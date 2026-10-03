//! The placement service's geometry and policy (P1-S06, plan §7.5, master §6.5 and §10.9): one service for start grids,
//! respawns and drop-in, for any number of cars with no cap, queue or refusal. 0.1's silent spawn cap (16 authored
//! spawns, modulo-wrapped, so player 17 landed on player 1) never returns.
//!
//! - **Start grid.** Rows fill the map's declared start corridor back along the route from the finish line (columns
//!   across its width, rows `rowSpacing` apart, following the route through bends). Once the corridor is full, further
//!   cars go into it anyway, each overflow layer staggered (a low-discrepancy sequence, 1–7 m behind its slot) so no
//!   two poses coincide, under spawn protection until clear.
//! - **Spawn protection** (1.5 s) ghosts a car against cars and debris (terrain and barriers stay solid). It ends only
//!   when the car overlaps no solid car or debris. Two protected cars overlapping resolve by car id: the lower one
//!   turns solid first.
//! - **Pose search.** A respawn or drop-in tries its target pose, then steps back along the route and to either side.
//!   If nothing is clear, the car takes the target pose anyway under protection: it's immediately controllable, never
//!   refused.
//! - **Drop-in** (R63) targets ~3 s of route behind the last still-racing car, from a short history of that car's
//!   progress. It is at least [`DROP_IN_MIN_GAP_M`] behind, so a stationary last racer still leaves a gap. The newcomer
//!   inherits the gate state at that point, marked late. Before any history exists it takes the next grid slot.

use jj_map::LoadedMap;

use crate::journal::SpawnPose;
use crate::sim::TICK_HZ;

pub const PROTECT_TICKS: u64 = 3 * TICK_HZ as u64 / 2;
pub const DROP_IN_BEHIND_TICKS: u64 = 3 * TICK_HZ as u64;
/// A drop-in lands at least this far (m) behind the last racer.
pub const DROP_IN_MIN_GAP_M: f32 = 12.0;
/// Progress history: one sample per this many ticks, kept for [`HISTORY_KEEP_TICKS`].
pub const HISTORY_EVERY_TICKS: u64 = TICK_HZ as u64 / 10;
pub const HISTORY_KEEP_TICKS: u64 = 6 * TICK_HZ as u64;
/// How far above the road a placed car starts (its body origin is on the ground at rest, P1-S03a): a short drop.
pub const SPAWN_LIFT_M: f32 = 0.1;
/// Pose search: steps back along the route (m), and lateral offsets tried at each step (m).
pub const SEARCH_STEP_M: f32 = 6.0;
pub const SEARCH_STEPS: usize = 10;
pub const SEARCH_LATERAL_M: [f32; 3] = [0.0, -3.5, 3.5];
/// Clearance margin around a car's footprint when testing overlap (m).
pub const CLEARANCE_M: f32 = 0.15;

/// The route as a polyline in metres, for poses at a distance along it.
#[derive(Clone, Debug)]
pub struct RouteLine {
    pts: Vec<(f32, f32, f32)>,
    s: Vec<f32>,
    total: f32,
}

impl RouteLine {
    pub fn new(map: &LoadedMap) -> Self {
        let pts: Vec<(f32, f32, f32)> = map
            .map
            .route
            .points
            .iter()
            .map(|p| {
                (
                    p.x as f32 / 1000.0,
                    p.y as f32 / 1000.0,
                    p.z as f32 / 1000.0,
                )
            })
            .collect();
        let n = pts.len();
        let mut s = Vec::with_capacity(n);
        let mut total = 0.0;
        for i in 0..n {
            s.push(total);
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            total += libm::hypotf(b.0 - a.0, b.2 - a.2);
        }
        Self { pts, s, total }
    }

    pub fn length_m(&self) -> f32 {
        self.total
    }

    pub fn s_of(&self, point: usize) -> f32 {
        self.s[point % self.pts.len()]
    }

    /// The pose at arc length `s` (wrapping), `lateral` metres to the (−tz, tx) side, `lift` above the road, facing
    /// along the route.
    pub fn pose_at(&self, s: f32, lateral: f32, lift: f32) -> SpawnPose {
        let n = self.pts.len();
        let s = s.rem_euclid(self.total);
        let i = self
            .s
            .partition_point(|&v| v <= s)
            .saturating_sub(1)
            .min(n - 1);
        let (a, b) = (self.pts[i], self.pts[(i + 1) % n]);
        let seg = libm::hypotf(b.0 - a.0, b.2 - a.2).max(1e-6);
        let t = ((s - self.s[i]) / seg).clamp(0.0, 1.0);
        let (tx, tz) = ((b.0 - a.0) / seg, (b.2 - a.2) / seg);
        SpawnPose {
            x: a.0 + (b.0 - a.0) * t - tz * lateral,
            y: a.1 + (b.1 - a.1) * t + lift,
            z: a.2 + (b.2 - a.2) * t + tx * lateral,
            heading: libm::atan2f(tx, tz),
        }
    }
}

