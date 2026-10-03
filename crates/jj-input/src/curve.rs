//! Controller-side personal stick shaping: dead zone + response curve, applied to raw float axes
//! **before** quantisation (plan §5.4: axes carry the personal curve already applied; game
//! interpretation on the host works on the quantised values).
//!
//! The curve is a device preference (master §10.6a), not game tuning: identity (`gamma = 1`,
//! `deadzone = 0`) is valid. Shaping is per axis, so a diagonal stick never reduces the other
//! axis's magnitude (the property the plan calls out for DriveIntent).

use jj_types::axis::quantise_axis;

/// A stick's personal shaping. Defaults are identity: the game must not depend on a curve being
/// applied (pads and keys on the host run the same game interpretation on quantised axes).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StickCurve {
    /// Magnitude at and below which the axis reads neutral (0.0..0.5).
    pub deadzone: f32,
    /// Response exponent (≥ 1): 1 is linear, higher is finer control near neutral (TUNE per device).
    pub gamma: f32,
}

impl Default for StickCurve {
    fn default() -> Self {
        Self::identity()
    }
}

impl StickCurve {
    /// No shaping at all: what a host pad with no stored profile uses.
    pub const fn identity() -> Self {
        Self {
            deadzone: 0.0,
            gamma: 1.0,
        }
    }

    /// The phone default (TUNE): a small dead zone for drifting thumbs, near-linear response.
    pub const fn phone_default() -> Self {
        Self {
            deadzone: 0.08,
            gamma: 1.0,
        }
    }

    /// Shapes one raw axis. Neutral (0) and full range (±1) are exact; the result is monotonic in
    /// the input; NaN reads as neutral and out-of-range values are clamped (same contract as
    /// [`quantise_axis`], so shaping then quantising never invents range).
    pub fn apply(&self, v: f32) -> f32 {
        if v.is_nan() {
            return 0.0;
        }
        let a = v.clamp(-1.0, 1.0).abs();
        let dz = self.deadzone.clamp(0.0, 0.5);
        if a <= dz {
            return 0.0;
        }
        let span = 1.0 - dz;
        let shaped = ((a - dz) / span).powf(self.gamma.max(1.0));
        v.signum() * shaped.clamp(0.0, 1.0)
    }

    /// Shapes both axes of a stick independently.
    pub fn apply_pair(&self, x: f32, y: f32) -> [f32; 2] {
        [self.apply(x), self.apply(y)]
    }
}

/// Shapes and quantises one raw axis in one step (what the controller does per sample).
pub fn shape_and_quantise(curve: &StickCurve, v: f32) -> i16 {
    quantise_axis(curve.apply(v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn identity_is_the_raw_value() {
        let c = StickCurve::identity();
        for v in [-1.0, -0.5, -1.0 / 32767.0, 0.0, 0.37, 1.0] {
            assert_eq!(c.apply(v), v.clamp(-1.0, 1.0));
        }
    }

    #[test]
    fn neutral_and_full_range_are_exact_with_a_deadzone() {
        let c = StickCurve {
            deadzone: 0.12,
            gamma: 2.0,
        };
        assert_eq!(c.apply(0.0), 0.0);
        assert_eq!(c.apply(0.12), 0.0, "the edge of the dead zone is neutral");
        assert_eq!(c.apply(1.0), 1.0);
        assert_eq!(c.apply(-1.0), -1.0);
        assert_eq!(c.apply(0.119), 0.0, "just inside the zone is neutral");
    }

    #[test]
    fn nonfinite_and_out_of_range_read_sanely() {
        let c = StickCurve::phone_default();
        assert_eq!(c.apply(f32::NAN), 0.0);
        assert_eq!(c.apply(f32::INFINITY), 1.0);
        assert_eq!(c.apply(f32::NEG_INFINITY), -1.0);
        assert_eq!(c.apply(7.0), 1.0);
    }

    proptest! {
        #[test]
        fn monotonic_and_sign_preserving(
            v in -1.0f32..=1.0,
            d in 0.0f32..=0.5,
            g in 1.0f32..=4.0,
        ) {
            let c = StickCurve { deadzone: d, gamma: g };
            let out = c.apply(v);
            prop_assert!(out.abs() <= 1.0);
            prop_assert!(out == 0.0 || out.signum() == v.signum());
            prop_assert!(c.apply(v / 2.0).abs() <= out.abs() + f32::EPSILON);
        }

        #[test]
        fn shaping_never_invents_range(v in -1.0f32..=1.0) {
            let c = StickCurve { deadzone: 0.15, gamma: 2.5 };
            let q = shape_and_quantise(&c, v);
            prop_assert!((q as i32).abs() <= 32767);
            prop_assert_eq!(shape_and_quantise(&c, 0.0), 0);
            prop_assert_eq!(shape_and_quantise(&c, 1.0), 32767);
        }
    }
}
