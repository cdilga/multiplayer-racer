//! The party loop in the worker (P1-G01): the round director (N07b) and results (N07c) wrapped round the sim.
//!
//! Lobby → (Ready or Start now) → Preparing → Countdown → Running → Finalising → Intermission → next round. The Lobby
//! has no driving cars (R110): seats wait for the Countdown, which builds a fresh sim on the prepared map and puts
//! the round's cohort on the start grid, held until the start. A seat that claims mid-round drops in (S06). The greybox
//! is the prepared map until M08a/M08b prepare generated tracks, so a preparation completes at once. Laps are a round
//! rule (`UiCommand::SetLaps`); free drive (`UiCommand::FreeDrive`) is G04's dev mode, where Lobby cars drive.

use std::collections::VecDeque;

use jj_protocol::cmd::{CameraMode, ResultRow, RoomPhase, You};
use jj_session::director::{
    Director, DirectorConfig, Driving, Input as DirIn, Output as DirOut, Phase,
};
use jj_session::results::{
    DerbyEntrant, DerbyFacts, Entrant, FinishTime, RoundFacts, Ruleset, Standings,
};
use jj_types::{LifeId, PreparationId, RoundId};

use super::*;

/// The round loop's state on the host.
pub(super) struct RoundState {
    pub director: Director,
    pub standings: Standings,
    /// The host's laps override (`UiCommand::SetLaps`); `None` follows the track's length class (R125).
    pub laps: Option<u32>,
    pub free_drive: bool,
    pub catch_up: jj_sim::assist::CatchUp,
    /// The round on now (Countdown to Intermission), and its seats.
    pub round: Option<RoundId>,
    pub cohort: Vec<SeatId>,
    /// Seats that dropped in after the start (late entrants in the results).
    pub late: Vec<SeatId>,
    /// The last results, for Intermission and the controllers' end card.
    pub results: Option<Vec<ResultRow>>,
    pub seed: u64,
    /// Main prepares each round's map (P1-M08a); otherwise the start map is every round's.
    pub prepare_maps: bool,
    /// The preparation main is working on, its seed, and the map it delivered for the next Countdown.
    pub pending: Option<(PreparationId, u64)>,
    pub prepared: Option<LoadedMap>,
    /// `MapReady`s for a superseded preparation, dropped (R90 readout).
    pub stale_dropped: u32,
    /// The last map verdict ("ok" or the validator's rules).
    pub verdict: String,
    /// R127: launch snaps that reached the host in the last `START_GRACE_MS` of the countdown fire at GO instead of
    /// counting as false starts (the phone's own countdown can run a few frames ahead of the host's).
    pub start_launches: Vec<(jj_sim::CarId, u16)>,
    /// P1-G06: the next round is a derby (the lobby's mode choice), and whether the round on now is one.
    pub derby_next: bool,
    pub derby_now: bool,
    /// A derby round's game-time length, ms (§10.12: 3 minutes).
    pub derby_ms: u32,
    /// br-qw28: between rounds (the vote and the flyover), its timing data, and the host's results hold.
    pub between: super::between::BetweenState,
    pub timing: super::between::BetweenTiming,
    pub results_ms: u32,
    /// The seed of the track the round on now runs on (a Rematch prepares it again), and of the prepared next one.
    pub current_seed: Option<u64>,
    pub prepared_seed: Option<u64>,
    /// br-m1xe: the recipe main was asked to build with (a kept track's, or a Rematch's), for the pending preparation, the
    /// prepared map and the round on now (`None`: main's own).
    pub pending_recipe: Option<String>,
    pub prepared_recipe: Option<String>,
    pub current_recipe: Option<String>,
    /// br-m1xe: the host chose a kept track for the next round (its seed and recipe).
    pub favourite: Option<(u64, String)>,
    /// br-bbki.11: bots on the autopilot on each round's grid after the seats (the Feel Lab's carnage bowl); br-8h3u.14:
    /// the host adds them from the lobby, each with a skill and a learner level.
    pub bots: Vec<BotSpec>,
    /// br-8h3u.14: the last race's bots in the results (they score no points), for the host's results screen.
    pub bot_results: Vec<BotResult>,
    /// This round's bot cars, held with the grid through the countdown (P1-FL08).
    pub bot_cars: Vec<CarId>,
    /// The id of the bot (`BotSpec::id`) driving each of `bot_cars`: a bot the host removes mid-round keeps its car, number
    /// and place until the round ends (council review round 3: it finished as "#0 Bot").
    pub bot_ids: Vec<u32>,
    /// The next bot's id (never reused in a session).
    pub next_bot_id: u32,
    /// br-m1xe: the tick each seat's laps ended this round (its lap times).
    pub lap_ticks: std::collections::BTreeMap<SeatId, Vec<u64>>,
}

/// A bot the host added (br-8h3u.14): its id (the host menu addresses it by this, never by its row), skill (0 Easy,
/// 1 Normal, 2 Hard: `assist.json` `autopilot.botSkills`) and learner level (an L-plater when it isn't Off).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct BotSpec {
    pub id: u32,
    pub skill: u8,
    pub assist: jj_sim::assist::AssistLevel,
}

impl BotSpec {
    fn new(id: u32) -> Self {
        Self {
            id,
            skill: 1,
            assist: jj_sim::assist::AssistLevel::Off,
        }
    }
}

/// A bot's row in a race's results (br-8h3u.14): which bot, its place among every car, its time if it finished.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct BotResult {
    pub index: u32,
    pub place: u32,
    pub time_ms: Option<u32>,
}

/// The item owner of bot `index` (council review 2026-11-15): bots have no seat, so their item ledger entries name a
/// seat id counted down from the top of the range, which the room's seats (counted up from 1) never reach. Nothing is
/// sent to it: an item command to a seat with no connection goes nowhere.
pub(super) fn bot_item_owner(index: u32) -> SeatId {
    SeatId(u32::MAX - index)
}

/// The start grid's order (council review 2026-11-15: seats first and bots in the order added made a procession, Hard
/// bots stuck behind Easy ones and a player's idle car ahead of every bot). Slowest first: the Easy bots at the front,
/// then the seats alternating with the Normal bots, then the Hard bots at the back, so pace has to show by passing.
/// `seats` cars and one bot per entry of `bot_skills`; returns each one's grid slot (seats first, then bots).
pub(super) fn grid_slots(seats: usize, bot_skills: &[u8]) -> Vec<usize> {
    // (group, rank within the group, which: seat index or seats + bot index)
    let mut order: Vec<(u8, usize, usize)> = (0..seats).map(|s| (1, 2 * s + 1, s)).collect();
    let mut normals = 0;
    for (b, &skill) in bot_skills.iter().enumerate() {
        let (group, rank) = match skill {
            0 => (0, b),
            1 => {
                normals += 1;
                (1, 2 * (normals - 1))
            }
            _ => (2, b),
        };
        order.push((group, rank, seats + b));
    }
    order.sort_unstable();
    let mut slots = vec![0; order.len()];
    for (slot, &(_, _, who)) in order.iter().enumerate() {
        slots[who] = slot;
    }
    slots
}

