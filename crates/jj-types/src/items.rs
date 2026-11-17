//! The item identities and use refusals shared by the sim and wire (P1-W01).
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
    /// A ram buff (a roo bar on the nose): this car's rams hit harder and cost its own nose nothing.
    RooBar,
    /// A firecracker lobbed ahead or dropped behind: it goes off after its fuse and blasts every rival near it.
    Bunger,
    /// A magpie that swoops whoever is winning.
    Magpie,
}

impl ItemId {
    /// Every item, in the order a station's draw indexes them.
    pub const ALL: [ItemId; 7] = [
        ItemId::Boomerang,
        ItemId::Sanga,
        ItemId::Tinnie,
        ItemId::Esky,
        ItemId::RooBar,
        ItemId::Bunger,
        ItemId::Magpie,
    ];

    /// The item's place in [`ItemId::ALL`].
    pub fn index(self) -> usize {
        self as usize
    }

    /// The item's id as its card and the wire spell it.
    pub fn id(self) -> &'static str {
        match self {
            ItemId::Boomerang => "boomerang",
            ItemId::Sanga => "sanga",
            ItemId::Tinnie => "tinnie",
            ItemId::Esky => "esky",
            ItemId::RooBar => "roo-bar",
            ItemId::Bunger => "bunger",
            ItemId::Magpie => "magpie",
        }
    }
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
