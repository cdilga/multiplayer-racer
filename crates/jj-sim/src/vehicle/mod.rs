//! How a car's controls become wheel and body commands (P1-S03a, plan §7.3). Pure functions of the profile, the
//! applied input and the car's state, so feel changes are data (`assets/profiles/*.json`) and testable without a world.
//!
//! - **Steer/throttle/brake/reverse:** DRIVE x steers, with less lock as speed rises. Up throttles; down (brake, or a
//!   negative throttle) brakes, and reverses once the car is nearly stopped. Throttle while rolling backwards brakes
//!   first.
//! - **Surfaces:** each wheel's grip is the profile's multiplier for the ground class under it.
//! - **Air control:** with no wheel on the ground, DRIVE y pitches and DRIVE x rolls the body, gently.

use jj_map::model::{Surface, Terrain};
use jj_types::axis::dequantise_axis;

use crate::journal::DriveInput;
use crate::profile::{Drive, VehicleProfile};

/// Rapier's raycast vehicle moves each tyre's side impulse most of the way up to the centre of mass before applying it
/// (its private `roll_influence`, 0.1 as in Bullet), which cuts body roll by 90 %. The profile's `roll_influence` is the
/// share the sim wants; [`crate::sim::Sim::step`] puts back the difference after `update_vehicle`.
pub const ROLL_INFLUENCE_RAPIER: f32 = 0.1;

/// What one wheel does this tick.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelCommand {
    pub steering: f32,
    pub engine_force: f32,
    /// Rapier's `brake` is an impulse per tick: force × dt.
    pub brake_impulse: f32,
    pub friction_slip: f32,
}

/// DRIVE y as (up, down), each 0..1: throttle drives, brake (or a negative throttle, the stick pulled down) brakes.
fn stick(input: DriveInput) -> (f32, f32) {
    let throttle = dequantise_axis(input.throttle);
    let down = (dequantise_axis(input.brake).max(0.0) + (-throttle).max(0.0)).min(1.0);
    (throttle.max(0.0), down)
}

/// A car's ACTION-stick state (§7.3): the boost meter (0..1) and how far into a drift the rear tyres are (0 gripping,
/// 1 drifting).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ActionState {
    pub boost: f32,
    pub drift: f32,
    /// Boosting this tick (held and the meter not empty).
    pub boosting: bool,
    /// Boost can start: false once a burst has emptied the meter, until boost is let go (re-armed on release, like
    /// the ACTION stick's sectors).
    pub armed: bool,
    /// Ticks left of a well-timed wheelie's extra drive (P1-S03c).
    pub wheelie_ticks: u32,
    /// The ACTION utilities (P1-S08), indexed by [`crate::utility::UtilityKind::index`]: the tick each can next fire
    /// (game time), and how many have fired over the round.
    pub utility_ready: [u64; 2],
    pub utility_fired: [u32; 2],
    /// The tick the wheelie launch can next fire (the cooldown, P1-C11).
    pub wheelie_ready: u64,
    /// R120: seconds of real drift held so far (the handbrake on, rear sliding, at speed), and the drift-exit boost's
    /// ticks left once it's let go ("drop a gear and disappear"); how many exit boosts this car has fired.
    pub drift_held_s: f32,
    pub exit_boost_ticks: u32,
    pub exit_boosts: u32,
}

impl ActionState {
    pub fn new(p: &VehicleProfile) -> Self {
        Self {
            boost: p.tuning.boost_start.clamp(0.0, 1.0),
            drift: 0.0,
            boosting: false,
            armed: true,
            wheelie_ticks: 0,
            utility_ready: [0; 2],
            utility_fired: [0; 2],
            wheelie_ready: 0,
            drift_held_s: 0.0,
            exit_boost_ticks: 0,
            exit_boosts: 0,
        }
    }

