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
/// The Tradie Ute's profile (`assets/profiles/tradie-ute.json`, br-bwju.2): heavier and torquier than the Cruz.
pub const TRADIE_UTE_JSON: &str = include_str!("../../../assets/profiles/tradie-ute.json");
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
    /// Every part's own collider proxy, in the contract's part order (`core`, `front`, `back`, the four doors, the
    /// four wheels): P1-S04a builds one convex collider per part from these.
    #[serde(default)]
    pub parts: Vec<PartGeometry>,
}

/// One part from the sidecar: pivot, hinge, mass share and collider proxy points, in vehicle space.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartGeometry {
    pub name: String,
    pub pivot: [f32; 3],
    /// Unit axis and loose limits (degrees); `None` for `core`.
    pub hinge: Option<([f32; 3], f32, f32)>,
    pub mass_fraction: f32,
    pub points: Vec<[f32; 3]>,
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
    /// Engine power at full throttle, W: past `power / force` m/s the force falls as power / speed (0: no limit).
    pub max_engine_power_w: f32,
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
    /// Handbrake drift (ACTION left, §7.3): the rear tyres' grip while it's held, and how long they take to come back
    /// (linearly) once it's let go, s.
    pub drift_rear_grip: f32,
    pub drift_recovery_s: f32,
    /// Boost (ACTION right, §7.3): the meter at spawn (0..1), the extra engine force while boosting (+60 % = 0.6),
    /// how fast boosting drains the meter and idling refills it (per s), and the extra refill while drifting (per s,
    /// at least `drift_charge_min_slip_deg` of rear slip and `drift_charge_min_mps`).
    pub boost_start: f32,
    /// A burst needs this much meter to start (then runs while held until empty).
    pub boost_min_start: f32,
    pub boost_engine_gain: f32,
    pub boost_drain_per_s: f32,
    pub boost_recharge_per_s: f32,
    pub drift_charge_per_s: f32,
    pub drift_charge_min_slip_deg: f32,
    pub drift_charge_min_mps: f32,
    /// Wheelie ("lift and launch", R64): lift scales with the gesture's preload up to `wheelie_full_preload_ms`, as an
    /// upward impulse at the front axle (N·s at full lift). A release preloaded at least `wheelie_good_min_ms` also
    /// adds `wheelie_drive_gain` to the drive force for `wheelie_drive_s`. (jj-input cancels a preload held past
    /// 1.2 s, so a late release never arrives.)
    pub wheelie_full_preload_ms: f32,
    pub wheelie_good_min_ms: f32,
    pub wheelie_lift_impulse: f32,
    pub wheelie_drive_gain: f32,
    pub wheelie_drive_s: f32,
    /// The launch repays the pull (P1-S09): a well-timed release gives the car a forward impulse of this many times what
    /// the preload cost it. The cost is the speed the brakes shed during the first `wheelie_full_preload_ms` of the pull,
    /// plus what the engine would have added in that time (`max_engine_force / mass` × the pull). 0: no repayment (the
    /// +`wheelie_drive_gain` for `wheelie_drive_s` alone can't repay a 0.35 s pull: it is worth about 0.1 s).
    #[serde(default)]
    pub wheelie_launch_reward: f32,
    /// The wheelie launch (the R116 boost, P1-C11) is refused for this long after one (s); 0: no cooldown. The phone's ring
    /// shows the same wait from `assets/profiles/input.json` (`launch.cooldownMs`, a test keeps the two equal).
    #[serde(default)]
    pub wheelie_cooldown_s: f32,
    /// A launch is refused while the car is going backwards faster than this (m/s): pull-and-hold reversed, and a snap
    /// forward then is just throttle. A pull at rest (or going forward) arms it, countdown included.
    #[serde(default = "no_reverse_limit")]
    pub wheelie_max_reverse_mps: f32,
    /// Airborne only (no wheel in contact): torque at full stick, N·m. DRIVE y pitches, DRIVE x rolls.
    pub air_pitch_torque: f32,
    pub air_roll_torque: f32,
    /// R120 drift exit: the least drift held (s) that earns a boost on release, seconds of boost per second held, its cap.
    #[serde(default)]
    pub drift_exit_min_s: f32,
    /// … counting only while the rear slides at least this much (deg): any real slide, not the meter's 10° charge.
    #[serde(default)]
    pub drift_exit_min_slip_deg: f32,
    #[serde(default)]
    pub drift_exit_boost_per_s: f32,
    #[serde(default)]
    pub drift_exit_boost_max_s: f32,
    /// The exit boost's extra drive (like `boost_engine_gain`, which it replaces while it burns if larger; 0 = the meter boost's).
    #[serde(default)]
    pub drift_exit_boost_gain: f32,
    /// In the air the car levels itself toward world-up (N·m per radian of tilt, from the sine of the tilt) …
    #[serde(default)]
    pub air_level_torque: f32,
    /// … damped on its pitch and roll rate (N·m·s per rad/s).
    #[serde(default)]
    pub air_level_damping: f32,
    pub surfaces: SurfaceGrip,
    /// Part health and the damage episodes (plan §6.3, R86, P1-S04a).
    #[serde(default)]
    pub damage: DamageTuning,
}

