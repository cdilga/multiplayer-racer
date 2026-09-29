"""Spike B: render LOD0/1/2 at the pixel size each would actually be used at, for visual comparison.

Run:  blender -b -P render_lod_compare.py -- <out_dir>

Camera distance per LOD is chosen so the car's bounding box occupies approximately the requested
frame height in pixels (LOD0 full/close view ~300px -- roughly the own-car size measured at N=4/12
in the Part-A capture; LOD1 ~120px per the task brief's medium-tile hint; LOD2 ~40px, the plan's
LOD-floor budget "budget >= 40 px" from Part-A). Camera framing/lighting held constant across the
three renders so the only variable is geometry (and, for LOD1/2, the missing dent shape key / dropped
decals) -- straight apples-to-apples.
"""
import bpy, os, sys, math
import mathutils
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")

TARGETS = [(0, "cruz_missile.lod0.glb", 300), (1, "cruz_missile.lod1.glb", 120), (2, "cruz_missile.lod2.glb", 40)]
FRAME = 512  # square render, car occupies TARGET px of this frame height


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "CYCLES"
    scene.render.resolution_x = FRAME
    scene.render.resolution_y = FRAME
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.85, 0.78, 0.66, 1)
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    scene.collection.objects.link(sun)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam, cam_data


def bbox_corners_world(objs):
    corners = []
    for o in objs:
        for corner in o.bound_box:
            corners.append(o.matrix_world @ mathutils.Vector(corner))
    return corners


def projected_height_px(scene, cam, corners, res_x, res_y):
    ys = []
    for c in corners:
        co = world_to_camera_view(scene, cam, c)
        ys.append(co.y)
    return (max(ys) - min(ys)) * res_y


def render_one(level, glb, target_px, out_png):
    scene, cam, cam_data = setup_scene()
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = [o for o in scene.objects if o.type == "MESH"]
    if not imported:
        print("NO MESHES for", glb)
        return None
    corners = bbox_corners_world(imported)
    bmin = mathutils.Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    bmax = mathutils.Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    center = (bmin + bmax) / 2

    cam_data.lens = 85  # longer lens = flatter perspective, closer to an in-game chase/telephoto framing
    cam_data.sensor_width = 36
    scene.render.resolution_x = FRAME
    scene.render.resolution_y = FRAME

    # rear-3/4 chase-cam-style direction (mostly behind, a bit above and to the side), matching how
    # own-car framing is composed in ingame.html's chase camera rather than a studio product angle.
    direction_unit = mathutils.Vector((0.32, -0.85, 0.33)).normalized()
    look_target = center + mathutils.Vector((0, 0, 0.25))

    def place(dist):
        cam.location = center + direction_unit * dist
        aim = look_target - cam.location
        cam.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
        bpy.context.view_layer.update()

    # binary-search the camera distance so the full projected bbox height == target_px, using the
    # actual camera projection (no paraxial approximation -- accurate for any FOV/angle).
    lo, hi = 0.3, 300.0
    for _ in range(40):
        mid = (lo + hi) / 2
        place(mid)
        h = projected_height_px(scene, cam, corners, FRAME, FRAME)
        if h > target_px:
            lo = mid
        else:
            hi = mid
    place((lo + hi) / 2)
    final_h = projected_height_px(scene, cam, corners, FRAME, FRAME)

    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    tri = 0
    for o in imported:
        o.data.calc_loop_triangles()
        tri += len(o.data.loop_triangles)
    print(f"LOD{level} rendered {out_png} target={target_px}px got={final_h:.1f}px dist={(lo+hi)/2:.2f} tris={tri}")
    return {"level": level, "png": out_png, "target_px": target_px, "measured_px": round(final_h, 1), "tris": tri}


results = []
for level, glb, target_px in TARGETS:
    out_png = os.path.join(OUT, f"lod_compare_{level}.png")
    r = render_one(level, os.path.join(OUT, glb), target_px, out_png)
    if r:
        results.append(r)

print("DONE", results)
