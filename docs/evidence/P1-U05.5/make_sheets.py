#!/usr/bin/env python3
"""P1-U05.5 contact sheets from the captures (run after art/ui/poc/world/capture-looks.mjs): every look at 1, 8 and 24
tiles, the ink modes, the halftone before/after and the shimmer before/after at grid-tile size. Needs Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
LOOKS = ['fury-road', 'dust-storm', 'bleached-heat', 'scavenged', 'burnt-dusk', 'round1']
NAMES = {'fury-road': 'Fury road (recommended)', 'dust-storm': 'Dust storm', 'bleached-heat': 'Bleached heat', 'scavenged': 'Scavenged',
         'burnt-dusk': 'Burnt dusk', 'round1': 'Round 1 (for comparison)'}
try:
    FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 26)
except OSError:
    FONT = ImageFont.load_default()


def label(im, text):
    d = ImageDraw.Draw(im)
    w = d.textlength(text, font=FONT)
    d.rectangle([8, 8, 24 + w, 46], fill=(21, 32, 58))
    d.text((16, 12), text, fill=(255, 244, 222), font=FONT)
    return im


def sheet(cells, cols, size, out):
    rows = (len(cells) + cols - 1) // cols
    o = Image.new('RGB', (cols * size[0], rows * size[1]), (21, 32, 58))
    for k, (path, text, scale) in enumerate(cells):
        im = Image.open(HERE / path).convert('RGB')
        im = im.resize(size, Image.NEAREST if scale == 'nearest' else Image.LANCZOS)
        o.paste(label(im, text), ((k % cols) * size[0], (k // cols) * size[1]))
    o.save(HERE / out, quality=86)
    print(out, o.size)


for state, tag in [('tv', '1 tile'), ('grid_n8', '8 tiles'), ('grid_n24', '24 tiles')]:
    sheet([(f'looks/{l}__{state}.jpg', f'{NAMES[l]}, {tag}', None) for l in LOOKS], 2, (960, 540), f'sheet-looks-{state}.jpg')
sheet([(f'closeup/{t}.jpg', n, None) for t, n in [('outer', 'Ink: outer silhouette (recommended)'), ('silhouette', 'Ink: silhouette only'),
                                                  ('full', 'Ink: round 0, everywhere'), ('none', 'No ink')]], 2, (960, 540), 'sheet-ink.jpg')
sheet([(f'closeup/{t}.jpg', n, None) for t, n in [('round1-halftone-on-car', 'Before: round 1, halftone on the car'), ('round1-look', 'After: round 1 look, halftone on the ground only'),
                                                  ('debug-halftone-before', 'Before: halftone channel'), ('debug-halftone-after', 'After: halftone channel (cars black)')]], 2, (960, 540), 'sheet-halftone.jpg')
sheet([(f'shimmer/grid-tile-{t}-{k}.{"jpg" if k == "frame" else "png"}', f'{n}: {"frame" if k == "frame" else "flicker"}', 'nearest')
       for t, n in [('round1-lines', 'Before: round 1 lines'), ('texture-af16', 'After: textured road, AF16')] for k in ['frame', 'heat']], 2, (960, 768), 'sheet-shimmer-grid-tile.jpg')
