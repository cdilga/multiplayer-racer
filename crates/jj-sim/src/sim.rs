//! The simulation core (P1-S01): a Rapier world built from a validated `jj.map.v1`, raycast vehicles, seeded RNG, the
//! applied-tick journal and a full-state hash.
//!
//! **Time** (plan §7.1, R61): a fixed 120 Hz step, `dt = 1/120`. The host's worker owns the accumulator and calls
//! [`Sim::step`] once per whole tick; nothing here reads a clock.
//!
//! **Tick order:** apply the inputs due at this tick → set vehicle controls → `update_vehicle` against the current query
//! data → `step` → (later beads: contacts and damage episodes, structural changes, race progress, events, snapshot).
//!
//! **Rapier 0.36 semantics this relies on** (pinned by `tests/rapier_api.rs`, notes in `docs/learnings/sim.md`):
//! `engine_force` is a force (Rapier integrates it with `dt`); `brake` is an impulse per tick and is ignored while any
//! engine force is set; only a positive engine force wakes a sleeping chassis. So controls are converted here: brake force
//! × dt → impulse, engine force zeroed while braking, and the chassis woken on any non-neutral input.
//!
//! Axes: metres, +y up, cars face +z. Map poses use yaw about +y with 0 = +x (counter-clockwise seen from above), which is
//! a Rapier rotation of −yaw.

use rapier3d::control::{DynamicRayCastVehicleController, WheelTuning};
use rapier3d::parry::utils::Array2;
use rapier3d::prelude::*;
use sha2::{Digest, Sha256};

use jj_map::{Footprint, LoadedMap, Registry, Terrain};

use crate::autopilot::{Autopilot, AutopilotState, Mode, Path, Pose2};
use crate::damage::episodes::{CarParts, Episodes, PreStep, TAG_CAR, TAG_PROP};
use crate::damage::springs::{Hinge, Spring};
use crate::damage::{self, CarDamage, DamageEvent, PARTS, PartState};
use crate::journal::{DriveInput, Entry, Journal, Setup, SpawnPose};
use crate::placement::{
    CLEARANCE_M, PROTECT_TICKS, Rect, RouteLine, SEARCH_LATERAL_M, SEARCH_STEP_M, SEARCH_STEPS,
    SPAWN_LIFT_M, corridor_slots, grid_pose, offset, overlaps,
};
use crate::profile::VehicleProfile;
use crate::race::{Course, Effect, Race, Respawned};
use crate::rng::Rng;
use crate::surface;
use crate::utility::{self, PropKind, UtilityEvent, UtilityKind, rules};
use crate::vehicle;

pub const TICK_HZ: u32 = 120;
pub const DT: f32 = 1.0 / TICK_HZ as f32;

/// Collision groups (P1-S05): finished cars become ghosts that touch only the world (terrain and static dressing), so
/// they stop colliding with racers and debris but keep driving on the ground.
pub const GROUP_WORLD: Group = Group::GROUP_1;
pub const GROUP_CAR: Group = Group::GROUP_2;
pub const GROUP_PROP: Group = Group::GROUP_3;
pub const GROUP_GHOST: Group = Group::GROUP_4;
/// Spawn protection (P1-S06): like a ghost, touching only the world, until the car is clear.
pub const GROUP_PROTECTED: Group = Group::GROUP_5;
/// The ground (P1-S04a): the heightfield, apart from the static dressing so wheel colliders can exclude it.
pub const GROUP_TERRAIN: Group = Group::GROUP_6;
/// A car's wheel colliders (P1-S04a): they touch cars, debris and scenery but not the terrain, so a wheel strike on
/// a barrier registers without fighting the raycast suspension standing on the ground.
pub const GROUP_WHEEL: Group = Group::GROUP_7;
/// A part that just came off a car (P1-S04b): it touches only the world until it has cleared the chassis it left.
pub const GROUP_FRESH: Group = Group::GROUP_8;
const fn groups(memberships: Group, filter: Group) -> InteractionGroups {
    InteractionGroups::new(memberships, filter, InteractionTestMode::And)
}
const WORLD_GROUPS: InteractionGroups = groups(GROUP_WORLD, Group::ALL);
const TERRAIN_GROUPS: InteractionGroups = groups(GROUP_TERRAIN, Group::ALL);
/// Everything static a ghost or protected car's body touches: the ground and the dressing.
const SOLID_WORLD: Group = GROUP_WORLD.union(GROUP_TERRAIN);
const PROP_GROUPS: InteractionGroups = groups(GROUP_PROP, Group::ALL);
const CAR_GROUPS: InteractionGroups = groups(GROUP_CAR, Group::ALL);
const GHOST_GROUPS: InteractionGroups = groups(GROUP_GHOST, SOLID_WORLD);
/// What a racing car's wheel rays hit (everything but ghosts), and a ghost's (only the world).
const CAR_RAYS: InteractionGroups =
    groups(GROUP_CAR, SOLID_WORLD.union(GROUP_PROP).union(GROUP_CAR));
const GHOST_RAYS: InteractionGroups = groups(GROUP_GHOST, SOLID_WORLD);
const PROTECTED_GROUPS: InteractionGroups = groups(GROUP_PROTECTED, SOLID_WORLD);
const PROTECTED_RAYS: InteractionGroups = groups(GROUP_PROTECTED, SOLID_WORLD);
/// A wheel collider's groups (never the terrain): racing, ghost and protected like the chassis' own.
const WHEEL_GROUPS: InteractionGroups = groups(
    GROUP_WHEEL,
    GROUP_WORLD
        .union(GROUP_PROP)
        .union(GROUP_CAR)
        .union(GROUP_WHEEL),
);
const FRESH_DEBRIS_GROUPS: InteractionGroups = groups(GROUP_FRESH, SOLID_WORLD);
const GHOST_WHEEL_GROUPS: InteractionGroups = groups(GROUP_GHOST, GROUP_WORLD);
const PROTECTED_WHEEL_GROUPS: InteractionGroups = groups(GROUP_PROTECTED, GROUP_WORLD);

/// How a car collides now: racing, a finished ghost, or under spawn protection.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Solidity {
    Racing,
    Ghost,
    Protected,
}

impl Solidity {
    /// The groups for a part's collider (`wheel`: the four wheel colliders).
    fn groups(self, wheel: bool) -> InteractionGroups {
        match (self, wheel) {
            (Self::Racing, false) => CAR_GROUPS,
            (Self::Racing, true) => WHEEL_GROUPS,
            (Self::Ghost, false) => GHOST_GROUPS,
            (Self::Ghost, true) => GHOST_WHEEL_GROUPS,
            (Self::Protected, false) => PROTECTED_GROUPS,
            (Self::Protected, true) => PROTECTED_WHEEL_GROUPS,
        }
    }
}

/// How much forward-speed history a car keeps: a wheelie preload is cancelled at 1.2 s, so a little more than that.
const SPEED_HISTORY_TICKS: usize = 150;

/// A car's id: its index in spawn order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CarId(pub u32);

struct Car {
    /// Which profile builds and drives this car: an index into `Sim::profiles` (R123, the roster's vehicle).
    model: usize,
    body: RigidBodyHandle,
    /// The core's collider (the cabin, which carries the car's mass properties).
    collider: ColliderHandle,
    /// Every part's collider in part order (`crate::damage::PART_NAMES`); `parts[0]` is `collider`.
    parts: Vec<ColliderHandle>,
    /// Part health (P1-S04a).
    damage: CarDamage,
    vehicle: DynamicRayCastVehicleController,
    input: DriveInput,
    /// Under spawn protection since this tick (P1-S06).
    protected_since: Option<u64>,
    /// Driven by the autopilot (P1-S07): dropout, idle, a finished car's cool-down, or a bot.
    autopilot: Option<Autopilot>,
    /// The controls actually applied last step (the player's, the autopilot's, a handback blend, or none while held).
    applied: DriveInput,
    /// Bumps on every teleport (placement, respawn): renderers never interpolate across a change of life (P1-S02).
    life: u32,
    /// The ACTION stick's state: boost meter and drift (P1-S03b).
    action: vehicle::ActionState,
    /// Each loose part's hinge spring (P1-S04b), in part order; closed and at rest while a part isn't loose.
    springs: [Spring; PARTS],
    /// Parts whose collider has left the chassis (detached into debris).
    removed: [bool; PARTS],
    /// The last [`SPEED_HISTORY_TICKS`] forward speeds (m/s), newest last: the wheelie launch repays what its pull cost.
    speed_history: std::collections::VecDeque<f32>,
    /// The chassis' linear velocity at the end of the last step, for its acceleration (the hinge springs' drive).
    last_linvel: Vector,
    /// How many times this car has been wrecked and rebuilt (P1-S04c): debris from an earlier incarnation belongs to the
    /// husk's wreck, not to the car that respawned.
    incarnation: u32,
    /// What took this incarnation's last part off, and whose car it was (the cause of a wheel-loss wreck).
    last_detach: Option<(damage::OtherBody, Option<u32>)>,
    /// The tick this incarnation first lost a wheel (R121): it drives on until `wheel_loss_respawn_s` later, then is
    /// wrecked and respawns fresh.
    wheel_lost_at: Option<u64>,
}

/// The catch plane's top, below the kill plane, and its half extent, m.
const CATCH_PLANE_BELOW_KILL_M: f32 = 10.0;
const CATCH_PLANE_HALF_M: f32 = 5000.0;

/// Angular damping on detached parts, 1/s (rolling resistance, so debris comes to rest and can sleep).
const DEBRIS_ANGULAR_DAMPING: f32 = 2.0;

/// What a part is, from the profile (P1-S04b): where its mass sits, how much, and how it swings.
#[derive(Clone, Copy)]
struct PartPhys {
    com: Vector,
    mass: f32,
    hinge: Option<Hinge>,
}

/// What a car looks like right now (for scenarios, receipts and the introspection surface).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CarState {
    pub position: [f32; 3],
    /// Quaternion x, y, z, w.
    pub rotation: [f32; 4],
    pub linvel: [f32; 3],
    pub angvel: [f32; 3],
    /// Speed along the car's forward (+z) axis, m/s (negative reversing).
    pub forward_speed: f32,
    /// The car's up axis' y component (1 upright, −1 on its roof).
    pub up_y: f32,
    /// Heading about +y, radians (0 = +z).
    pub heading: f32,
    pub wheels_in_contact: u8,
    pub sleeping: bool,
}

/// One wheel right now (front +x, front −x, rear +x, rear −x), for traces and outcome signatures.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WheelState {
    pub in_contact: bool,
    pub suspension_length: f32,
    pub suspension_force: f32,
    pub forward_impulse: f32,
    pub side_impulse: f32,
    /// Spin angle, radians.
    pub rotation: f32,
    pub steering: f32,
    /// Slip angle at the hard point, degrees: the angle between the wheel's heading and its ground velocity (0 below
    /// 0.5 m/s or off the ground).
    pub slip_deg: f32,
}

pub struct Sim {
    world: PhysicsWorld,
    /// One profile per roster vehicle (R123), indexed by a car's `vehicle`; a car is built from and driven by its own.
    profiles: Vec<VehicleProfile>,
    /// The ground classes under the wheels (per-surface grip).
    terrain: Terrain,
    cars: Vec<Car>,
    props: Vec<RigidBodyHandle>,
    /// The ground footprints of the map's solid dressing (barriers, posts, buildings): a placed car must clear them too,
    /// since protection ghosts a car against cars and debris only and terrain and barriers stay solid.
    statics: Vec<Rect>,
    /// What each prop is, for renderers (P1-S08: map props and debris, or dropped cones).
    prop_kinds: Vec<PropKind>,
    /// Which car's part each `Part` debris body is, by prop index (P1-S04b).
    part_debris: std::collections::BTreeMap<u32, (u32, u8, u32)>,
    /// Each husk body's prop index → the car it was (P1-S04c).
    husks: std::collections::BTreeMap<u32, u32>,
    /// Fresh part debris and the tick it starts colliding with cars again.
    fresh_debris: Vec<(u32, u64)>,
    /// Per-part mass, centre of mass and hinge, from the profile.
    part_phys: Vec<Vec<PartPhys>>,
    /// Work the sim itself authorises into the bodies, J: engine force, air control, flip assist, wheelie lift, the roll
    /// correction and detach kicks. The energy accounting subtracts it (`Sim::energy_j`).
    ledger: f64,
    /// Accepted ACTION utilities, with the tick they fired at (P1-S08).
    utility_events: Vec<(u64, UtilityEvent)>,
    /// Damage episodes (P1-S04a): the open ones, prop owners, every finished record and part-state change.
    episodes: Episodes,
    damage_events: Vec<(u64, DamageEvent)>,
    /// The bodies' state before each step, for the contacts' closing speeds.
    pre_step: PreStep,
    tick: u64,
    rng: Rng,
    journal: Journal,
    race: Race,
    line: RouteLine,
    slots: Vec<SpawnPose>,
    path: Path,
}

