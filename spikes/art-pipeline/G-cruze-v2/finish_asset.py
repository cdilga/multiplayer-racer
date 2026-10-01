"""Finish one LOD of the Cruz Missile v2 into a contract asset (see ASSET-CONTRACT.md).

Semantic materials, part extras (mass, joints in glTF space, colliders, detachability), localised
dent morphs, a shared UV0 atlas (+UV1 copy), a baked RGBA mask (R paint, G pattern, B dirt, A emissive)
wired into jj_paint, GLB export, and a per-LOD meta file that write_sidecar.py merges.

Run:  blender -b -P finish_asset.py -- --lod N [--src out/cruze_v2.lodN.blend] [--dst ../../../art/vehicles/cruz-missile]
"""
import bpy, bmesh, json, math, os, struct, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
LOD = int(arg("--lod", "1"))
SRC = os.path.abspath(arg("--src", os.path.join(HERE, "out", f"cruze_v2.lod{LOD}.blend")))
DST = os.path.abspath(arg("--dst", os.path.join(HERE, "..", "..", "..", "art", "vehicles", "cruz-missile")))
MASK_PX = {0: 1024, 1: 512, 2: 256}[LOD]
os.makedirs(os.path.join(DST, ".build"), exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
coll = bpy.data.collections["CruzMissileV2"]
OBJ = {o.name: o for o in coll.objects}
VISUAL = [o for o in coll.objects if o.type == "MESH" and not o.name.startswith("col_")]
COLLIDERS = [o for o in coll.objects if o.type == "MESH" and o.name.startswith("col_")]
EMPTIES = [o for o in coll.objects if o.type == "EMPTY"]


def gl(v):
    """Blender (+Z up, +Y forward) -> glTF (+Y up, -Z forward)."""
    return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]


# ------------------------------------------------------------------ 1. semantic materials
SEMANTIC = {"jj_indicator": "indicator", "jj_brakelight_lens": "brakelight", "jj_spring": "accent"}
for m in bpy.data.materials:
    if not m.name.startswith("jj_"):
        continue
    sem = SEMANTIC.get(m.name, m.name[3:])
    if m.name == "jj_spring":
        m.name = "jj_accent_spring"
    m["jj_semantic"] = sem

# ------------------------------------------------------------------ 2. part metadata
MASS_KG = 1250.0
FRACTIONS = {
    "bonnet": 0.040, "boot": 0.030, "door_L": 0.025, "door_R": 0.025, "door_rear_L": 0.022, "door_rear_R": 0.022,
    "bumper_front": 0.030, "bumper_rear": 0.025, "glass": 0.020,
    "wheel_FL": 0.030, "wheel_FR": 0.030, "wheel_RL": 0.030, "wheel_RR": 0.030,
    "light_head_L": 0.004, "light_head_R": 0.004, "light_brake_L": 0.004, "light_brake_R": 0.004,
    "mirror_L": 0.003, "mirror_R": 0.003, "susp_FL": 0.010, "susp_FR": 0.010, "susp_RL": 0.010, "susp_RR": 0.010,
}
FRACTIONS["chassis"] = round(1.0 - sum(FRACTIONS.values()), 6)
TRIMS = {"bumper_front_trim": "bumper_front", "boot_trim": "boot"}
DETACHABLE = {"bonnet", "boot", "door_L", "door_R", "door_rear_L", "door_rear_R", "bumper_front", "bumper_rear",
              "wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR", "mirror_L", "mirror_R", "light_head_L",
              "light_head_R", "light_brake_L", "light_brake_R"}
DENTABLE = ["chassis", "bonnet", "boot", "door_L", "door_R", "door_rear_L", "door_rear_R", "bumper_front", "bumper_rear"]
COLLIDER_OF = {}
for c in COLLIDERS:
    part = c["jj_collider"]["part"]
    COLLIDER_OF.setdefault(part, []).append(c.name)


def gl_axis(a):
    return [float(a[0]), float(a[2]), float(-a[1])]


