//! The host's round director (P1-N07b, master §10.6 and §10.8): one reducer runs the party by itself.
//!
//! ```text
//! Lobby ─start─► Preparing ─map ready─► Countdown ─► Running ─round over─► Finalising ─results─► Intermission
//!   ▲              (only if the map                                                                   │ timer, all Ready
//!   │               isn't ready yet)  ◄──────────────────────── next round (Preparing if needed) ◄─────┘ or Start now
//!   └── End (any phase), empty party settle, failed fallback
//! ```
//!
//! Pure and deterministic like the seat reducer: inputs in, outputs out, time only through [`Input::Elapsed`]. Timers
//! run on the **presentation clock**, which stops while a manual, host-hidden or fault pause is on (§3.5); renderer and
//! performance pauses stop the sim but not the clock. The host feeds in who is eligible (active, source-fresh, non-parked
//! human seats from [`crate::seats`] and the transport), Ready taps, host buttons, map-preparation results and the
//! rules' round-over, and acts on the outputs: prepare or cancel a map, warn not-ready phones, start the round.
//!
//! - **Start policy:** with the ready-based start armed, the round starts when every eligible seat is Ready (nonempty).
//!   **Start now** starts anyway: not-ready seats get a warning (10 s, host-configurable 5–15 s), then everyone plays with
//!   their current car; pressing it again skips the countdown. Force overrides Ready only, never map readiness.
//! - **Cohort freeze:** the start cohort freezes when a start begins. New seats join with their current selection and
//!   don't restart it; an original seat un-readying cancels a ready-based start and returns where it came from.
//! - **Preparation IDs:** every request (start, intermission, reroll, fallback) takes a new [`PreparationId`]; a
//!   completion for any other id is stale and can't commit. End cancels the pending job and voids an unfinished round.
//! - **No zero-player loop:** a round never starts with no eligible seats; an empty party settles in Lobby and disarms
//!   the automatic start. Nothing here counts or caps seats (R36).
//!
//! Known gaps (later beads): voting and its close deadline, replay visibility, finite events (EventEnd) and the 30-minute
//! idle End. The wire `RoomPhase`/`PauseReason` mapping lands with the browser wiring (G01).

use std::collections::BTreeSet;

use jj_types::{PreparationId, RoundId, SeatId};

#[cfg(test)]
mod tests;

/// Timer lengths, in presentation-clock milliseconds.
#[derive(Clone, Debug)]
pub struct DirectorConfig {
    /// The 3-2-1 countdown (§10.6).
    pub countdown_ms: u32,
    /// The "Starting soon" warning not-ready seats get on a host force-start (§10.6: 10 s, clamped to 5–15 s).
    pub force_warning_ms: u32,
    /// Results and reel between rounds (§10.8: ~60 s, a host setting).
    pub intermission_ms: u32,
    /// How long Finalising waits for the results commit before showing them as unsaved (never an endless spinner).
    pub finalise_timeout_ms: u32,
    /// Initial room setup arms the ready-based start (§10.6).
    pub ready_start_armed: bool,
}

impl Default for DirectorConfig {
    fn default() -> Self {
        Self {
            countdown_ms: 3_000,
            force_warning_ms: 10_000,
            intermission_ms: 60_000,
            finalise_timeout_ms: 5_000,
            ready_start_armed: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Lobby,
    Preparing,
    Countdown,
    Running,
    Finalising,
    Intermission,
    /// Terminal: the room is gone.
    Disbanded,
}

/// What started the pending start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartPolicy {
    /// Every eligible seat was Ready; an original seat un-readying cancels it.
    AllReady,
    /// The host pressed Start now (Ready doesn't matter).
    Forced,
    /// The intermission timer ran out (Ready is optional in Party Mix).
    Auto,
}

/// Pause reasons compose; the sim pauses while any is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Pause {
    Manual,
    HostHidden,
    RendererUnavailable,
    PerformanceStall,
    Fault,
}

impl Pause {
    /// Manual, hidden and fault pauses stop countdown and intermission time (§10.8).
    pub fn freezes_timers(self) -> bool {
        matches!(self, Pause::Manual | Pause::HostHidden | Pause::Fault)
    }
}