fn yaw_rotation(yaw_cdeg: i32) -> Vector {
    Vector::new(0.0, -(yaw_cdeg as f32 / 100.0).to_radians(), 0.0)
}

fn proxy_collider(fp: Footprint) -> (ColliderBuilder, f32) {
    match fp {
        Footprint::Rect { x, z, height } => {
            let (hx, hy, hz) = (x as f32 / 2000.0, height as f32 / 2000.0, z as f32 / 2000.0);
            (ColliderBuilder::cuboid(hx, hy, hz), hy)
        }
        Footprint::Circle { radius, height } => {
            let hy = height as f32 / 2000.0;
            (ColliderBuilder::cylinder(hy, radius as f32 / 1000.0), hy)
        }
    }
}

impl Sim {
    /// A world for `map` (already validated and canonical) with `registry`'s collider proxies, seeded with `seed`.
    pub fn new(map: &LoadedMap, registry: &Registry, seed: u64, profile: VehicleProfile) -> Self {
        Self::with_profiles(map, registry, seed, vec![profile])
    }

    /// A world whose cars each pick one of `profiles` (R123): `spawn_car_as` takes an index into this list.
    pub fn with_profiles(
        map: &LoadedMap,
        registry: &Registry,
        seed: u64,
        profiles: Vec<VehicleProfile>,
    ) -> Self {
        assert!(
            !profiles.is_empty(),
            "a sim needs at least one vehicle profile"
        );
        let mut world = PhysicsWorld::new();
        world.integration_parameters.dt = DT;
        let m = &map.map;

        // Terrain: Rapier's heightfield is centred on its collider, rows along z and columns along x.
        let t = &m.terrain;
        let (cols, rows) = (t.cols as usize, t.rows as usize);
        let spacing = t.spacing as f32 / 1000.0;
        let heights = Array2::from_fn(rows, cols, |i, j| {
            f32::from(t.heights[i * cols + j]) / 100.0
        });
        let (sx, sz) = ((cols - 1) as f32 * spacing, (rows - 1) as f32 * spacing);
        let ground = ColliderBuilder::heightfield(heights, Vector::new(sx, 1.0, sz))
            .translation(Vector::new(
                t.origin_x as f32 / 1000.0 + sx / 2.0,
                0.0,
                t.origin_z as f32 / 1000.0 + sz / 2.0,
            ))
            .friction(0.9)
            .collision_groups(TERRAIN_GROUPS);
        world.insert_collider(ground, None);

        // Sharp jumps (br-gw74.7.1): the ramp, table and landing ramp are the exact triangles of `jj_map::jump`, not a 2.5 m
        // grid's rounding of them. They are ground to the car (the terrain's groups).
        for f in &m.features {
            if let Some((verts, tris)) = jj_map::jump::jump_mesh(m, f) {
                let pts: Vec<Vector> = verts
                    .iter()
                    .map(|p| Vector::new(p[0] as f32, p[1] as f32, p[2] as f32))
                    .collect();
                if let Ok(b) =
                    ColliderBuilder::trimesh_with_flags(pts, tris, TriMeshFlags::FIX_INTERNAL_EDGES)
                {
                    world.insert_collider(b.friction(0.9).collision_groups(TERRAIN_GROUPS), None);
                }
            }
        }

        // A solid catch plane well under the kill plane (P1-S04c): whatever falls out of the map (a wreck's husk and parts, a
        // prop knocked off the edge) comes to rest on it instead of falling for ever, so a husk is never despawned and
        // never costs more than a sleeping body.
        let bounds = &m.header.bounds;
        let (cx, cz) = (
            (bounds.min_x + bounds.max_x) as f32 / 2000.0,
            (bounds.min_z + bounds.max_z) as f32 / 2000.0,
        );
        let plane_top = bounds.kill_y as f32 / 1000.0 - CATCH_PLANE_BELOW_KILL_M;
        world.insert_collider(
            ColliderBuilder::cuboid(CATCH_PLANE_HALF_M, 1.0, CATCH_PLANE_HALF_M)
                .translation(Vector::new(cx, plane_top - 1.0, cz))
                .friction(0.9)
                .collision_groups(WORLD_GROUPS),
            None,
        );

        // Static dressing with `collides`: the registry's collider proxies, standing on the ground at their pose.
        let mut statics = Vec::new();
        for d in m.dressing.iter().filter(|d| d.collides) {
            let Some(fp) = registry
                .get(&d.kit_piece)
                .and_then(|p| p.footprint(&d.params))
            else {
                continue;
            };
            let theta = -(d.pose.yaw as f32 / 100.0).to_radians();
            statics.push(match fp {
                Footprint::Rect { x, z, .. } => Rect {
                    x: d.pose.x as f32 / 1000.0,
                    z: d.pose.z as f32 / 1000.0,
                    heading: theta,
                    half_w: x as f32 / 2000.0,
                    half_l: z as f32 / 2000.0,
                },
                Footprint::Circle { radius, .. } => Rect {
                    x: d.pose.x as f32 / 1000.0,
                    z: d.pose.z as f32 / 1000.0,
                    heading: 0.0,
                    half_w: radius as f32 / 1000.0,
                    half_l: radius as f32 / 1000.0,
                },
            });
            let (builder, hy) = proxy_collider(fp);
            let c = builder
                .translation(Vector::new(
                    d.pose.x as f32 / 1000.0,
                    d.pose.y as f32 / 1000.0 + hy,
                    d.pose.z as f32 / 1000.0,
                ))
                .rotation(yaw_rotation(d.pose.yaw))
                .collision_groups(WORLD_GROUPS);
            world.insert_collider(c, None);
        }

        // Props: initial dynamic bodies (cones, bins) with their proxies; they stay for the round.
        let mut props = Vec::new();
        for p in &m.props {
            let Some(fp) = registry
                .get(&p.kit_piece)
                .and_then(|k| k.footprint(&p.params))
            else {
                continue;
            };
            let (builder, hy) = proxy_collider(fp);
            let body = RigidBodyBuilder::dynamic()
                .translation(Vector::new(
                    p.pose.x as f32 / 1000.0,
                    p.pose.y as f32 / 1000.0 + hy,
                    p.pose.z as f32 / 1000.0,
                ))
                .rotation(yaw_rotation(p.pose.yaw));
            let (h, _) = world.insert(
                body.user_data(TAG_PROP | props.len() as u128),
                builder.density(80.0).collision_groups(PROP_GROUPS),
            );
            props.push(h);
        }

        let journal = Journal {
            seed,
            map_hash: map.hash,
            setup: Vec::new(),
            entries: Vec::new(),
        };
        let phys = profiles.iter().map(part_phys).collect();
        Self {
            world,
            profiles,
            terrain: m.terrain.clone(),
            cars: Vec::new(),
            prop_kinds: vec![PropKind::Debris; props.len()],
            part_debris: std::collections::BTreeMap::new(),
            husks: std::collections::BTreeMap::new(),
            fresh_debris: Vec::new(),
            part_phys: phys,
            ledger: 0.0,
            utility_events: Vec::new(),
            props,
            statics,
            episodes: Episodes::default(),
            damage_events: Vec::new(),
            pre_step: PreStep::default(),
            tick: 0,
            rng: Rng::stream(seed, "sim"),
            journal,
            race: Race::new(Course::new(map)),
            line: RouteLine::new(map),
            slots: corridor_slots(map, &RouteLine::new(map)),
            path: Path::new(map),
        }
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    pub fn rng(&mut self) -> &mut Rng {
        &mut self.rng
    }

    pub fn cars(&self) -> impl Iterator<Item = CarId> + '_ {
        (0..self.cars.len() as u32).map(CarId)
    }

    /// Spawns a car (a journaled setup command) and returns its id.
    pub fn spawn_car(&mut self, pose: SpawnPose) -> CarId {
        self.spawn_car_as(pose, 0)
    }

    /// Spawns a car built from profile `vehicle` (R123: an index into the profiles the sim was made with; one past the
    /// end is clamped to the last, so an unknown pick still drives). Vehicle 0 journals as the original `SpawnCar`, so
    /// single-vehicle journals are unchanged.
    pub fn spawn_car_as(&mut self, pose: SpawnPose, vehicle: usize) -> CarId {
        let vehicle = vehicle.min(self.profiles.len() - 1);
        let id = CarId(self.cars.len() as u32);
        let cmd = if vehicle == 0 {
            Setup::SpawnCar { car: id.0, pose }
        } else {
            Setup::SpawnCarAs {
                car: id.0,
                pose,
                vehicle: vehicle as u16,
            }
        };
        self.journal.setup.push((self.tick, cmd));
        self.add_car(pose, vehicle);
        self.race.add_car(pose);
        self.protect(id);
        id
    }

    /// The start grid for `n` more cars (any `n`): each takes the next grid pose, the overflow under protection.
    pub fn spawn_grid(&mut self, n: usize) -> Vec<CarId> {
        (0..n)
            .map(|_| self.spawn_car(self.grid_pose(self.cars.len())))
            .collect()
    }

    /// The start grid for one more car per entry of `vehicles`, each built from that profile index (R123).
    pub fn spawn_grid_as(&mut self, vehicles: &[usize]) -> Vec<CarId> {
        vehicles
            .iter()
            .map(|&v| self.spawn_car_as(self.grid_pose(self.cars.len()), v))
            .collect()
    }

    /// The `k`-th car's start-grid pose.
    pub fn grid_pose(&self, k: usize) -> SpawnPose {
        grid_pose(&self.slots, k)
    }

    /// A seat joining mid-round (a journaled command): ~3 s of route behind the last still-racing car with that
    /// car's gate state, marked late, immediately controllable under protection. Before the race has that much
    /// history, it takes the next grid slot.
    pub fn drop_in(&mut self) -> CarId {
        self.drop_in_as(0)
    }

    /// [`Sim::drop_in`] for a car built from profile `vehicle` (R123).
    pub fn drop_in_as(&mut self, vehicle: usize) -> CarId {
        let vehicle = vehicle.min(self.profiles.len() - 1);
        let cmd = if vehicle == 0 {
            Setup::DropIn
        } else {
            Setup::DropInAs {
                vehicle: vehicle as u16,
            }
        };
        self.journal.setup.push((self.tick, cmd));
        let id = CarId(self.cars.len() as u32);
        match self.race.drop_in_progress(self.tick) {
            Some(p) => {
                let target = self
                    .line
                    .pose_at(self.race.finish_s() + p, 0.0, SPAWN_LIFT_M);
                let pose = self.clear_pose_near(None, target, vehicle);
                self.add_car(pose, vehicle);
                self.race.add_late_car(pose, p, self.tick);
            }
            None => {
                let pose = self.grid_pose(self.cars.len());
                self.add_car(pose, vehicle);
                if self.race.started_at.is_some() {
                    self.race.add_late_car(pose, -1.0, self.tick);
                } else {
                    self.race.add_car(pose);
                }
            }
        }
        self.protect(id);
        id
    }

    /// A dynamic debris body (a journaled setup command): a cuboid with half extents `half`, resting at `pose`. It
    /// stays for the round (R58).
    pub fn spawn_debris(&mut self, pose: SpawnPose, half: [f32; 3]) {
        self.journal
            .setup
            .push((self.tick, Setup::SpawnDebris { pose, half }));
        let body = RigidBodyBuilder::dynamic()
            .translation(Vector::new(pose.x, pose.y, pose.z))
            .rotation(Vector::new(0.0, pose.heading, 0.0))
            .user_data(TAG_PROP | self.props.len() as u128);
        let collider = ColliderBuilder::cuboid(half[0], half[1], half[2])
            .density(150.0)
            .collision_groups(PROP_GROUPS);
        let (h, _) = self.world.insert(body, collider);
        self.props.push(h);
        self.prop_kinds.push(PropKind::Debris);
    }

