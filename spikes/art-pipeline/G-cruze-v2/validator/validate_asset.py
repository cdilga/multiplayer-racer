#!/usr/bin/env python3
"""Vehicle asset validator for Joystick Jammers 0.2 (V2-61 vehicle contract).

Spec: spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md and
docs/plans/v0.2-revamp-plan-2026-09-28.md SS12.3-SS12.4.

Python 3 stdlib only. PIL is used ONLY to decode embedded PNG textures (for size/mode/
channel checks); no numpy (not available in the target system python). This module parses
the GLB binary chunk and glTF accessors itself -- it never trusts sidecar claims about
triangle counts, node positions, or shapes; it reads them from the GLB and compares.

Usage:
    python3 validate_asset.py <dir-containing-sidecar-and-glbs>
    python3 validate_asset.py --glb <file.glb> --sidecar <file.asset.json>

Prints one line per rule check: "PASS <rule_id> <detail>" or "FAIL <rule_id> <detail>",
then a summary. Exits 1 if any FAIL was printed, else 0.
"""
import argparse
import io
import json
import math
import os
import struct
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - PIL is expected to be present per task spec
    Image = None


# ---------------------------------------------------------------------------
# Contract constants (spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md)
# ---------------------------------------------------------------------------

WHEEL_IDS = ["FL", "FR", "RL", "RR"]
FRONT_WHEELS = ["wheel_FL", "wheel_FR"]
REAR_WHEELS = ["wheel_RL", "wheel_RR"]
WHEEL_NODES = [f"wheel_{w}" for w in WHEEL_IDS]
SUSP_NODES = [f"susp_{w}" for w in WHEEL_IDS]

DOOR_PARTS = ["door_L", "door_R", "door_rear_L", "door_rear_R"]
BUMPER_PARTS = ["bumper_front", "bumper_rear"]
MIRROR_PARTS = ["mirror_L", "mirror_R"]
LIGHT_PARTS = ["light_head_L", "light_head_R", "light_brake_L", "light_brake_R"]
PANEL_PARTS = ["bonnet", "boot"] + DOOR_PARTS + BUMPER_PARTS

# Every required part node, descendant of `chassis`. `chassis` itself is the root visual node.
REQUIRED_PART_NODES = (
    ["bonnet", "boot"] + DOOR_PARTS + BUMPER_PARTS + ["glass"]
    + LIGHT_PARTS + MIRROR_PARTS + WHEEL_NODES + SUSP_NODES
)
ROOT_NODE = "chassis"

# Trims: sub-meshes of a part, jj_part_of set, no mass of their own.
TRIM_NODES = {"bumper_front_trim": "bumper_front", "boot_trim": "boot"}

REQUIRED_ANCHORS = ["cam_fp", "cam_tp_target", "com", "exhaust_0",
                    "lplate_front", "lplate_rear", "roof_number"]

REQUIRED_COLLIDERS = (
    ["col_chassis", "col_cabin"]
    + [f"col_{p}" for p in PANEL_PARTS]
    + [f"col_wheel_{w}" for w in WHEEL_IDS]
)

# Dentable parts and their expected morph target names.
DENTABLE_PANEL_PARTS = ["bonnet", "boot"] + DOOR_PARTS + BUMPER_PARTS
CHASSIS_DENT_TARGETS = ["chassis_dent_FL", "chassis_dent_FR", "chassis_dent_RL",
                        "chassis_dent_RR", "chassis_dent_roof"]

CORE_SEMANTICS = {"paint", "tyre", "wheel", "glass", "plastic", "metal", "headlight",
                  "brakelight", "interior", "decal", "underside"}
PROPOSAL_SEMANTICS = {"indicator", "accent"}
ALLOWED_SEMANTICS = CORE_SEMANTICS | PROPOSAL_SEMANTICS
EMISSIVE_SEMANTICS = {"headlight", "brakelight", "indicator"}

TRI_BUDGET_HYPOTHESES = {
    0: (1000, 3000, "close gameplay mesh"),
    1: (500, 1000, "medium view"),
    2: (150, 400, "distant/small view"),
}

ORIGIN_Y_TOL = 0.01
ORIGIN_Z_TOL = 0.05
PIVOT_TOL = 0.02
COLLIDER_FIT_TOL = 0.15
MASS_SUM_TOL = 1e-3
UNIT_AXIS_TOL = 1e-3
UV_BOUNDS_TOL = 1e-4
UV_OVERLAP_BUDGET_PCT = 0.5
MORPH_MIN_DISP = 0.01
MORPH_MAX_DISP = 0.25
SIDECAR_AGREEMENT_TOL = 0.01
ANCHOR_CENTRELINE_TOL = 0.1
ANCHOR_EXTREME_TOL = 0.15


# ---------------------------------------------------------------------------
# GLB / glTF parsing (stdlib only)
# ---------------------------------------------------------------------------

class GlbParseError(Exception):
    pass


def load_glb(path):
    """Parse a GLB file into (gltf_json_dict, bin_bytes_or_None)."""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 12:
        raise GlbParseError("file too short to contain a GLB header")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise GlbParseError(f"bad magic {magic!r}, expected b'glTF'")
    if version != 2:
        raise GlbParseError(f"unsupported glTF version {version}, expected 2")
    off = 12
    json_chunk = None
    bin_chunk = None
    while off < length and off < len(data):
        if off + 8 > len(data):
            raise GlbParseError("truncated chunk header")
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk_start = off + 8
        chunk_end = chunk_start + clen
        if chunk_end > len(data):
            raise GlbParseError("chunk length exceeds file size")
        chunk = data[chunk_start:chunk_end]
        if ctype == b"JSON":
            json_chunk = chunk
        elif ctype == b"BIN\x00":
            bin_chunk = chunk
        off = chunk_end
    if json_chunk is None:
        raise GlbParseError("no JSON chunk found")
    gltf = json.loads(json_chunk.decode("utf-8"))
    return gltf, bin_chunk


