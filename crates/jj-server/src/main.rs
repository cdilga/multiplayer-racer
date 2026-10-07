//! `jj-server`: the Asupersync adapter (R2, no Tokio). It parses HTTP/1.1 into the runtime-free [`App`], writes the
//! response back, and keeps SSE streams open with a 15 s heartbeat. Configuration is environment only:
//!
//! | Variable | Default | Meaning |
//! |---|---|---|
//! | `JJ_BIND` | `0.0.0.0:8080` | listen address |
//! | `JJ_DIST` | `web/dist` | the built web bundle |
//! | `JJ_BASE_PATH` | `/` | deployment base (`/p/<id>/` in a preview) |
//! | `JJ_BUILD` | `dev` | build id for `/version` |
//! | `JJ_REALM` | `dev` | `production` hides the test surface |
//! | `JJ_ROOM_KEY` | a fixed dev key | room-ticket key; must survive restarts in a deployment |
//! | `JJ_PUBLIC_ORIGIN` | from the request | origin for join URLs |
//! | `TURN_STATIC_AUTH_SECRET` | none (STUN only) | coturn `use-auth-secret` |
//! | `JJ_STUN_URLS`, `JJ_TURN_URLS` | Cloudflare STUN, `turn.dilger.dev:3479` UDP | comma-separated (tests: a local coturn) |
//! | `JJ_TURN_TTL_S` | 7200 | TURN credential lifetime |
//! | `JJ_BROKER_URL` | none | the TURN broker, `http://host:port` on the internal network (P1-N04b); unset, the relay fallback is unavailable |
//! | `JJ_BROKER_SECRET`, `JJ_PREVIEW_ID` | none, from `JJ_BASE_PATH` | this backend's `HMAC-SHA256(brokerKey, previewId)` and id |
//! | `JJ_ROLE` | `server` | `turn-broker` runs the credential broker instead (same image) |
//! | `JJ_BROKER_KEY`, `CF_TURN_KEY_ID`, `CF_TURN_KEY_API_TOKEN` | none | broker role only; a backend refuses to start holding them |
//!
//! `jj-server --healthcheck` checks a running server on `JJ_BIND`'s port (the image's HEALTHCHECK).

use std::future::poll_fn;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use asupersync::bytes::{Buf, Bytes};
use asupersync::combinator::select::{Either, Select};
use asupersync::cx::Cx;
use asupersync::http::body::{Body as _, Frame};
use asupersync::http::h1::HttpError;
use asupersync::http::h1::server::HostPolicy;
use asupersync::http::h1::{
    Http1Config, Http1Listener, Http1ListenerConfig, Http1ProducedResponse, IncomingRequestBody,
    Method, StreamingServerRequest,
};
use asupersync::runtime::RuntimeBuilder;
use asupersync::time::{sleep, wall_now};

use jj_server::app::{App, Config, SSE_HEARTBEAT, SSE_HEARTBEAT_MS, sse_event};
use jj_server::crypto::OsEntropy;
use jj_server::http::{Body, MAX_BODY_BYTES, MAX_HEADER_BYTES, Request, Response, SseOpen};
use jj_server::ice::CoturnProvider;
use jj_server::ice::broker::{self, Begin, Broker, IssueRequest};
use jj_server::statics::Bundle;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn method_name(m: &Method) -> String {
    match m {
        Method::Get => "GET".into(),
        Method::Head => "HEAD".into(),
        Method::Post => "POST".into(),
        Method::Put => "PUT".into(),
        Method::Delete => "DELETE".into(),
        Method::Options => "OPTIONS".into(),
        Method::Patch => "PATCH".into(),
        other => format!("{other:?}").to_ascii_uppercase(),
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        410 => "Gone",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        503 => "Service Unavailable",
        _ => "Status",
    }
}

async fn read_body(mut body: IncomingRequestBody) -> Result<Vec<u8>, ()> {
    let mut out = Vec::new();
    loop {
        match poll_fn(|c| Pin::new(&mut body).poll_frame(c)).await {
            None => return Ok(out),
            Some(Err(_)) => return Err(()),
            Some(Ok(Frame::Data(mut d))) => {
                while d.has_remaining() {
                    let n = d.chunk().len();
                    out.extend_from_slice(d.chunk());
                    d.advance(n);
                }
                if out.len() > MAX_BODY_BYTES {
                    return Err(());
                }
            }
            Some(Ok(_)) => {}
        }
    }
}

