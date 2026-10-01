"""compose_recog.py <out.png> <dir> <views,comma> <label=prefix>...   photo row on top, then one row per variant (PIL only)."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
BG = (243, 230, 207); PH = '../refs/photos'
def font(sz, bold=False):
    for p in ['/System/Library/Fonts/Helvetica.ttc']:
        try: return ImageFont.truetype(p, sz, index=1 if bold else 0)
        except Exception: pass
    return ImageFont.load_default()
# photo crops matching each view (x0, y0, x1, y1)
CROPS = {'front3q': ('cruze_photo_4.jpg', (960, 560, 1720, 1080)), 'rear3q': ('cruze_photo_2.jpg', (0, 280, 1500, 1620)),
         'side': ('cruze_photo_3.jpg', (90, 610, 1260, 1100)), 'chase': (None, None), 'closeF': ('cruze_photo_4.jpg', (1060, 660, 1700, 1060)), 'closeR': ('cruze_photo_2.jpg', (300, 700, 1500, 1620))}
def fit(im, w, h, bg=BG):
    im = im.copy(); im.thumbnail((w, h), Image.LANCZOS); c = Image.new('RGB', (w, h), bg); c.paste(im, ((w - im.width) // 2, (h - im.height) // 2)); return c
out, d, views = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
rows = [a.split('=', 1) for a in sys.argv[4:]]
cw, ch, lab = 560, 373, 26
sheet = Image.new('RGB', (cw * len(views) + 10 * (len(views) + 1), (len(rows) + 1) * (ch + lab + 8) + 10), (250, 246, 238)); dr = ImageDraw.Draw(sheet)
def cell(r, ci, im, text):
    x = 10 + ci * (cw + 10); y = 8 + r * (ch + lab + 8)
    sheet.paste(fit(im, cw, ch), (x, y + lab)); dr.text((x + 2, y + 3), text, font=font(15, True), fill=(40, 34, 28))
for ci, v in enumerate(views):
    f, box = CROPS.get(v, (None, None))
    if f: cell(0, ci, Image.open(f'{PH}/{f}').convert('RGB').crop(box), f'REAL PHOTO - {v}')
    else: cell(0, ci, Image.new('RGB', (cw, ch), (250, 246, 238)), f'{v} (no photo: host chase cam)')
for ri, (label, prefix) in enumerate(rows, start=1):
    for ci, v in enumerate(views):
        p = f'{d}/{prefix}_{v}.png'
        if os.path.exists(p): cell(ri, ci, Image.open(p).convert('RGB'), f'{label} - {v}')
sheet.save(out); print(out, sheet.size)
