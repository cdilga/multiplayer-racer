//! The host's sim worker in WASM (P1-S02): `jj-session` + `jj-input` + `jj-sim` behind the worker ABI
//! (`jj_protocol::abi`). [`host::Host`] is the native-testable core; [`HostSim`] is the wasm-bindgen face the worker
//! (`web/host/src/worker/sim.worker.ts`) calls.
//!
//! The `testing` feature adds the test surface (`host::testing`, P1-F05b) and the test hooks. Only the test chunk's
//! worker (`web/host/src/testing/`) loads that build; the shipped worker is built without it.

#![forbid(unsafe_code)]

pub mod host;

use wasm_bindgen::prelude::*;

/// The worker's handle on the sim. Every method takes or returns plain bytes or numbers.
#[wasm_bindgen]
pub struct HostSim(host::Host);

fn err(e: host::HostError) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
impl HostSim {
    /// Starts from an encoded `MainToSim::Init`.
    #[wasm_bindgen(constructor)]
    pub fn new(init: &[u8]) -> Result<HostSim, JsError> {
        host::Host::new(init).map(HostSim).map_err(err)
    }

    /// An encoded `MainToSim` message (applied at the next tick boundary; pauses act at once).
    pub fn handle(&mut self, msg: &[u8]) -> Result<(), JsError> {
        self.0.handle(msg).map_err(err)
    }

    /// Steps every whole tick due by `now_ms` (the worker's `performance.now()`); returns how many.
    pub fn advance(&mut self, now_ms: f64) -> u32 {
        self.0.advance((now_ms * 1000.0).round().max(0.0) as u64)
    }

    /// The next encoded `SimToMain` (events first, in order, then outbound controller bytes), if any.
    pub fn next_message(&mut self) -> Option<Vec<u8>> {
        self.0.next_message().map(|m| m.encode())
    }

    pub fn snapshot_size(&self) -> usize {
        self.0.snapshot_size()
    }

    /// Writes a snapshot into a pooled buffer; 0 if it doesn't fit (the worker grows the buffer and skips this one).
    pub fn write_snapshot(&self, buf: &mut [u8]) -> usize {
        self.0.write_snapshot(buf)
    }

    pub fn tick(&self) -> f64 {
        self.0.tick() as f64
    }

    pub fn pause_mask(&self) -> u32 {
        self.0.pause_mask()
    }

    pub fn countdown_ms(&self) -> u32 {
        (self.0.countdown_us() / 1000) as u32
    }

    /// The room for the host's screens (P1-G01/R07): phase, timer, round, laps, seats with Ready, results, standings.
    pub fn room_json(&self) -> String {
        self.0.room_json()
    }

    /// The full-state hash as hex.
    pub fn state_hash(&self) -> String {
        self.0
            .state_hash()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// The applied-tick journal so far (postcard), for bug clips (F07).
    pub fn journal(&self) -> Vec<u8> {
        self.0.sim().journal().to_bytes()
    }

    /// The worker caught a panic or an unrecoverable error: the `fault` pause reason.
    pub fn fault(&mut self) {
        self.0.fault();
    }
}

/// Test hooks (P1-S02, P1-F05b): only in the `testing` build, which only the test chunk's worker loads.
#[cfg(feature = "testing")]
#[wasm_bindgen]
impl HostSim {
    /// A test-surface command (JSON, see `host::testing`) → its answer (JSON).
    pub fn test(&mut self, command: &str) -> Result<String, JsError> {
        self.0
            .test_command(command)
            .map(|v| v.to_string())
            .map_err(|e| JsError::new(&e))
    }

    /// Applies an encoded `MainToSim` exactly at the boundary before `tick`.
    pub fn schedule(&mut self, tick: f64, msg: &[u8]) -> Result<(), JsError> {
        self.0.schedule(tick as u64, msg).map_err(err)
    }

    /// Stop stepping at `tick`.
    pub fn stop_at(&mut self, tick: f64) {
        self.0.stop_at(tick as u64);
    }

