//! Between rounds (br-qw28, R125). The results stay up for `results_ms`, then the phones vote for `vote_ms`: Rematch (the
//! same track: the same seed and recipe), New track (the same style: the next seed, the same recipe) or Surprise me (a
//! new seed whose style main draws at random). The most votes win; a tie, or no votes, is a Rematch; the host may choose
//! instead (`UiCommand::SetNextTrack`). Then, before the countdown, the TV flies along the new track for `flyover_ms`:
//! any press skips it, and seats can still change car until it ends (the grid is built at the countdown).
//!
//! The director keeps its own Intermission deadline (results + vote). The vote closes a tick before it; while the flyover
//! runs the director's presentation clock is held, so the countdown waits for it. A map that arrives while the director
//! is Preparing holds its `PrepareFinished` until the flyover ends.

use std::collections::BTreeMap;

use jj_protocol::cmd::{Between, HostCmd, NextTrack};
use jj_session::director::{Input as DirIn, Phase};
use jj_types::PreparationId;

use super::*;

/// `assets/profiles/rounds.json`.
pub const ROUNDS_JSON: &str = include_str!("../../../../assets/profiles/rounds.json");

#[derive(Clone, Copy, Debug)]
pub(super) struct BetweenTiming {
    pub results_ms: u32,
    pub vote_ms: u32,
    pub flyover_ms: u32,
}

impl BetweenTiming {
    pub fn shipped() -> Self {
        let v: serde_json::Value =
            serde_json::from_str(ROUNDS_JSON).expect("assets/profiles/rounds.json is valid");
        let ms = |k: &str| v[k].as_u64().unwrap_or_else(|| panic!("rounds.json {k}")) as u32;
        Self {
            results_ms: ms("resultsMs"),
            vote_ms: ms("voteMs"),
            flyover_ms: ms("flyoverMs"),
        }
    }
}

#[derive(Default)]
pub(super) struct BetweenState {
    /// Ms of Intermission so far (the presentation clock), while one runs.
    pub elapsed_ms: Option<u64>,
    pub votes: BTreeMap<SeatId, NextTrack>,
    pub host_choice: Option<NextTrack>,
    pub decided: Option<NextTrack>,
    /// Ms left of the flyover while it runs, and the preparation it holds back from the director.
    pub flyover_left_ms: Option<u32>,
    pub held: Option<(PreparationId, bool)>,
    /// The flyover for this start has run (or been skipped).
    pub flown: bool,
    /// The next preparation's seed (a Rematch) and style draw (Surprise me), taken by the next `PrepareRequested`.
    pub rematch_seed: Option<u64>,
    pub surprise: bool,
    /// What the phones were last told (sent again only when it changes).
    sent: Option<(Option<bool>, [u32; 3], Option<NextTrack>, bool)>,
}

/// The vote's result: the most votes, a tie (or none) is a Rematch.
pub(super) fn tally(votes: &BTreeMap<SeatId, NextTrack>) -> ([u32; 3], NextTrack) {
    let mut n = [0u32; 3];
    for v in votes.values() {
        n[index(*v)] += 1;
    }
    let max = *n.iter().max().unwrap_or(&0);
    let winners: Vec<usize> = (0..3).filter(|&i| n[i] == max).collect();
    let choice = if max > 0 && winners.len() == 1 {
        [NextTrack::Rematch, NextTrack::NewTrack, NextTrack::Surprise][winners[0]]
    } else {
        NextTrack::Rematch
    };
    (n, choice)
}

fn index(t: NextTrack) -> usize {
    match t {
        NextTrack::Rematch => 0,
        NextTrack::NewTrack => 1,
        NextTrack::Surprise => 2,
    }
}

fn name(t: NextTrack) -> &'static str {
    match t {
        NextTrack::Rematch => "rematch",
        NextTrack::NewTrack => "new",
        NextTrack::Surprise => "surprise",
    }
}

impl Host {
    fn between_total_ms(&self) -> u64 {
        u64::from(self.round.results_ms) + u64::from(self.round.timing.vote_ms)
    }

    /// The director's Intermission is the results hold plus the vote.
    pub(super) fn sync_intermission(&mut self) {
        let total = self.between_total_ms() as u32;
        self.round.director.set_intermission_ms(total);
    }

