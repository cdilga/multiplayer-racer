//! Rooms, signalling endpoints and their SSE mailboxes (P1-N03, plan §5.1–§5.2). In memory: a server restart drops
//! everything, hosts re-register with their ticket and controllers re-register their endpoints. Lifetimes, never
//! counts: nothing limits how many rooms, endpoints or messages exist.

use std::collections::{HashMap, VecDeque};
use std::task::Waker;

use jj_types::ROOM_CODE_ALPHABET;

use crate::crypto::Entropy;

/// The host's signalling endpoint id.
pub const HOST_ENDPOINT: &str = "host";
/// Undelivered messages stay this long per endpoint stream (DEFAULT).
pub const MAILBOX_KEEP_MS: u64 = 60_000;
/// No host stream for this long → `host-unreachable` (DEFAULT, TUNE).
pub const HOST_UNREACHABLE_MS: u64 = 30_000;
/// No host stream for this long → the room record is dropped (DEFAULT, TUNE).
pub const ROOM_DROP_MS: u64 = 10 * 60_000;
/// An ended room's tombstone lives this long.
pub const TOMBSTONE_MS: u64 = 24 * 3_600_000;

/// Codes that never get issued (4-letter rude words in the code alphabet).
const DENY: &[&str] = &[
    "ANUS", "ARSE", "BUMS", "CRAP", "CUNT", "DAMN", "DICK", "DYKE", "FUCK", "FUKK", "FVCK", "HOMO",
    "JERK", "KUNT", "NAZI", "NUDE", "PAKI", "PHUK", "PISS", "POOP", "PORN", "PUSS", "RAPE", "SCUM",
    "SEXY", "SHAT", "SHYT", "SKAG", "SLAG", "SLUT", "SMEG", "SPAZ", "SPUNK", "TURD", "TWAT",
    "WANK", "WHOR", "WTF", "XXX", "SUCK", "PUBE", "PRCK",
];

pub fn is_denied(code: &str) -> bool {
    DENY.iter().any(|w| code.contains(w))
}

pub fn random_code(rng: &mut dyn Entropy) -> String {
    let alphabet = ROOM_CODE_ALPHABET.as_bytes();
    loop {
        let code: String = (0..jj_types::ROOM_CODE_LEN)
            .map(|_| alphabet[(rng.next_u32() as usize) % alphabet.len()] as char)
            .collect();
        if !is_denied(&code) {
            return code;
        }
    }
}

pub fn random_id(prefix: &str, rng: &mut dyn Entropy) -> String {
    let mut b = [0u8; 8];
    rng.fill(&mut b);
    format!(
        "{prefix}-{}",
        b.iter().map(|x| format!("{x:02x}")).collect::<String>()
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub id: u64,
    pub at_ms: u64,
    pub data: String,
}

/// One endpoint's outbound SSE queue. Event ids are monotonic per endpoint; messages are kept for
/// [`MAILBOX_KEEP_MS`] so a reconnect with `Last-Event-ID` gets what it missed exactly once.
#[derive(Debug, Default)]
pub struct Mailbox {
    next_id: u64,
    events: VecDeque<Event>,
    wakers: Vec<Waker>,
}

impl Mailbox {
    pub fn push(&mut self, data: String, now_ms: u64) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.events.push_back(Event {
            id,
            at_ms: now_ms,
            data,
        });
        for w in self.wakers.drain(..) {
            w.wake();
        }
        id
    }

    /// Events after `last` (a `last` from before a server restart, past our newest id, restarts from the beginning).
    pub fn after(&self, last: u64) -> Vec<Event> {
        let last = if last > self.next_id { 0 } else { last };
        self.events
            .iter()
            .filter(|e| e.id > last)
            .cloned()
            .collect()
    }

    pub fn has_after(&self, last: u64) -> bool {
        let last = if last > self.next_id { 0 } else { last };
        self.events.back().is_some_and(|e| e.id > last)
    }

    pub fn register_waker(&mut self, w: &Waker) {
        if !self.wakers.iter().any(|x| x.will_wake(w)) {
            self.wakers.push(w.clone());
        }
    }

    pub fn wake_all(&mut self) {
        for w in self.wakers.drain(..) {
            w.wake();
        }
    }

    pub fn prune(&mut self, now_ms: u64) {
        while self
            .events
            .front()
            .is_some_and(|e| e.at_ms + MAILBOX_KEEP_MS <= now_ms)
        {
            self.events.pop_front();
        }
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

#[derive(Debug)]
pub struct Endpoint {
    pub secret_hash: String,
    pub mailbox: Mailbox,
    /// Open SSE streams for this endpoint.
    pub streams: u32,
}

impl Endpoint {
    pub fn new(secret_hash: String) -> Self {
        Self {
            secret_hash,
            mailbox: Mailbox::default(),
            streams: 0,
        }
    }
}

#[derive(Debug)]
pub struct Room {
    pub room_id: String,
    pub code: String,
    pub host_secret_hash: String,
    pub endpoints: HashMap<String, Endpoint>,
    /// When the host's stream was last seen (open now, or closed at this time).
    pub host_seen_ms: u64,
    pub created_ms: u64,
}

impl Room {
    pub fn new(room_id: String, code: String, host_secret_hash: String, now_ms: u64) -> Self {
        let mut endpoints = HashMap::new();
        endpoints.insert(
            HOST_ENDPOINT.to_owned(),
            Endpoint::new(host_secret_hash.clone()),
        );
        Self {
            room_id,
            code,
            host_secret_hash,
            endpoints,
            host_seen_ms: now_ms,
            created_ms: now_ms,
        }
    }

    pub fn host_streaming(&self) -> bool {
        self.endpoints
            .get(HOST_ENDPOINT)
            .is_some_and(|e| e.streams > 0)
    }

    pub fn host_silent_ms(&self, now_ms: u64) -> u64 {
        if self.host_streaming() {
            0
        } else {
            now_ms.saturating_sub(self.host_seen_ms)
        }
    }
}

#[derive(Clone, Debug)]
pub struct Tombstone {
    pub code: String,
    pub at_ms: u64,
}
