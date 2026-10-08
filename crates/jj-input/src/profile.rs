//! The input profile (P1-C11, R116): every threshold of the dual-stick layout as versioned data, with a validator.
//!
//! The file is `assets/profiles/input.json`, compiled in as [`DEFAULT_JSON`] so the controller (wasm), the host and the
//! native tests all read the same numbers. Nothing in the machines hard-codes a threshold: change the JSON, rebuild, and
//! the layout changes (tuned at the playtest, not in code). [`InputProfile::resolve`] turns the floats into the quantised
//! integer thresholds the machines compare against, so a decision made on a phone and the host's agree exactly.

use jj_types::axis::{AxisThreshold, quantise_axis};
use serde::{Deserialize, Serialize};

/// The shipped profile (`assets/profiles/input.json`).
pub const DEFAULT_JSON: &str = include_str!("../../../assets/profiles/input.json");

/// Fixed point for the angle tangents (compared in integers: `|x| * ONE >= tan_q * |y|`).
const ONE: i64 = 4096;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InputProfile {
    pub version: u32,
    #[serde(default)]
    pub what: String,
    pub steer: SteerProfile,
    pub drift: DriftProfile,
    pub launch: LaunchProfile,
    pub flick: FlickProfile,
}

/// The right stick's x axis: a small radial deadzone and a response curve.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SteerProfile {
    /// The stick's radial magnitude below which steering reads neutral (0..=0.5).
    pub radial_deadzone: f32,
    /// Response exponent (1..=4): 1 linear, higher is finer near centre.
    pub gamma: f32,
}

/// Drift on the left stick's x: an angular deadzone about vertical with hysteresis.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DriftProfile {
    /// Degrees off vertical the stick must reach to enter a drift.
    pub enter_angle_deg: f32,
    /// How far the stick must be pushed (radial, 0..=1) to enter a drift.
    pub enter_deflection: f32,
    /// A drift releases when the angle falls below this (less than the entry angle) ...
    pub exit_angle_deg: f32,
    /// ... or the deflection falls below this (less than the entry deflection).
    pub exit_deflection: f32,
    /// A drift needs the stick no further back than this (|y| below the centre, 0..=1): braking never drifts.
    pub max_pull_back: f32,
}

/// The wheelie launch, which is the boost (R116): a full pull back held for the preload time, then a snap to full forward.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LaunchProfile {
    /// The stick must pass this forward (0..=1 of travel) to count as the snap.
    pub snap_to: f32,
    /// ... within this many ms of leaving the preload zone; slower is just a throttle roll-on.
    pub snap_window_ms: u32,
    /// After a launch the next one is refused for this long (ms); the phone shows the wait as a ring on the stick.
    pub cooldown_ms: u32,
    /// A full pull back arms the launch first; reverse engages only once the pull has been held this long (ms), so
    /// pull-then-snap launches and pull-and-hold reverses. Must be longer than the sim's full-lift preload.
    pub reverse_delay_ms: u32,
}

/// The right stick's forward/back flick: fast travel to the rim near vertical, then a cooldown and a re-arm.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FlickProfile {
    /// |y| the stick must reach to fire.
    pub rim: f32,
    /// The flick starts from below this |y| (the stick is armed only after it has been this low).
    pub arm_below: f32,
    /// The stick must go from below `armBelow` to the rim within this many ms.
    pub max_travel_ms: u32,
    /// Only near vertical: at most this many degrees off the up/down axis (hard steering never fires).
    pub max_angle_deg: f32,
    /// After a fire the flick is dead for this long (ms), and then needs the stick back below `armBelow`.
    pub cooldown_ms: u32,
}

/// Why a profile was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileError(pub Vec<String>);

impl std::fmt::Display for ProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.join("; "))
    }
}

impl InputProfile {
    /// Parses and validates a profile.
    pub fn from_json(text: &str) -> Result<Self, ProfileError> {
        let p: Self = serde_json::from_str(text).map_err(|e| ProfileError(vec![e.to_string()]))?;
        p.validate()?;
        Ok(p)
    }

