//! P1-S02 native tests of the worker core. The browser tests (`web/host/tests/worker.test.mjs`) run the same core as
//! WASM in a real Web Worker.

use jj_map::{Registry, load_json};
use jj_protocol::PROTOCOL_VERSION;
use jj_protocol::abi::{ABI_VERSION, Channel, MainToSim, SimToMain, UiCommand};
use jj_protocol::cmd::{ControllerCmd, HostCmd, InputThresholds};
use jj_protocol::state::{STATE_MINOR, StateBatch, StateFlags, StateRecord};
use jj_types::{BuildId, CommandId, EndpointId, LocalSourceId, RequestId, SourceHandle};

use super::*;

const GREYBOX: &str = include_str!("../../../../maps/greybox-loop.json");
const MS: u64 = 1000;

#[test]
fn snapshot_transfers_compliant_rails_by_map_dressing_index() {
    let map = load_json(
        include_bytes!("../../../../scenarios/rails/yard.json"),
        &jj_procgen::registry(),
    )
    .unwrap();
    let mut h = Host::new(
        &MainToSim::Init {
            abi_version: ABI_VERSION,
            rules_hash: [0; 32],
            map_bytes: map.canonical,
            vehicle_sidecars: vec![],
            seed: 91,
        }
        .encode(),
    )
    .unwrap();
    assert!(h.sim.set_rail(0, 0.25, 0.0));
    let mut buf = vec![0; h.snapshot_size()];
    assert_eq!(h.write_snapshot(&mut buf), buf.len());
    assert_eq!(
        u16::from_le_bytes(buf[6..8].try_into().unwrap()),
        1,
        "rail trailer flag"
    );
    let at = SNAPSHOT_HEADER;
    assert_eq!(
        u32::from_le_bytes(buf[at..at + 4].try_into().unwrap()),
        1,
        "all rail sections"
    );
    assert_eq!(
        u32::from_le_bytes(buf[at + 4..at + 8].try_into().unwrap()),
        0,
        "dressing index"
    );
    assert_eq!(
        f32::from_le_bytes(buf[at + 8..at + 12].try_into().unwrap()),
        0.25,
        "physical displacement"
    );
    assert_eq!(
        h.write_snapshot(&mut buf[..SNAPSHOT_HEADER]),
        0,
        "never truncate entities to fit a buffer"
    );
}

#[test]
fn race_classification_preserves_crossing_fraction_progress_and_exact_ties() {
    use jj_session::results::{RoundFacts, Ruleset, classify};
    use jj_types::{RoundId, SeatId};
    let mut h = driving_host();
    h.sim.spawn_grid_as(&[0]);
    let base = h.sim.race().car(0).unwrap().clone();
    let mut states = vec![base; 5];
    for (i, state) in states.iter_mut().enumerate() {
        state.best_progress_mm = 123_456;
        state.best_progress_tick = if i == 3 { 80 } else { 90 };
        if i < 3 {
            state.finished_at = Some(100);
            state.finish_fraction = if i < 2 { 10_000 } else { 20_000 };
        }
    }
    let entrants = states
        .iter()
        .enumerate()
        .map(|(i, state)| super::round::entrant_from_race(SeatId(i as u32 + 1), Some(state), false))
        .collect::<Vec<_>>();
    assert_eq!(entrants[0].finish.unwrap().fraction, 10_000);
    assert_eq!(entrants[3].progress_mm, 123_456);
    assert_eq!(entrants[3].progress_tick, 80);
    let result = classify(&RoundFacts {
        round: RoundId(1),
        ruleset: Ruleset::default(),
        entrants,
    })
    .unwrap();
    assert_eq!(
        result
            .rows
            .iter()
            .map(|r| r.place.unwrap())
            .collect::<Vec<_>>(),
        vec![1, 1, 3, 4, 5]
    );
    assert_eq!(
        result.rows[0].points, result.rows[1].points,
        "exact finish ties share points"
    );
    let missing = super::round::entrant_from_race(SeatId(6), None, true);
    assert!(!missing.entered && missing.withdrawn && missing.late);
}

/// A host in G04's free drive, where a claimed seat drives at once: the driving-mechanics tests run there. The round
/// loop's own tests (G01) start from `Host::new` with the real Lobby, which holds every car.
fn driving_host() -> Host {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    h
}

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

fn local(source: u32, drive: [i16; 2]) -> Vec<u8> {
    MainToSim::LocalSource {
        source: LocalSourceId(source),
        axes: [drive[0], drive[1], 0, 0],
        buttons: 0,
        seq: 0,
    }
    .encode()
}

fn net(endpoint: &str, channel: Channel, bytes: Vec<u8>) -> Vec<u8> {
    MainToSim::NetBytes {
        endpoint: EndpointId(endpoint.into()),
        channel,
        bytes,
    }
    .encode()
}

fn record(source: SourceHandle, seq: u16, drive: [i16; 2]) -> Vec<u8> {
    StateBatch {
        minor: STATE_MINOR,
        batch_seq: seq,
        sent_at_ms: 0,
        records: vec![StateRecord {
            source,
            seq,
            drive,
            action: [0, 0],
            flags: StateFlags(StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH),
        }],
    }
    .encode()
    .unwrap()
}

/// Runs a host with the worker calling `advance` every `period_us` until `stop` ticks, with `script` (tick, message)
/// scheduled; returns the final tick and hash.
fn run(period_us: u64, stop: u64, script: &[(u64, Vec<u8>)]) -> (u64, [u8; 32]) {
    let mut h = driving_host();
    for (t, m) in script {
        h.schedule(*t, m).unwrap();
    }
    h.stop_at(stop);
    let mut now = 0;
    while h.tick() < stop {
        h.advance(now);
        now += period_us;
    }
    (h.tick(), h.state_hash())
}

/// A pad player: full throttle for 2 s, then steering for 2 s, then coasting.
fn pad_script() -> Vec<(u64, Vec<u8>)> {
    let mut s = Vec::new();
    for t in (0..720).step_by(6) {
        let drive = if t < 240 {
            [0, 32_767]
        } else if t < 480 {
            [16_000, 20_000]
        } else {
            [0, 0]
        };
        s.push((t, local(1, drive)));
    }
    s
}

/// The owner tuning menu (br-2sdu.1): a tuning change is a journalled UI command applied at a tick boundary, so it
/// changes the run, the same script replays bit for bit, and a bad field is refused without touching the car.
#[test]
fn a_tuning_change_applies_at_a_tick_boundary_and_replays_bit_for_bit() {
    let tune = |field: &str, value: &str| {
        MainToSim::Ui {
            command: CommandId(7),
            ui: UiCommand::SetTuning {
                field: field.into(),
                value: value.into(),
            },
        }
        .encode()
    };
    let plain = pad_script();
    let mut tuned = pad_script();
    tuned.push((60, tune("max_engine_force", "20000")));
    let a = run(16_667, 720, &tuned);
    let b = run(16_667, 720, &tuned);
    assert_eq!(a, b, "the tuned run replays bit for bit");
    assert_ne!(
        a.1,
        run(16_667, 720, &plain).1,
        "and the tuning changed the run"
    );

    let mut h = driving_host();
    h.schedule(5, &tune("max_engine_force", "9000")).unwrap();
    h.schedule(6, &tune("no_such_field", "1")).unwrap();
    h.stop_at(10);
    let mut now = 0;
    while h.tick() < 10 {
        h.advance(now);
        now += 16_667;
    }
    assert_eq!(
        h.sim.profile().tuning.max_engine_force,
        9000.0,
        "the sim drives with the new value"
    );
    let shown: serde_json::Value = serde_json::from_str(&h.tuning_json()).unwrap();
    assert_eq!(
        shown["tuning"]["max_engine_force"], 9000.0,
        "the menu reads it back"
    );
    assert!(
        shown["error"]
            .as_str()
            .unwrap_or("")
            .contains("no_such_field"),
        "a bad field is refused: {shown}"
    );
}

/// P1-S10: while a derby round is on, a seat's phone HUD carries its raw points, rank and the round's game time left, and
/// the room view (the TV's) carries each seat's points and rank and the time left; a race's HUD carries none.
#[test]
fn a_derby_rounds_facts_reach_the_phone_hud_and_the_room_view() {
    let mut h = driving_host();
    let phone = |c: ControllerCmd| net("phone", Channel::Cmd, c.encode());
    h.schedule(
        0,
        &phone(ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        }),
    )
    .unwrap();
    h.schedule(
        0,
        &phone(ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        }),
    )
    .unwrap();
    let mut now = 0;
    let huds = |h: &mut Host, now: &mut u64, n: usize| {
        let mut out = Vec::new();
        for _ in 0..n {
            h.advance(*now);
            *now += 8_334;
            while let Some(m) = h.next_message() {
                if let SimToMain::Outbound {
                    channel: Channel::State,
                    bytes,
                    ..
                } = m
                    && let Ok(u) = HudUpdate::decode(&bytes)
                {
                    out.push(u.hud);
                }
            }
        }
        out
    };
    let before = huds(&mut h, &mut now, 240);
    assert!(!before.is_empty(), "the phone hears its HUD");
    assert!(
        before.iter().all(|u| u.derby.is_none()),
        "no derby facts outside a derby"
    );
    h.sim.start_derby(180 * u64::from(jj_sim::TICK_HZ));
    let during = huds(&mut h, &mut now, 240);
    let last = during
        .last()
        .and_then(|u| u.derby)
        .expect("the HUD carries derby facts");
    assert_eq!(last.rank, 1, "the only car ranks first");
    assert_eq!(last.half_points, 0, "no damage dealt, no points");
    assert!(
        (170..=180).contains(&last.left_s),
        "about three minutes left: {}",
        last.left_s
    );
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    let left = room["derbyLeftMs"]
        .as_u64()
        .expect("the room view has the derby time left");
    assert!((170_000..=180_000).contains(&left), "{left}");
    let seat = &room["seats"][0];
    assert_eq!(seat["derby"]["rank"], 1, "{seat}");
    assert_eq!(seat["derby"]["points"], 0.0, "{seat}");
}

/// br-bbki.7.1: an `air.*` tuning change (assets/profiles/air.json) reaches the sim at a tick boundary, the menu reads it
/// back, a value the air validator refuses changes nothing, and the next round's new world flies with the tuned set.
#[test]
fn an_air_profile_change_reaches_the_sim_and_the_next_round() {
    let tune = |field: &str, value: &str| {
        MainToSim::Ui {
            command: CommandId(9),
            ui: UiCommand::SetTuning {
                field: field.into(),
                value: value.into(),
            },
        }
        .encode()
    };
    let mut h = driving_host();
    h.schedule(5, &tune("air.pitchRateDps", "140")).unwrap();
    h.schedule(6, &tune("air.bands.badDeg", "60")).unwrap();
    h.stop_at(10);
    let mut now = 0;
    while h.tick() < 10 {
        h.advance(now);
        now += 16_667;
    }
    assert_eq!(
        h.sim.air_profile().pitch_rate_dps,
        140.0,
        "the sim flies with the new value"
    );
    assert_eq!(
        h.sim.air_profile().bands.bad_deg,
        25.0,
        "the refused band changed nothing"
    );
    let shown: serde_json::Value = serde_json::from_str(&h.tuning_json()).unwrap();
    assert_eq!(
        shown["air"]["pitchRateDps"], 140.0,
        "the menu reads it back"
    );
    assert!(
        shown["error"]
            .as_str()
            .unwrap_or("")
            .starts_with("air.bands.badDeg:"),
        "a bad value is refused: {shown}"
    );
    h.reset_world();
    assert_eq!(
        h.sim.air_profile().pitch_rate_dps,
        140.0,
        "a new round's world keeps the tuned air"
    );
}

/// The owner tuning menu part 2 (br-2sdu.2): an input-profile change is a journalled UI command; the host reads its
/// seats' sticks with it at once, every connected controller is sent the whole profile, one that joins later is sent it
/// after its Welcome, a refused value changes nothing, and the same script replays bit for bit.
#[test]
fn an_input_profile_change_reaches_the_host_and_every_controller() {
    let tune = |field: &str, value: &str| {
        MainToSim::Ui {
            command: CommandId(8),
            ui: UiCommand::SetTuning {
                field: field.into(),
                value: value.into(),
            },
        }
        .encode()
    };
    let join = |ep: &str| {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId(ep.into()),
            resume: Some(format!("secret-{ep}")),
        };
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        };
        [
            net(ep, Channel::Cmd, hello.encode()),
            net(ep, Channel::Cmd, claim.encode()),
        ]
    };
    let mut h = driving_host();
    for m in join("early") {
        h.schedule(0, &m).unwrap();
    }
    h.schedule(30, &tune("input.flick.rim", "0.8")).unwrap();
    h.schedule(31, &tune("input.flick.maxAngleDeg", "25"))
        .unwrap();
    // armBelow must stay under the rim: refused, nothing changes.
    h.schedule(32, &tune("input.flick.armBelow", "0.99"))
        .unwrap();
    for m in join("late") {
        h.schedule(60, &m).unwrap();
    }
    h.stop_at(120);
    let mut now = 0;
    let mut got: std::collections::BTreeMap<String, Vec<InputThresholds>> = Default::default();
    let mut welcomed = std::collections::BTreeSet::new();
    while h.tick() < 120 {
        h.advance(now);
        now += 16_667;
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                endpoint,
                channel: Channel::Cmd,
                bytes,
            } = m
            {
                match HostCmd::decode(&bytes) {
                    Ok(HostCmd::Welcome { .. }) => {
                        welcomed.insert(endpoint.0.clone());
                    }
                    Ok(HostCmd::InputProfile(w)) => {
                        assert!(
                            welcomed.contains(&endpoint.0),
                            "the profile follows the Welcome"
                        );
                        got.entry(endpoint.0).or_default().push(w);
                    }
                    _ => {}
                }
            }
        }
    }
    let early = &got["early"];
    assert_eq!(early.len(), 2, "one message per accepted change: {early:?}");
    assert_eq!(early[0].flick_rim, 8000);
    assert_eq!(early[1].flick_max_angle, 2500);
    assert_eq!(early[1].flick_rim, 8000, "the whole profile");
    assert_eq!(
        got["late"],
        vec![early[1]],
        "a later joiner gets the tuned profile"
    );
    let shown: serde_json::Value = serde_json::from_str(&h.tuning_json()).unwrap();
    assert_eq!(shown["input"]["flick"]["rim"], 0.8);
    assert!(
        shown["error"].as_str().unwrap_or("").contains("armBelow"),
        "a value the validator refuses is shown: {shown}"
    );
    // Replays bit for bit, and the host's own reading of the right stick changes with the threshold: the steering curve's
    // exponent bends a half push of the stick.
    let steered = |extra: &[(u64, Vec<u8>)]| {
        let mut s = Vec::new();
        for t in (0..300u64).step_by(6) {
            let push = MainToSim::LocalSource {
                source: LocalSourceId(7),
                axes: [0, 16_000, 16_000, 0],
                buttons: 0,
                seq: 0,
            }
            .encode();
            s.push((t, push));
        }
        s.extend_from_slice(extra);
        run(16_667, 300, &s)
    };
    let tuned = [(2u64, tune("input.steer.gamma", "2"))];
    assert_eq!(steered(&tuned), steered(&tuned), "replays");
    assert_ne!(
        steered(&tuned).1,
        steered(&[]).1,
        "and the threshold changed the run"
    );
}

#[test]
fn render_and_worker_cadence_never_change_the_simulation() {
    // The worker's timer at 30, 60 and 144 Hz and an irregular one: whole ticks, the same hash at the same tick.
    let script = pad_script();
    let results: Vec<(u64, [u8; 32])> = [33_333, 16_667, 6_944, 3_000]
        .iter()
        .map(|&p| run(p, 720, &script))
        .collect();
    for r in &results[1..] {
        assert_eq!(*r, results[0]);
    }
    assert_eq!(results[0].0, 720);
}

#[test]
fn controller_bytes_and_local_source_drive_identically() {
    // §7.3a source-parity: the same tick inputs through the controller wire (Hello, Claim, state records) and through
    // LocalSource give the same car.
    let pad = pad_script();
    let mut wire = vec![
        (
            0,
            net(
                "phone",
                Channel::Cmd,
                ControllerCmd::Hello {
                    protocol: PROTOCOL_VERSION,
                    build: BuildId("t".into()),
                    endpoint: EndpointId("phone".into()),
                    resume: None,
                }
                .encode(),
            ),
        ),
        (
            0,
            net(
                "phone",
                Channel::Cmd,
                ControllerCmd::Claim {
                    request: RequestId(1),
                    name: "Ava".into(),
                }
                .encode(),
            ),
        ),
    ];
    // The seat's source handle comes back in Welcome; the reducer gives the first seat handle 1.
    let src = SourceHandle(1);
    for (k, t) in (0..720u64).step_by(6).enumerate() {
        let drive = if t < 240 {
            [0, 32_767]
        } else if t < 480 {
            [16_000, 20_000]
        } else {
            [0, 0]
        };
        // Both paths ignore a sample until the seat has a car (claimed at tick 0, its car added at that boundary).
        wire.push((
            t,
            net("phone", Channel::State, record(src, k as u16 + 1, drive)),
        ));
    }
    let (local_tick, local_hash) = run(16_667, 720, &pad);
    let mut h = driving_host();
    for (t, m) in &wire {
        h.schedule(*t, m).unwrap();
    }
    h.stop_at(720);
    let mut now = 0;
    let mut welcome = None;
    while h.tick() < 720 {
        h.advance(now);
        now += 16_667;
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                channel: Channel::Cmd,
                bytes,
                ..
            } = m
                && let Ok(HostCmd::Welcome { source, .. }) = HostCmd::decode(&bytes)
            {
                welcome = Some(source);
            }
        }
    }
    assert_eq!(
        welcome,
        Some(src),
        "Welcome carried the source handle the records used"
    );
    assert_eq!(
        (h.tick(), h.state_hash()),
        (local_tick, local_hash),
        "controller bytes and LocalSource diverged"
    );
    let moved = h.sim().car_state(CarId(0)).unwrap();
    assert!(
        moved.forward_speed.abs() > 1.0 || moved.position[0] > 50.0,
        "the car actually drove: {moved:?}"
    );
}

