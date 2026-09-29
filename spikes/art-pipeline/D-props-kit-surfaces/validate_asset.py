"""Spike D task 4: draft-schema + structural validator for destructible_prop / kit_piece /
surface_set assets (stdlib only, no `jsonschema` package available on this machine).

Usage:
  python3 validate_asset.py destructible_prop out/wheelie_bin.asset.json [out/wheelie_bin_intact.glb ...]
  python3 validate_asset.py kit_piece out/track_piece_bend90.asset.json out/track_piece_bend90.glb
  python3 validate_asset.py surface_set out/dirt_packed.surface.json

Exit 0 + {"ok": true} on pass, exit 1 + failure list on fail. The game loads assets only through
their sidecars (plan §12), so the sidecar is the primary contract surface; GLB structural checks are
best-effort cross-checks where a GLB path is given.
"""
import json, math, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_DIR = os.path.join(HERE, "contracts")

# ---------------------------------------------------------------- minimal JSON-Schema subset
def validate_schema(instance, schema, path="$"):
    fails = []
    t = schema.get("type")
    if t == "object":
        if not isinstance(instance, dict):
            return [f"{path}: expected object, got {type(instance).__name__}"]
        for req in schema.get("required", []):
            if req not in instance:
                fails.append(f"{path}: missing required property '{req}'")
        if "minProperties" in schema and len(instance) < schema["minProperties"]:
            fails.append(f"{path}: expected >= {schema['minProperties']} properties, got {len(instance)}")
        props = schema.get("properties", {})
        for k, v in instance.items():
            if k in props:
                fails += validate_schema(v, props[k], f"{path}.{k}")
            elif "patternProperties" in schema:
                # simplistic: apply the (single) pattern schema to any unmatched key
                for pat_schema in schema["patternProperties"].values():
                    fails += validate_schema(v, pat_schema, f"{path}.{k}")
    elif t == "array":
        if not isinstance(instance, list):
            return [f"{path}: expected array, got {type(instance).__name__}"]
        if "minItems" in schema and len(instance) < schema["minItems"]:
            fails.append(f"{path}: expected >= {schema['minItems']} items, got {len(instance)}")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            fails.append(f"{path}: expected <= {schema['maxItems']} items, got {len(instance)}")
        if "items" in schema:
            for i, item in enumerate(instance):
                fails += validate_schema(item, schema["items"], f"{path}[{i}]")
    elif t == "string":
        if not isinstance(instance, str):
            fails.append(f"{path}: expected string, got {type(instance).__name__}")
        elif "minLength" in schema and len(instance) < schema["minLength"]:
            fails.append(f"{path}: string shorter than minLength {schema['minLength']}")
        elif "enum" in schema and instance not in schema["enum"]:
            fails.append(f"{path}: '{instance}' not in enum {schema['enum']}")
    elif t in ("number", "integer"):
        if not isinstance(instance, (int, float)) or isinstance(instance, bool):
            fails.append(f"{path}: expected {t}, got {type(instance).__name__}")
        else:
            if t == "integer" and not float(instance).is_integer():
                fails.append(f"{path}: expected integer, got {instance}")
            if "minimum" in schema and instance < schema["minimum"]:
                fails.append(f"{path}: {instance} < minimum {schema['minimum']}")
            if "maximum" in schema and instance > schema["maximum"]:
                fails.append(f"{path}: {instance} > maximum {schema['maximum']}")
    elif t == "boolean":
        if not isinstance(instance, bool):
            fails.append(f"{path}: expected boolean, got {type(instance).__name__}")
    return fails


