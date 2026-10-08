//! The R116 dual-stick layout (P1-C11): the left stick drives, drifts and launches; the right stick steers and fires.
//!
//! - **Left stick** `y` is throttle, brake/reverse and the wheelie preload ([`crate::intent`], [`crate::wheelie`]). `x` is
//!   **drift**, behind an angular deadzone about vertical (35 degrees and 0.6 deflection to enter, less to leave:
//!   hysteresis), so full throttle with a natural thumb lean never drifts. While drifting the throttle reads the stick's
//!   magnitude, so a drift at the rim keeps full throttle. Sticks keep their circular range (no disc-to-square remap).
//!   **Boost is the wheelie launch**: a full pull back held for the preload time, then a snap to full forward inside the
//!   profile's window. That is `WheelieDetector::sample_with` with the profile's snap line and window, and the cooldown in
//!   [`crate::source::SourceState`]; speed arming and the lift and burst are the sim's.
//! - **Right stick** `x` steers (analog, a small radial deadzone and a response curve); `y` fires **forward** (up) or
//!   **back** (down) only on a deliberate flick: fast travel from the stick's rest to the rim, near vertical, then a cooldown
//!   and a re-arm below the arm level, so hard steering never fires.
//!
//! Every threshold is [`crate::profile`] data. The old one-stick layout is [`crate::action`] plus `drive.x` steering, kept
//! as a personal setting.

use crate::intent::{DriveIntent, drive_intent};
use crate::profile::{Resolved, off_vertical_at_least, within_of_vertical};
use crate::source::SourceSemantics;
use jj_types::axis::{dequantise_axis, sanitise_axis};

/// The left stick's drift, with hysteresis.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DriveStickMachine {
    drifting: bool,
}

impl DriveStickMachine {
    pub fn sample(&mut self, drive: [i16; 2], p: &Resolved) {
        let (x, y) = (sanitise_axis(drive[0]), sanitise_axis(drive[1]));
        let not_pulled_back = i32::from(y) > -i32::from(p.drift_pull_back.0);
        self.drifting = if self.drifting {
            not_pulled_back
                && p.drift_exit.met_by_xy(x, y)
                && off_vertical_at_least(x, y, p.drift_exit_tan)
        } else {
            not_pulled_back
                && p.drift_enter.met_by_xy(x, y)
                && off_vertical_at_least(x, y, p.drift_enter_tan)
        };
    }

    pub fn drifting(&self) -> bool {
        self.drifting
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// A flick that fired.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flick {
    Forward,
    Back,
}

/// The right stick's flick detector.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FlickMachine {
    /// Seen below the arm level since the last fire (and the cooldown is over): a flick may start.
    armed: bool,
    /// The last time (ms) the stick was below the arm level: where a flick's travel starts.
    below_at_ms: u64,
    cooldown_until_ms: u64,
}

