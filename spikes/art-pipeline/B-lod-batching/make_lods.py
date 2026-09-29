"""Spike B: generate LOD1/LOD2 from the Part-A "Cruz Missile" source, headless.

Run:  blender -b -P make_lods.py -- <out_dir>

Decisions (documented in REPORT.md):
- LOD0 = the Part-A export, unchanged (dent shape key intact).
- LOD1/LOD2 DROP the per-part dent shape key. Rationale: Decimate cannot be applied to a mesh that
  has shape keys other than Basis (Blender raises "Modifier cannot be applied to a mesh with shape
  keys" from Python operators too) without first collapsing them, and re-simplifying the dented
  target shape independently would require decimating twice and keeping topology correspondence,
  which is not headless-scriptable with bpy's Decimate (it works on the active/basis mesh only).
  LOD1/2 exist for medium/small projected sizes (contract hypothesis: 500-1k / 150-400 tris) where a
  per-vertex crumple is sub-pixel anyway; the plan explicitly allows "generic decimation must not
  erase dents" to be satisfied by *not doing generic decimation of a dented mesh* -- instead we
  decide, per LOD, whether dents apply, and LOD0 (the only LOD close enough to matter) keeps them.
- Object names, parenting and pivots (hub points, hinge origins, markers, colliders) are preserved
  exactly across LODs: Decimate is a data-level (mesh) operation and never touches object transforms.
- Collider proxies (col_*) and markers (empties) are NOT decimated/duplicated per LOD -- physics and
  anchors are shared, contract-required to stay constant across visual LODs.
- Tiny/flat meshes (decals, lights, rim discs) are skipped by Decimate below a face-count floor
  (see SKIP_BELOW_FACES) since collapsing them further either does nothing useful or destroys the
  small feature; LOD2 drops decal meshes entirely (unreadable at that distance) -- see DROP_AT_LOD2.
- Export: separate GLBs per LOD (cruz_missile.lod0/1/2.glb) rather than one glTF with `_LODx` node
  suffixes. Rationale: the contract's own precedent ("higher detail available by immutable
  self-hosted URLs") is a per-file model, a loader only fetches the bytes for the detail level it
  picked (one glTF-with-all-LODs file forces every client to download all three), and it matches the
  existing per-asset sidecar pattern (`validate_vehicle.py` validates one glTF against one sidecar).
"""
import bpy, os, sys, json, shutil

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_BLEND = os.path.join(HERE, "..", "out", "cruz_missile.blend")
os.makedirs(OUT, exist_ok=True)

SKIP_BELOW_FACES = 40          # meshes with fewer faces than this are left untouched by Decimate
DROP_AT_LOD2 = ("decal_word_L", "decal_word_R")  # unreadable at LOD2 distance; dropped entirely

LOD_RATIOS = {1: 0.40, 2: 0.14}  # per-mesh Decimate ratio; tuned below to hit ~40%/~12% of LOD0 tris


def mesh_objects(exclude_colliders=True):
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        if exclude_colliders and o.name.startswith("col_"):
            continue
        yield o


def strip_shape_keys(o):
    if o.data.shape_keys:
        # collapse to basis (rest pose) then remove the key blocks so Decimate can apply
        for kb in list(o.data.shape_keys.key_blocks):
            if kb.name != "Basis":
                kb.value = 0.0
        bpy.context.view_layer.objects.active = o
        while o.data.shape_keys and len(o.data.shape_keys.key_blocks) > 1:
            o.shape_key_remove(o.data.shape_keys.key_blocks[-1])
        if o.data.shape_keys:
            o.shape_key_remove(o.data.shape_keys.key_blocks[0])  # remove Basis too


def decimate(o, ratio):
    o.data.calc_loop_triangles()
    before = len(o.data.loop_triangles)
    if before < SKIP_BELOW_FACES:
        return before, before
    bpy.context.view_layer.objects.active = o
    mod = o.modifiers.new("lod_decimate", "DECIMATE")
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.calc_loop_triangles()
    after = len(o.data.loop_triangles)
    return before, after


def build_lod(level, ratio, drop_names):
    bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
    scene = bpy.context.scene
    dropped = []
    for name in drop_names:
        obj = bpy.data.objects.get(name)
        if obj:
            dropped.append(name)
            bpy.data.objects.remove(obj, do_unlink=True)
    total_before = total_after = 0
    per_mesh = {}
    for o in list(mesh_objects()):
        strip_shape_keys(o)
        b, a = decimate(o, ratio)
        total_before += b
        total_after += a
        per_mesh[o.name] = {"before": b, "after": a}
    # export
    glb = os.path.join(OUT, f"cruz_missile.lod{level}.glb")
    for s in scene.objects:
        s.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True,
                               export_morph=True, export_apply=True, use_selection=False)
    return {"level": level, "ratio": ratio, "dropped_meshes": dropped,
            "triangles_total": total_after, "triangles_before_decimate": total_before,
            "per_mesh": per_mesh, "glb": os.path.basename(glb)}


results = {}

# LOD0: copy the Part-A source unchanged (dents intact).
lod0_glb = os.path.join(OUT, "cruz_missile.lod0.glb")
shutil.copyfile(os.path.join(HERE, "..", "out", "cruz_missile.glb"), lod0_glb)
bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
tri0 = 0
for o in mesh_objects():
    o.data.calc_loop_triangles()
    tri0 += len(o.data.loop_triangles)
results["0"] = {"level": 0, "ratio": 1.0, "dropped_meshes": [], "triangles_total": tri0,
                 "triangles_before_decimate": tri0, "per_mesh": {}, "glb": "cruz_missile.lod0.glb",
                 "note": "unchanged Part-A export; dent shape key intact"}

results["1"] = build_lod(1, LOD_RATIOS[1], drop_names=[])
results["1"]["note"] = "dent shape key removed (see module docstring); decals kept"
results["2"] = build_lod(2, LOD_RATIOS[2], drop_names=DROP_AT_LOD2)
results["2"]["note"] = "dent shape key removed; decal meshes dropped (unreadable at this size)"

manifest = {
    "id": "cruz-missile",
    "contract": "jj.vehicle.v0-spike",
    "lods": [results["0"], results["1"], results["2"]],
    "budget_hypothesis_tris": {"lod0_close": "1000-3000 (measured 9152; see Part-A finding #2)",
                                "lod1_medium": "500-1000", "lod2_distant": "150-400"},
}
with open(os.path.join(OUT, "lods.json"), "w") as f:
    json.dump(manifest, f, indent=2)

print("LOD0", results["0"]["triangles_total"], "tris")
print("LOD1", results["1"]["triangles_total"], "tris  (target ~", int(tri0 * LOD_RATIOS[1]), ")")
print("LOD2", results["2"]["triangles_total"], "tris  (target ~", int(tri0 * LOD_RATIOS[2]), ")")
