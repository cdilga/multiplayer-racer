"""Spike D task 1: wheelie bin destructible prop, headless Blender.

Run:  blender -b -P build_wheelie_bin.py -- <out_dir>

Builds:
  - intact bin: green body, red hinged lid, 2 wheels (jj_* semantic materials)
  - pre-fractured pieces: iterative random-plane bisection of the body mesh
    (no Cell Fracture addon available headless on this machine -- confirmed via
    addon_utils.modules(), see REPORT.md). Bisection is a strict partition of the
    source mesh, so combined piece volume == intact volume by construction (within
    float tolerance), which is what the validator checks (plan 8.4: piece masses).
  - rubbish debris props: can, pizza box, banana peel, nappy (simple chunky meshes,
    comic style -- no gross detail).

Exports: wheelie_bin_intact.glb, wheelie_bin_fractured.glb, wheelie_bin_debris.glb
Sidecar: wheelie_bin.asset.json (destructible_prop contract draft)
"""
import bpy, bmesh, json, math, os, random, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
os.makedirs(OUT, exist_ok=True)
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color, rough=0.6, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.5
    m["jj_semantic"] = name
    return m


M = {
    "bin_body": mat("jj_bin_body", (0.09, 0.42, 0.14), 0.65),
    "bin_lid": mat("jj_bin_lid", (0.62, 0.06, 0.05), 0.55),
    "bin_wheel": mat("jj_bin_wheel", (0.04, 0.04, 0.04), 0.8),
    "bin_axle": mat("jj_bin_axle", (0.5, 0.5, 0.52), 0.4, 0.7),
    "debris_can": mat("jj_debris_can", (0.75, 0.75, 0.78), 0.35, 0.6),
    "debris_can_label": mat("jj_debris_can_label", (0.85, 0.1, 0.12), 0.5),
    "debris_pizza": mat("jj_debris_pizza", (0.82, 0.66, 0.38), 0.7),
    "debris_pizza_top": mat("jj_debris_pizza_top", (0.35, 0.1, 0.06), 0.6),
    "debris_banana": mat("jj_debris_banana", (0.95, 0.85, 0.15), 0.5),
    "debris_banana_in": mat("jj_debris_banana_in", (0.95, 0.9, 0.6), 0.5),
    "debris_nappy": mat("jj_debris_nappy", (0.96, 0.96, 0.92), 0.6),
    "debris_nappy_tape": mat("jj_debris_nappy_tape", (0.3, 0.55, 0.85), 0.5),
}

PIECES_META = {}
DEBRIS_META = {}


