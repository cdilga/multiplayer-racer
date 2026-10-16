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

use crate::assist::{AssistLevel, AssistProfile, AssistReport, AssistState, CatchUp};
use crate::autopilot::{Autopilot, AutopilotState, Mode, Path, Pose2};
use crate::damage::episodes::{CarParts, Episodes, PreStep, TAG_CAR, TAG_PROP};
use crate::damage::springs::{Hinge, Spring};
use crate::damage::{self, CarDamage, DamageEvent, PartState};
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
/// The autopilot's air control (R129): it pitches to the road's grade this many seconds ahead, with this gain from the
/// pitch error (radians) to the stick.
const AIR_LOOK_S: f32 = 0.6;
const AIR_PITCH_GAIN: f32 = 4.0;
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
/// Drive fades between these contact-normal heights (cos of the slope): full on ground up to about 55 degrees, none at 70.
const DRIVABLE_NORMAL_Y: f32 = 0.57;
const WALL_NORMAL_Y: f32 = 0.34;

/// The arcade controller's share of a wheel's sideways grip (P1-FL04.2): all of it on road-steep ground, none from where
/// drive starts to fade; Rapier's side friction has the rest.
/// `full` is the profile's `arcade.bank_normal_y`: at or below `DRIVABLE_NORMAL_Y` the controller never fades.
fn arcade_authority(full: f32, in_contact: bool, normal_y: f32) -> f32 {
    if !in_contact || full <= DRIVABLE_NORMAL_Y {
        return 1.0;
    }
    ((normal_y - DRIVABLE_NORMAL_Y) / (full - DRIVABLE_NORMAL_Y)).clamp(0.0, 1.0)
}

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
/// What stops a boomerang (P1-W02a): the ground, scenery and debris; cars are hit by distance instead.
const BOOMERANG_RAYS: InteractionGroups = groups(GROUP_PROP, SOLID_WORLD.union(GROUP_PROP));
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
    /// Every part's collider in profile order; `parts[0]` is `collider`.
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
    /// The ACTION stick's state: boost meter and arcade slide (P1-S03b).
    action: vehicle::ActionState,
    /// Each loose part's hinge spring (P1-S04b), in part order; closed and at rest while a part isn't loose.
    springs: Vec<Spring>,
    /// Parts whose collider has left the chassis (detached into debris).
    removed: Vec<bool>,
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
    /// The player's learner assist (R125).
    assist: AssistState,
    /// Each wheel's ground slip-curve factor this tick (R124), for the arcade handling layer (P1-FL04).
    side_stiffness: Vec<f32>,
    /// Riding a loop (br-xlvx.6): the loop carries the car until its exit, or lets it go if it gets too slow.
    loop_ride: Option<crate::looping::LoopRide>,
    /// The tick a loop let this car go for being too slow: it respawns before the loop shortly after.
    loop_fall: Option<u64>,
}

