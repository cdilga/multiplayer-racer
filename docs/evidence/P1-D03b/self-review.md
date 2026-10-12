# Self-review P1-D03b

Captured with `node art/ui/lib/live-check.mjs --local --viewports 412x915,1440x900 /poc/index.html /poc/vehicles/index.html "/poc/vehicles/review.html?v=cruz-missile"`
(Playwright Chromium headless, software GL; not the owner's devices). Full-page PNGs in `shots/`.

## Looked at
- `shots/poc_index_html_{412x915,1440x900}.png`: the restructured landing. Jump nav, the Vehicles section first (Cruz Missile card with status, date, beads, review links), then UI accepted set, Look, Audio, Motion; every entry carries its status chip, date and bead from `poc/design.json`, newest first. All previous link rows are still there (same URLs).
- `shots/poc_vehicles_index_html_*.png`: the roster list and the viewer (details in docs/evidence/br-bwju.1/self-review.md).
- `shots/poc_vehicles_review_html_v_cruz_missile_*.png`: the complete page, items 1 to 7 in order: IoU tables and compare sheets for LOD0 and LOD2, viewer with the LOD budget table, damage strip and overview, paints and swatches, in-world captures, gate findings and handling, spec-twin note (not a twin).

## Defects found and fixed
1. First pass: images flagged "did not load" on the review page (lazy loading never decoded off-screen images): removed `loading=lazy`.
2. Viewer camera framed the car small in the stage: moved it closer.
3. The roster briefly listed `tradie-ute` (another session's unbaked folder): the roster is now cars with a vehicle.json and a bake.

## Remaining defects
- live-check still reports "cut off by the screen edge" on the three tall pages at the viewport's bottom edge (text straddling the fold, e.g. "Every roster vehicle wit", "0.947"). The pages scroll normally; it is the checker's heuristic for non-scrolling TV mocks, and the full-page PNGs show nothing clipped. Not fixed (art/ui/lib is not this bead's).
- On a phone the reference compare sheets (1977 px wide) are small; each image links to its full size.

## Not covered
Real phone/WebKit, the deployed preview (needs the deploy-poc.yml run after push), the owner's devices.
