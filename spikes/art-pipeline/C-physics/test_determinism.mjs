// test_determinism.mjs — task 5: same inputs + build => same trace hash (plan §7.3 `replay-identity`).
//
// Runs the exact drive_test.mjs input script (settle/throttle/turn/brake, fixed dt=1/120) twice in
// two fully independent worlds/vehicles and compares a hash of the full final rigid-body state
// (position, rotation, linear/angular velocity, per-wheel rotation angle).

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { runDriveScenario } from "./test_drive.mjs";

function round(x, dp = 9) { return Number(x.toFixed(dp)); }
function canonicalize(finalState) {
    const v3 = (v) => [round(v.x), round(v.y), round(v.z)];
    const v4 = (v) => [round(v.x), round(v.y), round(v.z), round(v.w)];
    return JSON.stringify({
        pos: v3(finalState.pos), rot: v4(finalState.rot),
        linvel: v3(finalState.linvel), angvel: v3(finalState.angvel),
        wheelRotations: finalState.wheelRotations.map((r) => round(r)),
        totalSteps: finalState.totalSteps,
    });
}
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

const runA = await runDriveScenario({ cabinShape: "round" });
const runB = await runDriveScenario({ cabinShape: "round" });

const canonA = canonicalize(runA.finalState);
const canonB = canonicalize(runB.finalState);
const hashA = sha256(canonA), hashB = sha256(canonB);

// Also compare raw (unrounded) values, so we can see HOW big any drift is even if it's below our
// rounding tolerance (i.e. distinguish "bit-identical", "identical to 1e-9", and "diverged").
function rawDiff(a, b) {
    const d = (x, y) => Math.abs(x - y);
    return {
        pos: [d(a.pos.x, b.pos.x), d(a.pos.y, b.pos.y), d(a.pos.z, b.pos.z)],
        rot: [d(a.rot.x, b.rot.x), d(a.rot.y, b.rot.y), d(a.rot.z, b.rot.z), d(a.rot.w, b.rot.w)],
        wheelRotations: a.wheelRotations.map((r, i) => d(r, b.wheelRotations[i])),
    };
}
const diff = rawDiff(runA.finalState, runB.finalState);
const maxDiff = Math.max(...diff.pos, ...diff.rot, ...diff.wheelRotations);

const result = {
    hashA, hashB, identical: hashA === hashB,
    maxRawDiff: maxDiff,
    finalStateA: runA.finalState, finalStateB: runB.finalState,
};
writeFileSync(new URL("./out/determinism_test.json", import.meta.url), JSON.stringify(result, null, 2));

console.log("=== DETERMINISM TEST (same inputs, same build, two independent runs) ===");
console.log("hash A:", hashA);
console.log("hash B:", hashB);
console.log("identical (rounded to 1e-9):", result.identical);
console.log("max raw component diff:", maxDiff, maxDiff === 0 ? "(bit-identical)" : "(nonzero — see REPORT.md)");
console.log("wrote out/determinism_test.json");
