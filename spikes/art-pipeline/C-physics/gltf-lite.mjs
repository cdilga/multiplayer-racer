// gltf-lite.mjs — minimal, dependency-free GLB parser for the physics spike.
//
// We deliberately don't use three's GLTFLoader: it wants a DOM/Image pipeline for textures we
// don't need, and a hand-rolled parser makes the axis-conversion arithmetic auditable end to end.
// Supports exactly what build_cruz_missile.py produces: single-buffer GLB, FLOAT32 VEC3 positions,
// TRS nodes (no matrix nodes), node/mesh `extras`, and relative morph targets (glTF export default).

import { readFileSync } from "node:fs";

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_CTOR = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
    5125: Uint32Array, 5126: Float32Array,
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function parseGLB(path) {
    const buf = readFileSync(path);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB (bad magic)`);
    const totalLength = buf.readUInt32LE(8);
    let off = 12;
    let json = null, bin = null;
    while (off < totalLength) {
        const chunkLen = buf.readUInt32LE(off);
        const chunkType = buf.readUInt32LE(off + 4);
        const data = buf.subarray(off + 8, off + 8 + chunkLen);
        if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
        else if (chunkType === 0x004e4942) bin = data;
        off += 8 + chunkLen;
    }
    if (!json) throw new Error(`${path}: no JSON chunk`);
    return { json, bin };
}

function readAccessor(gltf, bin, index) {
    if (index === undefined || index === null) return null;
    const acc = gltf.accessors[index];
    const numComponents = TYPE_COMPONENTS[acc.type];
    const compBytes = COMPONENT_BYTES[acc.componentType];
    const Ctor = COMPONENT_CTOR[acc.componentType];
    const elemBytes = numComponents * compBytes;
    const out = new Float32Array(acc.count * numComponents);
    const readScalar = (byteOff) => {
        if (Ctor === Float32Array) return bin.readFloatLE(byteOff);
        if (acc.componentType === 5121) return bin.readUInt8(byteOff);
        if (acc.componentType === 5123) return bin.readUInt16LE(byteOff);
        if (acc.componentType === 5125) return bin.readUInt32LE(byteOff);
        if (acc.componentType === 5120) return bin.readInt8(byteOff);
        if (acc.componentType === 5122) return bin.readInt16LE(byteOff);
        throw new Error(`unsupported componentType ${acc.componentType}`);
    };
    if (acc.bufferView !== undefined) {
        const bv = gltf.bufferViews[acc.bufferView];
        const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = bv.byteStride || elemBytes;
        for (let i = 0; i < acc.count; i++) {
            const rowOff = base + i * stride;
            for (let c = 0; c < numComponents; c++) {
                let v = readScalar(rowOff + c * compBytes);
                if (acc.normalized) {
                    if (acc.componentType === 5121) v /= 255;
                    else if (acc.componentType === 5123) v /= 65535;
                }
                out[i * numComponents + c] = v;
            }
        }
    } // else: fully implicit-zero base (only legal when `sparse` is present) — left as zeros.
    // Sparse override (Blender's glTF exporter emits morph-target deltas this way to save space —
    // e.g. a localized dent only touches a fraction of a panel's verts). Without this, every morph
    // target reads back as all-zero. See REPORT.md #10.
    if (acc.sparse) {
        const { count, indices, values } = acc.sparse;
        const idxBV = gltf.bufferViews[indices.bufferView];
        const idxBase = (idxBV.byteOffset || 0) + (indices.byteOffset || 0);
        const idxCompBytes = COMPONENT_BYTES[indices.componentType];
        const valBV = gltf.bufferViews[values.bufferView];
        const valBase = (valBV.byteOffset || 0) + (values.byteOffset || 0);
        for (let s = 0; s < count; s++) {
            let elemIndex;
            if (indices.componentType === 5121) elemIndex = bin.readUInt8(idxBase + s * idxCompBytes);
            else if (indices.componentType === 5123) elemIndex = bin.readUInt16LE(idxBase + s * idxCompBytes);
            else elemIndex = bin.readUInt32LE(idxBase + s * idxCompBytes);
            for (let c = 0; c < numComponents; c++) {
                out[elemIndex * numComponents + c] = bin.readFloatLE(valBase + (s * numComponents + c) * 4);
            }
        }
    }
    return { array: out, numComponents, count: acc.count, min: acc.min, max: acc.max };
}

function readIndices(gltf, bin, index) {
    if (index === undefined || index === null) return null;
    const acc = gltf.accessors[index];
    const bv = gltf.bufferViews[acc.bufferView];
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const out = new Uint32Array(acc.count);
    for (let i = 0; i < acc.count; i++) {
        const byteOff = base + i * COMPONENT_BYTES[acc.componentType];
        out[i] = acc.componentType === 5125 ? bin.readUInt32LE(byteOff)
            : acc.componentType === 5123 ? bin.readUInt16LE(byteOff)
                : bin.readUInt8(byteOff);
    }
    return out;
}

// ---- minimal mat4/quat math (column-major, glTF convention) ----
function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4FromTRS(t, r, s) {
    const [x, y, z, w] = r;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const [sx, sy, sz] = s;
    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        t[0], t[1], t[2], 1,
    ];
}
function mat4Mul(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1]
            + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
    return out;
}
function mat4TransformPoint(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
}
function mat4Translation(m) { return [m[12], m[13], m[14]]; }

/**
 * Loads the GLB into a flat, physics-friendly scene description.
 *
 * IMPORTANT axis note: Blender's glTF exporter (used by build_cruz_missile.py) converts the
 * Blender-space (Z-up, +Y-forward) authoring axes to glTF-space (Y-up, -Z-forward) by remapping
 * each vertex/translation as `gltf(x,y,z) = blender(x, z, -y)`. We verified this empirically by
 * comparing known Blender-script coordinates (e.g. wheel_FL local (-0.98, 1.2, -0.24) in Blender
 * -> (-0.98, -0.24, -1.2) in the exported node) against the parsed GLB. We do NOT convert back:
 * this loader returns everything in glTF space (Y-up, -Z-forward, X-right) and the physics world
 * below is built directly in that space, so "forward" for driving is -Z and "up" is +Y.
 */
export function loadScene(path) {
    const { json: gltf, bin } = parseGLB(path);
    const nodes = gltf.nodes.map((n) => {
        const t = n.translation || [0, 0, 0];
        const r = n.rotation || [0, 0, 0, 1];
        const s = n.scale || [1, 1, 1];
        return {
            name: n.name,
            local: mat4FromTRS(t, r, s),
            translation: t, rotation: r, scale: s,
            mesh: n.mesh, extras: n.extras || null, children: n.children || [],
            world: null, parent: -1,
        };
    });
    for (let i = 0; i < nodes.length; i++) for (const c of nodes[i].children) nodes[c].parent = i;
    const roots = gltf.scenes[gltf.scene ?? 0].nodes;
    const stack = roots.map((i) => ({ i, parentWorld: mat4Identity() }));
    while (stack.length) {
        const { i, parentWorld } = stack.pop();
        nodes[i].world = mat4Mul(parentWorld, nodes[i].local);
        for (const c of nodes[i].children) stack.push({ i: c, parentWorld: nodes[i].world });
    }

    const meshes = (gltf.meshes || []).map((m) => {
        const prim = m.primitives[0];
        const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
        const idx = readIndices(gltf, bin, prim.indices);
        const targets = (prim.targets || []).map((t) => readAccessor(gltf, bin, t.POSITION));
        const targetNames = (m.extras && m.extras.targetNames) || targets.map((_, i) => `target_${i}`);
        return { name: m.name, position: pos, indices: idx, targets, targetNames };
    });

    return { nodes, meshes, mat4TransformPoint, mat4Translation };
}

export function nodeByName(scene, name) {
    return scene.nodes.find((n) => n.name === name) || null;
}

export function worldPos(node) { return mat4Translation(node.world); }

/** World-space AABB (min/max) of a mesh node's base (undented) vertex positions. */
export function worldAABB(scene, node) {
    const mesh = scene.meshes[node.mesh];
    const pos = mesh.position.array;
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.position.count; i++) {
        const p = mat4TransformPoint(node.world, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
    return { min, max };
}

/** Local-space (node-frame) AABB — used for wheel radius/axle inference and collider half-extents. */
export function localAABB(scene, node) {
    const mesh = scene.meshes[node.mesh];
    const pos = mesh.position.array;
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.position.count; i++) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], pos[i * 3 + k]);
            max[k] = Math.max(max[k], pos[i * 3 + k]);
        }
    }
    return { min, max };
}
