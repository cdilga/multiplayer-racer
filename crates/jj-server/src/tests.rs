//! Route-level tests for N02 (static, version, health, limits) and N03 (rooms and signalling), on virtual time.

use std::sync::Arc;

use jj_protocol::signal::{
    EndpointRegistered, ErrorBody, IceList, RetryAfter, RoomCreated, RoomLookup, RoomReRegistered,
    RoomStatus, SignalKind, SignalMessage, VersionInfo, from_json, to_json,
};
use jj_types::{EndpointId, ROOM_CODE_ALPHABET};

use crate::app::{App, Config};
use crate::crypto::{SeededEntropy, secret_hash};
use crate::http::{Body, IMMUTABLE, Request, Response};
use crate::ice::CoturnProvider;
use crate::rooms::{HOST_ENDPOINT, is_denied};
use crate::statics::{Bundle, Page};

const T0: u64 = 1_800_000_000_000;

fn bundle(base: &str) -> Bundle {
    let mut b = Bundle::empty();
    b.insert("assets/host-abc.js", b"console.log(1)");
    b.insert("test/hooks-testing-1.js", b"//t");
    let page = |name: &str| {
        format!("<html><head><script src=\"../assets/{name}-abc.js\"></script></head></html>")
    };
    b.insert_page(Page::Landing, &page("landing"), base);
    b.insert_page(Page::Host, &page("host"), base);
    b.insert_page(Page::Controller, &page("controller"), base);
    b
}

fn app_with(base: &str, realm: &str, seed: u64) -> Arc<App> {
    let cfg = Config {
        base: base.into(),
        realm: realm.into(),
        ..Config::dev()
    };
    Arc::new(App::new(
        cfg,
        bundle(base),
        Box::new(CoturnProvider::new(Some(b"k".to_vec()))),
        Box::new(SeededEntropy(seed)),
    ))
}

fn app() -> Arc<App> {
    app_with("/", "dev", 7)
}

fn json<T: serde::de::DeserializeOwned>(r: &Response) -> T {
    from_json(r.body_bytes())
        .unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(r.body_bytes())))
}

fn reason(r: &Response) -> String {
    json::<ErrorBody>(r).reason
}

fn post(path: &str, body: String) -> Request {
    Request::new("POST", path)
        .with_body(body)
        .with_ip("10.0.0.1")
}

fn create(app: &App, request_id: &str, secret: &str, now: u64) -> RoomCreated {
    create_from(app, "10.0.0.1", request_id, secret, now)
}

fn create_from(app: &App, ip: &str, request_id: &str, secret: &str, now: u64) -> RoomCreated {
    let r = app.handle(
        &post(
            "/api/v1/rooms",
            format!(
                r#"{{"requestId":"{request_id}","hostSecretHash":"{}"}}"#,
                secret_hash(secret)
            ),
        )
        .with_header("host", "jj.test")
        .with_ip(ip),
        now,
    );
    assert_eq!(r.status, 201, "{}", String::from_utf8_lossy(r.body_bytes()));
    json(&r)
}

fn register(app: &App, room: &str, ep: &str, secret: &str, now: u64) -> Response {
    app.handle(
        &post(
            &format!("/api/v1/rooms/{room}/endpoints"),
            format!(
                r#"{{"requestId":"q-{ep}","endpointId":"{ep}","endpointSecretHash":"{}"}}"#,
                secret_hash(secret)
            ),
        ),
        now,
    )
}

fn signal(
    app: &App,
    room: &str,
    from: &str,
    to: &str,
    secret: &str,
    kind: SignalKind,
    now: u64,
) -> Response {
    let msg = SignalMessage {
        from: EndpointId(from.into()),
        to: EndpointId(to.into()),
        kind,
        generation: 1,
        payload: "sdp".into(),
    };
    app.handle(
        &post(
            &format!("/api/v1/rooms/{room}/signal"),
            String::from_utf8(to_json(&msg)).unwrap(),
        )
        .with_header("authorization", &format!("Bearer {secret}")),
        now,
    )
}

