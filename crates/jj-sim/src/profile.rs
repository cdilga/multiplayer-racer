//! Vehicle profiles. Until P1-V02's sidecar exists, a **provisional** profile with Spike J's Cruze dimensions
//! (`spikes/art-pipeline/J-cruze-lowpoly/params.json`: length 4.31 m, wheel radius 0.40 m, half-track 0.85 m, axles at
//! ±1.34 m). P1-S03 switches to the sidecar and tunes feel; these numbers are a working start, not a tuning.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Drive {
    Front,
    Rear,
    All,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VehicleProfile {
    /// Chassis collider half extents (x, y, z), metres.
    pub chassis_half: [f32; 3],
    pub chassis_mass: f32,
    pub wheel_radius: f32,
    pub half_track: f32,
    pub axle_front_z: f32,
    pub axle_rear_z: f32,
    /// Chassis-space y of the wheels' suspension hard points.
    pub hard_point_y: f32,
    pub suspension_rest: f32,
    /// Rapier `WheelTuning` (stiffness is per kilogram of chassis: Rapier multiplies the spring force by the mass).
    pub suspension_stiffness: f32,
    pub suspension_compression: f32,
    pub suspension_damping: f32,
    pub max_suspension_travel: f32,
    pub friction_slip: f32,
    pub side_friction_stiffness: f32,
    pub max_suspension_force: f32,
    /// Total engine force at full throttle, N (split across the driven wheels).
    pub max_engine_force: f32,
    /// Total braking force at full brake, N (applied as force × dt per tick: Rapier's `brake` is an impulse).
    pub max_brake_force: f32,
    pub max_steer_rad: f32,
    pub drive: Drive,
    pub linear_damping: f32,
    pub angular_damping: f32,
}

impl VehicleProfile {
    pub fn provisional_cruz() -> Self {
        Self {
            chassis_half: [0.88, 0.38, 2.15],
            chassis_mass: 1200.0,
            wheel_radius: 0.40,
            half_track: 0.85,
            axle_front_z: 1.34,
            axle_rear_z: -1.34,
            hard_point_y: -0.15,
            suspension_rest: 0.35,
            suspension_stiffness: 30.0,
            suspension_compression: 4.0,
            suspension_damping: 4.5,
            max_suspension_travel: 0.3,
            friction_slip: 2.0,
            side_friction_stiffness: 1.0,
            max_suspension_force: 60_000.0,
            max_engine_force: 7_000.0,
            max_brake_force: 14_000.0,
            max_steer_rad: 0.55,
            drive: Drive::Rear,
            linear_damping: 0.15,
            angular_damping: 0.8,
        }
    }
}
