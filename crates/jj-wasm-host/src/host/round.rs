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
use jj_session::results::{Entrant, FinishTime, RoundFacts, Ruleset, Standings};
use jj_types::{LifeId, PreparationId, RoundId};

use super::*;

/// The round loop's state on the host.
pub(super) struct RoundState {
    pub director: Director,
    pub standings: Standings,
    pub laps: u32,
    pub free_drive: bool,
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
}

impl RoundState {
    pub fn new(seed: u64) -> Self {
        Self {
            director: Director::new(DirectorConfig::default()),
            standings: Standings::default(),
            laps: jj_sim::race::DEFAULT_LAPS,
            free_drive: false,
            round: None,
            cohort: Vec::new(),
            late: Vec::new(),
            results: None,
            seed,
            prepare_maps: false,
            pending: None,
            prepared: None,
            stale_dropped: 0,
            verdict: String::new(),
        }
    }
}

fn room_phase(p: Phase) -> RoomPhase {
    match p {
        Phase::Lobby | Phase::Disbanded => RoomPhase::Lobby,
        Phase::Preparing | Phase::Countdown => RoomPhase::Countdown,
        Phase::Running | Phase::Finalising => RoomPhase::Racing,
        Phase::Intermission => RoomPhase::Results,
    }
}

impl Host {
    /// What cars may do now.
    pub(super) fn driving(&self) -> Driving {
        self.round.director.driving()
    }