#[test]
fn hiding_pauses_with_no_catch_up_and_resume_counts_down_with_neutral_input() {
    let mut h = driving_host();
    // A pad holding full throttle.
    for t in (0..2000).step_by(6) {
        h.schedule(t, &local(1, [0, 32_767])).unwrap();
    }
    let mut now = 0;
    for _ in 0..120 {
        h.advance(now);
        now += 8_334;
    }
    let before = h.tick();
    assert!(before > 100);
    h.handle(
        &MainToSim::Lifecycle {
            visible: false,
            render_ok: true,
        }
        .encode(),
    )
    .unwrap();
    // Ten hidden seconds: no ticks now, and none replayed later.
    for _ in 0..1000 {
        h.advance(now);
        now += 10 * MS;
    }
    assert_eq!(h.tick(), before);
    assert_eq!(h.pause_mask(), Pause::HostHidden as u32);
    h.handle(
        &MainToSim::Lifecycle {
            visible: true,
            render_ok: true,
        }
        .encode(),
    )
    .unwrap();
    assert_eq!(h.pause_mask(), 0);
    // The countdown: visible, 3 s, still no ticks.
    h.advance(now);
    assert!(h.countdown_us() > 2_900_000);
    let mut t = 0;
    while h.countdown_us() > 0 {
        now += 100 * MS;
        h.advance(now);
        t += 100;
        assert_eq!(h.tick(), before, "no ticks during the countdown");
        assert!(t <= 3_100);
    }
    // Then exactly real time's worth of ticks: one second → 120, not the hidden ten seconds.
    for _ in 0..120 {
        now += 8_334;
        h.advance(now);
    }
    assert!(
        (h.tick() - before).abs_diff(120) <= 1,
        "no catch-up: {} ticks",
        h.tick() - before
    );
}

#[test]
fn input_is_rearmed_at_neutral_after_a_pause() {
    let mut h = driving_host();
    // A pad refreshing full throttle every 6 ticks (a held stick), up to tick 60.
    for t in (0..60).step_by(6) {
        h.schedule(t, &local(1, [0, 32_767])).unwrap();
    }
    let mut now = 0;
    for _ in 0..60 {
        h.advance(now);
        now += 8_334;
    }
    assert!(h.sim().applied_input(CarId(0)).unwrap().throttle > 0);
    // Paused (manual): a sample arrives during the pause; after the countdown the car is neutral until fresh input.
    h.handle(
        &MainToSim::Ui {
            command: CommandId(1),
            ui: UiCommand::Pause { on: true },
        }
        .encode(),
    )
    .unwrap();
    h.handle(&local(1, [0, 32_767])).unwrap();
    h.handle(
        &MainToSim::Ui {
            command: CommandId(2),
            ui: UiCommand::Pause { on: false },
        }
        .encode(),
    )
    .unwrap();
    now += 3_100 * MS;
    h.advance(now);
    for _ in 0..30 {
        now += 8_334;
        h.advance(now);
    }
    assert_eq!(
        h.sim().applied_input(CarId(0)).unwrap(),
        DriveInput::default(),
        "re-armed at neutral"
    );
    h.handle(&local(1, [0, 32_767])).unwrap();
    now += 8_334;
    h.advance(now);
    now += 8_334;
    h.advance(now);
    assert!(
        h.sim().applied_input(CarId(0)).unwrap().throttle > 0,
        "fresh input drives again"
    );
}

#[test]
fn a_long_stall_pauses_at_the_last_tick_instead_of_catching_up() {
    let mut h = driving_host();
    let mut now = 0;
    for _ in 0..60 {
        h.advance(now);
        now += 8_334;
    }
    let at = h.tick();
    now += 2_000 * MS; // the worker was starved for two seconds
    assert_eq!(h.advance(now), 0);
    assert_eq!(
        (h.tick(), h.pause_mask()),
        (at, Pause::PerformanceStall as u32)
    );
    now += STALL_HOLD_US + 10;
    h.advance(now);
    assert_eq!(h.pause_mask(), 0);
    now += RESUME_COUNTDOWN_US + 10;
    h.advance(now);
    for _ in 0..60 {
        now += 8_334;
        h.advance(now);
    }
    assert!(h.tick() > at, "running again after the stall");
}

#[test]
fn a_fault_stops_the_sim() {
    let mut h = driving_host();
    h.fault();
    assert_eq!(h.pause_mask(), Pause::Fault as u32);
    assert_eq!(h.advance(1_000_000), 0);
    assert_eq!(h.advance(2_000_000), 0);
}

#[test]
fn replay_air_flag_uses_suspension_contacts_instead_of_terrain_height() {
    let mut h = driving_host();
    h.sim.spawn_grid_as(&[0]);
    for _ in 0..120 {
        h.sim.step();
    }
    let read = |h: &Host| {
        let mut buf = vec![0; h.snapshot_size()];
        h.write_snapshot(&mut buf);
        u32::from_le_bytes(
            buf[SNAPSHOT_HEADER + 52..SNAPSHOT_HEADER + 56]
                .try_into()
                .unwrap(),
        ) & 256
    };
    assert!(h.sim.car_state(CarId(0)).unwrap().wheels_in_contact > 0);
    assert_eq!(read(&h), 0, "a grounded car is not an air highlight");
    h.sim.place_car(
        CarId(0),
        jj_sim::SpawnPose {
            x: 0.0,
            y: 10.0,
            z: 0.0,
            heading: 0.0,
        },
        0.0,
        [0.0; 3],
    );
    h.sim.step();
    assert_eq!(h.sim.car_state(CarId(0)).unwrap().wheels_in_contact, 0);
    assert_eq!(
        read(&h),
        256,
        "an actual flight is marked for the presentation recorder"
    );
}

#[test]
fn snapshots_carry_cars_and_skip_when_the_buffer_is_short() {
    let mut h = driving_host();
    h.handle(&local(1, [0, 20_000])).unwrap();
    h.handle(&local(2, [0, 20_000])).unwrap();
    let mut now = 0;
    for _ in 0..30 {
        h.advance(now);
        now += 8_334;
    }
    let need = h.snapshot_size();
    assert!(
        h.write_snapshot(&mut vec![0; need - 1]) == 0,
        "a short buffer is skipped, not overrun"
    );
    let mut buf = vec![0; need];
    assert_eq!(h.write_snapshot(&mut buf), need);
    let u32_at = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
    assert_eq!(u32_at(0), SNAPSHOT_MAGIC);
    assert_eq!(u64::from_le_bytes(buf[8..16].try_into().unwrap()), h.tick());
    assert_eq!(u32_at(28), 2, "two cars");
    let y = f32::from_le_bytes(
        buf[SNAPSHOT_HEADER + 12..SNAPSHOT_HEADER + 16]
            .try_into()
            .unwrap(),
    );
    assert!(y > 0.0 && y < 2.0, "car 0's height {y}");
    let _ = Origin::Local(LocalSourceId(1));
}

#[test]
fn loose_and_detached_parts_reach_the_snapshot_and_main_as_part_records_and_events() {
    // P1-S04b through the real host path: a loose door and a detached bumper are part records in the snapshot (state,
    // hinge angle, the debris body's pose) and PartLoose / PartDetached events with their cause; the detached bumper keeps
    // its debris slot (kind 2) so debris indices stay stable.
    use jj_protocol::abi::{DamageCause, SimEvent};
    let mut h = driving_host();
    h.handle(&local(1, [0, 20_000])).unwrap();
    let mut now = 0;
    for _ in 0..30 {
        h.advance(now);
        now += 8_334;
    }
    h.sim.set_part_health(CarId(0), 3, 5.0);
    h.sim.set_part_health(CarId(0), 1, 0.0);
    for _ in 0..30 {
        h.advance(now);
        now += 8_334;
    }
    let mut events = Vec::new();
    while let Some(m) = h.next_message() {
        if let SimToMain::Events { batch } = m {
            events.extend(batch);
        }
    }
    // The bumper is gone, its cause the scenery (the setup command isn't a hit, so `Scenery`).
    let _ = DamageCause::Scenery;
    let mut buf = vec![0; h.snapshot_size()];
    let n = h.write_snapshot(&mut buf);
    assert_eq!(n, buf.len());
    let u32_at = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
    let u16_at = |o: usize| u16::from_le_bytes(buf[o..o + 2].try_into().unwrap());
    let (cars, debris, parts) = (u32_at(28), u32_at(32) as usize, u32_at(36) as usize);
    assert_eq!((cars, debris >= 1, parts), (1, true, 2), "two part records");
    let at = SNAPSHOT_HEADER + SNAPSHOT_CAR + SNAPSHOT_DEBRIS * debris;
    let rec = |i: usize| at + i * SNAPSHOT_PART;
    assert_eq!(
        (u32_at(rec(0)), u16_at(rec(0) + 4), u16_at(rec(0) + 6)),
        (0, 1, 2),
        "the bumper: detached"
    );
    assert_eq!(
        (u32_at(rec(1)), u16_at(rec(1) + 4), u16_at(rec(1) + 6)),
        (0, 3, 1),
        "the door: loose"
    );
    let kinds: Vec<u32> = (0..debris)
        .map(|i| u32_at(SNAPSHOT_HEADER + SNAPSHOT_CAR + i * SNAPSHOT_DEBRIS + 28))
        .collect();
    assert!(
        kinds.contains(&2),
        "the bumper's debris slot is kind 2: {kinds:?}"
    );
    // Events are only seat events when a seat drives the car; the local source's seat does.
    assert!(
        events
            .iter()
            .any(|e| matches!(e, SimEvent::PartDetached { part: 1, .. }))
            && events
                .iter()
                .any(|e| matches!(e, SimEvent::PartLoose { part: 3, .. })),
        "{events:?}"
    );
}

#[test]
fn a_wreck_leaves_a_husk_and_its_parts_as_pieces_in_the_snapshot_and_a_wrecked_event() {
    // P1-S04c through the real host path: detached wheels wreck the car once R121's grace runs out. Main gets Wrecked (with the wheel's cause);
    // the snapshot has the husk (part 255) and the ten parts as pieces (state 3: they belong to a car that has since been
    // rebuilt), the debris list keeps their slots (kind 2), and the respawned car's parts are all intact.
    use jj_protocol::abi::SimEvent;
    let mut h = driving_host();
    h.handle(&local(1, [0, 20_000])).unwrap();
    let mut now = 0;
    for _ in 0..30 {
        h.advance(now);
        now += 8_334;
    }
    h.sim.set_part_health(CarId(0), 7, 0.0);
    h.sim.set_part_health(CarId(0), 10, 0.0);
    let grace = (h.sim.profile().tuning.damage.wheel_loss_respawn_s * TICK_HZ as f32) as u64;
    for _ in 0..grace + 30 {
        h.advance(now);
        now += 8_334;
    }
    let mut events = Vec::new();
    while let Some(m) = h.next_message() {
        if let SimToMain::Events { batch } = m {
            events.extend(batch);
        }
    }
    assert!(
        events.iter().any(|e| matches!(e, SimEvent::Wrecked { .. })),
        "{events:?}"
    );
    let mut buf = vec![0; h.snapshot_size()];
    assert_eq!(h.write_snapshot(&mut buf), buf.len());
    let u32_at = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
    let u16_at = |o: usize| u16::from_le_bytes(buf[o..o + 2].try_into().unwrap());
    let (debris, parts) = (u32_at(32) as usize, u32_at(36) as usize);
    assert_eq!((debris >= 11, parts), (true, 11), "the husk and ten parts");
    let at = SNAPSHOT_HEADER + SNAPSHOT_CAR + SNAPSHOT_DEBRIS * debris;
    let recs: Vec<(u16, u16)> = (0..parts)
        .map(|i| {
            (
                u16_at(at + i * SNAPSHOT_PART + 4),
                u16_at(at + i * SNAPSHOT_PART + 6),
            )
        })
        .collect();
    assert!(
        recs.iter().all(|r| r.1 == 3),
        "every record is a piece: {recs:?}"
    );
    assert!(recs.iter().any(|r| r.0 == 255), "one is the husk");
    let kinds2 = (0..debris)
        .filter(|&i| u32_at(SNAPSHOT_HEADER + SNAPSHOT_CAR + i * SNAPSHOT_DEBRIS + 28) == 2)
        .count();
    assert_eq!(kinds2, 11, "the pieces keep their debris slots, kind 2");
}

fn boost_then_release_classic() {
    let classic = true;
    // P1-S03b: a phone holding DRIVE up with ACTION right boosts (jj-input's held right sector, through the source
    // semantics into the sim's applied input); swinging ACTION left names nothing and lets go (R128).
    let mut h = driving_host();
    let hello = ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("phone".into()),
        resume: None,
    };
    let claim = ControllerCmd::Claim {
        request: RequestId(1),
        name: "Ava".into(),
    };
    h.schedule(0, &net("phone", Channel::Cmd, hello.encode()))
        .unwrap();
    h.schedule(0, &net("phone", Channel::Cmd, claim.encode()))
        .unwrap();
    for (k, t) in (0..240u64).step_by(6).enumerate() {
        // The old layout: the right stick held right boosts, swung left it lets go.
        let (drive, action) = match t < 120 {
            true => ([0, 32_767], [32_767, 0]),
            false => ([0, 32_767], [-32_767, 0]),
        };
        let batch = StateBatch {
            minor: STATE_MINOR,
            batch_seq: k as u16 + 1,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(1),
                seq: k as u16 + 1,
                drive,
                action,
                flags: StateFlags(
                    StateFlags::AVAILABLE
                        | StateFlags::DRIVE_TOUCH
                        | StateFlags::ACTION_TOUCH
                        | if classic { StateFlags::CLASSIC } else { 0 },
                ),
            }],
        };
        h.schedule(t, &net("phone", Channel::State, batch.encode().unwrap()))
            .unwrap();
    }
    let mut boosted = false;
    while h.tick() < 120 {
        h.step_one();
        boosted |= h.sim().action_state(CarId(0)).is_some_and(|a| a.boosting);
    }
    assert!(boosted, "boosted");
    while h.tick() < 200 {
        h.step_one();
    }
    let a = h.sim().action_state(CarId(0)).unwrap();
    assert!(!a.boosting, "swung left lets go of the boost: {a:?}");
    assert!(h.sim().applied_input(CarId(0)).is_some_and(|i| !i.boost));
}

/// P1-C13 (R119): a source on a shared connection that says it is unplugged keeps getting its 20 Hz refresh sent with the
/// others, so it is never silent; it still goes to the autopilot after DROPOUT_MS, the seat is held (and says for how long),
/// and plugging back in and pressing takes the car back.
#[test]
fn an_unplugged_source_on_a_live_connection_autopilots_after_the_dropout_time_and_is_held() {
    let mut h = driving_host();
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("laptop".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Pad".into(),
        },
    ] {
        h.schedule(0, &net("laptop", Channel::Cmd, c.encode()))
            .unwrap();
    }
    let ms = |t: u64| t * u64::from(TICK_HZ) / 1000;
    // Throttle until 1 s, unplugged (refreshes keep coming, flagged unavailable) from 1 s to 5 s, plugged and pressed after.
    for (k, t) in (0..ms(7_000)).step_by(3).enumerate() {
        let (drive, flags) = if t < ms(1_000) || t >= ms(5_000) {
            ([0, 32_767], StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH)
        } else {
            ([0, 0], 0)
        };
        let batch = StateBatch {
            minor: STATE_MINOR,
            batch_seq: k as u16 + 1,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(1),
                seq: k as u16 + 1,
                drive,
                action: [0, 0],
                flags: StateFlags(flags),
            }],
        };
        h.schedule(t, &net("laptop", Channel::State, batch.encode().unwrap()))
            .unwrap();
    }
    let unplugged = |h: &Host| {
        serde_json::from_str::<serde_json::Value>(&h.room_json()).unwrap()["seats"][0]["unpluggedMs"].as_u64()
    };
    while h.tick() < ms(900) {
        h.step_one();
    }
    assert!(!h.sim().has_autopilot(CarId(0)) && unplugged(&h).is_none());
    while h.tick() < ms(2_500) {
        h.step_one();
    }
    assert!(
        !h.sim().has_autopilot(CarId(0)),
        "not yet: the dropout time has not passed"
    );
    assert!(
        unplugged(&h).is_some_and(|u| (1_300..=1_700).contains(&u)),
        "{:?}",
        unplugged(&h)
    );
    while h.tick() < ms(4_500) {
        h.step_one();
    }
    assert!(
        h.sim().has_autopilot(CarId(0)),
        "autopilot after DROPOUT_MS though the stream never went quiet"
    );
    assert!(
        unplugged(&h).is_some_and(|u| u >= 3_300),
        "held and counting: {:?}",
        unplugged(&h)
    );
    assert_eq!(h.seats.seats().count(), 1, "the seat is held");
    while h.tick() < ms(6_500) {
        h.step_one();
    }
    assert!(unplugged(&h).is_none(), "plugged in again");
    assert!(
        !h.sim().has_autopilot(CarId(0))
            || matches!(
                h.sim().autopilot_state(CarId(0)).map(|a| a.mode),
                Some(jj_sim::autopilot::Mode::Handback)
            ),
        "the press took the car back"
    );
}

