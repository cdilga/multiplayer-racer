// test_flip.mjs — task 3: flip-recover. Spawns the car in several inverted/on-side poses and lets
// it fall under gravity with NO input (no self-right torque — purely a collider-shape question, per
// the task brief), comparing the asset's rounded cabin collider (`col_cabin_round`, built here as a
// real Rapier `roundCuboid`) against a flat-roof plain-box cabin collider (`col_cabin_round`'s own
// AABB, but with zero border radius) and against chassis-only (no cabin volume at all).

import { writeFileSync } from "node:fs";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, quatFromAxisAngle } from "./physics_common.mjs";
import { loadVehicle } from "./load_vehicle.mjs";

const GLB = "../out/cruz_missile.glb";
const SIDECAR = "../out/cruz_missile.asset.json";
const UPRIGHT_DOT_THRESHOLD = 0.85; // within ~32 deg of vertical counts as "upright"
const SETTLE_SPEED_THRESHOLD = 0.15;

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function quatMul(a, b) {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}
function rotateVecByQuat(q, v) {
    const { x, y, z, w } = q;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [
        ix * w + iw * -x + iy * -z - iz * -y,
        iy * w + iw * -y + iz * -x - ix * -z,
        iz * w + iw * -z + ix * -y - iy * -x,
    ];
}

// A breaking 12deg yaw so perfectly symmetric flips don't rest in an artificial knife-edge balance.
const YAW_BREAK = quatFromAxisAngle([0, 1, 0], (12 * Math.PI) / 180);

const POSES = [
    { name: "upside_down_flat", q: quatFromAxisAngle([0, 0, 1], Math.PI) },
    { name: "on_left_side", q: quatFromAxisAngle([0, 0, 1], Math.PI / 2) },
    { name: "on_right_side", q: quatFromAxisAngle([0, 0, 1], -Math.PI / 2) },
    { name: "nose_down_90", q: quatFromAxisAngle([1, 0, 0], Math.PI / 2) },
    { name: "tail_down_90", q: quatFromAxisAngle([1, 0, 0], -Math.PI / 2) },
    { name: "upside_down_nose_tilt", q: quatMul(quatFromAxisAngle([1, 0, 0], Math.PI / 6), quatFromAxisAngle([0, 0, 1], Math.PI)) },
    { name: "corner_balance_A", q: quatMul(quatFromAxisAngle([1, 0, 1], Math.PI * 0.75), quatFromAxisAngle([0, 1, 0], 0.3)) },
    { name: "corner_balance_B", q: quatMul(quatFromAxisAngle([1, 0, -1], Math.PI * 0.75), quatFromAxisAngle([0, 1, 0], -0.3)) },
    { name: "upside_down_roll_tilt", q: quatMul(quatFromAxisAngle([0, 0, 1], Math.PI * 0.9), quatFromAxisAngle([1, 0, 0], 0.2)) },
    { name: "on_left_side_pitched", q: quatMul(quatFromAxisAngle([0, 0, 1], Math.PI / 2), quatFromAxisAngle([1, 0, 0], 0.4)) },
];

function normalizeQ(q) {
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

async function runPose(pose, cabinShape) {
    const RAPIER = await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const spawnQ = normalizeQ(quatMul(YAW_BREAK, pose.q));
    const spawn = [0, v.groundOffsetY + 2.2, 0];
    const { body, controller } = buildVehicle(world, v, { spawn, spawnRotation: spawnQ, cabinShape });

    const DURATION_S = 6;
    const steps = Math.round(DURATION_S * 120);
    let firstUprightStep = null;
    for (let i = 0; i < steps; i++) {
        stepWorld(world, controller);
        const rot = body.rotation();
        const up = rotateVecByQuat(rot, [0, 1, 0]);
        if (firstUprightStep === null && up[1] >= UPRIGHT_DOT_THRESHOLD) firstUprightStep = i + 1;
    }
    const rot = body.rotation();
    const up = rotateVecByQuat(rot, [0, 1, 0]);
    const lv = body.linvel(), av = body.angvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z) + Math.hypot(av.x, av.y, av.z);
    const upright = up[1] >= UPRIGHT_DOT_THRESHOLD;
    const settled = speed < SETTLE_SPEED_THRESHOLD;
    return {
        pose: pose.name, cabinShape,
        finalUpDotWorldUp: up[1],
        upright, settled,
        recoveredWithinS: firstUprightStep ? firstUprightStep / 120 : null,
        finalPos: body.translation(),
    };
}