    /// Is the vote open now (the results hold is over and nothing is decided)?
    fn vote_open(&self) -> bool {
        self.round.director.phase() == Phase::Intermission
            && self.round.between.decided.is_none()
            && self
                .round
                .between
                .elapsed_ms
                .is_some_and(|e| e >= u64::from(self.round.results_ms))
    }

    pub(super) fn between_intermission_started(&mut self) {
        self.round.between = BetweenState {
            elapsed_ms: Some(0),
            rematch_seed: None,
            ..BetweenState::default()
        };
        self.send_between_all();
    }

    /// Steps the between-rounds clock by `ms`; returns false while the flyover holds the director's clock.
    pub(super) fn between_tick(&mut self, ms: u32) -> bool {
        if let Some(left) = self.round.between.flyover_left_ms {
            let left = left.saturating_sub(ms);
            if left == 0 {
                self.end_flyover();
            } else {
                self.round.between.flyover_left_ms = Some(left);
            }
            return false;
        }
        if self.round.director.phase() == Phase::Intermission
            && let Some(e) = self.round.between.elapsed_ms
        {
            let e = e + u64::from(ms);
            self.round.between.elapsed_ms = Some(e);
            // Closes a couple of ticks before the director's own deadline, so a flyover can hold it.
            if self.round.between.decided.is_none()
                && e + 2 * u64::from(ms) >= self.between_total_ms()
            {
                self.decide();
                if self.round.between.flyover_left_ms.is_some() {
                    return false;
                }
            }
            self.send_between_all();
        }
        true
    }

    /// The vote closes: apply its result, and fly over the next track now if it's ready (else when it arrives).
    fn decide(&mut self) {
        let (_, voted) = tally(&self.round.between.votes);
        let choice = self.round.between.host_choice.unwrap_or(voted);
        self.round.between.decided = Some(choice);
        if self.round.prepare_maps {
            match choice {
                NextTrack::Rematch => {
                    if let Some(seed) = self.round.current_seed {
                        self.round.between.rematch_seed = Some(seed);
                        self.director_apply(DirIn::Reroll);
                    }
                }
                NextTrack::Surprise => {
                    self.round.between.surprise = true;
                    self.director_apply(DirIn::Reroll);
                }
                NextTrack::NewTrack => {}
            }
        }
        let ready = self.round.pending.is_none()
            && (!self.round.prepare_maps || self.round.prepared.is_some());
        if ready {
            self.start_flyover();
        }
        self.session_rev += 1;
        self.send_between_all();
    }

    /// The vote closed while the map was still coming and it has now arrived during the Intermission.
    pub(super) fn round_flyover_now(&mut self) {
        self.start_flyover();
    }

    fn start_flyover(&mut self) {
        if self.round.between.flown || self.round.timing.flyover_ms == 0 {
            return;
        }
        self.round.between.flyover_left_ms = Some(self.round.timing.flyover_ms);
        self.session_rev += 1;
        self.send_between_all();
    }

    fn end_flyover(&mut self) {
        self.round.between.flyover_left_ms = None;
        self.round.between.flown = true;
        if let Some((id, ok)) = self.round.between.held.take() {
            self.director_apply(DirIn::PrepareFinished { id, ok });
        }
        self.session_rev += 1;
        self.send_between_all();
    }

    /// A press during the flyover skips it (Ready, an action, a host key cluster or pad). Returns true if it did.
    pub(super) fn skip_flyover(&mut self) -> bool {
        if self.round.between.flyover_left_ms.is_none() {
            return false;
        }
        self.end_flyover();
        true
    }

    /// A ready map for a between-rounds start waits for the flyover (returns true if it was held).
    pub(super) fn hold_for_flyover(&mut self, id: PreparationId, ok: bool) -> bool {
        let b = &self.round.between;
        if !ok || b.flown || b.decided.is_none() || self.round.director.phase() != Phase::Preparing
        {
            return false;
        }
        self.round.between.held = Some((id, ok));
        self.start_flyover();
        self.round.between.flyover_left_ms.is_some()
    }

    /// The countdown has begun: the between-rounds state is done with.
    pub(super) fn between_countdown(&mut self) {
        let b = std::mem::take(&mut self.round.between);
        self.round.between.rematch_seed = b.rematch_seed;
        self.send_between_all();
    }

