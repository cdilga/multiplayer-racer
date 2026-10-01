#!/usr/bin/env python3
"""Generates one broken fixture per validate_asset.py rule from a known-good GLB+sidecar.

Each fixture is a full copy of the good asset (3 LOD GLBs + sidecar) in its own directory
under fixtures/broken/<fixture_name>/, with exactly one targeted mutation applied so that
exactly one rule_id is expected to FAIL (collateral FAILs on OTHER rules are tolerated --
e.g. dropping a required node also perturbs nodes.same_across_lods -- but the fixture's
named rule must always appear). fixtures/expected.json records, per fixture, the rule_id
test_validator.sh must see among the FAIL lines.

Run: python3 make_broken_fixtures.py <good_dir> <out_dir>
  e.g. python3 make_broken_fixtures.py fixtures/good fixtures/broken
"""
import json
import os
import shutil
import struct
import sys

GOOD_BASENAME = "good"  # good.lod{0,1,2}.glb + good.asset.json


# ---------------------------------------------------------------------------
# Minimal mutable GLB load/save + FLOAT accessor read/write (stdlib only).
# Mirrors validate_asset.py's parsing but keeps the binary chunk mutable.
# ---------------------------------------------------------------------------

def load_glb_parts(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF"
    off = 12
    json_chunk, bin_chunk = None, None
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8:off + 8 + clen]
        if ctype == b"JSON":
            json_chunk = chunk
        elif ctype == b"BIN\x00":
            bin_chunk = bytearray(chunk)
        off += 8 + clen
    return json.loads(json_chunk), bin_chunk


def write_glb(path, gltf, bin_bytes):
    json_bytes = json.dumps(gltf).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "
    bin_bytes = bytes(bin_bytes)
    while len(bin_bytes) % 4 != 0:
        bin_bytes += b"\x00"
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
        f.write(bin_bytes)


_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_float_vecs(gltf, bin_bytes, acc_idx):
    """Returns (vecs, base_offset, stride, ncomp) for an all-FLOAT accessor -- true for
    every accessor build_good_asset.py writes (positions/UVs/morph deltas)."""
    acc = gltf["accessors"][acc_idx]
    assert acc["componentType"] == 5126, "fixture generator only handles FLOAT accessors"
    bv = gltf["bufferViews"][acc["bufferView"]]
    ncomp = _NCOMP[acc["type"]]
    stride = bv.get("byteStride") or ncomp * 4
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    vecs = [struct.unpack_from("<" + "f" * ncomp, bin_bytes, base + i * stride)
            for i in range(acc["count"])]
    return vecs, base, stride, ncomp


def write_float_vecs(bin_bytes, vecs, base, stride, ncomp):
    for i, v in enumerate(vecs):
        struct.pack_into("<" + "f" * ncomp, bin_bytes, base + i * stride, *v)


def find_node(gltf, name):
    for i, n in enumerate(gltf["nodes"]):
        if n.get("name") == name:
            return i, n
    raise KeyError(name)


def find_mesh_index_by_node_name(gltf, name):
    _, n = find_node(gltf, name)
    return n["mesh"]


# ---------------------------------------------------------------------------
# Fixture harness
# ---------------------------------------------------------------------------

class Fixture:
    def __init__(self, name, rule_id, description, apply_fn, lods=(0, 1, 2), sidecar=False):
        self.name = name
        self.rule_id = rule_id
        self.description = description
        self.apply_fn = apply_fn
        self.lods = lods           # which LOD glbs the mutation touches
        self.mutate_sidecar = sidecar


