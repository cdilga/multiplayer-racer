"""grid_overlay.py — draw a metric grid over front/rear references so features can be read off in metres.
x: metres from the centreline (+ = image right), y: metres above the ground."""
from PIL import Image, ImageDraw
import sys
name = sys.argv[1]; REF = f'../../refs/{name}.png'
im = Image.open(REF).convert('RGB'); W, H = im.size; px = im.convert('L').load()
fg = lambda x, y: px[x, y] < 235
xs = [x for x in range(W) if any(fg(x, y) for y in range(0, H, 3))]
ys = [y for y in range(H) if any(fg(x, y) for x in range(0, W, 3))]
ground = ys[-1]
# body width 1.79 m -> find the px extent of the body rows around mid-height (ignore mirrors): use row at ~0.6 m
def row_extent(yy): 
    r = [x for x in range(W) if fg(x, yy)]; return r[0], r[-1]
# scale from tyre-bottom to roof = 1.48 m
roof = ys[0]; scale = 1.48 / (ground - roof)          # m per px (height-based)
cx = W / 2
print(name, 'ground', ground, 'roof', roof, 'm/px', round(scale, 5), 'body px width @0.6m', row_extent(int(ground - 0.6 / scale)))
d = ImageDraw.Draw(im)
for k in range(-12, 13):
    x = cx + k * 0.1 / scale; d.line([(x, 0), (x, H)], fill=(255, 0, 0) if k % 5 == 0 else (255, 190, 190), width=1)
    if k % 5 == 0: d.text((x + 2, 4), f'{k*0.1:.1f}', fill=(200, 0, 0))
for k in range(0, 17):
    y = ground - k * 0.1 / scale; d.line([(0, y), (W, y)], fill=(0, 0, 255) if k % 5 == 0 else (190, 190, 255), width=1)
    if k % 5 == 0: d.text((4, y - 12), f'{k*0.1:.1f}', fill=(0, 0, 200))
im.save(f'grid_{name}.png')
