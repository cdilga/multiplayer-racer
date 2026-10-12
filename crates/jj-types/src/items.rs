//! The two approved item identities and use refusals shared by the sim and wire (P1-W01).
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[serde(rename_all = "kebab-case")]
pub enum ItemId {
    Boomerang,
    Sanga,
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
