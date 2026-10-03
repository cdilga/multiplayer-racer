//! The `state` channel (unordered, lossy, plan §5.4): controller state batches and HUD updates.
//!
//! ```text
//! StateBatch:  u8 type=0x10 | u8 minor | u16 batchSeq | u16 sentAtMs | u8 count      (7 bytes)
//!   record × count:
//!     u16 sourceHandle | u16 sourceSeq | i16 driveX | i16 driveY | i16 actionX | i16 actionY | u8 flags   (13 bytes)
//! HudUpdate:   u8 type=0x20 | u8 minor | postcard(Hud)
//! ```
//! Little-endian. One source is 20 bytes, so 60 Hz is 1,200 B/s of payload (R80's target is 2,000). The codec is
//! lossless: axes are carried as sent (−32768 included); `jj_types::axis::sanitise_axis` is the reader's job.

use jj_types::{SourceHandle, Tick};
use serde::{Deserialize, Serialize};

use crate::DecodeError;

pub const STATE_BATCH: u8 = 0x10;
pub const HUD_UPDATE: u8 = 0x20;
/// The minor version this build writes. Readers accept any minor: a minor bump only adds meaning to unused flag
/// bits or HUD fields' trailing options, never moves a byte.
pub const STATE_MINOR: u8 = 1;
pub const BATCH_HEADER_LEN: usize = 7;
pub const RECORD_LEN: usize = 13;
/// The `count` field is a `u8`; more sources split into more batches (never truncated).
pub const MAX_RECORDS_PER_BATCH: usize = 255;
/// A batch splits when it would pass about this many application bytes (keeps each under one DTLS/SCTP packet).
pub const DEFAULT_BATCH_TARGET_BYTES: usize = 1000;

/// The per-record flag byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct StateFlags(pub u8);

impl StateFlags {
    pub const AVAILABLE: u8 = 1 << 0;
    pub const DRIVE_TOUCH: u8 = 1 << 1;
    pub const ACTION_TOUCH: u8 = 1 << 2;
    pub const WHEELIE_PRELOAD: u8 = 1 << 3;
    pub const MENU_OPEN: u8 = 1 << 4;

    pub fn has(self, bit: u8) -> bool {
        self.0 & bit != 0
    }
}

/// One source's sampled sticks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct StateRecord {
    pub source: SourceHandle,
    /// Wrapping, per source (`jj_types::seq`).
    pub seq: u16,
    /// Drive stick x, y (quantised; the personal response curve is already applied on the controller).
    pub drive: [i16; 2],
    /// Action stick x, y.
    pub action: [i16; 2],
    pub flags: StateFlags,
}

/// A batch of records sent together on one connection.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct StateBatch {
    pub minor: u8,
    /// Wrapping, per connection.
    pub batch_seq: u16,
    /// The controller's monotonic clock, wrapping ms (`jj_types::time::unwrap_ms16`).
    pub sent_at_ms: u16,
    pub records: Vec<StateRecord>,
}

/// A batch with more than 255 records can't be encoded: split it first ([`split_into_batches`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TooManyRecords(pub usize);

impl StateBatch {
    pub fn encoded_len(&self) -> usize {
        BATCH_HEADER_LEN + RECORD_LEN * self.records.len()
    }

    pub fn encode(&self) -> Result<Vec<u8>, TooManyRecords> {
        if self.records.len() > MAX_RECORDS_PER_BATCH {
            return Err(TooManyRecords(self.records.len()));
        }
        let mut out = Vec::with_capacity(self.encoded_len());
        out.extend([STATE_BATCH, self.minor]);
        out.extend(self.batch_seq.to_le_bytes());
        out.extend(self.sent_at_ms.to_le_bytes());
        out.push(self.records.len() as u8);
        for r in &self.records {
            out.extend(r.source.0.to_le_bytes());
            out.extend(r.seq.to_le_bytes());
            for v in [r.drive[0], r.drive[1], r.action[0], r.action[1]] {
                out.extend(v.to_le_bytes());
            }
            out.push(r.flags.0);
        }
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        if bytes.len() < BATCH_HEADER_LEN {
            return Err(DecodeError::Short {
                need: BATCH_HEADER_LEN,
                got: bytes.len(),
            });
        }
        if bytes[0] != STATE_BATCH {
            return Err(DecodeError::UnknownType(bytes[0]));
        }
        let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        let count = usize::from(bytes[6]);
        let need = BATCH_HEADER_LEN + RECORD_LEN * count;
        if bytes.len() < need {
            return Err(DecodeError::Short {
                need,
                got: bytes.len(),
            });
        }
        if bytes.len() > need {
            return Err(DecodeError::Trailing {
                extra: bytes.len() - need,
            });
        }
        let records = (0..count)
            .map(|k| {
                let at = BATCH_HEADER_LEN + k * RECORD_LEN;
                let i16_at = |i: usize| i16::from_le_bytes([bytes[at + i], bytes[at + i + 1]]);
                StateRecord {
                    source: SourceHandle(u16_at(at)),
                    seq: u16_at(at + 2),
                    drive: [i16_at(4), i16_at(6)],
                    action: [i16_at(8), i16_at(10)],
                    flags: StateFlags(bytes[at + 12]),
                }
            })
            .collect();
        Ok(Self {
            minor: bytes[1],
            batch_seq: u16_at(2),
            sent_at_ms: u16_at(4),
            records,
        })
    }
}