/// The shortest derby round the host may set (a round of a few hits), ms.
pub(super) const MIN_DERBY_MS: u32 = 30_000;

/// How long before GO a launch snap still counts as "on GO" (ms).
pub(super) const START_GRACE_MS: u64 = 150;

impl RoundState {
    pub fn new(seed: u64) -> Self {
        let timing = super::between::BetweenTiming::shipped();
        Self {
            // br-qw28: the Intermission is the results hold plus the vote.
            director: Director::new(DirectorConfig {
                intermission_ms: timing.results_ms + timing.vote_ms,
                ..DirectorConfig::default()
            }),
            between: Default::default(),
            timing,
            results_ms: timing.results_ms,
            current_seed: None,
            prepared_seed: None,
            pending_recipe: None,
            prepared_recipe: None,
            current_recipe: None,
            favourite: None,
            lap_ticks: Default::default(),
            bots: Vec::new(),
            bot_results: Vec::new(),
            bot_cars: Vec::new(),
            bot_ids: Vec::new(),
            next_bot_id: 0,
            standings: Standings::default(),
            laps: None,
            free_drive: false,
            catch_up: jj_sim::assist::CatchUp::Light,
            round: None,
            cohort: Vec::new(),
            late: Vec::new(),
            results: None,
            seed,
            prepare_maps: false,
            start_launches: Vec::new(),
            derby_next: false,
            derby_now: false,
            derby_ms: 180_000,
            pending: None,
            prepared: None,
            stale_dropped: 0,
            verdict: String::new(),
        }
    }
}

/// A track's laps by its length class (R125, `assets/profiles/generator.json`).
fn laps_for(map: &LoadedMap) -> u32 {
    let pts = &map.map.route.points;
    let len_m: f64 = (0..pts.len())
        .map(|i| {
            let (a, b) = (&pts[i], &pts[(i + 1) % pts.len()]);
            f64::from(b.x - a.x).hypot(f64::from(b.z - a.z)) / 1000.0
        })
        .sum();
    jj_procgen::tuning::GeneratorData::shipped().laps_for_length(len_m)
}

pub(super) fn room_phase(p: Phase) -> RoomPhase {
    match p {
        Phase::Lobby | Phase::Disbanded => RoomPhase::Lobby,
        Phase::Preparing | Phase::Countdown => RoomPhase::Countdown,
        Phase::Running | Phase::Finalising => RoomPhase::Racing,
        Phase::Intermission => RoomPhase::Results,
    }
}

impl Host {
    /// The laps the next race runs: the host's override, else the track's length class (R125: sprint, standard and epic
    /// tracks run more or fewer laps so a race lasts about the same time; the data is `assets/profiles/generator.json`).
    pub(super) fn effective_laps(&self) -> u32 {
        self.round.laps.unwrap_or_else(|| laps_for(&self.map))
    }

    /// The laps the next race runs, if that's known: the host's number, else the prepared track's length class (null while
    /// it's still being made; without main's preparation the start map is every round's).
    pub(super) fn next_laps(&self) -> Option<u32> {
        if let Some(l) = self.round.laps {
            return Some(l);
        }
        match &self.round.prepared {
            Some(map) => Some(laps_for(map)),
            None if !self.round.prepare_maps => Some(laps_for(&self.map)),
            None => None,
        }
    }

    /// The room view's laps: the running race's own count (a change mid-race is for the next round), else the next race's,
    /// else the current map's.
    fn laps_now(&self) -> u32 {
        let race = self.sim.race();
        if race.started_at.is_some() && !self.round.derby_now && self.round.round.is_some() {
            return race.laps;
        }
        self.next_laps().unwrap_or_else(|| self.effective_laps())
    }

    /// What cars may do now.
    pub(super) fn driving(&self) -> Driving {
        self.round.director.driving()
    }

    /// Host time for the director, once per tick.
    pub(super) fn round_tick(&mut self, tick: u64) {
        let ms = (tick_ms(tick + 1) - tick_ms(tick)) as u32;
        // br-qw28: the flyover holds the director's presentation clock (the countdown waits for it).
        if !self.between_tick(ms) {
            return;
        }
        self.director_apply(DirIn::Elapsed { ms });
    }

    /// Feeds the director and acts on everything it says (outputs can feed it again, e.g. a preparation finishing).
    pub(super) fn director_apply(&mut self, input: DirIn) {
        let mut queue: VecDeque<DirOut> = self.round.director.apply(input).into();
        while let Some(o) = queue.pop_front() {
            queue.extend(self.director_output(o));
        }
    }