/// What cars may do in the current phase.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Driving {
    /// Lobby warm-up (§9): free driving on the greybox with collisions and damage on; no progress, laps or score.
    FreeDrive,
    /// Held on the grid or parked (Preparing, Countdown, Finalising, Intermission).
    Held,
    /// The round is on.
    Racing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Input {
    /// Host time passing (the director keeps the presentation clock from it).
    Elapsed {
        ms: u32,
    },
    /// A seat became (or stopped being) an eligible human seat: active, source-fresh and not parked.
    SetEligible {
        seat: SeatId,
        eligible: bool,
    },
    /// A Ready tap, under the Ready revision the controller was showing; another revision is stale and ignored.
    SetReady {
        seat: SeatId,
        ready: bool,
        revision: u32,
    },
    /// Host **Start now** / **Start next round now**; pressed again during a start, skips the countdown.
    StartNow,
    /// Host arms or disarms "Start when everyone is ready".
    ArmReadyStart(bool),
    /// Host rerolls or picks the next map before the countdown runs out; supersedes the current preparation.
    Reroll,
    /// A map preparation finished (or failed).
    PrepareFinished {
        id: PreparationId,
        ok: bool,
    },
    /// The rules froze the result at the final tick.
    RoundOver,
    /// Scores and standings committed; `saved: false` shows them as unsaved (storage failed).
    ResultsCommitted {
        saved: bool,
    },
    Pause {
        reason: Pause,
        on: bool,
    },
    /// Host End game: cancel pending jobs, void an unfinished round, back to Lobby with everyone connected.
    End,
    /// Host Disband room: End, then the room is gone.
    Disband,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Output {
    PhaseChanged {
        phase: Phase,
    },
    /// Prepare this map in the background; only this id can commit.
    PrepareRequested {
        id: PreparationId,
        fallback: bool,
    },
    PrepareCancelled {
        id: PreparationId,
    },
    /// A completion for a superseded or cancelled preparation, ignored.
    StalePreparation {
        id: PreparationId,
    },
    /// A preparation failed; the director retries with the conservative fallback once, then settles in Lobby.
    PreparationFailed {
        id: PreparationId,
        retrying_with_fallback: bool,
    },
    /// Start now with seats not Ready: these phones get the "Starting soon" banner and vibration.
    ForceStartWarning {
        seats: Vec<SeatId>,
        ms: u32,
    },
    CountdownStarted {
        policy: StartPolicy,
        ms: u64,
        cohort: Vec<SeatId>,
    },
    /// An original seat un-readied during a ready-based start.
    StartCancelled {
        by: SeatId,
    },
    RoundStarted {
        round: RoundId,
        preparation: PreparationId,
        seats: Vec<SeatId>,
    },
    RoundFinalising {
        round: RoundId,
    },
    IntermissionStarted {
        round: RoundId,
        ms: u32,
        unsaved: bool,
    },
    RoundVoided {
        round: RoundId,
    },
    /// Ready was cleared; controllers show this revision from now on.
    ReadyCleared {
        revision: u32,
    },
    /// The party emptied (or the fallback map failed): back in Lobby, automatic start disarmed.
    Settled,
    Ended,
    Disbanded,
    PauseChanged {
        reasons: Vec<Pause>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PrepState {
    Pending,
    Ready,
}

#[derive(Clone, Copy, Debug)]
struct Prep {
    id: PreparationId,
    state: PrepState,
    fallback: bool,
}

/// Where a cancelled ready-based start returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Origin {
    Lobby,
    Intermission { remaining_ms: u64 },
}

#[derive(Clone, Debug)]
struct Start {
    policy: StartPolicy,
    origin: Origin,
    cohort: BTreeSet<SeatId>,
    /// The force-start warning runs until this presentation time; the countdown can't end before it.
    warn_until: Option<u64>,
    skip_countdown: bool,
}

#[derive(Clone, Debug)]
pub struct Director {
    cfg: DirectorConfig,
    /// Presentation clock, ms.
    now: u64,
    phase: Phase,
    eligible: BTreeSet<SeatId>,
    ready: BTreeSet<SeatId>,
    ready_revision: u32,
    armed: bool,
    pauses: BTreeSet<Pause>,
    prep: Option<Prep>,
    next_prep: u32,
    round: Option<RoundId>,
    next_round: u32,
    /// The countdown, intermission or finalise deadline on the presentation clock.
    deadline: Option<u64>,
    start: Option<Start>,
}

impl Default for Director {
    fn default() -> Self {
        Self::new(DirectorConfig::default())
    }
}

impl Director {
    pub fn new(mut cfg: DirectorConfig) -> Self {
        cfg.force_warning_ms = cfg.force_warning_ms.clamp(5_000, 15_000);
        let armed = cfg.ready_start_armed;
        Self {
            cfg,
            now: 0,
            phase: Phase::Lobby,
            eligible: BTreeSet::new(),
            ready: BTreeSet::new(),
            ready_revision: 0,
            armed,
            pauses: BTreeSet::new(),
            prep: None,
            next_prep: 1,
            round: None,
            next_round: 1,
            deadline: None,
            start: None,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// The presentation clock, ms.
    pub fn now_ms(&self) -> u64 {
        self.now
    }

    /// Time left on the countdown, intermission or finalise timer.
    pub fn remaining_ms(&self) -> Option<u64> {
        self.deadline.map(|d| d.saturating_sub(self.now))
    }

    /// The current (or last) round.
    pub fn round(&self) -> Option<RoundId> {
        self.round
    }

    /// The live preparation and whether its map is ready.
    pub fn preparation(&self) -> Option<(PreparationId, bool)> {
        self.prep.map(|p| (p.id, p.state == PrepState::Ready))
    }

    pub fn ready_revision(&self) -> u32 {
        self.ready_revision
    }

    pub fn is_ready(&self, seat: SeatId) -> bool {
        self.ready.contains(&seat)
    }

    pub fn armed(&self) -> bool {
        self.armed
    }

    /// The frozen start cohort while a start is pending.
    pub fn cohort(&self) -> Option<Vec<SeatId>> {
        self.start
            .as_ref()
            .map(|s| s.cohort.iter().copied().collect())
    }

    pub fn pauses(&self) -> impl Iterator<Item = Pause> + '_ {
        self.pauses.iter().copied()
    }

    pub fn sim_paused(&self) -> bool {
        !self.pauses.is_empty()
    }

    pub fn timers_frozen(&self) -> bool {
        self.pauses.iter().any(|p| p.freezes_timers())
    }

    pub fn driving(&self) -> Driving {
        match self.phase {
            Phase::Lobby => Driving::FreeDrive,
            Phase::Running => Driving::Racing,
            _ => Driving::Held,
        }
    }

    pub fn apply(&mut self, input: Input) -> Vec<Output> {
        let mut out = Vec::new();
        if self.phase == Phase::Disbanded {
            return out;
        }
        match input {
            Input::Elapsed { ms } => self.advance(u64::from(ms), &mut out),
            Input::SetEligible { seat, eligible } => self.set_eligible(seat, eligible, &mut out),
            Input::SetReady {
                seat,
                ready,
                revision,
            } => {
                if revision == self.ready_revision && self.eligible.contains(&seat) {
                    self.set_ready(seat, ready, &mut out);
                }
            }
            Input::StartNow => self.start_now(&mut out),
            Input::ArmReadyStart(on) => {
                self.armed = on;
                self.check_ready_start(&mut out);
            }
            Input::Reroll => self.reroll(&mut out),
            Input::PrepareFinished { id, ok } => self.prepare_finished(id, ok, &mut out),
            Input::RoundOver => {
                if self.phase == Phase::Running {
                    self.deadline = Some(self.now + u64::from(self.cfg.finalise_timeout_ms));
                    self.set_phase(Phase::Finalising, &mut out);
                    out.push(Output::RoundFinalising {
                        round: self.round.expect("a running round"),
                    });
                }
            }
            Input::ResultsCommitted { saved } => {
                if self.phase == Phase::Finalising {
                    self.enter_intermission(!saved, &mut out);
                }
            }
            Input::Pause { reason, on } => {
                let changed = if on {
                    self.pauses.insert(reason)
                } else {
                    self.pauses.remove(&reason)
                };
                if changed {
                    out.push(Output::PauseChanged {
                        reasons: self.pauses.iter().copied().collect(),
                    });
                }
            }
            Input::End => self.end(&mut out),
            Input::Disband => {
                self.end(&mut out);
                self.set_phase(Phase::Disbanded, &mut out);
                out.push(Output::Disbanded);
            }
        }
        out
    }

    /// Moves the presentation clock, firing each deadline at its own time so chained timers stay exact.
    fn advance(&mut self, ms: u64, out: &mut Vec<Output>) {
        if self.timers_frozen() {
            return;
        }
        let target = self.now + ms;
        while let Some(d) = self.deadline.filter(|&d| d <= target) {
            self.now = self.now.max(d);
            self.deadline = None;
            match self.phase {
                Phase::Countdown => self.begin_round(out),
                Phase::Intermission => self.intermission_over(out),
                Phase::Finalising => self.enter_intermission(true, out),
                _ => {}
            }
        }
        self.now = target;
    }

    fn set_phase(&mut self, phase: Phase, out: &mut Vec<Output>) {
        if self.phase != phase {
            self.phase = phase;
            out.push(Output::PhaseChanged { phase });
        }
    }

    fn set_eligible(&mut self, seat: SeatId, eligible: bool, out: &mut Vec<Output>) {
        if eligible {
            // A new seat joins with its current selection: it neither restarts nor cancels a start.
            self.eligible.insert(seat);
            return;
        }
        self.eligible.remove(&seat);
        self.ready.remove(&seat);
        if self.start.is_some() && self.eligible.is_empty() {
            self.settle(out);
        } else {
            // Everyone left who wasn't Ready may complete an all-ready start.
            self.check_ready_start(out);
        }
    }

    fn set_ready(&mut self, seat: SeatId, ready: bool, out: &mut Vec<Output>) {
        if ready {
            self.ready.insert(seat);
            self.check_ready_start(out);
            return;
        }
        if !self.ready.remove(&seat) {
            return;
        }
        let cancels = self
            .start
            .as_ref()
            .is_some_and(|s| s.policy == StartPolicy::AllReady && s.cohort.contains(&seat));
        if cancels {
            let start = self.start.take().expect("checked");
            out.push(Output::StartCancelled { by: seat });
            match start.origin {
                Origin::Lobby => {
                    self.deadline = None;
                    self.set_phase(Phase::Lobby, out);
                }
                Origin::Intermission { remaining_ms } => {
                    self.deadline = Some(self.now + remaining_ms);
                    self.set_phase(Phase::Intermission, out);
                }
            }
        }
    }

    /// An all-ready start: armed in Lobby, always in Intermission (Party Mix starts early when everyone is Ready).
    fn check_ready_start(&mut self, out: &mut Vec<Output>) {
        if self.start.is_some() || self.eligible.is_empty() || !self.eligible.is_subset(&self.ready)
        {
            return;
        }
        match self.phase {
            Phase::Lobby if self.armed => {
                self.begin_start(StartPolicy::AllReady, Origin::Lobby, None, out)
            }
            Phase::Intermission => {
                let origin = Origin::Intermission {
                    remaining_ms: self.remaining_ms().unwrap_or(0),
                };
                self.begin_start(StartPolicy::AllReady, origin, None, out);
            }
            _ => {}
        }
    }

    fn start_now(&mut self, out: &mut Vec<Output>) {
        if let Some(start) = self.start.as_mut() {
            // Pressed again: skip the countdown (and the rest of any warning); never the map's readiness.
            start.skip_countdown = true;
            start.warn_until = None;
            if self.phase == Phase::Countdown {
                self.begin_round(out);
            }
            return;
        }
        let origin = match self.phase {
            Phase::Lobby => Origin::Lobby,
            Phase::Intermission => Origin::Intermission {
                remaining_ms: self.remaining_ms().unwrap_or(0),
            },
            _ => return,
        };
        if self.eligible.is_empty() {
            return;
        }
        let not_ready: Vec<SeatId> = self.eligible.difference(&self.ready).copied().collect();
        let warn_until = if not_ready.is_empty() {
            None
        } else {
            out.push(Output::ForceStartWarning {
                seats: not_ready,
                ms: self.cfg.force_warning_ms,
            });
            Some(self.now + u64::from(self.cfg.force_warning_ms))
        };
        self.begin_start(StartPolicy::Forced, origin, warn_until, out);
    }

    /// Freezes the cohort and moves to Countdown if the map is ready, else to Preparing (requesting it if needed).
    fn begin_start(
        &mut self,
        policy: StartPolicy,
        origin: Origin,
        warn_until: Option<u64>,
        out: &mut Vec<Output>,
    ) {
        if self.eligible.is_empty() {
            self.settle(out);
            return;
        }
        self.start = Some(Start {
            policy,
            origin,
            cohort: self.eligible.clone(),
            warn_until,
            skip_countdown: false,
        });
        match self.prep.map(|p| p.state) {
            Some(PrepState::Ready) => self.enter_countdown(out),
            Some(PrepState::Pending) => self.enter_preparing(out),
            None => {
                self.request_prep(false, out);
                self.enter_preparing(out);
            }
        }
    }

    fn enter_preparing(&mut self, out: &mut Vec<Output>) {
        self.deadline = None;
        self.set_phase(Phase::Preparing, out);
    }

    fn enter_countdown(&mut self, out: &mut Vec<Output>) {
        let start = self.start.as_ref().expect("a pending start");
        if start.skip_countdown {
            self.begin_round(out);
            return;
        }
        let warning_left = start.warn_until.map_or(0, |w| w.saturating_sub(self.now));
        let ms = u64::from(self.cfg.countdown_ms).max(warning_left);
        let (policy, cohort) = (start.policy, start.cohort.iter().copied().collect());
        self.deadline = Some(self.now + ms);
        self.set_phase(Phase::Countdown, out);
        out.push(Output::CountdownStarted { policy, ms, cohort });
    }

    /// Commits the prepared map and everyone eligible now (the cohort plus late joiners) to a new round.
    fn begin_round(&mut self, out: &mut Vec<Output>) {
        let Some(prep) = self.prep.filter(|p| p.state == PrepState::Ready) else {
            self.enter_preparing(out);
            return;
        };
        if self.eligible.is_empty() {
            self.settle(out);
            return;
        }
        let round = RoundId(self.next_round);
        self.next_round += 1;
        self.round = Some(round);
        self.prep = None;
        self.start = None;
        self.deadline = None;
        self.clear_ready(out);
        self.set_phase(Phase::Running, out);
        out.push(Output::RoundStarted {
            round,
            preparation: prep.id,
            seats: self.eligible.iter().copied().collect(),
        });
    }

    fn enter_intermission(&mut self, unsaved: bool, out: &mut Vec<Output>) {
        self.deadline = Some(self.now + u64::from(self.cfg.intermission_ms));
        self.clear_ready(out);
        self.set_phase(Phase::Intermission, out);
        out.push(Output::IntermissionStarted {
            round: self.round.expect("a finished round"),
            ms: self.cfg.intermission_ms,
            unsaved,
        });
        // The next track prepares in the background while the results play.
        self.request_prep(false, out);
    }

    fn intermission_over(&mut self, out: &mut Vec<Output>) {
        if self.eligible.is_empty() {
            self.settle(out);
        } else {
            self.begin_start(
                StartPolicy::Auto,
                Origin::Intermission { remaining_ms: 0 },
                None,
                out,
            );
        }
    }

    fn reroll(&mut self, out: &mut Vec<Output>) {
        match self.phase {
            Phase::Lobby | Phase::Intermission | Phase::Preparing => self.request_prep(false, out),
            Phase::Countdown => {
                // A new pick invalidates the countdown's map: wait for the new one, keeping the start and its cohort.
                self.request_prep(false, out);
                self.enter_preparing(out);
            }
            _ => {}
        }
    }

    fn request_prep(&mut self, fallback: bool, out: &mut Vec<Output>) {
        self.cancel_prep(out);
        let id = PreparationId(self.next_prep);
        self.next_prep += 1;
        self.prep = Some(Prep {
            id,
            state: PrepState::Pending,
            fallback,
        });
        out.push(Output::PrepareRequested { id, fallback });
    }

    fn cancel_prep(&mut self, out: &mut Vec<Output>) {
        if let Some(p) = self.prep.take()
            && p.state == PrepState::Pending
        {
            out.push(Output::PrepareCancelled { id: p.id });
        }
    }

    fn prepare_finished(&mut self, id: PreparationId, ok: bool, out: &mut Vec<Output>) {
        let Some(prep) = self
            .prep
            .filter(|p| p.id == id && p.state == PrepState::Pending)
        else {
            out.push(Output::StalePreparation { id });
            return;
        };
        if ok {
            self.prep = Some(Prep {
                state: PrepState::Ready,
                ..prep
            });
            if self.phase == Phase::Preparing && self.start.is_some() {
                self.enter_countdown(out);
            }
            return;
        }
        out.push(Output::PreparationFailed {
            id,
            retrying_with_fallback: !prep.fallback,
        });
        self.prep = None;
        if !prep.fallback {
            self.request_prep(true, out);
        } else if self.phase == Phase::Preparing {
            self.settle(out);
        }
    }

    fn clear_ready(&mut self, out: &mut Vec<Output>) {
        self.ready.clear();
        self.ready_revision += 1;
        out.push(Output::ReadyCleared {
            revision: self.ready_revision,
        });
    }

    /// Back to Lobby with the automatic start disarmed (an emptied party or a failed fallback).
    fn settle(&mut self, out: &mut Vec<Output>) {
        self.cancel_prep(out);
        self.prep = None;
        self.start = None;
        self.deadline = None;
        self.armed = false;
        self.clear_ready(out);
        self.set_phase(Phase::Lobby, out);
        out.push(Output::Settled);
    }

    fn end(&mut self, out: &mut Vec<Output>) {
        self.cancel_prep(out);
        self.prep = None;
        if matches!(self.phase, Phase::Running | Phase::Finalising) {
            out.push(Output::RoundVoided {
                round: self.round.expect("an unfinished round"),
            });
        }
        self.start = None;
        self.deadline = None;
        self.armed = false;
        self.clear_ready(out);
        self.set_phase(Phase::Lobby, out);
        out.push(Output::Ended);
    }
}
