//! The server's routes (plan §5.1) as plain synchronous code over [`Request`]/[`Response`]. Time comes in as an
//! argument (Unix ms), so tests run hours of virtual time in microseconds. The SSE side is a std `Future` over the
//! endpoint's mailbox, so any executor (Asupersync in `main.rs`) can wait on it.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll};

use jj_protocol::signal::{
    CreateRoom, EndpointRegistered, ErrorBody, IceFallback, IceList, IceRefresh, ReRegisterRoom,
    RegisterEndpoint, RetryAfter, RoomCreated, RoomLookup, RoomReRegistered, RoomStatus,
    SignalMessage, VersionInfo, from_json, to_json,
};
use jj_types::{BuildId, EndpointId, RoomCode, RoomId};

use crate::crypto::{Entropy, b64url, ct_eq, hmac_sha256, secret_hash};
use crate::http::{Body, MAX_BODY_BYTES, Request, Response, SseOpen};
use crate::ice::{FallbackError, IceProvider};
use crate::rate::{ENDPOINT_REGISTER, Limiter, ROOM_CREATE, SIGNAL_POST};
use crate::rooms::{
    Endpoint, Event, HOST_ENDPOINT, HOST_UNREACHABLE_MS, ROOM_DROP_MS, Room, TOMBSTONE_MS,
    Tombstone, random_code, random_id,
};
use crate::statics::{Bundle, Page};

pub struct Config {
    /// The deployment base path, starting and ending with `/` (`/` or `/p/<id>/`).
    pub base: String,
    pub build: String,
    /// `production`, `preview`, `dev` … (`/version`); a production realm 404s the bundle's `test/` directory.
    pub realm: String,
    /// `JJ_ROOM_KEY`: signs room tickets so a host can re-register after a server restart.
    pub room_key: Vec<u8>,
    /// The public origin for join URLs (`https://jammers.dilger.dev`); `None` derives it from the request.
    pub public_origin: Option<String>,
    /// A TURN broker is configured (P1-N04b's relay fallback); without one `/ice/fallback` is `relay-unavailable`.
    pub broker: bool,
}

impl Config {
    pub fn dev() -> Self {
        Self {
            base: "/".into(),
            build: "dev".into(),
            realm: "dev".into(),
            room_key: b"jj-dev-room-key".to_vec(),
            public_origin: None,
            broker: false,
        }
    }
}

/// Normalises a base path to `/…/`.
pub fn normalise_base(base: &str) -> String {
    let trimmed = base.trim_matches('/');
    if trimmed.is_empty() {
        "/".into()
    } else {
        format!("/{trimmed}/")
    }
}

struct State {
    rooms: HashMap<String, Room>,
    codes: HashMap<String, String>,
    /// `requestId` → `roomId`, so a retried create returns the same room.
    creates: HashMap<String, String>,
    tombstones: HashMap<String, Tombstone>,
    /// Codes of ended rooms (until reused) → `roomId`, so `GET rooms/<code>` can say `ended`.
    ended_codes: HashMap<String, String>,
    create_limit: Limiter,
    register_limit: Limiter,
    signal_limit: Limiter,
    rng: Box<dyn Entropy>,
}

pub struct App {
    cfg: Config,
    bundle: Bundle,
    ice: Box<dyn IceProvider>,
    state: Mutex<State>,
}

fn err(status: u16, reason: &str) -> Response {
    Response::json(
        status,
        to_json(&ErrorBody {
            reason: reason.into(),
        }),
    )
}

fn limited(retry_after_ms: u64) -> Response {
    Response::json(429, to_json(&RetryAfter { retry_after_ms }))
        .with_header("retry-after", &retry_after_ms.div_ceil(1000).to_string())
}

fn unknown_room() -> Response {
    err(404, ErrorBody::UNKNOWN_ROOM)
}

fn bearer_matches(req: &Request, hash: &str) -> bool {
    req.bearer()
        .is_some_and(|t| ct_eq(secret_hash(t).as_bytes(), hash.as_bytes()))
}

