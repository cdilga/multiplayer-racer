//! Autopilot (P1-S07, plan §7.5, R45): a visible, deliberately weak driver for dropped-out, idle and finished cars and
//! for test bots. It hands control back cleanly when the player returns.
//!
//! - **Pure pursuit** on the map's centerline. The look-ahead is ≈ 0.8 s × speed (at least [`MIN_LOOK_AHEAD_M`]), and
//!   steering is the pursuit curvature turned into a wheel angle with the car's wheelbase. Route tracking only searches
//!   forward from the last point, so a crossing or a nearby stretch of the loop can't pull it across.
//! - **Speed** comes from the sharpest curvature ahead: `skill × √(a_lat / κ)`, clamped to the car's own ceiling (a share
//!   of its top speed, br-4tbo: the arcade cars reach ~50 m/s) and held to a jump's take-off speed on its ramp. The plan
//!   is data ([`SpeedPlan`], `assets/profiles/assist.json` `autopilot`). A cool-down lap (finished cars) goes at 0.6 of it.
//! - **Forks** (P1-FL16). A route fork's branch is a line of its own. Approaching a split, a car takes the branch when
//!   its index plus the forks it has met, plus a bit drawn from the sim seed and the fork, is odd: half of any pack
//!   takes each way, and each car alternates from one pass to the next (R29). It pursues the branch from the split and
//!   rejoins the route at the merge. A car that recovers forgets its branch.
//! - **Noise.** Small and seeded (its own RNG stream per car), drifting slowly so it reads as a driver, not jitter.
//! - **Self-recovery.** Under 1 m/s for 3 s, it presses Recover. That's a consequence of the state, so it isn't journaled.
//! - **Handback.** When the player takes over, the controls blend from the autopilot's last output to the player's
//!   input over [`HANDBACK_TICKS`], starting at a tick boundary, with no jolt. Deciding that input is fresh and
//!   deliberate is the session's job (G03), and [`is_deliberate`] is the test it uses: a heartbeat or a noisy axis
//!   doesn't reclaim the car.
//!
//! - **Derby hunting** (br-bbki.11). In a derby there's no route to follow: the bot picks a rival (the nearest one ahead
//!   of it that isn't under spawn protection, kept a while so it doesn't dither), drives at where that car will be when it
//!   gets there (its velocity times the time to close, capped), flat out to ram, and holds inside the bowl: an aim past the
//!   floor's edge is pulled back in. With nobody to hunt it circles the floor.
//! - **Never parks** (council review 2026-11-16: idle seats and Easy bots sat slow and tilted on the bowl's rim for most of
//!   a derby). An aim behind turns at full lock (the pursuit's curvature fades to nothing there); heading out across the
//!   floor it brakes for the edge; it picks rivals up the bank or against the rock last. Up the bank it heads back down
//!   to the floor. Stalled for a moment it turns away (reversing down the bank), leaves that pile-up alone a while and
//!   hunts another; when that doesn't free it, it presses Recover. The numbers are `assist.json` `bots.derby`; all of it
//!   reads the sim state only, so it isn't journaled and replays bit for bit.
//!
//! - **Traffic** (council review 2026-11-15: bots followed one line in grid order, so a faster car sat behind a slower
//!   one for the whole race). A car closing on one ahead in its lane takes a passing lane beside it, on the side nearer
//!   its own and inside the road's edge, moving sideways at a lane change's rate; it holds the lane a moment after the
//!   pass and eases back to the line. The pursuit aims at the line moved sideways by the lane. A car alone never leaves
//!   the line, so a solo lap is unchanged.
//! - **Items** (same review: bots never used one). [`Autopilot::item_use`] decides on the front item from what the car
//!   can see: a boomerang at a car ahead in its aim cone (or behind), an esky for a car close behind, a sanga or tinnie on
//!   a straight, after a reaction time, and anything held too long anyway. The numbers are `assist.json` `bots`.
//!   Like Recover it reads only the sim's state, so it isn't journaled and replays bit for bit.
//!
//! Everything it decides is in [`AutopilotState`] for introspection (target point, look-ahead, target speed, stuck
//! time).

use jj_map::LoadedMap;
use jj_types::axis::{dequantise_axis, quantise_axis};
use serde::{Deserialize, Serialize};

use crate::assist::{BotItemTuning, BotTuning, DerbyBotTuning};
use crate::journal::DriveInput;
use crate::rng::Rng;
use crate::sim::TICK_HZ;
use crate::utility::UtilityKind;
use jj_types::items::ItemId;

const SECOND: u64 = TICK_HZ as u64;
pub const LOOK_AHEAD_S: f32 = 0.8;
pub const MIN_LOOK_AHEAD_M: f32 = 6.0;
pub const COOL_DOWN: f32 = 0.6;
pub const STUCK_SPEED: f32 = 1.0;
pub const STUCK_TICKS: u64 = 3 * SECOND;
pub const HANDBACK_TICKS: u64 = SECOND / 4;
/// How far the steering noise wanders, and how often it picks a new target.
pub const NOISE_STEER: f32 = 0.04;
pub const NOISE_EVERY_TICKS: u64 = SECOND / 4;
/// An axis has to move this much (of full scale) between two inputs to count as deliberate.
pub const DELIBERATE_AXIS: f32 = 0.25;

/// How fast the autopilot plans to go (br-4tbo): one car's, from the assist data and its profile's top speed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpeedPlan {
    /// Lateral grip the plan assumes (m/s²), before the skill factor.
    pub lateral_grip: f32,
    pub skill: f32,
    /// Braking the plan assumes when it looks ahead for a corner (m/s²).
    pub plan_brake: f32,
    pub min_speed: f32,
    /// The car's ceiling (m/s).
    pub max_speed: f32,
    /// On a jump's ramp the plan holds to this (m/s): generated jumps are built for a take-off speed.
    pub takeoff_mps: f32,
    /// The car's catch-up drive scale (1 when it isn't trailing): a trailing bot aims that much faster, so catch-up helps
    /// it at its planned speed too, not only while it accelerates.
    pub scale: f32,
}

/// What a route point asks of the plan: nothing, a jump's take-off speed, or a gap leap's own speed (the top of the
/// window it is built for).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RampCap {
    None,
    Jump,
    Leap(f32),
}

impl SpeedPlan {
    /// The speed this plan allows at a point of curvature `k` (1/m), on a jump's ramp or not.
    pub fn cap(&self, k: f32, ramp: RampCap) -> f32 {
        let mut v = if k > 1e-4 {
            self.skill * libm::sqrtf(self.lateral_grip / k)
        } else {
            self.max_speed
        };
        match ramp {
            RampCap::None => {}
            RampCap::Jump => v = v.min(self.takeoff_mps),
            RampCap::Leap(mps) => v = v.min(mps),
        }
        v.clamp(self.min_speed, self.max_speed)
    }
}

/// The centerline as the autopilot sees it: points (m), arc lengths and curvature at each point (1/m).
#[derive(Clone, Debug)]
pub struct Path {
    pts: Vec<(f32, f32)>,
    heights: Vec<f32>,
    /// Half the road's drivable width at each route point, m (how far a passing lane may go).
    half_width: Vec<f32>,
    layered: bool,
    s: Vec<f32>,
    curvature: Vec<f32>,
    total: f32,
    branches: Vec<Branch>,
    /// Route points on a jump's or a gap leap's run-up and ramp, where the plan holds to its take-off speed.
    takeoff: Vec<RampCap>,
}

/// A route fork's branch (jj-map `fork::path`): it leaves the route at point `from` and rejoins it at `to`.
#[derive(Clone, Debug)]
struct Branch {
    from: usize,
    to: usize,
    pts: Vec<(f32, f32)>,
    curvature: Vec<f32>,
}

