//! The first-drive prompts' state (P1-C06): the seven controls a newcomer is taught, steer, brake and reverse, boost,
//! drift, OI!, cone, wheelie, tracked from what the HOST detects for the seat (its sampled sticks and the discrete
//! actions it applies), so the seat's tile can show the next one and clear it when the control is seen. The phone's
//! own tutorial card tracks the same sequence from its side; the two never wait on each other and nothing here pauses
//! the room, holds Ready, a car pick or a race start. Data, not UI: `room_json` carries `{step, done}` per seat.

use jj_input::SourceSemantics;
use jj_protocol::cmd::ActionKind;

/// Each step's goal ids, in order (the wording is the host UI's, `web/host/src/ui/prompts/steps.ts`).
pub const STEPS: [&[&str]; 7] = [
    &["right", "left"],
    &["go", "stop"],
    &["boost"],
    &["drift"],
    &["oi"],
    &["cone"],
    &["wheelie"],
];

/// A stick past this counts as the gesture (the same 0.7 the phone's card uses).
const PAST: f32 = 0.7;

#[derive(Clone, Debug, Default)]
pub struct PromptTrack {
    /// The phone said prompts are wanted (`Tutorial{on:true}`); off after a skip or a finish, and for a player who
    /// skipped it on this device before.
    pub on: bool,
    pub step: usize,
    done: Vec<&'static str>,
}

impl PromptTrack {
    /// `Tutorial{on}`: turning it on after it was off starts the sequence again (Help's repeat); off hides it.
    pub fn set(&mut self, on: bool) {
        if on && !self.on {
            self.step = 0;
            self.done.clear();
        }
        self.on = on;
    }

    /// Whether the seat's tile shows a prompt now.
    pub fn showing(&self) -> bool {
        self.on && self.step < STEPS.len()
    }

    /// The goals of the current step the host has seen.
    pub fn done(&self) -> &[&'static str] {
        &self.done
    }

    fn tick_goal(&mut self, goal: &'static str) {
        if !self.showing() || !STEPS[self.step].contains(&goal) || self.done.contains(&goal) {
            return;
        }
        self.done.push(goal);
        if STEPS[self.step].iter().all(|g| self.done.contains(g)) {
            self.step += 1;
            self.done.clear();
        }
    }

    /// The seat's interpreted sticks, fresh this tick.
    pub fn sample(&mut self, s: &SourceSemantics) {
        if !self.showing() {
            return;
        }
        if s.drive.steer > PAST {
            self.tick_goal("right");
        }
        if s.drive.steer < -PAST {
            self.tick_goal("left");
        }
        if s.drive.throttle > PAST {
            self.tick_goal("go");
        }
        // Brake only counts once it has gone (the phone's card says the same): pull back after pushing up.
        if s.drive.brake > PAST && (self.done.contains(&"go") || self.step > 1) {
            self.tick_goal("stop");
        }
        if s.boost {
            self.tick_goal("boost");
        }
        if s.drift {
            self.tick_goal("drift");
        }
    }

    /// A discrete action the host applied for the seat.
    pub fn action(&mut self, kind: ActionKind) {
        self.tick_goal(match kind {
            ActionKind::UtilityForward => "oi",
            ActionKind::UtilityRear => "cone",
            ActionKind::Wheelie { .. } => "wheelie",
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sticks(steer: f32, throttle: f32, brake: f32, drift: bool, boost: bool) -> SourceSemantics {
        let mut s = SourceSemantics::default();
        s.drive.steer = steer;
        s.drive.throttle = throttle;
        s.drive.brake = brake;
        s.drift = drift;
        s.boost = boost;
        s
    }

    #[test]
    fn the_sequence_clears_one_control_at_a_time_in_order() {
        let mut p = PromptTrack::default();
        p.sample(&sticks(1.0, 0.0, 0.0, false, false));
        assert!(!p.showing(), "off until the phone asks");
        p.set(true);
        p.sample(&sticks(0.0, 0.0, 0.0, true, true));
        assert_eq!(
            (p.step, p.done().len()),
            (0, 0),
            "a later control ticks nothing early"
        );
        p.sample(&sticks(1.0, 0.0, 0.0, false, false));
        assert_eq!(p.done(), ["right"]);
        p.sample(&sticks(-1.0, 0.0, 0.0, false, false));
        assert_eq!(
            (p.step, p.done().len()),
            (1, 0),
            "both sides done: next step"
        );
        p.sample(&sticks(0.0, 0.0, 1.0, false, false));
        assert!(p.done().is_empty(), "braking before going doesn't count");
        p.sample(&sticks(0.0, 1.0, 0.0, false, false));
        p.sample(&sticks(0.0, 0.0, 1.0, false, false));
        assert_eq!(p.step, 2);
        p.sample(&sticks(0.0, 0.0, 0.0, false, true));
        p.sample(&sticks(0.0, 0.0, 0.0, true, false));
        assert_eq!(p.step, 4);
        p.action(ActionKind::UtilityForward);
        p.action(ActionKind::UtilityRear);
        p.action(ActionKind::Wheelie { preload_ms: 600 });
        assert!(!p.showing(), "all seven seen: finished");
    }

    #[test]
    fn off_hides_it_and_on_again_repeats_from_the_start() {
        let mut p = PromptTrack::default();
        p.set(true);
        p.sample(&sticks(1.0, 0.0, 0.0, false, false));
        p.set(false);
        assert!(!p.showing());
        p.set(true);
        assert_eq!((p.step, p.done().len()), (0, 0));
    }
}
