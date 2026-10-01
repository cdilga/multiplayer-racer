"""Merge the per-LOD meta written by finish_asset.py into cruz_missile.asset.json (stdlib only).

Geometry facts (parts, anchors, wheels, colliders, bounds) come from the baseline LOD1; every LOD's
triangle/draw/texture numbers come from its own exported GLB.

Run:  python3 write_sidecar.py [art/vehicles/cruz-missile]
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "..", "art", "vehicles", "cruz-missile"))
metas = {m["lod"]: m for m in (json.load(open(os.path.join(DST, ".build", f))) for f in sorted(os.listdir(os.path.join(DST, ".build"))))}
base = metas[1]
ROLE = {0: "hero/close-up (optional richer variant)", 1: "baseline close gameplay mesh", 2: "medium/distant"}
HYPOTHESIS = {0: None, 1: [1000, 3000], 2: [500, 1000]}

sidecar = {
    "contract": "jj-vehicle/0.1-draft",
    "asset_id": "cruz-missile",
    "archetype": "small_sedan",
    "display_name": "Cruz Missile",
    "inspired_by": "early-2010s Australian small sedan (no real badges or names)",
    "space": {"up": "+Y", "forward": "-Z", "right": "+X", "handedness": "right"},
    "units": "m",
    "origin": "ground plane, midway between the axles, on the centreline",
    "bounds": base["bounds"],
    "lods": [{"lod": m["lod"], "file": m["file"], "triangles": m["triangles"], "draw_calls": m["draw_calls"],
              "materials": m["materials"], "mask_px": m["mask_px"], "bytes": m["file_bytes"], "role": ROLE[m["lod"]],
              "triangle_hypothesis": HYPOTHESIS[m["lod"]]} for m in sorted(metas.values(), key=lambda m: m["lod"])],
    "baseline_lod": 1,
    "parts": base["parts"],
    "trims": {"bumper_front_trim": "bumper_front", "boot_trim": "boot"},
    "wheels": base["wheels"],
    "drive": "FWD",
    "suspension": base["suspension"],
    "physics": {"mass_kg": base["mass_kg"], "com": base["com"], "profile": "profiles/vehicles/cruz-missile.json (pending jj-sim)",
                "colliders": base["colliders"]},
    "anchors": base["anchors"],
    "materials": base["materials_map"],
    "textures": {"mask": {"channels": {"r": "paint", "g": "pattern (twin stripes)", "b": "dirt/damage (baked AO)", "a": "emissive"},
                          "uv": "UV0 (glTF convention, top-left origin); UV1 = copy for bakes",
                          "texel_density": "uniform, except paint islands at 1.6x linear (identity paint/pattern priority)",
                          "per_lod_px": {str(m["lod"]): m["mask_px"] for m in metas.values()},
                          "files": {str(m["lod"]): f"mask.lod{m['lod']}.png" for m in metas.values()}}},
    "deformation": {"dentable": [p for p, e in base["parts"].items() if e.get("dents")],
                    "morphs": {p: e["dents"] for p, e in base["parts"].items() if e.get("dents")},
                    "note": "localised radial dents along -normal; the game blends and accumulates them per impact"},
    "identity": {"roof_number_anchor": "roof_number", "roof_number_size_m": 0.9, "paint_semantic": "paint",
                 "pattern_channel": "g", "plates": ["lplate_front", "lplate_rear"]},
    "contract_proposals": ["material semantic 'indicator' (amber emissive)", "material semantic 'accent' (non-paint coloured hardware)",
                           "parts door_rear_L/door_rear_R and susp_* beyond plan §8.1's minimum list"],
}
out = os.path.join(DST, "cruz_missile.asset.json")
json.dump(sidecar, open(out, "w"), indent=1)
mass = sum(e["mass_fraction"] for e in base["parts"].values())
print("SIDECAR", out, "mass_fraction_sum=%.6f" % mass, "lods=", [(l["lod"], l["triangles"]) for l in sidecar["lods"]])
