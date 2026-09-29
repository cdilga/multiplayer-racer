"""Spike A (textures & UVs): reopen the .blend saved by build_textured_car.py, wire the mask.png
(composed by compose_mask.py, PIL) and the UV0 normal map into jj_paint via explicit UV Map nodes
(never "whichever UV happens to be active" -- the contract requires UV0 specifically), and export
the FINAL textured GLB with everything embedded.

Run: blender -b -P attach_mask.py -- out [--broken-overlap]
"""
import bpy, json, os, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
BROKEN = "--broken-overlap" in argv
LEGACY = "--legacy-smart-project" in argv
FULL = "--full" in argv
suffix = "_broken" if BROKEN else ("_legacyuv" if LEGACY else ("_full" if FULL else ""))

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, f"cruz_missile{suffix}.blend"))
scene = bpy.context.scene

mask_path = os.path.join(OUT, f"mask{suffix}.png")
norm_path = os.path.join(OUT, f"normal_map_uv0{suffix}.png")
mask_img = bpy.data.images.load(mask_path, check_existing=True)
norm_img = bpy.data.images.load(norm_path, check_existing=True)
norm_img.colorspace_settings.name = "Non-Color"

mat = bpy.data.materials["jj_paint"]
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]

uv0_node = nt.nodes.new("ShaderNodeUVMap"); uv0_node.uv_map = "UV0"
mask_tex = nt.nodes.new("ShaderNodeTexImage"); mask_tex.image = mask_img; mask_tex.label = "jj_mask (RGBA)"
nt.links.new(uv0_node.outputs["UV"], mask_tex.inputs["Vector"])
nt.links.new(mask_tex.outputs["Color"], bsdf.inputs["Base Color"])  # R,G,B preview (runtime shader reinterprets channels)

norm_tex = nt.nodes.new("ShaderNodeTexImage"); norm_tex.image = norm_img; norm_tex.label = "jj_normal (UV0)"
nt.links.new(uv0_node.outputs["UV"], norm_tex.inputs["Vector"])
normal_map_node = nt.nodes.new("ShaderNodeNormalMap"); normal_map_node.uv_map = "UV0"
nt.links.new(norm_tex.outputs["Color"], normal_map_node.inputs["Color"])
nt.links.new(normal_map_node.outputs["Normal"], bsdf.inputs["Normal"])

mat["jj_mask_texture"] = os.path.basename(mask_path)
mat["jj_mask_uv_set"] = "UV0"
mat["jj_normal_texture"] = os.path.basename(norm_path)
mat["jj_normal_uv_set"] = "UV0"

glb = os.path.join(OUT, f"cruz_missile_textured{suffix}.glb")
for s in scene.objects: s.select_set(True)
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True,
                          export_apply=False, use_selection=False)

interim_sidecar = json.load(open(os.path.join(OUT, f"cruz_missile_interim{suffix}.asset.json")))
mask_info = json.load(open(os.path.join(OUT, f"mask{suffix}.json")))
sidecar = dict(interim_sidecar)
sidecar["id"] = "cruz-missile-textured" + suffix
sidecar["mask_texture"] = mask_info
sidecar["textures"] = {
    "mask": {"file": mask_info["mask_texture"], "size": mask_info["size"], "uv_set": "UV0",
             "channels": mask_info["channels"]},
    "normal": {"file": os.path.basename(norm_path), "size": [1024, 1024], "uv_set": "UV0",
               "note": "baked directly at UV0 (not transferred from UV1) -- tangent-space vectors "
                       "aren't safe to resample between two different UV parameterizations without "
                       "re-deriving the tangent basis; scalar AO/curvature (the mask's B channel) are."},
}
with open(os.path.join(OUT, f"cruz_missile_textured{suffix}.asset.json"), "w") as f:
    json.dump(sidecar, f, indent=2)
print("FINAL EXPORT", glb)
