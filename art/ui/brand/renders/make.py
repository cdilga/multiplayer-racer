#!/usr/bin/env python3
"""Cut-out renders for the design sheets and mocks (P1-U01.3, R102 "big renders").

The stand-in is Spike J's canonical L0 hero render of the Cruz Missile (spikes/art-pipeline/J-cruze-lowpoly/, R81),
rendered on a flat grey backdrop. This keys out the backdrop and the grey contact shadow (pages draw their own ink
outline and sticker shadow round the cut-out), crops to the car and writes brand/renders/cruz-missile-hero.png at 2x
(nearest, so the low-poly edges stay crisp).
The renderer makes the real ones later; this file only exists so the sheets can show a render as a first-class element.

Run: python3 art/ui/brand/renders/make.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE.parents[3] / 'spikes/art-pipeline/J-cruze-lowpoly/out/evidence/ladder_L0_hero.png'
OUT = HERE / 'cruz-missile-hero.png'


def main() -> None:
    im = Image.open(SRC).convert('RGBA')
    bg = im.getpixel((2, 2))[:3]
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            spread = max(r, g, b) - min(r, g, b)
            # The backdrop, and the contact shadow (darker than the backdrop but unsaturated and lighter than the car's
            # own greys).
            if d <= 3 or (spread <= 6 and 120 < max(r, g, b) < bg[0]):
                px[x, y] = (0, 0, 0, 0)
    box = im.getbbox()
    pad = 6
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
    car = im.crop(box)
    car = car.resize((car.width * 2, car.height * 2), Image.NEAREST)
    car.save(OUT, optimize=True)
    print(f'{OUT.relative_to(HERE.parents[3])}: {car.width}x{car.height} from {SRC.name} (backdrop {bg})')


if __name__ == '__main__':
    main()
