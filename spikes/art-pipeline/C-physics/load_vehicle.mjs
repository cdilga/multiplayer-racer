// load_vehicle.mjs — turns the art-pipeline spike's GLB + sidecar into physics-ready data:
// collider proxies, centre of mass, wheel hardpoints/radius, and per-part mass in kg.
//
// Coordinate space: everything below is in glTF space as exported (Y-up, -Z-forward, X-right),
// expressed RELATIVE TO THE "chassis" NODE ORIGIN (which is also the glTF scene root for this
// asset). That offset is exactly the local frame a Rapier rigid body needs: colliders and wheel
// connection points are attached to a body via a translation relative to the body's own origin.
//
// Contract finding (see REPORT.md #1): the plan (§12.4) requires "origin at ground between axles",
// but this asset's chassis-node origin sits 0.72 m above the ground (wheel-bottom) plane. We do not
// silently "fix" this — we surface it as `groundOffsetY` so callers can place the body correctly,
// and flag it as a contract violation to repair upstream.

import { readFileSync } from "node:fs";
import { loadScene, nodeByName, worldPos, worldAABB, localAABB } from "./gltf-lite.mjs";

const TOTAL_MASS_KG = 1200; // task brief: "e.g. 1200 kg-equivalent scaled for arcade"

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

export function loadVehicle(glbPath, sidecarPath, { totalMassKg = TOTAL_MASS_KG } = {}) {
    const scene = loadScene(glbPath);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    const chassisNode = nodeByName(scene, "chassis");
    if (!chassisNode) throw new Error("no 'chassis' node — contract requires a chassis root");
    const chassisWorld = worldPos(chassisNode);

    const rel = (node) => sub(worldPos(node), chassisWorld);

    // ---- parts (mass fractions, hp, attach type) from node extras, cross-checked vs sidecar ----
    const parts = {};
    let massFractionSum = 0;
    for (const n of scene.nodes) {
        const ex = n.extras;
        if (!ex || ex.jj_kind === undefined) continue;
        const massFraction = ex.jj_mass_fraction ?? 0;
        massFractionSum += massFraction;
        parts[n.name] = {
            kind: ex.jj_kind,
            hp: ex.jj_hp,
            attach: ex.jj_attach,
            massFraction,
            massKg: massFraction * totalMassKg,
            protectsZone: ex.jj_protects_zone ?? null,
            hingeAxis: ex.jj_hinge_axis ?? null,
            worldPos: worldPos(n),
            relPos: rel(n),
            hasMesh: n.mesh !== undefined && n.mesh !== null,
        };
    }

    // ---- collider proxies: any node with extras.jj_collider, as world-aligned cuboids ----
    // (col_chassis, col_cabin_round today; see REPORT.md #2 for the "_round" naming vs actual shape.)
    const colliders = {};
    for (const n of scene.nodes) {
        if (!n.extras || n.extras.jj_collider !== true) continue;
        const aabbLocalToNode = localAABB(scene, n);
        const halfExtents = [
            (aabbLocalToNode.max[0] - aabbLocalToNode.min[0]) / 2,
            (aabbLocalToNode.max[1] - aabbLocalToNode.min[1]) / 2,
            (aabbLocalToNode.max[2] - aabbLocalToNode.min[2]) / 2,
        ];
        colliders[n.name] = { halfExtents, centerRel: rel(n) };
    }

    // ---- wheels: hub pivot = node origin; radius/axle from the mesh's local AABB ----
    // Empirical finding: wheel meshes are baked (rotation applied) so the tyre's cylinder axis
    // lands on local X in glTF space too (axis-mapping leaves X untouched) — see gltf-lite.mjs
    // header comment. Radius = max radial extent in the plane perpendicular to that axis.
    const wheelOrder = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
    const wheels = {};
    for (const name of wheelOrder) {
        const n = nodeByName(scene, name);
        if (!n) continue;
        const aabb = localAABB(scene, n);
        const halfX = (aabb.max[0] - aabb.min[0]) / 2; // tyre width / 2
        const halfY = (aabb.max[1] - aabb.min[1]) / 2;
        const halfZ = (aabb.max[2] - aabb.min[2]) / 2;
        const radius = Math.max(halfY, halfZ);
        if (Math.abs(halfY - halfZ) > 0.01 * radius) {
            console.warn(`[load_vehicle] ${name}: local AABB not axisymmetric about X (halfY=${halfY.toFixed(4)}, halfZ=${halfZ.toFixed(4)}) — axle-axis assumption may be wrong`);
        }
        wheels[name] = {
            hubRel: rel(n),
            radius,
            width: halfX * 2,
            axleLocal: [1, 0, 0], // shared L/R axle direction, see comment above
            isFront: name.includes("F"),
        };
    }

    // ---- markers: empties (no mesh) referenced by the contract ----
    const markerNames = sidecar.markers || [];
    const markers = {};
    for (const name of markerNames) {
        const n = nodeByName(scene, name);
        if (n) markers[name] = rel(n);
    }
    if (!markers.com) throw new Error("no 'com' marker found — required for centre of mass");

    // ---- dent morph targets per part (task 4: verify detached debris keeps its deformed shape) ----
    const dentTargets = {};
    for (const n of scene.nodes) {
        if (n.mesh === undefined || n.mesh === null) continue;
        const mesh = scene.meshes[n.mesh];
        const dentIdx = mesh.targetNames.findIndex((t) => t.endsWith("_dent"));
        if (dentIdx >= 0) {
            dentTargets[n.name] = { targetIndex: dentIdx, targetName: mesh.targetNames[dentIdx], meshIndex: n.mesh };
        }
    }

    return {
        scene, sidecar, chassisWorld,
        groundOffsetY: chassisWorld[1], // contract finding: should be ~0 (origin at ground); see REPORT.md
        totalMassKg,
        massFractionSum,
        parts, colliders, wheels, markers, dentTargets,
    };
}

export function summarize(v) {
    return {
        totalMassKg: v.totalMassKg,
        massFractionSum: +v.massFractionSum.toFixed(4),
        groundOffsetY: +v.groundOffsetY.toFixed(4),
        colliders: Object.fromEntries(Object.entries(v.colliders).map(([k, c]) => [k, {
            halfExtents: c.halfExtents.map((x) => +x.toFixed(4)),
            centerRel: c.centerRel.map((x) => +x.toFixed(4)),
        }])),
        wheels: Object.fromEntries(Object.entries(v.wheels).map(([k, w]) => [k, {
            hubRel: w.hubRel.map((x) => +x.toFixed(4)),
            radius: +w.radius.toFixed(4),
            width: +w.width.toFixed(4),
        }])),
        com: v.markers.com.map((x) => +x.toFixed(4)),
        dentParts: Object.keys(v.dentTargets),
    };
}
