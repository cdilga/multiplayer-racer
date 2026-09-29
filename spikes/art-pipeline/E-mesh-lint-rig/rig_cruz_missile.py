"""Spike E task 2: add a real rig contract to the Cruz Missile.

The source build (../build_cruz_missile.py) gives wheels correct hub pivots already, but
doors/bonnet/boot are centred boxes -- their local origin sits at the panel's geometric
centre, not on a hinge line, so `rotation_euler` on them does not behave like a hinge (half
the panel would swing into the cabin). This script does NOT edit the original builder (per
the coordinator's file reservation); it opens the built .blend, relocates each hinged part's
origin onto its real-world hinge line with `origin_set(ORIGIN_CURSOR)` (world position is
preserved, only the local origin/mesh-local coords change), and writes rig-contract metadata
as custom properties so rig_check.py can drive + verify the joints generically.

Run:  blender -b -P rig_cruz_missile.py -- <src.blend> <out.blend> <out_contract.json>
"""
import bpy, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = argv[0] if len(argv) > 0 else "../out/cruz_missile.blend"
OUT_BLEND = argv[1] if len(argv) > 1 else "out/cruz_missile_rigged.blend"
OUT_CONTRACT = argv[2] if len(argv) > 2 else "out/cruz_missile.rig.contract.json"

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(SRC))
scene = bpy.context.scene


def world_bbox(o):
    mw = o.matrix_world
    corners = [mw @ Vector(c) for c in o.bound_box]
    xs = [c.x for c in corners]; ys = [c.y for c in corners]; zs = [c.z for c in corners]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def set_origin_to(o, world_point):
    for s in scene.objects:
        s.select_set(False)
    scene.cursor.location = world_point
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
    o.select_set(False)


contract = {"asset": "cruz-missile", "up": "+Z", "forward": "+Y", "joints": {}}
pivots_before_after = {}

# ---- hinged panels: pivot -> the real hinge line, not the panel's geometric centre
HINGES = [
    # name, edge ("min_y"/"max_y"), axis (local, unit), range_deg, notes
    ("door_L", "max_y", (0, 0, -1), (0, 70), "front-hinged, swings outward (-X)"),
    ("door_R", "max_y", (0, 0, 1), (0, 70), "front-hinged, swings outward (+X)"),
    ("bonnet", "min_y", (1, 0, 0), (0, 60), "rear-hinged at scuttle, nose lifts (+Z)"),
    ("boot", "max_y", (-1, 0, 0), (0, 60), "front-hinged at cabin edge, lid lifts (+Z)"),
]
for name, edge, axis, rng, note in HINGES:
    o = bpy.data.objects[name]
    lo, hi = world_bbox(o)
    before = o.matrix_world.translation.copy()
    if edge == "min_y":
        hinge_pt = Vector(((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2))
    else:
        hinge_pt = Vector(((lo.x + hi.x) / 2, hi.y, (lo.z + hi.z) / 2))
    set_origin_to(o, hinge_pt)
    bpy.context.view_layer.update()
    after = o.matrix_world.translation.copy()
    pivots_before_after[name] = {"before": list(before), "after_should_equal_hinge": list(hinge_pt),
                                  "after_actual": list(after)}
    o["jj_joint"] = "hinge"
    o["jj_axis"] = list(axis)
    o["jj_range_deg"] = list(rng)
    o["jj_body"] = "chassis,cabin"
    contract["joints"][name] = {"type": "hinge", "axis_local": list(axis), "range_deg": list(rng),
                                 "attach": "chassis", "body_meshes": ["chassis", "cabin"], "note": note}

# ---- wheels: hub pivot already correct in the source build (verified by mesh_lint pivot check)
for name in ("wheel_RL", "wheel_RR"):
    o = bpy.data.objects[name]
    o["jj_joint"] = "spin"
    o["jj_axis"] = [1, 0, 0]
    o["jj_range_deg"] = [0, 360]
    o["jj_body"] = "chassis,underside"
    contract["joints"][name] = {"type": "spin", "axis_local": [1, 0, 0], "range_deg": [0, 360], "attach": "chassis",
                                 "body_meshes": ["chassis", "underside"]}

for name in ("wheel_FL", "wheel_FR"):
    o = bpy.data.objects[name]
    o["jj_joint"] = "compound"  # steer (about hub, kingpin) composed with spin (about axle)
    o["jj_axis_steer"] = [0, 0, 1]
    o["jj_range_steer_deg"] = [-35, 35]
    o["jj_axis_spin"] = [1, 0, 0]
    o["jj_range_spin_deg"] = [0, 360]
    o["jj_body"] = "chassis,underside"
    contract["joints"][name] = {"type": "compound", "steer": {"axis_local": [0, 0, 1], "range_deg": [-35, 35]},
                                 "spin": {"axis_local": [1, 0, 0], "range_deg": [0, 360]}, "attach": "chassis",
                                 "body_meshes": ["chassis", "underside"]}

os.makedirs(os.path.dirname(os.path.abspath(OUT_BLEND)), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT_BLEND))
with open(OUT_CONTRACT, "w") as f:
    json.dump(contract, f, indent=2)
print("PIVOTS", json.dumps(pivots_before_after, indent=2))
print("SAVED", OUT_BLEND, OUT_CONTRACT)
