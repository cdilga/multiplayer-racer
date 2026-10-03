//! Asset sidecar schemas and the GLB validator (vehicle first).
//!
//! - [`vehicle`]: the `jj.vehicle.v1` contract (P1-V01): sidecar types, the named rules, and a validator that reads the
//!   LOD GLBs themselves.
//! - [`glb`]: a minimal binary-glTF reader for the checks (scene graph, transforms, positions, triangle counts).

#![forbid(unsafe_code)]

pub mod glb;
pub mod vehicle;
