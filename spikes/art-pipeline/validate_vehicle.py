"""Draft vehicle-contract validator (stdlib only). python3 validate_vehicle.py out/cruz_missile.glb out/cruz_missile.asset.json

Checks the GLB against the draft contract: required parts/markers/colliders, semantic materials,
wheel pivots at hubs (not at the world origin), hinged parts off-centre, per-part dent morph targets,
triangle budget, extras present, and sidecar/GLB agreement. Exit 1 on any failure.
"""
import json, struct, sys

REQUIRED_PARTS = ["chassis", "bonnet", "boot", "door_L", "door_R", "bumper_front", "bumper_rear",
                  "wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR", "glass"]
REQUIRED_MARKERS = ["lplate_front", "lplate_rear", "cam_fp", "com", "roof_number"]
REQUIRED_COLLIDERS = ["col_chassis"]
DENTED_PARTS = ["chassis", "bonnet", "boot", "door_L", "door_R", "bumper_front", "bumper_rear"]
SEMANTIC = {"jj_paint", "jj_tyre", "jj_wheel", "jj_glass", "jj_plastic", "jj_headlight", "jj_brakelight"}
TRI_BUDGET = 10000  # spike finding: dentable panels need interior verts (was 5000)

def load_glb(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    clen, ctype = struct.unpack_from("<I4s", data, 12)
    return json.loads(data[20:20 + clen])

def main(glb_path, sidecar_path):
    g = load_glb(glb_path)
    side = json.load(open(sidecar_path))
    fails, notes = [], []
    nodes = {n.get("name"): n for n in g.get("nodes", [])}
    for n in REQUIRED_PARTS + REQUIRED_MARKERS + REQUIRED_COLLIDERS:
        if n not in nodes:
            fails.append(f"missing node '{n}'")
    mats = {m.get("name") for m in g.get("materials", [])}
    for m in SEMANTIC - mats:
        fails.append(f"missing semantic material '{m}'")
    # Pivots: wheels must sit at their hub (translation well away from the origin, below the body).
    for w in ("wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"):
        t = nodes.get(w, {}).get("translation")
        if not t or (abs(t[0]) < 0.3 and abs(t[1]) < 0.3 and abs(t[2]) < 0.3):
            fails.append(f"{w}: pivot not at hub (translation={t})")
    for h in ("door_L", "door_R", "bonnet", "boot"):
        t = nodes.get(h, {}).get("translation")
        if not t or max(abs(c) for c in t) < 0.3:
            fails.append(f"{h}: pivot at origin, cannot hinge (translation={t})")
    # Deformation: each dented part's mesh has a morph target.
    for p in DENTED_PARTS:
        n = nodes.get(p)
        if n is None or "mesh" not in n:
            continue
        mesh = g["meshes"][n["mesh"]]
        if not any(prim.get("targets") for prim in mesh.get("primitives", [])):
            fails.append(f"{p}: no dent morph target (R68)")
        if not n.get("extras", {}).get("jj_hp"):
            fails.append(f"{p}: missing jj_hp extras")
    if side.get("triangles_lod0", 1e9) > TRI_BUDGET:
        fails.append(f"triangles {side['triangles_lod0']} > budget {TRI_BUDGET}")
    for p in side.get("parts", {}):
        if p not in nodes:
            fails.append(f"sidecar part '{p}' not in GLB")
    if side.get("bake_errors"):
        fails.append(f"bake errors: {side['bake_errors']}")
    notes.append(f"nodes={len(nodes)} meshes={len(g.get('meshes', []))} materials={len(mats)} tris={side.get('triangles_lod0')}")
    print(json.dumps({"ok": not fails, "failures": fails, "notes": notes}, indent=2))
    return 0 if not fails else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
