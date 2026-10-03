#!/usr/bin/env python3
"""P1-U05.3 evidence: the real references (left) next to the in-world mock's graphics (right). Writes refs-vs-world.jpg.

Run after `JJ_EVIDENCE_DIR=docs/evidence/P1-U05.3/world JJ_STATES='graphics,grid&n=24,tv,overview&n=16' node art/ui/poc/world/capture.mjs`:
    python3 docs/evidence/P1-U05.3/make_refs.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RAW = REPO / 'art/references/australia/raw'
ROWS = [
    ('W-beam guard rail', RAW / 'wbeam-brisbane-st-lucia.jpg', (960, 0, 1920, 540)),
    ('Chevron posts', RAW / 'chevrons-cunninghams-gap.jpg', (0, 540, 960, 1080)),
    ('Race-banner finish', REPO / 'art/ui/refs/owner-2026-10-03/world-finish-gantry-tatts-finke.png', (0, 0, 960, 540)),
]
INK, PAPER = (21, 32, 58), (255, 244, 222)


def fit(im, w, h):
    im = im.convert('RGB')
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def main() -> None:
    world = Image.open(HERE / 'world/captures/1080p-graphics.jpg')
    W, H = 720, 405
    out = Image.new('RGB', (24 + W + 16 + W + 24, 40 + len(ROWS) * (H + 40)), PAPER)
    d = ImageDraw.Draw(out)
    d.text((24, 12), 'Reference (language only, never content)', fill=INK)
    d.text((24 + W + 16, 12), 'In-world mock, #graphics (P1-U05.3)', fill=INK)
    for k, (label, ref, box) in enumerate(ROWS):
        y = 40 + k * (H + 40)
        d.text((24, y), label, fill=INK)
        out.paste(fit(Image.open(ref), W, H), (24, y + 16))
        out.paste(fit(world.crop(box), W, H), (24 + W + 16, y + 16))
    out.save(HERE / 'refs-vs-world.jpg', quality=82)
    print('refs-vs-world.jpg', out.size)


if __name__ == '__main__':
    main()
