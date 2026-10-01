"""measure_side.py — pull the Cruze's recognition geometry out of the orthographic SIDE reference (pure PIL).
Writes recog/side_spec.json (metres, origin midway between wheel centres, +z toward the FRONT, y up from the ground):
  silhouette top profile, belt line (bottom of the glass), glass polygons (DLO), wheel centres/radius, sill, hood/deck ends."""
import json, math
from PIL import Image
REF = '../../refs/side.png'
LEN = 4.60                           # real length (m) -> metres per px
im = Image.open(REF).convert('L'); W, H = im.size
px = im.load()
fg = lambda x, y: px[x, y] < 235
xs = [x for x in range(W) if any(fg(x, y) for y in range(0, H, 2))]
x0, x1 = xs[0], xs[-1]; m = LEN / (x1 - x0)
ys = [y for y in range(H) if any(fg(x, y) for x in range(x0, x1, 3))]
ytop, ybot = ys[0], ys[-1]
ground = ybot
# wheels: near-black tyre pixels
tyre = lambda x, y: px[x, y] < 40
cols = [(x, sum(1 for y in range(ytop, ybot + 1) if tyre(x, y))) for x in range(x0, x1 + 1)]
half = (x0 + x1) // 2
def wheel(lo, hi):
    seg = [c for c in cols if lo <= c[0] < hi and c[1] > 20]
    xa, xb = seg[0][0], seg[-1][0]
    return (xa + xb) / 2, (xb - xa) / 2
wf, wfr = wheel(x0, half); wr, wrr = wheel(half, x1 + 1)
# tyre vertical extent at the wheel centre column
def col_extent(x):
    ys_ = [y for y in range(ytop, ybot + 1) if tyre(int(x), y)]
    return ys_[0], ys_[-1]
tf = col_extent(wf); wheel_r = (tf[1] - tf[0]) / 2 * m
mid = (wf + wr) / 2
Z = lambda x: (mid - x) * m          # +z toward the front (image left = front)
Y = lambda y: (ground - y) * m
# top silhouette profile every ~5 cm
prof = []
step = max(1, round(0.05 / m))
for x in range(x0, x1 + 1, step):
    col = [y for y in range(ytop, ybot + 1) if fg(x, y)]
    if col: prof.append([round(Z(x), 3), round(Y(min(col)), 3)])
# glass regions: mid-grey ~#666 (102) — flood fill on a coarse grid
def is_glass(x, y): return 82 <= px[x, y] <= 126
seen = set(); comps = []
for y in range(ytop, ybot + 1, 2):
    for x in range(x0, x1 + 1, 2):
        if (x, y) in seen or not is_glass(x, y): continue
        stack = [(x, y)]; seen.add((x, y)); pts = []
        while stack:
            cx, cy = stack.pop(); pts.append((cx, cy))
            for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                nx, ny = cx + dx, cy + dy
                if x0 <= nx <= x1 and ytop <= ny <= ybot and (nx, ny) not in seen and is_glass(nx, ny):
                    seen.add((nx, ny)); stack.append((nx, ny))
        if len(pts) > 250: comps.append(pts)
def hull(points):
    pts = sorted(set(points))
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
glass = []
for pts in comps:
    hl = hull(pts)
    # simplify hull to <= 8 vertices by dropping the least significant
    poly = [(Z(x), Y(y)) for x, y in hl]
    while len(poly) > 8:
        best, bi = 1e9, 0
        for i in range(len(poly)):
            a, b, c = poly[i - 1], poly[i], poly[(i + 1) % len(poly)]
            area = abs((a[0]-c[0])*(b[1]-a[1]) - (a[0]-b[0])*(c[1]-a[1])) / 2
            if area < best: best, bi = area, i
        poly.pop(bi)
    zs = [p[0] for p in poly]; ysg = [p[1] for p in poly]
    glass.append({'bbox': [round(min(zs), 3), round(min(ysg), 3), round(max(zs), 3), round(max(ysg), 3)], 'poly': [[round(a, 3), round(b, 3)] for a, b in poly], 'px': len(pts)})
glass.sort(key=lambda g: -g['bbox'][0])       # front to back
spec = {
    'metres_per_px': m, 'length_m': LEN, 'wheelbase_m': round((wr - wf) * m, 3), 'wheel_r_m': round(wheel_r, 3),
    'front_overhang_m': round((wf - x0) * m, 3), 'rear_overhang_m': round((x1 - wr) * m, 3),
    'wheels': {'front_z': round(Z(wf), 3), 'rear_z': round(Z(wr), 3)}, 'height_m': round((ground - ytop) * m, 3),
    'top_profile': prof, 'glass': glass,
}
json.dump(spec, open('side_spec.json', 'w'), indent=1)
print('wheelbase', spec['wheelbase_m'], 'wheel_r', spec['wheel_r_m'], 'height', spec['height_m'], 'overhangs', spec['front_overhang_m'], spec['rear_overhang_m'])
for g in glass: print('glass', g['bbox'], 'px', g['px'])
print('roof peak', max(prof, key=lambda p: p[1]))
print([p for p in prof][::6])
