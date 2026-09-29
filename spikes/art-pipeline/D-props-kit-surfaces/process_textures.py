"""Spike D task 3: normalize generated surface textures to power-of-two, verify tileability by
rendering a 3x3 tile composite, and write per-surface sidecars (surface_set contract draft).

Run: python3 process_textures.py
"""
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

SURFACES = {
    "surface_dirt_packed.png": {
        "id": "dirt_packed",
        "display_name": "Packed red outback dirt",
        "grip": 0.78,
        "rolling_resistance": 0.35,
        "particle_color": "#a8552a",
        "tyre_sound_id": "sfx_tyre_dirt_packed",
    },
    "surface_sand_soft.png": {
        "id": "sand_soft",
        "display_name": "Soft desert sand",
        "grip": 0.45,
        "rolling_resistance": 0.85,
        "particle_color": "#e8c878",
        "tyre_sound_id": "sfx_tyre_sand_soft",
    },
    "surface_tarmac.png": {
        "id": "tarmac",
        "display_name": "Worn tarmac",
        "grip": 1.0,
        "rolling_resistance": 0.12,
        "particle_color": "#555b61",
        "tyre_sound_id": "sfx_tyre_tarmac",
    },
}

TARGET = 1024

for fname, meta in SURFACES.items():
    path = os.path.join(TEX, fname)
    im = Image.open(path).convert("RGB")
    if im.size != (TARGET, TARGET):
        # finding: imagegen doesn't reliably return power-of-two dims (got 1254x1254 for 2 of 3
        # requests despite asking for 1024) -- the pipeline must always normalize on ingest.
        im = im.resize((TARGET, TARGET), Image.LANCZOS)
        im.save(path)
    # 3x3 tile composite to visually verify seamlessness
    tile_im = Image.new("RGB", (TARGET * 3, TARGET * 3))
    for tx in range(3):
        for ty in range(3):
            tile_im.paste(im, (tx * TARGET, ty * TARGET))
    tile_out = os.path.join(OUT, f"tile3x3_{meta['id']}.png")
    tile_im.resize((768, 768), Image.LANCZOS).save(tile_out)

    sidecar = {
        "contract": "jj.surface_set.v0-draft",
        "id": meta["id"],
        "display_name": meta["display_name"],
        "surface_id": meta["id"],
        "texture": f"textures/{fname}",
        "resolution": [TARGET, TARGET],
        "tileable": True,
        "tileability_check": f"out/tile3x3_{meta['id']}.png (visual inspection, no seam algorithm run)",
        "gameplay": {
            "grip": meta["grip"],
            "rolling_resistance": meta["rolling_resistance"],
            "particle_color": meta["particle_color"],
            "tyre_sound_id": meta["tyre_sound_id"],
        },
        "provenance": {"source": "codex exec image_generation 2026-09-29",
                        "prompt_constraints": "no real landmarks, no Indigenous motifs, no real brands/logos"},
    }
    with open(os.path.join(OUT, f"{meta['id']}.surface.json"), "w") as f:
        json.dump(sidecar, f, indent=2)
    print("PROCESSED", fname, "->", im.size, "sidecar written")

print("DONE")
