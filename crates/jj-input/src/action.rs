//! Sector detection on the ACTION stick (plan §7.6): up = forward utility, down = rear utility,
//! right = boost (held), left = handbrake drift (held).
//!
//! The stick is read as a four-way pad: the **dominant axis** (the larger of `|x|`, `|y|`; an
//! exact tie has no dominant) names the sector. Hysteresis keeps a sector engaged through jitter
//! (enter at [`ENTER`], release below [`EXIT`]), and the discrete utilities need a **neutral
//! re-arm** (below [`REARM`]) before they can fire again, so holding the stick up fires once, and
//! a flick through a sector fires exactly once per intentional entry.
//!
//! All thresholds are quantised ([`AxisThreshold`]), so the controller and the host agree exactly.

use jj_types::axis::{AxisThreshold, sanitise_axis};

/// Sector engagement threshold (DEFAULT, TUNE): how far the dominant axis must reach to enter.
pub const ENTER: AxisThreshold = AxisThreshold(ENTER_Q);
/// Disengagement threshold, strictly inside [`ENTER`] (hysteresis).
pub const EXIT: AxisThreshold = AxisThreshold(EXIT_Q);
/// Below this the stick counts as neutral again and the discrete utilities re-arm.
pub const REARM: AxisThreshold = AxisThreshold(REARM_Q);

const ENTER_Q: i16 = AxisThreshold::new(0.75).0;
const EXIT_Q: i16 = AxisThreshold::new(0.5).0;
const REARM_Q: i16 = AxisThreshold::new(0.25).0;

/// One direction of the ACTION stick.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Sector {
    /// Up: forward utility ("OI!" flash, §7.6).
    Up,
    /// Down: rear utility (drop a cone, §7.6).
    Down,
    /// Right: boost (held, §7.3).
    Right,
    /// Left: handbrake drift (held, §7.3).
    Left,
}

impl Sector {
    /// Held semantics (boost/drift); up/down are discrete instead.
    pub fn held(self) -> bool {
        matches!(self, Sector::Left | Sector::Right)
    }
}

/// The dominant sector of a sampled stick, if any axis reaches far enough to name one.
///
/// The dominant axis is the one with the strictly larger magnitude; an exact tie has no dominant
/// sector (neither diagonal names a direction). Engagement uses [`ENTER`]; anything below
/// [`EXIT`]-on-the-dominant-axis disengages.
fn dominant(action: [i16; 2]) -> Option<Sector> {
    let x = sanitise_axis(action[0]);
    let y = sanitise_axis(action[1]);
    let (ax, ay) = (i32::from(x).abs(), i32::from(y).abs());
    if ax == ay {
        return None;
    }
    let (dominant_q, sector) = if ay > ax {
        (y, if y > 0 { Sector::Up } else { Sector::Down })
    } else {
        (x, if x > 0 { Sector::Right } else { Sector::Left })
    };
    (i32::from(dominant_q).abs() >= i32::from(ENTER_Q)).then_some(sector)
}

/// A discrete utility that fired on this sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Utility {
    Forward,
    Rear,
}

/// Per-source sector machine state. Feed every sample through [`SectorMachine::sample`].
#[derive(Clone, Debug, Default)]
pub struct SectorMachine {
    engaged: Option<Sector>,
    disarmed: bool,
}

impl SectorMachine {
    /// Feeds one ACTION-stick sample; returns the utility that fired on intentional entry, if any.
    pub fn sample(&mut self, action: [i16; 2]) -> Option<Utility> {
        // Neutral re-arm: only once the stick is truly near centre can the discrete utilities
        // fire again (re-arm is the lowest threshold, well inside the hysteresis exit).
        if !REARM.met_by_xy(action[0], action[1]) {
            self.disarmed = false;
        }
        let dom = dominant(action);
        let mut fired = None;
        match dom {
            Some(s) if Some(s) == self.engaged => {}
            Some(s) => {
                self.engaged = Some(s);
                if !s.held() && !self.disarmed {
                    self.disarmed = true;
                    fired = Some(match s {
                        Sector::Up => Utility::Forward,
                        Sector::Down => Utility::Rear,
                        _ => unreachable!("held sectors don't fire"),
                    });
                }
            }
            None => {
                // No dominant sector: release below the hysteresis exit.
                if self.engaged.is_some() && below_exit(action) {
                    self.engaged = None;
                }
            }
        }
        fired
    }

    /// The held sectors' current state (boost = right, drift = left).
    pub fn held(&self) -> HeldActions {
        HeldActions {
            boost: self.engaged == Some(Sector::Right),
            drift: self.engaged == Some(Sector::Left),
        }
    }

    /// Drops everything without firing (neutralisation: cancel, hidden, disconnected, paused).
    pub fn reset(&mut self) {
        self.engaged = None;
        self.disarmed = false;
    }
}

/// Whether both axes are below the hysteresis exit (the stick has left its sector).
fn below_exit(action: [i16; 2]) -> bool {
    !EXIT.met_by(sanitise_axis(action[0])) && !EXIT.met_by(sanitise_axis(action[1]))
}

