"""Spike A (textures & UVs): compose the contract mask texture (RGBA = R paint, G pattern,
B dirt/damage, A emissive) from the interim GLB + Blender's UV1 bakes, using stdlib + PIL only
(Blender's bundled python has no PIL, hence this runs as a separate system-python step).

Run: python3 compose_mask.py out/cruz_missile_interim.glb out/cruz_missile_interim.asset.json out

Pipeline:
  R (paint)    -- rasterize every paint-part triangle at its UV0 position -> 255 (procedural, exact:
                  every pixel this mask paints white is a real paint-material pixel, no bake needed).
  B (dirt)     -- AO + curvature were baked via UV1 (see build_textured_car.py). Scalar data can be
                  safely resampled between two different UV parameterizations of the SAME triangle
                  by matching barycentric coordinates: for each pixel inside a triangle's UV0
                  footprint, compute its barycentric weights there, apply the SAME weights to that
                  triangle's UV1 verts to find where to sample the UV1 bake images. This is the
                  "UV1 for bakes" half of the contract line actually doing something: bake once at a
                  clean unique unwrap, transfer into the shared runtime atlas.
  G (pattern)  -- procedural diagonal stripe per paint-part atlas cell (task explicitly allows
                  procedural; decal-sheet registration into the shared atlas is future work, noted
                  in REPORT.md).
  A (emissive) -- procedural thin pinstripe along the stripe edge (a paint-on emissive accent, not
                  the headlight/brakelight lamp geometry, which keeps its own simple material --
                  see REPORT.md for why).
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from uv_raster import load_glb, mesh_triangles, rasterize_triangle
from PIL import Image, ImageDraw, ImageFilter

RES = 1024


DECAL_PARTS = {"door_L", "door_R"}  # parts that get the real decal sheet instead of a procedural stripe
DECAL_CROP = (20, 440, 1000, 560)   # flame-graphic region of textures/decal_sheet.png


def main(glb_path, sidecar_path, out_dir, use_decal=False):
    t0 = time.time()
    gltf, bin_bytes = load_glb(glb_path)
    sidecar = json.load(open(sidecar_path))
    # derive the variant suffix from the input filename itself (cruz_missile_interim<suffix>.glb) --
    # more robust than a sidecar flag, since new variants (e.g. legacyuv) don't all set one.
    base = os.path.basename(glb_path)
    suffix = base[len("cruz_missile_interim"):-len(".glb")]
    paint_parts = set(sidecar["paint_parts"])
    rects = {r["part"]: r["rect"] for r in sidecar["uv0_atlas_report"]}

    ao_img = Image.open(os.path.join(out_dir, sidecar["bake_images"]["ao_uv1"])).convert("L")
    curv_img = Image.open(os.path.join(out_dir, sidecar["bake_images"]["curvature_uv1"])).convert("L")
    ao_px, curv_px = ao_img.load(), curv_img.load()
    AW, AH = ao_img.size

    R = Image.new("L", (RES, RES), 0)
    B = Image.new("L", (RES, RES), 0)
    rd, bd = R.load(), B.load()

    name_to_mesh = {m.get("name"): i for i, m in enumerate(gltf["meshes"])}
    stats = {"paint_triangles": 0, "paint_px": 0}
    for part in paint_parts:
        mi = name_to_mesh[part]
        pos, uv0, uv1, tris, matidx = mesh_triangles(gltf, bin_bytes, mi)
        mat_name = gltf["materials"][matidx]["name"] if matidx is not None else None
        assert mat_name == "jj_paint", f"{part}: expected jj_paint, got {mat_name}"
        for (ia, ib, ic) in tris:
            a0, b0, c0 = uv0[ia], uv0[ib], uv0[ic]
            a1, b1, c1 = uv1[ia], uv1[ib], uv1[ic]
            stats["paint_triangles"] += 1
            for x, y, wa, wb, wc in rasterize_triangle(a0, b0, c0, RES):
                rd[x, y] = 255
                stats["paint_px"] += 1
                u1 = wa * a1[0] + wb * b1[0] + wc * c1[0]
                v1 = wa * a1[1] + wb * b1[1] + wc * c1[1]
                # v1 comes from the GLB's TEXCOORD_1 (glTF-convention, top-origin) and the bake PNG
                # was saved by Blender (which flips its own bottom-origin buffer to top-origin on
                # save) -- both already top-origin, so no extra flip here (see uv_raster.py docstring).
                sx = min(max(int(u1 * AW), 0), AW - 1)
                sy = min(max(int(v1 * AH), 0), AH - 1)
                ao_v = ao_px[sx, sy] / 255.0
                curv_v = curv_px[sx, sy] / 255.0
                dirt = max(0.0, min(1.0, (1.0 - ao_v) * 0.75 + (1.0 - curv_v) * 0.25))
                bd[x, y] = max(bd[x, y], int(dirt * 255))

    # G: a slim procedural racing-stripe accent per paint-part cell (not a harsh 50/50 split --
    # coordinator feedback on an earlier, too-wide version: it read as broken rather than a livery
    # accent). A: thin emissive pinstripe on its edge. Both feathered with a small blur so the mask
    # itself is legible on inspection, not just functionally correct when sampled by a shader.
    G = Image.new("L", (RES, RES), 0)
    Achan = Image.new("L", (RES, RES), 0)
    gdraw, adraw = ImageDraw.Draw(G), ImageDraw.Draw(Achan)
    decal_alpha = None
    if use_decal:
        decal_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "textures", "decal_sheet.png")
        decal_alpha = Image.open(decal_path).convert("RGBA").crop(DECAL_CROP).split()[3]  # alpha only -> G value
    for part, (rx, ry, rw, rh) in rects.items():
        x0, y0 = rx * RES, (1.0 - ry - rh) * RES  # rect is in UV (v-up); PIL is y-down
        x1, y1 = (rx + rw) * RES, (1.0 - ry) * RES
        w, h = x1 - x0, y1 - y0
        if use_decal and part in DECAL_PARTS:
            # register the real decal sheet (a flame graphic) into this part's atlas cell, scaled to
            # fill it with a small margin, using the decal's own alpha as the pattern-mask value.
            mx, my = w * 0.08, h * 0.15
            dw, dh = int(max(w - 2 * mx, 1)), int(max(h - 2 * my, 1))
            resized = decal_alpha.resize((dw, dh))
            G.paste(resized, (int(x0 + mx), int(y0 + my)))
            adraw.rectangle([x0 + mx, y0 + my, x0 + mx + dw, y0 + my + dh], fill=0)  # no emissive on decals
            continue
        band = w * 0.09  # slim accent stripe, ~18% of cell width total
        cx = (x0 + x1) / 2
        skew = h * 0.12  # gentle diagonal, not a hard 45-degree cut
        poly = [(cx - band, y0), (cx + band, y0), (cx + band - skew, y1), (cx - band - skew, y1)]
        gdraw.polygon(poly, fill=255)
        edge_w = max(band * 0.18, 4)
        edge = [(cx + band, y0), (cx + band + edge_w, y0), (cx + band + edge_w - skew, y1), (cx + band - skew, y1)]
        adraw.polygon(edge, fill=230)
    G = G.filter(ImageFilter.GaussianBlur(radius=2.5))
    Achan = Achan.filter(ImageFilter.GaussianBlur(radius=1.5))
    stats["timing_s"] = round(time.time() - t0, 2)

    mask = Image.merge("RGBA", (R, G, B, Achan))
    mask_path = os.path.join(out_dir, f"mask{suffix}.png")
    mask.save(mask_path)

    # Evidence: an atlas-layout diagnostic (rects labelled) and a readable dirt preview.
    diag = Image.new("RGB", (RES, RES), (20, 20, 24))
    dd = ImageDraw.Draw(diag)
    palette = [(230, 80, 80), (80, 180, 230), (230, 200, 80), (120, 220, 120), (200, 120, 230), (230, 150, 80)]
    for i, (part, (rx, ry, rw, rh)) in enumerate(rects.items()):
        x0, y0 = rx * RES, (1.0 - ry - rh) * RES
        x1, y1 = (rx + rw) * RES, (1.0 - ry) * RES
        dd.rectangle([x0, y0, x1, y1], outline=palette[i % len(palette)], width=3)
        dd.text((x0 + 6, y0 + 6), part, fill=palette[i % len(palette)])
    diag.save(os.path.join(out_dir, f"atlas_layout{suffix}.png"))
    mask.save(os.path.join(out_dir, f"mask_channels{suffix}.png"))
    for ch, im in (("R", R), ("G", G), ("B", B), ("A", Achan)):
        im.save(os.path.join(out_dir, f"mask_{ch}{suffix}.png"))

    channel_meanings = {"R": "paint mask (1=paint body panel)", "G": "pattern mask (procedural diagonal stripe)",
                         "B": "dirt/damage (AO+curvature transferred UV1->UV0)",
                         "A": "emissive accent (procedural pinstripe glow)"}
    info = {"mask_texture": os.path.basename(mask_path), "size": mask.size, "channels": channel_meanings,
            "uv_set": "UV0 (TEXCOORD_0)", "stats": stats, "source_bakes": sidecar["bake_images"]}
    with open(os.path.join(out_dir, f"mask{suffix}.json"), "w") as f:
        json.dump(info, f, indent=2)
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    use_decal = "--decal" in sys.argv[4:]
    main(sys.argv[1], sys.argv[2], sys.argv[3], use_decal=use_decal)
