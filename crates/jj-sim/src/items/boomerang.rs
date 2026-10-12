//! P1-W02a: the boomerang's flight. A throw leaves the car at `SPEED_MPS` (forward or rear, plus the car's own velocity)
//! with a little sideways spin, then a spring toward the thrower bends it out (about 21 m) and back over about 2.2 s,
//! so it returns to wherever the thrower is now. It flies level at bonnet height. Walls, terrain and debris stop it;
//! each other car is hit at most once per leg (out and back); the thrower catches it on the way back. Plain data: the
//! sim steps it, hashes it and reports it (R90).

use serde::{Deserialize, Serialize};

/// Throw speed relative to the thrower, m/s (the card's 30 m/s).
pub const SPEED_MPS: f32 = 30.0;
/// The sideways part of the throw relative to the thrower, m/s: the out-and-back path is a narrow loop, not a line.
pub const SIDE_MPS: f32 = 5.0;
/// The spring's angular rate (rad/s): out to `SPEED_MPS / OMEGA` (about 21 m) and back after `PI / OMEGA` (2.2 s).
pub const OMEGA: f32 = 1.428;
/// Flight height above the thrower's body origin, m.
pub const HEIGHT_M: f32 = 0.8;
/// A car within this of the boomerang (body origin to boomerang, in plan) is hit.
pub const HIT_RADIUS_M: f32 = 1.8;
/// The thrower catches it on the way back within this.
pub const CATCH_RADIUS_M: f32 = 2.5;
/// The speed change one hit gives a car, m/s (inside the card's 10 m/s envelope), with a little lift.
pub const HIT_DV_MPS: f32 = 6.0;
pub const HIT_LIFT: f32 = 0.25;
/// Damage to the struck part (S04).
pub const HIT_DAMAGE: f32 = 25.0;
/// How fast it spins as drawn: 8 turns a second, at 120 Hz.
pub const SPIN_RAD_PER_TICK: f32 = core::f32::consts::TAU * 8.0 / 120.0;
/// The snapshot's debris kind word for a boomerang in the air (after the props' kinds: debris 0, cone 1, part 2, husk 3).
pub const SNAPSHOT_KIND: u32 = 4;
/// A sanga'd car takes this share of the push and the damage (W03).
pub const SANGA_SCALE: f32 = 0.2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Leg {
    Out,
    Back,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum End {
    /// The thrower caught it on the way back.
    Caught,
    /// A wall, the ground or debris stopped it.
    Stopped,
    /// Its lifetime ran out, the round ended or the thrower respawned: it drops.
    Dropped,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub tick: u64,
    pub car: u32,
    pub leg: Leg,
    pub part: u8,
    pub dv_mps: f32,
    pub damage: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flight {
    /// The item effect this flight is (its identity and expiry).
    pub effect: u64,
    /// The thrower's car and the life it threw from.
    pub car: u32,
    pub life: u32,
    pub position: [f32; 3],
    /// Velocity relative to the thrower, m/s (the spring acts on it).
    pub relative_velocity: [f32; 3],
    pub leg: Leg,
    pub armed_at: u64,
    pub expires_at: u64,
    pub hits: Vec<Hit>,
    pub ended: Option<(u64, End)>,
}

impl Flight {
    /// Whether `car` was already hit on this flight's current leg.
    pub fn hit_this_leg(&self, car: u32) -> bool {
        self.hits.iter().any(|h| h.car == car && h.leg == self.leg)
    }

    pub fn active(&self) -> bool {
        self.ended.is_none()
    }

    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        out.extend(postcard::to_allocvec(self).expect("a flight serialises"));
    }
}