    fn director_output(&mut self, o: DirOut) -> Vec<DirOut> {
        match o {
            // Main prepares generated maps (M08a): the seed is the session seed plus the preparation id, so a bug clip
            // names the exact track. Without it the start map is always ready.
            DirOut::PrepareRequested { id, .. } if self.round.prepare_maps => {
                // br-qw28: a Rematch prepares the round's own seed again; Surprise me lets main draw the style.
                // br-m1xe: a kept track the host chose comes first; then a Rematch (its seed and recipe again).
                // (Kept until the countdown commits it, so the room shows it and a later preparation uses it too.)
                let (seed, recipe) = match self.round.favourite.clone() {
                    Some((seed, recipe)) => (seed, Some(recipe)),
                    None => (
                        self.round
                            .between
                            .rematch_seed
                            .take()
                            .unwrap_or_else(|| self.round.seed.wrapping_add(u64::from(id.0))),
                        self.round.between.rematch_recipe.take(),
                    ),
                };
                self.round.pending_recipe = recipe.clone();
                let surprise = std::mem::take(&mut self.round.between.surprise) && recipe.is_none();
                self.round.pending = Some((id, seed));
                self.round.prepared = None;
                // A derby round's arena is sized for everyone in the room now (late joiners still fit: no cap).
                let arena_cars = self
                    .round
                    .derby_next
                    .then(|| (self.inputs.len() as u32 + self.round.bots.len() as u32).max(2));
                self.events.push(SimEvent::PrepareRequested {
                    preparation: id,
                    seed,
                    arena_cars,
                    surprise,
                    recipe,
                });
                vec![]
            }
            DirOut::PrepareRequested { id, .. } => {
                // Without main's preparation (tests, the greybox), a derby round's arena is built here.
                let seed = self
                    .round
                    .between
                    .rematch_seed
                    .take()
                    .unwrap_or_else(|| self.round.seed.wrapping_add(u64::from(id.0)));
                self.round.prepared_seed = Some(seed);
                // A race keeps this host's own map: an arena prepared for a derby before the host switched to Race
                // doesn't wait for it.
                self.round.prepared = None;
                if self.round.derby_next {
                    let cars = (self.inputs.len() + self.round.bots.len()).max(2);
                    self.round.prepared =
                        jj_procgen::arena::prepare(seed, cars, &jj_procgen::registry()).ok();
                }
                self.round
                    .director
                    .apply(DirIn::PrepareFinished { id, ok: true })
            }
            DirOut::PrepareCancelled { id } => {
                if self.round.pending.is_some_and(|(p, _)| p == id) {
                    self.round.pending = None;
                }
                vec![]
            }
            DirOut::CountdownStarted { cohort, .. } => {
                self.between_countdown();
                self.round.favourite = None;
                self.round.derby_now = self.round.derby_next;
                self.start_grid(&cohort);
                self.room_state_all();
                vec![]
            }
            DirOut::RoundStarted { round, seats, .. } => {
                self.round.round = Some(round);
                self.round.cohort = seats;
                self.round.lap_ticks.clear();
                self.round.late.clear();
                let laps = self.effective_laps();
                self.sim.set_catch_up(self.round.catch_up);
                if self.round.derby_now {
                    // P1-G06: a derby round on game time; the director ends it at the same limit (SetGameLimit).
                    let ticks = u64::from(self.round.derby_ms) * u64::from(jj_sim::TICK_HZ) / 1000;
                    self.sim.start_derby(ticks);
                } else {
                    self.sim.start_race(laps);
                }
                // Snaps that arrived just before GO launch now, the first tick of the race (R127).
                for (car, preload_ms) in std::mem::take(&mut self.round.start_launches) {
                    self.sim.wheelie(car, preload_ms);
                }
                self.room_state_all();
                vec![]
            }
            DirOut::RoundFinalising { round } => {
                let saved = self.commit_results(round);
                self.round.director.apply(DirIn::ResultsCommitted { saved })
            }
            DirOut::Ended | DirOut::Settled | DirOut::RoundVoided { .. } => {
                if self.round.director.phase() == Phase::Lobby {
                    self.enter_lobby();
                }
                self.room_state_all();
                vec![]
            }
            DirOut::Disbanded => {
                let ended = HostCmd::Ended.encode();
                for endpoint in self.net_endpoints() {
                    self.out.push(SimToMain::Outbound {
                        endpoint,
                        channel: Channel::Cmd,
                        bytes: ended.clone(),
                    });
                }
                vec![]
            }
            DirOut::PhaseChanged { phase } => {
                if phase == Phase::Lobby {
                    self.round.between = Default::default();
                    self.enter_lobby();
                }
                self.session_rev += 1;
                self.room_state_all();
                vec![]
            }
            DirOut::IntermissionStarted { .. } => {
                self.between_intermission_started();
                self.session_rev += 1;
                self.room_state_all();
                vec![]
            }
            DirOut::ReadyCleared { .. } | DirOut::StartCancelled { .. } => {
                self.session_rev += 1;
                self.room_state_all();
                vec![]
            }
            _ => vec![],
        }
    }

    /// A fresh world on the prepared map, the cohort on the start grid in seat order (held until the start), and no
    /// debris from before the round (R58 is per round).
    fn start_grid(&mut self, cohort: &[SeatId]) {
        // P1-C10: practice is for while a round runs; the practisers are on this grid with everyone.
        self.end_all_practice();
        self.round.start_launches.clear();
        if let Some(map) = self.round.prepared.take() {
            self.map = map;
        }
        if let Some(seed) = self.round.prepared_seed.take() {
            self.round.current_seed = Some(seed);
            self.round.current_recipe = self.round.prepared_recipe.take();
        }
        self.reset_world();
        let seats: Vec<SeatId> = cohort
            .iter()
            .copied()
            .filter(|s| self.inputs.contains_key(s))
            .collect();
        let models: Vec<usize> = seats.iter().map(|&s| self.vehicle_of_seat(s)).collect();
        let skills: Vec<u8> = self.round.bots.iter().map(|b| b.skill).collect();
        let slots = grid_slots(seats.len(), &skills);
        // Car ids stay seats first, then bots (the TV numbers a bot's car after the seats'); only the grid slots mix.
        let cars: Vec<CarId> = models
            .iter()
            .zip(&slots)
            .map(|(&m, &slot)| self.sim.spawn_car_as(self.sim.grid_pose(slot), m))
            .collect();
        for (seat, car) in seats.iter().zip(cars) {
            if let Some(input) = self.inputs.get_mut(seat) {
                input.car = Some(car);
                input.dropped = false;
            }
        }
        // br-bbki.11: the bots, on the grid after the seats, each on the autopilot (no seat: they're in the world and the
        // derby ledger, not the results).
        self.round.bot_cars = slots[seats.len()..]
            .iter()
            .map(|&slot| self.sim.spawn_car_as(self.sim.grid_pose(slot), 0))
            .collect();
        self.round.bot_ids = self.round.bots.iter().map(|b| b.id).collect();
        // br-8h3u.14: each at its skill's pace, an L-plater on its learner level.
        let skills = self.sim.assist_profile().autopilot.bot_skills;
        for (&bot, spec) in self.round.bot_cars.iter().zip(&self.round.bots) {
            self.sim.set_autopilot(bot, true);
            // Council review round 3: a bot's finish doesn't end the race on the humans (only a seat's opens the window).
            self.sim.set_bot(bot);
            let pace = skills.pace_milli(spec.skill);
            if pace != 1000 {
                self.sim.set_bot_pace(bot, pace);
            }
            if spec.assist != jj_sim::assist::AssistLevel::Off {
                self.sim.set_assist(bot, spec.assist);
            }
        }
        self.session_rev += 1;
    }

    /// Back to the Lobby: no cars on the road (R110), unless free drive (G04's dev mode) puts every seat in a car.
    fn enter_lobby(&mut self) {
        self.end_all_practice();
        self.round.round = None;
        self.round.cohort.clear();
        self.reset_world();
        if self.round.free_drive {
            let seats: Vec<SeatId> = self.inputs.keys().copied().collect();
            for seat in seats {
                let car = self.sim.spawn_grid_as(&[self.vehicle_of_seat(seat)])[0];
                if let Some(input) = self.inputs.get_mut(&seat) {
                    input.car = Some(car);
                }
            }
        }
        self.session_rev += 1;
    }

