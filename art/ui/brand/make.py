#!/usr/bin/env python3
"""Generate the Joystick Jammers brand files (P1-U01): wordmark, app icon, favicon, QR rule.

Run (from anywhere):

    python art/ui/brand/make.py            # writes every file in art/ui/brand/
    python art/ui/brand/make.py --verify   # also rasterises the QR rule and decodes it (needs opencv)
    python art/ui/brand/make.py --svg-only # SVGs only, skip the PNG/ICO rasterisation

Needs: fonttools + brotli (WOFF2 read), qrcode, Pillow, and `node` with the repo-root Playwright
(Chromium) for the PNG rasterisation (rasterize.mjs). --verify additionally needs
opencv-python-headless. No network, no CDN, no installed fonts: every glyph in every SVG is an
outline path taken from the bundled WOFF2 files in art/ui/fonts/ (advances and GPOS kerning
included), and every colour comes from art/ui/tokens.json.

Outputs (all in art/ui/brand/):
  wordmark.svg, wordmark-on-ink.svg          the one lockup, for paper and for ink grounds
  app-icon.svg (rounded), app-icon-fullbleed.svg (square, for the PNG exports)
  app-icon-512.png, app-icon-192.png, apple-touch-icon-180.png     opaque, full bleed
  favicon.svg, favicon-32.png, favicon.ico (16, 32, 48)
  qr-rule.svg                                 the QR rule: real code + room code beside it
  qr-dont-logo.svg, qr-dont-quiet.svg, qr-dont-inverted.svg        negative examples for the sheet
"""

from __future__ import annotations

import glob
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import qrcode
import qrcode.constants
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

HERE = Path(__file__).resolve().parent
UI = HERE.parent
TOKENS = json.loads((UI / "tokens.json").read_text())
PAL = {name: c["hex"] for name, c in TOKENS["palette"].items()}

QR_URL = "https://jammers.dilger.dev/j/ROO7"
ROOM_CODE = "ROO7"
CAPTION = "Scan to join, or enter the code"


# ---------------------------------------------------------------------------------------------
# Text to outline paths
# ---------------------------------------------------------------------------------------------
def num(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Face:
    """A bundled WOFF2 face: glyph outlines, advances and GPOS pair kerning (latn/DFLT kern)."""

    def __init__(self, fname: str):
        self.font = TTFont(UI / "fonts" / fname)
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.hmtx = self.font["hmtx"]
        self.upm = self.font["head"].unitsPerEm
        self.cap = self.font["OS/2"].sCapHeight
        self._kern = self._load_kern()

    def _load_kern(self):
        gpos = self.font["GPOS"].table
        feats = gpos.FeatureList.FeatureRecord
        scripts = {s.ScriptTag: s.Script for s in gpos.ScriptList.ScriptRecord}
        script = scripts.get("latn") or scripts["DFLT"]
        lookup_ids: list[int] = []
        for i in script.DefaultLangSys.FeatureIndex:
            if feats[i].FeatureTag == "kern":
                lookup_ids += feats[i].Feature.LookupListIndex
        lookups = []
        for li in dict.fromkeys(lookup_ids):
            lk = gpos.LookupList.Lookup[li]
            subs = []
            for st in lk.SubTable:
                if lk.LookupType == 9:  # extension
                    st = st.ExtSubTable
                if hasattr(st, "ValueFormat1"):
                    subs.append((st, {g: i for i, g in enumerate(st.Coverage.glyphs)}))
            lookups.append(subs)
        return lookups

    def glyph(self, ch: str) -> str:
        return self.cmap[ord(ch)]

    def advance(self, gn: str) -> int:
        return self.hmtx[gn][0]

    def kern(self, g1: str, g2: str) -> int:
        """Sum of the first matching pair adjustment in each kern lookup (as a shaper does)."""
        total = 0
        for subs in self._kern:
            for st, cov in subs:
                if g1 not in cov:
                    continue
                if st.Format == 1:
                    rec = next((r for r in st.PairSet[cov[g1]].PairValueRecord if r.SecondGlyph == g2), None)
                    if rec is None:
                        continue
                    v = rec.Value1
                else:
                    c1 = st.ClassDef1.classDefs.get(g1, 0)
                    c2 = st.ClassDef2.classDefs.get(g2, 0)
                    v = st.Class1Record[c1].Class2Record[c2].Value1
                total += getattr(v, "XAdvance", 0) if v else 0
                break
        return total

    def run(self, text: str, scale: float, tx: float, ty: float, tracking: float = 0.0):
        """Outline path for `text`. Font units * scale; (tx, ty) = left origin on the baseline.

        Returns (d, (xmin, ymin, xmax, ymax), advance_in_svg_units); y is flipped for SVG.
        """
        pen = SVGPathPen(self.gs, ntos=num)
        bp = BoundsPen(self.gs)
        x = 0.0
        prev = None
        for ch in text:
            gn = self.glyph(ch)
            if prev is not None:
                x += self.kern(prev, gn) + tracking
            t = (scale, 0, 0, -scale, tx + x * scale, ty)
            self.gs[gn].draw(TransformPen(pen, t))
            self.gs[gn].draw(TransformPen(bp, t))
            x += self.advance(gn)
            prev = gn
        return pen.getCommands(), bp.bounds, x * scale

    def measure(self, text: str, tracking: float = 0.0):
        """Ink bounds of `text` at scale 1 with origin (0, 0) on the baseline."""
        _, b, adv = self.run(text, 1.0, 0.0, 0.0, tracking)
        return b, adv


def merge(*bs):
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))


