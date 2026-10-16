//! How a car's controls become wheel and body commands (P1-S03a, plan §7.3). Pure functions of the profile, the
//! applied input and the car's state, so feel changes are data (`assets/profiles/*.json`) and testable without a world.
//!
//! - **Steer/throttle/brake/reverse:** DRIVE x steers, with less lock as speed rises. Up throttles; down (brake, or a
//!   negative throttle) brakes, and reverses once the car is nearly stopped. Throttle while rolling backwards brakes
//!   first.
//! - **Surfaces:** each wheel's grip is the profile's multiplier for the ground class under it.
//! - **Air control:** with no wheel on the ground, DRIVE y pitches and DRIVE x rolls the body, gently.

pub mod arcade;

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
pub(crate) fn stick(input: DriveInput) -> (f32, f32) {
    let throttle = dequantise_axis(input.throttle);
    let down = (dequantise_axis(input.brake).max(0.0) + (-throttle).max(0.0)).min(1.0);
    (throttle.max(0.0), down)
}

/// A car's ACTION-stick state (§7.3): the boost meter (0..1), the wheelie and utilities, and the arcade controller's own
/// state (its slide, 0 gripping to 1 sliding, P1-FL04.2).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ActionState {
    pub boost: f32,
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
    /// R127: the launch snapped during the countdown; it is forfeited until `start_forfeit_s` after GO.
    pub false_start: bool,
    /// The arcade controller's state (P1-FL04.2): its slide, load shift and punch timer.
    pub arcade: arcade::ArcadeState,
}

impl ActionState {
    /// How far into a slide the car is: 0 gripping, 1 sliding (tyre smoke, squeal and the slide's boost charge).
    pub fn slide(&self) -> f32 {
        self.arcade.slide
    }
}

impl ActionState {
    pub fn new(p: &VehicleProfile) -> Self {
        Self {
            boost: p.tuning.boost_start.clamp(0.0, 1.0),
            boosting: false,
            armed: true,
            wheelie_ticks: 0,
            utility_ready: [0; 2],
            utility_fired: [0; 2],
            wheelie_ready: 0,
            false_start: false,
            arcade: arcade::ArcadeState::default(),
        }
    }

    /// One tick: boosting drains the meter, not boosting refills it, and a slide at speed (the arcade controller's,
    /// from last tick) refills more.
    pub fn update(&mut self, p: &VehicleProfile, input: DriveInput, speed: f32, dt: f32) {
        let t = &p.tuning;
        self.wheelie_ticks = self.wheelie_ticks.saturating_sub(1);
        // A burst starts from `boost_min_start` of meter and runs while held, down to empty; an empty meter ends it
        // until boost is let go. So holding boost forever is one burst, and boosting again means choosing when
        // (§7.3a "boost-forever isn't the best line").
        if !input.boost {
            self.armed = true;
        }
        let metered = input.boost
            && self.armed
            && (self.boost >= t.boost_min_start || (self.boosting && self.boost > 0.0));
        self.boosting = metered;
        if metered {
            self.boost -= t.boost_drain_per_s * dt;
            if self.boost <= 0.0 {
                self.armed = false;
            }
        } else {
            self.boost += t.boost_recharge_per_s * dt;
        }
        if self.slide() > 0.5 && speed >= t.slide_charge_min_mps {
            self.boost += t.slide_charge_per_s * dt;
        }
        self.boost = self.boost.clamp(0.0, 1.0);
    }
}

/// The four wheels' commands (FL, FR, RL, RR) for `input` at `forward_speed` m/s, on ground with `grip[i]` under wheel
/// `i`, for a tick of `dt` seconds, with the car's ACTION state (`action.update` already run this tick).
/// The boost's push on the body along the car's forward axis, N (0 when not boosting): the extra drive the boost adds
/// over full throttle, power-limited like the engine, so boost is worth most at low speed and lifts top speed a
/// little. It acts on the body rather than through the tyres: wheelspin can't swallow it (arcade fun pass,
/// br-gw74.13).
pub fn boost_thrust(p: &VehicleProfile, action: ActionState, forward_speed: f32) -> f32 {
    if !action.boosting {
        return 0.0;
    }
    let t = &p.tuning;
    let extra = t.boost_engine_gain;
    let force = t.max_engine_force * extra;
    if t.max_engine_power_w > 0.0 {
        force.min(t.max_engine_power_w * extra / forward_speed.max(1.0))
    } else {
        force
    }
}

pub fn wheel_commands(
    p: &VehicleProfile,
    input: DriveInput,
    action: ActionState,
    forward_speed: f32,
    grip: impl AsRef<[f32]>,
    dt: f32,
) -> Vec<WheelCommand> {
    let t = &p.tuning;
    let (throttle, brake) = stick(input);
    let steer = dequantise_axis(input.steer);
    // On the arcade controller the drivetrain is character, not traction (R138): every wheel drives, so a front-driven
    // car launches as hard as a rear-driven one, and the drive type shows in how the car slides (`arcade`).
    let driven = |i: usize| match t.drive {
        _ if t.arcade.is_some() => true,
        Drive::Front => i < p.front_wheels(),
        Drive::Rear => i >= p.front_wheels(),
        Drive::All => true,
    };
    let count = p.geometry.wheels.len();
    let grip = grip.as_ref();
    let n_driven = (0..count).filter(|&i| driven(i)).count() as f32;
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
        // Boosting holds full throttle through the tyres; the boost's extra drive is a push on the body
        // (`boost_thrust`), so a traction-limited launch still gets it (arcade fun pass, br-gw74.13).
        (drive(t.max_engine_force, t.max_engine_power_w), 0.0)
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
    let lock = p.steer_lock(forward_speed);
    let mut out = vec![WheelCommand::default(); count];
    for (i, w) in out.iter_mut().enumerate() {
        w.steering = if i < p.front_wheels() {
            steer * lock
        } else {
            0.0
        };
        // Rapier ignores `brake` while an engine force is set.
        if braking > 0.0 {
            w.brake_impulse = braking * t.max_brake_force / count as f32 * dt;
        } else if driven(i) {
            w.engine_force = engine / n_driven;
        }
        w.friction_slip = t.friction_slip * grip[i];
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
        assert!(
            stopped
                .iter()
                .all(|w| w.engine_force < 0.0 && w.brake_impulse == 0.0),
            "reverse drives every wheel on the arcade controller"
        );
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
            slow.iter().map(|w| w.friction_slip).collect::<Vec<_>>(),
            vec![base, base * 0.8, base * 0.7, base * 0.9]
        );
    }
}
