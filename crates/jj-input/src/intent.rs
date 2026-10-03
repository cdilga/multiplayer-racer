//! Game interpretation of the DRIVE stick (plan §7.3): what the sticks *mean*, computed from the
//! quantised axes on both the controller (to detect discrete actions) and the host (the same code
//! path pads and keys use, plan T5).
//!
//! Sign convention: `+y` is up (throttle), `−y` is down (brake, then reverse near rest), `+x`
//! steers right. All thresholds live in quantised space ([`jj_types::axis::AxisThreshold`]) so the
//! controller's decision and the host's agree exactly, whatever float rounding a round trip does.
//!
//! Layout of the DRIVE stick's `y` axis (DEFAULT; the vehicle feel targets are TUNE at G-FEEL):
//!
//! ```text
//!  +1.0                full throttle
//!   0                  rest
//!  −0.85               full brake (reachable, and reachable before the wheelie detent)
//!  < −0.85             wheelie preload zone (strictly past full brake; §7.3)
//!  −1.0                bottom of travel
//! ```

use jj_types::axis::{AXIS_MAX, AxisThreshold, dequantise_axis, sanitise_axis};

/// Where the brake saturates to full on the DRIVE stick's downward travel (plan §7.3, DEFAULT).
pub const FULL_BRAKE: f32 = 0.85;
/// The wheelie preload zone begins strictly past [`FULL_BRAKE`] (§7.3: "y < −0.85").
pub const FULL_BRAKE_Q: i16 = AxisThreshold::new(FULL_BRAKE).0;

/// What the DRIVE stick asks the car to do, shaped per axis so a diagonal stick never reduces the
/// other axis (plan §7.3). `reverse` is a *request*: the vehicle engages reverse only when brake is
/// held full and the car is near rest (that judgement is the sim's, S03; input can't see speed).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DriveIntent {
    /// Steering, −1 (left) ..= 1 (right); a function of `drive.x` only.
    pub steer: f32,
    /// Throttle, 0 ..= 1; a function of `drive.y` only.
    pub throttle: f32,
    /// Brake, 0 ..= 1; saturates at full at and past [`FULL_BRAKE`].
    pub brake: f32,
    /// Full brake is engaged (the "reversing near rest" request; see the type docs).
    pub reverse: bool,
}

/// Interprets the DRIVE stick. Pure: the same quantised pair always means the same intent.
pub fn drive_intent(drive: [i16; 2]) -> DriveIntent {
    let x = sanitise_axis(drive[0]);
    let y = sanitise_axis(drive[1]);
    let throttle = if y > 0 {
        f32::from(y) / f32::from(AXIS_MAX)
    } else {
        0.0
    };
    // Brake ramps to full at FULL_BRAKE_Q and stays full through the preload zone to the bottom.
    let brake_up = (-i32::from(y)).clamp(0, i32::from(FULL_BRAKE_Q));
    let brake = f32::from(brake_up as i16) / f32::from(FULL_BRAKE_Q);
    DriveIntent {
        steer: dequantise_axis(x),
        throttle,
        brake,
        reverse: y <= -FULL_BRAKE_Q,
    }
}

/// True when the DRIVE stick is strictly inside the wheelie preload zone (`y < −0.85`, §7.3).
pub fn in_preload_zone(drive_y: i16) -> bool {
    sanitise_axis(drive_y) < -FULL_BRAKE_Q
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_types::axis::quantise_axis;
    use proptest::prelude::*;

    #[test]
    fn the_y_axis_layout_is_as_documented() {
        let i = drive_intent([0, AXIS_MAX]);
        assert_eq!(i.throttle, 1.0);
        assert_eq!(i.brake, 0.0);
        let i = drive_intent([0, 0]);
        assert_eq!((i.throttle, i.brake), (0.0, 0.0), "neutral is coast");
        let i = drive_intent([0, -FULL_BRAKE_Q]);
        assert_eq!(i.brake, 1.0, "full brake at the detent");
        assert!(
            !in_preload_zone(-FULL_BRAKE_Q),
            "the detent is not the zone"
        );
        let i = drive_intent([0, -AXIS_MAX]);
        assert_eq!(i.brake, 1.0, "saturated through the zone");
        assert!(in_preload_zone(-AXIS_MAX));
        assert!(drive_intent([0, -AXIS_MAX]).reverse);
    }

    #[test]
    fn minus_32768_reads_as_full_range() {
        assert!(in_preload_zone(i16::MIN));
        assert_eq!(drive_intent([i16::MIN, i16::MIN]).steer, -1.0);
    }

    proptest! {
        // AC1: axes are shaped independently, so diagonal steering never reduces full throttle.
        #[test]
        fn diagonal_steer_does_not_reduce_full_throttle(
            x in any::<i16>(),
            y in any::<i16>(),
        ) {
            let d = drive_intent([x, y]);
            let alone = drive_intent([0, y]);
            prop_assert_eq!(d.throttle, alone.throttle);
            prop_assert_eq!(d.brake, alone.brake);
            prop_assert_eq!(d.reverse, alone.reverse);
            let steered = drive_intent([x, 0]);
            prop_assert_eq!(d.steer, steered.steer);
            // Full is full, at any steering angle, in both directions.
            prop_assert_eq!(drive_intent([x, AXIS_MAX]).throttle, 1.0);
            prop_assert_eq!(drive_intent([x, -AXIS_MAX]).brake, 1.0);
        }

        // AC2: full brake is reachable, and reachable strictly before the wheelie detent.
        #[test]
        fn brake_reaches_full_before_the_wheelie_detent(q in -AXIS_MAX..=AXIS_MAX) {
            let brake = drive_intent([0, q]).brake;
            if q >= 0 {
                prop_assert_eq!(brake, 0.0);
            } else {
                prop_assert!((0.0..=1.0).contains(&brake));
                prop_assert_eq!(drive_intent([0, q]).throttle, 0.0);
            }
            if q >= -FULL_BRAKE_Q {
                prop_assert!(!in_preload_zone(q), "no preload at or above the detent");
                // Full brake is already reachable at the detent itself.
                prop_assert_eq!(drive_intent([0, -FULL_BRAKE_Q]).brake, 1.0);
            } else {
                prop_assert_eq!(brake, 1.0, "full brake holds through the zone");
                prop_assert!(in_preload_zone(q));
                prop_assert!(drive_intent([0, q]).reverse);
            }
            // Monotonic down the travel.
            if q < AXIS_MAX {
                prop_assert!(brake >= drive_intent([0, q + 1]).brake);
            }
        }

    }
    #[test]
    fn thresholds_survive_their_own_quantisation() {
        assert!(in_preload_zone(quantise_axis(-(FULL_BRAKE + 0.001))));
        assert!(!in_preload_zone(quantise_axis(-FULL_BRAKE)));
    }
}
