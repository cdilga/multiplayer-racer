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

#[test]
fn a_controllers_wheelie_applies_once_and_a_host_pads_gesture_is_detected_by_the_host() {
    // P1-S03c: a controller sends its validated release as `Action` (resent on the reliable channel, applied once);
    // a host pad's pull-release is detected by the host's own source machine.
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
    let mut h = Host::new(&init()).unwrap();
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
}

#[test]
fn a_host_pad_identifies_leaves_and_claims_its_seat_again() {
    let mut h = Host::new(&init()).unwrap();
    let ms = |t: u64| t * u64::from(TICK_HZ) / 1000;
    h.schedule(0, &pad(4, [0, 20_000], 0)).unwrap();
    h.schedule(ms(500), &pad(4, [0, 0], LOCAL_IDENTIFY))
        .unwrap();
    h.schedule(ms(600), &pad(4, [0, 0], 0)).unwrap();
    h.schedule(
        ms(1_000),
        &pad(4, [0, 0], LOCAL_IDENTIFY | LOCAL_READY | LOCAL_LEAVE),
    )
    .unwrap();
    // Still holding when the seat leaves: no re-claim until it lets go.
    h.schedule(
        ms(1_100),
        &pad(4, [0, 0], LOCAL_IDENTIFY | LOCAL_READY | LOCAL_LEAVE),
    )
    .unwrap();
    h.schedule(ms(1_500), &pad(4, [0, 0], 0)).unwrap();
    h.schedule(ms(2_000), &pad(4, [0, 25_000], 0)).unwrap();
    let presence = |h: &Host| h.seats.seats().next().map(|s| s.presence);
    while h.tick() < ms(1_400) {
        h.step_one();
    }
    assert_eq!(
        presence(&h),
        Some(jj_session::seats::Presence::Left),
        "Leave at a tick boundary"
    );
    assert!(
        h.inputs.values().all(|i| i.car.is_none()),
        "its car withdrawn"
    );
    while h.tick() < ms(2_200) {
        h.step_one();
    }
    assert_eq!(
        presence(&h),
        Some(jj_session::seats::Presence::Active),
        "a press claims it again"
    );
    assert_eq!(h.seats.seats().count(), 1, "the same seat, not a new one");
    assert!(h.inputs.values().any(|i| i.car.is_some()));
}
