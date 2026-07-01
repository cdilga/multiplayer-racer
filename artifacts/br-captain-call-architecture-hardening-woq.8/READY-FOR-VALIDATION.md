# br-captain-call-architecture-hardening-woq.8 — viewport tiling evidence

Pure viewport tiling layer (FB-camtile) for clusters + Wife's Grid Mode.
Delivered without touching the contested RenderSystem.js / GameHost.js / Engine.js.

## Files (all NEW, zero-conflict)
- `static/js/geometry/ViewportTiling.js` — pure tiling module (no DOM/Three.js/renderer).
- `tests/unit/viewport-tiling.test.js` — 16 unit tests.
- `artifacts/br-captain-call-architecture-hardening-woq.8/` — visual harness + 10 screenshots.

## Module API
- `tileViewports(k, {width,height,hudMargin})` → rectangles that perfectly tile the
  screen (no gaps/overlap), bounded aspect, per-tile HUD-safe `content` inset.
  K=1 full-screen; K=2 split (side-by-side landscape / stacked portrait); K>=3 compact
  row-based grid whose row count is chosen to keep every tile inside ASPECT_BOUNDS.
- `verifyTiling(layout)` → {covered, overlap, min/maxAspect, aspectWithinBounds}.
- `assignSeatsToViewports(seats, vpCount)` → stable seatId→viewport map (sorted by
  seatId, independent of join order); consumes the room-seat registry snapshot shape.
- `resolveViewportBudget(requested, opts)` → readability + performance guard: largest
  readable viewport count ≤ maxViewports, with {degraded, reason} for the ladder.
- `buildWifesGrid(seats, opts)` → opt-in per-seat follow grid with stable assignment +
  downgrade when too many seats to show legibly.

## Evidence — reproduced
- `npx vitest run tests/unit/viewport-tiling.test.js` → **16 passed**. Covers: K=1 full,
  K=2 split (both orientations), K∈{3,4,5,6,8,9,12,16} at 1080p+4K tile with no
  gaps/overlap and bounded aspect, determinism, HUD-safe insets inside tiles, stable
  seatId assignment across order-change/leave-rejoin/seat-persistence/round-robin,
  Wife's Grid stability + 32→downgrade, readability/perf guards (4K fits ≥ 1080p).
- Visual harness (real module output → canvas):
  `python3 -m http.server 8012 & node .../capture-tiling.mjs` → **ALL_OK true**, 10 PNGs,
  no page errors. 1080p + 4K × {all-cars K=1, cluster-director K=6, Wife's Grid 8/16/32}.
  - `wifes-grid-16-1080p.png`: 4×4 tiles 480×270 (ar 1.78); P1..P16 name tags + own-car
    chevrons INSIDE the dashed HUD-safe inset (no boundary overlap).
  - `cluster-director-1080p.png`: 3×2 tiles 640×540 (ar 1.19).
  - `wifes-grid-32-*.png`: **downgraded to 16 readable viewports** (readability guard),
    all 32 seats still mapped (clustered), none dropped.

## Remaining blocker (honest, not faked)
The screenshots prove the **tiling geometry + marker/name placement** (rectangles,
HUD-safe insets, downgrade). Rendering the **actual 3D world into each viewport**
(host RenderSystem camera viewports) requires editing the CONTESTED
`static/js/systems/RenderSystem.js` + `static/js/GameHost.js` (active WIP by other
agents). That in-engine wiring + full-3D screenshots are deferred until those files
free up; the pure tiling layer, its contract, and its readability/perf/assignment
guarantees are complete and independently verifiable now.

Product invariant respected: this module is pure geometry — it instantiates no
renderer, so Local phones/controllers never build a world from it.