fn fixed(resp: Response, head: bool) -> Http1ProducedResponse {
    let bytes = match resp.body {
        Body::Bytes(b) => b,
        Body::Sse(_) => Vec::new(),
    };
    let len = bytes.len() as u64;
    let cap = NonZeroUsize::new(4).expect("non-zero");
    let mut out = if head {
        Http1ProducedResponse::with_content_length(
            cap,
            resp.status,
            reason(resp.status),
            len,
            |cx, mut s| async move {
                s.finish(&cx)?;
                Ok(s)
            },
        )
    } else {
        Http1ProducedResponse::with_content_length(
            cap,
            resp.status,
            reason(resp.status),
            len,
            move |cx, mut s| {
                async move {
                    // The server's frame cap is 64 KiB; split larger bodies.
                    let bytes = Bytes::from(bytes);
                    let mut off = 0;
                    while off < bytes.len() {
                        let end = (off + 60 * 1024).min(bytes.len());
                        s.send_bytes(&cx, bytes.slice(off..end)).await?;
                        off = end;
                    }
                    s.finish(&cx)?;
                    Ok(s)
                }
            },
        )
    };
    for (k, v) in resp.headers {
        out = out.with_header(k, v);
    }
    out
}

fn sse(app: Arc<App>, open: SseOpen, headers: Vec<(String, String)>) -> Http1ProducedResponse {
    let cap = NonZeroUsize::new(16).expect("non-zero");
    let mut out = Http1ProducedResponse::chunked(cap, 200, "OK", move |cx, mut s| async move {
        if !app.sse_opened(&open, now_ms()) {
            s.finish(&cx)?;
            return Ok(s);
        }
        let mut cursor = open.last_event_id;
        // A comment first, so proxies flush the headers straight away.
        let result: Result<(), HttpError> = async {
            s.send_bytes(&cx, Bytes::from_static(b": open\n\n")).await?;
            while let Some(events) = app.sse_take(&open, cursor) {
                if !events.is_empty() {
                    let mut chunk = String::new();
                    for e in &events {
                        chunk.push_str(&sse_event(e));
                        cursor = e.id;
                    }
                    s.send_bytes(&cx, Bytes::from(chunk)).await?;
                    continue;
                }
                let wait = Box::pin(app.sse_wait(&open, cursor));
                let tick = Box::pin(sleep(wall_now(), Duration::from_millis(SSE_HEARTBEAT_MS)));
                match Select::new(wait, tick).await {
                    Ok(Either::Left(())) => {}
                    Ok(Either::Right(_)) => {
                        s.send_bytes(&cx, Bytes::from_static(SSE_HEARTBEAT.as_bytes()))
                            .await?
                    }
                    Err(_) => break,
                }
            }
            Ok(())
        }
        .await;
        app.sse_closed(&open, now_ms());
        result?;
        s.finish(&cx)?;
        Ok(s)
    });
    for (k, v) in headers {
        out = out.with_header(k, v);
    }
    out
}

async fn serve(app: Arc<App>, req: StreamingServerRequest) -> Http1ProducedResponse {
    let head = req.head;
    let peer = req
        .peer_addr
        .map(|a| a.ip().to_string())
        .unwrap_or_default();
    let Ok(body) = read_body(req.body).await else {
        return fixed(Response::text(413, "body too large"), false);
    };
    let mut r = Request::new(&method_name(&head.method), &head.uri);
    r.headers = head
        .headers
        .into_iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v))
        .collect();
    r.client_ip = r
        .header("cf-connecting-ip")
        .map(str::to_owned)
        .unwrap_or(peer);
    r.body = body;
    let resp = app.handle(&r, now_ms());
    match resp.body {
        Body::Sse(open) => sse(app, open, resp.headers),
        Body::Bytes(_) => fixed(resp, r.method == "HEAD"),
    }
}

/// `jj-server --healthcheck`: the image's HEALTHCHECK (no curl in the runtime image). GETs `B/healthz` on the local
/// port and exits 0 on `200`, 1 otherwise.
fn healthcheck() -> ! {
    use std::io::{Read, Write};
    let bind = env("JJ_BIND").unwrap_or_else(|| "0.0.0.0:8080".into());
    let port = bind.rsplit(':').next().unwrap_or("8080").to_owned();
    let base = jj_server::app::normalise_base(&env("JJ_BASE_PATH").unwrap_or_else(|| "/".into()));
    let ok = std::net::TcpStream::connect(("127.0.0.1", port.parse::<u16>().unwrap_or(8080)))
        .and_then(|mut s| {
            s.set_read_timeout(Some(Duration::from_secs(3)))?;
            write!(
                s,
                "GET {base}healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
            )?;
            let mut head = [0u8; 12];
            s.read_exact(&mut head)?;
            Ok(head.starts_with(b"HTTP/1.1 200"))
        })
        .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 });
}

