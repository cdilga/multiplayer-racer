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

use jj_map::{Footprint, LoadedMap, Registry};
use jj_types::axis::dequantise_axis;

use crate::autopilot::{Autopilot, AutopilotState, Mode, Path, Pose2};
use crate::journal::{DriveInput, Entry, Journal, Setup, SpawnPose};
use crate::placement::{
    CLEARANCE_M, PROTECT_TICKS, Rect, RouteLine, SEARCH_LATERAL_M, SEARCH_STEP_M, SEARCH_STEPS,
    SPAWN_LIFT_M, corridor_slots, grid_pose, offset, overlaps,
};
use crate::profile::{Drive, VehicleProfile};
use crate::race::{Course, Effect, Race};
use crate::rng::Rng;

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
const fn groups(memberships: Group, filter: Group) -> InteractionGroups {
    InteractionGroups::new(memberships, filter, InteractionTestMode::And)
}
const WORLD_GROUPS: InteractionGroups = groups(GROUP_WORLD, Group::ALL);
const PROP_GROUPS: InteractionGroups = groups(GROUP_PROP, Group::ALL);
const CAR_GROUPS: InteractionGroups = groups(GROUP_CAR, Group::ALL);
const GHOST_GROUPS: InteractionGroups = groups(GROUP_GHOST, GROUP_WORLD);
/// What a racing car's wheel rays hit (everything but ghosts), and a ghost's (only the world).
const CAR_RAYS: InteractionGroups =
    groups(GROUP_CAR, GROUP_WORLD.union(GROUP_PROP).union(GROUP_CAR));
const GHOST_RAYS: InteractionGroups = groups(GROUP_GHOST, GROUP_WORLD);
const PROTECTED_GROUPS: InteractionGroups = groups(GROUP_PROTECTED, GROUP_WORLD);
const PROTECTED_RAYS: InteractionGroups = groups(GROUP_PROTECTED, GROUP_WORLD);

/// A car's id: its index in spawn order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CarId(pub u32);

struct Car {
    body: RigidBodyHandle,
    collider: ColliderHandle,
    vehicle: DynamicRayCastVehicleController,
    input: DriveInput,
    /// Under spawn protection since this tick (P1-S06).
    protected_since: Option<u64>,
    /// Driven by the autopilot (P1-S07): dropout, idle, a finished car's cool-down, or a bot.
    autopilot: Option<Autopilot>,
    /// The controls actually applied last step (the player's, the autopilot's, a handback blend, or none while held).
    applied: DriveInput,
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
    profile: VehicleProfile,
    cars: Vec<Car>,
    props: Vec<RigidBodyHandle>,
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
            .collision_groups(WORLD_GROUPS);
        world.insert_collider(ground, None);

        // Static dressing with `collides`: the registry's collider proxies, standing on the ground at their pose.
        for d in m.dressing.iter().filter(|d| d.collides) {
            let Some(fp) = registry
                .get(&d.kit_piece)
                .and_then(|p| p.footprint(&d.params))
            else {
                continue;
            };
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
            let (h, _) = world.insert(body, builder.density(80.0).collision_groups(PROP_GROUPS));
            props.push(h);
        }

