//! The magpie (br-bhkz.3): swooping season. Let go in either direction, it climbs, finds whoever is winning (the most
//! points in a derby, the leader in a race; the next best when that is the thrower) and dives on them: one peck that
//! damages the part it hits, shoves the car and spins it. It flies at a fixed speed and turns only so fast, so a hard
//! turn as it dives can shake it; it never hits its thrower, a protected car or a finished one. Plain data.

use serde::{Deserialize, Serialize};

/// Its flying speed, m/s, and how fast its heading turns, rad/s.
pub const SPEED_MPS: f32 = 32.0;
pub const TURN_RAD_S: f32 = 3.2;
/// It leaves the car climbing at this angle (sine), from this far over the roof, m.
pub const LAUNCH_UP: f32 = 0.6;
pub const LAUNCH_ABOVE_M: f32 = 1.8;
/// Until it is within `DIVE_M` of its target (in plan) it aims `CRUISE_M` above it; then at `AIM_ABOVE_M` over its origin.
pub const CRUISE_M: f32 = 6.0;
pub const DIVE_M: f32 = 14.0;
pub const AIM_ABOVE_M: f32 = 0.9;
/// It never flies lower than this over the ground, m.
pub const FLOOR_M: f32 = 0.9;
/// A car within this of it (in plan, and `HIT_REACH_Y_M` vertically) is pecked.
pub const HIT_RADIUS_M: f32 = 2.4;
pub const HIT_REACH_Y_M: f32 = 2.5;
/// The peck: a shove along its flight, m/s, with a little lift; a yaw kick, rad/s; and damage to the nearest part.
pub const HIT_DV_MPS: f32 = 5.0;
pub const HIT_LIFT: f32 = 0.2;
pub const HIT_SPIN_RAD_S: f32 = 3.5;
pub const HIT_DAMAGE: f32 = 20.0;
/// A sanga'd car takes this share of all three (W03).
pub const SANGA_SCALE: f32 = 0.2;
/// The snapshot's debris kind word for a magpie in the air.
pub const SNAPSHOT_KIND: u32 = 14;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum End {
    /// It pecked its target and flew off.
    Pecked,
    /// Nobody to swoop (every rival protected, finished or gone).
    Lost,
    /// Its seven seconds ran out, or the round ended.
    Dropped,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub tick: u64,
    pub car: u32,
    pub part: u8,
    pub dv_mps: f32,
    pub damage: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Swoop {
    /// The item effect this magpie is (its identity and expiry).
    pub effect: u64,
    /// The thrower's car and the life it threw from.
    pub car: u32,
    pub life: u32,
    pub position: [f32; 3],
    /// Its heading: a unit vector.
    pub heading: [f32; 3],
    /// The car it is after.
    pub target: Option<u32>,
    pub armed_at: u64,
    pub expires_at: u64,
    pub hit: Option<Hit>,
    pub ended: Option<(u64, End)>,
}

impl Swoop {
    pub fn active(&self) -> bool {
        self.ended.is_none()
    }

    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        out.extend(postcard::to_allocvec(self).expect("a swoop serialises"));
    }
}

/// `from` turned toward `to` (unit vectors) by at most `max` radians.
pub fn turn_toward(from: [f32; 3], to: [f32; 3], max: f32) -> [f32; 3] {
    let dot = (from[0] * to[0] + from[1] * to[1] + from[2] * to[2]).clamp(-1.0, 1.0);
    let angle = libm::acosf(dot);
    if angle <= max || angle < 1e-4 {
        return to;
    }
    // Spherical interpolation by max / angle. Opposite headings have no plane to turn in: tip the target up a little.
    let (to, angle) = if angle > 3.1 {
        let tipped = [to[0], to[1] + 0.2, to[2]];
        let n = libm::sqrtf(tipped[0] * tipped[0] + tipped[1] * tipped[1] + tipped[2] * tipped[2]);
        let t = [tipped[0] / n, tipped[1] / n, tipped[2] / n];
        let d = (from[0] * t[0] + from[1] * t[1] + from[2] * t[2]).clamp(-1.0, 1.0);
        (t, libm::acosf(d))
    } else {
        (to, angle)
    };
    let s = libm::sinf(angle);
    let t = max / angle;
    let (a, b) = (libm::sinf((1.0 - t) * angle) / s, libm::sinf(t * angle) / s);
    let v = [
        from[0] * a + to[0] * b,
        from[1] * a + to[1] * b,
        from[2] * a + to[2] * b,
    ];
    let n = libm::sqrtf(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).max(1e-6);
    [v[0] / n, v[1] / n, v[2] / n]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_is_limited_and_reaches_its_target() {
        let (x, z) = ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
        let step = turn_toward(x, z, 0.1);
        let dot = step[0] * x[0] + step[1] * x[1] + step[2] * x[2];
        assert!((libm::acosf(dot) - 0.1).abs() < 1e-4, "it turned 0.1 rad");
        assert_eq!(
            turn_toward(x, z, 2.0),
            z,
            "a turn within reach lands on the target"
        );
        // Straight back: it still turns, and stays a unit vector.
        let back = turn_toward(x, [-1.0, 0.0, 0.0], 0.1);
        let len = libm::sqrtf(back[0] * back[0] + back[1] * back[1] + back[2] * back[2]);
        assert!((len - 1.0).abs() < 1e-4 && back[0] < 1.0);
    }
}