def svg_doc(vb, body, title, desc, width=None, extra=""):
    x, y, w, h = vb
    wh = f' width="{num(width)}" height="{num(width * h / w)}"' if width else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x)} {num(y)} {num(w)} {num(h)}"{wh}{extra} '
        'role="img" aria-labelledby="t d">\n'
        f"<title id=\"t\">{title}</title>\n<desc id=\"d\">{desc}</desc>\n{body}</svg>\n"
    )


# ---------------------------------------------------------------------------------------------
# Wordmark
# ---------------------------------------------------------------------------------------------
# Geometry is in font units of the first line (JOYSTICK cap height = 700).
OUTLINE = 24  # visible ink outline per side (stroke-width is twice this; paint-order keeps the fill whole)
KEYLINE = 14  # paper keyline outside the outline, on-ink variant only
TRACK = 42  # extra letter-spacing, so thick outlines do not close the gaps and counters
LEAD_GAP = 34  # JOYSTICK baseline to JAMMERS cap top: outlines fuse into one sticker plate
SHADOW_DY = 0.06 * 700  # hard sticker shadow: 6% of cap height, straight down, no blur
JAM_INDENT = 16  # JAMMERS sits a touch to the right of JOYSTICK (the italic lean carries the rest)


def wordmark_parts():
    face = Face("barlow-condensed-900-italic.woff2")
    b1, _ = face.measure("JOYSTICK", TRACK)
    b2, _ = face.measure("JAMMERS", TRACK)
    s1 = 1.0
    s2 = (b1[2] - b1[0]) / (b2[2] - b2[0])  # JAMMERS scaled to the same ink width: the bigger, chunkier line
    cap1 = face.cap * s1
    cap2 = face.cap * s2
    base1 = 0.0
    base2 = base1 + LEAD_GAP + cap2
    d1, bb1, _ = face.run("JOYSTICK", s1, -b1[0], base1, TRACK)
    d2, bb2, _ = face.run("JAMMERS", s2, -b2[0] * s2 + JAM_INDENT, base2, TRACK)
    return d1, d2, merge(bb1, bb2), cap1, cap2


