//! The two approved item identities and use refusals shared by the sim and wire (P1-W01).
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[serde(rename_all = "kebab-case")]
pub enum ItemId {
    Boomerang,
    Sanga,
    /// A self-use speed boost (a cold tinnie).
    Tinnie,
    /// A hazard dropped behind the car: persistent dynamic debris.
    Esky,
}

impl ItemId {
    /// Every item, in the order a station's draw indexes them.
    pub const ALL: [ItemId; 4] = [
        ItemId::Boomerang,
        ItemId::Sanga,
        ItemId::Tinnie,
        ItemId::Esky,
    ];
}

/// A refused use retains the front item; these describe why, rather than silently consuming it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub enum ItemUseRefusal {
    Empty,
    Cooldown,
    Protected,
    Blocked,
    Unavailable,
    NotRacing,
}
