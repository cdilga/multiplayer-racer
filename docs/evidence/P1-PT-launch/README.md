# Generated jump launch and landing — P1-PT-launch / br-gw74.10 / br-gw74.7 / br-gw74.7.1

Generator 13 gives each sharp jump a receiving table through its design flight, followed by a descent with a
curvature-bounded transition to flat road. Table and descent follow the route/terrain at 25 cm sections. No grip,
suspension or force multiplier changed. Root causes and fixture corrections are in `docs/learnings/procgen.md`.

Validation on the final geometry:

- RCH on eris: `cargo test --config profile.test.opt-level=1 -p jj-procgen --test jumps --test procgen --test biome
  --test features -- --nocapture`: 19 tests pass. The jump bank places 94 jumps across seeds 0–9 in Greybox, Rocks,
  OutbackDirt and OutbackBitumen. Every jump is driven under autopilot at 15/22/26/30 m/s; a second bank uses the real
  boost action at the lip. Continuous flight minimum: 0.25 s at 15 m/s, 0.5 s at racing speed/boost. Mean continuous
  racing flight ≥0.8 s. Every touchdown and landing traversal stays upY >0.8, exit >0.9; design-speed/boost runs need
  no recovery. The fixture must reach its actual landing exit. Worst probed lip error: 0.8 cm (limit 5 cm).
- Defect injections reject a missing receiving table, a short landing reservation, zero descent slope and negative
  or excessive transition length.
- R120 drift fixtures: 2 pass. Native/WASM generator parity on eris Node: 4 pass, including recipe/arena hashes and
  the unchanged generation time budget. Affected-crate all-target/all-feature Clippy with `-D warnings` passes.
- `npm --prefix web run typecheck`: pass.
- `node --test web/tests/journeys/generated-jump.test.mjs`: Chromium and WebKit pass on MacBookPro18,3 / Apple M1 Pro,
  real Rust server `/tmp/jj-macos-server-w01`, source 0c2ac3d4 plus this patch. One Cruz; generated Rocks seed 7 jump 4;
  boost input and frame-stepped host WASM worker, no connected phone. All six actual uploaded jump triangle buffers
  match the native mesh fingerprint. At tick 180 all wheels are clear, upY 0.9961; tick 420 has four contacts,
  upY 0.9996, no wreck/recovery. Both browsers match native full-state hash
  `8309077cb1c5a53caa704bf57fea1edbc182a09230c4566cdc762991a0931171`.

The browser journey earns its keep by detecting stale renderer or WASM geometry that the native landing bank
cannot see, and checking the actual game worker against native replay. It regenerates the map and fixture using
`jj procgen` and `jj sim`; generated binary intermediates live in OS scratch. Set `JJ_BIN` to a built native `jj`,
`JJ_SERVER_BIN` to the Rust server and `JJ_CAPTURE_DIR` to this directory to reproduce the visual matrix.

[Self-review](self-review.md) names all 32 inspected Chromium/WebKit images at the required viewports,
fullscreen, resize and a clear side angle. The final R122 generated-road handling bank passes both tests in 419.70 s
on eris as part of the workspace run. The complete `rch exec -- cargo test --workspace --all-features --config
profile.test.opt-level=1 -- --test-threads=4` matrix finished with exit 0 on eris in 1360.60 s on 2026-10-11
18:03:52 UTC; all test banks and doc tests pass. This is local evidence; deployed review remains pending,
and none of these three beads is being closed on this receipt alone. Physical phone/Safari and owner playtest
are not claimed.