fn open(app: &App, room: &str, ep: &str, secret: &str, last: Option<u64>) -> Response {
    let mut r = Request::new("GET", &format!("/api/v1/rooms/{room}/signal?endpoint={ep}"))
        .with_header("authorization", &format!("Bearer {secret}"));
    if let Some(l) = last {
        r = r.with_header("last-event-id", &l.to_string());
    }
    app.handle(&r, T0)
}

fn lookup(app: &App, code: &str, now: u64) -> RoomLookup {
    json(&app.handle(&Request::new("GET", &format!("/api/v1/rooms/{code}")), now))
}

// ---- N02 ----

#[test]
fn serves_pages_and_immutable_assets_under_a_preview_base_with_real_404s() {
    for base in ["/", "/p/x/", "/p/y/"] {
        let app = app_with(base, "preview", 1);
        let r = app.handle(
            &Request::new("GET", &format!("{base}assets/host-abc.js")),
            T0,
        );
        assert_eq!(
            (r.status, r.header("cache-control")),
            (200, Some(IMMUTABLE))
        );
        assert_eq!(
            r.header("content-type"),
            Some("text/javascript; charset=utf-8")
        );
        let missing = app.handle(
            &Request::new("GET", &format!("{base}assets/nope-123.js")),
            T0,
        );
        assert_eq!(missing.status, 404);
        assert!(
            !String::from_utf8_lossy(missing.body_bytes()).contains("<html"),
            "never SPA HTML"
        );
        for (path, page) in [
            ("", "landing"),
            ("host", "host"),
            ("c", "controller"),
            ("j/ABCD", "controller"),
            ("j/abcd", "controller"),
        ] {
            let r = app.handle(&Request::new("GET", &format!("{base}{path}")), T0);
            assert_eq!(r.status, 200, "{base}{path}");
            let html = String::from_utf8_lossy(r.body_bytes()).to_string();
            assert!(
                html.contains(&format!("src=\"{base}assets/{page}-abc.js\"")),
                "{base}{path}: {html}"
            );
            assert!(html.contains(&format!("content=\"{base}\"")));
            assert_eq!(r.header("cache-control"), Some("no-cache"));
        }
        assert_eq!(
            app.handle(&Request::new("GET", &format!("{base}j/AB")), T0)
                .status,
            404
        );
        assert_eq!(
            app.handle(&Request::new("GET", &format!("{base}random")), T0)
                .status,
            404
        );
    }
    // Outside the base nothing is served.
    let app = app_with("/p/x/", "preview", 1);
    assert_eq!(
        app.handle(&Request::new("GET", "/assets/host-abc.js"), T0)
            .status,
        404
    );
    assert_eq!(app.handle(&Request::new("GET", "/p/x"), T0).status, 200);
}

#[test]
fn production_realm_hides_the_test_surface() {
    assert_eq!(
        app_with("/", "dev", 1)
            .handle(&Request::new("GET", "/test/hooks-testing-1.js"), T0)
            .status,
        200
    );
    assert_eq!(
        app_with("/", "production", 1)
            .handle(&Request::new("GET", "/test/hooks-testing-1.js"), T0)
            .status,
        404
    );
}

#[test]
fn version_and_healthz_answer_and_body_limits_hold() {
    let app = app_with("/p/x/", "preview", 1);
    let v: VersionInfo = json(&app.handle(&Request::new("GET", "/p/x/version"), T0));
    assert_eq!(
        (v.protocol, v.realm.as_str()),
        (jj_protocol::PROTOCOL_VERSION, "preview")
    );
    let h = app.handle(&Request::new("GET", "/p/x/healthz"), T0);
    assert_eq!(
        (h.status, h.header("cache-control")),
        (200, Some("no-store"))
    );
    let big = app.handle(
        &post(
            "/p/x/api/v1/rooms",
            "x".repeat(crate::http::MAX_BODY_BYTES + 1),
        ),
        T0,
    );
    assert_eq!(big.status, 413);
}

