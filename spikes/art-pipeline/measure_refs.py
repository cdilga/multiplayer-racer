"""Measure side/top reference silhouettes into profiles (metres). python3 measure_refs.py -> out/profiles.json"""
from PIL import Image
import json
L = 4.60  # real length (m)
def load(n, w=384):
    im = Image.open(f"refs/{n}.png").convert("L"); h = round(im.height * w / im.width)
    return im.resize((w, h)), w, h
side, W, H = load("side"); px = side.load()
cols = [x for x in range(W) if any(px[x, y] < 235 for y in range(H))]
x0, x1 = cols[0], cols[-1]
ys = [y for y in range(H) for x in (W // 2,) if px[x, y] < 235]
ground = max(y for x in range(x0, x1) for y in range(H) if px[x, y] < 235)
m = L / (x1 - x0)  # metres per px (orthographic)
N = 48; prof = []
for i in range(N + 1):
    x = round(x0 + (x1 - x0) * i / N); x = min(max(x, x0 + 1), x1 - 1)
    col = [px[x, y] for y in range(H)]
    fg = [y for y in range(H) if col[y] < 235]
    top = min(fg)
    tyre = [y for y in fg if col[y] < 45]                     # near-black tyre pixels
    bottom = (min(tyre) - 2) if len(tyre) > 6 else max(fg)     # body stops at the arch above the tyre
    glass = [y for y in fg if 60 < col[y] < 125 and y < top + (bottom - top) * 0.55]
    belt = max(glass) if len(glass) > 4 else None
    prof.append({"x": round((x - x0) * m, 3), "top": round((ground - top) * m, 3),
                 "bottom": round((ground - bottom) * m, 3), "belt": round((ground - belt) * m, 3) if belt else None})
# wheel centres: columns with most tyre pixels, two clusters
tyrecount = [(x, sum(1 for y in range(H) if px[x, y] < 45)) for x in range(x0, x1)]
half = (x0 + x1) // 2
wf = max((t for t in tyrecount if t[0] < half), key=lambda t: t[1])[0]
wr = max((t for t in tyrecount if t[0] >= half), key=lambda t: t[1])[0]
tyre_top = min(y for y in range(H) if px[wf, y] < 45)
# top view half-widths (clip mirrors: median over neighbours)
top, TW, TH = load("top"); tp = top.load()
tc = [x for x in range(TW) if any(tp[x, y] < 235 for y in range(TH))]; tx0, tx1 = tc[0], tc[-1]
tm = L / (tx1 - tx0); widths = []
for i in range(N + 1):
    x = round(tx0 + (tx1 - tx0) * i / N); x = min(max(x, tx0 + 1), tx1 - 1)
    fg = [y for y in range(TH) if tp[x, y] < 235]
    widths.append((max(fg) - min(fg)) * tm / 2)
sm = [sorted(widths[max(0, i - 3):i + 4])[len(widths[max(0, i - 3):i + 4]) // 2] for i in range(len(widths))]
for p, w in zip(prof, sm): p["halfwidth"] = round(min(w, 0.9), 3)
# smooth the beltline: greenhouse = span where roof is well above the median belt; one belt height
bs = sorted(p["belt"] for p in prof if p["belt"] is not None); belt_med = bs[len(bs) // 2]
for p in prof:
    p["belt"] = round(belt_med, 3) if p["top"] > belt_med + 0.18 else None
out = {"length": L, "profile": prof, "wheel_x": [round((wf - x0) * m, 3), round((wr - x0) * m, 3)],
       "wheel_radius": round((ground - tyre_top) * m / 2, 3), "front": "x=0 (car faces -x in refs)"}
json.dump(out, open("out/profiles.json", "w"), indent=1)
print("wheelbase", round(out["wheel_x"][1] - out["wheel_x"][0], 3), "wheel_r", out["wheel_radius"],
      "height", max(p["top"] for p in prof), "maxhalfwidth", max(p["halfwidth"] for p in prof))
