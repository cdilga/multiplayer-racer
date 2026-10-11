//! P1-PT-rooftop: the town house's collision surfaces match its code-built gable and verandah.
//! Normalised dimensions are the house kit's, not a new invisible platform above the visible roof.
use jj_map::{Dressing, Surface, Terrain};
use rapier3d::control::Wheel;
use rapier3d::prelude::*;

use crate::vehicle;

/// Terrain membership prevents physical wheel shapes fighting suspension on a roof. The extra bit
/// identifies the roof's tyre surface without changing body/ghost/protected collision filters.
pub(crate) const ROOF: Group = Group::GROUP_9;

pub(crate) fn surface(
    terrain: &Terrain,
    colliders: &ColliderSet,
    wheel: &Wheel,
    at: Vector,
) -> Surface {
    let contact = wheel.raycast_info();
    if contact.is_in_contact
        && contact
            .ground_object
            .and_then(|h| colliders.get(h))
            .is_some_and(|c| c.collision_groups().memberships.contains(ROOF))
    {
        Surface::Tarmac
    } else {
        vehicle::surface_at(terrain, at.x, at.z)
    }
}

/// Keep the full registry footprint for placement; only the physical proxy is decomposed here.
pub(crate) fn insert_house(
    world: &mut PhysicsWorld,
    d: &Dressing,
    walls: InteractionGroups,
    roof: InteractionGroups,
) -> bool {
    if d.kit_piece != "town/house" {
        return false;
    }
    let dimension = |key: &str, scale: f32| d.params.get(key).copied().map(|n| n as f32 * scale);
    let (Some(w), Some(h), Some(z)) = (
        dimension("widthMm", 0.001),
        dimension("heightCm", 0.01),
        dimension("depthMm", 0.001),
    ) else {
        return false;
    };
    let yaw = Rotation::from_scaled_axis(Vector::new(
        0.0,
        -(d.pose.yaw as f32 / 100.0).to_radians(),
        0.0,
    ));
    let origin = Vector::new(
        d.pose.x as f32 / 1000.0,
        d.pose.y as f32 / 1000.0,
        d.pose.z as f32 / 1000.0,
    );
    let scaled = |p: [f32; 3]| Vector::new(p[0] * w, p[1] * h, p[2] * z);
    let mut hull = |points: &[[f32; 3]], groups: InteractionGroups| {
        let points: Vec<Vector> = points.iter().map(|&p| scaled(p)).collect();
        let shape = ColliderBuilder::convex_hull(&points).expect("house kit hull has volume");
        world.insert_collider(
            shape
                .translation(origin)
                .rotation(yaw.to_scaled_axis())
                .collision_groups(groups),
            None,
        );
    };
    // Gable: the renderer's ridge runs along x, z=-0.11, eaves at y=0.6.
    hull(
        &[
            [-0.5, 0.6, -0.5],
            [0.5, 0.6, -0.5],
            [-0.5, 0.6, 0.28],
            [0.5, 0.6, 0.28],
            [-0.5, 1.0, -0.11],
            [0.5, 1.0, -0.11],
        ],
        roof,
    );
    // Verandah lean-to: its thin sheet follows the renderer's sloping surface.
    hull(
        &[
            [-0.5, 0.556, 0.24],
            [0.5, 0.556, 0.24],
            [-0.5, 0.466, 0.5],
            [0.5, 0.466, 0.5],
            [-0.5, 0.568, 0.24],
            [0.5, 0.568, 0.24],
            [-0.5, 0.478, 0.5],
            [0.5, 0.478, 0.5],
        ],
        roof,
    );
    let mut box_piece = |centre: [f32; 3], size: [f32; 3]| {
        let c = origin + yaw * scaled(centre);
        let half = scaled(size) * 0.5;
        world.insert_collider(
            ColliderBuilder::cuboid(half.x, half.y, half.z)
                .translation(c)
                .rotation(yaw.to_scaled_axis())
                .collision_groups(walls),
            None,
        );
    };
    box_piece([0., 0.31, -0.12], [0.9, 0.62, 0.72]);
    box_piece([0., 0.035, 0.37], [0.9, 0.07, 0.25]);
    box_piece([0.28, 0.845, -0.22], [0.07, 0.25, 0.07]);
    for x in [-0.45, -0.15, 0.15, 0.45] {
        box_piece([x, 0.2525, 0.48], [0.022, 0.445, 0.022]);
    }
    true
}