/// The held ACTION-stick semantics.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HeldActions {
    /// Right sector: boost is held (§7.3).
    pub boost: bool,
    /// Left sector: handbrake drift is held (§7.3).
    pub drift: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_types::axis::quantise_axis;
    use proptest::prelude::*;

    const UP: [i16; 2] = [0, AXIS];
    const DOWN: [i16; 2] = [0, -AXIS];
    const RIGHT: [i16; 2] = [AXIS, 0];
    const LEFT: [i16; 2] = [-AXIS, 0];
    const NEUTRAL: [i16; 2] = [0, 0];
    const AXIS: i16 = 32767;

    #[test]
    fn entry_fires_once_and_rearms_only_through_neutral() {
        let mut m = SectorMachine::default();
        assert_eq!(m.sample(UP), Some(Utility::Forward));
        assert_eq!(m.sample(UP), None, "holding doesn't refire");
        assert_eq!(
            m.sample(DOWN),
            None,
            "swinging straight across doesn't refire"
        );
        assert_eq!(m.sample(NEUTRAL), None);
        assert_eq!(
            m.sample(DOWN),
            Some(Utility::Rear),
            "re-armed through neutral"
        );
    }

    #[test]
    fn hysteresis_holds_through_jitter() {
        let mut m = SectorMachine::default();
        m.sample(RIGHT);
        let jitter = [quantise_axis(0.6), 0]; // past exit, below enter
        assert_eq!(m.sample(jitter), None);
        assert!(m.held().boost, "still engaged below the enter threshold");
        let coast = [quantise_axis(0.4), 0]; // below exit
        m.sample(coast);
        assert!(!m.held().boost, "released below the exit threshold");
    }

    #[test]
    fn diagonal_ties_name_no_sector() {
        let mut m = SectorMachine::default();
        let diag = [AXIS, AXIS];
        assert_eq!(m.sample(diag), None, "an exact tie has no dominant sector");
        assert_eq!(m.held(), HeldActions::default());
        // Just off the tie, the larger axis wins.
        assert_eq!(m.sample([AXIS, AXIS - 1]), None);
        assert!(m.held().boost);
    }

    #[test]
    fn held_sectors_switch_directly() {
        let mut m = SectorMachine::default();
        m.sample(LEFT);
        assert!(m.held().drift);
        m.sample(RIGHT);
        assert_eq!(
            m.held(),
            HeldActions {
                boost: true,
                drift: false
            }
        );
    }

    #[test]
    fn reset_releases_and_rearms_without_firing() {
        let mut m = SectorMachine::default();
        m.sample(UP);
        m.reset();
        assert_eq!(m.held(), HeldActions::default());
        assert_eq!(
            m.sample(UP),
            Some(Utility::Forward),
            "fresh entry after reset fires"
        );
    }

    #[test]
    fn rearm_is_the_lowest_threshold() {
        let mut m = SectorMachine::default();
        m.sample(UP);
        let above_rearm = [0, quantise_axis(0.3)]; // past re-arm, below exit
        assert_eq!(m.sample(above_rearm), None);
        assert_eq!(
            m.sample(UP),
            None,
            "not re-armed yet: must pass below REARM"
        );
        m.sample([0, quantise_axis(0.2)]);
        assert_eq!(m.sample(UP), Some(Utility::Forward));
    }

    proptest! {
        // AC4 (detection half): one intentional entry fires exactly one utility, whatever the
        // sample rate, the path through the sector, or the jitter while inside it.
        #[test]
        fn one_entry_one_fire(
            hold_samples in 1usize..64,
            wobble in prop::collection::vec(-0.4f32..0.4, 0..16),
            enter_from in (-0.7f32..0.7),
        ) {
            let mut m = SectorMachine::default();
            let mut fires = 0;
            // Approach: rise through the sector from below the enter threshold.
            let mut y = enter_from;
            loop {
                let s = m.sample([0, quantise_axis(y)]);
                if s.is_some() {
                    fires += 1;
                }
                if y >= 0.9 {
                    break;
                }
                y = (y + 0.05).min(0.9);
            }
            for w in wobble {
                if m.sample([0, quantise_axis(1.0 - w)]).is_some() {
                    fires += 1;
                }
            }
            for _ in 0..hold_samples {
                if m.sample(UP).is_some() {
                    fires += 1;
                }
            }
            prop_assert_eq!(fires, 1);
        }

        #[test]
        fn dominant_is_the_larger_axis(x in any::<i16>(), y in any::<i16>()) {
            let d = dominant([x, y]);
            // i16::MIN is not a valid axis value: `dominant` reads it as -32767, so the oracle does too (and cannot overflow).
            let (ax, ay) = (sanitise_axis(x).abs(), sanitise_axis(y).abs());
            let (x, y) = (sanitise_axis(x), sanitise_axis(y));
            if ax == ay || ax < ENTER_Q && ay < ENTER_Q {
                prop_assert_eq!(d, None);
            } else if ay > ax {
                prop_assert_eq!(d, Some(if y > 0 { Sector::Up } else { Sector::Down }));
            } else if ax > ay {
                prop_assert_eq!(d, Some(if x > 0 { Sector::Right } else { Sector::Left }));
            }
        }
    }
}
