//! Per-source input state: one controller stick pair (or one host pad/keys mapping) interpreted by
//! the machines in [`crate::intent`], [`crate::action`] and [`crate::wheelie`], with stable action
//! IDs, freshness and neutralisation.
//!
//! A **source** is one player's sticks on one endpoint (a phone touchscreen is one source; a hub
//! with four pads is four sources on one connection — plan §5.4). The controller feeds every raw
//! sample through [`SourceState::sample`] (detection is event-driven, so a press and release
//! between two sends still yields its action); the host feeds its pad/keys samples through the
//! same method (plan T5: touch, pads and keys mean the same thing).

use crate::action::{HeldActions, SectorMachine, Utility};
use crate::dual::{DriveStickMachine, Flick, FlickMachine};
use crate::intent::DriveIntent;
use crate::profile::Resolved;
use crate::wheelie::WheelieDetector;
use jj_protocol::cmd::ActionKind;
use jj_protocol::state::{StateFlags, StateRecord};
use jj_types::axis::sanitise_axis;
use jj_types::{ActionId, SourceHandle};

/// Why a source was neutralised. Neutralisation makes the sticks read neutral **and** drops every
/// pending detection without firing (plan: pointer cancel, visibility loss, device disconnect and
/// pause never fire a wheelie or utility).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Neutralise {
    /// A `pointercancel` (or the stick's touch ended without a final position).
    PointerCancel,
    /// The page became hidden (`visibilitychange`).
    Hidden,
    /// The device went away (`gamepaddisconnected`, headset drop).
    Disconnected,
    /// The pause menu opened (the source also shows `MENU_OPEN` while paused).
    Paused,
}

/// A discrete action detected on this sample, ready to send as `ControllerCmd::Action` (the
/// `actionId` is stable per source; the host deduplicates on it).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DetectedAction {
    pub action: ActionId,
    pub kind: ActionKind,
    /// The `sourceSeq` of the sample that completed the action, for `Action.at_source_seq`.
    pub at_source_seq: u16,
}

/// Everything a source's sticks currently mean to the game.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SourceSemantics {
    pub drive: DriveIntent,
    /// Right sector held (boost, §7.3).
    pub boost: bool,
    /// Left sector held (handbrake drift, §7.3).
    pub drift: bool,
    /// A wheelie preload is pending (the HUD can hint it).
    pub wheelie_preload: bool,
    /// The R116 launch pull is armed and has not yet become reverse: the brakes hold, the car does not back up.
    pub launch_armed: bool,
}

/// Touch/menu facts of one sample; the flags the wire carries (the UI knows these, the machines
/// don't).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SampleFlags {
    /// The source can provide input (a disconnected source reads unavailable).
    pub available: bool,
    /// A finger/stick is on the DRIVE stick.
    pub drive_touch: bool,
    /// A finger/stick is on the ACTION stick.
    pub action_touch: bool,
    /// The pause menu is open for this source.
    pub menu_open: bool,
    /// The player chose the old one-stick layout (steer on the left stick, the right stick's sectors: boost, drift, forward,
    /// back). The default is the R116 dual-stick layout.
    pub classic: bool,
}

/// One interpreted input source.
#[derive(Clone, Debug)]
pub struct SourceState {
    handle: SourceHandle,
    /// Wrapping, per source (§5.4); bumps on every sample.
    seq: u16,
    drive: [i16; 2],
    action: [i16; 2],
    flags: SampleFlags,
    sectors: SectorMachine,
    wheelie: WheelieDetector,
    /// The R116 layout's machines and thresholds.
    left: DriveStickMachine,
    flick: FlickMachine,
    profile: Resolved,
    /// The wheelie launch (the boost) is refused until this time; the phone's ring reads it.
    launch_ready_at_ms: u64,
    launch_total_ms: u64,
    /// Monotonic ms of the last sample (freshness; the host neutralises after 250 ms of silence).
    last_sample_ms: u64,
    has_sample: bool,
    /// Per-source action counter; wrapping `u32` (the host deduplicates on it — a collision needs
    /// 2³² actions from one source, which is days of continuous firing).
    next_action_id: u32,
}