def new_mesh_obj(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if material:
        me.materials.append(material)
    return o


def box_bm(size, loc=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return bm


def mesh_volume(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    vol = bm.calc_volume(signed=True)
    bm.free()
    return abs(vol)


# ---------------------------------------------------------------- intact bin
# Wheelie bin proportions (units metres): ~0.6 x 0.5 x 1.05 body, tapered slightly at base.
BODY_W, BODY_D, BODY_H = 0.58, 0.52, 0.95
body_bm = bmesh.new()
bmesh.ops.create_cube(body_bm, size=1)
# taper: scale bottom verts in slightly for the classic wheelie-bin trapezoid profile
for v in body_bm.verts:
    if v.co.z < 0:
        v.co.x *= 0.82
        v.co.y *= 0.82
bmesh.ops.scale(body_bm, vec=(BODY_W, BODY_D, BODY_H), verts=body_bm.verts)
bmesh.ops.translate(body_bm, vec=(0, 0, BODY_H / 2 + 0.12), verts=body_bm.verts)
# subdivide so fracture bisection + dent-style deformation has interior verts
bmesh.ops.subdivide_edges(body_bm, edges=body_bm.edges[:], cuts=3, use_grid_fill=True)
body = new_mesh_obj("bin_body", body_bm.copy(), M["bin_body"])
body["jj_kind"] = "destructible_body"
body_intact_volume = mesh_volume(body)

lid_bm = box_bm((BODY_W * 1.04, BODY_D * 1.04, 0.06), (0, -BODY_D * 0.02, 0))
lid = new_mesh_obj("bin_lid", lid_bm, M["bin_lid"])
lid_hinge_y = BODY_D / 2 + 0.12 - 0.02
lid.location = (0, lid_hinge_y * 0 + (BODY_D / 2 - 0.02), BODY_H + 0.12 + 0.03)
lid["jj_kind"] = "hinged_lid"
lid["jj_hinge_axis"] = [1, 0, 0]
lid["jj_hinge_point"] = [0, lid.location.y - 0.02, lid.location.z - 0.01]

# wheel axle + 2 wheels at the rear base
axle_bm = bmesh.new()
bmesh.ops.create_cone(axle_bm, cap_ends=True, segments=16, radius1=0.05, radius2=0.05, depth=BODY_W * 1.05)
bmesh.ops.rotate(axle_bm, verts=axle_bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
axle = new_mesh_obj("bin_axle", axle_bm, M["bin_axle"])
axle.location = (0, BODY_D / 2 - 0.03, 0.14)

wheels = []
for side, x in (("L", -BODY_W / 2 + 0.02), ("R", BODY_W / 2 - 0.02)):
    wbm = bmesh.new()
    bmesh.ops.create_cone(wbm, cap_ends=True, segments=20, radius1=0.14, radius2=0.14, depth=0.06)
    bmesh.ops.rotate(wbm, verts=wbm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    w = new_mesh_obj(f"bin_wheel_{side}", wbm, M["bin_wheel"])
    w.location = (x, BODY_D / 2 - 0.03, 0.14)
    w["jj_kind"] = "wheel"
    wheels.append(w)

for o in (lid, axle, *wheels):
    o.parent = body
    o.matrix_parent_inverse = body.matrix_world.inverted()

bpy.context.view_layer.update()

# ---------------------------------------------------------------- crush damage shape keys (data API only)
# Owner-requested addition: a "squished" damage state on the *intact* bin, distinct from the
# fracture-piece destruction above (run-over/rammed, not broken apart). Two shape keys, each spread
# across every affected object so a single driven influence value crushes body + lid + wheels
# together: "bin_crush_top" (squashed from above, ~45% height, body bulges outward, lid pressed
# down/creased) and "bin_crush_side" (caved in from one side, opposite side bulges, lid knocked
# ajar, wheels splayed outward). Comic/cartoon exaggeration, not a realistic deformation sim.
# Finding carried over from the dent keys above: Blender 5 shape keys default to value=1.0 on
# creation, so every key below is explicitly set back to 0.0 immediately after creation.
CRUSH_MORPHS = {"bin_crush_top": [], "bin_crush_side": []}

def add_key(obj, name):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name=name)
    key.value = 0.0
    CRUSH_MORPHS[name].append(obj.name)
    return key

BODY_BOTTOM_Z = 0.12
BODY_TOP_Z = 0.12 + BODY_H
TOP_SQUASH = 0.45  # final height fraction for a full top-crush

# body: top squash (barrel-bulge outward as it flattens)
key = add_key(body, "bin_crush_top")
for i, v in enumerate(body.data.vertices):
    t = max(0.0, min(1.0, (v.co.z - BODY_BOTTOM_Z) / BODY_H))
    new_z = BODY_BOTTOM_Z + t * BODY_H * TOP_SQUASH
    bulge = 1.0 + 0.55 * math.sin(math.pi * t)
    key.data[i].co = Vector((v.co.x * bulge, v.co.y * bulge, new_z))

# body: side cave-in (+X impact face caves in, -X face bulges out a little)
key = add_key(body, "bin_crush_side")
impact_center = Vector((BODY_W / 2, 0, BODY_H / 2 + 0.12))
cave_depth = BODY_W * 0.62
radius = max(BODY_W, BODY_D, BODY_H) * 0.62
for i, v in enumerate(body.data.vertices):
    d = (v.co - impact_center).length
    co = v.co.copy()
    if d < radius:
        falloff = (1 - d / radius) ** 1.4
        co.x -= cave_depth * falloff
    elif v.co.x < -BODY_W * 0.15:
        co.x -= (v.co.x + BODY_W * 0.15) * 0.35  # opposite face bulges outward (more negative x)
    key.data[i].co = co

# lid: pressed down flat onto the squashed body (top crush) / knocked ajar & skewed (side crush)
# IMPORTANT: bin_lid's mesh vertices are in the *lid object's local space* (box_bm baked a small
# offset into them, and the big placement lives in lid.location), unlike bin_body/wheels whose mesh
# data is already in absolute/world coordinates (object.location left at identity). Any "absolute"
# reference point (hinge_point, lid.location itself) must be converted into lid-local mesh space by
# subtracting lid.location before combining it with v.co -- mixing the two spaces directly produced
# a real bug here (the side-crush lid flew out as a long detached plank; fixed below).
drop_amount = BODY_H * (1.0 - TOP_SQUASH)
lid_ys = [v.co.y for v in lid.data.vertices]
lid_y_min, lid_y_max = min(lid_ys), max(lid_ys)  # local-space extent; hinge is at the y_max (back) edge

key = add_key(lid, "bin_crush_top")
for i, v in enumerate(lid.data.vertices):
    y_frac = (lid_y_max - v.co.y) / max(1e-6, (lid_y_max - lid_y_min))  # 0 at hinge edge .. 1 at front edge
    crease = 0.05 * math.sin(math.pi * max(0.0, min(1.0, y_frac)))
    key.data[i].co = v.co - Vector((0, 0, drop_amount + crease))

key = add_key(lid, "bin_crush_side")
# Second bug found here (via the ortho debug render): binSidecar's jj_hinge_point sits only ~2cm
# from lid.location -- i.e. near the OBJECT's own local origin, not anywhere near the mesh's actual
# back/hinge edge (local y ~= lid_y_max). That property is fine for the object-transform-based
# rotation ingame.html does (rotating the whole rigid object still reads as "opening" even from an
# approximate pivot), but for a per-vertex shape key it rotated the lid around its own middle --
# both ends swing, so it looked like a detached, floating plank instead of a hinge. Use the mesh's
# real back edge as the local pivot instead.
hinge_pivot_local = Vector((0.0, lid_y_max, 0.0))
hinge_axis = Vector(lid["jj_hinge_axis"]).normalized()
ajar_rot = Matrix.Rotation(math.radians(-32), 4, hinge_axis)  # negative: front edge lifts up/open, not down into the body
for i, v in enumerate(lid.data.vertices):
    rel = v.co - hinge_pivot_local
    co = hinge_pivot_local + (ajar_rot @ rel)
    co.x += 0.04  # knocked slightly toward the impact side
    key.data[i].co = co

# wheels: mild squash-contact on top crush, splayed outward (impact-side wheel more) on side crush
for w in wheels:
    side_sign = -1.0 if w.name.endswith("_L") else 1.0
    key = add_key(w, "bin_crush_top")
    offset = Vector((side_sign * 0.05, 0, -0.025))
    for i, v in enumerate(w.data.vertices):
        key.data[i].co = v.co + offset
    key = add_key(w, "bin_crush_side")
    impact_side = w.location.x > 0  # matches the +X cave-in face above
    splay = 0.16 if impact_side else 0.06
    offset = Vector((side_sign * splay, 0, -0.03))
    for i, v in enumerate(w.data.vertices):
        key.data[i].co = v.co + offset

# ---------------------------------------------------------------- collider proxies (separate from render mesh)
col_bm = box_bm((BODY_W, BODY_D, BODY_H), (0, 0, BODY_H / 2 + 0.12))
col = new_mesh_obj("col_bin_body", col_bm, None)
col["jj_collider"] = True
col.display_type = "WIRE"
col.hide_render = True
col.parent = body
col.matrix_parent_inverse = body.matrix_world.inverted()

# markers: base contact point + com
com = bpy.data.objects.new("bin_com", None)
com.location = (0, 0, BODY_H * 0.42 + 0.12)
scene.collection.objects.link(com)
com.parent = body
com.matrix_parent_inverse = body.matrix_world.inverted()

# ---------------------------------------------------------------- export intact GLB
intact_objs = [body, lid, axle, col, com, *wheels]
for o in scene.objects:
    o.select_set(o in intact_objs)
glb_intact = os.path.join(OUT, "wheelie_bin_intact.glb")
bpy.ops.export_scene.gltf(filepath=glb_intact, export_format="GLB", export_extras=True,
                           export_apply=False, use_selection=True)

# ---------------------------------------------------------------- pre-fracture the body
# Random-plane bisection: repeatedly split a random current fragment with a plane through a
# random interior point + random normal. This is a strict spatial partition (no gaps/overlaps),
# so sum(fragment volumes) == source volume by construction (checked by the validator).
N_PIECES = 7
frag_bm = bmesh.new()
frag_bm.from_mesh(body.data)
fragments = [frag_bm]
bbox_center = Vector((0, 0, BODY_H / 2 + 0.12))
bbox_radius = max(BODY_W, BODY_D, BODY_H) * 0.6

while len(fragments) < N_PIECES:
    # split the largest-volume fragment (keeps pieces reasonably even)
    def frag_vol(bm):
        bm2 = bm.copy()
        bmesh.ops.triangulate(bm2, faces=bm2.faces)
        v = abs(bm2.calc_volume(signed=True))
        bm2.free()
        return v
    idx = max(range(len(fragments)), key=lambda i: frag_vol(fragments[i]))
    src = fragments.pop(idx)
    plane_co = bbox_center + Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * bbox_radius * 0.35
    plane_no = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))).normalized()
    a = src.copy()
    geom_a = a.verts[:] + a.edges[:] + a.faces[:]
    res_a = bmesh.ops.bisect_plane(a, geom=geom_a, plane_co=plane_co, plane_no=plane_no,
                                    clear_inner=False, clear_outer=True)
    bmesh.ops.contextual_create(a, geom=[e for e in res_a["geom_cut"] if isinstance(e, bmesh.types.BMEdge)])
    b = src.copy()
    geom_b = b.verts[:] + b.edges[:] + b.faces[:]
    res_b = bmesh.ops.bisect_plane(b, geom=geom_b, plane_co=plane_co, plane_no=-plane_no,
                                    clear_inner=False, clear_outer=True)
    bmesh.ops.contextual_create(b, geom=[e for e in res_b["geom_cut"] if isinstance(e, bmesh.types.BMEdge)])
    src.free()
    fragments.append(a)
    fragments.append(b)

piece_objs = []
piece_total_volume = 0.0
for i, bm in enumerate(fragments):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    name = f"bin_piece_{i:02d}"
    o = new_mesh_obj(name, bm, M["bin_body"] if i % 3 else M["bin_lid"])
    vol = mesh_volume(o)
    piece_total_volume += vol
    # mass proportional to volume (uniform density assumption, noted in sidecar)
    density = 380.0  # kg/m^3 -- HDPE bin shell approx, hollow-shell equivalent density for a solid-fill fracture proxy
    mass = round(vol * density, 3)
    o["jj_kind"] = "fracture_piece"
    o["jj_mass_kg"] = mass
    PIECES_META[name] = {"volume_m3": round(vol, 5), "mass_kg": mass}
    piece_objs.append(o)

lid_piece = new_mesh_obj("bin_lid_piece", box_bm((BODY_W * 1.04, BODY_D * 1.04, 0.06)), M["bin_lid"])
lid_piece.location = lid.matrix_world.translation
lid_vol = mesh_volume(lid_piece)
lid_piece["jj_kind"] = "fracture_piece"
lid_piece["jj_mass_kg"] = round(lid_vol * 380.0, 3)
PIECES_META["bin_lid_piece"] = {"volume_m3": round(lid_vol, 5), "mass_kg": lid_piece["jj_mass_kg"]}
piece_objs.append(lid_piece)

for o in scene.objects:
    o.select_set(o in piece_objs)
glb_fractured = os.path.join(OUT, "wheelie_bin_fractured.glb")
bpy.ops.export_scene.gltf(filepath=glb_fractured, export_format="GLB", export_extras=True,
                           export_apply=False, use_selection=True)

volume_ratio = (piece_total_volume + lid_vol) / (body_intact_volume + mesh_volume(lid))

# ---------------------------------------------------------------- rubbish debris props
debris_objs = []

def add_debris(name, builder, material):
    o = builder(name, material)
    DEBRIS_META[name] = {"material": material.name}
    debris_objs.append(o)
    return o

def build_can(name, material):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.033, radius2=0.033, depth=0.115)
    o = new_mesh_obj(name, bm, material)
    # crush dent: squash slightly + a shape key for "stepped on" state (comic squish, value 0 default)
    o.shape_key_add(name="Basis")
    key = o.shape_key_add(name=f"{name}_crushed")
    key.value = 0.0
    for i, v in enumerate(o.data.vertices):
        key.data[i].co = Vector((v.co.x * 1.35, v.co.y * 1.35, v.co.z * 0.4))
    band = new_mesh_obj(f"{name}_label", box_bm((0.067, 0.001, 0.05)), M["debris_can_label"])
    band.location = (0, 0.0335, 0)
    band.parent = o; band.matrix_parent_inverse = o.matrix_world.inverted()
    return o