    /// The vehicle table or a pick changed: in the Lobby with free drive on, the world is rebuilt so every seat's car is its
    /// pick; otherwise a new world is built at the next Countdown anyway, and nothing happens here.
    pub(super) fn rebuild_for_vehicles(&mut self) {
        if self.round.round.is_none() && self.phase() == Phase::Lobby {
            self.enter_lobby();
        }
    }

    /// A new sim on the same map and seed: every car, prop and piece of debris from before is gone with it.
    pub(super) fn reset_world(&mut self) {
        // The tuned profile (owner tuning menu) carries into every round's new world.
        self.sim = Sim::with_profiles(
            &self.map,
            &jj_procgen::registry(),
            self.round.seed,
            self.vehicles.iter().map(|(_, p)| p.clone()).collect(),
        );
        self.sim.set_air_profile(self.air_profile.clone());
        for input in self.inputs.values_mut() {
            input.car = None;
            input.dropped = false;
        }
        self.round.bot_cars.clear();
        self.round.bot_ids.clear();
        self.seen_race_events = 0;
        self.seen_utility_events = 0;
        self.seen_damage_events = 0;
        self.wrecks_seen.clear();
        self.seen_item_events = 0;
        self.spawn_items.clear();
        self.seen_derby_events = 0;
        self.derby_hits.clear();
        self.sent_inventory.clear();
    }

    /// A seat got a car from the seat reducer (claimed, or back from sitting out): it drives now in free drive or a
    /// running round (drop-in); otherwise it waits for the next Countdown's grid.
    pub(super) fn car_wanted(&mut self, seat: SeatId) -> Option<CarId> {
        let v = self.vehicle_of_seat(seat);
        match self.driving() {
            Driving::FreeDrive => Some(self.sim.spawn_grid_as(&[v])[0]),
            Driving::Racing => Some(self.sim.drop_in_as(v)),
            // A late joiner in the Countdown takes the next grid slot, held with the rest until GO (G02).
            Driving::Held if self.phase() == Phase::Countdown => {
                Some(self.sim.spawn_grid_as(&[v])[0])
            }
            Driving::Held => None,
        }
    }

    /// Classifies the round from the race and commits it to the session standings; returns whether it saved.
    fn commit_results(&mut self, round: RoundId) -> bool {
        if self.round.derby_now {
            return self.commit_derby(round);
        }
        let race = self.sim.race();
        let start = race.started_at.unwrap_or(0);
        let entrants: Vec<Entrant> = self
            .round
            .cohort
            .iter()
            .map(|&seat| {
                let car = self.inputs.get(&seat).and_then(|i| i.car);
                entrant_from_race(
                    seat,
                    car.and_then(|c| race.car(c.0)),
                    self.round.late.contains(&seat),
                )
            })
            .collect();
        let facts = RoundFacts {
            round,
            ruleset: Ruleset::default(),
            entrants,
        };
        let Ok(committed) = self.round.standings.commit(&facts) else {
            return false;
        };
        let result = match committed {
            jj_session::results::Committed::New(r) | jj_session::results::Committed::Again(r) => r,
        };
        // br-8h3u.14: with bots in the race every car takes its place among all of them, finishers in finish order, then
        // the unfinished by distance covered (council review round 3: every DNF shared "–"); the bots score nothing, and
        // the seats keep their points.
        let race = self.sim.race();
        let ranked: Vec<u32> = race.standings().iter().map(|r| r.car).collect();
        let with_bots = !self.round.bot_cars.is_empty();
        let place_of = |car: CarId| {
            ranked
                .iter()
                .position(|&o| o == car.0)
                .map_or(0, |p| p as u32 + 1)
        };
        let rows: Vec<ResultRow> = result
            .rows
            .iter()
            .filter_map(|c| {
                let seat = self.seats.seat(c.seat)?;
                let time_ms = facts
                    .entrants
                    .iter()
                    .find(|e| e.seat == c.seat)
                    .and_then(|e| e.finish)
                    .map(|f| tick_ms(f.tick.saturating_sub(start)) as u32);
                let place = if with_bots {
                    self.inputs
                        .get(&c.seat)
                        .and_then(|i| i.car)
                        .map_or(0, place_of)
                } else {
                    c.place.unwrap_or(0)
                };
                if left_unplaced(seat, place) {
                    return None;
                }
                Some(ResultRow {
                    number: seat.number,
                    name: self.seats.display_name(c.seat).unwrap_or_default(),
                    place,
                    time_ms,
                    points: c.points,
                })
            })
            .collect();
        let bot_results: Vec<BotResult> = self
            .round
            .bot_cars
            .iter()
            .enumerate()
            .map(|(i, &car)| BotResult {
                index: i as u32,
                place: place_of(car),
                time_ms: race
                    .car(car.0)
                    .and_then(|c| c.finished_at)
                    .map(|t| tick_ms(t.saturating_sub(start)) as u32),
            })
            .collect();
        self.round.bot_results = bot_results;
        self.events.push(SimEvent::Results { rows: rows.clone() });
        self.round.results = Some(rows);
        true
    }

    /// P1-G06: a derby round's results from the ledger (P1-S10): ranked by raw points, ties sharing, the championship
    /// table without a finish bonus.
    fn commit_derby(&mut self, round: RoundId) -> bool {
        self.round.bot_results.clear();
        let Some(ledger) = self.sim.derby() else {
            return false;
        };
        let mut played: Vec<SeatId> = self.round.cohort.clone();
        for &s in &self.round.late {
            if !played.contains(&s) {
                played.push(s);
            }
        }
        let entrants: Vec<DerbyEntrant> = played
            .iter()
            .map(|&seat| {
                let car = self.inputs.get(&seat).and_then(|i| i.car);
                let present = self
                    .seats
                    .seat(seat)
                    .is_some_and(|s| s.presence != seats::Presence::Left);
                DerbyEntrant {
                    seat,
                    entered: car.is_some(),
                    units: car.map_or(0, |c| ledger.units(c.0)),
                    withdrawn: !present,
                    late: self.round.late.contains(&seat),
                }
            })
            .collect();
        let facts = DerbyFacts { round, entrants };
        let Ok(committed) = self.round.standings.commit_derby(&facts) else {
            return false;
        };
        let result = match committed {
            jj_session::results::Committed::New(r) | jj_session::results::Committed::Again(r) => r,
        };
        let rows: Vec<ResultRow> = result
            .rows
            .iter()
            .filter_map(|c| {
                let seat = self.seats.seat(c.seat)?;
                if left_unplaced(seat, c.place.unwrap_or(0)) {
                    return None;
                }
                Some(ResultRow {
                    number: seat.number,
                    name: self.seats.display_name(c.seat).unwrap_or_default(),
                    place: c.place.unwrap_or(0),
                    time_ms: None,
                    points: c.points,
                })
            })
            .collect();
        self.events.push(SimEvent::Results { rows: rows.clone() });
        self.round.results = Some(rows);
        true
    }