    /// The shipped profile. Panics only if `assets/profiles/input.json` is invalid, which the tests (and CI) rule out.
    pub fn standard() -> Self {
        Self::from_json(DEFAULT_JSON).expect("assets/profiles/input.json is valid")
    }

    /// Every problem with the numbers, so a tuning mistake reads in one go.
    pub fn validate(&self) -> Result<(), ProfileError> {
        let mut bad = Vec::new();
        let mut need = |ok: bool, msg: &str| {
            if !ok {
                bad.push(msg.to_owned());
            }
        };
        let unit = |v: f32| v.is_finite() && (0.0..=1.0).contains(&v);
        let deg = |v: f32| v.is_finite() && (0.0..90.0).contains(&v);
        need(self.version == 1, "version must be 1");
        need(
            self.steer.radial_deadzone.is_finite()
                && (0.0..=0.5).contains(&self.steer.radial_deadzone),
            "steer.radialDeadzone must be within 0..=0.5",
        );
        need(
            self.steer.gamma.is_finite() && (1.0..=4.0).contains(&self.steer.gamma),
            "steer.gamma must be within 1..=4",
        );
        need(
            deg(self.drift.enter_angle_deg) && self.drift.enter_angle_deg > 0.0,
            "drift.enterAngleDeg must be within 0..90",
        );
        need(
            deg(self.drift.exit_angle_deg),
            "drift.exitAngleDeg must be within 0..90",
        );
        need(
            self.drift.exit_angle_deg < self.drift.enter_angle_deg,
            "drift.exitAngleDeg must be less than enterAngleDeg (hysteresis)",
        );
        need(
            unit(self.drift.enter_deflection) && self.drift.enter_deflection > 0.0,
            "drift.enterDeflection must be within 0..=1",
        );
        need(
            unit(self.drift.exit_deflection),
            "drift.exitDeflection must be within 0..=1",
        );
        need(
            self.drift.exit_deflection < self.drift.enter_deflection,
            "drift.exitDeflection must be less than enterDeflection (hysteresis)",
        );
        need(
            unit(self.drift.max_pull_back),
            "drift.maxPullBack must be within 0..=1",
        );
        need(
            unit(self.launch.snap_to) && self.launch.snap_to > 0.3,
            "launch.snapTo must be within 0.3..=1",
        );
        need(
            (50..=1000).contains(&self.launch.snap_window_ms),
            "launch.snapWindowMs must be within 50..=1000",
        );
        need(
            (500..=3000).contains(&self.launch.reverse_delay_ms),
            "launch.reverseDelayMs must be within 500..=3000 (longer than the preload)",
        );
        need(
            self.launch.cooldown_ms <= 60_000,
            "launch.cooldownMs must be at most 60000",
        );
        need(
            unit(self.flick.rim) && self.flick.rim > 0.5,
            "flick.rim must be within 0.5..=1",
        );
        need(
            unit(self.flick.arm_below),
            "flick.armBelow must be within 0..=1",
        );
        need(
            self.flick.arm_below < self.flick.rim,
            "flick.armBelow must be less than rim",
        );
        need(
            (16..=1000).contains(&self.flick.max_travel_ms),
            "flick.maxTravelMs must be within 16..=1000",
        );
        need(
            deg(self.flick.max_angle_deg),
            "flick.maxAngleDeg must be within 0..90",
        );
        need(
            self.flick.cooldown_ms <= 5000,
            "flick.cooldownMs must be at most 5000",
        );
        if bad.is_empty() {
            Ok(())
        } else {
            Err(ProfileError(bad))
        }
    }

