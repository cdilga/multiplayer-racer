"""Spike A (textures & UVs): build a trimmed "Cruz Missile" body with a real UV0 paint atlas +
UV1 bake atlas, bake AO/curvature/normal, export an INTERIM glb (no mask yet -- that's composed by
compose_mask.py using PIL, which Blender's python doesn't have).

Run:  blender -b -P build_textured_car.py -- <out_dir> [--broken-overlap]

Scope note: this trims the base spike's dents/hinge-metadata/decal-wordmarks/spoiler -- out of scope
for a textures/UVs spike (already proven in spikes/art-pipeline/SPIKE-REPORT.md). It focuses effort on:
  - UV0: single packed, non-overlapping atlas across the paint body shell (chassis/cabin/bonnet/
    boot/doors), built by smart-projecting each part into its own 0-1 space then remapping into a
    rectangle sized proportional to sqrt(real surface area), shelf-packed -- non-overlap by
    construction, texel density controlled by construction (reported, not just hoped for).
  - UV1: a second, independent atlas (same packer, different objects, its own margins) used ONLY as
    a bake target for AO/curvature/normal.
  - Cycles CPU bakes: AO + curvature (Pointiness emission trick) baked via UV1 into a SHARED image
    across all paint parts; a tangent-space normal map baked directly via UV0 (see REPORT.md for why
    normal isn't done via the UV1->UV0 transfer that AO/curvature use).

--broken-overlap deliberately collides two paint parts' UV0 rects, for the validator's negative test.
"""
import bpy, bmesh, json, math, os, sys, time
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
BROKEN = "--broken-overlap" in argv
LEGACY_SMART_PROJECT = "--legacy-smart-project" in argv  # reproduces the pre-fix UV path, for the
# validator's before/after demo only -- see REPORT.md §"coordinator review". Not the shipped path.
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
TIMINGS = {}


def lap(label):
    TIMINGS[label] = round(time.time() - T0, 2)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
ATLAS_RES = 1024

# ---------------------------------------------------------------- materials (semantic names)
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
    "paint": mat("jj_paint", (0.85, 0.85, 0.85), 0.35),  # neutral grey: identity colour comes from the mask at runtime
    "tyre": mat("jj_tyre", (0.03, 0.03, 0.03), 0.9),
    "wheel": mat("jj_wheel", (0.05, 0.15, 0.7), 0.3, 0.6),
    "glass": mat("jj_glass", (0.2, 0.35, 0.45), 0.05),
    "plastic": mat("jj_plastic", (0.06, 0.06, 0.07), 0.7),
    "headlight": mat("jj_headlight", (1, 1, 0.9), 0.1, emit=(1, 0.95, 0.8)),
    "brakelight": mat("jj_brakelight", (0.8, 0.05, 0.05), 0.2, emit=(1, 0.05, 0.02)),
    "underside": mat("jj_underside", (0.1, 0.08, 0.07), 0.9),
}

# ---------------------------------------------------------------- geometry helpers
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
        mod = o.modifiers.new("bevel", "BEVEL"); mod.width = bevel; mod.segments = segments
        mod.limit_method = "ANGLE"
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


# ---------------------------------------------------------------- the car (units: metres, +Y forward, Z up)
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
    mod = t.modifiers.new("bevel", "BEVEL"); mod.width = 0.08; mod.segments = 2
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
empty("roof_number", (0, -0.2, 1.48), chassis)

lap("build_geometry")

# ---------------------------------------------------------------- UV0 (paint atlas) and UV1 (bake atlas)
PAINT_PARTS = ["chassis", "cabin", "bonnet", "boot", "door_L", "door_R"]
paint_objs = [bpy.data.objects[n] for n in PAINT_PARTS]


