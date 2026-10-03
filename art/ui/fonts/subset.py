"""Subset the bundled UI fonts to WOFF2 (P1-U01). One-time dev step; the outputs are committed.

Usage: python subset.py <dir with the upstream TTFs>   (needs fonttools + brotli)
Upstream: github.com/google/fonts ofl/barlowcondensed and ofl/barlowsemicondensed (OFL-1.1).
Keeps every OpenType layout feature (tnum for scores and countdowns, kern, case, …) and the Latin,
Latin Extended, Vietnamese and punctuation ranges. Other scripts use the named fallback stack in
tokens.json (fonts.fallback).
"""

import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

UNICODES = (
    "U+0000-024F,U+0259,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+1E00-1EFF,"
    "U+2000-206F,U+20A0-20C0,U+2100-2122,U+2190-2199,U+2212,U+2215,U+2713-2714,U+FEFF,U+FFFD"
)
FACES = {
    "BarlowCondensed-Black.ttf": "barlow-condensed-900.woff2",
    "BarlowCondensed-BlackItalic.ttf": "barlow-condensed-900-italic.woff2",
    "BarlowCondensed-ExtraBold.ttf": "barlow-condensed-800.woff2",
    "BarlowSemiCondensed-Medium.ttf": "barlow-semi-condensed-500.woff2",
    "BarlowSemiCondensed-SemiBold.ttf": "barlow-semi-condensed-600.woff2",
    "BarlowSemiCondensed-Bold.ttf": "barlow-semi-condensed-700.woff2",
}


def main() -> None:
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(__file__).parent
    for ttf, woff2 in FACES.items():
        font = TTFont(src / ttf)
        feats = sorted({fr.FeatureTag for fr in font["GSUB"].table.FeatureList.FeatureRecord})
        assert "tnum" in feats, f"{ttf} has no tabular figures"
        subset.main([
            str(src / ttf),
            f"--unicodes={UNICODES}",
            "--layout-features=*",
            "--flavor=woff2",
            "--name-IDs=*",
            "--name-legacy",
            "--notdef-outline",
            f"--output-file={out / woff2}",
        ])
        print(f"{woff2}: {(out / woff2).stat().st_size} bytes, GSUB features {' '.join(feats)}")


if __name__ == "__main__":
    main()