/// br-f3rz: a phone refreshes a held stick at 20 Hz and Wi-Fi power save can hold its packets 100-300 ms. A held
/// throttle with a 300 ms gap in its samples keeps driving through the gap (HOLD_MS), and a closed peer
/// (`MainToSim::PeerGone`) reads neutral at once.
#[test]
fn a_held_throttle_survives_a_300_ms_sample_gap_and_a_closed_peer_is_neutral_at_once() {
    let mut h = driving_host();
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Phone".into(),
        },
    ] {
        h.schedule(0, &net("phone", Channel::Cmd, c.encode()))
            .unwrap();
    }
    let ms = |t: u64| t * u64::from(TICK_HZ) / 1000;
    // Throttle held, refreshed every 50 ms, except for nothing from 1000 ms to 1300 ms; the samples stop at 1500 ms.
    for (i, t) in (0..1_500)
        .step_by(50)
        .filter(|t| !(1_000..1_300).contains(t))
        .enumerate()
    {
        let k = i as u16 + 1;
        let batch = StateBatch {
            minor: STATE_MINOR,
            batch_seq: k,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(1),
                seq: k,
                drive: [0, 32_767],
                action: [0, 0],
                flags: StateFlags(StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH),
            }],
        };
        h.schedule(
            ms(t),
            &net("phone", Channel::State, batch.encode().unwrap()),
        )
        .unwrap();
    }
    let throttle = |h: &Host| h.sim().applied_input(CarId(0)).map_or(0, |i| i.throttle);
    while h.tick() < ms(1_280) {
        h.step_one();
    }
    assert!(
        throttle(&h) > 0,
        "280 ms into the gap the held throttle still drives"
    );
    while h.tick() < ms(1_450) {
        h.step_one();
    }
    assert!(throttle(&h) > 0, "and after it");
    let gone = MainToSim::PeerGone {
        endpoint: EndpointId("phone".into()),
    }
    .encode();
    h.schedule(ms(1_460), &gone).unwrap();
    while h.tick() < ms(1_470) {
        h.step_one();
    }
    assert_eq!(throttle(&h), 0, "a closed peer is neutral at once");
}

#[test]
fn the_old_layouts_action_stick_still_boosts_then_lets_go() {
    // The old one-stick layout, a personal setting: the flag on every record tells the host to read it that way.
    boost_then_release_classic();
}

#[test]
fn r128_the_rim_is_not_a_boost_and_a_sideways_push_is_nothing() {
    // P1-C11 (R116, amended): the boost is the wheelie launch, so full forward to the rim is only throttle; the left stick
    // pushed sideways is nothing at all (R128: no drift input), so the throttle falls to zero.
    let mut h = driving_host();
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        },
    ] {
        h.schedule(0, &net("phone", Channel::Cmd, c.encode()))
            .unwrap();
    }
    for (k, t) in (0..240u64).step_by(6).enumerate() {
        let drive = if t < 120 { [0, 32_767] } else { [32_767, 0] };
        let batch = StateBatch {
            minor: STATE_MINOR,
            batch_seq: k as u16 + 1,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(1),
                seq: k as u16 + 1,
                drive,
                action: [0, 0],
                flags: StateFlags(StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH),
            }],
        };
        h.schedule(t, &net("phone", Channel::State, batch.encode().unwrap()))
            .unwrap();
    }
    let mut boosted = false;
    while h.tick() < 120 {
        h.step_one();
        boosted |= h.sim().action_state(CarId(0)).is_some_and(|a| a.boosting);
    }
    assert!(!boosted, "the rim is only throttle");
    while h.tick() < 200 {
        h.step_one();
    }
    let a = h.sim().action_state(CarId(0)).unwrap();
    assert!(!a.boosting, "sideways is not a boost: {a:?}");
    let applied = h.sim().applied_input(CarId(0)).unwrap();
    assert!(
        !applied.boost && applied.throttle == 0 && applied.brake == 0,
        "a sideways push is no input: {applied:?}"
    );
}

#[test]
fn a_controllers_wheelie_applies_once_and_a_host_pads_gesture_is_detected_by_the_host() {
    // P1-S03c: a controller sends its validated release as `Action` (resent on the reliable channel, applied once);
    // a host pad's pull-release is detected by the host's own source machine.
    let mut h = driving_host();
    let hello = ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("phone".into()),
        resume: None,
    };
    let claim = ControllerCmd::Claim {
        request: RequestId(1),
        name: "Ava".into(),
    };
    h.schedule(0, &net("phone", Channel::Cmd, hello.encode()))
        .unwrap();
    h.schedule(0, &net("phone", Channel::Cmd, claim.encode()))
        .unwrap();
    let wheelie = ControllerCmd::Action {
        action: jj_types::ActionId(7),
        source: SourceHandle(1),
        kind: jj_protocol::cmd::ActionKind::Wheelie { preload_ms: 450 },
        round: jj_types::RoundId(0),
        life: jj_types::LifeId(0),
        at_source_seq: 1,
    };
    for t in [30, 31] {
        h.schedule(t, &net("phone", Channel::Cmd, wheelie.encode()))
            .unwrap();
    }
    // A pad (local source 5) rolls, pulls past full brake for 0.45 s, then snaps forward.
    for t in (0..240u64).step_by(2) {
        let y = if t < 60 {
            13_000
        } else if t < 114 {
            -32_767
        } else {
            32_767
        };
        h.schedule(t, &local(5, [0, y])).unwrap();
    }
    while h.tick() < 240 {
        h.step_one();
    }
    let wheelies: Vec<(u64, u32)> = h
        .sim()
        .journal()
        .setup
        .iter()
        .filter_map(|(t, s)| match s {
            jj_sim::journal::Setup::Wheelie { car, .. } => Some((*t, *car)),
            _ => None,
        })
        .collect();
    let phone: Vec<_> = wheelies.iter().filter(|(_, c)| *c == 0).collect();
    let pad: Vec<_> = wheelies.iter().filter(|(_, c)| *c == 1).collect();
    assert_eq!(
        phone.len(),
        1,
        "the resent Action applied once: {wheelies:?}"
    );
    assert_eq!(pad.len(), 1, "the pad's release fired once: {wheelies:?}");
    assert!(pad[0].0 >= 114 && pad[0].0 < 130, "at the release: {pad:?}");
}

fn pad(source: u32, drive: [i16; 2], buttons: u32) -> Vec<u8> {
    MainToSim::LocalSource {
        source: LocalSourceId(source),
        axes: [drive[0], drive[1], 0, 0],
        buttons,
        seq: 0,
    }
    .encode()
}

#[test]
fn host_pads_claim_on_press_drop_out_to_the_autopilot_and_come_back() {
    // P1-C05: two host pads claim two seats on their first press (a neutral pad claims nothing), unplugging one makes
    // it neutral at once and hands only its car to the autopilot after DROPOUT_MS, and fresh deliberate input takes
    // it back.
    let mut h = driving_host();
    let ms = |t: u64| t * u64::from(TICK_HZ) / 1000;
    // Pad 3 is plugged in but untouched until 1 s: it sends nothing, so it claims nothing.
    for t in (0..ms(6_000)).step_by(6) {
        h.schedule(t, &pad(1, [0, 32_767], 0)).unwrap();
        if t >= ms(1_000) && t < ms(2_000) {
            h.schedule(t, &pad(2, [0, 32_767], 0)).unwrap();
        }
        if t >= ms(5_000) {
            h.schedule(t, &pad(2, [16_000, 32_767], 0)).unwrap();
        }
    }
    // Pad 2 unplugs at 2 s: one unavailable sample, then silence until it comes back at 5 s.
    h.schedule(ms(2_000), &pad(2, [0, 0], LOCAL_UNAVAILABLE))
        .unwrap();
    let seats_at = |h: &Host| h.seats.seats().count();
    while h.tick() < ms(900) {
        h.step_one();
    }
    assert_eq!(seats_at(&h), 1, "only the pressed pad has a seat");
    let mut autopiloted_at = None;
    while h.tick() < ms(4_800) {
        h.step_one();
        if autopiloted_at.is_none() && h.sim().has_autopilot(CarId(1)) {
            autopiloted_at = Some(h.tick());
        }
    }
    assert_eq!(seats_at(&h), 2);
    // R119: the room view says how long the unplugged seat has been unplugged (and nothing else is).
    let unplugged: Vec<Option<u64>> = serde_json::from_str::<serde_json::Value>(&h.room_json())
        .unwrap()["seats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["unpluggedMs"].as_u64())
        .collect();
    assert_eq!(
        unplugged.iter().filter(|u| u.is_some()).count(),
        1,
        "only the unplugged pad: {unplugged:?}"
    );
    let held_for = unplugged.iter().flatten().next().copied().unwrap();
    assert!(
        (2_700..=2_900).contains(&held_for),
        "unplugged for about 2.8 s: {held_for}"
    );
    let at = autopiloted_at.expect("the unplugged pad's car went to the autopilot");
    assert!(
        at > ms(2_000) + ms(DROPOUT_MS) - 6 && at <= ms(2_000) + ms(DROPOUT_MS) + 2,
        "after DROPOUT_MS: tick {at}"
    );
    assert!(!h.sim().has_autopilot(CarId(0)), "only its seat");
    while h.tick() < ms(5_500) {
        h.step_one();
    }
    let back = h
        .sim()
        .has_autopilot(CarId(1))
        .then(|| h.sim().autopilot_state(CarId(1)).map(|a| a.mode));
    assert!(
        matches!(back, None | Some(Some(jj_sim::autopilot::Mode::Handback))),
        "fresh input took it back: {back:?}"
    );
    assert!(
        serde_json::from_str::<serde_json::Value>(&h.room_json()).unwrap()["seats"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["unpluggedMs"].is_null()),
        "plugged again: nothing is unplugged"
    );
}

#[test]
fn a_host_pad_identifies_sits_out_leaves_and_joins_again_as_a_new_seat() {
    // P1-C05: Identify fires for that seat only (an event for the renderer's Cooee flash); the drawer's Sit out
    // toggles at a tick boundary; the hold chord leaves (the seat stays, Left, with its standings), and after letting
    // go the pad's next press is a new player with a new seat.
    let mut h = driving_host();
    let ms = |t: u64| t * u64::from(TICK_HZ) / 1000;
    h.schedule(0, &pad(4, [0, 20_000], 0)).unwrap();
    h.schedule(0, &pad(9, [0, 20_000], 0)).unwrap();
    // Past the seat reducer's Identify limit (joining auto-flashes).
    h.schedule(ms(3_500), &pad(4, [0, 0], LOCAL_IDENTIFY))
        .unwrap();
    h.schedule(ms(3_600), &pad(4, [0, 0], 0)).unwrap();
    h.schedule(ms(4_000), &pad(9, [0, 0], LOCAL_SIT_OUT))
        .unwrap();
    h.schedule(ms(4_100), &pad(9, [0, 0], 0)).unwrap();
    h.schedule(
        ms(5_000),
        &pad(4, [0, 0], LOCAL_IDENTIFY | LOCAL_READY | LOCAL_LEAVE),
    )
    .unwrap();
    // Still holding after leaving: nothing joins until it lets go.
    h.schedule(
        ms(5_100),
        &pad(4, [0, 0], LOCAL_IDENTIFY | LOCAL_READY | LOCAL_LEAVE),
    )
    .unwrap();
    h.schedule(ms(5_500), &pad(4, [0, 0], 0)).unwrap();
    h.schedule(ms(6_000), &pad(4, [0, 25_000], 0)).unwrap();
    let mut identified = Vec::new();
    let presence = |h: &Host, endpoint: &str| {
        h.seats
            .seats()
            .find(|s| s.endpoint.0 == endpoint)
            .map(|s| s.presence)
    };
    while h.tick() < ms(5_400) {
        h.step_one();
        while let Some(m) = h.next_message() {
            if let SimToMain::Events { batch } = m {
                identified.extend(batch.into_iter().filter_map(|e| match e {
                    SimEvent::Identify { seat } => Some(seat),
                    _ => None,
                }));
            }
        }
    }
    let seat_of = |h: &Host, endpoint: &str| {
        h.seats
            .seats()
            .find(|s| s.endpoint.0 == endpoint)
            .map(|s| s.id)
    };
    let (four, nine) = (
        seat_of(&h, "local:4").unwrap(),
        seat_of(&h, "local:9").unwrap(),
    );
    // Each seat auto-flashed on joining; then only pad 4's press flashed, and only its seat.
    assert_eq!(
        identified,
        vec![four, nine, four],
        "Identify for that seat only"
    );
    assert_eq!(
        presence(&h, "local:9"),
        Some(jj_session::seats::Presence::SittingOut),
        "Sit out from the drawer"
    );
    assert_eq!(
        presence(&h, "local:4"),
        Some(jj_session::seats::Presence::Left),
        "Leave at a tick boundary"
    );
    while h.tick() < ms(6_200) {
        h.step_one();
    }
    assert_eq!(
        presence(&h, "local:4"),
        Some(jj_session::seats::Presence::Left),
        "the old seat stays, standings kept"
    );
    assert_eq!(
        presence(&h, "local:4#2"),
        Some(jj_session::seats::Presence::Active),
        "a new seat for the next press"
    );
    assert_eq!(h.seats.seats().count(), 3);
}

#[test]
fn a_controllers_utilities_apply_once_and_reach_main_as_events_and_a_cone_in_the_snapshot() {
    // P1-S08 through the real host path: a phone sends its ACTION up/down entries as `Action` (resent on the reliable
    // channel, applied once per id); a host pad's flick up is detected by the host's own source machine. Accepted
    // utilities reach main as `Oi` / `ConeDropped`, and the cone is a debris record of kind 1 in the snapshot.
    let mut h = driving_host();
    let hello = ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("phone".into()),
        resume: None,
    };
    let claim = ControllerCmd::Claim {
        request: RequestId(1),
        name: "Ava".into(),
    };
    h.schedule(0, &net("phone", Channel::Cmd, hello.encode()))
        .unwrap();
    h.schedule(0, &net("phone", Channel::Cmd, claim.encode()))
        .unwrap();
    let action = |id: u32, kind| ControllerCmd::Action {
        action: jj_types::ActionId(id),
        source: SourceHandle(1),
        kind,
        round: jj_types::RoundId(0),
        life: jj_types::LifeId(0),
        at_source_seq: 1,
    };
    let rear = action(9, jj_protocol::cmd::ActionKind::UtilityRear);
    let up = action(10, jj_protocol::cmd::ActionKind::UtilityForward);
    for t in [30, 31, 33] {
        h.schedule(t, &net("phone", Channel::Cmd, rear.encode()))
            .unwrap();
    }
    h.schedule(40, &net("phone", Channel::Cmd, up.encode()))
        .unwrap();
    // A pad (local source 5): ACTION up for 0.1 s, then neutral.
    let pad = |action_y: i16| {
        MainToSim::LocalSource {
            source: LocalSourceId(5),
            axes: [0, 0, 0, action_y],
            buttons: 0,
            seq: 0,
        }
        .encode()
    };
    for t in (0..120u64).step_by(2) {
        let y = if (50..62).contains(&t) { 32_767 } else { 0 };
        h.schedule(t, &pad(y)).unwrap();
    }
    let mut events = Vec::new();
    while h.tick() < 120 {
        h.step_one();
        while let Some(m) = h.next_message() {
            if let SimToMain::Events { batch } = m {
                events.extend(batch);
            }
        }
    }
    let utilities: Vec<(u32, jj_sim::UtilityKind)> = h
        .sim()
        .journal()
        .setup
        .iter()
        .filter_map(|(_, s)| match s {
            jj_sim::journal::Setup::Utility { car, kind } => Some((*car, *kind)),
            _ => None,
        })
        .collect();
    assert_eq!(
        utilities,
        vec![
            (0, jj_sim::UtilityKind::Rear),
            (0, jj_sim::UtilityKind::Forward),
            (1, jj_sim::UtilityKind::Forward)
        ],
        "each action id applied once, the pad's flick once"
    );
    let cones: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, SimEvent::ConeDropped { .. }))
        .collect();
    let ois = events
        .iter()
        .filter(|e| matches!(e, SimEvent::Oi { .. }))
        .count();
    assert_eq!(cones.len(), 1, "one cone reached main: {events:?}");
    assert_eq!(
        ois, 2,
        "the phone's and the pad's OI! reached main: {events:?}"
    );
    let SimEvent::ConeDropped { debris, .. } = *cones[0] else {
        unreachable!()
    };
    let mut buf = vec![0u8; h.snapshot_size()];
    assert!(h.write_snapshot(&mut buf) > 0);
    let cars = h.sim().cars().count();
    let at = SNAPSHOT_HEADER + SNAPSHOT_CAR * cars + SNAPSHOT_DEBRIS * debris as usize + 28;
    assert_eq!(
        u32::from_le_bytes(buf[at..at + 4].try_into().unwrap()),
        1,
        "the cone's debris record says cone"
    );
}