impl App {
    pub fn new(
        cfg: Config,
        bundle: Bundle,
        ice: Box<dyn IceProvider>,
        rng: Box<dyn Entropy>,
    ) -> Self {
        let cfg = Config {
            base: normalise_base(&cfg.base),
            ..cfg
        };
        Self {
            cfg,
            bundle,
            ice,
            state: Mutex::new(State {
                rooms: HashMap::new(),
                codes: HashMap::new(),
                creates: HashMap::new(),
                tombstones: HashMap::new(),
                ended_codes: HashMap::new(),
                create_limit: Limiter::new(ROOM_CREATE),
                register_limit: Limiter::new(ENDPOINT_REGISTER),
                signal_limit: Limiter::new(SIGNAL_POST),
                rng,
            }),
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // A panic while holding the lock leaves plain data behind; keep serving.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn ticket(&self, room_id: &str, code: &str, host_secret_hash: &str) -> String {
        b64url(&hmac_sha256(
            &self.cfg.room_key,
            &[
                self.cfg.realm.as_bytes(),
                b"\0",
                room_id.as_bytes(),
                b"\0",
                code.as_bytes(),
                b"\0",
                host_secret_hash.as_bytes(),
            ],
        ))
    }

    /// Routes one request. `now_ms` is Unix ms.
    pub fn handle(&self, req: &Request, now_ms: u64) -> Response {
        self.sweep(now_ms);
        let Some(rest) = req.path.strip_prefix(&self.cfg.base).or_else(|| {
            // `B` without its trailing slash (`/p/x`) serves the landing page too.
            (req.path == self.cfg.base.trim_end_matches('/')).then_some("")
        }) else {
            return Response::not_found();
        };
        if req.body.len() > MAX_BODY_BYTES {
            return err(413, "body-too-large");
        }
        let get = req.method == "GET" || req.method == "HEAD";
        match (req.method.as_str(), rest) {
            (_, "") if get => self.bundle.page(Page::Landing),
            (_, "host" | "host/") if get => self.bundle.page(Page::Host),
            (_, "c" | "c/") if get => self.bundle.page(Page::Controller),
            (_, r) if get && r.starts_with("j/") && RoomCode::parse(&r[2..]).is_some() => {
                self.bundle.page(Page::Controller)
            }
            (_, r) if get && r.starts_with("assets/") => self.bundle.file(r),
            (_, r) if get && r.starts_with("test/") => {
                if self.cfg.realm == "production" {
                    Response::not_found()
                } else {
                    self.bundle.file(r)
                }
            }
            (_, "version") if get => Response::json(
                200,
                to_json(&VersionInfo {
                    build: BuildId(self.cfg.build.clone()),
                    protocol: jj_protocol::PROTOCOL_VERSION,
                    realm: self.cfg.realm.clone(),
                }),
            ),
            (_, "healthz") if get => self.healthz(),
            (_, r) if r.starts_with("api/v1/") => self.api(req, &r["api/v1/".len()..], now_ms),
            _ => Response::not_found(),
        }
    }

    fn healthz(&self) -> Response {
        let st = self.lock();
        let body = serde_json::json!({
            "ok": true,
            "build": self.cfg.build,
            "realm": self.cfg.realm,
            "rooms": st.rooms.len(),
            "assets": self.bundle.file_count(),
            "ice": self.ice.status(),
            // The Cloudflare TURN fallback (P1-N04b) through the broker; reported, never fatal.
            "relayFallback": if self.cfg.broker { "configured" } else { "unavailable" },
        });
        Response::json(200, body.to_string().into_bytes())
    }

    fn api(&self, req: &Request, path: &str, now: u64) -> Response {
        let parts: Vec<&str> = path.split('/').collect();
        match (req.method.as_str(), parts.as_slice()) {
            ("POST", ["rooms"]) => self.create_room(req, now),
            ("PUT", ["rooms", code]) => self.re_register(req, code, now),
            ("GET", ["rooms", code]) => self.lookup(code, now),
            ("POST", ["rooms", room, "endpoints"]) => self.register_endpoint(req, room, now),
            ("GET", ["rooms", room, "signal"]) => self.open_signal(req, room),
            ("POST", ["rooms", room, "signal"]) => self.post_signal(req, room, now),
            ("POST", ["rooms", room, "end"]) => self.end_room(req, room, now),
            ("POST", ["ice"]) => self.ice_refresh(req, now),
            ("POST", ["ice", "fallback"]) => self.ice_fallback(req, now),
            _ => err(404, "no-such-route"),
        }
    }

    fn join_url(&self, req: &Request, code: &str) -> String {
        let origin = self.cfg.public_origin.clone().unwrap_or_else(|| {
            let proto = req.header("x-forwarded-proto").unwrap_or("http");
            let host = req.header("host").unwrap_or("localhost");
            format!("{proto}://{host}")
        });
        format!("{}{}j/{code}", origin.trim_end_matches('/'), self.cfg.base)
    }

    fn fresh_code(st: &mut State) -> String {
        loop {
            let code = random_code(st.rng.as_mut());
            if !st.codes.contains_key(&code) {
                return code;
            }
        }
    }

    fn create_room(&self, req: &Request, now: u64) -> Response {
        let Ok(body) = from_json::<CreateRoom>(&req.body) else {
            return err(400, "bad-body");
        };
        let mut st = self.lock();
        if let Some(room_id) = st.creates.get(&body.request_id).cloned()
            && let Some(room) = st.rooms.get(&room_id)
            && room.host_secret_hash == body.host_secret_hash
        {
            let code = room.code.clone();
            drop(st);
            return self.room_created(req, &room_id, &code, &body.host_secret_hash, now);
        }
        if let Err(wait) = st.create_limit.take(&req.client_ip, now) {
            return limited(wait);
        }
        let code = Self::fresh_code(&mut st);
        let room_id = loop {
            let id = random_id("rm", st.rng.as_mut());
            if !st.rooms.contains_key(&id) && !st.tombstones.contains_key(&id) {
                break id;
            }
        };
        st.ended_codes.remove(&code);
        st.codes.insert(code.clone(), room_id.clone());
        st.creates.insert(body.request_id, room_id.clone());
        st.rooms.insert(
            room_id.clone(),
            Room::new(
                room_id.clone(),
                code.clone(),
                body.host_secret_hash.clone(),
                now,
            ),
        );
        drop(st);
        self.room_created(req, &room_id, &code, &body.host_secret_hash, now)
    }

    fn room_created(
        &self,
        req: &Request,
        room_id: &str,
        code: &str,
        hash: &str,
        now: u64,
    ) -> Response {
        let (ice_servers, ice_expires_at) = self.ice.initial(HOST_ENDPOINT, now);
        Response::json(
            201,
            to_json(&RoomCreated {
                room_id: RoomId(room_id.into()),
                code: RoomCode(code.into()),
                join_url: self.join_url(req, code),
                host_endpoint_id: EndpointId(HOST_ENDPOINT.into()),
                room_ticket: self.ticket(room_id, code, hash),
                ice_servers,
                ice_expires_at,
            }),
        )
    }

    fn re_register(&self, req: &Request, code: &str, now: u64) -> Response {
        let Ok(body) = from_json::<ReRegisterRoom>(&req.body) else {
            return err(400, "bad-body");
        };
        let Some(code) = RoomCode::parse(code) else {
            return err(400, "bad-code");
        };
        let (room_id, hash) = (body.room_id.0.clone(), body.host_secret_hash.clone());
        if !bearer_matches(req, &hash) {
            return err(401, "bad-bearer");
        }
        let expected = self.ticket(&room_id, &code.0, &hash);
        if !ct_eq(expected.as_bytes(), body.room_ticket.as_bytes()) {
            return err(403, "bad-ticket");
        }
        let mut st = self.lock();
        if st.tombstones.contains_key(&room_id) {
            return err(410, "ended");
        }
        if let Some(room) = st.rooms.get_mut(&room_id) {
            // Still here (no restart happened): the same room answers with its current code.
            if room.host_secret_hash != hash {
                return err(403, "bad-ticket");
            }
            room.host_seen_ms = room.host_seen_ms.max(now);
            let code = room.code.clone();
            drop(st);
            return self.re_registered(&room_id, &code, &hash);
        }
        let code = if st.codes.contains_key(&code.0) {
            Self::fresh_code(&mut st)
        } else {
            code.0
        };
        st.ended_codes.remove(&code);
        st.codes.insert(code.clone(), room_id.clone());
        st.rooms.insert(
            room_id.clone(),
            Room::new(room_id.clone(), code.clone(), hash.clone(), now),
        );
        drop(st);
        self.re_registered(&room_id, &code, &hash)
    }

    fn re_registered(&self, room_id: &str, code: &str, hash: &str) -> Response {
        Response::json(
            200,
            to_json(&RoomReRegistered {
                code: RoomCode(code.into()),
                room_ticket: self.ticket(room_id, code, hash),
            }),
        )
    }

    fn lookup(&self, code: &str, now: u64) -> Response {
        let build = Some(BuildId(self.cfg.build.clone()));
        let realm = Some(self.cfg.realm.clone());
        let st = self.lock();
        let lookup = match RoomCode::parse(code) {
            None => RoomLookup {
                status: RoomStatus::NotFound,
                room_id: None,
                build,
                realm,
            },
            Some(code) => {
                if let Some(room) = st.codes.get(&code.0).and_then(|id| st.rooms.get(id)) {
                    let status = if room.host_silent_ms(now) >= HOST_UNREACHABLE_MS {
                        RoomStatus::HostUnreachable
                    } else {
                        RoomStatus::Available
                    };
                    RoomLookup {
                        status,
                        room_id: Some(RoomId(room.room_id.clone())),
                        build,
                        realm,
                    }
                } else if let Some(id) = st.ended_codes.get(&code.0) {
                    RoomLookup {
                        status: RoomStatus::Ended,
                        room_id: Some(RoomId(id.clone())),
                        build,
                        realm,
                    }
                } else {
                    RoomLookup {
                        status: RoomStatus::NotFound,
                        room_id: None,
                        build,
                        realm,
                    }
                }
            }
        };
        Response::json(200, to_json(&lookup))
    }

    fn register_endpoint(&self, req: &Request, room_id: &str, now: u64) -> Response {
        let Ok(body) = from_json::<RegisterEndpoint>(&req.body) else {
            return err(400, "bad-body");
        };
        let id = body.endpoint_id.0;
        if id.is_empty() || id == HOST_ENDPOINT || id.len() > 64 {
            return err(409, "endpoint-conflict");
        }
        let mut st = self.lock();
        let State {
            rooms,
            register_limit,
            ..
        } = &mut *st;
        let Some(room) = rooms.get_mut(room_id) else {
            return unknown_room();
        };
        match room.endpoints.get(&id) {
            Some(e) if e.secret_hash != body.endpoint_secret_hash => {
                return err(409, "endpoint-conflict");
            }
            Some(_) => {}
            None => {
                if let Err(wait) = register_limit.take(&req.client_ip, now) {
                    return limited(wait);
                }
                room.endpoints
                    .insert(id.clone(), Endpoint::new(body.endpoint_secret_hash));
            }
        }
        drop(st);
        let (ice_servers, ice_expires_at) = self.ice.initial(&id, now);
        Response::json(
            201,
            to_json(&EndpointRegistered {
                ice_servers,
                ice_expires_at,
            }),
        )
    }

    fn open_signal(&self, req: &Request, room_id: &str) -> Response {
        let Some(endpoint) = req.query_param("endpoint") else {
            return err(400, "no-endpoint");
        };
        let st = self.lock();
        let Some(room) = st.rooms.get(room_id) else {
            return unknown_room();
        };
        let Some(ep) = room.endpoints.get(endpoint) else {
            return err(404, "unknown-endpoint");
        };
        if !bearer_matches(req, &ep.secret_hash) {
            return err(401, "bad-bearer");
        }
        let last_event_id = req
            .header("last-event-id")
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0);
        Response {
            status: 200,
            headers: vec![
                ("content-type".into(), "text/event-stream".into()),
                ("cache-control".into(), "no-store".into()),
                ("x-accel-buffering".into(), "no".into()),
            ],
            body: Body::Sse(SseOpen {
                room_id: room_id.into(),
                endpoint_id: endpoint.into(),
                last_event_id,
            }),
        }
    }

