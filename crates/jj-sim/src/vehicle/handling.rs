//! Arcade handling (P1-FL04, R128): a lateral-grip layer per axle on top of Rapier's raycast vehicle.
//!
//! Rapier keeps the suspension, the contacts and the drive/brake impulses. Its side friction is a damper (each tick a
//! wheel pushes back 20 % of the sideways velocity at its contact, `resolve_single_unilateral`'s `contact_damping`),
//! which never saturates the way a tyre does and leaves the car pushing wide at speed (owner: "understeers all the
//! time"). With a profile's `tuning.handling` set, Rapier's side friction is off (`side_friction_stiffness = 0`) and
//! each grounded wheel gets a tyre force instead:
//!
//! - **Slip curve:** the force rises with the slip angle to its peak at `peak_slip_deg`, then falls to `slide_grip` of
//!   the peak by `slide_slip_deg` (a slide holds less than the limit, so a car can break away and be caught).
//! - **Per axle grip:** the peak is the wheel's friction coefficient (profile × ground × drift, as Rapier's
//!   `friction_slip`) times its axle's `front_grip`/`rear_grip`, times the wheel's load.
//! - **Shared grip:** drive and braking take their share first (a friction circle on the share of the wheel's drive
//!   grip in use, weighted by `drive_grip_share`), so a rear-driven car steps out under power and a front-driven one
//!   pushes.
//! - **Arcade weight transfer:** throttle and brake shift grip between the axles (`weight_transfer`, settling over
//!   `weight_transfer_s`), with no body pitch: lifting off moves grip to the front and rotates the car.
//! - **Steer to the peak:** at speed, the stick sets the front tyres' slip against the way the front axle is travelling
//!   (full stick at the peak, never past the profile's `max_steer_rad`), so they bite at the peak instead of ploughing
//!   past it, and with the stick centred the wheels follow the axle's travel like a caster; at walking pace the stick
//!   is the profile's plain lock.
//! - **Yaw-rate feel:** the stick asks for a yaw rate (`yaw_rate_deg_s`, reached by `yaw_rate_speed_mps`, never more
//!   than the grip can turn the car at that speed, μg / v); while the car turns slower than asked toward the stick a
//!   yaw impulse closes the gap, at most `yaw_accel_deg_s2`. It never slows a rotation, so the car still gets sideways.
//!
//! The axle grips are lateral only: drive and braking keep Rapier's `friction_slip` limit.
//!
//! Named presets (Kart, Rally, Hooligan) are data in `assets/profiles/handling-presets.json`.

use rapier3d::control::Wheel;
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};

/// The presets file, compiled in.
pub const PRESETS_JSON: &str = include_str!("../../../../assets/profiles/handling-presets.json");

/// Below this ground speed at the contact (m/s) the slip angle is taken against this speed instead: a car at rest
/// would otherwise read any sideways creep as a 90° slide.
const SLIP_FLOOR_MPS: f32 = 1.0;

