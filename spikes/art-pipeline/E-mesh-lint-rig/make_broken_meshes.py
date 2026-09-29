"""Build 4 deliberately-broken single-object .blend fixtures to prove each mesh_lint check
fires on the defect it targets, plus one "clean" control cube that should pass.

Run:  blender -b -P make_broken_meshes.py -- <out_dir>
"""
import bpy, bmesh, os, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "broken")
os.makedirs(OUT, exist_ok=True)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def save(name):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{name}.blend"))
    print("wrote", name)


# ---------------------------------------------------------------- 0. clean control cube
fresh()
bpy.ops.mesh.primitive_cube_add(size=1.0)
o = bpy.context.active_object
o.name = o.data.name = "clean_cube"
o.data.materials.append(mat("jj_paint"))
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode="OBJECT")
save("00_clean_cube")

# ---------------------------------------------------------------- 1. flipped normals
fresh()
bpy.ops.mesh.primitive_cube_add(size=1.0)
o = bpy.context.active_object
o.name = o.data.name = "flipped_normals_cube"
o.data.materials.append(mat("jj_paint"))
bm = bmesh.new(); bm.from_mesh(o.data)
bmesh.ops.reverse_faces(bm, faces=bm.faces)  # flip every face -> inward-facing, negative signed volume
bm.to_mesh(o.data); bm.free()
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode="OBJECT")
save("01_flipped_normals")

# ---------------------------------------------------------------- 2. non-manifold hole
fresh()
bpy.ops.mesh.primitive_cube_add(size=1.0)
o = bpy.context.active_object
o.name = o.data.name = "holed_cube"
o.data.materials.append(mat("jj_paint"))
bm = bmesh.new(); bm.from_mesh(o.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[0]], context="FACES")  # remove one face -> open boundary, non-manifold edges
bm.to_mesh(o.data); bm.free()
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode="OBJECT")
save("02_nonmanifold_hole")

# ---------------------------------------------------------------- 3. overlapping duplicate face
fresh()
bpy.ops.mesh.primitive_cube_add(size=1.0)
o = bpy.context.active_object
o.name = o.data.name = "dup_face_cube"
o.data.materials.append(mat("jj_paint"))
bm = bmesh.new(); bm.from_mesh(o.data)
bm.faces.ensure_lookup_table()
f = bm.faces[0]
verts = [v.co.copy() for v in f.verts]
new_verts = [bm.verts.new(co) for co in verts]  # duplicate verts...
bm.faces.new(new_verts)                          # ...and a coincident duplicate face (z-fighting)
bm.to_mesh(o.data); bm.free()
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode="OBJECT")
save("03_overlapping_duplicate_face")

# ---------------------------------------------------------------- 4. unapplied negative scale
fresh()
bpy.ops.mesh.primitive_cube_add(size=1.0)
o = bpy.context.active_object
o.name = o.data.name = "negative_scale_cube"
o.data.materials.append(mat("jj_paint"))
bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode="OBJECT")
o.scale = (-1.0, 1.0, 1.0)  # left un-applied on purpose (flips winding/normals on export)
save("04_unapplied_negative_scale")

print("DONE")
