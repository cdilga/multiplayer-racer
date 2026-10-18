//! The nose climbs (P1-FL12, R133): a car with `tuning.nose_climb` crawling into a bank with the throttle on gets its
//! nose up it the way a tyre's leading edge would.
//!
//! Rapier's raycast wheels have no leading edge: a wheel only finds the ground straight under its hard point. A car whose
//! bumper hangs ahead of and below its front tyres' reach (the Tradie Ute's bull bar and winch hook, 0.29 m up and
//! 1.33 m ahead of the front axle) meets a bank's foot with the bumper first and pins itself there, rear tyres spinning.
//! Below `below_mps`, with throttle on, each of the car's contacts with the ground that sits ahead of the front axle on
//! a bank face (not flat ground, not a wall) becomes a belt running up the face at `belt_mps` with a tyre's `grip`: the
//! solver's tangent velocity there, as for a conveyor. The bumper rides up until the front tyres reach the face and
//! drive. Above the
//! speed, or off the throttle, contacts are Rapier's own, so a car that hits a bank at speed doesn't launch off it (the
//! R122 bank).
//!
//! The tail is the other end of the same problem: as the nose goes up a bank the rear overhang (bumper corners, tow hitch)
//! swings down onto the foot's gentle slope behind the rear axle, and a body with friction there props the rear tyres off
//! the ground (br-bbki.12: the rebuilt Ute's lower step-bumper corners stalled it 2.6 m up). A bumper skids; so a climber's
//! contacts with a bank face that lie wholly behind the rear axle have no friction.
//!
//! The work a belt does is authorised in the energy ledger (`Sim::step`).

use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};

/// A contact normal this upright or more is ground the car's wheels stand on, not a face to climb.
const FLAT_NORMAL_Y: f32 = 0.95;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoseClimb {
    /// The forward speed below which the nose climbs, m/s.
    pub below_mps: f32,
    /// The belt's speed up a bank's face, m/s.
    pub belt_mps: f32,
    /// The climbing contacts' friction: a tyre's grip on the face, not the body's.
    pub grip: f32,
}

/// One car whose nose climbs this step: its body, its front axle (vehicle space, z), its belt speed and grip.
pub(crate) struct Climber {
    pub body: RigidBodyHandle,
    pub front_axle_z: f32,
    /// Its rear axle (vehicle space, z).
    pub rear_axle_z: f32,
    pub belt_mps: f32,
    pub grip: f32,
}

/// The contact hook for one step.
pub(crate) struct Hooks<'a> {
    pub climbers: &'a [Climber],
    /// A face no steeper than this (its normal's y) is a bank; steeper is a wall the car's drive can't use either.
    pub wall_normal_y: f32,
    /// Collision groups that are ground (terrain, the world's static solids).
    pub ground: Group,
    /// The guard rails' beams (`crate::rails`), and the |normal y| below which a contact with one is a side hit.
    pub rails: &'a [RigidBodyHandle],
    pub rail_side_normal_max_y: f32,
}

impl Hooks<'_> {
    /// A guard rail redirects (br-bbki.25, owner playtest 2026-10-17: "landing and colliding … re launched the car into
    /// the air"). A rigid box hit by a car's wedge-shaped hull at an angle acts as a ramp: the contact normal on the
    /// beam's top edge or the hull's sloped nose tips up and the car vaults the rail. A real W-beam deforms around the car
    /// instead. So a side hit's normal is laid flat: the beam pushes across, never up. Something resting on the beam's
    /// top (a normal steeper than the threshold) is left alone.
    fn rail_side_hit(&self, ctx: &mut ContactModificationContext) -> bool {
        let is_rail = |b: Option<RigidBodyHandle>| b.is_some_and(|b| self.rails.contains(&b));
        if !(is_rail(ctx.rigid_body1) || is_rail(ctx.rigid_body2)) {
            return false;
        }
        let Some(m) = ctx.rigid_mut() else {
            return true;
        };
        let n = *m.normal;
        if n.y.abs() < self.rail_side_normal_max_y {
            let flat = Vector::new(n.x, 0.0, n.z);
            if flat.length() > 1e-3 {
                *m.normal = flat.normalize();
            }
        }
        true
    }
}

impl PhysicsHooks for Hooks<'_> {
    fn modify_solver_contacts(&self, ctx: &mut ContactModificationContext) {
        if self.rail_side_hit(ctx) {
            return;
        }
        let (body1, body2) = (ctx.rigid_body1, ctx.rigid_body2);
        let Some((climber, car_first)) = self.climbers.iter().find_map(|c| {
            if body1 == Some(c.body) {
                Some((c, true))
            } else if body2 == Some(c.body) {
                Some((c, false))
            } else {
                None
            }
        }) else {
            return;
        };
        let other = if car_first {
            ctx.collider2
        } else {
            ctx.collider1
        };
        if !ctx
            .colliders
            .get(other)
            .is_some_and(|c| c.collision_groups().memberships.intersects(self.ground))
        {
            return;
        }
        let Some(pose) = ctx.bodies.get(climber.body).map(|b| *b.position()) else {
            return;
        };
        let Some(m) = ctx.rigid_mut() else {
            return;
        };
        // The manifold's normal points from collider 1 to collider 2; the face's normal points out of the ground.
        let face = if car_first { -*m.normal } else { *m.normal };
        if !(face.y > self.wall_normal_y && face.y < FLAT_NORMAL_Y) {
            return;
        }
        let fwd = pose.rotation * Vector::Z;
        let up_face = (fwd - face * fwd.dot(face)).normalize_or_zero();
        if up_face.y <= 0.0 {
            return;
        }
        let mut climbing = false;
        for c in m.solver_contacts.iter_mut() {
            let at = if car_first { c.anchor1 } else { c.anchor2 };
            if pose.inverse_transform_point(at).z > climber.front_axle_z {
                // The solver drives the contact's relative tangent velocity (collider 1's against collider 2's) toward
                // this: the car runs up the face.
                c.tangent_velocity =
                    up_face * climber.belt_mps * if car_first { -1.0 } else { 1.0 };
                climbing = true;
            }
        }
        if climbing {
            *m.friction = m.friction.max(climber.grip);
        } else if m.solver_contacts.iter().all(|c| {
            let at = if car_first { c.anchor1 } else { c.anchor2 };
            pose.inverse_transform_point(at).z < climber.rear_axle_z
        }) {
            *m.friction = 0.0;
        }
    }
}
