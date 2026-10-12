//! Learner assists and gentle catch-up (R125, br-2mxa). Both are part of the sim state: journaled setup commands
//! ([`crate::journal::Setup::Assist`], [`crate::journal::Setup::CatchUp`]), hashed, replayed bit for bit.
//!
//! **Assists are input-side.** Each tick, before the normal vehicle path, a car with an assist level edits its player's
//! input. Nothing here applies a force of its own except the flip assist's self-righting torque (the same one the race
//! rules use, integrated once per tick). The levels, from data (`assets/profiles/assist.json`):
//!
//! - **Some**: steering pulled 30 % toward the line when the stick is near centre, brake assist before bends, and no
//!   accidental drift (the drift button counts only after the stick has been held at full lock 0.25 s).
//! - **Lots**: auto-throttle (the player steers; the brake still works), 60 % steer-to-line, brake assist, drift and the
//!   wheelie launch off, and the flip assist acts at once.
//!
//! **Never fights the player.** The steer-to-line weight is full while the stick is within `nearCentre` of centre and
//! falls to zero at `zeroAt`, so a full-lock input passes through exactly; a stick pushed the other way from the line
//! also gets no help. The brake assist and auto-throttle only ever add brake or throttle the player isn't giving.
//!
//! **Catch-up** (for every car, lobby Off / Light) scales a trailing car's engine force: a car more than `startS` behind
//! the leader (gap metres over a reference speed) gets up to `topSpeedGain` more drive, linearly to full at `fullS`, and
//! its boost meter refills `boostRefill`× as fast at full. The leader (and any car not behind) gets exactly 1.0. The
//! scale multiplies the engine force the vehicle path already commands, so it is honest physics: the ledger counts it,
//! and the car's top speed rises by the force ratio under the profile's linear drag.

use serde::{Deserialize, Serialize};

use crate::autopilot::{LineProbe, Path, Pose2};
use crate::journal::DriveInput;
use jj_types::axis::{dequantise_axis, quantise_axis};

pub const ASSIST_JSON: &str = include_str!("../../../assets/profiles/assist.json");
const CONTRACT: &str = "jj-assist/1";

/// A player's assist level (R125).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AssistLevel {
    #[default]
    Off,
    Some,
    Lots,
}

impl AssistLevel {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Some,
            2 => Self::Lots,
            _ => Self::Off,
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// The lobby's catch-up choice.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CatchUp {
    #[default]
    Off,
    Light,
}

