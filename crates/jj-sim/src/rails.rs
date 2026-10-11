//! Compliant W-beam sections (owner playtest 2, br-gw74.9). Collision impulses move a dynamic section
//! across the road; a force-based Rapier prismatic spring returns it. No car steering/velocity override.
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};

use crate::damage::episodes::TAG_RAIL;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RailProfile {
    pub version: u32,
    pub mass_kg_per_m: f32,
    pub stiffness_n_per_m_per_m: f32,
    pub damping_ratio: f32,
    pub travel_m: f32,
    pub sleep_speed_mps: f32,
    pub solver_iterations: usize,
    pub join_stiffness_n_per_m: f32,
    pub join_damping_ratio: f32,
    pub join_distance_m: f32,
    pub friction: f32,
    pub restitution: f32,
    pub end_radius_m: f32,
}

impl RailProfile {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1 {
            return Err("unsupported rail profile version");
        }
        if [
            self.mass_kg_per_m,
            self.stiffness_n_per_m_per_m,
            self.damping_ratio,
            self.travel_m,
            self.sleep_speed_mps,
            self.join_stiffness_n_per_m,
            self.join_damping_ratio,
            self.join_distance_m,
            self.end_radius_m,
        ]
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.0)
            || !self.friction.is_finite()
            || self.friction < 0.0
            || !self.restitution.is_finite()
            || !(0.0..=1.0).contains(&self.restitution)
            || self.solver_iterations == 0
        {
            return Err(
                "rail profile needs finite physical coefficients and positive mass, spring, damping and travel",
            );
        }
        Ok(())
    }

    pub fn standard() -> Self {
        let p: Self = serde_json::from_str(include_str!("../../../assets/physics/guard-rail.json"))
            .expect("shipped rail profile parses");
        p.validate().expect("shipped rail profile validates");
        p
    }
}

/// Stable map dressing index, not a prop/debris index. The beam slides along its local +z normal.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RailState {
    pub dressing: u32,
    pub displacement_m: f32,
    pub velocity_mps: f32,
    pub travel_m: f32,
    pub spring_energy_j: f32,
    pub fixed: bool,
}

pub(crate) struct Rail {
    pub body: RigidBodyHandle,
    pub dressing: u32,
    rest: Vector,
    axis: Vector,
    stiffness: f32,
    travel: f32,
    half_length: f32,
}

impl Rail {
    pub(crate) fn insert(
        world: &mut PhysicsWorld,
        dressing: u32,
        centre: Vector,
        yaw: Vector,
        collider: ColliderBuilder,
        length: f32,
        p: RailProfile,
    ) -> Self {
        let mass = p.mass_kg_per_m * length;
        let stiffness = p.stiffness_n_per_m_per_m * length;
        // Damping ratio times critical damping, N s/m; the force-based motor integrates once in Rapier.
        let damping = p.damping_ratio * 2.0 * libm::sqrtf(stiffness * mass);
        let anchor = world
            .bodies
            .insert(RigidBodyBuilder::fixed().translation(centre).rotation(yaw));
        let body = world.bodies.insert(
            RigidBodyBuilder::dynamic()
                .translation(centre)
                .rotation(yaw)
                .gravity_scale(0.0)
                .additional_solver_iterations(p.solver_iterations)
                .ccd_enabled(true)
                .user_data(TAG_RAIL | u128::from(dressing)),
        );
        // Default car-sized sleeping tolerance can leave a visible spring offset. Sleeping remains available
        // after the beam has returned; use the data's small normal-speed threshold instead.
        world.bodies[body]
            .activation_mut()
            .normalized_linear_threshold = p.sleep_speed_mps;
        world.insert_collider(
            collider
                .mass(mass)
                .friction(p.friction)
                .friction_combine_rule(CoefficientCombineRule::Min)
                .restitution(p.restitution),
            Some(body),
        );
        world.impulse_joints.insert(
            anchor,
            body,
            PrismaticJointBuilder::new(Vector::Z)
                .contacts_enabled(false)
                .motor_model(MotorModel::ForceBased)
                .motor_position(0.0, stiffness, damping)
                .limits([-p.travel_m, p.travel_m]),
            true,
        );
        let axis = world.bodies[body].position().rotation * Vector::Z;
        Self {
            body,
            dressing,
            rest: centre,
            axis,
            stiffness,
            travel: p.travel_m,
            half_length: length / 2.0,
        }
    }