        let journal = Journal {
            seed,
            map_hash: map.hash,
            setup: Vec::new(),
            entries: Vec::new(),
        };
        Self {
            world,
            profile,
            cars: Vec::new(),
            props,
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
        let id = CarId(self.cars.len() as u32);
        self.journal
            .setup
            .push((self.tick, Setup::SpawnCar { car: id.0, pose }));
        self.add_car(pose);
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

    /// The `k`-th car's start-grid pose.
    pub fn grid_pose(&self, k: usize) -> SpawnPose {
        grid_pose(&self.slots, k)
    }

    /// A seat joining mid-round (a journaled command): ~3 s of route behind the last still-racing car with that
    /// car's gate state, marked late, immediately controllable under protection. Before the race has that much
    /// history, it takes the next grid slot.
    pub fn drop_in(&mut self) -> CarId {
        self.journal.setup.push((self.tick, Setup::DropIn));
        let id = CarId(self.cars.len() as u32);
        match self.race.drop_in_progress(self.tick) {
            Some(p) => {
                let target = self
                    .line
                    .pose_at(self.race.finish_s() + p, 0.0, SPAWN_LIFT_M);
                let pose = self.clear_pose_near(None, target);
                self.add_car(pose);
                self.race.add_late_car(pose, p, self.tick);
            }
            None => {
                let pose = self.grid_pose(self.cars.len());
                self.add_car(pose);
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
            .rotation(Vector::new(0.0, pose.heading, 0.0));
        let collider = ColliderBuilder::cuboid(half[0], half[1], half[2])
            .density(150.0)
            .collision_groups(PROP_GROUPS);
        let (h, _) = self.world.insert(body, collider);
        self.props.push(h);
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
        Some(Rect {
            x: t.x,
            z: t.z,
            heading: libm::atan2f(fwd.x, fwd.z),
            half_w: self.profile.chassis_half[0] + CLEARANCE_M,
            half_l: self.profile.chassis_half[2] + CLEARANCE_M,
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

    fn pose_footprint(&self, pose: SpawnPose) -> Rect {
        Rect {
            x: pose.x,
            z: pose.z,
            heading: pose.heading,
            half_w: self.profile.chassis_half[0] + CLEARANCE_M,
            half_l: self.profile.chassis_half[2] + CLEARANCE_M,
        }
    }

    /// The first clear pose near `target` (itself, then steps back along its heading and to either side), checked
    /// against every other car and debris; `target` itself if none is clear (the car then waits out protection).
    fn clear_pose_near(&self, exclude: Option<CarId>, target: SpawnPose) -> SpawnPose {
        let others: Vec<Rect> = self
            .cars()
            .filter(|&c| Some(c) != exclude)
            .filter_map(|c| self.footprint(c))
            .chain(self.debris_footprints())
            .collect();
        for step in 0..SEARCH_STEPS {
            for side in SEARCH_LATERAL_M {
                let pose = offset(target, step as f32 * SEARCH_STEP_M, side);
                let fp = self.pose_footprint(pose);
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
            if let Some(col) = self.world.colliders.get_mut(c.collider) {
                col.set_collision_groups(PROTECTED_GROUPS);
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
                let groups = if self.race.is_finished(i as u32) {
                    GHOST_GROUPS
                } else {
                    CAR_GROUPS
                };
                self.cars[i].protected_since = None;
                if let Some(col) = self.world.colliders.get_mut(self.cars[i].collider) {
                    col.set_collision_groups(groups);
                }
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
        let Some(c) = self.cars.get(car.0 as usize) else {
            return;
        };
        if let Some(b) = self.world.bodies.get_mut(c.body) {
            let rotation = Rotation::from_axis_angle(Vector::Y, pose.heading)
                * Rotation::from_axis_angle(Vector::Z, roll);
            b.set_position(
                Pose::from_parts(Vector::new(pose.x, pose.y, pose.z), rotation),
                true,
            );
            b.set_linvel(Vector::new(linvel[0], linvel[1], linvel[2]), true);
            b.set_angvel(Vector::ZERO, true);
        }
        self.race.placed(car.0);
    }

    /// The race starts now with `laps` laps (a journaled command: countdown completion, P1-S05).
    pub fn start_race(&mut self, laps: u32) {
        self.journal
            .setup
            .push((self.tick, Setup::StartRace { laps }));
        self.race.start(self.tick, laps);
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
            Effect::Respawn { car, pose, .. } => {
                // Through the placement service: a clear pose near the anchor, then spawn protection.
                let pose = self.clear_pose_near(Some(CarId(car)), pose);
                self.teleport(CarId(car), pose, 0.0, [0.0; 3]);
                self.protect(CarId(car));
            }
            Effect::Ghost { car } => {
                // A protected car turns ghost (not solid) when its protection ends.
                if let Some(c) = self.cars.get(car as usize)
                    && c.protected_since.is_none()
                    && let Some(col) = self.world.colliders.get_mut(c.collider)
                {
                    col.set_collision_groups(GHOST_GROUPS);
                }
                // A finished car coasts its cool-down laps on autopilot.
                let seed = self.journal.seed;
                if let Some(c) = self.cars.get_mut(car as usize) {
                    c.autopilot = Some(Autopilot::new(seed, car, Mode::CoolDown));
                }
            }
        }
    }

    fn add_car(&mut self, pose: SpawnPose) {
        let p = &self.profile;
        let [hx, hy, hz] = p.chassis_half;
        let body = RigidBodyBuilder::dynamic()
            .translation(Vector::new(pose.x, pose.y, pose.z))
            .rotation(Vector::new(0.0, pose.heading, 0.0))
            .linear_damping(p.linear_damping)
            .angular_damping(p.angular_damping)
            // Never asleep: Rapier's update_vehicle pumps suspension impulses into a sleeping chassis' velocity
            // without waking it (tests/rapier_api.rs), which would jolt the car when it woke.
            .can_sleep(false)
            .ccd_enabled(true);
        let volume = 8.0 * hx * hy * hz;
        let collider = ColliderBuilder::cuboid(hx, hy, hz)
            .density(p.chassis_mass / volume)
            .friction(0.6)
            .collision_groups(CAR_GROUPS);
        let (handle, collider) = self.world.insert(body, collider);

        let mut vehicle = DynamicRayCastVehicleController::new(handle);
        vehicle.index_up_axis = 1;
        vehicle.index_forward_axis = 2;
        let tuning = WheelTuning {
            suspension_stiffness: p.suspension_stiffness,
            suspension_compression: p.suspension_compression,
            suspension_damping: p.suspension_damping,
            max_suspension_travel: p.max_suspension_travel,
            side_friction_stiffness: p.side_friction_stiffness,
            friction_slip: p.friction_slip,
            max_suspension_force: p.max_suspension_force,
        };
        // Wheel order: front +x, front −x, rear +x, rear −x, i.e. wheel_FL, wheel_FR, wheel_RL, wheel_RR. In this
        // right-handed frame (+y up, facing +z) +x is the car's left, as the Cruz Missile's sidecar names it (P1-V02).
        for (x, z) in [
            (p.half_track, p.axle_front_z),
            (-p.half_track, p.axle_front_z),
            (p.half_track, p.axle_rear_z),
            (-p.half_track, p.axle_rear_z),
        ] {
            vehicle.add_wheel(
                Vector::new(x, p.hard_point_y, z),
                Vector::new(0.0, -1.0, 0.0),
                Vector::new(-1.0, 0.0, 0.0),
                p.suspension_rest,
                p.wheel_radius,
                &tuning,
            );
        }
        self.cars.push(Car {
            body: handle,
            collider,
            vehicle,
            input: DriveInput::default(),
            protected_since: None,
            autopilot: None,
            applied: DriveInput::default(),
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
        let p = self.profile.clone();
        let tick = self.tick;
        let wheelbase = p.axle_front_z - p.axle_rear_z;
        let mut stuck = Vec::new();
        for (i, car) in self.cars.iter_mut().enumerate() {
            let id = i as u32;
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
                        ap.drive(&self.path, pose, p.max_steer_rad, wheelbase, tick);
                    input = out;
                    if recover {
                        stuck.push(id);
                    }
                }
            }
            if self.race.is_held(id, tick) {
                input = DriveInput::default();
            }
            car.applied = input;
            let throttle = dequantise_axis(input.throttle);
            let steer = dequantise_axis(input.steer);
            let brake = dequantise_axis(input.brake).max(0.0);
            let driven = |i: usize| match p.drive {
                Drive::Front => i < 2,
                Drive::Rear => i >= 2,
                Drive::All => true,
            };
            let n_driven = (0..4).filter(|&i| driven(i)).count() as f32;
            for (i, w) in car.vehicle.wheels_mut().iter_mut().enumerate() {
                w.steering = if i < 2 { steer * p.max_steer_rad } else { 0.0 };
                if brake > 0.0 {
                    // Rapier ignores `brake` while an engine force is set, and treats it as an impulse per tick.
                    w.engine_force = 0.0;
                    w.brake = brake * p.max_brake_force / 4.0 * DT;
                } else {
                    w.engine_force = if driven(i) {
                        throttle * p.max_engine_force / n_driven
                    } else {
                        0.0
                    };
                    w.brake = 0.0;
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
                b.apply_torque_impulse(Vector::new(t[0], t[1], t[2]) * DT, true);
            }
            let rays = if car.protected_since.is_some() {
                PROTECTED_RAYS
            } else if self.race.is_finished(id) {
                GHOST_RAYS
            } else {
                CAR_RAYS
            };
            let filter = QueryFilter::default()
                .exclude_rigid_body(car.body)
                .groups(rays);
            let queries = self.world.broad_phase.as_query_pipeline_mut(
                self.world.narrow_phase.query_dispatcher(),
                &mut self.world.bodies,
                &mut self.world.colliders,
                filter,
            );
            car.vehicle.update_vehicle(DT, queries);
        }
        // A stuck autopilot presses Recover: a consequence of the state, so not journaled.
        for id in stuck {
            if let Some(effect) = self.race.recover(tick, id) {
                self.apply(effect);
            }
        }
        self.world.step();
        self.tick += 1;
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
        self.settle_protection();
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
            heading: fwd.x.atan2(fwd.z),
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

    /// The player's controls for `car` (what `set_input` last gave it).
    pub fn input(&self, car: CarId) -> Option<DriveInput> {
        self.cars.get(car.0 as usize).map(|c| c.input)
    }

    /// The controls the car actually drove with last step: the player's, the autopilot's, a handback blend, or none
    /// while held.
    pub fn applied_input(&self, car: CarId) -> Option<DriveInput> {
        self.cars.get(car.0 as usize).map(|c| c.applied)
    }

    pub fn profile(&self) -> &VehicleProfile {
        &self.profile
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
            race.extend(c.protected_since.unwrap_or(u64::MAX).to_le_bytes());
            match &c.autopilot {
                Some(ap) => ap.hash_into(&mut race),
                None => race.push(0xff),
            }
        }
        h.update(&race);
        for c in &self.cars {
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
        let mut sim = Self::new(map, registry, journal.seed, profile);
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
        heading: dx.atan2(dz),
    }
}
