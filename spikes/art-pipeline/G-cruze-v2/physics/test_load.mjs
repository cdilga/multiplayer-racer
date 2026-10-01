// test_load.mjs — task "load": mass fraction sum, total mass, CoM, collider list (vertex counts +
// convexity sanity), wheel hardpoints. No physics stepping here, just the loader + a couple of
// RAPIER.ColliderDesc.convexHull() sanity calls.

import { writeFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { loadVehicle, summarize } from "./load_vehicle_v2.mjs";

const GLB = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.lod1.glb", import.meta.url).pathname;
const SIDECAR = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.asset.json", import.meta.url).pathname;

async function main() {
    await RAPIER.init();
    const v = loadVehicle(GLB, SIDECAR);
    const summary = summarize(v);

    // ---- convexity sanity: convexHull() must succeed for every 'convex' collider, and the vertex
    // count we read off the mesh must match what the sidecar declares (physics.colliders[name].verts)
    const convexityChecks = {};
    for (const [name, c] of Object.entries(v.colliders)) {
        if (c.shape !== "convex") continue;
        const hullDesc = RAPIER.ColliderDesc.convexHull(c.chassisRelVerts);
        const sidecarVerts = v.sidecar.physics?.colliders?.[name]?.verts ?? null;
        convexityChecks[name] = {
            hullBuilt: hullDesc !== null && hullDesc !== undefined,
            vertCountFromMesh: c.vertCount,
            vertCountFromSidecar: sidecarVerts,
            vertCountMatches: sidecarVerts === null || sidecarVerts === c.vertCount,
        };
    }

    // ---- box collider sanity: half-extents shouldn't be degenerate (near-zero on any axis) ----
    const boxSanity = {};
    for (const [name, c] of Object.entries(v.colliders)) {
        if (c.shape !== "box") continue;
        boxSanity[name] = {
            halfExtents: c.halfExtents.map((x) => +x.toFixed(4)),
            degenerate: c.halfExtents.some((h) => h < 1e-4),
        };
    }

    // ---- wheel hub vs col_wheel_* cylinder cross-check (informational collider vs sidecar hub/radius) ----
    const wheelHardpoints = {};
    for (const [name, w] of Object.entries(v.wheels)) {
        const colName = `col_${name}`;
        const col = v.colliders[colName];
        wheelHardpoints[name] = {
            hubRel: w.hubRel, radius: w.radius, width: w.width, steer: w.steer, driven: w.driven,
            cylinderCollider: col ? {
                halfExtents: col.halfExtents.map((x) => +x.toFixed(4)),
                centerRel: col.centerRel.map((x) => +x.toFixed(4)),
                // radius implied by the cylinder mesh's own bbox (max of the two non-axle half-extents)
                impliedRadius: +Math.max(col.halfExtents[1], col.halfExtents[2]).toFixed(4),
                hubVsCylinderCenterDeltaM: +Math.hypot(
                    w.hubRel[0] - col.centerRel[0], w.hubRel[1] - col.centerRel[1], w.hubRel[2] - col.centerRel[2],
                ).toFixed(4),
            } : null,
        };
    }

    const result = {
        totalMassKg: v.totalMassKg,
        massFractionSum: v.massFractionSum,
        massFractionSumOk: Math.abs(v.massFractionSum - 1) < 1e-3,
        groundOffsetY: v.groundOffsetY,
        groundOffsetYOk: Math.abs(v.groundOffsetY) < 0.01,
        com: v.anchors.com,
        anchorMismatches: v.anchorMismatches,
        colliders: summary.colliders,
        convexityChecks,
        boxSanity,
        wheelHardpoints,
        partCount: Object.keys(v.parts).length,
    };
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const result = await main();
    writeFileSync(new URL("./out/load_test.json", import.meta.url), JSON.stringify(result, null, 2));
    console.log("=== LOAD TEST (cruz_missile.lod1.glb) ===");
    console.log("totalMassKg:", result.totalMassKg);
    console.log("massFractionSum:", result.massFractionSum, "(ok:", result.massFractionSumOk, ")");
    console.log("groundOffsetY:", result.groundOffsetY.toFixed(6), "(ok:", result.groundOffsetYOk, ")");
    console.log("com:", result.com);
    console.log("anchorMismatches:", result.anchorMismatches.length ? result.anchorMismatches : "(none)");
    console.log("\ncolliders:");
    for (const [name, c] of Object.entries(result.colliders)) {
        console.log(`  ${name.padEnd(18)} shape=${c.shape.padEnd(8)} verts=${c.vertCount} halfExtents=${c.halfExtents} centerRel=${c.centerRel}`);
    }
    console.log("\nconvexity checks:", JSON.stringify(result.convexityChecks, null, 2));
    console.log("\nwheel hardpoints:");
    for (const [name, w] of Object.entries(result.wheelHardpoints)) {
        console.log(`  ${name.padEnd(10)} hub=${w.hubRel} radius=${w.radius} width=${w.width} steer=${w.steer} driven=${w.driven}`);
        if (w.cylinderCollider) {
            console.log(`    -> col_${name} centerRel=${w.cylinderCollider.centerRel} impliedRadius=${w.cylinderCollider.impliedRadius} deltaFromHub=${w.cylinderCollider.hubVsCylinderCenterDeltaM}m`);
        }
    }
    console.log("\nwrote out/load_test.json");
}

export { main as runLoadTest };