    /// An ACTION utility (P1-S08, a journaled command): jj-input's deliberate up or down sector entry. Up fires the
    /// "OI!" flash (an event for the host's cue); down drops a traffic cone [`rules::CONE_BEHIND_M`] behind the rear
    /// bumper, at rest, a light dynamic prop that stays for the round (R58). Refused (false) while that utility's
    /// cooldown runs (game time), while the car is held, or for a finished car.
    pub fn utility(&mut self, car: CarId, kind: UtilityKind) -> bool {
        self.journal
            .setup
            .push((self.tick, Setup::Utility { car: car.0, kind }));
        let held = self.race.is_held(car.0, self.tick) || self.race.is_finished(car.0);
        let tick = self.tick;
        let rear_z = self
            .cars
            .get(car.0 as usize)
            .map_or(0.0, |c| self.profiles[c.model].hull_bounds().0[2]);
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return false;
        };
        let i = kind.index();
        if held || tick < c.action.utility_ready[i] {
            return false;
        }
        c.action.utility_ready[i] = tick + utility::cooldown_ticks(kind);
        c.action.utility_fired[i] += 1;
        match kind {
            UtilityKind::Forward => self
                .utility_events
                .push((tick, UtilityEvent::Oi { car: car.0 })),
            UtilityKind::Rear => {
                let Some(b) = self.world.bodies.get(c.body) else {
                    return false;
                };
                let iso = *b.position();
                // The body frame is the car's vehicle space: origin on the ground between the axles, +z forward.
                let base = iso
                    * Vector::new(
                        0.0,
                        0.0,
                        rear_z - rules::CONE_BEHIND_M - rules::CONE_RADIUS_M,
                    );
                let heading = {
                    let fwd = iso.rotation * Vector::Z;
                    libm::atan2f(fwd.x, fwd.z)
                };
                let body = RigidBodyBuilder::dynamic()
                    .translation(Vector::new(
                        base.x,
                        base.y + rules::CONE_HALF_HEIGHT_M + 0.02,
                        base.z,
                    ))
                    .rotation(Vector::new(0.0, heading, 0.0))
                    .user_data(TAG_PROP | self.props.len() as u128);
                let collider =
                    ColliderBuilder::cone(rules::CONE_HALF_HEIGHT_M, rules::CONE_RADIUS_M)
                        .density(utility::cone_density())
                        .friction(0.7)
                        .collision_groups(PROP_GROUPS);
                let (h, _) = self.world.insert(body, collider);
                let prop = self.props.len() as u32;
                self.props.push(h);
                self.prop_kinds.push(PropKind::Cone);
                self.utility_events
                    .push((tick, UtilityEvent::Cone { car: car.0, prop }));
            }
        }
        true
    }

    /// Accepted ACTION utilities so far, with their ticks (P1-S08).
    pub fn utility_events(&self) -> &[(u64, UtilityEvent)] {
        &self.utility_events
    }

    /// What each prop is, in the order of [`Sim::debris_poses`] (P1-S08).
    pub fn prop_kinds(&self) -> &[PropKind] {
        &self.prop_kinds
    }

    /// The autopilot takes `car` (`on`), or hands it back to its player over a short blend (a journaled command; the
    /// session decides when, on fresh deliberate input: see [`crate::autopilot::is_deliberate`]).
    pub fn set_autopilot(&mut self, car: CarId, on: bool) {
        self.journal
            .setup
            .push((self.tick, Setup::Autopilot { car: car.0, on }));
        let (seed, tick) = (self.journal.seed, self.tick);
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return;
        };
        match (on, c.autopilot.as_mut()) {
            (true, Some(ap)) if ap.mode() != Mode::Handback => {}
            (true, _) => c.autopilot = Some(Autopilot::new(seed, car.0, Mode::Driving)),
            (false, Some(ap)) if ap.mode() != Mode::Handback => ap.hand_back(tick),
            (false, _) => {}
        }
    }

    /// The autopilot's last decision for `car`, if it's driving (target, look-ahead, target speed, stuck time).
    pub fn autopilot_state(&self, car: CarId) -> Option<AutopilotState> {
        self.cars.get(car.0 as usize)?.autopilot.as_ref()?.state()
    }

    /// The ground class under car `car` (for the engine audio's surface layer): 0 tarmac, 1 dirt (packed dirt), 2 gravel (gravel,
    /// rock), 3 off track (R124: the host tells off-track from dirt).
    pub fn car_surface(&self, car: CarId) -> Option<u8> {
        use jj_map::model::Surface;
        let b = self.world.bodies.get(self.cars.get(car.0 as usize)?.body)?;
        let t = b.position().translation;
        Some(match vehicle::surface_at(&self.terrain, t.x, t.z) {
            Surface::Tarmac => 0,
            s => surface::audio_class(s),
        })
    }

    /// The car's life: bumps on every teleport or respawn, so interpolation never spans one.
    pub fn car_life(&self, car: CarId) -> Option<u32> {
        self.cars.get(car.0 as usize).map(|c| c.life)
    }

    /// Every debris body's position and rotation (props and injected debris), in creation order.
    pub fn debris_poses(&self) -> Vec<([f32; 3], [f32; 4])> {
        self.props
            .iter()
            .filter_map(|&h| self.world.bodies.get(h))
            .map(|b| {
                let (t, r) = (b.position().translation, b.position().rotation);
                ([t.x, t.y, t.z], [r.x, r.y, r.z, r.w])
            })
            .collect()
    }

    pub fn has_autopilot(&self, car: CarId) -> bool {
        self.cars
            .get(car.0 as usize)
            .is_some_and(|c| c.autopilot.is_some())
    }

    pub fn is_protected(&self, car: CarId) -> bool {
        self.cars
            .get(car.0 as usize)
            .is_some_and(|c| c.protected_since.is_some())
    }

    /// A car's ground footprint (chassis plus the clearance margin).
    pub fn footprint(&self, car: CarId) -> Option<Rect> {
        let c = self.cars.get(car.0 as usize)?;
        let b = self.world.bodies.get(c.body)?;
        let (t, fwd) = (b.position().translation, b.position().rotation * Vector::Z);
        let half = self.profiles[c.model].chassis_half();
        Some(Rect {
            x: t.x,
            z: t.z,
            heading: libm::atan2f(fwd.x, fwd.z),
            half_w: half[0] + CLEARANCE_M,
            half_l: half[2] + CLEARANCE_M,
        })
    }

    /// Every debris body's ground footprint (its collider's bounding box).
    pub fn debris_footprints(&self) -> Vec<Rect> {
        self.props
            .iter()
            .filter_map(|&h| self.world.bodies.get(h))
            .flat_map(|b| {
                b.colliders()
                    .iter()
                    .filter_map(|&c| self.world.colliders.get(c))
            })
            .map(|c| {
                let aabb = c.compute_aabb();
                let (mid, half) = (aabb.center(), aabb.half_extents());
                Rect {
                    x: mid.x,
                    z: mid.z,
                    heading: 0.0,
                    half_w: half.x,
                    half_l: half.z,
                }
            })
            .collect()
    }

    fn pose_footprint(&self, pose: SpawnPose, vehicle: usize) -> Rect {
        let half = self.profiles[vehicle].chassis_half();
        Rect {
            x: pose.x,
            z: pose.z,
            heading: pose.heading,
            half_w: half[0] + CLEARANCE_M,
            half_l: half[2] + CLEARANCE_M,
        }
    }

    /// The first clear pose near `target` (itself, then steps back along its heading and to either side), checked
    /// against every other car, debris and solid dressing; `target` itself if none is clear (the car then waits out protection).
    fn clear_pose_near(
        &self,
        exclude: Option<CarId>,
        target: SpawnPose,
        vehicle: usize,
    ) -> SpawnPose {
        let others: Vec<Rect> = self
            .cars()
            .filter(|&c| Some(c) != exclude)
            .filter_map(|c| self.footprint(c))
            .chain(self.debris_footprints())
            .chain(self.statics.iter().copied())
            .collect();
        for step in 0..SEARCH_STEPS {
            for side in SEARCH_LATERAL_M {
                let pose = offset(target, step as f32 * SEARCH_STEP_M, side);
                let fp = self.pose_footprint(pose, vehicle);
                if !others.iter().any(|o| overlaps(&fp, o)) {
                    return pose;
                }
            }
        }
        target
    }

    fn protect(&mut self, car: CarId) {
        let tick = self.tick;
        if let Some(c) = self.cars.get_mut(car.0 as usize) {
            c.protected_since = Some(tick);
            for (i, &h) in c.parts.iter().enumerate() {
                if let Some(col) = self.world.colliders.get_mut(h) {
                    col.set_collision_groups(Solidity::Protected.groups(damage::is_wheel(i)));
                }
            }
        }
    }

    /// Sets every one of car `i`'s part colliders to `solidity`'s groups.
    fn set_solidity(&mut self, i: usize, solidity: Solidity) {
        for (part, &h) in self.cars[i].parts.iter().enumerate() {
            if let Some(col) = self.world.colliders.get_mut(h) {
                col.set_collision_groups(solidity.groups(damage::is_wheel(part)));
            }
        }
    }

    /// Ends spawn protection for cars that have had 1.5 s and overlap no solid car, no lower-id protected car and no
    /// debris; the rest stay protected and are checked again next tick.
    fn settle_protection(&mut self) {
        let tick = self.tick;
        let prints: Vec<Option<Rect>> = self.cars().map(|c| self.footprint(c)).collect();
        let debris = self.debris_footprints();
        for i in 0..self.cars.len() {
            let Some(since) = self.cars[i].protected_since else {
                continue;
            };
            let Some(me) = prints[i] else { continue };
            if tick < since + PROTECT_TICKS {
                continue;
            }
            let blocked = prints.iter().enumerate().any(|(j, f)| {
                j != i
                    && (self.cars[j].protected_since.is_none() || j < i)
                    && f.is_some_and(|f| overlaps(&me, &f))
            }) || debris.iter().any(|d| overlaps(&me, d));
            if !blocked {
                let solidity = if self.race.is_finished(i as u32) {
                    Solidity::Ghost
                } else {
                    Solidity::Racing
                };
                self.cars[i].protected_since = None;
                self.set_solidity(i, solidity);
            }
        }
    }

    /// Teleports `car` to `pose`, rolled `roll` radians about its forward axis, with `linvel` and no spin (a journaled
    /// setup command, so the run still replays). A placement never crosses a race gate.
    pub fn place_car(&mut self, car: CarId, pose: SpawnPose, roll: f32, linvel: [f32; 3]) {
        if self.cars.get(car.0 as usize).is_none() {
            return;
        }
        self.journal.setup.push((
            self.tick,
            Setup::PlaceCar {
                car: car.0,
                pose,
                roll,
                linvel,
            },
        ));
        self.teleport(car, pose, roll, linvel);
    }

    fn teleport(&mut self, car: CarId, pose: SpawnPose, roll: f32, linvel: [f32; 3]) {
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return;
        };
        c.life = c.life.wrapping_add(1);
        let c = &self.cars[car.0 as usize];
        let g = self.world.gravity;
        let mut moved = 0.0f64;
        if let Some(b) = self.world.bodies.get_mut(c.body) {
            let before = f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g));
            let rotation = Rotation::from_axis_angle(Vector::Y, pose.heading)
                * Rotation::from_axis_angle(Vector::Z, roll);
            b.set_position(
                Pose::from_parts(Vector::new(pose.x, pose.y, pose.z), rotation),
                true,
            );
            b.set_linvel(Vector::new(linvel[0], linvel[1], linvel[2]), true);
            b.set_angvel(Vector::ZERO, true);
            self.cars[car.0 as usize].last_linvel = Vector::new(linvel[0], linvel[1], linvel[2]);
            // A teleport (placement, respawn) is setup, not physics: the energy it gives or takes is authorised.
            let b = &self.world.bodies[self.cars[car.0 as usize].body];
            moved =
                f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g)) - before;
        }
        self.ledger += moved;
        self.race.placed(car.0);
    }

    /// The race starts now with `laps` laps (a journaled command: countdown completion, P1-S05).
    pub fn start_race(&mut self, laps: u32) {
        self.journal
            .setup
            .push((self.tick, Setup::StartRace { laps }));
        self.race.start(self.tick, laps);
    }

    /// Ends the race now, as the finish window closing would (a journaled command, R90 "settable": scenarios and the test
    /// surface can finish a round on demand). Returns whether it ended.
    pub fn end_race_now(&mut self) -> bool {
        self.journal.setup.push((self.tick, Setup::EndRace));
        self.race.end_now(self.tick)
    }

    /// A player's Recover button (a journaled command). Returns whether it was accepted: after 1 s under 3 m/s, or when
    /// inverted; the car then respawns at its anchor and is held for the 2 s penalty.
    pub fn recover(&mut self, car: CarId) -> bool {
        self.journal
            .setup
            .push((self.tick, Setup::Recover { car: car.0 }));
        match self.race.recover(self.tick, car.0) {
            Some(effect) => {
                self.apply(effect);
                true
            }
            None => false,
        }
    }

    /// A wheelie release (P1-S03c, R64) with jj-input's measured preload. Journaled; refused (false) unless at least 3
    /// wheels are on the ground and the car isn't held. Lift scales with preload (full at
    /// `wheelie_full_preload_ms`) as an upward impulse at the front axle, and a well-timed release (at least
    /// `wheelie_good_min_ms`) adds drive for `wheelie_drive_s`. With the front wheels up, the car can't steer much: they
    /// have no grip in the air.
    pub fn wheelie(&mut self, car: CarId, preload_ms: u16) -> bool {
        self.journal.setup.push((
            self.tick,
            Setup::Wheelie {
                car: car.0,
                preload_ms,
            },
        ));
        let Some(vehicle) = self.cars.get(car.0 as usize).map(|c| c.model) else {
            return false;
        };
        let t = self.profiles[vehicle].tuning.clone();
        let front_z = self.profiles[vehicle].axle_front_z();
        let held = self.race.is_held(car.0, self.tick);
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return false;
        };
        let grounded = c
            .vehicle
            .wheels()
            .iter()
            .filter(|w| w.raycast_info().is_in_contact)
            .count();
        if grounded < 3 || held || preload_ms == 0 {
            return false;
        }
        // The launch is on a cooldown, and a car that pull-and-held into reverse is reversing, not launching.
        if self.tick < c.action.wheelie_ready
            || c.speed_history
                .back()
                .is_some_and(|&v| v < -t.wheelie_max_reverse_mps)
        {
            return false;
        }
        c.action.wheelie_ready =
            self.tick + libm::roundf(t.wheelie_cooldown_s * TICK_HZ as f32) as u64;
        let Some(b) = self.world.bodies.get_mut(c.body) else {
            return false;
        };
        let lift = (f32::from(preload_ms) / t.wheelie_full_preload_ms).min(1.0);
        let iso = *b.position();
        let front = iso * Vector::new(0.0, 0.0, front_z);
        let up = iso.rotation * Vector::Y;
        let impulse = up * (t.wheelie_lift_impulse * lift);
        self.ledger += f64::from(impulse.dot(b.velocity_at_point(front)));
        b.apply_impulse_at_point(impulse, front, true);
        if f32::from(preload_ms) >= t.wheelie_good_min_ms {
            c.action.wheelie_ticks = libm::roundf(t.wheelie_drive_s * TICK_HZ as f32) as u32;
            if t.wheelie_launch_reward > 0.0 {
                // The launch repays the pull: the speed the brakes shed over the first `wheelie_full_preload_ms` of it, plus
                // what the engine would have added meanwhile, times the reward. A pull held past the full-lift point costs
                // more time and is repaid no more (spec: lift is greatest at 0.4 s), so late and held releases lose.
                let tick_ms = 1000.0 / TICK_HZ as f32;
                let pull_ticks = libm::roundf(f32::from(preload_ms) / tick_ms) as usize;
                let paid_ticks =
                    (libm::roundf(t.wheelie_full_preload_ms.min(f32::from(preload_ms)) / tick_ms)
                        as usize)
                        .min(pull_ticks);
                let h = &c.speed_history;
                let at = |back: usize| {
                    h.len()
                        .checked_sub(1 + back)
                        .and_then(|i| h.get(i))
                        .copied()
                };
                let started = at(pull_ticks).or_else(|| h.front().copied()).unwrap_or(0.0);
                let paid = at(pull_ticks - paid_ticks)
                    .or_else(|| h.front().copied())
                    .unwrap_or(started);
                let shed = (started - paid).max(0.0);
                let engine = t.max_engine_force / t.mass * (paid_ticks as f32 / TICK_HZ as f32);
                let dv = t.wheelie_launch_reward * (shed + engine);
                let forward = iso.rotation * Vector::Z;
                let flat = Vector::new(forward.x, 0.0, forward.z).normalize_or_zero();
                let mass = b.mass();
                let before = b.linvel();
                b.apply_impulse(flat * (mass * dv), true);
                // Authorised work: the launch is the game giving the pull's cost back.
                self.ledger += f64::from(
                    0.5 * mass * ((before + flat * dv).length_squared() - before.length_squared()),
                );
            }
        }
        true
    }

    pub fn race(&self) -> &Race {
        &self.race
    }

    /// Whether `car` is a ghost (finished: touches only the world).
    pub fn is_ghost(&self, car: CarId) -> bool {
        self.cars
            .get(car.0 as usize)
            .and_then(|c| self.world.colliders.get(c.collider))
            .is_some_and(|c| c.collision_groups() == GHOST_GROUPS)
    }

    fn apply(&mut self, effect: Effect) {
        match effect {
            Effect::Respawn { car, pose, why } => {
                if matches!(
                    why,
                    Respawned::OutOfBounds | Respawned::FlipWreck | Respawned::WheelLoss
                ) {
                    self.wreck_car(car as usize, why);
                }
                // Through the placement service: a clear pose near the anchor, then spawn protection.
                let vehicle = self.cars[car as usize].model;
                let pose = self.clear_pose_near(Some(CarId(car)), pose, vehicle);
                self.teleport(CarId(car), pose, 0.0, [0.0; 3]);
                self.protect(CarId(car));
            }
            // R125: the hold is over, the car rolls off along its heading at a fraction of the planned speed there, and
            // its spawn protection (ghosted for cars) runs again from now.
            Effect::Roll { car } => {
                if let Some(st) = self.car_state(CarId(car)) {
                    let v = crate::race::RESPAWN_ROLL_FRACTION
                        * self.path.planned_speed(st.position[0], st.position[2]);
                    // `heading` is libm's (car_state): it feeds the physics here, so native and WASM step bit for bit.
                    let heading = st.heading;
                    let (sin, cos) = (libm::sinf(heading), libm::cosf(heading));
                    // Through teleport, at the pose it's at: the speed it's given is setup, booked in the ledger.
                    let pose = SpawnPose {
                        x: st.position[0],
                        y: st.position[1],
                        z: st.position[2],
                        heading,
                    };
                    self.teleport(CarId(car), pose, 0.0, [v * sin, 0.0, v * cos]);
                    self.protect(CarId(car));
                }
            }
            Effect::Ghost { car } => {
                // A protected car turns ghost (not solid) when its protection ends.
                if self
                    .cars
                    .get(car as usize)
                    .is_some_and(|c| c.protected_since.is_none())
                {
                    self.set_solidity(car as usize, Solidity::Ghost);
                }
                // A finished car coasts its cool-down laps on autopilot.
                let seed = self.journal.seed;
                if let Some(c) = self.cars.get_mut(car as usize) {
                    c.autopilot = Some(Autopilot::new(seed, car, Mode::CoolDown));
                }
            }
        }
    }

    /// Builds a car from the profile (P1-S03a): the body frame is the sidecar's vehicle space (origin on the ground
    /// between the axles), the chassis is the convex hull of the sidecar's core proxy with the sidecar's centre of mass,
    /// and the wheels hang from their sidecar pivots.
    fn add_car(&mut self, pose: SpawnPose, model: usize) {
        let p = &self.profiles[model];
        let t = &p.tuning;
        let body = RigidBodyBuilder::dynamic()
            .translation(Vector::new(pose.x, pose.y, pose.z))
            .rotation(Vector::new(0.0, pose.heading, 0.0))
            .linear_damping(t.linear_damping)
            .angular_damping(t.angular_damping)
            // Never asleep: Rapier's update_vehicle pumps suspension impulses into a sleeping chassis' velocity
            // without waking it (tests/rapier_api.rs), which would jolt the car when it woke.
            .can_sleep(false)
            .ccd_enabled(true)
            .user_data(TAG_CAR | self.cars.len() as u128);
        let (handle, collider) = self.world.insert(body, part_builder(p, damage::CORE));
        let mut parts = vec![collider];
        for i in 1..PARTS {
            parts.push(self.world.insert_collider(part_builder(p, i), Some(handle)));
        }

        let mut vehicle = DynamicRayCastVehicleController::new(handle);
        vehicle.index_up_axis = 1;
        vehicle.index_forward_axis = 2;
        let tuning = WheelTuning {
            suspension_stiffness: t.suspension_stiffness,
            suspension_compression: t.suspension_compression,
            suspension_damping: t.suspension_damping,
            max_suspension_travel: t.max_suspension_travel,
            side_friction_stiffness: t.side_friction_stiffness,
            friction_slip: t.friction_slip,
            max_suspension_force: t.max_suspension_force,
        };
        // Wheel order: FL, FR, RL, RR. In this right-handed frame (+y up, facing +z) +x is the car's left, as the
        // sidecar names them (P1-V02).
        for i in 0..4 {
            let [x, y, z] = p.hard_point(i);
            vehicle.add_wheel(
                Vector::new(x, y, z),
                Vector::new(0.0, -1.0, 0.0),
                Vector::new(-1.0, 0.0, 0.0),
                t.suspension_rest,
                p.geometry.wheel_radius,
                &tuning,
            );
        }
        self.cars.push(Car {
            model,
            body: handle,
            collider,
            parts,
            damage: CarDamage::new(&p.tuning.damage),
            vehicle,
            input: DriveInput::default(),
            protected_since: None,
            autopilot: None,
            applied: DriveInput::default(),
            life: 0,
            action: vehicle::ActionState::new(p),
            springs: [Spring::default(); PARTS],
            removed: [false; PARTS],
            speed_history: std::collections::VecDeque::new(),
            last_linvel: Vector::ZERO,
            incarnation: 0,
            last_detach: None,
            wheel_lost_at: None,
        });
    }

    /// Sets a car's controls from the next step on (journaled when they change).
    pub fn set_input(&mut self, car: CarId, input: DriveInput) {
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return;
        };
        if c.input != input {
            c.input = input;
            self.journal.entries.push(Entry {
                tick: self.tick,
                car: car.0,
                input,
            });
        }
    }

    /// Advances one fixed tick.
    pub fn step(&mut self) {
        let tick = self.tick;
        let mut stuck = Vec::new();
        for (i, car) in self.cars.iter_mut().enumerate() {
            let id = i as u32;
            // Each car is driven by its own profile (R123).
            let p = &self.profiles[car.model];
            let wheelbase = p.wheelbase();
            // A held car (the 2 s respawn penalty) gets no controls; an autopiloted one gets the autopilot's, blending
            // to the player's during a handback.
            let mut input = car.input;
            if let Some(ap) = car.autopilot.as_mut() {
                if ap.mode() == Mode::Handback {
                    match ap.blend(tick, car.input) {
                        Some(blended) => input = blended,
                        None => car.autopilot = None,
                    }
                } else if let Some(b) = self.world.bodies.get(car.body) {
                    let (t, fwd) = (b.position().translation, b.position().rotation * Vector::Z);
                    let pose = Pose2 {
                        x: t.x,
                        z: t.z,
                        heading: libm::atan2f(fwd.x, fwd.z),
                        forward_speed: b.linvel().dot(fwd),
                    };
                    let (out, recover) =
                        ap.drive(&self.path, pose, p.tuning.max_steer_rad, wheelbase, tick);
                    // The ACTION stick passes through (P1-S03b): an idle player's is neutral, a bot's or a scenario's
                    // boost and drift ride on the autopilot's line. Only DRIVE moving counts as taking back over.
                    input = DriveInput {
                        drift: car.input.drift,
                        boost: car.input.boost,
                        ..out
                    };
                    if recover {
                        stuck.push(id);
                    }
                }
            }
            if self.race.is_held(id, tick) {
                input = DriveInput::default();
            }
            car.applied = input;
            // The controls (P1-S03a, crate::vehicle): reverse near rest, speed-scaled steering, the grip of the
            // ground under each wheel, and air control while no wheel touches the ground.
            if let Some(b) = self.world.bodies.get_mut(car.body) {
                let iso = *b.position();
                let fwd = iso.rotation * Vector::Z;
                let forward_speed = b.linvel().dot(fwd);
                if car.speed_history.len() == SPEED_HISTORY_TICKS {
                    car.speed_history.pop_front();
                }
                car.speed_history.push_back(forward_speed);
                // The rear tyres' slip from last tick's contacts decides the drift's boost charge, so libm.
                let side = (iso.rotation * Vector::Y).cross(fwd);
                let rear_slip = car.vehicle.wheels()[2..]
                    .iter()
                    .filter(|w| w.raycast_info().is_in_contact)
                    .map(|w| {
                        let v = b.velocity_at_point(w.raycast_info().hard_point_ws);
                        let (vf, vs) = (v.dot(fwd), v.dot(side));
                        if libm::hypotf(vf, vs) < 0.5 {
                            0.0
                        } else {
                            libm::fabsf(libm::atan2f(vs, libm::fabsf(vf))).to_degrees()
                        }
                    })
                    .fold(0.0, f32::max);
                car.action
                    .update(p, input, rear_slip, b.linvel().length(), DT);
                let mut grip = [1.0; 4];
                let mut side_stiffness = [1.0; 4];
                for (i, g) in grip.iter_mut().enumerate() {
                    let [x, y, z] = p.geometry.wheels[i];
                    let at = iso * Vector::new(x, y, z);
                    let ground = vehicle::surface_at(&self.terrain, at.x, at.z);
                    *g = p.grip(ground);
                    // R124: the ground's slip curve (dirt resolves less of the sideways slip per tick).
                    side_stiffness[i] = p.tuning.side_friction_stiffness
                        * surface::table().tyre(ground).side_stiffness;
                }
                let commands =
                    vehicle::wheel_commands(p, input, car.action, forward_speed, grip, DT);
                let dt_ = &p.tuning.damage;
                let t_ = &p.tuning;
                for (i, (w, c)) in car
                    .vehicle
                    .wheels_mut()
                    .iter_mut()
                    .zip(commands)
                    .enumerate()
                {
                    w.steering = c.steering;
                    w.engine_force = c.engine_force;
                    w.brake = c.brake_impulse;
                    w.friction_slip = c.friction_slip;
                    w.side_friction_stiffness = side_stiffness[i];
                    match car.damage.state(damage::WHEEL_FL + i, dt_) {
                        PartState::Intact => w.max_suspension_force = t_.max_suspension_force,
                        // A loose wheel grips less.
                        PartState::Loose => {
                            w.friction_slip *= 1.0 - dt_.loose_wheel_grip_loss;
                            w.max_suspension_force = t_.max_suspension_force;
                        }
                        // A detached wheel is out of the vehicle controller: no suspension force, no grip, no drive
                        // (Rapier 0.36 has no remove-wheel API; tests/rapier_api.rs pins this), so its corner drops.
                        PartState::Detached => {
                            w.engine_force = 0.0;
                            w.brake = 0.0;
                            w.friction_slip = 0.0;
                            w.max_suspension_force = 0.0;
                        }
                    }
                    self.ledger += f64::from(w.engine_force * forward_speed * DT);
                }
                let airborne = car
                    .vehicle
                    .wheels()
                    .iter()
                    .all(|w| !w.raycast_info().is_in_contact);
                if airborne && !input.is_neutral() {
                    let [tx, ty, tz] = vehicle::air_torque(p, input);
                    let ti = iso.rotation * Vector::new(tx, ty, tz) * DT;
                    self.ledger += f64::from(ti.dot(b.angvel()));
                    b.apply_torque_impulse(ti, true);
                }
                // In the air the car levels itself (arcade, owner playtest 1: a held throttle over a real jump tipped
                // it onto its nose): a spring toward world-up on pitch and roll, damped, so the stick only biases the
                // attitude. Its work is authorised in the ledger like the stick's.
                let up = iso.rotation * Vector::Y;
                // Only in near-upright flight (a jump), never in a tumble: a car rolled past 45° is the flip assist's.
                if airborne
                    && p.tuning.air_level_torque > 0.0
                    && up.y > core::f32::consts::FRAC_1_SQRT_2
                {
                    let tilt = up.cross(Vector::Y);
                    let w = b.angvel();
                    let w_tilt = w - Vector::Y * w.dot(Vector::Y);
                    let ti = (tilt * p.tuning.air_level_torque
                        - w_tilt * p.tuning.air_level_damping)
                        * DT;
                    self.ledger += f64::from(ti.dot(w));
                    b.apply_torque_impulse(ti, true);
                }
            }
            // Only a positive engine force wakes a sleeping chassis in Rapier: wake it on any control input.
            if !input.is_neutral()
                && let Some(b) = self.world.bodies.get_mut(car.body)
                && b.is_sleeping()
            {
                b.wake_up(true);
            }
            // Flip assist (P1-S05): a self-righting torque, integrated once per tick as an impulse.
            if self.race.is_assisting(id)
                && let Some(b) = self.world.bodies.get_mut(car.body)
            {
                let r = b.position().rotation;
                let (up, fwd, w) = (r * Vector::Y, r * Vector::Z, b.angvel());
                let t =
                    Race::assist_torque([up.x, up.y, up.z], [fwd.x, fwd.y, fwd.z], [w.x, w.y, w.z]);
                let ti = Vector::new(t[0], t[1], t[2]) * DT;
                self.ledger += f64::from(ti.dot(b.angvel()));
                b.apply_torque_impulse(ti, true);
            }
            let rays = if car.protected_since.is_some() {
                PROTECTED_RAYS
            } else if self.race.is_finished(id) {
                GHOST_RAYS
            } else {
                CAR_RAYS
            };
            // A suspension ray that starts inside a solid it isn't standing on (a detached part lying across the wheel arch,
            // a car shoved into this one) would read "ground at distance 0": full suspension force, and the contact rises
            // with the car, so the chassis climbs and tips. A wheel's ray ignores any non-world collider that contains
            // its own origin; the colliders push apart on their own.
            let origins: Vec<Vector> = car
                .vehicle
                .wheels()
                .iter()
                .map(|w| w.raycast_info().hard_point_ws)
                .collect();
            let not_around_a_wheel = |_: ColliderHandle, c: &Collider| {
                c.collision_groups().memberships.contains(GROUP_WORLD)
                    || c.collision_groups().memberships.contains(GROUP_TERRAIN)
                    || !origins
                        .iter()
                        .any(|&o| c.shape().contains_point(c.position(), o))
            };
            let filter = QueryFilter::default()
                .exclude_rigid_body(car.body)
                .groups(rays)
                .predicate(&not_around_a_wheel);
            let queries = self.world.broad_phase.as_query_pipeline_mut(
                self.world.narrow_phase.query_dispatcher(),
                &mut self.world.bodies,
                &mut self.world.colliders,
                filter,
            );
            car.vehicle.update_vehicle(DT, queries);
            // R124 rolling drag: each wheel in contact drags against its ground velocity by the ground under it. One
            // impulse of force × dt per tick, never more than stops the wheel's quarter of the car.
            if let Some(b) = self.world.bodies.get_mut(car.body) {
                let quarter = b.mass() * 0.25;
                let mut ground = [(Vector::ZERO, Vector::ZERO); 4];
                let mut n = 0;
                for w in car.vehicle.wheels() {
                    let ri = w.raycast_info();
                    if !ri.is_in_contact || w.wheel_suspension_force <= 0.0 {
                        continue;
                    }
                    let at = ri.contact_point_ws;
                    let surf = vehicle::surface_at(&self.terrain, at.x, at.z);
                    let tyre = surface::table().tyre(surf);
                    let nrm = ri.contact_normal_ws;
                    // Along the wheel's rolling direction only: sideways slip is the tyre's grip, not rolling drag.
                    let fwd = b.position().rotation * Vector::Z;
                    let fwd = (fwd - nrm * fwd.dot(nrm)).normalize_or_zero();
                    let along = b.velocity_at_point(at).dot(fwd);
                    let speed = along.abs();
                    if speed < 1e-3 {
                        continue;
                    }
                    let load = w.wheel_suspension_force;
                    let force = load * (tyre.rolling_resistance + tyre.speed_drag * speed);
                    let impulse = (force * DT).min(quarter * speed);
                    ground[n] = (at, fwd * (-impulse * along.signum()));
                    n += 1;
                }
                // Drag acts through the centre of mass's height, not the ground: a drag at the contact patch would
                // pitch the nose down by its lever arm (R122: a car never dives).
                let up = b.position().rotation * Vector::Y;
                let com = b.center_of_mass();
                for &(at, j) in &ground[..n] {
                    let at = at + up * up.dot(com - at);
                    // Dissipative only (it opposes the velocity), so the energy ledger needs no entry.
                    b.apply_impulse_at_point(j, at, true);
                }
            }
            // Rapier applied each side impulse at a point moved (1 − 0.1) of its height up toward the centre of mass;
            // a `roll_influence` of r would have moved it (1 − r). The difference is a moment about the moved points:
            // (up · h · (r − 0.1)) × J per wheel, h the contact's height relative to the centre of mass.
            let extra = p.tuning.roll_influence - vehicle::ROLL_INFLUENCE_RAPIER;
            if extra != 0.0
                && let Some(b) = self.world.bodies.get_mut(car.body)
            {
                let up = b.position().rotation * Vector::Y;
                let com = b.center_of_mass();
                let mut torque = Vector::ZERO;
                for w in car.vehicle.wheels() {
                    let ri = w.raycast_info();
                    if !ri.is_in_contact || w.side_impulse == 0.0 {
                        continue;
                    }
                    let n = ri.contact_normal_ws;
                    let axle = (w.axle() - n * w.axle().dot(n)).normalize_or_zero();
                    let h = up.dot(ri.contact_point_ws - com);
                    torque += (up * (h * extra)).cross(axle * w.side_impulse);
                }
                self.ledger += f64::from(torque.dot(b.angvel()));
                b.apply_torque_impulse(torque, true);
            }
        }
        // A stuck autopilot presses Recover: a consequence of the state, so not journaled.
        for id in stuck {
            if let Some(effect) = self.race.recover(tick, id) {
                self.apply(effect);
            }
        }
        self.pre_step.capture(&self.world.bodies);
        self.world.step();
        self.tick += 1;
        self.step_damage();
        let views: Vec<crate::race::CarView> = self
            .cars
            .iter()
            .map(|c| {
                let b = &self.world.bodies[c.body];
                let (v, up) = (b.linvel(), b.position().rotation * Vector::Y);
                let t = b.position().translation;
                crate::race::CarView {
                    position: [t.x, t.y, t.z],
                    up_y: up.y,
                    speed: v.length(),
                }
            })
            .collect();
        for effect in self.race.update(self.tick, &views) {
            self.apply(effect);
        }
        self.check_wheel_wrecks();
        self.settle_protection();
    }

    /// Reads this step's contacts into damage episodes, then closes the ones whose window ran out (P1-S04a).
    fn step_damage(&mut self) {
        let cars: Vec<CarParts<'_>> = self
            .cars
            .iter()
            .enumerate()
            .map(|(i, c)| CarParts {
                car: i as u32,
                parts: &c.parts,
            })
            .collect();
        let ts: Vec<&crate::profile::DamageTuning> = self
            .cars
            .iter()
            .map(|c| &self.profiles[c.model].tuning.damage)
            .collect();
        self.episodes
            .scan(&self.world, &self.pre_step, &cars, &ts, self.tick);
        let mut health: Vec<CarDamage> = self.cars.iter().map(|c| c.damage.clone()).collect();
        let events = self.episodes.close(self.tick, &ts, &mut health);
        for (c, h) in self.cars.iter_mut().zip(health) {
            c.damage = h;
        }
        for e in &events {
            if let DamageEvent::PartDetached {
                car,
                cause,
                instigator,
                ..
            } = *e
                && let Some(c) = self.cars.get_mut(car as usize)
            {
                c.last_detach = Some((cause, instigator));
            }
        }
        self.damage_events
            .extend(events.into_iter().map(|e| (self.tick, e)));
        self.step_springs();
        self.detach_parts();
        self.clear_fresh_debris();
    }

    /// Integrates every loose part's hinge spring on the chassis' acceleration this tick (P1-S04b).
    fn step_springs(&mut self) {
        for car in &mut self.cars {
            let t = &self.profiles[car.model].tuning.damage;
            let part_phys = &self.part_phys[car.model];
            let Some(b) = self.world.bodies.get(car.body) else {
                continue;
            };
            // The chassis' acceleration over the whole tick (suspension, tyres, contacts and gravity); the part feels
            // gravity minus that, in vehicle space.
            let accel = (b.linvel() - car.last_linvel) / DT;
            car.last_linvel = b.linvel();
            let force = b.position().rotation.inverse() * (Vector::new(0.0, -9.81, 0.0) - accel);
            #[allow(clippy::needless_range_loop)]
            // `part` indexes the springs, the profile's parts and the health
            for part in 1..PARTS {
                let spring = &mut car.springs[part];
                match (car.damage.state(part, t), part_phys[part].hinge) {
                    (PartState::Loose, Some(h)) => {
                        spring.step(&h, force, t.spring_stiffness, t.spring_damping, DT);
                    }
                    // Intact is closed; detached has left.
                    _ => *spring = Spring::default(),
                }
            }
        }
    }

    /// Detaches every part whose health ran out (P1-S04b), at the end of the tick: its collider leaves the chassis and a
    /// dynamic debris body shaped like its sidecar proxy takes its place at the same pose, carrying its share of the mass
    /// and the chassis' velocity at its centre (`v + ω × r`) plus a small outward kick. The chassis' mass properties are
    /// recomputed. The debris stays a dynamic body for the round.
    fn detach_parts(&mut self) {
        for ci in 0..self.cars.len() {
            let t = self.profiles[self.cars[ci].model].tuning.damage.clone();
            for part in 1..PARTS {
                if self.cars[ci].removed[part]
                    || self.cars[ci].damage.state(part, &t) != PartState::Detached
                {
                    continue;
                }
                self.cars[ci].removed[part] = true;
                self.detach_part(ci, part, &t);
            }
        }
    }

    fn detach_part(&mut self, ci: usize, part: usize, t: &crate::profile::DamageTuning) {
        let (body, handle, core) = {
            let c = &self.cars[ci];
            (c.body, c.parts[part], c.collider)
        };
        let Some(b) = self.world.bodies.get(body) else {
            return;
        };
        let (iso, v, w, com) = (*b.position(), b.linvel(), b.angvel(), b.center_of_mass());
        self.world.colliders.remove(
            handle,
            &mut self.world.islands,
            &mut self.world.bodies,
            &mut self.world.soft_bodies,
            true,
        );
        // The chassis keeps the rest: total mass minus every part gone, the centre of mass moved off them, the
        // inertia scaled with the mass.
        let vehicle = self.cars[ci].model;
        let p = &self.profiles[vehicle];
        let part_phys = &self.part_phys[vehicle];
        let (m0, [cx, cy, cz]) = (p.tuning.mass, p.geometry.com);
        let (mut gone, mut moment) = (0.0f32, Vector::ZERO);
        for (i, &r) in self.cars[ci].removed.iter().enumerate() {
            if r {
                gone += part_phys[i].mass;
                moment += part_phys[i].com * part_phys[i].mass;
            }
        }
        let rest = (m0 - gone).max(1.0);
        let com_rest = (Vector::new(cx, cy, cz) * m0 - moment) / rest;
        let (lo, hi) = p.hull_bounds();
        let [w_, h_, l_] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        let k = rest / 12.0 * p.tuning.inertia_scale;
        let inertia = Vector::new(
            k * (h_ * h_ + l_ * l_),
            k * (w_ * w_ + l_ * l_),
            k * (w_ * w_ + h_ * h_),
        );
        if let Some(col) = self.world.colliders.get_mut(core) {
            col.set_mass_properties(MassProperties::new(com_rest, rest, inertia));
        }
        if let Some(b) = self.world.bodies.get_mut(body) {
            b.recompute_mass_properties_from_colliders(&self.world.colliders);
        }
        // The debris: the proxy's convex hull in vehicle space on a body at the chassis' pose, so a renderer draws the
        // part mesh at the body's pose. Fresh debris touches only the world until it has cleared the chassis.
        let phys = part_phys[part];
        let points: Vec<Vector> = p.geometry.parts[part]
            .points
            .iter()
            .map(|&[x, y, z]| Vector::new(x, y, z))
            .collect();
        let builder = ColliderBuilder::convex_hull(&points)
            .unwrap_or_else(|| ColliderBuilder::ball(0.05))
            .mass(phys.mass)
            .friction(0.6)
            .collision_groups(FRESH_DEBRIS_GROUPS);
        let idx = self.props.len() as u32;
        let com_world = iso * phys.com;
        let radial = com_world - com;
        let inherited = v + w.cross(radial);
        let kick = radial.normalize_or_zero() * t.detach_kick_mps;
        let body = RigidBodyBuilder::dynamic()
            .pose(iso)
            .linvel(inherited + kick)
            .angvel(w)
            // Rapier has no rolling friction, so a rounded part would roll on for ever and never sleep: a little angular
            // damping stands in for it (a loss, never a source).
            .angular_damping(DEBRIS_ANGULAR_DAMPING)
            .user_data(TAG_PROP | u128::from(idx));
        let (h, _) = self.world.insert(body, builder);
        // What the kick put in, authorised: ½m(|v + k|² − |v|²).
        let (v1, v0) = (inherited + kick, inherited);
        self.ledger += f64::from(0.5 * phys.mass * (v1.length_squared() - v0.length_squared()));
        self.props.push(h);
        self.prop_kinds.push(PropKind::Part);
        self.part_debris
            .insert(idx, (ci as u32, part as u8, self.cars[ci].incarnation));
        let until =
            self.tick + (libm::roundf(t.detach_clear_ms * 0.001 * TICK_HZ as f32) as u64).max(1);
        self.fresh_debris.push((idx, until));
    }

    /// A car that loses a wheel drives on for `wheel_loss_respawn_s`, then is wrecked and respawns as a fresh car (R121,
    /// owner playtest 1: a car on three wheels was too punishing; amends P1-S04c's two-wheel rule).
    fn check_wheel_wrecks(&mut self) {
        for ci in 0..self.cars.len() {
            let t = self.profiles[self.cars[ci].model].tuning.damage.clone();
            let after = libm::roundf(t.wheel_loss_respawn_s * TICK_HZ as f32) as u64;
            let gone = (damage::WHEEL_FL..PARTS)
                .any(|i| self.cars[ci].damage.state(i, &t) == PartState::Detached);
            if !gone {
                continue;
            }
            let since = *self.cars[ci].wheel_lost_at.get_or_insert(self.tick);
            if self.tick >= since + after
                && let Some(e) = self.race.wreck(self.tick, ci as u32, Respawned::WheelLoss)
            {
                self.apply(e);
            }
        }
    }

    /// The car that last hit car `ci` hard enough to count, within the last ten seconds.
    fn recent_instigator(&self, ci: usize) -> Option<u32> {
        let from = self.tick.saturating_sub(10 * u64::from(TICK_HZ));
        self.damage_events
            .iter()
            .rev()
            .take_while(|(t, _)| *t >= from)
            .find_map(|(_, e)| match e {
                DamageEvent::Episode(r) if r.car == ci as u32 => {
                    r.other_owner.map(|o| o.car).filter(|&c| c != ci as u32)
                }
                _ => None,
            })
    }

    /// Wrecks car `ci` (P1-S04c): every part still on it pops off as debris, its chassis stays where it is as a husk (a
    /// dynamic body for the round, never despawned), and the car itself is rebuilt fresh and intact for the respawn the
    /// caller places at its anchor (same identity, same progress). Wreck event, with its cause and instigator, follows.
    fn wreck_car(&mut self, ci: usize, why: Respawned) {
        let t = self.profiles[self.cars[ci].model].tuning.damage.clone();
        for part in 1..PARTS {
            if !self.cars[ci].removed[part] {
                self.cars[ci].damage.health[part] = 0.0;
                self.cars[ci].removed[part] = true;
                self.detach_part(ci, part, &t);
            }
        }
        self.spawn_husk(ci);
        self.rebuild_car(ci);
        let (wreck, cause, instigator) = match why {
            Respawned::OutOfBounds => (
                damage::WreckWhy::OutOfBounds,
                None,
                self.recent_instigator(ci),
            ),
            Respawned::FlipWreck => (damage::WreckWhy::Flipped, None, self.recent_instigator(ci)),
            _ => {
                let (cause, by) = self.cars[ci].last_detach.unzip();
                (damage::WreckWhy::WheelLoss, cause, by.flatten())
            }
        };
        self.cars[ci].last_detach = None;
        self.damage_events.push((
            self.tick,
            DamageEvent::Wrecked {
                car: ci as u32,
                why: wreck,
                cause,
                instigator,
            },
        ));
    }

    /// The wrecked chassis' core hull, as a dynamic body at its pose with its velocity.
    fn spawn_husk(&mut self, ci: usize) {
        let body = self.cars[ci].body;
        let Some(b) = self.world.bodies.get(body) else {
            return;
        };
        let (iso, v, w, com, mass) = (
            *b.position(),
            b.linvel(),
            b.angvel(),
            b.center_of_mass(),
            b.mass(),
        );
        let phys = self.part_phys[self.cars[ci].model][damage::CORE];
        let points: Vec<Vector> = self.profiles[self.cars[ci].model].geometry.parts[damage::CORE]
            .points
            .iter()
            .map(|&[x, y, z]| Vector::new(x, y, z))
            .collect();
        let builder = ColliderBuilder::convex_hull(&points)
            .unwrap_or_else(|| ColliderBuilder::ball(0.3))
            .mass(mass)
            .friction(0.6)
            .collision_groups(PROP_GROUPS);
        let idx = self.props.len() as u32;
        let radial = iso * phys.com - com;
        let hb = RigidBodyBuilder::dynamic()
            .pose(iso)
            .linvel(v + w.cross(radial))
            .angvel(w)
            .angular_damping(DEBRIS_ANGULAR_DAMPING)
            .user_data(TAG_PROP | u128::from(idx));
        let (h, _) = self.world.insert(hb, builder);
        // The husk is the old chassis: what it carries was the chassis' and moves on authorised.
        let g = self.world.gravity;
        if let Some(hb) = self.world.bodies.get(h) {
            self.ledger +=
                f64::from(hb.kinetic_energy() + hb.gravitational_potential_energy(DT, g));
        }
        self.props.push(h);
        self.prop_kinds.push(PropKind::Husk);
        self.husks.insert(idx, ci as u32);
    }

    /// Makes car `ci` a fresh intact car again: every part collider back on the chassis, the full mass properties,
    /// full health, closed springs. The car body, its vehicle controller and its identity are the same.
    fn rebuild_car(&mut self, ci: usize) {
        let body = self.cars[ci].body;
        let g = self.world.gravity;
        let energy = |sim: &Self| {
            sim.world.bodies.get(body).map_or(0.0, |b| {
                f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g))
            })
        };
        let before = energy(self);
        let vehicle = self.cars[ci].model;
        for i in 1..PARTS {
            let builder = part_builder(&self.profiles[vehicle], i)
                .collision_groups(Solidity::Protected.groups(damage::is_wheel(i)));
            self.cars[ci].parts[i] = self.world.insert_collider(builder, Some(body));
        }
        let core = self.cars[ci].collider;
        let mp = chassis_mass_props(&self.profiles[vehicle]);
        if let Some(col) = self.world.colliders.get_mut(core) {
            col.set_mass_properties(mp);
        }
        if let Some(b) = self.world.bodies.get_mut(body) {
            b.recompute_mass_properties_from_colliders(&self.world.colliders);
        }
        // The mass coming back is the respawn's, not the sim's doing.
        self.ledger += energy(self) - before;
        let c = &mut self.cars[ci];
        c.damage = CarDamage::new(&self.profiles[vehicle].tuning.damage);
        c.springs = [Spring::default(); PARTS];
        c.removed = [false; PARTS];
        c.incarnation += 1;
        c.wheel_lost_at = None;
    }

    /// Fresh debris that has had its clearing time, and no longer overlaps any car, collides with everything like any other
    /// prop. A part that came off a car at rest has only slid a few centimetres: it still lies across the chassis, and
    /// turning solid there would wedge it against its owner for ever (and shove the owner about: the car creeping up its
    /// own bumper). Like spawn protection, it ends only once clear of every car.
    fn clear_fresh_debris(&mut self) {
        let tick = self.tick;
        let mut keep = Vec::new();
        let cars: Vec<Rect> = self.cars().filter_map(|c| self.footprint(c)).collect();
        for &(idx, until) in &self.fresh_debris {
            if tick < until {
                keep.push((idx, until));
                continue;
            }
            let under = self
                .world
                .bodies
                .get(self.props[idx as usize])
                .into_iter()
                .flat_map(|b| b.colliders().iter())
                .filter_map(|&c| self.world.colliders.get(c))
                .any(|col| {
                    let aabb = col.compute_aabb();
                    let (mid, half) = (aabb.center(), aabb.half_extents());
                    let fp = Rect {
                        x: mid.x,
                        z: mid.z,
                        heading: 0.0,
                        half_w: half.x,
                        half_l: half.z,
                    };
                    cars.iter().any(|c| overlaps(&fp, c))
                });
            if under {
                keep.push((idx, until));
                continue;
            }
            if let Some(b) = self.world.bodies.get(self.props[idx as usize]) {
                for &c in b.colliders() {
                    if let Some(col) = self.world.colliders.get_mut(c) {
                        col.set_collision_groups(PROP_GROUPS);
                    }
                }
            }
        }
        self.fresh_debris = keep;
    }

    /// Sets a part's health (a journaled setup command, R90 "settable"): clamped to 0..its starting health. The core has
    /// none. The damage state, springs and detaching follow like after any hit.
    pub fn set_part_health(&mut self, car: CarId, part: u8, health: f32) {
        self.journal.setup.push((
            self.tick,
            Setup::PartHealth {
                car: car.0,
                part,
                health,
            },
        ));
        if let Some(c) = self.cars.get_mut(car.0 as usize)
            && (1..PARTS).contains(&usize::from(part))
        {
            let t = &self.profiles[c.model].tuning.damage;
            let i = usize::from(part);
            let was = c.damage.state(i, t);
            c.damage.health[i] = health.clamp(0.0, c.damage.start[i]);
            let now = c.damage.state(i, t);
            // A state change by command is a state change all the same, with no body to blame.
            if now != was {
                let (cause, instigator) = (damage::OtherBody::Scenery, None);
                let e = match now {
                    PartState::Detached => DamageEvent::PartDetached {
                        car: car.0,
                        part,
                        cause,
                        instigator,
                    },
                    _ => DamageEvent::PartLoose {
                        car: car.0,
                        part,
                        cause,
                        instigator,
                    },
                };
                self.damage_events.push((self.tick, e));
            }
        }
    }

    /// Wrecks `car` now, as the stuck-flip rule would (a journaled command, R90 "settable"): returns whether it was
    /// accepted (not during a hold, not for a finished car).
    pub fn wreck(&mut self, car: CarId) -> bool {
        self.journal
            .setup
            .push((self.tick, Setup::Wreck { car: car.0 }));
        match self.race.wreck(self.tick, car.0, Respawned::FlipWreck) {
            Some(effect) => {
                self.apply(effect);
                true
            }
            None => false,
        }
    }

    /// Every loose part's hinge angle, radians, in part order (0 when not loose).
    pub fn part_angles(&self, car: CarId) -> Option<[f32; PARTS]> {
        self.cars
            .get(car.0 as usize)
            .map(|c| std::array::from_fn(|i| c.springs[i].angle))
    }

    /// The part records for the snapshot (P1-S04b): every part that isn't intact, as `(car, part, state, hinge angle,
    /// debris body index)`, in car then part order. A detached part's pose is its debris body's (`debris_poses`).
    pub fn part_records(&self) -> Vec<(u32, u8, PartState, f32, Option<u32>)> {
        let mut out = Vec::new();
        for (ci, c) in self.cars.iter().enumerate() {
            let t = &self.profiles[c.model].tuning.damage;
            for part in 1..PARTS {
                let state = c.damage.state(part, t);
                if state == PartState::Intact {
                    continue;
                }
                let debris = self
                    .part_debris
                    .iter()
                    .find(|(_, v)| {
                        v.0 == ci as u32 && usize::from(v.1) == part && v.2 == c.incarnation
                    })
                    .map(|(&i, _)| i);
                out.push((ci as u32, part as u8, state, c.springs[part].angle, debris));
            }
        }
        out
    }

    /// The husks and the orphaned parts (those that came off a car since wrecked and rebuilt) for the snapshot (P1-S04c):
    /// `(car, part, debris body index)` in body order, `part` 255 for a husk. They are drawn on their own and stay for the
    /// round; a part of a living car is a part record instead.
    pub fn piece_records(&self) -> Vec<(u32, u8, u32)> {
        let mut out = Vec::new();
        for i in 0..self.props.len() as u32 {
            if let Some(&car) = self.husks.get(&i) {
                out.push((car, 255, i));
            } else if let Some(&(car, part, inc)) = self.part_debris.get(&i)
                && self
                    .cars
                    .get(car as usize)
                    .is_some_and(|c| c.incarnation != inc)
            {
                out.push((car, part, i));
            }
        }
        out
    }

    /// How many husks the round has made.
    pub fn husk_count(&self) -> usize {
        self.husks.len()
    }

    /// Whether debris body `index` is asleep (dynamic bodies may sleep and wake; nothing freezes them).
    pub fn debris_sleeping(&self, index: usize) -> Option<bool> {
        self.world
            .bodies
            .get(*self.props.get(index)?)
            .map(RigidBody::is_sleeping)
    }

    /// Whether debris body `index` is dynamic (always, for the round).
    pub fn debris_dynamic(&self, index: usize) -> Option<bool> {
        self.world
            .bodies
            .get(*self.props.get(index)?)
            .map(RigidBody::is_dynamic)
    }

    /// A debris body's linear velocity (of its centre of mass), m/s.
    pub fn debris_linvel(&self, index: usize) -> Option<[f32; 3]> {
        let v = self.world.bodies.get(*self.props.get(index)?)?.linvel();
        Some([v.x, v.y, v.z])
    }

    /// A debris body's mass, kg.
    pub fn debris_mass(&self, index: usize) -> Option<f32> {
        self.world
            .bodies
            .get(*self.props.get(index)?)
            .map(RigidBody::mass)
    }

    /// A car chassis' mass now, kg (less every detached part).
    pub fn car_mass(&self, car: CarId) -> Option<f32> {
        let c = self.cars.get(car.0 as usize)?;
        self.world.bodies.get(c.body).map(RigidBody::mass)
    }

    /// Which car's part debris body `index` is.
    pub fn debris_part(&self, index: usize) -> Option<(CarId, &'static str)> {
        self.part_debris
            .get(&(index as u32))
            .map(|&(c, p, _)| (CarId(c), damage::PART_NAMES[usize::from(p)]))
    }

    /// Kinetic plus potential energy over every dynamic body, J, and the authorised-work ledger (engine force, air
    /// control, flip assist, wheelie lift, the roll correction, detach kicks): the energy accounting of plan §13b.1. What
    /// matters is `energy − ledger` over a run: it may fall (friction, impacts) but a rise past the solver's tolerance is a
    /// bug candidate.
    pub fn energy_j(&self) -> (f64, f64) {
        let g = self.world.gravity;
        let e = self
            .world
            .bodies
            .iter()
            .filter(|(_, b)| b.is_dynamic())
            .map(|(_, b)| f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g)))
            .sum();
        (e, self.ledger)
    }

    /// Scales the solver's iterations (the TGS substeps) for the stress rerun of the energy tests; not a journaled
    /// command, so replays don't see it.
    #[doc(hidden)]
    pub fn scale_solver_iterations(&mut self, factor: usize) {
        self.world.integration_parameters.num_solver_iterations *= factor.max(1);
    }

    /// Every finished damage episode and part-state change so far, with the tick it happened (P1-S04a): the records
    /// S04b, the host's events and the traces read.
    pub fn damage_events(&self) -> &[(u64, DamageEvent)] {
        &self.damage_events
    }

    /// The prop's causal owner: the car that last put a qualifying impulse into it, and when.
    pub fn prop_owner(&self, prop: u32) -> Option<damage::Owner> {
        self.episodes.owner_of_prop(prop)
    }

    /// A car's part health, in part order (`damage::PART_NAMES`; the core has none).
    pub fn part_health(&self, car: CarId) -> Option<[f32; PARTS]> {
        self.cars.get(car.0 as usize).map(|c| c.damage.health)
    }

    /// A car's part states, in part order.
    pub fn part_states(&self, car: CarId) -> Option<[PartState; PARTS]> {
        self.cars
            .get(car.0 as usize)
            .map(|c| c.damage.states(&self.profiles[c.model].tuning.damage))
    }

    /// A part's state by name (`front`, `door_FL`…).
    pub fn part_state(&self, car: CarId, part: &str) -> Option<PartState> {
        let i = damage::part_index(part)?;
        self.part_states(car).map(|s| s[i])
    }

    /// The ground's height (m) straight below (x, z) as the cars meet it (terrain and sharp jump pieces), found by a ray
    /// from `from_y` down; `None` when nothing is under it. A probe for tests and tools (needs one `step` first).
    pub fn ground_height(&self, x: f32, z: f32, from_y: f32) -> Option<f32> {
        let queries = self.world.broad_phase.as_query_pipeline(
            self.world.narrow_phase.query_dispatcher(),
            &self.world.bodies,
            &self.world.colliders,
            QueryFilter::default().groups(CAR_RAYS),
        );
        let ray = Ray::new(Vector::new(x, from_y, z), Vector::new(0.0, -1.0, 0.0));
        queries
            .cast_ray(&ray, 1.0e4, true)
            .map(|(_, toi)| from_y - toi)
    }

    pub fn car_state(&self, car: CarId) -> Option<CarState> {
        let c = self.cars.get(car.0 as usize)?;
        let b = self.world.bodies.get(c.body)?;
        let pose = b.position();
        let (t, r) = (pose.translation, pose.rotation);
        let fwd = r * Vector::new(0.0, 0.0, 1.0);
        let up = r * Vector::new(0.0, 1.0, 0.0);
        let (v, w) = (b.linvel(), b.angvel());
        Some(CarState {
            position: [t.x, t.y, t.z],
            rotation: [r.x, r.y, r.z, r.w],
            linvel: [v.x, v.y, v.z],
            angvel: [w.x, w.y, w.z],
            forward_speed: v.dot(fwd),
            up_y: up.y,
            // libm, not std: the respawn roll (R125) steps the physics from it, and native and WASM must agree.
            heading: libm::atan2f(fwd.x, fwd.z),
            wheels_in_contact: c
                .vehicle
                .wheels()
                .iter()
                .filter(|w| w.raycast_info().is_in_contact)
                .count() as u8,
            sleeping: b.is_sleeping(),
        })
    }

    /// The four wheels of `car` (front +x, front −x, rear +x, rear −x).
    pub fn wheel_states(&self, car: CarId) -> Option<Vec<WheelState>> {
        let c = self.cars.get(car.0 as usize)?;
        let b = self.world.bodies.get(c.body)?;
        let r = b.position().rotation;
        let (fwd, up) = (
            r * Vector::new(0.0, 0.0, 1.0),
            r * Vector::new(0.0, 1.0, 0.0),
        );
        Some(
            c.vehicle
                .wheels()
                .iter()
                .map(|w| {
                    let info = w.raycast_info();
                    let slip_deg = if info.is_in_contact {
                        let v = b.velocity_at_point(info.hard_point_ws);
                        // The wheel's heading: the chassis' forward turned by the steering angle about its up axis.
                        let (s, co) = w.steering.sin_cos();
                        let heading = fwd * co + up.cross(fwd) * s;
                        let side = up.cross(heading);
                        let (vf, vs) = (v.dot(heading), v.dot(side));
                        if vf.hypot(vs) < 0.5 {
                            0.0
                        } else {
                            vs.atan2(vf.abs()).to_degrees()
                        }
                    } else {
                        0.0
                    };
                    WheelState {
                        in_contact: info.is_in_contact,
                        suspension_length: info.suspension_length,
                        suspension_force: w.wheel_suspension_force,
                        forward_impulse: w.forward_impulse,
                        side_impulse: w.side_impulse,
                        rotation: w.rotation,
                        steering: w.steering,
                        slip_deg,
                    }
                })
                .collect(),
        )
    }

    /// A car's ACTION-stick state: its boost meter, how far into a drift it is, and whether it's boosting (P1-S03b).
    pub fn action_state(&self, car: CarId) -> Option<vehicle::ActionState> {
        self.cars.get(car.0 as usize).map(|c| c.action)
    }

    /// The player's controls for `car` (what `set_input` last gave it).
    pub fn input(&self, car: CarId) -> Option<DriveInput> {
        self.cars.get(car.0 as usize).map(|c| c.input)
    }

    /// The controls the car actually drove with last step: the player's, the autopilot's, a handback blend, or none
    /// while held.
    pub fn applied_input(&self, car: CarId) -> Option<DriveInput> {
        self.cars.get(car.0 as usize).map(|c| c.applied)
    }

    /// The first vehicle's profile (a one-vehicle sim's only one); see [`Sim::profile_of`] and [`Sim::profile_at`].
    pub fn profile(&self) -> &VehicleProfile {
        &self.profiles[0]
    }

    /// The profile roster vehicle `vehicle` builds its cars from.
    pub fn profile_at(&self, vehicle: usize) -> Option<&VehicleProfile> {
        self.profiles.get(vehicle)
    }

    /// The profile `car` was built from and is driven by (R123).
    pub fn profile_of(&self, car: CarId) -> Option<&VehicleProfile> {
        self.cars
            .get(car.0 as usize)
            .map(|c| &self.profiles[c.model])
    }

    /// Which roster vehicle (profile index) `car` is.
    pub fn vehicle_of(&self, car: CarId) -> Option<usize> {
        self.cars.get(car.0 as usize).map(|c| c.model)
    }

    /// How many vehicle profiles this sim was made with.
    pub fn vehicle_count(&self) -> usize {
        self.profiles.len()
    }

    /// Replaces the tuning of roster vehicle `vehicle` (the owner tuning menu, br-2sdu.1): only cars of that vehicle
    /// change; geometry stays. Every field acts from the next tick except mass and inertia, which a car's body takes
    /// when it spawns.
    pub fn set_tuning_for(&mut self, vehicle: usize, tuning: crate::profile::Tuning) {
        if let Some(p) = self.profiles.get_mut(vehicle) {
            p.tuning = tuning;
        }
    }

    /// [`Sim::set_tuning_for`] vehicle 0.
    pub fn set_tuning(&mut self, tuning: crate::profile::Tuning) {
        self.set_tuning_for(0, tuning);
    }

    /// SHA-256 over the whole simulated state: tick, RNG, every car (pose, velocities, wheels) and every prop, in a
    /// stable order. Same build + same inputs + same seed → same hash.
    pub fn state_hash(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(self.tick.to_le_bytes());
        for s in self.rng.state() {
            h.update(s.to_le_bytes());
        }
        let mut body = |handle: RigidBodyHandle| {
            if let Some(b) = self.world.bodies.get(handle) {
                let pose = b.position();
                let (t, r, v, w) = (pose.translation, pose.rotation, b.linvel(), b.angvel());
                for f in [
                    t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z,
                ] {
                    h.update(f.to_bits().to_le_bytes());
                }
            }
        };
        for c in &self.cars {
            body(c.body);
        }
        for &p in &self.props {
            body(p);
        }
        let mut race = Vec::new();
        self.race.hash_into(&mut race);
        for c in &self.cars {
            c.damage.hash_into(&mut race);
            for (s, r) in c.springs.iter().zip(c.removed) {
                race.extend(s.angle.to_bits().to_le_bytes());
                race.extend(s.rate.to_bits().to_le_bytes());
                race.push(u8::from(r));
            }
            race.extend(c.incarnation.to_le_bytes());
            for v in &c.speed_history {
                race.extend(v.to_bits().to_le_bytes());
            }
        }
        race.extend(self.ledger.to_bits().to_le_bytes());
        for &(i, until) in &self.fresh_debris {
            race.extend(i.to_le_bytes());
            race.extend(until.to_le_bytes());
        }
        self.episodes.hash_into(&mut race);
        for c in &self.cars {
            race.extend(c.protected_since.unwrap_or(u64::MAX).to_le_bytes());
            match &c.autopilot {
                Some(ap) => ap.hash_into(&mut race),
                None => race.push(0xff),
            }
        }
        h.update(&race);
        for c in &self.cars {
            for f in [c.action.boost, c.action.drift] {
                h.update(f.to_bits().to_le_bytes());
            }
            h.update([u8::from(c.action.boosting), u8::from(c.action.armed)]);
            h.update(c.action.wheelie_ticks.to_le_bytes());
            h.update(c.action.wheelie_ready.to_le_bytes());
            for (r, n) in c.action.utility_ready.iter().zip(c.action.utility_fired) {
                h.update(r.to_le_bytes());
                h.update(n.to_le_bytes());
            }
            for w in c.vehicle.wheels() {
                for f in [
                    w.rotation,
                    w.raycast_info().suspension_length,
                    w.steering,
                    w.engine_force,
                    w.brake,
                ] {
                    h.update(f.to_bits().to_le_bytes());
                }
            }
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&h.finalize());
        out
    }

    /// Rebuilds a session from its journal and runs it to `ticks`: the replay half of the determinism contract.
    pub fn replay(
        map: &LoadedMap,
        registry: &Registry,
        profile: VehicleProfile,
        journal: &Journal,
        ticks: u64,
    ) -> Self {
        Self::replay_with(map, registry, vec![profile], journal, ticks)
    }

    /// [`Sim::replay`] for a sim made with several vehicle profiles (R123): the journal's `SpawnCarAs`/`DropInAs`
    /// pick among them.
    pub fn replay_with(
        map: &LoadedMap,
        registry: &Registry,
        profiles: Vec<VehicleProfile>,
        journal: &Journal,
        ticks: u64,
    ) -> Self {
        let mut sim = Self::with_profiles(map, registry, journal.seed, profiles);
        let (mut setup, mut entries) = (
            journal.setup.iter().peekable(),
            journal.entries.iter().peekable(),
        );
        while sim.tick < ticks {
            while let Some((_, s)) = setup.next_if(|(t, _)| *t == sim.tick) {
                match s {
                    Setup::SpawnCar { pose, .. } => {
                        sim.spawn_car(*pose);
                    }
                    Setup::SpawnCarAs { pose, vehicle, .. } => {
                        sim.spawn_car_as(*pose, usize::from(*vehicle));
                    }
                    Setup::DropInAs { vehicle } => {
                        sim.drop_in_as(usize::from(*vehicle));
                    }
                    Setup::PlaceCar {
                        car,
                        pose,
                        roll,
                        linvel,
                    } => sim.place_car(CarId(*car), *pose, *roll, *linvel),
                    Setup::StartRace { laps } => sim.start_race(*laps),
                    Setup::Recover { car } => {
                        sim.recover(CarId(*car));
                    }
                    Setup::DropIn => {
                        sim.drop_in();
                    }
                    Setup::SpawnDebris { pose, half } => sim.spawn_debris(*pose, *half),
                    Setup::Autopilot { car, on } => sim.set_autopilot(CarId(*car), *on),
                    Setup::Wheelie { car, preload_ms } => {
                        sim.wheelie(CarId(*car), *preload_ms);
                    }
                    Setup::Utility { car, kind } => {
                        sim.utility(CarId(*car), *kind);
                    }
                    Setup::PartHealth { car, part, health } => {
                        sim.set_part_health(CarId(*car), *part, *health);
                    }
                    Setup::Wreck { car } => {
                        sim.wreck(CarId(*car));
                    }
                    Setup::EndRace => {
                        sim.end_race_now();
                    }
                }
            }
            while let Some(e) = entries.next_if(|e| e.tick == sim.tick) {
                sim.set_input(CarId(e.car), e.input);
            }
            sim.step();
        }
        sim
    }
}