impl SourceState {
    /// A source reading the sticks with another profile's thresholds (tests, tuning).
    pub fn with_profile(handle: SourceHandle, profile: Resolved) -> Self {
        let mut s = Self::new(handle);
        s.profile = profile;
        s
    }

    /// Swaps the thresholds this source reads (the owner tuning menu, br-2sdu.2). The machines keep their state; the next
    /// sample compares against the new numbers.
    pub fn set_profile(&mut self, profile: Resolved) {
        self.profile = profile;
    }

    /// A source the host assigned `handle` to on claim.
    pub fn new(handle: SourceHandle) -> Self {
        Self {
            handle,
            seq: 0,
            drive: [0, 0],
            action: [0, 0],
            flags: SampleFlags::default(),
            sectors: SectorMachine::default(),
            wheelie: WheelieDetector::default(),
            left: DriveStickMachine::default(),
            flick: FlickMachine::default(),
            profile: Resolved::default(),
            launch_ready_at_ms: 0,
            launch_total_ms: 0,
            last_sample_ms: 0,
            has_sample: false,
            next_action_id: 1,
        }
    }

    /// Feeds one quantised sample (post personal curve; see [`crate::curve`]) at monotonic
    /// `now_ms`. Returns the discrete actions this sample completed, if any.
    pub fn sample(
        &mut self,
        drive: [i16; 2],
        action: [i16; 2],
        flags: SampleFlags,
        now_ms: u64,
    ) -> Vec<DetectedAction> {
        // A paused or unavailable source is neutral: no interpretation, no fires (it can still
        // report its flags so the host sees why).
        let effective = if flags.menu_open || !flags.available {
            ([0, 0], [0, 0])
        } else {
            (drive, action)
        };
        // Changing layout mid-stream starts the machines afresh (nothing fires across the switch).
        if self.has_sample && self.flags.classic != flags.classic {
            self.sectors.reset();
            self.wheelie.reset();
            self.left.reset();
            self.flick.reset();
        }
        self.drive = effective.0;
        self.action = effective.1;
        self.flags = flags;
        self.last_sample_ms = now_ms;
        self.has_sample = true;
        self.seq = self.seq.wrapping_add(1);

        let mut out = Vec::new();
        if flags.menu_open || !flags.available {
            self.sectors.reset();
            self.wheelie.reset();
            self.left.reset();
            self.flick.reset();
            return out;
        }
        let utility = if flags.classic {
            self.sectors.sample(self.action).map(|u| match u {
                Utility::Forward => ActionKind::UtilityForward,
                Utility::Rear => ActionKind::UtilityRear,
            })
        } else {
            self.left.sample(self.drive, &self.profile);
            self.flick
                .sample(self.action, now_ms, &self.profile)
                .map(|f| match f {
                    Flick::Forward => ActionKind::UtilityForward,
                    Flick::Back => ActionKind::UtilityRear,
                })
        };
        if let Some(kind) = utility {
            out.push(DetectedAction {
                action: self.take_action_id(),
                kind,
                at_source_seq: self.seq,
            });
        }
        let wheelie = if flags.classic {
            self.wheelie.sample(self.drive[1], now_ms)
        } else {
            // The launch: a snap to full forward inside the profile's window. The pull still tracks while cooling down (the
            // HUD shows it), but a snap then fires nothing.
            let snap = self.wheelie.sample_with(
                self.drive[1],
                now_ms,
                self.profile.launch_snap,
                self.profile.launch_window_ms,
                // Held through a countdown the pull stays armed (nothing cancels it); the reverse delay decides reverse.
                u64::MAX,
            );
            snap.filter(|_| now_ms >= self.launch_ready_at_ms)
        };
        if let Some(event) = wheelie {
            if !flags.classic {
                self.launch_ready_at_ms = now_ms.saturating_add(self.profile.launch_cooldown_ms);
                self.launch_total_ms = self.profile.launch_cooldown_ms;
            }
            out.push(DetectedAction {
                action: self.take_action_id(),
                kind: ActionKind::Wheelie {
                    preload_ms: event.preload_ms,
                },
                at_source_seq: self.seq,
            });
        }
        out
    }

