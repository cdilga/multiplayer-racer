"""Spike A (textures & UVs) -- owner-decision comparison, "Simplified stylised" side: same car,
flat semantic colours + identity paint (tinted at runtime, like the Full variant) + vertex-colour AO
(baked straight to mesh vertex colors, no UV atlas or bake images at all) + one small decal texture
for a roof number. No normal map, no curvature map, no shared mask atlas, no UV1.

Run: blender -b -P build_simplified_car.py -- out
"""
import bpy, bmesh, json, math, os, sys, time

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
TIMINGS = {}


def lap(label):
    TIMINGS[label] = round(time.time() - T0, 2)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    m["jj_semantic"] = name
    return m


M = {
    "paint": mat("jj_paint", (0.85, 0.85, 0.85), 0.35),
    "tyre": mat("jj_tyre", (0.03, 0.03, 0.03), 0.9),
    "wheel": mat("jj_wheel", (0.05, 0.15, 0.7), 0.3, 0.6),
    "glass": mat("jj_glass", (0.2, 0.35, 0.45), 0.05),
    "plastic": mat("jj_plastic", (0.06, 0.06, 0.07), 0.7),
    "headlight": mat("jj_headlight", (1, 1, 0.9), 0.1, emit=(1, 0.95, 0.8)),
    "brakelight": mat("jj_brakelight", (0.8, 0.05, 0.05), 0.2, emit=(1, 0.05, 0.02)),
    "underside": mat("jj_underside", (0.1, 0.08, 0.07), 0.9),
}


def box(name, size, loc, material, bevel=0.06, segments=3, cuts=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = o.data.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if cuts:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
        bm.to_mesh(o.data); bm.free()
    if bevel:
        modb = o.modifiers.new("bevel", "BEVEL"); modb.width = bevel; modb.segments = segments
        modb.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="bevel")
    o.data.materials.append(material)
    return o


def set_parent(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    scene.collection.objects.link(e)
    if parent: set_parent(e, parent)
    return e


# ---------------------------------------------------------------- the car (same proportions as the Full variant)
chassis = box("chassis", (1.85, 3.6, 0.55), (0, 0, 0.72), M["paint"], bevel=0.14, segments=4, cuts=2)
under = box("underside", (1.7, 3.4, 0.12), (0, 0, 0.42), M["underside"], bevel=0.03); set_parent(under, chassis)
cabin = box("cabin", (1.55, 1.75, 0.5), (0, -0.2, 1.22), M["paint"], bevel=0.18, segments=4, cuts=2); set_parent(cabin, chassis)
glass = box("glass", (1.6, 1.5, 0.3), (0, -0.2, 1.18), M["glass"], bevel=0.12); set_parent(glass, chassis)
bonnet = box("bonnet", (1.7, 0.95, 0.1), (0, 1.2, 1.02), M["paint"], bevel=0.04, cuts=2); set_parent(bonnet, chassis)
boot = box("boot", (1.7, 0.6, 0.1), (0, -1.45, 1.02), M["paint"], bevel=0.04, cuts=2); set_parent(boot, chassis)
for side, x in (("L", -0.95), ("R", 0.95)):
    d = box(f"door_{side}", (0.08, 1.3, 0.5), (x, -0.15, 0.78), M["paint"], bevel=0.03, cuts=2)
    set_parent(d, chassis)
bf = box("bumper_front", (1.95, 0.3, 0.32), (0, 1.9, 0.58), M["plastic"], bevel=0.1, cuts=2); set_parent(bf, chassis)
br = box("bumper_rear", (1.95, 0.28, 0.3), (0, -1.9, 0.58), M["plastic"], bevel=0.1, cuts=2); set_parent(br, chassis)
for i, x in enumerate((-0.6, 0.6)):
    h = box(f"light_head_{i}", (0.4, 0.06, 0.16), (x, 2.04, 0.72), M["headlight"], bevel=0.02); set_parent(h, chassis)
    b = box(f"light_brake_{i}", (0.4, 0.06, 0.14), (x, -2.03, 0.78), M["brakelight"], bevel=0.02); set_parent(b, chassis)

WHEELS = {"wheel_FL": (-0.98, 1.2), "wheel_FR": (0.98, 1.2), "wheel_RL": (-0.98, -1.25), "wheel_RR": (0.98, -1.25)}
for name, (x, y) in WHEELS.items():
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.48, depth=0.42, location=(x, y, 0.48), rotation=(0, math.pi / 2, 0))
    t = bpy.context.active_object; t.name = t.data.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    modb = t.modifiers.new("bevel", "BEVEL"); modb.width = 0.08; modb.segments = 2
    bpy.ops.object.modifier_apply(modifier="bevel")
    t.data.materials.append(M["tyre"])
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.3, depth=0.44, location=(x, y, 0.48), rotation=(0, math.pi / 2, 0))
    r = bpy.context.active_object; r.name = r.data.name = f"{name}_rim"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    r.data.materials.append(M["wheel"]); set_parent(r, t)
    set_parent(t, chassis)

