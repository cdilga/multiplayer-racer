//! The practice scene for newcomers (P1-C10, master §4.3). From Help or the join screen while a round runs, a player picks
//! Practice: their seat drives its own small world (the room's start map, the greybox loop) run by the same core in this
//! worker, while everyone else keeps racing. Each practising seat has its own world: its own `Sim`, stepped once per host
//! tick after the round's sim, never touching it (its car, events, laps and damage stay there: its own score namespace).
//! The C06 prompts run there (they read the seat's input, whichever car it drives). "Join the race" (`Practice{on:false}`)
//! ends it and the seat enters the running round at the tail like any late joiner (R63). Never a queue and never a
//! mandatory step: practice only exists when a player asks for it, and the next round's countdown ends it (the seat is on
//! the grid with everyone).
//!
//! The renderer draws a practice car as one more car record in the snapshot, with its own id ([`PRACTICE_CAR_BASE`] +
//! seat), the [`SNAP_PRACTICE`] flag and its position moved by [`PRACTICE_OFFSET_M`], where the host page draws the
//! practice map: one renderer, one scene, the practice course far enough away that no camera sees both.

use jj_protocol::cmd::{ActionOutcome, ActionRejection};

use super::*;

/// A practice car's snapshot id: this plus the seat id (round cars count up from 0, so the two never meet).
pub const PRACTICE_CAR_BASE: u32 = 0x4000_0000;
/// Snapshot car flag: a practice car (drawn on the practice course, left out of the round's framing and shadows).
pub const SNAP_PRACTICE: u32 = 1 << 9;
/// Where practice course `slot` is drawn in the host's scene (m): 20 km from the round's map and 3 km apart, so each tile's
/// camera (2 km far plane) sees only its own course.
pub const PRACTICE_OFFSET_M: [f32; 3] = [0.0, 0.0, 20_000.0];
pub const PRACTICE_SLOT_M: f32 = 3_000.0;

/// Practice course `slot`'s offset in the drawn scene (m).
pub fn practice_offset(slot: u32) -> [f32; 3] {
    [
        PRACTICE_OFFSET_M[0] + slot as f32 * PRACTICE_SLOT_M,
        PRACTICE_OFFSET_M[1],
        PRACTICE_OFFSET_M[2],
    ]
}

/// One seat's practice world: its own sim on the start map, the seat's car in it, and where it is drawn (the lowest slot
/// free when it started; it keeps it).
pub(super) struct PracticeWorld {
    pub sim: Sim,
    pub car: CarId,
    pub slot: u32,
}

/// A practice car's ACTION gesture (P1-C10): the launch and the utilities act on the practice world, and the phone hears how
/// a utility went, as in the round.
pub(super) fn practice_action(
    sim: &mut Sim,
    car: CarId,
    kind: ActionKind,
) -> Option<ActionOutcome> {
    let utility = match kind {
        ActionKind::Wheelie { preload_ms } => {
            sim.wheelie(car, preload_ms);
            return None;
        }
        ActionKind::UtilityForward => UtilityKind::Forward,
        ActionKind::UtilityRear => UtilityKind::Rear,
    };
    Some(if sim.utility(car, utility) {
        ActionOutcome::Applied {
            tick: Tick(sim.tick()),
        }
    } else {
        ActionOutcome::Rejected {
            reason: ActionRejection::NotAvailable,
        }
    })
}

impl Host {
    /// Practice is for while a round runs (and its results): in the Lobby there are no cars (R110) and the tutorial card
    /// coaches; in the countdown the seat is on the grid.
    pub(super) fn practice_allowed(&self) -> bool {
        matches!(
            self.phase(),
            jj_session::director::Phase::Running
                | jj_session::director::Phase::Finalising
                | jj_session::director::Phase::Intermission
        )
    }

