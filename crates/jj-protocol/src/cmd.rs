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
