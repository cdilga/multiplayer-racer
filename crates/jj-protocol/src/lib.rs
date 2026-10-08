//! Wire formats: controller state, commands and HUD, signalling DTOs and the host worker ABI, with goldens.
//!
//! | Module | Wire | Encoding |
//! |---|---|---|
//! | [`state`] | WebRTC `state` channel (unordered, lossy): controller state batches, HUD updates | fixed binary, little-endian |
//! | [`cmd`] | WebRTC `cmd` channel (ordered, reliable): Hello/Claim/Action… and Welcome/ActionResult/RoomState… | `u8` version + postcard |
//! | [`abi`] | host main thread ↔ sim worker | postcard |
//! | [`signal`] | server API v1 and SSE signalling (plan §5.1) | JSON (camelCase) |
//! | [`clock`] | Ping/Pong clock-offset estimate with ±RTT/2 uncertainty | (not a wire format) |
//!
//! Every message has a golden byte vector in `goldens/`; the goldens test fails when any encoding changes
//! (`JJ_BLESS=1 cargo test -p jj-protocol goldens` rewrites them, for a deliberate version bump only).

#![forbid(unsafe_code)]

pub mod abi;
pub mod clock;
pub mod cmd;
pub mod signal;
pub mod state;

#[cfg(test)]
mod tests;

/// The controller protocol version a `Hello` carries; a host on another version answers `ClaimRejected{Build}`.
pub const PROTOCOL_VERSION: u16 = 5;

/// Why bytes didn't decode. Decoders never panic: any byte string gets a value or one of these.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// Fewer bytes than the header or the declared records need.
    Short { need: usize, got: usize },
    /// Bytes left over after a complete message.
    Trailing { extra: usize },
    /// The message type byte isn't one this channel carries.
    UnknownType(u8),
    /// The version byte isn't this build's.
    Version { expected: u16, got: u16 },
    /// The postcard or JSON body didn't parse.
    Body(String),
}

impl core::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Short { need, got } => {
                write!(f, "message too short: need {need} bytes, got {got}")
            }
            Self::Trailing { extra } => write!(f, "{extra} trailing bytes after the message"),
            Self::UnknownType(t) => write!(f, "unknown message type 0x{t:02x}"),
            Self::Version { expected, got } => {
                write!(f, "version {got}, this build speaks {expected}")
            }
            Self::Body(e) => write!(f, "bad body: {e}"),
        }
    }
}

/// postcard-encodes `msg` after a prefix, with no trailing bytes allowed on the way back in.
pub(crate) fn postcard_with_prefix<T: serde::Serialize>(prefix: &[u8], msg: &T) -> Vec<u8> {
    let mut out = prefix.to_vec();
    // Encoding plain data into a Vec can't fail: no I/O, no size limit, no unsupported serde shapes in these types.
    out.extend(postcard::to_allocvec(msg).expect("postcard encodes protocol types"));
    out
}

pub(crate) fn postcard_exact<'a, T: serde::Deserialize<'a>>(
    bytes: &'a [u8],
) -> Result<T, DecodeError> {
    let (msg, rest) =
        postcard::take_from_bytes(bytes).map_err(|e| DecodeError::Body(e.to_string()))?;
    if rest.is_empty() {
        Ok(msg)
    } else {
        Err(DecodeError::Trailing { extra: rest.len() })
    }
}
