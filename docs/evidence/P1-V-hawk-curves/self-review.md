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

## Deployed review

Published model commit 72c518500 at https://jammers-preview.dilger.dev/poc/vehicles/review.html?v=hawk-dash via Gitea POC deployment run 9117. deployment.json verifies ten live files byte-for-byte against the candidate: review data, viewer, shared shader, atlas, all three GLBs and all three comparison sheets. The deployed Chromium laptop and WebKit phone controls probes pass (live-interactions/checks.json).

- live-interactions/chromium-matrix.jpg: all nine deployed LOD/paint/damage states, reviewed; colours correct and parts contained.
- live-interactions/webkit-matrix.jpg: same nine deployed states on phone, reviewed; no clipped body or blank canvas.

- live-page/matrix.jpg: all ten deployed full-page screenshots, reviewed at 375x667, 412x915, 915x412, 1366x768 and 1920x1080 before/after shrink/grow. Complete comparisons, cyan interactive car, damage/paint/grid evidence and validation all render.
- live-page/poc_vehicles_review_html_v_hawk_dash_375x667.png: deployed 375x667, initial; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_375x667_after-resize.png: deployed 375x667, after shrink/grow; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_412x915.png: deployed 412x915, initial; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_412x915_after-resize.png: deployed 412x915, after shrink/grow; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_915x412.png: deployed 915x412, initial; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_915x412_after-resize.png: deployed 915x412, after shrink/grow; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_1366x768.png: deployed 1366x768, initial; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_1366x768_after-resize.png: deployed 1366x768, after shrink/grow; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_1920x1080.png: deployed 1920x1080, initial; sections complete and model visible.
- live-page/poc_vehicles_review_html_v_hawk_dash_1920x1080_after-resize.png: deployed 1920x1080, after shrink/grow; sections complete and model visible.

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
- The first deployed live-check ran before the asynchronously inserted model/images had loaded; its full-page screenshots eventually rendered correctly. Reran with the existing `--ready "#controls button[title=LOD0]"` option to wait for model load.
- live-check reports viewport-bottom crossings at 412x915 (reference paragraph) and 1920x1080 (an image link). These are normal content continuing below the viewport on this vertically scrolling page, not hidden content. Full-page screenshots show the complete content. No horizontal overflow, undecoded images, script errors or blank canvases remain in the ready capture. Chromium still emits `net::ERR_ABORTED` on the initial GLB request despite successful model parse/render; this makes live-check exit 1 at every live viewport. A diagnostic fresh page reproduces that event followed by model-ready controls. The GLB hashes match the candidate; all three LODs render in both browser engines. This is recorded, not counted as a green live-check. The independent controls probe passes in both engines.

## Not covered

- Physical phones/TV, Safari, actual OS fullscreen: viewport shrink/grow and WebKit emulation only.
- New driving feel, dynamic debris lifetime and N×N host rendering benchmarks: visual geometry and the POC viewer changed; host simulation/renderer/batching did not. Frozen collision proxies give the same before/after idle-settle replay hash. Focused settle and existing Hawk straight-run fixtures pass.
- Roof-number readability is not demonstrated by the evidence viewer's grids. The mount was moved above the new crown.
- No claim of full CI completion. The bead is handed off as batch_pending after focused checks.


## Front / rear follow-up, 25 October 2026

The owner requested closer sloped doors/haunches, lamp shapes and the exhaust surround after reviewing this first pass. The revised model e1d8a900 is deployed through successful POC run 9158. Current triangle counts are 2697 / 837 / 553; wheels remain 176 / 112 / 112. Contract/reproducibility/geometry checks, all 42 paint/pivot/spec tests, focused settle and Hawk straight-run fixtures pass. Ten deployed hashes match and Chromium/WebKit controls pass. Full current report and honest outline tradeoffs: docs/evidence/P1-V-hawk-fascia/validation.md and docs/evidence/P1-V-hawk-fascia/self-review.md. The earlier sections above remain the receipt for the first pass, not the current model totals.

Looked at the deployed follow-up:

- docs/evidence/P1-V-hawk-fascia/reference-lod0/sheet.png: enlarged front/rear reference, previous and revised; all views and outline diffs.
- docs/evidence/P1-V-hawk-fascia/live-page/page-top-matrix.jpg: every phone/laptop/TV viewport before/after resize; page assets complete.
- docs/evidence/P1-V-hawk-fascia/live-page/page-full-matrix.jpg: full-page section continuity at all viewports.
- docs/evidence/P1-V-hawk-fascia/live-interactions/chromium-stage-matrix.jpg: deployed LODs, paints and damage controls.
- docs/evidence/P1-V-hawk-fascia/live-interactions/webkit-stage-matrix.jpg: same states on emulated phone; model contained.

Remaining defects: owner likeness verdict pending; wider ends/wing reduce weighted silhouette scores to .9495 / .9472 / .9362, mostly in top view. Live-check’s initial GLB abort and viewport-bottom crossings remain documented, with successful independent render/controls proof. Physical devices, host identity/batching and audio were not recertified by this geometry pass.