    /// Host time for the director, once per tick.
    pub(super) fn round_tick(&mut self, tick: u64) {
        let ms = (tick_ms(tick + 1) - tick_ms(tick)) as u32;
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
                let seed = self.round.seed.wrapping_add(u64::from(id.0));
                self.round.pending = Some((id, seed));
                self.round.prepared = None;
                self.events.push(SimEvent::PrepareRequested {
                    preparation: id,
                    seed,
                });
                vec![]
            }
            DirOut::PrepareRequested { id, .. } => self
                .round
                .director
                .apply(DirIn::PrepareFinished { id, ok: true }),
            DirOut::PrepareCancelled { id } => {
                if self.round.pending.is_some_and(|(p, _)| p == id) {
                    self.round.pending = None;
                }
                vec![]
            }
            DirOut::CountdownStarted { cohort, .. } => {
                self.start_grid(&cohort);
                self.room_state_all();
                vec![]
            }
            DirOut::RoundStarted { round, seats, .. } => {
                self.round.round = Some(round);
                self.round.cohort = seats;
                self.round.late.clear();
                self.sim.start_race(self.round.laps);
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
                    self.enter_lobby();
                }
                self.session_rev += 1;
                self.room_state_all();
                vec![]
            }
            DirOut::ReadyCleared { .. }
            | DirOut::IntermissionStarted { .. }
            | DirOut::StartCancelled { .. } => {
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
        if let Some(map) = self.round.prepared.take() {
            self.map = map;
        }
        self.reset_world();
        let seats: Vec<SeatId> = cohort
            .iter()
            .copied()
            .filter(|s| self.inputs.contains_key(s))
            .collect();
        let models: Vec<usize> = seats.iter().map(|&s| self.vehicle_of_seat(s)).collect();
        let cars = self.sim.spawn_grid_as(&models);
        for (seat, car) in seats.iter().zip(cars) {
            if let Some(input) = self.inputs.get_mut(seat) {
                input.car = Some(car);
                input.dropped = false;
            }
        }
        self.session_rev += 1;
    }

    /// Back to the Lobby: no cars on the road (R110), unless free drive (G04's dev mode) puts every seat in a car.
    fn enter_lobby(&mut self) {
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
    fn reset_world(&mut self) {
        // The tuned profile (owner tuning menu) carries into every round's new world.
        self.sim = Sim::with_profiles(
            &self.map,
            &jj_procgen::registry(),
            self.round.seed,
            self.vehicles.iter().map(|(_, p)| p.clone()).collect(),
        );
        for input in self.inputs.values_mut() {
            input.car = None;
            input.dropped = false;
        }
        self.seen_race_events = 0;
        self.seen_utility_events = 0;
        self.seen_damage_events = 0;
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
        let race = self.sim.race();
        let start = race.started_at.unwrap_or(0);
        let entrants: Vec<Entrant> = self
            .round
            .cohort
            .iter()
            .map(|&seat| {
                let car = self.inputs.get(&seat).and_then(|i| i.car);
                let standing =
                    car.and_then(|c| race.standings().into_iter().find(|s| s.car == c.0));
                Entrant {
                    seat,
                    entered: car.is_some(),
                    finish: standing.and_then(|s| s.finished_at).map(|t| FinishTime {
                        tick: t,
                        fraction: 0,
                    }),
                    progress_mm: standing.map_or(0, |s| (s.progress_m.max(0.0) * 1000.0) as u64),
                    progress_tick: self.sim.tick(),
                    withdrawn: car.is_none(),
                    late: self.round.late.contains(&seat),
                }
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
                Some(ResultRow {
                    number: seat.number,
                    name: self.seats.display_name(c.seat).unwrap_or_default(),
                    place: c.place.unwrap_or(0),
                    time_ms,
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
    }

    /// The room as JSON for the host's screens (R07): phase, timer, round, laps, every seat and the standings.
    pub fn room_json(&self) -> String {
        let d = &self.round.director;
        let order: Vec<u32> = self.sim.race().standings().iter().map(|r| r.car).collect();
        // A seat that left is gone from the room (no phantom seats, G02); its standings row stays. The seat itself is
        // kept only so the same endpoint could return to it.
        let seats: Vec<serde_json::Value> = self
            .seats
            .seats()
            .filter(|s| s.presence != seats::Presence::Left)
            .map(|s| {
                let car = self.inputs.get(&s.id).and_then(|i| i.car).map(|c| c.0);
                let race =
                    car.and_then(|c| self.sim.race().standings().into_iter().find(|r| r.car == c));
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
                    // The transport endpoint (an id, never the secret): diagnostics match it to the peer's path.
                    "endpoint": (!s.endpoint.0.starts_with("local:")).then_some(s.endpoint.0.as_str()),
                    "car": car,
                    "laps": race.map(|r| r.laps),
                    "position": car.and_then(|c| order.iter().position(|&o| o == c)).map(|p| p + 1),
                    "boost": car.and_then(|c| self.sim.action_state(CarId(c))).map(|a| (a.boost.clamp(0.0, 1.0) * 255.0).round() as u8),
                    "finished": race.and_then(|r| r.finished_at).is_some(),
                    // R119: how long this seat's pad has been unplugged (null while plugged); nothing expires the seat.
                    "unpluggedMs": self.inputs.get(&s.id).and_then(|i| i.unplugged_since_ms).map(|t| super::tick_ms(self.sim.tick()).saturating_sub(t)),
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
        serde_json::json!({
            "phase": format!("{:?}", d.phase()),
            "remainingMs": d.remaining_ms(),
            "round": d.round().map(|r| r.0),
            "laps": self.round.laps,
            "freeDrive": self.round.free_drive,
            // The roster's vehicle ids in table order: a snapshot car's vehicle (flags bits 16-31) indexes this (R123).
            "vehicles": self.vehicles.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            "armed": d.armed(),
            "preparation": {
                "external": self.round.prepare_maps,
                "pending": self.round.pending.map(|(p, s)| serde_json::json!({ "id": p.0, "seed": s })),
                "prepared": self.round.prepared.is_some(),
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
        let ids: Vec<&str> = self.vehicles.iter().map(|(id, _)| id.as_str()).collect();
        let tuned = &self.vehicles[self.tuning_vehicle];
        serde_json::json!({
            "tuning": tuned.1.tuning, "input": input, "error": self.tuning_error,
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
            UiCommand::StartRound => self.director_apply(DirIn::StartNow),
            UiCommand::EndRound => self.director_apply(DirIn::End),
            UiCommand::DisbandRoom => self.director_apply(DirIn::Disband),
            UiCommand::SetLaps { laps } => self.round.laps = laps.max(1),
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
        self.director_apply(DirIn::PrepareFinished {
            id: preparation,
            ok,
        });
    }

    /// READY from a controller or a host pad/key cluster, under the director's current Ready revision.
    pub(super) fn set_ready(&mut self, seat: SeatId, ready: bool) {
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
