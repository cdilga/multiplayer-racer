#!/usr/bin/env python3
"""P1-U01.3 evidence: the component sheet's top, before (round 0) and after (R102), next to the owner's four reference
screens. Writes compare-before.jpg and compare-after.jpg here.

Run after `node art/ui/sheets/render.mjs --out docs/evidence/P1-U01.3/after components`:
    python3 docs/evidence/P1-U01.3/make_compare.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
REFS = REPO / 'art/ui/refs/owner-2026-10-03'
SHEETS = {'before': REPO / 'docs/evidence/P1-U01/components.png', 'after': HERE / 'after/components.png'}
PAPER, INK = (255, 244, 222), (21, 32, 58)


def column(paths, width):
    ims = []
    for p in paths:
        im = Image.open(p).convert('RGB')
        ims.append(im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))
    return ims


def main() -> None:
    tv = column([REFS / 'tv-pause-menu.jpg', REFS / 'tv-intermission-highlights.jpg'], 820)
    phone = column([REFS / 'phone-intermission-vote.jpg', REFS / 'phone-join.jpg'], 330)
    refs_h = max(sum(i.height for i in tv) + 16, max(i.height for i in phone))
    for name, sheet in SHEETS.items():
        top = Image.open(sheet).convert('RGB')
        top = top.crop((0, 0, top.width, min(top.height, 1500)))
        top = top.resize((1240, round(top.height * 1240 / top.width)), Image.LANCZOS)
        X = 24 + 820 + 16 + 330 + 12 + 330 + 32
        W = X + top.width + 24
        H = max(refs_h, top.height) + 96
        out = Image.new('RGB', (W, H), PAPER)
        d = ImageDraw.Draw(out)
        d.text((24, 16), "Owner's reference screens (language only, never content)", fill=INK)
        d.text((X, 16), f'Component sheet, {name} (top 1500 px)', fill=INK)
        y = 48
        for im in tv:
            out.paste(im, (24, y))
            y += im.height + 16
        out.paste(phone[0], (24 + 820 + 16, 48))
        out.paste(phone[1], (24 + 820 + 16 + 330 + 12, 48))
        out.paste(top, (X, 48))
        out.save(HERE / f'compare-{name}.jpg', quality=82)
        print(f'compare-{name}.jpg {out.width}x{out.height}')


if __name__ == '__main__':
    main()
