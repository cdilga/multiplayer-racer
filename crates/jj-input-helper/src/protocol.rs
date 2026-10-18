//! The helper ↔ host page messages: JSON text frames over the localhost WebSocket, version [`VERSION`].
//!
//! Helper → page: `hello` on open; `paired` / `unpaired` answering a `pair`; then, only while paired, `devices` (every
//! device the helper has seen this capture, with `connected`), `keys` (a keyboard's held keys, as `KeyboardEvent.code`
//! names, the whole set each time) and `pad` (a pad's four stick axes, −1..1 with y down as in the Gamepad API, and its
//! pressed standard-mapping buttons as a bitmask). Page → helper: `pair` with the code the helper shows or the token a
//! previous pairing gave it. The shapes are pinned by `tests/fixtures/protocol.jsonl`, which the page's tests read too.

use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Keyboard,
    Pad,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Device {
    pub id: u32,
    pub kind: Kind,
    pub name: String,
    pub connected: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum ToPage {
    Hello {
        v: u32,
        os: String,
        version: String,
    },
    Paired {
        token: String,
    },
    Unpaired {
        reason: String,
    },
    Devices {
        devices: Vec<Device>,
    },
    Keys {
        id: u32,
        down: Vec<String>,
    },
    Pad {
        id: u32,
        axes: [f32; 4],
        buttons: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum FromPage {
    Pair {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    },
}

impl ToPage {
    pub fn json(&self) -> String {
        serde_json::to_string(self).expect("protocol messages serialise")
    }
}

/// Rounds an axis to 1/1000: the page quantises to 1/32767 anyway, and three digits keep a pad frame short.
pub fn axis(v: f32) -> f32 {
    (v.clamp(-1.0, 1.0) * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every line of the shared fixture parses as its direction's message and serialises back to the same JSON, so the
    /// page's reader (web/host/tests/helper.test.mjs reads the same file) and the helper agree on the shapes.
    #[test]
    fn fixture_round_trips() {
        let fixture = include_str!("../tests/fixtures/protocol.jsonl");
        let mut n = 0;
        for line in fixture.lines().filter(|l| !l.trim().is_empty()) {
            let (dir, json) = line.split_once(' ').expect("`<dir> <json>`");
            let back = match dir {
                "page<" => serde_json::to_string(&serde_json::from_str::<ToPage>(json).unwrap()),
                "page>" => serde_json::to_string(&serde_json::from_str::<FromPage>(json).unwrap()),
                d => panic!("unknown direction {d}"),
            }
            .unwrap();
            assert_eq!(back, json, "fixture line round-trips");
            n += 1;
        }
        assert!(n >= 8, "the fixture covers every message");
    }

    #[test]
    fn axis_rounds_and_clamps() {
        assert_eq!(axis(0.12345), 0.123);
        assert_eq!(axis(-2.0), -1.0);
    }
}
