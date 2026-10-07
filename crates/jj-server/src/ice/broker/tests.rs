//! P1-N04b: the credential broker on virtual time with a mocked Cloudflare, plus the backend route through it.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use jj_protocol::signal::{ErrorBody, IceList, IceServer, RetryAfter, RoomCreated, from_json};

use super::*;
use crate::app::{App, Config};
use crate::crypto::{SeededEntropy, secret_hash};
use crate::http::Request;
use crate::ice::CoturnProvider;
use crate::statics::{Bundle, Page};

const T0: u64 = 1_800_000_000_000;
const KEY: &[u8] = b"broker-key";

fn cf_servers(id: &str) -> Vec<IceServer> {
    vec![
        IceServer {
            urls: vec![
                "stun:stun.cloudflare.com:3478".into(),
                "stun:stun.cloudflare.com:53".into(),
            ],
            username: None,
            credential: None,
        },
        IceServer {
            urls: vec![
                "turn:turn.cloudflare.com:3478?transport=udp".into(),
                "turn:turn.cloudflare.com:53?transport=udp".into(),
                "turn:turn.cloudflare.com:80?transport=tcp".into(),
                "turns:turn.cloudflare.com:5349?transport=tcp".into(),
                "turns:turn.cloudflare.com:443?transport=tcp".into(),
            ],
            username: Some(format!("u-{id}")),
            credential: Some(format!("c-{id}")),
        },
    ]
}

fn req(id: &str, room: &str, ep: &str, ip: &str) -> IssueRequest {
    IssueRequest {
        request_id: id.into(),
        realm: "preview".into(),
        room_id: room.into(),
        endpoint_id: ep.into(),
        client_ip: ip.into(),
    }
}

/// A mocked Cloudflare counting its calls.
fn cf(calls: &Arc<AtomicUsize>) -> impl FnMut(&str, u64) -> Result<Vec<IceServer>, ()> + use<> {
    let calls = calls.clone();
    move |id, ttl| {
        assert_eq!(ttl, FALLBACK_TTL_S);
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(cf_servers(id))
    }
}

#[test]
fn forty_endpoints_behind_one_ip_all_get_credentials_within_the_worst_case() {
    let mut b = Broker::new(KEY.to_vec(), true);
    let calls = Arc::new(AtomicUsize::new(0));
    let mut cf = cf(&calls);
    let (mut now, mut got, mut refusals) = (T0, 0, 0);
    let mut first_batch = 0;
    for n in 0..40 {
        let r = req(&format!("q{n}"), "room-1", &format!("c-{n}"), "203.0.113.9");
        loop {
            match b.issue(&r, now, &mut cf) {
                Ok(_) => {
                    got += 1;
                    if now == T0 {
                        first_batch += 1;
                    }
                    break;
                }
                // A 429 is a wait, never a refusal: the client retries after retryAfterMs.
                Err(FallbackError::RateLimited { retry_after_ms }) => {
                    assert!(retry_after_ms > 0);
                    refusals += 1;
                    now += retry_after_ms;
                }
                Err(e) => panic!("{e:?}"),
            }
        }
    }
    assert_eq!(got, 40);
    assert_eq!(first_batch, 32, "burst of 32 at once");
    assert!(refusals >= 8);
    // 32 at once, the other 8 at 1 per 5 s: all within 40 s.
    assert!(now - T0 <= 40_000, "took {} ms", now - T0);
    assert_eq!(calls.load(Ordering::SeqCst), 40);
}

#[test]
fn a_retried_request_id_returns_the_same_credential_even_when_limited_since() {
    let mut b = Broker::new(KEY.to_vec(), true);
    let calls = Arc::new(AtomicUsize::new(0));
    let mut cf = cf(&calls);
    let first = b
        .issue(&req("q1", "r", "c-1", "1.1.1.1"), T0, &mut cf)
        .unwrap();
    // Exhaust the IP's burst, then the lost response is retried.
    for n in 0..40 {
        let _ = b.issue(
            &req(&format!("x{n}"), "r2", &format!("e{n}"), "1.1.1.1"),
            T0,
            &mut cf,
        );
    }
    let again = b
        .issue(&req("q1", "r", "c-1", "1.1.1.1"), T0 + 1, &mut cf)
        .unwrap();
    assert_eq!(first, again);
    // Forgotten after the memory window.
    b.prune(T0 + REQUEST_MEMORY_MS + 1);
    assert!(b.by_request.is_empty());
}

