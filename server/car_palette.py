"""Curated, TV-legible car palette (br-car-identity-system).

Cars used to get a random 24-bit color (``secrets.randbelow(0x1000000)``), which
routinely produced two near-identical colors that are confusable at couch
distance. Instead we assign from a curated palette of high-separation colors by
seat index, and give each car a persistent roof number.

The palette is deliberately hue- and lightness-diverse; ``palette_min_distance``
lets tests assert that no two entries are perceptually confusable.
"""

# Curated for maximum mutual separation at TV/couch distance (high chroma,
# spread hue, varied lightness). Order chosen so the first N assigned to a small
# lobby are also maximally distinct from each other.
CAR_PALETTE = [
    "#e6194b",  # red
    "#3cb44b",  # green
    "#ffe119",  # yellow
    "#4363d8",  # blue
    "#f58231",  # orange
    "#911eb4",  # purple
    "#42d4f4",  # cyan
    "#f032e6",  # magenta
    "#bfef45",  # lime
    "#fabed4",  # pink
    "#469990",  # teal
    "#9a6324",  # brown
    "#800000",  # maroon
    "#aaffc3",  # mint
    "#808000",  # olive
    "#000075",  # navy
]


def color_for_index(index):
    """Return a curated hex color for a zero-based seat index (cycles)."""
    if index is None:
        index = 0
    return CAR_PALETTE[int(index) % len(CAR_PALETTE)]


def color_for_seat(seat_id):
    """Return a curated color for a 1-based monotonic ``seat_id``."""
    try:
        idx = int(seat_id) - 1
    except (TypeError, ValueError):
        idx = 0
    if idx < 0:
        idx = 0
    return color_for_index(idx)


def number_for_seat(seat_id):
    """Persistent roof number for a car. Uses the 1-based seat_id directly."""
    try:
        n = int(seat_id)
    except (TypeError, ValueError):
        return None
    return n if n >= 1 else None


def _hex_to_rgb(hex_color):
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgb_to_lab(rgb):
    # sRGB -> linear -> XYZ (D65) -> Lab (CIE76-compatible).
    r, g, b = (_srgb_to_linear(v) for v in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t) + (16 / 116)

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(hex_a, hex_b):
    """Perceptual distance (CIE76 Euclidean in Lab) between two hex colors."""
    la = _rgb_to_lab(_hex_to_rgb(hex_a))
    lb = _rgb_to_lab(_hex_to_rgb(hex_b))
    return sum((a - b) ** 2 for a, b in zip(la, lb)) ** 0.5


def palette_min_distance(palette=None):
    """Smallest pairwise perceptual distance across the palette (higher = more distinct)."""
    palette = palette or CAR_PALETTE
    smallest = float("inf")
    for i in range(len(palette)):
        for j in range(i + 1, len(palette)):
            smallest = min(smallest, delta_e(palette[i], palette[j]))
    return smallest
