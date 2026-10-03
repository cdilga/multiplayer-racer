//! Vehicle profiles (P1-S03a): `assets/profiles/<vehicle>.json` (`jj.vehicle-profile.v1`), one per roster car.
//!
//! - **Geometry** comes from the car's baked sidecar (P1-V02): the chassis proxy's hull points, the wheels' pivots
//!   and radius, and the centre of mass, in vehicle space (metres, +y up, +z forward, origin on the ground between
//!   the axles). `jj vehicle sync` derives it and `jj validate` checks the file still matches the sidecar it names.
//!   The sim's body frame **is** vehicle space, so a renderer puts the GLB straight at the body pose.
//! - **Tuning** is the hand-set feel (plan §7.3, TUNE, judged at G-FEEL). `jj sim --set <field>=<value>` and
//!   `jj sim --sweep` override its fields by name.

use serde::{Deserialize, Serialize};

/// The profile file's contract tag.
pub const PROFILE: &str = "jj.vehicle-profile.v1";
/// The Cruz Missile's profile, compiled in: what the host's worker and fixtures without their own use.
pub const CRUZ_MISSILE_JSON: &str = include_str!("../../../assets/profiles/cruz-missile.json");
/// Gravity used to size the static sag, m/s² (the world's gravity).
const G: f32 = 9.81;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Drive {
    Front,
    Rear,
    All,
}

/// Where a profile's geometry came from: the sidecar and the hashes of the bytes it was derived from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    /// Repo-relative path of the sidecar (`*.asset.json`).
    pub sidecar: String,
    pub sidecar_sha256: String,
    /// Its LOD0 GLB (where the collider proxies live).
    pub lod0_sha256: String,
}

/// The car's shape in vehicle space, from its sidecar. Wheels in the sim's order: FL, FR, RL, RR (+x is the car's
/// left, as the sidecar names them).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VehicleGeometry {
    /// The chassis proxy's points; the sim builds their convex hull.
    pub hull: Vec<[f32; 3]>,
    pub wheels: [[f32; 3]; 4],
    pub wheel_radius: f32,
    pub com: [f32; 3],
}

/// Grip multipliers per ground surface (plan §7.3 "Surfaces"), applied to the tyres' friction slip.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceGrip {
    pub tarmac: f32,
    pub packed_dirt: f32,
    pub gravel: f32,
    pub rock: f32,
    pub off_track: f32,
}

/// The hand-set feel. Forces are totals for the car; Rapier's `WheelTuning` stiffness is per kilogram of chassis
/// (Rapier multiplies the spring force by the mass).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tuning {
    /// Total mass, kg (S04 splits it across the parts by their sidecar mass fractions).
    pub mass: f32,
    /// A multiplier on the hull's box inertia: lower turns quicker.
    pub inertia_scale: f32,
    pub suspension_rest: f32,
    pub suspension_stiffness: f32,
    pub suspension_compression: f32,
    pub suspension_damping: f32,
    pub max_suspension_travel: f32,
    pub max_suspension_force: f32,
    pub friction_slip: f32,
    pub side_friction_stiffness: f32,
    /// Total engine force at full throttle, N (split across the driven wheels).
    pub max_engine_force: f32,
    /// Total engine force in reverse at full brake once nearly stopped, N.
    pub max_reverse_force: f32,
    /// Below this forward speed (m/s), brake reverses instead (and throttle while rolling backwards brakes).
    pub reverse_below_mps: f32,
    /// Total braking force at full brake, N (applied as force × dt per tick: Rapier's `brake` is an impulse).
    pub max_brake_force: f32,
    /// Front-wheel lock at full steer when stopped, radians.
    pub max_steer_rad: f32,
    /// Lock falls off with speed: `max_steer_rad / (1 + speed / steer_falloff_mps)`.
    pub steer_falloff_mps: f32,
    pub drive: Drive,
    pub linear_damping: f32,
    pub angular_damping: f32,
    /// How much of the tyres' side forces' real lever arm rolls the body (Bullet's `rollInfluence`: 1 physical, 0 none).
    /// Rapier fixes its own at 0.1 privately; the sim puts back the difference (`crate::vehicle::ROLL_INFLUENCE_RAPIER`).
    pub roll_influence: f32,
    /// Airborne only (no wheel in contact): torque at full stick, N·m. DRIVE y pitches, DRIVE x rolls.
    pub air_pitch_torque: f32,
    pub air_roll_torque: f32,
    pub surfaces: SurfaceGrip,
}