def world_area(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    a = sum(f.calc_area() for f in bm.faces)
    bm.free()
    return a


def uv_bbox(obj, layer_name):
    layer = obj.data.uv_layers[layer_name]
    us = [l.uv.x for l in layer.data]; vs = [l.uv.y for l in layer.data]
    return min(us), min(vs), max(us) - min(us), max(vs) - min(vs)


def guillotine_pack(rects_wh, bin_w=1.0, bin_h=1.0):
    """Best-area-fit guillotine bin packer (arbitrary w,h, no rotation). Returns a list of
    (x, y, w, h) in the SAME order as rects_wh, or None if something doesn't fit."""
    free = [(0.0, 0.0, bin_w, bin_h)]
    order = sorted(range(len(rects_wh)), key=lambda i: -(rects_wh[i][0] * rects_wh[i][1]))
    placed = [None] * len(rects_wh)
    for i in order:
        w, h = rects_wh[i]
        best_idx, best_score = None, None
        for fi, (fx, fy, fw, fh) in enumerate(free):
            if w <= fw + 1e-9 and h <= fh + 1e-9:
                leftover = fw * fh - w * h
                if best_score is None or leftover < best_score:
                    best_score, best_idx = leftover, fi
        if best_idx is None:
            return None
        fx, fy, fw, fh = free.pop(best_idx)
        placed[i] = (fx, fy, w, h)
        remW, remH = fw - w, fh - h
        if remW < remH:
            if remW > 1e-9: free.append((fx + w, fy, remW, h))
            if remH > 1e-9: free.append((fx, fy + h, fw, remH))
        else:
            if remH > 1e-9: free.append((fx, fy + h, w, remH))
            if remW > 1e-9: free.append((fx + w, fy, remW, fh))
    return placed


def legacy_smart_project_into(obj, layer_name):
    """The ORIGINAL (pre-fix) per-object unwrap: a single bpy.ops.uv.smart_project call. Kept only
    to regenerate a "before" GLB on demand for the validator's negative-test demo -- see
    REPORT.md. Automatic angle-based clustering produced sparse, fragmented islands on this
    beveled-box geometry (visually confirmed with a UV checker-texture render); replaced by
    box_unwrap() below for the shipped path."""
    md = obj.data
    if layer_name not in md.uv_layers:
        if layer_name == "UV0":
            while md.uv_layers:
                md.uv_layers.remove(md.uv_layers[0])
        md.uv_layers.new(name=layer_name)
    md.uv_layers.active = md.uv_layers[layer_name]
    for s in scene.objects: s.select_set(False)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
    bpy.ops.object.mode_set(mode="OBJECT")


def guillotine_pack_autosize(rects_wh, grow=1.08, max_iter=300):
    """Pack into a bin that GROWS to fit, instead of a fixed-aspect (square) bin shrunk by a guessed
    FILL fraction. Forcing extreme-aspect-ratio rect sets (e.g. a thin door's 2 big + 4 sliver faces)
    into a square bin wastes a lot of space at low FILL; letting the bin's own aspect ratio emerge
    packs near-optimally regardless of the input shapes. Returns (placed, bin_w, bin_h)."""
    bin_w = max(w for w, h in rects_wh)
    bin_h = max(h for w, h in rects_wh)
    for _ in range(max_iter):
        placed = guillotine_pack(rects_wh, bin_w, bin_h)
        if placed:
            return placed, bin_w, bin_h
        if bin_w <= bin_h:
            bin_w *= grow
        else:
            bin_h *= grow
    return None, bin_w, bin_h


def box_unwrap(obj, layer_name, margin_frac=0.03):
    """Deterministic per-face axis-aligned box projection: bucket every face into one of 6 groups by
    its dominant normal axis+sign, project each group onto its own plane (using the mesh's real
    local-space units, so texel density is controlled, not left to a heuristic), then guillotine-pack
    the up to 6 resulting rectangles into this object's own local 0-1 UV space.

    Replaces bpy.ops.uv.smart_project, whose automatic angle-based clustering produced sparse,
    fragmented, oddly-shaped islands on this beveled-box geometry (visually confirmed via a UV
    checker-texture render -- see REPORT.md). This is fully deterministic and every island is a
    clean axis-aligned rectangle; the only distortion is on small bevel/corner faces whose normal
    isn't aligned with any single axis (inherent to any box-projection method, and a small fraction
    of total area for these parts).

    glTF TEXCOORD_N follows uv_layers list order, so strip whatever default "UVMap" layer
    primitive_*_add() left behind the first time we touch a mesh -- otherwise it silently occupies
    TEXCOORD_0 and pushes our named UV0/UV1 to TEXCOORD_1/2.
    """
    md = obj.data
    if layer_name not in md.uv_layers:
        if layer_name == "UV0":
            while md.uv_layers:
                md.uv_layers.remove(md.uv_layers[0])
        md.uv_layers.new(name=layer_name)
    bm = bmesh.new(); bm.from_mesh(md)
    bm.faces.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv[layer_name]

    groups = {}  # (axis, sign) -> [faces]
    for f in bm.faces:
        n = f.normal
        comps = (abs(n.x), abs(n.y), abs(n.z))
        axis = comps.index(max(comps))
        sign = 1 if n[axis] >= 0 else -1
        groups.setdefault((axis, sign), []).append(f)

    group_keys = list(groups.keys())
    group_bounds = []  # (u_axis, v_axis, minu, maxu, minv, maxv)
    for key in group_keys:
        axis, sign = key
        u_axis, v_axis = [a for a in (0, 1, 2) if a != axis]
        us = [v.co[u_axis] for f in groups[key] for v in f.verts]
        vs = [v.co[v_axis] for f in groups[key] for v in f.verts]
        group_bounds.append((u_axis, v_axis, min(us), max(us), min(vs), max(vs)))

    rects_wh = [(max(mu[3] - mu[2], 1e-6), max(mu[5] - mu[4], 1e-6)) for mu in group_bounds]
    placed, bin_w, bin_h = guillotine_pack_autosize(rects_wh)
    if not placed:
        raise RuntimeError(f"box_unwrap({obj.name}): could not pack {len(rects_wh)} face groups")
    # one UNIFORM scale (same for x and y -- no anisotropic stretch) bringing the packed bin's
    # longer side to fit inside [0,1] with a safety margin.
    fit = 0.98 / max(bin_w, bin_h)
    placed = [(x * fit, y * fit, w * fit, h * fit) for x, y, w, h in placed]
    fill_ratio = sum(w * h for w, h in rects_wh) / (bin_w * bin_h)

    for key, (u_axis, v_axis, minu, maxu, minv, maxv), rect in zip(group_keys, group_bounds, placed):
        rx, ry, rw, rh = rect
        mx, my = margin_frac * rw, margin_frac * rh
        ix, iy, iw, ih = rx + mx, ry + my, rw - 2 * mx, rh - 2 * my
        du, dv = max(maxu - minu, 1e-9), max(maxv - minv, 1e-9)
        for f in groups[key]:
            for loop in f.loops:
                co = loop.vert.co
                nu = (co[u_axis] - minu) / du
                nv = (co[v_axis] - minv) / dv
                loop[uv_layer].uv = (ix + nu * iw, iy + nv * ih)
    bm.to_mesh(md); bm.free()
    return fill_ratio


def pack_atlas(objs, layer_name, margin_frac, broken_collide=False):
    """Box-unwrap each obj into its own 0-1 space on layer_name (see box_unwrap), measure each
    part's natural UV bounding-box aspect ratio, then guillotine-pack rectangles sized proportional
    to real surface area (preserving that aspect) into a single shared 0-1 atlas. Non-overlap by
    construction; texel density controlled by construction (reported, not just hoped for)."""
    for o in objs:
        if LEGACY_SMART_PROJECT:
            legacy_smart_project_into(o, layer_name)
        else:
            box_unwrap(o, layer_name)
    areas = [world_area(o) for o in objs]
    bboxes = [uv_bbox(o, layer_name) for o in objs]  # (minu, minv, uw, uh)
    # Size each part's rect proportional to its real area, preserving its own uv_bbox aspect (so no
    # anisotropic stretch beyond whatever box_unwrap already fixed at full packing efficiency); one
    # shared constant makes texel density identical across parts by construction. Autosize the bin
    # (rather than guessing a FILL against a forced-square bin) for the same reason box_unwrap does.
    total = sum(areas)
    scale = [math.sqrt(max(a, 1e-6) / total / max(uw * uh, 1e-6)) for a, (_, _, uw, uh) in zip(areas, bboxes)]
    rects_wh = [(uw * s, uh * s) for (_, _, uw, uh), s in zip(bboxes, scale)]
    placed, bin_w, bin_h = guillotine_pack_autosize(rects_wh)
    if not placed:
        raise RuntimeError(f"guillotine_pack: could not fit {len(objs)} parts into the atlas")
    fit = 0.995 / max(bin_w, bin_h)
    placed = [(x * fit, y * fit, w * fit, h * fit) for x, y, w, h in placed]
    if broken_collide and len(placed) > 1:
        placed[1] = placed[0]  # deliberately collide part[1]'s cell with part[0]'s -> real UV overlap
    report = []
    for o, area, (minu, minv, uw, uh), rect in zip(objs, areas, bboxes, placed):
        rx, ry, rw, rh = rect
        mx, my = margin_frac * rw, margin_frac * rh
        ix, iy, iw, ih = rx + mx, ry + my, rw - 2 * mx, rh - 2 * my
        layer = o.data.uv_layers[layer_name]
        for loop in layer.data:
            u, v = loop.uv
            nu = (u - minu) / uw if uw > 1e-9 else 0.5
            nv = (v - minv) / uh if uh > 1e-9 else 0.5
            loop.uv = (ix + nu * iw, iy + nv * ih)
        texel_density = ATLAS_RES * math.sqrt(max(rw * rh, 1e-9)) / math.sqrt(max(area, 1e-9))
        report.append({"part": o.name, "area_m2": round(area, 4), "rect": [round(c, 5) for c in rect],
                        "uv_bbox_aspect": round(uw / uh, 3) if uh > 1e-9 else None,
                        "texel_density_px_per_m": round(texel_density, 1)})
    return report


uv0_report = pack_atlas(paint_objs, "UV0", margin_frac=0.05, broken_collide=BROKEN)
uv1_report = pack_atlas(paint_objs, "UV1", margin_frac=0.08, broken_collide=False)
densities = [r["texel_density_px_per_m"] for r in uv0_report]
texel_consistency = {"uv0_min": min(densities), "uv0_max": max(densities),
                      "uv0_ratio_max_over_min": round(max(densities) / min(densities), 3)}

# Non-paint parts still need SOME UV0 (glTF wants it if any material samples a texture); give them a
# trivial per-object smart-project so they round-trip cleanly, but they are NOT part of the shared
# paint atlas / mask texture (out of scope for this spike; see REPORT.md).
for o in scene.objects:
    if o.type == "MESH" and o.name not in PAINT_PARTS and "UV0" not in o.data.uv_layers:
        box_unwrap(o, "UV0")

lap("uv_pack")

# ---------------------------------------------------------------- bakes (Cycles CPU)
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.device = "CPU"

bake_errors = {}


def select_only(objs):
    for s in scene.objects: s.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def add_bake_target(material, image):
    nt = material.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    for n in nt.nodes: n.select = False
    tex.select = True
    nt.nodes.active = tex
    return tex


def bake_shared(objs, uv_layer_name, image, bake_type, label):
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers[uv_layer_name]
    select_only(objs)
    t0 = time.time()
    try:
        bpy.ops.object.bake(type=bake_type)
        TIMINGS[f"bake_{label}"] = round(time.time() - t0, 2)
    except Exception as e:
        bake_errors[label] = str(e)
    image.filepath_raw = os.path.join(OUT, f"{image.name}.png")
    image.file_format = "PNG"
    image.save()


suffix = "_broken" if BROKEN else ("_legacyuv" if LEGACY_SMART_PROJECT else "")
paint_mat = M["paint"]
ao_img = bpy.data.images.new(f"bake_ao_uv1{suffix}", ATLAS_RES, ATLAS_RES, alpha=False)
curv_img = bpy.data.images.new(f"bake_curvature_uv1{suffix}", ATLAS_RES, ATLAS_RES, alpha=False)
norm_img = bpy.data.images.new(f"normal_map_uv0{suffix}", ATLAS_RES, ATLAS_RES, alpha=False)
norm_img.colorspace_settings.name = "Non-Color"
norm_img.generated_color = (0.5, 0.5, 1.0, 1.0)
norm_img.pixels[:] = [0.5, 0.5, 1.0, 1.0] * (ATLAS_RES * ATLAS_RES)

# --- AO, via UV1, shared image across all paint parts
tex_node = add_bake_target(paint_mat, ao_img)
bake_shared(paint_objs, "UV1", ao_img, "AO", "ao")
paint_mat.node_tree.nodes.remove(tex_node)

# --- curvature (pointiness) via a temporary Emission override, baked as EMIT, via UV1
nt = paint_mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
geo = nt.nodes.new("ShaderNodeNewGeometry")
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.44
ramp.color_ramp.elements[1].position = 0.56
nt.links.new(geo.outputs["Pointiness"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
prev_strength = bsdf.inputs["Emission Strength"].default_value
bsdf.inputs["Emission Strength"].default_value = 1.0
tex_node = add_bake_target(paint_mat, curv_img)
bake_shared(paint_objs, "UV1", curv_img, "EMIT", "curvature")
bsdf.inputs["Emission Strength"].default_value = prev_strength
nt.links.remove(nt.links[len(nt.links) - 1]) if False else None
for link in list(nt.links):
    if link.to_socket == bsdf.inputs["Emission Color"]:
        nt.links.remove(link)
nt.nodes.remove(geo); nt.nodes.remove(ramp); nt.nodes.remove(tex_node)

# --- tangent-space normal, baked directly via UV0 (see REPORT.md: scalar AO/curvature are safely
# resampled UV1->UV0 by compose_mask.py; a tangent-space vector is not, so normal is baked straight
# at UV0 to avoid that problem entirely)
tex_node = add_bake_target(paint_mat, norm_img)
bake_shared(paint_objs, "UV0", norm_img, "NORMAL", "normal")
paint_mat.node_tree.nodes.remove(tex_node)

lap("bakes")

# ---------------------------------------------------------------- export interim GLB (no mask texture yet)
glb = os.path.join(OUT, f"cruz_missile_interim{suffix}.glb")
for s in scene.objects: s.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True,
                          export_apply=False, use_selection=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"cruz_missile{suffix}.blend"))
lap("export")

tri = 0
for o in scene.objects:
    if o.type == "MESH":
        o.data.calc_loop_triangles(); tri += len(o.data.loop_triangles)

sidecar = {
    "contract": "jj.vehicle.v0-spike.textures-uv",
    "id": "cruz-missile" + suffix,
    "display_name": "Cruz Missile (textures/UV spike)",
    "units": "m", "forward": "+Y", "up": "+Z",
    "broken_overlap_variant": BROKEN,
    "paint_parts": PAINT_PARTS,
    "uv0_atlas_report": uv0_report,
    "uv1_atlas_report": uv1_report,
    "texel_density_consistency": texel_consistency,
    "atlas_resolution": ATLAS_RES,
    "materials": sorted(m.name for m in bpy.data.materials),
    "triangles_total": tri,
    "bake_images": {"ao_uv1": f"bake_ao_uv1{suffix}.png", "curvature_uv1": f"bake_curvature_uv1{suffix}.png",
                     "normal_uv0": f"normal_map_uv0{suffix}.png"},
    "bake_errors": bake_errors,
    "timings_s": TIMINGS,
    "provenance": {"blender": bpy.app.version_string, "script": "spikes/art-pipeline/A-textures-uv/build_textured_car.py"},
}
with open(os.path.join(OUT, f"cruz_missile_interim{suffix}.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)
print("EXPORTED", glb, "tris", tri, "timings", TIMINGS, "bake_errors", bake_errors)
print("TEXEL_CONSISTENCY", texel_consistency)
