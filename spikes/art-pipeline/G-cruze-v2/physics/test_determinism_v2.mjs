// test_determinism_v2.mjs — same inputs + build => same trace hash (plan §7.3 `replay-identity`).
//
// Runs one continuous scenario (settle -> 3s full throttle -> full-lock turn -> brake, fixed
// dt=1/120) twice in two fully independent worlds/vehicles and compares a hash of the full final
// rigid-body state (position, rotation, linear/angular velocity, per-wheel rotation angle). This
// scenario chains straight from the throttle phase into the turn (like C-physics/test_drive.mjs did)
// rather than test_drive_v2.mjs's "turn at a safe speed" methodology — so it DOES roll the car over
// (see test_drive_v2.mjs's header for why). That's fine here: determinism only asks "does the same
// input script + build produce the same trajectory twice", and a rollover is still a deterministic
// trajectory.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, FORWARD_SIGN } from "./physics_common_v2.mjs";
import { loadVehicle } from "./load_vehicle_v2.mjs";

const GLB = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.lod1.glb", import.meta.url).pathname;
const SIDECAR = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.asset.json", import.meta.url).pathname;
const ENGINE_FORCE = 4200, TURN_ENGINE_FORCE = 1500, MAX_BRAKE = 80;

async function runScenario() {
    await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const { body, controller, wheelIndex, drivenWheels, steerWheels } = buildVehicle(world, v, { spawn: [0, v.groundOffsetY + 0.5, 0] });
    const idx = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((n) => wheelIndex[n]);
    const steerRangeDeg = v.parts.wheel_FL.rangeSteerDeg;
    const MAX_STEER_RAD = (Math.max(...steerRangeDeg.map(Math.abs)) * Math.PI) / 180;

    for (let i = 0; i < 240; i++) stepWorld(world, controller); // settle, 2s
    for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * ENGINE_FORCE);
    for (let i = 0; i < 360; i++) stepWorld(world, controller); // full throttle, 3s
    for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * TURN_ENGINE_FORCE);
    for (let i = 0; i < 480; i++) { // full-lock turn, 4s (ramped over 0.5s)
        const ramp = Math.min(1, i / 60);
        for (const wi of steerWheels) controller.setWheelSteering(wi, MAX_STEER_RAD * ramp);
        stepWorld(world, controller);
    }
    for (const i of steerWheels) controller.setWheelSteering(i, 0);
    for (const i of idx) { controller.setWheelEngineForce(i, 0); controller.setWheelBrake(i, MAX_BRAKE); }
    for (let i = 0; i < 600; i++) stepWorld(world, controller); // brake, up to 5s

    return {
        pos: body.translation(), rot: body.rotation(), linvel: body.linvel(), angvel: body.angvel(),
        wheelRotations: idx.map((i) => controller.wheelRotation(i)),
    };
}

function round(x, dp = 9) { return Number(x.toFixed(dp)); }
function canonicalize(finalState) {
    const v3 = (v) => [round(v.x), round(v.y), round(v.z)];
    const v4 = (v) => [round(v.x), round(v.y), round(v.z), round(v.w)];
    return JSON.stringify({
        pos: v3(finalState.pos), rot: v4(finalState.rot),
        linvel: v3(finalState.linvel), angvel: v3(finalState.angvel),
        wheelRotations: finalState.wheelRotations.map((r) => round(r)),
    });
}
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
function rawDiff(a, b) {
    const d = (x, y) => Math.abs(x - y);
    return {
        pos: [d(a.pos.x, b.pos.x), d(a.pos.y, b.pos.y), d(a.pos.z, b.pos.z)],
        rot: [d(a.rot.x, b.rot.x), d(a.rot.y, b.rot.y), d(a.rot.z, b.rot.z), d(a.rot.w, b.rot.w)],
        wheelRotations: a.wheelRotations.map((r, i) => d(r, b.wheelRotations[i])),
    };
}

const runA = await runScenario();
const runB = await runScenario();
const canonA = canonicalize(runA), canonB = canonicalize(runB);
const hashA = sha256(canonA), hashB = sha256(canonB);
const diff = rawDiff(runA, runB);
const maxDiff = Math.max(...diff.pos, ...diff.rot, ...diff.wheelRotations);

const result = { hashA, hashB, identical: hashA === hashB, maxRawDiff: maxDiff, finalStateA: runA, finalStateB: runB };
writeFileSync(new URL("./out/determinism_test.json", import.meta.url), JSON.stringify(result, null, 2));

console.log("=== DETERMINISM TEST (cruz_missile, same inputs, same build, two independent runs) ===");
console.log("hash A:", hashA);
console.log("hash B:", hashB);
console.log("identical (rounded to 1e-9):", result.identical);
console.log("max raw component diff:", maxDiff, maxDiff === 0 ? "(bit-identical)" : "(nonzero — see REPORT.md)");
console.log("wrote out/determinism_test.json");
