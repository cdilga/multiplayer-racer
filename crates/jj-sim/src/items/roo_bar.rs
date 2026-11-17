//! The roo bar (br-bhkz.3): a ram buff. While it is fitted, a ram this car drives costs its own parts nothing and costs
//! the car it hits double. "Drives" is the damage module's strike share: this car brought at least half the closing
//! speed. Struck from the side or behind, the bar does nothing. Its duration is the card's; a second bar refreshes it.

use jj_types::items::ItemId;

use super::Items;

/// What the bar's own car keeps of a ram it drives.
pub const SELF_SCALE: f32 = 0.0;
/// What the car it rams takes, as a multiple of the hit.
pub const HIT_SCALE: f32 = 2.0;
/// A car must bring at least this share of the closing speed for the bar to count.
pub const STRIKE_SHARE: f32 = 0.5;
/// The snapshot's debris kind word for a fitted roo bar (drawn on the car's nose, at the car's pose).
pub const SNAPSHOT_KIND: u32 = 17;

/// Remaining ticks of the bar on `car`, if one is fitted.
pub fn remaining(items: &Items, car: u32, tick: u64) -> Option<u64> {
    items
        .effects()
        .filter(|e| e.item == ItemId::RooBar && e.car == car && e.expires_at > tick)
        .map(|e| e.expires_at - tick)
        .max()
}

pub fn active(items: &Items, car: u32, tick: u64) -> bool {
    remaining(items, car, tick).is_some()
}