// ---- N03 ----

#[test]
fn create_resolve_register_and_exchange_offer_answer_candidates_over_sse() {
    let app = app();
    let room = create(&app, "r-1", "hostsecret", T0);
    assert_eq!(room.host_endpoint_id.0, HOST_ENDPOINT);
    assert_eq!(room.join_url, format!("http://jj.test/j/{}", room.code.0));
    assert!(!room.ice_servers.is_empty() && room.ice_expires_at > T0);
    let found = lookup(&app, &room.code.0.to_lowercase(), T0);
    assert_eq!(
        (found.status, found.room_id.as_ref()),
        (RoomStatus::Available, Some(&room.room_id))
    );

    let reg = register(&app, &room.room_id.0, "c-1", "csecret", T0);
    assert_eq!(reg.status, 201);
    assert!(!json::<EndpointRegistered>(&reg).ice_servers.is_empty());

    let host_sse = open(&app, &room.room_id.0, HOST_ENDPOINT, "hostsecret", None);
    assert_eq!(host_sse.header("content-type"), Some("text/event-stream"));
    let Body::Sse(host_stream) = host_sse.body else {
        panic!("SSE")
    };
    let Body::Sse(c_stream) = open(&app, &room.room_id.0, "c-1", "csecret", None).body else {
        panic!("SSE")
    };

    assert_eq!(
        signal(
            &app,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "csecret",
            SignalKind::Offer,
            T0
        )
        .status,
        202
    );
    assert_eq!(
        signal(
            &app,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "csecret",
            SignalKind::Candidate,
            T0
        )
        .status,
        202
    );
    assert_eq!(
        signal(
            &app,
            &room.room_id.0,
            HOST_ENDPOINT,
            "c-1",
            "hostsecret",
            SignalKind::Answer,
            T0
        )
        .status,
        202
    );
    assert_eq!(
        signal(
            &app,
            &room.room_id.0,
            HOST_ENDPOINT,
            "c-1",
            "hostsecret",
            SignalKind::Candidate,
            T0
        )
        .status,
        202
    );

    let to_host = app.sse_take(&host_stream, 0).unwrap();
    let kinds: Vec<SignalKind> = to_host
        .iter()
        .map(|e| from_json::<SignalMessage>(e.data.as_bytes()).unwrap().kind)
        .collect();
    assert_eq!(kinds, [SignalKind::Offer, SignalKind::Candidate]);
    assert_eq!(to_host.iter().map(|e| e.id).collect::<Vec<_>>(), [1, 2]);
    let to_c = app.sse_take(&c_stream, 0).unwrap();
    assert_eq!(to_c.len(), 2);
}

#[test]
fn a_retried_create_returns_the_same_room() {
    let app = app();
    let a = create(&app, "r-same", "s", T0);
    let b = create(&app, "r-same", "s", T0 + 5);
    assert_eq!(
        (a.room_id, a.code, a.room_ticket),
        (b.room_id, b.code, b.room_ticket)
    );
    assert_eq!(app.room_count(), 1);
}

#[test]
fn after_a_restart_the_host_keeps_its_code_and_controllers_re_register() {
    let before = app();
    let room = create(&before, "r-1", "hs", T0);
    let after = app_with("/", "dev", 99); // same JJ_ROOM_KEY, empty memory
    // The restart signal.
    assert_eq!(
        reason(&open(&after, &room.room_id.0, HOST_ENDPOINT, "hs", None)),
        ErrorBody::UNKNOWN_ROOM
    );
    assert_eq!(
        signal(
            &after,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "cs",
            SignalKind::Offer,
            T0
        )
        .status,
        404
    );
    let put = after.handle(
        &Request::new("PUT", &format!("/api/v1/rooms/{}", room.code.0))
            .with_header("authorization", "Bearer hs")
            .with_body(format!(
                r#"{{"roomId":"{}","hostSecretHash":"{}","roomTicket":"{}"}}"#,
                room.room_id.0,
                secret_hash("hs"),
                room.room_ticket
            )),
        T0 + 1,
    );
    assert_eq!(put.status, 200);
    assert_eq!(json::<RoomReRegistered>(&put).code, room.code);
    assert_eq!(
        register(&after, &room.room_id.0, "c-1", "cs", T0 + 2).status,
        201
    );
    assert_eq!(
        lookup(&after, &room.code.0, T0 + 2).status,
        RoomStatus::Available
    );
}