    fn take_action_id(&mut self) -> ActionId {
        let id = ActionId(self.next_action_id);
        self.next_action_id = self.next_action_id.wrapping_add(1).max(1);
        id
    }

    /// Neutralises: sticks read neutral, every pending detection is dropped without firing, touch
    /// bits clear. Disconnect also clears `available`; pause also opens the menu flag.
    pub fn neutralise(&mut self, why: Neutralise) {
        self.drive = [0, 0];
        self.action = [0, 0];
        self.sectors.reset();
        self.wheelie.reset();
        self.left.reset();
        self.flick.reset();
        self.flags.drive_touch = false;
        self.flags.action_touch = false;
        match why {
            Neutralise::Disconnected => self.flags.available = false,
            Neutralise::Paused => {
                self.flags.menu_open = true;
                self.flags.available = false;
            }
            Neutralise::PointerCancel | Neutralise::Hidden => {}
        }
    }

    /// The pause menu closed: the source becomes available again (sticks still neutral).
    pub fn resume(&mut self) {
        self.flags.menu_open = false;
        self.flags.available = true;
    }

    /// The host-assigned handle (tags every state record and action of this source).
    pub fn handle(&self) -> SourceHandle {
        self.handle
    }

    /// The `sourceSeq` of the most recent sample.
    pub fn seq(&self) -> u16 {
        self.seq
    }

    /// What the sticks mean right now (neutral before the first sample).
    pub fn semantics(&self) -> SourceSemantics {
        if !self.flags.classic {
            let mut s = crate::dual::semantics(
                self.drive,
                self.action,
                &self.left,
                self.wheelie.is_preloading(),
                &self.profile,
            );
            // A full pull arms the launch first (the brakes hold); reverse engages only past the reverse delay.
            let delayed = self.wheelie.zone_ms() >= self.profile.launch_reverse_delay_ms;
            s.launch_armed = s.drive.reverse && !delayed;
            s.drive.reverse = s.drive.reverse && delayed;
            return s;
        }
        let held: HeldActions = self.sectors.held();
        SourceSemantics {
            drive: crate::intent::drive_intent(self.drive),
            boost: held.boost,
            drift: held.drift,
            wheelie_preload: self.wheelie.is_preloading(),
            launch_armed: false,
        }
    }

    /// The DRIVE intent alone (what S03 consumes per tick).
    pub fn drive_intent(&self) -> DriveIntent {
        self.semantics().drive
    }

    /// The wheelie launch's cooldown at `now_ms` as (remaining, total) ms: (0, 0) when it is ready. The phone draws it as a ring
    /// on the left stick knob.
    pub fn launch_cooldown(&self, now_ms: u64) -> (u64, u64) {
        let left = self.launch_ready_at_ms.saturating_sub(now_ms);
        if left == 0 {
            (0, 0)
        } else {
            (left, self.launch_total_ms)
        }
    }

    /// Whether this source reads the sticks the old one-stick way.
    pub fn classic(&self) -> bool {
        self.flags.classic
    }

    /// Monotonic ms of the last sample, and `None` before the first.
    pub fn last_sample_ms(&self) -> Option<u64> {
        self.has_sample.then_some(self.last_sample_ms)
    }

    /// Age of the newest sample at `now_ms` (freshness; the host's 250 ms neutralisation reads this).
    pub fn age_ms(&self, now_ms: u64) -> Option<u64> {
        self.last_sample_ms().map(|t| now_ms.saturating_sub(t))
    }

