//! Self-use drive boosts (sanga, tinnie): extra engine force along the level heading while the car is on the ground,
//! on top of the car's own drive. Plain data; the sim applies it once per tick as an impulse, like the arcade boost.

use jj_types::items::ItemId;

use super::Items;

/// Extra engine force as a share of the car's `max_engine_force` (and of its power cap).
pub const SANGA_GAIN: f32 = 0.5;
pub const TINNIE_GAIN: f32 = 1.4;

pub fn gain_of(item: ItemId) -> f32 {
    match item {
        ItemId::Sanga => SANGA_GAIN,
        ItemId::Tinnie => TINNIE_GAIN,
        _ => 0.0,
    }
}

/// The drive a car gets from its live boosts at `tick` and a throttle in 0..1. A sanga's tank-up follows the throttle (it is
/// extra drive, not a push), a tinnie pushes whatever the pedal does; boosts never stack (the stronger one counts).
pub fn active_gain(items: &Items, car: u32, tick: u64, throttle: f32) -> f32 {
    items
        .effects()
        .filter(|e| e.car == car && e.expires_at > tick)
        .map(|e| match e.item {
            ItemId::Sanga => SANGA_GAIN * throttle.clamp(0.0, 1.0),
            other => gain_of(other),
        })
        .fold(0.0, f32::max)
}

/// Remaining ticks of `item`'s newest effect on `car`.
pub fn remaining(items: &Items, car: u32, item: ItemId, tick: u64) -> Option<u64> {
    items
        .effects()
        .filter(|e| e.item == item && e.car == car && e.expires_at > tick)
        .map(|e| e.expires_at - tick)
        .max()
}

/// The thrust (N) of a boost `gain` at `forward_speed`, with the profile's engine limits.
pub fn thrust(gain: f32, max_force: f32, max_power_w: f32, forward_speed: f32) -> f32 {
    if gain <= 0.0 {
        return 0.0;
    }
    let force = max_force * gain;
    if max_power_w > 0.0 {
        force.min(max_power_w * gain / forward_speed.max(1.0))
    } else {
        force
    }
}