    fn post_signal(&self, req: &Request, room_id: &str, now: u64) -> Response {
        let Ok(msg) = from_json::<SignalMessage>(&req.body) else {
            return err(400, "bad-body");
        };
        let mut st = self.lock();
        let State {
            rooms,
            signal_limit,
            ..
        } = &mut *st;
        let Some(room) = rooms.get_mut(room_id) else {
            return unknown_room();
        };
        let Some(from) = room.endpoints.get(&msg.from.0) else {
            return err(404, "unknown-endpoint");
        };
        if !bearer_matches(req, &from.secret_hash) {
            return err(401, "bad-bearer");
        }
        if let Err(wait) = signal_limit.take(&format!("{room_id}/{}", msg.from.0), now) {
            return limited(wait);
        }
        let Some(to) = room.endpoints.get_mut(&msg.to.0) else {
            return err(404, "unknown-endpoint");
        };
        to.mailbox.push(
            String::from_utf8(to_json(&msg)).expect("JSON is UTF-8"),
            now,
        );
        Response::json(202, b"{}".to_vec())
    }

    fn end_room(&self, req: &Request, room_id: &str, now: u64) -> Response {
        let mut st = self.lock();
        let Some(room) = st.rooms.get(room_id) else {
            return if st.tombstones.contains_key(room_id) {
                Response::json(200, b"{}".to_vec())
            } else {
                unknown_room()
            };
        };
        if !bearer_matches(req, &room.host_secret_hash) {
            return err(401, "bad-bearer");
        }
        let mut room = st.rooms.remove(room_id).expect("present");
        for ep in room.endpoints.values_mut() {
            ep.mailbox.wake_all();
        }
        st.codes.remove(&room.code);
        st.ended_codes
            .insert(room.code.clone(), room.room_id.clone());
        st.tombstones.insert(
            room.room_id.clone(),
            Tombstone {
                code: room.code,
                at_ms: now,
            },
        );
        Response::json(200, b"{}".to_vec())
    }

