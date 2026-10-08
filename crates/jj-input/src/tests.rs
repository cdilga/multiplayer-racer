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
    classic: true,
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

// ---- P1-C11 (R116): the dual-stick layout through a whole source ----

const DUAL: SampleFlags = SampleFlags {
    available: true,
    drive_touch: true,
    action_touch: true,
    menu_open: false,
    classic: false,
};

#[test]
fn r116_full_throttle_and_full_lock_read_together_with_no_fire() {
    let mut s = SourceState::new(SourceHandle(1));
    let fired = s.sample([0, 32767], [32767, 0], DUAL, 0);
    assert!(fired.is_empty(), "no utility, no wheelie");
    let sem = s.semantics();
    assert_eq!((sem.drive.throttle, sem.drive.steer), (1.0, 1.0));
    // Full forward is only throttle: the boost is the wheelie launch.
    assert!(!sem.boost && !sem.drift);
}

#[test]
fn r116_a_rim_drift_keeps_full_throttle_and_the_old_layout_still_reads_the_old_way() {
    let mut s = SourceState::new(SourceHandle(1));
    s.sample([32767, 0], [0, 0], DUAL, 0);
    let sem = s.semantics();
    assert!(sem.drift && sem.drive.throttle > 0.99 && !sem.boost);
    // The same samples in the old layout: left x steers, nothing drifts.
    let mut c = SourceState::new(SourceHandle(2));
    let classic = SampleFlags {
        classic: true,
        ..DUAL
    };
    c.sample([32767, 0], [0, 0], classic, 0);
    let sem = c.semantics();
    assert_eq!((sem.drive.steer, sem.drive.throttle), (1.0, 0.0));
    assert!(!sem.drift);
}

#[test]
fn r116_a_flick_up_or_down_fires_forward_or_back_and_hard_steering_never_does() {
    let mut s = SourceState::new(SourceHandle(1));
    s.sample([0, 0], [0, 0], DUAL, 0);
    s.sample([0, 0], [0, 16000], DUAL, 30);
    let up = s.sample([0, 0], [0, 32767], DUAL, 60);
    assert_eq!(
        up.iter().map(|a| a.kind).collect::<Vec<_>>(),
        vec![ActionKind::UtilityForward]
    );
    s.sample([0, 0], [0, 0], DUAL, 800);
    s.sample([0, 0], [0, -16000], DUAL, 830);
    let down = s.sample([0, 0], [0, -32767], DUAL, 860);
    assert_eq!(
        down.iter().map(|a| a.kind).collect::<Vec<_>>(),
        vec![ActionKind::UtilityRear]
    );
    // Steering hard and wandering up and down within half range fires nothing.
    let mut h = SourceState::new(SourceHandle(2));
    h.sample([0, 0], [0, 0], DUAL, 0);
    for i in 1..40u64 {
        let y = if i % 2 == 0 { 15000 } else { -15000 };
        assert!(h.sample([0, 0], [32767, y], DUAL, i * 20).is_empty());
    }
}

#[test]
fn r116_changing_a_profile_value_changes_the_behaviour_with_no_code_change() {
    use crate::profile::InputProfile;
    let mut p = InputProfile::standard();
    p.flick.cooldown_ms = 2000;
    let mut s = SourceState::with_profile(SourceHandle(1), p.resolve());
    s.sample([0, 0], [0, 0], DUAL, 0);
    assert_eq!(s.sample([0, 0], [0, 32767], DUAL, 30).len(), 1);
    s.sample([0, 0], [0, 0], DUAL, 700);
    // 700 ms later the default 350 ms cooldown would have re-armed; this profile's 2 s has not.
    assert!(s.sample([0, 0], [0, 32767], DUAL, 730).is_empty());
    let mut d = SourceState::new(SourceHandle(2));
    d.sample([0, 0], [0, 0], DUAL, 0);
    d.sample([0, 0], [0, 32767], DUAL, 30);
    d.sample([0, 0], [0, 0], DUAL, 700);
    assert_eq!(d.sample([0, 0], [0, 32767], DUAL, 730).len(), 1);
}