    fn net_endpoints(&self) -> Vec<EndpointId> {
        self.seats
            .seats()
            .filter_map(|s| s.conn.and_then(|c| self.endpoint_of(c)))
            .filter(|e| !e.0.starts_with("local:"))
            .collect()
    }

    /// Every seated controller's view of the room (phase, its seat, the countdown, results).
    pub(super) fn room_state_all(&mut self) {
        let seats: Vec<SeatId> = self.seats.seats().map(|s| s.id).collect();
        for seat in seats {
            self.room_state(seat);
        }
    }

    /// The host removed a seat (P1-G07): its phone is told (it shows "The host removed you" with Join again), and the
    /// seat leaves at the next tick boundary, like a Leave; joining again from that phone is a new claim.
    fn remove_seat(&mut self, seat: SeatId) {
        let endpoint = self
            .seats
            .seat(seat)
            .and_then(|s| s.conn)
            .and_then(|c| self.endpoint_of(c))
            .filter(|e| !e.0.starts_with("local:"));
        if let Some(endpoint) = endpoint {
            self.out.push(SimToMain::Outbound {
                endpoint,
                channel: Channel::Cmd,
                bytes: self.seat_cmd(seat, jj_protocol::cmd::HostCmd::Removed),
            });
        }
        for o in self.seats.apply(seats::Input::HostRemove { seat }) {
            self.seat_output(o);
        }
    }

    pub(super) fn room_state(&mut self, seat: SeatId) {
        let Some(s) = self.seats.seat(seat) else {
            return;
        };
        let Some(endpoint) = s.conn.and_then(|c| self.endpoint_of(c)) else {
            return;
        };
        if endpoint.0.starts_with("local:") {
            return;
        }
        let d = &self.round.director;
        let phase = d.phase();
        let you = You {
            seat,
            number: s.number,
            colour: s.colour,
            name: self.seats.display_name(seat).unwrap_or_default(),
            round: d.round().unwrap_or(RoundId(0)),
            life: LifeId(0),
            ready: d.is_ready(seat),
            camera: CameraMode::ThirdPerson,
            sitting_out: s.presence == seats::Presence::SittingOut,
        };
        let countdown_ms = matches!(phase, Phase::Countdown | Phase::Intermission)
            .then(|| d.remaining_ms().map(|m| m as u32))
            .flatten();
        let room = HostCmd::RoomState {
            phase: room_phase(phase),
            you: Some(you),
            countdown_ms,
            results: (phase == Phase::Intermission)
                .then(|| self.round.results.clone())
                .flatten(),
        };
        let bytes = self.seat_cmd(seat, room);
        self.out.push(SimToMain::Outbound {
            endpoint,
            channel: Channel::Cmd,
            bytes,
        });
        // br-qw28: a phone that joins (or rejoins) between rounds sees the vote and the flyover too.
        if self.round.between.elapsed_ms.is_some() || self.round.between.flyover_left_ms.is_some() {
            self.send_between(seat);
        }
    }