impl FlickMachine {
    /// Feeds one right-stick sample at monotonic `now_ms`; returns the flick it completed, if any.
    pub fn sample(&mut self, action: [i16; 2], now_ms: u64, p: &Resolved) -> Option<Flick> {
        let (x, y) = (sanitise_axis(action[0]), sanitise_axis(action[1]));
        if !p.flick_arm.met_by(y) {
            self.below_at_ms = now_ms;
            if now_ms >= self.cooldown_until_ms {
                self.armed = true;
            }
            return None;
        }
        if self.armed
            && p.flick_rim.met_by(y)
            && within_of_vertical(x, y, p.flick_tan)
            && now_ms.saturating_sub(self.below_at_ms) <= p.flick_travel_ms
        {
            self.armed = false;
            self.cooldown_until_ms = now_ms.saturating_add(p.flick_cooldown_ms);
            return Some(if y > 0 { Flick::Forward } else { Flick::Back });
        }
        None
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// The right stick's steering: a radial deadzone on the stick's magnitude, then the response curve on `x` alone.
pub fn steer(action: [i16; 2], p: &Resolved) -> f32 {
    let (x, y) = (sanitise_axis(action[0]), sanitise_axis(action[1]));
    if !p.steer_deadzone.met_by_xy(x, y) && p.steer_deadzone.0 > 0 {
        return 0.0;
    }
    let v = dequantise_axis(x);
    v.signum() * v.abs().powf(p.steer_gamma)
}

/// What the two sticks mean under the dual layout: drive intent (steer from the right stick, throttle from the left, or its
/// magnitude while drifting), plus the held drift (the boost is the wheelie launch, an action).
pub fn semantics(
    drive: [i16; 2],
    action: [i16; 2],
    held: &DriveStickMachine,
    wheelie_preload: bool,
    p: &Resolved,
) -> SourceSemantics {
    let mut intent: DriveIntent = drive_intent([0, drive[1]]);
    intent.steer = steer(action, p);
    if held.drifting() {
        let (x, y) = (
            f64::from(sanitise_axis(drive[0])),
            f64::from(sanitise_axis(drive[1])),
        );
        intent.throttle =
            ((x * x + y * y).sqrt() / f64::from(jj_types::axis::AXIS_MAX)).min(1.0) as f32;
        intent.brake = 0.0;
        intent.reverse = false;
    }
    SourceSemantics {
        drive: intent,
        boost: false,
        drift: held.drifting(),
        wheelie_preload,
        launch_armed: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::InputProfile;
    use jj_types::axis::{AXIS_MAX, quantise_axis};
    use proptest::prelude::*;

    fn p() -> Resolved {
        InputProfile::standard().resolve()
    }
    fn q(v: f32) -> i16 {
        quantise_axis(v)
    }

    /// A stick position as magnitude and angle off the forward axis (degrees), inside the circle.
    fn polar(mag: f32, deg: f32) -> [i16; 2] {
        let r = deg.to_radians();
        [q(mag * r.sin()), q(mag * r.cos())]
    }

    #[test]
    fn full_throttle_with_full_lock_is_both_at_once_and_fires_nothing() {
        let p = p();
        let mut held = DriveStickMachine::default();
        let mut flick = FlickMachine::default();
        let (drive, action) = ([0, AXIS_MAX], [AXIS_MAX, 0]);
        held.sample(drive, &p);
        assert_eq!(flick.sample(action, 0, &p), None);
        let s = semantics(drive, action, &held, false, &p);
        assert_eq!((s.drive.throttle, s.drive.steer), (1.0, 1.0));
        assert!(
            !s.drift && !s.boost,
            "full forward is only throttle: the boost is the launch"
        );
    }

    #[test]
    fn a_drift_at_the_rim_keeps_full_throttle() {
        let p = p();
        let mut held = DriveStickMachine::default();
        for deg in [45.0, 60.0, 80.0, 90.0, -45.0, -90.0] {
            let drive = polar(1.0, deg);
            held.sample(drive, &p);
            let s = semantics(drive, [0, 0], &held, false, &p);
            assert!(s.drift, "{deg} degrees at the rim drifts");
            assert!(
                s.drive.throttle > 0.99,
                "{deg}: throttle reads the magnitude: {}",
                s.drive.throttle
            );
            held.sample([0, 0], &p);
        }
        // Half-way out sideways is a drift at half throttle.
        held.sample(polar(0.7, 90.0), &p);
        let t = semantics(polar(0.7, 90.0), [0, 0], &held, false, &p)
            .drive
            .throttle;
        assert!((t - 0.7).abs() < 0.01, "{t}");
    }

    #[test]
    fn a_drift_has_hysteresis_in_angle_and_in_deflection() {
        let p = p();
        let mut h = DriveStickMachine::default();
        h.sample(polar(0.8, 30.0), &p);
        assert!(!h.drifting(), "30 degrees is inside the 35 degree deadzone");
        h.sample(polar(0.8, 40.0), &p);
        assert!(h.drifting());
        h.sample(polar(0.8, 28.0), &p);
        assert!(
            h.drifting(),
            "still a drift between the exit angle (25) and the entry angle (35)"
        );
        h.sample(polar(0.8, 20.0), &p);
        assert!(!h.drifting(), "released below the exit angle");
        h.sample(polar(0.5, 90.0), &p);
        assert!(!h.drifting(), "0.5 deflection is below the entry 0.6");
        h.sample(polar(0.7, 90.0), &p);
        h.sample(polar(0.5, 90.0), &p);
        assert!(h.drifting(), "held down to the exit deflection 0.45");
        h.sample(polar(0.4, 90.0), &p);
        assert!(!h.drifting());
        // Pulled back to brake: never a drift.
        h.sample(polar(1.0, 150.0), &p);
        assert!(!h.drifting());
    }

    #[test]
    fn the_flick_needs_fast_travel_to_the_rim_near_vertical_then_a_cooldown_and_a_rearm() {
        let p = p();
        let mut f = FlickMachine::default();
        assert_eq!(f.sample([0, 0], 0, &p), None);
        // A quick flick up fires forward once.
        assert_eq!(f.sample([0, q(0.5)], 40, &p), None);
        assert_eq!(f.sample([0, AXIS_MAX], 80, &p), Some(Flick::Forward));
        assert_eq!(
            f.sample([0, AXIS_MAX], 100, &p),
            None,
            "held at the rim: no repeat"
        );
        // Back to rest inside the cooldown: not yet armed; after it, armed again.
        assert_eq!(f.sample([0, 0], 200, &p), None);
        assert_eq!(
            f.sample([0, -AXIS_MAX], 300, &p),
            None,
            "still cooling down"
        );
        assert_eq!(f.sample([0, 0], 500, &p), None);
        assert_eq!(f.sample([0, -AXIS_MAX], 540, &p), Some(Flick::Back));
        // A slow push to the rim is steering, not a flick.
        let mut s = FlickMachine::default();
        s.sample([0, 0], 0, &p);
        assert_eq!(s.sample([0, q(0.5)], 400, &p), None);
        assert_eq!(s.sample([0, AXIS_MAX], 800, &p), None, "too slow");
        // The rim off to the side is hard steering: never fires.
        let mut a = FlickMachine::default();
        a.sample([0, 0], 0, &p);
        assert_eq!(a.sample(polar(1.0, 60.0), 40, &p), None);
        assert_eq!(a.sample([AXIS_MAX, 0], 80, &p), None);
    }

    #[test]
    fn steering_is_analog_with_a_radial_deadzone_and_a_curve() {
        let p = p();
        assert_eq!(steer([0, 0], &p), 0.0);
        assert_eq!(steer([q(0.05), 0], &p), 0.0, "inside the radial deadzone");
        assert!(
            steer([q(0.3), 0], &p) > 0.0 && steer([q(0.3), 0], &p) < 0.3,
            "the curve is finer near centre"
        );
        assert_eq!(steer([AXIS_MAX, 0], &p), 1.0);
        assert_eq!(steer([-AXIS_MAX, 0], &p), -1.0);
        assert!(steer([q(-0.5), 0], &p) < 0.0);
        // The stick pushed up with a little lean still steers by x alone.
        assert_eq!(steer([q(0.3), AXIS_MAX], &p), steer([q(0.3), 0], &p));
    }

    proptest! {
        /// A natural thumb lean at full throttle (x up to 0.45 with y at least 0.9) never drifts and never loses throttle.
        #[test]
        fn a_thumb_lean_at_full_throttle_never_drifts(x in -0.45f32..0.45, y in 0.9f32..1.0) {
            let p = p();
            let mut h = DriveStickMachine::default();
            let d = [q(x), q(y)];
            h.sample(d, &p);
            prop_assert!(!h.drifting());
            let s = semantics(d, [0, 0], &h, false, &p);
            prop_assert!(s.drive.throttle >= 0.89);
        }

        /// Hard steering with y wandering up to 0.5 never fires, however fast the stick moves.
        #[test]
        fn hard_steering_never_fires(
            run in prop::collection::vec((-1.0f32..1.0, -0.5f32..0.5), 2..60),
            step_ms in 1u64..60,
        ) {
            let p = p();
            let mut f = FlickMachine::default();
            let mut t = 0;
            for (x, y) in run {
                t += step_ms;
                prop_assert_eq!(f.sample([q(x), q(y)], t, &p), None);
            }
        }

        /// The left stick's throttle, brake and wheelie axis never depend on x except through a drift.
        #[test]
        fn left_x_only_matters_through_a_drift(x in -1.0f32..1.0, y in 0.0f32..1.0) {
            let p = p();
            let mut h = DriveStickMachine::default();
            h.sample([q(x), q(y)], &p);
            let s = semantics([q(x), q(y)], [0, 0], &h, false, &p);
            if !h.drifting() {
                prop_assert_eq!(s.drive.throttle, drive_intent([0, q(y)]).throttle);
            }
        }
    }
}
