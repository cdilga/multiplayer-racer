"""Measure art/style/refs/wheelie_bin_turnaround.png (front/side/back/top, aligned) with PIL.

Run: python3 measure_turnaround.py -> out/measurements.json, out/grid_front.png, out/grid_side.png

Method: an automated colour-blob flood-fill pass was tried first and was UNRELIABLE here --
thin 1-2px black ink outlines connect otherwise-separate regions (e.g. both wheels, or a wheel
and the drawing's outline strokes) into one giant "blob", which corrupted diameter/width
readings (see git history of this file for the discarded attempt). Instead this script:
  1. Uses PIL to crop the 4 panels and render a 20px pixel-grid overlay (out/grid_front.png,
     out/grid_side.png) for precise-by-eye coordinate picking (front+side share a ground line
     and scale per the turnaround's own convention, so one px->m scale applies to both).
  2. Coordinates below were read off those grid overlays (documented per-field).
  3. All ratios/metres are computed here from those raw pixel readings, not hand-typed.
"""
import json
import os

from PIL import Image, ImageDraw

REF = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "art", "style", "refs", "wheelie_bin_turnaround.png"
)
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

ASSUMED_TOTAL_HEIGHT_M = 1.05  # standard 240L wheelie bin, lid top to ground

im = Image.open(REF).convert("RGB")
W, H = im.size
PANEL_W = W // 4
front_img = im.crop((0, 0, PANEL_W, H))
side_img = im.crop((PANEL_W, 0, 2 * PANEL_W, H))


def save_grid(panel_img, path):
    g = panel_img.copy()
    d = ImageDraw.Draw(g)
    pw, ph = g.size
    for x in range(0, pw, 20):
        d.line([(x, 0), (x, ph)], fill=(0, 150, 255), width=2 if x % 100 == 0 else 1)
    for y in range(0, ph, 20):
        d.line([(0, y), (pw, y)], fill=(0, 150, 255), width=2 if y % 100 == 0 else 1)
    g.save(path)


save_grid(front_img, os.path.join(OUT, "grid_front.png"))
save_grid(side_img, os.path.join(OUT, "grid_side.png"))

# ---- raw pixel readings (picked off the grid overlays above; FRONT and SIDE panels share the
#      turnaround's ground line and scale, so one px scale applies to both) --------------------
READINGS_PX = {
    "front": {
        "lid_hinge_tab_top_y": 205,
        "lid_dome_top_y": 225,
        "lid_body_boundary_y": 300,   # red/green transition = top of body rim
        "rim_flare_end_y": 345,       # rim widening ends, straight taper wall begins
        "body_bottom_y": 685,         # body/ground line (shared with wheel bottom)
        "wheel_top_y": 555,
        "wheel_bottom_y": 685,
        "top_rim_width_x": [25, 360],   # widest point, just below rim flare
        "mid_body_width_x": [55, 330],  # unoccluded taper reading, above wheel arches
    },
    "side": {
        "hinge_knob_x": [30, 80],       # green hinge-pin knob circle
        "hinge_barrel_x": [70, 195],    # red cylindrical hinge barrel
        "lid_body_boundary_y": 300,
        "rim_depth_x": [75, 350],       # body rim, back edge (behind hinge) to front edge
        "body_front_edge_x": 345,       # front (grip-panel) face, constant down the height
        "wheel_x": [75, 205],           # single unoccluded wheel, left/right extent
        "wheel_y": [555, 685],
    },
}

f = READINGS_PX["front"]
s = READINGS_PX["side"]

total_height_px = f["body_bottom_y"] - f["lid_hinge_tab_top_y"]
scale_m_per_px = ASSUMED_TOTAL_HEIGHT_M / total_height_px

lid_dome_thickness_px = f["lid_body_boundary_y"] - f["lid_dome_top_y"]
hinge_tab_extra_px = f["lid_dome_top_y"] - f["lid_hinge_tab_top_y"]
body_height_px = f["body_bottom_y"] - f["lid_body_boundary_y"]
top_rim_width_px = f["top_rim_width_x"][1] - f["top_rim_width_x"][0]
mid_body_width_px = f["mid_body_width_x"][1] - f["mid_body_width_x"][0]
wheel_diam_px = f["wheel_bottom_y"] - f["wheel_top_y"]

rim_depth_px = s["rim_depth_x"][1] - s["rim_depth_x"][0]
wheel_diam_side_px = s["wheel_y"][1] - s["wheel_y"][0]
hinge_barrel_diam_px = s["hinge_knob_x"][1] - s["hinge_knob_x"][0]

measurements = {
    "source": "art/style/refs/wheelie_bin_turnaround.png",
    "method": "grid-overlay manual pixel reads (see module docstring); front+side share scale/ground line",
    "assumed_total_height_m": ASSUMED_TOTAL_HEIGHT_M,
    "raw_px": READINGS_PX,
    "scale_m_per_px": round(scale_m_per_px, 6),
    "ratios": {
        "taper_bottom_over_top": round(mid_body_width_px / top_rim_width_px, 3),
        "depth_over_top_width": round(rim_depth_px / top_rim_width_px, 3),
        "wheel_diam_over_total_height": round(wheel_diam_px / total_height_px, 3),
        "lid_dome_over_total_height": round(lid_dome_thickness_px / total_height_px, 3),
        "body_over_total_height": round(body_height_px / total_height_px, 3),
        "wheel_diam_front_vs_side_agreement": round(wheel_diam_px / wheel_diam_side_px, 3),
    },
    "derived_metres": {
        "total_height_m": ASSUMED_TOTAL_HEIGHT_M,
        "lid_dome_thickness_m": round(lid_dome_thickness_px * scale_m_per_px, 3),
        "hinge_tab_rise_above_dome_m": round(hinge_tab_extra_px * scale_m_per_px, 3),
        "body_height_under_rim_m": round(body_height_px * scale_m_per_px, 3),
        "top_rim_width_m": round(top_rim_width_px * scale_m_per_px, 3),
        "bottom_body_width_m": round(mid_body_width_px * scale_m_per_px, 3),
        "depth_m": round(rim_depth_px * scale_m_per_px, 3),
        "wheel_diam_m": round(wheel_diam_px * scale_m_per_px, 3),
        "hinge_barrel_diam_m": round(hinge_barrel_diam_px * scale_m_per_px, 3),
    },
}

with open(os.path.join(OUT, "measurements.json"), "w") as fh:
    json.dump(measurements, fh, indent=2)

print(json.dumps(measurements["ratios"], indent=2))
print(json.dumps(measurements["derived_metres"], indent=2))
