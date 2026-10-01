// load_vehicle_v2.mjs — turns the G-cruze-v2 asset (cruz_missile.lod1.glb + cruz_missile.asset.json)
// into physics-ready data, per spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md.
//
// Differences from the C-physics spike's load_vehicle.mjs (see that file's header for the old
// conventions this supersedes):
//   - Parts are tagged `jj_part` (a string id), not `jj_kind`.
//   - `jj_collider` is either a real object `{shape, part}` on the collider node itself (col_*), or
//     a string / list of strings *referencing* a collider node name, on the owning part. We only
//     care about the former here (the collider node) to build physics geometry.
//   - Collider nodes are children of their part, which is itself a child of `chassis` — and parts
//     can have non-zero local origins (hinge points, e.g. `door_L` at x=-1.029). A naive
//     "subtract chassis world position from the node's own local translation" is WRONG here; we
//     must walk the full node.world matrix chain (parent -> child -> grandchild) that
//     gltf-lite.mjs's loadScene() already builds, then express every point relative to the
//     chassis's world transform. (Verified empirically via inspect_glb.mjs: collider node local
//     translations are authored as the exact negative of their parent part's local translation, so
//     each col_* node's OWN world matrix comes out as pure identity/zero — i.e. its raw mesh vertex
//     data is already numerically in the chassis/world frame. We still transform generically via
//     node.world rather than relying on that cancellation, since it's an asset-authoring artifact,
//     not a contract guarantee.)
//   - `chassis` itself sits at world (0,0,0) with identity rotation (confirmed via inspect_glb.mjs)
//     and is the scene root, so "chassis-relative" == "world" for this asset; groundOffsetY should
//     be ~0 (contract: origin on the ground plane between the axles) — unlike the C-physics asset,
//     which had a 0.72 m contract violation here.
//   - Wheel raycast hardpoints and suspension rest length/travel come from the SIDECAR
//     (`sidecar.wheels`, `sidecar.suspension`), not from measuring the `col_wheel_*` cylinder mesh.
//     Those cylinder colliders are informational only (contract: "wheels ... are informational —
//     the vehicle controller uses raycast wheels"); we still load them for cross-checking hub
//     position / radius consistency against the sidecar, but never add them as physics colliders.
//   - Total mass comes from `sidecar.physics.mass_kg` (1250 kg), not a hardcoded constant.

import { readFileSync } from "node:fs";
import { loadScene, nodeByName, worldPos } from "../../C-physics/gltf-lite.mjs";

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

