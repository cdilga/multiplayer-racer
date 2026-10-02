# compose_evidence.py — damage strip, LOD ladder and recolour sheets from out/evidence/ tiles.
import json
from PIL import Image, ImageDraw
D = 'out/evidence/'
def row(files, labels, h, title, out):
    ims = [Image.open(D + f).convert('RGB') for f in files]
    ims = [i.resize((round(i.width * h / i.height), h), Image.LANCZOS) for i in ims]
    W = sum(i.width for i in ims) + 10 * (len(ims) - 1); c = Image.new('RGB', (W, h + 44), (245, 245, 247)); g = ImageDraw.Draw(c)
    g.text((6, 4), title, fill=(0, 0, 0)); x = 0
    for i, l in zip(ims, labels): c.paste(i, (x, 22)); g.text((x + 6, h + 26), l, fill=(0, 0, 0)); x += i.width + 10
    c.save(out); return c
stages = ['0_intact', '1_dented', '2_doors_wheel', '3_front_gone', '4_shell', '4_shell_rear']
labs = ['0 intact', '1 dented: front, back, door', '2 door + wheel off', '3 front clip off', '4 shell: front, back, 3 doors, 2 wheels off', '4 shell (rear)']
for L in (0, 1): row([f'damage_L{L}_{s}.png' for s in stages], labs, 300, f'Damage states, LOD{L} (parts: front, back, 4 doors, 4 wheels; each intact -> dented -> detached)', f'out/damage_strip_L{L}.png')
meta = json.load(open(D + 'meta.json'))
tiles = []
for L in (0, 1, 2):
    t = meta['lods'][str(L)]
    row([f'ladder_L{L}_hero.png', f'ladder_L{L}_hero_wire.png', f'ladder_L{L}_rear.png', f'ladder_L{L}_rear_wire.png'], [f'LOD{L} {t["tris"]} tris, {t["draws"]} parts'] * 1 + ['wire', 'rear', 'wire'], 260, f'LOD{L}', f'out/ladder_L{L}.png')
ims = [Image.open(f'out/ladder_L{L}.png') for L in (0, 1, 2)]
c = Image.new('RGB', (max(i.width for i in ims), sum(i.height for i in ims)), (245, 245, 247)); y = 0
for i in ims: c.paste(i, (0, y)); y += i.height
c.save('out/ladder.png')
# thumbnails at game-tile sizes, scaled up 3x with nearest so the pixels are visible
th = []
for px in (100, 40):
    for L in (0, 1, 2):
        i = Image.open(D + f'ladder_L{L}_thumb{px}.png').convert('RGB'); th.append((f'L{L} @{px}px', i.resize((i.width * 3, i.height * 3), Image.NEAREST)))
W = sum(i.width for _, i in th[:3]) + 20; H = max(i.height for _, i in th[:3]) + max(i.height for _, i in th[3:]) + 60
c = Image.new('RGB', (W, H), (245, 245, 247)); g = ImageDraw.Draw(c); y = 0
for r in (th[:3], th[3:]):
    x = 0
    for l, i in r: g.text((x + 4, y + 2), l, fill=(0, 0, 0)); c.paste(i, (x, y + 18)); x += i.width + 10
    y += max(i.height for _, i in r) + 24
c.save('out/thumbs.png')
row([f'paint_{n}.png' for n in ('cyan', 'gold', 'red', 'purple')], ['cyan (reference)', 'gold', 'red', 'purple'], 220, 'Recolour: one atlas, paint colour swapped (livery accents keep their colours)', 'out/paint.png')
print('ok')