/// A profile file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileFile {
    pub profile: String,
    pub vehicle: String,
    pub source: Source,
    pub geometry: VehicleGeometry,
    pub tuning: Tuning,
}

/// What the sim builds and drives a car from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VehicleProfile {
    pub geometry: VehicleGeometry,
    pub tuning: Tuning,
}

impl VehicleProfile {
    /// Parses a profile file (its contract tag is checked; `jj validate` checks the rest against the sidecar).
    pub fn from_json(json: &str) -> Result<Self, String> {
        let f: ProfileFile =
            serde_json::from_str(json).map_err(|e| format!("bad vehicle profile: {e}"))?;
        if f.profile != PROFILE {
            return Err(format!("profile {:?}, expected {PROFILE:?}", f.profile));
        }
        Ok(Self {
            geometry: f.geometry,
            tuning: f.tuning,
        })
    }

    /// The Cruz Missile (`assets/profiles/cruz-missile.json`).
    pub fn cruz() -> Self {
        Self::from_json(CRUZ_MISSILE_JSON).expect("the compiled-in Cruz Missile profile parses")
    }

    /// The hull's axis-aligned box: (min, max).
    pub fn hull_bounds(&self) -> ([f32; 3], [f32; 3]) {
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for p in &self.geometry.hull {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        (lo, hi)
    }

    /// Half extents of the hull's box (footprints and clearances).
    pub fn chassis_half(&self) -> [f32; 3] {
        let (lo, hi) = self.hull_bounds();
        [
            (hi[0] - lo[0]) / 2.0,
            (hi[1] - lo[1]) / 2.0,
            (hi[2] - lo[2]) / 2.0,
        ]
    }

    pub fn axle_front_z(&self) -> f32 {
        (self.geometry.wheels[0][2] + self.geometry.wheels[1][2]) / 2.0
    }

    pub fn axle_rear_z(&self) -> f32 {
        (self.geometry.wheels[2][2] + self.geometry.wheels[3][2]) / 2.0
    }

    pub fn wheelbase(&self) -> f32 {
        self.axle_front_z() - self.axle_rear_z()
    }

    /// How far the springs compress under the car's own weight, m (Rapier's spring force is stiffness × compression ×
    /// chassis mass per wheel).
    pub fn static_sag(&self) -> f32 {
        G / (self.geometry.wheels.len() as f32 * self.tuning.suspension_stiffness)
    }

    /// Wheel `i`'s suspension hard point: above its pivot by the rest length less the static sag, so the car rests at
    /// its design pose (wheels at their pivots, the origin on the ground).
    pub fn hard_point(&self, i: usize) -> [f32; 3] {
        let [x, y, z] = self.geometry.wheels[i];
        [x, y + self.tuning.suspension_rest - self.static_sag(), z]
    }

    /// The front-wheel lock at full steer at `speed` m/s.
    pub fn steer_lock(&self, speed: f32) -> f32 {
        self.tuning.max_steer_rad / (1.0 + speed.abs() / self.tuning.steer_falloff_mps)
    }

    /// The grip multiplier for a surface.
    pub fn grip(&self, surface: jj_map::model::Surface) -> f32 {
        use jj_map::model::Surface;
        let s = &self.tuning.surfaces;
        match surface {
            Surface::Tarmac => s.tarmac,
            Surface::PackedDirt => s.packed_dirt,
            Surface::Gravel => s.gravel,
            Surface::Rock => s.rock,
            Surface::OffTrack => s.off_track,
        }
    }
}