empty("cam_fp", (0, 0.35, 1.35), chassis)
empty("cam_tp_target", (0, 0.2, 1.0), chassis)
empty("com", (0, 0.05, 0.55), chassis)
roof_number = empty("roof_number", (0, -0.2, 1.48), chassis)

lap("build_geometry")

# ---------------------------------------------------------------- vertex-colour AO (Cycles CPU) --
# no UV atlas at all for paint parts: identity tint happens per-vertex at runtime (paintColor * AO).
PAINT_PARTS = ["chassis", "cabin", "bonnet", "boot", "door_L", "door_R"]
paint_objs = [bpy.data.objects[n] for n in PAINT_PARTS]
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.device = "CPU"
t_bake0 = time.time()
for o in paint_objs:
    if "Col" not in o.data.color_attributes:
        o.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    o.data.color_attributes.active_color = o.data.color_attributes["Col"]
    for s in scene.objects: s.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
TIMINGS["bake_ao_vertex_colors"] = round(time.time() - t_bake0, 2)
lap("bakes")

# ---------------------------------------------------------------- one small decal: a roof number badge
# (a single small texture, not a shared atlas -- exactly the "one small decal atlas for numbers/livery"
# the comparison calls for).
NUM_RES = 128
num_img = bpy.data.images.new("roof_number_badge", NUM_RES, NUM_RES, alpha=True)
px = [0.0] * (NUM_RES * NUM_RES * 4)
cx, cy, r = NUM_RES / 2, NUM_RES / 2, NUM_RES * 0.46
for y in range(NUM_RES):
    for x in range(NUM_RES):
        i = (y * NUM_RES + x) * 4
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
        if d < r:
            px[i:i + 4] = [1.0, 1.0, 1.0, 1.0]
num_img.pixels[:] = px
num_img.filepath_raw = os.path.join(OUT, "roof_number_badge.png")
num_img.file_format = "PNG"
num_img.save()

badge_mat = bpy.data.materials.new("jj_decal")
badge_mat.use_nodes = True
badge_mat.blend_method = "BLEND"
bsdf = badge_mat.node_tree.nodes["Principled BSDF"]
tex = badge_mat.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = num_img
badge_mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
badge_mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
badge_mat["jj_semantic"] = "jj_decal"

bpy.ops.mesh.primitive_plane_add(size=0.9, location=(0, -0.2, 1.5), rotation=(0, 0, 0))
badge = bpy.context.active_object; badge.name = badge.data.name = "decal_roof_number"
badge.data.materials.append(badge_mat)
set_parent(badge, chassis)

# ---------------------------------------------------------------- export
glb = os.path.join(OUT, "cruz_missile_simplified.glb")
for s in scene.objects: s.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True,
                          export_apply=False, use_selection=False)
lap("export")

tri = 0
for o in scene.objects:
    if o.type == "MESH":
        o.data.calc_loop_triangles(); tri += len(o.data.loop_triangles)

sidecar = {
    "contract": "jj.vehicle.v0-spike.textures-uv.simplified",
    "id": "cruz-missile-simplified",
    "display_name": "Cruz Missile (simplified stylised)",
    "approach": "flat semantic colours + identity paint tint + vertex-colour AO + one small decal texture; no UV atlas, no bake images, no normal/curvature maps",
    "materials": sorted(m.name for m in bpy.data.materials),
    "triangles_total": tri,
    "textures": ["roof_number_badge.png"],
    "timings_s": TIMINGS,
    "provenance": {"blender": bpy.app.version_string, "script": "spikes/art-pipeline/A-textures-uv/build_simplified_car.py"},
}
with open(os.path.join(OUT, "cruz_missile_simplified.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)
print("EXPORTED", glb, "tris", tri, "timings", TIMINGS)