def load_glb(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", "not a GLB"
    clen, ctype = struct.unpack_from("<I4s", data, 12)
    return json.loads(data[20:20 + clen])


def is_pow2(n):
    return n > 0 and (n & (n - 1)) == 0


def check_orthonormal(right, fwd, up, tol=1e-3):
    import itertools
    def norm(v):
        m = math.sqrt(sum(c * c for c in v))
        return [c / m for c in v] if m > 1e-9 else v, m
    fails = []
    (rn, rm), (fn, fm), (un, um) = norm(right), norm(fwd), norm(up)
    for name, m in (("right", rm), ("forward", fm), ("up", um)):
        if abs(m - 1.0) > 0.15:
            fails.append(f"axis '{name}' not unit length before normalization (len={m:.3f})")
    pairs = [("right.forward", rn, fn), ("right.up", rn, un), ("forward.up", fn, un)]
    for name, a, b in pairs:
        dot = sum(x * y for x, y in zip(a, b))
        if abs(dot) > tol:
            fails.append(f"axes not orthogonal: {name} dot={dot:.4f} (tol {tol})")
    return fails


# ---------------------------------------------------------------- per-kind structural checks
def check_destructible_prop(sidecar, glb_paths):
    fails, notes = [], []
    d = sidecar.get("destruction", {})
    ratio = d.get("volume_conservation_ratio")
    if ratio is None:
        fails.append("destruction.volume_conservation_ratio missing")
    elif not (0.97 <= ratio <= 1.03):
        fails.append(f"volume_conservation_ratio {ratio} outside [0.97, 1.03] tolerance (pieces must sum to ~intact volume)")
    if not sidecar.get("collider"):
        fails.append("no collider reference in sidecar")
    if sidecar.get("lid"):
        lid = sidecar["lid"]
        axis = lid.get("hinge_axis")
        if not axis or abs(math.sqrt(sum(c * c for c in axis)) - 1.0) > 0.05:
            fails.append(f"lid.hinge_axis not a unit vector: {axis}")
    pieces = d.get("pieces", {})
    if d.get("piece_count") and len(pieces) < 1:
        fails.append("piece_count > 0 but no per-piece mass/volume entries recorded")
    for name, meta in pieces.items():
        if meta.get("mass_kg", 0) <= 0:
            fails.append(f"piece '{name}' has non-positive mass_kg")
    crush_morphs = sidecar.get("crush_morphs", {})
    for role, rel in sidecar.get("assets", {}).items():
        for gp in glb_paths:
            if os.path.basename(gp) == rel:
                g = load_glb(gp)
                nodes_by_name = {n.get("name"): n for n in g.get("nodes", [])}
                nodes = set(nodes_by_name)
                notes.append(f"{role}: {len(nodes)} nodes in {rel}")
                if role == "intact" and sidecar.get("intact_root") not in nodes:
                    fails.append(f"intact_root '{sidecar.get('intact_root')}' not found in {rel}")
                if role == "intact" and sidecar.get("collider") not in nodes:
                    fails.append(f"collider '{sidecar.get('collider')}' not found in {rel}")
                if role == "intact":
                    for morph_name, meta in crush_morphs.items():
                        for node_name in meta.get("nodes", []):
                            n = nodes_by_name.get(node_name)
                            if n is None or "mesh" not in n:
                                fails.append(f"crush morph '{morph_name}': node '{node_name}' not found in {rel}")
                                continue
                            mesh = g["meshes"][n["mesh"]]
                            target_names = (mesh.get("extras") or {}).get("targetNames", [])
                            if morph_name not in target_names:
                                fails.append(f"crush morph '{morph_name}' missing on node '{node_name}' (targetNames={target_names})")
                                continue
                            idx = target_names.index(morph_name)
                            weights = n.get("weights") or mesh.get("weights") or []
                            if idx >= len(weights) or weights[idx] != 0:
                                fails.append(f"crush morph '{morph_name}' on '{node_name}' does not default to 0 (weights={weights})")
    if crush_morphs:
        notes.append(f"crush_morphs checked: {list(crush_morphs)}")
    ladder = sidecar.get("damage_ladder")
    if ladder:
        states = [s.get("state") for s in ladder]
        if "fractured" not in states:
            fails.append("damage_ladder has no 'fractured' terminal state")
        for step in ladder:
            if step.get("morph") and step["morph"] not in crush_morphs:
                fails.append(f"damage_ladder step '{step.get('state')}' references unknown morph '{step['morph']}'")
    return fails, notes


def check_kit_piece(sidecar, glb_paths):
    fails, notes = [], []
    snaps = sidecar.get("snap_points", {})
    if len(snaps) < 2:
        fails.append(f"expected >= 2 snap points, got {len(snaps)}")
    for name, s in snaps.items():
        fwd, up = s.get("forward"), s.get("up")
        if not fwd or not up:
            fails.append(f"snap '{name}' missing forward/up")
            continue
        right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]]
        fails += [f"snap '{name}': {m}" for m in check_orthonormal(right, fwd, up)]
    slots = sidecar.get("surface_map", {}).get("slots", [])
    valid_prefix = "jj_surface_"
    for s in slots:
        if not s.startswith(valid_prefix):
            fails.append(f"surface slot material '{s}' doesn't follow '{valid_prefix}*' semantic naming")
    if not sidecar.get("cultural_review", {}).get("note"):
        fails.append("missing cultural_review.note (plan/owner-direction requires a review note for procedural landmark-like geometry)")
    for gp in glb_paths:
        g = load_glb(gp)
        nodes = {n.get("name") for n in g.get("nodes", [])}
        for rn in sidecar.get("render_nodes", []):
            if rn not in nodes:
                fails.append(f"render node '{rn}' not found in {os.path.basename(gp)}")
        for cn in sidecar.get("colliders", []):
            if cn not in nodes:
                fails.append(f"collider node '{cn}' not found in {os.path.basename(gp)}")
        for sn in snaps:
            if sn not in nodes:
                fails.append(f"snap node '{sn}' not found in {os.path.basename(gp)}")
        notes.append(f"{len(nodes)} nodes in {os.path.basename(gp)}")
    return fails, notes


