# compose.py — assemble out/tiles/*.png into the evidence sheets (PIL only). python3 compose.py [checks|parts|swap|ladder|hero|all]
import json, sys, os, glob
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.join(os.path.dirname(__file__), 'out'); T = os.path.join(OUT, 'tiles')
meta = json.load(open(os.path.join(OUT, 'capture-meta.json'))) if os.path.exists(os.path.join(OUT, 'capture-meta.json')) else {}
try: FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 18); SMALL = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 14)
except Exception: FONT = SMALL = ImageFont.load_default()
INK, BG = (42, 38, 34), (247, 238, 220)
def label(img, text, font=FONT, at=(8, 6)):
    d = ImageDraw.Draw(img); w = d.textlength(text, font=font); d.rectangle([at[0] - 4, at[1] - 2, at[0] + w + 4, at[1] + font.size + 4], fill=(255, 250, 240)); d.text(at, text, fill=INK, font=font); return img
def grid(rows, title, out, pad=6, scale=1.0):
    rows = [[(Image.open(p).convert('RGB') if p and os.path.exists(p) else None, t) for p, t in r] for r in rows]
    cw = max(im.width for r in rows for im, _ in r if im); ch = max(im.height for r in rows for im, _ in r if im)
    cw, ch = int(cw * scale), int(ch * scale)
    W = pad + max(len(r) for r in rows) * (cw + pad); H = 44 + len(rows) * (ch + pad) + pad
    sheet = Image.new('RGB', (W, H), BG); label(sheet, title, FONT, (10, 12))
    for j, r in enumerate(rows):
        for i, (im, t) in enumerate(r):
            x, y = pad + i * (cw + pad), 44 + j * (ch + pad)
            if im is None: continue
            if scale != 1.0: im = im.resize((cw, ch), Image.LANCZOS)
            sheet.paste(im, (x, y)); label_img = sheet.crop((x, y, x + cw, y + ch)); label(label_img, t, SMALL); sheet.paste(label_img, (x, y))
    sheet.save(os.path.join(OUT, out)); print('wrote', out, sheet.size)
def tp(n): return os.path.join(T, n + '.png')
what = sys.argv[1] if len(sys.argv) > 1 else 'all'
if what in ('hero', 'all'):
    grid([[(tp('hero_intact'), 'intact (L0, fast path)'), (tp('hero_crushed'), 'badly crushed: FL+roof+bonnet tent, door loose, glass smashed')],
          [(tp('hero_missing_door_bonnet'), 'missing door + bonnet: real cavities'), (tp('hero_door_upside_down'), 'detached door, upside down, keeps its crush')],
          [(tp('field_pile'), 'persistent wrecks + debris (dynamic, sleeping)'), (tp('hero_intact_rear'), 'intact rear')]],
         'Cruz Missile — decision-standard shots (spike I, Three.js primitives)', 'sheet_decision.png', scale=0.6)
if what in ('checks', 'all'):
    names = meta.get('checks') or [os.path.basename(p)[6:-4] for p in sorted(glob.glob(os.path.join(T, 'check_*.png')))]
    rows = [[(tp('check_' + n), n.replace('_', ' ')) for n in names[i:i + 4]] for i in range(0, len(names), 4)]
    grid(rows, 'Explicit failure checks (L0): thickness, cavities, retained deformation, wreck', 'sheet_checks.png', scale=0.8)
if what in ('parts', 'all'):
    cols = [('0_intact', 'on car: intact'), ('1_maxdeform', 'max deformation'), ('2_loose', 'open / loose'), ('3_removed', 'removed: what is revealed'),
            ('4_outside', 'detached: outside'), ('5_inside', 'inside / back'), ('6_edge', 'edge-on'), ('7_top', 'top'), ('8_under', 'flipped / underside')]
    parts = meta.get('parts') or sorted({os.path.basename(p).split('_')[1] for p in glob.glob(os.path.join(T, 'part_*.png'))})
    rows = [[(tp(f'part_{pid}_{c}'), f'{pid} · {t}') for c, t in cols] for pid in parts]
    grid(rows, 'Per-part damage sheet (L0): every detachable part from every side, at maximum deformation once detached', 'sheet_parts.png', scale=0.62)
if what in ('swap', 'all') and meta.get('swap'):
    rows = []
    for lod in range(4):
        r = []
        for az in (34, 148, 90):
            s = next(x for x in meta['swap'] if x['lod'] == lod and x['az'] == az)
            r += [(tp(f'swap_L{lod}_{az}_intact'), f'L{lod} intact ({az}°)'), (tp(f'swap_L{lod}_{az}_assembly'), f'assembly: {s["pctPixelsOver12"]}% px differ')]
        rows.append(r)
    grid(rows, 'Swap identity: intact fast path vs damage-ready assembly at zero damage (same camera)', 'sheet_swap.png', scale=0.42)
if what in ('ladder', 'all') and meta.get('ladder'):
    rows = []
    for state in ('intact', 'damaged'):
        for px in (520, 190, 120, 70, 40):
            items = [x for x in meta['ladder'] if x['state'] == state and x['px'] == px]
            if not items: continue
            r = []
            for x in items:
                im = Image.open(tp(f"ladder_{state}_{px}_L{x['lod']}")).convert('RGB'); k = max(1, round(360 / im.height))
                big = im.resize((im.width * k, im.height * k), Image.NEAREST); p = os.path.join(T, f"_up_ladder_{state}_{px}_L{x['lod']}.png"); big.save(p)
                r.append((p, f"{state} · {px}px · L{x['lod']}  (x{k} nearest)"))
            rows.append(r)
    grid(rows, 'LOD pairs at the projected sizes where the switch happens (car sphere diameter in px), shown pixel-exact', 'sheet_ladder.png', scale=0.55)