/// The start grid's slots: the corridor's rows and columns, front row first.
pub fn corridor_slots(map: &LoadedMap, line: &RouteLine) -> Vec<SpawnPose> {
    let st = &map.map.route.start;
    let (len, width) = (st.length as f32 / 1000.0, st.width as f32 / 1000.0);
    let (row, col) = (
        st.row_spacing as f32 / 1000.0,
        st.column_spacing as f32 / 1000.0,
    );
    let cols = ((width / col) as usize).max(1);
    let front = line.s_of(st.at as usize);
    let mut slots = Vec::new();
    let mut d = row / 2.0;
    while d <= len {
        for c in 0..cols {
            let lateral = (c as f32 - (cols as f32 - 1.0) / 2.0) * col;
            slots.push(line.pose_at(front - d, lateral, SPAWN_LIFT_M));
        }
        d += row;
    }
    if slots.is_empty() {
        slots.push(line.pose_at(front - row / 2.0, 0.0, SPAWN_LIFT_M));
    }
    slots
}

/// The grid pose of the `k`-th car: the corridor's slots in order, then overflow layers into the same corridor, each
/// layer shifted back and sideways so no two poses coincide. Defined for every `k`: there is no cap.
pub fn grid_pose(slots: &[SpawnPose], k: usize) -> SpawnPose {
    let (layer, slot) = (k / slots.len(), slots[k % slots.len()]);
    if layer == 0 {
        return slot;
    }
    // Layer L: Roberts' R2 low-discrepancy sequence, so layers never repeat: 1–7 m behind the slot (never on it, never on
    // the next row's slot 8 m back) and up to 1.2 m to either side.
    let l = layer as f64;
    let back = 1.0 + (l * 0.754_877_666_246_692_7).fract() as f32 * 6.0;
    let side = ((l * 0.569_840_290_998_053_2).fract() as f32 - 0.5) * 2.4;
    offset(slot, back, side)
}

/// `pose` moved `back` metres behind itself and `side` metres to its (cos h, −sin h) side.
pub fn offset(pose: SpawnPose, back: f32, side: f32) -> SpawnPose {
    let (s, c) = (libm::sinf(pose.heading), libm::cosf(pose.heading));
    SpawnPose {
        x: pose.x - s * back + c * side,
        y: pose.y,
        z: pose.z - c * back - s * side,
        heading: pose.heading,
    }
}

/// A car's footprint on the ground: centre, heading, half-width, half-length.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub z: f32,
    pub heading: f32,
    pub half_w: f32,
    pub half_l: f32,
}

impl Rect {
    fn axes(&self) -> [(f32, f32); 2] {
        let (s, c) = (libm::sinf(self.heading), libm::cosf(self.heading));
        // forward (sin h, cos h); side (cos h, −sin h)
        [(s, c), (c, -s)]
    }

    fn corners(&self) -> [(f32, f32); 4] {
        let [(fx, fz), (sx, sz)] = self.axes();
        let (l, w) = (self.half_l, self.half_w);
        [(l, w), (l, -w), (-l, -w), (-l, w)]
            .map(|(a, b)| (self.x + fx * a + sx * b, self.z + fz * a + sz * b))
    }
}

/// Whether two footprints overlap (separating-axis test).
pub fn overlaps(a: &Rect, b: &Rect) -> bool {
    let (ca, cb) = (a.corners(), b.corners());
    for (ax, az) in a.axes().into_iter().chain(b.axes()) {
        let project = |cs: &[(f32, f32); 4]| {
            cs.iter()
                .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &(x, z)| {
                    let p = x * ax + z * az;
                    (lo.min(p), hi.max(p))
                })
        };
        let ((a0, a1), (b0, b1)) = (project(&ca), project(&cb));
        if a1 < b0 || b1 < a0 {
            return false;
        }
    }
    true
}

/// One progress sample of a car (for drop-in).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProgressSample {
    pub tick: u64,
    pub progress_m: f32,
}
