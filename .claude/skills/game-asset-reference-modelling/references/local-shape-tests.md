# Reference-derived local shape tests

Use these checks to catch a named visual error that whole-asset IoU averages away. Choose checks
appropriate to the asset; a pipe opening, character pose and building roof need different oracles.

## Independent oracle and consistent inputs

Annotate the authoritative reference in its own pixel coordinates. Record image identity, view,
crop, pose, orientation and projection assumptions; optionally pin a content hash. Keep expectations
independent of candidate parameters. A test asserting the value just written into a model proves
configuration, not likeness.

Align reference and candidate with a documented transform preserving aspect ratio. Independent
horizontal/vertical stretching conceals proportion errors. Where absolute size matters, test it
separately; normalized likeness alone cannot establish world dimensions. If references disagree,
record which view governs which feature and the uncertainty rather than overfitting all of them.

Capture and source-based checks must identify the same candidate, LOD, state and camera. Missing
features, empty masks, failed loads and absent samples must fail or explicitly report unavailable,
never silently count as zero error. Keep old candidate overrides isolated; don't temporarily
overwrite a shared working source to reproduce a baseline.

## Useful local measurements

| Check | Error it exposes | Oracle |
|---|---|---|
| Width profile | Narrow base, wrong flank slope | Left/right contour at named sections |
| Width change | Widening starts too early/late | Difference between two section widths |
| Tip taper | Square nose, blunt roof or prop tip | Several samples approaching the extremity |
| Negative space | Filled handle, blocked arch, wrong limb gap | Separate opening mask or boundary |
| Feature envelope | Displaced or misshapen light, window, socket | Reference polygon/landmarks |
| Camera/pose identity | Apparent geometry error caused by framing | Frozen view metadata and projection |

For a vertical image, let `t` run along normalized reference height and measure `w(t)/H`, where
`H` is reference height. Also compare `(w(t2) - w(t1))/H`: equal maximum widths can conceal different
slopes or transition heights. Check left and right boundaries independently when asymmetry or
off-centre placement matters. Use local-axis sections for articulated/organic forms, and separate
pose error from shape error.

Use multiple adjacent samples or a small band where rasterization makes a single row unstable.
Preserve aspect ratio when fitting. Choose tolerances in meaningful units: an error of `.025` of
a 299-pixel reference height is about 7.5 pixels, not a universal acceptable error. Derive limits
from annotation ambiguity, pixel size, style and each LOD's faceting. Do not loosen a threshold
merely to admit the candidate.

Mask exclusions must be explicit. Hawk excludes the lowest 12.5% of its fit mask because contact
shadows contaminate it; that is a limitation of those images, not a default for every asset.
Do not exclude the very region whose mismatch prompted the task without a separate measurement.

## Internal features and holes

Prefer semantic IDs, part/group selection or stable material regions over incidental lit colour
to isolate features. Project the selected current triangles through the comparison camera, or
capture an ID pass. Match annotation semantics: a filled outer pipe envelope should include the
bore for that envelope check; a test of the actual opening must preserve the hole. Outer-silhouette
IoU alone cannot see internal gaps or features.

Feature polygons/landmarks detect location, extent and slant. Pair them with readable overlays
showing expected and actual regions. Source projection is useful for fast deterministic checks
but may include an occluded feature; inspect rendered visibility, or add a depth-aware mask when
that failure justifies it.

## Prove the gate detects the mistake

1. Check basic measurement math with simple known shapes where needed.
2. Run the previous bad candidate, or inject a plausible defect such as a narrow base, prematurely
   wide shoulder, squared tip, blocked gap, moved/missing feature or mismatched camera.
3. Verify the intended local gate rejects it. Ensure rejection is not just a failed import.
4. Run the revised current asset through all relevant LODs/states and inspect its overlays.

Synthetic defects demonstrate sensitivity; reproducing an actual previous mistake demonstrates
relevance. Neither replaces checking the current exported/rendered asset. Keep checks focused on
observable errors rather than mirroring every implementation choice.

Reports should identify reference and candidate, LOD/state, camera, sample locations, measured
errors and limits, exclusions and known gaps. Provide a readable difference overlay alongside the
machine result. A pass means the named checks pass, not that every curve or shading choice matches.

## Existing implementation

The repository's `tools/vehicles/fit/likeness.mjs` and `tools/vehicles/test/likeness.test.mjs`
demonstrate width profiles, deltas, cue envelopes, camera locks and defect injection. See
`tools/vehicles/fit/likeness.md` for their current interface. The implementation combines reusable
measurement math with a vehicle-specific source adapter. Adapt that boundary for a new asset
type; it is not a generic mesh importer.
