//! The controller's `cmd` channel (P1-C02/C03): encoders for every `ControllerCmd` the controller sends and decoders
//! for what the host sends back (`HostCmd` on `cmd`, `HudUpdate` on `state`). Decoders return JSON text (serde's
//! externally tagged form, e.g. `{"Welcome":{"seat":3,…}}`) so the page needs no hand-written postcard reader.

use jj_protocol::PROTOCOL_VERSION;
use jj_protocol::cmd::{CameraDistance, CameraMode, ControllerCmd, HostCmd};
use jj_protocol::state::HudUpdate;
use jj_types::{BuildId, EndpointId, RequestId, SourceHandle};
use wasm_bindgen::prelude::wasm_bindgen;

/// `Hello`: first message on every connection; `resume` is the endpoint secret when coming back to a seat.
#[wasm_bindgen(js_name = encodeHello)]
pub fn encode_hello(build: &str, endpoint: &str, resume: Option<String>) -> Vec<u8> {
    ControllerCmd::Hello {
        protocol: PROTOCOL_VERSION,
        build: BuildId(build.to_owned()),
        endpoint: EndpointId(endpoint.to_owned()),
        resume,
    }
    .encode()
}

/// `Claim`: idempotent on `request` (a retried claim yields one seat).
#[wasm_bindgen(js_name = encodeClaim)]
pub fn encode_claim(request: u32, name: &str) -> Vec<u8> {
    ControllerCmd::Claim {
        request: RequestId(request),
        name: name.to_owned(),
    }
    .encode()
}

/// `ForSource`: `inner` (an already encoded `ControllerCmd`) is for one source of this endpoint (a hub). Empty if `inner`
/// doesn't decode, or is itself a `Hello` or a `ForSource` (those never nest).
#[wasm_bindgen(js_name = encodeForSource)]
pub fn encode_for_source(source: u16, inner: &[u8]) -> Vec<u8> {
    match ControllerCmd::decode(inner) {
        Ok(ControllerCmd::Hello { .. } | ControllerCmd::ForSource { .. }) | Err(_) => Vec::new(),
        Ok(cmd) => ControllerCmd::ForSource {
            source: SourceHandle(source),
            cmd: Box::new(cmd),
        }
        .encode(),
    }
}

#[wasm_bindgen(js_name = encodeIdentify)]
pub fn encode_identify() -> Vec<u8> {
    ControllerCmd::Identify.encode()
}

#[wasm_bindgen(js_name = encodeSetName)]
pub fn encode_set_name(name: &str) -> Vec<u8> {
    ControllerCmd::SetName {
        name: name.to_owned(),
    }
    .encode()
}

/// `first_person`: the seat's tile camera (true = first person, false = chase).
#[wasm_bindgen(js_name = encodeSetCamera)]
pub fn encode_set_camera(first_person: bool) -> Vec<u8> {
    let camera = if first_person {
        CameraMode::FirstPerson
    } else {
        CameraMode::ThirdPerson
    };
    ControllerCmd::SetCamera { camera }.encode()
}

/// `SetCameraDistance`: 0 the host's own, 1 near, 2 far (anything else is the host's).
#[wasm_bindgen(js_name = encodeSetCameraDistance)]
pub fn encode_set_camera_distance(tag: u8) -> Vec<u8> {
    let distance = match tag {
        1 => CameraDistance::Near,
        2 => CameraDistance::Far,
        _ => CameraDistance::Host,
    };
    ControllerCmd::SetCameraDistance { distance }.encode()
}

#[wasm_bindgen(js_name = encodeReady)]
pub fn encode_ready(on: bool) -> Vec<u8> {
    ControllerCmd::Ready { on }.encode()
}

#[wasm_bindgen(js_name = encodeRecover)]
pub fn encode_recover() -> Vec<u8> {
    ControllerCmd::Recover.encode()
}

#[wasm_bindgen(js_name = encodeSitOut)]
pub fn encode_sit_out() -> Vec<u8> {
    ControllerCmd::SitOut.encode()
}

#[wasm_bindgen(js_name = encodeLeave)]
pub fn encode_leave() -> Vec<u8> {
    ControllerCmd::Leave.encode()
}

/// The lobby's car pick: a roster id and whether the picker is still open.
#[wasm_bindgen(js_name = encodePick)]
pub fn encode_pick(vehicle: &str, open: bool) -> Vec<u8> {
    ControllerCmd::Pick {
        vehicle: vehicle.to_owned(),
        open,
    }
    .encode()
}