    /// The wire view of this source's current state (`sourceSeq` included; §5.4's record).
    pub fn record(&self) -> StateRecord {
        StateRecord {
            source: self.handle,
            seq: self.seq,
            drive: [sanitise_axis(self.drive[0]), sanitise_axis(self.drive[1])],
            action: [sanitise_axis(self.action[0]), sanitise_axis(self.action[1])],
            flags: StateFlags(
                u8::from(self.flags.available)
                    | u8::from(self.flags.drive_touch) << 1
                    | u8::from(self.flags.action_touch) << 2
                    | u8::from(self.wheelie.is_preloading()) << 3
                    | u8::from(self.flags.menu_open) << 4
                    | u8::from(self.flags.classic) << 5,
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZONE: i16 = -32767; // deep in the preload zone
    const TOP: i16 = 32767; // past the release line
    const UP: [i16; 2] = [0, TOP];
    const ON: SampleFlags = SampleFlags {
        available: true,
        drive_touch: true,
        action_touch: true,
        menu_open: false,
        classic: true,
    };

    #[test]
    fn action_ids_are_stable_and_increasing() {
        let mut s = SourceState::new(SourceHandle(7));
        let a = s.sample([0, 0], UP, ON, 0);
        let b = s.sample([0, 0], [0, 0], ON, 10);
        let c = s.sample([0, ZONE], [0, 0], ON, 20);
        let d = s.sample([0, TOP], [0, 0], ON, 30);
        assert!(d.iter().all(|x| x.at_source_seq == s.seq()));
        let ids: Vec<u32> = [a, b, c, d].concat().iter().map(|x| x.action.0).collect();
        assert_eq!(ids, vec![1, 2], "each detection takes the next id");
    }

    #[test]
    fn the_record_carries_the_wire_flags() {
        let mut s = SourceState::new(SourceHandle(9));
        s.sample(
            [0, ZONE],
            [0, 0],
            SampleFlags {
                available: true,
                drive_touch: true,
                action_touch: false,
                menu_open: false,
                classic: true,
            },
            0,
        );
        let r = s.record();
        assert!(r.flags.has(StateFlags::AVAILABLE));
        assert!(r.flags.has(StateFlags::DRIVE_TOUCH));
        assert!(r.flags.has(StateFlags::WHEELIE_PRELOAD));
        assert!(!r.flags.has(StateFlags::ACTION_TOUCH));
        s.neutralise(Neutralise::Disconnected);
        let r = s.record();
        assert!(!r.flags.has(StateFlags::AVAILABLE));
        assert!(!r.flags.has(StateFlags::WHEELIE_PRELOAD));
        assert_eq!(r.drive, [0, 0]);
    }

    #[test]
    fn a_paused_or_unavailable_source_samples_neutral_and_never_fires() {
        let mut s = SourceState::new(SourceHandle(1));
        let paused = SampleFlags {
            menu_open: true,
            ..ON
        };
        assert!(s.sample([0, ZONE], UP, paused, 0).is_empty());
        assert_eq!(s.semantics().drive.brake, 0.0);
        assert!(!s.semantics().wheelie_preload);
        s.resume();
        assert!(
            s.sample([0, TOP], [0, 0], ON, 10).is_empty(),
            "no stale fire after resume"
        );
        // And a real pattern after resuming works.
        assert!(
            s.sample([0, ZONE], [0, 0], ON, 20).is_empty(),
            "preload entry fires nothing"
        );
        let wheelie = s.sample([0, TOP], [0, 0], ON, 30);
        assert_eq!(wheelie.len(), 1);
        assert_eq!(wheelie[0].kind, ActionKind::Wheelie { preload_ms: 10 });
    }

    #[test]
    fn freshness_is_per_source() {
        let mut s = SourceState::new(SourceHandle(2));
        assert_eq!(s.last_sample_ms(), None);
        s.sample([0, 0], [0, 0], ON, 1_000);
        assert_eq!(s.age_ms(1_250), Some(250));
    }

    #[test]
    fn one_source_one_seq_stream() {
        let mut s = SourceState::new(SourceHandle(3));
        for i in 0..5 {
            s.sample([0, 0], [0, 0], ON, i * 10);
        }
        assert_eq!(s.seq(), 5);
        assert_eq!(s.record().seq, 5);
    }
}