def build_pizza_box(name, material):
    bm = box_bm((0.32, 0.32, 0.045))
    o = new_mesh_obj(name, bm, material)
    lid_top = new_mesh_obj(f"{name}_lid", box_bm((0.30, 0.30, 0.01)), M["debris_pizza_top"])
    lid_top.location = (0, 0, 0.028)
    lid_top.parent = o; lid_top.matrix_parent_inverse = o.matrix_world.inverted()
    return o

def build_banana_peel(name, material):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=0.02, radius2=0.045, depth=0.22)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.radians(75), 3, "X"))
    o = new_mesh_obj(name, bm, material)
    return o

def build_nappy(name, material):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(0.20, 0.14, 0.06), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=0.02, segments=2, affect="VERTICES")
    o = new_mesh_obj(name, bm, material)
    tape = new_mesh_obj(f"{name}_tape", box_bm((0.02, 0.005, 0.03)), M["debris_nappy_tape"])
    tape.location = (0.09, 0, 0)
    tape.parent = o; tape.matrix_parent_inverse = o.matrix_world.inverted()
    return o

add_debris("debris_can_01", build_can, M["debris_can"])
add_debris("debris_pizza_box_01", build_pizza_box, M["debris_pizza"])
add_debris("debris_banana_peel_01", build_banana_peel, M["debris_banana"])
add_debris("debris_nappy_01", build_nappy, M["debris_nappy"])