/// The damage model's numbers (plan §6.3, DEFAULT/TUNE; calibrated by `scenarios/damage/`, never by formula).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct DamageTuning {
    /// Starting health per part kind.
    pub health_front: f32,
    pub health_back: f32,
    pub health_door: f32,
    pub health_wheel: f32,
    /// Damage per N·s of qualifying normal impulse (`damage = k × Σ impulse`) per part kind.
    pub k_front: f32,
    pub k_back: f32,
    pub k_door: f32,
    pub k_wheel: f32,
    /// A part is loose once its health is at or below this fraction of its starting health.
    pub loose_fraction: f32,
    /// Contacts aggregate over this much game time per (car, part, other body), ms.
    pub window_ms: f32,
    /// Only contacts closing at least this fast count, m/s (excludes resting contact).
    pub min_closing_mps: f32,
    /// A hit on the core (it has no health) belongs to the nearest part within this distance, m: the sidecar's core
    /// proxy bulges past the door skins, so a side hit lands on it first.
    pub attribution_margin_m: f32,
    /// Loose parts (P1-S04b): the hinge spring's stiffness (1/s², the square of its natural angular frequency) and damping
    /// (1/s). Visual springs on the chassis' accelerations; they never push back on the body.
    pub spring_stiffness: f32,
    pub spring_damping: f32,
    /// A loose wheel loses this fraction of its friction slip (0 since R121: damage costs nothing until a wheel comes off).
    pub loose_wheel_grip_loss: f32,
    /// After the first wheel comes off, the car drives on this long, s, then is wrecked and respawns fresh (R121).
    pub wheel_loss_respawn_s: f32,
    /// A detaching part leaves at this much extra speed, m/s, away from the chassis' centre of mass (an authorised input
    /// to the energy ledger).
    pub detach_kick_mps: f32,
    /// A fresh debris part ignores cars for this long, ms, so it clears the chassis it came off without being shoved.
    pub detach_clear_ms: f32,
}

impl Default for DamageTuning {
    fn default() -> Self {
        Self {
            health_front: 100.0,
            health_back: 100.0,
            health_door: 60.0,
            health_wheel: 80.0,
            // Calibrated by scenarios/damage (tests/damage.rs), not by formula: see docs/learnings/sim.md.
            k_front: 0.007,
            k_back: 0.007,
            k_door: 0.014,
            k_wheel: 0.0055,
            loose_fraction: 0.5,
            window_ms: 50.0,
            min_closing_mps: 4.0,
            attribution_margin_m: 0.3,
            spring_stiffness: 25.0,
            spring_damping: 4.0,
            loose_wheel_grip_loss: 0.0,
            wheel_loss_respawn_s: 2.0,
            detach_kick_mps: 1.5,
            detach_clear_ms: 250.0,
        }
    }
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

    /// The Tradie Ute (`assets/profiles/tradie-ute.json`).
    pub fn tradie_ute() -> Self {
        Self::from_json(TRADIE_UTE_JSON).expect("the compiled-in Tradie Ute profile parses")
    }

    /// Every roster vehicle's profile, in roster order (R123): `(id, profile)` for each row of `web/shared/src/roster.json`,
    /// read from `assets/profiles/<id>.json` under `repo_root`. Adding a vehicle is a roster row and its profile file: no
    /// code lists vehicles. Native only (tests, tools); the browser sends the same files to the host as `Vehicles`.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn roster(repo_root: &std::path::Path) -> Result<Vec<(String, Self)>, String> {
        let read = |p: std::path::PathBuf| {
            std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))
        };
        let roster: serde_json::Value =
            serde_json::from_str(&read(repo_root.join("web/shared/src/roster.json"))?)
                .map_err(|e| format!("roster.json: {e}"))?;
        let cars = roster["cars"].as_array().ok_or("roster.json has no cars")?;
        cars.iter()
            .map(|c| {
                let id = c["id"].as_str().ok_or("a roster row without an id")?;
                let json = read(repo_root.join(format!("assets/profiles/{id}.json")))?;
                Ok((id.to_owned(), Self::from_json(&json)?))
            })
            .collect()
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

fn no_reverse_limit() -> f32 {
    f32::MAX
}