impl CatchUp {
    pub fn from_u8(v: u8) -> Self {
        if v == 1 { Self::Light } else { Self::Off }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineTuning {
    pub look_ahead_s: f32,
    pub min_look_ahead_m: f32,
    pub plan_brake: f32,
    /// Steer-to-line is at full strength while the stick is within this of centre (0..1) ...
    pub near_centre: f32,
    /// ... and gone at this deflection, linearly between.
    pub zero_at: f32,
    /// A stick at or past this deflection counts as full lock (the drift gate).
    pub full_lock: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeedPlanTuning {
    /// Lateral acceleration the plan assumes (m/s²).
    pub lateral_grip: f32,
    pub min_speed: f32,
    pub cap_mps: f32,
    /// Over the plan by this much (m/s) before the brake assist starts.
    pub overspeed_margin: f32,
    pub brake_gain: f32,
    pub throttle_gain: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriftRule {
    Free,
    HeldFullLock,
    Off,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LevelTuning {
    pub steer_to_line: f32,
    /// Scales the planned speed this level brakes for and cruises at.
    pub speed_skill: f32,
    pub brake_assist: bool,
    pub auto_throttle: bool,
    pub drift: DriftRule,
    pub drift_hold_s: f32,
    pub wheelie: bool,
    pub flip_instant: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlipTuning {
    pub up_below: f32,
    pub speed_below_mps: f32,
    pub done_above: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatchUpTuning {
    /// Gap metres are turned into seconds at this speed.
    pub reference_speed_mps: f32,
    pub start_s: f32,
    pub full_s: f32,
    /// Extra engine force at full catch-up, as a fraction (0.06 is +6 %).
    pub top_speed_gain: f32,
    /// The boost meter's refill multiplier at full catch-up.
    pub boost_refill: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Levels {
    some: LevelTuning,
    lots: LevelTuning,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssistFile {
    contract: String,
    #[allow(dead_code)]
    what: String,
    line: LineTuning,
    speed_plan: SpeedPlanTuning,
    levels: Levels,
    flip: FlipTuning,
    catch_up: CatchUpTuning,
}

/// The assist data, validated.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AssistProfile {
    pub line: LineTuning,
    pub speed_plan: SpeedPlanTuning,
    pub some: LevelTuning,
    pub lots: LevelTuning,
    pub flip: FlipTuning,
    pub catch_up: CatchUpTuning,
}

impl AssistProfile {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let f: AssistFile =
            serde_json::from_str(json).map_err(|e| format!("bad assist profile: {e}"))?;
        if f.contract != CONTRACT {
            return Err(format!(
                "assist contract {:?}, expected {CONTRACT:?}",
                f.contract
            ));
        }
        let p = Self {
            line: f.line,
            speed_plan: f.speed_plan,
            some: f.levels.some,
            lots: f.levels.lots,
            flip: f.flip,
            catch_up: f.catch_up,
        };
        p.validate()?;
        Ok(p)
    }

    /// The compiled-in `assets/profiles/assist.json`.
    pub fn standard() -> Self {
        Self::from_json(ASSIST_JSON).expect("the compiled-in assist profile parses")
    }

    fn validate(&self) -> Result<(), String> {
        let unit = |name: &str, v: f32| {
            if (0.0..=1.0).contains(&v) {
                Ok(())
            } else {
                Err(format!("assist {name} = {v}, expected 0..1"))
            }
        };
        let l = &self.line;
        unit("line.nearCentre", l.near_centre)?;
        unit("line.zeroAt", l.zero_at)?;
        unit("line.fullLock", l.full_lock)?;
        if l.zero_at <= l.near_centre {
            return Err("assist line.zeroAt must be above line.nearCentre".into());
        }
        if l.look_ahead_s <= 0.0 || l.min_look_ahead_m <= 0.0 || l.plan_brake <= 0.0 {
            return Err("assist line look-ahead and plan brake must be positive".into());
        }
        let s = &self.speed_plan;
        if s.lateral_grip <= 0.0 || s.cap_mps <= s.min_speed || s.min_speed <= 0.0 {
            return Err("assist speedPlan needs lateralGrip > 0 and 0 < minSpeed < capMps".into());
        }
        if s.brake_gain < 0.0 || s.throttle_gain < 0.0 || s.overspeed_margin < 0.0 {
            return Err("assist speedPlan gains and margin must not be negative".into());
        }
        for (name, lv) in [("some", &self.some), ("lots", &self.lots)] {
            unit(&format!("levels.{name}.steerToLine"), lv.steer_to_line)?;
            if lv.speed_skill <= 0.0 || lv.speed_skill > 2.0 || lv.drift_hold_s < 0.0 {
                return Err(format!(
                    "assist levels.{name}: speedSkill 0..2, driftHoldS >= 0"
                ));
            }
        }
        let f = &self.flip;
        if f.up_below >= f.done_above || f.speed_below_mps < 0.0 {
            return Err("assist flip needs upBelow < doneAbove and speedBelowMps >= 0".into());
        }
        let c = &self.catch_up;
        if c.reference_speed_mps <= 0.0
            || c.start_s < 0.0
            || c.full_s <= c.start_s
            || c.top_speed_gain < 0.0
            || c.boost_refill < 1.0
        {
            return Err(
                "assist catchUp needs referenceSpeedMps > 0, 0 <= startS < fullS, gain >= 0, boostRefill >= 1"
                    .into(),
            );
        }
        Ok(())
    }

    fn level(&self, level: AssistLevel) -> Option<&LevelTuning> {
        match level {
            AssistLevel::Off => None,
            AssistLevel::Some => Some(&self.some),
            AssistLevel::Lots => Some(&self.lots),
        }
    }

    /// Whether this level lets the wheelie launch through.
    pub fn allows_wheelie(&self, level: AssistLevel) -> bool {
        self.level(level).is_none_or(|l| l.wheelie)
    }

    /// The catch-up scale for a car `gap_m` behind the leader (1.0 at or before `startS`), and the share of the full
    /// effect (0..1) it represents.
    pub fn catch_up_share(&self, gap_m: f32) -> f32 {
        let c = &self.catch_up;
        let gap_s = gap_m / c.reference_speed_mps;
        ((gap_s - c.start_s) / (c.full_s - c.start_s)).clamp(0.0, 1.0)
    }
}

/// What the assist did to a car's input last tick (introspection, R90).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistReport {
    pub level: AssistLevel,
    /// Steer-to-line weight actually used (0 at full lock), and the line's steer it pulled toward.
    pub line_weight: f32,
    pub line_steer: f32,
    pub target_speed: f32,
    pub brake_assist: f32,
    pub auto_throttle: f32,
    pub drift_blocked: bool,
    pub flip_active: bool,
    /// Catch-up share (0..1) and the engine-force scale it gave.
    pub catch_share: f32,
    pub catch_scale: f32,
}

/// One car's assist state.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AssistState {
    pub level: AssistLevel,
    route_idx: Option<usize>,
    full_lock_ticks: u32,
    drift_latched: bool,
    flip_active: bool,
    pub report: AssistReport,
}

impl AssistState {
    pub fn set_level(&mut self, level: AssistLevel) {
        if self.level != level {
            *self = Self {
                level,
                ..Self::default()
            };
        }
    }

    /// The input after the assist: `car` is where the car is and how fast, `max_steer`/`wheelbase` its geometry. A car
    /// with no assist returns `input` untouched.
    pub fn apply(
        &mut self,
        prof: &AssistProfile,
        path: &Path,
        car: Pose2,
        max_steer: f32,
        wheelbase: f32,
        input: DriveInput,
    ) -> DriveInput {
        let Some(lv) = prof.level(self.level) else {
            return input;
        };
        let (line, plan) = (&prof.line, &prof.speed_plan);
        let probe: LineProbe = path.probe(
            self.route_idx,
            car,
            max_steer,
            wheelbase,
            [line.look_ahead_s, line.min_look_ahead_m, line.plan_brake],
        );
        self.route_idx = Some(probe.idx);
        let target_speed = if probe.max_curvature > 1e-4 {
            lv.speed_skill * libm::sqrtf(plan.lateral_grip / probe.max_curvature)
        } else {
            plan.cap_mps
        }
        .clamp(plan.min_speed, plan.cap_mps)
            // Catch-up (R125) raises a trailing car's planned speed as well as its drive, so it helps at the plan too.
            * self.report.catch_scale.max(1.0);
        let mut out = input;
        let mut rep = AssistReport {
            level: self.level,
            line_steer: probe.steer,
            target_speed,
            catch_share: self.report.catch_share,
            catch_scale: self.report.catch_scale,
            ..AssistReport::default()
        };

        // Steering: pulled toward the line while the stick is near centre; nothing at full lock, and nothing when the
        // player is steering the other way from the line.
        let s = dequantise_axis(input.steer);
        let fade = ((line.zero_at - s.abs()) / (line.zero_at - line.near_centre)).clamp(0.0, 1.0);
        let opposed = s.abs() > line.near_centre && s * probe.steer < 0.0;
        let w = if opposed {
            0.0
        } else {
            lv.steer_to_line * fade
        };
        out.steer = quantise_axis(s + w * (probe.steer - s));
        rep.line_weight = w;

        // Speed: brake before a bend the car is too fast for, and (Lots) hold the throttle to the plan. A deliberate
        // brake or reverse from the player is never reduced.
        let speed = car.forward_speed;
        let over = speed - target_speed;
        let player_brake = dequantise_axis(input.brake)
            .max(0.0)
            .max((-dequantise_axis(input.throttle)).max(0.0));
        if lv.brake_assist && speed > 1.0 && over > plan.overspeed_margin {
            let help = (plan.brake_gain * (over - plan.overspeed_margin)).min(1.0);
            if help > player_brake {
                out.brake = quantise_axis(help);
                rep.brake_assist = help;
            }
            if help > 0.0 && dequantise_axis(out.throttle) > 0.0 {
                out.throttle = 0;
            }
        }
        if lv.auto_throttle
            && player_brake <= 0.0
            && rep.brake_assist == 0.0
            && target_speed > speed
        {
            let t = (plan.throttle_gain * (target_speed - speed)).min(1.0);
            if t > dequantise_axis(out.throttle) {
                out.throttle = quantise_axis(t);
                rep.auto_throttle = t;
            }
        }

        // Drift: off, or only after a held full lock.
        let full_lock = s.abs() >= line.full_lock;
        self.full_lock_ticks = if full_lock {
            self.full_lock_ticks + 1
        } else {
            0
        };
        let hold_ticks = libm::ceilf(lv.drift_hold_s * crate::sim::TICK_HZ as f32) as u32;
        match lv.drift {
            DriftRule::Free => {}
            DriftRule::Off => {
                rep.drift_blocked = input.drift;
                out.drift = false;
            }
            DriftRule::HeldFullLock => {
                let allowed =
                    input.drift && (self.drift_latched || self.full_lock_ticks >= hold_ticks);
                self.drift_latched = allowed;
                rep.drift_blocked = input.drift && !allowed;
                out.drift = allowed;
            }
        }
        self.report = rep;
        out
    }

    /// Whether the instant flip assist holds the car now: tipped over and nearly still starts it, and it runs until the
    /// car is upright again.
    pub fn flip_wanted(&mut self, prof: &AssistProfile, up_y: f32, speed: f32) -> bool {
        let on = prof.level(self.level).is_some_and(|l| l.flip_instant);
        self.flip_active = on
            && if self.flip_active {
                up_y < prof.flip.done_above
            } else {
                up_y < prof.flip.up_below && speed.abs() < prof.flip.speed_below_mps
            };
        self.report.flip_active = self.flip_active;
        self.flip_active
    }

    /// Bytes for the full-state hash (only for cars that have an assist on).
    pub fn hash_into(&self, out: &mut Vec<u8>) {
        out.push(self.level.as_u8());
        out.extend(self.route_idx.map_or(u64::MAX, |i| i as u64).to_le_bytes());
        out.extend(self.full_lock_ticks.to_le_bytes());
        out.push(u8::from(self.drift_latched));
        out.push(u8::from(self.flip_active));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_standard_profile_is_valid_and_bad_ones_are_refused() {
        let p = AssistProfile::standard();
        // Lots pulls toward the line harder than Some; the shares themselves are tuning data.
        assert!(0.0 < p.some.steer_to_line && p.some.steer_to_line < p.lots.steer_to_line && p.lots.steer_to_line <= 1.0);
        assert!(p.allows_wheelie(AssistLevel::Some) && !p.allows_wheelie(AssistLevel::Lots));
        let bad = ASSIST_JSON.replace("\"zeroAt\": 0.85", "\"zeroAt\": 0.1");
        assert!(AssistProfile::from_json(&bad).is_err());
        let bad = ASSIST_JSON.replace("jj-assist/1", "jj-assist/2");
        assert!(AssistProfile::from_json(&bad).is_err());
    }

    #[test]
    fn catch_up_share_is_zero_to_3_s_and_linear_to_full_at_12_s() {
        let p = AssistProfile::standard();
        let m = |s: f32| s * p.catch_up.reference_speed_mps;
        assert_eq!(p.catch_up_share(m(2.0)), 0.0);
        assert_eq!(p.catch_up_share(0.0), 0.0);
        assert!((p.catch_up_share(m(7.5)) - 0.5).abs() < 1e-6);
        assert_eq!(p.catch_up_share(m(40.0)), 1.0);
    }
}
