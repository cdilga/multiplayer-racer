//! The wheelie (plan §7.3, master R64): the forward/back "lift and launch".
//!
//! DRIVE pulled past the full-brake point (`y < −0.85`, the preload zone) preloads. A **release**
//! lifts the front: the stick leaves the preload zone and passes `y > −0.3` **within 250 ms** —
//! easing off slowly is just braking. Lift scales with preload time (max at 0.4 s; that scaling is
//! the sim's job, S03). Holding past **1.2 s** (TUNE) cancels the preload, because the player is
//! braking or reversing.
//!
//! Measured preload = the span from the sample that entered the zone to the sample that released,
//! minus any dip out of the zone that outlived nothing (a dip back in within the release window
//! resumes the same preload; the dip's own time doesn't count). Timing is caller-supplied
//! monotonic milliseconds; the detector only differences them.

use crate::intent::{FULL_BRAKE_Q, in_preload_zone};
use jj_types::axis::{AxisThreshold, sanitise_axis};

/// A release must pass this upward, out of braking (§7.3: `y > −0.3`; quantised so controller and
/// host agree — the step granularity is ~3×10⁻⁵ of travel).
pub const RELEASE_Q: i16 = AxisThreshold::new(0.3).0;
/// How long after leaving the preload zone a release still counts (ms, §7.3).
pub const RELEASE_WINDOW_MS: u64 = 250;
/// Preload held longer than this is cancelled — the player is braking or reversing (ms, TUNE).
pub const CANCEL_MS: u64 = 1_200;
/// The largest preload a fired event carries (the cancel boundary).
pub const MAX_PRELOAD_MS: u16 = CANCEL_MS as u16;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Idle,
    Preloading,
    /// Left the zone; a release passes `y > −0.3` by `deadline_ms` (inclusive) or it was braking.
    Releasing {
        deadline_ms: u64,
    },
    /// Held past [`CANCEL_MS`]; stays until the stick leaves the preload zone.
    Cancelled,
}

/// A validated wheelie release, ready to send as `Action { kind: wheelie { preload_ms } }` so a
/// later neutral sample can't erase it (§5.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WheelieEvent {
    /// Accumulated preload in ms, clamped to [`MAX_PRELOAD_MS`].
    pub preload_ms: u16,
}

/// Per-source wheelie detector. Feed every DRIVE sample (the controller does this to detect the
/// release as a discrete action; the host runs the same machine for pads and keys).
#[derive(Clone, Debug, Default)]
pub struct WheelieDetector {
    phase: Phase,
    /// Preload accumulated so far (ms).
    preload_ms: u64,
    last_ms: u64,
}

impl WheelieDetector {
    /// Feeds one DRIVE-stick sample at monotonic time `now_ms`; returns the event if this sample
    /// completes a release.
    pub fn sample(&mut self, drive_y: i16, now_ms: u64) -> Option<WheelieEvent> {
        self.sample_with(drive_y, now_ms, -RELEASE_Q, RELEASE_WINDOW_MS, CANCEL_MS)
    }

    /// As [`sample`](Self::sample) with another release rule: the stick must pass `y > release_q` (quantised; the old release line is `-RELEASE_Q`)
    /// within `window_ms` of leaving the zone. The R116 wheelie launch is a snap to full forward (`release_q` near the top,
    /// a short window), so an ordinary throttle roll-on after braking never fires it.
    pub fn sample_with(
        &mut self,
        drive_y: i16,
        now_ms: u64,
        release_q: i16,
        window_ms: u64,
        cancel_ms: u64,
    ) -> Option<WheelieEvent> {
        let released = |y: i16| sanitise_axis(y) > release_q;
        let in_zone = in_preload_zone(drive_y);
        let dt = now_ms.saturating_sub(self.last_ms);
        self.last_ms = now_ms;
        match self.phase {
            Phase::Idle => {
                if in_zone {
                    self.preload_ms = 0;
                    self.phase = Phase::Preloading;
                }
            }
            Phase::Preloading => {
                if in_zone {
                    self.preload_ms = self.preload_ms.saturating_add(dt);
                    if self.preload_ms > cancel_ms {
                        self.phase = Phase::Cancelled;
                    }
                } else if released(drive_y) {
                    // Left the zone straight past the release line in one sample: that IS the
                    // release; the final partial hold counts — unless it pushed the hold past
                    // the cancel point, in which case the player simply held too long.
                    self.preload_ms = self.preload_ms.saturating_add(dt);
                    if self.preload_ms > cancel_ms {
                        self.phase = Phase::Cancelled;
                    } else {
                        let ev = self.fire();
                        return Some(ev);
                    }
                } else {
                    // Left the zone into the braking band: the interval ending here was still a
                    // hold, so it counts; then the release window opens.
                    self.preload_ms = self.preload_ms.saturating_add(dt);
                    if self.preload_ms > cancel_ms {
                        self.phase = Phase::Cancelled;
                    } else {
                        self.phase = Phase::Releasing {
                            deadline_ms: now_ms.saturating_add(window_ms),
                        };
                    }
                }
            }
            Phase::Releasing { deadline_ms } => {
                if now_ms > deadline_ms {
                    // Eased off slowly (or parked in the middle): just braking. A pull back into
                    // the zone after the window starts a fresh preload.
                    self.expire_window(in_zone);
                } else if released(drive_y) {
                    let ev = self.fire();
                    return Some(ev);
                } else if in_zone {
                    // Dipped back in before releasing: preloading again, same accumulation.
                    self.phase = Phase::Preloading;
                }
            }
            Phase::Cancelled => {
                if !in_zone {
                    self.phase = Phase::Idle;
                    self.preload_ms = 0;
                }
            }
        }
        None
    }