    pub(crate) fn state(&self, bodies: &RigidBodySet) -> RailState {
        let b = &bodies[self.body];
        let d = (b.position().translation - self.rest).dot(self.axis);
        RailState {
            dressing: self.dressing,
            displacement_m: d,
            velocity_mps: b.linvel().dot(self.axis),
            travel_m: self.travel,
            spring_energy_j: 0.5 * self.stiffness * d * d,
            fixed: b.is_fixed(),
        }
    }

    pub(crate) fn set(&self, bodies: &mut RigidBodySet, displacement: f32, velocity: f32) {
        let b = &mut bodies[self.body];
        b.set_translation(
            self.rest + self.axis * displacement.clamp(-self.travel, self.travel),
            true,
        );
        b.set_linvel(self.axis * velocity, true);
    }
}

/// The bolted beam join spreads a hit into its neighbours instead of presenting a new blunt end to the car.
/// A second passive motor resists relative normal displacement, with the same SI spring-energy accounting.
pub(crate) struct Join {
    a: RigidBodyHandle,
    b: RigidBodyHandle,
    local_a: Vector,
    local_b: Vector,
    normal: Vector,
    rest: f32,
    stiffness: f32,
}

impl Join {
    pub(crate) fn energy(&self, bodies: &RigidBodySet) -> f64 {
        let d = (bodies[self.b].position() * self.local_b
            - bodies[self.a].position() * self.local_a)
            .dot(self.normal)
            - self.rest;
        f64::from(0.5 * self.stiffness * d * d)
    }
}

pub(crate) fn connect(world: &mut PhysicsWorld, rails: &[Rail], p: RailProfile) -> Vec<Join> {
    use std::collections::BTreeMap;
    type Endpoint = (usize, Vector, Vector);
    let cell = |v: Vector| {
        (
            libm::floorf(v.x / p.join_distance_m) as i64,
            libm::floorf(v.y / p.join_distance_m) as i64,
            libm::floorf(v.z / p.join_distance_m) as i64,
        )
    };
    let mut cells: BTreeMap<(i64, i64, i64), Vec<Endpoint>> = BTreeMap::new();
    let mut joins = Vec::new();
    for (i, rail) in rails.iter().enumerate() {
        for sign in [-1.0, 1.0] {
            let local_b = Vector::X * (sign * rail.half_length);
            let point = world.bodies[rail.body].position() * local_b;
            let (x, y, z) = cell(point);
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        for &(j, local_a, other) in
                            cells.get(&(x + dx, y + dy, z + dz)).into_iter().flatten()
                        {
                            if i == j || point.distance(other) > p.join_distance_m {
                                continue;
                            }
                            let a = &rails[j];
                            // Normals may be flipped by a section's symmetric orientation: align them before averaging.
                            let axis = if a.axis.dot(rail.axis) < 0.0 {
                                -rail.axis
                            } else {
                                rail.axis
                            };
                            let normal = (a.axis + axis).normalize();
                            let rotation = Rotation::from_axis_angle(
                                Vector::Y,
                                libm::atan2f(normal.x, normal.z),
                            );
                            let fa = Pose::from_parts(
                                local_a,
                                world.bodies[a.body].position().rotation.inverse() * rotation,
                            );
                            let fb = Pose::from_parts(
                                local_b,
                                world.bodies[rail.body].position().rotation.inverse() * rotation,
                            );
                            let rest = (point - other).dot(normal);
                            let reduced_mass = world.bodies[a.body].mass()
                                * world.bodies[rail.body].mass()
                                / (world.bodies[a.body].mass() + world.bodies[rail.body].mass());
                            let damping = p.join_damping_ratio
                                * 2.0
                                * libm::sqrtf(p.join_stiffness_n_per_m * reduced_mass);
                            world.impulse_joints.insert(
                                a.body,
                                rail.body,
                                GenericJointBuilder::new(JointAxesMask::empty())
                                    .contacts_enabled(false)
                                    .local_frame1(fa)
                                    .local_frame2(fb)
                                    .motor_model(JointAxis::LinZ, MotorModel::ForceBased)
                                    .motor_position(
                                        JointAxis::LinZ,
                                        rest,
                                        p.join_stiffness_n_per_m,
                                        damping,
                                    ),
                                true,
                            );
                            joins.push(Join {
                                a: a.body,
                                b: rail.body,
                                local_a,
                                local_b,
                                normal,
                                rest,
                                stiffness: p.join_stiffness_n_per_m,
                            });
                        }
                    }
                }
            }
            cells
                .entry((x, y, z))
                .or_default()
                .push((i, local_b, point));
        }
    }
    joins
}