for name, frac in FRACTIONS.items():
    o = OBJ[name]
    o["jj_part"] = name
    o["jj_mass_fraction"] = frac
    o["jj_detachable"] = name in DETACHABLE
    o["jj_attach"] = o.parent["jj_part"] if (o.parent and "jj_part" in o.parent) else ""
    if name in COLLIDER_OF:
        cols = COLLIDER_OF[name]
        o["jj_collider"] = cols[0] if len(cols) == 1 else cols
    joint = o.get("jj_joint", "fixed")
    o["jj_joint"] = joint
    if joint in ("hinge", "spin", "suspension"):
        o["jj_axis"] = gl_axis(o["jj_axis"])
    if joint == "suspension":
        o["jj_range_deg"] = [-0.10, 0.12]          # metres of travel for suspension joints
    if joint == "compound":
        o["jj_axis_steer"] = gl_axis(o["jj_axis_steer"])
        o["jj_axis_spin"] = gl_axis(o["jj_axis_spin"])
    if name in DENTABLE:
        o["jj_dent"] = []                         # filled below
for tname, owner in TRIMS.items():
    o = OBJ[tname]
    for k in ("jj_part", "jj_mass_fraction"):
        if k in o:
            del o[k]
    o["jj_part_of"] = owner

# ------------------------------------------------------------------ 3. localised dent morphs
def add_dent(o, key_name, centre_w, radius, depth):
    if o.data.shape_keys is None:
        o.shape_key_add(name="Basis", from_mix=False)
    sk = o.shape_key_add(name=key_name, from_mix=False)
    mw = o.matrix_world
    inv3 = mw.inverted().to_3x3()
    rot3 = mw.to_3x3()
    moved = 0
    for i, v in enumerate(o.data.vertices):
        pw = mw @ v.co
        d = (pw - centre_w).length
        if d >= radius:
            continue
        w = (1 - (d / radius) ** 2) ** 2
        nw = (rot3 @ v.normal).normalized()
        sk.data[i].co = v.co + inv3 @ (-nw * depth * w)
        moved += 1
    o["jj_dent"] = list(o.get("jj_dent", [])) + [key_name]
    return moved


def outer_point(o):
    """Centre of the part's outward-facing surface: centroid pushed out along the mean face normal."""
    mw = o.matrix_world
    rot3 = mw.to_3x3()
    area_n = Vector()
    cen = Vector()
    tot = 0.0
    for p in o.data.polygons:
        a = p.area
        area_n += (rot3 @ p.normal) * a
        cen += (mw @ p.center) * a
        tot += a
    cen /= tot
    n = area_n.normalized()
    far = max((mw @ v.co - cen).dot(n) for v in o.data.vertices)
    ext = max((mw @ v.co - cen).length for v in o.data.vertices)
    return cen + n * far, ext


CHASSIS_DENTS = {"chassis_dent_FL": (-0.92, 1.38, 1.0), "chassis_dent_FR": (0.92, 1.38, 1.0),
                 "chassis_dent_RL": (-0.92, -1.40, 1.05), "chassis_dent_RR": (0.92, -1.40, 1.05),
                 "chassis_dent_roof": (0.0, -0.20, 1.95)}


