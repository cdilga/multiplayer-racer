//! Wrapping `u16` sequence numbers (`batchSeq`, `sourceSeq`): newer-than by the half-range rule.

/// True when `a` is newer than `b`: `a` is ahead by 1..=32767 steps, modulo 2^16. Exactly half the range apart is
/// ambiguous, so neither is newer.
pub fn seq16_newer(a: u16, b: u16) -> bool {
    let d = a.wrapping_sub(b);
    d != 0 && d < 0x8000
}

/// Signed distance from `b` to `a` in wrapping space (−32768..=32767): positive when `a` is newer.
pub fn seq16_diff(a: u16, b: u16) -> i32 {
    i32::from(a.wrapping_sub(b) as i16)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn wraps_around() {
        assert!(seq16_newer(0, 65535));
        assert!(seq16_newer(5, 65530));
        assert!(!seq16_newer(65530, 5));
        assert!(!seq16_newer(7, 7));
        assert!(
            !seq16_newer(0x8000, 0) && !seq16_newer(0, 0x8000),
            "half the range apart is ambiguous"
        );
        assert_eq!(seq16_diff(2, 65534), 4);
        assert_eq!(seq16_diff(65534, 2), -4);
    }

    proptest! {
        #[test]
        fn a_step_forward_is_always_newer(b in any::<u16>(), step in 1u16..0x8000) {
            let a = b.wrapping_add(step);
            prop_assert!(seq16_newer(a, b));
            prop_assert!(!seq16_newer(b, a));
            prop_assert_eq!(seq16_diff(a, b), i32::from(step));
        }
    }
}
