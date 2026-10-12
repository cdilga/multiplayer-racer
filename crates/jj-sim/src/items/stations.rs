//! P1-W04: item pickup stations. A station is the map's `generic/item-station` dressing: a delivery box over the road.
//! While it is ready, every car inside it is offered a draw each tick; the host claims the offer for the car's seat
//! (`Sim::pickup_item`, journalled) and only a successful pickup takes the box (`Sim::take_station`, journalled), so a
//! full queue or a protected car leaves it for the next car. A taken station recharges for `RECHARGE_TICKS`, visibly.
//! The draw is seeded by the run, the station and how many times it has been taken: deterministic, and independent of
//! race position (no rubber-banding).

use jj_types::items::ItemId;
use serde::{Deserialize, Serialize};

use crate::rng::Rng;

/// A car whose body is within this of the box (in plan) is inside it.
pub const RADIUS_M: f32 = 2.2;
/// ... and within this vertically (the box hovers over the road).
pub const REACH_Y_M: f32 = 2.5;
/// The box hovers this far over the road.
pub const HOVER_M: f32 = 1.1;
/// The snapshot's debris kind words for a station (after the boomerang's 4): its box holding a boomerang, recharging, or
/// its box holding a sanga.
pub const SNAPSHOT_KIND_READY_BOOMERANG: u32 = 5;
pub const SNAPSHOT_KIND_RECHARGING: u32 = 6;
pub const SNAPSHOT_KIND_READY_SANGA: u32 = 7;
/// Recharge after a pickup: 5 s of game time.
pub const RECHARGE_TICKS: u64 = 5 * crate::TICK_HZ as u64;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    /// The map dressing this station is.
    pub dressing: u32,
    pub position: [f32; 3],
    /// Ready from this tick on.
    pub ready_at: u64,
    /// How many boxes it has given.
    pub taken: u32,
}

impl Station {
    pub fn ready(&self, tick: u64) -> bool {
        tick >= self.ready_at
    }

    /// The item its next box holds, from the pool {boomerang, sanga}.
    pub fn draw(&self, seed: u64, index: usize) -> ItemId {
        let key = seed ^ ((index as u64) << 32) ^ u64::from(self.taken);
        if Rng::stream(key, "station").next_u64() & 1 == 0 {
            ItemId::Boomerang
        } else {
            ItemId::Sanga
        }
    }
}

/// A box offered to a car this tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub station: u32,
    pub car: u32,
    pub item: ItemId,
}
