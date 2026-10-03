//! Cross-module acceptance properties (P1-N06): the behaviours the bead's acceptance names, tested
//! at the level a player feels them — a source fed with samples, actions coming out.

use crate::scheduler::SendScheduler;
use crate::source::{DetectedAction, Neutralise, SampleFlags, SourceState};
use jj_protocol::cmd::ActionKind;
use jj_types::SourceHandle;
use jj_types::axis::quantise_axis;
use proptest::prelude::*;

const ON: SampleFlags = SampleFlags {
    available: true,
    drive_touch: true,
    action_touch: true,
    menu_open: false,
};

/// A quantised stick pair generator with the interesting magnitudes over-represented (neutral,
/// thresholds, full range, random) — the boundaries are where these machines can break.
fn stick() -> impl Strategy<Value = [i16; 2]> {
    let axis = || {
        prop_oneof![
            2 => Just(0i16),
            1 => Just(-32767i16),
            1 => Just(32767i16),
            1 => Just(quantise_axis(-0.85)),
            1 => Just(quantise_axis(0.85)),
            1 => Just(quantise_axis(-0.75)),
            1 => Just(quantise_axis(0.75)),
            1 => Just(quantise_axis(-0.5)),
            1 => Just(quantise_axis(0.5)),
            1 => Just(quantise_axis(-0.25)),
            1 => Just(quantise_axis(0.25)),
            8 => any::<i16>(),
        ]
    };
    (axis(), axis()).prop_map(|(x, y)| [x, y])
}

proptest! {
    /// AC3: pointer cancel (and every other neutralisation) never fires a wheelie or utility.
    /// Whatever state a random pre-cancel run built — mid-preload, inside the release window,
    /// holding a sector — the cancel drops it, so the completion of that old pattern fires
    /// nothing, while a genuinely fresh press afterwards still works.
    #[test]
    fn ac3_neutralisation_never_fires(
        drive in prop::collection::vec(stick(), 4..48),
        action in prop::collection::vec(stick(), 4..48),
        why in 0u8..4,
    ) {
        let steps = drive.len().min(action.len());
        let mut s = SourceState::new(SourceHandle(1));
        let mut t = 0u64;
        for i in 0..steps {
            t += 12; // a step within the wheelie release window
            let _ = s.sample(drive[i], action[i], ON, t);
        }
        let why = match why {
            0 => Neutralise::PointerCancel,
            1 => Neutralise::Hidden,
            2 => Neutralise::Disconnected,
            _ => Neutralise::Paused,
        };
        s.neutralise(why);

        // The completion of any stale pattern: a wheelie flick (the only completion a cancelled
        // machine could owe) fires nothing. Sector utilities fire on entry, and an entry here
        // would be a genuinely new touch, so the ACTION stick stays neutral in this part.
        let mut fired: Vec<DetectedAction> = Vec::new();
        fired.extend(s.sample([0, quantise_axis(1.0)], [0, 0], ON, t + 5));
        fired.extend(s.sample([0, quantise_axis(1.0)], [0, 0], ON, t + 29));
        prop_assert!(fired.is_empty(), "stale pattern fired after {:?}: {:?}", why, fired);

        // A genuinely fresh pattern still works (cancel must not over-neutralise). A
        // disconnected or paused source reads unavailable: resume it first.
        if matches!(why, Neutralise::Disconnected | Neutralise::Paused) {
            s.resume();
        }
        let fresh = s.sample([0, 0], [0, quantise_axis(1.0)], ON, t + 41);
        prop_assert_eq!(fresh.len(), 1, "a fresh press after {:?} fires exactly once", why);
        prop_assert_eq!(fresh[0].kind, ActionKind::UtilityForward);
    }

    /// AC4: a press and release entirely between two sends still yields exactly one action, and
    /// the state stream never needs to have shown it.
    #[test]
    fn ac4_press_release_between_sends_yields_one_action(
        press_offset in 1u64..15,
        hold_ms in 1u64..15,
        value in 0.76f32..1.0,
        base in any::<i16>(),
    ) {
        let mut s = SourceState::new(SourceHandle(2));
        let mut sched = SendScheduler::new();
        // Idle baseline, then the flush that starts the quiet window.
        s.sample([base, 0], [0, 0], ON, 0);
        sched.poll(&[s.clone()], 0);
        let mut actions: Vec<DetectedAction> = Vec::new();
        let press_t = press_offset;
        let release_t = press_t + hold_ms;
        // The controller samples at input rate (every ms), not at send rate.
        for now in 1..=(release_t + 4) {
            let action_stick = if now >= press_t && now < release_t {
                [0, quantise_axis(value)]
            } else {
                [0, 0]
            };
            actions.extend(s.sample([base, 0], action_stick, ON, now));
            // Sends happen on the 60 Hz grid (now = 16, 32, …): the tap can fall entirely
            // between two of them, and the batch carries only the current snapshot.
            if now % 16 == 0
                && let Some(f) = sched.poll(std::slice::from_ref(&s), now)
            {
                prop_assert_ne!(f.reason, crate::scheduler::SendReason::Refresh);
            }
        }
        prop_assert_eq!(actions.len(), 1, "one tap, one action: {:?}", actions);
        prop_assert_eq!(actions[0].kind, ActionKind::UtilityForward);
        prop_assert!(actions[0].action.0 >= 1, "the action has a stable id");
    }

    /// The wheelie as the player feels it through the whole source: pull, hold, dwell below the
    /// release line, flick — one action carrying the preload the hold earned, or nothing at all
    /// when the dwell outlives the 250 ms window (easing off slowly is just braking).
    #[test]
    fn wheelie_through_the_source_carries_its_preload(
        preload_ms in 20u64..1_100,
        dwell_ms in 1u64..300,
    ) {
        let mut s = SourceState::new(SourceHandle(3));
        let mut t = 0u64;
        let mut ts = 0u64;
        let mut fired = Vec::new();
        while ts < preload_ms {
            ts += 10;
            t += 10;
            fired.extend(s.sample([0, quantise_axis(-1.0)], [0, 0], ON, t));
        }
        prop_assert!(fired.is_empty(), "preloading alone fires nothing");
        let exit_t = t + 10;
        fired.extend(s.sample([0, quantise_axis(-0.6)], [0, 0], ON, exit_t));
        let flick_t = exit_t + dwell_ms;
        fired.extend(s.sample([0, quantise_axis(1.0)], [0, 0], ON, flick_t));
        if dwell_ms <= crate::wheelie::RELEASE_WINDOW_MS {
            prop_assert_eq!(fired.len(), 1, "fast flick: one wheelie: {:?}", fired);
            match fired[0].kind {
                ActionKind::Wheelie { preload_ms: p } => prop_assert_eq!(u64::from(p), ts),
                other => panic!("wrong kind: {:?}", other),
            }
        } else {
            prop_assert!(fired.is_empty(), "too slow: just braking: {:?}", fired);
        }
    }
}
