//! Goldens, round trips, fuzzed decoders and batch splitting for every wire message.
//!
//! Goldens live in `goldens/<wire>/<message>.<bin|json>`. The test fails when any encoding changes or a golden is
//! missing; `JJ_BLESS=1 cargo test -p jj-protocol goldens` rewrites them, for a deliberate protocol bump only (and the
//! bump goes with a `PROTOCOL_VERSION`, `CMD_VERSION`, `STATE_MINOR` or `ABI_VERSION` change).

use std::collections::BTreeSet;
use std::path::Path;

use arbitrary::{Arbitrary, Unstructured};
use jj_types::*;
use proptest::prelude::*;

use crate::abi::*;
use crate::cmd::*;
use crate::signal::*;
use crate::state::*;
use crate::{DecodeError, PROTOCOL_VERSION};

// ---------------------------------------------------------------------------------------------------------------
// Samples: one per message variant, with realistic values.

fn colour(index: u16) -> SeatColour {
    SeatColour {
        index,
        rgb: [0xE5, 0x32, 0x2D],
    }
}

fn you() -> You {
    You {
        seat: SeatId(7),
        number: SeatNumber(108),
        colour: colour(0),
        name: "Dusty".into(),
        round: RoundId(3),
        life: LifeId(2),
        ready: true,
        camera: CameraMode::ThirdPerson,
        sitting_out: false,
    }
}

fn result_rows() -> Vec<ResultRow> {
    vec![
        ResultRow {
            number: SeatNumber(108),
            name: "Dusty".into(),
            place: 1,
            time_ms: Some(184_250),
            points: 30,
        },
        ResultRow {
            number: SeatNumber(7),
            name: "Pip".into(),
            place: 2,
            time_ms: None,
            points: 23,
        },
    ]
}

fn records() -> Vec<StateRecord> {
    vec![
        StateRecord {
            source: SourceHandle(1),
            seq: 65_535,
            drive: [0, 32_767],
            action: [-32_767, 0],
            flags: StateFlags(StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH),
        },
        StateRecord {
            source: SourceHandle(300),
            seq: 2,
            drive: [4_915, -16_384],
            action: [0, 0],
            flags: StateFlags(
                StateFlags::AVAILABLE | StateFlags::ACTION_TOUCH | StateFlags::WHEELIE_PRELOAD,
            ),
        },
    ]
}

fn state_samples() -> Vec<(&'static str, StateMessage)> {
    vec![
        (
            "batch",
            StateMessage::Batch(StateBatch {
                minor: STATE_MINOR,
                batch_seq: 513,
                sent_at_ms: 40_000,
                records: records(),
            }),
        ),
        (
            "batch-empty",
            StateMessage::Batch(StateBatch {
                minor: STATE_MINOR,
                batch_seq: 0,
                sent_at_ms: 0,
                records: vec![],
            }),
        ),
        (
            "hud-race",
            StateMessage::Hud(HudUpdate {
                minor: STATE_MINOR,
                hud: Hud {
                    position: Some(3),
                    lap: Some((2, 3)),
                    boost: 180,
                    connection: Some(Connection::Direct),
                    pause: None,
                    tick: Tick(7_200),
                },
            }),
        ),
        (
            "hud-paused",
            StateMessage::Hud(HudUpdate {
                minor: STATE_MINOR,
                hud: Hud {
                    position: None,
                    lap: None,
                    boost: 0,
                    connection: Some(Connection::Relay),
                    pause: Some(PauseReason::HostHidden),
                    tick: Tick(9),
                },
            }),
        ),
    ]
}

fn controller_samples() -> Vec<ControllerCmd> {
    vec![
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: "0.2.0+3d54f6f".into(),
            endpoint: "c-9f2a".into(),
            resume: None,
        },
        ControllerCmd::Claim {
            request: RequestId(1),
            name: "Dusty".into(),
        },
        ControllerCmd::Action {
            action: ActionId(42),
            source: SourceHandle(1),
            kind: ActionKind::Wheelie { preload_ms: 650 },
            round: RoundId(3),
            life: LifeId(2),
            at_source_seq: 65_534,
        },
        ControllerCmd::Identify,
        ControllerCmd::SetName {
            name: "Big Kev".into(),
        },
        ControllerCmd::SetCamera {
            camera: CameraMode::FirstPerson,
        },
        ControllerCmd::Ready { on: true },
        ControllerCmd::Recover,
        ControllerCmd::SitOut,
        ControllerCmd::Leave,
        ControllerCmd::Menu { open: true },
        ControllerCmd::Ping { t: 4_000_000_000 },
    ]
}