/// How one flush is split into batches.
#[derive(Clone, Copy, Debug)]
pub struct SplitOptions {
    /// `batchSeq` of the first batch; later ones count up (wrapping).
    pub first_batch_seq: u16,
    pub sent_at_ms: u16,
    /// Application bytes a batch may reach before the next starts (at least one record always goes in).
    pub target_bytes: usize,
    /// Which record leads this flush (e.g. the flush counter): rotating it spreads the first-batch position, and with
    /// it the loss exposure, fairly across sources.
    pub rotate: usize,
}

impl Default for SplitOptions {
    fn default() -> Self {
        Self {
            first_batch_seq: 0,
            sent_at_ms: 0,
            target_bytes: DEFAULT_BATCH_TARGET_BYTES,
            rotate: 0,
        }
    }
}

/// Splits one flush's records into batches by the byte target and the 255-record limit, whichever comes first.
/// Every record lands in exactly one batch, in rotated order; nothing is ever truncated.
pub fn split_into_batches(records: &[StateRecord], opts: SplitOptions) -> Vec<StateBatch> {
    if records.is_empty() {
        return Vec::new();
    }
    let per = (opts.target_bytes.saturating_sub(BATCH_HEADER_LEN) / RECORD_LEN)
        .clamp(1, MAX_RECORDS_PER_BATCH);
    let start = opts.rotate % records.len();
    let ordered: Vec<StateRecord> = records[start..]
        .iter()
        .chain(&records[..start])
        .copied()
        .collect();
    ordered
        .chunks(per)
        .enumerate()
        .map(|(i, chunk)| StateBatch {
            minor: STATE_MINOR,
            batch_seq: opts.first_batch_seq.wrapping_add(i as u16),
            sent_at_ms: opts.sent_at_ms,
            records: chunk.to_vec(),
        })
        .collect()
}

/// How the controller reaches the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum Connection {
    Direct,
    Relay,
    Reconnecting,
}

/// Why the round is paused (the host composes these; the controller shows the first).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum PauseReason {
    /// The host paused from its controls.
    Host,
    /// The host's tab is hidden.
    HostHidden,
    /// The host lost its renderer (context loss).
    RenderLost,
    /// The sim faulted; the room can't continue (R84).
    Fault,
}

/// The seat's HUD, sent ~10 Hz and on change. Disposable: a lost one is replaced by the next.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct Hud {
    /// Race position, 1-based; `None` outside a race.
    pub position: Option<u32>,
    /// `(current, total)` laps; `None` outside a race.
    pub lap: Option<(u16, u16)>,
    /// Boost meter, 0..=255 for empty..full.
    pub boost: u8,
    pub connection: Option<Connection>,
    pub pause: Option<PauseReason>,
    /// The sim tick the HUD describes.
    pub tick: Tick,
}

/// A HUD update on the state channel.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct HudUpdate {
    pub minor: u8,
    pub hud: Hud,
}

impl HudUpdate {
    pub fn encode(&self) -> Vec<u8> {
        crate::postcard_with_prefix(&[HUD_UPDATE, self.minor], &self.hud)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        match bytes {
            [HUD_UPDATE, minor, body @ ..] => Ok(Self {
                minor: *minor,
                hud: crate::postcard_exact(body)?,
            }),
            [t, _, ..] => Err(DecodeError::UnknownType(*t)),
            _ => Err(DecodeError::Short {
                need: 2,
                got: bytes.len(),
            }),
        }
    }
}

/// Anything on the state channel.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum StateMessage {
    Batch(StateBatch),
    Hud(HudUpdate),
}

impl StateMessage {
    pub fn encode(&self) -> Result<Vec<u8>, TooManyRecords> {
        match self {
            Self::Batch(b) => b.encode(),
            Self::Hud(h) => Ok(h.encode()),
        }
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        match bytes.first() {
            Some(&STATE_BATCH) => StateBatch::decode(bytes).map(Self::Batch),
            Some(&HUD_UPDATE) => HudUpdate::decode(bytes).map(Self::Hud),
            Some(&t) => Err(DecodeError::UnknownType(t)),
            None => Err(DecodeError::Short { need: 1, got: 0 }),
        }
    }
}
