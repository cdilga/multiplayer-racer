//! The `cmd` channel (ordered, reliable, plan §5.4): `u8 version` + a postcard-encoded enum.
//!
//! Discrete actions (wheelie release, forward/rear utility) are detected on the controller and sent as [`ControllerCmd::Action`]
//! with a stable `actionId`; the host deduplicates, applies at a tick or answers `Expired`/`Rejected`, never runs an
//! expired action late and never infers an edge from the lossy state stream (master §4.1).

use jj_types::{
    ActionId, BuildId, EndpointId, LifeId, RequestId, RoundId, SeatColour, SeatId, SeatNumber,
    SourceHandle, Tick,
};
use serde::{Deserialize, Serialize};

use crate::DecodeError;

/// The version byte in front of every command.
pub const CMD_VERSION: u8 = 1;

/// First- or third-person camera for the seat's tile.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum CameraMode {
    ThirdPerson,
    FirstPerson,
}

/// How far back a player wants their own tile's chase camera (R98): the host's own choice, or Near / Far.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum CameraDistance {
    /// Whatever the host picks for the number of players on screen.
    Host,
    Near,
    Far,
}

/// A discrete action, detected on the controller.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ActionKind {
    /// Wheelie release with its validated preload, so a later neutral sample can't erase it.
    Wheelie {
        preload_ms: u16,
    },
    UtilityForward,
    UtilityRear,
}

/// Controller → host.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ControllerCmd {
    /// First message on a connection. `resume` carries the endpoint secret when reconnecting to a seat.
    Hello {
        protocol: u16,
        build: BuildId,
        endpoint: EndpointId,
        resume: Option<String>,
    },
    /// Ask for a seat (idempotent on `request`).
    Claim {
        request: RequestId,
        name: String,
    },
    Action {
        action: ActionId,
        source: SourceHandle,
        kind: ActionKind,
        round: RoundId,
        life: LifeId,
        at_source_seq: u16,
    },
    /// Flash my car on the TV.
    Identify,
    SetName {
        name: String,
    },
    SetCamera {
        camera: CameraMode,
    },
    Ready {
        on: bool,
    },
    Recover,
    SitOut,
    Leave,
    Menu {
        open: bool,
    },
    /// Wrapping ms on the controller's monotonic clock.
    Ping {
        t: u32,
    },
    /// The car the player has picked in the lobby: an id from the roster (`[a-z0-9-]`, at most 32 bytes) and whether the
    /// picker is still open (the TV shows "Choosing car…" while it is, then the car). Any roster size.
    Pick {
        vehicle: String,
        open: bool,
    },
    /// The player's own camera distance for their tile (Settings, C07); `Host` goes back to the host's default.
    SetCameraDistance {
        distance: CameraDistance,
    },
    /// The player's first-drive prompts (C06) are wanted (`on: true`, when the phone's tutorial opens or repeats from Help)
    /// or over (`on: false`: skipped, finished, or skipped before on this device). The host tracks the seven controls
    /// itself and shows the next one on the seat's tile while it is on; it never pauses or blocks anything.
    Tutorial {
        on: bool,
    },
    /// `cmd` is for one source of this endpoint (a hub: pads, key clusters and the phone's own sticks over ONE connection).
    /// A `Claim` inside it claims that source's seat (keyed by `source` within the endpoint; the source's own `Welcome`
    /// comes back wrapped the same way), and `Identify`, `Ready`, `Leave`, `SitOut`, `SetName`, `Menu`, `Pick`,
    /// `SetCamera` and `Recover` act on that source's seat. A command without the wrapper is the endpoint's primary
    /// source (`SourceHandle(1)`, a phone's own sticks). Wrappers don't nest (the inner one is ignored) and there is no
    /// source cap.
    ForSource {
        source: SourceHandle,
        cmd: Box<ControllerCmd>,
    },
}

/// Why a claim was refused. There is no "room full": seats aren't capped (R36).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ClaimRejection {
    /// The controller's `protocol` differs from the host's: it reloads once.
    Build,
    /// The room has ended.
    Ended,
    /// The name failed validation (empty, too long, or not allowed).
    Name,
}