    /// `Practice{on}` from a controller source. Before the source has a seat (sent ahead of its `Claim`), it is kept for the
    /// seat that claim gets, so the newcomer never drops into the round first.
    pub(super) fn practice_cmd(&mut self, conn: ConnId, source: SourceHandle, on: bool) {
        match self.seats.seat_at(conn, source) {
            Some(seat) if on => self.start_practice(seat),
            Some(seat) => self.end_practice(seat, true),
            None if on => {
                self.practice_pending.insert((conn, source));
            }
            None => {
                self.practice_pending.remove(&(conn, source));
            }
        }
    }

    /// The room's phase for a phone that said Hello but has no seat yet (its join screen offers Practice while a round
    /// runs): a `RoomState` without `you`.
    pub(super) fn room_state_unseated(&mut self, endpoint: &EndpointId) {
        let d = &self.round.director;
        let bytes = HostCmd::RoomState {
            phase: super::round::room_phase(d.phase()),
            you: None,
            countdown_ms: None,
            results: None,
        }
        .encode();
        self.out.push(SimToMain::Outbound {
            endpoint: endpoint.clone(),
            channel: Channel::Cmd,
            bytes,
        });
    }

    /// A Welcome: the claim was made with Practice first.
    pub(super) fn practice_on_welcome(&mut self, conn: ConnId, source: SourceHandle, seat: SeatId) {
        if self.practice_pending.remove(&(conn, source)) {
            self.start_practice(seat);
        }
    }

    /// The seat starts practising: a fresh world with its car, the C06 prompts on, and the seat's round car (if it has one)
    /// handed to the autopilot meanwhile, as an open menu does (G03). Refused (the phone is told) outside a running round.
    pub(super) fn start_practice(&mut self, seat: SeatId) {
        if !self.practice_allowed() || !self.inputs.contains_key(&seat) {
            self.send_seat_phone(seat, HostCmd::Practice { on: false });
            return;
        }
        let slot = (0..)
            .find(|k| self.practice.values().all(|w| w.slot != *k))
            .unwrap_or(0);
        let world = self.practice_world(seat, slot);
        self.practice.insert(seat, world);
        if let Some(input) = self.inputs.get_mut(&seat) {
            input.prompt.set(true);
            if let Some(car) = input.car
                && !input.dropped
            {
                self.sim.set_autopilot(car, true);
                input.dropped = true;
            }
        }
        self.session_rev += 1;
        self.send_seat_phone(seat, HostCmd::Practice { on: true });
    }

    /// A practising seat picked another car: its practice world starts again with it (same slot).
    pub(super) fn practice_repick(&mut self, seat: SeatId) {
        if let Some(slot) = self.practice.get(&seat).map(|w| w.slot) {
            let world = self.practice_world(seat, slot);
            self.practice.insert(seat, world);
        }
    }

    fn practice_world(&self, seat: SeatId, slot: u32) -> PracticeWorld {
        let mut sim = Sim::with_profiles(
            &self.practice_map,
            &jj_procgen::registry(),
            self.round.seed,
            self.vehicles.iter().map(|(_, p)| p.clone()).collect(),
        );
        sim.set_air_profile(self.air_profile.clone());
        let car = sim.spawn_grid_as(&[self.vehicle_of_seat(seat)])[0];
        PracticeWorld { sim, car, slot }
    }

    /// The seat stops practising. `join`: "Join the race": a seat without a round car enters the running round now, at the
    /// tail like any late joiner (R63) (in the countdown it takes a grid slot; between rounds it waits for the next grid);
    /// a seat whose car was on the autopilot takes it back with its next deliberate input (the dropout handback).
    pub(super) fn end_practice(&mut self, seat: SeatId, join: bool) {
        let was = self.practice.remove(&seat).is_some();
        let seated = self.seats.seat(seat).is_some_and(|s| s.has_car);
        if join
            && seated
            && self.inputs.get(&seat).is_some_and(|i| i.car.is_none())
            && let Some(car) = self.car_wanted(seat)
        {
            let profile = self.input_profile.resolve();
            if let Some(input) = self.inputs.get_mut(&seat) {
                input.car = Some(car);
                input.dropped = false;
                // Like any late joiner: the round car starts from this source's next sample, not from the practice ones
                // (a practice sample a few seconds old would read as a dropout and hand it to the autopilot).
                input.state = SourceState::with_profile(input.state.handle(), profile);
                input.wire_seq = None;
                input.active_ms = 0;
                input.idle_cued = false;
            }
            if self.round.round.is_some() && !self.round.cohort.contains(&seat) {
                self.round.cohort.push(seat);
                self.round.late.push(seat);
            }
        }
        if was {
            self.session_rev += 1;
            self.send_seat_phone(seat, HostCmd::Practice { on: false });
        }
    }