def densify(o, centres=None, radius=0.55):
    """Flat (shape-preserving) subdivision so localised dents have interior vertices to move.
    With `centres`, only faces near those points are split (targeted crumple zones)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw = o.matrix_world
    if centres is None:
        edges = bm.edges[:]
    else:
        faces = [f for f in bm.faces if any(((mw @ f.calc_center_median()) - Vector(c)).length < radius for c in centres)]
        edges = list({e for f in faces for e in f.edges})
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True, smooth=0.0)
    bm.to_mesh(o.data)
    bm.free()
    for p in o.data.polygons:
        p.use_smooth = True


if LOD >= 1:   # LOD0's body is already subdivided; the cage LODs need interior verts for localised dents
    for name in (("bonnet", "boot") if LOD == 1 else ()) + ("door_L", "door_R", "door_rear_L", "door_rear_R"):
        densify(OBJ[name])
if LOD == 1:
    densify(OBJ["chassis"], centres=CHASSIS_DENTS.values(), radius=0.45)

dent_report = {}
for name in DENTABLE[1:]:
    o = OBJ[name]
    c, ext = outer_point(o)
    dent_report[f"{name}_dent"] = add_dent(o, f"{name}_dent", c, max(0.35, min(0.6, ext * 0.8)), 0.10)
CH = OBJ["chassis"]
for key, pos in CHASSIS_DENTS.items():
    dent_report[key] = add_dent(CH, key, Vector(pos), 0.45, 0.12)

# ------------------------------------------------------------------ 4. UV0 atlas (+UV1 copy)
bpy.ops.object.select_all(action="DESELECT")
for o in VISUAL:
    if not o.data.uv_layers:
        o.data.uv_layers.new(name="UV0")
    else:
        o.data.uv_layers[0].name = "UV0"
    o.select_set(True)
bpy.context.view_layer.objects.active = VISUAL[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.average_islands_scale()
bpy.ops.object.mode_set(mode="OBJECT")
PAINT_TEXEL_BOOST = 1.6   # identity paint + pattern get 1.6x linear texel density (documented in the sidecar)


def boost_paint_islands(o, k):
    """Scale each UV island made only of paint faces about its own centre (pack_islands re-lays them out)."""
    paint_idx = {i for i, sl in enumerate(o.material_slots) if sl.material and sl.material.name == "jj_paint"}
    if not paint_idx:
        return
    bm = bmesh.new(); bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv.active
    seen = set()
    for f in bm.faces:
        if f.material_index not in paint_idx or f in seen:
            continue
        stack, isl = [f], []
        while stack:
            g = stack.pop()
            if g in seen or g.material_index not in paint_idx:
                continue
            seen.add(g); isl.append(g)
            for lg in g.loops:
                for h in lg.edge.link_faces:
                    if h is g or h in seen:
                        continue
                    lh = next((l for l in h.loops if l.edge == lg.edge), None)
                    # connected in UV space when the shared edge's UVs coincide (either winding)
                    a0, a1 = lg[uvl].uv, lg.link_loop_next[uvl].uv
                    b0, b1 = lh[uvl].uv, lh.link_loop_next[uvl].uv
                    if ((a0 - b1).length < 1e-6 and (a1 - b0).length < 1e-6) or ((a0 - b0).length < 1e-6 and (a1 - b1).length < 1e-6):
                        stack.append(h)
        ls = [l for g in isl for l in g.loops]
        cx = sum(l[uvl].uv.x for l in ls) / len(ls); cy = sum(l[uvl].uv.y for l in ls) / len(ls)
        for l in ls:
            l[uvl].uv = ((l[uvl].uv.x - cx) * k + cx, (l[uvl].uv.y - cy) * k + cy)
    bm.to_mesh(o.data); bm.free()


for o in VISUAL:
    boost_paint_islands(o, PAINT_TEXEL_BOOST)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", scale=True, margin_method="FRACTION", margin=0.003,
                        shape_method="CONCAVE")
bpy.ops.object.mode_set(mode="OBJECT")
for o in VISUAL:
    uv1 = o.data.uv_layers.new(name="UV1")             # copies the active (UV0) coordinates
    o.data.uv_layers.active = o.data.uv_layers["UV0"]
    o.data.uv_layers["UV0"].active_render = True

# ------------------------------------------------------------------ 5. bake the RGBA mask
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.render.bake.margin = max(2, MASK_PX // 128)
scene.world = scene.world or bpy.data.worlds.new("World")
scene.world.light_settings.distance = 0.6              # AO reach (metres)

img_emit = bpy.data.images.new("bake_emit", MASK_PX, MASK_PX, alpha=False)
img_ao = bpy.data.images.new("bake_ao", MASK_PX, MASK_PX, alpha=False)
LIGHT_SEMS = {"headlight", "brakelight", "indicator"}


def temp_material(kind, sem, img):
    m = bpy.data.materials.new(f"tmp_{kind}_{sem}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV0"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    if kind == "emit":
        em = nt.nodes.new("ShaderNodeEmission")
        comb = nt.nodes.new("ShaderNodeCombineColor")
        if sem == "paint":
            comb.inputs[0].default_value = 1.0
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Position"], sep.inputs[0])
            sepn = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Normal"], sepn.inputs[0])
            ab = nt.nodes.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"; nt.links.new(sep.outputs[0], ab.inputs[0])
            g1 = nt.nodes.new("ShaderNodeMath"); g1.operation = "GREATER_THAN"; g1.inputs[1].default_value = 0.09
            nt.links.new(ab.outputs[0], g1.inputs[0])
            l1 = nt.nodes.new("ShaderNodeMath"); l1.operation = "LESS_THAN"; l1.inputs[1].default_value = 0.23
            nt.links.new(ab.outputs[0], l1.inputs[0])
            up = nt.nodes.new("ShaderNodeMath"); up.operation = "GREATER_THAN"; up.inputs[1].default_value = 0.40
            nt.links.new(sepn.outputs[2], up.inputs[0])
            m1 = nt.nodes.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
            nt.links.new(g1.outputs[0], m1.inputs[0]); nt.links.new(l1.outputs[0], m1.inputs[1])
            m2 = nt.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"
            nt.links.new(m1.outputs[0], m2.inputs[0]); nt.links.new(up.outputs[0], m2.inputs[1])
            nt.links.new(m2.outputs[0], comb.inputs[1])          # G = twin racing stripes on the upper surfaces
        elif sem in LIGHT_SEMS:
            comb.inputs[2].default_value = 1.0                   # -> A (emissive) after packing
        nt.links.new(comb.outputs[0], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    else:
        df = nt.nodes.new("ShaderNodeBsdfDiffuse")
        df.inputs["Color"].default_value = (1, 1, 1, 1)
        nt.links.new(df.outputs[0], out.inputs["Surface"])
    nt.nodes.active = tex
    return m


original = {o.name: [s.material for s in o.material_slots] for o in VISUAL}


def swap(kind, img):
    cache = {}
    for o in VISUAL:
        for i, s in enumerate(o.material_slots):
            sem = s.material.get("jj_semantic", "none") if s.material else "none"
            if sem not in cache:
                cache[sem] = temp_material(kind, sem, img)
            s.material = cache[sem]
    return cache


def restore():
    for o in VISUAL:
        for i, s in enumerate(o.material_slots):
            s.material = original[o.name][i]


bpy.ops.object.select_all(action="DESELECT")
for o in VISUAL:
    o.select_set(True)
bpy.context.view_layer.objects.active = VISUAL[0]
tmp = swap("emit", img_emit)
bpy.ops.object.bake(type="EMIT", use_clear=True, margin=scene.render.bake.margin)
restore()
tmp2 = swap("ao", img_ao)
bpy.ops.object.bake(type="AO", use_clear=True, margin=scene.render.bake.margin)
restore()
for m in list(tmp.values()) + list(tmp2.values()):
    bpy.data.materials.remove(m)

import numpy as np
emit = np.array(img_emit.pixels[:], dtype=np.float32).reshape(MASK_PX, MASK_PX, 4)
ao = np.array(img_ao.pixels[:], dtype=np.float32).reshape(MASK_PX, MASK_PX, 4)
mask = np.zeros((MASK_PX, MASK_PX, 4), dtype=np.float32)
mask[..., 0] = emit[..., 0]
mask[..., 1] = emit[..., 1]
mask[..., 2] = np.clip((1.0 - ao[..., 0]) * 1.5, 0.0, 1.0)     # dirt collects where AO is dark
mask[..., 3] = emit[..., 2]
img_mask = bpy.data.images.new("jj_mask", MASK_PX, MASK_PX, alpha=True)
img_mask.pixels.foreach_set(mask.ravel())
mask_path = os.path.join(DST, f"mask.lod{LOD}.png")
img_mask.filepath_raw = mask_path
img_mask.file_format = "PNG"
img_mask.alpha_mode = "STRAIGHT"
img_mask.save()
img_mask.pack()

# wire the mask into jj_paint (base colour, UV0) - the runtime JJ paint shader reads it
paint = bpy.data.materials["jj_paint"]
nt = paint.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img_mask
uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UV0"
nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
paint["jj_mask_channels"] = {"r": "paint", "g": "pattern", "b": "dirt", "a": "emissive"}

# ------------------------------------------------------------------ 6. export
bpy.ops.object.select_all(action="DESELECT")
for o in coll.objects:
    o.hide_set(False)
    o.select_set(True)
glb_path = os.path.join(DST, f"cruz_missile.lod{LOD}.glb")
bpy.ops.export_scene.gltf(
    filepath=glb_path, export_format="GLB", use_selection=True, export_yup=True, export_extras=True,
    export_morph=True, export_morph_normal=True, export_try_sparse_sk=False, export_texcoords=True,
    export_normals=True, export_tangents=False, export_materials="EXPORT", export_image_format="AUTO",
    export_cameras=False, export_lights=False, export_animations=False, export_morph_animation=False,
    export_apply=False, export_vertex_color="NONE", export_all_vertex_colors=False)
if LOD == 0:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(DST, "cruz_missile.source.blend"), copy=True)


# ------------------------------------------------------------------ 7. per-LOD meta from the GLB itself
def glb_json(path):
    data = open(path, "rb").read()
    clen = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + clen])


g = glb_json(glb_path)
node_mesh = {n["name"]: n.get("mesh") for n in g["nodes"]}
tris = 0
for name, mi in node_mesh.items():
    if mi is None or name.startswith("col_"):
        continue
    for prim in g["meshes"][mi]["primitives"]:
        tris += g["accessors"][prim["indices"]]["count"] // 3
draws = sum(len(g["meshes"][mi]["primitives"]) for n, mi in node_mesh.items() if mi is not None and not n.startswith("col_"))

wmin = Vector((1e9, 1e9, 1e9)); wmax = -wmin
for o in VISUAL:
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        wmin = Vector(map(min, wmin, p)); wmax = Vector(map(max, wmax, p))
lo_g, hi_g = gl(wmin), gl(wmax)
bounds = {"min": [min(lo_g[i], hi_g[i]) for i in range(3)], "max": [max(lo_g[i], hi_g[i]) for i in range(3)]}

parts = {}
for name, frac in FRACTIONS.items():
    o = OBJ[name]
    e = {"node": name, "mass_fraction": frac, "joint": o["jj_joint"], "detachable": bool(o["jj_detachable"]),
         "attach": o["jj_attach"], "origin": gl(o.matrix_world.translation)}
    for k in ("jj_axis", "jj_range_deg", "jj_axis_steer", "jj_range_steer_deg", "jj_axis_spin"):
        if k in o:
            e[k[3:]] = list(o[k])
    if "jj_collider" in o:
        e["collider"] = o["jj_collider"] if isinstance(o["jj_collider"], str) else list(o["jj_collider"])
    if "jj_dent" in o:
        e["dents"] = list(o["jj_dent"])
    parts[name] = e
wheels, susp = {}, {}
for w in ("FL", "FR", "RL", "RR"):
    hub = OBJ[f"wheel_{w}"].matrix_world.translation
    top = OBJ[f"susp_{w}"].matrix_world.translation
    wheels[f"wheel_{w}"] = {"hub": gl(hub), "radius": 0.44, "width": 0.42, "steer": w[0] == "F", "driven": w[0] == "F"}
    susp[f"wheel_{w}"] = {"top_mount": gl(top), "hub": gl(hub), "rest_length": round(top.z - hub.z, 4), "travel": [-0.10, 0.12]}
anchors = {e.name: gl(e.matrix_world.translation) for e in EMPTIES}
materials = {m.name: m["jj_semantic"] for m in bpy.data.materials if m.name.startswith("jj_") and "jj_semantic" in m}
colliders = {c.name: {"shape": c["jj_collider"]["shape"], "part": c["jj_collider"]["part"], "verts": len(c.data.vertices)} for c in COLLIDERS}
meta = {"lod": LOD, "file": os.path.basename(glb_path), "triangles": tris, "draw_calls": draws,
        "materials": len(g.get("materials", [])), "mask_px": MASK_PX, "bounds": bounds, "parts": parts,
        "wheels": wheels, "suspension": susp, "anchors": anchors, "materials_map": materials,
        "colliders": colliders, "dents": dent_report, "mass_kg": MASS_KG,
        "com": anchors.get("com"), "file_bytes": os.path.getsize(glb_path)}
json.dump(meta, open(os.path.join(DST, ".build", f"lod{LOD}.json"), "w"), indent=1)
print("FINISH_OK", json.dumps({"lod": LOD, "triangles": tris, "draws": draws, "bytes": meta["file_bytes"],
                               "dents": dent_report}))
