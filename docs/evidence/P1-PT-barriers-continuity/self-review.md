# Self-review P1-PT-barriers-continuity

Real generated round, journaled placement, 120 simulation steps, Chromium 151 on Mac arm64. Phone/TV dimensions are viewport emulation, not physical hardware.

## Looked at

- frames/before-gaps.jpg — 1920×1080, separated sections around the bend before this change.
- frames/chase-1366x768.jpg — laptop, joined W-beam across the full visible outer bend.
- frames/chase-1920x1080.jpg — TV, continuous beam behind separate chevron posts.
- frames/chase-375x667.jpg — small portrait phone, the near and upcoming beams join.
- frames/chase-412x915.jpg — portrait phone, continuous outer-edge rail with natural off-screen ends.
- frames/chase-915x412.jpg — landscape phone, no visible holes between sections.
- frames/chase-fullscreen.jpg — actual fullscreen entered, continuous bend remains visible.
- frames/chase-after-fullscreen.jpg — actual fullscreen exited, the scene remains correct.

Every fresh frame inspected in two contact sheets. The earlier stale-build frames were also inspected and rejected as after evidence; their 101-section count matched the previous build. Fresh captures report 160 sections.

## Defects found and fixed

Fixed-length sections left gaps when the outside of the bend expanded their centre spacing. Sections now meet at actual outside-edge endpoints with a small overlap. No beam/polyline count was truncated.

The capture harness could quietly serve old pages after compiling only its isolated kit. It now builds fresh live pages by default.

## Remaining defects

Collision compliance and forgiving rail use remain on br-gw74.9. These are stationary geometry captures, not proof of the mid-hit behaviour. No remaining continuity defect in this matrix.

## Not covered

Physical phones, physical TV, device Safari, impacts or spring deflection. No touch UI changed. Deployed pinned preview matrix will be recorded before close.