/// Why an action was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ActionRejection {
    /// `round` isn't the seat's current round.
    StaleRound,
    /// `life` isn't the seat's current life (the car respawned).
    StaleLife,
    /// The source isn't this connection's, or has no seat.
    NotYourSource,
    /// The action isn't available now (no utility held, wheelie not allowed in this phase…).
    NotAvailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum ActionOutcome {
    Applied { tick: Tick },
    Expired,
    Rejected { reason: ActionRejection },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum RoomPhase {
    Lobby,
    Countdown,
    Racing,
    Results,
}

/// The receiving seat's own state.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct You {
    pub seat: SeatId,
    pub number: SeatNumber,
    pub colour: SeatColour,
    pub name: String,
    /// `Action`s echo these two.
    pub round: RoundId,
    pub life: LifeId,
    pub ready: bool,
    pub camera: CameraMode,
    pub sitting_out: bool,
}

/// One line of a round's results.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub struct ResultRow {
    pub number: SeatNumber,
    pub name: String,
    /// 1-based finishing place.
    pub place: u32,
    /// Race time; `None` for a car that didn't finish.
    pub time_ms: Option<u32>,
    pub points: u32,
}

/// Host → controller.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
pub enum HostCmd {
    Welcome {
        seat: SeatId,
        number: SeatNumber,
        colour: SeatColour,
        source: SourceHandle,
    },
    ClaimRejected {
        reason: ClaimRejection,
    },
    ActionResult {
        action: ActionId,
        outcome: ActionOutcome,
    },
    RoomState {
        phase: RoomPhase,
        you: Option<You>,
        countdown_ms: Option<u32>,
        results: Option<Vec<ResultRow>>,
    },
    /// Echoes the Ping's `t` with the host's clock when it answered (wrapping ms).
    Pong {
        t: u32,
        host_t: u32,
    },
    /// The room is over; the controller shows the end card.
    Ended,
    /// The seat has given no deliberate input while racing (G03): the autopilot takes the car in `autopilot_in_ms`
    /// unless the player steers; the phone shows the cue.
    IdleCue {
        autopilot_in_ms: u32,
    },
    /// The host removed this player (P1-G07): the phone shows so, with Join again.
    Removed,
    /// `cmd` answers one source of the endpoint (the reply to a `ForSource` claim, and every later message for that
    /// source's seat: `RoomState`, `IdleCue`, `Removed`). Endpoint-wide messages (`Ended`, `Pong`) are never wrapped.
    ForSource {
        source: SourceHandle,
        cmd: Box<HostCmd>,
    },
    /// The owner tuning menu (br-2sdu.2) changed the input profile: every threshold the controller's `jj-input` reads,
    /// whole, in fixed point. Endpoint-wide (never wrapped), and sent again to a controller that joins afterwards. Only a
    /// host with a tuned profile sends it; the shipped profile is compiled into the controller.
    InputProfile(InputThresholds),
}

/// The input profile (`assets/profiles/input.json`) on the wire, in fixed point so the host and every controller resolve
/// the very same thresholds: fractions in 1/10000, angles in 1/100 degree, gamma in 1/1000, times in ms.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct InputThresholds {
    pub steer_radial_deadzone: u16,
    pub steer_gamma: u16,
    pub drift_enter_angle: u16,
    pub drift_enter_deflection: u16,
    pub drift_exit_angle: u16,
    pub drift_exit_deflection: u16,
    pub drift_max_pull_back: u16,
    pub launch_snap_to: u16,
    pub launch_snap_window_ms: u32,
    pub launch_cooldown_ms: u32,
    pub launch_reverse_delay_ms: u32,
    pub flick_rim: u16,
    pub flick_arm_below: u16,
    pub flick_max_travel_ms: u32,
    pub flick_max_angle: u16,
    pub flick_cooldown_ms: u32,
}

macro_rules! codec {
    ($t:ty) => {
        impl $t {
            pub fn encode(&self) -> Vec<u8> {
                crate::postcard_with_prefix(&[CMD_VERSION], self)
            }

            pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
                match bytes {
                    [CMD_VERSION, body @ ..] => crate::postcard_exact(body),
                    [v, ..] => Err(DecodeError::Version {
                        expected: CMD_VERSION.into(),
                        got: (*v).into(),
                    }),
                    [] => Err(DecodeError::Short { need: 1, got: 0 }),
                }
            }
        }
    };
}
codec!(ControllerCmd);
codec!(HostCmd);
