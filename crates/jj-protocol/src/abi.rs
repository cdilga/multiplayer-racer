//! The host's main thread ↔ sim worker ABI (plan §4.4), implemented by `jj-wasm-host` and `web/host`.
//!
//! Control messages are postcard; snapshots are bulk binary in pooled transferable buffers (`buf`), so there are no
//! per-entity calls. If no pooled buffer is free the worker skips that publish: it never blocks physics or drops events.

use jj_types::{CommandId, EndpointId, LocalSourceId, PreparationId, SeatId, SeatNumber, Tick};
use serde::{Deserialize, Serialize};

use crate::DecodeError;
use crate::cmd::{CameraMode, ResultRow};

/// Carried in `Init`; a worker built for another ABI refuses to start. 2: damage events carry their cause and instigator,
/// `PartLoose` and the contact-episode records join (P1-S04a). 4: `SimEvent::Landed` joins (R129, P1-FL07); 5: it carries the car (every car's landing shows). 6: `SimEvent::Takedown` (R134, P1-FL19). 7: `MainToSim::PeerGone` (br-f3rz).
pub const ABI_VERSION: u16 = 11;

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
    /// G04's dev/test free drive: Lobby cars drive (the real Lobby has none, R110).
    FreeDrive {
        on: bool,
    },
    /// Laps per round from the next round (a round rule; journeys use 1).
    SetLaps {
        laps: u32,
    },
    /// Rounds are prepared by main (the procgen worker builds each round's map and main sends `MapReady`, P1-M08a);
    /// off, the host races the map it was started on.
    PrepareMaps {
        on: bool,
    },
    /// The host removes a seat (P1-G07): it leaves at the next tick boundary and the phone is told.
    RemoveSeat {
        seat: SeatId,
    },
    /// The owner tuning menu (br-2sdu.1): one vehicle-profile tuning field by name (`max_engine_force`,
    /// `surfaces.gravel`), the value as JSON. Applied at a tick boundary like every UI command, so it is journalled.
    SetTuning {
        field: String,
        value: String,
    },
    /// Which roster vehicle's profile the tuning menu edits (R123): `SetTuning` changes that vehicle's rows only, and the
    /// menu reads its tuning back. An unknown id is ignored.
    TuneVehicle {
        vehicle: String,
    },
    /// R125: lobby catch-up choice, applied from the next round's GO.
    SetCatchUp {
        on: bool,
    },
    /// Host keyboard/pad lobby choice, using the same seat Pick path as a phone.
    LocalPick {
        source: LocalSourceId,
        vehicle: String,
        open: bool,
    },
    /// A lobby button is a reliable command, independent of sampled input edges.
    LocalReady {
        source: LocalSourceId,
    },
    /// Controllers menu actions remain reliable while the simulation is paused.
    LocalJoin {
        source: LocalSourceId,
    },
    LocalLeave {
        source: LocalSourceId,
    },
    LocalSitOut {
        source: LocalSourceId,
        on: bool,
    },
    /// P1-G06: the next round's mode, Derby (in an arena sized for the cohort) or Race; applies from the next round.
    SetMode {
        derby: bool,
    },
    /// P1-G06: a derby round's game-time length, ms (3 minutes by default, §10.12); applies from the next round.
    SetDerbyLength {
        ms: u32,
    },
    /// P1-G06: the Intermission's length between rounds, ms (§10.8, ~60 s by default).
    SetIntermission {
        ms: u32,
    },
    /// br-qw28: the host's choice for the next track, overriding the vote (`None` goes back to the vote).
    SetNextTrack {
        choice: Option<crate::cmd::NextTrack>,
    },
    /// br-m1xe: the next round runs a kept track: its seed and recipe (main's biome list; empty is the seed's own mix).
    /// `seed: None` clears it.
    SetFavourite {
        seed: Option<u64>,
        recipe: String,
    },
    /// br-bbki.11 (the Feel Lab): this many bots on the autopilot join each round's grid after the seats (any number).
    SetBots {
        n: u32,
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
    /// The roster's vehicles (R123), in roster order: `(id, profile JSON)` each (`assets/profiles/<id>.json`, loaded by
    /// main from the roster data). A car's vehicle in the snapshot is its index here. Sent before the first round; the
    /// host's built-in first vehicle stands until then.
    Vehicles {
        vehicles: Vec<(String, String)>,
    },
    /// A controller's peer connection closed or failed (br-f3rz): its seats' sticks read neutral at once, instead of
    /// holding their last sample through the held-input window. A reconnect's Hello resumes them as before.
    PeerGone {
        endpoint: EndpointId,
    },
}

