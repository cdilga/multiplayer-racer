"""Spike E: minimal low-poly "Dirt Zed" dirt bike, built headless, with a rig contract baked
in as custom properties (same jj_joint / jj_axis convention as rig_cruz_missile.py).

Proves the rig contract generalizes to a 2-wheeled steer group whose kingpin (head-tube) axis
is NOT a cardinal direction (it carries a real-world rake angle), and to a vehicle with no
hinged body panels at all -- only spin + steer joints.

Run:  blender -b -P build_dirtbike.py -- <out_dir>
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

RAKE_DEG = 25.0  # head-tube angle from vertical, tilted toward the rear (+Y is forward)
RAKE = math.radians(RAKE_DEG)
HEAD_AXIS_LOCAL = (0.0, math.sin(RAKE), math.cos(RAKE))  # deliberately NOT a cardinal axis

WHEEL_R = 0.33
WHEELBASE = 1.30
AXLE_Z = WHEEL_R


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


M = {
    "frame": mat("jj_metal", (0.75, 0.1, 0.08), 0.35, 0.7),
    "plastic": mat("jj_plastic", (0.08, 0.08, 0.09), 0.6),
    "tyre": mat("jj_tyre", (0.03, 0.03, 0.03), 0.9),
    "wheel": mat("jj_wheel", (0.7, 0.7, 0.72), 0.3, 0.6),
    "seat": mat("jj_seat", (0.05, 0.05, 0.05), 0.7),
}


def set_parent(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = o.data.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL"); mod.width = bevel; mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="bevel")
    o.data.materials.append(material)
    return o


def wheel(name, loc, material_tyre, material_rim, radius=WHEEL_R, width=0.14):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=radius, depth=width, location=loc,
                                         rotation=(0, math.pi / 2, 0))
    t = bpy.context.active_object; t.name = t.data.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mod = t.modifiers.new("bevel", "BEVEL"); mod.width = 0.03; mod.segments = 2
    bpy.ops.object.modifier_apply(modifier="bevel")
    t.data.materials.append(material_tyre)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius * 0.55, depth=width * 1.05, location=loc,
                                         rotation=(0, math.pi / 2, 0))
    r = bpy.context.active_object; r.name = r.data.name = f"{name}_rim"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    r.data.materials.append(material_rim)
    set_parent(r, t)
    return t


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    scene.collection.objects.link(e)
    if parent: set_parent(e, parent)
    return e


def uv_unwrap(o):
    bpy.context.view_layer.objects.active = o
    for s in scene.objects: s.select_set(False)
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- frame (root)
frame = box("frame", (0.10, WHEELBASE * 0.62, 0.16), (0, 0.05, 0.62), M["frame"], bevel=0.03)
tank = box("tank", (0.28, 0.42, 0.26), (0, 0.28, 0.86), M["plastic"], bevel=0.05); set_parent(tank, frame)
seat = box("seat", (0.26, 0.55, 0.10), (0, -0.28, 0.92), M["seat"], bevel=0.03); set_parent(seat, frame)
downtube = box("downtube", (0.07, 0.10, 0.55), (0, 0.35, 0.35), M["frame"], rot=(math.radians(18), 0, 0), bevel=0.02)
set_parent(downtube, frame)

# ---------------------------------------------------------------- rear: swingarm + wheel (spin only)
rear_axle = Vector((0, -WHEELBASE / 2, AXLE_Z))
pivot_rear = Vector((0, 0.0, 0.55))
swing_len = (rear_axle - pivot_rear).length
swing_mid = (rear_axle + pivot_rear) / 2
swing_dir = (rear_axle - pivot_rear).normalized()
swing_rot_x = math.atan2(-(rear_axle.z - pivot_rear.z), -(rear_axle.y - pivot_rear.y)) + math.pi / 2
swingarm = box("swingarm", (0.05, swing_len, 0.05), tuple(swing_mid), M["frame"],
               rot=(swing_rot_x, 0, 0), bevel=0.015)
set_parent(swingarm, frame)

wheel_rear = wheel("wheel_rear", tuple(rear_axle), M["tyre"], M["wheel"])
set_parent(wheel_rear, frame)
wheel_rear["jj_joint"] = "spin"
wheel_rear["jj_axis"] = [1, 0, 0]
wheel_rear["jj_range_deg"] = [0, 360]
wheel_rear["jj_body"] = "frame,swingarm"

# ---------------------------------------------------------------- front: steer group (fork+bars+wheel)
front_axle = Vector((0, WHEELBASE / 2, AXLE_Z))
head_axis_w = Vector(HEAD_AXIS_LOCAL).normalized()
# Steer pivot: any point on the head-tube axis line is mathematically valid for a pure
# rotation about that axis; pick the front axle itself so the pivot sits at the wheel it
# drives (matches how the "steer group" reads visually and keeps the fork geometry simple).
steer_pivot = front_axle.copy()

steer_front = empty("steer_front", tuple(steer_pivot), frame)
steer_front["jj_joint"] = "steer"
steer_front["jj_axis"] = list(head_axis_w)  # deliberately non-cardinal (rake angle)
steer_front["jj_range_deg"] = [-40, 40]
steer_front["jj_body"] = "frame,downtube"

# fork legs: two thin cylinders running from the axle UP along head_axis_w toward the head tube
fork_top = steer_pivot + head_axis_w * 0.55
for side, dx in (("L", -0.09), ("R", 0.09)):
    mid = (fork_top + steer_pivot) / 2 + Vector((dx, 0, 0))
    leg = box(f"fork_{side}", (0.03, 0.03, 0.58), tuple(mid), M["frame"],
              rot=(-RAKE, 0, 0), bevel=0.01)
    set_parent(leg, steer_front)

handlebar = box("handlebar", (0.55, 0.04, 0.04), tuple(fork_top + Vector((0, 0, 0.05))), M["frame"], bevel=0.015)
set_parent(handlebar, steer_front)

wheel_front = wheel("wheel_front", tuple(front_axle), M["tyre"], M["wheel"])
set_parent(wheel_front, steer_front)
wheel_front["jj_joint"] = "spin"
wheel_front["jj_axis"] = [1, 0, 0]
wheel_front["jj_range_deg"] = [0, 360]
wheel_front["jj_body"] = "frame,downtube"

# fender (decorative, rides with the steer group -- also exercises interpenetration-at-lock check)
fender = box("fender_front", (0.22, 0.32, 0.05), tuple(front_axle + Vector((0, -0.05, WHEEL_R + 0.10))),
             M["plastic"], bevel=0.02)
set_parent(fender, steer_front)

# ---------------------------------------------------------------- UVs for all solid meshes
for o in [o for o in scene.objects if o.type == "MESH"]:
    uv_unwrap(o)

# ---------------------------------------------------------------- export
glb = os.path.join(OUT, "dirtbike.glb")
for s in scene.objects: s.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True, use_selection=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "dirtbike.blend"))

contract = {
    "asset": "dirt-zed", "up": "+Z", "forward": "+Y",
    "joints": {
        "wheel_rear": {"type": "spin", "axis_local": [1, 0, 0], "range_deg": [0, 360], "attach": "frame"},
        "steer_front": {"type": "steer", "axis_local": list(head_axis_w), "range_deg": [-40, 40],
                         "attach": "frame", "note": f"head-tube rake {RAKE_DEG} deg from vertical"},
        "wheel_front": {"type": "spin", "axis_local": [1, 0, 0], "range_deg": [0, 360], "attach": "steer_front",
                         "note": "spins inside the steer group; composes with steer_front's rotation"},
    },
}
with open(os.path.join(OUT, "dirtbike.rig.contract.json"), "w") as f:
    json.dump(contract, f, indent=2)
print("EXPORTED", glb)
