//! Stick axes on the wire: `i16` in −32767..=32767 (−32768 is never sent and is read as −32767).
//!
//! What must survive quantisation: **neutral** (0.0 ↔ 0 exactly), **full range** (±1.0 ↔ ±32767 exactly) and
//! **thresholds**. A threshold is compared in quantised space ([`AxisThreshold`]), so a value the controller
//! quantised at a threshold meets it on the host too, whatever rounding the float round trip would do.

use serde::{Deserialize, Serialize};

/// The largest axis magnitude on the wire.
pub const AXIS_MAX: i16 = 32767;
const SCALE: f32 = AXIS_MAX as f32;

/// Quantises an axis in −1.0..=1.0 (clamped; NaN is neutral, ±∞ is full range) to the wire's `i16`.
pub const fn quantise_axis(v: f32) -> i16 {
    if v.is_nan() {
        return 0;
    }
    (v.clamp(-1.0, 1.0) * SCALE).round() as i16
}

/// The axis value an `i16` on the wire stands for (−32768 reads as −1.0).
pub fn dequantise_axis(q: i16) -> f32 {
    f32::from(sanitise_axis(q)) / SCALE
}

/// Maps the one out-of-range wire value (−32768) to −32767; decoders apply it so every axis is symmetric.
pub const fn sanitise_axis(q: i16) -> i16 {
    if q < -AXIS_MAX { -AXIS_MAX } else { q }
}

/// A magnitude threshold (dead zone, sector, boost) held in quantised units, so controller and host agree exactly.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
pub struct AxisThreshold(pub i16);

impl AxisThreshold {
    /// The threshold for magnitude `t` (0.0..=1.0).
    pub const fn new(t: f32) -> Self {
        Self(quantise_axis(t.abs()))
    }

    /// True when one quantised axis's magnitude reaches the threshold.
    pub fn met_by(self, q: i16) -> bool {
        i32::from(sanitise_axis(q)).abs() >= i32::from(self.0)
    }

    /// True when a quantised stick's radial magnitude reaches the threshold (exact, in integers).
    pub fn met_by_xy(self, x: i16, y: i16) -> bool {
        let (x, y, t) = (
            i64::from(sanitise_axis(x)),
            i64::from(sanitise_axis(y)),
            i64::from(self.0),
        );
        x * x + y * y >= t * t
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const LSB: f32 = 1.0 / SCALE;
    /// The thresholds `jj-input` and the phone use today (dead zones, sector entry, boost/drift); any new one is
    /// covered by the property test below.
    const THRESHOLDS: [f32; 8] = [0.08, 0.12, 0.15, 0.2, 0.25, 0.5, 0.75, 0.9];

    #[test]
    fn neutral_and_full_range_are_exact() {
        assert_eq!(quantise_axis(0.0), 0);
        assert_eq!(quantise_axis(-0.0), 0);
        assert_eq!(dequantise_axis(0), 0.0);
        assert_eq!(quantise_axis(1.0), AXIS_MAX);
        assert_eq!(quantise_axis(-1.0), -AXIS_MAX);
        assert_eq!(dequantise_axis(AXIS_MAX), 1.0);
        assert_eq!(dequantise_axis(-AXIS_MAX), -1.0);
        assert_eq!(
            dequantise_axis(i16::MIN),
            -1.0,
            "−32768 reads as full range, not past it"
        );
        assert_eq!(quantise_axis(7.0), AXIS_MAX, "clamped");
        assert_eq!(quantise_axis(f32::NEG_INFINITY), -AXIS_MAX);
        assert_eq!(quantise_axis(f32::NAN), 0, "NaN is neutral");
    }

    #[test]
    fn thresholds_survive_quantisation() {
        for t in THRESHOLDS {
            let th = AxisThreshold::new(t);
            for sign in [1.0f32, -1.0] {
                assert!(
                    th.met_by(quantise_axis(sign * t)),
                    "a value at {t} meets it"
                );
                assert!(
                    th.met_by(quantise_axis(sign * (t + 2.0 * LSB))),
                    "just above {t} meets it"
                );
                assert!(
                    !th.met_by(quantise_axis(sign * (t - 2.0 * LSB))),
                    "just below {t} doesn't"
                );
            }
            let q = quantise_axis(t);
            assert!(
                th.met_by_xy(q, 0) && th.met_by_xy(0, -q),
                "on-axis radial threshold at {t}"
            );
        }
    }

    proptest! {
        #[test]
        fn round_trip_error_is_half_a_step(v in -1.0f32..=1.0) {
            prop_assert!((dequantise_axis(quantise_axis(v)) - v).abs() <= 0.5 * LSB + f32::EPSILON);
        }

        #[test]
        fn quantisation_is_monotonic(a in -1.0f32..=1.0, b in -1.0f32..=1.0) {
            if a <= b { prop_assert!(quantise_axis(a) <= quantise_axis(b)); }
        }

        #[test]
        fn any_threshold_agrees_with_the_float_comparison_off_its_step(t in 0.0f32..=1.0, v in -1.0f32..=1.0) {
            // Away from the threshold's own quantisation step, the quantised decision equals the float one.
            prop_assume!((v.abs() - t).abs() > LSB);
            prop_assert_eq!(AxisThreshold::new(t).met_by(quantise_axis(v)), v.abs() >= t);
        }
    }
}
