# P1-U05 design review

## In-world look

**Who/what/when.** Sonnet 5.5 subagent, fresh context, did not build it, 2026-10-03. Looked at all 13 captures (Chromium WebGPU, M1 Pro, 1080p and 4K), `perf.json` and `capture-report.json` (no errors, no external requests), against H4 and master §12.1/§12.1a. Colour notes are from eyeballing plus rough pixel sampling.

**Against H4 and §12.1.**
- Faceted cars: pass. Chunky, ink-ringed, same stripe livery and wing as the J hero; they read in 80 px Overview and 320 px tiles.
- Toon ramp: cars show about two tones; sky, mesas and ground are smooth gradients, so the ramp is a car-only effect.
- Ink outlines: pass. Weight matches the HUD stickers.
- Halftone: present but subtle, under cars, tree shadows and mesa flanks.
- Grit: light. Mottled road and tyre tracks, but the ground is a flat rust plane.
- Emissives: LED bar and headlights read in `tv` and `paint` (bloom on). In the 24-grid the tail lights are flat salmon rectangles, closer to decals than lights.
- Graphic sky: not met. It is a two-stop gradient with no cloud or sun, and none of H4's windmill, bunting or water tower. The cars carry H4's energy; the world is clean vector, not a busy painted panel.

**Chrome.** It belongs: the same navy ink, cream stickers and seat-colour tile borders that match the paint hues. HUD stays in corners; the position sticker is large (about 100x90 in a 320x270 tile) but clears the road. The road ahead is hidden in rows 3-4 by neighbouring cars on the start grid, which is cars, not effects. No impact words or speed lines exist yet, so the readability rule is untested here, not passed.

**In-world graphics** (`1080p-graphics.jpg`). All present.
- Checkpoint gate: reads from far away (cobalt posts, saffron banner).
- Finish gantry and corner chevrons: read.
- Weak: the saffron road line and the chequered line sit faint on pale sand, and the gantry's halftone shadow crosses them.
- Kerbs show as a soft pink smear rather than crisp red/white.
- Red tyres and rails on rust ground lean on the ink outline alone.
- The gantry "lights" are small white boxes that do not read as lit.

**Paint vs badge** (`4k-paint.jpg`).
- No pair collapses in the 24-grid. Closest are #1/#11 (bright vs dark red) and #4/#12 (teal vs sky blue), separated by value, and the number carries the rest.
- Lit paint sits darker than the badge throughout. #1 shifts a little toward #3's orange in shade.
- #5 yellow is nearest the sand ground (the outline does the work). #7 black reads dark brown, and the lights keep it findable. #9 white reads cream.
- The identical pink/lime livery on every car competes with #6 pink and #8 green, and on dark cars (#7, #19) it has more chroma than the body. Livery should follow identity.
- #12 is clipped at the right edge in both paint captures.

**Cost proposal.** No bloom at 24 tiles is sound, and the look still reads without it. `plain` loses ink, halftone and car separation, and the dense rows 13-24 become confetti. `ids` keeps most of the look at the same cost (11.2 vs 11.0 ms at 1080p, 13.0 vs 13.7 ms at 4K), so it is not a cheaper tier. At tile scale `ids` also has a cleaner horizon: about 25% dark pixels in tile 1's horizon band for `full`, against about 5% for `ids` and `plain`. Evidence caveat: GPU timestamp ms exceed the rAF interval in every row (4K bloom: 116 ms GPU against an 8.4 ms p50 frame). They are not wall time. The ranking is believable but the absolute numbers are not. R10 should budget on frame interval too.

**Defects, by severity.**
1. High: the Overview bowl is an empty tan disc with about 80 px cars, no props, debris or nameplates, and no comic-panel character (`1080p-overview_n=16.jpg`).
2. High: the world dressing is flat against H4: plain gradient sky, bare rust ground (`1080p-tv.jpg`, `4k-tv.jpg`).
3. Medium: tail lights and gantry lights read as flat panels without bloom (`1080p-grid_n=24.jpg`).
4. Medium: checkpoint and finish road lines are too faint (`1080p-graphics.jpg`, top row).
5. Medium: full-look ink clumps into a dark mass at tile horizons (`1080p-grid_n=24.jpg` vs `-ids.jpg`).
6. Low/medium: a single livery on all cars, paint darker than badges, #12 clipped (`4k-paint.jpg`).
7. Low: kerbs are smeared and red barriers are low-contrast on rust (`1080p-graphics.jpg`). Yellow ground pyramids could be mistaken for items or hazards (`4k-graphics.jpg`).
8. Low: a pale ink-dropout sliver on the bowl lip at bottom right (`4k-overview_n=16.jpg`).

**Verdict.** Ready for the owner's design review as cars, ink, chrome and track graphics. Present it as a first look: only one biome, and the world dressing, sky, Overview and effects are stubs. Items 1-2 are what the owner will react to first.

## Fixes after the review (2026-10-03, by the builder)

Re-captured (`node art/ui/poc/world/capture.mjs`: 13 captures, WebGPU, no errors, no external requests) and re-measured
headed (`--perf`); `art/ui/poc/world/README.md` has the new table and proposal.

| Defect | What changed | Capture |
|---|---|---|
| 1 Overview bowl empty | Tyre-stack wall, hay bales, donut marks, doors, bumpers and wheels lying where they fell, parked utes, windmill, shed, bunting, and a nameplate over every car | `1080p-overview_n=16.jpg` |
| 2 Flat world | Small inked cumulus in the sky; painted earth patches; windmills, a water tower, tin sheds, bunting and hand-painted signs along the track | `1080p-tv.jpg`, `4k-tv.jpg` |
| 3 Lights flat without bloom | Gantry lamps are larger, in navy housings. Car lights still have no halo at 24 tiles (the cost choice stands) | `1080p-graphics.jpg` |
| 4 Faint checkpoint/finish lines | Checkpoint line 1.6 m wide, saffron with navy edges; finish strip deeper, with a navy border | `1080p-graphics.jpg` |
| 5 Ink clumping at horizons | Spinifex and trees kept within 45 m and 80 m of the road; the far ground carries flat colour patches, which add no ink lines | `1080p-grid_n=24.jpg` |
| 6 One livery, #12 clipped | Livery bolts are cream and navy, so only the paint carries identity; the paint camera moved back, and all 12 fit | `4k-paint.jpg` |
| 7 Smeared kerbs, item-like pyramids | Kerbs are crisp blocks; spinifex are squat olive clumps | `1080p-graphics.jpg` |

Cost: the dressing added about 3 ms of GPU per frame at 1080p and 8 ms at 4K to the scene pass (timestamps). The same-session
A/B found FXAA cost about 7 ms at 1080p, so the grid look now also drops FXAA. The presented look holds 120 Hz at 1080p and
mostly at 4K (p95 frame 17 ms). Static props are baked into one mesh per material (606 meshes into 92).

**Motion reel findings for U02 and U04** (from the reel's builder, `docs/evidence/P1-U05/motion/README.md`): identity colour
#7 is charcoal, so its ring and outline vanish against the ink gutters (the reel identifies #6 instead). Dark seats need a
cream outer stroke on ink. U02's identify outline is a faint fringe, which the reel brightens. The 150 ms stagger and the
scales exist only as prose in the tokens.