#[test]
fn item_inventory_events_and_use_refusals_follow_only_their_hub_source() {
    use jj_protocol::cmd::ActionOutcome;
    use jj_protocol::items::{Inventory, ItemEventKind, ItemId};
    let mut h = Host::new(&init()).unwrap();
    let send = |h: &mut Host, cmd: ControllerCmd| {
        h.handle(&net("hub-items", Channel::Cmd, cmd.encode()))
            .unwrap();
    };
    let wrapped = |source, cmd| ControllerCmd::ForSource {
        source: SourceHandle(source),
        cmd: Box::new(cmd),
    };
    send(
        &mut h,
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("hub-items".into()),
            resume: None,
        },
    );
    for source in [7, 9] {
        send(
            &mut h,
            wrapped(
                source,
                ControllerCmd::Claim {
                    request: RequestId(source.into()),
                    name: format!("Pad {source}"),
                },
            ),
        );
    }
    h.step_one();
    for source in [7, 9] {
        send(&mut h, wrapped(source, ControllerCmd::Ready { on: true }));
    }
    for _ in 0..1200 {
        h.step_one();
        if h.phase() == jj_session::director::Phase::Running {
            break;
        }
    }
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
    for _ in 0..240 {
        h.step_one();
    }
    let seat = h
        .seats
        .seats()
        .find(|s| s.source == SourceHandle(7))
        .unwrap()
        .id;
    let car = h.inputs[&seat].car.unwrap();
    assert!(!h.sim.is_protected(car));
    while h.next_message().is_some() {}
    h.sim.pickup_item(car, seat, ItemId::Boomerang).unwrap();
    h.sim.pickup_item(car, seat, ItemId::Sanga).unwrap();
    assert_eq!(
        h.sim.pickup_item(car, seat, ItemId::Boomerang),
        Err(jj_sim::items::PickupRefusal::Full)
    );
    h.step_one();
    let drain = |h: &mut Host| {
        let mut cmds = Vec::new();
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                channel: Channel::Cmd,
                bytes,
                endpoint,
            } = m
                && let Ok(HostCmd::ForSource { source, cmd }) = HostCmd::decode(&bytes)
            {
                assert_eq!(endpoint.0, "hub-items");
                cmds.push((source, *cmd));
            }
        }
        cmds
    };
    let picked = drain(&mut h);
    let held = Inventory {
        front: Some(ItemId::Boomerang),
        back: Some(ItemId::Sanga),
    };
    assert!(
        picked
            .iter()
            .any(|(source, cmd)| *source == SourceHandle(7) && *cmd == HostCmd::Inventory(held))
    );
    let events = picked
        .iter()
        .filter_map(|(source, cmd)| match cmd {
            HostCmd::ItemEvent(e) => {
                assert_eq!(*source, SourceHandle(7));
                assert_eq!(e.owner, seat);
                Some(*e)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        events.len(),
        2,
        "a refused third box creates no pickup event"
    );
    assert_eq!(
        (events[0].item, events[1].item),
        (ItemId::Boomerang, ItemId::Sanga)
    );
    assert!(events.iter().all(|e| e.kind == ItemEventKind::Picked));
    let action = wrapped(
        7,
        ControllerCmd::Action {
            action: ActionId(50),
            source: SourceHandle(7),
            kind: ActionKind::UtilityRear,
            round: jj_types::RoundId(0),
            life: jj_types::LifeId(0),
            at_source_seq: 1,
        },
    );
    send(&mut h, action.clone());
    h.step_one();
    // P1-W02a: the boomerang has its projectile now, so the rear flick throws it (it used to be refused as unavailable).
    let thrown = drain(&mut h);
    assert!(
        thrown.iter().any(|(source, cmd)| *source == SourceHandle(7)
            && matches!(
                cmd,
                HostCmd::ActionResult {
                    action: ActionId(50),
                    outcome: ActionOutcome::Applied { .. },
                }
            )),
        "the throw's result goes to its own hub source: {thrown:?}"
    );
    let after = Inventory {
        front: Some(ItemId::Sanga),
        back: None,
    };
    assert_eq!(h.inventory_for(seat), after);
    assert_eq!(h.sim.boomerangs().len(), 1, "one boomerang in the air");
    assert!(
        h.sim.utility_events().is_empty(),
        "no cone is substituted for the held item"
    );
    send(&mut h, action);
    h.step_one();
    assert_eq!(
        h.sim.boomerangs().len(),
        1,
        "resent action is not applied twice"
    );
    assert_eq!(h.inventory_for(seat), after);
    // The sanga is still queued: the round end has to clear it.
    assert!(h.sim.end_race_now());
    h.step_one();
    assert!(
        drain(&mut h)
            .iter()
            .any(|(source, cmd)| *source == SourceHandle(7)
                && *cmd == HostCmd::Inventory(Inventory::default()))
    );
}

#[test]
fn a_reloaded_controller_says_hello_again_and_gets_its_seat_back() {
    // P1-C03/G04: a reload or a rebuilt link is a new connection, so its Hello must be answered with the same seat.
    let hello = || {
        net(
            "phone",
            Channel::Cmd,
            ControllerCmd::Hello {
                protocol: PROTOCOL_VERSION,
                build: BuildId("t".into()),
                endpoint: EndpointId("phone".into()),
                resume: Some("secret".into()),
            }
            .encode(),
        )
    };
    let claim = net(
        "phone",
        Channel::Cmd,
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        }
        .encode(),
    );
    let mut h = driving_host();
    h.schedule(0, &hello()).unwrap();
    h.schedule(0, &claim).unwrap();
    h.schedule(60, &hello()).unwrap();
    h.stop_at(120);
    let mut now = 0;
    let mut welcomes = Vec::new();
    while h.tick() < 120 {
        h.advance(now);
        now += 16_667;
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                channel: Channel::Cmd,
                bytes,
                ..
            } = m
                && let Ok(HostCmd::Welcome { seat, number, .. }) = HostCmd::decode(&bytes)
            {
                welcomes.push((seat, number));
            }
        }
    }
    assert_eq!(
        welcomes.len(),
        2,
        "a Welcome for the claim and one for the reload: {welcomes:?}"
    );
    assert_eq!(welcomes[0], welcomes[1], "the same seat and number");
}