def wordmark_svg(on_ink: bool) -> str:
    d1, d2, bb, cap1, _ = wordmark_parts()
    ink, paper, saffron = PAL["ink"], PAL["paper"], PAL["saffron"]
    o, k = OUTLINE, KEYLINE
    sh = SHADOW_DY
    pad = 6
    margin = o + (k if on_ink else 0) + pad
    vb = (bb[0] - margin, bb[1] - margin, (bb[2] - bb[0]) + 2 * margin, (bb[3] - bb[1]) + 2 * margin + sh)
    j = 'stroke-linejoin="round" stroke-linecap="round"'
    parts = [f'<defs>\n<path id="joystick" d="{d1}"/>\n<path id="jammers" d="{d2}"/>\n</defs>\n']
    if on_ink:
        # paper keyline around the whole sticker silhouette (letters and their shadow)
        parts.append(
            f'<g id="keyline" fill="{paper}" stroke="{paper}" stroke-width="{num(2 * (o + k))}" {j}>'
            f'<use href="#joystick"/><use href="#jammers"/>'
            f'<use href="#joystick" y="{num(sh)}"/><use href="#jammers" y="{num(sh)}"/></g>\n'
        )
    parts.append(
        f'<g id="shadow" transform="translate(0 {num(sh)})" fill="{ink}" stroke="{ink}" '
        f'stroke-width="{num(2 * o)}" {j}><use href="#joystick"/><use href="#jammers"/></g>\n'
    )
    top_fill = paper if on_ink else ink
    parts.append(
        f'<g id="letters" stroke="{ink}" stroke-width="{num(2 * o)}" paint-order="stroke" {j}>'
        f'<use href="#joystick" fill="{top_fill}"/><use href="#jammers" fill="{saffron}"/></g>\n'
    )
    which = "on ink" if on_ink else "on paper"
    return svg_doc(
        vb,
        "".join(parts),
        "Joystick Jammers wordmark",
        f"JOYSTICK over JAMMERS in Barlow Condensed Black Italic, outlined in ink with a hard sticker shadow, for use {which}.",
        width=720,
    )


# ---------------------------------------------------------------------------------------------
# App icon and favicon
# ---------------------------------------------------------------------------------------------
def monogram(face, size_w, cx, cy, tracking):
    """'JJ' scaled so its ink width is size_w, centred on (cx, cy). Returns (d, bounds, scale)."""
    b, _ = face.measure("JJ", tracking)
    s = size_w / (b[2] - b[0])
    d, bb, _ = face.run("JJ", s, 0, 0, tracking)
    # centre on the cap-height box (J has no descender) horizontally on the ink
    dx = cx - (bb[0] + bb[2]) / 2
    dy = cy - (-face.cap * s / 2)
    d, bb, _ = face.run("JJ", s, dx, dy, tracking)
    return d, bb, s


def app_icon_svg(rounded: bool) -> str:
    face = Face("barlow-condensed-900-italic.woff2")
    ink, paper, saffron, cobalt = PAL["ink"], PAL["paper"], PAL["saffron"], PAL["cobalt"]
    size = 512
    d, bb, s = monogram(face, 316, size / 2, size / 2 - 8, tracking=-22)
    o = 13  # visible ink outline, px at 512
    sh = 22  # sticker shadow offset, px at 512
    # offset along the italic angle, so the shadow does not leave a thin sliver on the slanted stems
    shx = -sh * math.tan(math.radians(-face.font["post"].italicAngle))
    j = 'stroke-linejoin="round"'
    rx = 112 if rounded else 0
    keyline = (
        f'<rect x="22" y="22" width="468" height="468" rx="{92 if rounded else 70}" fill="none" '
        f'stroke="{paper}" stroke-width="5" stroke-opacity="0.55"/>'
    )
    body = (
        f'<rect width="{size}" height="{size}" rx="{rx}" fill="{ink}"/>\n{keyline}\n'
        f'<defs><path id="jj" d="{d}"/></defs>\n'
        # cobalt hard shadow (an ink shadow would vanish on an ink ground; 1.5 px under the outline so no
        # anti-aliased hairline shows along the stems), then ink outline, then saffron
        f'<use href="#jj" x="{num(shx)}" y="{sh}" fill="{cobalt}" stroke="{cobalt}" stroke-width="{2 * o - 3}" {j}/>\n'
        f'<use href="#jj" fill="{saffron}" stroke="{ink}" stroke-width="{2 * o}" paint-order="stroke" {j}/>\n'
    )
    return svg_doc(
        (0, 0, size, size),
        body,
        "Joystick Jammers app icon",
        "JJ monogram in Barlow Condensed Black Italic: saffron with an ink outline and cobalt sticker shadow on an ink square with a thin paper keyline."
        + ("" if rounded else " Full-bleed square version for PNG exports; the operating system rounds the corners."),
        width=512,
    )


