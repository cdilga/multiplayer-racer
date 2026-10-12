# P1-PT-chevrons verification

Build: working changes based on 8f98c06f, generator version 11. Local browser: Playwright Chromium 151.0.7922.34 on macOS arm64, ANGLE Metal / Apple M1 Pro. This is viewport emulation, not physical phones or TV hardware.

- AC1/AC3: `node --test web/host/tests/fx.test.mjs`, 13 passed; checks sheet clearance, U bend contact, both legs and front saddle at 40/60/100 mm post radii.
- AC2/AC4: `node --test web/host/tests/chevrons.test.mjs`, two passed; actual 192×108 viewport pixel test and real generated-round chase-camera capture. Board measurements and comparison are in reference-check.md.
- Orientation/placement: RCH `cargo test -p jj-procgen --test biome --test procgen --test signs --test biomes` passed after refreshing generator-11 goldens. This validates outside-bend placement, front-facing normals and right/left arrow direction.
- Renderer: `node --test web/host/tests/map.test.mjs`, three passed; geometry variants use positive instance scales and preserve all decor instances.
- Build: web TypeScript check and Vite build passed; testing-host/procgen WASM built through RCH and generated with wasm-bindgen. Final affected Rust formatting applied.
- AC5/AC6: both reference comparisons and all phone/laptop/TV/chase/fullscreen captures inspected; self-review.md names each.
- AC7: the journey is useful because geometry bounds alone missed right-bend posts occluding the printed arrow. It starts a real round, places through the existing journaled simulation probe, steps 120 ticks and captures the real chase renderer. No synthetic map, race-finish shortcut, retries or count caps.

Reuse: existing kit/decor instancing, route dressing, Rust procgen validation/goldens, simulation command journal, surface harness and Chromium launch helper.

Committed frames/browser-run.json records the setup, 48 generated chevron instances, dimensions, renderer and pixel counts. The cohort is one car for a sign-placement check; it imposes no gameplay limit.

Deployed preview check: pending publication of this commit; recorded separately before closing.

Latest capture refresh: both browser tests passed in 18.63 s using the real Rust jj-server on this Mac. A test-source join through the existing simulation probe precedes normal room Start; this is not physical-controller evidence. The mounted room HUD, seat border, lap/place and footer are visible. All seven chase frames and five isolated kit frames inspected after the refresh. Generator 12, 160 joined rails, 48 chevrons.
