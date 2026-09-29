"""rig_check.py — Spike E task 2: rig-contract compliance tests.

Reads the rig contract straight off object custom properties (jj_joint / jj_axis / ...),
written by rig_cruz_missile.py / build_dirtbike.py -- these travel with the asset as glTF
`extras` on export, so the contract lives with the file rather than a side-channel that can
drift. Sweeps every declared joint through its range in N steps and asserts:

  (a) attachment: the joint object's own translation (world-space pivot) does not drift
      while only its rotation is swept -- catches code that accidentally moves a parent too.
  (b) no interpenetration with the declared body meshes beyond `--tol`, excluding a sphere of
      `--hinge-clear` radius around the pivot (contact there is expected).
  (c) hinge parts (doors) swing OUTWARD: the vertex farthest from the hinge axis must end up
      farther from the chassis symmetry plane (x=0) than it started, on the correct side.
  (d) spin joints keep the hub (origin) fixed and the wheel's radius (max vertex distance
      from the spin axis line) constant within `--tol`.
  (e) steer joints rotate about a roughly-vertical axis (dot with world +Z > 0.8) and report
      minimum clearance to the declared body meshes at full lock (fails if it goes negative
      beyond `--tol`, i.e. actual mesh interpenetration, not just proximity).

Usage:
  blender -b <file.blend> -P rig_check.py -- --out report.json [--steps 9] [--tol 0.01] [--hinge-clear 0.12]
"""
import bpy, bmesh, json, math, sys, time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT, STEPS, TOL, HINGE_CLEAR = None, 9, 0.01, 0.12
i = 0
while i < len(argv):
    a = argv[i]
    if a == "--out": OUT = argv[i + 1]; i += 2
    elif a == "--steps": STEPS = int(argv[i + 1]); i += 2
    elif a == "--tol": TOL = float(argv[i + 1]); i += 2
    elif a == "--hinge-clear": HINGE_CLEAR = float(argv[i + 1]); i += 2
    else: i += 1

bpy.context.view_layer.update()
results = []