    fn endpoint_bearer_ok(
        &self,
        req: &Request,
        room_id: &str,
        endpoint_id: &str,
    ) -> Result<(), Response> {
        let st = self.lock();
        let Some(room) = st.rooms.get(room_id) else {
            return Err(unknown_room());
        };
        let Some(ep) = room.endpoints.get(endpoint_id) else {
            return Err(err(404, "unknown-endpoint"));
        };
        if !bearer_matches(req, &ep.secret_hash) {
            return Err(err(401, "bad-bearer"));
        }
        Ok(())
    }

    fn ice_refresh(&self, req: &Request, now: u64) -> Response {
        let Ok(body) = from_json::<IceRefresh>(&req.body) else {
            return err(400, "bad-body");
        };
        if let Err(r) = self.endpoint_bearer_ok(req, &body.room_id.0, &body.endpoint_id.0) {
            return r;
        }
        let (ice_servers, expires_at) = self.ice.initial(&body.endpoint_id.0, now);
        Response::json(
            200,
            to_json(&IceList {
                ice_servers,
                expires_at,
            }),
        )
    }

    fn ice_fallback(&self, req: &Request, now: u64) -> Response {
        let Ok(body) = from_json::<IceFallback>(&req.body) else {
            return err(400, "bad-body");
        };
        if let Err(r) = self.endpoint_bearer_ok(req, &body.room_id.0, &body.endpoint_id.0) {
            return r;
        }
        match self.ice.fallback(&body.endpoint_id.0, now) {
            Ok((ice_servers, expires_at)) => Response::json(
                200,
                to_json(&IceList {
                    ice_servers,
                    expires_at,
                }),
            ),
            Err(FallbackError::RelayUnavailable) => err(503, ErrorBody::RELAY_UNAVAILABLE),
            Err(FallbackError::RateLimited { retry_after_ms }) => limited(retry_after_ms),
        }
    }

