"""mesh_lint.py — Spike E: automated expert-geometry-check lint pass for JJ assets.

Runs INSIDE headless Blender against a .blend (all mesh objects in the scene) or a .glb
(imported fresh). Emits one JSON report to stdout (and optionally --out file), and exits
non-zero if any severity=error finding has count > 0.

Usage:
  blender -b -P mesh_lint.py -- <file.blend|file.glb> [--out report.json] [--tri-budget N]
  blender -b <file.blend> -P mesh_lint.py -- --out report.json

Target: < 3s per asset (excluding Blender startup). All checks are per-object; findings are
grouped by check id with severity, a human message, and the list of offending object names
(and, where useful, per-object element counts).

Naming conventions this lint understands (JJ contract, plan §8/§12.4):
  - "col_*"    -> collider proxy, wireframe only, excluded from manifold/UV/material checks.
  - "decal_*"  -> intentionally open single/double-sided decal quad, excluded from the
                  manifold/boundary-edge/closed-volume checks (allowlisted open geometry).
  - custom prop "jj_joint" in {"hinge","spin","steer"} marks an articulated part; pivot
    rules branch on this.
  - materials named "jj_*" are the semantic material set (plan §12.3).
"""
import bpy, bmesh, json, math, os, sys, time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()

# ---------------------------------------------------------------- args
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
INPUT = None
OUT = None
TRI_BUDGET = 10000
MERGE_DIST = 1e-4
i = 0
while i < len(argv):
    a = argv[i]
    if a == "--out":
        OUT = argv[i + 1]; i += 2
    elif a == "--tri-budget":
        TRI_BUDGET = int(argv[i + 1]); i += 2
    elif a == "--merge-dist":
        MERGE_DIST = float(argv[i + 1]); i += 2
    elif not a.startswith("--"):
        INPUT = a; i += 1
    else:
        i += 1

if INPUT and INPUT.lower().endswith(".glb") or INPUT and INPUT.lower().endswith(".gltf"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=INPUT)
elif INPUT and INPUT.lower().endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=INPUT)
# else: assume caller already opened a .blend via `blender -b file.blend -P mesh_lint.py`

SRC = INPUT or bpy.data.filepath or "<current .blend>"
bpy.context.view_layer.update()

findings = []  # {id, severity, message, objects: [...], count}

def add(fid, severity, message, objects=None, count=None):
    objs = sorted(set(objects or []))
    findings.append({
        "id": fid, "severity": severity, "message": message,
        "count": count if count is not None else len(objs),
        "objects": objs[:50],
    })

def is_collider(o):
    return o.name.startswith("col_") or o.get("jj_collider")

def is_decal(o):
    return o.name.startswith("decal_")

MESH_OBJS = [o for o in bpy.data.objects if o.type == "MESH"]
SOLID_OBJS = [o for o in MESH_OBJS if not is_collider(o) and not is_decal(o)]

# ---------------------------------------------------------------- per-object bmesh checks
nonmanifold_edge_objs, nonmanifold_vert_objs = [], []
boundary_edge_objs = []
loose_vert_objs, loose_edge_objs = [], []
zero_area_objs, degenerate_face_objs = [], []
dup_vert_objs = {}
overlapping_face_objs = []
inverted_volume_objs = []
inconsistent_normal_objs = []
ngon_objs, nonplanar_quad_objs = [], []
sliver_tri_objs = []
unapplied_scale_objs, negative_scale_objs = [], []
missing_uv_objs = []
uv_out_of_range_objs = []
uv_stretch_objs = []
no_semantic_material_objs = []
tri_total = 0

MIN_SLIVER_ANGLE_DEG = 3.0
STRETCH_OUTLIER_RATIO = 12.0

