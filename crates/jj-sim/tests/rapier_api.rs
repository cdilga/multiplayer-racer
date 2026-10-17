//! Rapier 0.36 API fixture (P1-S01): pins the vehicle-controller semantics every later sim bead relies on, measured on
//! the pinned version (Spike C used the JS API). Raw Rapier on flat ground, no jj-sim wrapper, so a Rapier bump that
//! changes any of these fails here first. Findings: `docs/learnings/sim.md`.

use rapier3d::control::{DynamicRayCastVehicleController, WheelTuning};
use rapier3d::prelude::*;

struct Rig {
    world: PhysicsWorld,
    body: RigidBodyHandle,
    vehicle: DynamicRayCastVehicleController,
}

/// A 1,200 kg box car on a large flat ground, facing +z. Its chassis never sleeps (see
/// `update_vehicle_pumps_velocity_into_a_sleeping_chassis`); `sleepy` gives Rapier's default.
fn rig(dt: f32, speed: f32) -> Rig {
    rig_with(dt, speed, false)
}

fn rig_with(dt: f32, speed: f32, sleepy: bool) -> Rig {
    let mut world = PhysicsWorld::new();
    world.integration_parameters.dt = dt;
    world.insert_collider(
        ColliderBuilder::cuboid(500.0, 0.5, 500.0).translation(Vector::new(0.0, -0.5, 0.0)),
        None,
    );
    let body = RigidBodyBuilder::dynamic()
        .translation(Vector::new(0.0, 0.85, 0.0))
        .linvel(Vector::new(0.0, 0.0, speed))
        .can_sleep(sleepy);
    let (hx, hy, hz) = (0.88, 0.38, 2.15);
    let (body, _) = world.insert(
        body,
        ColliderBuilder::cuboid(hx, hy, hz).density(1200.0 / (8.0 * hx * hy * hz)),
    );
    let mut vehicle = DynamicRayCastVehicleController::new(body);
    vehicle.index_up_axis = 1;
    vehicle.index_forward_axis = 2;
    let tuning = WheelTuning {
        suspension_stiffness: 30.0,
        suspension_compression: 4.0,
        suspension_damping: 4.5,
        max_suspension_travel: 0.3,
        friction_slip: 2.0,
        side_friction_stiffness: 1.0,
        max_suspension_force: 60_000.0,
    };
    for (x, z) in [(0.85, 1.34), (-0.85, 1.34), (0.85, -1.34), (-0.85, -1.34)] {
        vehicle.add_wheel(
            Vector::new(x, -0.15, z),
            Vector::new(0.0, -1.0, 0.0),
            Vector::new(-1.0, 0.0, 0.0),
            0.35,
            0.40,
            &tuning,
        );
    }
    Rig {
        world,
        body,
        vehicle,
    }
}

impl Rig {
    /// The documented order: `update_vehicle` against the current query data, then `step`.
    fn tick(&mut self, dt: f32) {
        let q = self.world.broad_phase.as_query_pipeline_mut(
            self.world.narrow_phase.query_dispatcher(),
            &mut self.world.bodies,
            &mut self.world.colliders,
            QueryFilter::default().exclude_rigid_body(self.body),
        );
        self.vehicle.update_vehicle(dt, q);
        self.world.step();
    }

    fn run(&mut self, dt: f32, seconds: f32) {
        for _ in 0..(seconds / dt).round() as usize {
            self.tick(dt);
        }
    }

    fn speed(&self) -> f32 {
        self.world.bodies[self.body].linvel().z
    }

    fn y(&self) -> f32 {
        self.world.bodies[self.body].translation().y
    }

