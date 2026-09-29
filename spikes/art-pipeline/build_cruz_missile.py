"""Art-pipeline spike: build the "Cruz Missile" greybox car headlessly to the draft 0.2 contract.

Run:  blender -b -P build_cruz_missile.py -- <out_dir>

Proves: scripted modelling, named parts per contract (plan §8.1/§12.4), collider proxies, per-part
dent shape keys (R68 deformation), semantic materials, UVs, decals from an imagegen sheet, AO baked to
vertex colours, glTF export with part metadata as extras, and a JSON sidecar.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- materials (semantic names)
def mat(name, color, rough=0.5, metal=0.0, emit=None, image=None, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            m.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    m["jj_semantic"] = name
    return m

M = {
    "paint": mat("jj_paint", (1.0, 0.72, 0.05), 0.35),
    "tyre": mat("jj_tyre", (0.03, 0.03, 0.03), 0.9),
    "wheel": mat("jj_wheel", (0.05, 0.15, 0.7), 0.3, 0.6),
    "glass": mat("jj_glass", (0.2, 0.35, 0.45), 0.05),
    "plastic": mat("jj_plastic", (0.06, 0.06, 0.07), 0.7),
    "metal": mat("jj_metal", (0.6, 0.6, 0.62), 0.25, 1.0),
    "headlight": mat("jj_headlight", (1, 1, 0.9), 0.1, emit=(1, 0.95, 0.8)),
    "brakelight": mat("jj_brakelight", (0.8, 0.05, 0.05), 0.2, emit=(1, 0.05, 0.02)),
    "decal": mat("jj_decal", (1, 1, 1), 0.4, image=os.path.join(HERE, "textures", "decal_sheet.png"), alpha=True),
    "underside": mat("jj_underside", (0.1, 0.08, 0.07), 0.9),
    "lplate": mat("jj_lplate", (1, 0.85, 0.0), 0.5),
}

# ---------------------------------------------------------------- helpers
PARTS = {}  # name -> metadata (becomes glTF extras + sidecar)

def box(name, size, loc, material, bevel=0.06, segments=3, cuts=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = o.data.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if cuts:  # interior verts for dentable panels, BEFORE bevel (angle-limited bevel skips flat edges)
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
        bm.to_mesh(o.data); bm.free()
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL"); mod.width = bevel; mod.segments = segments
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="bevel")
    o.data.materials.append(material)
    return o

def part(o, kind, hp, attach, mass_frac, protects=None, hinge=None, dent=True):
    meta = {"kind": kind, "hp": hp, "attach": attach, "mass_fraction": mass_frac}
    if protects: meta["protects_zone"] = protects
    if hinge: meta["hinge_axis"] = hinge
    for k, v in meta.items():
        o[f"jj_{k}"] = v
    if dent:
        add_dent(o)
    PARTS[o.name] = meta
    return o

CAR_CENTRE = Vector((0, 0, 0.72))

def add_dent(o, depth=0.22):
    """R68: a localized crumple shape key per part: push the outer face inward around an impact point."""
    # Dentable panels need interior vertices (finding: bevelled boxes only have corner verts).
    o.shape_key_add(name="Basis")
    key = o.shape_key_add(name=f"{o.name}_dent")
    key.value = 0.0  # spike finding: Blender 5 creates new keys at 1.0
    rel = o.location - CAR_CENTRE
    outward = rel.normalized() if rel.length > 0.3 else Vector((0, 1, 0))  # chassis: front crumple
    # pick the dominant axis so the dent lands on a real face
    ax = max(range(3), key=lambda k: abs(outward[k]))
    outward = Vector([0, 0, 0]); outward[ax] = 1 if rel[ax] >= 0 or rel.length <= 0.3 else -1
    extent = max(v.co.dot(outward) for v in o.data.vertices)
    impact = outward * extent
    radius = max(o.dimensions) * 0.35
    for i, v in enumerate(o.data.vertices):
        d = (v.co - impact).length
        if d < radius:
            falloff = (1 - d / radius) ** 1.5
            key.data[i].co = v.co - outward * depth * falloff

def collider(name, size, loc, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    c = bpy.context.active_object
    c.name = c.data.name = name
    c.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    c["jj_collider"] = True
    c.display_type = "WIRE"
    c.hide_render = True
    set_parent(c, parent)
    return c

def set_parent(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()

def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    scene.collection.objects.link(e)
    if parent: set_parent(e, parent)
    return e

def decal_quad(name, parent, loc, rot, size, uv_rect):
    """Quad using a region of the decal sheet (u0,v0,u1,v1)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    q = bpy.context.active_object
    q.name = q.data.name = name
    q.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    u0, v0, u1, v1 = uv_rect
    uv = q.data.uv_layers.active.data
    for loop in q.data.loops:
        co = q.data.vertices[loop.vertex_index].co
        uv[loop.index].uv = (u0 if co.x < 0 else u1, v0 if co.y < 0 else v1)
    q.data.materials.append(M["decal"])
    set_parent(q, parent)
    return q

