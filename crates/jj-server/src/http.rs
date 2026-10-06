//! The server's own request/response types. The Asupersync adapter (`main.rs`) parses HTTP/1.1 into a [`Request`] and
//! writes a [`Response`] back; everything between is plain synchronous code, so tests drive it without sockets.

/// One parsed request. Header names are lower-case; `path` has no query string.
#[derive(Clone, Debug, Default)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// The client's address: the tunnel's `CF-Connecting-IP` when present, else the socket peer.
    pub client_ip: String,
}

impl Request {
    pub fn new(method: &str, target: &str) -> Self {
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        Self {
            method: method.to_owned(),
            path: path.to_owned(),
            query: query.to_owned(),
            ..Self::default()
        }
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers
            .push((name.to_ascii_lowercase(), value.to_owned()));
        self
    }

    pub fn with_body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = body.into();
        self
    }

    pub fn with_ip(mut self, ip: &str) -> Self {
        self.client_ip = ip.to_owned();
        self
    }

    /// The bearer token from `Authorization: Bearer <token>`.
    pub fn bearer(&self) -> Option<&str> {
        let v = self.header("authorization")?;
        let (scheme, token) = v.split_once(' ')?;
        scheme
            .eq_ignore_ascii_case("bearer")
            .then_some(token.trim())
    }

    /// A query parameter's raw value (our ids and codes never need percent-decoding).
    pub fn query_param(&self, name: &str) -> Option<&str> {
        self.query
            .split('&')
            .filter_map(|kv| kv.split_once('='))
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v)
    }
}

/// An SSE stream the adapter keeps open: the endpoint whose mailbox it drains, from just after `last_event_id`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SseOpen {
    pub room_id: String,
    pub endpoint_id: String,
    pub last_event_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Body {
    Bytes(Vec<u8>),
    /// `text/event-stream`: the adapter streams the mailbox (see `App::sse_*`).
    Sse(SseOpen),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}

pub const NO_STORE: &str = "no-store";
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
pub const NO_CACHE: &str = "no-cache";

impl Response {
    pub fn bytes(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: vec![("content-type".into(), content_type.into())],
            body: Body::Bytes(body.into()),
        }
    }

    /// A JSON API response (`Cache-Control: no-store`).
    pub fn json(status: u16, body: Vec<u8>) -> Self {
        Self::bytes(status, "application/json", body).cache(NO_STORE)
    }

    pub fn text(status: u16, text: &str) -> Self {
        Self::bytes(
            status,
            "text/plain; charset=utf-8",
            text.as_bytes().to_vec(),
        )
    }

    pub fn not_found() -> Self {
        Self::text(404, "not found").cache(NO_STORE)
    }

    pub fn cache(self, value: &str) -> Self {
        self.with_header("cache-control", value)
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.retain(|(k, _)| k != name);
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn body_bytes(&self) -> &[u8] {
        match &self.body {
            Body::Bytes(b) => b,
            Body::Sse(_) => &[],
        }
    }
}

/// Request size limits (N02): the adapter refuses anything larger with `413`/`431` before the app sees it.
pub const MAX_BODY_BYTES: usize = 64 * 1024;
pub const MAX_HEADER_BYTES: usize = 16 * 1024;