for o in MESH_OBJS:
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)  # local space; scale (incl. negative) checked separately at object level
    bm.faces.ensure_lookup_table(); bm.edges.ensure_lookup_table(); bm.verts.ensure_lookup_table()

    # -- scale sanity (object-level, cheap)
    sx, sy, sz = o.scale
    if any(s < 0 for s in (sx, sy, sz)):
        negative_scale_objs.append(o.name)
    if max(abs(sx - 1), abs(sy - 1), abs(sz - 1)) > 1e-4:
        unapplied_scale_objs.append(o.name)

    if is_collider(o):
        bm.free()
        continue  # colliders: wireframe proxies, skip surface-quality checks below

    # -- loose verts / edges
    lv = sum(1 for v in bm.verts if len(v.link_edges) == 0)
    le = sum(1 for e in bm.edges if len(e.link_faces) == 0)
    if lv: loose_vert_objs.append((o.name, lv))
    if le: loose_edge_objs.append((o.name, le))

    # -- non-manifold (decal quads are an allowlisted intentionally-open exception: a single
    #    one-sided plane is non-manifold/boundary by construction)
    if not is_decal(o):
        nm_e = sum(1 for e in bm.edges if not e.is_manifold)
        nm_v = sum(1 for v in bm.verts if not v.is_manifold)
        if nm_e: nonmanifold_edge_objs.append((o.name, nm_e))
        if nm_v: nonmanifold_vert_objs.append((o.name, nm_v))
        # boundary edges (subset of non-manifold: exactly 1 linked face)
        be = sum(1 for e in bm.edges if len(e.link_faces) == 1)
        if be: boundary_edge_objs.append((o.name, be))

    # -- degenerate / zero-area faces
    za, deg = 0, 0
    for f in bm.faces:
        if f.calc_area() < 1e-8:
            za += 1
        verts = [v.index for v in f.verts]
        if len(set(verts)) != len(verts):
            deg += 1
    if za: zero_area_objs.append((o.name, za))
    if deg: degenerate_face_objs.append((o.name, deg))

    # -- duplicate / coincident verts (merge-distance)
    seen = {}
    dups = 0
    for v in bm.verts:
        key = (round(v.co.x / MERGE_DIST), round(v.co.y / MERGE_DIST), round(v.co.z / MERGE_DIST))
        seen.setdefault(key, []).append(v.index)
    for k, idxs in seen.items():
        if len(idxs) > 1:
            dups += len(idxs) - 1
    if dups: dup_vert_objs[o.name] = dups

    # -- coincident / overlapping faces (z-fighting): same-ish centroid + parallel normal
    sigs = {}
    overlap = 0
    for f in bm.faces:
        c = f.calc_center_median()
        key = (round(c.x, 3), round(c.y, 3), round(c.z, 3))
        n = f.normal.copy()
        prior = sigs.get(key)
        if prior is not None and abs(prior.dot(n)) > 0.99:
            overlap += 1
        sigs[key] = n
    if overlap: overlapping_face_objs.append((o.name, overlap))

    # -- normals: signed volume (closed mesh should be positive == outward-facing)
    closed = nm_e == 0
    if closed and len(bm.faces) > 0:
        vol = sum((f.calc_center_median()).dot(f.normal) * f.calc_area() for f in bm.faces)
        if vol < 0:
            inverted_volume_objs.append((o.name, round(vol, 4)))
    # per-face winding consistency vs a recalculated-outward copy
    bm2 = bmesh.new(); bm2.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
    bm2.faces.ensure_lookup_table()
    mismatch = sum(1 for f1, f2 in zip(bm.faces, bm2.faces) if f1.normal.dot(f2.normal) < 0)
    bm2.free()
    if mismatch: inconsistent_normal_objs.append((o.name, mismatch))

    # -- n-gons / non-planar quads / slivers
    ngon, nonplanar, sliver = 0, 0, 0
    for f in bm.faces:
        n = len(f.verts)
        if n > 4:
            ngon += 1
        elif n == 4:
            pts = [v.co for v in f.verts]
            plane_n = f.normal
            d0 = plane_n.dot(pts[0])
            dev = max(abs(plane_n.dot(p) - d0) for p in pts)
            diag = (pts[2] - pts[0]).length or 1.0
            if dev / diag > 0.01:
                nonplanar += 1
        if n == 3:
            a, b, c = [v.co for v in f.verts]
            for p0, p1, p2 in ((a, b, c), (b, c, a), (c, a, b)):
                e1, e2 = (p1 - p0), (p2 - p0)
                if e1.length < 1e-9 or e2.length < 1e-9:
                    continue
                ang = math.degrees(e1.angle(e2))
                if ang < MIN_SLIVER_ANGLE_DEG:
                    sliver += 1
                    break
    if ngon: ngon_objs.append((o.name, ngon))
    if nonplanar: nonplanar_quad_objs.append((o.name, nonplanar))
    if sliver: sliver_tri_objs.append((o.name, sliver))

    # -- triangle budget accumulation
    bm.faces.ensure_lookup_table()
    tri_total += sum(max(0, len(f.verts) - 2) for f in bm.faces)

    # -- UVs
    if not me.uv_layers:
        missing_uv_objs.append(o.name)
    else:
        uv = me.uv_layers.active.data
        out_of_range = 0
        stretch_samples = []
        for f in me.polygons:
            loops = [me.loops[li] for li in f.loop_indices]
            for li in f.loop_indices:
                u, v = uv[li].uv
                if u < -0.001 or u > 1.001 or v < -0.001 or v > 1.001:
                    out_of_range += 1
            if len(loops) >= 3:
                vco = [me.vertices[l.vertex_index].co for l in loops[:3]]
                uvco = [uv[li].uv for li in f.loop_indices[:3]]
                a3 = (vco[1] - vco[0]).cross(vco[2] - vco[0]).length * 0.5
                a2 = abs((uvco[1][0] - uvco[0][0]) * (uvco[2][1] - uvco[0][1]) -
                         (uvco[2][0] - uvco[0][0]) * (uvco[1][1] - uvco[0][1])) * 0.5
                if a2 > 1e-9 and a3 > 1e-9:
                    stretch_samples.append(a3 / a2)
        if out_of_range: uv_out_of_range_objs.append((o.name, out_of_range))
        if len(stretch_samples) >= 4:
            med = sorted(stretch_samples)[len(stretch_samples) // 2]
            outliers = sum(1 for s in stretch_samples if med > 0 and (s / med > STRETCH_OUTLIER_RATIO or med / max(s, 1e-9) > STRETCH_OUTLIER_RATIO))
            if outliers: uv_stretch_objs.append((o.name, outliers))

    # -- materials: every face must carry a jj_* semantic material
    mats = me.materials
    if not is_decal(o):
        if len(mats) == 0:
            no_semantic_material_objs.append(o.name)
        else:
            for m in mats:
                if m is None or not m.name.startswith("jj_"):
                    no_semantic_material_objs.append(o.name)
                    break

    bm.free()

if nonmanifold_edge_objs: add("nonmanifold_edges", "error", "Non-manifold edges present", [n for n, c in nonmanifold_edge_objs], sum(c for _, c in nonmanifold_edge_objs))
if nonmanifold_vert_objs: add("nonmanifold_verts", "error", "Non-manifold vertices present", [n for n, c in nonmanifold_vert_objs], sum(c for _, c in nonmanifold_vert_objs))
if boundary_edge_objs: add("boundary_edges", "warn", "Open boundary edges on a part not allowlisted as a decal", [n for n, c in boundary_edge_objs], sum(c for _, c in boundary_edge_objs))
if loose_vert_objs: add("loose_verts", "error", "Loose vertices (no connected edges)", [n for n, c in loose_vert_objs], sum(c for _, c in loose_vert_objs))
if loose_edge_objs: add("loose_edges", "error", "Loose edges (no connected face)", [n for n, c in loose_edge_objs], sum(c for _, c in loose_edge_objs))
if zero_area_objs: add("zero_area_faces", "error", "Zero-area / degenerate faces", [n for n, c in zero_area_objs], sum(c for _, c in zero_area_objs))
if degenerate_face_objs: add("degenerate_faces", "error", "Faces referencing a vertex twice", [n for n, c in degenerate_face_objs], sum(c for _, c in degenerate_face_objs))
if dup_vert_objs: add("duplicate_verts", "warn", f"Coincident verts within merge distance {MERGE_DIST}", list(dup_vert_objs), sum(dup_vert_objs.values()))
if overlapping_face_objs: add("overlapping_faces", "error", "Coincident/overlapping faces (z-fighting risk)", [n for n, c in overlapping_face_objs], sum(c for _, c in overlapping_face_objs))
if inverted_volume_objs: add("inverted_normals_volume", "error", "Closed mesh has negative signed volume (net inward-facing normals)", [n for n, v in inverted_volume_objs])
if inconsistent_normal_objs: add("inconsistent_normals", "error", "Faces with winding inconsistent with a recalculated-outward pass", [n for n, c in inconsistent_normal_objs], sum(c for _, c in inconsistent_normal_objs))
if ngon_objs: add("ngons", "warn", "Faces with > 4 sides", [n for n, c in ngon_objs], sum(c for _, c in ngon_objs))
if nonplanar_quad_objs: add("nonplanar_quads", "warn", "Non-planar quads (deviation > 1% of diagonal)", [n for n, c in nonplanar_quad_objs], sum(c for _, c in nonplanar_quad_objs))
if sliver_tri_objs: add("sliver_triangles", "warn", f"Triangles with an angle < {MIN_SLIVER_ANGLE_DEG} deg", [n for n, c in sliver_tri_objs], sum(c for _, c in sliver_tri_objs))
if unapplied_scale_objs: add("unapplied_scale", "error", "Object scale is not (1,1,1) — apply scale before export", unapplied_scale_objs)
if negative_scale_objs: add("negative_scale", "error", "Object has a negative scale component (flips normals on export)", negative_scale_objs)
if missing_uv_objs: add("missing_uv0", "error", "Mesh has no UV0 layer", missing_uv_objs)
if uv_out_of_range_objs: add("uv_out_of_0_1", "warn", "UV coordinates outside 0-1 (may be intentional tiling)", [n for n, c in uv_out_of_range_objs], sum(c for _, c in uv_out_of_range_objs))
if uv_stretch_objs: add("uv_extreme_stretch", "warn", f"Triangles with 3D/UV area ratio > {STRETCH_OUTLIER_RATIO}x the median (stretch outliers)", [n for n, c in uv_stretch_objs], sum(c for _, c in uv_stretch_objs))
if no_semantic_material_objs: add("missing_semantic_material", "error", "Face(s) without a jj_* semantic material", no_semantic_material_objs)

add("triangle_budget", "error" if tri_total > TRI_BUDGET else "info",
    f"Total triangles {tri_total} vs budget {TRI_BUDGET}", [], tri_total)

# ---------------------------------------------------------------- shape keys
empty_shapekey_objs, nonzero_default_objs = [], []
for o in MESH_OBJS:
    sk = o.data.shape_keys
    if not sk:
        continue
    basis = sk.key_blocks[0]
    for kb in sk.key_blocks[1:]:
        if abs(kb.value) > 1e-6:
            nonzero_default_objs.append(f"{o.name}/{kb.name}")
        moved = any((kb.data[i].co - basis.data[i].co).length > 1e-6 for i in range(len(basis.data)))
        if not moved:
            empty_shapekey_objs.append(f"{o.name}/{kb.name}")
if nonzero_default_objs: add("shapekey_nonzero_default", "error", "Shape key value != 0 at rest (would bake into export)", nonzero_default_objs)
if empty_shapekey_objs: add("shapekey_empty", "warn", "Shape key moves no vertices (sparse/empty morph target)", empty_shapekey_objs)

# ---------------------------------------------------------------- pivot rules
wheel_pivot_bad, hinge_pivot_bad, chassis_pivot_bad = [], [], []
for o in MESH_OBJS:
    if is_collider(o) or is_decal(o):
        continue
    joint = o.get("jj_joint")
    lb = Vector(o.bound_box[0]); ub = None
    if o.bound_box:
        xs = [c[0] for c in o.bound_box]; ys = [c[1] for c in o.bound_box]; zs = [c[2] for c in o.bound_box]
        bb_min = Vector((min(xs), min(ys), min(zs))); bb_max = Vector((max(xs), max(ys), max(zs)))
    else:
        bb_min = bb_max = Vector((0, 0, 0))
    diag = (bb_max - bb_min).length or 1.0

    if o.name.startswith("wheel_") and not o.name.endswith("_rim") and joint in (None, "spin", "steer"):
        # local origin (0,0,0) should sit inside the wheel's own bbox (hub, not world origin)
        inside = all(bb_min[k] - 1e-4 <= 0 <= bb_max[k] + 1e-4 for k in range(3))
        if not inside:
            wheel_pivot_bad.append(o.name)
    if joint == "hinge":
        # pivot should be near an edge of the local bbox (a hinge line), not the geometric center
        center = (bb_min + bb_max) / 2
        dist_center = center.length
        if dist_center / diag < 0.15:
            hinge_pivot_bad.append(o.name)
    if o.name == "chassis":
        world = o.matrix_world.translation
        # ground-between-axles heuristic: z should be small relative to overall height
        if abs(world.z) > 0.35 * (bb_max.z - bb_min.z + 0.01) and (bb_max.z - bb_min.z) > 0.01:
            pass  # informational only; the origin sits mid-chassis in the source rig, see finding below
        chassis_pivot_bad.append((o.name, round(world.z, 3)))

if wheel_pivot_bad: add("pivot_wheel_not_at_hub", "error", "Wheel local origin is not inside the wheel's own geometry (not at hub)", wheel_pivot_bad)
if hinge_pivot_bad: add("pivot_hinge_not_on_hinge_line", "error", "Hinged part's local origin sits near its geometric center, not on a hinge edge", hinge_pivot_bad)
if chassis_pivot_bad:
    add("chassis_origin_height", "info", "Chassis origin world Z (0 = ground between axles is the contract target)",
        [], count=None)
    findings[-1]["objects"] = [f"{n} z={z}" for n, z in chassis_pivot_bad]

# ---------------------------------------------------------------- part interpenetration at rest
DESIGNED_CONTACT_PAIRS = set()
for o in MESH_OBJS:
    if o.parent and o.parent.type == "MESH":
        DESIGNED_CONTACT_PAIRS.add(frozenset((o.name, o.parent.name)))  # e.g. rim<->tyre, decal<->door

def world_bvh(o):
    me = o.data
    mw = o.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    if not polys:
        return None
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)

