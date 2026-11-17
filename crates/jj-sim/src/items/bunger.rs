//! The bunger (br-bhkz.3): a big firecracker. Lobbed ahead at the nearest rival in front (aimed at where that car will
//! be when the fuse runs out) or dropped behind, it lands, sits and goes off when its fuse (the card's lifetime) runs
//! out: every rival in the ring is thrown outward and damaged, more toward the middle; junk in the ring is thrown too and
//! becomes the thrower's. The thrower's own car is never hit. Plain data: the sim steps it, hashes it and reports it.

use serde::{Deserialize, Serialize};

/// The blast ring's radius (in plan), and how far above or below the bunger a car may be, m.
pub const BLAST_RADIUS_M: f32 = 9.0;
pub const BLAST_REACH_Y_M: f32 = 4.0;
/// The speed change at the middle of the ring, m/s, outward with a little lift; at the edge `EDGE_SHARE` of it.
pub const BLAST_DV_MPS: f32 = 9.0;
pub const BLAST_LIFT: f32 = 0.35;
/// Damage at the middle (to the part nearest the bunger), and the share of push and damage left at the ring's edge.
pub const BLAST_DAMAGE: f32 = 30.0;
pub const EDGE_SHARE: f32 = 0.4;
/// Junk in the ring is thrown outward at this at the middle, m/s.
pub const JUNK_DV_MPS: f32 = 7.0;
/// A plain forward lob: this far ahead of the car's own motion a second, m/s. A rear drop is let go at rest.
pub const LOB_MPS: f32 = 12.0;
/// Auto-aim: the nearest rival within this cone ahead (half-angle cosine, 35 degrees) and range.
pub const AIM_COS: f32 = 0.82;
pub const AIM_RANGE_M: f32 = 45.0;
/// It rests this far over the ground, m.
pub const REST_M: f32 = 0.2;
/// The blast stays in the snapshot this long, ticks (0.4 s at 120 Hz), for the TV's ring.
pub const SHOW_TICKS: u64 = 48;
/// The snapshot's debris kind words: a lit bunger, and its blast.
pub const SNAPSHOT_KIND: u32 = 15;
pub const SNAPSHOT_KIND_BLAST: u32 = 16;
/// A sanga'd car takes this share of the push and the damage (W03).
pub const SANGA_SCALE: f32 = 0.2;

/// What the blast leaves of its push and damage at `distance` m from the middle (0 outside the ring).
pub fn falloff(distance: f32) -> f32 {
    if distance >= BLAST_RADIUS_M {
        0.0
    } else {
        1.0 - (1.0 - EDGE_SHARE) * (distance / BLAST_RADIUS_M)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub car: u32,
    pub part: u8,
    pub dv_mps: f32,
    pub damage: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bunger {
    /// The item effect this bunger is (its identity and fuse).
    pub effect: u64,
    /// The thrower's car and the life it threw from.
    pub car: u32,
    pub life: u32,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
    pub landed: bool,
    /// The fuse runs out at this tick.
    pub blast_at: u64,
    /// The tick it went off, and the cars it hit.
    pub blast: Option<u64>,
    pub hits: Vec<Hit>,
    /// The round ended first: it never went off.
    pub dud: bool,
}

impl Bunger {
    /// Still to go off.
    pub fn lit(&self) -> bool {
        self.blast.is_none() && !self.dud
    }

    /// Whether its blast is still in the snapshot at `tick`.
    pub fn blasting(&self, tick: u64) -> bool {
        self.blast.is_some_and(|at| tick < at + SHOW_TICKS)
    }

    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        out.extend(postcard::to_allocvec(self).expect("a bunger serialises"));
    }
}