def favicon_svg() -> str:
    face = Face("barlow-condensed-900-italic.woff2")
    ink, saffron = PAL["ink"], PAL["saffron"]
    size = 64
    d, _, _ = monogram(face, 52, size / 2, size / 2, tracking=4)
    body = (
        f'<rect width="{size}" height="{size}" rx="14" fill="{ink}"/>\n'
        f'<path d="{d}" fill="{saffron}"/>\n'
    )
    return svg_doc(
        (0, 0, size, size),
        body,
        "Joystick Jammers favicon",
        "Simplified JJ monogram, saffron on ink, no outline or keyline so it reads at 16 pixels.",
        width=64,
    )


# ---------------------------------------------------------------------------------------------
# QR rule
# ---------------------------------------------------------------------------------------------
def qr_matrix():
    q = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=1,
        border=TOKENS["qr"]["quietZoneModules"],
    )
    q.add_data(QR_URL)
    q.make(fit=True)
    return q.get_matrix(), q.version, q.mask_pattern


def qr_path(matrix) -> str:
    """One path of horizontal runs, one module = 1 unit."""
    out = []
    for y, row in enumerate(matrix):
        x = 0
        n = len(row)
        while x < n:
            if row[x]:
                x0 = x
                while x < n and row[x]:
                    x += 1
                out.append(f"M{x0} {y}h{x - x0}v1h{-(x - x0)}z")
            else:
                x += 1
    return "".join(out)


def qr_rule_svg():
    matrix, version, mask = qr_matrix()
    n = len(matrix)
    mod = 10  # px per module in this file (the sheet states the real minimums per profile)
    qr_px = n * mod
    ink, paper, saffron, ink_soft = PAL["ink"], PAL["paper"], PAL["saffron"], PAL["ink-soft"]
    white, black = PAL["white"], PAL["black"]

    margin = 22
    stroke = 8  # thick panel outline
    pad = 36
    gap = 56
    text_w = 540
    panel_w = pad + qr_px + gap + text_w + pad
    panel_h = pad + qr_px + pad
    px, py = margin, margin
    shadow_dy = 10

    face_code = Face("barlow-condensed-900.woff2")
    face_cap = Face("barlow-semi-condensed-600.woff2")

    # room code: scale so it fills the text column's width
    b, _ = face_code.measure(ROOM_CODE, 14)
    code_s = text_w / (b[2] - b[0])
    cap_h = face_code.cap * code_s
    # caption: scale to the same column width
    cb, _ = face_cap.measure(CAPTION, 0)
    cap_s = text_w / (cb[2] - cb[0])
    caption_cap = face_cap.cap * cap_s

    col_x = px + pad + qr_px + gap
    block_h = cap_h + 52 + caption_cap
    top = py + (panel_h - block_h) / 2
    code_base = top + cap_h
    cap_base = code_base + 52 + caption_cap
    d_code, bb_code, _ = face_code.run(ROOM_CODE, code_s, col_x - b[0] * code_s, code_base, 14)
    d_cap, bb_cap, _ = face_cap.run(CAPTION, cap_s, col_x - cb[0] * cap_s, cap_base, 0)

    # saffron marker bar behind the lower part of the room code (beside the QR, never inside it)
    bar_h = cap_h * 0.34
    bar_y = code_base - bar_h * 0.78
    bar = (
        f'<path d="M{num(col_x - 14)} {num(bar_y)}H{num(col_x + text_w + 10)}l-14 {num(bar_h)}H{num(col_x - 28)}z" '
        f'fill="{saffron}"/>'
    )

    qx, qy = px + pad, py + pad
    W = panel_w + 2 * margin
    H = panel_h + 2 * margin + shadow_dy
    body = (
        f'<rect x="{px}" y="{py + shadow_dy}" width="{panel_w}" height="{panel_h}" rx="26" fill="{ink}"/>\n'
        f'<rect x="{px}" y="{py}" width="{panel_w}" height="{panel_h}" rx="26" fill="{paper}" stroke="{ink}" stroke-width="{stroke}"/>\n'
        f'{bar}\n'
        f'<g id="qr" transform="translate({qx} {qy}) scale({mod})" shape-rendering="crispEdges">'
        f'<rect width="{n}" height="{n}" fill="{white}"/>'
        f'<path d="{qr_path(matrix)}" fill="{black}"/></g>\n'
        f'<rect x="{qx - 2}" y="{qy - 2}" width="{qr_px + 4}" height="{qr_px + 4}" fill="none" stroke="{ink}" stroke-width="4"/>\n'
        f'<path id="room-code" d="{d_code}" fill="{ink}"/>\n'
        f'<path id="caption" d="{d_cap}" fill="{ink}"/>\n'
    )
    desc = (
        f"QR code for {QR_URL}: version {version}, error correction M, {n - 8} modules plus a "
        f"{TOKENS['qr']['quietZoneModules']}-module quiet zone, black modules on pure white, nothing in the middle. "
        f"The room code {ROOM_CODE} and the caption sit beside it."
    )
    return svg_doc((0, 0, W, H), body, f"Join QR and room code {ROOM_CODE}", desc, width=W), (matrix, version, mask)