_COMP_TYPES = {
    5120: ("b", 1),  # BYTE
    5121: ("B", 1),  # UNSIGNED_BYTE
    5122: ("h", 2),  # SHORT
    5123: ("H", 2),  # UNSIGNED_SHORT
    5125: ("I", 4),  # UNSIGNED_INT
    5126: ("f", 4),  # FLOAT
}
_TYPE_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def read_accessor(gltf, bin_bytes, accessor_index):
    """Decode an accessor into a flat list of tuples (one tuple per element).

    Handles componentType/type, byteStride (interleaved bufferViews) and normalized
    integer formats. Sparse accessors are not supported (not needed for this pipeline's
    exporter output, per task scope).
    """
    acc = gltf["accessors"][accessor_index]
    count = acc["count"]
    comp_fmt, comp_size = _COMP_TYPES[acc["componentType"]]
    ncomp = _TYPE_COUNTS[acc["type"]]
    elem_bytes = comp_size * ncomp

    if "bufferView" not in acc:
        # No data (e.g. fully sparse-with-no-base, not expected here) -> zeros.
        return [tuple(0 for _ in range(ncomp))] * count

    bv = gltf["bufferViews"][acc["bufferView"]]
    stride = bv.get("byteStride") or elem_bytes
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    fmt = "<" + comp_fmt * ncomp
    out = []
    for i in range(count):
        off = base + i * stride
        raw = bin_bytes[off:off + elem_bytes]
        vals = struct.unpack(fmt, raw)
        if acc.get("normalized") and comp_fmt in ("B", "H", "b", "h"):
            if comp_fmt == "B":
                vals = tuple(v / 255.0 for v in vals)
            elif comp_fmt == "H":
                vals = tuple(v / 65535.0 for v in vals)
            elif comp_fmt == "b":
                vals = tuple(max(v / 127.0, -1.0) for v in vals)
            elif comp_fmt == "h":
                vals = tuple(max(v / 32767.0, -1.0) for v in vals)
        out.append(vals)
    return out


def prim_indices(gltf, bin_bytes, prim, vertex_count):
    if "indices" in prim:
        return [v[0] for v in read_accessor(gltf, bin_bytes, prim["indices"])]
    return list(range(vertex_count))


def prim_triangles(gltf, bin_bytes, prim):
    """Return (positions[], uv0_or_None, uv1_or_None, [(i,j,k) index triples])."""
    attrs = prim["attributes"]
    positions = [v for v in read_accessor(gltf, bin_bytes, attrs["POSITION"])] if "POSITION" in attrs else []
    uv0 = read_accessor(gltf, bin_bytes, attrs["TEXCOORD_0"]) if "TEXCOORD_0" in attrs else None
    uv1 = read_accessor(gltf, bin_bytes, attrs["TEXCOORD_1"]) if "TEXCOORD_1" in attrs else None
    mode = prim.get("mode", 4)
    idx = prim_indices(gltf, bin_bytes, prim, len(positions))
    tris = []
    if mode == 4:  # TRIANGLES
        for i in range(0, len(idx) - 2, 3):
            tris.append((idx[i], idx[i + 1], idx[i + 2]))
    # Other primitive modes (strip/fan/points/lines) are not expected for this pipeline;
    # leave tris empty for them rather than guessing.
    return positions, uv0, uv1, tris


# ---------------------------------------------------------------------------
# Minimal 4x4 matrix math (row-major nested lists), for node world transforms.
# ---------------------------------------------------------------------------

IDENTITY4 = [[1.0, 0.0, 0.0, 0.0],
             [0.0, 1.0, 0.0, 0.0],
             [0.0, 0.0, 1.0, 0.0],
             [0.0, 0.0, 0.0, 1.0]]


def mat4_mul(a, b):
    out = [[0.0] * 4 for _ in range(4)]
    for r in range(4):
        for c in range(4):
            out[r][c] = sum(a[r][k] * b[k][c] for k in range(4))
    return out


def mat4_apply_point(m, p):
    x, y, z = p
    v = [m[r][0] * x + m[r][1] * y + m[r][2] * z + m[r][3] for r in range(4)]
    return (v[0], v[1], v[2])


def mat4_apply_vector(m, v3):
    """Apply the linear (rotation+scale) part only -- for displacement vectors."""
    x, y, z = v3
    v = [m[r][0] * x + m[r][1] * y + m[r][2] * z for r in range(3)]
    return (v[0], v[1], v[2])


def quat_to_mat3(x, y, z, w):
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def mat4_from_node(node):
    if "matrix" in node:
        m = node["matrix"]  # column-major flat 16
        return [[m[0], m[4], m[8], m[12]],
                [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]],
                [m[3], m[7], m[11], m[15]]]
    t = node.get("translation", [0.0, 0.0, 0.0])
    r = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = node.get("scale", [1.0, 1.0, 1.0])
    rot = quat_to_mat3(*r)
    out = [[0.0] * 4 for _ in range(4)]
    for i in range(3):
        for j in range(3):
            out[i][j] = rot[i][j] * s[j]
        out[i][3] = t[i]
    out[3] = [0.0, 0.0, 0.0, 1.0]
    return out


def build_world_transforms(gltf):
    """Return dict: node_index -> 4x4 world matrix (row-major nested lists)."""
    nodes = gltf.get("nodes", [])
    parent_of = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent_of[c] = i
    scenes = gltf.get("scenes")
    if scenes:
        scene = scenes[gltf.get("scene", 0)]
        roots = list(scene.get("nodes", []))
    else:
        roots = [i for i in range(len(nodes)) if i not in parent_of]

    world = {}

    def visit(idx, parent_world):
        local = mat4_from_node(nodes[idx])
        w = mat4_mul(parent_world, local)
        world[idx] = w
        for c in nodes[idx].get("children", []):
            visit(c, w)

    for r in roots:
        visit(r, IDENTITY4)
    # Any node unreachable from scene roots (shouldn't happen, but be defensive):
    for i in range(len(nodes)):
        if i not in world:
            visit(i, IDENTITY4)
    return world


def world_translation(world_mat):
    return (world_mat[0][3], world_mat[1][3], world_mat[2][3])


# ---------------------------------------------------------------------------
# Asset context: one loaded GLB LOD + convenience lookups.
# ---------------------------------------------------------------------------

class LodAsset:
    def __init__(self, path, lod_number):
        self.path = path
        self.lod_number = lod_number
        self.gltf, self.bin_bytes = load_glb(path)
        self.nodes = self.gltf.get("nodes", [])
        self.node_index_by_name = {}
        for i, n in enumerate(self.nodes):
            name = n.get("name")
            if name:
                # First occurrence wins; duplicate names are their own problem, not
                # something we silently paper over.
                self.node_index_by_name.setdefault(name, i)
        self.world = build_world_transforms(self.gltf)
        self._mesh_cache = {}

    def node(self, name):
        i = self.node_index_by_name.get(name)
        return None if i is None else self.nodes[i]

    def node_index(self, name):
        return self.node_index_by_name.get(name)

    def has_node(self, name):
        return name in self.node_index_by_name

    def world_matrix(self, name):
        i = self.node_index(name)
        return None if i is None else self.world[i]

    def world_pos(self, name):
        m = self.world_matrix(name)
        return None if m is None else world_translation(m)

    def mesh_of_node(self, name):
        n = self.node(name)
        if n is None or "mesh" not in n:
            return None
        return self.gltf["meshes"][n["mesh"]]

    def node_local_positions(self, name):
        """Local-space positions of a node's mesh (ALL primitives: a part is split per material), decoded once."""
        key = ("local", name)
        if key in self._mesh_cache:
            return self._mesh_cache[key]
        mesh = self.mesh_of_node(name)
        if mesh is None or not mesh.get("primitives"):
            self._mesh_cache[key] = None
            return None
        pos = []
        for prim in mesh["primitives"]:
            p, uv0, uv1, tris = prim_triangles(self.gltf, self.bin_bytes, prim)
            pos.extend(p)
        self._mesh_cache[key] = pos
        return pos

    def node_world_positions(self, name):
        pos = self.node_local_positions(name)
        if pos is None:
            return None
        m = self.world_matrix(name)
        return [mat4_apply_point(m, p) for p in pos]

    def all_visual_node_names(self):
        """Node names that carry a rendered mesh and are NOT collider proxies."""
        out = []
        for n in self.nodes:
            name = n.get("name")
            if not name or "mesh" not in n:
                continue
            if name.startswith("col_"):
                continue
            out.append(name)
        return out

    def all_collider_node_names(self):
        return [n.get("name") for n in self.nodes
                if n.get("name", "").startswith("col_") and "mesh" in n]

    def required_node_names(self):
        """The full set of stable-ID node names this LOD is expected to carry."""
        return set([ROOT_NODE] + REQUIRED_PART_NODES + list(TRIM_NODES.keys())
                   + REQUIRED_ANCHORS + REQUIRED_COLLIDERS)

    def morph_target_names(self, part_name):
        mesh = self.mesh_of_node(part_name)
        if mesh is None:
            return None
        names = mesh.get("extras", {}).get("targetNames")
        return list(names) if names else []