fn put(
    app: &App,
    code: &str,
    room_id: &str,
    secret: &str,
    ticket: &str,
    bearer: Option<&str>,
) -> Response {
    let mut r = Request::new("PUT", &format!("/api/v1/rooms/{code}")).with_body(format!(
        r#"{{"roomId":"{room_id}","hostSecretHash":"{}","roomTicket":"{ticket}"}}"#,
        secret_hash(secret)
    ));
    if let Some(b) = bearer {
        r = r.with_header("authorization", &format!("Bearer {b}"));
    }
    app.handle(&r, T0)
}

#[test]
fn forged_tickets_taken_codes_and_ended_rooms() {
    let a = app();
    let room = create(&a, "r-1", "hs", T0);
    let fresh = app_with("/", "dev", 3);
    assert_eq!(
        put(
            &fresh,
            &room.code.0,
            &room.room_id.0,
            "hs",
            "Zm9yZ2Vk",
            Some("hs")
        )
        .status,
        403
    );
    assert_eq!(
        put(
            &fresh,
            &room.code.0,
            &room.room_id.0,
            "hs",
            &room.room_ticket,
            None
        )
        .status,
        401
    );
    // Another room took the code meanwhile: a fresh code for the same roomId.
    fresh.squat(&room.code.0, T0);
    let r = put(
        &fresh,
        &room.code.0,
        &room.room_id.0,
        "hs",
        &room.room_ticket,
        Some("hs"),
    );
    assert_eq!(r.status, 200);
    let re: RoomReRegistered = json(&r);
    assert_ne!(re.code, room.code);
    assert_eq!(
        re.room_ticket,
        fresh.ticket(&room.room_id.0, &re.code.0, &secret_hash("hs"))
    );
    // Ended rooms leave a tombstone and can't come back.
    let end = |bearer: &str| {
        a.handle(
            &post(
                &format!("/api/v1/rooms/{}/end", room.room_id.0),
                String::new(),
            )
            .with_header("authorization", &format!("Bearer {bearer}")),
            T0,
        )
    };
    assert_eq!(end("wrong").status, 401);
    assert_eq!(end("hs").status, 200);
    assert_eq!(lookup(&a, &room.code.0, T0).status, RoomStatus::Ended);
    assert_eq!(
        put(
            &a,
            &room.code.0,
            &room.room_id.0,
            "hs",
            &room.room_ticket,
            Some("hs")
        )
        .status,
        410
    );
    assert_eq!(lookup(&a, "ZZZZ", T0).status, RoomStatus::NotFound);
}

#[test]
fn endpoint_conflicts_and_wrong_bearers() {
    let app = app();
    let room = create(&app, "r-1", "hs", T0);
    assert_eq!(register(&app, &room.room_id.0, "c-1", "a", T0).status, 201);
    assert_eq!(
        register(&app, &room.room_id.0, "c-1", "a", T0).status,
        201,
        "idempotent"
    );
    assert_eq!(register(&app, &room.room_id.0, "c-1", "b", T0).status, 409);
    assert_eq!(
        register(&app, &room.room_id.0, HOST_ENDPOINT, "b", T0).status,
        409
    );
    assert_eq!(open(&app, &room.room_id.0, "c-1", "b", None).status, 401);
    assert_eq!(
        signal(
            &app,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "b",
            SignalKind::Offer,
            T0
        )
        .status,
        401
    );
}

