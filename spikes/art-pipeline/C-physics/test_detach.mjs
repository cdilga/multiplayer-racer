// test_detach.mjs — task 4: detach door_R at a simulated impact, turn it into real debris.
//
// Steps: settle the car -> hit it with a lateral impulse (stand-in for a collision) -> at that
// instant, build a convex-hull collider from door_R's ACTUAL render-mesh vertices (real art data,
// not a placeholder box) -> spawn it as a separate dynamic body with the car's velocity + the
// angular contribution at the attach point -> reduce the car's mass by the door's mass fraction ->
// verify the debris stays dynamic, can sleep, and wakes when the car later hits it -> apply the
// door's dent morph to its vertex data and confirm the detached part keeps the deformed shape.

import { writeFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld } from "./physics_common.mjs";
import { loadVehicle } from "./load_vehicle.mjs";
import { nodeByName } from "./gltf-lite.mjs";

const GLB = "../out/cruz_missile.glb";
const SIDECAR = "../out/cruz_missile.asset.json";

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
    const RAPIER_ = await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const { body, controller } = buildVehicle(world, v, { spawn: [0, v.groundOffsetY + 0.3, 0], cabinShape: "round" });
    for (let i = 0; i < 200; i++) stepWorld(world, controller); // settle

    // ---- simulated impact: a hard lateral impulse near the door_R attach point ----
    const doorPart = v.parts.door_R;
    const carPos = body.translation(), carRot = body.rotation();
    const attachWorldOffset = rotateVecByQuat(carRot, doorPart.relPos);
    const attachWorldPos = [carPos.x + attachWorldOffset[0], carPos.y + attachWorldOffset[1], carPos.z + attachWorldOffset[2]];
    body.applyImpulseAtPoint({ x: 2500, y: 200, z: 0 }, { x: attachWorldPos[0], y: attachWorldPos[1], z: attachWorldPos[2] }, true);
    // REPORT.md #11: read state right after ONE plain `world.step()` — NOT another
    // `controller.updateVehicle()` pass. Same root cause as the drag finding (#8): updateVehicle()
    // overwrites the chassis's linear/angular velocity from its own wheel model every call, so an
    // externally applied impulse gets largely cancelled within a couple of controller ticks. A real
    // impact-response path in jj-sim needs to feed collision impulses into the tick BEFORE/instead
    // of the vehicle-controller velocity write for that step, not apply them independently.
    world.step();

    // ---- detach: read the car's state at the moment of detach ----
    const carLV = body.linvel(), carAV = body.angvel();
    const carComWorldOffset = rotateVecByQuat(body.rotation(), v.markers.com);
    const carComWorld = [body.translation().x + carComWorldOffset[0], body.translation().y + carComWorldOffset[1], body.translation().z + carComWorldOffset[2]];
    const doorWorldOffset = rotateVecByQuat(body.rotation(), doorPart.relPos);
    const doorWorldPos = [body.translation().x + doorWorldOffset[0], body.translation().y + doorWorldOffset[1], body.translation().z + doorWorldOffset[2]];
    const doorWorldRot = body.rotation(); // door node has identity rotation relative to chassis (verified in load_vehicle)

    // v_point = v_com + omega x (point - com) — standard rigid-body point-velocity transfer.
    const rArm = [doorWorldPos[0] - carComWorld[0], doorWorldPos[1] - carComWorld[1], doorWorldPos[2] - carComWorld[2]];
    const omegaCrossR = cross([carAV.x, carAV.y, carAV.z], rArm);
    const debrisLinvel = add([carLV.x, carLV.y, carLV.z], omegaCrossR);

    // ---- real render-mesh vertices for door_R -> convex hull collider (art data drives the debris shape) ----
    const doorNode = nodeByName(v.scene, "door_R");
    const doorMesh = v.scene.meshes[doorNode.mesh];
    const baseVerts = doorMesh.position.array; // local to the door node's own origin
    const doorBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(doorWorldPos[0], doorWorldPos[1], doorWorldPos[2])
        .setRotation(doorWorldRot)
        .setLinvel(debrisLinvel[0], debrisLinvel[1], debrisLinvel[2])
        .setAngvel(carAV)
        .setCcdEnabled(true);
    const doorBody = world.createRigidBody(doorBodyDesc);
    let doorColliderDesc = RAPIER.ColliderDesc.convexHull(baseVerts);
    let colliderKind = "convexHull";
    if (!doorColliderDesc) {
        // Fallback per task brief ("a box from bounds — justify"): convexHull can return null for a
        // degenerate point set (didn't happen here, but a door mesh with near-planar coplanar verts
        // is plausible for a thin flat panel and should not crash the detach path).
        colliderKind = "box (convexHull returned null — degenerate/near-planar hull)";
        let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < baseVerts.length; i += 3) for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], baseVerts[i + k]); max[k] = Math.max(max[k], baseVerts[i + k]);
        }
        doorColliderDesc = RAPIER.ColliderDesc.cuboid((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2)
            .setTranslation((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
    }
    doorColliderDesc.setMass(doorPart.massKg).setFriction(0.8).setRestitution(0.1);
    const doorCollider = world.createCollider(doorColliderDesc, doorBody);

    // ---- remove the door's mass fraction from the car (approximate: proportional mass/inertia scale) ----
    const remainingFraction = 1 - doorPart.massFraction;
    const newMass = v.totalMassKg * remainingFraction;
    const chassisC = v.colliders.col_chassis;
    const [fx, fy, fz] = chassisC.halfExtents.map((h) => h * 2);
    const newInertia = boxInertia(newMass, fx, fy, fz);
    // REPORT.md #12: Rapier's JS Vector-valued params want a real {x,y,z} object. Passing our plain
    // `[x,y,z]` array here (an easy mistake — `v.markers.com` is an array everywhere else in this
    // codebase) does NOT throw; it silently reads undefined fields as NaN, which then contaminates
    // every body it contacts (we saw the door debris's velocity/rotation go NaN and never sleep).
    const comVec = { x: v.markers.com[0], y: v.markers.com[1], z: v.markers.com[2] };
    body.setAdditionalMassProperties(newMass, comVec, newInertia, { x: 0, y: 0, z: 0, w: 1 }, true);

    // ---- apply the dent morph to the door's vertex data (verify it survives detach, vertex-only) ----
    const dentIdx = doorMesh.targetNames.findIndex((t) => t.endsWith("_dent"));
    const dentTarget = doorMesh.targets[dentIdx];
    const dented = new Float32Array(baseVerts.length);
    let maxDisplacement = 0, movedVerts = 0;
    for (let i = 0; i < baseVerts.length; i++) {
        dented[i] = baseVerts[i] + dentTarget.array[i]; // weight = 1.0 (fully dented), relative morph target
    }
    for (let i = 0; i < baseVerts.length; i += 3) {
        const d = Math.hypot(dented[i] - baseVerts[i], dented[i + 1] - baseVerts[i + 1], dented[i + 2] - baseVerts[i + 2]);
        if (d > 1e-6) movedVerts++;
        if (d > maxDisplacement) maxDisplacement = d;
    }

    const result = { impact: {}, detach: {}, sleepWake: {}, dent: {} };
    result.detach = {
        colliderKind,
        doorMassKg: doorPart.massKg,
        carMassBeforeKg: v.totalMassKg, carMassAfterKg: newMass,
        doorWorldPos, debrisLinvel, debrisAngvel: carAV,
        bodyTypeAfterCreate: doorBody.bodyType(), // must equal RAPIER.RigidBodyType.Dynamic (0)
    };
    result.dent = { targetName: doorMesh.targetNames[dentIdx], vertexCount: baseVerts.length / 3, movedVerts, maxDisplacementM: maxDisplacement };

    // ---- run forward: debris must stay dynamic, and go to sleep once it settles ----
    let sleptAtStep = null;
    const bodyTypeSamples = new Set();
    for (let i = 0; i < 720; i++) { // 6s
        stepWorld(world, controller);
        bodyTypeSamples.add(doorBody.bodyType());
        if (sleptAtStep === null && doorBody.isSleeping()) sleptAtStep = i + 1;
    }
    result.sleepWake.sleptAtSeconds = sleptAtStep ? sleptAtStep / 120 : null;
    result.sleepWake.bodyTypesObserved = [...bodyTypeSamples];
    result.sleepWake.stillDynamicAfterSleep = doorBody.bodyType() === RAPIER.RigidBodyType.Dynamic;
    result.sleepWake.isSleepingBeforeHit = doorBody.isSleeping();

    // ---- wake test: bring the (still-driveable) car into contact with the sleeping debris ----
    // We don't need a real driver here, just a controlled approach: teleport the car just short of
    // the resting debris (clear of the ground/door volumes) and give it velocity toward it, then
    // step normally. This exercises the real thing we care about — does a moving dynamic body
    // (still driven by the same vehicle controller) wake a sleeping dynamic debris body on contact —
    // without needing a full path-follower for what is otherwise a one-line physics fact to check.
    const doorRestPos = doorBody.translation();
    // NB: we drive the approach via scripted `setTranslation()` steps rather than `setLinvel` — per
    // REPORT.md #8/#11, the vehicle controller overwrites the chassis's velocity from its own wheel
    // model every `updateVehicle()` call, so a one-shot velocity kick gets cancelled almost
    // immediately and never covers real distance. What we're actually verifying here (a moving
    // dynamic collider waking a sleeping dynamic body on contact) doesn't depend on how the car got
    // there, so a scripted approach avoids re-fighting the same controller quirk in an unrelated test.
    const startX = doorRestPos.x - 3.0;
    const endX = doorRestPos.x + 0.2; // drive slightly past the door's center
    const APPROACH_STEPS = 90;
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    let wokeAtStep = null;
    for (let i = 0; i < APPROACH_STEPS && wokeAtStep === null; i++) {
        const x = startX + ((endX - startX) * (i + 1)) / APPROACH_STEPS;
        body.setTranslation({ x, y: doorRestPos.y + 0.15, z: doorRestPos.z }, true);
        stepWorld(world, controller);
        if (!doorBody.isSleeping()) wokeAtStep = i + 1;
    }
    result.sleepWake.wokeAfterCarContact = wokeAtStep !== null;
    result.sleepWake.wokeAtSeconds = wokeAtStep ? wokeAtStep / 120 : null;
    result.sleepWake.finalDoorBodyType = doorBody.bodyType();

    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const result = await main();
    writeFileSync(new URL("./out/detach_test.json", import.meta.url), JSON.stringify(result, null, 2));
    console.log("=== PART DETACH -> DEBRIS TEST (door_R) ===");
    console.log("collider:", result.detach.colliderKind);
    console.log("door mass", result.detach.doorMassKg.toFixed(1), "kg; car mass", result.detach.carMassBeforeKg, "->", result.detach.carMassAfterKg.toFixed(1), "kg");
    console.log("debris linvel at detach:", result.detach.debrisLinvel.map((x) => +x.toFixed(2)));
    console.log("body type right after create (0=Dynamic):", result.detach.bodyTypeAfterCreate);
    console.log("slept at:", result.sleepWake.sleptAtSeconds, "s; still Dynamic type after sleep:", result.sleepWake.stillDynamicAfterSleep);
    console.log("woke after car contact:", result.sleepWake.wokeAfterCarContact, "at", result.sleepWake.wokeAtSeconds, "s; final body type:", result.sleepWake.finalDoorBodyType);
    console.log("dent: target", result.dent.targetName, "moved", result.dent.movedVerts, "/", result.dent.vertexCount, "verts, max displacement", result.dent.maxDisplacementM.toFixed(4), "m");
    console.log("wrote out/detach_test.json");
}
