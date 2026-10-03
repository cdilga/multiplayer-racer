//! P1-S02 native tests of the worker core. The browser tests (`web/host/tests/worker.test.mjs`) run the same core as
//! WASM in a real Web Worker.

use jj_map::{Registry, load_json};
use jj_protocol::PROTOCOL_VERSION;
use jj_protocol::abi::{ABI_VERSION, Channel, MainToSim, SimToMain, UiCommand};
use jj_protocol::cmd::{ControllerCmd, HostCmd};
use jj_protocol::state::{STATE_MINOR, StateBatch, StateFlags, StateRecord};
use jj_types::{BuildId, CommandId, EndpointId, LocalSourceId, RequestId, SourceHandle};

use super::*;

const GREYBOX: &str = include_str!("../../../../maps/greybox-loop.json");
const MS: u64 = 1000;

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
    let mut h = Host::new(&init()).unwrap();
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
    let mut h = Host::new(&init()).unwrap();
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
    let mut h = Host::new(&init()).unwrap();
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
    let mut h = Host::new(&init()).unwrap();
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
    let mut h = Host::new(&init()).unwrap();
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
    let mut h = Host::new(&init()).unwrap();
    h.fault();
    assert_eq!(h.pause_mask(), Pause::Fault as u32);
    assert_eq!(h.advance(1_000_000), 0);
    assert_eq!(h.advance(2_000_000), 0);
}

#[test]
fn snapshots_carry_cars_and_skip_when_the_buffer_is_short() {
    let mut h = Host::new(&init()).unwrap();
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
fn the_action_stick_reaches_the_sim_as_boost_then_drift() {
    // P1-S03b: a phone holding DRIVE up with ACTION right boosts (jj-input's held right sector, through the source
    // semantics into the sim's applied input); swinging ACTION left is the handbrake drift.
    let mut h = Host::new(&init()).unwrap();
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
        let action = if t < 120 { [32_767, 0] } else { [-32_767, 0] };
        let batch = StateBatch {
            minor: STATE_MINOR,
            batch_seq: k as u16 + 1,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(1),
                seq: k as u16 + 1,
                drive: [0, 32_767],
                action,
                flags: StateFlags(
                    StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH | StateFlags::ACTION_TOUCH,
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
    assert!(boosted, "ACTION right boosted");
    while h.tick() < 200 {
        h.step_one();
    }
    let a = h.sim().action_state(CarId(0)).unwrap();
    assert!(a.drift > 0.9 && !a.boosting, "ACTION left drifts: {a:?}");
    assert!(
        h.sim()
            .applied_input(CarId(0))
            .is_some_and(|i| i.drift && !i.boost)
    );
}