    /// The room as JSON for the host's screens (R07): phase, timer, round, laps, every seat and the standings.
    pub fn room_json(&self) -> String {
        let d = &self.round.director;
        let order: Vec<u32> = self.sim.race().standings().iter().map(|r| r.car).collect();
        // A seat that left is gone from the room (no phantom seats, G02); its standings row stays. The seat itself is
        // kept only so the same endpoint could return to it. One leaving (Remove player in a paused race, council review
        // round 3) is gone from the view at once: its car leaves at the resumed tick.
        let seats: Vec<serde_json::Value> = self
            .seats
            .seats()
            .filter(|s| s.presence != seats::Presence::Left && !s.is_leaving())
            .map(|s| {
                let round_car = self.inputs.get(&s.id).and_then(|i| i.car).map(|c| c.0);
                // P1-C10: a practising seat's tile follows its practice car (its own id in the snapshot).
                let practice = self.practice_snapshot_id(s.id);
                let car = round_car;
                let race =
                    car.and_then(|c| self.sim.race().standings().into_iter().find(|r| r.car == c));
                // br-ennm: the respawn hold's time left (ms) and its cause, for the tile's banner: a wreck's why
                // ("outOfBounds", "flipped", "wheelLoss") when one started this hold, else "recover".
                let tick = self.sim.tick();
                let wreck = car
                    .and_then(|c| Some((c, self.sim.race().car(c)?.hold_until)))
                    .filter(|&(_, until)| tick < until)
                    .map(|(c, until)| {
                        let why = self
                            .wrecks_seen
                            .get(&c)
                            .filter(|(t, _)| *t + jj_sim::race::RESPAWN_HOLD_TICKS >= until)
                            .map_or("recover", |(_, why)| why);
                        (super::tick_ms(until - tick), why)
                    });
                serde_json::json!({
                    "seat": s.id.0,
                    "number": s.number.0,
                    "name": self.seats.display_name(s.id).unwrap_or_default(),
                    "rgb": s.colour.rgb,
                    "colourIndex": s.colour.index,
                    "ready": d.is_ready(s.id),
                    "vehicle": self.picks.get(&s.id).map(|p| p.0.as_str()),
                    "choosing": self.picks.get(&s.id).is_some_and(|p| p.1),
                    "presence": format!("{:?}", s.presence),
                    "local": s.endpoint.0.starts_with("local:"),
                    // P1-C14: which host pad, wheel or key cluster holds this seat ("local:<source>" or "local:<source>#<n>"), so the
                    // tile can show that source's own controls card and glyphs.
                    "localSource": s.endpoint.0.strip_prefix("local:").and_then(|r| r.split('#').next()).and_then(|n| n.parse::<u32>().ok()),
                    // The transport endpoint (an id, never the secret): diagnostics match it to the peer's path.
                    "endpoint": (!s.endpoint.0.starts_with("local:")).then_some(s.endpoint.0.as_str()),
                    "car": practice.or(car),
                    // P1-C10: practising in its own world (its tile shows the practice course), and its round car if it
                    // has one (on the autopilot meanwhile).
                    "practice": practice.is_some(),
                    "roundCar": round_car,
                    "laps": race.map(|r| r.laps),
                    "position": car.and_then(|c| order.iter().position(|&o| o == c)).map(|p| p + 1),
                    "boost": car.and_then(|c| self.sim.action_state(CarId(c))).map(|a| (a.boost.clamp(0.0, 1.0) * 255.0).round() as u8),
                    "finished": race.and_then(|r| r.finished_at).is_some(),
                    // P1-S10: in a derby round, the seat's raw points and rank (ties share).
                    // br-bhkz.2: with the car's health zones (percent: front, back, left doors, right doors, weakest
                    // wheel; 255 none) and its latest scoring hit (its count, points so far and what it was).
                    "derby": car.and_then(|c| self.sim.derby().map(|l| {
                        let (health, hit) = self.derby_reads(jj_sim::CarId(c));
                        serde_json::json!({
                            "points": l.points(c), "rank": l.rank_of(c), "health": health,
                            "hit": { "seq": hit.seq, "points": f64::from(hit.half_points()) / 2.0, "what": hit.what },
                        })
                    })),
                    // Owner playtest 2026-10-17 (finishing gave no feedback): the finishing time, for the tile's banner.
                    "finishMs": race.and_then(|r| r.finished_at).map(|t| super::tick_ms(t.saturating_sub(self.sim.race().started_at.unwrap_or(t)))),
                    // br-m1xe: each lap's time this round (ms), from GO and lap to lap.
                    "lapMs": self.lap_ms(s.id),
                    "wreckMs": wreck.map(|w| w.0),
                    "wreckWhy": wreck.map(|w| w.1),
                    // Council review round 3: the car has been crawling for `race.json` `recover.stuckAfterS` while racing;
                    // the tile says to tap Recover (the race recovers it itself at `autoAfterS`).
                    "stuck": car.is_some_and(|c| practice.is_none() && self.sim.race().is_stuck(c, tick)),
                    // R119: how long this seat's pad has been unplugged (null while plugged); nothing expires the seat.
                    "unpluggedMs": self.inputs.get(&s.id).and_then(|i| i.unplugged_since_ms).map(|t| super::tick_ms(self.sim.tick()).saturating_sub(t)),
                    // R125: 0 Off, 1 Some, 2 Lots; the tile shows an L-plate while it isn't 0.
                    "assist": self.inputs.get(&s.id).map_or(0, |i| i.assist.as_u8()),
                    // The autopilot holds this seat's car (idle, menu open, dropped out): the tile says so (council review
                    // 2026-11-15: an idle phone won races with nothing on screen to say nobody was driving).
                    "autopilot": self.inputs.get(&s.id).is_some_and(|i| i.dropped),
                    "inventory": self.inventory_for(s.id),
                    "prompt": self.inputs.get(&s.id).filter(|i| i.prompt.showing()).map(|i| serde_json::json!({ "step": i.prompt.step, "of": super::prompts::STEPS.len(), "done": i.prompt.done() })),
                })
            })
            .collect();
        let rejected_frames = self.rejected_frames;
        let standings: Vec<serde_json::Value> = self
            .round
            .standings
            .table()
            .iter()
            .map(|r| serde_json::json!({ "seat": r.seat.0, "place": r.place, "points": r.total.points, "wins": r.total.wins }))
            .collect();
        let race = self.sim.race();
        let race_ends_in_ms = race
            .window_closes_at()
            .filter(|_| race.over.is_none())
            .map(|t| super::tick_ms(t.saturating_sub(self.sim.tick())));
        serde_json::json!({
            "phase": format!("{:?}", d.phase()),
            "remainingMs": d.remaining_ms(),
            "round": d.round().map(|r| r.0),
            // The race's laps while one runs, else the next race's (council review round 3: the lobby promised the last
            // map's 5 and the race ran the new track's 3). `lapsAuto`: no number was chosen, the track's length decides;
            // `nextLaps` is that number once the next track is ready (null until then).
            "laps": self.laps_now(),
            "lapsAuto": self.round.laps.is_none(),
            "nextLaps": self.next_laps(),
            // Once the first seat finishes (any car in a room of only bots), the rest have the finish window to finish (null
            // before, and once it's over).
            "raceEndsInMs": race_ends_in_ms,
            // P1-G06: this round's mode, the next round's (the lobby's choice), and the host's derby/intermission lengths.
            "mode": if self.round.derby_now { "derby" } else { "race" },
            "nextMode": if self.round.derby_next { "derby" } else { "race" },
            "derbyMs": self.round.derby_ms,
            // The host's results hold (br-qw28: the vote follows it), and the vote and flyover between rounds.
            "intermissionMs": self.round.results_ms,
            "between": self.between_json(),
            // P1-S10: a derby round's game time left (null outside a derby).
            "derbyLeftMs": self.sim.derby().map(|l| super::tick_ms(l.time_left_ticks(self.sim.tick()))),
            "freeDrive": self.round.free_drive,
            "bots": self.round.bots.len(),
            // br-8h3u.14: each bot's skill (0 Easy, 1 Normal, 2 Hard) and learner level, and the last race's bot rows.
            // A bot's race position (null outside a round) counts every car, as a seat's does.
            // Each bot's id is what the host menu sends back (never its row). `slot`: its car's place among this round's bot
            // cars (the TV numbers bot cars after the seats', in this order), null if it isn't racing this round.
            "botList": self.round.bots.iter().map(|b| {
                let slot = self.round.bot_ids.iter().position(|&id| id == b.id);
                let position = slot.and_then(|i| self.round.bot_cars.get(i)).and_then(|c| order.iter().position(|&o| o == c.0)).map(|p| p + 1);
                serde_json::json!({ "id": b.id, "skill": b.skill, "assist": b.assist.as_u8(), "position": position, "slot": slot })
            }).collect::<Vec<_>>(),
            // This round's bot cars in slot order, a bot the host removed mid-round included (it races on to the end).
            "botCars": self.round.bot_ids.iter().zip(&self.round.bot_cars).map(|(&id, c)| {
                serde_json::json!({ "id": id, "position": order.iter().position(|&o| o == c.0).map(|p| p + 1) })
            }).collect::<Vec<_>>(),
            "botResults": self.round.bot_results.iter().map(|b| serde_json::json!({ "index": b.index, "place": b.place, "timeMs": b.time_ms })).collect::<Vec<_>>(),
            "catchUp": self.round.catch_up == jj_sim::assist::CatchUp::Light,
            // The roster's vehicle ids in table order: a snapshot car's vehicle (flags bits 16-31) indexes this (R123).
            "vehicles": self.vehicles.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            "armed": d.armed(),
            "preparation": {
                "external": self.round.prepare_maps,
                "pending": self.round.pending.map(|(p, s)| serde_json::json!({ "id": p.0, "seed": s })),
                "prepared": self.round.prepared.is_some(),
                // br-qw28: the seed of the track the round on now runs on (a Rematch prepares it again).
                "current": self.round.current_seed,
                "currentRecipe": self.round.current_recipe,
                "favourite": self.round.favourite.as_ref().map(|(s, r)| serde_json::json!({ "seed": s, "recipe": r })),
                "staleDropped": self.round.stale_dropped,
                "verdict": self.round.verdict,
            },
            "seats": seats,
            "results": self.round.results,
            "standings": standings,
            "rejectedFrames": rejected_frames,
        })
        .to_string()
    }

