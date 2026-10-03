//! Authoritative simulation: Rapier world, vehicle, damage parts, debris, race progress, placement and autopilot.
//!
//! P1-S01 lays the core: [`sim::Sim`] (a Rapier world from `jj.map.v1`, raycast vehicles at a fixed 120 Hz),
//! [`rng::Rng`] streams, the applied-tick [`journal::Journal`] and the full-state hash. Determinism rules (plan §7.2):
//! seeded RNG, stable iteration order, no wall clock (enforced by `tests/determinism_scan.rs`), Rapier
//! `enhanced-determinism`.

#![forbid(unsafe_code)]

pub mod autopilot;
pub mod journal;
pub mod observe;
pub mod placement;
pub mod profile;
pub mod race;
pub mod rng;
pub mod sim;

pub use journal::{DriveInput, Journal, SpawnPose};
pub use profile::VehicleProfile;
pub use sim::{CarId, CarState, DT, Sim, TICK_HZ, WheelState, route_spawn};
