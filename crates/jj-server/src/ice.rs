//! ICE provider (P1-N04, R88): STUN first, then the self-hosted coturn with short-lived TURN REST credentials minted
//! locally (no network call). The Cloudflare TURN fallback (P1-N04b) is lazy: a backend never holds the Cloudflare
//! token, it asks the one credential broker ([`broker`]); with no broker it answers `relay-unavailable`.

pub mod broker;

use jj_protocol::signal::IceServer;

use crate::crypto::{b64, hmac_sha1};

/// TTL of a minted coturn credential (DEFAULT); clients refresh at 75 % of it via `POST /ice`.
pub const TURN_TTL_S: u64 = 7_200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FallbackError {
    /// `503 {reason: relay-unavailable}`.
    RelayUnavailable,
    /// `429 {retryAfterMs}`.
    RateLimited { retry_after_ms: u64 },
}

/// What a fallback request carries to the broker.
#[derive(Clone, Debug)]
pub struct FallbackCtx {
    /// Fresh per client call; the transport's retry reuses it, so a lost response returns the same credential.
    pub request_id: String,
    pub realm: String,
    pub room_id: String,
    pub endpoint_id: String,
    /// The tunnel's `CF-Connecting-IP` (else the socket peer).
    pub client_ip: String,
}

impl FallbackCtx {
    pub fn to_issue(&self) -> broker::IssueRequest {
        broker::IssueRequest {
            request_id: self.request_id.clone(),
            realm: self.realm.clone(),
            room_id: self.room_id.clone(),
            endpoint_id: self.endpoint_id.clone(),
            client_ip: self.client_ip.clone(),
        }
    }
}

/// How a backend reaches the credential broker.
pub trait BrokerTransport: Send + Sync {
    fn issue(&self, ctx: &FallbackCtx, now_ms: u64)
    -> Result<(Vec<IceServer>, u64), FallbackError>;
}

pub trait IceProvider: Send + Sync {
    /// The initial list for an endpoint and its expiry (Unix ms).
    fn initial(&self, endpoint_id: &str, now_ms: u64) -> (Vec<IceServer>, u64);
    /// Cloudflare TURN entries, issued by the broker (P1-N04b).
    fn fallback(
        &self,
        _ctx: &FallbackCtx,
        _now_ms: u64,
    ) -> Result<(Vec<IceServer>, u64), FallbackError> {
        Err(FallbackError::RelayUnavailable)
    }
    /// Readiness note for `/healthz` (reported, never fatal).
    fn status(&self) -> &'static str;
}

/// STUN + coturn (`use-auth-secret`).
pub struct CoturnProvider {
    pub stun_urls: Vec<String>,
    pub turn_urls: Vec<String>,
    /// `TURN_STATIC_AUTH_SECRET`; without it the list is STUN only.
    pub secret: Option<Vec<u8>>,
    pub ttl_s: u64,
    /// The credential broker; `None` means the relay fallback is unavailable.
    pub broker: Option<Box<dyn BrokerTransport>>,
}

impl CoturnProvider {
    pub fn new(secret: Option<Vec<u8>>) -> Self {
        Self {
            stun_urls: vec!["stun:stun.cloudflare.com:3478".into()],
            turn_urls: vec!["turn:turn.dilger.dev:3479?transport=udp".into()],
            secret,
            ttl_s: TURN_TTL_S,
            broker: None,
        }
    }
}

/// The TURN REST credential coturn checks (`tools/net/turn_probe.py` mints the same):
/// `username = "<expiry unix s>:<label>"`, `credential = base64(HMAC-SHA1(secret, username))`.
pub fn mint_turn_credential(secret: &[u8], expiry_unix_s: u64, label: &str) -> (String, String) {
    let username = format!("{expiry_unix_s}:{label}");
    let credential = b64(&hmac_sha1(secret, username.as_bytes()));
    (username, credential)
}

impl IceProvider for CoturnProvider {
    fn initial(&self, endpoint_id: &str, now_ms: u64) -> (Vec<IceServer>, u64) {
        let expiry_s = now_ms / 1000 + self.ttl_s;
        // An entry with no URLs would make RTCPeerConnection throw, so empty lists are left out.
        let mut list = Vec::new();
        if !self.stun_urls.is_empty() {
            list.push(IceServer {
                urls: self.stun_urls.clone(),
                username: None,
                credential: None,
            });
        }
        if let Some(secret) = &self.secret
            && !self.turn_urls.is_empty()
        {
            let (username, credential) = mint_turn_credential(secret, expiry_s, endpoint_id);
            list.push(IceServer {
                urls: self.turn_urls.clone(),
                username: Some(username),
                credential: Some(credential),
            });
        }
        (list, expiry_s * 1000)
    }

    fn fallback(
        &self,
        ctx: &FallbackCtx,
        now_ms: u64,
    ) -> Result<(Vec<IceServer>, u64), FallbackError> {
        match &self.broker {
            Some(b) => b.issue(ctx, now_ms),
            None => Err(FallbackError::RelayUnavailable),
        }
    }

    fn status(&self) -> &'static str {
        if self.secret.is_some() {
            "stun+coturn"
        } else {
            "stun-only (no TURN_STATIC_AUTH_SECRET)"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_matches_turn_probe_format() {
        // Golden: python3 -c 'import hmac,hashlib,base64;print(base64.b64encode(hmac.new(b"s3cret",
        //   b"1700000600:c-9f2a",hashlib.sha1).digest()).decode())'
        let (u, c) = mint_turn_credential(b"s3cret", 1_700_000_600, "c-9f2a");
        assert_eq!(u, "1700000600:c-9f2a");
        assert_eq!(c, GOLDEN_CREDENTIAL);
    }

    const GOLDEN_CREDENTIAL: &str =
        include_str!("../tests/golden/turn-credential.txt").trim_ascii();

    #[test]
    fn initial_list_is_stun_then_coturn_with_expiry() {
        let p = CoturnProvider::new(Some(b"k".to_vec()));
        let (list, exp) = p.initial("c-1", 1_000_000);
        assert_eq!(list.len(), 2);
        assert!(list[0].urls[0].starts_with("stun:") && list[0].username.is_none());
        assert!(list[1].urls[0].starts_with("turn:turn.dilger.dev:3479"));
        assert_eq!(list[1].username.as_deref(), Some("8200:c-1"));
        assert_eq!(exp, 8_200_000);
    }

    #[test]
    fn fallback_is_unavailable_without_a_broker() {
        let p = CoturnProvider::new(None);
        let ctx = FallbackCtx {
            request_id: "q".into(),
            realm: "dev".into(),
            room_id: "r".into(),
            endpoint_id: "c-1".into(),
            client_ip: "1.1.1.1".into(),
        };
        assert_eq!(p.fallback(&ctx, 0), Err(FallbackError::RelayUnavailable));
        assert_eq!(p.initial("c-1", 0).0.len(), 1);
    }
}
