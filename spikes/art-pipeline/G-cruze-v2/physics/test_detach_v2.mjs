// test_detach_v2.mjs — detach door_L as debris on a simulated impact.
//
// Contract difference from C-physics/test_detach.mjs: that spike built the debris collider from the
// door's actual RENDER mesh (a convex hull of every visible vertex). This asset instead gives each
// detachable panel a purpose-built box proxy (`col_door_L`, part of `sidecar.physics.colliders`),
// so we build the debris rigid body directly from that collider's already-computed chassis-relative
// half-extents/center (from load_vehicle_v2.mjs) — using the ACTUAL authored collider, not a
// re-derived bounding box of the visual mesh, per ASSET-CONTRACT.md ("Colliders ... are real
// meshes ... box for each detachable panel").
//
// Steps: settle the car -> hit it with a lateral impulse (stand-in for a collision) -> at that
// instant, build a box collider from col_door_L's own half-extents -> spawn it as a separate dynamic
// body with the car's velocity + the angular contribution at the attach point -> reduce the car's
// mass by the door's mass fraction -> verify the debris stays dynamic, can sleep, and wakes when the
// car later hits it.

import { writeFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, GROUP_CAR, GROUP_DEBRIS, GROUP_ALL, interactionGroups } from "./physics_common_v2.mjs";
import { loadVehicle } from "./load_vehicle_v2.mjs";
import { nodeByName } from "../../C-physics/gltf-lite.mjs";

const GLB = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.lod1.glb", import.meta.url).pathname;
const SIDECAR = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.asset.json", import.meta.url).pathname;