    /// One tick: the drift blend follows the handbrake (on at once, back to grip over `drift_recovery_s`); boosting
    /// drains the meter, not boosting refills it, and a real drift (rear slip and speed over their minimums) refills
    /// more.
    pub fn update(
        &mut self,
        p: &VehicleProfile,
        input: DriveInput,
        rear_slip_deg: f32,
        speed: f32,
        dt: f32,
    ) {
        let t = &p.tuning;
        self.wheelie_ticks = self.wheelie_ticks.saturating_sub(1);
        self.exit_boost_ticks = self.exit_boost_ticks.saturating_sub(1);
        // R120: a held drift banks exit boost; letting the handbrake go after at least `drift_exit_min_s` of it fires a
        // burst of `drift_exit_boost_per_s` seconds per second held (up to `drift_exit_boost_max_s`).
        let real = self.drift > 0.5
            && rear_slip_deg >= t.drift_exit_min_slip_deg
            && speed >= t.drift_charge_min_mps;
        if input.drift {
            if real {
                self.drift_held_s += dt;
            }
        } else if self.drift_held_s > 0.0 {
            if t.drift_exit_boost_per_s > 0.0 && self.drift_held_s >= t.drift_exit_min_s {
                let s =
                    (self.drift_held_s * t.drift_exit_boost_per_s).min(t.drift_exit_boost_max_s);
                self.exit_boost_ticks = libm::roundf(s * crate::sim::TICK_HZ as f32) as u32;
                self.exit_boosts += 1;
            }
            self.drift_held_s = 0.0;
        }
        self.drift = if input.drift {
            1.0
        } else {
            (self.drift - dt / t.drift_recovery_s).max(0.0)
        };
        // A burst starts from `boost_min_start` of meter and runs while held, down to empty; an empty meter ends it
        // until boost is let go. So holding boost forever is one burst, and boosting again means choosing when
        // (§7.3a "boost-forever isn't the best line").
        if !input.boost {
            self.armed = true;
        }
        let metered = input.boost
            && self.armed
            && (self.boost >= t.boost_min_start || (self.boosting && self.boost > 0.0));
        // The exit boost is boost (the same drive, flame and sound), but free: it never drains the meter.
        self.boosting = metered || self.exit_boost_ticks > 0;
        if metered {
            self.boost -= t.boost_drain_per_s * dt;
            if self.boost <= 0.0 {
                self.armed = false;
            }
        } else {
            self.boost += t.boost_recharge_per_s * dt;
        }
        if self.drift > 0.5
            && rear_slip_deg >= t.drift_charge_min_slip_deg
            && speed >= t.drift_charge_min_mps
        {
            self.boost += t.drift_charge_per_s * dt;
        }
        self.boost = self.boost.clamp(0.0, 1.0);
    }
}

/// The four wheels' commands (FL, FR, RL, RR) for `input` at `forward_speed` m/s, on ground with `grip[i]` under wheel
/// `i`, for a tick of `dt` seconds, with the car's ACTION state (`action.update` already run this tick).
pub fn wheel_commands(
    p: &VehicleProfile,
    input: DriveInput,
    action: ActionState,
    forward_speed: f32,
    grip: [f32; 4],
    dt: f32,
) -> [WheelCommand; 4] {
    let t = &p.tuning;
    let (throttle, brake) = stick(input);
    let steer = dequantise_axis(input.steer);
    let driven = |i: usize| match t.drive {
        Drive::Front => i < 2,
        Drive::Rear => i >= 2,
        Drive::All => true,
    };
    let n_driven = (0..4).filter(|&i| driven(i)).count() as f32;
    // Boost is full forward drive and then some, whatever DRIVE says: letting go of it is how a booster slows for a
    // corner (§7.3a "boost-forever isn't the best line"). Otherwise down brakes while rolling forward and reverses near
    // rest, and up drives forward but brakes while rolling backwards.
    // Forward drive is power-limited: the force falls as power / speed once past the crossover, so a car has a top
    // speed and boost is worth most at low speed (a corner exit), least flat out.
    let drive = |force: f32, power: f32| {
        if t.max_engine_power_w > 0.0 {
            force.min(power / forward_speed.max(1.0))
        } else {
            force
        }
    };
    let (engine, braking) = if action.boosting {
        let gain = 1.0 + t.boost_engine_gain;
        (
            drive(t.max_engine_force * gain, t.max_engine_power_w * gain),
            0.0,
        )
    } else if brake > 0.0 {
        if forward_speed > t.reverse_below_mps || input.no_reverse {
            (0.0, brake)
        } else {
            (-brake * t.max_reverse_force, 0.0)
        }
    } else if throttle > 0.0 && forward_speed < -t.reverse_below_mps {
        (0.0, throttle)
    } else {
        (
            drive(
                throttle * t.max_engine_force,
                throttle * t.max_engine_power_w,
            ),
            0.0,
        )
    };
    // A well-timed wheelie launches: more forward drive for a moment.
    let engine = if action.wheelie_ticks > 0 && engine > 0.0 {
        engine * (1.0 + t.wheelie_drive_gain)
    } else {
        engine
    };
    // The handbrake drift loosens the rear tyres.
    let rear_grip = 1.0 - action.drift * (1.0 - t.drift_rear_grip);
    let lock = p.steer_lock(forward_speed);
    let mut out = [WheelCommand::default(); 4];
    for (i, w) in out.iter_mut().enumerate() {
        w.steering = if i < 2 { steer * lock } else { 0.0 };
        // Rapier ignores `brake` while an engine force is set.
        if braking > 0.0 {
            w.brake_impulse = braking * t.max_brake_force / 4.0 * dt;
        } else if driven(i) {
            w.engine_force = engine / n_driven;
        }
        w.friction_slip = t.friction_slip * grip[i] * if i >= 2 { rear_grip } else { 1.0 };
    }
    out
}