    fn fire(&mut self) -> WheelieEvent {
        let preload_ms = self.preload_ms.min(u64::from(MAX_PRELOAD_MS));
        self.phase = Phase::Idle;
        self.preload_ms = 0;
        WheelieEvent {
            preload_ms: preload_ms as u16,
        }
    }

    fn expire_window(&mut self, in_zone: bool) {
        self.preload_ms = 0;
        self.phase = if in_zone {
            Phase::Preloading
        } else {
            Phase::Idle
        };
    }

    /// How long the stick has been held in the preload zone right now (0 outside it): what the R116 reverse delay reads.
    pub fn zone_ms(&self) -> u64 {
        if self.phase == Phase::Preloading {
            self.preload_ms
        } else {
            0
        }
    }

    /// True while a preload is pending (the controller sets the `WHEELIE_PRELOAD` flag from this).
    pub fn is_preloading(&self) -> bool {
        matches!(self.phase, Phase::Preloading | Phase::Releasing { .. })
    }

    /// Drops everything without firing (neutralisation: cancel, hidden, disconnected, paused).
    pub fn reset(&mut self) {
        self.phase = Phase::Idle;
        self.preload_ms = 0;
    }
}

/// Full brake is at `−0.85` and the release line at `−0.3`; the two never cross (a release can't
/// happen while still inside the zone, and the window can't be satisfied by braking alone).
const _: () = assert!(RELEASE_Q < FULL_BRAKE_Q);

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const ZONE: i16 = -32767; // deep in the preload zone (quantise_axis(-1.0))
    const BRAKE: i16 = -19660; // between the release line and the zone (quantise_axis(-0.6))
    const TOP: i16 = 32767; // past the release line
    const NEUTRAL: i16 = 0;

    #[test]
    fn the_full_pattern_fires_with_its_preload() {
        let mut w = WheelieDetector::default();
        assert_eq!(w.sample(ZONE, 0), None);
        assert!(w.is_preloading());
        assert_eq!(w.sample(ZONE, 300), None);
        // Preload spans entry sample → release sample (310, not 300).
        assert_eq!(w.sample(TOP, 310), Some(WheelieEvent { preload_ms: 310 }));
        assert!(!w.is_preloading());
    }

    #[test]
    fn easing_off_slowly_is_just_braking() {
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        w.sample(ZONE, 200);
        // Out of the zone at 210 but parked below the release line; deadline is 460.
        for t in (210..=460).step_by(10) {
            assert_eq!(w.sample(BRAKE, t), None, "no fire while easing at {t} ms");
        }
        assert!(
            w.is_preloading(),
            "the window is still open at exactly 460 (inclusive)"
        );
        assert!(w.sample(BRAKE, 470).is_none());
        assert!(!w.is_preloading(), "the window closed at 460");
        assert_eq!(
            w.sample(TOP, 600),
            None,
            "too late: past the line after the window"
        );
    }

    #[test]
    fn the_release_window_boundary_is_inclusive() {
        // Out at 200, past the line at exactly +250 ms: still a release.
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        w.sample(ZONE, 200);
        w.sample(BRAKE, 200); // leaves the zone; deadline 450
        assert_eq!(w.sample(TOP, 450), Some(WheelieEvent { preload_ms: 200 }));
        // One ms later than that: braking.
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        w.sample(ZONE, 200);
        w.sample(BRAKE, 200);
        assert_eq!(w.sample(TOP, 451), None);
        assert_eq!(w.sample(TOP, 452), None, "and it stays quiet");
    }

    #[test]
    fn holding_past_the_cancel_point_cancels() {
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        assert_eq!(
            w.sample(ZONE, CANCEL_MS),
            None,
            "at 1.2 s it still preloads"
        );
        assert!(w.is_preloading());
        assert_eq!(w.sample(ZONE, CANCEL_MS + 1), None, "past 1.2 s cancels");
        assert!(!w.is_preloading());
        // A cancelled preload can't be rescued by a fast release.
        assert_eq!(w.sample(TOP, CANCEL_MS + 2), None);
        // It re-opens only after leaving the zone; a fresh pattern works.
        w.sample(NEUTRAL, CANCEL_MS + 10);
        assert_eq!(w.sample(ZONE, CANCEL_MS + 20), None);
        assert!(w.is_preloading());
        assert_eq!(
            w.sample(TOP, CANCEL_MS + 60),
            Some(WheelieEvent { preload_ms: 40 })
        );
    }

    #[test]
    fn a_dip_out_and_back_keeps_accumulating() {
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        w.sample(ZONE, 100); // preload 100
        w.sample(BRAKE, 110); // out of the zone, inside the window (dip time doesn't count)
        w.sample(ZONE, 150); // back in: same preload resumes
        w.sample(ZONE, 250); // +100
        assert_eq!(w.sample(TOP, 260), Some(WheelieEvent { preload_ms: 220 }));
    }

    #[test]
    fn a_pull_back_after_an_expired_window_is_a_fresh_preload() {
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        w.sample(ZONE, 100);
        w.sample(BRAKE, 110); // deadline 360
        w.sample(BRAKE, 400); // window expired: braking
        w.sample(ZONE, 500); // pull back in: fresh preload from here
        w.sample(ZONE, 600);
        assert_eq!(w.sample(TOP, 610), Some(WheelieEvent { preload_ms: 110 }));
    }

    #[test]
    fn reset_drops_a_pending_release() {
        let mut w = WheelieDetector::default();
        w.sample(ZONE, 0);
        w.sample(ZONE, 150);
        w.reset();
        assert!(!w.is_preloading());
        assert_eq!(
            w.sample(TOP, 155),
            None,
            "a cancel between preload and release fires nothing"
        );
        assert_eq!(
            w.sample(ZONE, 200),
            None,
            "a fresh pattern after the reset works"
        );
        assert!(w.is_preloading());
        assert_eq!(w.sample(TOP, 240), Some(WheelieEvent { preload_ms: 40 }));
    }

    proptest! {
        // AC3 (wheelie half): a neutralise at any point kills the pending pattern — the property
        // version of `reset_drops_a_pending_release`, over random preload/release timings.
        #[test]
        fn reset_kills_any_pending_pattern(
            preload_ms in 0u64..3_000,
            mid_pause in 0u64..300,
            t_fire_offset in 0u64..1_000,
        ) {
            let mut w = WheelieDetector::default();
            let mut t = 0u64;
            w.sample(ZONE, t);
            // Spread the preload over many samples (sample-rate independence).
            let mut left = preload_ms;
            while left > 0 {
                let step = left.min(37);
                left -= step;
                t += step;
                w.sample(ZONE, t);
            }
            t += mid_pause;
            w.sample(BRAKE, t); // somewhere in the window
            w.reset();
            prop_assert_eq!(w.sample(TOP, t + t_fire_offset), None);
        }

        #[test]
        fn fired_preload_spans_entry_to_release(preload_ms in 1u64..1_199) {
            let mut w = WheelieDetector::default();
            w.sample(ZONE, 0);
            w.sample(ZONE, preload_ms);
            let ev = w.sample(TOP, preload_ms).expect("valid release");
            prop_assert_eq!(u64::from(ev.preload_ms), preload_ms);
        }

        #[test]
        fn sample_rate_does_not_change_the_outcome(steps in 1usize..32, preload_ms in 1u64..1_000) {
            let run = |steps: usize| -> Option<WheelieEvent> {
                let mut w = WheelieDetector::default();
                let mut t = 0u64;
                w.sample(ZONE, t);
                let step = preload_ms / steps as u64 + 1;
                let mut total = 0;
                while total < preload_ms {
                    let s = step.min(preload_ms - total);
                    total += s;
                    t += s;
                    w.sample(ZONE, t);
                }
                w.sample(TOP, t + 5)
            };
            // The +5 ms to the release sample is the same in both runs, so the events match.
            prop_assert_eq!(run(steps), run(1));
            prop_assert!(run(steps).is_some());
        }
    }
}