# spread debris out for the export/preview (spawn offsets also recorded in sidecar)
spawn_offsets = []
for i, o in enumerate(debris_objs):
    ang = i * (2 * math.pi / len(debris_objs))
    r = 0.5 + 0.15 * (i % 2)
    off = (math.cos(ang) * r, math.sin(ang) * r, 0.03)
    o.location = off
    spawn_offsets.append({"name": o.name, "offset": list(off)})

bpy.context.view_layer.update()
for o in scene.objects:
    o.select_set(o in debris_objs)
glb_debris = os.path.join(OUT, "wheelie_bin_debris.glb")
bpy.ops.export_scene.gltf(filepath=glb_debris, export_format="GLB", export_extras=True,
                           export_apply=False, use_selection=True, export_morph=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "wheelie_bin.blend"))

# ---------------------------------------------------------------- sidecar (destructible_prop draft contract)
sidecar = {
    "contract": "jj.destructible_prop.v0-draft",
    "id": "wheelie_bin",
    "display_name": "Wheelie Bin",
    "units": "m", "forward": "+Y", "up": "+Z",
    "assets": {
        "intact": "wheelie_bin_intact.glb",
        "fractured": "wheelie_bin_fractured.glb",
        "debris": "wheelie_bin_debris.glb",
    },
    "intact_root": "bin_body",
    "lid": {
        "node": "bin_lid",
        "hinge_axis": [1, 0, 0],
        "hinge_point": list(lid["jj_hinge_point"]),
        "open_angle_deg": 110,
    },
    "wheels": ["bin_wheel_L", "bin_wheel_R"],
    "collider": "col_bin_body",
    "com_marker": "bin_com",
    "crush_morphs": {
        "bin_crush_top": {"nodes": CRUSH_MORPHS["bin_crush_top"], "description": "squashed from above, ~45% height, body bulges outward, lid pressed down"},
        "bin_crush_side": {"nodes": CRUSH_MORPHS["bin_crush_side"], "description": "caved in from one side, opposite face bulges, lid knocked ajar, wheels splayed"},
    },
    "damage_ladder": [
        {"state": "intact", "morph": None, "influence": 0.0, "impulse_threshold_ns": 0},
        {"state": "dented", "morph": "bin_crush_top", "influence": 0.5, "impulse_threshold_ns": 180},
        {"state": "squished", "morph": "bin_crush_top", "influence": 1.0, "impulse_threshold_ns": 320},
        {"state": "squished_side", "morph": "bin_crush_side", "influence": 1.0, "impulse_threshold_ns": 300},
        {"state": "fractured", "morph": None, "influence": None, "impulse_threshold_ns": 450, "spawns": "rubbish_spawn"},
    ],
    "destruction": {
        "break_threshold_impulse_ns": 450,
        "damage_to_car_factor": 0.12,
        "pieces": PIECES_META,
        "piece_count": len(piece_objs),
        "intact_volume_m3": round(body_intact_volume + mesh_volume(lid), 5),
        "fractured_volume_m3": round(piece_total_volume + lid_vol, 5),
        "volume_conservation_ratio": round(volume_ratio, 4),
        "fracture_method": "iterative_random_plane_bisection (no cell-fracture addon available headless)",
    },
    "rubbish_spawn": {
        "on_break": True,
        "max_count": len(debris_objs),
        "items": spawn_offsets,
    },
    "debris_catalog": {
        "debris_can_01": {"kind": "can", "crush_morph": "debris_can_01_crushed"},
        "debris_pizza_box_01": {"kind": "pizza_box"},
        "debris_banana_peel_01": {"kind": "banana_peel"},
        "debris_nappy_01": {"kind": "nappy"},
    },
    "style_notes": "comic/cartoon chunky proportions, no gross-out detail (plan 8.4)",
    "materials": sorted(m.name for m in bpy.data.materials),
    "provenance": {"blender": bpy.app.version_string, "script": "spikes/art-pipeline/D-props-kit-surfaces/build_wheelie_bin.py"},
}
with open(os.path.join(OUT, "wheelie_bin.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)

print("EXPORTED", glb_intact, glb_fractured, glb_debris)
print("VOLUME_RATIO", volume_ratio, "pieces", len(piece_objs))