    /// The quantised integer form the machines compare against.
    pub fn resolve(&self) -> Resolved {
        let tan = |deg: f32| ((deg.to_radians().tan() * ONE as f32).round() as i64).max(0);
        Resolved {
            steer_deadzone: AxisThreshold::new(self.steer.radial_deadzone),
            steer_gamma: self.steer.gamma,
            drift_enter: AxisThreshold::new(self.drift.enter_deflection),
            drift_enter_tan: tan(self.drift.enter_angle_deg),
            drift_exit: AxisThreshold::new(self.drift.exit_deflection),
            drift_exit_tan: tan(self.drift.exit_angle_deg),
            drift_pull_back: AxisThreshold::new(self.drift.max_pull_back),
            launch_snap: quantise_axis(self.launch.snap_to),
            launch_window_ms: u64::from(self.launch.snap_window_ms),
            launch_cooldown_ms: u64::from(self.launch.cooldown_ms),
            launch_reverse_delay_ms: u64::from(self.launch.reverse_delay_ms),
            flick_rim: AxisThreshold::new(self.flick.rim),
            flick_arm: AxisThreshold::new(self.flick.arm_below),
            flick_travel_ms: u64::from(self.flick.max_travel_ms),
            flick_tan: tan(self.flick.max_angle_deg),
            flick_cooldown_ms: u64::from(self.flick.cooldown_ms),
        }
    }
}

/// The profile in quantised integers (cheap to copy into every source).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Resolved {
    pub steer_deadzone: AxisThreshold,
    pub steer_gamma: f32,
    pub drift_enter: AxisThreshold,
    pub drift_enter_tan: i64,
    pub drift_exit: AxisThreshold,
    pub drift_exit_tan: i64,
    pub drift_pull_back: AxisThreshold,
    /// The wheelie launch's snap line (quantised y), snap window and cooldown.
    pub launch_snap: i16,
    pub launch_window_ms: u64,
    pub launch_cooldown_ms: u64,
    /// A pull must be held this long (ms) before it reads as reverse.
    pub launch_reverse_delay_ms: u64,
    pub flick_rim: AxisThreshold,
    pub flick_arm: AxisThreshold,
    pub flick_travel_ms: u64,
    pub flick_tan: i64,
    pub flick_cooldown_ms: u64,
}

impl Default for Resolved {
    fn default() -> Self {
        InputProfile::standard().resolve()
    }
}

/// True when `|x| / |y| >= tan` (the stick is at least that far off the vertical axis), in integers.
pub(crate) fn off_vertical_at_least(x: i16, y: i16, tan_q: i64) -> bool {
    i64::from(x).abs() * ONE >= tan_q * i64::from(y).abs()
}

/// True when `|x| / |y| <= tan` (the stick is within that angle of the vertical axis), in integers.
pub(crate) fn within_of_vertical(x: i16, y: i16, tan_q: i64) -> bool {
    i64::from(x).abs() * ONE <= tan_q * i64::from(y).abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_profile_is_valid_and_round_trips() {
        let p = InputProfile::standard();
        assert_eq!(p.drift.enter_angle_deg, 35.0);
        let again = InputProfile::from_json(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(p, again);
    }

    #[test]
    fn the_validator_names_every_bad_number() {
        let mut p = InputProfile::standard();
        p.drift.exit_angle_deg = 40.0;
        p.flick.rim = 0.2;
        p.steer.gamma = 0.5;
        p.flick.max_travel_ms = 5;
        p.drift.max_pull_back = 2.0;
        let e = p.validate().unwrap_err().0;
        assert_eq!(e.len(), 6, "{e:?}");
        assert!(e.iter().any(|m| m.contains("drift.exitAngleDeg")));
        assert!(e.iter().any(|m| m.contains("flick.rim")));
        assert!(e.iter().any(|m| m.contains("steer.gamma")));
        assert!(e.iter().any(|m| m.contains("flick.maxTravelMs")));
        assert!(
            InputProfile::from_json("{\"version\":1}").is_err(),
            "missing sections are refused"
        );
        assert!(
            InputProfile::from_json(&DEFAULT_JSON.replace("\"gamma\"", "\"gamm\"")).is_err(),
            "unknown or misspelt keys are refused"
        );
    }

    #[test]
    fn a_changed_value_changes_the_resolved_thresholds_without_code() {
        let mut p = InputProfile::standard();
        let before = p.resolve();
        p.drift.enter_deflection = 0.8;
        p.drift.enter_angle_deg = 50.0;
        let after = p.resolve();
        assert!(after.drift_enter > before.drift_enter);
        assert!(after.drift_enter_tan > before.drift_enter_tan);
    }
}
