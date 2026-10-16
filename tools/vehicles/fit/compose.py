# compose.py <capture dir> <masks dir> [sheet] (br-bwju.3, from Spike J): the review sheet: reference crop | our shaded view
# | silhouette diff (red = reference only, green = ours only) for each view, then the reference hero beside ours.
import sys, json
from PIL import Image, ImageDraw

d, masks = sys.argv[1].rstrip('/') + '/', sys.argv[2].rstrip('/') + '/'
sheet = sys.argv[3] if len(sys.argv) > 3 else 'lod1'
sc = json.load(open(d + 'score.json'))


def fit(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def trim(im):
    bg = im.getpixel((2, 2)); px = im.load(); w, h = im.size
    xs = [x for x in range(w) for y in range(0, h, 4) if sum(abs(a - b) for a, b in zip(px[x, y][:3], bg[:3])) > 30]
    ys = [y for y in range(h) for x in range(0, w, 4) if sum(abs(a - b) for a, b in zip(px[x, y][:3], bg[:3])) > 30]
    return im.crop((max(0, min(xs) - 6), max(0, min(ys) - 6), min(w, max(xs) + 6), min(h, max(ys) + 6))) if xs else im


rows = []
for v in ['side', 'front', 'rear', 'top']:
    hh = 420 if v == 'top' else 230
    ref = fit(Image.open(f'{masks}{sheet}_{v}.crop.png').convert('RGB'), hh)
    ours = fit(trim(Image.open(d + f'shade_{v}.png').convert('RGB')), hh)
    diff = fit(Image.open(d + f'diff_{v}.png').convert('RGB'), hh)
    rows.append((v, [ref, ours, diff]))
W = max(sum(i.width for i in r) + 40 for _, r in rows); Ht = sum(r[0].height + 28 for _, r in rows)
hero = [fit(Image.open(f'{masks}{sheet}_hero.crop.png').convert('RGB'), 300), fit(trim(Image.open(d + 'hero.png').convert('RGB')), 300)]
W = max(W, sum(i.width for i in hero) + 20); Ht += 330
c = Image.new('RGB', (W, Ht), (245, 245, 247)); g = ImageDraw.Draw(c); y = 0
for v, ims in rows:
    s = sc['views'][v]
    g.text((6, y + 6), f"{v}: IoU {s['iou']:.3f}  aspect {s['aspect']:.3f}  miss {s['miss']:.3f}  extra {s['extra']:.3f}", fill=(0, 0, 0)); y += 22; x = 0
    for im in ims: c.paste(im, (x, y)); x += im.width + 20
    y += ims[0].height + 6
x = 0
for im in hero: c.paste(im, (x, y + 10)); x += im.width + 20
g.text((6, Ht - 14), f"{sc['car']}  LOD{sc['lod']} vs {sheet}  tris {sc['stats']['tris']}  draws {sc['stats']['draws']}  score {sc['score']}", fill=(0, 0, 0))
c.save(d + 'sheet.png'); print(d + 'sheet.png', c.size)