def bbox_of_points(points):
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def bbox_center(bbox):
    (minp, maxp) = bbox
    return tuple((minp[i] + maxp[i]) / 2.0 for i in range(3))


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

class Reporter:
    def __init__(self):
        self.lines = []
        self.fail_count = 0
        self.pass_count = 0

    def report(self, rule_id, ok, detail):
        status = "PASS" if ok else "FAIL"
        line = f"{status} {rule_id} {detail}"
        self.lines.append(line)
        print(line)
        if ok:
            self.pass_count += 1
        else:
            self.fail_count += 1
        return ok

    def info(self, rule_id, detail):
        line = f"INFO {rule_id} {detail}"
        self.lines.append(line)
        print(line)


# ---------------------------------------------------------------------------
# Rule implementations. Each takes (rep, lod, sidecar) or a list of lods for
# cross-LOD rules, and reports one PASS/FAIL line (per lod, where relevant).
# ---------------------------------------------------------------------------

def rule_glb_parse(rep, lods_or_errors):
    """lods_or_errors: list of (path, LodAsset_or_None, error_or_None)."""
    for path, lod, err in lods_or_errors:
        base = os.path.basename(path)
        if err is not None:
            rep.report("glb.parse", False, f"{base}: {err}")
            continue
        issues = []
        gltf = lod.gltf
        if gltf.get("asset", {}).get("version") != "2.0":
            issues.append(f"asset.version={gltf.get('asset', {}).get('version')!r}, expected '2.0'")
        if gltf.get("cameras"):
            issues.append(f"{len(gltf['cameras'])} camera(s) present (not allowed)")
        ext_used = set(gltf.get("extensionsUsed", []))
        if "KHR_lights_punctual" in ext_used or gltf.get("extensions", {}).get("KHR_lights_punctual"):
            issues.append("KHR_lights_punctual extension present (not allowed)")
        for n in gltf.get("nodes", []):
            if "extensions" in n and "KHR_lights_punctual" in n["extensions"]:
                issues.append(f"node '{n.get('name')}' has a KHR_lights_punctual light")
        if gltf.get("animations"):
            issues.append(f"{len(gltf['animations'])} animation(s) present (not allowed)")
        if issues:
            rep.report("glb.parse", False, f"{base}: " + "; ".join(issues))
        else:
            rep.report("glb.parse", True,
                       f"{base}: valid glTF 2.0 GLB, no cameras/lights/animations "
                       f"({len(gltf.get('nodes', []))} nodes, {len(gltf.get('meshes', []))} meshes)")


def rule_nodes_required(rep, lod):
    base = os.path.basename(lod.path)
    required = lod.required_node_names()
    missing = sorted(n for n in required if not lod.has_node(n))
    if missing:
        rep.report("nodes.required", False, f"{base}: missing nodes {missing}")
    else:
        rep.report("nodes.required", True, f"{base}: all {len(required)} required nodes present")


def rule_nodes_same_across_lods(rep, lods):
    """lods: list of LodAsset (successfully-parsed only)."""
    if len(lods) < 2:
        rep.info("nodes.same_across_lods", "only one parsed LOD available, nothing to compare")
        return
    per_lod_names = {}
    per_lod_morphs = {}
    for lod in lods:
        base = os.path.basename(lod.path)
        names = set(n.get("name") for n in lod.nodes if n.get("name"))
        per_lod_names[base] = names
        morphs = {}
        for part in DENTABLE_PANEL_PARTS + [ROOT_NODE]:
            if lod.has_node(part):
                morphs[part] = tuple(sorted(lod.morph_target_names(part) or []))
        per_lod_morphs[base] = morphs

    ref_base = os.path.basename(lods[0].path)
    ref_names = per_lod_names[ref_base]
    ref_morphs = per_lod_morphs[ref_base]
    issues = []
    for base, names in per_lod_names.items():
        if base == ref_base:
            continue
        only_ref = ref_names - names
        only_this = names - ref_names
        if only_ref or only_this:
            issues.append(f"{base} vs {ref_base}: only-in-{ref_base}={sorted(only_ref)} "
                           f"only-in-{base}={sorted(only_this)}")
    for base, morphs in per_lod_morphs.items():
        if base == ref_base:
            continue
        for part in set(ref_morphs) | set(morphs):
            if ref_morphs.get(part) != morphs.get(part):
                issues.append(f"{base}.{part} morph targets {morphs.get(part)} != "
                               f"{ref_base}.{part} morph targets {ref_morphs.get(part)}")
    if issues:
        rep.report("nodes.same_across_lods", False, "; ".join(issues))
    else:
        rep.report("nodes.same_across_lods", True,
                   f"identical node name sets and morph-target names across {len(lods)} LODs")