    /// The throttle car `car` drove with last tick (0..1; for tests of the neutral re-arm).
    pub fn applied_throttle(&self, car: u32) -> f32 {
        self.0
            .sim()
            .applied_input(jj_sim::CarId(car))
            .map_or(0.0, |i| jj_types::axis::dequantise_axis(i.throttle))
    }

    /// Panics, so the worker's fault path can be shown working.
    pub fn debug_panic(&self) {
        panic!("debug_panic: the worker's fault path under test");
    }
}

/// Typed encoders for the worker ABI, so the worker (and its test harness) never hand-roll postcard in JS.
pub mod codec {
    use jj_map::{Registry, load_json};
    use jj_protocol::abi::{ABI_VERSION, Channel, MainToSim, UiCommand};
    use jj_types::{CommandId, EndpointId, LocalSourceId};
    use wasm_bindgen::prelude::*;

    /// Validates a `jj.map.v1` JSON document and returns its canonical bytes (what `Init` carries).
    #[wasm_bindgen]
    pub fn canonical_map(json: &str) -> Result<Vec<u8>, JsError> {
        load_json(json.as_bytes(), &Registry::generic())
            .map(|m| m.canonical)
            .map_err(|r| {
                JsError::new(&format!(
                    "{:?}",
                    r.violations
                        .iter()
                        .map(|v| v.rule.name())
                        .collect::<Vec<_>>()
                ))
            })
    }

    #[wasm_bindgen]
    pub fn encode_init(map_bytes: &[u8], seed: f64) -> Vec<u8> {
        MainToSim::Init {
            abi_version: ABI_VERSION,
            rules_hash: [0; 32],
            map_bytes: map_bytes.to_vec(),
            vehicle_sidecars: vec![],
            seed: seed as u64,
        }
        .encode()
    }

    /// A prepared round map (canonical bytes) for preparation `preparation`: sent once the renderer has built it (P1-M08a).
    #[wasm_bindgen]
    pub fn encode_map_ready(preparation: u32, map_bytes: &[u8]) -> Vec<u8> {
        MainToSim::MapReady {
            preparation: jj_types::PreparationId(preparation),
            map_bytes: map_bytes.to_vec(),
        }
        .encode()
    }

    #[wasm_bindgen]
    pub fn encode_lifecycle(visible: bool, render_ok: bool) -> Vec<u8> {
        MainToSim::Lifecycle { visible, render_ok }.encode()
    }