/// P1-G01: the party loop runs itself. Four controllers claim in the real Lobby (no cars, R110), all Ready, the
/// Countdown puts them on the grid, a 1-lap race runs (the autopilot drives every car), results commit, Intermission
/// runs out and the next round starts with no host input.
#[test]
fn four_controllers_play_two_rounds_hands_off_and_the_lobby_has_no_cars() {
    let mut h = Host::new(&init()).unwrap();
    let ui = |ui: UiCommand| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&ui(UiCommand::SetLaps { laps: 1 })).unwrap();
    let phones = ["p1", "p2", "p3", "p4"];
    for (k, p) in phones.iter().enumerate() {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId((*p).into()),
            resume: Some(format!("s{k}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("Ava{k}"),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
    }
    let mut now = 0u64;
    let step = |h: &mut Host, ticks: u64, now: &mut u64| {
        for _ in 0..ticks {
            h.advance(*now);
            *now += 8_334;
            while h.next_message().is_some() {}
        }
    };
    step(&mut h, 120, &mut now);
    assert_eq!(h.phase(), jj_session::director::Phase::Lobby);
    assert_eq!(
        h.sim.cars().count(),
        0,
        "the Lobby has no driving cars (R110)"
    );
    assert!(h.room_json().contains("\"seats\""));
    for p in phones {
        h.handle(&net(
            p,
            Channel::Cmd,
            ControllerCmd::Ready { on: true }.encode(),
        ))
        .unwrap();
    }
    let mut rounds_started = 0;
    let mut results = 0;
    let mut last_phase = h.phase();
    let mut autopiloted = false;
    for _ in 0..(120 * 600) {
        step(&mut h, 1, &mut now);
        let phase = h.phase();
        if phase != last_phase {
            if phase == jj_session::director::Phase::Running {
                rounds_started += 1;
                autopiloted = false;
            }
            if phase == jj_session::director::Phase::Intermission {
                results += 1;
            }
            if phase == jj_session::director::Phase::Countdown {
                assert_eq!(
                    h.sim.cars().count(),
                    4,
                    "the Countdown puts the cohort on the grid"
                );
            }
            last_phase = phase;
        }
        if phase == jj_session::director::Phase::Running && !autopiloted {
            for c in 0..h.sim.cars().count() {
                h.sim.set_autopilot(CarId(c as u32), true);
            }
            autopiloted = true;
        }
        if rounds_started == 2 {
            break;
        }
    }
    assert_eq!(results, 1, "round 1 finished and committed its results");
    assert_eq!(
        rounds_started, 2,
        "round 2 started on its own after Intermission"
    );
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_eq!(room["standings"].as_array().unwrap().len(), 4);
    assert_eq!(room["results"].as_array().unwrap().len(), 4);
}

/// P1-G06: the lobby's mode choice runs a derby round end to end. Four controllers claim, the host picks Derby with a
/// 30 s round and a 10 s Intermission; the Countdown puts them in an arena (a bowl, not the course), GO starts the derby
/// on game time, two cars ram (points), the director ends the round at the limit, the results rank by raw points, and
/// after the Intermission the next round (still a derby) starts on its own. Then Race again runs a race.
#[test]
fn a_derby_round_runs_to_results_on_game_time_and_the_next_starts_on_its_own() {
    let mut h = Host::new(&init()).unwrap();
    let ui = |ui: UiCommand| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&ui(UiCommand::SetMode { derby: true })).unwrap();
    h.handle(&ui(UiCommand::SetDerbyLength { ms: 30_000 }))
        .unwrap();
    h.handle(&ui(UiCommand::SetIntermission { ms: 10_000 }))
        .unwrap();
    let phones = ["p1", "p2", "p3", "p4"];
    for (k, p) in phones.iter().enumerate() {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId((*p).into()),
            resume: Some(format!("s{k}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("Ava{k}"),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
        h.handle(&net(
            p,
            Channel::Cmd,
            ControllerCmd::Ready { on: true }.encode(),
        ))
        .unwrap();
    }
    let mut now = 0u64;
    let mut step = |h: &mut Host, ticks: u64| {
        for _ in 0..ticks {
            h.advance(now);
            now += 8_334;
            while h.next_message().is_some() {}
        }
    };
    let mut guard = 0;
    while h.phase() != jj_session::director::Phase::Running {
        step(&mut h, 30);
        guard += 1;
        assert!(guard < 1200, "the derby starts on its own");
    }
    assert!(
        h.map
            .map
            .features
            .iter()
            .any(|f| f.kind == jj_map::model::FeatureKind::Bowl),
        "a derby round is in an arena"
    );
    assert!(h.sim.derby().is_some(), "GO starts the derby, not a race");
    assert!(h.sim.race().started_at.is_none());
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_eq!(room["mode"], "derby");
    // Two cars ram: car 1 drives flat out into car 0, parked across its path, once spawn protection is over.
    step(&mut h, 2 * 120);
    let target = h.sim.car_state(CarId(0)).unwrap().position;
    let from = h.sim.car_state(CarId(1)).unwrap().position;
    let (dx, dz) = (target[0] - from[0], target[2] - from[2]);
    let d = dx.hypot(dz);
    let heading = dx.atan2(dz);
    h.sim.place_car(
        CarId(1),
        jj_sim::SpawnPose {
            x: target[0] - dx / d * 12.0,
            y: target[1] + 0.3,
            z: target[2] - dz / d * 12.0,
            heading,
        },
        0.0,
        [dx / d * 20.0, 0.0, dz / d * 20.0],
    );
    step(&mut h, 120);
    let points = h.sim.derby().unwrap().points(1);
    assert!(points > 0.0, "the ram scores: {points}");
    let mut results = 0;
    let mut started = 1;
    let mut last = h.phase();
    for _ in 0..(120 * 120) {
        step(&mut h, 1);
        let phase = h.phase();
        if phase != last {
            if phase == jj_session::director::Phase::Intermission {
                results += 1;
                let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
                let rows = room["results"].as_array().unwrap();
                assert_eq!(rows.len(), 4, "every seat is in the results: {room}");
                assert_eq!(
                    rows[0]["number"], room["seats"][1]["number"],
                    "the rammer ranks first: {rows:?}"
                );
                assert!(
                    rows.iter().all(|r| r["timeMs"].is_null()),
                    "a derby has no times"
                );
            }
            if phase == jj_session::director::Phase::Running {
                started += 1;
            }
            last = phase;
        }
        if started == 2 {
            break;
        }
    }
    assert_eq!(
        results, 1,
        "the derby ended at its 30 s limit and committed"
    );
    assert_eq!(
        started, 2,
        "the next round started on its own after the Intermission"
    );
    assert!(h.sim.derby().is_some(), "the next round is a derby too");
    // Race again from the next round: switched mid-derby, it applies when this derby ends.
    h.handle(&ui(UiCommand::SetMode { derby: false })).unwrap();
    assert!(h.sim.derby().is_some(), "the derby on now carries on");
    let mut guard = 0;
    while !(h.phase() == jj_session::director::Phase::Running && h.sim.race().started_at.is_some())
    {
        step(&mut h, 30);
        guard += 1;
        assert!(guard < 4000, "a race round follows: {:?}", h.phase());
    }
    assert!(h.sim.derby().is_none(), "Race runs a race");
}

/// P1-G01 (R90 "settable"): the race can be finished on demand. A running 99-lap round with four racers plus
/// `end_race_now` (what the test surface's `finishRace` calls) freezes the result as the finish window closing would:
/// the race rules emit RaceOver, the director goes Running -> Finalising -> Intermission the normal way, and the standings
/// hold every racer.
#[test]
fn finishing_the_race_on_demand_gives_intermission_with_standings_for_every_racer() {
    let mut h = Host::new(&init()).unwrap();
    h.handle(
        &MainToSim::Ui {
            command: CommandId(1),
            ui: UiCommand::SetLaps { laps: 99 },
        }
        .encode(),
    )
    .unwrap();
    for (k, p) in ["p1", "p2", "p3", "p4"].iter().enumerate() {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId((*p).into()),
            resume: Some(format!("s{k}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("Ava{k}"),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
        h.handle(&net(
            p,
            Channel::Cmd,
            ControllerCmd::Ready { on: true }.encode(),
        ))
        .unwrap();
    }
    let mut now = 0u64;
    let mut step = |h: &mut Host, ticks: u64| {
        for _ in 0..ticks {
            h.advance(now);
            now += 8_334;
            while h.next_message().is_some() {}
        }
    };
    let mut guard = 0;
    while h.phase() != jj_session::director::Phase::Running {
        step(&mut h, 60);
        guard += 1;
        assert!(guard < 600, "the round starts on its own");
    }
    for c in 0..h.sim.cars().count() {
        h.sim.set_autopilot(CarId(c as u32), true);
    }
    step(&mut h, 600);
    assert_eq!(
        h.phase(),
        jj_session::director::Phase::Running,
        "99 laps are far off"
    );
    assert!(h.sim.race().over.is_none());
    assert!(h.sim.end_race_now(), "a running race ends on demand");
    assert!(!h.sim.end_race_now(), "and only once");
    for _ in 0..200 {
        if h.phase() == jj_session::director::Phase::Intermission {
            break;
        }
        step(&mut h, 60);
    }
    assert_eq!(
        h.phase(),
        jj_session::director::Phase::Intermission,
        "RaceOver took the director through Finalising to Intermission"
    );
    assert_eq!(
        h.sim.race().over.map(|(_, why)| why),
        Some(jj_sim::race::RaceEnd::Window)
    );
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_eq!(
        room["results"].as_array().unwrap().len(),
        4,
        "every racer is placed"
    );
    assert_eq!(room["standings"].as_array().unwrap().len(), 4);
}

/// Owner playtest 1 (br-gw74.1): Identify answers every press after a round starts. Each round builds a new sim whose
/// tick restarts at 0; the seats keep their own clock, so a long Lobby doesn't freeze the Identify limit in the race.
#[test]
fn identify_answers_every_press_after_a_long_lobby_and_a_round_start() {
    let mut h = Host::new(&init()).unwrap();
    for (k, p) in ["p1", "p2"].iter().enumerate() {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId((*p).into()),
            resume: Some(format!("s{k}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("Ava{k}"),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
    }
    let mut now = 0u64;
    let mut flashes = 0usize;
    let mut step = |h: &mut Host, ticks: u64, flashes: &mut usize| {
        for _ in 0..ticks {
            h.advance(now);
            now += 8_334;
            while let Some(m) = h.next_message() {
                if let SimToMain::Events { batch } = m {
                    *flashes += batch
                        .iter()
                        .filter(|e| matches!(e, SimEvent::Identify { .. }))
                        .count();
                }
            }
        }
    };
    // A long Lobby (60 s): the sim ticks far ahead of where the round's new world will start.
    step(&mut h, 120 * 60, &mut flashes);
    for p in ["p1", "p2"] {
        h.handle(&net(
            p,
            Channel::Cmd,
            ControllerCmd::Ready { on: true }.encode(),
        ))
        .unwrap();
    }
    let mut guard = 0;
    while h.phase() != jj_session::director::Phase::Running {
        step(&mut h, 60, &mut flashes);
        guard += 1;
        assert!(guard < 600, "the round starts on its own");
    }
    step(&mut h, 240, &mut flashes);
    for press in 1..=3 {
        let before = flashes;
        h.handle(&net("p1", Channel::Cmd, ControllerCmd::Identify.encode()))
            .unwrap();
        step(&mut h, 30, &mut flashes);
        assert!(
            flashes > before,
            "press {press} in the race flashed (sim tick {})",
            h.tick()
        );
        step(&mut h, 2 * 120, &mut flashes); // 2 s between presses
    }
}

/// P1-M08a (host side): with main preparing maps, the director's request becomes a `PrepareRequested` event with the
/// session seed plus the preparation id; a `MapReady` for another preparation is dropped and counted; the right one is
/// validated and the next Countdown builds the round on it.
#[test]
fn a_prepared_map_is_validated_and_raced_and_a_stale_one_is_dropped() {
    let mut h = Host::new(&init()).unwrap();
    let ui = |ui: UiCommand| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&ui(UiCommand::PrepareMaps { on: true })).unwrap();
    let hello = ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("p1".into()),
        resume: Some("s".into()),
    }
    .encode();
    h.handle(&net("p1", Channel::Cmd, hello)).unwrap();
    let claim = ControllerCmd::Claim {
        request: RequestId(1),
        name: "Ava".into(),
    }
    .encode();
    h.handle(&net("p1", Channel::Cmd, claim)).unwrap();
    let mut now = 0;
    let mut request = None;
    let pump = |h: &mut Host,
                ticks: u32,
                now: &mut u64,
                request: &mut Option<(jj_types::PreparationId, u64)>| {
        for _ in 0..ticks {
            h.advance(*now);
            *now += 8_334;
            while let Some(m) = h.next_message() {
                if let SimToMain::Events { batch } = m {
                    for e in batch {
                        if let SimEvent::PrepareRequested {
                            preparation, seed, ..
                        } = e
                        {
                            *request = Some((preparation, seed));
                        }
                    }
                }
            }
        }
    };
    pump(&mut h, 30, &mut now, &mut request);
    h.handle(&ui(UiCommand::StartRound)).unwrap();
    pump(&mut h, 30, &mut now, &mut request);
    let (preparation, seed) = request.expect("the start asked main to prepare a map");
    assert_eq!(
        seed,
        3 + u64::from(preparation.0),
        "session seed + preparation id"
    );
    assert_eq!(h.phase(), jj_session::director::Phase::Preparing);

    let generated = jj_procgen::prepare(seed, &[jj_map::Biome::OutbackDirt]);
    let bytes = jj_map::canonical_bytes(&generated.map);
    let stale = jj_types::PreparationId(preparation.0 + 7);
    h.handle(
        &MainToSim::MapReady {
            preparation: stale,
            map_bytes: bytes.clone(),
        }
        .encode(),
    )
    .unwrap();
    pump(&mut h, 5, &mut now, &mut request);
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_eq!(room["preparation"]["staleDropped"], 1);
    assert_eq!(
        h.phase(),
        jj_session::director::Phase::Preparing,
        "a stale map never commits"
    );

    h.handle(
        &MainToSim::MapReady {
            preparation,
            map_bytes: bytes,
        }
        .encode(),
    )
    .unwrap();
    pump(&mut h, 60, &mut now, &mut request);
    assert!(
        matches!(
            h.phase(),
            jj_session::director::Phase::Countdown | jj_session::director::Phase::Running
        ),
        "{:?}",
        h.phase()
    );
    assert_eq!(
        h.map.hash,
        jj_map::load_canonical(
            &jj_map::canonical_bytes(&generated.map),
            &jj_procgen::registry()
        )
        .unwrap()
        .hash
    );
    assert_eq!(h.sim.cars().count(), 1);
}

/// P1-G03: idle and menu handoffs, on top of the dropout rule. A racing controller that keeps sending neutral input
/// gets the takeover cue at 15 s and the autopilot at 18 s; its next deliberate input takes the car back. Opening the
/// menu hands the car over at once; the first deliberate input after closing it takes it back.
#[test]
fn an_idle_racer_gets_the_cue_then_the_autopilot_and_a_menu_hands_over() {
    let mut h = Host::new(&init()).unwrap();
    let hello = ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("p1".into()),
        resume: Some("s".into()),
    }
    .encode();
    h.handle(&net("p1", Channel::Cmd, hello)).unwrap();
    let claim = ControllerCmd::Claim {
        request: RequestId(1),
        name: "Ava".into(),
    }
    .encode();
    h.handle(&net("p1", Channel::Cmd, claim)).unwrap();
    h.handle(&net(
        "p1",
        Channel::Cmd,
        ControllerCmd::Ready { on: true }.encode(),
    ))
    .unwrap();
    let src = SourceHandle(1);
    let mut now = 0u64;
    let mut seq = 0u16;
    // (TV events, phone messages) of the idle cue.
    let mut cues = [0u32; 2];
    // Steps `ms` of host time sending `drive` every 50 ms (fresh, so never a dropout).
    let run = |h: &mut Host,
               ms: u64,
               drive: [i16; 2],
               now: &mut u64,
               seq: &mut u16,
               cues: &mut [u32; 2]| {
        let end = *now + ms * 1000;
        while *now < end {
            if (*now / 8_334).is_multiple_of(6) {
                *seq = seq.wrapping_add(1);
                h.handle(&net("p1", Channel::State, record(src, *seq, drive)))
                    .unwrap();
            }
            h.advance(*now);
            *now += 8_334;
            while let Some(m) = h.next_message() {
                match m {
                    SimToMain::Events { batch } => {
                        cues[0] += batch
                            .iter()
                            .filter(|e| matches!(e, SimEvent::IdleCue { .. }))
                            .count() as u32;
                    }
                    SimToMain::Outbound {
                        channel: Channel::Cmd,
                        bytes,
                        ..
                    } => {
                        if let Ok(HostCmd::IdleCue { autopilot_in_ms }) = HostCmd::decode(&bytes) {
                            assert_eq!(autopilot_in_ms, IDLE_CUE_MS as u32);
                            cues[1] += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
    };
    // A menu open on the grid (the newcomer's tutorial) and closed before GO hands nothing over.
    h.handle(&net(
        "p1",
        Channel::Cmd,
        ControllerCmd::Menu { open: true }.encode(),
    ))
    .unwrap();
    run(&mut h, 1_000, [0, 0], &mut now, &mut seq, &mut cues);
    h.handle(&net(
        "p1",
        Channel::Cmd,
        ControllerCmd::Menu { open: false }.encode(),
    ))
    .unwrap();
    run(&mut h, 3_000, [0, 0], &mut now, &mut seq, &mut cues);
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
    assert!(
        !h.sim.has_autopilot(CarId(0)),
        "a menu closed before GO hands nothing over"
    );
    let car = CarId(0);
    run(&mut h, 2_000, [0, 32_767], &mut now, &mut seq, &mut cues);
    assert!(!h.sim.has_autopilot(car), "driving: the player has the car");
    run(&mut h, 14_000, [0, 0], &mut now, &mut seq, &mut cues);
    assert_eq!(
        (cues, h.sim.has_autopilot(car)),
        ([0, 0], false),
        "under 15 s idle: nothing yet"
    );
    run(&mut h, 2_000, [0, 0], &mut now, &mut seq, &mut cues);
    assert_eq!(
        (cues, h.sim.has_autopilot(car)),
        ([1, 1], false),
        "15 s idle: the cue on the TV and the phone, not yet the autopilot"
    );
    run(&mut h, 3_000, [0, 0], &mut now, &mut seq, &mut cues);
    assert!(h.sim.has_autopilot(car), "18 s idle: the autopilot drives");
    run(&mut h, 500, [0, 32_767], &mut now, &mut seq, &mut cues);
    assert!(
        !h.sim.has_autopilot(car),
        "a deliberate input takes it back"
    );

    h.handle(&net(
        "p1",
        Channel::Cmd,
        ControllerCmd::Menu { open: true }.encode(),
    ))
    .unwrap();
    run(&mut h, 200, [0, 32_767], &mut now, &mut seq, &mut cues);
    assert!(
        h.sim.has_autopilot(car),
        "an open menu hands the car to the autopilot"
    );
    h.handle(&net(
        "p1",
        Channel::Cmd,
        ControllerCmd::Menu { open: false }.encode(),
    ))
    .unwrap();
    run(&mut h, 200, [0, 0], &mut now, &mut seq, &mut cues);
    assert!(
        h.sim.has_autopilot(car),
        "closing the menu alone doesn't take it back"
    );
    run(&mut h, 300, [0, 32_767], &mut now, &mut seq, &mut cues);
    assert!(
        !h.sim.has_autopilot(car),
        "the first deliberate input after closing does"
    );
}

/// P1-G02: churn at 32 synthetic controllers (a sample, not a limit). They join in the Lobby and race; mid-race 8 leave,
/// 4 sit out and 6 more drop in, each with a car on its next tick; the room never lists a seat that left (no phantoms)
/// and nobody is refused.
#[test]
fn thirty_two_controllers_churn_through_every_phase_with_no_phantom_seats() {
    let mut h = Host::new(&init()).unwrap();
    let room = |h: &Host| serde_json::from_str::<serde_json::Value>(&h.room_json()).unwrap();
    let names = |h: &Host| -> Vec<String> {
        room(h)["seats"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["name"].as_str().unwrap().to_string())
            .collect()
    };
    let join = |h: &mut Host, p: &str| {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId(p.into()),
            resume: Some(format!("s-{p}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: p.to_uppercase(),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
    };
    let cmd = |h: &mut Host, p: &str, c: ControllerCmd| {
        h.handle(&net(p, Channel::Cmd, c.encode())).unwrap()
    };
    let mut now = 0u64;
    let step = |h: &mut Host, ticks: u64, now: &mut u64| {
        for _ in 0..ticks {
            h.advance(*now);
            *now += 8_334;
            while h.next_message().is_some() {}
        }
    };
    let first: Vec<String> = (0..32).map(|k| format!("p{k}")).collect();
    for p in &first {
        join(&mut h, p);
    }
    step(&mut h, 12, &mut now);
    assert_eq!(names(&h).len(), 32, "32 in the Lobby, nobody refused");
    for p in &first {
        cmd(&mut h, p, ControllerCmd::Ready { on: true });
    }
    step(&mut h, 2, &mut now);
    assert_eq!(h.phase(), jj_session::director::Phase::Countdown);
    // A joiner in the Countdown takes the next grid slot.
    join(&mut h, "c0");
    step(&mut h, 2, &mut now);
    assert!(
        !room(&h)["seats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "C0")
            .unwrap()["car"]
            .is_null(),
        "a Countdown joiner is on the grid"
    );
    for _ in 0..(120 * 10) {
        step(&mut h, 1, &mut now);
        if h.phase() == jj_session::director::Phase::Running {
            break;
        }
    }
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
    assert_eq!(h.sim.cars().count(), 33, "the grid holds all 33");
    step(&mut h, 240, &mut now);

    // Mid-race churn: 8 leave, 4 sit out, 6 drop in.
    for p in &first[..8] {
        cmd(&mut h, p, ControllerCmd::Leave);
    }
    for p in &first[8..12] {
        cmd(&mut h, p, ControllerCmd::SitOut);
    }
    let late: Vec<String> = (0..6).map(|k| format!("q{k}")).collect();
    for p in &late {
        join(&mut h, p);
    }
    step(&mut h, 2, &mut now);
    let r = room(&h);
    let seats = r["seats"].as_array().unwrap();
    assert_eq!(
        seats.len(),
        33 - 8 + 6,
        "leavers are gone, newcomers are in: {}",
        seats.len()
    );
    for s in seats {
        let name = s["name"].as_str().unwrap();
        assert!(
            !first[..8].iter().any(|p| p.to_uppercase() == name),
            "{name} left: no phantom seat"
        );
        let sat_out = first[8..12].iter().any(|p| p.to_uppercase() == name);
        assert_eq!(
            s["presence"],
            if sat_out { "SittingOut" } else { "Active" },
            "{name}"
        );
        assert_eq!(
            s["car"].is_null(),
            sat_out,
            "{name}: a car unless sitting out (drop-in on the next tick)"
        );
    }
    step(&mut h, 120, &mut now);
    let late: Vec<SeatId> = h.round.late.clone();
    assert_eq!(late.len(), 6, "the six drop-ins race as late entrants");
    assert!(
        late.iter().all(|s| h.round.cohort.contains(s)),
        "and get standings rows"
    );
    // Intermission churn and kept standings are JN5's (12 controllers race to results through the real host page).
}

/// P1-G07: the host removes a player mid-race. That phone is told (HostCmd::Removed), the seat leaves at the next tick
/// boundary (gone from the room view, its standings row kept), the other seat races on, and the same phone joining
/// again is a new claim with a new number.
#[test]
fn the_host_removes_a_player_mid_race_and_a_rejoin_is_a_new_seat() {
    let mut h = Host::new(&init()).unwrap();
    let join = |h: &mut Host, p: &str, k: u32| {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId(p.into()),
            resume: Some(format!("s-{p}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(k),
            name: p.to_uppercase(),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
    };
    let mut now = 0u64;
    let mut removed_to = Vec::new();
    let step = |h: &mut Host, ticks: u64, now: &mut u64, removed_to: &mut Vec<String>| {
        for _ in 0..ticks {
            h.advance(*now);
            *now += 8_334;
            while let Some(m) = h.next_message() {
                if let SimToMain::Outbound {
                    endpoint,
                    channel: Channel::Cmd,
                    bytes,
                } = m
                    && let Ok(HostCmd::Removed) = HostCmd::decode(&bytes)
                {
                    removed_to.push(endpoint.0);
                }
            }
        }
    };
    join(&mut h, "pa", 1);
    join(&mut h, "pb", 2);
    for p in ["pa", "pb"] {
        h.handle(&net(
            p,
            Channel::Cmd,
            ControllerCmd::Ready { on: true }.encode(),
        ))
        .unwrap();
    }
    for _ in 0..(120 * 10) {
        step(&mut h, 1, &mut now, &mut removed_to);
        if h.phase() == jj_session::director::Phase::Running {
            break;
        }
    }
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
    let room = |h: &Host| serde_json::from_str::<serde_json::Value>(&h.room_json()).unwrap();
    let seat_b = room(&h)["seats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "PB")
        .unwrap()["seat"]
        .as_u64()
        .unwrap() as u32;
    // PB's car loses its bumper before the removal: the part is debris, a dynamic body of the world.
    let car_b = room(&h)["seats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "PB")
        .unwrap()["car"]
        .as_u64()
        .unwrap() as u32;
    // PB's seat is a silent one: the autopilot drives its car.
    h.sim.set_autopilot(CarId(car_b), true);
    step(&mut h, 60, &mut now, &mut removed_to);
    assert!(
        h.sim.applied_input(CarId(car_b)).unwrap().throttle > 0,
        "the autopilot is driving PB's car"
    );
    h.sim.set_part_health(CarId(car_b), 1, 0.0);
    step(&mut h, 10, &mut now, &mut removed_to);
    let b_debris = |h: &Host| -> Vec<usize> {
        (0..h.sim.prop_kinds().len())
            .filter(|&i| h.sim.debris_part(i).is_some_and(|(c, _)| c.0 == car_b))
            .collect()
    };
    let before = b_debris(&h);
    assert!(
        !before.is_empty(),
        "PB's bumper is debris before the removal"
    );
    h.handle(
        &MainToSim::Ui {
            command: CommandId(9),
            ui: UiCommand::RemoveSeat {
                seat: jj_types::SeatId(seat_b),
            },
        }
        .encode(),
    )
    .unwrap();
    step(&mut h, 3, &mut now, &mut removed_to);
    assert_eq!(
        removed_to,
        vec!["pb".to_string()],
        "only the removed phone is told"
    );
    let names: Vec<String> = room(&h)["seats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names, vec!["PA".to_string()], "PB is gone, PA races on");
    // The withdrawn car stops: the autopilot doesn't keep it racing; its controls hand back to neutral over the autopilot's
    // quarter-second blend (no jolt), so a second later nothing drives it.
    step(&mut h, 40, &mut now, &mut removed_to);
    assert_eq!(
        h.sim.applied_input(CarId(car_b)).unwrap().throttle,
        0,
        "a removed car stops driving"
    );
    // Debris stays: the removed car's parts are still there, still dynamic bodies, nothing deleted, merged or frozen.
    let after = b_debris(&h);
    assert_eq!(after, before, "the removed car's debris stays in the world");
    assert!(
        after.iter().all(|&i| h.sim.debris_dynamic(i) == Some(true)),
        "and stays dynamic"
    );
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
    // The same phone claims again: a new seat with a new number.
    let claim = ControllerCmd::Claim {
        request: RequestId(3),
        name: "PB".into(),
    }
    .encode();
    h.handle(&net("pb", Channel::Cmd, claim)).unwrap();
    step(&mut h, 3, &mut now, &mut removed_to);
    let back = room(&h)["seats"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"].as_str().unwrap().starts_with("PB"))
        .cloned()
        .expect("PB is back (its name may carry a duplicate suffix)");
    assert_ne!(
        back["seat"].as_u64().unwrap() as u32,
        seat_b,
        "a new seat, not the removed one"
    );
}

/// P1-R07c: pausing is how a host lets someone join mid-race. A phone's Hello and Claim made while the race is paused are
/// welcomed and seated on the host's clock with the sim frozen (no tick, no car, the race still Running and still
/// paused); its car arrives through the late-join placement on the first tick after Resume, with a standings row. A
/// Ready sent in the pause waits for the resumed tick (it moves the round director).
#[test]
fn a_claim_while_paused_is_welcomed_and_seated_and_places_at_resume() {
    let mut h = Host::new(&init()).unwrap();
    let send = |h: &mut Host, p: &str, cmd: ControllerCmd| {
        h.handle(&net(p, Channel::Cmd, cmd.encode())).unwrap()
    };
    let join = |h: &mut Host, p: &str, k: u32| {
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
        send(
            h,
            p,
            ControllerCmd::Claim {
                request: RequestId(k),
                name: p.to_uppercase(),
            },
        );
    };
    let mut now = 0u64;
    let mut welcomed = Vec::new();
    let step = |h: &mut Host, frames: u64, now: &mut u64, welcomed: &mut Vec<String>| {
        for _ in 0..frames {
            h.advance(*now);
            *now += 8_334;
            while let Some(m) = h.next_message() {
                if let SimToMain::Outbound {
                    endpoint,
                    channel: Channel::Cmd,
                    bytes,
                } = m
                    && let Ok(HostCmd::Welcome { .. }) = HostCmd::decode(&bytes)
                {
                    welcomed.push(endpoint.0);
                }
            }
        }
    };
    let pause = |h: &mut Host, on: bool| {
        h.handle(
            &MainToSim::Ui {
                command: CommandId(7),
                ui: UiCommand::Pause { on },
            }
            .encode(),
        )
        .unwrap();
    };
    join(&mut h, "pa", 1);
    join(&mut h, "pb", 2);
    for p in ["pa", "pb"] {
        send(&mut h, p, ControllerCmd::Ready { on: true });
    }
    for _ in 0..(120 * 10) {
        step(&mut h, 1, &mut now, &mut welcomed);
        if h.phase() == jj_session::director::Phase::Running {
            break;
        }
    }
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
    step(&mut h, 60, &mut now, &mut welcomed);
    let room = |h: &Host| serde_json::from_str::<serde_json::Value>(&h.room_json()).unwrap();
    let seat_of = |h: &Host, name: &str| {
        room(h)["seats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == name)
            .cloned()
    };

    // The host pauses; a third phone scans the QR and claims.
    pause(&mut h, true);
    step(&mut h, 2, &mut now, &mut welcomed);
    let frozen = h.tick();
    let hash = h.state_hash();
    join(&mut h, "pc", 3);
    send(&mut h, "pc", ControllerCmd::Ready { on: true });
    step(&mut h, 60, &mut now, &mut welcomed);
    assert!(
        welcomed.contains(&"pc".to_string()),
        "the joiner is welcomed during the pause: {welcomed:?}"
    );
    let pc = seat_of(&h, "PC").expect("the joiner has a seat during the pause");
    assert!(pc["car"].is_null(), "no car while the race is frozen: {pc}");
    assert_eq!(h.tick(), frozen, "no tick ran");
    assert_eq!(h.state_hash(), hash, "the race state is untouched");
    assert_eq!(h.pause_mask(), Pause::Manual as u32, "still paused");
    assert_eq!(h.phase(), jj_session::director::Phase::Running);

    // Resume: after the countdown the first tick places the joiner as a late entrant.
    pause(&mut h, false);
    for _ in 0..(120 * 10) {
        step(&mut h, 1, &mut now, &mut welcomed);
        if h.tick() > frozen + 2 {
            break;
        }
    }
    assert!(h.tick() > frozen, "the race resumed");
    let pc = seat_of(&h, "PC").unwrap();
    assert!(
        !pc["car"].is_null(),
        "the joiner has a car after Resume: {pc}"
    );
    assert!(
        h.round
            .late
            .iter()
            .any(|s| s.0 == pc["seat"].as_u64().unwrap() as u32),
        "placed by the late-join rules (a late entrant)"
    );
    assert_eq!(h.phase(), jj_session::director::Phase::Running);
}

#[test]
fn a_hidden_host_still_tells_the_phones_why_the_room_is_paused() {
    use jj_protocol::state::{HudUpdate, PauseReason};
    let mut h = driving_host();
    let phone = |c: ControllerCmd| net("phone", Channel::Cmd, c.encode());
    h.schedule(
        0,
        &phone(ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        }),
    )
    .unwrap();
    h.schedule(
        0,
        &phone(ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        }),
    )
    .unwrap();
    let mut now = 0;
    for _ in 0..240 {
        h.advance(now);
        now += 8_334;
    }
    while h.next_message().is_some() {}
    h.handle(
        &MainToSim::Lifecycle {
            visible: false,
            render_ok: true,
        }
        .encode(),
    )
    .unwrap();
    let frozen = h.tick();
    // One hidden second: no ticks, yet the phone hears HostHidden on its state channel, about ten times.
    let mut heard = 0;
    for _ in 0..100 {
        h.advance(now);
        now += 10 * MS;
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                channel: Channel::State,
                bytes,
                ..
            } = m
                && let Ok(u) = HudUpdate::decode(&bytes)
                && u.hud.pause == Some(PauseReason::HostHidden)
            {
                heard += 1;
            }
        }
    }
    assert_eq!(h.tick(), frozen, "no ticks while hidden");
    assert!(
        (8..=12).contains(&heard),
        "the pause reached the phone {heard} times in a second"
    );
}

#[test]
fn a_hello_for_another_protocol_is_answered_with_claim_rejected_build_and_no_seat() {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    let hello = |protocol: u16| {
        net(
            "old-phone",
            Channel::Cmd,
            ControllerCmd::Hello {
                protocol,
                build: BuildId("t".into()),
                endpoint: EndpointId("old-phone".into()),
                resume: None,
            }
            .encode(),
        )
    };
    h.handle(&hello(PROTOCOL_VERSION + 1)).unwrap();
    h.handle(&net(
        "old-phone",
        Channel::Cmd,
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        }
        .encode(),
    ))
    .unwrap();
    let mut rejected = 0;
    let mut welcomed = 0;
    let mut t = 0;
    for _ in 0..30 {
        h.advance(t);
        t += 16_667;
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound {
                channel: Channel::Cmd,
                bytes,
                ..
            } = m
            {
                match HostCmd::decode(&bytes) {
                    Ok(HostCmd::ClaimRejected {
                        reason: jj_protocol::cmd::ClaimRejection::Build,
                    }) => rejected += 1,
                    Ok(HostCmd::Welcome { .. }) => welcomed += 1,
                    _ => {}
                }
            }
        }
    }
    assert_eq!(
        (rejected, welcomed),
        (1, 0),
        "told to update, never welcomed"
    );
    // The same phone built for this protocol joins as normal.
    h.handle(&hello(PROTOCOL_VERSION)).unwrap();
    h.handle(&net(
        "old-phone",
        Channel::Cmd,
        ControllerCmd::Claim {
            request: RequestId(2),
            name: "Ava".into(),
        }
        .encode(),
    ))
    .unwrap();
    let mut now = t;
    let mut joined = false;
    for _ in 0..60 {
        h.advance(now);
        now += 16_667;
        while let Some(m) = h.next_message() {
            if let SimToMain::Outbound { bytes, .. } = m
                && let Ok(HostCmd::Welcome { .. }) = HostCmd::decode(&bytes)
            {
                joined = true;
            }
        }
    }
    assert!(joined, "a controller on the right protocol is welcomed");
}

#[test]
fn a_pick_reaches_the_room_view_and_a_bad_id_does_not() {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    let phone = |c: ControllerCmd| net("phone", Channel::Cmd, c.encode());
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        },
    ] {
        h.handle(&phone(c)).unwrap();
    }
    let mut now = 0;
    let mut step = |h: &mut Host, n: usize| {
        for _ in 0..n {
            h.advance(now);
            now += 16_667;
        }
    };
    step(&mut h, 60);
    let seat = |h: &Host| -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
        v["seats"][0].clone()
    };
    assert_eq!(
        seat(&h)["vehicle"],
        serde_json::Value::Null,
        "nothing picked yet"
    );
    // The picker opens on a car: the TV says "choosing", with the car being looked at.
    h.handle(&phone(ControllerCmd::Pick {
        vehicle: "test-car-41".into(),
        open: true,
    }))
    .unwrap();
    step(&mut h, 10);
    assert_eq!(
        (seat(&h)["vehicle"].clone(), seat(&h)["choosing"].clone()),
        ("test-car-41".into(), true.into())
    );
    // Done: the pick stands and the picker is closed.
    h.handle(&phone(ControllerCmd::Pick {
        vehicle: "cruz-missile".into(),
        open: false,
    }))
    .unwrap();
    step(&mut h, 10);
    assert_eq!(
        (seat(&h)["vehicle"].clone(), seat(&h)["choosing"].clone()),
        ("cruz-missile".into(), false.into())
    );
    // Ids that aren't plain slugs, empty or too long change nothing.
    for bad in ["", "Cruz Missile", "<b>", &"a".repeat(33)] {
        h.handle(&phone(ControllerCmd::Pick {
            vehicle: bad.to_owned(),
            open: true,
        }))
        .unwrap();
    }
    step(&mut h, 10);
    assert_eq!(
        (seat(&h)["vehicle"].clone(), seat(&h)["choosing"].clone()),
        ("cruz-missile".into(), false.into())
    );
}

/// P1-C08: a hub is ONE endpoint with a seat per source. Thirty sources claim over the one connection (no cap), each is
/// welcomed under its own source wrapper, and Identify, Ready and Leave act on that source's seat only.
#[test]
fn a_hub_endpoint_claims_and_holds_a_seat_per_source_over_one_connection() {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    let hub = |c: ControllerCmd| net("hub", Channel::Cmd, c.encode());
    let for_source = |source: u16, c: ControllerCmd| {
        hub(ControllerCmd::ForSource {
            source: SourceHandle(source),
            cmd: Box::new(c),
        })
    };
    h.handle(&hub(ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("hub".into()),
        resume: None,
    }))
    .unwrap();
    for src in 2..=31u16 {
        h.handle(&for_source(
            src,
            ControllerCmd::Claim {
                request: RequestId(1),
                name: format!("Pad {src}"),
            },
        ))
        .unwrap();
    }
    let mut now = 0;
    let mut welcomes: Vec<(u16, SeatId)> = Vec::new();
    let mut identified = Vec::new();
    let mut pump = |h: &mut Host,
                    n: usize,
                    welcomes: &mut Vec<(u16, SeatId)>,
                    identified: &mut Vec<SeatId>| {
        for _ in 0..n {
            h.advance(now);
            now += 16_667;
            while let Some(m) = h.next_message() {
                match m {
                    SimToMain::Outbound {
                        channel: Channel::Cmd,
                        bytes,
                        ..
                    } => {
                        if let Ok(HostCmd::ForSource { source, cmd }) = HostCmd::decode(&bytes)
                            && let HostCmd::Welcome {
                                seat, source: s, ..
                            } = *cmd
                        {
                            assert_eq!(
                                source, s,
                                "a source's welcome comes back under that source"
                            );
                            welcomes.push((source.0, seat));
                        }
                    }
                    SimToMain::Events { batch } => {
                        identified.extend(batch.into_iter().filter_map(|e| match e {
                            SimEvent::Identify { seat } => Some(seat),
                            _ => None,
                        }))
                    }
                    _ => {}
                }
            }
        }
    };
    pump(&mut h, 60, &mut welcomes, &mut identified);
    let seats: BTreeSet<SeatId> = welcomes.iter().map(|w| w.1).collect();
    assert_eq!(
        (welcomes.len(), seats.len()),
        (30, 30),
        "a seat per source, each welcomed once"
    );
    let view = |h: &Host| -> serde_json::Value { serde_json::from_str(&h.room_json()).unwrap() };
    assert_eq!(view(&h)["seats"].as_array().unwrap().len(), 30);
    let seat_of = |src: u16| welcomes.iter().find(|w| w.0 == src).unwrap().1;
    // Ready from one source readies that seat only.
    h.handle(&for_source(7, ControllerCmd::Ready { on: true }))
        .unwrap();
    pump(&mut h, 5, &mut Vec::new(), &mut identified);
    let ready: Vec<u64> = view(&h)["seats"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["ready"] == true)
        .map(|s| s["seat"].as_u64().unwrap())
        .collect();
    assert_eq!(ready, vec![u64::from(seat_of(7).0)]);
    // Identify (past the join flash's 3 s limit) flashes that source's seat only.
    pump(&mut h, 240, &mut Vec::new(), &mut Vec::new());
    h.handle(&for_source(12, ControllerCmd::Identify)).unwrap();
    let mut flashed = Vec::new();
    pump(&mut h, 5, &mut Vec::new(), &mut flashed);
    assert_eq!(
        flashed,
        vec![seat_of(12)],
        "Identify for that source's seat only"
    );
    // Leave from one source withdraws that seat; the other twenty-nine play on.
    h.handle(&for_source(20, ControllerCmd::Leave)).unwrap();
    pump(&mut h, 5, &mut Vec::new(), &mut Vec::new());
    let ids: Vec<u64> = view(&h)["seats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["seat"].as_u64().unwrap())
        .collect();
    assert_eq!(ids.len(), 29);
    assert!(!ids.contains(&u64::from(seat_of(20).0)));
    // The phone's own source (the unwrapped primary) is one more seat on the same endpoint.
    h.handle(&hub(ControllerCmd::Claim {
        request: RequestId(2),
        name: "Phone".into(),
    }))
    .unwrap();
    pump(&mut h, 5, &mut Vec::new(), &mut Vec::new());
    assert_eq!(view(&h)["seats"].as_array().unwrap().len(), 30);
    // A wrapper inside a wrapper is ignored.
    h.handle(&for_source(
        99,
        ControllerCmd::ForSource {
            source: SourceHandle(98),
            cmd: Box::new(ControllerCmd::Claim {
                request: RequestId(3),
                name: "Nested".into(),
            }),
        },
    ))
    .unwrap();
    pump(&mut h, 5, &mut Vec::new(), &mut Vec::new());
    assert_eq!(view(&h)["seats"].as_array().unwrap().len(), 30);
}

/// P1-C07: a player's own camera distance reaches the host as an event for that seat (and only that seat).
#[test]
fn a_camera_distance_choice_is_an_event_for_that_seat() {
    use jj_protocol::cmd::CameraDistance;
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    for who in ["a", "b"] {
        for c in [
            ControllerCmd::Hello {
                protocol: PROTOCOL_VERSION,
                build: BuildId("t".into()),
                endpoint: EndpointId(who.into()),
                resume: None,
            },
            ControllerCmd::Claim {
                request: RequestId(1),
                name: who.into(),
            },
        ] {
            h.handle(&net(who, Channel::Cmd, c.encode())).unwrap();
        }
    }
    let mut now = 0;
    let mut events = Vec::new();
    let mut pump = |h: &mut Host, n: usize, events: &mut Vec<SimEvent>| {
        for _ in 0..n {
            h.advance(now);
            now += 16_667;
            while let Some(m) = h.next_message() {
                if let SimToMain::Events { batch } = m {
                    events.extend(batch);
                }
            }
        }
    };
    pump(&mut h, 30, &mut Vec::new());
    h.handle(&net(
        "b",
        Channel::Cmd,
        ControllerCmd::SetCameraDistance {
            distance: CameraDistance::Near,
        }
        .encode(),
    ))
    .unwrap();
    pump(&mut h, 3, &mut events);
    let seat_b = h.seats.seats().find(|s| s.endpoint.0 == "b").unwrap().id;
    let got: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            SimEvent::CameraDistanceSet { seat, distance } => Some((*seat, *distance)),
            _ => None,
        })
        .collect();
    assert_eq!(got, vec![(seat_b, CameraDistance::Near)]);
    // Back to the host's own.
    h.handle(&net(
        "b",
        Channel::Cmd,
        ControllerCmd::SetCameraDistance {
            distance: CameraDistance::Host,
        }
        .encode(),
    ))
    .unwrap();
    events.clear();
    pump(&mut h, 3, &mut events);
    assert!(events.iter().any(|e| matches!(
        e,
        SimEvent::CameraDistanceSet {
            distance: CameraDistance::Host,
            ..
        }
    )));
}

/// R125 (br-2mxa): the phone's assist level reaches the seat's car in the sim and the room view (the L-plate), and
/// catch-up is on for everyone by default.
#[test]
fn the_seats_assist_level_reaches_its_car_and_the_room_view() {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    let phone = |c: ControllerCmd| net("phone", Channel::Cmd, c.encode());
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        },
    ] {
        h.handle(&phone(c)).unwrap();
    }
    let mut now = 0;
    let mut pump = |h: &mut Host, n: usize| {
        for _ in 0..n {
            h.advance(now);
            now += 16_667;
        }
    };
    let assist_in_view = |h: &Host| -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
        v["seats"][0]["assist"].clone()
    };
    pump(&mut h, 20);
    assert_eq!(assist_in_view(&h), 0, "a new seat has no help");
    assert_eq!(
        h.round.catch_up,
        jj_sim::assist::CatchUp::Light,
        "the lobby defaults to Light"
    );
    assert_eq!(
        h.sim.catch_up(),
        jj_sim::assist::CatchUp::Off,
        "free drive keeps its own rules"
    );
    for (level, want, sim_level) in [
        (
            jj_protocol::cmd::AssistLevel::Some,
            1,
            jj_sim::assist::AssistLevel::Some,
        ),
        (
            jj_protocol::cmd::AssistLevel::Lots,
            2,
            jj_sim::assist::AssistLevel::Lots,
        ),
        (
            jj_protocol::cmd::AssistLevel::Off,
            0,
            jj_sim::assist::AssistLevel::Off,
        ),
    ] {
        h.handle(&phone(ControllerCmd::SetAssist { level }))
            .unwrap();
        pump(&mut h, 5);
        assert_eq!(assist_in_view(&h), want);
        let car = h
            .inputs
            .values()
            .next()
            .and_then(|i| i.car)
            .expect("the seat has a car");
        assert_eq!(h.sim.assist_level(car), sim_level);
    }
}

/// Catch-up is a lobby choice applied at GO and retained for subsequent rounds, never a fixture override.
#[test]
fn catch_up_is_a_round_rule_and_the_host_can_switch_it_off() {
    for on in [false, true] {
        let mut h = Host::new(&init()).unwrap();
        let ui = |ui| {
            MainToSim::Ui {
                command: CommandId(1),
                ui,
            }
            .encode()
        };
        h.handle(&ui(UiCommand::SetCatchUp { on })).unwrap();
        h.handle(&local(1, [0, 32767])).unwrap();
        h.step_one();
        let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
        assert_eq!(room["catchUp"], on);
        assert_eq!(h.sim.catch_up(), jj_sim::assist::CatchUp::Off);
        h.handle(&ui(UiCommand::StartRound)).unwrap();
        h.step_one();
        h.handle(&ui(UiCommand::StartRound)).unwrap(); // the host's second press skips the force-start warning
        for _ in 0..120 * 10 {
            h.step_one();
            if h.phase() == jj_session::director::Phase::Running {
                break;
            }
        }
        assert_eq!(h.phase(), jj_session::director::Phase::Running);
        let expected = if on {
            jj_sim::assist::CatchUp::Light
        } else {
            jj_sim::assist::CatchUp::Off
        };
        assert_eq!(h.sim.catch_up(), expected);
        for _ in 0..120 {
            h.step_one();
        }
        assert_eq!(
            h.sim.catch_up(),
            expected,
            "ticks never overwrite the chosen rule"
        );
    }
}

/// P1-C06: the host tracks the seat's first-drive prompts from what it sees; skip hides them and never pauses anything.
#[test]
fn the_seats_prompts_follow_what_the_host_sees_and_skip_hides_them() {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    let phone = |c: ControllerCmd| net("phone", Channel::Cmd, c.encode());
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("phone".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        },
    ] {
        h.handle(&phone(c)).unwrap();
    }
    let mut now = 0;
    let mut seq = 0u16;
    let mut drive = |h: &mut Host, x: i16, n: usize| {
        for _ in 0..n {
            seq += 1;
            let b = StateBatch {
                minor: STATE_MINOR,
                batch_seq: seq,
                sent_at_ms: 0,
                records: vec![StateRecord {
                    source: SourceHandle(1),
                    seq,
                    drive: [0, 0],
                    action: [x, 0], // R116: the right stick steers
                    flags: StateFlags(StateFlags::AVAILABLE | StateFlags::ACTION_TOUCH),
                }],
            };
            h.handle(&net("phone", Channel::State, b.encode().unwrap()))
                .unwrap();
            h.advance(now);
            now += 16_667;
        }
    };
    let prompt = |h: &Host| -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
        v["seats"][0]["prompt"].clone()
    };
    drive(&mut h, 0, 20);
    assert_eq!(
        prompt(&h),
        serde_json::Value::Null,
        "nothing until the phone asks"
    );
    h.handle(&phone(ControllerCmd::Tutorial { on: true }))
        .unwrap();
    drive(&mut h, 32_767, 10);
    let p = prompt(&h);
    assert_eq!(
        (p["step"].clone(), p["of"].clone(), p["done"].clone()),
        (0.into(), 5.into(), serde_json::json!(["right"]))
    );
    drive(&mut h, -32_767, 10);
    assert_eq!(prompt(&h)["step"], 1, "both sides seen: the next control");
    // Skip hides it, and the room runs on.
    h.handle(&phone(ControllerCmd::Tutorial { on: false }))
        .unwrap();
    drive(&mut h, 0, 5);
    assert_eq!(prompt(&h), serde_json::Value::Null);
    let v: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_ne!(v["paused"], true, "prompts never pause the room");
    // Repeat from Help starts again at step 0.
    h.handle(&phone(ControllerCmd::Tutorial { on: true }))
        .unwrap();
    drive(&mut h, 0, 2);
    assert_eq!(prompt(&h)["step"], 0);
}

/// P1-G07: a controller can't remove anyone. The controller protocol has no `RemoveSeat`; the host's own command
/// (`UiCommand::RemoveSeat`) sent as controller bytes, on either channel, is refused and counted, and every message a
/// controller does have only ever touches its own seat.
#[test]
fn a_controller_cannot_remove_a_seat() {
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    for who in ["a", "b"] {
        for c in [
            ControllerCmd::Hello {
                protocol: PROTOCOL_VERSION,
                build: BuildId("t".into()),
                endpoint: EndpointId(who.into()),
                resume: None,
            },
            ControllerCmd::Claim {
                request: RequestId(1),
                name: who.into(),
            },
        ] {
            h.handle(&net(who, Channel::Cmd, c.encode())).unwrap();
        }
    }
    let mut now = 0;
    let mut step = |h: &mut Host, n: usize| {
        for _ in 0..n {
            h.advance(now);
            now += 16_667;
            while h.next_message().is_some() {}
        }
    };
    step(&mut h, 30);
    let room = |h: &Host| serde_json::from_str::<serde_json::Value>(&h.room_json()).unwrap();
    let seats = |h: &Host| room(h)["seats"].as_array().unwrap().len();
    let seat_a = h.seats.seats().find(|s| s.endpoint.0 == "a").unwrap().id;
    assert_eq!(seats(&h), 2);
    assert_eq!(room(&h)["rejectedFrames"], 0);
    // Controller "b" sends the host's RemoveSeat for seat "a", as bytes, on both channels.
    let remove = MainToSim::Ui {
        command: CommandId(1),
        ui: UiCommand::RemoveSeat { seat: seat_a },
    }
    .encode();
    h.handle(&net("b", Channel::Cmd, remove.clone())).unwrap();
    h.handle(&net("b", Channel::State, remove)).unwrap();
    // And every controller message there is, from b, including a source wrapper aimed at a source b doesn't have.
    for sample in [
        ControllerCmd::Identify,
        ControllerCmd::Ready { on: true },
        ControllerCmd::Recover,
        ControllerCmd::Menu { open: true },
        ControllerCmd::ForSource {
            source: SourceHandle(1),
            cmd: Box::new(ControllerCmd::Ready { on: false }),
        },
        ControllerCmd::ForSource {
            source: SourceHandle(2),
            cmd: Box::new(ControllerCmd::Leave),
        },
    ] {
        h.handle(&net("b", Channel::Cmd, sample.encode())).unwrap();
    }
    step(&mut h, 10);
    assert_eq!(seats(&h), 2, "nobody was removed");
    assert!(
        h.seats
            .seat(seat_a)
            .is_some_and(|s| s.presence == seats::Presence::Active),
        "seat a is untouched"
    );
    assert_eq!(
        room(&h)["rejectedFrames"],
        2,
        "both refused frames are counted"
    );
}

/// P1-C11: the phone's cooldown ring (input profile) and the sim's refusal (vehicle profile) are the same wait.
#[test]
fn the_input_and_vehicle_profiles_agree_on_the_launch() {
    let input = jj_input::InputProfile::standard();
    let vehicle = jj_sim::VehicleProfile::cruz();
    let t = &vehicle.tuning;
    assert_eq!(
        f64::from(input.launch.cooldown_ms),
        f64::from(t.wheelie_cooldown_s) * 1000.0,
        "one cooldown, two files"
    );
    assert!(input.launch.snap_window_ms <= 500, "a snap, not a roll-on");
}

/// P1-C11 (R116): a host pad's right stick steers (its x), its left stick drives (its y).
#[test]
fn a_host_pads_right_stick_steers_and_its_left_stick_drives() {
    let mut h = driving_host();
    for t in (0..600u64).step_by(6) {
        h.schedule(
            t,
            &MainToSim::LocalSource {
                source: LocalSourceId(7),
                axes: [0, 21_000, 26_000, 0],
                buttons: 0,
                seq: 0,
            }
            .encode(),
        )
        .unwrap();
    }
    while h.tick() < 300 {
        h.step_one();
    }
    let i = h.sim().applied_input(CarId(0)).expect("the pad has a car");
    assert!(i.throttle > 15_000, "the left stick drives: {i:?}");
    assert!(i.steer.abs() > 15_000, "the right stick steers: {i:?}");
}

/// The roster's `(id, profile JSON)` pairs, in roster order, read from the data files (R123: no vehicle is named in code).
fn roster_files() -> Vec<(String, String)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let roster: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("web/shared/src/roster.json")).unwrap(),
    )
    .unwrap();
    roster["cars"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let id = c["id"].as_str().unwrap().to_owned();
            let json =
                std::fs::read_to_string(root.join(format!("assets/profiles/{id}.json"))).unwrap();
            (id, json)
        })
        .collect()
}

