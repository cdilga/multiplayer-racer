"""Render one evidence still of a rigged asset posed at specific joint angles (Workbench, fast,
headless). Used to build the rig contact sheet.

Usage:
  blender -b <file.blend> -P render_rig_pose.py -- <out.png> <cam_loc_x,y,z> <cam_target_x,y,z> \
      part1=angle1[,angle2 for compound steer+spin] part2=angle ...

For a "compound"-joint part (Cruz Missile front wheels), pass steer,spin e.g. wheel_FL=35,0
For a "steer"-joint Empty (dirt bike), pass angle only, e.g. steer_front=40
"""
import bpy, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0]
cam_loc = Vector([float(x) for x in argv[1].split(",")])
cam_target = Vector([float(x) for x in argv[2].split(",")])
pose_args = argv[3:]

scene = bpy.context.scene

for pa in pose_args:
    part, vals = pa.split("=")
    angles = [float(v) for v in vals.split(",")]
    obj = bpy.data.objects[part]
    joint = obj["jj_joint"]
    base = obj.matrix_local.copy()
    if joint == "hinge":
        axis = obj["jj_axis"]
        R = Matrix.Rotation(math.radians(angles[0]), 4, Vector(axis).normalized())
        obj.matrix_local = base @ R
    elif joint == "spin":
        axis = obj["jj_axis"]
        R = Matrix.Rotation(math.radians(angles[0]), 4, Vector(axis).normalized())
        obj.matrix_local = base @ R
    elif joint == "steer":
        axis = obj["jj_axis"]
        R = Matrix.Rotation(math.radians(angles[0]), 4, Vector(axis).normalized())
        obj.matrix_local = base @ R
    elif joint == "compound":
        steer_deg = angles[0]
        spin_deg = angles[1] if len(angles) > 1 else 0.0
        Rs = Matrix.Rotation(math.radians(steer_deg), 4, Vector(obj["jj_axis_steer"]).normalized())
        Rp = Matrix.Rotation(math.radians(spin_deg), 4, Vector(obj["jj_axis_spin"]).normalized())
        obj.matrix_local = base @ Rs @ Rp

bpy.context.view_layer.update()

# sync each material's legacy viewport diffuse_color from its Principled BSDF Base Color so
# Workbench "Material" shading (which reads diffuse_color, not the node tree) shows real hues
for m in bpy.data.materials:
    if m.use_nodes:
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            m.diffuse_color = bsdf.inputs["Base Color"].default_value

# ---------------------------------------------------------------- camera + workbench render
cam_data = bpy.data.cameras.new("EvidenceCam")
cam_obj = bpy.data.objects.new("EvidenceCam", cam_data)
scene.collection.objects.link(cam_obj)
cam_obj.location = cam_loc
direction = (cam_target - cam_loc)
rot_quat = direction.to_track_quat('-Z', 'Y')
cam_obj.rotation_euler = rot_quat.to_euler()
scene.camera = cam_obj

# a couple of area/sun lights so Workbench "Solid" reads shape, or use STUDIO lighting
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 900
scene.render.resolution_y = 675
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("RENDERED", OUT)
