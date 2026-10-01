// test_flip_v2.mjs — flip-recover: spawn the car in several inverted/on-side poses and let it fall
// under gravity with NO input, reporting whether/when it settles upright. Per the task brief this is
// report-only (find out what happens; the plan expects a self-right assist torque elsewhere, not a
// fix here) — mirrors C-physics/test_flip.mjs's pose sweep and "nudge" test.
//
// Contract difference from that spike: there is no round/box/none cabin-shape comparison here —
// this asset only authors ONE cabin collider (`col_cabin`, already a genuine convex hull per
// ASSET-CONTRACT.md, not the C-physics asset's mislabeled box), so we just build the real vehicle
// (physics_common_v2.buildVehicle uses whatever shape each collider actually is) and report how it
// behaves, once, rather than across synthetic shape variants.

import { writeFileSync } from "node:fs";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, quatFromAxisAngle } from "./physics_common_v2.mjs";
import { loadVehicle } from "./load_vehicle_v2.mjs";

const GLB = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.lod1.glb", import.meta.url).pathname;
const SIDECAR = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.asset.json", import.meta.url).pathname;
const UPRIGHT_DOT_THRESHOLD = 0.85; // within ~32 deg of vertical counts as "upright"
const SETTLE_SPEED_THRESHOLD = 0.15;

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
function normalizeQ(q) {
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
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

async function runPose(pose) {
    await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const spawnQ = normalizeQ(quatMul(YAW_BREAK, pose.q));
    const spawn = [0, v.groundOffsetY + 2.2, 0];
    const { body, controller } = buildVehicle(world, v, { spawn, spawnRotation: spawnQ });

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
        pose: pose.name,
        finalUpDotWorldUp: up[1],
        upright, settled,
        recoveredWithinS: firstUprightStep ? firstUprightStep / 120 : null,
        finalPos: body.translation(),
    };
}

/** Settle flat upside-down, then a small angular kick — does the real col_cabin convex hull help
 * complete a roll already in motion? Same rationale as C-physics/test_flip.mjs's nudge test. */
async function runNudge(axis, omega) {
    await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const flatUpsideDown = quatFromAxisAngle([0, 0, 1], Math.PI);
    const { body, controller } = buildVehicle(world, v, { spawn: [0, v.groundOffsetY + 1.0, 0], spawnRotation: flatUpsideDown });
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
        axis, omega, restUpDotBeforeNudge: restUp,
        finalUpDot: up[1], upright: up[1] >= UPRIGHT_DOT_THRESHOLD,
        recoveredWithinS: firstUprightStep ? firstUprightStep / 120 : null,
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const results = [];
    for (const pose of POSES) results.push(await runPose(pose));
    const recovered = results.filter((r) => r.upright).length;
    const summary = { n: results.length, recovered, pct: +((100 * recovered) / results.length).toFixed(1) };

    console.log("=== FLIP-RECOVER TEST (cruz_missile, real col_cabin convex hull) ===");
    console.log(`recovered ${summary.recovered}/${summary.n} (${summary.pct}%)`);
    for (const r of results) {
        console.log(`  ${r.pose.padEnd(24)} upright=${r.upright} settled=${r.settled} upDot=${r.finalUpDotWorldUp.toFixed(2)} recoveredAt=${r.recoveredWithinS ?? "-"}`);
    }

    const nudgeResults = [];
    for (const [axisName, axis] of [["X", [1, 0, 0]], ["Z", [0, 0, 1]]]) {
        for (const omega of [1.5, 3.0, 5.0]) {
            nudgeResults.push({ axisName, ...(await runNudge(axis, omega)) });
        }
    }
    console.log("\n=== NUDGE TEST (settled upside-down, then kicked with angular velocity) ===");
    for (const r of nudgeResults) {
        console.log(`  axis=${r.axisName} omega=${r.omega.toFixed(1).padStart(4)} rad/s -> upright=${String(r.upright).padEnd(5)} recoveredAt=${r.recoveredWithinS ?? "-"} finalUpDot=${r.finalUpDot.toFixed(2)}`);
    }

    writeFileSync(new URL("./out/flip_test.json", import.meta.url), JSON.stringify({ threshold: { uprightDot: UPRIGHT_DOT_THRESHOLD, settleSpeed: SETTLE_SPEED_THRESHOLD }, summary, results, nudgeResults }, null, 2));
    console.log("\nwrote out/flip_test.json");
}