def check_surface_set(sidecar, glb_paths):
    fails, notes = [], []
    tex_rel = sidecar.get("texture")
    if tex_rel:
        tex_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[2]))), tex_rel) \
            if not os.path.isabs(tex_rel) else tex_rel
        # resolve relative to the sidecar's own directory first
        sidecar_dir = os.path.dirname(os.path.abspath(sys.argv[2]))
        candidate = os.path.join(os.path.dirname(sidecar_dir), tex_rel)
        if not os.path.exists(candidate):
            candidate = os.path.join(sidecar_dir, tex_rel)
        if os.path.exists(candidate):
            try:
                from PIL import Image
                im = Image.open(candidate)
                w, h = im.size
                if not (is_pow2(w) and is_pow2(h)):
                    fails.append(f"texture {tex_rel} is {w}x{h}, not power-of-two")
                notes.append(f"texture resolution {w}x{h}")
            except ImportError:
                notes.append("PIL not available, skipped pixel-dimension check")
        else:
            fails.append(f"texture file not found: {candidate}")
    res = sidecar.get("resolution")
    if res and not (is_pow2(res[0]) and is_pow2(res[1])):
        fails.append(f"sidecar-declared resolution {res} not power-of-two")
    gp = sidecar.get("gameplay", {})
    for k in ("grip", "rolling_resistance"):
        if k in gp and not (0 <= gp[k] <= 1.5):
            fails.append(f"gameplay.{k}={gp[k]} out of plausible [0,1.5] range")
    return fails, notes


CHECKERS = {
    "destructible_prop": check_destructible_prop,
    "kit_piece": check_kit_piece,
    "surface_set": check_surface_set,
}


def main(argv):
    if len(argv) < 2:
        print("usage: validate_asset.py <kind> <sidecar.json> [glb ...]")
        return 2
    kind, sidecar_path = argv[0], argv[1]
    glb_paths = argv[2:]
    schema_path = os.path.join(SCHEMA_DIR, f"{kind}.schema.json")
    schema = json.load(open(schema_path))
    sidecar = json.load(open(sidecar_path))

    fails = validate_schema(sidecar, schema)
    notes = [f"schema={kind}.schema.json"]
    if kind in CHECKERS:
        f2, n2 = CHECKERS[kind](sidecar, glb_paths)
        fails += f2
        notes += n2
    result = {"ok": not fails, "kind": kind, "sidecar": sidecar_path, "failures": fails, "notes": notes}
    print(json.dumps(result, indent=2))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