function rotateVecByQuat(q, v) {
    const { x, y, z, w } = q;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function boxInertia(mass, fullX, fullY, fullZ) {
    return { x: (mass / 12) * (fullY ** 2 + fullZ ** 2), y: (mass / 12) * (fullX ** 2 + fullZ ** 2), z: (mass / 12) * (fullX ** 2 + fullY ** 2) };
}

async function main() {
    await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const { body, controller } = buildVehicle(world, v, { spawn: [0, v.groundOffsetY + 0.3, 0] });
    for (let i = 0; i < 200; i++) stepWorld(world, controller); // settle

    const doorPart = v.parts.door_L;
    if (!doorPart) throw new Error("no 'door_L' part found — contract requires it");
    const doorCollider = v.colliders.col_door_L;
    if (!doorCollider || doorCollider.shape !== "box") throw new Error("col_door_L missing or not a box collider");

    // ---- asset-problem probe: col_door_L's box collider sits INSIDE col_chassis/col_cabin's
    // convex-hull AABB while the door is closed (verified: door AABB x[-1.029,-0.860] y[0.657,1.360]
    // z[-0.610,-0.040] is entirely within col_chassis's AABB x[-1.055,1.055] y[0.48,1.40]
    // z[-1.839,1.81]). Spawning it as a normal solid collider at the exact detach instant makes
    // Rapier's contact solver depenetrate it immediately — measure that "pop" here on a disposable
    // probe body (full collision groups, same pose, zero initial velocity) so the number in
    // REPORT.md is a real measurement, not an assertion.
    const carPosProbe = body.translation();
    const doorWorldPosProbe = [carPosProbe.x + doorPart.relPos[0], carPosProbe.y + doorPart.relPos[1], carPosProbe.z + doorPart.relPos[2]];
    const probeOffset = [doorCollider.centerRel[0] - doorPart.relPos[0], doorCollider.centerRel[1] - doorPart.relPos[1], doorCollider.centerRel[2] - doorPart.relPos[2]];
    const probeBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...doorWorldPosProbe));
    world.createCollider(RAPIER.ColliderDesc.cuboid(...doorCollider.halfExtents).setTranslation(...probeOffset).setMass(doorPart.massKg), probeBody);
    world.step(); // one physics step: any overlap depenetration shows up as an instant linvel spike
    const probeLV = probeBody.linvel();
    const overlapPopSpeedMS = Math.hypot(probeLV.x, probeLV.y, probeLV.z);
    world.removeRigidBody(probeBody); // discard the probe; the real debris body is built below with a grace period

    // ---- simulated impact: a hard lateral impulse near the door_L attach point ----
    const carPos = body.translation(), carRot = body.rotation();
    const attachWorldOffset = rotateVecByQuat(carRot, doorPart.relPos);
    const attachWorldPos = [carPos.x + attachWorldOffset[0], carPos.y + attachWorldOffset[1], carPos.z + attachWorldOffset[2]];
    body.applyImpulseAtPoint({ x: -2500, y: 200, z: 0 }, { x: attachWorldPos[0], y: attachWorldPos[1], z: attachWorldPos[2] }, true);
    // Same footgun as the C-physics spike (REPORT.md #11): read state after ONE plain world.step(),
    // not another controller.updateVehicle() pass, or the vehicle controller's own velocity write
    // cancels most of the impulse within a couple of ticks.
    world.step();

    // ---- detach: read the car's state at the moment of detach ----
    const carLV = body.linvel(), carAV = body.angvel();
    const carComWorldOffset = rotateVecByQuat(body.rotation(), v.anchors.com);
    const carComWorld = [body.translation().x + carComWorldOffset[0], body.translation().y + carComWorldOffset[1], body.translation().z + carComWorldOffset[2]];
    const doorWorldOffset = rotateVecByQuat(body.rotation(), doorPart.relPos);
    const doorWorldPos = [body.translation().x + doorWorldOffset[0], body.translation().y + doorWorldOffset[1], body.translation().z + doorWorldOffset[2]];
    const doorWorldRot = body.rotation(); // door node has identity rotation relative to chassis (verified via inspect_glb.mjs)

    // v_point = v_com + omega x (point - com) — standard rigid-body point-velocity transfer.
    const rArm = [doorWorldPos[0] - carComWorld[0], doorWorldPos[1] - carComWorld[1], doorWorldPos[2] - carComWorld[2]];
    const omegaCrossR = cross([carAV.x, carAV.y, carAV.z], rArm);
    const debrisLinvel = add([carLV.x, carLV.y, carLV.z], omegaCrossR);

    // ---- debris body + box collider from col_door_L's own authored half-extents ----
    // The door node's own local frame is identity-rotated relative to chassis (confirmed via
    // inspect_glb.mjs), so the collider's centerRel (chassis-relative) minus the door's relPos gives
    // the box's offset within the door's own local frame — needed because the debris body is spawned
    // at the DOOR's origin/rotation, not the chassis's.
    const colliderOffsetInDoorFrame = [
        doorCollider.centerRel[0] - doorPart.relPos[0],
        doorCollider.centerRel[1] - doorPart.relPos[1],
        doorCollider.centerRel[2] - doorPart.relPos[2],
    ];
    const doorBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(doorWorldPos[0], doorWorldPos[1], doorWorldPos[2])
        .setRotation(doorWorldRot)
        .setLinvel(debrisLinvel[0], debrisLinvel[1], debrisLinvel[2])
        .setAngvel(carAV)
        .setCcdEnabled(true);
    const doorBody = world.createRigidBody(doorBodyDesc);
    // Grace period (see the probe measurement above + REPORT.md): exclude GROUP_CAR from this
    // collider's filter for the first GRACE_STEPS ticks, so it separates under its transferred
    // velocity/gravity instead of exploding out of the overlap with col_chassis/col_cabin. It still
    // collides with the ground during grace. Restored to full collision below so the later
    // "car drives into sleeping debris" wake check still works.
    const GRACE_STEPS = 20; // ~0.17s — comfortably more than the ~0.02-0.03s the door needs to clear the hull at its transferred speed
    const doorColliderDesc = RAPIER.ColliderDesc.cuboid(...doorCollider.halfExtents)
        .setTranslation(...colliderOffsetInDoorFrame)
        .setMass(doorPart.massKg).setFriction(0.8).setRestitution(0.1)
        .setCollisionGroups(interactionGroups(GROUP_DEBRIS, GROUP_ALL & ~GROUP_CAR));
    const doorRapierCollider = world.createCollider(doorColliderDesc, doorBody);

    // ---- remove the door's mass fraction from the car (approximate: proportional mass/inertia scale) ----
    const remainingFraction = 1 - doorPart.massFraction;
    const newMass = v.totalMassKg * remainingFraction;
    const chassisC = v.colliders.col_chassis;
    const [fx, fy, fz] = chassisC.halfExtents.map((h) => h * 2);
    const newInertia = boxInertia(newMass, fx, fy, fz);
    // Rapier's JS vector params want a real {x,y,z} object, not a plain array — silently reads
    // undefined as NaN otherwise (C-physics REPORT.md #12).
    const comVec = { x: v.anchors.com[0], y: v.anchors.com[1], z: v.anchors.com[2] };
    body.setAdditionalMassProperties(newMass, comVec, newInertia, { x: 0, y: 0, z: 0, w: 1 }, true);

    const result = { detach: {}, sleepWake: {}, assetProblems: {} };
    result.assetProblems.doorColliderOverlapsChassisHull = {
        description: "col_door_L's box AABB (closed pose) is fully inside col_chassis's convex-hull AABB",
        overlapPopSpeedMS: overlapPopSpeedMS,
        workaround: `grace period of ${GRACE_STEPS} steps (~${(GRACE_STEPS / 120).toFixed(3)}s) excluding GROUP_CAR from the debris collider's filter`,
    };
    result.assetProblems.chassisColliderDoesNotReachGround = {
        description: "col_chassis's collider AABB bottom sits above the ground plane even though the visual mesh/wheels reach y=0",
        colChassisBottomRelM: v.colliders.col_chassis.centerRel[1] - v.colliders.col_chassis.halfExtents[1],
        colBumperFrontBottomRelM: v.colliders.col_bumper_front.centerRel[1] - v.colliders.col_bumper_front.halfExtents[1],
    };
    result.detach = {
        colliderKind: "box (col_door_L authored half-extents)",
        halfExtents: doorCollider.halfExtents,
        doorMassKg: doorPart.massKg,
        carMassBeforeKg: v.totalMassKg, carMassAfterKg: newMass,
        doorWorldPos, debrisLinvel, debrisAngvel: carAV,
        bodyTypeAfterCreate: doorBody.bodyType(), // must equal RAPIER.RigidBodyType.Dynamic (0)
    };

    // ---- run forward: debris must stay dynamic, and go to sleep once it settles ----
    let sleptAtStep = null;
    const bodyTypeSamples = new Set();
    for (let i = 0; i < 720; i++) { // 6s
        if (i === GRACE_STEPS) doorRapierCollider.setCollisionGroups(interactionGroups(GROUP_DEBRIS, GROUP_ALL));
        stepWorld(world, controller);
        bodyTypeSamples.add(doorBody.bodyType());
        if (sleptAtStep === null && doorBody.isSleeping()) sleptAtStep = i + 1;
    }
    result.sleepWake.restPos = doorBody.translation();
    result.sleepWake.sleptAtSeconds = sleptAtStep ? sleptAtStep / 120 : null;
    result.sleepWake.bodyTypesObserved = [...bodyTypeSamples];
    result.sleepWake.stillDynamicAfterSleep = doorBody.bodyType() === RAPIER.RigidBodyType.Dynamic;
    result.sleepWake.isSleepingBeforeHit = doorBody.isSleeping();

    // ---- wake test: bring the (still-driveable) car into contact with the sleeping debris ----
    const doorRestPos = doorBody.translation();
    const startX = doorRestPos.x - 3.0;
    const endX = doorRestPos.x + 0.2; // drive slightly past the door's center
    const APPROACH_STEPS = 90;
    // Asset problem (see REPORT.md): col_chassis's own collider bottom sits ~0.48 m ABOVE the
    // asset's ground plane (centerRel.y=0.94 - halfExtents.y=0.46), even though the visual mesh and
    // wheels go all the way to y=0 — there's a real gap between the car's belly and its own
    // collision proxy. A door lying flat on the ground (rest y ~ 0, ~0.17 m tall on its side) is
    // entirely below that gap, so a normal ride-height approach would never touch it; we therefore
    // aim the approach at the height where the chassis collider's OWN bottom would meet the door,
    // not at a "normal" driving height, to isolate the wake/contact behavior we're actually testing.
    const chassisBottomOffset = v.colliders.col_chassis.centerRel[1] - v.colliders.col_chassis.halfExtents[1];
    const approachY = doorRestPos.y - chassisBottomOffset + 0.05;
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    let wokeAtStep = null;
    for (let i = 0; i < APPROACH_STEPS && wokeAtStep === null; i++) {
        const x = startX + ((endX - startX) * (i + 1)) / APPROACH_STEPS;
        body.setTranslation({ x, y: approachY, z: doorRestPos.z }, true);
        stepWorld(world, controller);
        if (!doorBody.isSleeping()) wokeAtStep = i + 1;
    }
    result.sleepWake.wokeAfterCarContact = wokeAtStep !== null;
    result.sleepWake.wokeAtSeconds = wokeAtStep ? wokeAtStep / 120 : null;
    result.sleepWake.finalDoorBodyType = doorBody.bodyType();

    // ---- bonus: dent morph target sanity for door_L (sparse-accessor read path) ----
    const doorNode = nodeByName(v.scene, "door_L");
    const doorMesh = v.scene.meshes[doorNode.mesh];
    const dentIdx = doorMesh.targetNames.findIndex((t) => t.endsWith("_dent"));
    if (dentIdx >= 0) {
        const baseVerts = doorMesh.position.array;
        const dentTarget = doorMesh.targets[dentIdx];
        let maxDisplacement = 0, movedVerts = 0;
        for (let i = 0; i < baseVerts.length; i += 3) {
            const d = Math.hypot(dentTarget.array[i], dentTarget.array[i + 1], dentTarget.array[i + 2]);
            if (d > 1e-6) movedVerts++;
            if (d > maxDisplacement) maxDisplacement = d;
        }
        result.dent = { targetName: doorMesh.targetNames[dentIdx], vertexCount: baseVerts.length / 3, movedVerts, maxDisplacementM: maxDisplacement };
    }

    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const result = await main();
    writeFileSync(new URL("./out/detach_test.json", import.meta.url), JSON.stringify(result, null, 2));
    console.log("=== PART DETACH -> DEBRIS TEST (door_L) ===");
    console.log("asset problem: door/chassis collider overlap pop speed =", result.assetProblems.doorColliderOverlapsChassisHull.overlapPopSpeedMS.toFixed(3), "m/s (1 step, full groups, no fix) — workaround:", result.assetProblems.doorColliderOverlapsChassisHull.workaround);
    console.log("collider:", result.detach.colliderKind, "halfExtents:", result.detach.halfExtents);
    console.log("door mass", result.detach.doorMassKg.toFixed(1), "kg; car mass", result.detach.carMassBeforeKg, "->", result.detach.carMassAfterKg.toFixed(1), "kg");
    console.log("debris linvel at detach:", result.detach.debrisLinvel.map((x) => +x.toFixed(2)));
    console.log("body type right after create (0=Dynamic):", result.detach.bodyTypeAfterCreate);
    console.log("slept at:", result.sleepWake.sleptAtSeconds, "s; still Dynamic type after sleep:", result.sleepWake.stillDynamicAfterSleep);
    console.log("woke after car contact:", result.sleepWake.wokeAfterCarContact, "at", result.sleepWake.wokeAtSeconds, "s; final body type:", result.sleepWake.finalDoorBodyType);
    if (result.dent) console.log("dent: target", result.dent.targetName, "moved", result.dent.movedVerts, "/", result.dent.vertexCount, "verts, max displacement", result.dent.maxDisplacementM.toFixed(4), "m");
    console.log("wrote out/detach_test.json");
}