#[test]
fn host_unreachable_after_30_s_and_dropped_after_10_min_virtual_time() {
    let app = app();
    let room = create(&app, "r-1", "hs", T0);
    let Body::Sse(s) = open(&app, &room.room_id.0, HOST_ENDPOINT, "hs", None).body else {
        panic!()
    };
    assert!(app.sse_opened(&s, T0));
    // Streaming: available however long.
    assert_eq!(
        lookup(&app, &room.code.0, T0 + 3_600_000).status,
        RoomStatus::Available
    );
    app.sse_closed(&s, T0 + 3_600_000);
    let t = T0 + 3_600_000;
    assert_eq!(
        lookup(&app, &room.code.0, t + 29_999).status,
        RoomStatus::Available
    );
    assert_eq!(
        lookup(&app, &room.code.0, t + 30_000).status,
        RoomStatus::HostUnreachable
    );
    assert_eq!(
        lookup(&app, &room.code.0, t + 599_999).status,
        RoomStatus::HostUnreachable
    );
    assert_eq!(
        lookup(&app, &room.code.0, t + 600_000).status,
        RoomStatus::NotFound
    );
    assert_eq!(app.room_count(), 0);
}

#[test]
fn a_hundred_registrations_from_one_ip_all_succeed() {
    let app = app();
    let room = create(&app, "r-1", "hs", T0);
    let Body::Sse(s) = open(&app, &room.room_id.0, HOST_ENDPOINT, "hs", None).body else {
        panic!()
    };
    app.sse_opened(&s, T0);
    let mut now = T0;
    for i in 0..100 {
        loop {
            let r = register(&app, &room.room_id.0, &format!("c-{i}"), "s", now);
            if r.status == 201 {
                break;
            }
            assert_eq!(r.status, 429);
            now += json::<RetryAfter>(&r).retry_after_ms;
        }
    }
    assert!(now - T0 <= 9_000, "100 joins took {} ms", now - T0);
}

#[test]
fn last_event_id_resume_delivers_missed_messages_once_within_60_s() {
    let app = app();
    let room = create(&app, "r-1", "hs", T0);
    register(&app, &room.room_id.0, "c-1", "cs", T0);
    for _ in 0..3 {
        signal(
            &app,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "cs",
            SignalKind::Candidate,
            T0,
        );
    }
    let Body::Sse(s) = open(&app, &room.room_id.0, HOST_ENDPOINT, "hs", Some(1)).body else {
        panic!()
    };
    assert_eq!(s.last_event_id, 1);
    let missed = app.sse_take(&s, s.last_event_id).unwrap();
    assert_eq!(missed.iter().map(|e| e.id).collect::<Vec<_>>(), [2, 3]);
    // Past 60 s the backlog is gone (the sweep runs on any request).
    lookup(&app, &room.code.0, T0 + 60_000);
    assert!(app.sse_take(&s, 0).unwrap().is_empty());
}

#[test]
fn bursts_get_429_with_retry_after_and_then_succeed() {
    let app = app();
    let mut now = T0;
    for i in 0..10 {
        create(&app, &format!("r-{i}"), "s", now);
    }
    let r = app.handle(
        &post(
            "/api/v1/rooms",
            format!(
                r#"{{"requestId":"r-x","hostSecretHash":"{}"}}"#,
                secret_hash("s")
            ),
        ),
        now,
    );
    assert_eq!(r.status, 429);
    now += json::<RetryAfter>(&r).retry_after_ms;
    create(&app, "r-x", "s", now);

    let room = create(&app, "r-sig", "hs", now + 10_000);
    register(&app, &room.room_id.0, "c-1", "cs", now);
    let mut limited = None;
    for _ in 0..65 {
        let r = signal(
            &app,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "cs",
            SignalKind::Candidate,
            now,
        );
        if r.status == 429 {
            limited = Some(json::<RetryAfter>(&r).retry_after_ms);
        }
    }
    let wait = limited.expect("the 65th signal is limited");
    assert_eq!(
        signal(
            &app,
            &room.room_id.0,
            "c-1",
            HOST_ENDPOINT,
            "cs",
            SignalKind::Candidate,
            now + wait
        )
        .status,
        202
    );
}

