//! The native input helper (P1-C12.1): every keyboard and every pad plugged into the host computer becomes its own
//! local source on the paired host page, past what a browser can tell apart (KeyboardEvent has no device id) or show
//! (Chromium's four Gamepad API slots).
//!
//! - `backend`: per-OS device readers (Linux evdev, Windows Raw Input, macOS IOHIDManager) and a scripted one for
//!   tests. Each turns its devices into [`hub::DeviceEvent`]s with browser key names and the Gamepad API's standard
//!   pad mapping, so everything after it is OS-blind.
//! - `hub`: the device layer: stable ids per device (a replugged device gets its id back), per-device key and pad
//!   state, and the messages the page reads ([`protocol`]).
//! - `ws`, `pairing`, `server`: a WebSocket on 127.0.0.1 that only an allowed origin can open and only a paired page
//!   can read; devices are opened only while a paired page is connected (no page, no capture).
//!
//! The page turns each device into `LocalSource{source, axes, buttons, seq}` exactly as it does its own pads and key
//! clusters (`web/host/src/input/local.ts`), so the worker's `jj-input` path stays source-blind. Transport, security and
//! the per-OS install notes: `docs/evidence/P1-C12.1/receipt.md`.

pub mod backend;
pub mod hub;
pub mod keymap;
pub mod pairing;
pub mod protocol;
pub mod server;
pub mod ws;

/// The port the host page looks for the helper on (`web/host/src/input/helper.json`).
pub const DEFAULT_PORT: u16 = 47123;

/// The origins a helper accepts with no `--allow-origin`: the game's own sites (a preview's `/p/<id>/` is the same origin).
pub const DEFAULT_ORIGINS: [&str; 2] = [
    "https://jammers.dilger.dev",
    "https://jammers-preview.dilger.dev",
];