const G: f32 = 9.81;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Handling {
    /// Peak-grip multipliers per axle, on the wheel's friction coefficient.
    pub front_grip: f32,
    pub rear_grip: f32,
    /// The slip angle (deg) of peak force on tarmac; a ground with `side_stiffness < 1` (R124) peaks later.
    pub peak_slip_deg: f32,
    /// Past the peak the force falls linearly to `slide_grip` × peak by this slip angle (deg), and stays there.
    pub slide_slip_deg: f32,
    pub slide_grip: f32,
    /// How much a wheel's drive or brake uses up its sideways grip: at a drive force of the wheel's whole drive grip
    /// (`friction_slip` × load), the sideways peak is √(1 − share²) of itself (0 none, 1 all of it).
    pub drive_grip_share: f32,
    /// Grip moved between the axles at full brake (to the front) or full throttle (to the rear), as a fraction.
    pub weight_transfer: f32,
    /// Time constant of that shift, s.
    pub weight_transfer_s: f32,
    /// The yaw rate full stick asks for at speed (deg/s), half of it at `yaw_rate_speed_mps`; 0 turns the helper off.
    pub yaw_rate_deg_s: f32,
    pub yaw_rate_speed_mps: f32,
    /// How fast the helper closes a shortfall (per s) and its largest angular acceleration (deg/s²).
    pub yaw_response_per_s: f32,
    pub yaw_accel_deg_s2: f32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PresetsFile {
    #[allow(dead_code)]
    note: String,
    presets: Vec<Preset>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Preset {
    id: String,
    #[allow(dead_code)]
    what: String,
    handling: Handling,
}

impl Handling {
    /// The named presets, in file order: `(id, handling)`.
    pub fn presets() -> Vec<(String, Handling)> {
        let f: PresetsFile =
            serde_json::from_str(PRESETS_JSON).expect("the compiled-in handling presets parse");
        f.presets.into_iter().map(|p| (p.id, p.handling)).collect()
    }

    pub fn preset(id: &str) -> Option<Handling> {
        Self::presets()
            .into_iter()
            .find(|(k, _)| k == id)
            .map(|(_, h)| h)
    }

    /// The share of peak force at slip angle `alpha_deg` on a ground whose slip curve is `side_stiffness` (R124).
    pub fn curve(&self, alpha_deg: f32, side_stiffness: f32) -> f32 {
        let k = side_stiffness.max(0.05);
        let (peak, slide) = (self.peak_slip_deg / k, self.slide_slip_deg / k);
        let a = alpha_deg.abs();
        if a <= peak {
            a / peak
        } else if a >= slide {
            self.slide_grip
        } else {
            1.0 - (1.0 - self.slide_grip) * (a - peak) / (slide - peak)
        }
    }

    /// The axle's grip multiplier with the load shift (`shift` +1 all forward under braking, −1 all back under power).
    pub fn axle_grip(&self, front: bool, shift: f32) -> f32 {
        if front {
            self.front_grip * (1.0 + self.weight_transfer * shift)
        } else {
            self.rear_grip * (1.0 - self.weight_transfer * shift)
        }
    }

    /// One tick of the load shift toward `brake − throttle` (boost counts as full throttle).
    pub fn step_shift(&self, shift: f32, throttle: f32, brake: f32, dt: f32) -> f32 {
        let target = (brake - throttle).clamp(-1.0, 1.0);
        let k = (dt / self.weight_transfer_s.max(dt)).min(1.0);
        shift + (target - shift) * k
    }

    /// The lateral acceleration the weaker axle holds at its peak, m/s², for a wheel friction coefficient `mu`.
    pub fn lateral_g(&self, mu: f32) -> f32 {
        mu * self.front_grip.min(self.rear_grip) * G
    }

    /// The front wheels' angle (rad, + left) for `steer` (−1..1) at `speed` m/s, with the front axle travelling at
    /// `front_beta` rad off the car's nose (+ left): at speed the stick sets the front tyres' slip against the way the
    /// axle is actually moving, full stick at their peak (so they never plough past it), a centred stick none (the
    /// wheels follow the axle's travel, as a caster does, so in an oversteer slide they point into it). At walking pace that angle means nothing, so below the
    /// speed where the grip's tightest corner needs full lock anyway (wheelbase × lateral / v² = lock − peak) it blends
    /// to the profile's `max_steer_rad`.
    pub fn steer_angle(
        &self,
        mu: f32,
        wheelbase: f32,
        max_steer_rad: f32,
        steer: f32,
        speed: f32,
        front_beta: f32,
    ) -> f32 {
        let peak = self.peak_slip_deg.to_radians();
        let room = (max_steer_rad - peak).max(1e-3);
        let blend_speed = libm::sqrtf(wheelbase * self.lateral_g(mu) / room);
        let w = (speed.abs() / blend_speed).min(1.0);
        let tracked = (front_beta + steer * peak).clamp(-max_steer_rad, max_steer_rad);
        steer * max_steer_rad * (1.0 - w) + tracked * w
    }

    /// The yaw rate (rad/s, + left) the stick asks for at `forward_speed` m/s, for a wheel friction coefficient `mu`:
    /// never more than the grip can turn the car at, lateral / v.
    pub fn target_yaw_rate(&self, steer: f32, forward_speed: f32, mu: f32) -> f32 {
        let v = forward_speed.abs();
        let rate = (self.yaw_rate_deg_s.to_radians() * v / (v + self.yaw_rate_speed_mps.max(0.1)))
            .min(self.lateral_g(mu) / v.max(1e-3));
        steer * rate * if forward_speed < 0.0 { -1.0 } else { 1.0 }
    }
}

/// Applies the layer to a car's chassis after Rapier's `update_vehicle`: each grounded wheel's tyre force, then the
/// yaw helper. `mu` is the profile's `friction_slip`, `front` is the number of front wheels, `side_stiffness[i]` the ground's slip-curve factor under wheel
/// `i`. The side forces act at the centre of mass's height (R122: the arcade grip leans and dives the body by
/// nothing; at three times Rapier's cornering force, its `roll_influence` lever rolled a car onto its sill). Returns the work the yaw helper added, J, for the energy ledger; the tyre forces only oppose
/// sliding.
#[allow(clippy::too_many_arguments)]
pub fn apply(
    h: &Handling,
    mu: f32,
    body: &mut RigidBody,
    wheels: &[Wheel],
    front: usize,
    side_stiffness: &[f32],
    shift: f32,
    steer: f32,
    dt: f32,
) -> f64 {
    let grounded: Vec<usize> = (0..wheels.len())
        .filter(|&i| {
            let w = &wheels[i];
            w.raycast_info().is_in_contact && w.wheel_suspension_force > 0.0
        })
        .collect();
    if grounded.is_empty() {
        return 0.0;
    }
    let n = grounded.len() as f32;
    let up = body.position().rotation * Vector::Y;
    let com = body.center_of_mass();
    let mp = body.mass_properties();
    let inv_m = mp.local_mprops.inv_mass;
    // The world inverse inertia tensor itself (parry's `world_inv_inertia`), whatever Rapier's field doc says about a
    // square root.
    let inv_i = mp.effective_world_inv_inertia;
    let mut impulses = Vec::with_capacity(grounded.len());
    for &i in &grounded {
        let w = &wheels[i];
        let ri = w.raycast_info();
        let nrm = ri.contact_normal_ws;
        let axle = (w.axle() - nrm * w.axle().dot(nrm)).normalize_or_zero();
        let fwd = nrm.cross(axle).normalize_or_zero();
        let at = ri.contact_point_ws;
        let v = body.velocity_at_point(at);
        let (vs, vf) = (v.dot(axle), v.dot(fwd));
        let mu = w.friction_slip * h.axle_grip(i < front, shift);
        let load = w.wheel_suspension_force.min(w.max_suspension_force);
        // The share of the wheel's drive grip (Rapier's own limit, `friction_slip` × load) its drive or brake uses.
        let used = ((w.forward_impulse / dt).abs() / (w.friction_slip * load).max(1e-3)).min(1.0)
            * h.drive_grip_share;
        let lateral_max = mu * load * libm::sqrtf((1.0 - used * used).max(0.0));
        let alpha = libm::atan2f(vs.abs(), vf.abs().max(SLIP_FLOOR_MPS)).to_degrees();
        let force = lateral_max * h.curve(alpha, side_stiffness.get(i).copied().unwrap_or(1.0));
        // Never more than stops this wheel's share of the sideways velocity at its contact this tick: the wheels act
        // on one body, so each takes 1/n of the impulse that would null it.
        let aj = (at - com).cross(axle);
        let m_eff = 1.0 / (inv_m + aj.dot(inv_i * aj));
        let j = (force * dt).min(vs.abs() * m_eff / n);
        if j > 0.0 {
            let point = at + up * up.dot(com - at);
            impulses.push((axle * (-j * vs.signum()), point));
        }
    }
    for (j, point) in impulses {
        body.apply_impulse_at_point(j, point, true);
    }
    // The yaw helper: rotation toward the stick, never against it.
    if h.yaw_rate_deg_s <= 0.0 || grounded.len() < 2 || steer == 0.0 {
        return 0.0;
    }
    let fwd = body.position().rotation * Vector::Z;
    let target = h.target_yaw_rate(steer, body.linvel().dot(fwd), mu);
    let w = body.angvel();
    let short = target - w.dot(up);
    if short * target.signum() <= 0.0 {
        return 0.0;
    }
    let dr = short * (h.yaw_response_per_s * dt).min(1.0);
    let cap = h.yaw_accel_deg_s2.to_radians() * dt;
    let dr = dr.clamp(-cap, cap);
    let ti = up * (dr / up.dot(inv_i * up));
    body.apply_torque_impulse(ti, true);
    f64::from(ti.dot(w))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_parse_and_curves_peak_then_fall() {
        let presets = Handling::presets();
        let ids: Vec<&str> = presets.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(ids, ["kart", "rally", "hooligan"]);
        for (id, h) in &presets {
            assert!((h.curve(h.peak_slip_deg, 1.0) - 1.0).abs() < 1e-6, "{id}");
            assert!(h.curve(h.peak_slip_deg / 2.0, 1.0) < 1.0, "{id}");
            assert!(
                (h.curve(h.slide_slip_deg * 2.0, 1.0) - h.slide_grip).abs() < 1e-6,
                "{id}"
            );
            // Dirt (side stiffness under 1) peaks at a larger slip.
            assert!(h.curve(h.peak_slip_deg, 0.6) < 1.0, "{id}");
        }
    }

    #[test]
    fn load_shift_moves_grip_forward_on_lift_and_brake() {
        let h = Handling::preset("rally").unwrap();
        let mut s = -1.0;
        for _ in 0..120 {
            s = h.step_shift(s, 0.0, 0.0, 1.0 / 120.0);
        }
        assert!(s.abs() < 0.05, "a lift settles to neutral, got {s}");
        assert!(h.axle_grip(true, 1.0) > h.axle_grip(true, 0.0));
        assert!(h.axle_grip(false, 1.0) < h.axle_grip(false, 0.0));
    }

    #[test]
    fn target_yaw_follows_the_stick_and_flips_in_reverse() {
        let h = Handling::preset("kart").unwrap();
        assert!(h.target_yaw_rate(1.0, 30.0, 2.0) > 0.0);
        assert!(h.target_yaw_rate(1.0, -5.0, 2.0) < 0.0);
        assert_eq!(h.target_yaw_rate(0.0, 30.0, 2.0), 0.0);
        // Grip-limited at speed: never more than lateral / v.
        let at40 = h.target_yaw_rate(1.0, 40.0, 2.0);
        assert!(at40 <= h.lateral_g(2.0) / 40.0 + 1e-6);
        // Full lock at a crawl; at speed, the peak slip off the axle's travel, into a slide when it points outside.
        assert!((h.steer_angle(2.0, 2.6, 0.55, 1.0, 0.0, 0.0) - 0.55).abs() < 1e-6);
        let peak = h.peak_slip_deg.to_radians();
        assert!((h.steer_angle(2.0, 2.6, 0.55, 1.0, 30.0, 0.05) - (0.05 + peak)).abs() < 1e-6);
        assert!(h.steer_angle(2.0, 2.6, 0.55, 1.0, 30.0, -0.3) < 0.0);
        assert!((h.steer_angle(2.0, 2.6, 0.55, 0.0, 30.0, -0.1) + 0.1).abs() < 1e-6);
        assert_eq!(h.steer_angle(2.0, 2.6, 0.55, 0.0, 30.0, 0.0), 0.0);
    }
}