def qr_dont_svgs(matrix):
    n = len(matrix)
    ink, saffron, cobalt, white, black = PAL["ink"], PAL["saffron"], PAL["cobalt"], PAL["white"], PAL["black"]
    path = qr_path(matrix)
    face = Face("barlow-condensed-900-italic.woff2")

    # 1. logo in the middle
    c = n / 2
    side = 11
    d, _, _ = monogram(face, side * 0.7, c, c - 0.2, tracking=-22)
    logo = (
        f'<rect x="{num(c - side / 2)}" y="{num(c - side / 2)}" width="{side}" height="{side}" rx="2" fill="{ink}"/>'
        f'<path d="{d}" fill="{saffron}"/>'
    )
    a = svg_doc(
        (0, 0, n, n),
        f'<rect width="{n}" height="{n}" fill="{white}"/><path d="{path}" fill="{black}"/>{logo}',
        "Do not: logo in the QR",
        "Negative example. A logo covers the middle of the code.",
        width=n * 6,
        extra=' shape-rendering="crispEdges"',
    )

    # 2. no quiet zone: crop the white margin away and sit the code on a coloured ground
    q = TOKENS["qr"]["quietZoneModules"]
    inner = n - 2 * q
    pad = 1.2
    b = svg_doc(
        (0, 0, inner + 2 * pad, inner + 2 * pad),
        f'<rect width="{inner + 2 * pad}" height="{inner + 2 * pad}" fill="{cobalt}"/>'
        f'<g transform="translate({pad - q} {pad - q})"><rect x="{q}" y="{q}" width="{inner}" height="{inner}" fill="{white}"/>'
        f'<path d="{path}" fill="{black}"/></g>',
        "Do not: trim the quiet zone",
        "Negative example. The white quiet zone is cut away so the code touches busy artwork.",
        width=(inner + 2 * pad) * 6.4,
        extra=' shape-rendering="crispEdges"',
    )

    # 3. inverted and tinted
    inv = svg_doc(
        (0, 0, n, n),
        f'<rect width="{n}" height="{n}" fill="{ink}"/><path d="{path}" fill="{PAL["paper-shade"]}"/>',
        "Do not: invert or tint the QR",
        "Negative example. Light modules on a dark ground.",
        width=n * 6,
        extra=' shape-rendering="crispEdges"',
    )
    return a, b, inv


# ---------------------------------------------------------------------------------------------
# Rasterise, ICO, verify
# ---------------------------------------------------------------------------------------------
def find_node() -> str:
    node = shutil.which("node")
    if node:
        return node
    cands = sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin/node")))
    cands += sorted(glob.glob("/opt/homebrew/opt/nvm/versions/node/*/bin/node"))
    if not cands:
        sys.exit("node not found: source nvm and `nvm use 26` first")
    return cands[-1]


