# P1-D05 self-review

Looked at: index-desktop.png (1280 wide) and index-phone.png (390 wide), rendered by `scripts/index_page.py` from
register-sample.json (a hand-made register: pinned "Playtest 1", Latest, a failed-smoke row, a retired row) in headless
Chromium via file://.

Defects found and fixed: none after the first render; no horizontal overflow (scrollWidth equals viewport width).

Remaining defects: the Barlow fonts load from the edge's /fonts/ path, so this file:// capture shows the system fallback.
The Keep column wraps under the grid on desktop (4 cells in a 3-column grid).

Not covered: live deployment (no preview published yet), TV viewport, the accepted tokens swap (G-DESIGN).