# ---------------------------------------------------------------- the car (units: metres, +Y forward, Z up)
# Chunky toy proportions: short overhangs, big wheels, stubby body.
chassis = box("chassis", (1.85, 3.6, 0.55), (0, 0, 0.72), M["paint"], bevel=0.14, segments=4, cuts=4)
part(chassis, "chassis", 400, "core", 0.55, dent=True)
under = box("underside", (1.7, 3.4, 0.12), (0, 0, 0.42), M["underside"], bevel=0.03); set_parent(under, chassis)

cabin = box("cabin", (1.55, 1.75, 0.5), (0, -0.2, 1.22), M["paint"], bevel=0.18, segments=4, cuts=4)
part(cabin, "roof", 150, "fixed", 0.08, protects="roof"); set_parent(cabin, chassis)
glass = box("glass", (1.6, 1.5, 0.3), (0, -0.2, 1.18), M["glass"], bevel=0.12)
part(glass, "glass", 20, "shatter", 0.01, dent=False); set_parent(glass, chassis)

bonnet = box("bonnet", (1.7, 0.95, 0.1), (0, 1.2, 1.02), M["paint"], bevel=0.04, cuts=4)
part(bonnet, "bonnet", 60, "hinged", 0.03, protects="front", hinge=[1, 0, 0]); set_parent(bonnet, chassis)
boot = box("boot", (1.7, 0.6, 0.1), (0, -1.45, 1.02), M["paint"], bevel=0.04, cuts=4)
part(boot, "boot", 50, "hinged", 0.02, protects="rear", hinge=[1, 0, 0]); set_parent(boot, chassis)

for side, x in (("L", -0.95), ("R", 0.95)):
    d = box(f"door_{side}", (0.08, 1.3, 0.5), (x, -0.15, 0.78), M["paint"], bevel=0.03, cuts=4)
    part(d, "door", 70, "hinged", 0.03, protects=f"side_{side}", hinge=[0, 0, 1]); set_parent(d, chassis)
    # decal: CRUZ MISSILE wordmark from the top-left of the sheet, on the door
    sgn = -1 if side == "L" else 1
    decal_quad(f"decal_word_{side}", d, (x + sgn * 0.045, -0.15, 0.8), (math.pi / 2, 0, sgn * math.pi / 2),
               (1.2, 0.45), (0.02, 0.62, 0.72, 0.98))

bf = box("bumper_front", (1.95, 0.3, 0.32), (0, 1.9, 0.58), M["plastic"], bevel=0.1, cuts=4)
part(bf, "bumper", 90, "detachable", 0.03, protects="front"); set_parent(bf, chassis)
br = box("bumper_rear", (1.95, 0.28, 0.3), (0, -1.9, 0.58), M["plastic"], bevel=0.1, cuts=4)
part(br, "bumper", 80, "detachable", 0.03, protects="rear"); set_parent(br, chassis)
spoiler = box("spoiler", (1.6, 0.25, 0.06), (0, -1.6, 1.28), M["plastic"], bevel=0.02)
for sx in (-0.55, 0.55):
    st = box(f"spoiler_strut_{sx:+.0f}", (0.06, 0.08, 0.22), (sx, -1.6, 1.16), M["plastic"], bevel=0.01)
    set_parent(st, spoiler)
part(spoiler, "spoiler", 25, "detachable", 0.01, dent=False); set_parent(spoiler, chassis)
for i, x in enumerate((-0.6, 0.6)):
    h = box(f"light_head_{i}", (0.4, 0.06, 0.16), (x, 2.04, 0.72), M["headlight"], bevel=0.02); set_parent(h, chassis)
    b = box(f"light_brake_{i}", (0.4, 0.06, 0.14), (x, -2.03, 0.78), M["brakelight"], bevel=0.02); set_parent(b, chassis)

