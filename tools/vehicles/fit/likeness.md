# Local likeness checks

Whole-car silhouette IoU averages away small but recognisable errors. The Hawk Dash follow-up
adds local checks derived from the unchanged reference sheet in `refs/likeness.json`:

- Front/rear width at shoulder, flank and lower-base heights; width **changes** between rows
  detect widening that starts too high or a base that tucks in.
- Top-view width near the nose, including its final taper, detects a square front.
- Manually annotated lamp, exhaust-surround and outlet envelopes detect displacement and shape
  differences inside an otherwise matching silhouette. Atlas swatch UVs select actual source
  triangles, so lighting and paint cannot disguise missing cues. Outlet checks fill each dark
  bore because the reference annotation describes its outer hexagonal envelope.
- Explicit projection, elevation, target height and distance lock the comparison camera.

Run the regular regression tests (included by the existing vehicle CI test directory):

```sh
node --test tools/vehicles/test/likeness.test.mjs
```

They project **current model geometry**, at every LOD, through the reference camera. They also
inject narrow bases, early widening, square noses, missing/moved cues and elevated/mismatched
cameras and assert rejection. They do not compare a stale screenshot to itself. Normal CI needs
no browser for these checks.

For the full visual loop, capture current model pixels and check those local contours as well:

```sh
node tools/vehicles/fit/capture.mjs hawk-dash --lod 0 --out /tmp/hawk-fit
node tools/vehicles/fit/likeness.mjs hawk-dash --capture /tmp/hawk-fit
```

The command exits nonzero on any failed check and writes `likeness.json` plus `likeness.svg`.
The SVG labels each failed area; red is reference-only and green is model-only. Contour bars show
reference and model width at each named height. Keep this beside the fit sheet in review evidence.
Repeat with `--lod 1`, then `--lod 2 --sheet lowest`. All LODs use the same high-detail feature
annotations to preserve identity; coarse tiers have explicit faceting tolerances.

To reproduce a previous candidate without overwriting the working tree, pass its source files:

```sh
node tools/vehicles/fit/likeness.mjs hawk-dash --capture /tmp/previous-fit \
  --model /tmp/previous/model.js --params /tmp/previous/params.json --out /tmp/previous-check
```

The CLI's contour measurements come from the named capture; its feature measurements come from
the named source. Keep those inputs from the same candidate. Reports include source/parameter
hashes and camera metadata checks; the canonical reference image hash is pinned in the fixture.

Coordinates run from roof=0 to ground=1. Width errors are measured as full width divided by
reference height. For example, `.025` means 7.5 pixels in a 299-pixel-high reference. The fit tool
excludes the lowest 12.5% because contact shadows corrupt its mask, so lower-base rows stop above
that band. Width-delta checks remove global scale and reveal the position of a roll or flare.

These tests cover the named cues, not complete likeness. A generated sheet is not a calibrated
photograph; silhouette and feature projections cannot judge shading, depth visibility, side
graphics, or every interior curve. Keep the same-camera visual review and owner review. To add a
new vehicle or cue, annotate its unchanged reference pixels, explain its tolerance, and include a
defect injection that proves the check catches the intended failure.

The roster tests discover every vehicle with `refs/likeness.json`. Each fixture pins the reference
image, extracted masks and comparison cameras. Sedan fixtures cover shoulder rollover, cabin taper,
nose width and lamps; bike fixtures cover rider/body sections and recognizable cues. Postie also
checks daylight between wheel spokes and below the open motorcycle frame. The real Tradie Ute
uses `refs/check-measured.mjs` against independently recorded owner measurements, with raised
canopy/widened tray/roof defects at every LOD. These supplement visual review rather than proving
complete resemblance from a handful of measurements.

For exact baseline captures, `capture.mjs` accepts `--model`, `--params` and `--atlas` together.
Browser routes substitute those files without editing the working tree; relative imports retain
the vehicle's original URL. The source-check loader likewise resolves relative bike-kit imports
against the original vehicle directory. Keep the baseline palette with its source when atlas
indices have changed.

Inspect the extraction itself before fitting. `refs/sheets.json` supplies crop `views`, segmentation,
component `keep` and helmet `patch` settings. Optional `exclude: {rear: [[x0,y0,x1,y1]]}` rectangles
use absolute sheet pixels and remove a neighboring view after segmentation/patching, before
morphology. Pig's expanded rear crop needed this to retain its helmet without admitting the top
view's tyre. Exclusions must never remove a mismatching part of the subject. Postie's silver engine
needed a brighter dark threshold, and its separate top-view front tyre needed a lower component
share. Pin the resulting masks, explain each correction, and recapture both baseline and candidate
with the same settings; scores from different masks cannot demonstrate improvement.
