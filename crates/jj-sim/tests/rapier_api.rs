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

#[test]
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

#[test]
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

#[test]
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

#[test]
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

#[test]
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

#[test]
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