# Big wheels (tyre + rim), pivots at hubs.
WHEELS = {"wheel_FL": (-0.98, 1.2), "wheel_FR": (0.98, 1.2), "wheel_RL": (-0.98, -1.25), "wheel_RR": (0.98, -1.25)}
for name, (x, y) in WHEELS.items():
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.48, depth=0.42, location=(x, y, 0.48), rotation=(0, math.pi / 2, 0))
    t = bpy.context.active_object; t.name = t.data.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mod = t.modifiers.new("bevel", "BEVEL"); mod.width = 0.08; mod.segments = 2
    bpy.ops.object.modifier_apply(modifier="bevel")
    t.data.materials.append(M["tyre"])
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.3, depth=0.44, location=(x, y, 0.48), rotation=(0, math.pi / 2, 0))
    r = bpy.context.active_object; r.name = r.data.name = f"{name}_rim"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    r.data.materials.append(M["wheel"]); set_parent(r, t)
    part(t, "wheel", 120, "detachable", 0.025, dent=False)
    set_parent(t, chassis)

# L-plate mounts (R64), camera and physics markers, exhaust.
empty("lplate_front", (0, 2.06, 0.6), chassis)
empty("lplate_rear", (0, -2.06, 0.62), chassis)
empty("cam_fp", (0, 0.35, 1.35), chassis)
empty("cam_tp_target", (0, 0.2, 1.0), chassis)
empty("com", (0, 0.05, 0.55), chassis)
empty("exhaust_0", (0.55, -2.05, 0.45), chassis)
empty("roof_number", (0, -0.2, 1.48), chassis)

# Collider proxies (never the render mesh).
collider("col_chassis", (1.85, 4.0, 0.7), (0, 0, 0.75), chassis)
collider("col_cabin_round", (1.5, 1.7, 0.45), (0, -0.2, 1.25), chassis)  # rounded cabin => rolls back (plan §7.3)

# ---------------------------------------------------------------- UVs for all meshes
for o in [o for o in scene.objects if o.type == "MESH" and not o.name.startswith(("decal_", "col_"))]:
    bpy.context.view_layer.objects.active = o
    for s in scene.objects: s.select_set(False)
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- bake AO to vertex colours (Cycles, CPU)
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.device = "CPU"
baked = []
for o in [o for o in scene.objects if o.type == "MESH" and not o.name.startswith(("decal_", "col_"))]:
    if o.data.shape_keys:  # bake on basis; shape keys are kept
        pass
    if "jj_ao" not in o.data.color_attributes:
        o.data.color_attributes.new("jj_ao", "BYTE_COLOR", "CORNER")
    o.data.color_attributes.active_color = o.data.color_attributes["jj_ao"]
    for s in scene.objects: s.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        baked.append(o.name)
    except Exception as e:  # recorded in the sidecar; the spike reports it
        PARTS.setdefault("_bake_errors", {})[o.name] = str(e)

# ---------------------------------------------------------------- export
glb = os.path.join(OUT, "cruz_missile.glb")
for s in scene.objects: s.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True, export_morph=True,
                          export_apply=False, use_selection=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "cruz_missile.blend"))

tri = 0
for o in scene.objects:
    if o.type == "MESH" and not o.name.startswith("col_"):
        o.data.calc_loop_triangles(); tri += len(o.data.loop_triangles)

sidecar = {
    "contract": "jj.vehicle.v0-spike",
    "id": "cruz-missile",
    "display_name": "Cruz Missile",
    "units": "m", "forward": "+Y", "up": "+Z",
    "archetype": "baseline",
    "parts": {k: v for k, v in PARTS.items() if not k.startswith("_")},
    "markers": ["lplate_front", "lplate_rear", "cam_fp", "cam_tp_target", "com", "exhaust_0", "roof_number"],
    "colliders": ["col_chassis", "col_cabin_round"],
    "materials": sorted(m.name for m in bpy.data.materials),
    "triangles_lod0": tri,
    "ao_baked": baked,
    "bake_errors": PARTS.get("_bake_errors", {}),
    "textures": ["textures/decal_sheet.png"],
    "provenance": {"blender": bpy.app.version_string, "script": "spikes/art-pipeline/build_cruz_missile.py",
                   "decal_source": "codex image_generation 2026-09-29"},
}
with open(os.path.join(OUT, "cruz_missile.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)
print("EXPORTED", glb, "tris", tri, "baked", len(baked))