fn controller_variant(c: &ControllerCmd) -> &'static str {
    // Adding a variant breaks this match: name it here, add it to the list below and give it a sample above.
    match c {
        ControllerCmd::Hello { .. } => "hello",
        ControllerCmd::Claim { .. } => "claim",
        ControllerCmd::Action { .. } => "action",
        ControllerCmd::Identify => "identify",
        ControllerCmd::SetName { .. } => "set-name",
        ControllerCmd::SetCamera { .. } => "set-camera",
        ControllerCmd::Ready { .. } => "ready",
        ControllerCmd::Recover => "recover",
        ControllerCmd::SitOut => "sit-out",
        ControllerCmd::Leave => "leave",
        ControllerCmd::Menu { .. } => "menu",
        ControllerCmd::Ping { .. } => "ping",
    }
}
const CONTROLLER_VARIANTS: [&str; 12] = [
    "hello",
    "claim",
    "action",
    "identify",
    "set-name",
    "set-camera",
    "ready",
    "recover",
    "sit-out",
    "leave",
    "menu",
    "ping",
];

fn host_samples() -> Vec<HostCmd> {
    vec![
        HostCmd::Welcome {
            seat: SeatId(7),
            number: SeatNumber(108),
            colour: colour(11),
            source: SourceHandle(1),
        },
        HostCmd::ClaimRejected {
            reason: ClaimRejection::Build,
        },
        HostCmd::ActionResult {
            action: ActionId(42),
            outcome: ActionOutcome::Applied { tick: Tick(7_201) },
        },
        HostCmd::RoomState {
            phase: RoomPhase::Results,
            you: Some(you()),
            countdown_ms: None,
            results: Some(result_rows()),
        },
        HostCmd::Pong {
            t: 4_000_000_000,
            host_t: 12_345,
        },
        HostCmd::Ended,
        HostCmd::IdleCue {
            autopilot_in_ms: 3_000,
        },
        HostCmd::Removed,
    ]
}

fn host_variant(c: &HostCmd) -> &'static str {
    match c {
        HostCmd::Welcome { .. } => "welcome",
        HostCmd::ClaimRejected { .. } => "claim-rejected",
        HostCmd::ActionResult { .. } => "action-result",
        HostCmd::RoomState { .. } => "room-state",
        HostCmd::Pong { .. } => "pong",
        HostCmd::Ended => "ended",
        HostCmd::IdleCue { .. } => "idle-cue",
        HostCmd::Removed => "removed",
    }
}
const HOST_VARIANTS: [&str; 8] = [
    "welcome",
    "claim-rejected",
    "action-result",
    "room-state",
    "pong",
    "ended",
    "idle-cue",
    "removed",
];

/// Extra goldens for the outcome and rejection enums inside `ActionResult` and `ClaimRejected`.
fn host_detail_samples() -> Vec<(&'static str, HostCmd)> {
    vec![
        (
            "action-result-expired",
            HostCmd::ActionResult {
                action: ActionId(43),
                outcome: ActionOutcome::Expired,
            },
        ),
        (
            "action-result-rejected",
            HostCmd::ActionResult {
                action: ActionId(44),
                outcome: ActionOutcome::Rejected {
                    reason: ActionRejection::StaleLife,
                },
            },
        ),
        (
            "claim-rejected-ended",
            HostCmd::ClaimRejected {
                reason: ClaimRejection::Ended,
            },
        ),
        (
            "room-state-countdown",
            HostCmd::RoomState {
                phase: RoomPhase::Countdown,
                you: Some(you()),
                countdown_ms: Some(3_000),
                results: None,
            },
        ),
    ]
}

