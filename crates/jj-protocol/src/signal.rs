//! Server API v1 and SSE signalling bodies (plan §5.1, §5.2): JSON, camelCase, `Cache-Control: no-store`.
//!
//! Secrets never appear here: requests carry SHA-256 hashes of them, and the secret itself goes only in the
//! `Authorization: Bearer` header. Nothing in these types counts or caps rooms, endpoints or players.

use jj_types::{BuildId, EndpointId, RoomCode, RoomId};
use serde::{Deserialize, Serialize};

use crate::DecodeError;

/// One ICE server entry, as `RTCPeerConnection` takes it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct IceServer {
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

/// `GET B/version`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub build: BuildId,
    pub protocol: u16,
    pub realm: String,
}

/// `POST B/api/v1/rooms` (host). Retrying with the same `requestId` returns the same room.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct CreateRoom {
    pub request_id: String,
    pub host_secret_hash: String,
}

/// `201` for [`CreateRoom`]. The host's signalling endpoint is registered with the room as `"host"`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct RoomCreated {
    pub room_id: RoomId,
    pub code: RoomCode,
    pub join_url: String,
    pub host_endpoint_id: EndpointId,
    pub room_ticket: String,
    pub ice_servers: Vec<IceServer>,
    /// Unix ms.
    pub ice_expires_at: u64,
}

/// `PUT B/api/v1/rooms/<code>` (host, after a server restart), with `Authorization: Bearer <hostSecret>`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct ReRegisterRoom {
    pub room_id: RoomId,
    pub host_secret_hash: String,
    pub room_ticket: String,
}

/// `200` for [`ReRegisterRoom`]: the code may be fresh if another room took the old one meanwhile.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct RoomReRegistered {
    pub code: RoomCode,
    pub room_ticket: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "kebab-case")]
pub enum RoomStatus {
    Available,
    HostUnreachable,
    Ended,
    NotFound,
}

/// `GET B/api/v1/rooms/<code>` (anyone).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct RoomLookup {
    pub status: RoomStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<RoomId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<BuildId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realm: Option<String>,
}

/// `POST B/api/v1/rooms/<roomId>/endpoints` (controller): registers a signalling endpoint, not a seat. Idempotent
/// with the same id and secret hash; a different hash for a registered id gets `409`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct RegisterEndpoint {
    pub request_id: String,
    pub endpoint_id: EndpointId,
    pub endpoint_secret_hash: String,
}

/// `201` for [`RegisterEndpoint`]: the initial ICE list in the same round trip.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct EndpointRegistered {
    pub ice_servers: Vec<IceServer>,
    pub ice_expires_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "lowercase")]
pub enum SignalKind {
    Offer,
    Answer,
    Candidate,
    Restart,
    Bye,
}

/// `POST B/api/v1/rooms/<roomId>/signal` (both), and each SSE event's data. `payload` is opaque to the server: the SDP,
/// or a candidate's JSON text.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct SignalMessage {
    pub from: EndpointId,
    pub to: EndpointId,
    pub kind: SignalKind,
    /// The connection generation (`gen` on the wire); an ICE restart bumps it, so late messages for an old one are dropped.
    #[serde(rename = "gen")]
    pub generation: u32,
    pub payload: String,
}

/// `POST B/api/v1/ice` (both, bearer = that endpoint's secret): refresh the initial list.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct IceRefresh {
    pub room_id: RoomId,
    pub endpoint_id: EndpointId,
}

/// `POST B/api/v1/ice/fallback` (both): ask for Cloudflare TURN (R92).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct IceFallback {
    pub room_id: RoomId,
    pub endpoint_id: EndpointId,
    pub reason: String,
}

/// `200` for [`IceRefresh`] and [`IceFallback`].
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct IceList {
    pub ice_servers: Vec<IceServer>,
    pub expires_at: u64,
}

/// `429`: a rate limit (never a player cap); the client retries after this long.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct RetryAfter {
    pub retry_after_ms: u64,
}

/// Error bodies: `404 {reason: unknown-room}` (the restart signal), `503 {reason: relay-unavailable}`, `409`, `403`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(any(test, feature = "arbitrary"), derive(arbitrary::Arbitrary))]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub reason: String,
}

impl ErrorBody {
    pub const UNKNOWN_ROOM: &'static str = "unknown-room";
    pub const RELAY_UNAVAILABLE: &'static str = "relay-unavailable";
}

/// JSON-encodes any API body.
pub fn to_json<T: Serialize>(body: &T) -> Vec<u8> {
    // Plain structs of strings and integers always serialise.
    serde_json::to_vec(body).expect("API bodies serialise")
}

/// Parses an API body; never panics.
pub fn from_json<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, DecodeError> {
    serde_json::from_slice(bytes).map_err(|e| DecodeError::Body(e.to_string()))
}
