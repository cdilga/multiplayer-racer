//! Reliable item facts (P1-W01). Source-specific messages travel inside `HostCmd::ForSource`.
use jj_types::{LifeId, SeatId, Tick};
use serde::{Deserialize, Serialize};

pub use jj_types::items::{ItemId, ItemUseRefusal};

/// FIFO positions, not independent selectable slots. The owner specified exactly two held items.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct Inventory {
    pub front: Option<ItemId>,
    pub back: Option<ItemId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ItemDirection {
    Forward,
    Rear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ItemEventKind {
    Picked,
    Used { direction: ItemDirection },
    Hit { target: Option<SeatId> },
    Caught,
    Expired,
}

/// Causal owner/life stay attached to an effect even if the owner's car respawns.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct ItemEvent {
    pub tick: Tick,
    pub owner: SeatId,
    pub life: LifeId,
    pub effect: u64,
    pub item: ItemId,
    pub kind: ItemEventKind,
}