fn main_samples() -> Vec<MainToSim> {
    vec![
        MainToSim::Init {
            abi_version: ABI_VERSION,
            rules_hash: [0xAB; 32],
            map_bytes: b"jj.map.v1\0".to_vec(),
            vehicle_sidecars: vec![b"cruz".to_vec()],
            seed: 0xC0FF_EE00_1234,
        },
        MainToSim::NetBytes {
            endpoint: "c-9f2a".into(),
            channel: Channel::State,
            bytes: vec![0x10, 1, 0, 0, 0, 0, 0],
        },
        MainToSim::LocalSource {
            source: LocalSourceId(2),
            axes: [0, 32_767, -32_767, 100],
            buttons: 0b1010,
            seq: 9,
        },
        MainToSim::Ui {
            command: CommandId(5),
            ui: UiCommand::SetCamera {
                seat: SeatId(7),
                camera: CameraMode::FirstPerson,
            },
        },
        MainToSim::Lifecycle {
            visible: false,
            render_ok: true,
        },
        MainToSim::MapReady {
            preparation: PreparationId(4),
            map_bytes: b"jj.map.v1\0".to_vec(),
        },
        MainToSim::ReturnBuffer { buf: vec![0; 16] },
    ]
}

fn main_variant(m: &MainToSim) -> &'static str {
    match m {
        MainToSim::Init { .. } => "init",
        MainToSim::NetBytes { .. } => "net-bytes",
        MainToSim::LocalSource { .. } => "local-source",
        MainToSim::Ui { .. } => "ui",
        MainToSim::Lifecycle { .. } => "lifecycle",
        MainToSim::MapReady { .. } => "map-ready",
        MainToSim::ReturnBuffer { .. } => "return-buffer",
    }
}
const MAIN_VARIANTS: [&str; 7] = [
    "init",
    "net-bytes",
    "local-source",
    "ui",
    "lifecycle",
    "map-ready",
    "return-buffer",
];

fn ui_samples() -> Vec<UiCommand> {
    vec![
        UiCommand::StartRound,
        UiCommand::EndRound,
        UiCommand::DisbandRoom,
        UiCommand::Reroll,
        UiCommand::SetCamera {
            seat: SeatId(1),
            camera: CameraMode::ThirdPerson,
        },
        UiCommand::Pause { on: true },
        UiCommand::RemoveEndpoint {
            endpoint: "c-77".into(),
        },
    ]
}

fn sim_samples() -> Vec<SimToMain> {
    vec![
        SimToMain::Snapshot {
            buf: vec![1, 2, 3, 4],
            tick: Tick(7_200),
            sim_time_us: 120_000_000,
            session_rev: 3,
        },
        SimToMain::Events {
            batch: event_samples(),
        },
        SimToMain::Journal {
            bytes: vec![9, 8, 7],
        },
        SimToMain::Outbound {
            endpoint: "c-9f2a".into(),
            channel: Channel::Cmd,
            bytes: vec![1, 5],
        },
    ]
}

fn sim_variant(m: &SimToMain) -> &'static str {
    match m {
        SimToMain::Snapshot { .. } => "snapshot",
        SimToMain::Events { .. } => "events",
        SimToMain::Journal { .. } => "journal",
        SimToMain::Outbound { .. } => "outbound",
    }
}
const SIM_VARIANTS: [&str; 4] = ["snapshot", "events", "journal", "outbound"];

fn event_samples() -> Vec<SimEvent> {
    vec![
        SimEvent::SeatJoined {
            seat: SeatId(7),
            number: SeatNumber(108),
        },
        SimEvent::SeatLeft { seat: SeatId(3) },
        SimEvent::PartLoose {
            seat: SeatId(7),
            part: 3,
            cause: DamageCause::Car,
            instigator: Some(SeatId(2)),
        },
        SimEvent::PartDetached {
            seat: SeatId(7),
            part: 2,
            cause: DamageCause::Scenery,
            instigator: None,
        },
        SimEvent::Wrecked {
            seat: SeatId(7),
            cause: DamageCause::Debris,
            instigator: Some(SeatId(2)),
        },
        SimEvent::Episode {
            record: EpisodeRecord {
                seat: SeatId(7),
                part: 4,
                other: HitBody::Car {
                    seat: Some(SeatId(2)),
                },
                owner: Some(SeatId(2)),
                owner_tick: Some(Tick(7_194)),
                impulse_ns: 7_557,
                closing_mm_s: 11_590,
                tick: Tick(7_200),
            },
        },
        SimEvent::Episode {
            record: EpisodeRecord {
                seat: SeatId(3),
                part: 8,
                other: HitBody::Debris { index: 12 },
                owner: Some(SeatId(7)),
                owner_tick: Some(Tick(7_100)),
                impulse_ns: 980,
                closing_mm_s: 5_200,
                tick: Tick(7_206),
            },
        },
        SimEvent::Episode {
            record: EpisodeRecord {
                seat: SeatId(7),
                part: 1,
                other: HitBody::Scenery,
                owner: None,
                owner_tick: None,
                impulse_ns: 17_645,
                closing_mm_s: 14_500,
                tick: Tick(7_400),
            },
        },
        SimEvent::Lap {
            seat: SeatId(7),
            lap: 2,
        },
        SimEvent::Finished {
            seat: SeatId(7),
            place: 1,
            time_ms: 184_250,
        },
        SimEvent::Results {
            rows: result_rows(),
        },
        SimEvent::PrepareRequested {
            preparation: PreparationId(5),
            seed: 77,
        },
    ]
}

