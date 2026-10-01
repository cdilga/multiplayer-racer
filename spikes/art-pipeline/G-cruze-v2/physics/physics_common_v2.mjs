// physics_common_v2.mjs — Rapier world/vehicle setup for the G-cruze-v2 asset (cruz_missile).
//
// World convention: glTF space as loaded by load_vehicle_v2.mjs — Y up, -Z forward, X right,
// gravity (0,-9.81,0). Same convention as the C-physics spike; "forward" for driving is -Z.

import RAPIER from "@dimforge/rapier3d-compat";

let initialized = false;
export async function ensureInit() {
    if (!initialized) { await RAPIER.init(); initialized = true; }
    return RAPIER;
}

export const DT = 1 / 120;

// ---- collision groups (see interaction_groups.d.ts: top 16 bits = membership, bottom 16 = filter
// mask; two colliders interact iff each one's membership has a bit in common with the OTHER's
// filter). Used by test_detach_v2.mjs to give freshly-detached debris a brief grace period where it
// doesn't collide with its own source car — see that file and REPORT.md "asset problems" for why:
// this asset's panel box colliders (col_door_L etc.) sit fully inside col_chassis's convex-hull AABB
// while the panel is closed, so treating a panel as a separate solid body at the exact moment of
// detach causes an immediate depenetration "pop" (empirically ~2.1 m/s in one 1/120s step here).
export const GROUP_CAR = 1 << 0;
export const GROUP_GROUND = 1 << 1;
export const GROUP_DEBRIS = 1 << 2;
export const GROUP_ALL = 0xffff;
export function interactionGroups(membership, filter) { return ((membership & 0xffff) << 16) | (filter & 0xffff); }

export function createWorld() {
    return new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}

/** A large flat ground collider, top surface at y=0, friction 1.0. */
export function createGround(world, { halfExtent = 200 } = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtent, 0.5, halfExtent)
        .setTranslation(0, -0.5, 0)
        .setFriction(1.0)
        .setCollisionGroups(interactionGroups(GROUP_GROUND, GROUP_ALL));
    return world.createCollider(desc);
}

function boxInertia(mass, fullX, fullY, fullZ) {
    return {
        x: (mass / 12) * (fullY * fullY + fullZ * fullZ),
        y: (mass / 12) * (fullX * fullX + fullZ * fullZ),
        z: (mass / 12) * (fullX * fullX + fullY * fullY),
    };
}

// ---- suspension tuning (derived, not fudged — see REPORT.md "Suspension derivation") ----
//
// Rapier's DynamicRayCastVehicleController is Bullet's btRaycastVehicle model under the hood.
// Bullet's updateSuspension() computes, per wheel:
//   force = stiffness * (restLength - currentLength) - damping * suspensionRelativeVelocity
//   wheel.suspensionForce = force * chassisMass
// i.e. `stiffness`/`damping` are already "per unit chassis mass" accelerations — `stiffness` has
// units of rad^2/s^2 (an angular natural frequency squared), independent of the vehicle's actual
// mass. That means we can pick a target ride frequency directly:
//   stiffness = (2 * pi * f_hz)^2
//
// f_hz = 1.3 Hz: firmer than a soft family sedan (~1 Hz) and firmer than the C-physics spike's
// asset, which used stiffness=26 -> f = sqrt(26)/(2*pi) ~= 0.81 Hz and sagged to a resting ride
// height 0.54 m vs its 0.72 m authored height (REPORT.md #2 there: "soft, untuned suspension").
// Cruz Missile's authored hub height is 0.44 m; 1.3 Hz gets us close to that without changing wheel
// geometry or force-fudging anything (verified below in the settle test).
export const RIDE_FREQUENCY_HZ = 1.3;
export const SUSPENSION_STIFFNESS = (2 * Math.PI * RIDE_FREQUENCY_HZ) ** 2; // ~= 66.6

// Damping: expressed as a fraction of 2*sqrt(stiffness) (the critical-damping reference for a
// simple spring-mass system, standard in Bullet-vehicle tuning guides). We deliberately damp
// compression LESS (0.4) than relaxation (0.6) — the same qualitative asymmetry as the C-physics
// spike (3.2 / 4.4 => ratios 0.31 / 0.43) — so the wheel can absorb a bump quickly (compression)
// but the spring doesn't overshoot/bounce back on the way out (relaxation). Both ratios are inside
// Bullet's commonly-documented range (~0.2-0.9) for this controller; no term here is a force
// multiplier hack.
const CRITICAL_DAMPING = 2 * Math.sqrt(SUSPENSION_STIFFNESS);
export const SUSPENSION_COMPRESSION_RATIO = 0.4;
export const SUSPENSION_RELAXATION_RATIO = 0.6;
export const SUSPENSION_COMPRESSION = SUSPENSION_COMPRESSION_RATIO * CRITICAL_DAMPING;
export const SUSPENSION_RELAXATION = SUSPENSION_RELAXATION_RATIO * CRITICAL_DAMPING;

