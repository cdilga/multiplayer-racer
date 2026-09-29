"""Render front/side/rear/3-quarter/top + a dented variant of the spike car. blender -b out/cruz_missile.blend -P render_contact_sheet.py -- out"""
import bpy, math, os, sys
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.film_transparent = False
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.93, 0.88, 0.8, 1)
scene.view_settings.view_transform = "Standard"

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
sun.data.energy = 4; sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 50
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("ground"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.75, 0.38, 0.2, 1)
ground.data.materials.append(gm)

target = Vector((0, 0, 0.8))
def shot(name, pos):
    cam.location = pos
    cam.rotation_euler = (target - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"view_{name}.png")
    bpy.ops.render.render(write_still=True)

views = {"front": (0, 9, 1.6), "side": (9, 0, 1.4), "rear": (0, -9, 1.6), "threequarter": (6.5, 6.5, 3.2), "top": (0.01, 0.01, 11)}
for n, p in views.items():
    shot(n, p)
# dented variant: every per-part dent shape key at full
for o in scene.objects:
    if o.type == "MESH" and o.data.shape_keys:
        for kb in o.data.shape_keys.key_blocks[1:]:
            kb.value = 1.0
shot("threequarter_dented", views["threequarter"])
print("RENDERED", scene.render.engine)
