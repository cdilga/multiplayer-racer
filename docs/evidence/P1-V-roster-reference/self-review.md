# Roster reference refinement — visual self-review

2026-10-25, NobleMoose, `br-rgw6`. Review candidate, not full production qualification. Browser checks are Playwright Chromium 151.0.7922.34 and WebKit on the repository Mac; no physical phone/TV or GPU performance claim.

## Looked at

- Postie `postie-bike/before-lod0/sheet.png`, `postie-bike/before-lod1/sheet.png`, `postie-bike/before-lod2/sheet.png`, `postie-bike/after-lod0/sheet.png`, `postie-bike/after-lod1/sheet.png`, `postie-bike/after-lod2/sheet.png`: same new reference, masks and level cameras on both candidates. Inspected each complete comparison, silhouette diff and hero, including the round lamp, tank inset, exposed engine, single exhaust and open frame.
- AU Hawk/Lion/Cruz principal reference comparison sheets and ute `tradie-ute/ladder.png`: stance, arch rollover, cabin taper, rounded nose, lamps, real tray/canopy and accessories. Helpers inspected every final comparison and all actual baked-loader images; each vehicle's `self-review.md` names them.
- `local-interactions/chromium-matrix-0.jpg`, `local-interactions/chromium-matrix-1.jpg`, `local-interactions/chromium-matrix-2.jpg`, `local-interactions/chromium-matrix-3.jpg`, `local-interactions/webkit-matrix-0.jpg`, `local-interactions/webkit-matrix-1.jpg`, `local-interactions/webkit-matrix-2.jpg`, `local-interactions/webkit-matrix-3.jpg`: all 96 underlying stage captures across six vehicles, three LODs, two player paints and intact/loose/detached presets. All models render; tyres stay neutral, bike/mail identity remains distinct, ute canopy remains black, and parts visibly separate.
- `local-page/page-matrix-0.jpg`: all twelve full-page Chromium captures, phone portrait 412×915 and desktop 1920×1080. Reference images, interactive stage, damage/paint strips, measurements and reports are present. Ute uses the real blurred-plate garage photo and measured table.
- Postie `postie-bike/views.png` and actual-loader aperture proof: its pale wheel quadrants are visible background; expanded baked-mesh ray probes and exact backdrop pixels confirm openings.
- `live-interactions/chromium-matrix-0.jpg`, `live-interactions/chromium-matrix-1.jpg`, `live-interactions/chromium-matrix-2.jpg`, `live-interactions/chromium-matrix-3.jpg`, `live-interactions/webkit-matrix-0.jpg`, `live-interactions/webkit-matrix-1.jpg`, `live-interactions/webkit-matrix-2.jpg`, `live-interactions/webkit-matrix-3.jpg`: all 96 deployed stage captures inspected after publication; all twelve vehicle/browser combinations pass. `deployment.json` verifies 74/74 public files against candidate `ad35536b`, including every LOD, texture, comparison and measured ute report. POC workflow 9240 succeeded.

## Defects found and fixed

Repeated wheel geometry funded body form and recognizable cues. Underlying shoulder/arch profiles were corrected rather than hiding them with trim. Cruz lamp graphics were clipped onto final body facets to remove diagonal occlusion slits; medium spoiler endplates shed hidden thickness to retain the 900-triangle budget.

Pig's rear helmet and plan handguard had been cut by extraction windows, and silver forks were absent from masks. Postie's segmentation missed silver machinery and dropped a disconnected front tyre. Fixed the oracle extraction explicitly and recaptured old/new with identical settings. Frozen reference hashes/cameras now prevent quiet drift.

Postie's scooter floor/shield and twin pipes were replaced by the requested motorcycle architecture. The ute's invented pickup tub, canopy glazing and scoop were replaced using actual owner evidence. Original physics attachment snapshots keep visible reshaping from silently changing damage hinges; injected pivot/axis drift is rejected.

## Remaining defects

Some generated views disagree and global IoU has tradeoffs: AU and Lion have small aggregate regressions despite improved named local form. Pig remains weaker in side/plan and LOD2 aggregate drops .0049; Postie remains around .86 at close tier rather than .95. Detailed scores and limits are in each validation report. These are review candidates.

AU retains its deliberate no-wing variant, coarse window specks and partially occluded blank badge. Cruz retains a small body-colour patch at a side-window corner. Coarse bike riders, mirrors and small hardware simplify strongly. The ute's dark night photos cannot provide a calibrated front view.

`live-check.mjs` reports its existing viewport-edge heuristic on normally scrolling review-page content, with no asset/JS/image/blank-canvas/horizontal-overflow failures. This check exits 1 and is not labelled green; full-page images and the separate browser control assertions show intact content. The unrelated full engine-synth check has seven failures, with all manifest profiles valid; recorded on existing task `br-8h3u.12`.

## Not covered

No new physical-device/network session, host race capture, dynamic debris-lifetime qualification, runtime roof-number readability proof or 24×24 performance benchmark. Rendering/batching/audio implementation and handling were unchanged. Fresh native settle and existing straight-run fixtures for every revised vehicle pass with exact journal replay. Owner feedback decides final likeness.


## Owner-requested deeper rework, 2026-10-25
The first pass below was rejected. Current review and limitations are in `docs/evidence/P1-V-roster-rework/self-review.md` and `docs/evidence/P1-V-roster-rework/validation.md`. The parent inspected `docs/evidence/P1-V-roster-rework/local-interactions-contact-1.jpg` through the complete six-sheet set plus large per-vehicle comparisons. The new review candidate supersedes the previous roster assets; Hawk remains unchanged.