/// br-bwju.7 (R123): two phones pick different roster vehicles; each car is built from its own profile, the snapshot
/// names each car's vehicle, and the tuning menu edits one vehicle's profile only.
#[test]
fn each_seat_drives_the_vehicle_it_picked_and_tuning_follows_the_selected_vehicle() {
    let roster = roster_files();
    assert!(roster.len() >= 2, "the roster has at least two vehicles");
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    h.handle(
        &MainToSim::Vehicles {
            vehicles: roster.clone(),
        }
        .encode(),
    )
    .unwrap();
    let mut now = 0;
    let mut step = |h: &mut Host, n: usize| {
        for _ in 0..n {
            h.advance(now);
            now += 16_667;
        }
    };
    for (k, who) in ["phone-a", "phone-b"].into_iter().enumerate() {
        let phone = |c: ControllerCmd| net(who, Channel::Cmd, c.encode());
        h.handle(&phone(ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId(who.into()),
            resume: None,
        }))
        .unwrap();
        h.handle(&phone(ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("P{k}"),
        }))
        .unwrap();
        step(&mut h, 30);
        h.handle(&phone(ControllerCmd::Pick {
            vehicle: roster[k].0.clone(),
            open: false,
        }))
        .unwrap();
        step(&mut h, 30);
    }
    let sim = h.sim();
    let cars: Vec<CarId> = sim.cars().collect();
    assert_eq!(cars.len(), 2);
    for (k, &c) in cars.iter().enumerate() {
        let want = jj_sim::VehicleProfile::from_json(&roster[k].1).unwrap();
        assert_eq!(sim.vehicle_of(c), Some(k));
        assert_eq!(sim.profile_of(c).unwrap().tuning.mass, want.tuning.mass);
        assert_eq!(
            sim.profile_of(c).unwrap().tuning.max_engine_force,
            want.tuning.max_engine_force
        );
    }
    // The snapshot carries each car's vehicle in the top half of its flags (record 64 B after the 40 B header).
    let mut buf = vec![0; h.snapshot_size()];
    assert_eq!(h.write_snapshot(&mut buf), buf.len());
    let flags = |k: usize| {
        let at = SNAPSHOT_HEADER + k * SNAPSHOT_CAR + 52;
        u32::from_le_bytes(buf[at..at + 4].try_into().unwrap())
    };
    assert_eq!((flags(0) >> 16, flags(1) >> 16), (0, 1));
    // The room names the table, so a renderer maps the index to a roster id.
    let tuning: serde_json::Value = serde_json::from_str(&h.tuning_json()).unwrap();
    assert_eq!(
        tuning["vehicles"],
        serde_json::json!(roster.iter().map(|r| &r.0).collect::<Vec<_>>())
    );
    // Tuning follows the selected vehicle: the second one's rows change only its cars.
    let before = h.sim().profile_at(0).unwrap().tuning.max_engine_force;
    h.handle(
        &MainToSim::Ui {
            command: CommandId(1),
            ui: UiCommand::TuneVehicle {
                vehicle: roster[1].0.clone(),
            },
        }
        .encode(),
    )
    .unwrap();
    h.handle(
        &MainToSim::Ui {
            command: CommandId(2),
            ui: UiCommand::SetTuning {
                field: "max_engine_force".into(),
                value: "12345".into(),
            },
        }
        .encode(),
    )
    .unwrap();
    step(&mut h, 5);
    assert_eq!(
        h.sim().profile_of(cars[1]).unwrap().tuning.max_engine_force,
        12345.0
    );
    assert_eq!(
        h.sim().profile_of(cars[0]).unwrap().tuning.max_engine_force,
        before
    );
    let shown: serde_json::Value = serde_json::from_str(&h.tuning_json()).unwrap();
    assert_eq!(
        (
            shown["vehicle"].as_str(),
            shown["tuning"]["max_engine_force"].as_f64()
        ),
        (Some(roster[1].0.as_str()), Some(12345.0))
    );
}

