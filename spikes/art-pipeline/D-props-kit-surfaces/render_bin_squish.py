"""Render a Blender-side contact sheet of the wheelie bin's crush damage ladder (evidence for the
owner-requested "squished" damage state). Reuses the same Workbench flat-color approach as
render_contact_sheets.py (Cycles/EEVEE wash the green body material out on this machine for reasons
unrelated to the asset data -- see that script's comment).

Run: blender -b -P render_bin_squish.py -- <out_dir>
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.view_settings.view_transform = "Standard"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.55, 0.58, 0.62)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def is_collider(o):
    return o.name.startswith("col_") or o.get("jj_collider")


def strip_colliders():
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH" and is_collider(o)]:
        bpy.data.objects.remove(o, do_unlink=True)


def frame_and_shoot(cam, objs, dist_mul, out_path, elev=22, azim=35):
    # Use the DEPSGRAPH-EVALUATED mesh (post shape-key deformation) for framing, not o.bound_box
    # (which is always the undeformed basis shape). Framing off the undeformed box while the real
    # geometry is deformed (e.g. a crush shape key at value 1.0) can put the camera too close to the
    # actual deformed geometry, producing extreme perspective stretching -- this is exactly what
    # happened here on the first pass (the lid looked like a huge detached plank; the shape-key data
    # itself was correct the whole time, confirmed by evaluating the mesh directly).
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        o_eval = o.evaluated_get(dg)
        me = o_eval.to_mesh()
        mw = o_eval.matrix_world
        for v in me.vertices:
            wc = mw @ v.co
            lo = Vector(min(lo[i], wc[i]) for i in range(3))
            hi = Vector(max(hi[i], wc[i]) for i in range(3))
        o_eval.to_mesh_clear()
    center = (lo + hi) / 2
    span = max((hi - lo)[i] for i in range(3))
    dist = max(span, 0.3) * dist_mul
    ang_e, ang_a = math.radians(elev), math.radians(azim)
    cam.location = center + Vector((math.cos(ang_a) * math.cos(ang_e), math.sin(ang_a) * math.cos(ang_e), math.sin(ang_e))) * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)


def set_crush(scene_objs, morph_name, value):
    for o in scene_objs:
        if o.type == "MESH" and o.data.shape_keys:
            kb = o.data.shape_keys.key_blocks.get(morph_name)
            if kb:
                kb.value = value


STATES = [
    ("intact", None, 0.0, "wheelie_bin_intact.glb"),
    ("dented (top 0.5)", "bin_crush_top", 0.5, "wheelie_bin_intact.glb"),
    ("squished (top 1.0)", "bin_crush_top", 1.0, "wheelie_bin_intact.glb"),
    ("squished (side 1.0)", "bin_crush_side", 1.0, "wheelie_bin_intact.glb"),
]

for label, morph, value, glb in STATES:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = setup_render()
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, glb))
    strip_colliders()
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if morph:
        set_crush(objs, morph, value)
    safe = label.split(" ")[0].replace("(", "").replace(")", "")
    out_path = os.path.join(OUT, f"render_bin_squish_{safe}_{morph or 'none'}.png")
    frame_and_shoot(cam, objs, 2.4, out_path)
    print("RENDERED", label, "->", out_path)

# also render the fractured+debris state for the full ladder contact sheet
bpy.ops.wm.read_factory_settings(use_empty=True)
cam = setup_render()
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "wheelie_bin_fractured.glb"))
strip_colliders()
frac_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
import random
random.seed(1)
for o in frac_objs:
    o.location += Vector((random.uniform(-0.4, 0.4), random.uniform(-0.4, 0.4), random.uniform(0, 0.15)))
frame_and_shoot(cam, frac_objs, 2.6, os.path.join(OUT, "render_bin_squish_fractured_none.png"))

print("DONE")