    /// Every practice ends (a new round's grid, the Lobby): those seats race with everyone from here.
    pub(super) fn end_all_practice(&mut self) {
        let seats: Vec<SeatId> = self.practice.keys().copied().collect();
        for seat in seats {
            self.end_practice(seat, false);
        }
    }

    /// A seat's practice car, if it is practising (actions and Recover go to it).
    pub(super) fn practice_car(&mut self, seat: SeatId) -> Option<(&mut Sim, CarId)> {
        self.practice.get_mut(&seat).map(|w| (&mut w.sim, w.car))
    }

    /// One tick of every practice world, after the round's.
    pub(super) fn step_practice(&mut self) {
        for w in self.practice.values_mut() {
            w.sim.step();
        }
    }

    /// The snapshot id of a practising seat's car.
    pub(super) fn practice_snapshot_id(&self, seat: SeatId) -> Option<u32> {
        self.practice
            .contains_key(&seat)
            .then_some(PRACTICE_CAR_BASE + seat.0)
    }

    /// The practice cars' snapshot records (after the round's cars), positions moved onto the drawn practice course.
    pub(super) fn write_practice_cars(&self, w: &mut Writer<'_>) {
        for (seat, p) in &self.practice {
            let Some(s) = p.sim.car_state(p.car) else {
                continue;
            };
            let input = p.sim.applied_input(p.car);
            let steer = input.map_or(0.0, |i| jj_types::axis::dequantise_axis(i.steer));
            let throttle = input.map_or(0.0, |i| {
                jj_types::axis::dequantise_axis(i.throttle).clamp(0.0, 1.0)
            });
            let action = p.sim.action_state(p.car).unwrap_or_default();
            let flags = SNAP_PRACTICE
                | u32::from(p.sim.is_protected(p.car))
                | (u32::from(action.boosting) << 4)
                | (u32::from(action.slide() > 0.5) << 5)
                | (u32::from(p.sim.car_surface(p.car).unwrap_or(0)) << 6)
                | (u32::from(s.wheels_in_contact == 0) << 8)
                | ((p.sim.vehicle_of(p.car).unwrap_or(0) as u32 & 0xFFFF) << 16);
            w.u32(PRACTICE_CAR_BASE + seat.0);
            w.u32(p.sim.car_life(p.car).unwrap_or(0));
            let at = practice_offset(p.slot);
            for (k, v) in s.position.iter().enumerate() {
                w.f32(v + at[k]);
            }
            s.rotation.iter().chain(&s.linvel).for_each(|&v| w.f32(v));
            w.f32(steer);
            w.u32(flags);
            w.f32(action.boost);
            w.f32(throttle);
        }
    }

    /// Bytes the practice trailer needs (0 with nobody practising).
    pub(super) fn practice_trailer_size(&self) -> usize {
        if self.practice.is_empty() {
            return 0;
        }
        4 + self
            .practice
            .values()
            .map(|p| 8 + SNAPSHOT_DEBRIS * p.sim.debris_poses().len())
            .sum::<usize>()
    }