/// A spawn pose on a map's route: centerline point `index`, `lateral` metres to the side, `lift` metres above the road,
/// facing along the route.
pub fn route_spawn(map: &LoadedMap, index: usize, lateral: f32, lift: f32) -> SpawnPose {
    let pts = &map.map.route.points;
    let (a, b) = (pts[index % pts.len()], pts[(index + 1) % pts.len()]);
    let (dx, dz) = ((b.x - a.x) as f32, (b.z - a.z) as f32);
    let len = dx.hypot(dz).max(1e-6);
    // Lateral +: the side of (−tz, tx), as the map validator measures it.
    let (nx, nz) = (-dz / len, dx / len);
    SpawnPose {
        x: a.x as f32 / 1000.0 + nx * lateral,
        y: a.y as f32 / 1000.0 + lift,
        z: a.z as f32 / 1000.0 + nz * lateral,
        heading: libm::atan2f(dx, dz),
    }
}

/// Each part's mass, centre of mass and hinge from the profile (P1-S04b): the proxy hull's centroid, its mass fraction of
/// the car, and the hinge's pivot-to-centre arm and limits.
fn part_phys(p: &VehicleProfile) -> Vec<PartPhys> {
    (0..PARTS)
        .map(|i| {
            let Some(g) = p.geometry.parts.get(i) else {
                return PartPhys {
                    com: Vector::ZERO,
                    mass: 0.0,
                    hinge: None,
                };
            };
            let points: Vec<Vector> = g
                .points
                .iter()
                .map(|&[x, y, z]| Vector::new(x, y, z))
                .collect();
            let com = SharedShape::convex_hull(&points)
                .map_or(Vector::ZERO, |s| s.mass_properties(1.0).local_com);
            let hinge = g.hinge.map(|([ax, ay, az], lo, hi)| Hinge {
                axis: Vector::new(ax, ay, az).normalize_or_zero(),
                arm: com - Vector::new(g.pivot[0], g.pivot[1], g.pivot[2]),
                lo: lo.to_radians(),
                hi: hi.to_radians(),
            });
            PartPhys {
                com,
                mass: g.mass_fraction * p.tuning.mass,
                hinge,
            }
        })
        .collect()
}