#[test]
fn r116_the_record_carries_the_layout_and_neutralising_clears_both_machines() {
    let mut s = SourceState::new(SourceHandle(1));
    s.sample([32767, 0], [0, 0], DUAL, 0);
    assert!(s.semantics().drift);
    assert!(
        !s.record()
            .flags
            .has(jj_protocol::state::StateFlags::CLASSIC)
    );
    s.neutralise(Neutralise::Hidden);
    assert!(!s.semantics().drift);
    let c = SampleFlags {
        classic: true,
        ..DUAL
    };
    s.sample([0, 0], [0, 0], c, 10);
    assert!(
        s.record()
            .flags
            .has(jj_protocol::state::StateFlags::CLASSIC)
    );
}

const ZONE: i16 = -32767;
const TOP: i16 = 32767;

/// Pulls the left stick fully back for `ms` (samples every 20 ms) from `t0`, returning the time after it.
fn pull(s: &mut SourceState, t0: u64, ms: u64) -> u64 {
    let mut t = t0;
    while t < t0 + ms {
        s.sample([0, ZONE], [0, 0], DUAL, t);
        t += 20;
    }
    t
}

#[test]
fn r116_pull_then_snap_launches_once_then_cools_down() {
    let mut s = SourceState::new(SourceHandle(1));
    let t = pull(&mut s, 0, 500);
    let fired = s.sample([0, TOP], [0, 0], DUAL, t + 40);
    assert_eq!(fired.len(), 1, "the snap to full forward launches");
    assert!(matches!(fired[0].kind, ActionKind::Wheelie { preload_ms } if preload_ms >= 500));
    assert!(s.launch_cooldown(t + 40).0 > 3000, "the ring starts full");
    // Another pull and snap inside the cooldown does nothing.
    let t2 = pull(&mut s, t + 100, 500);
    assert!(s.sample([0, TOP], [0, 0], DUAL, t2 + 40).is_empty());
    // After the cooldown it works again, and the ring has emptied.
    let t3 = pull(&mut s, t2 + 5000, 500);
    assert_eq!(s.launch_cooldown(t3), (0, 0));
    assert_eq!(s.sample([0, TOP], [0, 0], DUAL, t3 + 40).len(), 1);
}

#[test]
fn r116_a_throttle_roll_on_after_braking_never_launches() {
    let mut s = SourceState::new(SourceHandle(1));
    let mut t = pull(&mut s, 0, 500);
    // Out of the pull and up to full throttle over 600 ms: a roll-on, not a snap.
    for k in 1..=30 {
        let y = ZONE as i32 + (TOP as i32 - ZONE as i32) * k / 30;
        assert!(s.sample([0, y as i16], [0, 0], DUAL, t).is_empty());
        t += 20;
    }
}

#[test]
fn r116_a_full_pull_arms_first_and_reverses_only_past_the_delay() {
    let mut s = SourceState::new(SourceHandle(1));
    let t = pull(&mut s, 0, 500);
    let early = s.semantics().drive;
    assert!(
        early.brake == 1.0 && !early.reverse,
        "the brakes hold, no reverse yet"
    );
    pull(&mut s, t, 600);
    assert!(
        s.semantics().drive.reverse,
        "held past the delay it is reverse"
    );
}

#[test]
fn r116_a_pull_held_through_a_countdown_stays_armed_for_the_snap_at_go() {
    let mut s = SourceState::new(SourceHandle(1));
    // Three seconds of full pull (the countdown), then the snap at GO.
    let t = pull(&mut s, 0, 3000);
    let fired = s.sample([0, TOP], [0, 0], DUAL, t + 40);
    assert_eq!(fired.len(), 1, "nothing cancelled the pull");
    assert!(matches!(fired[0].kind, ActionKind::Wheelie { preload_ms } if preload_ms > 0));
}

#[test]
fn r116_the_old_layout_keeps_the_old_wheelie() {
    let mut s = SourceState::new(SourceHandle(1));
    let classic = SampleFlags {
        classic: true,
        ..DUAL
    };
    s.sample([0, ZONE], [0, 0], classic, 0);
    s.sample([0, ZONE], [0, 0], classic, 300);
    // A release to just above the old line (y > -0.3) fires there, not in the new layout.
    assert_eq!(s.sample([0, -2000], [0, 0], classic, 320).len(), 1);
}
