//! Riding a loop (br-xlvx.6, R124/R138: driving feel authored, not simulated). A raycast car's suspension holds about 2 g
//! and a loop at speed asks 6-11 g of the deck, so a car on a loop is carried like a coaster: once it reaches the deck
//! near the entry, heading along it and faster than the loop's `minSpeedMms`, the loop holds it on the deck's centre
//! line at the lateral offset and ride height it arrived with. Its speed along the line changes with gravity along the
//! curve, its own throttle (the profile's engine force, capped by its power) and brake; its pose follows the deck's frame,
//! upside down at the top. At the exit the loop lets it go along the road. If its speed drops below `minSpeedMms` on the
//! way round, the loop lets go there and the car falls (the sim then respawns it before the loop).
//!
//! Every change the ride makes to a body's energy is booked in the sim's ledger, and its state is part of the full-state
//! hash while a car rides. The geometry is `jj_map::looping`'s, so the car rides the triangles the renderer draws.

use jj_map::looping::{self, LoopDesign, LoopFrame};
use rapier3d::prelude::*;

/// A loop, ready to ride: its design and frame, and its deck sections' centres for finding where a car meets it.
pub(crate) struct LoopRail {
    pub(crate) design: LoopDesign,
    frame: LoopFrame,
    centres: Vec<Vector>,
}

/// A car riding a loop: which, how far round (t in 0..1), its speed along the line (m/s), and the lateral offset and
/// ride height above the deck's centre line it holds (m).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LoopRide {
    pub(crate) rail: usize,
    pub(crate) t: f64,
    pub(crate) speed: f32,
    lateral: f32,
    height: f32,
}

impl LoopRide {
    pub(crate) fn hash_into(&self, out: &mut Vec<u8>) {
        out.extend((self.rail as u32).to_le_bytes());
        out.extend(self.t.to_bits().to_le_bytes());
        for v in [self.speed, self.lateral, self.height] {
            out.extend(v.to_bits().to_le_bytes());
        }
    }
}

/// Where a lock-on may start: the first part of the deck, before it steepens much.
const LOCK_T: f64 = 0.1;
/// The car must head along the deck (cosine between its velocity and the deck's tangent).
const LOCK_HEADING: f32 = 0.8;
/// Lateral offset is kept inside the deck by this margin, m.
const EDGE_MARGIN_M: f32 = 1.0;

fn v3(a: [f64; 3]) -> Vector {
    Vector::new(a[0] as f32, a[1] as f32, a[2] as f32)
}

impl LoopRail {
    pub(crate) fn new(map: &jj_map::model::Map, design: LoopDesign) -> Option<Self> {
        let frame = looping::frame(map, &design)?;
        let centres = looping::sections(&frame, &design)
            .iter()
            .map(|s| v3(s.c))
            .collect();
        Some(Self {
            design,
            frame,
            centres,
        })
    }

    /// The deck's centre, tangent, side and normal at t.
    fn at(&self, t: f64) -> (Vector, Vector, Vector, Vector) {
        let s = looping::section_at(&self.frame, &self.design, t);
        (
            v3(s.c),
            v3(looping::tangent(&self.frame, self.design.radius_m, t)),
            v3(s.side),
            v3(s.normal),
        )
    }

    /// A car at `pos` moving at `vel`, with a wheel on this loop's deck: the ride it starts, if it qualifies (near the
    /// entry, heading along the deck, fast enough).
    pub(crate) fn lock_on(&self, rail: usize, pos: Vector, vel: Vector) -> Option<LoopRide> {
        let n = self.centres.len() - 1;
        let k = (0..=n)
            .min_by(|&a, &b| {
                (self.centres[a] - pos)
                    .length_squared()
                    .total_cmp(&(self.centres[b] - pos).length_squared())
            })
            .unwrap_or(0);
        let t = k as f64 / n as f64;
        if t > LOCK_T {
            return None;
        }
        let (c, tangent, side, normal) = self.at(t);
        let speed = vel.dot(tangent);
        if f64::from(speed) < self.design.min_speed_mps
            || vel.normalize_or_zero().dot(tangent) < LOCK_HEADING
        {
            return None;
        }
        let rel = pos - c;
        let half = self.frame.half_width as f32 - EDGE_MARGIN_M;
        Some(LoopRide {
            rail,
            t,
            speed,
            lateral: rel.dot(side).clamp(-half, half),
            height: rel.dot(normal).max(0.0),
        })
    }

    /// The pose and velocities for a ride at its current t: (position, rotation, linear velocity, angular velocity).
    pub(crate) fn pose(&self, ride: &LoopRide, dt: f32) -> (Vector, Rotation, Vector, Vector) {
        let (c, tangent, side, normal) = self.at(ride.t);
        let rotation = frame_rotation(side, normal, tangent);
        // The angular velocity that turns this frame into the next tick's.
        let ahead = (ride.t
            + f64::from(ride.speed * dt)
                / looping::metres_per_t(&self.frame, self.design.radius_m, ride.t))
        .min(1.0);
        let (_, t2, s2, n2) = self.at(ahead);
        let turn = frame_rotation(s2, n2, t2) * rotation.inverse();
        let (axis, angle) = turn.to_axis_angle();
        let angvel = if angle.is_finite() {
            axis * (angle / dt)
        } else {
            Vector::ZERO
        };
        (
            c + side * ride.lateral + normal * ride.height,
            rotation,
            tangent * ride.speed,
            angvel,
        )
    }

    /// Advances a ride one tick: gravity along the curve, the engine (`drive_accel`, m/s², already capped by power) and
    /// the brake (`brake_accel`). Returns the ride carried on, or why it ended.
    pub(crate) fn advance(
        &self,
        mut ride: LoopRide,
        gravity: Vector,
        drive_accel: f32,
        brake_accel: f32,
        dt: f32,
    ) -> RideStep {
        let (_, tangent, _, _) = self.at(ride.t);
        let accel = gravity.dot(tangent) + drive_accel - brake_accel.min(ride.speed.max(0.0) / dt);
        ride.speed += accel * dt;
        if f64::from(ride.speed) < self.design.min_speed_mps {
            return RideStep::TooSlow(ride);
        }
        ride.t += f64::from(ride.speed * dt)
            / looping::metres_per_t(&self.frame, self.design.radius_m, ride.t);
        if ride.t >= 1.0 {
            ride.t = 1.0;
            return RideStep::Out(ride);
        }
        RideStep::On(ride)
    }
}

/// What a tick of riding did.
pub(crate) enum RideStep {
    /// Still on the loop.
    On(LoopRide),
    /// Out of the exit, onto the road: let go at the exit pose.
    Out(LoopRide),
    /// Slower than the loop's minimum: let go where it is, and it falls.
    TooSlow(LoopRide),
}

/// The rotation whose car axes are: +X the car's left (`side`), +Y its up (`normal`), +Z its nose (`forward`).
fn frame_rotation(side: Vector, normal: Vector, forward: Vector) -> Rotation {
    Rotation::from_mat3(&rapier3d::glamx::Mat3::from_cols(side, normal, forward)).normalize()
}