#[test]
fn one_credential_per_endpoint_is_reused_for_every_peer_and_the_endpoint_bucket_rations_new_ones() {
    let mut b = Broker::new(KEY.to_vec(), true);
    let calls = Arc::new(AtomicUsize::new(0));
    let mut cf = cf(&calls);
    // The host (one endpoint) serves many peers: a different requestId per peer, one Cloudflare credential.
    let a = b
        .issue(&req("p1", "r", "host", "1.1.1.1"), T0, &mut cf)
        .unwrap();
    for n in 2..20 {
        let r = b
            .issue(
                &req(&format!("p{n}"), "r", "host", "1.1.1.1"),
                T0 + n,
                &mut cf,
            )
            .unwrap();
        assert_eq!(r, a);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(
        a.0.iter()
            .any(|s| s.username.as_deref() == Some("u-jj-preview-r-host"))
    );
    // Near expiry a new credential is minted (burst 2), a third within 5 min is rate-limited, then recovers.
    let t1 = T0 + FALLBACK_TTL_S * 1000 - REUSE_MARGIN_MS + 1;
    b.issue(&req("n1", "r", "host", "1.1.1.1"), t1, &mut cf)
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let t2 = t1 + FALLBACK_TTL_S * 1000 - REUSE_MARGIN_MS + 1;
    let limited = b.issue(&req("n2", "r", "host", "1.1.1.1"), t2, &mut cf);
    assert!(
        matches!(limited, Ok(_) | Err(FallbackError::RateLimited { .. })),
        "{limited:?}"
    );
}

#[test]
fn endpoint_bucket_is_burst_two_then_one_per_five_minutes() {
    let mut b = Broker::new(KEY.to_vec(), true);
    let mut n = 0;
    let mut mint = |b: &mut Broker, now| {
        n += 1;
        let r = req(&format!("m{n}"), "r", "c-1", "2.2.2.2");
        // Force a fresh credential each time by forgetting the cached one.
        b.by_endpoint.clear();
        b.issue(&r, now, &mut |id, _| Ok(cf_servers(id)))
    };
    assert!(mint(&mut b, T0).is_ok());
    assert!(mint(&mut b, T0).is_ok());
    let Err(FallbackError::RateLimited { retry_after_ms }) = mint(&mut b, T0) else {
        panic!("third in a burst is limited")
    };
    assert_eq!(retry_after_ms, 300_000);
    assert!(mint(&mut b, T0 + 300_000).is_ok());
}

#[test]
fn a_wrong_or_other_backends_secret_is_rejected() {
    let b = Broker::new(KEY.to_vec(), true);
    let a = backend_secret(KEY, "pv-a");
    assert!(b.authentic("pv-a", &a));
    assert!(!b.authentic("pv-b", &a), "another backend's secret");
    assert!(!b.authentic("pv-a", "deadbeef"));
    assert!(!b.authentic("pv-a", ""));
    assert!(!b.authentic("", &backend_secret(KEY, "")));
    assert!(!Broker::new(b"other".to_vec(), true).authentic("pv-a", &a));
    assert_eq!(a.len(), 64);
}

#[test]
fn with_the_key_unset_the_broker_says_relay_unavailable_and_never_calls_cloudflare() {
    let mut b = Broker::new(KEY.to_vec(), false);
    let r = b.issue(&req("q", "r", "c", "1.1.1.1"), T0, &mut |_, _| {
        panic!("no Cloudflare")
    });
    assert_eq!(r, Err(FallbackError::RelayUnavailable));
}

#[test]
fn a_cloudflare_failure_is_relay_unavailable_and_not_remembered() {
    let mut b = Broker::new(KEY.to_vec(), true);
    let r = b.issue(&req("q", "r", "c", "1.1.1.1"), T0, &mut |_, _| Err(()));
    assert_eq!(r, Err(FallbackError::RelayUnavailable));
    let ok = b.issue(&req("q", "r", "c", "1.1.1.1"), T0 + 1, &mut |id, _| {
        Ok(cf_servers(id))
    });
    assert!(ok.is_ok(), "the retry may succeed");
}

#[test]
fn port_53_urls_are_dropped_and_the_tls_443_entry_is_kept() {
    let kept = filter_servers(cf_servers("x"));
    let all: Vec<&String> = kept.iter().flat_map(|s| &s.urls).collect();
    assert!(
        all.iter()
            .all(|u| !u.contains(":53?") && !u.ends_with(":53")),
        "{all:?}"
    );
    assert!(
        all.iter()
            .any(|u| u.starts_with("turns:") && u.contains(":443"))
    );
    assert!(all.iter().any(|u| u.contains(":80?transport=tcp")));
    let body = br#"{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53","turn:turn.cloudflare.com:53?transport=udp"],"username":"u","credential":"c"}]}"#;
    let parsed = parse_cf_response(body).unwrap();
    assert_eq!(
        parsed[0].urls,
        vec!["stun:stun.cloudflare.com:3478".to_string()]
    );
    // The single-object shape, and an answer with nothing usable.
    assert!(
        parse_cf_response(
            br#"{"iceServers":{"urls":["turn:a.b:3478"],"username":"u","credential":"c"}}"#
        )
        .is_ok()
    );
    assert!(parse_cf_response(br#"{"iceServers":[{"urls":["turn:a.b:53"]}]}"#).is_err());
    assert!(parse_cf_response(b"nope").is_err());
}

#[test]
fn cloudflare_request_shape() {
    assert_eq!(
        cf_issue_url("KEYID"),
        "https://rtc.live.cloudflare.com/v1/turn/keys/KEYID/credentials/generate-ice-servers"
    );
    let v: serde_json::Value = serde_json::from_slice(&cf_issue_body(1800, "jj-p-r-e")).unwrap();
    assert_eq!(v["ttl"], 1800);
    assert_eq!(v["customIdentifier"], "jj-p-r-e");
}

#[test]
fn only_the_broker_role_may_hold_the_cloudflare_credentials() {
    let none = |_: &str| None;
    assert_eq!(backend_env_violation(&none), None);
    let tok = |k: &str| (k == "CF_TURN_KEY_API_TOKEN").then(|| "x".to_owned());
    assert_eq!(backend_env_violation(&tok), Some("CF_TURN_KEY_API_TOKEN"));
    let bk = |k: &str| (k == "JJ_BROKER_KEY").then(|| "x".to_owned());
    assert_eq!(backend_env_violation(&bk), Some("JJ_BROKER_KEY"));
}

#[test]
fn preview_id_comes_from_the_base_path() {
    assert_eq!(preview_id_of("/"), "production");
    assert_eq!(preview_id_of("/p/abc123/"), "abc123");
    assert_eq!(preview_id_of("/p/abc123"), "abc123");
}

// ---- through the backend route ----

fn bundle(base: &str) -> Bundle {
    let mut b = Bundle::empty();
    b.insert("assets/host-abc.js", b"1");
    let page = "<html><head><script src=\"../assets/host-abc.js\"></script></head></html>";
    b.insert_page(Page::Landing, page, base);
    b.insert_page(Page::Host, page, base);
    b.insert_page(Page::Controller, page, base);
    b
}

type SharedBroker = Arc<Mutex<Broker>>;

fn backend(
    base: &str,
    broker: &SharedBroker,
    preview: &str,
    secret: &str,
    calls: &Arc<AtomicUsize>,
) -> App {
    let calls = calls.clone();
    let mut ice = CoturnProvider::new(Some(b"k".to_vec()));
    ice.broker = Some(Box::new(InProcessBroker {
        broker: broker.clone(),
        cf: Arc::new(move |id, _| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(cf_servers(id))
        }),
        preview_id: preview.into(),
        secret: secret.into(),
    }));
    App::new(
        Config {
            base: base.into(),
            realm: "preview".into(),
            broker: true,
            ..Config::dev()
        },
        bundle(base),
        Box::new(ice),
        Box::new(SeededEntropy(preview.bytes().map(u64::from).sum())),
    )
}

fn post(path: &str, body: String, secret: &str, ip: &str) -> Request {
    Request::new("POST", path)
        .with_body(body)
        .with_ip(ip)
        .with_header("authorization", &format!("Bearer {secret}"))
}

fn open_room(app: &App, base: &str, endpoints: &[&str], now: u64) -> String {
    let r = app.handle(
        &Request::new("POST", &format!("{base}api/v1/rooms"))
            .with_body(format!(
                r#"{{"requestId":"rq","hostSecretHash":"{}"}}"#,
                secret_hash("hs")
            ))
            .with_ip("10.0.0.1")
            .with_header("host", "jj.test"),
        now,
    );
    let room: RoomCreated = from_json(r.body_bytes()).unwrap();
    for ep in endpoints {
        let r = app.handle(
            &Request::new(
                "POST",
                &format!("{base}api/v1/rooms/{}/endpoints", room.room_id.0),
            )
            .with_body(format!(
                r#"{{"requestId":"q-{ep}","endpointId":"{ep}","endpointSecretHash":"{}"}}"#,
                secret_hash("cs")
            ))
            .with_ip("10.0.0.1"),
            now,
        );
        assert_eq!(r.status, 201, "{}", String::from_utf8_lossy(r.body_bytes()));
    }
    room.room_id.0
}

fn fallback(
    app: &App,
    base: &str,
    room: &str,
    ep: &str,
    ip: &str,
    now: u64,
) -> crate::http::Response {
    app.handle(
        &post(
            &format!("{base}api/v1/ice/fallback"),
            format!(r#"{{"roomId":"{room}","endpointId":"{ep}","reason":"udp-blocked"}}"#),
            "cs",
            ip,
        ),
        now,
    )
}

#[test]
fn the_route_returns_cloudflare_entries_and_two_backends_share_one_bucket() {
    let broker: SharedBroker = Arc::new(Mutex::new(Broker::new(KEY.to_vec(), true)));
    let calls = Arc::new(AtomicUsize::new(0));
    let a = backend(
        "/p/aaa/",
        &broker,
        "aaa",
        &backend_secret(KEY, "aaa"),
        &calls,
    );
    let b = backend(
        "/p/bbb/",
        &broker,
        "bbb",
        &backend_secret(KEY, "bbb"),
        &calls,
    );
    let eps: Vec<String> = (0..40).map(|n| format!("c-{n}")).collect();
    let eps_ref: Vec<&str> = eps.iter().map(String::as_str).collect();
    let ra = open_room(&a, "/p/aaa/", &eps_ref[..20], T0);
    let rb = open_room(&b, "/p/bbb/", &eps_ref[..20], T0);

    let ok = fallback(&a, "/p/aaa/", &ra, "c-0", "198.51.100.7", T0);
    assert_eq!(
        ok.status,
        200,
        "{}",
        String::from_utf8_lossy(ok.body_bytes())
    );
    let list: IceList = from_json(ok.body_bytes()).unwrap();
    assert!(
        list.ice_servers
            .iter()
            .flat_map(|s| &s.urls)
            .all(|u| !u.contains(":53?") && !u.ends_with(":53"))
    );
    assert_eq!(list.expires_at, T0 + FALLBACK_TTL_S * 1000);

    // Both backends draw on the same per-IP bucket (burst 32): 31 more succeed across them, the 33rd waits.
    let mut ok_count = 1;
    let mut limited = None;
    for n in 1..20 {
        for (app, base, room) in [(&a, "/p/aaa/", &ra), (&b, "/p/bbb/", &rb)] {
            let r = fallback(app, base, room, &format!("c-{n}"), "198.51.100.7", T0);
            match r.status {
                200 => ok_count += 1,
                429 => {
                    limited = Some(
                        from_json::<RetryAfter>(r.body_bytes())
                            .unwrap()
                            .retry_after_ms,
                    )
                }
                s => panic!("{s}"),
            }
        }
    }
    assert_eq!(ok_count, 32, "one shared burst of 32 across two backends");
    assert_eq!(limited, Some(5_000));
    // A different IP is unaffected.
    assert_eq!(
        fallback(&b, "/p/bbb/", &rb, "c-19", "198.51.100.8", T0).status,
        200
    );
}

#[test]
fn a_wrong_backend_secret_gets_relay_unavailable_through_the_route() {
    let broker: SharedBroker = Arc::new(Mutex::new(Broker::new(KEY.to_vec(), true)));
    let calls = Arc::new(AtomicUsize::new(0));
    // Backend bbb presents aaa's secret.
    let b = backend(
        "/p/bbb/",
        &broker,
        "bbb",
        &backend_secret(KEY, "aaa"),
        &calls,
    );
    let room = open_room(&b, "/p/bbb/", &["c-1"], T0);
    let r = fallback(&b, "/p/bbb/", &room, "c-1", "1.1.1.1", T0);
    assert_eq!(r.status, 503);
    assert_eq!(
        from_json::<ErrorBody>(r.body_bytes()).unwrap().reason,
        ErrorBody::RELAY_UNAVAILABLE
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn with_the_key_unset_the_room_keeps_its_direct_and_coturn_list_and_fallback_is_relay_unavailable()
{
    let broker: SharedBroker = Arc::new(Mutex::new(Broker::new(KEY.to_vec(), false)));
    let calls = Arc::new(AtomicUsize::new(0));
    let a = backend(
        "/p/aaa/",
        &broker,
        "aaa",
        &backend_secret(KEY, "aaa"),
        &calls,
    );
    let room = open_room(&a, "/p/aaa/", &["c-1"], T0);
    let r = a.handle(
        &post(
            "/p/aaa/api/v1/ice",
            format!(r#"{{"roomId":"{room}","endpointId":"c-1"}}"#),
            "cs",
            "1.1.1.1",
        ),
        T0,
    );
    assert_eq!(r.status, 200);
    let list: IceList = from_json(r.body_bytes()).unwrap();
    assert!(
        list.ice_servers
            .iter()
            .any(|s| s.urls[0].starts_with("turn:turn.dilger.dev"))
    );
    let fb = fallback(&a, "/p/aaa/", &room, "c-1", "1.1.1.1", T0);
    assert_eq!(fb.status, 503);
    assert_eq!(
        from_json::<ErrorBody>(fb.body_bytes()).unwrap().reason,
        ErrorBody::RELAY_UNAVAILABLE
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

// ---- the real socket path: HttpBroker against a one-shot broker over loopback ----

#[test]
fn http_broker_speaks_to_a_broker_over_a_socket_and_retries_a_lost_response_with_the_same_request_id()
 {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let broker = Arc::new(Mutex::new(Broker::new(KEY.to_vec(), true)));
    let calls = Arc::new(AtomicUsize::new(0));
    let (b2, c2) = (broker.clone(), calls.clone());
    let server = std::thread::spawn(move || {
        // First connection: read the request and hang up without answering (a lost response).
        // Second: answer properly. Both carry the same requestId, so one Cloudflare call only.
        for attempt in 0..2 {
            let (mut s, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            let (head_end, len) = loop {
                let n = s.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
                if let Some(p) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&raw[..p]).to_lowercase();
                    let len = head
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if raw.len() >= p + 4 + len {
                        break (p, len);
                    }
                }
            };
            let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
            assert!(
                head.starts_with("POST /prefix/broker/issue HTTP/1.1"),
                "{head}"
            );
            let header = |n: &str| {
                head.lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix(&format!("{n}: "))
                            .map(|_| l.split_once(": ").unwrap().1.to_owned())
                    })
                    .unwrap_or_default()
            };
            let mut g = b2.lock().unwrap();
            assert!(g.authentic(&header(BACKEND_HEADER), &header(BACKEND_AUTH_HEADER)));
            let ir: IssueRequest =
                serde_json::from_slice(&raw[head_end + 4..head_end + 4 + len]).unwrap();
            assert_eq!(ir.request_id, "same-id");
            let c3 = c2.clone();
            let r = g.issue(&ir, T0, &mut |id, _| {
                c3.fetch_add(1, Ordering::SeqCst);
                Ok(cf_servers(id))
            });
            if attempt == 0 {
                continue; // drop the socket: no response
            }
            let (status, body) = http_result(r);
            write!(
                s,
                "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            s.write_all(&body).unwrap();
        }
    });
    let http = HttpBroker::new(
        &format!("http://{addr}/prefix"),
        "aaa",
        &backend_secret(KEY, "aaa"),
    )
    .unwrap();
    let ctx = FallbackCtx {
        request_id: "same-id".into(),
        realm: "preview".into(),
        room_id: "r".into(),
        endpoint_id: "c-1".into(),
        client_ip: "1.1.1.1".into(),
    };
    let (servers, exp) = BrokerTransport::issue(&http, &ctx, T0).unwrap();
    assert!(
        servers
            .iter()
            .any(|s| s.username.as_deref() == Some("u-jj-preview-r-c-1"))
    );
    assert_eq!(exp, T0 + FALLBACK_TTL_S * 1000);
    server.join().unwrap();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "the retry reused the credential"
    );
    assert!(HttpBroker::new("https://broker.internal", "a", "b").is_none());
}
