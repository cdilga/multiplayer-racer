//! Air control and landing tiers (R129, P1-FL07; `docs/research/fun-tracks.md` R14–R16), from one global profile
//! (`assets/profiles/air.json`, R15: the same for every car and every jump).
//!
//! **In the air** DRIVE y pitches the car as the wheels' reaction would (owner playtest 2026-10-17, br-bbki.24): throttle
//! spins the wheels up and drops the rear (nose up), brake stops them and rotates the nose down. DRIVE x yaws it. They are body
//! *rates*: each tick the sim turns the gap between the car's body rate and the wanted one into an angular impulse
//! through the car's own inertia, closing it within `responseS`. So every car turns at the same degrees per second.
//! Roll is held level. A neutral stick holds the attitude the car left the lip with, so the jump's geometry decides
//! where neutral lands (R14), and the player's pitch is the skill.
//!
//! **Landing.** After at least `minAirS` in the air, the first wheel contact is judged on the angle between the car's up
//! and the ground's normal there:
//! - **Clean:** within `cleanDeg`, with every attached wheel down within `allWheelsS`. The car is pushed toward
//!   `1 + gain` times its landing speed for `seconds`, one tier up after a long flight.
//! - **OK:** nothing.
//! - **Bad:** from `badDeg` to `crashDeg`. The car loses `speedLoss` of its speed.
//! - **Crash:** past `crashDeg`, or the body hits the ground before any wheel (roof or side first). The car self-rights
//!   within `rightWithinS`.
//!
//! Everything here is pure arithmetic on plain arrays (body frame: +x the car's left, +y up, +z forward); the sim owns the
//! bodies and applies what this asks for, integrated once per tick.

use serde::{Deserialize, Serialize};

use crate::journal::DriveInput;
use jj_types::axis::dequantise_axis;