/// The `turn-broker` role's state: the limits plus the only copy of the Cloudflare key.
struct BrokerApp {
    broker: std::sync::Mutex<Broker>,
    client: asupersync::http::h1::HttpClient,
    key_id: String,
    token: String,
}

async fn serve_broker(
    app: Arc<BrokerApp>,
    cx: Cx,
    req: StreamingServerRequest,
) -> Http1ProducedResponse {
    let head = req.head;
    let Ok(body) = read_body(req.body).await else {
        return fixed(Response::text(413, "body too large"), false);
    };
    let path = head.uri.split('?').next().unwrap_or("").to_owned();
    if matches!(head.method, Method::Get) && path.ends_with("/healthz") {
        return fixed(Response::text(200, "ok"), false);
    }
    if !(matches!(head.method, Method::Post) && path.ends_with(broker::ISSUE_PATH)) {
        return fixed(Response::text(404, "not found"), false);
    }
    let header = |n: &str| {
        head.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(n))
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let authentic = app.broker.lock().expect("broker lock").authentic(
        &header(broker::BACKEND_HEADER),
        &header(broker::BACKEND_AUTH_HEADER),
    );
    if !authentic {
        return fixed(Response::text(401, "bad backend secret"), false);
    }
    let Ok(ir) = serde_json::from_slice::<IssueRequest>(&body) else {
        return fixed(Response::text(400, "bad body"), false);
    };
    let now = now_ms();
    let begin = app.broker.lock().expect("broker lock").begin(&ir, now);
    let result = match begin {
        Begin::Done(r) => r,
        Begin::Issue {
            custom_identifier,
            ttl_s,
        } => {
            let cf = match app
                .client
                .post(broker::cf_issue_url(&app.key_id))
                .header("authorization", format!("Bearer {}", app.token))
                .header("content-type", "application/json")
                .body(broker::cf_issue_body(ttl_s, &custom_identifier))
                .send(&cx)
                .await
            {
                Ok(r) if (200..300).contains(&r.status) => broker::parse_cf_response(&r.body),
                _ => Err(()),
            };
            app.broker
                .lock()
                .expect("broker lock")
                .finish(&ir, cf, now_ms())
        }
    };
    let retry_after = match &result {
        Err(jj_server::ice::FallbackError::RateLimited { retry_after_ms }) => Some(*retry_after_ms),
        _ => None,
    };
    let (status, json) = broker::http_result(result);
    let mut resp = Response::json(status, json);
    if let Some(ms) = retry_after {
        resp = resp.with_header("retry-after", &ms.div_ceil(1000).to_string());
    }
    fixed(resp, false)
}

fn run_broker() -> ! {
    let bind = env("JJ_BIND").unwrap_or_else(|| "0.0.0.0:8080".into());
    let key_id = env("CF_TURN_KEY_ID");
    let token = env("CF_TURN_KEY_API_TOKEN");
    let Some(key) = env("JJ_BROKER_KEY") else {
        eprintln!("jj-server (turn-broker): JJ_BROKER_KEY is required");
        std::process::exit(1);
    };
    let configured = key_id.is_some() && token.is_some();
    eprintln!(
        "jj-server turn-broker: cloudflare {}",
        if configured {
            "configured"
        } else {
            "NOT configured (answers relay-unavailable)"
        }
    );
    let app = Arc::new(BrokerApp {
        broker: std::sync::Mutex::new(Broker::new(key.into_bytes(), configured)),
        client: asupersync::http::h1::HttpClient::builder()
            .no_retries()
            .no_redirects()
            .request_timeout(Duration::from_secs(8))
            .build(),
        key_id: key_id.unwrap_or_default(),
        token: token.unwrap_or_default(),
    });
    let rt = RuntimeBuilder::new()
        .build()
        .expect("the Asupersync runtime starts");
    let handle = rt.handle();
    rt.block_on(async move {
        let http = Http1Config::default()
            .host_policy(HostPolicy::AllowAll)
            .max_body_size(MAX_BODY_BYTES)
            .max_headers_size(MAX_HEADER_BYTES);
        let cfg = Http1ListenerConfig::default()
            .http_config(http)
            .max_connections(None);
        let handler =
            move |cx: Cx, req: StreamingServerRequest| serve_broker(Arc::clone(&app), cx, req);
        let listener =
            match Http1Listener::bind_produced_with_config(bind.clone(), handler, cfg).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("jj-server: can't bind {bind}: {e}");
                    std::process::exit(1);
                }
            };
        eprintln!("jj-server turn-broker: listening on {bind}");
        if let Err(e) = listener.run_produced(&handle).await {
            eprintln!("jj-server: stopped: {e}");
            std::process::exit(1);
        }
    });
    std::process::exit(0);
}

