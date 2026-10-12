# Self-review P1-PT-chevrons

Local captures: Chromium 151.0.7922.34, macOS arm64, ANGLE Metal Apple M1 Pro. Real generated round, one car; phones/TV are viewport emulation. The round is journaled into a stationary chase view after 120 simulation steps. Runtime captures use the complete map, not a sign-only scene.

## Looked at

- frames/small-tile.jpg — actual 192×108 viewport, one black arrow distinguishable inside yellow.
- frames/kit-front.jpg — 720×720, raised portrait board, post clear of printed front.
- frames/kit-right.jpg — 720×720, mirrored single arrow, unchanged mounting.
- frames/kit-rear.jpg — 720×720, two bolts wrap the post and connect to board backing.
- frames/kit-side.jpg — 720×720, tight U bends, front saddle and sheet clearance.
- frames/chase-1366x768.jpg — laptop, generated right-bend row faces the driver.
- frames/chase-1920x1080.jpg — TV viewport, raised separate boards visible around bend.
- frames/chase-915x412.jpg — landscape phone, same corner and clear front arrows.
- frames/chase-412x915.jpg — portrait phone, first near board may naturally leave the left edge; upcoming boards remain visible.
- frames/chase-375x667.jpg — small phone, upcoming single arrows remain distinct.
- frames/chase-fullscreen.jpg — actual fullscreen entered, same intact corner row.
- frames/chase-after-fullscreen.jpg — actual fullscreen exited, no layout correction required.
- frames/before-facing-fix.jpg — earlier chase capture, post obscured right-bend arrow.
- frames/reference-helensburgh.jpg — Australian photograph with final front/side model.
- frames/reference-cunninghams-gap.jpg — Australian photograph with final front/side model.

All 12 final capture frames inspected in three contact sheets; rear/side mounting and both reference composites also inspected separately. The original two photographs were inspected before modelling. reference-check.md distinguishes observations from chosen dimensions.

## Defects found and fixed

The original board overlapped the post, sat low and lacked hardware. It is now 1.20×1.50 m, centre 1.70 m above the generated post base, with 0.175 m forward offset. Two U-bolts have real rear contact and a front saddle rather than an oversized floating hoop.

The first runtime capture exposed right-bend boards showing their rear and post over the arrow. Both bend types now face approaching traffic; only the arrow mirrors. Geometry variants preserve every instance with positive scales.

A software capture briefly read the canvas before its rendered frame reached the compositor. The close-view capture waits two animation frames before the screenshot; native final captures passed.

## Remaining defects

No chevron-specific defect in this matrix. Joined rail geometry from br-gw74.9.1 is visible in the latest frames. Collision compliance remains unfinished on br-gw74.9.

## Not covered

Physical phones, Safari on a device and physical TV output. This renderer change is not touch UI. WebKit-specific controller coverage is in P1-C12; these world captures use Chromium. The small-tile check is a close-board readability sample, not a claim that distant signs have fixed pixel size.

Deployed pinned-preview matrix pending publication and will be added before close.

Latest capture refresh: both browser tests passed in 18.63 s using the real Rust jj-server on this Mac. A test-source join through the existing simulation probe precedes normal room Start; this is not physical-controller evidence. The mounted room HUD, seat border, lap/place and footer are visible. All seven chase frames and five isolated kit frames inspected after the refresh. Generator 12, 160 joined rails, 48 chevrons.