    /// The vehicle tuning as the owner tuning menu shows it (br-2sdu.1): every field, and why the last change was
    /// refused, if it was.
    pub fn tuning_json(&self) -> String {
        // Through text, so the f32 thresholds read as 0.8 and not 0.800000011.
        let input: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&self.input_profile).unwrap_or_default())
                .unwrap_or_default();
        let air: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&self.air_profile).unwrap_or_default())
                .unwrap_or_default();
        let ids: Vec<&str> = self.vehicles.iter().map(|(id, _)| id.as_str()).collect();
        let tuned = &self.vehicles[self.tuning_vehicle];
        serde_json::json!({
            "tuning": tuned.1.tuning, "input": input, "air": air, "error": self.tuning_error,
            "vehicle": tuned.0, "vehicles": ids,
        })
        .to_string()
    }

    /// Reads every seat's sticks with the (changed) input profile, and tells every connected controller.
    fn apply_input_profile(&mut self) {
        let resolved = self.input_profile.resolve();
        for seat in self.inputs.values_mut() {
            seat.state.set_profile(resolved);
        }
        let bytes = HostCmd::InputProfile(self.input_profile.to_wire()).encode();
        for endpoint in self.net_endpoints() {
            self.out.push(SimToMain::Outbound {
                endpoint,
                channel: Channel::Cmd,
                bytes: bytes.clone(),
            });
        }
    }

    /// A host UI command for the round loop.
    pub(super) fn round_ui(&mut self, ui: UiCommand) {
        match ui {
            // br-qw28: Start during the flyover skips it (the countdown follows).
            UiCommand::StartRound => {
                if !self.skip_flyover() {
                    self.director_apply(DirIn::StartNow)
                }
            }
            UiCommand::EndRound => self.director_apply(DirIn::End),
            UiCommand::DisbandRoom => self.director_apply(DirIn::Disband),
            // 0 is Auto: the track's length class decides (council review round 3: the menu showed 5 lit, the race ran 3).
            UiCommand::SetLaps { laps } => {
                self.round.laps = (laps > 0).then_some(laps);
                self.session_rev += 1;
            }
            UiCommand::SetMode { derby } => {
                let changed = self.round.derby_next != derby;
                self.round.derby_next = derby;
                // Council review round 3 (#8): Round complete switches Race/Derby for the next round. The next map is
                // already preparing in the background (a course or an arena, by the old mode): prepare it again in the
                // new one. A countdown's map is committed; the switch applies from the round after.
                if changed
                    && self.round.director.preparation().is_some()
                    && matches!(
                        self.round.director.phase(),
                        Phase::Lobby | Phase::Intermission | Phase::Preparing
                    )
                {
                    self.director_apply(DirIn::Reroll);
                }
                let limit = derby.then_some(self.round.derby_ms);
                self.director_apply(DirIn::SetGameLimit(limit));
                self.session_rev += 1;
            }
            UiCommand::SetDerbyLength { ms } => {
                self.round.derby_ms = ms.max(MIN_DERBY_MS);
                if self.round.derby_next {
                    self.director_apply(DirIn::SetGameLimit(Some(self.round.derby_ms)));
                }
                self.session_rev += 1;
            }
            UiCommand::SetIntermission { ms } => {
                // br-qw28: the results hold; the vote follows it.
                self.round.results_ms = ms.clamp(5_000, 600_000);
                self.sync_intermission();
                self.session_rev += 1;
            }
            UiCommand::SetNextTrack { choice } => self.set_next_track(choice),
            UiCommand::SetBots { n } => {
                self.round.bots.truncate(n as usize);
                while self.round.bots.len() < n as usize {
                    let id = self.round.next_bot_id;
                    self.round.next_bot_id += 1;
                    self.round.bots.push(BotSpec::new(id));
                }
                self.session_rev += 1;
            }
            UiCommand::SetBotSkill { id, skill } => {
                if let Some(b) = self.round.bots.iter_mut().find(|b| b.id == id) {
                    b.skill = skill.min(2);
                }
                self.session_rev += 1;
            }
            UiCommand::SetBotAssist { id, level } => {
                if let Some(b) = self.round.bots.iter_mut().find(|b| b.id == id) {
                    b.assist = jj_sim::assist::AssistLevel::from_u8(level);
                }
                self.session_rev += 1;
            }
            // A second press on a row that's already gone does nothing (by index it took the next bot down).
            UiCommand::RemoveBot { id } => {
                self.round.bots.retain(|b| b.id != id);
                self.session_rev += 1;
            }
            UiCommand::SetSeatAssist { seat, level } => {
                if let Some(input) = self.inputs.get_mut(&SeatId(seat)) {
                    input.assist = jj_sim::assist::AssistLevel::from_u8(level);
                }
                self.session_rev += 1;
            }
            // br-m1xe: a kept track for the next round. A preparation already made for it is superseded.
            UiCommand::SetFavourite { seed, recipe } => {
                self.round.favourite = seed.map(|s| (s, recipe));
                if self.round.prepare_maps
                    && matches!(
                        self.phase(),
                        Phase::Lobby | Phase::Intermission | Phase::Preparing
                    )
                {
                    self.director_apply(DirIn::Reroll);
                }
                self.session_rev += 1;
            }
            UiCommand::SetCatchUp { on } => {
                self.round.catch_up = if on {
                    jj_sim::assist::CatchUp::Light
                } else {
                    jj_sim::assist::CatchUp::Off
                };
                self.session_rev += 1;
            }
            UiCommand::PrepareMaps { on } => self.round.prepare_maps = on,
            // Draw the next track seed: the director supersedes the preparation (cancelling the old id).
            UiCommand::Reroll => self.director_apply(DirIn::Reroll),
            UiCommand::RemoveSeat { seat } => self.remove_seat(seat),
            // `input.<section>.<field>`: the input profile (br-2sdu.2), live to every seat and controller.
            UiCommand::SetTuning { field, value } if field.starts_with("input.") => {
                match self
                    .input_profile
                    .with_fields(&[(field["input.".len()..].to_owned(), value)])
                    .and_then(|p| jj_input::InputProfile::from_wire(&p.to_wire()))
                {
                    Ok(p) => {
                        self.input_profile = p;
                        self.tuning_error = None;
                        self.apply_input_profile();
                    }
                    Err(e) => self.tuning_error = Some(format!("{field}: {e}")),
                }
                self.session_rev += 1;
            }
            // `air.<path>`: the air-control and landing data (br-bbki.7.1), one set for every car, live mid-flight.
            UiCommand::SetTuning { field, value } if field.starts_with("air.") => {
                match self
                    .air_profile
                    .with_fields(&[(field["air.".len()..].to_owned(), value)])
                {
                    Ok(p) => {
                        self.sim.set_air_profile(p.clone());
                        self.air_profile = p;
                        self.tuning_error = None;
                    }
                    Err(e) => self.tuning_error = Some(format!("{field}: {e}")),
                }
                self.session_rev += 1;
            }
            UiCommand::SetTuning { field, value } => {
                let at = self.tuning_vehicle;
                match jj_fixture::profile_from(
                    self.vehicles[at].1.clone(),
                    &[(field.clone(), value)],
                ) {
                    Ok(p) => {
                        // Only cars of the tuned vehicle change (R123).
                        self.sim.set_tuning_for(at, p.tuning.clone());
                        self.vehicles[at].1 = p;
                        self.tuning_error = None;
                    }
                    Err(e) => self.tuning_error = Some(e),
                }
                self.session_rev += 1;
            }
            UiCommand::TuneVehicle { vehicle } => {
                if let Some(at) = self.vehicles.iter().position(|(id, _)| *id == vehicle) {
                    self.tuning_vehicle = at;
                }
                self.session_rev += 1;
            }
            UiCommand::FreeDrive { on } => {
                self.round.free_drive = on;
                let cfg = DirectorConfig {
                    lobby_free_drive: on,
                    ..DirectorConfig::default()
                };
                if self.round.director.phase() == Phase::Lobby {
                    self.round.director = Director::new(cfg);
                    let seats: Vec<SeatId> = self.inputs.keys().copied().collect();
                    for seat in seats {
                        self.round.director.apply(DirIn::SetEligible {
                            seat,
                            eligible: true,
                        });
                    }
                    self.enter_lobby();
                }
            }
            _ => {}
        }
    }

    /// G04's dev free drive (the host page's `?drive`, and tests of driving mechanics): Lobby cars drive.
    pub fn set_free_drive(&mut self, on: bool) {
        self.round_ui(UiCommand::FreeDrive { on });
    }

    /// The round director's phase (tests and the host's screens).
    pub fn phase(&self) -> Phase {
        self.round.director.phase()
    }

    /// br-m1xe: a seat's lap times this round (ms): from GO to its first lap's end, then lap to lap.
    fn lap_ms(&self, seat: SeatId) -> Vec<u64> {
        let mut from = self.sim.race().started_at.unwrap_or(0);
        self.round
            .lap_ticks
            .get(&seat)
            .map(|ticks| {
                ticks
                    .iter()
                    .map(|&t| {
                        let ms = super::tick_ms(t.saturating_sub(from));
                        from = t;
                        ms
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// A prepared map from main (P1-M08a): validated here (the sim owns colliders), committed at the next Countdown; a
    /// stale preparation is dropped and counted, a broken map fails the preparation (the director retries once with the
    /// conservative recipe, then settles in the Lobby).
    pub(super) fn map_ready(&mut self, preparation: PreparationId, map_bytes: &[u8]) {
        if self.round.pending.map(|(p, _)| p) != Some(preparation) {
            self.round.stale_dropped += 1;
            return;
        }
        let ok = match load_canonical(map_bytes, &jj_procgen::registry()) {
            Ok(map) => {
                self.round.prepared = Some(map);
                self.round.prepared_seed = self.round.pending.map(|(_, s)| s);
                self.round.prepared_recipe = self.round.pending_recipe.clone();
                self.round.verdict = "ok".into();
                true
            }
            Err(r) => {
                self.round.verdict = r
                    .violations
                    .iter()
                    .map(|v| v.rule.name())
                    .collect::<Vec<_>>()
                    .join(", ");
                false
            }
        };
        self.round.pending = None;
        // br-qw28: a between-rounds start flies over the new track before its countdown.
        if self.hold_for_flyover(preparation, ok) {
            return;
        }
        // The vote closed before this map arrived and the director is still in Intermission: fly over it now.
        if ok
            && self.round.between.decided.is_some()
            && self.round.director.phase() == Phase::Intermission
        {
            self.director_apply(DirIn::PrepareFinished {
                id: preparation,
                ok,
            });
            self.round_flyover_now();
            return;
        }
        self.director_apply(DirIn::PrepareFinished {
            id: preparation,
            ok,
        });
    }

    /// READY from a controller or a host pad/key cluster, under the director's current Ready revision.
    pub(super) fn set_ready(&mut self, seat: SeatId, ready: bool) {
        // br-qw28: a press during the flyover skips it.
        if ready && self.skip_flyover() {
            return;
        }
        let revision = self.round.director.ready_revision();
        self.director_apply(DirIn::SetReady {
            seat,
            ready,
            revision,
        });
        self.session_rev += 1;
        self.room_state(seat);
    }
}

/// Council review round 3 (#5): a seat that left the round (the host removed it, or it left) before it placed is not in
/// that round's results as if it raced to the end ("– #2 Shazza +0"); its standings row keeps its points.
fn left_unplaced(seat: &seats::Seat, place: u32) -> bool {
    seat.presence == seats::Presence::Left && place == 0
}

/// Keep the authoritative same-tick finish and unfinished-progress tie-breaks at the session boundary.
pub(super) fn entrant_from_race(
    seat: SeatId,
    car: Option<&jj_sim::race::CarRace>,
    late: bool,
) -> Entrant {
    Entrant {
        seat,
        entered: car.is_some(),
        finish: car.and_then(|c| {
            c.finished_at.map(|tick| FinishTime {
                tick,
                fraction: c.finish_fraction,
            })
        }),
        progress_mm: car.map_or(0, |c| c.best_progress_mm),
        progress_tick: car.map_or(0, |c| c.best_progress_tick),
        withdrawn: car.is_none(),
        late,
    }
}
