//! Loose-part hinge springs (P1-S04b, plan §6.3): a part that's loose stays attached, its collider stays at the attached
//! pose, and a damped 1-DOF spring about its hinge axis swings it on the chassis' accelerations. The spring is state the
//! snapshot publishes for the renderer (the hinge angle); it never pushes back on the body, so it can't inject energy
//! (visual springs, not joints: Spike I). Everything here is plain `f32` arithmetic in a fixed order, so native and WASM
//! agree bit for bit.

use rapier3d::prelude::Vector;

/// One part's hinge angle and rate (radians, radians/s), 0 = closed or hanging at rest.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Spring {
    pub angle: f32,
    pub rate: f32,
}

/// A part's hinge in vehicle space.
#[derive(Clone, Copy, Debug)]
pub struct Hinge {
    /// Unit axis.
    pub axis: Vector,
    /// From the pivot to the part's centre of mass.
    pub arm: Vector,
    /// Limits, radians.
    pub lo: f32,
    pub hi: f32,
}

impl Spring {
    /// One tick: `force` is the apparent force per unit mass on the part in vehicle space (gravity minus the chassis'
    /// acceleration), `stiffness` and `damping` the spring's. Semi-implicit Euler, clamped to the limits with the rate
    /// zeroed against a stop (an inelastic stop never gives energy back).
    pub fn step(&mut self, h: &Hinge, force: Vector, stiffness: f32, damping: f32, dt: f32) {
        let along = h.arm.dot(h.axis);
        let r2 = (h.arm.length_squared() - along * along).max(0.01);
        let torque = h.axis.dot(h.arm.cross(force));
        let accel = torque / r2 - stiffness * self.angle - damping * self.rate;
        self.rate += accel * dt;
        self.angle += self.rate * dt;
        if self.angle < h.lo {
            self.angle = h.lo;
            self.rate = self.rate.max(0.0);
        } else if self.angle > h.hi {
            self.angle = h.hi;
            self.rate = self.rate.min(0.0);
        }
    }
}
