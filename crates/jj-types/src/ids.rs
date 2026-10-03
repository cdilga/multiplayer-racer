//! Identifier newtypes. None of them is a count or a cap: numbers and handles are as wide as their wire field,
//! and seat numbers are `u32` so any number of players gets one (R36).

use serde::{Deserialize, Serialize};

macro_rules! id {
    ($(#[$doc:meta])* $name:ident($inner:ty)) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize)]
        #[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
        #[serde(transparent)]
        pub struct $name(pub $inner);
    };
}

macro_rules! text_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize)]
        #[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(s: &str) -> Self {
                Self(s.to_owned())
            }
        }
    };
}

id!(
    /// A seat in the room (stable for the room's life; a seat owns a car and a number).
    SeatId(u32)
);
id!(
    /// The number painted on a car and shown on its badge (`#108`). Not a slot index and not capped.
    SeatNumber(u32)
);
id!(
    /// Per-connection handle the host assigns to a controller source on claim; tags each state record.
    SourceHandle(u16)
);
id!(
    /// A discrete controller action (wheelie release, utility); the host deduplicates on it.
    ActionId(u32)
);
id!(
    /// The round a seat is in; `Action`s echo it so a stale action can't land in a new round.
    RoundId(u32)
);
id!(
    /// The seat's current life within a round (bumps on respawn); `Action`s echo it.
    LifeId(u32)
);
id!(
    /// A controller's claim request (idempotent retries reuse it).
    RequestId(u32)
);
id!(
    /// A host UI command (start, End round, reroll…) sent from main to the sim worker.
    CommandId(u32)
);
id!(
    /// A round-map preparation; a `MapReady` with a stale one is ignored.
    PreparationId(u32)
);
id!(
    /// A fixed simulation step.
    Tick(u64)
);
id!(
    /// A host-local input source (a pad or keyboard player) as the worker sees it.
    LocalSourceId(u32)
);

text_id!(
    /// A signalling endpoint: one per browser (the host's is `"host"`). Not a seat.
    EndpointId
);
text_id!(
    /// A room's permanent id; controllers address the room by it, so a code change after a restart doesn't strand them.
    RoomId
);
text_id!(
    /// The 4-character join code shown on the TV (a locator, never a credential).
    RoomCode
);
text_id!(
    /// The build identifier the server and bundles report (`/version`).
    BuildId
);

/// The room-code alphabet: no O/0/I/1/L, so codes read unambiguously off a TV (plan §5.1).
pub const ROOM_CODE_ALPHABET: &str = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// Room codes are this many characters.
pub const ROOM_CODE_LEN: usize = 4;

impl RoomCode {
    /// Normalises typed entry (case-insensitive) and checks the alphabet and length; `None` if it can't be a code.
    pub fn parse(entry: &str) -> Option<Self> {
        let code: String = entry.trim().to_ascii_uppercase();
        (code.chars().count() == ROOM_CODE_LEN
            && code.chars().all(|c| ROOM_CODE_ALPHABET.contains(c)))
        .then_some(Self(code))
    }
}

/// A seat's identity colour: its index into the identity palette (`art/ui/tokens.json`; past the palette's end the
/// pattern variants take over) and the sRGB the controller paints with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
pub struct SeatColour {
    pub index: u16,
    pub rgb: [u8; 3],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_codes_normalise_and_reject_ambiguous_letters() {
        assert_eq!(RoomCode::parse(" kq7x ").unwrap().as_str(), "KQ7X");
        assert!(
            RoomCode::parse("ROO7").is_none(),
            "O isn't in the alphabet (the U02 mocks' ROO7 can't occur)"
        );
        assert!(RoomCode::parse("R007").is_none(), "0 isn't in the alphabet");
        assert!(RoomCode::parse("LIO1").is_none());
        assert!(RoomCode::parse("ABC").is_none());
        assert!(RoomCode::parse("ABCDE").is_none());
    }
}