/// The ground class at world `(x, z)`: the terrain grid's nearest sample (outside the grid is off-track).
pub fn surface_at(terrain: &Terrain, x: f32, z: f32) -> Surface {
    let spacing = terrain.spacing as f32 / 1000.0;
    let col = libm::roundf((x - terrain.origin_x as f32 / 1000.0) / spacing);
    let row = libm::roundf((z - terrain.origin_z as f32 / 1000.0) / spacing);
    if col < 0.0 || row < 0.0 || col >= terrain.cols as f32 || row >= terrain.rows as f32 {
        return Surface::OffTrack;
    }
    terrain.surfaces[row as usize * terrain.cols as usize + col as usize]
}

/// Air control: the body-space torque (x pitches, z rolls) for `input`, N·m. Pushing up noses down; steering left
/// drops the left side.
pub fn air_torque(p: &VehicleProfile, input: DriveInput) -> [f32; 3] {
    let t = &p.tuning;
    let (up, down) = stick(input);
    let stick_y = up - down;
    let steer = dequantise_axis(input.steer);
    // +x is the car's left: a positive turn about it lowers the nose. A positive turn about +z (forward) lifts the
    // left side, so steering left (positive) turns the other way.
    [
        stick_y * t.air_pitch_torque,
        0.0,
        -steer * t.air_roll_torque,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_types::axis::quantise_axis;

    fn input(throttle: f32, steer: f32, brake: f32) -> DriveInput {
        DriveInput {
            throttle: quantise_axis(throttle),
            steer: quantise_axis(steer),
            brake: quantise_axis(brake),
            ..Default::default()
        }
    }

    #[test]
    fn brake_brakes_when_rolling_and_reverses_near_rest() {
        let p = VehicleProfile::cruz();
        let rolling = wheel_commands(
            &p,
            input(0.0, 0.0, 1.0),
            ActionState::default(),
            10.0,
            [1.0; 4],
            1.0 / 120.0,
        );
        assert!(
            rolling
                .iter()
                .all(|w| w.brake_impulse > 0.0 && w.engine_force == 0.0)
        );
        let stopped = wheel_commands(
            &p,
            input(0.0, 0.0, 1.0),
            ActionState::default(),
            0.0,
            [1.0; 4],
            1.0 / 120.0,
        );
        assert!(stopped[2].engine_force < 0.0 && stopped.iter().all(|w| w.brake_impulse == 0.0));
        let backwards = wheel_commands(
            &p,
            input(1.0, 0.0, 0.0),
            ActionState::default(),
            -5.0,
            [1.0; 4],
            1.0 / 120.0,
        );
        assert!(
            backwards
                .iter()
                .all(|w| w.brake_impulse > 0.0 && w.engine_force == 0.0)
        );
    }

    #[test]
    fn steering_lock_falls_with_speed_and_grip_follows_the_surface() {
        let p = VehicleProfile::cruz();
        let slow = wheel_commands(
            &p,
            input(0.0, 1.0, 0.0),
            ActionState::default(),
            0.0,
            [1.0, 0.8, 0.7, 0.9],
            1.0 / 120.0,
        );
        let fast = wheel_commands(
            &p,
            input(0.0, 1.0, 0.0),
            ActionState::default(),
            30.0,
            [1.0; 4],
            1.0 / 120.0,
        );
        assert!(fast[0].steering < slow[0].steering && slow[2].steering == 0.0);
        let base = p.tuning.friction_slip;
        assert_eq!(
            slow.map(|w| w.friction_slip),
            [base, base * 0.8, base * 0.7, base * 0.9]
        );
    }
}

#[cfg(test)]
mod r120_tests {
    use super::*;

    /// R120: a held real drift, let go, fires the exit boost for the profile's seconds per second held; it is boost
    /// (`boosting`) without draining the meter.
    #[test]
    fn letting_go_of_a_held_drift_fires_a_free_exit_boost() {
        let p = VehicleProfile::cruz();
        let t = &p.tuning;
        let mut a = ActionState::new(&p);
        let dt = 1.0 / crate::sim::TICK_HZ as f32;
        let drift = DriveInput {
            drift: true,
            ..DriveInput::default()
        };
        for _ in 0..crate::sim::TICK_HZ {
            a.update(&p, drift, 20.0, 15.0, dt);
        }
        assert!(
            a.drift_held_s > 0.9,
            "one second of real drift held: {}",
            a.drift_held_s
        );
        let meter = a.boost;
        a.update(&p, DriveInput::default(), 0.0, 15.0, dt);
        let want = (1.0 * t.drift_exit_boost_per_s).min(t.drift_exit_boost_max_s);
        assert!(
            a.exit_boost_ticks as f32 / crate::sim::TICK_HZ as f32 > want * 0.9,
            "{a:?}"
        );
        assert!(a.boosting && a.exit_boosts == 1, "{a:?}");
        assert!(a.boost >= meter, "free: the meter doesn't drain");
    }
}