    /// Drops silent rooms, old tombstones, old mailbox entries and idle buckets. Runs before every request, so no
    /// route ever sees a room past its lifetime.
    pub fn sweep(&self, now: u64) {
        let mut st = self.lock();
        let dead: Vec<String> = st
            .rooms
            .values()
            .filter(|r| r.host_silent_ms(now) >= ROOM_DROP_MS)
            .map(|r| r.room_id.clone())
            .collect();
        for id in dead {
            if let Some(mut room) = st.rooms.remove(&id) {
                for ep in room.endpoints.values_mut() {
                    ep.mailbox.wake_all();
                }
                st.codes.remove(&room.code);
                st.creates.retain(|_, v| *v != id);
            }
        }
        st.tombstones.retain(|_, t| t.at_ms + TOMBSTONE_MS > now);
        let live: std::collections::HashSet<String> = st.tombstones.keys().cloned().collect();
        st.ended_codes.retain(|_, id| live.contains(id));
        let live_rooms: std::collections::HashSet<String> = st.rooms.keys().cloned().collect();
        st.creates.retain(|_, id| live_rooms.contains(id));
        for room in st.rooms.values_mut() {
            for ep in room.endpoints.values_mut() {
                ep.mailbox.prune(now);
            }
        }
        st.create_limit.prune(now);
        st.register_limit.prune(now);
        st.signal_limit.prune(now);
    }