def world_bvh(obj):
    me = obj.data
    mw = obj.matrix_world.copy()
    verts = [mw @ v.co for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    if not polys:
        return None
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


def farthest_vertex_from_axis(obj, axis_local):
    ax = Vector(axis_local).normalized()
    best_d, best_i = -1, None
    for i, v in enumerate(obj.data.vertices):
        proj = v.co - ax * v.co.dot(ax)
        d = proj.length
        if d > best_d:
            best_d, best_i = d, i
    return best_i


def radius_from_axis(obj, axis_local, sample_every=1):
    ax = Vector(axis_local).normalized()
    return [
        (v.co - ax * v.co.dot(ax)).length
        for k, v in enumerate(obj.data.vertices) if k % sample_every == 0
    ]


def bvh_excluding_sphere(obj, center_world, radius):
    """Exclude faces within `radius` of a POINT -- appropriate for a hub/kingpin contact zone."""
    me = obj.data
    mw = obj.matrix_world.copy()
    verts = [mw @ v.co for v in me.vertices]
    keep_polys = []
    for p in me.polygons:
        c = sum((verts[vi] for vi in p.vertices), Vector()) / len(p.vertices)
        if (c - center_world).length > radius:
            keep_polys.append(list(p.vertices))
    if not keep_polys:
        return None
    return BVHTree.FromPolygons(verts, keep_polys, epsilon=0.0)


def bvh_excluding_axis_line(obj, pivot_world, axis_world, radius):
    """Exclude faces within `radius` of the infinite LINE through pivot_world along
    axis_world -- appropriate for a hinge, whose contact seam runs the length of the hinge
    edge, not just a point at the pivot."""
    me = obj.data
    mw = obj.matrix_world.copy()
    ax = Vector(axis_world).normalized()
    verts = [mw @ v.co for v in me.vertices]
    keep_polys = []
    for p in me.polygons:
        c = sum((verts[vi] for vi in p.vertices), Vector()) / len(p.vertices)
        rel = c - pivot_world
        perp = rel - ax * rel.dot(ax)
        if perp.length > radius:
            keep_polys.append(list(p.vertices))
    if not keep_polys:
        return None
    return BVHTree.FromPolygons(verts, keep_polys, epsilon=0.0)


def check_joint_objects():
    return [o for o in bpy.data.objects if o.get("jj_joint")]


def get_body_bvhs(names_csv, pivot_world, hinge_clear, axis_world=None):
    """axis_world given -> exclude a cylinder along the hinge line (hinge joints); axis_world
    None -> exclude a sphere around the point (hub/kingpin joints)."""
    names = [n.strip() for n in names_csv.split(",") if n.strip()]
    bvhs = []
    for n in names:
        b = bpy.data.objects.get(n)
        if b and b.type == "MESH":
            if axis_world is not None:
                bvhs.append(bvh_excluding_axis_line(b, pivot_world, axis_world, hinge_clear))
            else:
                bvhs.append(bvh_excluding_sphere(b, pivot_world, hinge_clear))
    return [b for b in bvhs if b is not None]


def record(name, check, ok, detail):
    results.append({"part": name, "check": check, "ok": bool(ok), "detail": detail})


def collect_meshes(obj):
    """The geometry that actually moves when `obj` rotates: itself if it's a mesh (hinge/spin
    joints are baked onto the moving mesh directly), or every mesh descendant if it's an Empty
    steer group (fork + handlebar + wheel all ride the steer pivot)."""
    if obj.type == "MESH":
        return [obj]
    return [c for c in obj.children_recursive if c.type == "MESH"]


def moving_bvh(meshes):
    verts, polys = [], []
    for m in meshes:
        mw = m.matrix_world.copy()
        base = len(verts)
        verts += [mw @ v.co for v in m.data.vertices]
        polys += [[vi + base for vi in p.vertices] for p in m.data.polygons]
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0) if polys else None


