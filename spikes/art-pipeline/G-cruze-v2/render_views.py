"""Workbench renders of the Cruz Missile v2 for visual review.

Run:  blender -b <out/cruze_v2.blend> -P render_views.py -- <out_dir> [prefix]
Views: hero (3/4 front, like the concept), hero_rear, side, front, rear, top, and a 40 px thumbnail.
"""
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
PREFIX = argv[1] if len(argv) > 1 else "v2"
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.show_object_outline = True
sh.object_outline_color = (0.05, 0.04, 0.04)
sh.show_cavity = True
sh.cavity_type = "WORLD"
sh.show_specular_highlight = True
scene.display.render_aa = "8"
scene.render.film_transparent = False
scene.world = scene.world or bpy.data.worlds.new("w")
sh.background_type = "VIEWPORT"
sh.background_color = (0.96, 0.93, 0.86)
scene.render.resolution_x, scene.render.resolution_y = 1200, 800

for e in [o for o in scene.objects if o.type == "EMPTY"]:
    e.hide_render = True

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, 0, 0.9))


def shoot(name, loc, ortho=None, res=(1200, 800), lens=50):
    cam.location = Vector(loc)
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    else:
        cam_data.type = "PERSP"
        cam_data.lens = lens
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = os.path.join(OUT, f"{PREFIX}_{name}.png")
    bpy.ops.render.render(write_still=True)


shoot("hero", (5.2, 6.4, 3.4), lens=45)          # 3/4 front-right, elevated (concept angle)
shoot("hero_left", (-5.2, 6.4, 3.4), lens=45)
shoot("hero_rear", (-5.0, -6.4, 3.2), lens=45)
shoot("side", (12, 0, 0.9), ortho=5.2)
shoot("front", (0, 12, 0.9), ortho=3.2, res=(900, 800))
shoot("rear", (0, -12, 0.9), ortho=3.2, res=(900, 800))
cam.location = Vector((0, 0, 12)); cam.rotation_euler = (0, 0, -math.pi / 2)
cam_data.type = "ORTHO"; cam_data.ortho_scale = 4.6
scene.render.resolution_x, scene.render.resolution_y = 1200, 800
scene.render.filepath = os.path.join(OUT, f"{PREFIX}_top.png")
bpy.ops.render.render(write_still=True)
sh.show_cavity = False
shoot("thumb40", (5.2, 6.4, 3.4), lens=45, res=(60, 40))
