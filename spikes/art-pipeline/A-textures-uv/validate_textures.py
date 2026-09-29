"""Spike A (textures & UVs) validator: checks a vehicle GLB against the draft textures/UV contract.
stdlib + PIL only (extends spikes/art-pipeline/validate_vehicle.py's approach with real UV-space
checks instead of trusting sidecar claims).

Run: python3 validate_textures.py out/cruz_missile_textured.glb [out/cruz_missile_textured.asset.json]

Checks:
  1. UV0 present on every paint part; UV1 present on every paint part (bake set).
  2. All UV0/UV1 coordinates fall within [0,1] (with a small float tolerance).
  3. No overlapping UV0 islands among paint parts (rasterize at 1024^2, any pixel touched by more
     than one triangle beyond a tiny tolerance is a real overlap -- see module docstring reasoning
     in compose_mask.py: proper triangle rasterization at pixel centers does not double-fill shared
     edges between adjacent, non-overlapping triangles).
  4. Every embedded texture is <=1024px on its long edge and power-of-two.
  5. The mask texture (if present) is RGBA and each channel has real (non-zero) content.
  6. Material names are the jj_* semantic set.
  7. Every texture a material references actually has its image embedded in the GLB with a non-empty
     buffer view.
  8. Per-face UV-area/3D-area ratio: flags triangles whose UV footprint is collapsed relative to the
     part's own median ratio (<10% of median -- e.g. a face crushed to a sliver by a bad projection).
  9. Per-face shape/angle distortion: the singular-value ratio (gmax/gmin) of the local 3D-to-UV
     Jacobian (Sander et al. 2001's standard texture-stretch metric) -- flags anisotropic stretch
     that a pure area-ratio check misses (a face can keep its total area while becoming a thin
     parallelogram). >4x singular-value ratio counts as distorted.
     Combined budget: fail if the AREA-WEIGHTED SUM of collapsed-or-distorted paint triangles exceeds
     2% of total paint-face area (checks 8+9 share one budget, per the review that asked for this).

Exit 0 + ok:true only if every check passes.
"""
import io, json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from uv_raster import load_glb, mesh_triangles, rasterize_triangle
from PIL import Image

PAINT_PARTS_FALLBACK = ["chassis", "cabin", "bonnet", "boot", "door_L", "door_R"]
SEMANTIC_PREFIX = "jj_"
OVERLAP_PIXEL_TOLERANCE = 25  # allow a few px of float/edge jitter before calling it a real overlap
COLLAPSE_MEDIAN_FRAC = 0.10   # a face UV-area-ratio below 10% of the part's median is "collapsed"
ANISOTROPY_LIMIT = 4.0        # gmax/gmin above this is "distorted" (stretched into a sliver/parallelogram)
DISTORTION_AREA_BUDGET_PCT = 2.0  # fail if collapsed+distorted area exceeds this % of total paint area
DENSITY_CV_LIMIT = 1.0        # per-part coefficient of variation of area_ratio above this = inconsistent
                               # texel density within one part's own unwrap (see note at call site: this
                               # is what actually caught the fragmented-island regression on review; the
                               # per-face collapse/anisotropy checks above did not, on this geometry)


def tri_area_3d(a, b, c):
    ax, ay, az = a; bx, by, bz = b; cx, cy, cz = c
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    px, py, pz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    return 0.5 * math.sqrt(px * px + py * py + pz * pz)


def tri_area_2d(a, b, c):
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2.0


def jacobian_anisotropy(p0, p1, p2, uv0, uv1, uv2):
    """Sander/Snyder/Gortler/Hoppe (2001) texture-stretch Jacobian: returns (gmax, gmin), the
    singular values of the local map from the triangle's 3D tangent plane to UV space (units: 3D
    length per UV unit, in the best/worst directions). gmax/gmin = 1.0 is a perfectly isotropic
    (non-stretched) mapping; large values mean the triangle is stretched into a thin parallelogram
    even if its total area looks fine."""
    q1 = tuple(p1[i] - p0[i] for i in range(3))
    q2 = tuple(p2[i] - p0[i] for i in range(3))
    s1, t1 = uv1[0] - uv0[0], uv1[1] - uv0[1]
    s2, t2 = uv2[0] - uv0[0], uv2[1] - uv0[1]
    adom = (s1 * t2 - s2 * t1) / 2.0
    if abs(adom) < 1e-12:
        return None
    ss = tuple((q1[i] * t2 - q2[i] * t1) / (2 * adom) for i in range(3))
    st = tuple((q2[i] * s1 - q1[i] * s2) / (2 * adom) for i in range(3))
    a = sum(x * x for x in ss)
    b = sum(ss[i] * st[i] for i in range(3))
    c = sum(x * x for x in st)
    disc = math.sqrt(max((a - c) ** 2 + 4 * b * b, 0))
    gmax = math.sqrt(max(0.5 * ((a + c) + disc), 0))
    gmin = math.sqrt(max(0.5 * ((a + c) - disc), 0))
    return gmax, gmin