fn main() {
    if std::env::args().any(|a| a == "--healthcheck") {
        healthcheck();
    }
    if env("JJ_ROLE").as_deref() == Some("turn-broker") {
        run_broker();
    }
    if let Some(var) = broker::backend_env_violation(&|k| env(k)) {
        eprintln!(
            "jj-server: {var} is set, but only the turn-broker role may hold the Cloudflare credentials"
        );
        std::process::exit(1);
    }
    let bind = env("JJ_BIND").unwrap_or_else(|| "0.0.0.0:8080".into());
    let dist = PathBuf::from(env("JJ_DIST").unwrap_or_else(|| "web/dist".into()));
    let dev = Config::dev();
    let cfg = Config {
        base: env("JJ_BASE_PATH").unwrap_or(dev.base),
        build: env("JJ_BUILD").unwrap_or(dev.build),
        realm: env("JJ_REALM").unwrap_or(dev.realm),
        room_key: env("JJ_ROOM_KEY")
            .map(String::into_bytes)
            .unwrap_or(dev.room_key),
        public_origin: env("JJ_PUBLIC_ORIGIN"),
        broker: false,
    };
    let base = jj_server::app::normalise_base(&cfg.base);
    let bundle = match Bundle::load(&dist, &base) {
        Ok(b) => b,
        Err(e) => {
            eprintln!(
                "jj-server: can't load the bundle at {}: {e}",
                dist.display()
            );
            std::process::exit(1);
        }
    };
    let mut ice = CoturnProvider::new(env("TURN_STATIC_AUTH_SECRET").map(String::into_bytes));
    let list = |v: String| {
        v.split(',')
            .map(|u| u.trim().to_owned())
            .filter(|u| !u.is_empty())
            .collect()
    };
    let mut cfg = cfg;
    if let Some(url) = env("JJ_BROKER_URL") {
        let preview = env("JJ_PREVIEW_ID").unwrap_or_else(|| broker::preview_id_of(&base));
        match (
            env("JJ_BROKER_SECRET"),
            broker::HttpBroker::new(&url, &preview, ""),
        ) {
            (Some(secret), Some(mut b)) => {
                b.secret = secret;
                ice.broker = Some(Box::new(b));
                cfg.broker = true;
            }
            _ => eprintln!(
                "jj-server: JJ_BROKER_URL needs an http:// URL and JJ_BROKER_SECRET; the relay fallback stays unavailable"
            ),
        }
    }
    if let Some(v) = env("JJ_STUN_URLS") {
        ice.stun_urls = list(v);
    }
    if let Some(v) = env("JJ_TURN_URLS") {
        ice.turn_urls = list(v);
    }
    if let Some(ttl) = env("JJ_TURN_TTL_S").and_then(|v| v.parse().ok()) {
        ice.ttl_s = ttl;
    }
    eprintln!(
        "jj-server {}: {} assets from {}, base {base}, realm {}, ice {}",
        cfg.build,
        bundle.file_count(),
        dist.display(),
        cfg.realm,
        jj_server::ice::IceProvider::status(&ice)
    );
    let app = Arc::new(App::new(cfg, bundle, Box::new(ice), Box::new(OsEntropy)));

    let rt = RuntimeBuilder::new()
        .build()
        .expect("the Asupersync runtime starts");
    let handle = rt.handle();
    rt.block_on(async move {
        let http = Http1Config::default()
            .host_policy(HostPolicy::AllowAll)
            .max_body_size(MAX_BODY_BYTES)
            .max_headers_size(MAX_HEADER_BYTES);
        // No connection cap: rooms, endpoints and streams are never counted (R66).
        let cfg = Http1ListenerConfig::default()
            .http_config(http)
            .max_connections(None);
        let handler = move |_cx: Cx, req: StreamingServerRequest| serve(Arc::clone(&app), req);
        let listener =
            match Http1Listener::bind_produced_with_config(bind.clone(), handler, cfg).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("jj-server: can't bind {bind}: {e}");
                    std::process::exit(1);
                }
            };
        eprintln!(
            "jj-server: listening on {}",
            listener.local_addr().map(|a| a.to_string()).unwrap_or(bind)
        );
        if let Err(e) = listener.run_produced(&handle).await {
            eprintln!("jj-server: stopped: {e}");
            std::process::exit(1);
        }
    });
}
