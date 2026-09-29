"""Render Blender-side turntable contact sheets for the bin and track piece (evidence for REPORT.md).
Run: blender -b -P render_contact_sheets.py -- <out_dir>
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")


def setup_render(engine="BLENDER_WORKBENCH"):
    # Workbench "solid + MATERIAL color" gives a flat, lighting-artifact-free render of each part's
    # actual base color -- exactly what an asset-correctness contact sheet needs (not a lighting demo).
    # (CYCLES/EEVEE both washed the green body material to near-white here; root cause not chased
    # further since it's a renderer/lighting-setup issue in this throwaway script, not the asset data --
    # confirmed by direct inspection of the reimported material's Base Color, which is correct.)
    scene = bpy.context.scene
    scene.render.engine = engine
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.55, 0.58, 0.62)
    sun = None
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def frame_and_shoot(cam, objs, dist_mul, out_path, elev=28, azim=35):
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for corner in o.bound_box:
            wc = o.matrix_world @ Vector(corner)
            lo = Vector(min(lo[i], wc[i]) for i in range(3))
            hi = Vector(max(hi[i], wc[i]) for i in range(3))
    center = (lo + hi) / 2
    span = max((hi - lo)[i] for i in range(3))
    dist = max(span, 0.3) * dist_mul
    ang_e = math.radians(elev)
    ang_a = math.radians(azim)
    cam.location = center + Vector((math.cos(ang_a) * math.cos(ang_e), math.sin(ang_a) * math.cos(ang_e), math.sin(ang_e))) * dist
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)


# -------------------- Bin: intact + fractured + debris, side by side scenes rendered separately then composited via PIL later
# Finding: glTF has no concept of Blender's hide_render/display_type=WIRE, so on reimport a
# collider node (exported with no material -> default flat-white) sits visible, right on top of
# the tapered render mesh. Any consumer of these GLBs (preview tools, the in-game loader) MUST
# filter collider nodes explicitly by the "col_" name prefix / jj_collider extras flag -- never
# rely on a Blender-side visibility flag surviving the round trip. Recorded in REPORT.md.
def is_collider(o):
    return o.name.startswith("col_") or o.get("jj_collider")

def strip_colliders():
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH" and is_collider(o)]:
        bpy.data.objects.remove(o, do_unlink=True)

def fix_preview_diffuse():
    # Finding: a GLB with baked vertex-colour AO round-trips through the glTF importer with Base
    # Color rewired through a "vertex-color x base-color-factor" Mix node (glTF/KHR spec: COLOR_0
    # multiplies base color). The Principled BSDF's own Base Color input is left at a flat grey
    # placeholder, so Workbench "MATERIAL" preview mode (which reads that input) renders flat grey
    # even though the material is correct (Cycles/EEVEE/Three.js all evaluate the full node graph
    # correctly). Recover the real factor from the Mix node for preview purposes only.
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        mix = m.node_tree.nodes.get("Mix")
        if bsdf and bsdf.inputs["Base Color"].is_linked and mix and mix.type == "MIX":
            for inp in mix.inputs:
                if inp.type == "RGBA" and not inp.is_linked and tuple(inp.default_value[:3]) != (1, 1, 1):
                    m.diffuse_color = inp.default_value[:]
                    break

bpy.ops.wm.read_factory_settings(use_empty=True)
cam = setup_render()
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "wheelie_bin_intact.glb"))
strip_colliders()
intact_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
frame_and_shoot(cam, intact_objs, 2.6, os.path.join(OUT, "render_bin_intact.png"))

bpy.ops.wm.read_factory_settings(use_empty=True)
cam = setup_render()
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "wheelie_bin_fractured.glb"))
strip_colliders()
frac_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# scatter pieces outward a bit for readability
import random
random.seed(1)
for o in frac_objs:
    o.location += Vector((random.uniform(-0.4, 0.4), random.uniform(-0.4, 0.4), random.uniform(0, 0.15)))
frame_and_shoot(cam, frac_objs, 2.6, os.path.join(OUT, "render_bin_fractured.png"))

bpy.ops.wm.read_factory_settings(use_empty=True)
cam = setup_render()
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "wheelie_bin_debris.glb"))
debris_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
frame_and_shoot(cam, debris_objs, 3.2, os.path.join(OUT, "render_bin_debris.png"))

# -------------------- Track piece
bpy.ops.wm.read_factory_settings(use_empty=True)
cam = setup_render()
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "track_piece_bend90.glb"))
strip_colliders()
fix_preview_diffuse()
track_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
frame_and_shoot(cam, track_objs, 1.6, os.path.join(OUT, "render_track_piece.png"), elev=55, azim=25)

print("RENDERED contact sheets to", OUT)