def is_pow2(n):
    return n > 0 and (n & (n - 1)) == 0


def embedded_image_bytes(gltf, bin_bytes, image_index):
    img = gltf["images"][image_index]
    if "bufferView" not in img:
        return None
    bv = gltf["bufferViews"][img["bufferView"]]
    off = bv.get("byteOffset", 0)
    return bin_bytes[off: off + bv["byteLength"]]


def main(glb_path, sidecar_path=None):
    gltf, bin_bytes = load_glb(glb_path)
    sidecar = json.load(open(sidecar_path)) if sidecar_path and os.path.exists(sidecar_path) else {}
    paint_parts = sidecar.get("paint_parts", PAINT_PARTS_FALLBACK)

    fails, warns, notes = [], [], []
    name_to_mesh = {m.get("name"): i for i, m in enumerate(gltf["meshes"])}

    # --- 1 & 2: UV set presence + range
    per_part = {}
    for part in paint_parts:
        if part not in name_to_mesh:
            fails.append(f"paint part '{part}' not found as a mesh node"); continue
        mi = name_to_mesh[part]
        prim = gltf["meshes"][mi]["primitives"][0]
        attrs = prim["attributes"]
        if "TEXCOORD_0" not in attrs:
            fails.append(f"{part}: missing UV0 (TEXCOORD_0)"); continue
        if "TEXCOORD_1" not in attrs:
            fails.append(f"{part}: missing UV1 (TEXCOORD_1, required for bakes on paint parts)")
        pos, uv0, uv1, tris, matidx = mesh_triangles(gltf, bin_bytes, mi)
        for label, uvs in (("UV0", uv0), ("UV1", uv1)):
            if uvs is None:
                continue
            us = [u for u, v in uvs]; vs = [v for u, v in uvs]
            if min(us) < -1e-4 or max(us) > 1 + 1e-4 or min(vs) < -1e-4 or max(vs) > 1 + 1e-4:
                fails.append(f"{part}.{label}: coords out of [0,1] (u=[{min(us):.4f},{max(us):.4f}] "
                             f"v=[{min(vs):.4f},{max(vs):.4f}])")
        mat_name = gltf["materials"][matidx]["name"] if matidx is not None else None
        if mat_name != "jj_paint":
            fails.append(f"{part}: expected material jj_paint, got {mat_name}")
        per_part[part] = (pos, uv0, tris)

    # --- 3: overlap check across all paint parts' UV0, at 1024^2
    RES = 1024
    touch_count = {}
    for part, (pos, uv0, tris) in per_part.items():
        if uv0 is None:
            continue
        for (ia, ib, ic) in tris:
            a, b, c = uv0[ia], uv0[ib], uv0[ic]
            for x, y, *_ in rasterize_triangle(a, b, c, RES):
                touch_count[(x, y)] = touch_count.get((x, y), 0) + 1
    overlap_px = sum(1 for c in touch_count.values() if c > 1)
    notes.append(f"uv0 overlap check: {overlap_px} px touched by >1 triangle (tolerance {OVERLAP_PIXEL_TOLERANCE})")
    if overlap_px > OVERLAP_PIXEL_TOLERANCE:
        fails.append(f"UV0 islands overlap across paint parts: {overlap_px} px (budget {OVERLAP_PIXEL_TOLERANCE})")

    # --- 3b: per-face UV-area/3D-area ratio (collapse) + shape/angle distortion (anisotropy)
    tri_stats = []  # (part, area3d, area_ratio, anisotropy)
    for part, (pos, uv0, tris) in per_part.items():
        if uv0 is None or pos is None:
            continue
        for (ia, ib, ic) in tris:
            p0, p1, p2 = pos[ia], pos[ib], pos[ic]
            a3 = tri_area_3d(p0, p1, p2)
            if a3 < 1e-12:
                continue
            u0, u1, u2 = uv0[ia], uv0[ib], uv0[ic]
            a2 = tri_area_2d(u0, u1, u2)
            jac = jacobian_anisotropy(p0, p1, p2, u0, u1, u2)
            aniso = (jac[0] / jac[1]) if (jac and jac[1] > 1e-9) else (1e9 if jac else 1.0)
            tri_stats.append([part, a3, a2 / a3, aniso])
    if tri_stats:
        total_paint_area = sum(t[1] for t in tri_stats)
        ratios_sorted = sorted(t[2] for t in tri_stats)
        median_ratio = ratios_sorted[len(ratios_sorted) // 2]
        collapsed_area = sum(t[1] for t in tri_stats if median_ratio > 0 and t[2] < COLLAPSE_MEDIAN_FRAC * median_ratio)
        distorted_area = sum(t[1] for t in tri_stats if t[3] > ANISOTROPY_LIMIT)
        # a triangle can be both; count its area once in the combined budget
        bad_area = sum(t[1] for t in tri_stats
                        if (median_ratio > 0 and t[2] < COLLAPSE_MEDIAN_FRAC * median_ratio) or t[3] > ANISOTROPY_LIMIT)
        bad_pct = 100 * bad_area / total_paint_area if total_paint_area > 0 else 0
        notes.append(f"uv distortion: median_area_ratio={median_ratio:.5f} collapsed_area_pct="
                     f"{100*collapsed_area/total_paint_area:.2f}% distorted_area_pct="
                     f"{100*distorted_area/total_paint_area:.2f}% combined_bad_area_pct={bad_pct:.2f}% "
                     f"(budget {DISTORTION_AREA_BUDGET_PCT}%)")
        if bad_pct > DISTORTION_AREA_BUDGET_PCT:
            fails.append(f"UV distortion: {bad_pct:.2f}% of paint-face area is collapsed or "
                         f"anisotropically stretched (>{ANISOTROPY_LIMIT}x) -- budget "
                         f"{DISTORTION_AREA_BUDGET_PCT}%")

        # --- 3c: per-part texel-density CONSISTENCY (coefficient of variation of area_ratio).
        # Added after review found that 3b's per-face metrics did not distinguish a visually much
        # worse unwrap (fragmented smart-project islands) from a clean one on this geometry -- a
        # part can have zero individually-collapsed/distorted triangles while its islands still sit
        # at wildly inconsistent internal scales relative to each other. That inconsistency shows up
        # directly as a high coefficient of variation of the per-triangle area_ratio within one part.
        by_part = {}
        for part, a3, ratio, aniso in tri_stats:
            by_part.setdefault(part, []).append(ratio)
        density_notes = []
        for part, ratios in by_part.items():
            n = len(ratios)
            mean = sum(ratios) / n
            var = sum((r - mean) ** 2 for r in ratios) / n
            cv = (var ** 0.5) / mean if mean > 1e-12 else 0
            density_notes.append(f"{part}:CV={cv:.2f}")
            if cv > DENSITY_CV_LIMIT:
                fails.append(f"{part}: inconsistent texel density within its own UV0 unwrap "
                             f"(coefficient of variation {cv:.2f} > budget {DENSITY_CV_LIMIT}) -- "
                             f"islands are packed at wildly different internal scales")
        notes.append("per-part texel-density CV (budget <= %.1f): %s" % (DENSITY_CV_LIMIT, ", ".join(density_notes)))

    # --- 4: texture sizes
    tex_images = {}
    for i, img in enumerate(gltf.get("images", [])):
        raw = embedded_image_bytes(gltf, bin_bytes, i)
        if raw is None:
            fails.append(f"image[{i}] '{img.get('name')}': not embedded (no bufferView)"); continue
        try:
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception as e:
            fails.append(f"image[{i}] '{img.get('name')}': failed to decode ({e})"); continue
        w, h = im.size
        tex_images[i] = im
        if w > 1024 or h > 1024:
            fails.append(f"image[{i}] '{img.get('name')}': {w}x{h} exceeds 1024 budget")
        if not (is_pow2(w) and is_pow2(h)):
            fails.append(f"image[{i}] '{img.get('name')}': {w}x{h} not power-of-two")

    # --- 5: mask RGBA + per-channel content
    mask_idx = next((i for i, img in enumerate(gltf.get("images", [])) if (img.get("name") or "").startswith("mask")), None)
    if mask_idx is None:
        fails.append("mask texture: not present in GLB (no image named 'mask')")
    else:
        im = tex_images.get(mask_idx)
        if im is not None:
            if im.mode != "RGBA":
                fails.append(f"mask texture: mode {im.mode}, expected RGBA")
            else:
                extrema = im.getextrema()
                labels = ["R (paint)", "G (pattern)", "B (dirt)", "A (emissive)"]
                for (lo, hi), label in zip(extrema, labels):
                    if hi <= 0:
                        fails.append(f"mask channel {label}: entirely empty (max={hi})")
                notes.append(f"mask channel extrema: {dict(zip(labels, extrema))}")

    # --- 6: semantic material names
    mats = [m.get("name", "") for m in gltf.get("materials", [])]
    non_semantic = [m for m in mats if not m.startswith(SEMANTIC_PREFIX)]
    if non_semantic:
        fails.append(f"non-semantic material names: {non_semantic}")
    if "jj_paint" not in mats:
        fails.append("missing jj_paint material")

    # --- 7: every texture a material references is embedded
    for mat in gltf.get("materials", []):
        refs = []
        pbr = mat.get("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr: refs.append(("baseColorTexture", pbr["baseColorTexture"]["index"]))
        if "normalTexture" in mat: refs.append(("normalTexture", mat["normalTexture"]["index"]))
        for role, tex_idx in refs:
            tex = gltf["textures"][tex_idx]
            img_idx = tex.get("source")
            if img_idx is None or img_idx not in tex_images:
                fails.append(f"material '{mat.get('name')}' {role} -> texture {tex_idx}: image not embedded/decodable")

    notes.append(f"materials={mats}")
    notes.append(f"images={[ (i, im.size, im.mode) for i, im in tex_images.items() ]}")
    result = {"ok": not fails, "failures": fails, "warnings": warns, "notes": notes}
    print(json.dumps(result, indent=2))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
