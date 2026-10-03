//! Typed IDs, units and small math shared by every crate. No I/O.
//!
//! - [`ids`]: newtypes for every identifier on the wire (seats, sources, endpoints, rounds, actions…).
//! - [`seq`]: wrapping `u16` sequence comparison.
//! - [`time`]: wrapping millisecond clocks and unwrapping them against a reference.
//! - [`axis`]: stick axis quantisation to `i16` (−32767..32767) that keeps neutral, full range and thresholds.

#![forbid(unsafe_code)]

pub mod axis;
pub mod ids;
pub mod seq;
pub mod time;

pub use ids::*;