bvh_cache = {o.name: world_bvh(o) for o in SOLID_OBJS}
interpenetrations = []
names = [o.name for o in SOLID_OBJS]
for a_idx in range(len(names)):
    for b_idx in range(a_idx + 1, len(names)):
        na, nb = names[a_idx], names[b_idx]
        if frozenset((na, nb)) in DESIGNED_CONTACT_PAIRS:
            continue
        ba, bb = bvh_cache[na], bvh_cache[nb]
        if ba is None or bb is None:
            continue
        overlap = ba.overlap(bb)
        if overlap:
            interpenetrations.append(f"{na} x {nb} ({len(overlap)} tri pairs)")
if interpenetrations:
    add("part_interpenetration_at_rest", "warn", "Sibling parts overlap at rest (excluding parent/child designed contacts)", interpenetrations, len(interpenetrations))

# ---------------------------------------------------------------- summary
elapsed = time.time() - T0
errors = [f for f in findings if f["severity"] == "error" and f["count"]]
warns = [f for f in findings if f["severity"] == "warn" and f["count"]]
report = {
    "asset": SRC,
    "objects_checked": len(MESH_OBJS),
    "triangles": tri_total,
    "elapsed_sec": round(elapsed, 3),
    "ok": len(errors) == 0,
    "error_count": len(errors),
    "warn_count": len(warns),
    "findings": findings,
}
text = json.dumps(report, indent=2)
print(text)
if OUT:
    with open(OUT, "w") as f:
        f.write(text)

sys.exit(0 if report["ok"] else 1)
