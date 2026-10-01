"""compose.py — labelled evidence sheets from out/*.png (PIL only)."""
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
OUT = 'out'; REFS = '../refs'; BG = (243, 230, 207)
def font(sz, bold=False):
    for p in ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial.ttf']:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz, index=1 if bold and p.endswith('.ttc') else 0)
            except Exception: pass
    return ImageFont.load_default()
def autocrop(im, bg, tol=18, pad=24):
    im = im.convert('RGB'); px = im.load(); w, h = im.size; minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > tol * 3:
                minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)
    return im.crop((max(0, minx - pad), max(0, miny - pad), min(w, maxx + pad), min(h, maxy + pad)))
def fit(im, w, h, bg=(255, 255, 255)):
    im = im.copy(); im.thumbnail((w, h), Image.LANCZOS); c = Image.new('RGB', (w, h), bg); c.paste(im, ((w - im.width) // 2, (h - im.height) // 2)); return c
def label(canvas, xy, text, sz=22, fill=(30, 26, 22), bold=True):
    ImageDraw.Draw(canvas).text(xy, text, font=font(sz, bold), fill=fill)

# ── 1. reference comparison ─────────────────────────────────────────────────────────────────────
def compare():
    tw, th = 640, 400; W = tw * 2 + 30; rows = 3
    sheet = Image.new('RGB', (W * 3 + 40, 60 + rows * (th + 46) + 40 + 470), (250, 246, 238))
    label(sheet, (20, 14), 'Cruze reference vs primitives-only build (orthographic-style views, same framing)', 28)
    for i, name in enumerate(['front', 'side', 'rear']):
        ref = Image.open(f'{REFS}/{name}.png').convert('RGB'); ref = autocrop(ref, (255, 255, 255), 14, 20)
        ours = autocrop(Image.open(f'{OUT}/cruze_ortho_{name}.png'), BG, 14, 20)
        x0 = 20 + i * (W + 0)
        sheet.paste(fit(ref, tw, th), (x0, 70)); sheet.paste(fit(ours, tw, th, BG), (x0 + tw + 10, 70))
        label(sheet, (x0 + 6, 70 + th + 6), f'{name}: reference (Codex ortho of a 2012 Cruze)', 15, bold=False)
        label(sheet, (x0 + tw + 16, 70 + th + 6), f'{name}: ours', 15, bold=False)
    y = 70 + th + 46
    label(sheet, (20, y), 'Where it lands: Codex concept (the look we chase) -> previous Blender spike (G-cruze-v2) -> this spike (three.js primitives)', 22)
    y += 40; ph = 400
    tiles = [
        ('refs/codex_concept_cruze.png', 'Codex concept (target look)', None),
        ('refs/blender_v2_hero.png', 'Blender v2 (prev. spike)', None),
        (f'{OUT}/cruze_hero_gold.png', 'this spike — golden Cruze', BG),
        (f'{OUT}/cruze_hero_red.png', 'this spike — player red', BG),
    ]
    x = 20; tw2 = (sheet.width - 40 - 30) // 4
    for path, cap, bgc in tiles:
        im = Image.open(path).convert('RGB')
        if bgc: im = autocrop(im, bgc, 14, 30)
        sheet.paste(fit(im, tw2, ph, bgc or (255, 255, 255)), (x, y)); label(sheet, (x + 4, y + ph + 4), cap, 16, bold=False); x += tw2 + 10
    sheet = sheet.crop((0, 0, sheet.width, y + ph + 40)); sheet.save(f'{OUT}/cruze_vs_refs.png'); print('cruze_vs_refs', sheet.size)

# ── 2. LOD ladder ───────────────────────────────────────────────────────────────────────────────
def lods():
    m = json.load(open(f'{OUT}/metrics.json')); n = 4; tw, th = 620, 400
    sheet = Image.new('RGB', (tw * n + 20 * (n + 1), 60 + th * 2 + 40 + 220 + 30), (250, 246, 238))
    label(sheet, (20, 14), 'LOD is a parameter of every primitive (not decimation): same code, same parts, same pivots', 26)
    names = ['LOD0 hero', 'LOD1 gameplay (baseline)', 'LOD2 medium', 'LOD3 distant']
    for i in range(n):
        x = 20 + i * (tw + 20); k = f'cruze_lod{i}'
        a = autocrop(Image.open(f'{OUT}/{k}.png'), BG, 14, 20); b = autocrop(Image.open(f'{OUT}/{k}_wire.png'), BG, 14, 20)
        sheet.paste(fit(a, tw, th, BG), (x, 60)); sheet.paste(fit(b, tw, th, BG), (x, 60 + th + 6))
        label(sheet, (x + 6, 60 + 2), f"{names[i]}   {m[k]['tris']:,} tris · {m[k]['geometryKB']} KB geo · build {m[k]['buildMs']} ms", 17)
        # 100px and 40px tall thumbnails (plan: readable at 40 px)
        for j, hpx in enumerate([100, 40]):
            t = a.copy(); t.thumbnail((999, hpx), Image.LANCZOS); sheet.paste(t, (x + 6 + j * 180, 60 + th * 2 + 30))
    label(sheet, (20, 60 + th * 2 + 4), 'wireframes above; thumbnails below at 100 px and 40 px tall (actual pixels)', 15, bold=False)
    sheet.save(f'{OUT}/cruze_lods.png'); print('cruze_lods', sheet.size)

# ── 3. strips ───────────────────────────────────────────────────────────────────────────────────
def strip(names, caps, out, cols, title, scale=0.62, crop=None):
    ims = [Image.open(f'{OUT}/{n}.png').convert('RGB') for n in names]
    if crop: ims = [im.crop(crop) for im in ims]
    w, h = ims[0].size; tw, th = int(w * scale), int(h * scale); rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (tw * cols + 12 * (cols + 1), 56 + rows * (th + 40)), (250, 246, 238)); label(sheet, (14, 12), title, 24)
    for i, (im, cp) in enumerate(zip(ims, caps)):
        x = 12 + (i % cols) * (tw + 12); y = 56 + (i // cols) * (th + 40)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 30)); label(sheet, (x + 4, y + 4), f'{i + 1}. {cp}', 18)
    sheet.save(f'{OUT}/{out}.png'); print(out, sheet.size)

if __name__ == '__main__':
    compare(); lods()
    strip(['smash_00_pristine', 'smash_01_dents', 'smash_02_ajar', 'smash_03_doorgone', 'smash_05_wheel', 'smash_06_settled'],
          ['pristine', 'dents accumulate (bumper, bonnet, door)', 'door + bonnet hang loose on their hinges', 'door and headlamp torn off', 'wheel rips off and rolls away', 'aftermath: dents stay on the shell'],
          'cruze_smash_sheet', 3, 'Cruze — hit -> dent -> hinge loose -> detach (same geometry, no morph targets)', 0.6)
    strip(['bin_00_pristine', 'bin_01_dents', 'bin_02_lid_loose', 'bin_03_lid_off', 'bin_04_spill', 'bin_05_settled', 'bin_06_squish', 'bin_07_squish_settled'],
          ['pristine', 'dents', 'lid loose on its hinge', 'lid off, junk spills', 'knocked over', 'settled', 'driven over: squish', 'squished, lid gone'],
          'bin_smash_sheet', 4, 'Wheelie bin — dents, lid pops, junk spills, tips over, squish (crush is a vertex function)', 0.42)