/// The circle through each point and its neighbours two away: curvature (1/m), as the route's (clamped at an open line's ends).
fn curvatures(pts: &[(f32, f32)], closed: bool) -> Vec<f32> {
    let n = pts.len();
    let at = |i: isize| {
        if closed {
            pts[i.rem_euclid(n as isize) as usize]
        } else {
            pts[i.clamp(0, n as isize - 1) as usize]
        }
    };
    (0..n as isize)
        .map(|i| {
            let (a, b, c) = (at(i - 2), at(i), at(i + 2));
            let (ab, bc, ca) = (
                libm::hypotf(b.0 - a.0, b.1 - a.1),
                libm::hypotf(c.0 - b.0, c.1 - b.1),
                libm::hypotf(a.0 - c.0, a.1 - c.1),
            );
            let cross = ((b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)).abs();
            let d = ab * bc * ca;
            if d > 1e-6 { 2.0 * cross / d } else { 0.0 }
        })
        .collect()
}

/// Where a walk along the autopilot's line is: on the route at a point, or on a branch at one of its points.
#[derive(Clone, Copy, Debug)]
enum Cursor {
    Route(usize),
    Branch(usize, usize),
}

impl Path {
    /// The road's grade (rise over run) from `metres` to `metres + 10` ahead of route point `i`: what the autopilot pitches
    /// to in the air, so it comes down on the landing aligned (R129).
    pub fn grade_ahead(&self, i: usize, metres: f32) -> f32 {
        let n = self.pts.len();
        let i = i % n;
        let at = |m: f32| {
            let mut j = i;
            while self.ahead(i, j) < m && self.ahead(i, (j + 1) % n) > self.ahead(i, j) {
                j = (j + 1) % n;
            }
            j
        };
        let (a, b) = (at(metres), at(metres + 10.0));
        let run = self.ahead(a, b).max(1e-3);
        (self.heights[b] - self.heights[a]) / run
    }

    pub fn new(map: &LoadedMap) -> Self {
        let pts: Vec<(f32, f32)> = map
            .map
            .route
            .points
            .iter()
            .map(|p| (p.x as f32 / 1000.0, p.z as f32 / 1000.0))
            .collect();
        let n = pts.len();
        let mut s = Vec::with_capacity(n);
        let mut total = 0.0;
        for i in 0..n {
            s.push(total);
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            total += libm::hypotf(b.0 - a.0, b.1 - a.1);
        }
        // Curvature from the circle through each point and its neighbours two away (smooths the 2.5 m resampling).
        let curvature = curvatures(&pts, true);
        let branches = map
            .map
            .features
            .iter()
            .filter_map(|f| {
                let d = jj_map::fork::Fork::of(f)?;
                let pts: Vec<(f32, f32)> = jj_map::fork::path_of(&map.map, &d)
                    .iter()
                    .map(|p| (p[0] as f32, p[1] as f32))
                    .collect();
                (pts.len() >= 3).then(|| Branch {
                    from: d.from as usize,
                    to: d.to as usize,
                    curvature: curvatures(&pts, false),
                    pts,
                })
            })
            .collect();
        Self {
            pts,
            heights: map
                .map
                .route
                .points
                .iter()
                .map(|p| p.y as f32 / 1000.0)
                .collect(),
            half_width: map
                .map
                .route
                .points
                .iter()
                .map(|p| p.width as f32 / 2000.0)
                .collect(),
            // A bridge or an overpass leap: two roads at one place, told apart by height.
            layered: !jj_map::bridge::layered_points(&map.map).is_empty(),
            s,
            curvature,
            total,
            branches,
            takeoff: takeoff_points(map, n),
        }
    }

    /// What the point under a cursor asks of the plan (branches carry no jumps).
    fn takeoff_at(&self, c: Cursor) -> RampCap {
        match c {
            Cursor::Route(i) => self.takeoff[i],
            Cursor::Branch(..) => RampCap::None,
        }
    }

    /// The point and curvature under a cursor.
    fn at(&self, c: Cursor) -> ((f32, f32), f32) {
        match c {
            Cursor::Route(i) => (self.pts[i], self.curvature[i]),
            Cursor::Branch(b, j) => (self.branches[b].pts[j], self.branches[b].curvature[j]),
        }
    }

    /// One point on along the line a car drives: a route that meets the split of the branch it `takes` turns onto it,
    /// and a branch's last point leads back onto the route at its merge.
    fn next(&self, c: Cursor, takes: Option<usize>) -> Cursor {
        match c {
            Cursor::Route(i) => match takes {
                Some(b) if self.branches[b].from == i => Cursor::Branch(b, 1),
                _ => Cursor::Route((i + 1) % self.n()),
            },
            Cursor::Branch(b, j) if j + 1 < self.branches[b].pts.len() => Cursor::Branch(b, j + 1),
            Cursor::Branch(b, _) => Cursor::Route((self.branches[b].to + 1) % self.n()),
        }
    }

    /// The nearest point of branch `b` at or ahead of point `from` within the next `window` points.
    fn track_branch(&self, b: usize, from: usize, x: f32, z: f32, window: usize) -> usize {
        let pts = &self.branches[b].pts;
        (from..=(from + window).min(pts.len() - 1))
            .min_by(|&a, &c| {
                let da = libm::hypotf(pts[a].0 - x, pts[a].1 - z);
                let dc = libm::hypotf(pts[c].0 - x, pts[c].1 - z);
                da.total_cmp(&dc)
            })
            .unwrap_or(from)
    }

    fn n(&self) -> usize {
        self.pts.len()
    }

    /// The nearest point to (x, z) over the whole route (only when the autopilot first takes over).
    fn nearest(&self, x: f32, y: f32, z: f32) -> usize {
        (0..self.n())
            .min_by(|&a, &b| {
                let da = libm::hypotf(self.pts[a].0 - x, self.pts[a].1 - z);
                let db = libm::hypotf(self.pts[b].0 - x, self.pts[b].1 - z);
                let vertical = |i: usize| {
                    if self.layered {
                        (self.heights[i] - y).powi(2)
                    } else {
                        0.0
                    }
                };
                (da * da + vertical(a)).total_cmp(&(db * db + vertical(b)))
            })
            .unwrap_or(0)
    }

    /// The nearest point at or ahead of `from` within the next `window` points.
    fn track(&self, from: usize, x: f32, z: f32, window: usize) -> usize {
        (0..=window)
            .map(|k| (from + k) % self.n())
            .min_by(|&a, &b| {
                let da = libm::hypotf(self.pts[a].0 - x, self.pts[a].1 - z);
                let db = libm::hypotf(self.pts[b].0 - x, self.pts[b].1 - z);
                da.total_cmp(&db)
            })
            .unwrap_or(from)
    }

    /// Arc length from point `a` forward to point `b`.
    fn ahead(&self, a: usize, b: usize) -> f32 {
        (self.s[b] - self.s[a]).rem_euclid(self.total)
    }

    /// The speed the autopilot plans at (x, z) from a standing start: the tightest curvature within its braking horizon
    /// at full speed sets it, as `drive` does (R125's rolling respawn starts from a fraction of it).
    pub fn planned_speed(&self, x: f32, y: f32, z: f32, plan: &SpeedPlan) -> f32 {
        let n = self.n();
        let idx = self.nearest(x, y, z);
        let horizon = plan.max_speed * plan.max_speed / (2.0 * plan.plan_brake);
        let (mut v, mut p) = (plan.max_speed, idx);
        while self.ahead(idx, p) <= horizon {
            v = v.min(plan.cap(self.curvature[p], self.takeoff[p]));
            p = (p + 1) % n;
            if p == idx {
                break;
            }
        }
        v.clamp(plan.min_speed, plan.max_speed)
    }
}