/// P1-C14: a host pad's seat names its source, and its first-drive prompts run from its own samples with no phone to ask.
#[test]
fn a_host_pads_seat_names_its_source_and_runs_its_prompts() {
    let mut h = driving_host();
    for t in (0..300u64).step_by(6) {
        h.schedule(
            t,
            &MainToSim::LocalSource {
                source: LocalSourceId(7),
                axes: [0, 0, 26_000, 0],
                buttons: 0,
                seq: 0,
            }
            .encode(),
        )
        .unwrap();
    }
    while h.tick() < 200 {
        h.step_one();
    }
    let v: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    let seat = &v["seats"][0];
    assert_eq!(seat["localSource"], 7);
    assert_eq!(seat["prompt"]["step"], 0, "the prompts start on their own");
    assert_eq!(seat["prompt"]["done"], serde_json::json!(["right"]));
}

#[test]
fn host_local_vehicle_choice_uses_each_sources_existing_seat() {
    let roster = roster_files();
    let mut h = Host::new(&init()).unwrap();
    h.set_free_drive(true);
    h.handle(
        &MainToSim::Vehicles {
            vehicles: roster.clone(),
        }
        .encode(),
    )
    .unwrap();
    let pick = |source, vehicle: String, open| {
        MainToSim::Ui {
            command: jj_types::CommandId(1),
            ui: UiCommand::LocalPick {
                source: LocalSourceId(source),
                vehicle,
                open,
            },
        }
        .encode()
    };
    h.handle(&pick(99, roster[1].0.clone(), true)).unwrap();
    for now in (0..10).map(|i| i * 16_667) {
        h.advance(now);
    }
    assert_eq!(
        h.seats.seats().count(),
        0,
        "choosing never claims an absent source"
    );
    h.handle(&local(1, [0, 1])).unwrap();
    h.handle(&local(2, [0, 1])).unwrap();
    for now in (10..30).map(|i| i * 16_667) {
        h.advance(now);
    }
    h.handle(&pick(1, roster[1].0.clone(), true)).unwrap();
    for now in (30..40).map(|i| i * 16_667) {
        h.advance(now);
    }
    let seat = h
        .seats
        .seat_at(h.locals[&LocalSourceId(1)], seats::PRIMARY_SOURCE)
        .unwrap();
    assert_eq!(h.picks.get(&seat), Some(&(roster[1].0.clone(), true)));
    h.handle(&pick(1, roster[1].0.clone(), false)).unwrap();
    for now in (40..50).map(|i| i * 16_667) {
        h.advance(now);
    }
    assert_eq!(h.picks.get(&seat), Some(&(roster[1].0.clone(), false)));
    let other = h
        .seats
        .seat_at(h.locals[&LocalSourceId(2)], seats::PRIMARY_SOURCE)
        .unwrap();
    assert_eq!(h.vehicle_of_seat(other), 0);
    assert_eq!(h.vehicle_of_seat(seat), 1);
    assert_eq!(h.sim().cars().count(), 2);
}

#[test]
fn lobby_ready_button_is_reliable_and_requires_a_confirmed_existing_source() {
    let mut h = Host::new(&init()).unwrap();
    h.handle(&local(1, [0, 1])).unwrap();
    h.handle(&local(2, [0, 1])).unwrap();
    for i in 0..20 {
        h.advance(i * 16_667);
    }
    let seat = h
        .seats
        .seat_at(h.locals[&LocalSourceId(1)], seats::PRIMARY_SOURCE)
        .unwrap();
    let command = |ui| {
        MainToSim::Ui {
            command: jj_types::CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&command(UiCommand::LocalPick {
        source: LocalSourceId(1),
        vehicle: "cruz-missile".into(),
        open: true,
    }))
    .unwrap();
    h.handle(&command(UiCommand::LocalReady {
        source: LocalSourceId(1),
    }))
    .unwrap();
    h.handle(&command(UiCommand::LocalReady {
        source: LocalSourceId(99),
    }))
    .unwrap();
    for i in 20..30 {
        h.advance(i * 16_667);
    }
    assert!(!h.round.director.is_ready(seat));
    assert_eq!(h.seats.seats().count(), 2);
    h.handle(&command(UiCommand::LocalPick {
        source: LocalSourceId(1),
        vehicle: "cruz-missile".into(),
        open: false,
    }))
    .unwrap();
    h.handle(&command(UiCommand::LocalReady {
        source: LocalSourceId(1),
    }))
    .unwrap();
    for i in 30..40 {
        h.advance(i * 16_667);
    }
    assert!(h.round.director.is_ready(seat));
    h.handle(&command(UiCommand::LocalReady {
        source: LocalSourceId(1),
    }))
    .unwrap();
    for i in 40..50 {
        h.advance(i * 16_667);
    }
    assert!(!h.round.director.is_ready(seat));
}

#[test]
fn controllers_menu_actions_apply_while_paused_and_survive_resume_sample_discard() {
    let mut h = driving_host();
    h.handle(&pad(4, [0, 20_000], 0)).unwrap();
    for i in 0..20 {
        h.advance(i * 16_667);
    }
    let old = h.seats.seat_of(h.locals[&LocalSourceId(4)]).unwrap();
    let command = |ui| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&command(UiCommand::Pause { on: true })).unwrap();
    let held_tick = h.tick();
    let presence = |h: &Host, seat| h.seats.seats().find(|s| s.id == seat).unwrap().presence;
    // A later neutral sample must never erase a menu action. No physics tick runs here.
    h.handle(&command(UiCommand::LocalSitOut {
        source: LocalSourceId(4),
        on: true,
    }))
    .unwrap();
    h.handle(&pad(4, [0, 0], 0)).unwrap();
    h.advance(400_000);
    assert_eq!(h.tick(), held_tick);
    h.handle(&command(UiCommand::Pause { on: false })).unwrap();
    for i in 24..260 {
        h.advance(i * 16_667);
    }
    assert_eq!(presence(&h, old), seats::Presence::SittingOut);
    h.handle(&command(UiCommand::Pause { on: true })).unwrap();
    h.handle(&command(UiCommand::LocalSitOut {
        source: LocalSourceId(4),
        on: false,
    }))
    .unwrap();
    h.advance(4_400_000);
    h.handle(&command(UiCommand::Pause { on: false })).unwrap();
    for i in 264..500 {
        h.advance(i * 16_667);
    }
    assert_eq!(presence(&h, old), seats::Presence::Active);
    h.handle(&command(UiCommand::Pause { on: true })).unwrap();
    let held_tick = h.tick();
    h.handle(&command(UiCommand::LocalLeave {
        source: LocalSourceId(4),
    }))
    .unwrap();
    h.handle(&pad(4, [0, 0], 0)).unwrap();
    h.advance(8_400_000);
    h.handle(&command(UiCommand::LocalJoin {
        source: LocalSourceId(4),
    }))
    .unwrap();
    h.handle(&command(UiCommand::LocalJoin {
        source: LocalSourceId(9),
    }))
    .unwrap();
    h.advance(8_500_000);
    let new = h.seats.seat_of(h.locals[&LocalSourceId(4)]).unwrap();
    assert_ne!(old, new, "Add after Leave is a new player");
    assert_eq!(h.seats.seats().count(), 3);
    assert_eq!(h.tick(), held_tick);
    h.handle(&command(UiCommand::Pause { on: false })).unwrap();
    for i in 510..750 {
        h.advance(i * 16_667);
    }
    assert_eq!(presence(&h, old), seats::Presence::Left);
    assert_eq!(presence(&h, new), seats::Presence::Active);
    assert!(h.inputs[&new].car.is_some());
    assert_eq!(
        h.inputs.values().filter(|i| i.car.is_some()).count(),
        2,
        "only the two new seats own active cars; withdrawn dynamic husks may remain"
    );
}

