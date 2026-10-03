//! Wrapping millisecond clocks. `sentAtMs` on the state channel is the controller's monotonic clock as a wrapping
//! `u16` (65.5 s), `Ping.t` a wrapping `u32`; receivers unwrap them against a full-width reference on the same clock.

/// The full-width time nearest `reference` whose low 16 bits are `stamp` (both in the same clock, ms). Correct while
/// the true time is within ±32.767 s of `reference`; never below zero.
pub fn unwrap_ms16(stamp: u16, reference: u64) -> u64 {
    let d = i64::from(stamp.wrapping_sub(reference as u16) as i16);
    (reference as i64).saturating_add(d).max(0) as u64
}

/// As [`unwrap_ms16`] for a wrapping `u32` stamp (±24.8 days around `reference`).
pub fn unwrap_ms32(stamp: u32, reference: u64) -> u64 {
    let d = i64::from(stamp.wrapping_sub(reference as u32) as i32);
    (reference as i64).saturating_add(d).max(0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn unwraps_across_the_wrap() {
        assert_eq!(
            unwrap_ms16(10, 65_530),
            65_546,
            "the stamp wrapped just after the reference"
        );
        assert_eq!(
            unwrap_ms16(65_530, 65_546),
            65_530,
            "the stamp is from just before the wrap"
        );
        assert_eq!(unwrap_ms16(100, 5), 100);
        assert_eq!(unwrap_ms16(65_500, 5), 0, "never negative");
        assert_eq!(unwrap_ms32(3, (1u64 << 32) - 2), (1u64 << 32) + 3);
    }

    proptest! {
        #[test]
        fn recovers_any_time_near_the_reference(t in 40_000u64..10_000_000_000, back in -32_000i64..32_000) {
            let reference = (t as i64 + back) as u64;
            prop_assert_eq!(unwrap_ms16(t as u16, reference), t);
            prop_assert_eq!(unwrap_ms32(t as u32, reference), t);
        }
    }
}