    /// The practice trailer (snapshot flags bit 1): worlds u32, then per world its slot u32, its debris count u32 and that
    /// many 32 B debris records (position 3×f32 moved onto the drawn course, rotation 4×f32, kind u32), the round's own
    /// debris layout, so the page draws the course's props, dropped cones and loose bits where they lie.
    pub(super) fn write_practice_debris(&self, w: &mut Writer<'_>) {
        if self.practice.is_empty() {
            return;
        }
        w.u32(self.practice.len() as u32);
        for p in self.practice.values() {
            let debris = p.sim.debris_poses();
            w.u32(p.slot);
            w.u32(debris.len() as u32);
            let at = practice_offset(p.slot);
            for ((pos, r), k) in debris.iter().zip(p.sim.prop_kinds()) {
                let kind = match k {
                    jj_sim::PropKind::Part | jj_sim::PropKind::Husk => 2,
                    other => other.code(),
                };
                for (i, v) in pos.iter().enumerate() {
                    w.f32(v + at[i]);
                }
                r.iter().for_each(|&v| w.f32(v));
                w.u32(kind);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use jj_map::{Registry, load_json};
    use jj_protocol::PROTOCOL_VERSION;
    use jj_protocol::abi::{ABI_VERSION, Channel, MainToSim, SimToMain, UiCommand};
    use jj_protocol::cmd::{ControllerCmd, HostCmd};
    use jj_protocol::state::{STATE_MINOR, StateBatch, StateFlags, StateRecord};
    use jj_session::director::Phase;
    use jj_types::{BuildId, CommandId, EndpointId, RequestId, SourceHandle};

    use super::*;

    const GREYBOX: &str = include_str!("../../../../maps/greybox-loop.json");
    const RACERS: [&str; 4] = ["r1", "r2", "r3", "r4"];

    fn init() -> Vec<u8> {
        let map = load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap();
        MainToSim::Init {
            abi_version: ABI_VERSION,
            rules_hash: [0; 32],
            map_bytes: map.canonical,
            vehicle_sidecars: vec![],
            seed: 3,
        }
        .encode()
    }

    fn send(h: &mut Host, p: &str, cmd: ControllerCmd) {
        h.handle(
            &MainToSim::NetBytes {
                endpoint: EndpointId(p.into()),
                channel: Channel::Cmd,
                bytes: cmd.encode(),
            }
            .encode(),
        )
        .unwrap();
    }

    fn hello(h: &mut Host, p: &str) {
        send(
            h,
            p,
            ControllerCmd::Hello {
                protocol: PROTOCOL_VERSION,
                build: BuildId("t".into()),
                endpoint: EndpointId(p.into()),
                resume: Some(format!("s-{p}")),
            },
        );
    }

    fn claim(h: &mut Host, p: &str) {
        send(
            h,
            p,
            ControllerCmd::Claim {
                request: RequestId(1),
                name: p.to_uppercase(),
            },
        );
    }

    /// A phone's sticks: `drive` the left stick (throttle, brake), `action` the right (R116: its x steers).
    fn sticks(h: &mut Host, p: &str, seq: u16, drive: [i16; 2], action: [i16; 2]) {
        let bytes = StateBatch {
            minor: STATE_MINOR,
            batch_seq: seq,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(1),
                seq,
                drive,
                action,
                flags: StateFlags(
                    StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH | StateFlags::ACTION_TOUCH,
                ),
            }],
        }
        .encode()
        .unwrap();
        h.handle(
            &MainToSim::NetBytes {
                endpoint: EndpointId(p.into()),
                channel: Channel::State,
                bytes,
            }
            .encode(),
        )
        .unwrap();
    }

    /// One worker frame per tick; returns the host commands each phone was sent.
    fn step(h: &mut Host, now: &mut u64) -> Vec<(String, HostCmd)> {
        h.advance(*now);
        *now += 8_334;
        let mut out = Vec::new();
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                endpoint,
                channel: Channel::Cmd,
                bytes,
            } = m
                && let Ok(cmd) = HostCmd::decode(&bytes)
            {
                out.push((endpoint.0, cmd));
            }
        }
        out
    }

    /// A room with four phones racing (one lap less than forever): Ready, the countdown, then Running.
    fn racing_room() -> (Host, u64) {
        let mut h = Host::new(&init()).unwrap();
        h.handle(
            &MainToSim::Ui {
                command: CommandId(1),
                ui: UiCommand::SetLaps { laps: 20 },
            }
            .encode(),
        )
        .unwrap();
        for p in RACERS {
            hello(&mut h, p);
            claim(&mut h, p);
            send(&mut h, p, ControllerCmd::Ready { on: true });
        }
        let mut now = 0;
        for _ in 0..(120 * 30) {
            step(&mut h, &mut now);
            if h.phase() == Phase::Running {
                break;
            }
        }
        assert_eq!(h.phase(), Phase::Running);
        (h, now)
    }

    fn room(h: &Host) -> serde_json::Value {
        serde_json::from_str(&h.room_json()).unwrap()
    }

    fn seat_named(h: &Host, name: &str) -> serde_json::Value {
        room(h)["seats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == name)
            .cloned()
            .unwrap_or_default()
    }

    /// The bead's journey natively, bit for bit: four phones race in two identical rooms. In room A a newcomer asks for
    /// Practice before claiming, practises (steering, driving, the C06 prompts ticking) in its own world while the four
    /// race, then chooses Join the race; in room B the same newcomer simply claims at that same tick. The round's sim
    /// has the same full-state hash in both rooms at every tick, so practising never touched it; the newcomer enters at
    /// the tail as a late entrant; the practice car really moved in its own world and reached the snapshot on the
    /// practice course.
    #[test]
    fn a_newcomer_practises_while_four_race_then_joins_at_the_tail_and_the_round_never_notices() {
        let (mut a, mut now_a) = racing_room();
        let (mut b, mut now_b) = racing_room();
        assert_eq!(a.state_hash(), b.state_hash(), "two identical rooms");
        let go = a.tick();
        let join_at = go + 900;
        let mut practice_on = false;
        let mut start = None;
        let mut furthest = 0.0f32;
        let mut seq = 0u16;
        for t in go..join_at + 600 {
            seq = seq.wrapping_add(1);
            // The four racers hold full throttle, the same in both rooms.
            if t % 6 == 0 {
                for p in RACERS {
                    sticks(&mut a, p, seq, [0, 32_767], [0, 0]);
                    sticks(&mut b, p, seq, [0, 32_767], [0, 0]);
                }
            }
            if t == go + 60 {
                hello(&mut a, "nu");
                send(&mut a, "nu", ControllerCmd::Practice { on: true });
                claim(&mut a, "nu");
            }
            // Practice in room A: steer right, then left (the first prompt), then drive (the second); then let go a while
            // before joining.
            if (go + 120..join_at - 240).contains(&t) && t % 6 == 0 {
                let k = t - go - 120;
                let (drive, action) = match k {
                    0..120 => ([0, 0], [32_767, 0]),
                    120..240 => ([0, 0], [-32_767, 0]),
                    240..360 => ([0, 32_767], [0, 0]),
                    360..420 => ([0, -32_767], [0, 0]),
                    _ => ([0, 32_767], [8_000, 0]),
                };
                sticks(&mut a, "nu", seq, drive, action);
            }
            if t == join_at {
                send(&mut a, "nu", ControllerCmd::Practice { on: false });
                hello(&mut b, "nu");
                claim(&mut b, "nu");
            }
            // After joining, the newcomer drives the same in both rooms.
            if t > join_at && t % 6 == 0 {
                sticks(&mut a, "nu", seq, [0, 32_767], [0, 0]);
                sticks(&mut b, "nu", seq, [0, 32_767], [0, 0]);
            }
            for (to, cmd) in step(&mut a, &mut now_a) {
                if to == "nu"
                    && let HostCmd::Practice { on } = cmd
                {
                    practice_on = on;
                }
            }
            step(&mut b, &mut now_b);
            assert_eq!(a.tick(), b.tick());
            assert_eq!(
                a.state_hash(),
                b.state_hash(),
                "the round's sim is the same with and without the practice world (tick {t}, go {go}, join {join_at})"
            );
            if (go + 120..join_at).contains(&t) {
                let nu = seat_named(&a, "NU");
                assert_eq!(nu["practice"], true, "practising: {nu}");
                assert_eq!(
                    a.sim.cars().count(),
                    4,
                    "the round has only its four racers"
                );
                let p = &a.practice[&jj_types::SeatId(nu["seat"].as_u64().unwrap() as u32)];
                let pos = p.sim.car_state(p.car).unwrap().position;
                let s0 = *start.get_or_insert(pos);
                furthest =
                    furthest.max(((pos[0] - s0[0]).powi(2) + (pos[2] - s0[2]).powi(2)).sqrt());
            }
            if t == join_at - 1 {
                assert!(practice_on, "the phone was told it is practising");
                let nu = seat_named(&a, "NU");
                assert!(
                    nu["prompt"]["step"].as_u64().unwrap() >= 2,
                    "the C06 prompts ran in practice (steer, go and stop): {nu}"
                );
                assert_eq!(
                    nu["car"].as_u64().unwrap(),
                    u64::from(PRACTICE_CAR_BASE) + nu["seat"].as_u64().unwrap(),
                    "the tile follows the practice car"
                );
                // The snapshot carries the four round cars, then the practice car on the practice course.
                let mut buf = vec![0; a.snapshot_size()];
                assert_eq!(a.write_snapshot(&mut buf), buf.len());
                let u32_at = |at: usize| u32::from_le_bytes(buf[at..at + 4].try_into().unwrap());
                let f32_at = |at: usize| f32::from_le_bytes(buf[at..at + 4].try_into().unwrap());
                assert_eq!(u32_at(28), 5, "four round cars and one practice car");
                let rec = SNAPSHOT_HEADER + 4 * SNAPSHOT_CAR;
                assert_eq!(u32_at(rec), nu["car"].as_u64().unwrap() as u32);
                assert_ne!(u32_at(rec + 52) & SNAP_PRACTICE, 0, "flagged as practice");
                assert!(f32_at(rec + 16) > 19_000.0, "drawn on the practice course");
                assert_eq!(
                    u16::from_le_bytes(buf[6..8].try_into().unwrap()) & 2,
                    2,
                    "the practice trailer"
                );
            }
            if t == join_at + 1 {
                assert!(!practice_on, "Join the race ended practice on the phone");
                let nu = seat_named(&a, "NU");
                assert_eq!(nu["practice"], false);
                assert!(a.practice.is_empty(), "the practice world is gone");
                assert_eq!(a.sim.cars().count(), 5, "the newcomer is in the round");
                let seat = jj_types::SeatId(nu["seat"].as_u64().unwrap() as u32);
                assert!(a.round.late.contains(&seat), "a late entrant (R63)");
                let car = nu["car"].as_u64().unwrap() as u32;
                let standings = a.sim.race().standings();
                assert_eq!(
                    standings.last().map(|r| r.car),
                    Some(car),
                    "it entered at the tail"
                );
            }
        }
        assert!(
            furthest > 15.0,
            "the practice car drove in its own world ({furthest} m)"
        );
    }

    /// Practice is optional and never a queue: a newcomer who doesn't ask for it drops straight into the round; asked for
    /// in the Lobby it is refused (the phone is told) and nothing is built; the next round's countdown ends it, and the
    /// practiser is on the grid with everyone.
    #[test]
    fn practice_is_optional_refused_in_the_lobby_and_ended_by_the_next_round() {
        let mut h = Host::new(&init()).unwrap();
        let mut now = 0;
        hello(&mut h, "lo");
        claim(&mut h, "lo");
        step(&mut h, &mut now);
        send(&mut h, "lo", ControllerCmd::Practice { on: true });
        let told = step(&mut h, &mut now);
        assert!(
            told.iter()
                .any(|(to, c)| to == "lo" && *c == HostCmd::Practice { on: false }),
            "refused in the Lobby: {told:?}"
        );
        assert!(h.practice.is_empty());

        let (mut h, mut now) = racing_room();
        hello(&mut h, "plain");
        // Before claiming, the phone hears that a round is running (its join screen offers Practice first).
        let heard = step(&mut h, &mut now);
        assert!(
            heard.iter().any(|(to, c)| to == "plain"
                && matches!(
                    c,
                    HostCmd::RoomState {
                        phase: jj_protocol::cmd::RoomPhase::Racing,
                        you: None,
                        ..
                    }
                )),
            "an unseated phone hears the phase: {heard:?}"
        );
        claim(&mut h, "plain");
        for _ in 0..3 {
            step(&mut h, &mut now);
        }
        assert_eq!(
            h.sim.cars().count(),
            5,
            "no Practice: straight into the round"
        );
        assert_eq!(seat_named(&h, "PLAIN")["practice"], false);

        // A racer opens Help and picks Practice: its round car goes to the autopilot meanwhile.
        send(&mut h, "r1", ControllerCmd::Practice { on: true });
        step(&mut h, &mut now);
        let r1 = seat_named(&h, "R1");
        assert_eq!(r1["practice"], true);
        let round_car = CarId(r1["roundCar"].as_u64().unwrap() as u32);
        assert!(
            h.sim.has_autopilot(round_car),
            "the round car keeps racing on the autopilot"
        );

        // The host ends the round: back in the Lobby practice is over.
        h.handle(
            &MainToSim::Ui {
                command: CommandId(2),
                ui: UiCommand::EndRound,
            }
            .encode(),
        )
        .unwrap();
        let mut ended = false;
        for _ in 0..240 {
            for (to, c) in step(&mut h, &mut now) {
                ended |= to == "r1" && c == HostCmd::Practice { on: false };
            }
        }
        assert!(
            h.practice.is_empty() && ended,
            "the round's end ended practice"
        );
    }

    /// The countdown of the next round ends practice: the practiser is on the grid.
    #[test]
    fn the_next_countdown_puts_a_practiser_on_the_grid() {
        let (mut h, mut now) = racing_room();
        hello(&mut h, "nu");
        send(&mut h, "nu", ControllerCmd::Practice { on: true });
        claim(&mut h, "nu");
        step(&mut h, &mut now);
        assert_eq!(h.practice.len(), 1);
        let seat = jj_types::SeatId(seat_named(&h, "NU")["seat"].as_u64().unwrap() as u32);
        // Everyone home: the round finalises, the Intermission runs, the next countdown starts on its own.
        assert!(h.sim.end_race_now());
        let mut grid = false;
        for _ in 0..(120 * 120) {
            step(&mut h, &mut now);
            if h.phase() == Phase::Countdown {
                grid = true;
                break;
            }
        }
        assert!(grid, "the next round's countdown came");
        assert!(h.practice.is_empty(), "the countdown ended practice");
        assert!(
            h.inputs[&seat].car.is_some(),
            "the practiser has a grid slot with everyone"
        );
    }

    /// The cost of a practice world (P1-C10 acceptance: measured, never a slowdown of the round): native, release, the
    /// round's sim with four cars racing and one practice world, per tick. `cargo test --release -p jj-wasm-host
    /// practice_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn practice_cost() {
        let (mut h, mut now) = racing_room();
        hello(&mut h, "nu");
        send(&mut h, "nu", ControllerCmd::Practice { on: true });
        claim(&mut h, "nu");
        step(&mut h, &mut now);
        let ticks = 1200u64;
        let mut round_ns = 0u128;
        let mut practice_ns = 0u128;
        for t in 0..ticks {
            if t % 6 == 0 {
                for p in RACERS {
                    sticks(&mut h, p, t as u16, [0, 32_767], [0, 0]);
                }
                sticks(&mut h, "nu", t as u16, [0, 32_767], [6_000, 0]);
            }
            // The whole host step, then the practice worlds' share of it timed alone on a clone of the inputs.
            let t0 = std::time::Instant::now();
            h.advance(now);
            now += 8_334;
            round_ns += t0.elapsed().as_nanos();
            while h.next_message().is_some() {}
            let t1 = std::time::Instant::now();
            for w in h.practice.values_mut() {
                w.sim.step();
            }
            practice_ns += t1.elapsed().as_nanos();
        }
        println!(
            "practice_cost: host tick (round with 4 cars + 1 practice world) {:.1} us/tick; one practice world step {:.1} us/tick; {} ticks",
            round_ns as f64 / ticks as f64 / 1000.0,
            practice_ns as f64 / ticks as f64 / 1000.0,
            ticks
        );
    }
}
