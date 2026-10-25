# Remaining roster: reference refinement

Vehicle Model Validation: PASS for the visual review candidate and unchanged physics contract. This is not a new full-game or device performance qualification.

Bead `br-rgw6`, P1-V-roster-reference, 2026-10-25. Sources are code-built under R81/R86/R90/R123. The parent session is NobleMoose; small helpers handled independent vehicle work in the shared tree. Final publication commit and remote asset hashes are recorded in `deployment.json`.

## Result and authority

All six remaining vehicles received the game-asset-reference-modelling loop: preserve baseline, align cameras, audit repeated geometry, correct the underlying volume, annotate reference sections/features, inject defects, bake and inspect the actual loader. Each vehicle directory contains before/after captures, validation, self-review and reproduction checks. Accepted Hawk Dash was left unchanged.

AU Hawk, Cruz Missile and Lion President use their unchanged generated reference sheets. Corrections include shoulder/arch rollover, cabin taper, nose corners and lamp attachment to final facets. Wheel repetition is cheaper at each relevant tier. Pig Catcher uses corrected extraction of its unchanged sheet: its helmet and handguard were previously cropped and silver forks were missed. Expanded windows/exclusions and segmentation are retained explicitly; both old and new sources were rescored with the same corrected oracle.

Postie Bike has a new CB50-inspired reference and code-built tank, exposed engine, open frame, spoked wheels and one right exhaust. `postie-bike/refs/provenance.json` records Honda's primary photograph, Muse prompts/model, two generated images, hashes and $0.02 cost. The primary photograph overrides the generated rear view's invented twin outlets. No badge or real brand is placed in the game model. Corrected masks retain silver engine parts and the disconnected top-view front tyre; both candidates use those masks.

Tradie Ute uses the owner's Triton photos, tape measurements and newer code-built model from eris `morayfield-house-3d`. The game does not import that model's mesh. The independent oracle tests the tray/canopy dimensions, cab taper, black canopy and accessory sides. Historical generated ute sheets are excluded from acceptance. The review page shows the actual photo, measured targets, all-LOD results and report downloads.

## Measurement interpretation

The fitted whole-view score is diagnostic, not the only objective. AU's global scores regress slightly while its named local substrate/cue checks improve and wheel cost falls. Lion improves front/top/rear, with a side-view/aggregate tradeoff. Cruz's global score is nearly unchanged while wheel cost and local form improve. Pig has improved front/rear stance but weaker side/plan interpretation. Postie LOD0 improves from .8164 to .8563 against the new same-mask oracle. Coarse bike tiers remain much less detailed than their sheets. None of these measurements is represented as universal .95 likeness.

Per-car validation reports disclose all before/after scores, exported counts, per-part allocation and view limitations. Original collision POSITION bytes, pivots, masses, hinges, anchors, hubs and tuning are preserved. Updated profile source hashes track the final GLBs; these are visual changes, not handling changes.

| Vehicle | Exported LOD0 / LOD1 / LOD2 triangles |
|---|---:|
| AU Hawk | 2104 / 874 / 600 |
| Cruz Missile | 1913 / 896 / 507 |
| Lion President | 1813 / 897 / 576 |
| Pig Catcher | 2514 / 898 / 596 |
| Postie Bike | 2287 / 877 / 593 |
| Tradie Ute | 1402 / 896 / 586 |

All eighteen tiers remain within their original qualified budgets. `exports.json` records native contract checks and byte-reproducibility receipts.

## Automated and rendered evidence

- `vehicle-tests.txt`: focused vehicle suite including reference hashes/cameras, current source at every LOD, contour/cue defects, Postie frame/spoke gaps, owner-measured ute defects, contract/pivot/paint/loader checks.
- Per-car `reproduce.mjs` and receipts: previous source fails the new local checks, current LODs pass, and original physics geometry is identical. Per-car bake checks reproduce the shipped bytes; native asset validators enforce unchanged budgets without waivers.
- `sim.json`: all six native load/settle fixtures plus the six existing straight-run scenarios pass and journal replay hashes match. Bike fixtures require the existing two wheel contacts; car fixtures require four. The first reuse of a four-contact car expectation on a bike was corrected to its actual profile topology, with all other settle envelopes retained.
- `engine-check.txt`: all eight existing manifest profiles validate (P7). The broader unchanged synth/lab suite has seven failures (M5, B10, B12, L1, L6, K2, SL1), recorded against existing engine task `br-8h3u.12`. Sound was not regenerated, and that suite is not represented as green.
- Per-car actual baked-loader views, paints, LOD ladder, collider overlay, loose/detached strips and 1/4/24-tile captures were inspected by the authoring helper; the parent also inspected principal sheets and critical areas. The evidence renderer is a standalone shared-loader viewer, not a recorded host race.
- `review-probe.mjs` exercises all six POC pages in Chromium and WebKit: each LOD, two player paints and intact/loose/detached controls, asset errors, decoded images and horizontal overflow. Stage captures and check receipts distinguish local and deployed pages.

Final focused results: 93/93 vehicle tests, 13/13 review-page tests, seven generated review contracts, all six native asset validators/reproducible bakes, twelve native settle/straight scenarios with matching replay, and twelve local vehicle/browser combinations pass. The broader audio and viewport-edge failures described here remain explicitly outside that green set.

Postie's expanded baked-mesh wheel probe checks multiple wedge angles/radii from both sides. Pale wheel interiors match the background; they are open spaces, not discs. Source projection alone could not establish this, so the exported mesh and actual rendered pixels were checked too.

## Limits

Generated sheets are uncalibrated and internally inconsistent; the chosen camera and interpretation are explicit. AU retains its existing intentional no-wing variant. Very coarse LODs simplify windows, hardware and rider details. Dark garage photos cannot calibrate the ute's front/cab surfaces; documented measured dimensions govern only what was actually measured.

The page's damage presets pose loose/detached parts; they do not prove dynamic debris lifetime or recovery. Existing materials/batching, roof-number rendering and engine implementation were not changed. No new 24×24 draw benchmark, physical phone/TV test, WAN session or production race capture is claimed. Native retained-hull regression and real-loader visual evidence cover this bounded visual change. Owner review on `/poc/vehicles/` remains the likeness decision.