def copy_good(good_dir, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    for fname in (f"{GOOD_BASENAME}.lod0.glb", f"{GOOD_BASENAME}.lod1.glb",
                  f"{GOOD_BASENAME}.lod2.glb", f"{GOOD_BASENAME}.asset.json"):
        shutil.copyfile(os.path.join(good_dir, fname), os.path.join(dest_dir, fname))


# --- mutation functions: each takes (gltf, bin_bytes, lod_number) and mutates in place,
# EXCEPT sidecar mutations which take (sidecar_dict).

def mut_add_camera(gltf, bin_bytes, lod):
    gltf["cameras"] = [{"type": "perspective",
                        "perspective": {"yfov": 0.8, "znear": 0.1, "aspectRatio": 1.5}}]


def mut_drop_wheel_node(gltf, bin_bytes, lod):
    _, n = find_node(gltf, "wheel_FL")
    n["name"] = "wheel_FL_removed"  # keeps index stable (children refs by index unaffected)


def mut_rename_node_one_lod(gltf, bin_bytes, lod):
    if lod != 1:
        return
    _, n = find_node(gltf, "door_L")
    n["name"] = "door_L_renamed"


def mut_wheel_floats(gltf, bin_bytes, lod):
    _, n = find_node(gltf, "wheel_FL")
    n["translation"][1] += 0.05  # lifts the whole wheel off the ground plane


def mut_swap_forward(gltf, bin_bytes, lod):
    # Move BOTH headlights to the rear -- moving only one still leaves the L/R mean more
    # negative than the brakelights' mean, which would not trip the rule.
    for name in ("light_head_L", "light_head_R"):
        _, head = find_node(gltf, name)
        head["translation"][2] = 2.5


def mut_wheel_off_hub(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "wheel_FL")
    prim = gltf["meshes"][mesh_idx]["primitives"][0]
    acc_idx = prim["attributes"]["POSITION"]
    vecs, base, stride, ncomp = read_float_vecs(gltf, bin_bytes, acc_idx)
    vecs = [(x + 0.18, y, z) for (x, y, z) in vecs]  # mesh slides along the axle, pivot stays
    write_float_vecs(bin_bytes, vecs, base, stride, ncomp)


def mut_hinge_recentre(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "bonnet")
    prim = gltf["meshes"][mesh_idx]["primitives"][0]
    acc_idx = prim["attributes"]["POSITION"]
    vecs, base, stride, ncomp = read_float_vecs(gltf, bin_bytes, acc_idx)
    # Recentre the WHOLE local bbox on the origin (on every axis, not just the hinge axis) --
    # a thin panel's thickness axis is already close to a face by construction, so nudging
    # only the hinge axis leaves that thin axis still "on a face" and the rule keeps passing.
    mins = [min(v[i] for v in vecs) for i in range(3)]
    maxs = [max(v[i] for v in vecs) for i in range(3)]
    shift = [-(mins[i] + maxs[i]) / 2.0 for i in range(3)]
    vecs = [(x + shift[0], y + shift[1], z + shift[2]) for (x, y, z) in vecs]
    write_float_vecs(bin_bytes, vecs, base, stride, ncomp)


def mut_drop_extras_joint(gltf, bin_bytes, lod):
    _, n = find_node(gltf, "wheel_FL")
    n["extras"].pop("jj_joint", None)


def mut_mass_to_92(gltf, bin_bytes, lod):
    _, n = find_node(gltf, "chassis")
    n["extras"]["jj_mass_fraction"] = round(n["extras"]["jj_mass_fraction"] - 0.08, 6)


def mut_drop_collider(gltf, bin_bytes, lod):
    _, n = find_node(gltf, "col_chassis")
    n["name"] = "col_chassis_removed"


def mut_collider_material(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "col_bonnet")
    gltf["meshes"][mesh_idx]["primitives"][0]["material"] = 0


def mut_cabin_box_shape(gltf, bin_bytes, lod):
    cabin_idx, cabin_node = find_node(gltf, "col_cabin")
    bonnet_mesh_idx = find_mesh_index_by_node_name(gltf, "col_bonnet")
    cabin_node["mesh"] = bonnet_mesh_idx  # swap in a plain 8-vertex box


def mut_collider_oversized(gltf, bin_bytes, lod):
    _, wheel_col = find_node(gltf, "col_wheel_FL")
    chassis_mesh_idx = find_mesh_index_by_node_name(gltf, "col_chassis")
    wheel_col["mesh"] = chassis_mesh_idx  # a wheel "collider" the size of the whole chassis


def mut_bad_semantic(gltf, bin_bytes, lod):
    for m in gltf["materials"]:
        if m.get("name") == "jj_paint":
            m["extras"]["jj_semantic"] = "sparkle"


def mut_no_emissive(gltf, bin_bytes, lod):
    for m in gltf["materials"]:
        if m.get("name") == "jj_headlight":
            m["emissiveFactor"] = [0, 0, 0]
            m.pop("extensions", None)


def mut_drop_paint_texture(gltf, bin_bytes, lod):
    for m in gltf["materials"]:
        if m.get("name") == "jj_paint":
            m["pbrMetallicRoughness"].pop("baseColorTexture", None)


def mut_drop_texcoord1(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "chassis")
    gltf["meshes"][mesh_idx]["primitives"][0]["attributes"].pop("TEXCOORD_1", None)


def mut_uv_overlap(gltf, bin_bytes, lod):
    chassis_mesh_idx = find_mesh_index_by_node_name(gltf, "chassis")
    bonnet_mesh_idx = find_mesh_index_by_node_name(gltf, "bonnet")
    chassis_attrs = gltf["meshes"][chassis_mesh_idx]["primitives"][0]["attributes"]
    bonnet_attrs = gltf["meshes"][bonnet_mesh_idx]["primitives"][0]["attributes"]
    bonnet_attrs["TEXCOORD_0"] = chassis_attrs["TEXCOORD_0"]  # same UV space as chassis's paint


def mut_uv_out_of_bounds(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "bonnet")
    prim = gltf["meshes"][mesh_idx]["primitives"][0]
    acc_idx = prim["attributes"]["TEXCOORD_0"]
    vecs, base, stride, ncomp = read_float_vecs(gltf, bin_bytes, acc_idx)
    vecs[0] = (1.6, 0.5)
    write_float_vecs(bin_bytes, vecs, base, stride, ncomp)


def mut_rename_morph_target(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "bonnet")
    gltf["meshes"][mesh_idx]["extras"]["targetNames"] = ["bonnet_dent_WRONG"]


def mut_morph_zero(gltf, bin_bytes, lod):
    mesh_idx = find_mesh_index_by_node_name(gltf, "bonnet")
    prim = gltf["meshes"][mesh_idx]["primitives"][0]
    acc_idx = prim["targets"][0]["POSITION"]
    vecs, base, stride, ncomp = read_float_vecs(gltf, bin_bytes, acc_idx)
    vecs = [(0.0, 0.0, 0.0) for _ in vecs]
    write_float_vecs(bin_bytes, vecs, base, stride, ncomp)


def mut_anchor_bad(gltf, bin_bytes, lod):
    _, n = find_node(gltf, "roof_number")
    n["translation"][1] = 0.3  # dropped down inside the cabin, no longer clears the roof


SIDECAR_MUTATIONS = {}


def mut_sidecar_triangle_lie(sidecar):
    sidecar["lods"][0]["triangles"] += 137


def mut_sidecar_agreement_bad(sidecar):
    sidecar["anchors"]["com"] = [sidecar["anchors"]["com"][0] + 0.5,
                                 sidecar["anchors"]["com"][1], sidecar["anchors"]["com"][2]]


FIXTURES = [
    Fixture("glb_parse_camera", "glb.parse", "adds a camera to lod0", mut_add_camera, lods=(0,)),
    Fixture("nodes_required_drop_wheel", "nodes.required", "renames wheel_FL away in lod0",
            mut_drop_wheel_node, lods=(0,)),
    Fixture("nodes_same_across_lods", "nodes.same_across_lods", "renames door_L only in lod1",
            mut_rename_node_one_lod, lods=(0, 1, 2)),
    Fixture("space_origin_wheel_float", "space.origin", "lifts wheel_FL 5cm off the ground",
            mut_wheel_floats, lods=(0,)),
    Fixture("space_forward_swap", "space.forward", "moves a headlight to the rear",
            mut_swap_forward, lods=(0,)),
    Fixture("pivots_wheels_off_hub", "pivots.wheels", "slides wheel_FL mesh along its axle",
            mut_wheel_off_hub, lods=(0,)),
    Fixture("pivots_hinges_recentred", "pivots.hinges", "recentres bonnet's pivot mid-panel",
            mut_hinge_recentre, lods=(0,)),
    Fixture("extras_parts_missing_joint", "extras.parts", "drops jj_joint from wheel_FL",
            mut_drop_extras_joint, lods=(0,)),
    Fixture("mass_sum_92", "mass.sum", "mass fractions sum to ~0.92", mut_mass_to_92, lods=(0,)),
    Fixture("colliders_present_drop", "colliders.present", "renames col_chassis away",
            mut_drop_collider, lods=(0,)),
    Fixture("colliders_no_material_violation", "colliders.no_material",
            "gives col_bonnet a material", mut_collider_material, lods=(0,)),
    Fixture("colliders_shape_cabin_box", "colliders.shape", "col_cabin becomes an 8-vertex box",
            mut_cabin_box_shape, lods=(0,)),
    Fixture("colliders_fit_oversized", "colliders.fit",
            "col_wheel_FL becomes chassis-sized", mut_collider_oversized, lods=(0,)),
    Fixture("materials_semantic_bad", "materials.semantic", "jj_paint gets an invalid semantic",
            mut_bad_semantic, lods=(0,)),
    Fixture("materials_emissive_missing", "materials.emissive", "headlight loses its emissive",
            mut_no_emissive, lods=(0,)),
    Fixture("materials_paint_mask_missing", "materials.paint_mask",
            "jj_paint loses its baseColorTexture", mut_drop_paint_texture, lods=(0,)),
    Fixture("uv_present_missing_texcoord1", "uv.present", "chassis loses TEXCOORD_1",
            mut_drop_texcoord1, lods=(0,)),
    Fixture("uv_overlap_shared_island", "uv.overlap", "bonnet reuses chassis's UV0 island",
            mut_uv_overlap, lods=(0,)),
    Fixture("uv_bounds_out_of_range", "uv.bounds", "one bonnet UV0 coord goes to u=1.6",
            mut_uv_out_of_bounds, lods=(0,)),
    Fixture("morphs_present_renamed", "morphs.present", "bonnet_dent renamed to an unexpected name",
            mut_rename_morph_target, lods=(0,)),
    Fixture("morphs_nonzero_flat", "morphs.nonzero", "bonnet_dent target zeroed out",
            mut_morph_zero, lods=(0,)),
    Fixture("anchors_roof_number_low", "anchors", "roof_number dropped below the cabin roof",
            mut_anchor_bad, lods=(0,)),
]

SIDECAR_FIXTURES = [
    ("budget_triangles_sidecar_lies", "budget.triangles", "sidecar lod0 triangle count is wrong",
     mut_sidecar_triangle_lie),
    ("sidecar_agreement_bad_anchor", "sidecar.agreement", "sidecar com anchor moved 0.5m",
     mut_sidecar_agreement_bad),
]


def build_fixture(good_dir, out_dir, fixture):
    dest = os.path.join(out_dir, fixture.name)
    copy_good(good_dir, dest)
    for lod in fixture.lods:
        path = os.path.join(dest, f"{GOOD_BASENAME}.lod{lod}.glb")
        gltf, bin_bytes = load_glb_parts(path)
        fixture.apply_fn(gltf, bin_bytes, lod)
        write_glb(path, gltf, bin_bytes)
    return {"dir": fixture.name, "rule_id": fixture.rule_id, "description": fixture.description}


def build_sidecar_fixture(good_dir, out_dir, name, rule_id, description, mut_fn):
    dest = os.path.join(out_dir, name)
    copy_good(good_dir, dest)
    sidecar_path = os.path.join(dest, f"{GOOD_BASENAME}.asset.json")
    sidecar = json.load(open(sidecar_path))
    mut_fn(sidecar)
    with open(sidecar_path, "w") as f:
        json.dump(sidecar, f, indent=2)
    return {"dir": name, "rule_id": rule_id, "description": description}


def main(good_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    expected = {}
    for fixture in FIXTURES:
        entry = build_fixture(good_dir, out_dir, fixture)
        expected[fixture.name] = entry
        print(f"built fixture {fixture.name} -> expects FAIL {fixture.rule_id}")
    for name, rule_id, desc, fn in SIDECAR_FIXTURES:
        entry = build_sidecar_fixture(good_dir, out_dir, name, rule_id, desc, fn)
        expected[name] = entry
        print(f"built fixture {name} -> expects FAIL {rule_id}")
    with open(os.path.join(out_dir, "expected.json"), "w") as f:
        json.dump(expected, f, indent=2)
    print(f"wrote {os.path.join(out_dir, 'expected.json')} ({len(expected)} fixtures)")


if __name__ == "__main__":
    good_dir = sys.argv[1] if len(sys.argv) > 1 else "fixtures/good"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "fixtures/broken"
    main(good_dir, out_dir)