    /// A seat's vote (a later one replaces it), while the vote is open.
    pub(super) fn vote(&mut self, seat: SeatId, choice: NextTrack) {
        if !self.vote_open() {
            return;
        }
        self.round.between.votes.insert(seat, choice);
        self.session_rev += 1;
        self.send_between_all();
    }

    /// The host's own choice (`None`: back to the vote).
    pub(super) fn set_next_track(&mut self, choice: Option<NextTrack>) {
        self.round.between.host_choice = choice;
        self.session_rev += 1;
    }

    fn between_wire(&self, seat: SeatId) -> Option<Between> {
        let b = &self.round.between;
        if b.elapsed_ms.is_none() && b.flyover_left_ms.is_none() && b.decided.is_none() {
            return None;
        }
        let (votes, _) = tally(&b.votes);
        let vote_left_ms = self.vote_open().then(|| {
            (self
                .between_total_ms()
                .saturating_sub(b.elapsed_ms.unwrap_or(0))) as u32
        });
        Some(Between {
            vote_left_ms,
            votes,
            mine: b.votes.get(&seat).copied(),
            decided: b.decided,
            flyover_left_ms: b.flyover_left_ms,
        })
    }

    /// Tells every phone the vote and flyover when they change (open/closed, a tally, the result, the flyover).
    pub(super) fn send_between_all(&mut self) {
        let b = &self.round.between;
        let (votes, _) = tally(&b.votes);
        let key = (
            b.elapsed_ms.is_some().then(|| self.vote_open()),
            votes,
            b.decided,
            b.flyover_left_ms.is_some(),
        );
        if self.round.between.sent == Some(key) {
            return;
        }
        self.round.between.sent = Some(key);
        let seats: Vec<SeatId> = self.seats.seats().map(|s| s.id).collect();
        for seat in seats {
            self.send_between(seat);
        }
    }

    /// One phone's view (also sent with its room state, so a phone that joins meanwhile sees the vote).
    pub(super) fn send_between(&mut self, seat: SeatId) {
        let between = self.between_wire(seat).unwrap_or(Between {
            vote_left_ms: None,
            votes: [0; 3],
            mine: None,
            decided: None,
            flyover_left_ms: None,
        });
        self.send_seat_phone(seat, HostCmd::Between(between));
    }

    /// The between-rounds state for the host's screens.
    pub(super) fn between_json(&self) -> serde_json::Value {
        let b = &self.round.between;
        let (votes, leading) = tally(&b.votes);
        let elapsed = b.elapsed_ms.unwrap_or(0);
        let results = u64::from(self.round.results_ms);
        serde_json::json!({
            "active": b.elapsed_ms.is_some() || b.flyover_left_ms.is_some(),
            "resultsLeftMs": b.elapsed_ms.map(|_| results.saturating_sub(elapsed)),
            "voteOpen": self.vote_open(),
            "voteLeftMs": self.vote_open().then(|| self.between_total_ms().saturating_sub(elapsed)),
            "votes": { "rematch": votes[0], "new": votes[1], "surprise": votes[2] },
            "bySeat": b.votes.iter().map(|(s, v)| (s.0.to_string(), name(*v))).collect::<BTreeMap<_, _>>(),
            "leading": name(leading),
            "hostChoice": b.host_choice.map(name),
            "decided": b.decided.map(name),
            "flyoverLeftMs": b.flyover_left_ms,
            "flyoverMs": self.round.timing.flyover_ms,
            "resultsMs": self.round.results_ms,
            "voteMs": self.round.timing.vote_ms,
        })
    }
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn the_most_votes_win_and_a_tie_or_no_vote_is_a_rematch() {
        let mut v = BTreeMap::new();
        assert_eq!(tally(&v).1, NextTrack::Rematch);
        v.insert(SeatId(1), NextTrack::Surprise);
        v.insert(SeatId(2), NextTrack::Surprise);
        v.insert(SeatId(3), NextTrack::NewTrack);
        assert_eq!(tally(&v), ([0, 1, 2], NextTrack::Surprise));
        v.insert(SeatId(3), NextTrack::NewTrack);
        v.insert(SeatId(4), NextTrack::NewTrack);
        assert_eq!(tally(&v).1, NextTrack::Rematch, "two each: a tie");
    }
}
