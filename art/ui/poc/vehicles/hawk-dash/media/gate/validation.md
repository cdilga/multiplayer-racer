Vehicle Model Validation: PASS (visual rebuild and review candidate; caveats below)

Vehicle: Hawk Dash. Parts: core, front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; dark engine/cabin/boot interiors retained.
Build: the commit containing this report, based on 798b7d8e0e4707e7980d058edb23447462106d01. Captured 2026-10-25 on the Mac with Playwright Chromium 151.0.7922.34, software GL. These are browser captures, not device measurements.
Contract: owner request 2026-10-25, br-8h3u.11.1 / P1-V-hawk-curves; R81/R86; existing 2800/900/600 budgets. Method: lowpoly-model-from-refs; validation: vehicle-model-validation. References and masks are unchanged.

Reused: existing Hawk source/bake, AU Hawk body-section construction, reference fitter and capture tools, shared paint-key material, review builder and evidence viewer. No host renderer/material/batching changes. The POC viewer now uses the canonical premultiplied paint shader (its obsolete white-key rule rendered current atlases black); review/build.mjs copies and checks that shared module for the self-hosted design site. Its camera now frames the visible bounds at the actual canvas aspect, including detached parts on portrait phones. Collision hull points were extracted from the baseline GLB into colliders.json and retained verbatim; the visual sampling does not retune handling.

## Triangle allocation

Counts are from baked GLB damage parts, excluding collider proxies and hidden interior blocks. Full per-part counts and hashes: before-geometry.json and geometry.json.

| Tier | Wheels before → after | Body before → after | Total before → after | Existing budget |
|---|---:|---:|---:|---:|
| LOD0 | 668 → 176 | 1780 → 2513 | 2448 → 2689 | 2800 |
| LOD1 | 152 → 112 | 744 → 771 | 896 → 883 | 900 |
| LOD2 | 152 → 112 | 444 → 485 | 596 → 597 | 600 |

LOD0 wheel cost falls 73.7%, from 27.3% to 6.5% of the intact car. Twelve-sided LOD0 and eight-sided lower-tier tyres have closed inner sidewalls. Five-spoke rims are drawn in the existing atlas. The body gains fuller flanks, tucked sills, rolled shoulders, bonnet/boot crown, a multi-section power bulge, roof crown and stations, bowed windscreen/backlight, shaped bumper/intake and boot panel. Glass and fascia overlays follow their underlying triangles. Diffuser, fins and wing tips are closed solids. LOD2 retains four exhaust outlets as single silver facets and mirrors as closed triangular prisms.

## Reference comparison

Each reference-lodN/sheet.png is labelled reference / before / after / after silhouette diff, with an additional three-quarter comparison. Before uses the baseline source and the same fit viewer, camera and blue paint as after. The outline metric does not measure internal body curvature.

| Tier/view | Before | After |
|---|---:|---:|
| LOD0 weighted | .9633 | .9652 |
| LOD0 side / top / front / rear | .9792 / .9530 / .9335 / .9713 | .9761 / .9584 / .9373 / .9773 |
| LOD1 weighted | .9609 | .9612 |
| LOD1 side / top / front / rear | .9795 / .9447 / .9295 / .9752 | .9755 / .9506 / .9339 / .9719 |
| LOD2 weighted | .9505 | .9490 |
| LOD2 side / top / front / rear | .9586 / .9579 / .9082 / .9562 | .9546 / .9598 / .9138 / .9476 |

LOD0 improves overall, especially front/top/rear; side falls slightly. LOD2 is approximately the skill's .95 target and falls .0015 overall, principally at the rear. This is a body-likeness candidate for owner review, not a claim that every outline improved. The reference still has rounder arches and a more detailed fascia than the coarse tiers. The existing 0.4 m physics wheel radius is retained.

## Checks and evidence

- PASS source/contract/reproducibility: bake.txt, reproducibility.txt (`node tools/vehicles/bake.mjs art/vehicles/hawk-dash --check`), contract.txt (`jj vehicle sync` and `jj validate`), no waivers.
- PASS geometry/budget: verify.mjs checks the shipped GLBs, all 11 part IDs, finite vertices/normals, nonzero triangles, one material and sealed manifold wheels at all tiers. Wheel bottoms meet ground and wheel pivots match sidecar. geometry.json records per-part counts.
- PASS paint and hinges: `node --test tools/vehicles/test/{pivots,paint-key,spec-twins}.test.mjs`, 42 passed (paint-spec-tests.txt). Bright/white/near-black paint keeps tyres, rims, lamps and framed glass neutral (paints.png, paints-strip.png).
- PASS damage geometry: damage-strip.png and damage-strip-overview.png show intact, loose, detached and stripped-shell poses with dark bays. This is the existing evidence viewer, not a new simulation test of debris lifetime; no damage runtime code changed.
- PASS physics fit: final-sim.json, `jj sim --json --profile assets/profiles/hawk-dash.json settle.json scenarios/handling/roster-straight-hawk-dash.json`, both fixtures pass and replay matches. The focused settle fixture reuses the original idle-settle drops and settle checks verbatim. Original Cruz idle-settle asks for at least 2° pitch; Hawk reaches 1.6967° before and after and fails those two Cruz-specific checks identically (sim.json, physics-before-after.json). All other checks pass; before/after state hashes are identical. No fixture was relaxed to claim a handling improvement.
- PASS visual inspection: views.png, lods.png, colliders.png, all three comparison sheets, damage and paint strips, grid-1/4/24.png. These grids use the model evidence viewer. Current roof-number anchor was raised to clear the new crown. Runtime identity and N×N draw benchmarks were not rerun because host loader/material/batching are unchanged; the grids do not prove roof-number readability. review-probe.mjs exercises all three LODs, three seat paints and intact/loose/detached states through the actual POC controls in Chromium and WebKit; screenshots and checks.json are in local-interactions/ and live-interactions/.
- WARN engine gate: the unchanged Hawk sound profile passes schema validation (engine.txt P7). The broad sound-lab check reports seven failures: M5/B12/L6 squeal, B10/L1 firing pitch, K2 start and SL1 control inventory. These are outside this geometry change; tracked with br-8h3u.12. No sound files changed. This report does not certify the sound lab.

Remaining blockers for publishing this visual candidate: none. Owner likeness verdict pending on /poc/vehicles/review.html?v=hawk-dash. Full batch CI is handed to the deploy worker; no green-CI claim here. Deployed page checks are recorded in self-review.md.