    fn controls(&mut self, engine: f32, brake: f32, steer: f32) {
        for (i, w) in self.vehicle.wheels_mut().iter_mut().enumerate() {
            w.engine_force = if i >= 2 { engine } else { 0.0 };
            w.brake = brake;
            w.steering = if i < 2 { steer } else { 0.0 };
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn update_vehicle_before_step_holds_the_car_on_its_suspension() {
    let dt = 1.0 / 120.0;
    let mut r = rig(dt, 0.0);
    r.run(dt, 3.0);
    let contact = r
        .vehicle
        .wheels()
        .iter()
        .filter(|w| w.raycast_info().is_in_contact)
        .count();
    assert_eq!(contact, 4, "all four wheels on the ground");
    assert!(
        (0.4..0.9).contains(&r.y()),
        "the chassis rides on its springs, not on its box: y = {:.3}",
        r.y()
    );
    assert!(
        r.world.bodies[r.body].linvel().length() < 0.05,
        "and settles"
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn engine_force_is_a_force_and_brake_is_an_impulse_per_tick() {
    // Engine force: the same force for 1 s gives the same speed gain at 120 Hz and 60 Hz (Rapier integrates it with dt).
    let gain = |dt: f32| {
        let mut r = rig(dt, 0.0);
        r.run(dt, 1.0);
        r.controls(800.0, 0.0, 0.0);
        let v0 = r.speed();
        r.run(dt, 1.0);
        r.speed() - v0
    };
    let (g120, g60) = (gain(1.0 / 120.0), gain(1.0 / 60.0));
    assert!(
        g120 > 0.5 && (g120 / g60 - 1.0).abs() < 0.1,
        "force: {g120:.3} m/s at 120 Hz vs {g60:.3} at 60 Hz"
    );

    // Brake: the same `brake` value is an impulse per tick, so twice the ticks per second brake twice as hard.
    let loss = |dt: f32| {
        let mut r = rig(dt, 15.0);
        r.run(dt, 0.5);
        r.controls(0.0, 4.0, 0.0);
        let v0 = r.speed();
        r.run(dt, 1.0);
        v0 - r.speed()
    };
    let (l120, l60) = (loss(1.0 / 120.0), loss(1.0 / 60.0));
    assert!(
        (1.6..2.4).contains(&(l120 / l60)),
        "brake: {l120:.3} m/s lost at 120 Hz vs {l60:.3} at 60 Hz (ratio {:.2})",
        l120 / l60
    );

    // Exactly: 4 wheels × 4 N·s per tick × 120 ticks ÷ 1,200 kg = 1.6 m/s per second.
    assert!(
        (l120 - 1.6).abs() < 0.05,
        "brake impulse per tick: lost {l120:.3} m/s in 1 s"
    );

    // Per wheel: a wheel's brake is ignored while that wheel has an engine force.
    let mut r = rig(1.0 / 120.0, 15.0);
    r.run(1.0 / 120.0, 0.5);
    for w in r.vehicle.wheels_mut() {
        w.engine_force = 1.0;
        w.brake = 40.0;
    }
    let v0 = r.speed();
    r.run(1.0 / 120.0, 1.0);
    assert!(
        v0 - r.speed() < 0.1,
        "every wheel driven: the brake does nothing, lost {:.3} m/s",
        v0 - r.speed()
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn update_vehicle_pumps_velocity_into_a_sleeping_chassis() {
    // With sleeping allowed the chassis falls asleep within a second at rest, yet update_vehicle keeps applying the
    // suspension impulses (without waking it), so its velocity grows while it doesn't move: it would jolt on waking.
    // jj-sim's chassis therefore never sleep.
    let dt = 1.0 / 120.0;
    let mut r = rig_with(dt, 0.0, true);
    r.run(dt, 2.0);
    let b = &r.world.bodies[r.body];
    assert!(b.is_sleeping(), "asleep at rest");
    assert!(
        b.linvel().length() > 0.1,
        "but carrying {:.3} m/s of pumped velocity",
        b.linvel().length()
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn a_sleeping_chassis_wakes_only_on_positive_engine_force() {
    let dt = 1.0 / 120.0;
    let mut r = rig_with(dt, 0.0, true);
    r.run(dt, 2.0);
    let sleep = |r: &mut Rig| r.world.bodies.get_mut(r.body).unwrap().sleep();
    let asleep = |r: &Rig| r.world.bodies[r.body].is_sleeping();
    sleep(&mut r);
    r.controls(0.0, 0.0, 0.5);
    r.tick(dt);
    assert!(asleep(&r), "steering alone doesn't wake it");
    r.controls(-500.0, 0.0, 0.0);
    r.tick(dt);
    assert!(
        asleep(&r),
        "reverse (a negative engine force) doesn't wake it"
    );
    r.controls(0.0, 5.0, 0.0);
    r.tick(dt);
    assert!(asleep(&r), "a brake doesn't wake it");
    r.controls(500.0, 0.0, 0.0);
    r.tick(dt);
    assert!(!asleep(&r), "only a positive engine force wakes it");
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn per_wheel_state_is_readable() {
    let dt = 1.0 / 120.0;
    let mut r = rig(dt, 6.0);
    r.run(dt, 1.0);
    for w in r.vehicle.wheels() {
        let info = w.raycast_info();
        assert!(info.is_in_contact && info.ground_object.is_some());
        assert!(
            info.suspension_length > 0.0
                && info.suspension_length <= w.suspension_rest_length + w.max_suspension_travel
        );
        assert!(
            w.rotation.abs() > 1.0,
            "a rolling wheel turns: rotation {:.2} rad",
            w.rotation
        );
        assert!(w.wheel_suspension_force > 0.0);
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn one_wheel_is_disabled_by_zeroing_its_suspension_and_grip() {
    // There's no remove-wheel API: zero the wheel's max suspension force and friction, and its corner drops.
    let dt = 1.0 / 120.0;
    let mut r = rig(dt, 0.0);
    r.run(dt, 1.0);
    {
        let w = &mut r.vehicle.wheels_mut()[0];
        w.max_suspension_force = 0.0;
        w.friction_slip = 0.0;
    }
    r.run(dt, 2.0);
    let body = &r.world.bodies[r.body];
    let corner = |x: f32, z: f32| (body.position() * Vector::new(x, -0.15, z)).y;
    let (dropped, opposite) = (corner(0.85, 1.34), corner(-0.85, -1.34));
    assert!(
        dropped < opposite - 0.05,
        "the disabled corner sits lower: {dropped:.3} vs {opposite:.3}"
    );
    assert_eq!(r.vehicle.wheels()[0].wheel_suspension_force.min(0.0), 0.0);
}

// P1-W03a: isolate contact dominance from tyres, suspension, gravity and jj-sim damage.
// Equal 1,200 kg bodies are used deliberately: the effect must come from Rapier's API.
fn dominance_pair(
    group: i8,
    fixed: bool,
) -> (PhysicsWorld, RigidBodyHandle, Option<RigidBodyHandle>) {
    dominance_pair_ordered(group, fixed, false, FrictionModel::Simplified)
}

fn dominance_pair_ordered(
    group: i8,
    fixed: bool,
    target_first: bool,
    friction: FrictionModel,
) -> (PhysicsWorld, RigidBodyHandle, Option<RigidBodyHandle>) {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    world.integration_parameters.friction_model = friction;
    world.integration_parameters.dt = 1.0 / 120.0;
    let shape = || {
        ColliderBuilder::cuboid(1.0, 1.0, 1.0)
            .mass(1200.0)
            .friction(0.0)
            .restitution(0.0)
    };
    let moving_builder = RigidBodyBuilder::dynamic()
        .translation(Vector::new(-3.0, 0.0, 0.0))
        .linvel(Vector::new(15.0, 0.0, 0.0))
        .dominance_group(group)
        .lock_rotations()
        .can_sleep(false);
    let moving = (!target_first).then(|| world.insert(moving_builder.clone(), shape()).0);
    let target = if fixed {
        world.insert_collider(shape(), None);
        None
    } else {
        Some(
            world
                .insert(
                    RigidBodyBuilder::dynamic()
                        .lock_rotations()
                        .can_sleep(false),
                    shape(),
                )
                .0,
        )
    };
    let moving = moving.unwrap_or_else(|| world.insert(moving_builder, shape()).0);
    (world, moving, target)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn higher_dominance_pushes_dynamic_bodies_but_fixed_barriers_still_stop_it() {
    let mut results = Vec::new();
    for (group, fixed) in [(0, false), (1, false), (1, true)] {
        let (mut world, moving, target) = dominance_pair(group, fixed);
        for _ in 0..60 {
            world.step();
        }
        let speed = world.bodies[moving].linvel().x;
        let other = target.map(|h| world.bodies[h].linvel().x);
        println!(
            "dominance group={group}, fixed={fixed}: moving={speed}, other={other:?}, moving_x={}, target_x={:?}",
            world.bodies[moving].translation().x,
            target.map(|h| world.bodies[h].translation().x)
        );
        if group == 0 {
            assert!(
                (speed - 7.5).abs() < 0.1,
                "equal bodies share momentum: {speed}"
            );
            assert!((other.unwrap() - 7.5).abs() < 0.1);
        } else if fixed {
            assert!(
                speed.abs() < 0.1,
                "fixed terrain/barrier still stops dominant car: {speed}"
            );
            assert!(world.bodies[moving].translation().x < -1.9);
        } else {
            assert!(
                (speed - 15.0).abs() < 0.01,
                "dominant body's velocity unchanged: {speed}"
            );
            assert!(other.unwrap() > 14.9, "lower body is pushed: {other:?}");
            let gap = world.bodies[target.unwrap()].translation().x
                - world.bodies[moving].translation().x;
            assert!(
                gap > 1.98,
                "the car pushes without passing through/overlapping: {gap}"
            );
        }
        results.push((group, fixed, speed, other));
    }
    println!("Rapier 0.36 dominance (group, fixed, speed, target speed): {results:?}");
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn dominance_setter_applies_on_the_next_tick_and_equal_contacts_return_on_expiry() {
    let (mut world, moving, target) = dominance_pair(0, false);
    let target = target.unwrap();
    // The pair has not touched yet. Changing just the group must affect the upcoming contact.
    for _ in 0..4 {
        world.step();
    }
    let body = &mut world.bodies[moving];
    let (mass, speed) = (body.mass(), body.linvel().x);
    body.set_dominance_group(1);
    assert_eq!(body.dominance_group(), 1);
    assert_eq!((body.mass(), body.linvel().x), (mass, speed));
    for _ in 0..60 {
        world.step();
    }
    println!(
        "setter contact speeds: {}, {}",
        world.bodies[moving].linvel().x,
        world.bodies[target].linvel().x
    );
    assert!((world.bodies[moving].linvel().x - 15.0).abs() < 0.01);
    assert!(world.bodies[target].linvel().x > 14.9);

    // Force a fresh approaching contact in the existing world, then expire at the boundary.
    // Placement is test setup; no pose/velocity scripting belongs in the gameplay buff.
    world.bodies[moving].set_translation(Vector::new(-2.01, 0.0, 0.0), true);
    world.bodies[target].set_translation(Vector::ZERO, true);
    world.bodies[moving].set_linvel(Vector::new(15.0, 0.0, 0.0), true);
    world.bodies[target].set_linvel(Vector::ZERO, true);
    world.bodies[moving].set_dominance_group(0);
    for _ in 0..4 {
        world.step();
    }
    let a = world.bodies[moving].linvel().x;
    let b = world.bodies[target].linvel().x;
    assert!(
        (a - 7.5).abs() < 0.1 && (b - 7.5).abs() < 0.1,
        "ordinary two-way contact returns: {a}, {b}"
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn restoring_equal_dominance_separates_a_stationary_overlap_without_launching_it() {
    let (mut world, moving, target) = dominance_pair(1, false);
    let target = target.unwrap();
    // A settable overlap is deliberate, rather than relying on one exact collision trajectory.
    world.bodies[moving].set_translation(Vector::new(-1.8, 0.0, 0.0), true);
    world.bodies[moving].set_linvel(Vector::ZERO, true);
    world.step();
    world.bodies[moving].set_dominance_group(0);
    let before = world.bodies[moving].kinetic_energy() + world.bodies[target].kinetic_energy();
    let mut max_energy = before;
    for _ in 0..120 {
        world.step();
        max_energy = max_energy
            .max(world.bodies[moving].kinetic_energy() + world.bodies[target].kinetic_energy());
    }
    let gap = world.bodies[target].translation().x - world.bodies[moving].translation().x;
    println!("dominance overlap expiry: before={before} J, maximum={max_energy} J, gap={gap} m");
    assert!(
        gap > 1.98,
        "position correction separates the overlap: {gap}"
    );
    assert!(
        max_energy - before < 1.0,
        "stationary expiry must not launch: {max_energy} J"
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn dominance_contact_models_work_with_either_body_insertion_order() {
    for friction in [FrictionModel::Simplified, FrictionModel::Coulomb] {
        for target_first in [false, true] {
            for (group, fixed) in [(0, false), (1, false), (1, true)] {
                let (mut world, moving, target) =
                    dominance_pair_ordered(group, fixed, target_first, friction);
                for _ in 0..60 {
                    world.step();
                }
                let speed = world.bodies[moving].linvel().x;
                let expected = if fixed {
                    0.0
                } else if group == 0 {
                    7.5
                } else {
                    15.0
                };
                assert!(
                    (speed - expected).abs() < 0.1,
                    "{friction:?}, target_first={target_first}, group={group}, fixed={fixed}: {speed}"
                );
                if let Some(target) = target {
                    assert!((world.bodies[target].linvel().x - expected).abs() < 0.1);
                    let gap =
                        world.bodies[target].translation().x - world.bodies[moving].translation().x;
                    assert!(
                        gap > 1.98,
                        "{friction:?}, target_first={target_first}: gap={gap}"
                    );
                } else {
                    assert!(world.bodies[moving].translation().x < -1.9);
                }
            }
        }
    }
}

/// parry 0.31.1 (vendor/parry3d/JAMMERS-PATCH.md, br-zrat): a ray straight down a flat heightfield exactly on a cell
/// edge missed it whenever rounding put the point a hair outside the cell it was looked up in. A level bike placed on a
/// 10 m grid line (x = 20 on scenarios/bikes/flat-strips.json) fell 0.44 m through the ground onto its hull. Every grid
/// line and the cell interiors either side now hit at the ground's height, for a ray exactly vertical (WASM's level
/// wheel) and one an ulp or so off it (native rotation maths), so both platforms take the same path.
#[test]
fn a_vertical_ray_on_a_heightfield_grid_line_hits_the_ground() {
    let (rows, cols, spacing) = (17usize, 38usize, 10.0f32);
    let heights = rapier3d::parry::utils::Array2::from_fn(rows, cols, |_, _| 0.0f32);
    let (sx, sz) = ((cols - 1) as f32 * spacing, (rows - 1) as f32 * spacing);
    let ground = ColliderBuilder::heightfield(heights, Vector::new(sx, 1.0, sz))
        .translation(Vector::new(-140.0 + sx / 2.0, 0.0, -50.0 + sz / 2.0))
        .build();
    let mut missed = Vec::new();
    for dir in [
        Vector::new(0.0, -1.0, 0.0),
        Vector::new(1e-7, -1.0, -1e-7),
        Vector::new(-3e-8, -1.0, 6e-8),
    ] {
        for j in 1..cols - 1 {
            for dx in [0.0f32, -0.001, 0.001] {
                for z in [-45.0f32, -40.0, 0.0] {
                    let x = -140.0 + j as f32 * spacing + dx;
                    let ray = Ray::new(Vector::new(x, 0.5, z), dir);
                    let hit = ground.shape().cast_ray(ground.position(), &ray, 2.0, true);
                    if hit.is_none_or(|t| (t - 0.5).abs() > 1e-4) {
                        missed.push((dir, x, z, hit));
                    }
                }
            }
        }
    }
    assert!(missed.is_empty(), "rays that missed the ground: {missed:?}");
}