/// The whole car's mass properties (P1-S03a): the profile's mass about the sidecar's centre of mass, with the hull's box
/// inertia scaled by the profile. The core collider carries them.
fn chassis_mass_props(p: &VehicleProfile) -> MassProperties {
    let (lo, hi) = p.hull_bounds();
    let [w, h, l] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    let k = p.tuning.mass / 12.0 * p.tuning.inertia_scale;
    let inertia = Vector::new(
        k * (h * h + l * l),
        k * (w * w + l * l),
        k * (w * w + h * h),
    );
    let [cx, cy, cz] = p.geometry.com;
    MassProperties::new(Vector::new(cx, cy, cz), p.tuning.mass, inertia)
}

/// Part `i`'s collider on the chassis (P1-S04a): a convex hull of its sidecar proxy, in vehicle space. The core carries the
/// whole car's mass properties (S04b recomputes them when parts detach); the other parts are massless, so the chassis
/// feels as it did when it was one hull.
fn part_builder(p: &VehicleProfile, i: usize) -> ColliderBuilder {
    let points: Vec<Vector> = p
        .geometry
        .parts
        .get(i)
        .map(|g| {
            g.points
                .iter()
                .map(|&[x, y, z]| Vector::new(x, y, z))
                .collect()
        })
        .unwrap_or_default();
    let builder = ColliderBuilder::convex_hull(&points).unwrap_or_else(|| {
        if i == damage::CORE {
            let hull: Vec<Vector> = p
                .geometry
                .hull
                .iter()
                .map(|&[x, y, z]| Vector::new(x, y, z))
                .collect();
            let (lo, hi) = p.hull_bounds();
            ColliderBuilder::convex_hull(&hull).unwrap_or_else(|| {
                ColliderBuilder::cuboid(
                    (hi[0] - lo[0]) / 2.0,
                    (hi[1] - lo[1]) / 2.0,
                    (hi[2] - lo[2]) / 2.0,
                )
            })
        } else {
            // A profile without this part's proxy has no collider for it: a tiny inert ball at its pivot.
            let [x, y, z] = p.geometry.parts.get(i).map_or([0.0; 3], |g| g.pivot);
            ColliderBuilder::ball(0.01).translation(Vector::new(x, y, z))
        }
    });
    let builder = if i == damage::CORE {
        builder.mass_properties(chassis_mass_props(p))
    } else {
        builder.density(0.0)
    };
    builder
        .friction(0.6)
        .user_data(i as u128)
        .collision_groups(Solidity::Racing.groups(damage::is_wheel(i)))
}
