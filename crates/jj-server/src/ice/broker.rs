//! The Cloudflare TURN credential broker (P1-N04b, R92, plan §5.3).
//!
//! One `turn-broker` (the `jj-server` binary with `JJ_ROLE=turn-broker`) alone holds the Cloudflare API token. Every
//! backend (production, each preview) asks it for a fallback credential on the internal network, proving itself with
//! `HMAC-SHA256(brokerKey, previewId)`. The broker enforces the issuance limits (token buckets: rates, never player
//! caps), keeps one credential per endpoint, and answers a retried `requestId` with the same credential.
//!
//! [`Broker`] is runtime-free and takes time as an argument (virtual time in tests). The Cloudflare call itself is
//! the only effect: `begin` says whether one is needed, the adapter performs it, `finish` records it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::time::Duration;

use jj_protocol::signal::{IceList, IceServer, RetryAfter};
use serde::{Deserialize, Serialize};

use super::{BrokerTransport, FallbackCtx, FallbackError};
use crate::crypto::{ct_eq, hmac_sha256};
use crate::rate::{Limiter, Rate};

/// Credential lifetime asked of Cloudflare (30 min; re-requested only while a peer still needs a relay).
pub const FALLBACK_TTL_S: u64 = 1_800;
/// A cached credential is reused while at least this much of its life remains.
pub const REUSE_MARGIN_MS: u64 = 300_000;
/// How long a `requestId` is remembered.
pub const REQUEST_MEMORY_MS: u64 = 600_000;

/// Per endpoint: burst 2, then 1 per 5 min.
pub const PER_ENDPOINT: Rate = Rate {
    burst: 2,
    refill_ms: 300_000,
};
/// Per room: burst 32, then 1 per 2 s.
pub const PER_ROOM: Rate = Rate {
    burst: 32,
    refill_ms: 2_000,
};
/// Per client IP: burst 32, then 1 per 5 s.
pub const PER_IP: Rate = Rate {
    burst: 32,
    refill_ms: 5_000,
};

pub const BACKEND_HEADER: &str = "x-jj-backend";
pub const BACKEND_AUTH_HEADER: &str = "x-jj-backend-auth";
pub const ISSUE_PATH: &str = "broker/issue";

/// Backend to broker, JSON.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRequest {
    pub request_id: String,
    pub realm: String,
    pub room_id: String,
    pub endpoint_id: String,
    /// Taken by the backend only from the tunnel's `CF-Connecting-IP`.
    pub client_ip: String,
}

/// `hex(HMAC-SHA256(brokerKey, previewId))`: the per-backend secret. The publish workflow injects it into the
/// backend; the broker recomputes it.
pub fn backend_secret(broker_key: &[u8], preview_id: &str) -> String {
    hmac_sha256(broker_key, &[preview_id.as_bytes()])
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The preview id of a deployment base path (`/p/<id>/` gives `<id>`, `/` gives `production`).
pub fn preview_id_of(base: &str) -> String {
    base.trim_matches('/')
        .strip_prefix("p/")
        .map(|s| s.trim_matches('/').to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "production".into())
}

/// Drops every URL on port 53 (some networks mangle it) and entries left with no URL.
pub fn filter_servers(servers: Vec<IceServer>) -> Vec<IceServer> {
    servers
        .into_iter()
        .filter_map(|mut s| {
            s.urls.retain(|u| !url_port_is_53(u));
            (!s.urls.is_empty()).then_some(s)
        })
        .collect()
}

fn url_port_is_53(url: &str) -> bool {
    let rest = url.split_once(':').map_or(url, |(_, r)| r);
    let hostport = rest
        .trim_start_matches("//")
        .split('?')
        .next()
        .unwrap_or("");
    hostport.rsplit_once(':').is_some_and(|(_, p)| p == "53")
}

/// A backend (production or preview) must never hold the Cloudflare token: only the broker does.
pub fn backend_env_violation(get: &dyn Fn(&str) -> Option<String>) -> Option<&'static str> {
    ["CF_TURN_KEY_API_TOKEN", "CF_TURN_KEY_ID", "JJ_BROKER_KEY"]
        .into_iter()
        .find(|k| get(k).is_some())
}

// ---- Cloudflare API shapes (the effect the adapter performs) ----