fn signal_samples() -> Vec<(&'static str, Vec<u8>)> {
    let ice = vec![
        IceServer {
            urls: vec!["stun:turn.dilger.dev:3479".into()],
            username: None,
            credential: None,
        },
        IceServer {
            urls: vec!["turn:turn.dilger.dev:3479?transport=udp".into()],
            username: Some("1791000000:c-9f2a".into()),
            credential: Some("dGVzdA".into()),
        },
    ];
    vec![
        ("version", to_json(&VersionInfo { build: "0.2.0+3d54f6f".into(), protocol: PROTOCOL_VERSION, realm: "preview".into() })),
        ("create-room", to_json(&CreateRoom { request_id: "r-1".into(), host_secret_hash: "aGFzaA".into() })),
        (
            "room-created",
            to_json(&RoomCreated {
                room_id: "rm-5d1c".into(),
                code: "KQ7X".into(),
                join_url: "https://jammers.dilger.dev/j/KQ7X".into(),
                host_endpoint_id: "host".into(),
                room_ticket: "dGlja2V0".into(),
                ice_servers: ice.clone(),
                ice_expires_at: 1_791_003_600_000,
            }),
        ),
        ("re-register-room", to_json(&ReRegisterRoom { room_id: "rm-5d1c".into(), host_secret_hash: "aGFzaA".into(), room_ticket: "dGlja2V0".into() })),
        ("room-re-registered", to_json(&RoomReRegistered { code: "KQ7X".into(), room_ticket: "dGlja2V0".into() })),
        ("room-lookup", to_json(&RoomLookup { status: RoomStatus::HostUnreachable, room_id: Some("rm-5d1c".into()), build: Some("0.2.0+3d54f6f".into()), realm: Some("preview".into()) })),
        ("room-lookup-not-found", to_json(&RoomLookup { status: RoomStatus::NotFound, room_id: None, build: None, realm: None })),
        ("register-endpoint", to_json(&RegisterEndpoint { request_id: "r-2".into(), endpoint_id: "c-9f2a".into(), endpoint_secret_hash: "ZXA".into() })),
        ("endpoint-registered", to_json(&EndpointRegistered { ice_servers: ice.clone(), ice_expires_at: 1_791_003_600_000 })),
        (
            "signal-offer",
            to_json(&SignalMessage { from: "c-9f2a".into(), to: "host".into(), kind: SignalKind::Offer, generation: 1, payload: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n".into() }),
        ),
        (
            "signal-candidate",
            to_json(&SignalMessage { from: "host".into(), to: "c-9f2a".into(), kind: SignalKind::Candidate, generation: 1, payload: r#"{"candidate":"candidate:1 1 udp 2122260223 192.168.11.20 54400 typ host","sdpMid":"0"}"#.into() }),
        ),
        ("ice-refresh", to_json(&IceRefresh { room_id: "rm-5d1c".into(), endpoint_id: "c-9f2a".into() })),
        ("ice-fallback", to_json(&IceFallback { room_id: "rm-5d1c".into(), endpoint_id: "c-9f2a".into(), reason: "no-route".into() })),
        ("ice-list", to_json(&IceList { ice_servers: ice, expires_at: 1_791_003_600_000 })),
        ("retry-after", to_json(&RetryAfter { retry_after_ms: 1_500 })),
        ("error-unknown-room", to_json(&ErrorBody { reason: ErrorBody::UNKNOWN_ROOM.into() })),
    ]
}

/// Every golden: `(path under goldens/, bytes)`.
fn goldens() -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    for (name, m) in state_samples() {
        out.push((format!("state/{name}.bin"), m.encode().unwrap()));
    }
    for c in controller_samples() {
        out.push((
            format!("cmd/controller-{}.bin", controller_variant(&c)),
            c.encode(),
        ));
    }
    for c in host_samples() {
        out.push((format!("cmd/host-{}.bin", host_variant(&c)), c.encode()));
    }
    for (name, c) in host_detail_samples() {
        out.push((format!("cmd/host-{name}.bin"), c.encode()));
    }
    for m in main_samples() {
        out.push((format!("abi/main-{}.bin", main_variant(&m)), m.encode()));
    }
    for (k, ui) in ui_samples().into_iter().enumerate() {
        out.push((
            format!("abi/main-ui-{k}.bin"),
            MainToSim::Ui {
                command: CommandId(k as u32),
                ui,
            }
            .encode(),
        ));
    }
    for m in sim_samples() {
        out.push((format!("abi/sim-{}.bin", sim_variant(&m)), m.encode()));
    }
    for (name, json) in signal_samples() {
        out.push((format!("signal/{name}.json"), json));
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------
// Goldens

#[test]
fn goldens_match_the_committed_bytes() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("goldens");
    let bless = std::env::var_os("JJ_BLESS").is_some();
    let mut problems = Vec::new();
    let mut seen = BTreeSet::new();
    for (name, bytes) in goldens() {
        assert!(
            seen.insert(name.clone()),
            "two samples share the golden name {name}"
        );
        let path = dir.join(&name);
        if bless {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &bytes).unwrap();
            continue;
        }
        match std::fs::read(&path) {
            Ok(golden) if golden == bytes => {}
            Ok(golden) => problems.push(format!(
                "{name}: encoding changed ({} bytes, golden {} bytes)",
                bytes.len(),
                golden.len()
            )),
            Err(_) => problems.push(format!("{name}: no golden (JJ_BLESS=1 writes it)")),
        }
    }
    // No orphans: every committed golden still has a sample.
    for wire in ["state", "cmd", "abi", "signal"] {
        for entry in std::fs::read_dir(dir.join(wire))
            .into_iter()
            .flatten()
            .flatten()
        {
            let name = format!("{wire}/{}", entry.file_name().to_string_lossy());
            if !seen.contains(&name) {
                problems.push(format!("{name}: golden without a sample"));
            }
        }
    }
    assert!(problems.is_empty(), "goldens:\n{}", problems.join("\n"));
}

#[test]
fn every_variant_has_a_golden() {
    let names = |v: Vec<&'static str>| v.into_iter().collect::<BTreeSet<_>>();
    assert_eq!(
        names(
            controller_samples()
                .iter()
                .map(controller_variant)
                .collect()
        ),
        CONTROLLER_VARIANTS.into_iter().collect()
    );
    assert_eq!(
        names(host_samples().iter().map(host_variant).collect()),
        HOST_VARIANTS.into_iter().collect()
    );
    assert_eq!(
        names(main_samples().iter().map(main_variant).collect()),
        MAIN_VARIANTS.into_iter().collect()
    );
    assert_eq!(
        names(sim_samples().iter().map(sim_variant).collect()),
        SIM_VARIANTS.into_iter().collect()
    );
    assert_eq!(ui_samples().len(), 7, "every UiCommand variant");
    assert_eq!(
        event_samples().len(),
        12,
        "every SimEvent variant, plus extra episode shapes"
    );
}

#[test]
fn the_documented_layout_holds() {
    let b = StateBatch {
        minor: STATE_MINOR,
        batch_seq: 0x0201,
        sent_at_ms: 0x0403,
        records: records(),
    };
    let bytes = b.encode().unwrap();
    assert_eq!(bytes.len(), 7 + 2 * 13, "7-byte header, 13-byte records");
    assert_eq!(
        &bytes[..7],
        &[0x10, STATE_MINOR, 0x01, 0x02, 0x03, 0x04, 2],
        "type, minor, batchSeq LE, sentAtMs LE, count"
    );
    assert_eq!(
        &bytes[7..9],
        &1u16.to_le_bytes(),
        "first record's sourceHandle"
    );
    assert_eq!(
        bytes[7 + 12],
        StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH,
        "flags are the record's last byte"
    );
    assert_eq!(BATCH_HEADER_LEN + RECORD_LEN, 20, "one source = 20 bytes");
    assert_eq!(
        ControllerCmd::Identify.encode()[0],
        CMD_VERSION,
        "commands lead with the version byte"
    );
}

#[test]
fn decoders_reject_wrong_versions_and_trailing_bytes() {
    let mut hello = controller_samples()[0].encode();
    hello[0] = 9;
    assert_eq!(
        ControllerCmd::decode(&hello),
        Err(DecodeError::Version {
            expected: 1,
            got: 9
        })
    );
    let mut ping = ControllerCmd::Ping { t: 1 }.encode();
    ping.push(0);
    assert!(matches!(
        ControllerCmd::decode(&ping),
        Err(DecodeError::Trailing { extra: 1 })
    ));
    let mut batch = StateBatch {
        minor: 1,
        batch_seq: 0,
        sent_at_ms: 0,
        records: records(),
    }
    .encode()
    .unwrap();
    batch.pop();
    assert!(matches!(
        StateBatch::decode(&batch),
        Err(DecodeError::Short { .. })
    ));
    assert!(matches!(
        StateMessage::decode(&[0x99]),
        Err(DecodeError::UnknownType(0x99))
    ));
}

// ---------------------------------------------------------------------------------------------------------------
// Round trips (every message type, generated) and fuzzed decoders (never panic)

fn arb<T: for<'a> Arbitrary<'a>>(raw: &[u8]) -> Option<T> {
    T::arbitrary(&mut Unstructured::new(raw)).ok()
}

fn sanitised_batch(mut b: StateBatch) -> StateBatch {
    b.records.truncate(MAX_RECORDS_PER_BATCH);
    b
}

macro_rules! json_round_trip {
    ($raw:expr, $($t:ty),+) => {$(
        if let Some(v) = arb::<$t>($raw) {
            let back: $t = from_json(&to_json(&v)).unwrap();
            prop_assert_eq!(back, v);
        }
    )+};
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 2_000, ..ProptestConfig::default() })]

    #[test]
    fn every_message_round_trips(raw in proptest::collection::vec(any::<u8>(), 0..4_096)) {
        if let Some(b) = arb::<StateBatch>(&raw).map(sanitised_batch) {
            prop_assert_eq!(StateBatch::decode(&b.encode().unwrap()).unwrap(), b);
        }
        if let Some(h) = arb::<HudUpdate>(&raw) {
            prop_assert_eq!(HudUpdate::decode(&h.encode()).unwrap(), h);
        }
        if let Some(c) = arb::<ControllerCmd>(&raw) {
            prop_assert_eq!(ControllerCmd::decode(&c.encode()).unwrap(), c);
        }
        if let Some(c) = arb::<HostCmd>(&raw) {
            prop_assert_eq!(HostCmd::decode(&c.encode()).unwrap(), c);
        }
        if let Some(m) = arb::<MainToSim>(&raw) {
            prop_assert_eq!(MainToSim::decode(&m.encode()).unwrap(), m);
        }
        if let Some(m) = arb::<SimToMain>(&raw) {
            prop_assert_eq!(SimToMain::decode(&m.encode()).unwrap(), m);
        }
        json_round_trip!(&raw, VersionInfo, CreateRoom, RoomCreated, ReRegisterRoom, RoomReRegistered, RoomLookup,
            RegisterEndpoint, EndpointRegistered, SignalMessage, IceRefresh, IceFallback, IceList, RetryAfter, ErrorBody);
    }

    #[test]
    fn decoders_never_panic_on_any_bytes(raw in proptest::collection::vec(any::<u8>(), 0..2_048)) {
        let _ = StateMessage::decode(&raw);
        let _ = StateBatch::decode(&raw);
        let _ = HudUpdate::decode(&raw);
        let _ = ControllerCmd::decode(&raw);
        let _ = HostCmd::decode(&raw);
        let _ = MainToSim::decode(&raw);
        let _ = SimToMain::decode(&raw);
        let _ = from_json::<RoomCreated>(&raw);
        let _ = from_json::<SignalMessage>(&raw);
        let _ = from_json::<RoomLookup>(&raw);
    }

    #[test]
    fn decoders_never_panic_on_damaged_goldens(pick in any::<prop::sample::Index>(), at in any::<prop::sample::Index>(), byte in any::<u8>(), cut in any::<bool>()) {
        let all = goldens();
        let (name, mut bytes) = all[pick.index(all.len())].clone();
        if !bytes.is_empty() {
            let i = at.index(bytes.len());
            if cut { bytes.truncate(i) } else { bytes[i] = byte }
        }
        match name.split('/').next() {
            Some("state") => { let _ = StateMessage::decode(&bytes); }
            Some("cmd") => { let _ = ControllerCmd::decode(&bytes); let _ = HostCmd::decode(&bytes); }
            Some("abi") => { let _ = MainToSim::decode(&bytes); let _ = SimToMain::decode(&bytes); }
            _ => { let _ = from_json::<RoomCreated>(&bytes); let _ = from_json::<SignalMessage>(&bytes); }
        }
    }

    #[test]
    fn every_record_survives_splitting(
        n in 0usize..2_000, target in 1usize..6_000, rotate in any::<usize>(), first in any::<u16>(),
    ) {
        let recs: Vec<StateRecord> = (0..n).map(|i| StateRecord { source: SourceHandle(i as u16), seq: i as u16, ..Default::default() }).collect();
        let batches = split_into_batches(&recs, SplitOptions { first_batch_seq: first, sent_at_ms: 7, target_bytes: target, rotate });
        let mut seen: Vec<u16> = Vec::with_capacity(n);
        for (k, b) in batches.iter().enumerate() {
            prop_assert!(!b.records.is_empty() && b.records.len() <= MAX_RECORDS_PER_BATCH);
            prop_assert!(b.encoded_len() <= target.max(BATCH_HEADER_LEN + RECORD_LEN), "over the byte target with more than one record");
            prop_assert_eq!(b.batch_seq, first.wrapping_add(k as u16));
            let decoded = StateBatch::decode(&b.encode().unwrap()).unwrap();
            prop_assert_eq!(&decoded, b);
            seen.extend(decoded.records.iter().map(|r| r.source.0));
        }
        let start = if n == 0 { 0 } else { rotate % n };
        let expected: Vec<u16> = (start..n).chain(0..start).map(|i| i as u16).collect();
        prop_assert_eq!(seen, expected, "every record once, in rotated order");
    }
}

