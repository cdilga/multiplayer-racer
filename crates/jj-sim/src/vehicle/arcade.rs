//! The arcade car controller (P1-FL04.2, R136, R138): driving feel is authored, not simulated.
//!
//! Rapier keeps the suspension, the contacts, drive and braking along the wheels, collisions, jumps and debris. With a
//! profile's `tuning.arcade` set, its side friction is off and this controller drives the body instead, once per tick
//! after `update_vehicle`, with the car's wheels on the ground:
//!
//! - **The car goes where you point it.** The stick asks for a yaw rate: the kinematic turn of the profile's lock, the
//!   lock easing off with speed (`steer_falloff_mps`, so a small stick at speed is a small, progressive turn), never
//!   more than a lateral acceleration of `turn_g` or `yaw_max_deg_s`. A yaw controller closes the gap with a time
//!   constant `turn_in_s` (eager turn-in) and at most `yaw_accel_deg_s2`. No tyre slip curve: the ask is always met, so
//!   nothing ploughs, and full stick reaches the full arcade turn at any speed.
//! - **Grip swings the velocity onto the nose.** Sideways velocity at the centre of mass goes at up to `grip_g`; of the
//!   speed that takes away, `carry` is handed back along the nose, so a turn keeps its speed (big readable speed). It
//!   acts at the centre of mass: no roll, no dive (R122).
//! - **Weight transfer as character** (R128): a load shift follows brake − throttle over `transfer_s` (no body pitch).
//!   Braking or lifting asks for more rotation (`lift_tuck`, the FWD nose tucks), power changes the ask by
//!   `power_push` (FWD pushes a little, RWD tightens when it's negative).
//! - **Grip that lets go on purpose.** A throttle punch (stick from under `punch_from` to full within `punch_window_s`)
//!   with steer, below `punch_max_mps`, breaks the rear by `punch_slide` (0 on a front-driven car): the slide. Braking
//!   never breaks grip (a learner brakes and steers into every corner; the autopilot does too). While sliding, grip falls toward `slide_grip` and the
//!   stick sets the drift angle (full stick `slide_angle_deg`, centred straightens, opposite catches it), held at
//!   `slide_hold_per_s`; the yaw follows the velocity's own turn plus that correction, so a slide never spins by itself.
//!   A power slide lasts while the throttle stays past `slide_hold_throttle` with steer on; otherwise grip returns over
//!   `slide_recover_s`.
//! - **Forgiving.** Far past the slide angle (a hit, a landing sideways) the yaw controller lets go so wrecks still spin,
//!   and the grip fades toward the slide's. `roll_damping` calms the body's roll rate while it is on its wheels, so a
//!   kerb doesn't trip it.
//!
//! Everything here is data in the profile (`assets/profiles/<car>.json`, `tuning.arcade`) and every tick is libm maths,
//! so the controller replays bit for bit.

use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};

