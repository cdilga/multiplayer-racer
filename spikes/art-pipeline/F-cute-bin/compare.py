"""Build side-by-side comparison PNGs: our render(s) next to the matching reference image.

Run: python3 compare.py <round_tag>   e.g. python3 compare.py round1
Writes: out/<round>_compare_hero.png, out/<round>_compare_turnaround.png, out/<round>_compare_squish.png
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "out")
REFS = os.path.join(HERE, "..", "..", "..", "art", "style", "refs")
ROUND = sys.argv[1] if len(sys.argv) > 1 else "round1"


def font(sz=22):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", sz)
    except Exception:
        return ImageFont.load_default()


def label_strip(w, text, h=34, bg=(30, 28, 24), fg=(255, 244, 222)):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.text((10, 6), text, fill=fg, font=font(20))
    return im


def paste_row(images_with_labels, pad=16, bg=(240, 232, 214)):
    h = max(im.height for im, _ in images_with_labels) + 34 + pad * 2
    w = sum(im.width for im, _ in images_with_labels) + pad * (len(images_with_labels) + 1)
    canvas = Image.new("RGB", (w, h), bg)
    x = pad
    for im, label in images_with_labels:
        canvas.paste(label_strip(im.width, label), (x, pad))
        canvas.paste(im, (x, pad + 34))
        x += im.width + pad
    return canvas


def load(path):
    return Image.open(path).convert("RGB")


def resize_h(im, target_h):
    w = round(im.width * target_h / im.height)
    return im.resize((w, target_h))


# ---------------------------------------------------------------- hero (3/4 view)
hero_render = load(os.path.join(OUT, f"{ROUND}_hero_3q.png"))
hero_ref = load(os.path.join(REFS, "wheelie_bin.png"))
H = 640
row = paste_row([(resize_h(hero_render, H), f"{ROUND}: our 3/4 render"), (resize_h(hero_ref, H), "reference: wheelie_bin.png")])
row.save(os.path.join(OUT, f"{ROUND}_compare_hero.png"))
print("wrote", f"{ROUND}_compare_hero.png")

# ---------------------------------------------------------------- turnaround (4 views)
views = ["front", "side", "back", "top"]
th = 420
our_views = [resize_h(load(os.path.join(OUT, f"{ROUND}_turn_{v}.png")), th) for v in views]
our_sheet_w = sum(im.width for im in our_views) + 12 * (len(our_views) + 1)
our_sheet = Image.new("RGB", (our_sheet_w, th + 34 + 24), (255, 255, 255))
x = 12
for v, im in zip(views, our_views):
    our_sheet.paste(label_strip(im.width, v.upper(), bg=(255, 255, 255), fg=(20, 20, 20)), (x, 0))
    our_sheet.paste(im, (x, 34))
    x += im.width + 12
ref_sheet = load(os.path.join(REFS, "wheelie_bin_turnaround.png"))
ref_sheet = resize_h(ref_sheet, our_sheet.height)
gap = Image.new("RGB", (16, max(our_sheet.height, ref_sheet.height)), (240, 232, 214))
top_label = label_strip(our_sheet.width, f"{ROUND}: our turnaround (front/side/back/top)", bg=(30, 28, 24))
ref_label = label_strip(ref_sheet.width, "reference: wheelie_bin_turnaround.png", bg=(30, 28, 24))
row_h = max(our_sheet.height, ref_sheet.height)
canvas_w = our_sheet.width + 16 + ref_sheet.width
canvas = Image.new("RGB", (canvas_w, 34 + row_h), (240, 232, 214))
canvas.paste(top_label, (0, 0))
canvas.paste(ref_label, (our_sheet.width + 16, 0))
canvas.paste(our_sheet, (0, 34))
canvas.paste(ref_sheet, (our_sheet.width + 16, 34))
canvas.save(os.path.join(OUT, f"{ROUND}_compare_turnaround.png"))
print("wrote", f"{ROUND}_compare_turnaround.png")

# ---------------------------------------------------------------- squish sequence
squish_render = load(os.path.join(OUT, f"{ROUND}_squish.png"))
squish_ref = load(os.path.join(REFS, "wheelie_bin_squished.png"))
H2 = 460
col = Image.new(
    "RGB",
    (max(resize_h(squish_render, H2).width, resize_h(squish_ref, H2).width) + 24, H2 * 2 + 34 * 2 + 24 * 3),
    (240, 232, 214),
)
sr = resize_h(squish_render, H2)
rr = resize_h(squish_ref, H2)
y = 24
col.paste(label_strip(sr.width, f"{ROUND}: our squish sequence (intact -> dented -> squished top -> squished side -> broken+rubbish)"), (12, y))
y += 34
col.paste(sr, (12, y))
y += H2 + 24
col.paste(label_strip(rr.width, "reference: wheelie_bin_squished.png"), (12, y))
y += 34
col.paste(rr, (12, y))
col.save(os.path.join(OUT, f"{ROUND}_compare_squish.png"))
print("wrote", f"{ROUND}_compare_squish.png")