/// One stderr line per distinct relay-fallback failure cause (`kind` + `detail`) for the process's life, so a
/// relay-unavailable answer says why without logging per request. Never pass a secret, credential or response body
/// that could hold one.
pub fn note_once(kind: &str, detail: &str) {
    static SEEN: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    let key = format!("{kind}: {detail}");
    let mut seen = SEEN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !seen.contains(&key) {
        eprintln!("jj-server: relay fallback unavailable: {key}");
        seen.push(key);
    }
}

/// A Cloudflare error body, safe to log: only its `errors[].message`/`code` fields, never the raw body.
pub fn cf_error_summary(body: &[u8]) -> String {
    let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let errs: Vec<String> = v
        .get("errors")
        .and_then(|e| e.as_array())
        .map(|a| {
            a.iter()
                .map(|e| {
                    format!(
                        "{} {}",
                        e.get("code").unwrap_or(&serde_json::Value::Null),
                        e.get("message").and_then(|m| m.as_str()).unwrap_or("")
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    if errs.is_empty() {
        format!("{} body bytes", body.len())
    } else {
        errs.join("; ").chars().take(200).collect()
    }
}

pub fn cf_issue_url(key_id: &str) -> String {
    format!(
        "https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
    )
}

pub fn cf_issue_body(ttl_s: u64, custom_identifier: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({"ttl": ttl_s, "customIdentifier": custom_identifier}))
        .unwrap_or_default()
}

/// Parses `{"iceServers": [...]}` (or a single object) and drops port-53 URLs.
#[allow(clippy::result_unit_err)]
pub fn parse_cf_response(body: &[u8]) -> Result<Vec<IceServer>, ()> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Wire {
        ice_servers: serde_json::Value,
    }
    let wire: Wire = serde_json::from_slice(body).map_err(|_| ())?;
    let list: Vec<IceServer> = match wire.ice_servers {
        v @ serde_json::Value::Array(_) => serde_json::from_value(v).map_err(|_| ())?,
        v => vec![serde_json::from_value(v).map_err(|_| ())?],
    };
    let list = filter_servers(list);
    if list.is_empty() { Err(()) } else { Ok(list) }
}

// ---- the broker ----

#[derive(Clone, Debug)]
struct Issued {
    servers: Vec<IceServer>,
    expires_at_ms: u64,
}

/// The Cloudflare call as the broker sees it: custom identifier and TTL in, ICE servers out (`Err`: provider failure).
pub type CfCall<'a> = dyn FnMut(&str, u64) -> Result<Vec<IceServer>, ()> + 'a;

/// What `begin` decided.
pub enum Begin {
    /// Answered without Cloudflare (cached, replayed, limited, refused).
    Done(Result<(Vec<IceServer>, u64), FallbackError>),
    /// Call Cloudflare with this `customIdentifier` and TTL, then `finish`.
    Issue {
        custom_identifier: String,
        ttl_s: u64,
    },
}

pub struct Broker {
    key: Vec<u8>,
    /// Cloudflare key and token are present.
    configured: bool,
    endpoint: Limiter,
    room: Limiter,
    ip: Limiter,
    by_endpoint: HashMap<String, Issued>,
    by_request: HashMap<String, (u64, Issued)>,
}

impl Broker {
    pub fn new(key: Vec<u8>, configured: bool) -> Self {
        Self {
            key,
            configured,
            endpoint: Limiter::new(PER_ENDPOINT),
            room: Limiter::new(PER_ROOM),
            ip: Limiter::new(PER_IP),
            by_endpoint: HashMap::new(),
            by_request: HashMap::new(),
        }
    }

    /// Whether `auth` is the secret of backend `preview_id`; another backend's secret fails.
    pub fn authentic(&self, preview_id: &str, auth: &str) -> bool {
        let want = backend_secret(&self.key, preview_id);
        !preview_id.is_empty() && ct_eq(want.as_bytes(), auth.as_bytes())
    }

    fn endpoint_key(req: &IssueRequest) -> String {
        format!("{}/{}/{}", req.realm, req.room_id, req.endpoint_id)
    }

    pub fn begin(&mut self, req: &IssueRequest, now: u64) -> Begin {
        self.prune(now);
        if let Some((_, i)) = self.by_request.get(&req.request_id) {
            return Begin::Done(Ok((i.servers.clone(), i.expires_at_ms)));
        }
        if !self.configured {
            return Begin::Done(Err(FallbackError::RelayUnavailable));
        }
        let ekey = Self::endpoint_key(req);
        // One credential per endpoint: the host's peers share it. Reuse costs Cloudflare nothing, so no token.
        if let Some(i) = self.by_endpoint.get(&ekey)
            && i.expires_at_ms >= now + REUSE_MARGIN_MS
        {
            let i = i.clone();
            let out = Ok((i.servers.clone(), i.expires_at_ms));
            self.by_request.insert(req.request_id.clone(), (now, i));
            return Begin::Done(out);
        }
        let waits = [
            self.ip.take(&req.client_ip, now),
            self.room
                .take(&format!("{}/{}", req.realm, req.room_id), now),
            self.endpoint.take(&ekey, now),
        ];
        if let Some(wait) = waits.iter().filter_map(|w| w.err()).max() {
            return Begin::Done(Err(FallbackError::RateLimited {
                retry_after_ms: wait,
            }));
        }
        Begin::Issue {
            custom_identifier: format!("jj-{}-{}-{}", req.realm, req.room_id, req.endpoint_id),
            ttl_s: FALLBACK_TTL_S,
        }
    }

    /// Records Cloudflare's answer to an `Issue`.
    pub fn finish(
        &mut self,
        req: &IssueRequest,
        cf: Result<Vec<IceServer>, ()>,
        now: u64,
    ) -> Result<(Vec<IceServer>, u64), FallbackError> {
        // A provider failure drops only this provider's entries; it isn't remembered, so a retry may succeed.
        let servers = filter_servers(cf.map_err(|()| FallbackError::RelayUnavailable)?);
        if servers.is_empty() {
            return Err(FallbackError::RelayUnavailable);
        }
        let i = Issued {
            servers,
            expires_at_ms: now + FALLBACK_TTL_S * 1000,
        };
        let out = (i.servers.clone(), i.expires_at_ms);
        self.by_endpoint.insert(Self::endpoint_key(req), i.clone());
        self.by_request.insert(req.request_id.clone(), (now, i));
        Ok(out)
    }

    /// `begin` + a synchronous Cloudflare call + `finish` (tests and in-process use).
    pub fn issue(
        &mut self,
        req: &IssueRequest,
        now: u64,
        cf: &mut CfCall<'_>,
    ) -> Result<(Vec<IceServer>, u64), FallbackError> {
        match self.begin(req, now) {
            Begin::Done(r) => r,
            Begin::Issue {
                custom_identifier,
                ttl_s,
            } => {
                let r = cf(&custom_identifier, ttl_s);
                self.finish(req, r, now)
            }
        }
    }

    pub fn prune(&mut self, now: u64) {
        self.by_request
            .retain(|_, (at, _)| at.saturating_add(REQUEST_MEMORY_MS) > now);
        self.by_endpoint.retain(|_, i| i.expires_at_ms > now);
        self.endpoint.prune(now);
        self.room.prune(now);
        self.ip.prune(now);
    }
}

/// The broker's HTTP status and JSON body for a result.
pub fn http_result(r: Result<(Vec<IceServer>, u64), FallbackError>) -> (u16, Vec<u8>) {
    use jj_protocol::signal::{ErrorBody, to_json};
    match r {
        Ok((ice_servers, expires_at)) => (
            200,
            to_json(&IceList {
                ice_servers,
                expires_at,
            }),
        ),
        Err(FallbackError::RateLimited { retry_after_ms }) => {
            (429, to_json(&RetryAfter { retry_after_ms }))
        }
        Err(FallbackError::RelayUnavailable) => (
            503,
            to_json(&ErrorBody {
                reason: ErrorBody::RELAY_UNAVAILABLE.into(),
            }),
        ),
    }
}

// ---- backend side ----

/// A backend's blocking HTTP client to the broker (internal network, plain HTTP). One retry with the same
/// `requestId` after a transport failure, so a lost response yields the same credential.
pub struct HttpBroker {
    pub host_port: String,
    pub path_prefix: String,
    pub preview_id: String,
    pub secret: String,
    pub timeout: Duration,
}

impl HttpBroker {
    /// `url` is `http://host:port[/prefix]`; `https` is refused (the broker is reached on the internal network).
    pub fn new(url: &str, preview_id: &str, secret: &str) -> Option<Self> {
        let rest = url.strip_prefix("http://")?;
        let (host_port, prefix) = rest.split_once('/').unwrap_or((rest, ""));
        Some(Self {
            host_port: host_port.to_owned(),
            path_prefix: prefix.trim_matches('/').to_owned(),
            preview_id: preview_id.to_owned(),
            secret: secret.to_owned(),
            timeout: Duration::from_secs(4),
        })
    }

    fn once(&self, body: &[u8]) -> std::io::Result<(u16, Vec<u8>)> {
        use std::net::ToSocketAddrs;
        // Every resolved address in turn: on a dual-stack Docker network the name resolves to an IPv6 address first,
        // and the broker listens on 0.0.0.0 only, so taking the first one was "Connection refused" (2026-10-08).
        let mut last = std::io::Error::other("no address");
        let mut stream = None;
        for addr in self.host_port.to_socket_addrs()? {
            match std::net::TcpStream::connect_timeout(&addr, self.timeout) {
                Ok(s) => {
                    stream = Some(s);
                    break;
                }
                Err(e) => last = e,
            }
        }
        let mut s = stream.ok_or(last)?;
        s.set_read_timeout(Some(self.timeout))?;
        s.set_write_timeout(Some(self.timeout))?;
        let path = if self.path_prefix.is_empty() {
            format!("/{ISSUE_PATH}")
        } else {
            format!("/{}/{ISSUE_PATH}", self.path_prefix)
        };
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\n{BACKEND_HEADER}: {}\r\n{BACKEND_AUTH_HEADER}: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.host_port,
            self.preview_id,
            self.secret,
            body.len()
        );
        s.write_all(head.as_bytes())?;
        s.write_all(body)?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw)?;
        let split = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or_else(|| std::io::Error::other("no header end"))?;
        let status = std::str::from_utf8(&raw[..split])
            .ok()
            .and_then(|h| h.split_whitespace().nth(1))
            .and_then(|c| c.parse::<u16>().ok())
            .ok_or_else(|| std::io::Error::other("bad status"))?;
        Ok((status, raw[split + 4..].to_vec()))
    }
}

impl BrokerTransport for HttpBroker {
    fn issue(
        &self,
        ctx: &FallbackCtx,
        _now_ms: u64,
    ) -> Result<(Vec<IceServer>, u64), FallbackError> {
        let body =
            serde_json::to_vec(&ctx.to_issue()).map_err(|_| FallbackError::RelayUnavailable)?;
        let res = self.once(&body).or_else(|_| self.once(&body));
        match res {
            Ok((200, b)) => serde_json::from_slice::<IceList>(&b)
                .map(|l| (l.ice_servers, l.expires_at))
                .map_err(|e| {
                    note_once(
                        "broker reply unreadable",
                        &format!("{} bytes: {e}", b.len()),
                    );
                    FallbackError::RelayUnavailable
                }),
            Ok((429, b)) => Err(FallbackError::RateLimited {
                retry_after_ms: serde_json::from_slice::<RetryAfter>(&b)
                    .map_or(5_000, |r| r.retry_after_ms),
            }),
            Ok((status, b)) => {
                // The broker's own error bodies carry no secret (text or the relay-unavailable JSON).
                let text: String = String::from_utf8_lossy(&b).chars().take(120).collect();
                note_once("broker answered", &format!("{status} {text}"));
                Err(FallbackError::RelayUnavailable)
            }
            Err(e) => {
                note_once("broker unreachable", &format!("{}: {e}", self.host_port));
                Err(FallbackError::RelayUnavailable)
            }
        }
    }
}

type CfMock = std::sync::Arc<dyn Fn(&str, u64) -> Result<Vec<IceServer>, ()> + Send + Sync>;

/// In-process transport for tests: a shared [`Broker`] plus a scripted Cloudflare, so "two backends share one bucket"
/// runs without sockets. Each backend holds its own preview id and secret.
pub struct InProcessBroker {
    pub broker: std::sync::Arc<std::sync::Mutex<Broker>>,
    pub cf: CfMock,
    pub preview_id: String,
    pub secret: String,
}

impl BrokerTransport for InProcessBroker {
    fn issue(
        &self,
        ctx: &FallbackCtx,
        now_ms: u64,
    ) -> Result<(Vec<IceServer>, u64), FallbackError> {
        let mut b = self.broker.lock().expect("broker lock");
        if !b.authentic(&self.preview_id, &self.secret) {
            return Err(FallbackError::RelayUnavailable);
        }
        let cf = self.cf.clone();
        b.issue(&ctx.to_issue(), now_ms, &mut |id, ttl| cf(id, ttl))
    }
}

#[cfg(test)]
mod tests;