def rule_space_origin(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    lowest_ys = []
    for w in WHEEL_NODES:
        pts = lod.node_world_positions(w)
        if not pts:
            issues.append(f"{w}: no mesh to measure")
            continue
        min_y = min(p[1] for p in pts)
        lowest_ys.append((w, min_y))
        if abs(min_y) > ORIGIN_Y_TOL:
            issues.append(f"{w} lowest vertex y={min_y:.4f} (want 0 +/- {ORIGIN_Y_TOL})")
    hub_zs = []
    for w in WHEEL_NODES:
        p = lod.world_pos(w)
        if p is not None:
            hub_zs.append(p[2])
    if hub_zs:
        mean_z = sum(hub_zs) / len(hub_zs)
        if abs(mean_z) > ORIGIN_Z_TOL:
            issues.append(f"mean wheel hub z={mean_z:.4f} (want 0 +/- {ORIGIN_Z_TOL})")
    else:
        issues.append("no wheel hubs found to check axle centring")
    detail = f"{base}: lowest_wheel_y={lowest_ys}" if not issues else f"{base}: " + "; ".join(issues)
    rep.report("space.origin", not issues, detail)


def _part_world_center_z(lod, name):
    """World-space Z of a part's geometric centre (mesh bbox centre), which is robust to
    either authoring convention seen in exported assets: a real node translation with
    mesh vertices centred on it, OR an identity node transform with the true position
    baked directly into the mesh vertices (translation left at (0,0,0)). Node.translation
    alone is NOT a reliable position for the latter convention."""
    pts = lod.node_world_positions(name)
    if pts:
        return bbox_center(bbox_of_points(pts))[2]
    p = lod.world_pos(name)
    return p[2] if p else None


def rule_space_forward(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    head_z = [z for n in ("light_head_L", "light_head_R")
              for z in [_part_world_center_z(lod, n)] if z is not None]
    brake_z = [z for n in ("light_brake_L", "light_brake_R")
               for z in [_part_world_center_z(lod, n)] if z is not None]
    if head_z and brake_z:
        mh, mb = sum(head_z) / len(head_z), sum(brake_z) / len(brake_z)
        if not (mh < mb):
            issues.append(f"headlights mean z={mh:.3f} not more negative than brakelights mean z={mb:.3f}")
    else:
        issues.append("missing headlight or brakelight nodes")
    front_z = [z for n in FRONT_WHEELS for z in [_part_world_center_z(lod, n)] if z is not None]
    if front_z:
        bad = [z for z in front_z if not (z < 0)]
        if bad:
            issues.append(f"front wheel(s) not at negative z: {bad}")
    else:
        issues.append("missing front wheel nodes")
    detail = f"{base}: forward=-Z convention holds" if not issues else f"{base}: " + "; ".join(issues)
    rep.report("space.forward", not issues, detail)


def rule_pivots_wheels(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    checked = 0
    for w in WHEEL_NODES:
        world_pts = lod.node_world_positions(w)
        world_p = lod.world_pos(w)
        if not world_pts or world_p is None:
            issues.append(f"{w}: no mesh/translation to check")
            continue
        checked += 1
        bbox = bbox_of_points(world_pts)
        center = bbox_center(bbox)
        dist = math.dist(center, world_p)
        if dist > PIVOT_TOL:
            issues.append(f"{w}: pivot-to-bbox-centre distance={dist:.4f} (budget {PIVOT_TOL})")
    detail = f"{base}: {checked} wheel pivots within {PIVOT_TOL}m of mesh bbox centre" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("pivots.wheels", not issues, detail)


def rule_pivots_hinges(rep, lod):
    base = os.path.basename(lod.path)
    hinge_parts = [p for p in (DOOR_PARTS + ["bonnet", "boot"]) if lod.has_node(p)]
    issues = []
    checked = 0
    for p in hinge_parts:
        pos = lod.node_local_positions(p)
        if not pos:
            issues.append(f"{p}: no mesh to check")
            continue
        checked += 1
        bbox = bbox_of_points(pos)
        minp, maxp = bbox
        # Distance from local origin (0,0,0) to nearest bbox face, per axis.
        face_dists = [min(abs(0 - minp[i]), abs(0 - maxp[i])) for i in range(3)]
        best_axis_dist = min(face_dists)
        if best_axis_dist > PIVOT_TOL:
            issues.append(f"{p}: origin-to-nearest-bbox-face distance={best_axis_dist:.4f} "
                          f"(budget {PIVOT_TOL}) -- pivot looks centred, not hinged")
    detail = f"{base}: {checked} hinge pivots sit on a mesh bbox face" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("pivots.hinges", not issues, detail)


def _vec_len(v):
    return math.sqrt(sum(c * c for c in v))


def rule_extras_parts(rep, lod):
    base = os.path.basename(lod.path)
    parts = [p for p in ([ROOT_NODE] + REQUIRED_PART_NODES) if lod.has_node(p)]
    issues = []
    for p in parts:
        extras = lod.node(p).get("extras", {}) or {}
        for key in ("jj_part", "jj_joint", "jj_mass_fraction"):
            if key not in extras:
                issues.append(f"{p}: missing extras.{key}")
        if extras.get("jj_part") is not None and extras.get("jj_part") != p:
            issues.append(f"{p}: extras.jj_part={extras.get('jj_part')!r} != node name")
        for axis_key in ("jj_axis", "jj_axis_steer", "jj_axis_spin"):
            axis = extras.get(axis_key)
            if axis is not None:
                length = _vec_len(axis)
                if abs(length - 1.0) > UNIT_AXIS_TOL:
                    issues.append(f"{p}: extras.{axis_key}={axis} has length {length:.4f}, not unit")
    detail = f"{base}: {len(parts)} parts carry jj_part/jj_joint/jj_mass_fraction, axes unit length" \
        if not issues else f"{base}: " + "; ".join(issues)
    rep.report("extras.parts", not issues, detail)


def rule_mass_sum(rep, lod, sidecar):
    base = os.path.basename(lod.path)
    issues = []
    total = 0.0
    per_part = {}
    for p in ([ROOT_NODE] + REQUIRED_PART_NODES):
        if not lod.has_node(p):
            continue
        extras = lod.node(p).get("extras", {}) or {}
        mf = extras.get("jj_mass_fraction")
        if mf is None:
            continue
        per_part[p] = mf
        total += mf
    if abs(total - 1.0) > MASS_SUM_TOL:
        issues.append(f"sum of jj_mass_fraction over parts = {total:.5f}, expected 1.0 +/- {MASS_SUM_TOL}")
    sidecar_parts = (sidecar or {}).get("parts", {})
    for p, mf in per_part.items():
        sc = sidecar_parts.get(p, {})
        sc_mf = sc.get("mass_fraction")
        if sc_mf is not None and abs(sc_mf - mf) > MASS_SUM_TOL:
            issues.append(f"{p}: sidecar mass_fraction={sc_mf} != node extras jj_mass_fraction={mf}")
    detail = f"{base}: mass fractions sum to {total:.5f}, {len(per_part)} parts match sidecar" \
        if not issues else f"{base}: " + "; ".join(issues)
    rep.report("mass.sum", not issues, detail)


def rule_colliders_present(rep, lod):
    base = os.path.basename(lod.path)
    missing = [c for c in REQUIRED_COLLIDERS if not lod.has_node(c)]
    if missing:
        rep.report("colliders.present", False, f"{base}: missing colliders {missing}")
    else:
        rep.report("colliders.present", True, f"{base}: all {len(REQUIRED_COLLIDERS)} colliders present")


def rule_colliders_no_material(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    for cname in lod.all_collider_node_names():
        mesh = lod.mesh_of_node(cname)
        if mesh is None:
            continue
        for prim in mesh.get("primitives", []):
            if prim.get("material") is not None:
                issues.append(f"{cname}: primitive has material index {prim['material']}")
    detail = f"{base}: no collider primitive has a material" if not issues else f"{base}: " + "; ".join(issues)
    rep.report("colliders.no_material", not issues, detail)


def _unique_positions(points, quant=1e-5):
    seen = set()
    out = []
    for p in points:
        key = tuple(round(c / quant) for c in p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _is_convex_mesh(positions, tris, tol=1e-4):
    """All vertices on the inner side of every face plane: for every triangle face (from
    the mesh's own index buffer) build the plane and verify no vertex lies outside it by
    more than tol. This directly checks the authored geometry is convex, without building
    a separate hull -- correct as long as the mesh IS its own hull (every vertex is on the
    boundary), which is what the contract requires of col_chassis/col_cabin."""
    if not tris:
        return True, []
    violations = []
    for (ia, ib, ic) in tris:
        a, b, c = positions[ia], positions[ib], positions[ic]
        u = tuple(b[k] - a[k] for k in range(3))
        v = tuple(c[k] - a[k] for k in range(3))
        normal = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        nlen = _vec_len(normal)
        if nlen < 1e-12:
            continue
        normal = tuple(n / nlen for n in normal)
        d = sum(normal[k] * a[k] for k in range(3))
        max_out = 0.0
        for p in positions:
            side = sum(normal[k] * p[k] for k in range(3)) - d
            if side > max_out:
                max_out = side
        if max_out > tol:
            violations.append(max_out)
    return (len(violations) == 0), violations


def rule_colliders_shape(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    for cname in ("col_chassis", "col_cabin"):
        if not lod.has_node(cname):
            continue
        pos = lod.node_local_positions(cname)
        mesh = lod.mesh_of_node(cname)
        if not pos or mesh is None:
            issues.append(f"{cname}: no geometry to check")
            continue
        prim = mesh["primitives"][0]
        _, _, _, tris = prim_triangles(lod.gltf, lod.bin_bytes, prim)
        ok, violations = _is_convex_mesh(pos, tris)
        if not ok:
            issues.append(f"{cname}: not convex, max outside-plane distance="
                          f"{max(violations):.5f} (tol 1e-4)")
        if cname == "col_cabin":
            uniq = _unique_positions(pos)
            if len(uniq) in (8, 12):
                issues.append(f"{cname}: looks like a plain box ({len(uniq)} unique vertices) "
                              f"-- contract requires a cabin-shaped convex hull, not a box")
    for p in PANEL_PARTS:
        cname = f"col_{p}"
        if not lod.has_node(cname):
            continue
        pos = lod.node_local_positions(cname)
        if not pos:
            issues.append(f"{cname}: no geometry to check")
            continue
        shape = (lod.node(cname).get("extras", {}).get("jj_collider") or {}).get("shape", "box")
        if shape == "convex":   # rounded panels (e.g. bullet-nose bumpers) declare a hull instead of a box
            prim = lod.mesh_of_node(cname)["primitives"][0]
            _, _, _, tris = prim_triangles(lod.gltf, lod.bin_bytes, prim)
            ok, violations = _is_convex_mesh(pos, tris)
            if not ok:
                issues.append(f"{cname}: declared convex but max outside-plane distance={max(violations):.5f}")
        else:
            uniq = _unique_positions(pos)
            if len(uniq) > 8:
                issues.append(f"{cname}: {len(uniq)} unique vertices, expected a box (<=8)")
    for w in WHEEL_IDS:
        cname = f"col_wheel_{w}"
        if not lod.has_node(cname):
            continue
        pos = lod.node_local_positions(cname)
        if not pos or len(pos) < 6:
            issues.append(f"{cname}: too few vertices for a cylinder")
            continue
        # Approximate cylinder check: local axis assumed to be the wheel's rotation axis
        # (X, since wheels are left/right pairs spinning about the car's X axis). Group by
        # X level and check radial (Y,Z) distance from the mean axis is roughly constant.
        xs = sorted(set(round(p[0], 4) for p in pos))
        if len(xs) < 2:
            issues.append(f"{cname}: no extent along presumed axle axis (X)")
            continue
        cy = sum(p[1] for p in pos) / len(pos)
        cz = sum(p[2] for p in pos) / len(pos)
        radii = [math.hypot(p[1] - cy, p[2] - cz) for p in pos]
        # Fan-cap centre vertices legitimately sit ON the rotation axis (radius 0) in a
        # standard capped-cylinder mesh; they are not part of the cylindrical side wall and
        # must not count against "roughly cylindrical". Only rim vertices matter here.
        rim_radii = [r for r in radii if r > 0.25 * max(radii, default=0)]
        if not rim_radii:
            issues.append(f"{cname}: degenerate radius, not cylindrical")
            continue
        mean_r = sum(rim_radii) / len(rim_radii)
        max_dev = max(abs(r - mean_r) for r in rim_radii) / mean_r
        if max_dev > 0.25:
            issues.append(f"{cname}: radius varies {max_dev*100:.0f}% from mean, not roughly "
                          f"cylindrical")
    detail = f"{base}: chassis/cabin convex, cabin not a box, panels boxy, wheels cylindrical" \
        if not issues else f"{base}: " + "; ".join(issues)
    rep.report("colliders.shape", not issues, detail)


def rule_colliders_fit(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    checked = 0
    part_for_collider = {"col_chassis": "chassis", "col_cabin": "chassis"}
    for p in PANEL_PARTS:
        part_for_collider[f"col_{p}"] = p
    for w in WHEEL_IDS:
        part_for_collider[f"col_wheel_{w}"] = f"wheel_{w}"
    for cname, part in part_for_collider.items():
        if not lod.has_node(cname) or not lod.has_node(part):
            continue
        cpts = lod.node_world_positions(cname)
        ppts = lod.node_world_positions(part)
        if not cpts or not ppts:
            continue
        checked += 1
        cbox = bbox_of_points(cpts)
        pbox = bbox_of_points(ppts)
        # "Fit" = the collider does not stick out beyond the part's own visual bbox by more
        # than the tolerance. Undershoot (a smaller, conservative proxy -- e.g. col_chassis and
        # col_cabin are each a SUB-REGION of the one `chassis` mesh, never its full bbox) is not
        # a defect and must not fail; only overshoot (a collider ballooning outside the geometry
        # it is supposed to approximate) is a real fit bug.
        for axis in range(3):
            under_min = pbox[0][axis] - cbox[0][axis]   # >0 if collider extends below part's min
            over_max = cbox[1][axis] - pbox[1][axis]    # >0 if collider extends above part's max
            if under_min > COLLIDER_FIT_TOL or over_max > COLLIDER_FIT_TOL:
                issues.append(f"{cname} vs {part}: axis {axis} overshoots part bbox by "
                              f"{max(under_min, over_max):.3f}m (budget {COLLIDER_FIT_TOL})")
    detail = f"{base}: {checked} colliders stay within {COLLIDER_FIT_TOL}m of their part's bbox" \
        if not issues else f"{base}: " + "; ".join(issues)
    rep.report("colliders.fit", not issues, detail)


def rule_materials_semantic(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    materials = lod.gltf.get("materials", [])
    for name in lod.all_visual_node_names():
        mesh = lod.mesh_of_node(name)
        if mesh is None:
            continue
        for prim in mesh.get("primitives", []):
            mi = prim.get("material")
            if mi is None:
                issues.append(f"{name}: primitive has no material")
                continue
            mat = materials[mi]
            semantic = mat.get("extras", {}).get("jj_semantic")
            if semantic not in ALLOWED_SEMANTICS:
                issues.append(f"{name}: material '{mat.get('name')}' extras.jj_semantic="
                              f"{semantic!r} not in {sorted(ALLOWED_SEMANTICS)}")
                continue
            mname = mat.get("name", "")
            if not (mname == f"jj_{semantic}" or mname.startswith(f"jj_{semantic}_")):
                issues.append(f"{name}: material name '{mname}' doesn't match "
                              f"jj_{semantic}[_variant]")
    detail = f"{base}: every visual primitive has a jj_<semantic> material" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("materials.semantic", not issues, detail)


def rule_materials_emissive(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    found_any = False
    for mat in lod.gltf.get("materials", []):
        semantic = mat.get("extras", {}).get("jj_semantic")
        if semantic not in EMISSIVE_SEMANTICS:
            continue
        found_any = True
        emissive = mat.get("emissiveFactor", [0, 0, 0])
        strength = mat.get("extensions", {}).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 0)
        if sum(emissive) <= 0 and strength <= 0:
            issues.append(f"material '{mat.get('name')}' ({semantic}): emissiveFactor={emissive} "
                          f"emissiveStrength={strength}, expected non-zero")
    if not found_any:
        rep.report("materials.emissive", False, f"{base}: no headlight/brakelight/indicator material found")
        return
    detail = f"{base}: headlight/brakelight/indicator materials are emissive" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("materials.emissive", not issues, detail)


def rule_materials_paint_mask(rep, lod, sidecar):
    base = os.path.basename(lod.path)
    materials = lod.gltf.get("materials", [])
    paint = next((m for m in materials if m.get("name") == "jj_paint"), None)
    if paint is None:
        rep.report("materials.paint_mask", False, f"{base}: no 'jj_paint' material present")
        return
    issues = []
    tex_ref = paint.get("pbrMetallicRoughness", {}).get("baseColorTexture")
    if tex_ref is None:
        rep.report("materials.paint_mask", False, f"{base}: jj_paint has no baseColorTexture")
        return
    tex = lod.gltf["textures"][tex_ref["index"]]
    img_idx = tex.get("source")
    img = lod.gltf["images"][img_idx] if img_idx is not None else None
    if img is None or "bufferView" not in img:
        rep.report("materials.paint_mask", False, f"{base}: jj_paint baseColorTexture image not embedded")
        return
    bv = lod.gltf["bufferViews"][img["bufferView"]]
    off = bv.get("byteOffset", 0)
    raw = lod.bin_bytes[off:off + bv["byteLength"]]
    if Image is None:
        issues.append("PIL not available, cannot decode mask PNG")
    else:
        try:
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception as e:
            issues.append(f"mask texture failed to decode: {e}")
        else:
            if im.mode not in ("RGBA", "RGB"):
                issues.append(f"mask texture mode={im.mode}, expected RGBA or RGB")
            expected = None
            for lod_entry in (sidecar or {}).get("lods", []):
                if lod_entry.get("lod") == lod.lod_number or lod_entry.get("file") == os.path.basename(lod.path):
                    expected = lod_entry.get("mask_px")
            if expected is None:
                per_lod = (sidecar or {}).get("textures", {}).get("mask", {}).get("per_lod_px", {})
                expected = per_lod.get(str(lod.lod_number)) or per_lod.get(lod.lod_number)
            if expected is not None:
                exp_wh = tuple(expected) if isinstance(expected, (list, tuple)) else (expected, expected)
                if im.size != exp_wh:
                    issues.append(f"mask texture size={im.size} != sidecar expected {exp_wh}")
    detail = f"{base}: jj_paint baseColorTexture is an embedded RGBA/RGB PNG mask" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("materials.paint_mask", not issues, detail)


def rule_uv_present(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    for name in lod.all_visual_node_names():
        mesh = lod.mesh_of_node(name)
        if mesh is None:
            continue
        for pi, prim in enumerate(mesh.get("primitives", [])):
            attrs = prim.get("attributes", {})
            if "TEXCOORD_0" not in attrs:
                issues.append(f"{name}[{pi}]: missing TEXCOORD_0")
            if "TEXCOORD_1" not in attrs:
                issues.append(f"{name}[{pi}]: missing TEXCOORD_1")
    detail = f"{base}: TEXCOORD_0 and TEXCOORD_1 present on all visual primitives" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("uv.present", not issues, detail)


def rule_uv_bounds(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    for name in lod.all_visual_node_names():
        mesh = lod.mesh_of_node(name)
        if mesh is None:
            continue
        for pi, prim in enumerate(mesh.get("primitives", [])):
            if "TEXCOORD_0" not in prim.get("attributes", {}):
                continue
            uv0 = read_accessor(lod.gltf, lod.bin_bytes, prim["attributes"]["TEXCOORD_0"])
            us = [u for u, v in uv0]
            vs = [v for u, v in uv0]
            if min(us) < -UV_BOUNDS_TOL or max(us) > 1 + UV_BOUNDS_TOL \
                    or min(vs) < -UV_BOUNDS_TOL or max(vs) > 1 + UV_BOUNDS_TOL:
                issues.append(f"{name}[{pi}]: UV0 out of [0,1] u=[{min(us):.4f},{max(us):.4f}] "
                              f"v=[{min(vs):.4f},{max(vs):.4f}]")
    detail = f"{base}: all UV0 in [0,1]" if not issues else f"{base}: " + "; ".join(issues)
    rep.report("uv.bounds", not issues, detail)


def _edge(ax, ay, bx, by, px, py):
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax)


def _rasterize_triangle_pixels(uv_a, uv_b, uv_c, res):
    """Yield (x, y, w0, w1, w2) for pixel centers inside the triangle (inclusive test,
    used only for the 'covered' set, deduped by set membership so edge-sharing between
    adjacent triangles never inflates coverage)."""
    ax, ay = uv_a[0] * res, uv_a[1] * res
    bx, by = uv_b[0] * res, uv_b[1] * res
    cx, cy = uv_c[0] * res, uv_c[1] * res
    area = _edge(ax, ay, bx, by, cx, cy)
    if abs(area) < 1e-9:
        return
    minx = max(int(min(ax, bx, cx)), 0)
    maxx = min(int(max(ax, bx, cx)) + 1, res - 1)
    miny = max(int(min(ay, by, cy)), 0)
    maxy = min(int(max(ay, by, cy)) + 1, res - 1)
    inv_area = 1.0 / area
    for y in range(miny, maxy + 1):
        py = y + 0.5
        for x in range(minx, maxx + 1):
            px = x + 0.5
            w0 = _edge(bx, by, cx, cy, px, py) * inv_area
            w1 = _edge(cx, cy, ax, ay, px, py) * inv_area
            w2 = _edge(ax, ay, bx, by, px, py) * inv_area
            if w0 >= -1e-6 and w1 >= -1e-6 and w2 >= -1e-6:
                yield x, y, w0, w1, w2


def rule_uv_overlap(rep, lod):
    base = os.path.basename(lod.path)
    RES = 512
    covered = set()
    interior_touch = {}
    for name in lod.all_visual_node_names():
        mesh = lod.mesh_of_node(name)
        if mesh is None:
            continue
        for prim in mesh.get("primitives", []):
            if "TEXCOORD_0" not in prim.get("attributes", {}):
                continue
            pos, uv0, uv1, tris = prim_triangles(lod.gltf, lod.bin_bytes, prim)
            for (ia, ib, ic) in tris:
                a, b, c = uv0[ia], uv0[ib], uv0[ic]
                # Skip degenerate triangles (zero UV area).
                area2 = _edge(a[0], a[1], b[0], b[1], c[0], c[1])
                if abs(area2) < 1e-12:
                    continue
                for x, y, w0, w1, w2 in _rasterize_triangle_pixels(a, b, c, RES):
                    covered.add((x, y))
                    # Strict-interior test for overlap counting only, so a shared edge
                    # between two adjacent, non-overlapping triangles (w==0 on that edge
                    # for one of them) is never double-counted as an overlap -- this is
                    # the "half-open" rasterization the spec asks for.
                    if w0 > 1e-6 and w1 > 1e-6 and w2 > 1e-6:
                        interior_touch[(x, y)] = interior_touch.get((x, y), 0) + 1
    overlap_px = sum(1 for v in interior_touch.values() if v > 1)
    covered_px = len(covered)
    pct = (100.0 * overlap_px / covered_px) if covered_px else 0.0
    detail = f"{base}: overlap={overlap_px}px covered={covered_px}px ({pct:.3f}%, budget {UV_OVERLAP_BUDGET_PCT}%)"
    rep.report("uv.overlap", pct <= UV_OVERLAP_BUDGET_PCT, detail)


def rule_morphs_present(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    if lod.has_node(ROOT_NODE):
        names = set(lod.morph_target_names(ROOT_NODE) or [])
        missing = [t for t in CHASSIS_DENT_TARGETS if t not in names]
        if missing:
            issues.append(f"chassis: missing dent targets {missing} (has {sorted(names)})")
    else:
        issues.append("chassis node missing, cannot check dent targets")
    for p in DENTABLE_PANEL_PARTS:
        if not lod.has_node(p):
            continue
        names = set(lod.morph_target_names(p) or [])
        expected = f"{p}_dent"
        if expected not in names:
            issues.append(f"{p}: missing dent target '{expected}' (has {sorted(names)})")
    detail = f"{base}: all dentable parts carry their expected morph targets" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("morphs.present", not issues, detail)


def rule_morphs_nonzero(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    checked = 0
    for p in DENTABLE_PANEL_PARTS + [ROOT_NODE]:
        if not lod.has_node(p):
            continue
        mesh = lod.mesh_of_node(p)
        if mesh is None or not mesh.get("primitives"):
            continue
        # a part is split into one primitive per material; a target's displacement is the max over all of them
        names = lod.morph_target_names(p) or []
        per_target = {}
        for prim in mesh["primitives"]:
            for ti, target in enumerate(prim.get("targets", [])):
                if "POSITION" not in target:
                    continue
                deltas = read_accessor(lod.gltf, lod.bin_bytes, target["POSITION"])
                per_target[ti] = max(per_target.get(ti, 0.0), max((_vec_len(d) for d in deltas), default=0.0))
        for ti, max_disp in sorted(per_target.items()):
            tname = names[ti] if ti < len(names) else f"target[{ti}]"
            checked += 1
            if not (MORPH_MIN_DISP <= max_disp <= MORPH_MAX_DISP):
                issues.append(f"{p}.{tname}: max displacement={max_disp:.4f}m, expected "
                              f"[{MORPH_MIN_DISP},{MORPH_MAX_DISP}]")
    detail = f"{base}: {checked} morph targets within displacement budget" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("morphs.nonzero", not issues, detail)


def rule_budget_triangles(rep, lod, sidecar):
    base = os.path.basename(lod.path)
    total = 0
    for name in lod.all_visual_node_names():
        mesh = lod.mesh_of_node(name)
        if mesh is None:
            continue
        for prim in mesh.get("primitives", []):
            _, _, _, tris = prim_triangles(lod.gltf, lod.bin_bytes, prim)
            total += len(tris)

    sidecar_lods = (sidecar or {}).get("lods", [])
    sc_entry = next((e for e in sidecar_lods
                     if e.get("lod") == lod.lod_number or e.get("file") == os.path.basename(lod.path)), None)
    if sc_entry is None or "triangles" not in sc_entry:
        rep.report("budget.triangles", False, f"{base}: no sidecar lods[] entry with a "
                   f"'triangles' field to compare against (counted {total} from GLB accessors)")
        return
    sc_tris = sc_entry["triangles"]
    ok = (sc_tris == total)
    lo, hi, label = TRI_BUDGET_HYPOTHESES.get(lod.lod_number, (None, None, "unspecified"))
    if lo is not None:
        rep.info("budget.triangles", f"{base}: plan SS12.4 hypothesis range for {label} = "
                 f"{lo}-{hi} triangles (not a hard ceiling)")
    detail = f"{base}: counted {total} triangles from GLB accessors, sidecar claims {sc_tris}"
    rep.report("budget.triangles", ok, detail)


def rule_anchors(rep, lod):
    base = os.path.basename(lod.path)
    issues = []
    roof = lod.world_pos("roof_number")
    chassis_pts = lod.node_world_positions(ROOT_NODE)
    cabin_ys = []
    for p in ["glass"] + DOOR_PARTS:
        pts = lod.node_world_positions(p)
        if pts:
            cabin_ys.extend(y for _, y, _ in pts)
    if roof is None:
        issues.append("roof_number anchor missing")
    else:
        if cabin_ys:
            roof_clear = roof[1] - max(cabin_ys)
            if roof_clear < 0:
                issues.append(f"roof_number y={roof[1]:.3f} not above cabin roof "
                              f"(cabin max y={max(cabin_ys):.3f})")
        if abs(roof[0]) > ANCHOR_CENTRELINE_TOL:
            issues.append(f"roof_number x={roof[0]:.3f} not within {ANCHOR_CENTRELINE_TOL}m of centreline")

    all_visual_pts = []
    for name in lod.all_visual_node_names():
        pts = lod.node_world_positions(name)
        if pts:
            all_visual_pts.extend(pts)
    if all_visual_pts:
        min_z = min(p[2] for p in all_visual_pts)
        max_z = max(p[2] for p in all_visual_pts)
        lp_front = lod.world_pos("lplate_front")
        lp_rear = lod.world_pos("lplate_rear")
        if lp_front is None:
            issues.append("lplate_front anchor missing")
        elif abs(lp_front[2] - min_z) > ANCHOR_EXTREME_TOL:
            issues.append(f"lplate_front z={lp_front[2]:.3f} not within {ANCHOR_EXTREME_TOL}m "
                          f"of front extreme z={min_z:.3f}")
        if lp_rear is None:
            issues.append("lplate_rear anchor missing")
        elif abs(lp_rear[2] - max_z) > ANCHOR_EXTREME_TOL:
            issues.append(f"lplate_rear z={lp_rear[2]:.3f} not within {ANCHOR_EXTREME_TOL}m "
                          f"of rear extreme z={max_z:.3f}")
    else:
        issues.append("no visual geometry found to establish front/rear extremes")

    detail = f"{base}: roof_number and lplate anchors in expected positions" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("anchors", not issues, detail)


def rule_sidecar_agreement(rep, lod, sidecar):
    base = os.path.basename(lod.path)
    if not sidecar:
        rep.info("sidecar.agreement", f"{base}: no sidecar provided, nothing to compare")
        return
    issues = []
    checked = 0
    anchors = sidecar.get("anchors", {})
    for name, sc_pos in anchors.items():
        if not lod.has_node(name):
            continue
        world_p = lod.world_pos(name)
        if world_p is None or sc_pos is None:
            continue
        checked += 1
        dist = math.dist(world_p, tuple(sc_pos))
        if dist > SIDECAR_AGREEMENT_TOL:
            issues.append(f"anchor '{name}': sidecar={sc_pos} vs GLB world={tuple(round(c,4) for c in world_p)} "
                          f"dist={dist:.4f} (budget {SIDECAR_AGREEMENT_TOL})")
    wheels = sidecar.get("wheels", {})
    for wid, w in wheels.items():
        node_name = w.get("hub_node") or f"wheel_{wid}"
        hub = w.get("hub")
        if hub is None or not lod.has_node(node_name):
            continue
        world_p = lod.world_pos(node_name)
        if world_p is None:
            continue
        checked += 1
        dist = math.dist(world_p, tuple(hub))
        if dist > SIDECAR_AGREEMENT_TOL:
            issues.append(f"wheel '{wid}': sidecar hub={hub} vs GLB world={tuple(round(c,4) for c in world_p)} "
                          f"dist={dist:.4f} (budget {SIDECAR_AGREEMENT_TOL})")
    if checked == 0:
        rep.info("sidecar.agreement", f"{base}: sidecar has no comparable anchor/wheel positions")
        return
    detail = f"{base}: {checked} sidecar positions agree with GLB world transforms" if not issues \
        else f"{base}: " + "; ".join(issues)
    rep.report("sidecar.agreement", not issues, detail)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

PER_LOD_RULES_NO_SIDECAR = [
    rule_nodes_required,
    rule_space_origin,
    rule_space_forward,
    rule_pivots_wheels,
    rule_pivots_hinges,
    rule_extras_parts,
    rule_colliders_present,
    rule_colliders_no_material,
    rule_colliders_shape,
    rule_colliders_fit,
    rule_materials_semantic,
    rule_materials_emissive,
    rule_uv_present,
    rule_uv_bounds,
    rule_uv_overlap,
    rule_morphs_present,
    rule_morphs_nonzero,
    rule_anchors,
]

PER_LOD_RULES_WITH_SIDECAR = [
    rule_mass_sum,
    rule_materials_paint_mask,
    rule_budget_triangles,
    rule_sidecar_agreement,
]


def validate_lods(rep, lod_specs, sidecar):
    """lod_specs: list of (path, lod_number). Returns True if everything passed."""
    parsed = []          # list of (path, LodAsset, None)
    parse_results = []   # list of (path, LodAsset_or_None, err_or_None)
    for path, lod_number in lod_specs:
        try:
            lod = LodAsset(path, lod_number)
            parsed.append(lod)
            parse_results.append((path, lod, None))
        except (GlbParseError, KeyError, struct.error, json.JSONDecodeError) as e:
            parse_results.append((path, None, str(e)))

    rule_glb_parse(rep, parse_results)

    for lod in parsed:
        for rule in PER_LOD_RULES_NO_SIDECAR:
            rule(rep, lod)
        for rule in PER_LOD_RULES_WITH_SIDECAR:
            rule(rep, lod, sidecar)

    rule_nodes_same_across_lods(rep, parsed)

    return rep.fail_count == 0


def resolve_lod_specs_from_sidecar(sidecar, sidecar_dir):
    specs = []
    for entry in sidecar.get("lods", []):
        lod_num = entry.get("lod")
        fname = entry.get("file")
        if fname is None:
            continue
        specs.append((os.path.join(sidecar_dir, fname), lod_num if lod_num is not None else len(specs)))
    return specs


def run_directory_mode(target_dir):
    sidecar_paths = sorted(
        os.path.join(target_dir, f) for f in os.listdir(target_dir) if f.endswith(".asset.json")
    )
    if not sidecar_paths:
        print(f"FAIL discovery no *.asset.json sidecar found in {target_dir}")
        return 1
    overall_ok = True
    for sidecar_path in sidecar_paths:
        print(f"=== {sidecar_path} ===")
        sidecar = json.load(open(sidecar_path))
        specs = resolve_lod_specs_from_sidecar(sidecar, os.path.dirname(sidecar_path))
        if not specs:
            print(f"FAIL discovery {sidecar_path}: sidecar lists no lods[]")
            overall_ok = False
            continue
        rep = Reporter()
        ok = validate_lods(rep, specs, sidecar)
        print(f"--- {os.path.basename(sidecar_path)}: {rep.pass_count} PASS, {rep.fail_count} FAIL ---")
        overall_ok = overall_ok and ok
    return 0 if overall_ok else 1


def run_single_file_mode(glb_path, sidecar_path):
    sidecar = json.load(open(sidecar_path)) if sidecar_path else {}
    rep = Reporter()
    ok = validate_lods(rep, [(glb_path, 0)], sidecar)
    print(f"--- {os.path.basename(glb_path)}: {rep.pass_count} PASS, {rep.fail_count} FAIL ---")
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("directory", nargs="?", help="directory containing *.asset.json + GLBs")
    ap.add_argument("--glb", help="single GLB file (with --sidecar)")
    ap.add_argument("--sidecar", help="single sidecar *.asset.json file")
    args = ap.parse_args(argv)

    if args.glb:
        return run_single_file_mode(args.glb, args.sidecar)
    if args.directory:
        return run_directory_mode(args.directory)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