#[test]
fn a_thrown_boomerang_is_a_debris_record_of_its_own_kind_in_the_snapshot() {
    // P1-W02a: the renderer draws a boomerang in the air from the snapshot: kind 4, after the props.
    let mut h = Host::new(&init()).unwrap();
    let car = h.sim.spawn_car(jj_sim::route_spawn(
        &load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap(),
        16,
        0.0,
        0.6,
    ));
    h.sim.start_race(3);
    for _ in 0..240 {
        h.sim.step();
    }
    h.sim
        .pickup_item(car, jj_types::SeatId(1), jj_types::items::ItemId::Boomerang)
        .unwrap();
    assert!(matches!(
        h.utility_outcome(car, jj_sim::UtilityKind::Forward),
        jj_protocol::cmd::ActionOutcome::Applied { .. }
    ));
    h.sim.step();
    let mut buf = vec![0u8; h.snapshot_size()];
    assert!(h.write_snapshot(&mut buf) > 0);
    let cars = h.sim().cars().count();
    let debris = u32::from_le_bytes(buf[32..36].try_into().unwrap()) as usize;
    let kinds: Vec<u32> = (0..debris)
        .map(|i| {
            let at = SNAPSHOT_HEADER + SNAPSHOT_CAR * cars + SNAPSHOT_DEBRIS * i + 28;
            u32::from_le_bytes(buf[at..at + 4].try_into().unwrap())
        })
        .collect();
    assert!(
        kinds.contains(&jj_sim::items::boomerang::SNAPSHOT_KIND),
        "{kinds:?}"
    );
}

/// br-qw28 (R125): between rounds. Three phones race, the results hold, then they vote: two for Surprise me and one for
/// New track, so Surprise wins and the next preparation asks main to draw the style; the phones are told the vote and
/// the result. After it, the TV flies over the new track before the countdown (the director's clock waits) and a press
/// skips it. The next Intermission: nobody votes (a tie at zero), so it's a Rematch: the same seed again. The one after,
/// the host chooses New track over the phones' Rematch votes: the next seed.
#[test]
fn phones_vote_the_next_track_ties_are_a_rematch_the_host_overrides_and_a_flyover_precedes_the_countdown()
 {
    use jj_protocol::cmd::{HostCmd, NextTrack};
    use jj_session::director::Phase;
    let mut h = Host::new(&init()).unwrap();
    let ui = |ui: UiCommand| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&ui(UiCommand::PrepareMaps { on: true })).unwrap();
    let phones = ["p1", "p2", "p3"];
    for (k, p) in phones.iter().enumerate() {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId((*p).into()),
            resume: Some(format!("s{k}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("Ava{k}"),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
    }
    // Steps ticks, answering every PrepareRequested with a generated map for its seed; records the requests and what
    // phone p1 was told between rounds.
    #[derive(Default)]
    struct Log {
        requests: Vec<(jj_types::PreparationId, u64, bool)>,
        between: Vec<jj_protocol::cmd::Between>,
    }
    let mut now = 0u64;
    let mut log = Log::default();
    let step = |h: &mut Host, ticks: u32, now: &mut u64, log: &mut Log| {
        for _ in 0..ticks {
            h.advance(*now);
            *now += 8_334;
            let mut answer = Vec::new();
            while let Some(m) = h.next_message() {
                match m {
                    SimToMain::Events { batch } => {
                        for e in batch {
                            if let SimEvent::PrepareRequested {
                                preparation,
                                seed,
                                surprise,
                                ..
                            } = e
                            {
                                log.requests.push((preparation, seed, surprise));
                                answer.push((preparation, seed));
                            }
                        }
                    }
                    SimToMain::Outbound {
                        endpoint, bytes, ..
                    } if endpoint.0 == "p1" => {
                        if let Ok(HostCmd::Between(b)) = HostCmd::decode(&bytes) {
                            log.between.push(b);
                        }
                    }
                    _ => {}
                }
            }
            for (preparation, seed) in answer {
                let map = jj_procgen::prepare(seed, &[jj_map::Biome::OutbackDirt]).map;
                h.handle(
                    &MainToSim::MapReady {
                        preparation,
                        map_bytes: jj_map::canonical_bytes(&map),
                    }
                    .encode(),
                )
                .unwrap();
            }
        }
    };
    let room = |h: &Host| -> serde_json::Value { serde_json::from_str(&h.room_json()).unwrap() };
    let until = |h: &mut Host, now: &mut u64, log: &mut Log, phase: Phase, what: &str| {
        let mut guard = 0;
        while h.phase() != phase {
            step(h, 1, now, log);
            guard += 1;
            assert!(guard < 120 * 120, "{what}: stuck in {:?}", h.phase());
        }
    };
    let vote = |h: &mut Host, p: &str, choice: NextTrack| {
        h.handle(&net(
            p,
            Channel::Cmd,
            ControllerCmd::Vote { choice }.encode(),
        ))
        .unwrap();
    };
    h.handle(&ui(UiCommand::SetLaps { laps: 99 })).unwrap();
    h.handle(&ui(UiCommand::StartRound)).unwrap();
    until(&mut h, &mut now, &mut log, Phase::Running, "round 1 starts");
    let seed1 = log.requests.last().unwrap().1;

    // Round 1 ends: the results hold 10 s, a vote before then counts for nothing.
    assert!(h.sim.end_race_now());
    until(
        &mut h,
        &mut now,
        &mut log,
        Phase::Intermission,
        "round 1's results",
    );
    vote(&mut h, "p1", NextTrack::Rematch);
    step(&mut h, 1, &mut now, &mut log);
    assert_eq!(
        room(&h)["between"]["votes"]["rematch"],
        0,
        "the vote isn't open during the results"
    );
    step(&mut h, 10 * 120 + 12, &mut now, &mut log);
    let r = room(&h);
    assert_eq!(r["between"]["voteOpen"], true, "{}", r["between"]);
    assert!(
        log.between.iter().any(|b| b.vote_left_ms.is_some()),
        "the phones are told the vote is open"
    );
    vote(&mut h, "p1", NextTrack::Surprise);
    vote(&mut h, "p2", NextTrack::Surprise);
    vote(&mut h, "p3", NextTrack::NewTrack);
    step(&mut h, 1, &mut now, &mut log);
    let r = room(&h);
    assert_eq!(
        r["between"]["votes"],
        serde_json::json!({ "rematch": 0, "new": 1, "surprise": 2 })
    );
    assert_eq!(r["between"]["leading"], "surprise");
    let told = log.between.last().unwrap();
    assert_eq!(
        (told.votes, told.mine),
        ([0, 1, 2], Some(NextTrack::Surprise)),
        "p1 sees the tally and its own vote"
    );

    // The vote closes: Surprise me asks main to draw the style, then the flyover holds the countdown, and a press skips it.
    let mut guard = 0;
    while room(&h)["between"]["flyoverLeftMs"].is_null() {
        step(&mut h, 1, &mut now, &mut log);
        guard += 1;
        assert!(
            guard < 30 * 120,
            "the flyover starts: {}",
            room(&h)["between"]
        );
    }
    assert_eq!(room(&h)["between"]["decided"], "surprise");
    let (_, seed2, surprise) = *log.requests.last().unwrap();
    assert!(surprise, "Surprise me asks main for a drawn style");
    assert_ne!(seed2, seed1);
    assert!(
        log.between.last().unwrap().flyover_left_ms.is_some(),
        "the phones know the flyover is on"
    );
    step(&mut h, 3 * 120, &mut now, &mut log);
    assert!(
        matches!(h.phase(), Phase::Intermission | Phase::Preparing),
        "the countdown waits for the flyover: {:?}",
        h.phase()
    );
    h.handle(&net(
        "p2",
        Channel::Cmd,
        ControllerCmd::Ready { on: true }.encode(),
    ))
    .unwrap();
    step(&mut h, 1, &mut now, &mut log);
    assert!(
        room(&h)["between"]["flyoverLeftMs"].is_null(),
        "a press skips the flyover"
    );
    until(
        &mut h,
        &mut now,
        &mut log,
        Phase::Running,
        "round 2 starts after the flyover",
    );

    // Round 2 ends; nobody votes: a tie at none is a Rematch of round 2's own seed.
    assert!(h.sim.end_race_now());
    until(
        &mut h,
        &mut now,
        &mut log,
        Phase::Intermission,
        "round 2's results",
    );
    let before = log.requests.len();
    until(
        &mut h,
        &mut now,
        &mut log,
        Phase::Running,
        "round 3 starts (the flyover runs out on its own)",
    );
    assert_eq!(room(&h)["round"], 3);
    let rematch = log.requests[before..]
        .iter()
        .map(|r| r.1)
        .collect::<Vec<_>>();
    assert_eq!(
        rematch.last(),
        Some(&seed2),
        "no votes: a Rematch on the same seed: {rematch:?}"
    );

    // Round 3: the phones vote Rematch, the host chooses New track: the session seed plus the preparation id.
    assert!(h.sim.end_race_now());
    until(
        &mut h,
        &mut now,
        &mut log,
        Phase::Intermission,
        "round 3's results",
    );
    let first_prep = log.requests.last().unwrap().0;
    h.handle(&ui(UiCommand::SetNextTrack {
        choice: Some(NextTrack::NewTrack),
    }))
    .unwrap();
    step(&mut h, 10 * 120 + 12, &mut now, &mut log);
    vote(&mut h, "p1", NextTrack::Rematch);
    vote(&mut h, "p2", NextTrack::Rematch);
    until(&mut h, &mut now, &mut log, Phase::Running, "round 4 starts");
    let (prep, seed4, surprise) = *log.requests.last().unwrap();
    assert_eq!(
        prep, first_prep,
        "New track keeps the track prepared at the Intermission"
    );
    assert_eq!(seed4, 3 + u64::from(prep.0), "a new seed");
    assert!(!surprise);
}

/// br-m1xe: the host picks a kept track in the Lobby: the next preparation asks main for exactly its seed and recipe
/// (superseding one already made), and a Rematch of it later asks for the same seed and recipe again.
#[test]
fn a_kept_track_is_prepared_by_its_seed_and_recipe_and_a_rematch_keeps_its_recipe() {
    use jj_session::director::Phase;
    let mut h = Host::new(&init()).unwrap();
    let ui = |ui: UiCommand| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&ui(UiCommand::PrepareMaps { on: true })).unwrap();
    for (k, p) in ["p1", "p2"].iter().enumerate() {
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId((*p).into()),
            resume: Some(format!("s{k}")),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, hello)).unwrap();
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: format!("Ava{k}"),
        }
        .encode();
        h.handle(&net(p, Channel::Cmd, claim)).unwrap();
    }
    let mut now = 0u64;
    let mut asked: Vec<(u64, Option<String>)> = Vec::new();
    let step = |h: &mut Host, ticks: u32, now: &mut u64, asked: &mut Vec<(u64, Option<String>)>| {
        for _ in 0..ticks {
            h.advance(*now);
            *now += 8_334;
            let mut answer = Vec::new();
            while let Some(m) = h.next_message() {
                if let SimToMain::Events { batch } = m {
                    for e in batch {
                        if let SimEvent::PrepareRequested {
                            preparation,
                            seed,
                            recipe,
                            ..
                        } = e
                        {
                            asked.push((seed, recipe));
                            answer.push((preparation, seed));
                        }
                    }
                }
            }
            for (preparation, seed) in answer {
                let map = jj_procgen::prepare(seed, &[jj_map::Biome::OutbackDirt]).map;
                h.handle(
                    &MainToSim::MapReady {
                        preparation,
                        map_bytes: jj_map::canonical_bytes(&map),
                    }
                    .encode(),
                )
                .unwrap();
            }
        }
    };
    h.handle(&ui(UiCommand::SetLaps { laps: 99 })).unwrap();
    h.handle(&ui(UiCommand::SetFavourite {
        seed: Some(777_000),
        recipe: "rocks,town".into(),
    }))
    .unwrap();
    h.handle(&ui(UiCommand::StartRound)).unwrap();
    let mut guard = 0;
    while h.phase() != Phase::Running {
        step(&mut h, 1, &mut now, &mut asked);
        guard += 1;
        assert!(guard < 120 * 60, "the round starts");
    }
    assert_eq!(
        asked.last(),
        Some(&(777_000, Some("rocks,town".to_string()))),
        "the kept track: {asked:?}"
    );
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_eq!(room["preparation"]["current"], 777_000);
    assert_eq!(room["preparation"]["currentRecipe"], "rocks,town");
    // The race ends; nobody votes: a Rematch, which asks for the kept track's seed and recipe again.
    assert!(h.sim.end_race_now());
    let before = asked.len();
    guard = 0;
    while !(h.phase() == Phase::Running && asked.len() > before) {
        step(&mut h, 1, &mut now, &mut asked);
        guard += 1;
        assert!(guard < 120 * 120, "round 2 starts: {:?}", h.phase());
    }
    assert_eq!(
        asked.last(),
        Some(&(777_000, Some("rocks,town".to_string()))),
        "the Rematch keeps the recipe: {asked:?}"
    );
}

/// br-bbki.11: the Feel Lab's bots. With Bots 6, a derby round puts six autopiloted cars on the grid after the one seat,
/// in an arena sized for all seven, and they hunt: the bots score in the derby ledger.
#[test]
fn bots_join_a_derby_round_on_the_autopilot_and_score() {
    use jj_session::director::Phase;
    let mut h = Host::new(&init()).unwrap();
    let ui = |ui: UiCommand| {
        MainToSim::Ui {
            command: CommandId(1),
            ui,
        }
        .encode()
    };
    h.handle(&ui(UiCommand::SetMode { derby: true })).unwrap();
    h.handle(&ui(UiCommand::SetBots { n: 6 })).unwrap();
    let hello = ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId("t".into()),
        endpoint: EndpointId("p1".into()),
        resume: Some("s".into()),
    }
    .encode();
    h.handle(&net("p1", Channel::Cmd, hello)).unwrap();
    let claim = ControllerCmd::Claim {
        request: RequestId(1),
        name: "Ava".into(),
    }
    .encode();
    h.handle(&net("p1", Channel::Cmd, claim)).unwrap();
    h.handle(&ui(UiCommand::StartRound)).unwrap();
    let mut now = 0u64;
    let mut guard = 0;
    // P1-FL08: the bots wait for GO with the grid (the countdown's hold wins over the autopilot).
    let mut countdown_roll = 0.0f32;
    while h.phase() != Phase::Running {
        h.advance(now);
        now += 8_334;
        while h.next_message().is_some() {}
        if h.phase() == Phase::Countdown {
            for car in h.sim.cars().collect::<Vec<_>>() {
                let v = h.sim.car_state(car).unwrap().linvel;
                countdown_roll = countdown_roll.max(v[0].hypot(v[2]));
            }
        }
        guard += 1;
        assert!(guard < 120 * 60, "the derby starts");
    }
    assert!(
        countdown_roll < 0.5,
        "nobody rolls before GO: {countdown_roll} m/s"
    );
    assert_eq!(h.sim.cars().count(), 7, "one seat's car and six bots");
    let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
    assert_eq!(room["bots"], 6);
    for _ in 0..(30 * 120) {
        h.advance(now);
        now += 8_334;
        while h.next_message().is_some() {}
    }
    let rows = h.sim.derby().expect("a derby").rows();
    let scoring_bots = rows.iter().filter(|r| r.car >= 1 && r.units > 0).count();
    assert!(scoring_bots >= 3, "the bots hunt and score: {rows:?}");
}

/// br-ennm: a wrecked car's tile banner gets the respawn hold's time left and the wreck's cause from the room view, and
/// the fields clear when the hold ends.
#[test]
fn the_room_view_carries_a_wrecked_seats_hold_and_its_cause() {
    let mut h = driving_host();
    for c in [
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("p1".into()),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        },
    ] {
        h.handle(&net("p1", Channel::Cmd, c.encode())).unwrap();
    }
    let mut now = 0u64;
    let mut step = |h: &mut Host, n: usize| {
        for _ in 0..n {
            h.advance(now);
            now += 8_334;
            while h.next_message().is_some() {}
        }
    };
    step(&mut h, 240);
    let seat = |h: &Host| {
        let room: serde_json::Value = serde_json::from_str(&h.room_json()).unwrap();
        room["seats"][0].clone()
    };
    let car = seat(&h)["car"].as_u64().expect("the seat drives a car") as u32;
    assert!(seat(&h)["wreckMs"].is_null(), "no hold before the wreck");
    assert!(h.sim.wreck(CarId(car)), "the wreck is accepted");
    step(&mut h, 1);
    let s = seat(&h);
    assert_eq!(s["wreckWhy"], "flipped", "{s}");
    let ms = s["wreckMs"].as_u64().unwrap();
    assert!(ms > 0 && ms <= 1_000, "the hold's time left: {ms} ms");
    step(&mut h, 150);
    assert!(seat(&h)["wreckMs"].is_null(), "the hold is over");
}