pub const AIR_JSON: &str = include_str!("../../../assets/profiles/air.json");
const CONTRACT: &str = "jj-air/1";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AirProfile {
    pub contract: String,
    #[serde(default)]
    pub what: String,
    /// Full DRIVE y: the pitch rate the car is driven to, deg/s (R15: corrects 30° in ≤ 0.4 s).
    pub pitch_rate_dps: f32,
    /// Full DRIVE x: the yaw rate, deg/s.
    pub yaw_rate_dps: f32,
    /// Roll is driven back to level at this many radians per second per radian of roll.
    pub roll_level_per_s: f32,
    /// The time constant that closes the gap to the wanted rates, s.
    pub response_s: f32,
    /// Air control takes over this long into a flight; before it a crest hop is still the ground's (the car levels
    /// itself, so a held throttle never noses it into the road over a crest: owner playtest 1).
    pub control_after_s: f32,
    /// A horizontal velocity change of more than this in one tick (m/s) is a hit, not a launch: a car knocked into the air
    /// by it keeps the ground's levelling for that flight (a kicker's lip turns the velocity upward, not sideways).
    pub knock_dv_mps: f32,
    /// The steer held at takeoff doesn't yaw the car until it has moved `latch_release_stick` from it (a steer held
    /// through a bend is a habit, not an air input). The throttle isn't latched (br-bbki.24).
    pub latch_held_input: bool,
    pub latch_release_stick: f32,
    /// A throttle held through the lip starts raising the nose this long into a flight (br-bbki.24): a crest hop at full
    /// throttle never tips a car (or flips a bike) backwards, and a pinned throttle still over-rotates a real jump.
    pub throttle_latch_s: f32,
    /// Shorter flights (a bump, a kerb) aren't landings.
    pub min_air_s: f32,
    pub bands: Bands,
    pub clean: Boost,
    pub clean_long: LongBoost,
    pub bad: Bad,
    pub crash: Crash,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bands {
    pub clean_deg: f32,
    pub bad_deg: f32,
    pub crash_deg: f32,
    /// A clean landing puts every attached wheel down within this of the first, s.
    pub all_wheels_s: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Boost {
    /// The speed aimed for is `1 + gain` times the landing speed.
    pub gain: f32,
    pub seconds: f32,
    /// How hard the boost pushes toward that speed, m/s².
    pub accel_mps2: f32,
}

/// A clean landing after at least `air_s` in the air earns this tier instead (CTR's hang-time tiers).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LongBoost {
    pub air_s: f32,
    pub gain: f32,
    pub seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bad {
    /// The share of the car's speed a bad landing takes away.
    pub speed_loss: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Crash {
    /// A crashed car is back on its wheels within this, s (R138: no flip traps).
    pub right_within_s: f32,
    /// The most it is turned toward upright while being righted, deg/s.
    pub right_rate_dps: f32,
}

impl AirProfile {
    /// The shipped profile.
    pub fn standard() -> Self {
        Self::from_json(AIR_JSON).expect("assets/profiles/air.json is valid")
    }

    pub fn from_json(text: &str) -> Result<Self, String> {
        let p: Self = serde_json::from_str(text).map_err(|e| format!("air profile: {e}"))?;
        p.validate()?;
        Ok(p)
    }

    /// The same profile with each `(dotted path, json value)` set (`pitchRateDps`, `bands.cleanDeg`) for the owner tuning
    /// menu and `jj vehicle tune` (br-bbki.7.1). Refuses an unknown path, a section, `contract`/`what`, a value of the wrong
    /// type or one [`AirProfile::validate`] rejects; the original is untouched.
    pub fn with_fields(&self, set: &[(String, String)]) -> Result<Self, String> {
        let mut v = serde_json::to_value(self).map_err(|e| e.to_string())?;
        for (path, raw) in set {
            let value: serde_json::Value =
                serde_json::from_str(raw).map_err(|e| format!("{path}: {e}"))?;
            let mut slot = &mut v;
            for part in path.split('.') {
                slot = slot
                    .get_mut(part)
                    .ok_or_else(|| format!("no air field {path:?}"))?;
            }
            if slot.is_object() || path == "contract" || path == "what" {
                return Err(format!("{path}: not a tunable value"));
            }
            *slot = value;
        }
        let p: Self = serde_json::from_value(v)
            .map_err(|e| format!("air profile: {}", e.to_string().replace('\n', " ")))?;
        p.validate()?;
        Ok(p)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.contract != CONTRACT {
            return Err(format!("air profile contract must be {CONTRACT}"));
        }
        let positive = [
            ("pitchRateDps", self.pitch_rate_dps),
            ("yawRateDps", self.yaw_rate_dps),
            ("responseS", self.response_s),
            ("controlAfterS", self.control_after_s),
            ("knockDvMps", self.knock_dv_mps),
            ("latchReleaseStick", self.latch_release_stick),
            ("throttleLatchS", self.throttle_latch_s),
            ("minAirS", self.min_air_s),
            ("bands.allWheelsS", self.bands.all_wheels_s),
            ("clean.seconds", self.clean.seconds),
            ("clean.accelMps2", self.clean.accel_mps2),
            ("cleanLong.airS", self.clean_long.air_s),
            ("cleanLong.seconds", self.clean_long.seconds),
            ("crash.rightWithinS", self.crash.right_within_s),
            ("crash.rightRateDps", self.crash.right_rate_dps),
        ];
        for (name, v) in positive {
            if !(v.is_finite() && v > 0.0) {
                return Err(format!("air profile {name} must be positive"));
            }
        }
        if !(self.roll_level_per_s.is_finite() && self.roll_level_per_s >= 0.0) {
            return Err("air profile rollLevelPerS must not be negative".into());
        }
        let b = &self.bands;
        if !(0.0 < b.clean_deg
            && b.clean_deg < b.bad_deg
            && b.bad_deg < b.crash_deg
            && b.crash_deg <= 180.0)
        {
            return Err("air profile bands need 0 < cleanDeg < badDeg < crashDeg <= 180".into());
        }
        for (name, g) in [
            ("clean.gain", self.clean.gain),
            ("cleanLong.gain", self.clean_long.gain),
        ] {
            if !(0.0..=2.0).contains(&g) {
                return Err(format!("air profile {name} must be 0..2"));
            }
        }
        if !(0.0..1.0).contains(&self.bad.speed_loss) {
            return Err("air profile bad.speedLoss must be 0..1".into());
        }
        Ok(())
    }

    fn ticks(s: f32, hz: u32) -> u32 {
        libm::roundf(s * hz as f32).max(1.0) as u32
    }
}

/// DRIVE as air control reads it: y (throttle up, brake or reverse down) and x (steer, left positive).
pub fn sticks(input: DriveInput) -> (f32, f32) {
    let throttle = dequantise_axis(input.throttle);
    let down = (dequantise_axis(input.brake).max(0.0) + (-throttle).max(0.0)).min(1.0);
    (throttle.max(0.0) - down, dequantise_axis(input.steer))
}

/// The body rate change (rad/s, body frame) the air controller wants this tick for sticks `(stick_y, steer)` (after the
/// takeoff latch, [`AirState::air_sticks`]), a car with body rate `w_body` and roll `roll_rad` (positive lifts the left
/// side). A bike's roll is its own balance's, so it gets no roll term.
pub fn rate_change(
    p: &AirProfile,
    (stick_y, steer): (f32, f32),
    w_body: [f32; 3],
    roll_rad: f32,
    bike: bool,
    dt: f32,
) -> [f32; 3] {
    // A positive turn about +x (the car's left) lowers the nose; one about +y turns the nose toward the left. Throttle
    // (stick_y > 0) raises the nose, brake lowers it (br-bbki.24).
    let want = [
        -stick_y * p.pitch_rate_dps.to_radians(),
        steer * p.yaw_rate_dps.to_radians(),
        -roll_rad * p.roll_level_per_s,
    ];
    let k = (dt / p.response_s).min(1.0);
    [
        (want[0] - w_body[0]) * k,
        (want[1] - w_body[1]) * k,
        if bike { 0.0 } else { (want[2] - w_body[2]) * k },
    ]
}

/// The world rate change (rad/s) that turns a crashed car with up `up` and world rate `w` toward upright: about
/// `up × world-up` at up to `crash.rightRateDps`, slowing as it gets there; spin about world-up is left alone.
pub fn righting_change(p: &AirProfile, up: [f32; 3], w: [f32; 3], dt: f32) -> [f32; 3] {
    let [ux, uy, uz] = up;
    // up × (0, 1, 0)
    let (ax, az) = (-uz, ux);
    let s = libm::hypotf(ax, az);
    let angle = libm::atan2f(s, uy);
    let max = p.crash.right_rate_dps.to_radians();
    // Upside down the axis is undefined: roll over the car's side (its up's horizontal part is ~0, so pick +z's).
    let (nx, nz) = if s > 1e-3 {
        (ax / s, az / s)
    } else {
        (0.0, 1.0)
    };
    let rate = (angle * 4.0).min(max);
    let want = [nx * rate, w[1], nz * rate];
    let k = (dt / p.response_s).min(1.0);
    [(want[0] - w[0]) * k, 0.0, (want[2] - w[2]) * k]
}

/// How a landing went.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LandingTier {
    Clean,
    Ok,
    Bad,
    Crash,
}

impl LandingTier {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// A judged landing.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Landing {
    pub tier: LandingTier,
    /// Between the car's up and the ground's normal at first contact, degrees.
    pub angle_deg: f32,
    pub airtime_s: f32,
    /// Every attached wheel was down within `allWheelsS` of the first.
    pub all_wheels: bool,
    /// A clean landing after a long flight (the higher boost tier).
    pub long: bool,
}

/// One tick's contact facts for the judge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Touch {
    /// Wheels pressing on the ground.
    pub supported: usize,
    /// Wheels still attached.
    pub wheels: usize,
    /// The car's up · the ground's normal under the touching wheels (1 when level with it).
    pub cos_angle: f32,
    /// The body itself touched the ground while no wheel was down (a bumper, the roof or a side first); `cos_angle` is
    /// then against the ground's normal where it touched.
    pub body_hit: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Pending {
    angle_deg: f32,
    air_ticks: u32,
    since: u32,
}

/// A car's air state: its flight, a landing being judged, and what the last landing earned.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AirState {
    air_ticks: u32,
    pending: Option<Pending>,
    /// Just placed (a spawn, a respawn, a teleport): the drop to the ground isn't a jump. It lasts until it has
    /// swallowed that touchdown or the car has been down for `minAirS`.
    placed: bool,
    ground_ticks: u32,
    /// Hit hard (a wall, a rail, a car) since it was last settled on its wheels: this flight isn't a jump.
    knocked: bool,
    /// The sticks last held on the ground, the ones latched at takeoff, and which latched axes have since been moved.
    ground_sticks: (f32, f32),
    latched: Option<(f32, f32)>,
    armed: (bool, bool),
    /// Ticks of landing boost left, and the speed it pushes toward (m/s).
    pub boost_ticks: u32,
    pub boost_target: f32,
    /// Ticks left in which a crashed car is being righted.
    pub righting_ticks: u32,
    pub last: Option<Landing>,
    pub landings: u32,
}

impl AirState {
    /// A car just put down somewhere: its first touchdown is a settle, not a landing (no respawn boosts).
    pub fn placed() -> Self {
        Self {
            placed: true,
            ..Self::default()
        }
    }

    /// Ticks in the air so far this flight (0 on the ground or while a landing is judged).
    pub fn flight_ticks(&self) -> u32 {
        if self.pending.is_some() {
            0
        } else {
            self.air_ticks
        }
    }

    /// Air control has the car: it has been in the air past `controlAfterS`, on a jump (not knocked there, and not
    /// settling after being put down).
    pub fn flying(&self, p: &AirProfile, hz: u32) -> bool {
        !self.knocked
            && !self.placed
            && self.flight_ticks() >= AirProfile::ticks(p.control_after_s, hz)
    }

    /// The sticks this tick (`sticks`), on the ground or in the air: the ground's are latched at takeoff.
    pub fn feed(&mut self, sticks: (f32, f32), airborne: bool) {
        if airborne {
            self.latched.get_or_insert(self.ground_sticks);
        } else {
            self.ground_sticks = sticks;
            self.latched = None;
            self.armed = (false, false);
        }
    }

    /// The sticks air control acts on: an axis still where it was held at takeoff reads neutral (`latchHeldInput`).
    pub fn air_sticks(&mut self, p: &AirProfile, hz: u32, (y, x): (f32, f32)) -> (f32, f32) {
        if !p.latch_held_input {
            return (y, x);
        }
        let (ly, lx) = self.latched.unwrap_or((0.0, 0.0));
        self.armed.0 |= (y - ly).abs() > p.latch_release_stick;
        self.armed.1 |= (x - lx).abs() > p.latch_release_stick;
        // A throttle held through the lip keeps spinning the wheels: once the car is properly airborne
        // (`throttleLatchS`) it raises the nose, so a pinned throttle over-rotates a long jump (br-bbki.24: it used to
        // read neutral all flight, the easy answer). A held steer stays latched.
        let pitch_live =
            self.armed.0 || self.flight_ticks() >= AirProfile::ticks(p.throttle_latch_s, hz);
        (
            if pitch_live { y } else { 0.0 },
            if self.armed.1 { x } else { 0.0 },
        )
    }

    /// The chassis' horizontal velocity changed by `dv` (m/s) this tick: past `knockDvMps` it was hit, not launched.
    pub fn note_hit(&mut self, p: &AirProfile, dv: f32) {
        if dv > p.knock_dv_mps {
            self.knocked = true;
        }
    }

    /// Steps the judge one tick at `hz`; returns a landing once it's decided.
    pub fn tick(&mut self, p: &AirProfile, hz: u32, t: Touch) -> Option<Landing> {
        let min_air = AirProfile::ticks(p.min_air_s, hz);
        let all_within = AirProfile::ticks(p.bands.all_wheels_s, hz);
        if let Some(mut pend) = self.pending {
            pend.since += 1;
            let all = t.wheels > 0 && t.supported >= t.wheels;
            if all || pend.since >= all_within {
                self.pending = None;
                return Some(self.decide(p, hz, pend, all));
            }
            self.pending = Some(pend);
            return None;
        }
        if t.supported == 0 && !t.body_hit {
            self.air_ticks = self.air_ticks.saturating_add(1);
            self.ground_ticks = 0;
            return None;
        }
        self.ground_ticks = self.ground_ticks.saturating_add(1);
        if self.ground_ticks >= min_air {
            self.placed = false;
        }
        if self.ground_ticks >= AirProfile::ticks(p.control_after_s, hz) {
            self.knocked = false;
        }
        let flight = std::mem::take(&mut self.air_ticks);
        if flight < min_air {
            return None;
        }
        // A drop after being put down, or a flight a hit threw it into, isn't a jump: no landing to judge.
        if std::mem::take(&mut self.placed) || self.knocked {
            return None;
        }
        if t.supported == 0 {
            // The body came down first (a bumper, the roof, a side): judged on its angle to the ground where it touched,
            // never clean. Roof or side first is past `crashDeg` by its angle.
            let angle_deg = libm::acosf(t.cos_angle.clamp(-1.0, 1.0)).to_degrees();
            return Some(self.decide(
                p,
                hz,
                Pending {
                    angle_deg,
                    air_ticks: flight,
                    since: 0,
                },
                false,
            ));
        }
        let pend = Pending {
            angle_deg: libm::acosf(t.cos_angle.clamp(-1.0, 1.0)).to_degrees(),
            air_ticks: flight,
            since: 0,
        };
        if t.supported >= t.wheels {
            return Some(self.decide(p, hz, pend, true));
        }
        self.pending = Some(pend);
        None
    }

    fn decide(&mut self, p: &AirProfile, hz: u32, pend: Pending, all_wheels: bool) -> Landing {
        let airtime_s = pend.air_ticks as f32 / hz as f32;
        let b = &p.bands;
        let tier = if pend.angle_deg > b.crash_deg {
            LandingTier::Crash
        } else if pend.angle_deg >= b.bad_deg {
            LandingTier::Bad
        } else if pend.angle_deg <= b.clean_deg && all_wheels {
            LandingTier::Clean
        } else {
            LandingTier::Ok
        };
        let landing = Landing {
            tier,
            angle_deg: pend.angle_deg,
            airtime_s,
            all_wheels,
            long: tier == LandingTier::Clean && airtime_s >= p.clean_long.air_s,
        };
        self.last = Some(landing);
        self.landings += 1;
        landing
    }

    /// Starts what `landing` earned for a car moving at `speed` (m/s along its heading); returns the share of its
    /// velocity it keeps now (1 unless the landing was bad).
    pub fn reward(&mut self, p: &AirProfile, hz: u32, landing: Landing, speed: f32) -> f32 {
        match landing.tier {
            LandingTier::Clean => {
                let (gain, s) = if landing.long {
                    (p.clean_long.gain, p.clean_long.seconds)
                } else {
                    (p.clean.gain, p.clean.seconds)
                };
                self.boost_ticks = AirProfile::ticks(s, hz);
                self.boost_target = speed.max(0.0) * (1.0 + gain);
                1.0
            }
            LandingTier::Ok => 1.0,
            LandingTier::Bad => 1.0 - p.bad.speed_loss,
            LandingTier::Crash => {
                self.boost_ticks = 0;
                self.righting_ticks = AirProfile::ticks(p.crash.right_within_s, hz);
                1.0
            }
        }
    }

    /// This tick's landing-boost speed change (m/s along the heading) for a car at `speed`, and counts the boost down.
    /// Nothing once the boost is over or the car is already at its target; braking (`down` past a light touch) ends it.
    pub fn boost_dv(&mut self, p: &AirProfile, dt: f32, speed: f32, down: f32) -> f32 {
        if down > 0.1 {
            self.boost_ticks = 0;
        }
        if self.boost_ticks == 0 {
            return 0.0;
        }
        self.boost_ticks -= 1;
        (self.boost_target - speed).clamp(0.0, p.clean.accel_mps2 * dt)
    }

    /// Whether a crashed car is still being righted this tick (counts down; `upright` ends it early).
    pub fn righting(&mut self, upright: bool) -> bool {
        if upright {
            self.righting_ticks = 0;
        }
        if self.righting_ticks == 0 {
            return false;
        }
        self.righting_ticks -= 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_types::axis::quantise_axis;

    const HZ: u32 = 120;

    #[test]
    fn with_fields_sets_leaves_and_refuses_the_rest() {
        let p = AirProfile::standard();
        let set = |f: &str, v: &str| p.with_fields(&[(f.to_owned(), v.to_owned())]);
        let q = set("pitchRateDps", "140").unwrap();
        assert_eq!(q.pitch_rate_dps, 140.0);
        assert_eq!(set("bands.cleanDeg", "10").unwrap().bands.clean_deg, 10.0);
        assert_eq!(
            set("latchHeldInput", "false").unwrap().latch_held_input,
            false
        );
        assert_eq!(p, AirProfile::standard(), "the original is untouched");
        for (f, v) in [
            ("nope", "1"),
            ("bands", "1"),
            ("contract", "\"x\""),
            ("what", "\"x\""),
            ("pitchRateDps", "\"fast\""),
        ] {
            assert!(set(f, v).is_err(), "{f} = {v} is refused");
        }
        // The validator still holds: bands out of order are refused.
        assert!(set("bands.badDeg", "60").is_err());
    }

    fn input(throttle: f32, steer: f32, brake: f32) -> DriveInput {
        DriveInput {
            throttle: quantise_axis(throttle),
            steer: quantise_axis(steer),
            brake: quantise_axis(brake),
            ..Default::default()
        }
    }

    fn touch(supported: usize, deg: f32) -> Touch {
        Touch {
            supported,
            wheels: 4,
            cos_angle: libm::cosf(deg.to_radians()),
            body_hit: false,
        }
    }

    /// Flies for `air` ticks, then lands with `first` wheels at `deg`, then all four.
    fn land(p: &AirProfile, air: u32, first: usize, deg: f32) -> (AirState, Option<Landing>) {
        let mut s = AirState::default();
        for _ in 0..air {
            assert_eq!(s.tick(p, HZ, touch(0, 0.0)), None);
        }
        let mut out = s.tick(p, HZ, touch(first, deg));
        for _ in 0..60 {
            if out.is_some() {
                break;
            }
            out = s.tick(p, HZ, touch(4, deg));
        }
        (s, out)
    }

    #[test]
    fn the_shipped_profile_is_valid_and_corrects_30_degrees_within_0_4_s() {
        let p = AirProfile::standard();
        // R15: 30° in ≤ 0.4 s at full stick.
        assert!(p.pitch_rate_dps * 0.4 >= 30.0);
        assert_eq!(p.bands.clean_deg, 8.0);
    }

    #[test]
    fn the_validator_rejects_bad_bands_and_unknown_fields() {
        let mut p = AirProfile::standard();
        p.bands.bad_deg = 5.0;
        assert!(p.validate().is_err());
        let text = AIR_JSON.replacen("\"minAirS\"", "\"perJump\": 1, \"minAirS\"", 1);
        assert!(
            AirProfile::from_json(&text).is_err(),
            "R15: no per-jump overrides sneak in"
        );
    }

    #[test]
    fn throttle_raises_the_nose_brake_lowers_it_steer_yaws_and_roll_levels() {
        let p = AirProfile::standard();
        let dt = 1.0 / HZ as f32;
        let gas = rate_change(&p, sticks(input(1.0, 0.0, 0.0)), [0.0; 3], 0.0, false, dt);
        let brake = rate_change(&p, sticks(input(0.0, 0.0, 1.0)), [0.0; 3], 0.0, false, dt);
        let left = rate_change(&p, sticks(input(0.0, 1.0, 0.0)), [0.0; 3], 0.0, false, dt);
        assert!(
            gas[0] < 0.0 && brake[0] > 0.0,
            "gas spins the wheels up and drops the rear (nose up), brake rotates the nose down (br-bbki.24)"
        );
        assert!(left[1] > 0.0 && left[0] == 0.0, "steer yaws only");
        let tipped = rate_change(&p, (0.0, 0.0), [0.0; 3], 0.4, false, dt);
        assert!(tipped[2] < 0.0, "a raised left side is rolled back down");
        assert_eq!(
            rate_change(&p, (0.0, 0.0), [0.0; 3], 0.4, true, dt)[2],
            0.0,
            "a bike balances itself"
        );
        // Neutral holds the attitude: a spinning car is brought to rest, not levelled.
        let spinning = rate_change(&p, (0.0, 0.0), [1.0, 0.0, 0.0], 0.0, false, dt);
        assert!(spinning[0] < 0.0);
    }

    #[test]
    fn full_stick_reaches_the_rate_within_a_few_response_times() {
        let p = AirProfile::standard();
        let dt = 1.0 / HZ as f32;
        let mut w = [0.0f32; 3];
        for _ in 0..(5.0 * p.response_s / dt) as usize {
            let d = rate_change(&p, (1.0, 0.0), w, 0.0, false, dt);
            w[0] += d[0];
        }
        // Full throttle: the nose rises at the full rate (a negative turn about +x).
        assert!(
            (w[0] + p.pitch_rate_dps.to_radians()).abs() < 0.05 * p.pitch_rate_dps.to_radians()
        );
    }

    #[test]
    fn landings_are_judged_by_angle_and_wheels() {
        let p = AirProfile::standard();
        let air = 120;
        assert_eq!(land(&p, air, 4, 3.0).1.unwrap().tier, LandingTier::Clean);
        assert_eq!(
            land(&p, air, 2, 3.0).1.unwrap().tier,
            LandingTier::Clean,
            "the rest follow within 0.15 s"
        );
        assert_eq!(land(&p, air, 4, 14.0).1.unwrap().tier, LandingTier::Ok);
        assert_eq!(land(&p, air, 2, 30.0).1.unwrap().tier, LandingTier::Bad);
        assert_eq!(land(&p, air, 1, 60.0).1.unwrap().tier, LandingTier::Crash);
        // A short hop isn't a landing.
        assert_eq!(land(&p, 10, 4, 30.0).1, None);
    }

    #[test]
    fn a_clean_angle_with_a_wheel_hanging_is_only_ok() {
        let p = AirProfile::standard();
        let mut s = AirState::default();
        for _ in 0..120 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        let mut out = s.tick(&p, HZ, touch(2, 3.0));
        for _ in 0..60 {
            if out.is_some() {
                break;
            }
            out = s.tick(&p, HZ, touch(3, 3.0));
        }
        let l = out.unwrap();
        assert_eq!((l.tier, l.all_wheels), (LandingTier::Ok, false));
    }

    #[test]
    fn the_body_first_is_a_crash_and_the_car_is_righted() {
        let p = AirProfile::standard();
        let mut s = AirState::default();
        for _ in 0..120 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        let l = s
            .tick(
                &p,
                HZ,
                Touch {
                    supported: 0,
                    wheels: 4,
                    cos_angle: 0.5,
                    body_hit: true,
                },
            )
            .unwrap();
        assert_eq!(l.tier, LandingTier::Crash, "nose first at 60°");
        assert!((l.angle_deg - 60.0).abs() < 0.01);
        let mut tail = AirState::default();
        for _ in 0..120 {
            tail.tick(&p, HZ, touch(0, 0.0));
        }
        let scrape = tail.tick(
            &p,
            HZ,
            Touch {
                supported: 0,
                wheels: 4,
                cos_angle: libm::cosf(30f32.to_radians()),
                body_hit: true,
            },
        );
        assert_eq!(
            scrape.unwrap().tier,
            LandingTier::Bad,
            "a tail scrape at 30° is bad, not a crash"
        );
        let mut flat = AirState::default();
        for _ in 0..120 {
            flat.tick(&p, HZ, touch(0, 0.0));
        }
        let bumper = flat.tick(
            &p,
            HZ,
            Touch {
                supported: 0,
                wheels: 4,
                cos_angle: 1.0,
                body_hit: true,
            },
        );
        assert_eq!(
            bumper.unwrap().tier,
            LandingTier::Ok,
            "body first is never clean"
        );
        assert_eq!(s.reward(&p, HZ, l, 20.0), 1.0);
        assert!(s.righting(false));
        assert!(!s.righting(true), "upright ends it");
    }

    #[test]
    fn righting_turns_a_tipped_car_toward_upright_from_any_side() {
        let p = AirProfile::standard();
        let dt = 1.0 / HZ as f32;
        for up in [
            [1.0f32, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            [0.0, -1.0, 0.0],
            [0.6, -0.8, 0.0],
        ] {
            // Integrate the rate change on a unit-inertia body until upright.
            let (mut u, mut w) = (up, [0.0f32; 3]);
            let mut t = 0.0;
            while u[1] < 0.95 && t < 3.0 {
                let d = righting_change(&p, u, w, dt);
                w = [w[0] + d[0], w[1] + d[1], w[2] + d[2]];
                // u' = w × u
                let du = [
                    w[1] * u[2] - w[2] * u[1],
                    w[2] * u[0] - w[0] * u[2],
                    w[0] * u[1] - w[1] * u[0],
                ];
                u = [u[0] + du[0] * dt, u[1] + du[1] * dt, u[2] + du[2] * dt];
                let n = libm::sqrtf(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
                u = [u[0] / n, u[1] / n, u[2] / n];
                t += dt;
            }
            assert!(t < p.crash.right_within_s, "{up:?}: upright after {t} s");
        }
    }

    #[test]
    fn clean_boosts_toward_a_higher_speed_long_flights_more_and_bad_costs_speed() {
        let p = AirProfile::standard();
        let dt = 1.0 / HZ as f32;
        let (mut s, l) = land(&p, 120, 4, 2.0);
        let l = l.unwrap();
        assert!(!l.long);
        assert_eq!(s.reward(&p, HZ, l, 20.0), 1.0);
        assert!((s.boost_target - 26.0).abs() < 1e-4);
        let (mut speed, mut ticks) = (20.0f32, 0);
        while s.boost_ticks > 0 {
            speed += s.boost_dv(&p, dt, speed, 0.0);
            ticks += 1;
        }
        assert_eq!(ticks, 150, "1.25 s");
        assert!((speed - 26.0).abs() < 1e-3, "reaches +30%: {speed}");
        let (mut s, l) = land(&p, 200, 4, 2.0);
        let l = l.unwrap();
        assert!(l.long, "1.67 s in the air is the long tier");
        s.reward(&p, HZ, l, 20.0);
        assert!((s.boost_target - 27.0).abs() < 1e-4);
        let (mut s, l) = land(&p, 120, 4, 30.0);
        assert!((s.reward(&p, HZ, l.unwrap(), 20.0) - 0.73).abs() < 1e-6);
        assert_eq!(s.boost_ticks, 0);
        // Braking ends a boost.
        let (mut s, l) = land(&p, 120, 4, 2.0);
        s.reward(&p, HZ, l.unwrap(), 20.0);
        assert!(s.boost_dv(&p, dt, 20.0, 0.0) > 0.0);
        assert_eq!(s.boost_dv(&p, dt, 20.0, 1.0), 0.0);
        assert_eq!(s.boost_ticks, 0);
    }

    #[test]
    fn a_held_throttle_raises_the_nose_once_properly_airborne_and_a_held_steer_stays_latched() {
        let p = AirProfile::standard();
        let mut s = AirState::default();
        // Full throttle and a little steer held through the lip.
        s.feed((1.0, 0.2), false);
        s.feed((1.0, 0.2), true);
        assert_eq!(
            s.air_sticks(&p, HZ, (1.0, 0.2)),
            (0.0, 0.0),
            "a crest hop at full throttle tips nothing"
        );
        // Properly airborne: the pinned throttle raises the nose; the held steer still isn't an air input.
        for _ in 0..AirProfile::ticks(p.throttle_latch_s, HZ) {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        assert_eq!(
            s.air_sticks(&p, HZ, (1.0, 0.2)),
            (1.0, 0.0),
            "a pinned throttle over-rotates a long jump"
        );
        // Steering hard the other way arms the yaw.
        assert_eq!(s.air_sticks(&p, HZ, (1.0, -1.0)), (1.0, -1.0));
        // Down again: the latch resets for the next jump; a fresh brake from neutral pitches at once.
        s.feed((0.0, 0.0), false);
        s.feed((0.0, 0.0), true);
        assert_eq!(
            s.air_sticks(&p, HZ, (-1.0, 0.0)),
            (-1.0, 0.0),
            "the brake from neutral pitches at once"
        );
    }

    #[test]
    fn a_car_knocked_into_the_air_keeps_the_grounds_levelling_until_it_has_settled() {
        let p = AirProfile::standard();
        let mut s = AirState::default();
        for _ in 0..60 {
            s.tick(&p, HZ, touch(4, 0.0));
        }
        s.note_hit(&p, 9.0);
        for _ in 0..60 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        assert!(!s.flying(&p, HZ), "a rail threw it up: no air control");
        assert_eq!(
            s.tick(&p, HZ, touch(4, 40.0)),
            None,
            "and no landing to judge"
        );
        for _ in 0..60 {
            s.tick(&p, HZ, touch(4, 0.0));
        }
        for _ in 0..60 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        assert!(s.flying(&p, HZ), "the next jump is a jump");
        s.note_hit(&p, 2.0);
        assert!(s.flying(&p, HZ), "a bump isn't a hit");
    }

    #[test]
    fn a_placed_cars_first_touchdown_is_not_a_landing() {
        let p = AirProfile::standard();
        let mut s = AirState::placed();
        for _ in 0..60 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        assert!(
            !s.flying(&p, HZ),
            "settling after being put down isn't a flight to steer"
        );
        let mut s = AirState::placed();
        // The wheels brush the ground as it's put down, then it settles from a little higher.
        s.tick(&p, HZ, touch(4, 0.0));
        for _ in 0..60 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        assert_eq!(
            s.tick(&p, HZ, touch(4, 0.0)),
            None,
            "a respawn drop earns nothing"
        );
        for _ in 0..120 {
            s.tick(&p, HZ, touch(0, 0.0));
        }
        assert!(
            s.tick(&p, HZ, touch(4, 0.0)).is_some(),
            "the next jump does"
        );
    }
}