/**
 * "Nudge" test: settle flat upside-down (a stable rest state per the pose sweep below — landing
 * tilt just settles flat, it does not by itself demonstrate rolling), THEN give it a small rocking
 * angular-velocity kick (as if a bump/impact left it rocking) and see whether the *shape* of the
 * cabin collider makes it easier to complete a roll to upright, vs. getting stuck rocking on a
 * stable flat face. This isolates what "rounded so it rolls back" can actually buy you: not a
 * spontaneous un-flip from a dead stop, but a lower energy threshold to complete one already in
 * motion. See REPORT.md #4/#5.
 */
async function runNudge(cabinShape, axis, omega) {
    const RAPIER = await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const flatUpsideDown = quatFromAxisAngle([0, 0, 1], Math.PI);
    const { body, controller } = buildVehicle(world, v, { spawn: [0, v.groundOffsetY + 1.0, 0], spawnRotation: flatUpsideDown, cabinShape });
    for (let i = 0; i < 240; i++) stepWorld(world, controller); // settle flat upside-down first
    const restUp = rotateVecByQuat(body.rotation(), [0, 1, 0])[1];
    body.setAngvel({ x: axis[0] * omega, y: axis[1] * omega, z: axis[2] * omega }, true);
    let firstUprightStep = null;
    const steps = 8 * 120;
    for (let i = 0; i < steps; i++) {
        stepWorld(world, controller);
        const up = rotateVecByQuat(body.rotation(), [0, 1, 0]);
        if (firstUprightStep === null && up[1] >= UPRIGHT_DOT_THRESHOLD) firstUprightStep = i + 1;
    }
    const up = rotateVecByQuat(body.rotation(), [0, 1, 0]);
    return {
        cabinShape, axis, omega, restUpDotBeforeNudge: restUp,
        finalUpDot: up[1], upright: up[1] >= UPRIGHT_DOT_THRESHOLD,
        recoveredWithinS: firstUprightStep ? firstUprightStep / 120 : null,
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const results = { round: [], box: [], none: [] };
    for (const shape of ["round", "box", "none"]) {
        for (const pose of POSES) {
            results[shape].push(await runPose(pose, shape));
        }
    }
    const summarize = (arr) => {
        const n = arr.length;
        const recovered = arr.filter((r) => r.upright).length;
        return { n, recovered, pct: +((100 * recovered) / n).toFixed(1) };
    };
    const out = {
        threshold: { uprightDot: UPRIGHT_DOT_THRESHOLD, settleSpeed: SETTLE_SPEED_THRESHOLD },
        summary: { round: summarize(results.round), box: summarize(results.box), none: summarize(results.none) },
        results,
    };
    writeFileSync(new URL("./out/flip_test.json", import.meta.url), JSON.stringify(out, null, 2));
    console.log("=== FLIP-RECOVER TEST ===");
    for (const shape of ["round", "box", "none"]) {
        console.log(`\n-- cabinShape=${shape} -- recovered ${out.summary[shape].recovered}/${out.summary[shape].n} (${out.summary[shape].pct}%)`);
        for (const r of results[shape]) {
            console.log(`  ${r.pose.padEnd(24)} upright=${r.upright} settled=${r.settled} upDot=${r.finalUpDotWorldUp.toFixed(2)} recoveredAt=${r.recoveredWithinS ?? "-"}`);
        }
    }
    console.log("\nwrote out/flip_test.json");

    // ---- nudge test ----
    const nudgeResults = [];
    for (const shape of ["round", "box", "none"]) {
        for (const [axisName, axis] of [["X", [1, 0, 0]], ["Z", [0, 0, 1]]]) {
            for (const omega of [1.5, 3.0, 5.0]) {
                nudgeResults.push({ axisName, ...(await runNudge(shape, axis, omega)) });
            }
        }
    }
    writeFileSync(new URL("./out/flip_nudge_test.json", import.meta.url), JSON.stringify(nudgeResults, null, 2));
    console.log("\n=== NUDGE TEST (settled upside-down, then kicked with angular velocity) ===");
    for (const r of nudgeResults) {
        console.log(`  ${r.cabinShape.padEnd(6)} axis=${r.axisName} omega=${r.omega.toFixed(1).padStart(4)} rad/s -> upright=${String(r.upright).padEnd(5)} recoveredAt=${r.recoveredWithinS ?? "-"} finalUpDot=${r.finalUpDot.toFixed(2)}`);
    }
    console.log("\nwrote out/flip_nudge_test.json");
}
