# Compare the model's visible form

Use for reference-likeness work. The owner rejected roster models on 25 October despite broad
silhouette checks: flat doors, a floating flat Cruz bumper, incorrect cabin/window proportions,
and an unwanted curve on lower faces remained visible. Hawk Dash is the accepted benchmark.

## A comparison that can reveal mistakes

Keep the authoritative reference unchanged and snapshot the actual previous source and parameters.
Capture previous and revised candidates under identical cameras, light and paint. Use a documented
reference camera interpretation; generated turnarounds can disagree across views. Never fix a
projection error by distorting the vehicle. Show front, side, rear, top and a representative hero.

Put **reference | previous shaded model | revised shaded model** next to each other at a useful
size. Preserve aspect ratio; use one scale/alignment based on stable landmarks such as wheelbase
and ground. Independent tight-cropping can hide short bodies and incorrect overhangs. Existing
`tools/vehicles/fit/compose.py` sheets are useful diagnostics but independently trim/scale panels;
supplement them with landmark-aligned views and enlarged defect crops when judging proportions.

Inspect the actual rendered surfaces, including occlusion and shading transitions. Raw RGB
difference is not a likeness score: illumination, reflections and generated-sheet inconsistency
can dominate it. An outline diff answers only whether the outer bounds overlap. A grayscale or
neutral-paint diagnostic can help reveal facets under busy livery, but retain a final painted view.

## Diagnose before adding triangles

For each vehicle, write observations grounded in its reference:

| Region | Questions the shaded comparison must answer |
|---|---|
| Enclosing volume | Is body length/height correct relative to wheelbase? Are overhangs and stance right? |
| Cabin | Where do windscreen, roof and rear glass start/end? Is the glass envelope too tall or wide? |
| Flanks | Does width change with height? Do doors roll into the sill and shoulder, or read as slabs? |
| Ends | Is a bumper a volume wrapping into the wings, or an upright sheet? Are lamps on the right plane? |
| Attachments | Do bar mounts reach the curved fascia? Do graphics follow actual facets without gaps or burial? |
| Lower body | Is the sill/undertray intentionally shaped? Do arch cuts lift unrelated lower vertices into a bow? |
| Repetition | Do wheels/spokes/hidden faces consume budget needed for recognisable body transitions? |

Assign each named owner defect a before observation, intended correction and final visual verdict.
Measure cross-sections and landmarks where a shaded image leaves ambiguity. Build the surface that
produces the correct form; boxes, decals and trim cannot repair the wrong substrate.

## Optimisation that preserves the form

Follow the Hawk method rather than its exact vertex counts: reduce repeated wheel cost, remove
truly hidden geometry with the existing bake optimiser, and spend the savings at curvature or
material transitions. Preserve sidewalls, openings, wraparound corners and visible undersides.
Record exported per-part/per-LOD counts before and after. A lower count is useful only when the
visible shape and all required states survive. Do not introduce smooth shading to disguise flat
geometry. Keep one material and existing batching; do not change frozen collision geometry for a
visual-only repair.

## Accept the visible result

Look at every comparison and defect crop, not only its JSON score. Recheck low-detail tiers
separately: they often erase a roof/glass transition or square off a rounded bumper. Inspect the
baked asset through the real loader in paint variants, loose/detached states and gameplay sizes.
Refresh its review page along with its bake so the owner sees the evidence being judged.

Add local regression tests for the observed failures when feasible, with unchanged reference
identity and tolerances derived from visible uncertainty. Show that the previous defect fails.
Keep silhouette IoU and budget checks, but report them as separate evidence. A validation PASS
requires no unresolved blocker in the active scope; list uncertain or unmatched features honestly.

When helpers are used, ask for early large comparison images and named diagnoses. The parent
opens those images and directs corrections, then inspects each final vehicle before accepting it.
Do not replace that review with an agent's claim that the tests or aggregate IoU passed.
