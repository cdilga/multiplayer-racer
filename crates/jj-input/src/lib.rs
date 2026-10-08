//! Input interpretation shared by controllers and the host (plan T5): touch, pads and keys mean
//! the same thing because there is one crate that decides what sticks *mean*.
//!
//! | Module | What it owns |
//! |---|---|
//! | [`curve`] | the personal response curve, applied on the controller before quantisation (§5.4) |
//! | [`dual`] | the R116 layout: left stick drive/drift/boost, right stick steer and flick (P1-C11) |
//! | [`profile`] | the thresholds of that layout as versioned data with a validator |
//! | [`intent`] | game interpretation of the DRIVE stick: [`DriveIntent`] (steer/throttle/brake/reverse) |
//! | [`action`] | ACTION-stick sectors: hysteresis, neutral re-arm, held boost/drift, discrete utilities (§7.6) |
//! | [`wheelie`] | the wheelie preload/release machine (§7.3) |
//! | [`source`] | per-source state: flags, freshness, stable action IDs, neutralisation |
//! | [`scheduler`] | the send scheduler: 60 Hz change / 20 Hz refresh / prompt neutral (§5.4) |
//!
//! The controller runs all of it inside [`jj_wasm_input`] (discrete actions are detected there and
//! sent as `Action` commands, so a later neutral sample can't erase them); the host runs the same
//! machines for its pad/keyboard sources and to interpret what arrives on the state channel.
//!
//! Thresholds live in quantised axis space ([`jj_types::axis::AxisThreshold`]) so a decision made
//! on a controller matches the host's, whatever float rounding a round trip does.

#![forbid(unsafe_code)]

pub mod action;
pub mod curve;
pub mod dual;
pub mod intent;
pub mod profile;
pub mod scheduler;
pub mod source;
pub mod wheelie;

pub use action::{HeldActions, Sector, SectorMachine, Utility};
pub use curve::{StickCurve, shape_and_quantise};
pub use dual::{DriveStickMachine, Flick, FlickMachine};
pub use intent::{DriveIntent, FULL_BRAKE, FULL_BRAKE_Q, drive_intent};
pub use profile::{InputProfile, Resolved};
pub use scheduler::{CHANGE_INTERVAL_MS, Flush, REFRESH_INTERVAL_MS, SendReason, SendScheduler};
pub use source::{DetectedAction, Neutralise, SampleFlags, SourceSemantics, SourceState};
pub use wheelie::{WheelieDetector, WheelieEvent};

#[cfg(test)]
mod tests;
