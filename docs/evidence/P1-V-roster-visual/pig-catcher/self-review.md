# Shaded self-review, 2026-10-25

Vehicle Model Validation: FAIL on the global ~0.95 likeness target; named corrective geometry checks and budgets PASS. This is an awaiting-review candidate, not an owner acceptance or a complete runtime qualification.

Replaced flat radiator plates and rear leaves with convex panels and explicit crests. Raised both round spotlights above the beak instead of hiding them behind it. Split the engine into a smaller crankcase, tapered cylinder and real cooling ribs; tapered trousers with overlapping knee joints, connected the neck, added shirt collar/placket/pockets. Replaced bar spokes with narrow open wires and removed buried tread faces.

- Baked triangles: 2607 / 883 / 600 before → 2595 / 898 / 599 after, within original per-vehicle budgets. Exact per-part raw and baked accounting: triangle-receipt.json (collider/debug meshes excluded from render budget).
- Weighted silhouette scores: 0.8451 / 0.8226 / 0.7978. These remain below target and are not substituted for shaded inspection.
- Source, reference, GLB and frozen-contract SHA256 identities: triangle-receipt.json. vehicle.json, colliders.json and the entire asset sidecar remain byte-identical to HEAD. No hubs, physics pivots, anchors, masses, hinges, material topology, renderer or batching changed.
- Reproducible bake: bake-check.log. Named tests: ../bike-panels-test.log (17/17, including actual old source rejection); current earlier form gates: form-check.json.
- Evidence: visual-comparison.png preserves aspect and uses one identical crop/transform for old/current; regional-comparison.png enlarges identical old/current pixels. final-contact.png contains final GLTFLoader ladder, posed damage states, paint colours and all 1/4/24-tile viewer captures. comparison-contact.png contains all three current reference/shading/diff sheets plus rear heroes.
- Captures use Playwright Chromium 151.0.7922.34, headless software rendering. The damage states are viewer poses; these images do not prove dynamic debris lifetime or real host instancing, identity, performance or phone behaviour. Parent runs the combined vehicle suite and host/design-site checks.

Remaining limits: The generated reference is uncalibrated. The engine castings, shirt shoulders, helmet chin/peak, rope and rack remain visibly coarser than the reference. Coarse tiers intentionally simplify limbs and small accessories; they must be judged at switch size, not accepted merely because the mask matches.

Reviewed every final contact cell, source LOD view/hero and comparison region. The enlarged Pig knee review caught an open trouser joint; final source overlaps the joint without adding triangles. No further geometry changes or recaptures are pending.

Bounded switch-size follow-up: Coarse tyres now retain twelve outer stations and eight vertices around the open rim hole. Hidden joined caps, buried panel backs and fender undersides funded the round silhouette without changing LOD0. Side/front/rear before/after objects are rendered at 100 px high in switch-size/switch-review.png. These were inspected at native size; the lower helmet and tyre silhouette now read rounder. Budget and real old-source regression checks remain enforced.
