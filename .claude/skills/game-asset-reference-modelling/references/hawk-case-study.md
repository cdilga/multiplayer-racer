# Hawk Dash: accepted reference refinement

The owner accepted this result on 25 October 2026. It illustrates the method; its numerical
budgets, cameras, damage rules and modelling stack belong to this vehicle.

## What changed the result

- **Reallocate geometry.** Repeated wheel geometry consumed triangles without enough visual return.
  Wheel totals fell from 668 to 176 at LOD0, and 152 to 112 at the lower tiers. Final exported
  totals were 2702 / 879 / 597 against this asset's 2800 / 900 / 600 budgets. Curved body sections
  received the savings; coarse tiers retained the important shoulders rather than tiny details.
- **Measure where width lives.** Overall bounds hid a narrow base and widening that began too high.
  The arch cut raised the widest section with the cutout. Evaluating the original taper at the
  actual clipped height restored lower width and sloped upper haunches. Lower sill tuck also fell.
- **Correct the generating form.** Nose width tapers towards the tip and actual front facets curve
  back at the corners. A narrower cabin, lower/taller front lamps, lower rear lamps and closer
  outlet pairs improved the internal proportions. Colliders, handling and anchors stayed fixed.
- **Match cameras.** End views had been too elevated. The chosen front/rear comparison convention
  became a horizontal optical axis at vehicle midpoint with a 50 m long-lens distance. Side/top
  used 10 m; three-quarter views targeted 0.78 m horizontally. Shaded and silhouette views shared
  cameras. Both previous and revised candidates were recaptured. These are explicit conventions
  for an uncalibrated generated sheet, not recovered photographic camera parameters.
- **Project onto actual facets.** Deform the nose before projecting graphics. Preserve exact mesh
  diagonals between substrate and graphics; limit projection to the intended end part. Dark inner
  bays moved behind sloped doors. Visual review caught a disappearing coarse intake; a contour
  test then caught flat graphics squaring the rounded tip. Two shallow coarse fascia planes kept
  graphics continuous while following the shape.
- **Make failures measurable.** Reference width bands and width changes caught stance/slope errors;
  top-view taper caught a square nose; annotated lamp/outlet polygons caught internal cue errors.
  The previous source failed 8 / 7 / 4 local gates across the tiers; the revised result passed.

The general lessons are geometry allocation, section-aware form, camera consistency, surface-aware
decoration, local regression gates and renderer inspection. Other assets need their own meaningful
sections, poses, features and constraints.

## Evidence and limits

Same-camera weighted silhouette IoU changed from `.9392 / .9391 / .9412` to
`.9486 / .9526 / .9497`. LOD0 side IoU regressed slightly (`.9618 → .9537`); front, rear and top
improved. Twelve new tests included actual current geometry at every tier, immutable reference
identity, cameras and injected defects; 54 focused tests passed overall. These measurements
support, rather than replace, the owner's likeness verdict.

Model commit: `8430ec49`; evidence receipt: `a13a9b3f`; successful POC deploy: `9184`.
Review route: `https://jammers-preview.dilger.dev/poc/vehicles/review.html?v=hawk-dash`.

Repo-root evidence: `docs/evidence/P1-V-hawk-stance/validation.md`, `self-review.md`,
`reference-lodN/sheet.png`, `reference-lodN/likeness.{json,svg,txt}` and
`baseline-checks/summary.json`. The live Chromium/WebKit controls and deployed assets were checked.
The raw live-check exit was not green: an aborted initial GLB request and scroll-boundary flags
were documented despite successful subsequent rendering. These are browser observations, not
hardware-device or renderer-performance qualification.

## Reusing the tooling for a vehicle

Sources are `art/vehicles/hawk-dash/model.js`, `params.json`, `refs/sheets.json` and
`refs/likeness.json`. Fitter code is in `tools/vehicles/fit/` (`app.js`, `capture.mjs`, `lib.mjs`,
`likeness.mjs`); `likeness.md` documents coordinates, exclusions and CLI semantics.
Run from the repo root:

```sh
node --test tools/vehicles/test/likeness.test.mjs
node tools/vehicles/fit/capture.mjs hawk-dash --lod 0 --out /tmp/hawk-fit
node tools/vehicles/fit/likeness.mjs hawk-dash --capture /tmp/hawk-fit
node docs/evidence/P1-V-hawk-stance/baseline-checks/reproduce.mjs
```

Repeat capture/check with `--lod 1`, then `--lod 2 --sheet lowest`. Use distinct output directories.
For previous candidates, both capture and likeness accept `--model <old-model.js>` and
`--params <old-params.json>`. Keep capture and source inputs from the same candidate; the CLI takes
contours from the capture and feature projections from source. Reports include source hashes and
camera metadata. Avoid overwriting the working tree just to reproduce an old model.

For a prop, building, character or terrain piece, carry over the comparison and measurement
approach, adapting loading, pose and semantic feature selection. Do not copy vehicle-specific
coordinates, mask exclusions, contract limits or wheel/damage assumptions.