/// How long after a loop lets a too-slow car go it respawns before the loop (br-xlvx.6): long enough to see it fall.
const LOOP_FALL_TICKS: u64 = 3 * TICK_HZ as u64 / 2;

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
    rails: Vec<crate::rails::Rail>,
    rail_joins: Vec<crate::rails::Join>,
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
    /// The map's loops (br-xlvx.6), in feature order: a wheel on a loop's deck carries the loop's index in its collider,
    /// and a car that reaches one fast enough rides it (crate::looping).
    loops: Vec<crate::looping::LoopRail>,
    /// Work the sim itself authorises into the bodies, J: engine force, air control, flip assist, wheelie lift, the roll
    /// correction and detach kicks. The energy accounting subtracts it (`Sim::energy_j`).
    ledger: f64,
    /// Accepted ACTION utilities, with the tick they fired at (P1-S08).
    utility_events: Vec<(u64, UtilityEvent)>,
    item_cards: crate::items::Cards,
    items: crate::items::Items,
    /// Boomerangs in the air and the ones that landed this round (P1-W02a).
    boomerangs: Vec<crate::items::boomerang::Flight>,
    /// The map's item pickup stations and this tick's offers (P1-W04).
    stations: Vec<crate::items::stations::Station>,
    station_offers: Vec<crate::items::stations::Offer>,
    item_refusals: Vec<(u64, u32, jj_types::items::ItemUseRefusal)>,
    /// Damage episodes (P1-S04a): the open ones, prop owners, every finished record and part-state change.
    episodes: Episodes,
    damage_events: Vec<(u64, DamageEvent)>,
    /// The derby ledger (P1-S10), once a derby round has started.
    derby: Option<crate::derby::Ledger>,
    /// The bodies' state before each step, for the contacts' closing speeds.
    pre_step: PreStep,
    tick: u64,
    rng: Rng,
    journal: Journal,
    race: Race,
    line: RouteLine,
    slots: Vec<SpawnPose>,
    path: Path,
    /// Learner-assist and catch-up data (R125) and the lobby's catch-up choice.
    assist_profile: AssistProfile,
    catch_up: CatchUp,
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

        // The derby bowl (P1-M10) is a trimesh of the same kind: the bank, the wall and the lip, ground to the car.
        // Sharp jumps (br-gw74.7.1): the ramp, table and landing ramp are the exact triangles of `jj_map::jump`, not a 2.5 m
        // grid's rounding of them. They are ground to the car (the terrain's groups).
        let mut loops = Vec::new();
        for f in &m.features {
            // A loop's deck (br-xlvx.6): the exact triangles of `jj_map::looping`, a trimesh per tyre surface like a bridge
            // deck's, tagged as a loop with the loop's index so a wheel on it finds the loop's assist.
            if let Some(d) = jj_map::looping::LoopDesign::of(f)
                && let Some((verts, tris)) = jj_map::looping::loop_mesh(m, &d)
            {
                let materials = jj_map::looping::triangle_surfaces(m, &d).expect("validated loop");
                let pts: Vec<Vector> = verts
                    .iter()
                    .map(|p| Vector::new(p[0] as f32, p[1] as f32, p[2] as f32))
                    .collect();
                let tag = crate::roofs::BRIDGE_SURFACE
                    | crate::roofs::LOOP_SURFACE
                    | ((loops.len() as u128) << 8);
                for surface in [
                    jj_map::Surface::Tarmac,
                    jj_map::Surface::PackedDirt,
                    jj_map::Surface::Gravel,
                    jj_map::Surface::Rock,
                    jj_map::Surface::OffTrack,
                ] {
                    let faces: Vec<_> = tris
                        .iter()
                        .zip(&materials)
                        .filter(|(_, s)| **s == surface)
                        .map(|(t, _)| *t)
                        .collect();
                    if faces.is_empty() {
                        continue;
                    }
                    let b = ColliderBuilder::trimesh_with_flags(
                        pts.clone(),
                        faces,
                        TriMeshFlags::FIX_INTERNAL_EDGES,
                    )
                    .expect("validated loop mesh");
                    world.insert_collider(
                        b.friction(0.9)
                            .collision_groups(TERRAIN_GROUPS)
                            .user_data(tag | surface as u128),
                        None,
                    );
                }
                loops.push(crate::looping::LoopRail::new(m, d).expect("validated loop"));
                continue;
            }
            if let Some((verts, tris)) = jj_map::bridge::bridge_mesh(m, f) {
                let materials =
                    jj_map::bridge::triangle_surfaces(m, f).expect("validated bridge spans");
                let pts: Vec<Vector> = verts
                    .iter()
                    .map(|p| Vector::new(p[0] as f32, p[1] as f32, p[2] as f32))
                    .collect();
                for surface in [
                    jj_map::Surface::Tarmac,
                    jj_map::Surface::PackedDirt,
                    jj_map::Surface::Gravel,
                    jj_map::Surface::Rock,
                    jj_map::Surface::OffTrack,
                ] {
                    let faces: Vec<_> = tris
                        .iter()
                        .zip(&materials)
                        .filter(|(_, s)| **s == surface)
                        .map(|(t, _)| *t)
                        .collect();
                    if faces.is_empty() {
                        continue;
                    }
                    let b = ColliderBuilder::trimesh_with_flags(
                        pts.clone(),
                        faces,
                        TriMeshFlags::FIX_INTERNAL_EDGES,
                    )
                    .expect("validated bridge mesh");
                    world.insert_collider(
                        b.friction(0.9)
                            .collision_groups(TERRAIN_GROUPS)
                            .user_data(crate::roofs::BRIDGE_SURFACE | surface as u128),
                        None,
                    );
                }
                continue;
            }
            if let Some((verts, tris)) =
                jj_map::jump::jump_mesh(m, f).or_else(|| jj_map::arena::bowl_mesh(m, f))
            {
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
        let mut rails = Vec::new();
        let rail_profile = crate::rails::RailProfile::standard();
        for (index, d) in m.dressing.iter().enumerate().filter(|(_, d)| d.collides) {
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
            if crate::roofs::insert_house(
                &mut world,
                d,
                WORLD_GROUPS,
                groups(GROUP_TERRAIN.union(crate::roofs::ROOF), Group::ALL),
            ) {
                continue;
            }
            if d.kit_piece == "wayfinding/guard-rail" {
                let length = match fp {
                    Footprint::Rect { x, .. } => x as f32 / 1000.0,
                    _ => unreachable!(),
                };
                // Rolled beam ends have no sharp box corner to snag a tyre at a displaced overlap.
                // Keep the authored outer dimensions, rounding inward from that envelope.
                let depth = match fp {
                    Footprint::Rect { z, .. } => z as f32 / 1000.0,
                    _ => unreachable!(),
                };
                let profile = rail_profile;
                let radius = profile.end_radius_m.min(depth / 4.0).min(hy / 2.0);
                let builder = ColliderBuilder::round_cuboid(
                    length / 2.0 - radius,
                    hy - radius,
                    depth / 2.0 - radius,
                    radius,
                );
                rails.push(crate::rails::Rail::insert(
                    &mut world,
                    index as u32,
                    Vector::new(
                        d.pose.x as f32 / 1000.0,
                        d.pose.y as f32 / 1000.0 + hy,
                        d.pose.z as f32 / 1000.0,
                    ),
                    // Sections are mounted, not resting on terrain, and adjoining beams overlap at their joins.
                    // Let cars/debris hit them without ground friction or beam/beam contacts pinning the spring.
                    yaw_rotation(d.pose.yaw),
                    builder
                        .collision_groups(groups(GROUP_WORLD, Group::ALL.difference(SOLID_WORLD))),
                    length,
                    profile,
                ));
                continue;
            }
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

        let rail_joins = crate::rails::connect(&mut world, &rails, rail_profile);

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
            loops,
            ledger: 0.0,
            utility_events: Vec::new(),
            item_cards: crate::items::Cards::shipped().expect("shipped item cards validate"),
            items: crate::items::Items::default(),
            boomerangs: Vec::new(),
            stations: map
                .map
                .dressing
                .iter()
                .enumerate()
                .filter(|(_, d)| d.kit_piece == jj_map::kit::ITEM_STATION)
                .map(|(i, d)| crate::items::stations::Station {
                    dressing: i as u32,
                    position: {
                        let (x, z) = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
                        [
                            x as f32,
                            jj_map::jump::ground_height_m(&map.map.terrain, x, z) as f32
                                + crate::items::stations::HOVER_M,
                            z as f32,
                        ]
                    },
                    ready_at: 0,
                    taken: 0,
                })
                .collect(),
            station_offers: Vec::new(),
            item_refusals: Vec::new(),
            props,
            statics,
            rails,
            rail_joins,
            episodes: Episodes::default(),
            damage_events: Vec::new(),
            derby: None,
            pre_step: PreStep::default(),
            tick: 0,
            rng: Rng::stream(seed, "sim"),
            journal,
            race: Race::new(Course::new(map)),
            line: RouteLine::new(map),
            slots: corridor_slots(map, &RouteLine::new(map)),
            path: Path::new(map),
            assist_profile: AssistProfile::standard(),
            catch_up: CatchUp::Off,
        }
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    pub fn rail_count(&self) -> usize {
        self.rails.len()
    }

    pub fn rail_states(&self) -> Vec<crate::rails::RailState> {
        self.rails
            .iter()
            .map(|r| r.state(&self.world.bodies))
            .collect()
    }

    /// R90: set a section's displacement and normal velocity, journalled for replay. Unknown indices/nonfinite
    /// values are refused; travel is the physical joint limit, never a gameplay count limit.
    pub fn set_rail(&mut self, dressing: u32, displacement_m: f32, velocity_mps: f32) -> bool {
        if !displacement_m.is_finite() || !velocity_mps.is_finite() {
            return false;
        }
        let Some(rail) = self.rails.iter().find(|r| r.dressing == dressing) else {
            return false;
        };
        let before = self.energy_j().0;
        self.journal.setup.push((
            self.tick,
            Setup::RailState {
                dressing,
                displacement_m,
                velocity_mps,
            },
        ));
        rail.set(&mut self.world.bodies, displacement_m, velocity_mps);
        self.ledger += self.energy_j().0 - before;
        true
    }

    /// R90 comparison seam: fix the same rail at rest without changing its collider, friction or damage policy.
    pub fn set_rail_fixed(&mut self, dressing: u32, fixed: bool) -> bool {
        let Some(rail) = self.rails.iter().find(|r| r.dressing == dressing) else {
            return false;
        };
        let before = self.energy_j().0;
        rail.set(&mut self.world.bodies, 0.0, 0.0);
        self.world.bodies[rail.body].set_body_type(
            if fixed {
                RigidBodyType::Fixed
            } else {
                RigidBodyType::Dynamic
            },
            true,
        );
        self.ledger += self.energy_j().0 - before;
        self.journal
            .setup
            .push((self.tick, Setup::RailFixed { dressing, fixed }));
        true
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

    /// Journal an actual box offer. Only success tells the station to consume it (P1-W01/W04).
    pub fn pickup_item(
        &mut self,
        car: CarId,
        seat: jj_types::SeatId,
        item: jj_types::items::ItemId,
    ) -> Result<(), crate::items::PickupRefusal> {
        self.journal.setup.push((
            self.tick,
            Setup::PickupItem {
                car: car.0,
                seat,
                item,
            },
        ));
        let ctx = self
            .item_context(car, seat)
            .ok_or(crate::items::PickupRefusal::Unavailable)?;
        self.items
            .pickup(&self.item_cards, car.0, item, ctx, self.tick)
    }

    pub fn items(&self) -> &crate::items::Items {
        &self.items
    }

    pub fn item_refusals(&self) -> &[(u64, u32, jj_types::items::ItemUseRefusal)] {
        &self.item_refusals
    }

    fn item_context(&self, car: CarId, seat: jj_types::SeatId) -> Option<crate::items::Context> {
        let c = self.cars.get(car.0 as usize)?;
        Some(crate::items::Context {
            owner: crate::items::Owner {
                seat,
                life: jj_types::LifeId(c.life),
            },
            mode: if self.derby.is_some() {
                jj_contracts::item::Mode::Derby
            } else {
                jj_contracts::item::Mode::Race
            },
            racing: self.race.started_at.is_some()
                && self.race.over.is_none()
                && !self.race.is_held(car.0, self.tick)
                && !self.race.is_finished(car.0),
            protected: c.protected_since.is_some(),
        })
    }

    fn use_held_item(&mut self, car: CarId, direction: UtilityKind) -> bool {
        use jj_types::items::ItemUseRefusal;
        let ctx = self
            .items
            .owner_seat(car.0)
            .and_then(|seat| self.item_context(car, seat));
        let result = match ctx {
            Some(ctx) => {
                self.items.use_front(
                    &self.item_cards,
                    car.0,
                    ctx,
                    direction,
                    self.tick,
                    |effect| {
                        match effect.item {
                            jj_types::items::ItemId::Sanga => Ok(()),
                            // P1-W02a: the flight starts below, once the use is committed.
                            jj_types::items::ItemId::Boomerang => Ok(()),
                        }
                    },
                )
            }
            None => Err(ItemUseRefusal::Unavailable),
        };
        match result {
            Ok(effect) => {
                if effect.item == jj_types::items::ItemId::Boomerang {
                    self.throw_boomerang(car, &effect);
                }
                self.sync_sanga_dominance();
                true
            }
            Err(reason) => {
                self.item_refusals.push((self.tick, car.0, reason));
                false
            }
        }
    }

    /// This car's active buff, exposed to fixtures and the host as data.
    pub fn sanga_state(&self, car: CarId) -> Option<crate::items::sanga::Active> {
        self.sanga_state_at(car, self.tick)
    }

    /// R90: deepest overlap between the cars' currently attached convex parts, metres.
    /// Uses their actual shapes/poses, including damage, rather than an intact-car rectangle.
    pub fn car_overlap_depth_m(&self, a: CarId, b: CarId) -> Option<f32> {
        let a = self.cars.get(a.0 as usize)?;
        let b = self.cars.get(b.0 as usize)?;
        let mut depth = 0.0_f32;
        for ca in a.parts.iter().filter_map(|h| self.world.colliders.get(*h)) {
            for cb in b.parts.iter().filter_map(|h| self.world.colliders.get(*h)) {
                if let Some(contact) = rapier3d::parry::query::contact(
                    ca.position(),
                    ca.shape(),
                    cb.position(),
                    cb.shape(),
                    0.0,
                )
                .expect("validated vehicle parts are convex contact-query shapes")
                {
                    depth = depth.max(-contact.dist);
                }
            }
        }
        Some(depth)
    }

    fn sanga_state_at(&self, car: CarId, tick: u64) -> Option<crate::items::sanga::Active> {
        self.cars.get(car.0 as usize)?;
        crate::items::sanga::active(&self.items, car.0, tick)
    }

    fn sync_sanga_dominance(&mut self) {
        for (i, car) in self.cars.iter().enumerate() {
            let active = crate::items::sanga::active(&self.items, i as u32, self.tick).is_some();
            if let Some(body) = self.world.bodies.get_mut(car.body) {
                body.set_dominance_group(if active {
                    crate::items::sanga::DOMINANCE
                } else {
                    0
                });
            }
        }
    }

    /// An ACTION utility (P1-S08, a journaled command): jj-input's deliberate up or down sector entry. Up fires the
    /// "OI!" flash (an event for the host's cue); down drops a traffic cone [`rules::CONE_BEHIND_M`] behind the rear
    /// bumper, at rest, a light dynamic prop that stays for the round (R58). Refused (false) while that utility's
    /// cooldown runs (game time), while the car is held, or for a finished car.
    pub fn utility(&mut self, car: CarId, kind: UtilityKind) -> bool {
        self.journal
            .setup
            .push((self.tick, Setup::Utility { car: car.0, kind }));
        if self.items.queue(car.0).front.is_some() {
            return self.use_held_item(car, kind);
        }
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
        let vehicle = &self.cars.get(car.0 as usize)?.vehicle;
        let b = self.world.bodies.get(self.cars.get(car.0 as usize)?.body)?;
        let t = b.position().translation;
        let ground = vehicle
            .wheels()
            .iter()
            .find(|w| w.raycast_info().is_in_contact)
            .map_or_else(
                || vehicle::surface_at(&self.terrain, t.x, t.z),
                |w| crate::roofs::surface(&self.terrain, &self.world.colliders, w, t),
            );
        Some(match ground {
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
                    col.set_collision_groups(
                        Solidity::Protected.groups(self.profiles[c.model].is_wheel_part(i)),
                    );
                }
            }
        }
    }

    /// Sets every one of car `i`'s part colliders to `solidity`'s groups.
    fn set_solidity(&mut self, i: usize, solidity: Solidity) {
        for (part, &h) in self.cars[i].parts.iter().enumerate() {
            if let Some(col) = self.world.colliders.get_mut(h) {
                col.set_collision_groups(
                    solidity.groups(self.profiles[self.cars[i].model].is_wheel_part(part)),
                );
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

    /// The loops (br-xlvx.6, crate::looping): each car on a loop's deck near its entry, heading along it and fast enough,
    /// starts riding it; each riding car is carried a tick along the deck (its pose and velocity set from the ride, the
    /// energy that changes booked in the ledger) and let go at the exit, or where it got too slow. A car let go too slow
    /// respawns before the loop `LOOP_FALL_TICKS` later.
    fn ride_loops(&mut self, tick: u64) {
        if self.loops.is_empty() {
            return;
        }
        let g = self.world.gravity;
        let mut fallen = Vec::new();
        for (ci, car) in self.cars.iter_mut().enumerate() {
            if let Some(at) = car.loop_fall
                && tick >= at + LOOP_FALL_TICKS
            {
                car.loop_fall = None;
                fallen.push(ci as u32);
            }
            let Some(b) = self.world.bodies.get_mut(car.body) else {
                continue;
            };
            let ride = match car.loop_ride {
                Some(r) => Some(r),
                None => car
                    .vehicle
                    .wheels()
                    .iter()
                    .find_map(|w| crate::roofs::loop_under(&self.world.colliders, w))
                    .and_then(|k| {
                        self.loops
                            .get(k)
                            .and_then(|rail| rail.lock_on(k, b.translation(), b.linvel()))
                    }),
            };
            let Some(ride) = ride else {
                continue;
            };
            let p = &self.profiles[car.model];
            let rail = &self.loops[ride.rail];
            let (throttle, brake) = vehicle::stick(car.applied);
            let throttle = if car.action.boosting {
                1.0 + p.tuning.boost_engine_gain
            } else {
                throttle
            };
            let mass = b.mass().max(1.0);
            let drive = throttle
                * p.tuning
                    .max_engine_force
                    .min(p.tuning.max_engine_power_w / ride.speed.max(1.0))
                / mass;
            let brake_accel = brake * p.tuning.max_brake_force / mass;
            let (next, out, too_slow) = match rail.advance(ride, g, drive, brake_accel, DT) {
                crate::looping::RideStep::On(r) => (r, false, false),
                crate::looping::RideStep::Out(r) => (r, true, false),
                crate::looping::RideStep::TooSlow(r) => (r, false, true),
            };
            let before = f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g));
            let (pos, rotation, linvel, angvel) = rail.pose(&next, DT);
            if too_slow {
                // Let go where it is, at its speed along the deck: physics (and gravity) from here.
                b.set_linvel(linvel, true);
                car.loop_ride = None;
                car.loop_fall = Some(tick);
            } else {
                b.set_position(Pose::from_parts(pos, rotation), true);
                b.set_linvel(linvel, true);
                b.set_angvel(if out { Vector::ZERO } else { angvel }, true);
                car.loop_ride = if out { None } else { Some(next) };
            }
            car.last_linvel = b.linvel();
            self.ledger +=
                f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g)) - before;
        }
        for id in fallen {
            if let Some(effect) = self.race.wreck(tick, id, Respawned::Recover) {
                self.apply(effect);
            }
        }
    }

    fn teleport(&mut self, car: CarId, pose: SpawnPose, roll: f32, linvel: [f32; 3]) {
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return;
        };
        c.life = c.life.wrapping_add(1);
        c.loop_ride = None;
        c.loop_fall = None;
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

    /// The derby round starts now and runs `limit_ticks` of game time (a journaled command: countdown completion, P1-S10).
    /// Damage dealt to opponents scores from here on; see [`crate::derby`].
    pub fn start_derby(&mut self, limit_ticks: u64) {
        self.journal
            .setup
            .push((self.tick, Setup::StartDerby { limit_ticks }));
        self.derby = Some(crate::derby::Ledger::new(self.tick, limit_ticks));
        self.update_derby();
    }

    /// The derby ledger: points, ranks, the clock and the scored events. `None` until [`Sim::start_derby`].
    pub fn derby(&self) -> Option<&crate::derby::Ledger> {
        self.derby.as_ref()
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
        let ended = self.race.end_now(self.tick);
        if ended {
            self.items.round_end(self.tick);
            self.sync_sanga_dominance();
        }
        ended
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
        // R125: Lots turns the wheelie launch off.
        if !self
            .assist_profile
            .allows_wheelie(self.cars[car.0 as usize].assist.level)
        {
            return false;
        }
        let t = self.profiles[vehicle].tuning.clone();
        let front_z = self.profiles[vehicle].axle_front_z();
        let held = self.race.is_held(car.0, self.tick);
        // R127 gated start: inside the start window a false start forfeits the launch; a snap soon after GO is perfect.
        let ticks = |s: f32| libm::roundf(s * TICK_HZ as f32) as u64;
        let since_go = self.race.started_at.map(|s| self.tick.saturating_sub(s));
        let in_start = since_go.is_some_and(|s| s < ticks(t.start_forfeit_s));
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return false;
        };
        let grounded = c
            .vehicle
            .wheels()
            .iter()
            .filter(|w| w.raycast_info().is_in_contact)
            .count();
        let required = if c.vehicle.wheels().len() == 2 { 2 } else { 3 };
        if grounded < required || held || preload_ms == 0 {
            return false;
        }
        if in_start && c.action.false_start {
            return false;
        }
        let perfect =
            !c.action.false_start && since_go.is_some_and(|s| s <= ticks(t.start_perfect_s));
        let gain = if perfect {
            1.0 + t.start_perfect_bonus
        } else {
            1.0
        };
        // The launch is on a cooldown, and fires only from a stop (R127): at speed either way a snap is just throttle.
        if self.tick < c.action.wheelie_ready
            || c.speed_history
                .back()
                .is_some_and(|&v| v.abs() > t.wheelie_max_launch_mps)
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
                let dv = t.wheelie_launch_reward * gain * (shed + engine);
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
        if in_start {
            let outcome = if perfect {
                crate::race::StartLaunch::Perfect
            } else {
                crate::race::StartLaunch::Launch
            };
            self.race.note(
                self.tick,
                crate::race::Event::StartLaunch {
                    car: car.0,
                    outcome,
                },
            );
        }
        true
    }

    /// R127: the car's launch snapped while the grid was held for the countdown (the host knows the phase; the sim
    /// is built at the countdown and started at GO). Journaled. The launch is forfeited until `start_forfeit_s` after
    /// GO, and an `Early` start event is recorded once. Returns whether this was the car's first false start.
    pub fn false_start(&mut self, car: CarId) -> bool {
        self.journal
            .setup
            .push((self.tick, Setup::FalseStart { car: car.0 }));
        let Some(c) = self.cars.get_mut(car.0 as usize) else {
            return false;
        };
        if c.action.false_start || self.race.started_at.is_some() {
            return false;
        }
        c.action.false_start = true;
        self.race.note(
            self.tick,
            crate::race::Event::StartLaunch {
                car: car.0,
                outcome: crate::race::StartLaunch::Early,
            },
        );
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
                self.items.respawn(car);
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
                        * self
                            .path
                            .planned_speed(st.position[0], st.position[1], st.position[2]);
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
        for i in 1..p.part_count() {
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
        // Front axle first, rear axle second, as the profile and sidecar name them.
        for i in 0..p.geometry.wheels.len() {
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
            damage: CarDamage::for_profile(p),
            vehicle,
            input: DriveInput::default(),
            protected_since: None,
            autopilot: None,
            applied: DriveInput::default(),
            life: 0,
            action: vehicle::ActionState::new(p),
            springs: vec![Spring::default(); p.part_count()],
            removed: vec![false; p.part_count()],
            speed_history: std::collections::VecDeque::new(),
            side_stiffness: Vec::new(),
            loop_ride: None,
            loop_fall: None,
            last_linvel: Vector::ZERO,
            incarnation: 0,
            last_detach: None,
            wheel_lost_at: None,
            assist: AssistState::default(),
        });
    }

    /// Sets a player's learner-assist level (R125). A journaled setup command.
    pub fn set_assist(&mut self, car: CarId, level: AssistLevel) {
        self.journal.setup.push((
            self.tick,
            Setup::Assist {
                car: car.0,
                level: level.as_u8(),
            },
        ));
        if let Some(c) = self.cars.get_mut(car.0 as usize) {
            c.assist.set_level(level);
        }
    }

    /// Sets the lobby's catch-up (R125). A journaled setup command.
    pub fn set_catch_up(&mut self, mode: CatchUp) {
        self.journal.setup.push((
            self.tick,
            Setup::CatchUp {
                mode: u8::from(mode == CatchUp::Light),
            },
        ));
        self.catch_up = mode;
    }

    pub fn catch_up(&self) -> CatchUp {
        self.catch_up
    }

    /// The assist data in force (tunable through [`Sim::set_assist_profile`]).
    pub fn assist_profile(&self) -> &AssistProfile {
        &self.assist_profile
    }

    /// Replaces the assist data (the tuning menu; not journaled, like [`Sim::set_tuning`]).
    pub fn set_assist_profile(&mut self, profile: AssistProfile) {
        self.assist_profile = profile;
    }

    pub fn assist_level(&self, car: CarId) -> AssistLevel {
        self.cars
            .get(car.0 as usize)
            .map_or(AssistLevel::Off, |c| c.assist.level)
    }

    /// What the assist and catch-up did to `car` last tick (R90 introspection).
    pub fn assist_report(&self, car: CarId) -> Option<AssistReport> {
        let c = self.cars.get(car.0 as usize)?;
        let mut r = c.assist.report;
        r.level = c.assist.level;
        Some(r)
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

    /// Each car's catch-up share this tick (R125): 0 for the leader, a car not behind and every car when catch-up is off
    /// or the race isn't running; up to 1 at `fullS` behind. The leader is the unfinished car furthest along.
    fn catch_up_shares(&self) -> Vec<f32> {
        let n = self.cars.len();
        if self.catch_up == CatchUp::Off
            || self.race.started_at.is_none()
            || self.race.over.is_some()
        {
            return Vec::new();
        }
        let progress: Vec<Option<f32>> = (0..n as u32)
            .map(|i| (!self.race.is_finished(i)).then(|| self.race.progress_m(i)))
            .collect();
        let lead = progress.iter().flatten().copied().fold(f32::MIN, f32::max);
        progress
            .iter()
            .map(|p| {
                p.map_or(0.0, |p| {
                    if p >= lead {
                        0.0
                    } else {
                        self.assist_profile.catch_up_share(lead - p)
                    }
                })
            })
            .collect()
    }

    /// Advances one fixed tick.
    pub fn step(&mut self) {
        self.sync_sanga_dominance();
        let tick = self.tick;
        let mut stuck = Vec::new();
        let catch_shares = self.catch_up_shares();
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
                        y: t.y,
                        z: t.z,
                        heading: libm::atan2f(fwd.x, fwd.z),
                        forward_speed: b.linvel().dot(fwd),
                    };
                    // The lock the car really has at this speed (it eases off with speed), so the pursuit's stick turns
                    // the curvature it asks for (P1-FL04.2).
                    let (out, recover) = ap.drive(
                        &self.path,
                        pose,
                        p.steer_lock(pose.forward_speed),
                        wheelbase,
                        tick,
                        1.0 + self.assist_profile.catch_up.top_speed_gain
                            * catch_shares.get(i).copied().unwrap_or(0.0),
                    );
                    // The ACTION stick passes through (P1-S03b): an idle player's is neutral, a bot's or a scenario's
                    // boost rides on the autopilot's line. Only DRIVE moving counts as taking back over.
                    // In the air the stick pitches and rolls the car (R129): the autopilot levels its nose to the road's
                    // slope where it will come down (the grade ~0.6 s ahead), so it lands aligned instead of nosing in
                    // under throttle (R132 set pieces). Pushing up noses down; pulling back lifts the nose.
                    let airborne = car
                        .vehicle
                        .wheels()
                        .iter()
                        .all(|w| !w.raycast_info().is_in_contact);
                    let out = if airborne {
                        let i = ap.state().map_or(0, |s| s.route_point as usize);
                        let v = b.linvel();
                        let ahead = libm::hypotf(v.x, v.z) * AIR_LOOK_S;
                        let want = libm::atanf(self.path.grade_ahead(i, ahead));
                        let pitch = libm::asinf(fwd.y.clamp(-1.0, 1.0));
                        let stick = (AIR_PITCH_GAIN * (pitch - want)).clamp(-1.0, 1.0);
                        DriveInput {
                            throttle: jj_types::axis::quantise_axis(stick.max(0.0)),
                            brake: jj_types::axis::quantise_axis((-stick).max(0.0)),
                            steer: 0,
                            ..out
                        }
                    } else {
                        out
                    };
                    input = DriveInput {
                        boost: car.input.boost,
                        ..out
                    };
                    // The loop approach (br-xlvx.6): on a loop's run-in a bot holds the entry line at full throttle
                    // (crate::looping::LoopRail::approach), and on the loop itself it keeps the throttle down (the route
                    // under the loop means nothing to the pursuit there; the ride carries the car).
                    let on_loop = car.loop_ride.is_some().then_some(0.0);
                    if let Some(steer) = on_loop
                        .or_else(|| self.loops.iter().find_map(|r| r.approach(t, pose.heading)))
                    {
                        input = DriveInput {
                            throttle: i16::MAX,
                            brake: 0,
                            steer: jj_types::axis::quantise_axis(steer),
                            ..input
                        };
                    }
                    if recover {
                        stuck.push(id);
                    }
                }
            }
            // R125: a learner assist edits a player-driven car's input before the normal vehicle path.
            if car.assist.level != AssistLevel::Off
                && car.autopilot.is_none()
                && let Some(b) = self.world.bodies.get(car.body)
            {
                let (t, fwd) = (b.position().translation, b.position().rotation * Vector::Z);
                let pose = Pose2 {
                    x: t.x,
                    y: t.y,
                    z: t.z,
                    heading: libm::atan2f(fwd.x, fwd.z),
                    forward_speed: b.linvel().dot(fwd),
                };
                input = car.assist.apply(
                    &self.assist_profile,
                    &self.path,
                    pose,
                    p.steer_lock(pose.forward_speed),
                    wheelbase,
                    input,
                );
            }
            if self.race.is_held(id, tick) {
                input = DriveInput::default();
            }
            car.applied = input;
            let mut wheel_grip: Vec<f32> = Vec::new();
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
                car.action.update(p, input, b.linvel().length(), DT);
                // R125 catch-up: a trailing car's boost meter refills faster, in proportion to its gap.
                let share = catch_shares.get(i).copied().unwrap_or(0.0);
                if share > 0.0 && !car.action.boosting {
                    let extra = (self.assist_profile.catch_up.boost_refill - 1.0) * share;
                    car.action.boost =
                        (car.action.boost + extra * p.tuning.boost_recharge_per_s * DT).min(1.0);
                }
                let catch_scale = 1.0 + self.assist_profile.catch_up.top_speed_gain * share;
                car.assist.report.catch_share = share;
                car.assist.report.catch_scale = catch_scale;
                let mut grip = vec![1.0; p.geometry.wheels.len()];
                let mut side_stiffness = vec![1.0; p.geometry.wheels.len()];
                for (i, g) in grip.iter_mut().enumerate() {
                    let [x, y, z] = p.geometry.wheels[i];
                    let at = iso * Vector::new(x, y, z);
                    let ground = crate::roofs::surface(
                        &self.terrain,
                        &self.world.colliders,
                        &car.vehicle.wheels()[i],
                        at,
                    );
                    *g = p.grip(ground);
                    // R124: the ground's slip curve (dirt resolves less of the sideways slip per tick).
                    side_stiffness[i] = p.tuning.side_friction_stiffness
                        * surface::table().tyre(ground).side_stiffness;
                }
                wheel_grip.clone_from(&grip);
                let commands =
                    vehicle::wheel_commands(p, input, car.action, forward_speed, grip, DT);
                car.side_stiffness.clone_from(&side_stiffness);
                let dt_ = &p.tuning.damage;
                let t_ = &p.tuning;
                for (i, (w, c)) in car
                    .vehicle
                    .wheels_mut()
                    .iter_mut()
                    .zip(commands)
                    .enumerate()
                {
                    w.steering = match &t_.arcade {
                        // P1-FL04.2: the arcade controller turns the body; the wheels show the angle its ask needs.
                        Some(a) if i < p.front_wheels() => {
                            let v = forward_speed.abs().max(1.0);
                            let lateral = libm::atanf(wheelbase * a.turn_g * 9.81 / (v * v));
                            (jj_types::axis::dequantise_axis(input.steer)
                                * p.steer_lock(forward_speed))
                            .clamp(-lateral, lateral)
                        }
                        _ => c.steering,
                    };
                    // Drive bites only on drivable ground (br-gw74.13): it fades out as the contact steepens past about
                    // 55 degrees and is gone on a wall. The arcade engine out-pulls the car's weight, and the suspension
                    // keeps the tyres pressed to whatever they touch, so without this a car could drive up a wall.
                    let info = w.raycast_info();
                    let bank = t_.arcade.as_ref().map_or(0.0, |a| {
                        1.0 - arcade_authority(
                            a.bank_normal_y,
                            info.is_in_contact,
                            info.contact_normal_ws.y,
                        )
                    });
                    let climbable = if info.is_in_contact {
                        ((info.contact_normal_ws.y - WALL_NORMAL_Y)
                            / (DRIVABLE_NORMAL_Y - WALL_NORMAL_Y))
                            .clamp(0.0, 1.0)
                    } else {
                        1.0
                    };
                    w.engine_force = c.engine_force * catch_scale * climbable;
                    w.brake = c.brake_impulse;
                    w.friction_slip = c.friction_slip;
                    // P1-FL04.2: on the arcade controller the sideways grip is `vehicle::arcade`'s, not Rapier's, on road-steep
                    // ground; on a bank, where the controller fades out (`arcade_authority`), Rapier's tyres take it back.
                    w.side_friction_stiffness = if t_.arcade.is_some() {
                        side_stiffness[i] * bank
                    } else {
                        side_stiffness[i]
                    };
                    match car.damage.state(p.wheel_part(i), dt_) {
                        PartState::Intact => w.max_suspension_force = t_.max_suspension_force,
                        // R121: a loose wheel retains its handling until it detaches.
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
                let supported = car
                    .vehicle
                    .wheels()
                    .iter()
                    // A ray can still touch terrain at full extension while exerting no support force.
                    // Treating that as grounded disables levelling just as a car bounces off a rough verge.
                    .filter(|w| w.raycast_info().is_in_contact && w.wheel_suspension_force > 0.0)
                    .count();
                let airborne = supported == 0;
                // The boost pushes the body while the car is on the ground (arcade fun pass, br-gw74.13), along the
                // level ground plane (the forward axis with its climb removed): it speeds a car along a slope but never
                // rockets it up a wall or a derby bank.
                let thrust = vehicle::boost_thrust(p, car.action, forward_speed) * catch_scale;
                if thrust > 0.0 && !airborne {
                    let impulse = Vector::new(fwd.x, 0.0, fwd.z) * (thrust * DT);
                    self.ledger += f64::from(impulse.dot(b.linvel()));
                    b.apply_impulse(impulse, true);
                }
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
                // A bike needs both axle contacts; a car needs three loaded
                // contacts for a support plane. Once that plane disappears,
                // arrest a tilt beyond the profile's supported-road envelope.
                // Small road attitudes and rear-supported wheelies stay free.
                let bike = p.tuning.bike_balance.is_some();
                let stable_contacts = if bike { 2 } else { 3 };
                let losing_balance = bike || up.y < libm::cosf(p.tuning.support_level_tilt_rad);
                let level = airborne
                    || (supported < stable_contacts
                        && losing_balance
                        && car.action.wheelie_ticks == 0);
                // Keep damping through the upright hemisphere: a 45-degree
                // cutoff abandoned a recoverable rough-verge lean mid-flight.
                // Fully inverted cars remain the flip assist's; bikes auto-balance.
                if level && p.tuning.air_level_torque > 0.0 && (bike || up.y > 0.0) {
                    let tilt = up.cross(Vector::Y);
                    let w = b.angvel();
                    let w_tilt = w - Vector::Y * w.dot(Vector::Y);
                    // Bike roll has its own actuator below; applying both roll
                    // dampers would overdamp it and couple a fast yaw impact into
                    // that correction. The flight spring supplies pitch only.
                    let ti = if bike {
                        let axis = iso.rotation * Vector::X;
                        axis * (tilt.dot(axis) * p.tuning.air_level_torque
                            - w.dot(axis) * p.tuning.air_level_damping)
                            * DT
                    } else {
                        (tilt * p.tuning.air_level_torque - w_tilt * p.tuning.air_level_damping)
                            * DT
                    };
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
            let instant_flip = car.assist.level != AssistLevel::Off
                && self.world.bodies.get(car.body).is_some_and(|b| {
                    let r = b.position().rotation;
                    let (up, fwd) = (r * Vector::Y, r * Vector::Z);
                    car.assist
                        .flip_wanted(&self.assist_profile, up.y, b.linvel().dot(fwd))
                });
            if (self.race.is_assisting(id) || instant_flip)
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
            // P1-FL04 arcade handling: each grounded tyre's sideways force and the yaw-rate feel.
            if let Some(a) = &p.tuning.arcade
                && let Some(b) = self.world.bodies.get_mut(car.body)
            {
                // P1-FL04.2: the arcade controller turns the body, holds it on its line and lets the grip go on purpose.
                let wheels = car.vehicle.wheels();
                let loaded: Vec<usize> = (0..wheels.len())
                    .filter(|&i| {
                        wheels[i].raycast_info().is_in_contact
                            && wheels[i].wheel_suspension_force > 0.0
                    })
                    .collect();
                let mean = |v: &[f32]| {
                    if loaded.is_empty() {
                        1.0
                    } else {
                        loaded
                            .iter()
                            .map(|&i| v.get(i).copied().unwrap_or(1.0))
                            .sum::<f32>()
                            / loaded.len() as f32
                    }
                };
                let (grip, side) = (mean(&wheel_grip), mean(&car.side_stiffness));
                let (throttle, brake) = vehicle::stick(input);
                let controls = vehicle::arcade::Controls {
                    throttle: if car.action.boosting { 1.0 } else { throttle },
                    brake,
                    steer: jj_types::axis::dequantise_axis(input.steer),
                };
                // On a bank (a bowl's wall, a barrier face) the controller fades out, from full on road-steep ground
                // (`arcade.bank_normal_y`) to none by where drive starts to fade (`DRIVABLE_NORMAL_Y`): gravity and the
                // collision decide there, so the grip never holds a car's line up a wall.
                let climbable: f32 = loaded
                    .iter()
                    .map(|&i| {
                        let ri = wheels[i].raycast_info();
                        arcade_authority(a.bank_normal_y, ri.is_in_contact, ri.contact_normal_ws.y)
                    })
                    .sum();
                let ground = vehicle::arcade::Ground {
                    loaded: climbable / wheels.len() as f32,
                    grip,
                    side,
                };
                self.ledger += vehicle::arcade::apply(
                    a,
                    &mut car.action.arcade,
                    b,
                    controls,
                    ground,
                    p.tuning.max_steer_rad,
                    p.tuning.steer_falloff_mps,
                    wheelbase,
                    p.com()[2] - p.axle_rear_z(),
                    DT,
                );
            }
            // R124 rolling drag: each wheel in contact drags against its ground velocity by the ground under it. One
            // impulse of force × dt per tick, never more than stops the wheel's share of the vehicle.
            if let Some(b) = self.world.bodies.get_mut(car.body) {
                let wheel_mass = b.mass() / car.vehicle.wheels().len() as f32;
                let mut ground = vec![(Vector::ZERO, Vector::ZERO); car.vehicle.wheels().len()];
                let mut n = 0;
                for w in car.vehicle.wheels() {
                    let ri = w.raycast_info();
                    if !ri.is_in_contact || w.wheel_suspension_force <= 0.0 {
                        continue;
                    }
                    let at = ri.contact_point_ws;
                    let surf = crate::roofs::surface(&self.terrain, &self.world.colliders, w, at);
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
                    let impulse = (force * DT).min(wheel_mass * speed);
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
            // A bike has no lateral suspension baseline. Its arcade balance actuator supplies
            // the roll moment toward a speed/steer lean, without constraining yaw or wheelie
            // pitch. Torque integrates once; its work is recorded like air/flip controls.
            if let Some(balance) = &p.tuning.bike_balance
                && let Some(b) = self.world.bodies.get_mut(car.body)
            {
                let r = b.position().rotation;
                let (up, fwd) = (r * Vector::Y, r * Vector::Z);
                let pitch_axis = r * Vector::X;
                let horizontal_side = Vector::Y.cross(fwd);
                let side_length = horizontal_side.length();
                let side = horizontal_side.normalize_or_zero();
                let roll = libm::atan2f(-up.dot(side), up.y);
                // Differentiate that same world-up lean angle. Body angular velocity
                // along fwd also contains yaw when the bike pitches, so damping it
                // directly mistakes a fast tilted turn for a roll and resists recovery.
                let spin = b.angvel();
                let up_rate = spin.cross(up);
                let side_rate = Vector::Y.cross(spin.cross(fwd));
                let roll_rate = if side_length > 1e-6 {
                    let side_rate = (side_rate - side * side.dot(side_rate)) / side_length;
                    let a = -up.dot(side);
                    let a_rate = -up_rate.dot(side) - up.dot(side_rate);
                    (up.y * a_rate - a * up_rate.y) / (a * a + up.y * up.y).max(1e-6)
                } else {
                    spin.dot(fwd)
                };
                let speed = b.linvel().dot(fwd).abs();
                let grounded = car
                    .vehicle
                    .wheels()
                    .iter()
                    .any(|w| w.raycast_info().is_in_contact);
                let lean = if grounded {
                    -jj_types::axis::dequantise_axis(input.steer) * balance.max_lean_rad * speed
                        / (speed + balance.lean_speed_mps)
                } else {
                    0.0
                };
                let moment = (lean - roll) * balance.torque_per_rad - roll_rate * balance.damping;
                // A single-track support line creates an overturning roll moment as
                // the chassis leans. Cancel precisely the roll component Rapier just
                // applied at its contact patches; keep support force and pitch. This
                // gives the balance spring its requested equilibrium without gains
                // compensating for gravity or a fictitious third suspension wheel.
                let support_roll: f32 = car
                    .vehicle
                    .wheels()
                    .iter()
                    .map(|w| {
                        let ri = w.raycast_info();
                        let impulse = ri.contact_normal_ws
                            * w.wheel_suspension_force.min(w.max_suspension_force)
                            * DT;
                        (ri.contact_point_ws - b.center_of_mass())
                            .cross(impulse)
                            .dot(fwd)
                    })
                    .sum();
                // Rear drive/braking at ground height must not pitch an arcade
                // bike into a flip once its front ray lifts. Move that impulse's
                // pitch lever to COM height; preserve suspension pitch and the
                // explicit wheelie launch impulse. Rapier uses n × projected axle.
                let drive_pitch: f32 = car
                    .vehicle
                    .wheels()
                    .iter()
                    .map(|w| {
                        let ri = w.raycast_info();
                        let n = ri.contact_normal_ws;
                        let axle = (w.axle() - n * w.axle().dot(n)).normalize_or_zero();
                        let impulse = n.cross(axle).normalize_or_zero() * w.forward_impulse;
                        (ri.contact_point_ws - b.center_of_mass())
                            .cross(impulse)
                            .dot(pitch_axis)
                    })
                    .sum();
                let ti = fwd * (moment * DT - support_roll) - pitch_axis * drive_pitch;
                self.ledger += f64::from(ti.dot(b.angvel()));
                b.apply_torque_impulse(ti, true);
            }
        }
        self.ride_loops(tick);
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
                // On a loop (br-xlvx.6) the race sees the car where it is along the route under the deck, so its
                // progress keeps moving forward while the deck doubles back over it in plan view.
                let t = c
                    .loop_ride
                    .and_then(|r| self.loops.get(r.rail).map(|rail| rail.plan_point(&r, t.y)))
                    .unwrap_or(t);
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
        self.update_derby();
        self.step_boomerangs();
        self.offer_stations();
        self.items.expire(self.tick);
        if self.race.over.is_some() || self.derby.as_ref().is_some_and(|d| d.over(self.tick)) {
            self.items.round_end(self.tick);
            self.drop_boomerangs();
        }
        self.sync_sanga_dominance();
    }

    /// The map's item stations: where they are, when each is ready again and how many boxes it has given (P1-W04).
    pub fn stations(&self) -> &[crate::items::stations::Station] {
        &self.stations
    }

    /// Each station for the renderer: its position and snapshot kind (a box printed with the item it holds, or recharging).
    pub fn station_poses(&self) -> Vec<([f32; 3], u32)> {
        use crate::items::stations::{
            SNAPSHOT_KIND_READY_BOOMERANG, SNAPSHOT_KIND_READY_SANGA, SNAPSHOT_KIND_RECHARGING,
        };
        self.stations
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let kind = if !s.ready(self.tick) {
                    SNAPSHOT_KIND_RECHARGING
                } else if s.draw(self.journal.seed, i) == jj_types::items::ItemId::Sanga {
                    SNAPSHOT_KIND_READY_SANGA
                } else {
                    SNAPSHOT_KIND_READY_BOOMERANG
                };
                (s.position, kind)
            })
            .collect()
    }

    /// This tick's box offers: each car inside a ready station, with the item its box holds. The host claims one for
    /// the car's seat with [`Sim::pickup_item`] and, only if that succeeds, takes the box with [`Sim::take_station`].
    pub fn station_offers(&self) -> &[crate::items::stations::Offer] {
        &self.station_offers
    }

    /// Takes a station's box after a successful pickup (a journaled command): it recharges for 5 s. A station that isn't
    /// ready is left as it is.
    pub fn take_station(&mut self, station: u32) {
        self.journal
            .setup
            .push((self.tick, Setup::TakeStation { station }));
        let tick = self.tick;
        if let Some(s) = self.stations.get_mut(station as usize)
            && s.ready(tick)
        {
            s.ready_at = tick + crate::items::stations::RECHARGE_TICKS;
            s.taken += 1;
            self.station_offers.retain(|o| o.station != station);
        }
    }

    /// Offers each ready station's box to every racing, unprotected car inside it.
    fn offer_stations(&mut self) {
        use crate::items::stations::{Offer, RADIUS_M, REACH_Y_M};
        self.station_offers.clear();
        let racing = self.race.started_at.is_some() && self.race.over.is_none();
        if !racing {
            return;
        }
        let seed = self.journal.seed;
        for (si, st) in self.stations.iter().enumerate() {
            if !st.ready(self.tick) {
                continue;
            }
            let item = st.draw(seed, si);
            for (j, c) in self.cars.iter().enumerate() {
                if c.protected_since.is_some() || self.race.is_finished(j as u32) {
                    continue;
                }
                let t = self.world.bodies[c.body].position().translation;
                if libm::hypotf(t.x - st.position[0], t.z - st.position[2]) <= RADIUS_M
                    && (t.y - st.position[1]).abs() <= REACH_Y_M
                {
                    self.station_offers.push(Offer {
                        station: si as u32,
                        car: j as u32,
                        item,
                    });
                }
            }
        }
    }

    /// The boomerangs thrown this round, flying or finished, as data (P1-W02a, R90).
    pub fn boomerangs(&self) -> &[crate::items::boomerang::Flight] {
        &self.boomerangs
    }

    /// The boomerangs in the air for the renderer: position and a spin quaternion (x, y, z, w) about the vertical.
    pub fn boomerang_poses(&self) -> Vec<([f32; 3], [f32; 4])> {
        let spin = crate::items::boomerang::SPIN_RAD_PER_TICK * self.tick as f32;
        self.boomerangs
            .iter()
            .filter(|f| f.active())
            .map(|f| {
                let a = spin + f.effect as f32;
                (
                    f.position,
                    [0.0, libm::sinf(a / 2.0), 0.0, libm::cosf(a / 2.0)],
                )
            })
            .collect()
    }

    /// Ends every flight still in the air (round end): it drops. Debris is never touched.
    fn drop_boomerangs(&mut self) {
        for f in self.boomerangs.iter_mut().filter(|f| f.active()) {
            f.ended = Some((self.tick, crate::items::boomerang::End::Dropped));
        }
    }

    /// Starts a boomerang flight for a committed use: from the car's front or back, at the throw speed relative to the
    /// car plus a little sideways spin.
    fn throw_boomerang(&mut self, car: CarId, effect: &crate::items::Effect) {
        use crate::items::boomerang::{Flight, HEIGHT_M, Leg, SIDE_MPS, SPEED_MPS};
        let Some(c) = self.cars.get(car.0 as usize) else {
            return;
        };
        let Some(b) = self.world.bodies.get(c.body) else {
            return;
        };
        let pose = b.position();
        let fwd = pose.rotation * Vector::Z;
        let f = Vector::new(fwd.x, 0.0, fwd.z).normalize_or_zero();
        let side = Vector::new(f.z, 0.0, -f.x);
        let sign = match effect.direction {
            UtilityKind::Forward => 1.0,
            UtilityKind::Rear => -1.0,
        };
        let half_l = self.profiles[c.model].chassis_half()[2];
        let at = pose.translation + f * (sign * (half_l + 0.6));
        let rel = f * (sign * SPEED_MPS) + side * SIDE_MPS;
        let y = self.boomerang_y(at.x, at.z, pose.translation.y + HEIGHT_M, half_l + 0.6);
        self.boomerangs.push(Flight {
            effect: effect.id,
            car: car.0,
            life: c.life,
            position: [at.x, y, at.z],
            relative_velocity: [rel.x, 0.0, rel.z],
            leg: Leg::Out,
            armed_at: effect.armed_at,
            expires_at: effect.expires_at,
            hits: Vec::new(),
            ended: None,
        });
    }

    /// One tick of every flight: the spring toward the thrower, walls and debris, hits, the catch and expiry.
    fn step_boomerangs(&mut self) {
        use crate::items::boomerang::{
            CATCH_RADIUS_M, End, HIT_DAMAGE, HIT_DV_MPS, HIT_LIFT, HIT_RADIUS_M, Hit, Leg, OMEGA,
            SANGA_SCALE,
        };
        let tick = self.tick;
        for k in 0..self.boomerangs.len() {
            if !self.boomerangs[k].active() {
                continue;
            }
            let f = self.boomerangs[k].clone();
            let thrower = self.cars.get(f.car as usize).and_then(|c| {
                (c.life == f.life).then(|| {
                    let b = &self.world.bodies[c.body];
                    (b.position().translation, b.linvel())
                })
            });
            let Some((home, home_v)) = thrower.filter(|_| tick < f.expires_at) else {
                self.boomerangs[k].ended = Some((tick, End::Dropped));
                continue;
            };
            let p = Vector::new(f.position[0], f.position[1], f.position[2]);
            let r = Vector::new(p.x - home.x, 0.0, p.z - home.z);
            let mut u = Vector::new(f.relative_velocity[0], 0.0, f.relative_velocity[2]);
            u -= r * (OMEGA * OMEGA * DT);
            let v = Vector::new(home_v.x, 0.0, home_v.z) + u;
            let mut next = p + v * DT;
            next.y = self.boomerang_y(
                next.x,
                next.z,
                p.y,
                libm::hypotf(next.x - p.x, next.z - p.z),
            );
            let leg = if f.leg == Leg::Out && r.dot(u) < 0.0 {
                Leg::Back
            } else {
                f.leg
            };
            // Walls, the ground and debris stop it (cars are hit below, not ray-cast).
            let step = next - p;
            let stopped = step.length() > 1e-6 && {
                let queries = self.world.broad_phase.as_query_pipeline(
                    self.world.narrow_phase.query_dispatcher(),
                    &self.world.bodies,
                    &self.world.colliders,
                    QueryFilter::default().groups(BOOMERANG_RAYS),
                );
                let ray = Ray::new(p, step / step.length());
                queries
                    .cast_ray(&ray, step.length(), true)
                    .map(|(_, toi)| p + ray.dir * toi)
            }
            .map(|at| next = at)
            .is_some();
            {
                let f = &mut self.boomerangs[k];
                f.position = [next.x, next.y, next.z];
                f.relative_velocity = [u.x, 0.0, u.z];
                f.leg = leg;
            }
            if stopped {
                self.boomerangs[k].ended = Some((tick, End::Stopped));
                continue;
            }
            if leg == Leg::Back && libm::hypotf(next.x - home.x, next.z - home.z) < CATCH_RADIUS_M {
                self.boomerangs[k].ended = Some((tick, End::Caught));
                continue;
            }
            if tick < f.armed_at {
                continue;
            }
            let dir = Vector::new(v.x, 0.0, v.z).normalize_or_zero();
            for j in 0..self.cars.len() {
                if j as u32 == f.car
                    || self.cars[j].protected_since.is_some()
                    || self.race.is_finished(j as u32)
                    || self.boomerangs[k].hit_this_leg(j as u32)
                {
                    continue;
                }
                let body = self.cars[j].body;
                let (q, rot, mass, linvel) = {
                    let b = &self.world.bodies[body];
                    (
                        b.position().translation,
                        b.position().rotation,
                        b.mass(),
                        b.linvel(),
                    )
                };
                if libm::hypotf(next.x - q.x, next.z - q.z) > HIT_RADIUS_M
                    || (next.y - q.y).abs() > 2.0
                {
                    continue;
                }
                let scale = if self.sanga_state_at(CarId(j as u32), tick).is_some() {
                    SANGA_SCALE
                } else {
                    1.0
                };
                let dv = HIT_DV_MPS * scale;
                let impulse = (dir + Vector::Y * HIT_LIFT) * (mass * dv);
                self.ledger +=
                    f64::from(impulse.dot(linvel) + impulse.length_squared() / (2.0 * mass));
                if let Some(b) = self.world.bodies.get_mut(body) {
                    b.apply_impulse(impulse, true);
                }
                // The struck part: the one whose pivot is nearest the boomerang, in the car's frame.
                let local = rot.inverse() * (next - q);
                let model = self.cars[j].model;
                let geo = &self.profiles[model].geometry.parts;
                let t = self.profiles[model].tuning.damage.clone();
                let part = (1..self.cars[j].parts.len())
                    .filter(|&i| self.cars[j].damage.state(i, &t) != PartState::Detached)
                    .min_by(|&a, &b| {
                        let d = |i: usize| {
                            geo.get(i).map_or(f32::MAX, |g| {
                                (Vector::new(g.pivot[0], g.pivot[1], g.pivot[2]) - local)
                                    .length_squared()
                            })
                        };
                        d(a).total_cmp(&d(b))
                    });
                let damage = HIT_DAMAGE * scale;
                if let Some(i) = part {
                    let was = self.cars[j].damage.state(i, &t);
                    self.cars[j].damage.charge(i, damage);
                    let now = self.cars[j].damage.state(i, &t);
                    if now != was {
                        let (cause, instigator) =
                            (damage::OtherBody::Car { car: f.car }, Some(f.car));
                        let e = match now {
                            PartState::Detached => DamageEvent::PartDetached {
                                car: j as u32,
                                part: i as u8,
                                cause,
                                instigator,
                            },
                            _ => DamageEvent::PartLoose {
                                car: j as u32,
                                part: i as u8,
                                cause,
                                instigator,
                            },
                        };
                        self.damage_events.push((tick, e));
                    }
                }
                self.boomerangs[k].hits.push(Hit {
                    tick,
                    car: j as u32,
                    leg,
                    part: part.map_or(0, |i| i as u8),
                    dv_mps: dv,
                    damage: if part.is_some() { damage } else { 0.0 },
                });
            }
        }
    }

    /// Feeds the derby ledger this tick's control modes, protection and damage events (P1-S10).
    fn update_derby(&mut self) {
        let Some(mut ledger) = self.derby.take() else {
            return;
        };
        let flags: Vec<crate::derby::CarFlags> = self
            .cars
            .iter()
            .map(|c| crate::derby::CarFlags {
                autopilot: c.autopilot.is_some(),
                protected: c.protected_since.is_some(),
            })
            .collect();
        ledger.update_with_wheels(self.tick, &flags, &self.damage_events, |car, part| {
            self.profile_of(CarId(car))
                .is_some_and(|p| p.is_wheel_part(part))
        });
        self.derby = Some(ledger);
    }

    /// Reads this step's contacts into damage episodes, then closes the ones whose window ran out (P1-S04a).
    fn step_damage(&mut self) {
        // Contact immunity applies to the interval just simulated, including its last tick.
        let immune: Vec<bool> = self
            .cars
            .iter()
            .enumerate()
            .map(|(i, _)| {
                self.sanga_state_at(CarId(i as u32), self.tick - 1)
                    .is_some()
            })
            .collect();
        let cars: Vec<CarParts<'_>> = self
            .cars
            .iter()
            .enumerate()
            .map(|(i, c)| CarParts {
                car: i as u32,
                parts: &c.parts,
                contact_immune: immune[i],
            })
            .collect();
        let ts: Vec<&crate::profile::DamageTuning> = self
            .cars
            .iter()
            .map(|c| &self.profiles[c.model].tuning.damage)
            .collect();
        let dominance_work = self
            .episodes
            .scan(&self.world, &self.pre_step, &cars, &ts, self.tick);
        if dominance_work != 0.0 {
            self.ledger += dominance_work;
        }
        let mut health: Vec<CarDamage> = self.cars.iter().map(|c| c.damage.clone()).collect();
        let events = self.episodes.close(self.tick, &ts, &mut health, &immune);
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
            for part in 1..car.parts.len() {
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
            for part in 1..self.cars[ci].parts.len() {
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
        let (m0, [cx, cy, cz]) = (p.tuning.mass, p.com());
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
            let p = &self.profiles[self.cars[ci].model];
            let gone = (0..p.part_count())
                .filter(|&i| p.is_wheel_part(i))
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
        for part in 1..self.cars[ci].parts.len() {
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
        for i in 1..self.cars[ci].parts.len() {
            let builder = part_builder(&self.profiles[vehicle], i).collision_groups(
                Solidity::Protected.groups(self.profiles[vehicle].is_wheel_part(i)),
            );
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
        c.damage = CarDamage::for_profile(&self.profiles[vehicle]);
        c.springs = vec![Spring::default(); c.parts.len()];
        c.removed = vec![false; c.parts.len()];
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
            && (1..c.parts.len()).contains(&usize::from(part))
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
    pub fn part_angles(&self, car: CarId) -> Option<Vec<f32>> {
        self.cars
            .get(car.0 as usize)
            .map(|c| c.springs.iter().map(|s| s.angle).collect())
    }

    /// The part records for the snapshot (P1-S04b): every part that isn't intact, as `(car, part, state, hinge angle,
    /// debris body index)`, in car then part order. A detached part's pose is its debris body's (`debris_poses`).
    pub fn part_records(&self) -> Vec<(u32, u8, PartState, f32, Option<u32>)> {
        let mut out = Vec::new();
        for (ci, c) in self.cars.iter().enumerate() {
            let t = &self.profiles[c.model].tuning.damage;
            for part in 1..c.parts.len() {
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
    pub fn debris_part(&self, index: usize) -> Option<(CarId, &str)> {
        self.part_debris.get(&(index as u32)).map(|&(c, p, _)| {
            (
                CarId(c),
                self.profiles[self.cars[c as usize].model].part_name(usize::from(p)),
            )
        })
    }

    /// Kinetic plus potential energy over every dynamic body, J, and the authorised-work ledger (engine force, air
    /// control, flip assist, wheelie lift, the roll correction, detach kicks): the energy accounting of plan §13b.1. What
    /// matters is `energy − ledger` over a run: it may fall (friction, impacts) but a rise past the solver's tolerance is a
    /// bug candidate.
    pub fn energy_j(&self) -> (f64, f64) {
        let g = self.world.gravity;
        let e: f64 = self
            .world
            .bodies
            .iter()
            .filter(|(_, b)| b.is_dynamic())
            .map(|(_, b)| f64::from(b.kinetic_energy() + b.gravitational_potential_energy(DT, g)))
            .sum();
        let spring: f64 = self
            .rails
            .iter()
            .map(|r| f64::from(r.state(&self.world.bodies).spring_energy_j))
            .sum();
        let joins: f64 = self
            .rail_joins
            .iter()
            .map(|j| j.energy(&self.world.bodies))
            .sum();
        (e + spring + joins, self.ledger)
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

    /// A vehicle's part health, in profile order (the core has none).
    pub fn part_health(&self, car: CarId) -> Option<Vec<f32>> {
        self.cars
            .get(car.0 as usize)
            .map(|c| c.damage.health.clone())
    }

    /// A car's part states, in part order.
    pub fn part_states(&self, car: CarId) -> Option<Vec<PartState>> {
        self.cars
            .get(car.0 as usize)
            .map(|c| c.damage.states(&self.profiles[c.model].tuning.damage))
    }

    /// A boomerang's height at (x, z), `run` metres on from where it is at `at_y`: `HEIGHT_M` over the ground under it,
    /// so it rides a slope (flying level, it hit the next rise: 44 % of throws on generated tracks, CI 5309). A rise
    /// steeper than 45° is a wall, not a slope: it keeps its height and the forward ray stops it, as it does at a cliff,
    /// a prop or debris. With no ground under it, it keeps its height.
    fn boomerang_y(&self, x: f32, z: f32, at_y: f32, run: f32) -> f32 {
        use crate::items::boomerang::HEIGHT_M;
        match self.ground_height(x, z, at_y + 3.0) {
            Some(g) if g + HEIGHT_M - at_y <= run + 0.05 => g + HEIGHT_M,
            _ => at_y,
        }
    }

    /// A part's state by name (`front`, `door_FL`…).
    pub fn part_state(&self, car: CarId, part: &str) -> Option<PartState> {
        let i = self.profile_of(car)?.part_index(part)?;
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

    /// A car's ACTION-stick state: its boost meter, how far into an arcade slide it is, and whether it's boosting (P1-S03b).
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
        for rail in &self.rails {
            body(rail.body);
        }
        let mut race = Vec::new();
        for rail in &self.rails {
            race.push(u8::from(self.world.bodies[rail.body].is_fixed()));
        }
        self.race.hash_into(&mut race);
        for c in &self.cars {
            c.damage.hash_into(&mut race);
            for (s, r) in c.springs.iter().zip(c.removed.iter().copied()) {
                race.extend(s.angle.to_bits().to_le_bytes());
                race.extend(s.rate.to_bits().to_le_bytes());
                race.push(u8::from(r));
            }
            race.extend(c.incarnation.to_le_bytes());
            for v in &c.speed_history {
                race.extend(v.to_bits().to_le_bytes());
            }
            // Only while a car rides or falls from a loop (br-xlvx.6): maps without loops keep their hashes.
            if let Some(r) = &c.loop_ride {
                r.hash_into(&mut race);
            }
            if let Some(t) = c.loop_fall {
                race.extend(t.to_le_bytes());
            }
        }
        race.extend(self.ledger.to_bits().to_le_bytes());
        for &(i, until) in &self.fresh_debris {
            race.extend(i.to_le_bytes());
            race.extend(until.to_le_bytes());
        }
        self.episodes.hash_into(&mut race);
        if let Some(d) = &self.derby {
            d.hash_into(&mut race);
        }
        for c in &self.cars {
            race.extend(c.protected_since.unwrap_or(u64::MAX).to_le_bytes());
            match &c.autopilot {
                Some(ap) => ap.hash_into(&mut race),
                None => race.push(0xff),
            }
        }
        h.update(&race);
        let mut items = Vec::new();
        self.items.hash_into(&mut items);
        // Boomerang flights and taken stations are hashed only once there are any, so sims without them keep their hashes.
        for f in &self.boomerangs {
            f.hash_into(&mut items);
        }
        for s in self.stations.iter().filter(|s| s.taken > 0) {
            items.extend(s.dressing.to_le_bytes());
            items.extend(s.ready_at.to_le_bytes());
            items.extend(s.taken.to_le_bytes());
        }
        h.update(&items);
        // R125: assist state is hashed only where an assist or catch-up is on, so sims without them keep their hashes.
        let mut assist = Vec::new();
        for (id, c) in self.cars.iter().enumerate() {
            if c.assist.level != AssistLevel::Off {
                // The seat association affects future physics even before an input is stepped.
                assist.extend((id as u64).to_le_bytes());
                c.assist.hash_into(&mut assist);
            }
        }
        if self.catch_up != CatchUp::Off {
            assist.push(1);
        }
        h.update(&assist);
        for c in &self.cars {
            for f in [c.action.boost, c.action.slide()] {
                h.update(f.to_bits().to_le_bytes());
            }
            h.update([u8::from(c.action.boosting), u8::from(c.action.armed)]);
            h.update(c.action.wheelie_ticks.to_le_bytes());
            // The arcade controller's own state (P1-FL04.2); the angle and ask are observations, not state.
            let arc = &c.action.arcade;
            for f in [arc.slide, arc.load_shift] {
                h.update(f.to_bits().to_le_bytes());
            }
            h.update(arc.since_low.to_le_bytes());
            h.update(c.action.wheelie_ready.to_le_bytes());
            h.update([u8::from(c.action.false_start)]);
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
                    Setup::FalseStart { car } => {
                        sim.false_start(CarId(*car));
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
                    Setup::Assist { car, level } => {
                        sim.set_assist(CarId(*car), AssistLevel::from_u8(*level));
                    }
                    Setup::CatchUp { mode } => sim.set_catch_up(CatchUp::from_u8(*mode)),
                    Setup::StartDerby { limit_ticks } => sim.start_derby(*limit_ticks),
                    Setup::PickupItem { car, seat, item } => {
                        let _ = sim.pickup_item(CarId(*car), *seat, *item);
                    }
                    Setup::TakeStation { station } => sim.take_station(*station),
                    Setup::RailState {
                        dressing,
                        displacement_m,
                        velocity_mps,
                    } => {
                        sim.set_rail(*dressing, *displacement_m, *velocity_mps);
                    }
                    Setup::RailFixed { dressing, fixed } => {
                        sim.set_rail_fixed(*dressing, *fixed);
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
    (0..p.part_count())
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
    let [cx, cy, cz] = p.com();
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
        .friction(p.tuning.body_friction)
        .user_data(i as u128)
        .collision_groups(Solidity::Racing.groups(p.is_wheel_part(i)))
}
