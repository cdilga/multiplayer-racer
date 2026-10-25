# Self-review P1-V-hawk-curves

2026-10-25, NobleMoose. Mac, Playwright Chromium 151 and WebKit (emulation, not physical phones/TV). Model baseline 798b7d8e; candidate is the commit containing this report. Owner likeness verdict remains pending.

## Looked at

- reference-lod0/sheet.png: four orthographic views and front three-quarter, labelled reference/before/after/diff. Checked bonnet crown and bulge, shoulder roll, roof, bowed glass, fascia, arches, rim appearance and unchanged livery.
- reference-lod1/sheet.png: same comparison; checked simplified lamps/glass remain continuous.
- reference-lod2/sheet.png: same comparison against lowest-tier reference; checked lower-tier recognition and honest outline tradeoffs.
- views.png: front/rear/left/right/top/front-three-quarter/rear-three-quarter; checked paint and panel transitions, no glass intersections.
- lods.png: all three tiers, side and three-quarter; checked clean headlamps and decreasing facets.
- paints.png: cyan/red/yellow/blue/near-black/white; tyres/rims neutral and livery retained.
- colliders.png: side/front/top/three-quarter; frozen convex proxies, mirrors excluded.
- damage-strip.png: intact/loose/cambered/detached/stripped states; panels separate and dark bays remain.
- damage-strip-overview.png: same states top down; checked detached solids and open panel silhouettes.
- paints-strip.png: default and five bright paints; neutral glass, tyres, lamps.
- grid-1.png: full-size model in evidence viewer; checked side contours, roof and wheels.
- grid-4.png: four tile samples; checked tier/colour distinction.
- grid-24.png: 24 sample tiles; checked small-scale livery/colour recognition, not a player cap.
- local-page/matrix.jpg: all ten full-page screenshots below arranged side by side; sections/assets complete before and after resize.
- local-page/poc_vehicles_review_html_v_hawk_dash_375x667.png: small phone, initial.
- local-page/poc_vehicles_review_html_v_hawk_dash_375x667_after-resize.png: small phone, shrink/grow.
- local-page/poc_vehicles_review_html_v_hawk_dash_412x915.png: phone portrait, initial.
- local-page/poc_vehicles_review_html_v_hawk_dash_412x915_after-resize.png: portrait, shrink/grow.
- local-page/poc_vehicles_review_html_v_hawk_dash_915x412.png: phone landscape, initial.
- local-page/poc_vehicles_review_html_v_hawk_dash_915x412_after-resize.png: landscape, shrink/grow.
- local-page/poc_vehicles_review_html_v_hawk_dash_1366x768.png: laptop, initial.
- local-page/poc_vehicles_review_html_v_hawk_dash_1366x768_after-resize.png: laptop, shrink/grow.
- local-page/poc_vehicles_review_html_v_hawk_dash_1920x1080.png: TV viewport, initial.
- local-page/poc_vehicles_review_html_v_hawk_dash_1920x1080_after-resize.png: TV viewport, shrink/grow.
- local-interactions/chromium-matrix.jpg: every Chromium stage capture (LOD0/1/2, red/blue/orange paint, intact/loose/detached), camera contains all visible parts.
- local-interactions/webkit-matrix.jpg: every WebKit phone stage capture, same nine states; paint and tyres correct, no portrait cropping.

## Defects found and fixed

- Wheels consumed 668 LOD0 triangles. Replaced rim geometry with a shared-atlas face, reduced tyre segments and closed every inner sidewall. All four now cost 176 triangles.
- Flat body sections missed the reference's curves. Added body/roof sections, bonnet crown and shaped bulge, bowed glass, sculpted bumper and boot; numeric fitting raises LOD0 overall IoU .9633 → .9652.
- Glass crossed its underlying triangle diagonal, leaving blue paint poking through. Split the overlays on the same diagonal. Projected fascia decorations now clip to visible triangles at LOD0; exact headlamp projection at every tier fixes fragmented lamps.
- Diffuser/fins/wing tips were open slabs. Closed their sides and ends.
- Interactive review car was almost black: its viewer used the obsolete pure-white paint key. Reused the game's canonical premultiplied paint rule, copied and checked by review/build.mjs.
- Portrait viewer cropped the nose and detached parts. Fit the visible bounds using actual canvas aspect on load, resize and damage changes. Checked both browser engines after the fix.

## Remaining defects

- Likeness is for owner review. Detailed tier is closer; side IoU falls slightly and coarse-tier rear IoU falls. Exact numbers and reference comparisons are in validation.md. Coarse fascia/arch shapes remain intentionally faceted under existing budgets.
- Broad engine-lab checks have seven unrelated failures, recorded in engine.txt and br-8h3u.12; the unchanged Hawk profile passes schema validation. No audio changes in this pass.
- live-check reports viewport-bottom crossings at 412x915 (reference paragraph) and 1920x1080 (an image link). These are normal content continuing below the viewport on this vertically scrolling page, not hidden content. Full-page screenshots show the complete content. No horizontal overflow, failed requests, undecoded images, script errors or blank canvases. The independent controls probe passes in both engines.

## Not covered

- Physical phones/TV, Safari, actual OS fullscreen: viewport shrink/grow and WebKit emulation only.
- New driving feel, dynamic debris lifetime and N×N host rendering benchmarks: visual geometry and the POC viewer changed; host simulation/renderer/batching did not. Frozen collision proxies give the same before/after idle-settle replay hash. Focused settle and existing Hawk straight-run fixtures pass.
- Roof-number readability is not demonstrated by the evidence viewer's grids. The mount was moved above the new crown.
- Deployed-page capture pending this first push; deployment receipt and live images follow in the next evidence commit.