const G: f32 = 9.81;
/// Below this horizontal speed (m/s) the drift angle means nothing and is taken as 0.
const ANGLE_FLOOR_MPS: f32 = 2.0;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Arcade {
    /// Lateral acceleration full stick asks for at speed, g.
    pub turn_g: f32,
    /// The most yaw rate full stick asks for at any speed, deg/s.
    pub yaw_max_deg_s: f32,
    /// Yaw controller: time constant toward the ask (s) and its largest angular acceleration (deg/s²).
    pub turn_in_s: f32,
    pub yaw_accel_deg_s2: f32,
    /// Sideways grip at the centre of mass, g, and the share of the speed a turn's grip keeps (1 = no scrub).
    pub grip_g: f32,
    pub carry: f32,
    /// Load shift: settle time (s); the yaw ask's gain under braking/lift and its change under power.
    pub transfer_s: f32,
    pub lift_tuck: f32,
    pub power_push: f32,
    /// Throttle punch: from under `punch_from` to at least `punch_to` within `punch_window_s`, with at least
    /// `punch_steer` of stick, between `punch_min_mps` and `punch_max_mps`, starts a slide of `punch_slide` (0: never).
    pub punch_from: f32,
    pub punch_to: f32,
    pub punch_window_s: f32,
    pub punch_steer: f32,
    pub punch_min_mps: f32,
    pub punch_max_mps: f32,
    pub punch_slide: f32,
    /// The slide: grip share while fully sliding, the drift angle full stick holds (deg), how fast the yaw closes on that
    /// angle (per s), the throttle that keeps a power slide going, and how long grip takes to come back (s).
    pub slide_grip: f32,
    pub slide_angle_deg: f32,
    pub slide_hold_per_s: f32,
    pub slide_hold_throttle: f32,
    pub slide_recover_s: f32,
    /// Past `slide_angle_deg` + this (deg) the controller has let go (a hit or a sideways landing) down to
    /// `let_go_authority` of itself: wrecks spin, and still scrub their spin off like sliding tyres would.
    pub let_go_deg: f32,
    pub let_go_authority: f32,
    /// Roll-rate damping while on the wheels, per s (0 none).
    pub roll_damping: f32,
    /// Below this speed (m/s) the stick's turn is asked as if the car rolled at `pivot_mps` × the drive it's given
    /// (throttle forward, a pull back in reverse): a car pushed against a wall, a car or debris with steer on scrubs
    /// round and drives off instead of sitting stuck.
    pub pivot_mps: f32,
}

/// What the controller keeps per car between ticks (inside the car's `ActionState`, hashed with it).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArcadeState {
    /// 0 gripping, 1 fully sliding.
    pub slide: f32,
    /// +1 all the grip shifted forward (braking), −1 back (power).
    pub load_shift: f32,
    /// Ticks since the throttle was last under `punch_from` (saturating).
    pub since_low: u32,
    /// The drift angle (deg, + nose left of travel) and the yaw rate asked, last tick: observations for probes.
    pub angle_deg: f32,
    pub yaw_ask_deg_s: f32,
}

impl Default for ArcadeState {
    /// A fresh car hasn't just lifted: a spawn at full throttle is no punch.
    fn default() -> Self {
        Self {
            slide: 0.0,
            load_shift: 0.0,
            since_low: u32::MAX,
            angle_deg: 0.0,
            yaw_ask_deg_s: 0.0,
        }
    }
}

/// The controls the controller reads this tick: throttle and brake 0..1 (boost counts as full throttle), steer −1..1
/// (+ left).
#[derive(Clone, Copy, Debug)]
pub struct Controls {
    pub throttle: f32,
    pub brake: f32,
    pub steer: f32,
}