export function loadVehicle(glbPath, sidecarPath) {
    const scene = loadScene(glbPath);
    const mat4TransformPoint = scene.mat4TransformPoint;
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    const chassisNode = nodeByName(scene, "chassis");
    if (!chassisNode) throw new Error("no 'chassis' node — contract requires a chassis root");
    const chassisWorld = worldPos(chassisNode);

    const rel = (worldPoint) => sub(worldPoint, chassisWorld);
    const relNode = (node) => rel(worldPos(node));

    const totalMassKg = sidecar.physics?.mass_kg;
    if (!totalMassKg) throw new Error("sidecar.physics.mass_kg missing — contract requires it");

    // ---- parts (mass fractions, joints, attach, dents) from node extras, keyed by jj_part id ----
    const parts = {};
    let massFractionSum = 0;
    for (const n of scene.nodes) {
        const ex = n.extras;
        if (!ex || ex.jj_part === undefined) continue;
        const massFraction = ex.jj_mass_fraction ?? 0;
        massFractionSum += massFraction;
        parts[ex.jj_part] = {
            node: n.name,
            massFraction,
            massKg: massFraction * totalMassKg,
            joint: ex.jj_joint ?? null,
            attach: ex.jj_attach ?? null,
            detachable: !!ex.jj_detachable,
            colliderRef: ex.jj_collider ?? null, // string | string[] | undefined — a NAME reference, not geometry
            dents: ex.jj_dent ?? null,
            axis: ex.jj_axis ?? null,
            axisSteer: ex.jj_axis_steer ?? null,
            axisSpin: ex.jj_axis_spin ?? null,
            rangeDeg: ex.jj_range_deg ?? null,
            rangeSteerDeg: ex.jj_range_steer_deg ?? null,
            worldPos: worldPos(n),
            relPos: relNode(n),
            hasMesh: n.mesh !== undefined && n.mesh !== null,
        };
    }

    // ---- colliders: nodes whose OWN extras.jj_collider is a real {shape, part} object ----
    // (as opposed to a part node whose jj_collider is a string/list *naming* one of these nodes).
    const colliders = {};
    for (const n of scene.nodes) {
        const cx = n.extras && n.extras.jj_collider;
        if (!cx || typeof cx !== "object" || Array.isArray(cx) || !cx.shape) continue;
        if (n.mesh === undefined || n.mesh === null) {
            console.warn(`[load_vehicle_v2] collider node '${n.name}' has jj_collider but no mesh — skipped`);
            continue;
        }
        const mesh = scene.meshes[n.mesh];
        const localVerts = mesh.position.array;
        const vertCount = mesh.position.count;
        const chassisRelVerts = new Float32Array(localVerts.length);
        let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < vertCount; i++) {
            const local = [localVerts[i * 3], localVerts[i * 3 + 1], localVerts[i * 3 + 2]];
            const world = mat4TransformPoint(n.world, local); // full parent-chain transform, not a shortcut
            const cr = rel(world);
            chassisRelVerts[i * 3] = cr[0]; chassisRelVerts[i * 3 + 1] = cr[1]; chassisRelVerts[i * 3 + 2] = cr[2];
            for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], cr[k]); max[k] = Math.max(max[k], cr[k]); }
        }
        colliders[n.name] = {
            shape: cx.shape,
            part: cx.part,
            vertCount,
            halfExtents: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
            centerRel: [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2],
            chassisRelVerts, // flat Float32Array — usable directly as RAPIER.ColliderDesc.convexHull() input
        };
    }

    // ---- wheels: raycast hardpoints straight from the sidecar, NOT from col_wheel_* geometry ----
    const wheels = {};
    for (const [name, w] of Object.entries(sidecar.wheels || {})) {
        wheels[name] = {
            hubRel: w.hub, radius: w.radius, width: w.width,
            steer: !!w.steer, driven: !!w.driven,
            isFront: name.includes("F"),
        };
    }
    if (Object.keys(wheels).length !== 4) throw new Error(`expected 4 wheels in sidecar, got ${Object.keys(wheels).length}`);

    // ---- suspension: rest length / travel per wheel, from the sidecar ----
    const suspension = {};
    for (const [name, s] of Object.entries(sidecar.suspension || {})) {
        suspension[name] = { topMount: s.top_mount, hub: s.hub, restLength: s.rest_length, travel: s.travel };
    }

    // ---- anchors: empty (mesh-less) nodes, cross-checked against the sidecar's declared values ----
    const anchors = {};
    const anchorMismatches = [];
    for (const [name, sidecarPos] of Object.entries(sidecar.anchors || {})) {
        const n = nodeByName(scene, name);
        if (!n) { anchorMismatches.push({ name, reason: "node not found in GLB" }); continue; }
        const p = relNode(n);
        anchors[name] = p;
        const d = Math.hypot(p[0] - sidecarPos[0], p[1] - sidecarPos[1], p[2] - sidecarPos[2]);
        if (d > 1e-3) anchorMismatches.push({ name, glb: p, sidecar: sidecarPos, deltaM: d });
    }
    if (!anchors.com) throw new Error("no 'com' anchor found — required for centre of mass");

    // ---- dent morph targets per mesh node (chassis carries several) ----
    const dentTargets = {};
    for (const n of scene.nodes) {
        if (n.mesh === undefined || n.mesh === null) continue;
        const mesh = scene.meshes[n.mesh];
        const targets = [];
        mesh.targetNames.forEach((t, i) => { if (t.endsWith("_dent")) targets.push({ targetIndex: i, targetName: t }); });
        if (targets.length) dentTargets[n.name] = { meshIndex: n.mesh, targets };
    }

    return {
        scene, sidecar, chassisWorld,
        groundOffsetY: chassisWorld[1],
        totalMassKg, massFractionSum,
        parts, colliders, wheels, suspension, anchors, anchorMismatches, dentTargets,
    };
}

export function summarize(v) {
    return {
        totalMassKg: v.totalMassKg,
        massFractionSum: +v.massFractionSum.toFixed(6),
        groundOffsetY: +v.groundOffsetY.toFixed(4),
        colliders: Object.fromEntries(Object.entries(v.colliders).map(([k, c]) => [k, {
            shape: c.shape, part: c.part, vertCount: c.vertCount,
            halfExtents: c.halfExtents.map((x) => +x.toFixed(4)),
            centerRel: c.centerRel.map((x) => +x.toFixed(4)),
        }])),
        wheels: Object.fromEntries(Object.entries(v.wheels).map(([k, w]) => [k, {
            hubRel: w.hubRel.map((x) => +x.toFixed(4)), radius: +w.radius.toFixed(4),
            width: +w.width.toFixed(4), steer: w.steer, driven: w.driven,
        }])),
        suspension: Object.fromEntries(Object.entries(v.suspension).map(([k, s]) => [k, {
            restLength: s.restLength, travel: s.travel,
        }])),
        com: v.anchors.com.map((x) => +x.toFixed(4)),
        anchorMismatches: v.anchorMismatches,
        dentParts: Object.keys(v.dentTargets),
    };
}