/// What a steering assist reads off the route for one car (R125, `crate::assist`): the route point nearest the car, the
/// steer (−1..1 of full lock, positive left, the sim's sign) that pure pursuit would use to rejoin the line, and the
/// tightest curvature within braking distance.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineProbe {
    pub idx: usize,
    pub steer: f32,
    pub max_curvature: f32,
}

impl Path {
    /// Pure pursuit on the centerline for an assist: the same geometry as [`Autopilot::drive`], without noise or state. The
    /// `look` is `[look-ahead s, minimum look-ahead m, planned braking m/s²]`. The `hint` is the last route point (searched forward only; a car that has jumped, or a hint that is no longer near,
    /// searches the whole route).
    pub fn probe(
        &self,
        hint: Option<usize>,
        car: Pose2,
        max_steer: f32,
        wheelbase: f32,
        look: [f32; 3],
    ) -> LineProbe {
        let [look_s, min_look_m, plan_brake] = look;
        let n = self.n();
        let mut idx = match hint {
            Some(i) => self.track(i, car.x, car.z, 24),
            None => self.nearest(car.x, car.y, car.z),
        };
        let off = |i: usize| libm::hypotf(self.pts[i].0 - car.x, self.pts[i].1 - car.z);
        if hint.is_some() && off(idx) > 15.0 {
            idx = self.nearest(car.x, car.y, car.z);
        }
        let speed = car.forward_speed.max(0.0);
        let look = (look_s * speed).max(min_look_m);
        let mut t = idx;
        while self.ahead(idx, t) < look && self.ahead(idx, (t + 1) % n) > self.ahead(idx, t) {
            t = (t + 1) % n;
        }
        let target = self.pts[t];
        let (sh, ch) = (libm::sinf(car.heading), libm::cosf(car.heading));
        let (dx, dz) = (target.0 - car.x, target.1 - car.z);
        let (local_left, local_fwd) = (dx * ch - dz * sh, dx * sh + dz * ch);
        let alpha = libm::atan2f(local_left, local_fwd);
        let wheel = libm::atanf(2.0 * libm::sinf(alpha) / look * wheelbase);
        let horizon = speed * speed / (2.0 * plan_brake) + look;
        let (mut max_curvature, mut p) = (0.0f32, idx);
        while self.ahead(idx, p) <= horizon {
            max_curvature = max_curvature.max(self.curvature[p]);
            p = (p + 1) % n;
            if p == idx {
                break;
            }
        }
        LineProbe {
            idx,
            steer: (wheel / max_steer).clamp(-1.0, 1.0),
            max_curvature,
        }
    }
}

/// What the car looks like to the autopilot.
#[derive(Clone, Copy, Debug)]
pub struct Pose2 {
    pub x: f32,
    /// Height disambiguates overlapping roads when acquiring the route.
    pub y: f32,
    pub z: f32,
    /// Radians about +y, 0 = +z.
    pub heading: f32,
    /// Speed along the car's forward axis, m/s.
    pub forward_speed: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Driving for a dropped-out, idle or bot seat.
    Driving,
    /// A finished car's cool-down laps.
    CoolDown,
    /// Handing back: blending to the player's input.
    Handback,
}

/// Everything the autopilot decided this tick (introspection).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotState {
    pub mode: Mode,
    pub route_point: u32,
    pub target: [f32; 2],
    pub look_ahead_m: f32,
    pub target_speed: f32,
    pub stuck_ticks: u64,
    pub steer: f32,
    pub throttle: f32,
    pub brake: f32,
    /// The lane it drives, m to the left of the line (negative right): 0 unless it is passing.
    #[serde(default)]
    pub lane_m: f32,
}

/// Another car as an autopilot sees it: a rival a derby bot can hunt (br-bbki.11), or traffic to pass and aim items at.
/// Where it is and how it's moving, and whether hitting it scores (spawn protection).
#[derive(Clone, Copy, Debug)]
pub struct Rival {
    pub car: u32,
    pub x: f32,
    pub z: f32,
    pub vx: f32,
    pub vz: f32,
    pub protected: bool,
}

/// The derby bowl a bot hunts in: its centre and floor radius (m), and the solid rocks on its floor.
#[derive(Clone, Copy, Debug)]
pub struct Arena {
    pub x: f32,
    pub z: f32,
    pub floor_r: f32,
    /// The floor's height, m.
    pub floor_y: f32,
    /// The arena's island or spine (P1-M-arena-features), which a bot steers round instead of grinding into it.
    pub obstacle: Option<Obstacle>,
}

/// Solid rock on a derby floor, as a capsule: the segment `a`..`b` grown by `r` (one rock is a circle, a = b), m.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Obstacle {
    pub a: [f32; 2],
    pub b: [f32; 2],
    pub r: f32,
}

/// A bot's line passes the island at least this far off its rock, m (a car's half-width and some).
const ISLAND_CLEAR_M: f32 = 2.5;
/// The last metres before the aim aren't checked against the island: a rival pinned against the rock is still rammed.
const ISLAND_PREY_M: f32 = 3.0;
/// Samples along a bot's line when checking it against the island.
const ISLAND_SAMPLES: usize = 16;

/// The crossover (br-bhkz.4): an island of two rocks with at least this much clear between them is a gate, and the
/// arena's crossover runs through it, across the island: a launch ramp each side of a deck between the rocks
/// (`jj_procgen::arena::field`; the arena validator holds the gate open).
pub const GATE_MIN_M: f32 = 5.0;
/// The crossover's ramps end within this of the gate's middle, each side, m.
pub const GATE_RUN_M: f32 = 10.0;
/// A bot whose prey is across the island takes the crossover when it is within the gate's own width of its line, or
/// within this share of its distance from the ramp's foot (a cone of 24 degrees a side: it has room to line up).
const GATE_CONE: f32 = 0.45;
/// On the crossover a bot follows its line, aiming this far along it, m.
const GATE_LOOK_M: f32 = 8.0;

/// The gate through an island of two rocks: its middle, the unit vector across the island (the crossover's line) and
/// half the clear width between the rocks, m.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Gate {
    pub mid: [f32; 2],
    pub axis: [f32; 2],
    pub half: f32,
}

impl Gate {
    /// (x, z) in the gate's frame: m along the crossover's line from the gate's middle, and m across it.
    fn local(&self, x: f32, z: f32) -> (f32, f32) {
        let (dx, dz) = (x - self.mid[0], z - self.mid[1]);
        (
            dx * self.axis[0] + dz * self.axis[1],
            -dx * self.axis[1] + dz * self.axis[0],
        )
    }

    /// The aim for a car taking the crossover, if it is: a point on the crossover's line [`GATE_LOOK_M`] ahead of it.
    /// It takes it when it is on it and facing along it (it carries on over, whatever its prey does), or when its prey
    /// is across the island, its straight line there is `blocked` by the island, and it is in the cone before a ramp
    /// facing the gate. Everything else goes round ([`Obstacle::detour`]).
    pub fn through(&self, me: Pose2, ax: f32, az: f32, blocked: bool) -> Option<(f32, f32)> {
        let (s, l) = self.local(me.x, me.z);
        let (aim_s, _) = self.local(ax, az);
        // How much of the car's heading runs along the crossover's line (1 = straight along it, towards +axis).
        let along = libm::sinf(me.heading) * self.axis[0] + libm::cosf(me.heading) * self.axis[1];
        let on = s.abs() <= GATE_RUN_M && l.abs() <= self.half + 1.0;
        let way = if on && along.abs() > core::f32::consts::FRAC_1_SQRT_2 {
            along.signum()
        } else if blocked
            && s.abs() > GATE_RUN_M
            && s * aim_s < 0.0
            && l.abs() <= (self.half - 1.0).max(GATE_CONE * (s.abs() - GATE_RUN_M))
            && -s.signum() * along > 0.5
        {
            -s.signum()
        } else {
            return None;
        };
        let to = s + way * GATE_LOOK_M;
        Some((
            self.mid[0] + self.axis[0] * to,
            self.mid[1] + self.axis[1] * to,
        ))
    }
}