    // ---- SSE: the adapter calls these around one open stream ----

    /// A stream opened: the host's counts as its heartbeat.
    pub fn sse_opened(&self, s: &SseOpen, now: u64) -> bool {
        let mut st = self.lock();
        let Some(room) = st.rooms.get_mut(&s.room_id) else {
            return false;
        };
        let Some(ep) = room.endpoints.get_mut(&s.endpoint_id) else {
            return false;
        };
        ep.streams += 1;
        if s.endpoint_id == HOST_ENDPOINT {
            room.host_seen_ms = now;
        }
        true
    }

    pub fn sse_closed(&self, s: &SseOpen, now: u64) {
        let mut st = self.lock();
        if let Some(room) = st.rooms.get_mut(&s.room_id) {
            if let Some(ep) = room.endpoints.get_mut(&s.endpoint_id) {
                ep.streams = ep.streams.saturating_sub(1);
            }
            if s.endpoint_id == HOST_ENDPOINT {
                room.host_seen_ms = now;
            }
        }
    }

    /// Events after `cursor`, or `None` when the room or endpoint is gone (the stream ends; the client reconnects and
    /// gets `404 unknown-room` or re-registers).
    pub fn sse_take(&self, s: &SseOpen, cursor: u64) -> Option<Vec<Event>> {
        let st = self.lock();
        let ep = st.rooms.get(&s.room_id)?.endpoints.get(&s.endpoint_id)?;
        Some(ep.mailbox.after(cursor))
    }

    /// Resolves when the endpoint has events after `cursor`, or is gone.
    pub fn sse_wait(self: &Arc<Self>, s: &SseOpen, cursor: u64) -> SseWait {
        SseWait {
            app: Arc::clone(self),
            room_id: s.room_id.clone(),
            endpoint_id: s.endpoint_id.clone(),
            cursor,
        }
    }

    /// Takes a code with a placeholder room (tests: a code collision on re-registration).
    #[cfg(test)]
    pub(crate) fn squat(&self, code: &str, now: u64) {
        let mut st = self.lock();
        st.codes.insert(code.into(), "rm-squat".into());
        st.rooms.insert(
            "rm-squat".into(),
            Room::new("rm-squat".into(), code.into(), "x".into(), now),
        );
    }

    #[cfg(test)]
    pub(crate) fn room_count(&self) -> usize {
        self.lock().rooms.len()
    }
}

/// See [`App::sse_wait`].
pub struct SseWait {
    app: Arc<App>,
    room_id: String,
    endpoint_id: String,
    cursor: u64,
}

impl Future for SseWait {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let mut st = self.app.lock();
        let Some(ep) = st
            .rooms
            .get_mut(&self.room_id)
            .and_then(|r| r.endpoints.get_mut(&self.endpoint_id))
        else {
            return Poll::Ready(());
        };
        if ep.mailbox.has_after(self.cursor) {
            return Poll::Ready(());
        }
        ep.mailbox.register_waker(cx.waker());
        Poll::Pending
    }
}

/// Formats one SSE event (`id:` + `data:` lines).
pub fn sse_event(e: &Event) -> String {
    let mut out = format!("id: {}\n", e.id);
    for line in e.data.split('\n') {
        out.push_str("data: ");
        out.push_str(line);
        out.push('\n');
    }
    out.push('\n');
    out
}

/// The heartbeat comment (every 15 s; Cloudflare's proxy read timeout is ~100 s).
pub const SSE_HEARTBEAT: &str = ": hb\n\n";
pub const SSE_HEARTBEAT_MS: u64 = 15_000;
