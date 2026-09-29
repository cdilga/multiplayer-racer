"""blender -b -P render_cruze.py -- out : build both variants, render ortho side + 3/4 + dented."""
import bpy, math, os, sys, runpy
from mathutils import Vector
HERE = "/Users/cdilga/Documents/dev/multiplayer-racer/spikes/art-pipeline"
OUT = os.path.join(HERE, "out")
runpy.run_path(os.path.join(HERE, "model_cruze_from_refs.py"))
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x, sc.render.resolution_y = 1536, 1024
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1); sc.view_settings.view_transform = "Standard"
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(55), 0, math.radians(30))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
ref = bpy.data.objects["CRUZE_REF_chassis"]; ch = bpy.data.objects["CRUZE_CHUNKY_chassis"]
def hide(o, h):
    for x in [o] + list(o.children_recursive): x.hide_render = h
def shot(fn, target, pos, ortho=None):
    cam.data.type = "ORTHO" if ortho else "PERSP"
    if ortho: cam.data.ortho_scale = ortho
    cam.location = pos; cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUT, fn); bpy.ops.render.render(write_still=True)
for car, tag in ((ref, "ref"), (ch, "chunky")):
    hide(ref, car is not ref); hide(ch, car is not ch)
    x = car.location.x
    shot(f"cruze_{tag}_side.png", (x, 0, 0.75), (x - 20, 0, 0.75), ortho=5.2)   # left side, car faces -Y? front +Y
    shot(f"cruze_{tag}_34.png", (x, 0, 0.7), (x - 6, 6, 3.0))
hide(ref, True); hide(ch, False)
for o in ch.children_recursive + [ch]:
    if o.type == "MESH" and o.data.shape_keys:
        for kb in o.data.shape_keys.key_blocks[1:]: kb.value = 1
shot("cruze_chunky_34_dented.png", (ch.location.x, 0, 0.7), (ch.location.x - 6, 6, 3.0))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "cruze.blend"))
print("RENDERED")