/**
 * Builds a vehicle rigid body + DynamicRayCastVehicleController from loaded vehicle data.
 * Adds one Rapier collider per sidecar collider entry EXCEPT the wheel cylinders (informational
 * only, per ASSET-CONTRACT.md — solid cylinder colliders at the hubs would double up with, and
 * fight, the controller's own raycast wheels).
 */
export function buildVehicle(world, v, { spawn = [0, v.groundOffsetY, 0], spawnRotation = null } = {}) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn[0], spawn[1], spawn[2])
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.1);
    if (spawnRotation) bodyDesc.setRotation(spawnRotation);
    const body = world.createRigidBody(bodyDesc);

    const colliderHandles = {};
    for (const [name, c] of Object.entries(v.colliders)) {
        if (c.shape === "cylinder") continue; // wheel proxy — informational only, see header comment
        let desc;
        if (c.shape === "convex") {
            desc = RAPIER.ColliderDesc.convexHull(c.chassisRelVerts);
            if (!desc) throw new Error(`${name}: convexHull() returned null — degenerate/near-planar vertex set`);
        } else if (c.shape === "box") {
            desc = RAPIER.ColliderDesc.cuboid(...c.halfExtents).setTranslation(...c.centerRel);
        } else {
            throw new Error(`${name}: unsupported collider shape '${c.shape}'`);
        }
        desc.setDensity(0).setFriction(0.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setCollisionGroups(interactionGroups(GROUP_CAR, GROUP_ALL));
        colliderHandles[name] = world.createCollider(desc, body).handle;
    }

    // Mass/inertia: density 0 on every collider above (geometry only), real mass+CoM applied here
    // from the sidecar-declared total mass and the `com` anchor, with a box-inertia approximation
    // from col_chassis's overall extents (same approximation the C-physics spike used).
    const chassisC = v.colliders.col_chassis;
    const [fx, fy, fz] = chassisC.halfExtents.map((h) => h * 2);
    const inertia = boxInertia(v.totalMassKg, fx, fy, fz);
    body.setAdditionalMassProperties(
        v.totalMassKg,
        { x: v.anchors.com[0], y: v.anchors.com[1], z: v.anchors.com[2] },
        { x: inertia.x, y: inertia.y, z: inertia.z },
        { x: 0, y: 0, z: 0, w: 1 },
        true,
    );

    const controller = world.createVehicleController(body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2; // see C-physics REPORT.md #6 — real setter despite the odd name

    const order = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
    const wheelIndex = {};
    order.forEach((name, i) => {
        const w = v.wheels[name];
        const s = v.suspension[name];
        wheelIndex[name] = i;
        // Connection point = hub + restLength straight up (matches the sidecar exactly: hub.y=0.44,
        // restLength=0.52 -> 0.96, which equals the sidecar's own top_mount.y for every wheel — the
        // control-arm's horizontal offset in top_mount.x is a visual-rig detail, not part of the
        // vertical raycast-suspension geometry the controller needs).
        controller.addWheel(
            { x: w.hubRel[0], y: w.hubRel[1] + s.restLength, z: w.hubRel[2] },
            { x: 0, y: -1, z: 0 },
            { x: 1, y: 0, z: 0 },
            s.restLength,
            w.radius,
        );
        controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
        controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
        controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
        // sidecar travel is asymmetric ([-0.1, +0.12] m); this controller takes one symmetric
        // scalar, so we use the larger magnitude (0.12 m) — see REPORT.md "asset problems".
        controller.setWheelMaxSuspensionTravel(i, Math.max(...s.travel.map((t) => Math.abs(t))));
        // Per-wheel force cap well above any static/dynamic load we expect (static share is
        // totalWeight/4 ~= 3065 N per wheel; 4x TOTAL vehicle weight per wheel is a big margin for
        // braking/cornering load transfer and bump loads without ever being the limiting factor).
        controller.setWheelMaxSuspensionForce(i, v.totalMassKg * 9.81 * 4);
        controller.setWheelFrictionSlip(i, 1000);
        controller.setWheelSideFrictionStiffness(i, 1.0);
    });

    const drivenWheels = order.filter((n) => v.wheels[n].driven).map((n) => wheelIndex[n]);
    const steerWheels = order.filter((n) => v.wheels[n].steer).map((n) => wheelIndex[n]);

    return { body, controller, wheelIndex, drivenWheels, steerWheels, colliderHandles };
}

/** +1 * engineForce drives the chassis toward world -Z (the asset's authored front). */
export const FORWARD_SIGN = 1;

/**
 * `updateVehicle()` does not wake a sleeping chassis (C-physics REPORT.md #5) — wake explicitly
 * every step so a stationary "AFK" car still responds to input.
 */
export function stepWorld(world, controller, dt = DT) {
    if (controller.chassis().isSleeping()) controller.chassis().wakeUp();
    controller.updateVehicle(dt);
    world.step();
}

export function quatFromAxisAngle(axis, angleRad) {
    const s = Math.sin(angleRad / 2);
    return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angleRad / 2) };
}
