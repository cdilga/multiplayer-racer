//! Autopilot (P1-S07, plan §7.5, R45): a visible, deliberately weak driver for dropped-out, idle and finished cars and
//! for test bots. It hands control back cleanly when the player returns.
//!
//! - **Pure pursuit** on the map's centerline. The look-ahead is ≈ 0.8 s × speed (at least [`MIN_LOOK_AHEAD_M`]), and
//!   steering is the pursuit curvature turned into a wheel angle with the car's wheelbase. Route tracking only searches
//!   forward from the last point, so a crossing or a nearby stretch of the loop can't pull it across.
//! - **Speed** comes from the sharpest curvature ahead: `0.7 × √(a_lat / κ)` (low skill), clamped. A cool-down lap
//!   (finished cars) goes at 0.6 of that.
//! - **Noise.** Small and seeded (its own RNG stream per car), drifting slowly so it reads as a driver, not jitter.
//! - **Self-recovery.** Under 1 m/s for 3 s, it presses Recover. That's a consequence of the state, so it isn't journaled.
//! - **Handback.** When the player takes over, the controls blend from the autopilot's last output to the player's
//!   input over [`HANDBACK_TICKS`], starting at a tick boundary, with no jolt. Deciding that input is fresh and
//!   deliberate is the session's job (G03), and [`is_deliberate`] is the test it uses: a heartbeat or a noisy axis
//!   doesn't reclaim the car.
//!
//! Everything it decides is in [`AutopilotState`] for introspection (target point, look-ahead, target speed, stuck
//! time).

use jj_map::LoadedMap;
use jj_types::axis::{dequantise_axis, quantise_axis};
use serde::{Deserialize, Serialize};

use crate::journal::DriveInput;
use crate::rng::Rng;
use crate::sim::TICK_HZ;

const SECOND: u64 = TICK_HZ as u64;
pub const LOOK_AHEAD_S: f32 = 0.8;
pub const MIN_LOOK_AHEAD_M: f32 = 6.0;
/// Lateral grip the speed plan assumes (m/s²), before the skill factor.
pub const LATERAL_GRIP: f32 = 7.0;
pub const SKILL: f32 = 0.7;
pub const COOL_DOWN: f32 = 0.6;
pub const MIN_SPEED: f32 = 4.0;
pub const MAX_SPEED: f32 = 26.0;
/// Braking the speed plan assumes when it looks ahead for a corner (m/s²).
pub const PLAN_BRAKE: f32 = 6.0;
pub const STUCK_SPEED: f32 = 1.0;
pub const STUCK_TICKS: u64 = 3 * SECOND;
pub const HANDBACK_TICKS: u64 = SECOND / 4;
/// How far the steering noise wanders, and how often it picks a new target.
pub const NOISE_STEER: f32 = 0.04;
pub const NOISE_EVERY_TICKS: u64 = SECOND / 4;
/// An axis has to move this much (of full scale) between two inputs to count as deliberate.
pub const DELIBERATE_AXIS: f32 = 0.25;

/// The centerline as the autopilot sees it: points (m), arc lengths and curvature at each point (1/m).
#[derive(Clone, Debug)]
pub struct Path {
    pts: Vec<(f32, f32)>,
    s: Vec<f32>,
    curvature: Vec<f32>,
    total: f32,
}

impl Path {
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
        let curvature = (0..n)
            .map(|i| {
                let (a, b, c) = (pts[(i + n - 2) % n], pts[i], pts[(i + 2) % n]);
                let (ab, bc, ca) = (
                    libm::hypotf(b.0 - a.0, b.1 - a.1),
                    libm::hypotf(c.0 - b.0, c.1 - b.1),
                    libm::hypotf(a.0 - c.0, a.1 - c.1),
                );
                let cross = ((b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)).abs();
                let d = ab * bc * ca;
                if d > 1e-6 { 2.0 * cross / d } else { 0.0 }
            })
            .collect();
        Self {
            pts,
            s,
            curvature,
            total,
        }
    }

    fn n(&self) -> usize {
        self.pts.len()
    }

    /// The nearest point to (x, z) over the whole route (only when the autopilot first takes over).
    fn nearest(&self, x: f32, z: f32) -> usize {
        (0..self.n())
            .min_by(|&a, &b| {
                let da = libm::hypotf(self.pts[a].0 - x, self.pts[a].1 - z);
                let db = libm::hypotf(self.pts[b].0 - x, self.pts[b].1 - z);
                da.total_cmp(&db)
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
    pub fn planned_speed(&self, x: f32, z: f32) -> f32 {
        let n = self.n();
        let idx = self.nearest(x, z);
        let horizon = MAX_SPEED * MAX_SPEED / (2.0 * PLAN_BRAKE);
        let (mut k_max, mut p) = (0.0f32, idx);
        while self.ahead(idx, p) <= horizon {
            k_max = k_max.max(self.curvature[p]);
            p = (p + 1) % n;
            if p == idx {
                break;
            }
        }
        if k_max > 1e-4 {
            SKILL * libm::sqrtf(LATERAL_GRIP / k_max)
        } else {
            MAX_SPEED
        }
        .clamp(MIN_SPEED, MAX_SPEED)
    }
}

/// What the car looks like to the autopilot.
#[derive(Clone, Copy, Debug)]
pub struct Pose2 {
    pub x: f32,
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
}

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
        }
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
            // The ACTION stick's held sectors are the player's own from the first handback tick.
            drift: player.drift,
            boost: player.boost,
            no_reverse: false,
        })
    }

    /// Whether the handback has finished (the car is the player's again).
    pub fn handed_back(&self, tick: u64) -> bool {
        self.mode == Mode::Handback && tick >= self.handback_at + HANDBACK_TICKS
    }

    /// The controls for this tick, and whether it wants to press Recover (stuck for 3 s).
    pub fn drive(
        &mut self,
        path: &Path,
        car: Pose2,
        max_steer: f32,
        wheelbase: f32,
        tick: u64,
    ) -> (DriveInput, bool) {
        let n = path.n();
        let idx = match self.idx {
            Some(i) => path.track(i, car.x, car.z, 24),
            None => path.nearest(car.x, car.z),
        };
        self.idx = Some(idx);
        let speed = car.forward_speed.max(0.0);
        let look = (LOOK_AHEAD_S * speed).max(MIN_LOOK_AHEAD_M);
        let mut t = idx;
        while path.ahead(idx, t) < look && path.ahead(idx, (t + 1) % n) > path.ahead(idx, t) {
            t = (t + 1) % n;
        }
        let target = path.pts[t];
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
        let horizon = speed * speed / (2.0 * PLAN_BRAKE) + look;
        let mut k_max = 0.0f32;
        let mut p = idx;
        while path.ahead(idx, p) <= horizon {
            k_max = k_max.max(path.curvature[p]);
            p = (p + 1) % n;
            if p == idx {
                break;
            }
        }
        let mut target_speed = if k_max > 1e-4 {
            SKILL * libm::sqrtf(LATERAL_GRIP / k_max)
        } else {
            MAX_SPEED
        }
        .clamp(MIN_SPEED, MAX_SPEED);
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
        });
        (out, recover)
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
        out.extend(self.stuck.to_le_bytes());
        out.extend(self.handback_at.to_le_bytes());
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