/// The ground under the car this tick: the share of its wheels loaded (0..1), their mean grip multiplier (the profile's
/// `surfaces`: the turn the stick can ask for scales with it) and their mean side stiffness (R124's surface table: loose
/// ground holds the car's line less, so dirt and gravel drift wide).
#[derive(Clone, Copy, Debug)]
pub struct Ground {
    pub loaded: f32,
    pub grip: f32,
    pub side: f32,
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl Arcade {
    /// The yaw rate (rad/s, + left) the stick asks for while gripping, at `forward` m/s along the nose and `speed`
    /// m/s over the ground, for a lock of `max_steer` rad easing off as `max_steer / (1 + v / falloff)` on `wheelbase` m,
    /// and a ground grip multiplier `grip` (loose ground turns less at any speed). Pure-pursuit steering (the autopilot,
    /// the assists) maps a curvature to a stick through the same bicycle geometry, so it gets the turn it asks for.
    #[allow(clippy::too_many_arguments)]
    pub fn grip_yaw(
        &self,
        steer: f32,
        forward: f32,
        speed: f32,
        max_steer: f32,
        falloff: f32,
        wheelbase: f32,
        grip: f32,
    ) -> f32 {
        let s = steer.abs().min(1.0);
        let lock = max_steer / (1.0 + forward.abs() / falloff.max(1.0));
        let kinematic = forward.abs() * libm::tanf(s * lock) / wheelbase.max(0.5);
        let lateral = self.turn_g * G * grip / speed.max(1.0);
        let cap = self.yaw_max_deg_s.to_radians();
        // Loose ground turns less, but a car on the verge can still steer back: the ask scales with √grip (the lateral
        // cap and the line-holding take the whole multiplier).
        let rate = kinematic.min(lateral).min(cap) * libm::sqrtf(grip.clamp(0.0, 1.0));
        rate * steer.signum() * if forward < 0.0 { -1.0 } else { 1.0 }
    }

    /// The load shift's yaw-ask gain: `shift` +1 braking, 0 coasting, −1 full power.
    pub fn shift_gain(&self, shift: f32) -> f32 {
        1.0 + self.lift_tuck * shift.max(0.0) - self.power_push * (-shift).max(0.0)
    }

    /// One tick of the slide state: a punch starts one, a held power slide stays, anything else lets grip come back.
    pub fn step_slide(&self, st: &mut ArcadeState, c: Controls, speed: f32, dt: f32) {
        if c.throttle < self.punch_from {
            st.since_low = 0;
        } else {
            st.since_low = st.since_low.saturating_add(1);
        }
        let window = libm::ceilf(self.punch_window_s / dt) as u32;
        let steering = c.steer.abs() >= self.punch_steer;
        let punch = self.punch_slide > 0.0
            && c.throttle >= self.punch_to
            && st.since_low <= window
            && steering
            && (self.punch_min_mps..=self.punch_max_mps).contains(&speed);
        if punch {
            st.slide = st.slide.max(self.punch_slide);
        }
        // Steering against the slide (past a few degrees of it) catches it: grip comes back twice as fast and a power
        // slide no longer holds.
        let catching = c.steer * st.angle_deg < 0.0 && st.angle_deg.abs() > 3.0;
        let held = self.punch_slide > 0.0
            && c.throttle >= self.slide_hold_throttle
            && c.steer.abs() >= 0.2
            && !catching;
        if !(punch || held) {
            let rate = if catching { 2.0 } else { 1.0 };
            st.slide = (st.slide - rate * dt / self.slide_recover_s.max(dt)).max(0.0);
        }
        let target = (c.brake - c.throttle).clamp(-1.0, 1.0);
        st.load_shift += (target - st.load_shift) * (dt / self.transfer_s.max(dt)).min(1.0);
    }
}

/// Drives the body for one tick (after Rapier's `update_vehicle`). `max_steer`/`wheelbase` are the profile's lock and
/// geometry, `rear_arm` the centre of mass's distance ahead of the rear axle (m): grip holds the rear axle on its
/// line, so a gripping car pivots about its rear wheels the way a real one does, and the drift angle is the rear's. Returns the work the yaw controller added, J, for the energy ledger (the grip only ever takes speed away).
#[allow(clippy::too_many_arguments)]
pub fn apply(
    a: &Arcade,
    st: &mut ArcadeState,
    body: &mut RigidBody,
    c: Controls,
    ground: Ground,
    max_steer: f32,
    falloff: f32,
    wheelbase: f32,
    rear_arm: f32,
    dt: f32,
) -> f64 {
    if ground.loaded <= 0.0 {
        return 0.0;
    }
    let rot = body.position().rotation;
    let (up, fwd, left) = (rot * Vector::Y, rot * Vector::Z, rot * Vector::X);
    // Only a car on its wheels is driven: on its side or roof the flip assist (and the wreck) own it.
    let upright = smoothstep(0.5, 0.8, up.y);
    if upright <= 0.0 {
        return 0.0;
    }
    let ground = Ground {
        loaded: ground.loaded * upright,
        ..ground
    };
    let v = body.linvel();
    let (vf, vs) = (v.dot(fwd), v.dot(left));
    let speed = libm::hypotf(vf, vs);
    a.step_slide(st, c, speed, dt);
    let w = body.angvel();
    let r = w.dot(up);
    // The rear axle's sideways velocity: the centre of mass's, less the yaw's swing of the axle behind it.
    let vs_rear = vs - r * rear_arm;
    // The drift angle: the rear axle's travel off the nose, + when the nose points left of it (a left-hand slide), 0 at
    // a crawl.
    let angle = if speed < ANGLE_FLOOR_MPS {
        0.0
    } else {
        // Reversing, the travel is backwards along the car.
        -libm::atan2f(vs_rear, libm::fabsf(vf)) * if vf < 0.0 { -1.0 } else { 1.0 }
    };
    let angle_deg = angle.to_degrees();
    st.angle_deg = angle_deg;
    // Far past the slide's angle the car is wrecking, not driving: the controller lets go.
    let let_go = 1.0
        - (1.0 - a.let_go_authority)
            * smoothstep(
                a.slide_angle_deg,
                a.slide_angle_deg + a.let_go_deg,
                libm::fabsf(angle_deg),
            );
    let authority = ground.loaded * let_go;
    // Grip: sideways velocity goes at up to grip_g, less while sliding and less again far sideways.
    let slide_share = 1.0 - st.slide * (1.0 - a.slide_grip);
    let sideways = smoothstep(
        a.slide_angle_deg,
        a.slide_angle_deg + 30.0,
        libm::fabsf(angle_deg),
    );
    let grip = a.grip_g
        * G
        * ground.grip
        * ground.side
        * ground.loaded
        * slide_share
        * (1.0 - sideways * (1.0 - a.slide_grip));
    let cut = vs_rear.clamp(-grip * dt, grip * dt);
    let vs2 = vs - cut;
    let vf2 = if libm::fabsf(vf) > 1.0 {
        let kept = vf * vf + a.carry * (vs * vs - vs2 * vs2);
        libm::sqrtf(kept.max(0.0)) * vf.signum()
    } else {
        vf
    };
    let m = body.mass();
    body.apply_impulse(left * ((vs2 - vs) * m) + fwd * ((vf2 - vf) * m), true);
    // Yaw: while gripping, the stick's turn; while sliding, the velocity's own turn plus a pull onto the drift angle
    // the stick sets.
    // Stalled (driven but going nowhere: against a wall, a car or debris), the stick turns the car as if it rolled at
    // `pivot_mps`, whatever the ground under it, so it scrubs round and drives off.
    // Braking a rolling car is braking, not a push the other way.
    let intent = (c.throttle - c.brake) * a.pivot_mps;
    let pushing = libm::fabsf(vf) < 0.5 || intent * vf > 0.0;
    let stalled = pushing && libm::fabsf(intent) > libm::fabsf(vf);
    let r_grip = if stalled {
        a.grip_yaw(c.steer, intent, speed, max_steer, falloff, wheelbase, 1.0)
    } else {
        a.grip_yaw(
            c.steer,
            vf,
            speed,
            max_steer,
            falloff,
            wheelbase,
            ground.grip,
        )
    } * a.shift_gain(st.load_shift);
    let r_travel = if speed >= ANGLE_FLOOR_MPS {
        // How fast the velocity itself turns this tick (+ left): (v × Δv) · up / |v|².
        (vf * (vs2 - vs) - vs * (vf2 - vf)) / (speed * speed * dt)
    } else {
        0.0
    };
    // The stick sets the drift angle; against the slide it straightens it (a catch, never a flick the other way).
    let want = if c.steer * angle < 0.0 && libm::fabsf(angle_deg) > 3.0 {
        0.0
    } else {
        c.steer * a.slide_angle_deg.to_radians()
    };
    let r_slide = r_travel + (want - angle) * a.slide_hold_per_s;
    let ask = r_grip + (r_slide - r_grip) * st.slide;
    st.yaw_ask_deg_s = ask.to_degrees();
    // Stalled, the controller works at its full authority (wall friction under a full-throttle push out-torques the
    // turn-in filter, and the car would sit there).
    let response = if stalled {
        1.0
    } else {
        (dt / a.turn_in_s.max(dt)).min(1.0)
    };
    let dr = (ask - r) * response * authority;
    let cap = a.yaw_accel_deg_s2.to_radians() * dt * authority;
    let dr = dr.clamp(-cap, cap);
    let inv_i = body.mass_properties().effective_world_inv_inertia;
    let mut work = 0.0;
    let ti = up * (dr / up.dot(inv_i * up).max(1e-9));
    work += f64::from(ti.dot(w));
    body.apply_torque_impulse(ti, true);
    // Roll calm: damp the roll rate about the nose while on the wheels (dissipative).
    if a.roll_damping > 0.0 {
        let roll = w.dot(fwd);
        let k = (a.roll_damping * dt * ground.loaded).min(1.0);
        let tr = fwd * (-roll * k / fwd.dot(inv_i * fwd).max(1e-9));
        body.apply_torque_impulse(tr, true);
    }
    work
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cruz() -> Arcade {
        crate::profile::VehicleProfile::cruz()
            .tuning
            .arcade
            .expect("the Cruz ships the arcade controller")
    }

    #[test]
    fn the_ask_is_kinematic_at_a_crawl_and_lateral_at_speed() {
        let a = cruz();
        let crawl = a.grip_yaw(1.0, 2.0, 2.0, 0.55, 25.0, 2.6, 1.0);
        let lock = 0.55 / (1.0 + 2.0 / 25.0);
        assert!((crawl - 2.0 * libm::tanf(lock) / 2.6).abs() < 1e-5);
        // Full stick at speed is the arcade turn (turn_g), whatever the eased lock would say.
        let fast = a.grip_yaw(1.0, 30.0, 30.0, 0.55, 25.0, 2.6, 1.0);
        assert!((fast - a.turn_g * G / 30.0).abs() < 1e-5, "{fast}");
        // A small stick at speed is a small, progressive turn: the eased lock's kinematic curvature.
        let small = a.grip_yaw(0.1, 30.0, 30.0, 0.55, 25.0, 2.6, 1.0);
        let lock30 = 0.55 / (1.0 + 30.0 / 25.0);
        assert!((small - 30.0 * libm::tanf(0.1 * lock30) / 2.6).abs() < 1e-5 && small < fast / 2.0);
        // Reverse flips it.
        assert!(a.grip_yaw(1.0, -3.0, 3.0, 0.55, 25.0, 2.6, 1.0) < 0.0);
    }

    #[test]
    fn a_punch_starts_a_slide_only_on_a_driven_rear() {
        let mut a = cruz();
        let dt = 1.0 / 120.0;
        let mut st = ArcadeState::default();
        let idle = Controls {
            throttle: 0.0,
            brake: 0.0,
            steer: 1.0,
        };
        let punch = Controls {
            throttle: 1.0,
            ..idle
        };
        a.step_slide(&mut st, idle, 6.0, dt);
        a.step_slide(&mut st, punch, 6.0, dt);
        assert_eq!(st.slide, 0.0, "the front-driven Cruz never power-slides");
        a.punch_slide = 1.0;
        let mut st = ArcadeState::default();
        a.step_slide(&mut st, idle, 6.0, dt);
        a.step_slide(&mut st, punch, 6.0, dt);
        assert_eq!(st.slide, 1.0);
        // Held power keeps it; letting go of the throttle brings grip back.
        for _ in 0..60 {
            a.step_slide(&mut st, punch, 6.0, dt);
        }
        assert_eq!(st.slide, 1.0);
        for _ in 0..120 {
            a.step_slide(&mut st, idle, 6.0, dt);
        }
        assert_eq!(st.slide, 0.0);
        // A slow roll-on is no punch.
        let mut st = ArcadeState::default();
        for i in 0..=60 {
            let t = i as f32 / 60.0;
            a.step_slide(
                &mut st,
                Controls {
                    throttle: t,
                    ..idle
                },
                6.0,
                dt,
            );
        }
        assert_eq!(st.slide, 0.0, "{st:?}");
    }
}