#[wasm_bindgen(js_name = encodeMenu)]
pub fn encode_menu(open: bool) -> Vec<u8> {
    ControllerCmd::Menu { open }.encode()
}

#[wasm_bindgen(js_name = encodePing)]
pub fn encode_ping(t: u32) -> Vec<u8> {
    ControllerCmd::Ping { t }.encode()
}

/// A `HostCmd` from the `cmd` channel as JSON, or an empty string if it doesn't decode.
#[wasm_bindgen(js_name = decodeHostCmd)]
pub fn decode_host_cmd(bytes: &[u8]) -> String {
    HostCmd::decode(bytes)
        .ok()
        .and_then(|c| serde_json::to_string(&c).ok())
        .unwrap_or_default()
}

/// A `HudUpdate` from the `state` channel as JSON (`{"minor":…,"hud":{…}}`), or an empty string.
#[wasm_bindgen(js_name = decodeHud)]
pub fn decode_hud(bytes: &[u8]) -> String {
    HudUpdate::decode(bytes)
        .ok()
        .and_then(|h| {
            serde_json::to_string(&serde_json::json!({ "minor": h.minor, "hud": h.hud })).ok()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_protocol::cmd::RoomPhase;
    use jj_types::{SeatColour, SeatId, SeatNumber, SourceHandle};

    #[test]
    fn commands_round_trip() {
        match ControllerCmd::decode(&encode_hello("b1", "c-1", Some("s".into()))).unwrap() {
            ControllerCmd::Hello {
                protocol,
                endpoint,
                resume,
                ..
            } => {
                assert_eq!(
                    (protocol, endpoint.0.as_str(), resume.as_deref()),
                    (PROTOCOL_VERSION, "c-1", Some("s"))
                );
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            ControllerCmd::decode(&encode_claim(7, "Davo")).unwrap(),
            ControllerCmd::Claim {
                request: RequestId(7),
                name: "Davo".into()
            }
        );
        assert_eq!(
            ControllerCmd::decode(&encode_identify()).unwrap(),
            ControllerCmd::Identify
        );
        assert_eq!(
            ControllerCmd::decode(&encode_set_camera(true)).unwrap(),
            ControllerCmd::SetCamera {
                camera: CameraMode::FirstPerson
            }
        );
        assert_eq!(
            ControllerCmd::decode(&encode_ready(true)).unwrap(),
            ControllerCmd::Ready { on: true }
        );
        assert_eq!(
            ControllerCmd::decode(&encode_pick("cruz-missile", true)).unwrap(),
            ControllerCmd::Pick {
                vehicle: "cruz-missile".into(),
                open: true
            }
        );
    }

    #[test]
    fn host_commands_decode_to_json() {
        let welcome = HostCmd::Welcome {
            seat: SeatId(3),
            number: SeatNumber(12),
            colour: SeatColour {
                index: 2,
                rgb: [1, 2, 3],
            },
            source: SourceHandle(9),
        };
        let json = decode_host_cmd(&welcome.encode());
        assert!(json.starts_with("{\"Welcome\""), "{json}");
        assert!(json.contains("\"number\":12"), "{json}");
        let state = HostCmd::RoomState {
            phase: RoomPhase::Lobby,
            you: None,
            countdown_ms: None,
            results: None,
        };
        assert!(decode_host_cmd(&state.encode()).contains("RoomState"));
        assert_eq!(decode_host_cmd(&[0xff]), "");
        let wrapped = HostCmd::ForSource {
            source: SourceHandle(4),
            cmd: Box::new(state),
        };
        let json = decode_host_cmd(&wrapped.encode());
        assert!(json.starts_with("{\"ForSource\":{\"source\":4"), "{json}");
        let claim = encode_for_source(4, &encode_claim(1, "Pad"));
        assert!(matches!(
            ControllerCmd::decode(&claim),
            Ok(ControllerCmd::ForSource {
                source: SourceHandle(4),
                ..
            })
        ));
        assert!(
            encode_for_source(4, &claim).is_empty(),
            "wrappers don't nest"
        );
        assert!(encode_for_source(4, &encode_hello("b", "e", None)).is_empty());
        assert_eq!(decode_hud(&[0x00]), "");
    }
}