    #[wasm_bindgen]
    pub fn encode_ui(command: u32, ui: &str, on: bool) -> Vec<u8> {
        // `laps:<n>` sets laps per round (G01); `free-drive` is G04's dev mode.
        let ui = match ui {
            "start" => UiCommand::StartRound,
            "end" => UiCommand::EndRound,
            "disband" => UiCommand::DisbandRoom,
            "free-drive" => UiCommand::FreeDrive { on },
            "prepare-maps" => UiCommand::PrepareMaps { on },
            "reroll" => UiCommand::Reroll,
            l if l.starts_with("laps:") => UiCommand::SetLaps {
                laps: l[5..].parse().unwrap_or(jj_sim::race::DEFAULT_LAPS),
            },
            _ => UiCommand::Pause { on },
        };
        MainToSim::Ui {
            command: CommandId(command),
            ui,
        }
        .encode()
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn encode_local_source(
        source: u32,
        dx: i16,
        dy: i16,
        ax: i16,
        ay: i16,
        buttons: u32,
        seq: u16,
    ) -> Vec<u8> {
        MainToSim::LocalSource {
            source: LocalSourceId(source),
            axes: [dx, dy, ax, ay],
            buttons,
            seq,
        }
        .encode()
    }

    /// Controller bytes as they'd arrive from the transport, on the state (`state = true`) or cmd channel.
    #[wasm_bindgen]
    pub fn encode_net_bytes(endpoint: &str, state: bool, bytes: &[u8]) -> Vec<u8> {
        let channel = if state { Channel::State } else { Channel::Cmd };
        MainToSim::NetBytes {
            endpoint: EndpointId(endpoint.into()),
            channel,
            bytes: bytes.to_vec(),
        }
        .encode()
    }
}

/// A `SimToMain::Outbound` split out for the transport: which controller endpoint, which channel, what bytes.
#[wasm_bindgen]
pub struct Outbound {
    endpoint: String,
    state: bool,
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl Outbound {
    #[wasm_bindgen(getter)]
    pub fn endpoint(&self) -> String {
        self.endpoint.clone()
    }

    /// True for the `state` channel, false for `cmd`.
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> bool {
        self.state
    }

    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

/// The outbound controller message in an encoded `SimToMain`, if it is one (the worker routes it to the transport).
#[wasm_bindgen]
pub fn outbound_of(message: &[u8]) -> Option<Outbound> {
    match jj_protocol::abi::SimToMain::decode(message) {
        Ok(jj_protocol::abi::SimToMain::Outbound {
            endpoint,
            channel,
            bytes,
        }) => Some(Outbound {
            endpoint: endpoint.0,
            state: channel == jj_protocol::abi::Channel::State,
            bytes,
        }),
        _ => None,
    }
}

/// A drained `SimToMain::Events` batch as JSON (serde's externally tagged form, e.g. `[{"CameraSet":{...}}]`), so main
/// can react to sim events (cameras, identify flashes, laps) without loading the codec; `None` for other messages.
#[wasm_bindgen]
pub fn events_json(message: &[u8]) -> Option<String> {
    match jj_protocol::abi::SimToMain::decode(message) {
        Ok(jj_protocol::abi::SimToMain::Events { batch }) => serde_json::to_string(&batch).ok(),
        _ => None,
    }
}

/// Test-side encoders and a message describer (`testing` build only): a real controller encodes its frames in
/// `jj-wasm-input`.
#[cfg(feature = "testing")]
pub mod test_codec {
    use jj_protocol::PROTOCOL_VERSION;
    use jj_protocol::cmd::ControllerCmd;
    use jj_protocol::state::{STATE_MINOR, StateBatch, StateFlags, StateRecord};
    use jj_types::{BuildId, EndpointId, RequestId, SourceHandle};
    use wasm_bindgen::prelude::*;

    /// A `SimToMain` as text for tests: one line per event (an `Events` batch's boundaries depend on the worker's
    /// cadence, its events don't), or one line for an outbound message.
    #[wasm_bindgen]
    pub fn describe_message(bytes: &[u8]) -> Vec<String> {
        use jj_protocol::abi::SimToMain;
        match SimToMain::decode(bytes) {
            Ok(SimToMain::Events { batch }) => {
                batch.iter().map(|e| format!("event {e:?}")).collect()
            }
            Ok(SimToMain::Outbound {
                endpoint,
                channel,
                bytes,
            }) => {
                let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                vec![format!("outbound {} {channel:?} {hex}", endpoint.0)]
            }
            Ok(other) => vec![format!("{other:?}")],
            Err(e) => vec![format!("undecodable {e:?}")],
        }
    }

    #[wasm_bindgen]
    pub fn controller_hello(endpoint: &str) -> Vec<u8> {
        ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("harness".into()),
            endpoint: EndpointId(endpoint.into()),
            resume: None,
        }
        .encode()
    }

    #[wasm_bindgen]
    pub fn controller_claim(name: &str) -> Vec<u8> {
        ControllerCmd::Claim {
            request: RequestId(1),
            name: name.into(),
        }
        .encode()
    }

    #[wasm_bindgen]
    pub fn controller_ready(on: bool) -> Vec<u8> {
        ControllerCmd::Ready { on }.encode()
    }

    #[wasm_bindgen]
    pub fn controller_identify() -> Vec<u8> {
        ControllerCmd::Identify.encode()
    }

    #[wasm_bindgen]
    pub fn controller_state(source: u16, seq: u16, dx: i16, dy: i16) -> Result<Vec<u8>, JsError> {
        StateBatch {
            minor: STATE_MINOR,
            batch_seq: seq,
            sent_at_ms: 0,
            records: vec![StateRecord {
                source: SourceHandle(source),
                seq,
                drive: [dx, dy],
                action: [0, 0],
                flags: StateFlags(StateFlags::AVAILABLE | StateFlags::DRIVE_TOUCH),
            }],
        }
        .encode()
        .map_err(|e| JsError::new(&format!("{e:?}")))
    }
}