impl Obstacle {
    /// The gate between the island's two rocks, when there is one: the rocks' centres (the capsule's ends) stand at
    /// least [`GATE_MIN_M`] apart beyond their own radii.
    pub fn gate(&self) -> Option<Gate> {
        let (dx, dz) = (self.b[0] - self.a[0], self.b[1] - self.a[1]);
        let len = libm::hypotf(dx, dz);
        let clear = len - 2.0 * self.r;
        (clear >= GATE_MIN_M).then(|| Gate {
            mid: [(self.a[0] + self.b[0]) / 2.0, (self.a[1] + self.b[1]) / 2.0],
            axis: [-dz / len, dx / len],
            half: clear / 2.0,
        })
    }

    /// The point of the capsule's axis nearest (x, z), and how far that is.
    fn nearest(&self, x: f32, z: f32) -> ([f32; 2], f32) {
        let (dx, dz) = (self.b[0] - self.a[0], self.b[1] - self.a[1]);
        let len2 = dx * dx + dz * dz;
        let t = if len2 > 0.0 {
            (((x - self.a[0]) * dx + (z - self.a[1]) * dz) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let c = [self.a[0] + dx * t, self.a[1] + dz * t];
        (c, libm::hypotf(x - c[0], z - c[1]))
    }

    /// The aim for a car at (x, z) heading for (ax, az): unchanged when the line clears the rock, else a point beside
    /// the rock on the side the line already passes (the tangent way round), so the bot drives round it.
    pub fn detour(&self, x: f32, z: f32, ax: f32, az: f32) -> (f32, f32) {
        let (lx, lz) = (ax - x, az - z);
        let len = libm::hypotf(lx, lz);
        if len < 1e-3 {
            return (ax, az);
        }
        let span = (len - ISLAND_PREY_M).max(0.0);
        let clear = self.r + ISLAND_CLEAR_M;
        let mut worst: Option<([f32; 2], f32)> = None;
        for k in 0..=ISLAND_SAMPLES {
            let s = span * k as f32 / ISLAND_SAMPLES as f32;
            let (c, d) = self.nearest(x + lx / len * s, z + lz / len * s);
            if d < clear && worst.is_none_or(|w| d < w.1) {
                worst = Some((c, d));
            }
        }
        let Some((c, _)) = worst else {
            return (ax, az);
        };
        // The line's left normal; go round on the side of the line away from the rock's axis.
        let (nx, nz) = (-lz / len, lx / len);
        let side = (c[0] - x) * nx + (c[1] - z) * nz;
        let s = if side > 0.0 { -1.0 } else { 1.0 };
        (c[0] + nx * s * (clear + 1.0), c[1] + nz * s * (clear + 1.0))
    }
}

/// A hunter keeps its prey at least this long (ticks) before it looks again, unless the prey is protected or gone.
const HUNT_KEEP_TICKS: u64 = 2 * SECOND;
/// The lead on a rival is at most this far ahead in time (s).
const HUNT_LEAD_S: f32 = 1.2;

/// One car's autopilot.
#[derive(Clone, Debug)]
pub struct Autopilot {
    mode: Mode,
    idx: Option<usize>,
    noise: Rng,
    noise_now: f32,
    noise_target: f32,
    stuck: u64,
    last_out: DriveInput,
    handback_at: u64,
    state: Option<AutopilotState>,
    /// The fork this car is on (branch index, point), the fork it has decided about ahead and whether it takes it, and
    /// how many forks it has decided about (so each lap's choice is its own).
    on: Option<(usize, usize)>,
    plan: Option<(usize, bool)>,
    forks_met: u32,
    car: u32,
    choice_seed: u64,
    /// The derby rival it's hunting and when it chose it (br-bbki.11).
    prey: Option<(u32, u64)>,
    /// Traffic: the lane it drives and the one it moves to (m left of the line), and the tick it holds a passing lane to.
    lane: f32,
    lane_target: f32,
    lane_until: u64,
    /// The front item it holds and since when (its use waits a reaction).
    holding: Option<(ItemId, u64)>,
    /// Whether the plan sees a straight ahead this tick: `drive`/`hunt` set it, [`Autopilot::item_use`] reads it after.
    straight: bool,
    /// Derby: how long it has been stalled (ticks), the tick its back-off ends and what it backs away from (x, z), and
    /// the place (x, z) whose cars it leaves alone until a tick (council review 2026-11-16).
    stall: u64,
    back_until: u64,
    back_from: [f32; 2],
    shun: Option<([f32; 2], u64)>,
    /// Derby: coming down off the bank to the floor, and the back-offs since it last got clear of where it stalled.
    descending: bool,
    tries: u32,
    stalled_at: [f32; 2],
    /// Whether this back-off reverses (down the bank) or pivots away under throttle (on the floor).
    reversing: bool,
}

/// Seconds as whole ticks.
fn ticks(s: f32) -> u64 {
    (s * TICK_HZ as f32) as u64
}

/// Another car in this car's frame: (m to its left, m ahead).
fn local_of(me: Pose2, x: f32, z: f32) -> (f32, f32) {
    let (sh, ch) = (libm::sinf(me.heading), libm::cosf(me.heading));
    let (dx, dz) = (x - me.x, z - me.z);
    (dx * ch - dz * sh, dx * sh + dz * ch)
}

/// A split this close ahead (m) is decided about.
const DECIDE_M: f32 = 80.0;
/// A car this far past a split it didn't take forgets the decision.
const PASSED_M: f32 = 20.0;

/// splitmix64: the bit that offsets every car's branch choices at one fork, from the sim seed.
fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

impl Autopilot {
    pub fn new(seed: u64, car: u32, mode: Mode) -> Self {
        Self {
            mode,
            idx: None,
            noise: Rng::stream(seed ^ (u64::from(car) << 32), "autopilot"),
            noise_now: 0.0,
            noise_target: 0.0,
            stuck: 0,
            last_out: DriveInput::default(),
            handback_at: 0,
            state: None,
            on: None,
            plan: None,
            forks_met: 0,
            car,
            choice_seed: mix(seed ^ 0xF04C),
            prey: None,
            lane: 0.0,
            lane_target: 0.0,
            lane_until: 0,
            holding: None,
            straight: false,
            stall: 0,
            back_until: 0,
            back_from: [0.0; 2],
            shun: None,
            descending: false,
            tries: 0,
            stalled_at: [0.0; 2],
            reversing: false,
        }
    }

    /// The controls for a derby (br-bbki.11): hunt a rival in the bowl, flat out, and whether it wants to Recover.
    #[allow(clippy::too_many_arguments)]
    pub fn hunt(
        &mut self,
        me: Pose2,
        rivals: &[Rival],
        arena: Arena,
        max_steer: f32,
        wheelbase: f32,
        tick: u64,
        tuning: &DerbyBotTuning,
    ) -> (DriveInput, bool) {
        let (sh, ch) = (libm::sinf(me.heading), libm::cosf(me.heading));
        let local = |x: f32, z: f32| {
            let (dx, dz) = (x - me.x, z - me.z);
            (dx * ch - dz * sh, dx * sh + dz * ch)
        };
        let up_bank = |x: f32, z: f32| libm::hypotf(x - arena.x, z - arena.z) > arena.floor_r;
        if tick < self.back_until {
            return self.back_off(me, arena, max_steer, wheelbase, tick);
        }
        // Up the bank (council review 2026-11-16: bots crept along the rim, tilted, for most of a derby): it heads for
        // the floor's centre until it is well inside the floor's edge (no dithering on the edge), and when it faces up
        // the bank without the speed to turn down it backs down first.
        let (rx, rz) = (me.x - arena.x, me.z - arena.z);
        let r = libm::hypotf(rx, rz).max(1e-3);
        let outward = [me.x + rx / r * 10.0, me.z + rz / r * 10.0];
        if r > arena.floor_r + tuning.rim_m {
            self.descending = true;
        } else if r < arena.floor_r - tuning.rim_m {
            self.descending = false;
        }
        if self.descending {
            let (cl, cf) = local(arena.x, arena.z);
            if libm::atan2f(cl, cf).abs() > core::f32::consts::FRAC_PI_2
                && me.forward_speed < tuning.stall_mps
            {
                self.back_from = outward;
                self.back_until = tick + ticks(tuning.back_s).max(1);
                self.reversing = true;
                self.stall = 0;
                return self.back_off(me, arena, max_steer, wheelbase, tick);
            }
        }
        // Not the pile-up it just backed out of (a pinned rival, or two wedged on the rock).
        let shun = self
            .shun
            .filter(|&(_, until)| tick < until)
            .map(|(at, _)| at);
        let shunned = |r: &Rival| {
            shun.is_some_and(|at| libm::hypotf(r.x - at[0], r.z - at[1]) < tuning.shun_m)
        };
        let hunted = |r: &&Rival| r.car != self.car && !r.protected && !shunned(r);
        // Keep the prey a while; look again when it's protected, gone, or the time is up.
        let keep = self.prey.and_then(|(car, since)| {
            (tick < since + HUNT_KEEP_TICKS)
                .then(|| rivals.iter().find(|r| r.car == car && !r.protected))
                .flatten()
        });
        let prey = keep.or_else(|| {
            // The nearest rival, counting one behind as farther (a bot charges what it's facing) and one up the bank or
            // against the rock as farther still (council review 2026-11-16: a ram there pinned both cars).
            let pick = rivals.iter().filter(hunted).min_by(|a, b| {
                let cost = |r: &Rival| {
                    let (l, f) = local(r.x, r.z);
                    let on_rock = arena.obstacle.is_some_and(|o| {
                        o.nearest(r.x, r.z).1 < o.r + ISLAND_CLEAR_M + ISLAND_PREY_M
                    });
                    let pinned = if up_bank(r.x, r.z) || on_rock {
                        tuning.rim_penalty_m
                    } else {
                        0.0
                    };
                    libm::hypotf(l, f) + 12.0 * libm::atan2f(l, f).abs() + pinned
                };
                cost(a).total_cmp(&cost(b))
            });
            self.prey = pick.map(|r| (r.car, tick));
            pick
        });
        let speed = me.forward_speed.max(0.0);
        // Aim: the floor's centre coming down off the bank; where the prey will be when this car gets there; else round
        // the floor ahead.
        let (mut ax, mut az) = match prey {
            _ if self.descending => (arena.x, arena.z),
            Some(r) => {
                let d = libm::hypotf(r.x - me.x, r.z - me.z);
                let t = (d / speed.max(8.0)).min(HUNT_LEAD_S);
                (r.x + r.vx * t, r.z + r.vz * t)
            }
            None => {
                let (rx, rz) = (me.x - arena.x, me.z - arena.z);
                let r = libm::hypotf(rx, rz).max(1.0);
                let ring = arena.floor_r * 0.6;
                // A point a quarter turn on round a ring inside the floor.
                (
                    arena.x + (rx / r * 0.4 - rz / r) * ring,
                    arena.z + (rz / r * 0.4 + rx / r) * ring,
                )
            }
        };
        // Held inside the bowl: an aim past the floor's edge comes back in.
        let (ox, oz) = (ax - arena.x, az - arena.z);
        let out_r = libm::hypotf(ox, oz);
        let keep_in = arena.floor_r * 0.85;
        if out_r > keep_in {
            (ax, az) = (
                arena.x + ox / out_r * keep_in,
                arena.z + oz / out_r * keep_in,
            );
        }
        // Round the island, not into it; or over the crossover through its gate, when that is the way to the prey
        // (br-bhkz.4: the bots' lines skirted every jump).
        if let Some(o) = arena.obstacle {
            let round = o.detour(me.x, me.z, ax, az);
            (ax, az) = o
                .gate()
                .and_then(|g| g.through(me, ax, az, round != (ax, az)))
                .unwrap_or(round);
        }
        let (l, f) = local(ax, az);
        let dist = libm::hypotf(l, f).max(1.0);
        let alpha = libm::atan2f(l, f);
        // The pursuit's curvature, 2 sin α / d, fades to nothing as the aim swings behind: an aim behind turns at full
        // lock (council review 2026-11-16: a bot whose prey was behind it drove on, up the bank, barely turning).
        let behind = alpha.abs() > core::f32::consts::FRAC_PI_2;
        let curvature = 2.0 * libm::sinf(alpha) / dist.max(MIN_LOOK_AHEAD_M);
        let wheel = libm::atanf(curvature * wheelbase);
        if tick.is_multiple_of(NOISE_EVERY_TICKS) {
            self.noise_target = (self.noise.next_f32() * 2.0 - 1.0) * NOISE_STEER;
        }
        self.noise_now += (self.noise_target - self.noise_now) * 0.05;
        let steer = if behind {
            alpha.signum()
        } else {
            (wheel / max_steer + self.noise_now).clamp(-1.0, 1.0)
        };
        // Flat out at the prey, but on the floor no faster than stops on its edge from where it's heading out, at
        // `edgeBrakeMps2` (never slower than `minMps`: flat-out charges ran up the bank, council review 2026-11-16).
        // Coming down off the bank, until it faces down it goes no faster than twice `minMps`: faster, a quick car
        // orbited the bowl on the bank instead of turning down.
        let cap = if self.descending {
            if alpha.abs() < core::f32::consts::FRAC_PI_4 {
                f32::MAX
            } else {
                2.0 * tuning.min_mps
            }
        } else {
            let out_dot = rx * sh + rz * ch;
            let edge_m = -out_dot
                + libm::sqrtf(
                    (out_dot * out_dot - (r * r - arena.floor_r * arena.floor_r)).max(0.0),
                );
            libm::sqrtf(2.0 * tuning.edge_brake_mps2 * edge_m.max(0.0)).max(tuning.min_mps)
        };
        let (throttle, brake) = if speed > cap + 2.0 {
            (0.0, 1.0)
        } else if speed > cap {
            (0.0, 0.0)
        } else if alpha.abs() > 2.0 && speed > 8.0 {
            // Lifting to turn when the aim is well behind at speed.
            (0.3, 0.0)
        } else {
            (1.0, 0.0)
        };
        // A bowl has no straights: a self-use boost goes on a charge at prey dead ahead.
        self.straight = prey.is_some() && alpha.abs() < 0.3;
        self.stuck = if me.forward_speed.abs() < STUCK_SPEED {
            self.stuck + 1
        } else {
            0
        };
        let mut recover = self.stuck >= STUCK_TICKS;
        // Never parks (council review 2026-11-16): a bot that has made no way for a moment (pinning a rival against the
        // bank, grinding up it, nosed into the rock) backs off, away from it and towards the floor, then hunts another.
        // When backing off hasn't freed it `backTries` times running (beached on debris, a wheel gone), it recovers.
        self.stall = if me.forward_speed.abs() < tuning.stall_mps {
            self.stall + 1
        } else {
            0
        };
        // Got away: well clear of where it last stalled.
        if libm::hypotf(me.x - self.stalled_at[0], me.z - self.stalled_at[1]) > tuning.shun_m {
            self.tries = 0;
        }
        if !recover && self.stall >= ticks(tuning.stall_s) && self.tries >= tuning.back_tries {
            recover = true;
        } else if !recover && self.stall >= ticks(tuning.stall_s) {
            self.stall = 0;
            self.tries += 1;
            self.stalled_at = [me.x, me.z];
            self.back_until = tick + ticks(tuning.back_s).max(1);
            // What stopped it is what it's driving into: whatever is ahead of it.
            self.back_from = [me.x + sh * 10.0, me.z + ch * 10.0];
            self.reversing = false;
            let at = prey.map_or([me.x, me.z], |p| [p.x, p.z]);
            self.shun = Some((at, tick + ticks(tuning.shun_s)));
            self.prey = None;
        }
        if recover {
            self.stuck = 0;
            self.stall = 0;
            self.prey = None;
        }
        let out = DriveInput {
            throttle: quantise_axis(throttle),
            steer: quantise_axis(steer),
            brake: quantise_axis(brake),
            ..DriveInput::default()
        };
        self.last_out = out;
        self.state = Some(AutopilotState {
            mode: self.mode,
            route_point: prey.map_or(u32::MAX, |r| r.car),
            target: [ax, az],
            look_ahead_m: dist,
            target_speed: f32::MAX,
            stuck_ticks: self.stuck,
            steer,
            throttle,
            brake,
            lane_m: 0.0,
        });
        (out, recover)
    }

    /// A stalled derby bot getting away (council review 2026-11-16). With what stopped it ahead: on the floor it turns
    /// away at full lock under throttle (at a crawl the arcade car pivots round, `pivotMps`, and drives off: much quicker
    /// than reversing); facing up the bank it reverses down with the wheel over. Either way the nose swings away, to the
    /// floor's centre when it's dead ahead. With it behind, it drives for the centre. Still presses Recover when even
    /// that makes no way.
    fn back_off(
        &mut self,
        me: Pose2,
        arena: Arena,
        max_steer: f32,
        wheelbase: f32,
        tick: u64,
    ) -> (DriveInput, bool) {
        let (bl, bf) = local_of(me, self.back_from[0], self.back_from[1]);
        let away = libm::atan2f(bl, bf);
        let (cl, cf) = local_of(me, arena.x, arena.z);
        let centre = libm::atan2f(cl, cf);
        // Which way the nose should swing: away from it, or to the centre when it's dead ahead.
        let swing = if away.abs() < 0.2 {
            centre.signum()
        } else {
            -away.signum()
        };
        let (steer, throttle, brake) = if away.abs() < core::f32::consts::FRAC_PI_2 {
            if self.reversing {
                // Reversing, the wheel turned the other way swings the nose.
                (-swing, 0.0, 1.0)
            } else {
                (swing, 1.0, 0.0)
            }
        } else if centre.abs() > core::f32::consts::FRAC_PI_2 {
            (centre.signum(), 1.0, 0.0)
        } else {
            let dist = libm::hypotf(cl, cf).max(MIN_LOOK_AHEAD_M);
            let wheel = libm::atanf(2.0 * libm::sinf(centre) / dist * wheelbase);
            ((wheel / max_steer).clamp(-1.0, 1.0), 1.0, 0.0)
        };
        self.straight = false;
        self.stuck = if me.forward_speed.abs() < STUCK_SPEED {
            self.stuck + 1
        } else {
            0
        };
        let recover = self.stuck >= STUCK_TICKS;
        if recover {
            self.stuck = 0;
            self.back_until = tick;
        }
        let out = DriveInput {
            throttle: quantise_axis(throttle),
            steer: quantise_axis(steer),
            brake: quantise_axis(brake),
            ..DriveInput::default()
        };
        self.last_out = out;
        self.state = Some(AutopilotState {
            mode: self.mode,
            route_point: u32::MAX,
            target: self.back_from,
            look_ahead_m: libm::hypotf(bl, bf),
            target_speed: f32::MAX,
            stuck_ticks: self.stuck,
            steer,
            throttle,
            brake,
            lane_m: 0.0,
        });
        (out, recover)
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn state(&self) -> Option<AutopilotState> {
        self.state
    }

    /// The player takes over from `tick`: the controls blend to theirs over [`HANDBACK_TICKS`].
    pub fn hand_back(&mut self, tick: u64) {
        self.mode = Mode::Handback;
        self.handback_at = tick;
    }

    /// During a handback: the blended controls, or `None` once the player has the car fully.
    pub fn blend(&self, tick: u64, player: DriveInput) -> Option<DriveInput> {
        if self.mode != Mode::Handback {
            return None;
        }
        let k = (tick - self.handback_at) as f32 / HANDBACK_TICKS as f32;
        if k >= 1.0 {
            return None;
        }
        let mix =
            |a: i16, b: i16| quantise_axis(dequantise_axis(a) * (1.0 - k) + dequantise_axis(b) * k);
        Some(DriveInput {
            throttle: mix(self.last_out.throttle, player.throttle),
            steer: mix(self.last_out.steer, player.steer),
            brake: mix(self.last_out.brake, player.brake),
            // The ACTION stick's boost is the player's own from the first handback tick.
            boost: player.boost,
            no_reverse: false,
        })
    }

    /// Whether the handback has finished (the car is the player's again).
    pub fn handed_back(&self, tick: u64) -> bool {
        self.mode == Mode::Handback && tick >= self.handback_at + HANDBACK_TICKS
    }

    /// The controls for this tick, and whether it wants to press Recover (stuck for 3 s), on `plan` (its `scale` is the
    /// catch-up), passing the cars in `traffic` that are in its way (`bots.pass`).
    #[allow(clippy::too_many_arguments)]
    pub fn drive(
        &mut self,
        path: &Path,
        car: Pose2,
        max_steer: f32,
        wheelbase: f32,
        tick: u64,
        plan: &SpeedPlan,
        traffic: &[Rival],
        bots: &BotTuning,
    ) -> (DriveInput, bool) {
        let n = path.n();
        // On a branch: follow it to its last point, then the route from its merge.
        if let Some((b, j)) = self.on {
            let j = path.track_branch(b, j, car.x, car.z, 24);
            if j + 2 >= path.branches[b].pts.len() {
                self.on = None;
                self.plan = None;
                self.idx = Some(path.branches[b].to);
            } else {
                self.on = Some((b, j));
                self.idx = Some(path.branches[b].from);
            }
        }
        let idx = match (self.on, self.idx) {
            (Some(_), Some(i)) => i,
            (None, Some(i)) => path.track(i, car.x, car.z, 24),
            (_, None) => path.nearest(car.x, car.y, car.z),
        };
        self.idx = Some(idx);
        if self.on.is_none() {
            // Decide about the next split ahead; forget a split passed without taking it.
            if let Some((b, take)) = self.plan {
                let from = path.branches[b].from;
                if path.ahead(from, idx) < PASSED_M && path.ahead(from, idx) < path.ahead(idx, from)
                {
                    if take {
                        self.on = Some((b, path.track_branch(b, 0, car.x, car.z, 24)));
                    } else if path.ahead(from, idx) > PASSED_M / 2.0 {
                        self.plan = None;
                    }
                }
            } else if let Some(b) = (0..path.branches.len())
                .filter(|&b| path.ahead(idx, path.branches[b].from) <= DECIDE_M)
                .min_by(|&a, &c| {
                    path.ahead(idx, path.branches[a].from)
                        .total_cmp(&path.ahead(idx, path.branches[c].from))
                })
            {
                let offset = mix(self.choice_seed ^ b as u64) & 1;
                let take = (u64::from(self.car) + u64::from(self.forks_met) + offset) & 1 == 1;
                self.plan = Some((b, take));
                self.forks_met = self.forks_met.wrapping_add(1);
            }
        }
        let takes = self.plan.and_then(|(b, take)| take.then_some(b));
        let start = match self.on {
            Some((b, j)) => Cursor::Branch(b, j),
            None => Cursor::Route(idx),
        };
        // Walks the line the car drives from `start` until `until` metres, calling `each` with every point's planned cap.
        let walk = |until: f32, each: &mut dyn FnMut(f32, f32)| {
            let (mut c, mut gone) = (start, 0.0f32);
            for _ in 0..n * 2 {
                let next = path.next(c, takes);
                let (p, q) = (path.at(c).0, path.at(next).0);
                let step = libm::hypotf(q.0 - p.0, q.1 - p.1);
                if gone + step > until {
                    break;
                }
                gone += step;
                c = next;
                each(plan.cap(path.at(c).1, path.takeoff_at(c)), gone);
            }
            c
        };
        let speed = car.forward_speed.max(0.0);
        let look = (LOOK_AHEAD_S * speed).max(MIN_LOOK_AHEAD_M);
        self.pass(path, idx, car, traffic, bots, tick);
        let target = {
            // The line at the look-ahead, moved sideways by the lane (left of the line's direction there).
            let c = walk(look, &mut |_, _| {});
            let (p, q) = (path.at(c).0, path.at(path.next(c, takes)).0);
            let len = libm::hypotf(q.0 - p.0, q.1 - p.1).max(1e-3);
            let (lx, lz) = ((q.1 - p.1) / len, -(q.0 - p.0) / len);
            (p.0 + lx * self.lane, p.1 + lz * self.lane)
        };
        // Pure pursuit: the angle to the target in the car's frame (+ = to its left, +x when facing +z).
        let (sh, ch) = (libm::sinf(car.heading), libm::cosf(car.heading));
        let (dx, dz) = (target.0 - car.x, target.1 - car.z);
        let (local_left, local_fwd) = (dx * ch - dz * sh, dx * sh + dz * ch);
        let alpha = libm::atan2f(local_left, local_fwd);
        let curvature = 2.0 * libm::sinf(alpha) / look;
        let wheel = libm::atanf(curvature * wheelbase);
        if tick.is_multiple_of(NOISE_EVERY_TICKS) {
            self.noise_target = (self.noise.next_f32() * 2.0 - 1.0) * NOISE_STEER;
        }
        self.noise_now += (self.noise_target - self.noise_now) * 0.05;
        let steer = (wheel / max_steer + self.noise_now).clamp(-1.0, 1.0);
        // The speed plan: the sharpest bend within stopping distance plus the look-ahead.
        let horizon = speed * speed / (2.0 * plan.plan_brake) + look;
        // Braking on a curve, not at sight: each point's cap reached from here at the planned braking (v² = cap² + 2·a·d).
        let mut cap = plan.cap(path.at(start).1, path.takeoff_at(start));
        walk(horizon, &mut |v, d| {
            cap = cap.min(libm::sqrtf(v * v + 2.0 * plan.plan_brake * d));
        });
        // A straight: nothing within `straightM` asks the plan for less than its ceiling (a sanga or tinnie's place).
        let mut straight = cap >= plan.max_speed;
        walk(bots.items.straight_m, &mut |v, _| {
            straight &= v >= plan.max_speed
        });
        self.straight = straight;
        let mut target_speed = cap * plan.scale;
        if self.mode == Mode::CoolDown {
            target_speed *= COOL_DOWN;
        }
        let err = target_speed - car.forward_speed;
        let (throttle, brake) = if err > 0.0 {
            ((0.25 * err).min(1.0), 0.0)
        } else if err < -1.0 {
            (0.0, (0.3 * -err).min(1.0))
        } else {
            (0.0, 0.0)
        };
        self.stuck = if car.forward_speed.abs() < STUCK_SPEED {
            self.stuck + 1
        } else {
            0
        };
        let recover = self.stuck >= STUCK_TICKS;
        if recover {
            self.stuck = 0;
            self.idx = None;
            self.on = None;
            self.plan = None;
        }
        let out = DriveInput {
            throttle: quantise_axis(throttle),
            steer: quantise_axis(steer),
            brake: quantise_axis(brake),
            ..DriveInput::default()
        };
        self.last_out = out;
        self.state = Some(AutopilotState {
            mode: self.mode,
            route_point: idx as u32,
            target: [target.0, target.1],
            look_ahead_m: look,
            target_speed,
            stuck_ticks: self.stuck,
            steer,
            throttle,
            brake,
            lane_m: self.lane,
        });
        (out, recover)
    }

    /// Traffic (council review 2026-11-15): the nearest car ahead within the look and the car's own width of its lane,
    /// that it's closing on, is in the way; the car takes a lane `gapM` beside it, on the side nearer its own lane that
    /// fits inside the road (else the roomier side), and holds it `holdS` after the last car in the way. The lane moves at
    /// `laneRateMps`. Off the route's line (a fork's branch) it eases back to the line.
    fn pass(
        &mut self,
        path: &Path,
        idx: usize,
        me: Pose2,
        traffic: &[Rival],
        bots: &BotTuning,
        tick: u64,
    ) {
        let p = &bots.pass;
        let speed = me.forward_speed.max(0.0);
        let look = (p.look_s * speed).max(p.min_look_m);
        let (sh, ch) = (libm::sinf(me.heading), libm::cosf(me.heading));
        let room = (path.half_width[idx] - p.edge_m).max(0.0);
        let blocker = traffic
            .iter()
            .filter(|r| r.car != self.car)
            .filter_map(|r| {
                let (l, f) = local_of(me, r.x, r.z);
                let closing = speed - (r.vx * sh + r.vz * ch);
                (f > 0.0 && f < look && l.abs() < p.width_m && closing > p.closing_mps)
                    .then_some((f, l))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        if self.on.is_some() {
            self.lane_target = 0.0;
        } else if let Some((_, l)) = blocker {
            let theirs = self.lane + l;
            let sides = [theirs + p.gap_m, theirs - p.gap_m];
            let fits = |v: f32| v.abs() <= room;
            let near = |a: &f32, b: &f32| (a - self.lane).abs().total_cmp(&(b - self.lane).abs());
            self.lane_target = match sides.iter().copied().filter(|&v| fits(v)).min_by(near) {
                Some(v) => v,
                None => sides
                    .iter()
                    .map(|v| v.clamp(-room, room))
                    .max_by(|a, b| (a - theirs).abs().total_cmp(&(b - theirs).abs()))
                    .unwrap_or(0.0),
            };
            self.lane_until = tick + ticks(p.hold_s);
        } else if tick >= self.lane_until {
            self.lane_target = 0.0;
        }
        let step = p.lane_rate_mps / TICK_HZ as f32;
        let target = self.lane_target.clamp(-room, room);
        self.lane += (target - self.lane).clamp(-step, step);
    }

    /// Whether to use the front item this tick, and which way (council review 2026-11-15: bots never used one, an idle
    /// player's car hoarded). Only a driving autopilot uses items. A new front item waits `reactS`; then a boomerang goes
    /// forward at a car ahead in its aim cone within `boomerangAheadM` (or back at one behind within `boomerangBehindM`),
    /// an esky drops for a car within `eskyBehindM` behind and `eskyWidthM` of this car's line, a sanga or tinnie goes on
    /// a straight, and anything held `holdMaxS` goes anyway. The sim makes the use (and may refuse it).
    pub fn item_use(
        &mut self,
        me: Pose2,
        front: Option<ItemId>,
        traffic: &[Rival],
        t: &BotItemTuning,
        tick: u64,
    ) -> Option<UtilityKind> {
        let Some(item) = front.filter(|_| self.mode == Mode::Driving) else {
            self.holding = None;
            return None;
        };
        let since = match self.holding {
            Some((held, since)) if held == item => since,
            _ => {
                self.holding = Some((item, tick));
                tick
            }
        };
        if tick < since + ticks(t.react_s) {
            return None;
        }
        let overdue = tick >= since + ticks(t.hold_max_s);
        let others = || {
            traffic
                .iter()
                .filter(|r| r.car != self.car && !r.protected)
                .map(|r| local_of(me, r.x, r.z))
        };
        let in_cone = |ahead: bool, range: f32| {
            others().any(|(l, f)| {
                let d = libm::hypotf(l, f);
                let along = if ahead { f } else { -f };
                d <= range && along > 0.0 && along >= t.aim_cos * d
            })
        };
        let kind = match item {
            ItemId::Boomerang if in_cone(true, t.boomerang_ahead_m) || overdue => {
                Some(UtilityKind::Forward)
            }
            ItemId::Boomerang if in_cone(false, t.boomerang_behind_m) => Some(UtilityKind::Rear),
            ItemId::Esky
                if overdue
                    || others().any(|(l, f)| {
                        f < 0.0 && -f <= t.esky_behind_m && l.abs() <= t.esky_width_m
                    }) =>
            {
                Some(UtilityKind::Rear)
            }
            ItemId::Sanga | ItemId::Tinnie if self.straight || overdue => {
                Some(UtilityKind::Forward)
            }
            // br-bhkz.3: a bunger at a car ahead (the lob aims itself) or dropped for one close behind; a roo bar when
            // there is someone ahead to ram; a magpie as soon as it is held (it finds whoever is winning).
            ItemId::Bunger if in_cone(true, t.bunger_ahead_m) || overdue => {
                Some(UtilityKind::Forward)
            }
            ItemId::Bunger if in_cone(false, t.bunger_behind_m) => Some(UtilityKind::Rear),
            ItemId::RooBar if in_cone(true, t.roo_bar_ahead_m) || overdue => {
                Some(UtilityKind::Forward)
            }
            ItemId::Magpie => Some(UtilityKind::Forward),
            _ => None,
        };
        if kind.is_some() {
            // The next front item, even one the same, waits its own reaction.
            self.holding = None;
        }
        kind
    }

    /// Bytes for the full-state hash.
    pub fn hash_into(&self, out: &mut Vec<u8>) {
        out.push(self.mode as u8);
        out.extend(self.idx.map_or(u64::MAX, |i| i as u64).to_le_bytes());
        for s in self.noise.state() {
            out.extend(s.to_le_bytes());
        }
        out.extend(self.noise_now.to_bits().to_le_bytes());
        out.extend(self.noise_target.to_bits().to_le_bytes());
        if let Some((car, since)) = self.prey {
            out.extend(car.to_le_bytes());
            out.extend(since.to_le_bytes());
        }
        out.extend(self.stuck.to_le_bytes());
        out.extend(self.handback_at.to_le_bytes());
        // u64 sentinels, never `usize::MAX as u64`: usize is 32-bit in WASM, so that hashed differently from native
        // (every autopilot car off a fork: CI 5495, br-lekz).
        let (b, j) = self
            .on
            .map_or((u64::MAX, u64::MAX), |(b, j)| (b as u64, j as u64));
        out.extend(b.to_le_bytes());
        out.extend(j.to_le_bytes());
        let (pb, take) = self.plan.map_or((u64::MAX, false), |(b, t)| (b as u64, t));
        out.extend(pb.to_le_bytes());
        out.push(u8::from(take));
        out.extend(self.forks_met.to_le_bytes());
        // Traffic and items (2026-11-15), only once they leave their defaults: a car that never met traffic or held an
        // item hashes as before.
        if self.lane != 0.0
            || self.lane_target != 0.0
            || self.lane_until != 0
            || self.holding.is_some()
        {
            out.extend(b"ap-traffic");
            out.extend(self.lane.to_bits().to_le_bytes());
            out.extend(self.lane_target.to_bits().to_le_bytes());
            out.extend(self.lane_until.to_le_bytes());
            let (item, since) = self.holding.map_or((u8::MAX, 0), |(i, s)| (i as u8, s));
            out.push(item);
            out.extend(since.to_le_bytes());
        }
        // Derby back-offs (2026-11-16), likewise only once used.
        if self.stall != 0 || self.back_until != 0 || self.shun.is_some() || self.descending {
            out.extend(b"ap-derby");
            out.push(u8::from(self.descending));
            out.push(u8::from(self.reversing));
            out.extend(self.tries.to_le_bytes());
            out.extend(self.stalled_at[0].to_bits().to_le_bytes());
            out.extend(self.stalled_at[1].to_bits().to_le_bytes());
            out.extend(self.stall.to_le_bytes());
            out.extend(self.back_until.to_le_bytes());
            out.extend(self.back_from[0].to_bits().to_le_bytes());
            out.extend(self.back_from[1].to_bits().to_le_bytes());
            let (at, until) = self.shun.unwrap_or(([0.0; 2], 0));
            out.extend(at[0].to_bits().to_le_bytes());
            out.extend(at[1].to_bits().to_le_bytes());
            out.extend(until.to_le_bytes());
        }
    }
}

/// Whether a controller's new input is a deliberate move rather than a heartbeat or a noisy axis: some axis moved by
/// at least [`DELIBERATE_AXIS`] of full scale. The session (G03) only hands back on fresh input that passes this.
pub fn is_deliberate(previous: DriveInput, now: DriveInput) -> bool {
    let moved = |a: i16, b: i16| (dequantise_axis(a) - dequantise_axis(b)).abs() >= DELIBERATE_AXIS;
    moved(previous.throttle, now.throttle)
        || moved(previous.steer, now.steer)
        || moved(previous.brake, now.brake)
}

/// Route points from a jump's base to its lip, and a gap leap's run-up to its far rim, with what each asks of the plan.
fn takeoff_points(map: &LoadedMap, n: usize) -> Vec<RampCap> {
    let mut out = vec![RampCap::None; n];
    let m = &map.map;
    for f in &m.features {
        // Route points are ~2.5 m apart; a few before the base so the car is at the speed as it meets the ramp.
        let (from, to, cap) = if let Some(g) = jj_map::setpiece::GapLeap::of(f) {
            // The top of the window the piece is built and checked for: a bot at the middle of it came off the lip
            // slower still (the ramp takes speed) and fell short of a creek washout.
            (
                g.from as usize + n - 4,
                g.to as usize,
                RampCap::Leap(g.max_speed as f32),
            )
        } else if f.kind == jj_map::model::FeatureKind::Jump {
            let Some(d) = jj_map::jump::JumpDesign::of(f) else {
                continue;
            };
            let base = jj_map::jump::feature_base(m, f);
            (
                base + n - 4,
                base + (d.ramp_m / 2.5).ceil() as usize,
                RampCap::Jump,
            )
        } else {
            continue;
        };
        let mut i = from % n;
        loop {
            out[i] = cap;
            if i == to % n {
                break;
            }
            i = (i + 1) % n;
        }
    }
    out
}