#[test]
fn splitting_by_the_byte_target() {
    let recs: Vec<StateRecord> = (0..200)
        .map(|i| StateRecord {
            source: SourceHandle(i),
            ..Default::default()
        })
        .collect();
    let batches = split_into_batches(&recs, SplitOptions::default());
    let sizes: Vec<usize> = batches.iter().map(|b| b.records.len()).collect();
    assert_eq!(
        sizes,
        [76, 76, 48],
        "(1000 − 7) / 13 = 76 records per ~1,000-byte batch"
    );
    assert!(
        batches
            .iter()
            .all(|b| b.encode().unwrap().len() <= DEFAULT_BATCH_TARGET_BYTES)
    );
}

#[test]
fn splitting_more_than_255_sources() {
    let recs: Vec<StateRecord> = (0..600)
        .map(|i| StateRecord {
            source: SourceHandle(i),
            ..Default::default()
        })
        .collect();
    let batches = split_into_batches(
        &recs,
        SplitOptions {
            target_bytes: usize::MAX,
            ..SplitOptions::default()
        },
    );
    let sizes: Vec<usize> = batches.iter().map(|b| b.records.len()).collect();
    assert_eq!(
        sizes,
        [255, 255, 90],
        "the u8 count splits, nothing is truncated"
    );
    let all: Vec<u16> = batches
        .iter()
        .flat_map(|b| b.records.iter().map(|r| r.source.0))
        .collect();
    assert_eq!(all, (0..600).collect::<Vec<u16>>());
    let too_big = StateBatch {
        minor: 1,
        batch_seq: 0,
        sent_at_ms: 0,
        records: recs,
    };
    assert_eq!(
        too_big.encode(),
        Err(TooManyRecords(600)),
        "an unsplit batch refuses to encode rather than truncate"
    );
}