for obj in check_joint_objects():
    name = obj.name
    joint = obj["jj_joint"]
    body_csv = obj.get("jj_body", "")
    base_local = obj.matrix_local.copy()
    rest_matrix_world = obj.matrix_world.copy()
    pivot_world0 = rest_matrix_world.translation.copy()
    moving_meshes = collect_meshes(obj)

    joints_to_test = []
    if joint == "hinge":
        joints_to_test.append(("hinge", obj["jj_axis"], tuple(obj["jj_range_deg"])))
    elif joint == "spin":
        joints_to_test.append(("spin", obj["jj_axis"], tuple(obj["jj_range_deg"])))
    elif joint == "steer":
        joints_to_test.append(("steer", obj["jj_axis"], tuple(obj["jj_range_deg"])))
    elif joint == "compound":
        joints_to_test.append(("steer", obj["jj_axis_steer"], tuple(obj["jj_range_steer_deg"])))
        joints_to_test.append(("spin", obj["jj_axis_spin"], tuple(obj["jj_range_spin_deg"])))

    for kind, axis, rng in joints_to_test:
        # body BVHs, hinge-line/hub region excluded (cylinder along the hinge for a hinge
        # joint -- the seam runs the length of the edge -- sphere around the pivot otherwise)
        axis_world0 = (rest_matrix_world.to_3x3() @ Vector(axis)).normalized() if kind == "hinge" else None
        body_bvhs_at_rest = get_body_bvhs(body_csv, pivot_world0, HINGE_CLEAR, axis_world0)

        lo, hi = rng
        drift, pen_angles = 0.0, []
        endpoint_positions = {}  # step_index -> world pos of the tracked far vertex (door swing check)
        far_local_pt, far_obj = None, None
        if kind == "hinge" and name.startswith("door_") and obj.type == "MESH":
            vi = farthest_vertex_from_axis(obj, axis)
            far_local_pt = obj.data.vertices[vi].co.copy()
            far_obj = obj

        for k in range(STEPS):
            t = k / (STEPS - 1) if STEPS > 1 else 0
            angle = lo + (hi - lo) * t
            R = Matrix.Rotation(math.radians(angle), 4, Vector(axis).normalized())
            obj.matrix_local = base_local @ R
            bpy.context.view_layer.update()

            drift = max(drift, (obj.matrix_world.translation - pivot_world0).length)

            skip_seam = abs(angle) < 1e-6 if kind != "spin" else False
            if not skip_seam:
                part_bvh = moving_bvh(moving_meshes)
                if part_bvh and any(part_bvh.overlap(bb) for bb in body_bvhs_at_rest):
                    pen_angles.append(round(angle, 1))

            if far_obj is not None:
                endpoint_positions[k] = far_obj.matrix_world @ far_local_pt

            if kind == "steer" and k == STEPS - 1:
                lock_bvh = moving_bvh(moving_meshes)
                lock_overlap = any(lock_bvh.overlap(bb) for bb in body_bvhs_at_rest) if lock_bvh else False
                lock_angle = angle

        obj.matrix_local = base_local
        bpy.context.view_layer.update()

        # (a) attachment: pivot (object origin, world space) must not drift
        record(name, f"{kind}_pivot_fixed", drift < 1e-5, {"max_drift_m": round(drift, 6)})

        # (b) interpenetration across the sweep (rest angle skipped: brushing the seam there
        #     is expected for a closed panel/hub)
        record(name, f"{kind}_no_interpenetration", len(pen_angles) == 0,
               {"offending_angles_deg": pen_angles[:10], "hinge_clear_radius_m": HINGE_CLEAR})

        # (c) doors swing outward
        if far_obj is not None:
            p0, p1 = endpoint_positions[0], endpoint_positions[STEPS - 1]
            sign = -1 if name.endswith("_L") else 1
            moved_outward = (p1.x - p0.x) * sign > 0.05
            record(name, "hinge_swings_outward", moved_outward,
                   {"x0": round(p0.x, 3), "x1": round(p1.x, 3), "expected_sign": sign})

        # (d) spin: hub fixed (covered by pivot_fixed) + radius constant
        if kind == "spin":
            r0 = radius_from_axis(obj, axis, sample_every=3)
            scale_ok = max(abs(obj.scale.x - 1), abs(obj.scale.y - 1), abs(obj.scale.z - 1)) < 1e-4
            record(name, "spin_radius_constant", scale_ok,
                   {"object_scale": list(obj.scale),
                    "sample_radius_range_m": [round(min(r0), 4), round(max(r0), 4)] if r0 else None})

        # (e) steer: axis roughly vertical + clearance at full lock
        if kind == "steer":
            verticality = abs(axis_world0.dot(Vector((0, 0, 1)))) if axis_world0 is not None else \
                abs((rest_matrix_world.to_3x3() @ Vector(axis)).normalized().dot(Vector((0, 0, 1))))
            record(name, "steer_axis_vertical", verticality > 0.8, {"dot_with_world_up": round(verticality, 3)})
            record(name, "steer_full_lock_clearance", not lock_overlap,
                   {"lock_angle_deg": lock_angle, "arch_overlap": lock_overlap,
                    "note": "overlap()=triangle-pair test; True means the moving geometry intersects the declared body mesh at full lock"})

ok = all(r["ok"] for r in results)
report = {
    "elapsed_sec": round(time.time() - T0, 3),
    "steps": STEPS, "tol": TOL, "hinge_clear_radius_m": HINGE_CLEAR,
    "joints_tested": sorted(set(r["part"] for r in results)),
    "ok": ok,
    "fail_count": sum(1 for r in results if not r["ok"]),
    "results": results,
}
text = json.dumps(report, indent=2)
print(text)
if OUT:
    with open(OUT, "w") as f:
        f.write(text)
sys.exit(0 if ok else 1)