#[test]
fn codes_use_the_alphabet_skip_the_deny_list_and_retry_on_collision() {
    let app = app();
    let mut codes = std::collections::HashSet::new();
    for i in 0..2_000 {
        let room = create_from(
            &app,
            &format!("10.1.{}.{}", i / 256, i % 256),
            &format!("r-{i}"),
            "s",
            T0,
        );
        assert!(
            room.code.0.chars().all(|c| ROOM_CODE_ALPHABET.contains(c)) && room.code.0.len() == 4
        );
        assert!(!is_denied(&room.code.0));
        assert!(
            codes.insert(room.code.0),
            "codes stay unique among live rooms"
        );
    }
    assert!(is_denied("WANK") && is_denied("ARSE"));
}

#[test]
fn ice_refresh_needs_the_endpoint_bearer_and_fallback_is_relay_unavailable() {
    let app = app();
    let room = create(&app, "r-1", "hs", T0);
    register(&app, &room.room_id.0, "c-1", "cs", T0);
    let body = format!(r#"{{"roomId":"{}","endpointId":"c-1"}}"#, room.room_id.0);
    let ok = app.handle(
        &post("/api/v1/ice", body.clone()).with_header("authorization", "Bearer cs"),
        T0 + 1000,
    );
    assert_eq!(ok.status, 200);
    assert!(json::<IceList>(&ok).expires_at > T0);
    assert_eq!(
        app.handle(
            &post("/api/v1/ice", body.clone()).with_header("authorization", "Bearer no"),
            T0
        )
        .status,
        401
    );
    let fb = format!(
        r#"{{"roomId":"{}","endpointId":"c-1","reason":"udp-blocked"}}"#,
        room.room_id.0
    );
    let r = app.handle(
        &post("/api/v1/ice/fallback", fb).with_header("authorization", "Bearer cs"),
        T0,
    );
    assert_eq!(
        (r.status, reason(&r)),
        (503, ErrorBody::RELAY_UNAVAILABLE.to_owned())
    );
}

#[test]
fn sse_wait_wakes_on_a_message_and_when_the_room_ends() {
    use std::task::{Context, Poll, Wake, Waker};
    struct Flag(std::sync::atomic::AtomicBool);
    impl Wake for Flag {
        fn wake(self: Arc<Self>) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let app = app();
    let room = create(&app, "r-1", "hs", T0);
    register(&app, &room.room_id.0, "c-1", "cs", T0);
    let Body::Sse(s) = open(&app, &room.room_id.0, HOST_ENDPOINT, "hs", None).body else {
        panic!()
    };
    let flag = Arc::new(Flag(false.into()));
    let waker = Waker::from(flag.clone());
    let mut fut = Box::pin(app.sse_wait(&s, 0));
    assert!(
        fut.as_mut()
            .poll(&mut Context::from_waker(&waker))
            .is_pending()
    );
    signal(
        &app,
        &room.room_id.0,
        "c-1",
        HOST_ENDPOINT,
        "cs",
        SignalKind::Offer,
        T0,
    );
    assert!(flag.0.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        fut.as_mut().poll(&mut Context::from_waker(&waker)),
        Poll::Ready(())
    );
    let mut fut = Box::pin(app.sse_wait(&s, 1));
    assert!(
        fut.as_mut()
            .poll(&mut Context::from_waker(&waker))
            .is_pending()
    );
    app.handle(
        &post(
            &format!("/api/v1/rooms/{}/end", room.room_id.0),
            String::new(),
        )
        .with_header("authorization", "Bearer hs"),
        T0,
    );
    assert_eq!(
        fut.as_mut().poll(&mut Context::from_waker(&waker)),
        Poll::Ready(())
    );
    assert!(app.sse_take(&s, 0).is_none());
}
