//! The host's main thread ↔ sim worker ABI (plan §4.4), implemented by `jj-wasm-host` and `web/host`.
//!
//! Control messages are postcard; snapshots are bulk binary in pooled transferable buffers (`buf`), so there are no
//! per-entity calls. If no pooled buffer is free the worker skips that publish: it never blocks physics or drops events.

use jj_types::{CommandId, EndpointId, LocalSourceId, PreparationId, SeatId, SeatNumber, Tick};
use serde::{Deserialize, Serialize};

use crate::DecodeError;
use crate::cmd::{CameraMode, ResultRow};

/// Carried in `Init`; a worker built for another ABI refuses to start.
pub const ABI_VERSION: u16 = 1;

/// Which data channel controller bytes came in on (or go out on).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum Channel {
    State,
    Cmd,
}

/// Host UI commands (the host's own controls, not a controller's).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum UiCommand {
    StartRound,
    EndRound,
    DisbandRoom,
    /// Draw the next track seed.
    Reroll,
    SetCamera {
        seat: SeatId,
        camera: CameraMode,
    },
    Pause {
        on: bool,
    },
    /// Drop a controller endpoint (the drawer's Remove).
    RemoveEndpoint {
        endpoint: EndpointId,
    },
}

/// Main → sim.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum MainToSim {
    /// `map_bytes` is canonical `jj.map.v1`; `rules_hash` is the SHA-256 of the rules data.
    Init {
        abi_version: u16,
        rules_hash: [u8; 32],
        map_bytes: Vec<u8>,
        vehicle_sidecars: Vec<Vec<u8>>,
        seed: u64,
    },
    /// Raw controller bytes, forwarded as they arrive (no batching on main).
    NetBytes {
        endpoint: EndpointId,
        channel: Channel,
        bytes: Vec<u8>,
    },
    /// Host pads and keys, already sampled (axes quantised like the wire's).
    LocalSource {
        source: LocalSourceId,
        axes: [i16; 4],
        buttons: u32,
        seq: u16,
    },
    Ui {
        command: CommandId,
        ui: UiCommand,
    },
    /// Composes pause reasons.
    Lifecycle {
        visible: bool,
        render_ok: bool,
    },
    /// A prepared round map, sent only after the renderer built and uploaded it; a stale preparation is ignored.
    MapReady {
        preparation: PreparationId,
        map_bytes: Vec<u8>,
    },
    /// A pooled snapshot buffer back to the worker.
    ReturnBuffer {
        buf: Vec<u8>,
    },
}

/// Ordered sim events (one batch per publish).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum SimEvent {
    SeatJoined {
        seat: SeatId,
        number: SeatNumber,
    },
    SeatLeft {
        seat: SeatId,
    },
    /// A part went intact → loose → detached (R86); `part` indexes the vehicle's damage parts.
    PartDetached {
        seat: SeatId,
        part: u16,
    },
    Wrecked {
        seat: SeatId,
    },
    Lap {
        seat: SeatId,
        lap: u16,
    },
    Finished {
        seat: SeatId,
        place: u32,
        time_ms: u32,
    },
    Results {
        rows: Vec<ResultRow>,
    },
    /// Main hands `seed` to the procgen worker, the renderer builds the map, then main sends `MapReady`.
    PrepareRequested {
        preparation: PreparationId,
        seed: u64,
    },
    /// Flash this seat's car ("Cooee #N"): its player pressed Identify, or it just joined or respawned (rate-limited
    /// by the seat reducer).
    Identify {
        seat: SeatId,
    },
    /// The seat's ACTION up fired the "OI!" flash (P1-S08): headlights flash and "OI!" pops over the car.
    Oi {
        seat: SeatId,
    },
    /// The seat's ACTION down dropped a cone (P1-S08); `debris` indexes the snapshot's debris records.
    ConeDropped {
        seat: SeatId,
        debris: u32,
    },
}

/// Sim → main.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum SimToMain {
    /// Car transforms, wheel poses, part states/angles, debris transforms and HUD facts, in a pooled buffer.
    Snapshot {
        buf: Vec<u8>,
        tick: Tick,
        sim_time_us: u64,
        session_rev: u32,
    },
    Events {
        batch: Vec<SimEvent>,
    },
    /// Applied-tick input journal chunks, kept on main for bug clips.
    Journal {
        bytes: Vec<u8>,
    },
    /// Welcome, ActionResult, HUD and room state for controllers.
    Outbound {
        endpoint: EndpointId,
        channel: Channel,
        bytes: Vec<u8>,
    },
}

macro_rules! codec {
    ($t:ty) => {
        impl $t {
            pub fn encode(&self) -> Vec<u8> {
                crate::postcard_with_prefix(&[], self)
            }

            pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
                crate::postcard_exact(bytes)
            }
        }
    };
}
codec!(MainToSim);
codec!(SimToMain);