/// What hurt a part or wrecked a car.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum DamageCause {
    /// Another car.
    Car,
    /// A dynamic prop or debris body.
    Debris,
    /// Static scenery: barriers, buildings, the ground.
    Scenery,
    /// Left the bounds.
    OutOfBounds,
    /// Stuck upside down or on its side past the recovery timeout.
    Flipped,
    /// Stuck past the recovery timeout.
    Stuck,
}

/// What a contact episode hit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum HitBody {
    /// Another car, and the seat driving it if it has one.
    Car {
        seat: Option<SeatId>,
    },
    /// A prop or debris body, by its index in the snapshot's debris records.
    Debris {
        index: u32,
    },
    Scenery,
}

/// A finished contact episode (P1-S04a): `seat`'s car's part `part` took `impulse_ns` N·s of qualifying normal impulse
/// from `other` over a 50 ms window, the fastest contact closing at `closing_mm_s`. Damage is `k × impulse`, charged when
/// the window closes at `tick`. `owner` is the other body's causal owner (the seat whose car last put a qualifying
/// impulse into it, at `owner_tick`): itself for a car, the last car to hit it for debris.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct EpisodeRecord {
    pub seat: SeatId,
    pub part: u16,
    pub other: HitBody,
    pub owner: Option<SeatId>,
    pub owner_tick: Option<Tick>,
    pub impulse_ns: u32,
    pub closing_mm_s: u32,
    pub tick: Tick,
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
    /// A part's health fell to half or less, intact → loose (R86); `part` indexes the vehicle's parts in contract order
    /// (`core`, `front`, `back`, the four doors, the four wheels). `cause` is what it hit, `instigator` the seat whose
    /// car is that body's causal owner (the other car, or whoever last knocked the debris), if any.
    PartLoose {
        seat: SeatId,
        part: u16,
        cause: DamageCause,
        instigator: Option<SeatId>,
    },
    /// A part's health ran out, loose → detached (R86); same indices as [`SimEvent::PartLoose`].
    PartDetached {
        seat: SeatId,
        part: u16,
        cause: DamageCause,
        instigator: Option<SeatId>,
    },
    /// The seat's car was wrecked (it respawns after ~2 s).
    Wrecked {
        seat: SeatId,
        cause: DamageCause,
        instigator: Option<SeatId>,
    },
    /// One finished contact episode (a window of qualifying impacts on one part from one other body); the record S10 and
    /// W02 attribute from.
    Episode {
        record: EpisodeRecord,
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
        /// P1-G06: a derby round's arena for this many cars, instead of a course.
        arena_cars: Option<u32>,
        /// br-qw28: the vote chose Surprise me: main draws the track's style (its biome recipe) from the seed.
        surprise: bool,
        /// br-m1xe: the recipe to build with (a kept track, or a Rematch of a track that had one); `None`: main's own.
        recipe: Option<String>,
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
    /// The seat has been idle while racing (G03): the takeover cue shows; the autopilot drives in a few seconds unless
    /// the player steers.
    IdleCue {
        seat: SeatId,
    },
    /// The seat's player chose a camera for its tile (P1-R05; `SetCamera` from the controller). `car` is the seat's car
    /// index in the snapshot, which is what the host's tiles follow.
    CameraSet {
        seat: SeatId,
        car: u32,
        camera: CameraMode,
    },
    /// The seat's player chose their own camera distance (`SetCameraDistance`, C07); `Host` clears it. Keyed by seat:
    /// the host's tiles look up the seat's car themselves, so it holds before a car exists and across tile reflows.
    CameraDistanceSet {
        seat: SeatId,
        distance: crate::cmd::CameraDistance,
    },
    /// R127 gated start: how the seat's launch went; the TV pops it over the car.
    StartLaunch {
        seat: SeatId,
        outcome: crate::cmd::LaunchOutcome,
    },
    /// R129 (P1-FL07): how a car came down from a jump; the TV pops it over the car. `car` is its index in the
    /// snapshot (every car's landing shows, a bot's or a scenario's too); `seat` its player's, if it has one. `long`: a
    /// clean landing after a long flight (the higher boost tier).
    Landed {
        car: u32,
        seat: Option<SeatId>,
        tier: LandingTier,
        long: bool,
    },
    /// R134 (P1-FL19): car `attacker` wrecked (`wreck`) or spun car `victim`; its boost filled. The TV pops TAKEDOWN over
    /// the attacker (every car's, a bot's too); `seat` is the attacker's player, if it has one.
    Takedown {
        attacker: u32,
        victim: u32,
        seat: Option<SeatId>,
        wreck: bool,
    },
}

/// How a landing went (R129, R16): clean boosts, OK costs nothing, bad loses speed, a crash is righted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum LandingTier {
    Clean,
    Ok,
    Bad,
    Crash,
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
