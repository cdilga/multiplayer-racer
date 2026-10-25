# Postie Bike self-review — 2026-10-25

Inspected every final generated actual-loader image in Playwright Chromium 151.0.7922.34 on the Mac with software rendering. These are standalone baked-asset viewer captures, not physical-device or running-host evidence.

- `views.png`: opened all seven views. Long tank, exposed finned engine, slim fork, open frame and single right exhaust now read as a classic small motorcycle. Delivery baskets, red panniers and orange vest distinguish the game identity. No scooter floor/shield remains.
- `ladder.png` and `lods.png`: inspected front/side/rear/top/3/4 at all three tiers. All retain the exposed engine/frame, parcels and narrow tyres. Low tiers sacrifice mirrors and hand detail and have very coarse helmet/body facets; this is recorded rather than described as exact likeness.
- `paints.png` and `paints-strip.png`: tank/fenders take player colour; tyres stay dark; engine/frame, parcels, red panniers and rider retain their neutral/identity colours. Bright and dark paints have no missing texture or apparent light fringe.
- `damage-strip.png` and `damage-strip-overview.png`: intact, hinged loose and detached front/back/rider/wheels remain distinguishable. Rider throw and wheel/fork loss are visible. These poses exercise attachment geometry without claiming runtime debris simulation.
- `grid-1.png`, `grid-4.png`, `grid-24.png`: inspected each scale. The rider/mail silhouettes and colour remain readable; small engine/spoke details naturally become tiny. There is no identity-number overlay in this viewer, so number legibility is unproven here.
- `colliders.png`: inspected retained convex shells and wheel proxies. They intentionally preserve old physical shape while the visible reference geometry changes; original buffer hashes and the complete sidecar compare equal.

Investigated an apparent pale filled LOD0 wheel interior by enlarging the side view. It is the gray backdrop visible between eight spokes. Four interior pixels exactly match empty background RGB 201/201/203. Actual baked GLTFLoader geometry was then probed at 8 aperture angles and 3 radii from both side cameras at every tier: all 288 rays miss the wheel geometry, with limited fork/frame overlap only. The reproducible check and per-wheel occlusion counts are in `reproduce.mjs` / `source-checks.json`.

No missing assets, blank panels or clipped vehicle geometry found in these final captures. The generated references contain conflicting exhaust/hero views; the real primary architecture image wins. Fit scores remain below .95, so this is a review candidate and the strict silhouette gate is explicitly unmet. Parent inspected the detailed before/after fit sheets separately and owns their publication and the running-game checks.