def rasterize(jobs):
    with tempfile.TemporaryDirectory() as tmp:
        jf = Path(tmp) / "jobs.json"
        jf.write_text(json.dumps([{"svg": str(a), "out": str(o), "w": w, "h": h} for a, o, w, h in jobs]))
        subprocess.run([find_node(), str(HERE / "rasterize.mjs"), str(jf)], check=True)


def write_ico(path: Path, pngs: list[Path]):
    """ICO with embedded PNG frames (each size rendered natively, not resampled)."""
    blobs = [p.read_bytes() for p in pngs]
    sizes = [Image.open(p).size[0] for p in pngs]
    head = struct.pack("<HHH", 0, 1, len(blobs))
    off = 6 + 16 * len(blobs)
    entries = b""
    for sz, blob in zip(sizes, blobs):
        entries += struct.pack("<BBBBHHII", sz % 256, sz % 256, 0, 0, 1, 32, len(blob), off)
        off += len(blob)
    path.write_bytes(head + entries + b"".join(blobs))


def flatten_opaque(path: Path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGB", im.size, PAL["ink"])
    bg.paste(im, mask=im.split()[3])
    bg.save(path, optimize=True)


def verify_qr(svg: Path, expect: str):
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("verify: opencv not installed; QR NOT decoded")
        return False
    ok_all = True
    with tempfile.TemporaryDirectory() as tmp:
        for w in (740, 1480, 370):
            png = Path(tmp) / f"qr-{w}.png"
            vb = [float(v) for v in svg.read_text().split('viewBox="')[1].split('"')[0].split()]
            rasterize([(svg, png, w, round(w * vb[3] / vb[2]))])
            im = cv2.imdecode(np.fromfile(str(png), dtype=np.uint8), cv2.IMREAD_COLOR)
            text, pts, _ = cv2.QRCodeDetector().detectAndDecode(im)
            ok = text == expect
            ok_all &= ok
            print(f"verify: {w}px wide -> {text!r} {'OK' if ok else 'MISMATCH'}")
    return ok_all


def main():
    verify = "--verify" in sys.argv
    out = HERE
    (out / "wordmark.svg").write_text(wordmark_svg(False))
    (out / "wordmark-on-ink.svg").write_text(wordmark_svg(True))
    (out / "app-icon.svg").write_text(app_icon_svg(True))
    (out / "app-icon-fullbleed.svg").write_text(app_icon_svg(False))
    (out / "favicon.svg").write_text(favicon_svg())
    qr_svg, (matrix, version, mask) = qr_rule_svg()
    (out / "qr-rule.svg").write_text(qr_svg)
    a, b, c = qr_dont_svgs(matrix)
    (out / "qr-dont-logo.svg").write_text(a)
    (out / "qr-dont-quiet.svg").write_text(b)
    (out / "qr-dont-inverted.svg").write_text(c)
    if "--svg-only" in sys.argv:
        return

    rasterize(
        [
            (out / "app-icon-fullbleed.svg", out / "app-icon-512.png", 512, 512),
            (out / "app-icon-fullbleed.svg", out / "app-icon-192.png", 192, 192),
            (out / "app-icon-fullbleed.svg", out / "apple-touch-icon-180.png", 180, 180),
            (out / "favicon.svg", out / "favicon-32.png", 32, 32),
        ]
    )
    for name in ("app-icon-512.png", "app-icon-192.png", "apple-touch-icon-180.png"):
        flatten_opaque(out / name)  # opaque RGB, no alpha channel
    with tempfile.TemporaryDirectory() as tmp:
        frames = []
        for sz in (16, 32, 48):
            p = Path(tmp) / f"f{sz}.png"
            rasterize([(out / "favicon.svg", p, sz, sz)])
            frames.append(p)
        write_ico(out / "favicon.ico", frames)

    print(f"qr: version {version}, {len(matrix)} modules incl. quiet zone, {QR_URL}")
    if verify and not verify_qr(out / "qr-rule.svg", QR_URL):
        sys.exit(1)


if __name__ == "__main__":
    main()
