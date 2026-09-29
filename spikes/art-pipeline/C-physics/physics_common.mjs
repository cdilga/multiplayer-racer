// physics_common.mjs — shared Rapier world/vehicle setup for the C-physics spike scripts.
//
// World convention: glTF space as loaded by load_vehicle.mjs — Y up, -Z forward, X right,
// gravity (0,-9.81,0). "Forward" for driving is -Z; see driveSign() below for why.

import RAPIER from "@dimforge/rapier3d-compat";

let initialized = false;
export async function ensureInit() {
    if (!initialized) { await RAPIER.init(); initialized = true; }
    return RAPIER;
}

export const DT = 1 / 120;

export function createWorld() {
    return new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}

/** A large flat ground collider, top surface at y=0, friction 1.0. */
export function createGround(world, { halfExtent = 200 } = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtent, 0.5, halfExtent)
        .setTranslation(0, -0.5, 0)
        .setFriction(1.0);
    return world.createCollider(desc);
}

function boxInertia(mass, fullX, fullY, fullZ) {
    return {
        x: (mass / 12) * (fullY * fullY + fullZ * fullZ),
        y: (mass / 12) * (fullX * fullX + fullZ * fullZ),
        z: (mass / 12) * (fullX * fullX + fullY * fullY),
    };
}

/**
 * Builds a vehicle rigid body + DynamicRayCastVehicleController from loaded vehicle data.
 *
 * @param cabinShape 'round' (roundCuboid — the intended "rolls back when flipped" collider),
 *                   'box'   (plain cuboid — the flat-roof comparison from task 3),
 *                   'none'  (chassis-only collider, no cabin volume).
 */
export function buildVehicle(world, v, { spawn = [0, v.groundOffsetY, 0], spawnRotation = null, cabinShape = "round", cabinBorderRadius = 0.28 } = {}) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn[0], spawn[1], spawn[2])
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.1);
    if (spawnRotation) bodyDesc.setRotation(spawnRotation);
    const body = world.createRigidBody(bodyDesc);

    // Collider proxies (density 0 — mass comes from setAdditionalMassProperties below using the
    // 'com' marker and a box-inertia approximation of col_chassis; see REPORT.md #3).
    const chassisC = v.colliders.col_chassis;
    const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(...chassisC.halfExtents)
        .setTranslation(...chassisC.centerRel)
        .setDensity(0)
        .setFriction(0.7)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(chassisColliderDesc, body);

    let cabinColliderDesc = null;
    const cabinC = v.colliders.col_cabin_round;
    if (cabinC && cabinShape !== "none") {
        const [hx, hy, hz] = cabinC.halfExtents;
        if (cabinShape === "round") {
            const r = Math.min(cabinBorderRadius, hx, hy, hz) * 0.99;
            cabinColliderDesc = RAPIER.ColliderDesc.roundCuboid(hx - r, hy - r, hz - r, r);
        } else {
            cabinColliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
        }
        cabinColliderDesc.setTranslation(...cabinC.centerRel).setDensity(0).setFriction(0.7);
        world.createCollider(cabinColliderDesc, body);
    }

    const [fx, fy, fz] = chassisC.halfExtents.map((h) => h * 2);
    const inertia = boxInertia(v.totalMassKg, fx, fy, fz);
    body.setAdditionalMassProperties(
        v.totalMassKg,
        { x: v.markers.com[0], y: v.markers.com[1], z: v.markers.com[2] },
        { x: inertia.x, y: inertia.y, z: inertia.z },
        { x: 0, y: 0, z: 0, w: 1 },
        true,
    );

    const controller = world.createVehicleController(body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2; // NB: the .d.ts names the setter 'setIndexForwardAxis' (typo-looking but real, see REPORT.md #6)

    const order = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
    const wheelIndex = {};
    const REST_LENGTH = 0.28;
    order.forEach((name, i) => {
        const w = v.wheels[name];
        wheelIndex[name] = i;
        controller.addWheel(
            { x: w.hubRel[0], y: w.hubRel[1] + REST_LENGTH, z: w.hubRel[2] },
            { x: 0, y: -1, z: 0 },
            { x: 1, y: 0, z: 0 },
            REST_LENGTH,
            w.radius,
        );
        controller.setWheelSuspensionStiffness(i, 26);
        controller.setWheelSuspensionCompression(i, 3.2);
        controller.setWheelSuspensionRelaxation(i, 4.4);
        controller.setWheelMaxSuspensionTravel(i, 0.22);
        controller.setWheelMaxSuspensionForce(i, v.totalMassKg * 9.81 * 6);
        controller.setWheelFrictionSlip(i, 1000);
        controller.setWheelSideFrictionStiffness(i, 1.0);
    });

    return { body, controller, wheelIndex, restLength: REST_LENGTH };
}

/**
 * +1 * engineForce (per wheel) drives the chassis toward world -Z, which is the asset's authored
 * "front" (the `bonnet` node sits at local Z ≈ -1.2; see REPORT.md #6). Empirically,
 * `currentVehicleSpeed()` then reports a NEGATIVE number while moving in that direction — i.e. its
 * sign is relative to the chassis's local +Z axis, not "is the car going where engineForce pushed
 * it". Callers should use `Math.abs(controller.currentVehicleSpeed())` for a speed magnitude.
 */
export const FORWARD_SIGN = 1;

/**
 * Contract/API finding (REPORT.md #7): `DynamicRayCastVehicleController.updateVehicle()` sets the
 * chassis body's linear/angular velocity directly but does NOT wake a sleeping body. If the body
 * fell asleep (e.g. after settling with no input), `setWheelEngineForce`/`updateVehicle` silently
 * write velocity fields that are never integrated into position until something else wakes it —
 * so a stationary "AFK" car will not respond to input at all. We wake explicitly every step.
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
