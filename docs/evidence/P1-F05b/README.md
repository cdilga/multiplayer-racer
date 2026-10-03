# P1-F05b: the browser host's test surface (R90)

The `jj sim` fixture commands now run inside the real host page's worker. Playwright, an agent driving a headed
browser, or a smoke check can see, set up and step the live host.

## What it is

- **`crates/jj-fixture`** (new): the fixture format and runner, moved out of `jj-tools` so the WASM host runs the same
  code. Its `Harness` owns the setup, the per-tick script, seats/phase, signatures and checks; the caller owns the
  loop. `jj sim` keeps its CLI and output.
- **`jj-wasm-host` feature `testing`**: `host::testing` holds the JSON commands. They are `hold`, `load`, `spawn`,
  `inputs`, `step`, `until`, `observe`, `hash`, `outcome` and `meta`. It also holds the S02 hooks (`schedule`,
  `stopAt`, `debug_panic`, `applied_throttle`) and the test-side controller encoders. The shipped build has none of
  them.
- **`web/host/src/testing/`**: a lazily loaded chunk with its own worker and the `testing` WASM. The host page imports
  it only with `?test` (held and frame-stepped) or `?test=live`. It sets `window.__jjTest` on that page only.
  - Helpers: `join` (fake controllers through the real controller path), `drive`, and `untilFact(predicate)`, a blocking
    step that waits on its own fact.
  - A debug overlay: a route plot, plus per-wheel contact, compression and slip. Damage episodes and part states will
    appear when S04 adds them.
  - `captureMeta`.
- **Build:** the chunk, its worker and its WASM are written under `dist/test/` (`web/vite.config.ts`).
  `scripts/ci/bundle-check.mjs` fails a build with test code anywhere else.
- **Guardrail:** `assertTestable` (`web/host/tests/lib/surface.mjs`) refuses to drive any host except local and preview
  ones.

## Acceptance (Mac run, 2026-10-03; CI runs the same tests in the `web` job)

Chromium 151.0.7922.34 (Playwright 1.62.1 headless shell), darwin/arm64. `node --test web/host/tests/`: 8/8 pass
(3 F05b, 5 S02). Raw output is in `browser-run.json`.

| AC | Test | Result |
|---|---|---|
| 1 | `surface.test.mjs` AC1 | `/host/?test` starts held (no ticks over 300 ms). The test `load`s `scenarios/introspection/three-cars.json` without its cars and inputs, then `spawn`s the three cars and adds the inputs through the surface. After `step` 600, `hash` = `6b69a535e76bfff6915ed11b9dd5213941cf9102547885775d02eebaa52d2981`, the same as `jj sim --json` on the whole fixture. All 3 envelope checks pass. |
| 2 | `surface.test.mjs` AC2 | Three fake controllers (Ava, Bo, Cy) joined through Hello + Claim cmd bytes and got seats and cars 0–2. Ava's stick was held forward, and `untilFact(car 0 ≥ 8 m/s)` held after 186 ticks; the other cars stayed put. The test wrote `helper-session/`: `session.json`, `capture.png` (overlay on) and `capture.json`. `capture.json` records commit, map hash, seed, tick, state hash, viewport, browser and backend. |
| 3 | `scripts/ci/bundle-check.mjs web/dist` | `9 shipped files carry no test code; 3 test files are under test/`. Every marker it looks for is present in the test artefacts, so the check isn't vacuous. |
| 4 (host half) | `surface.test.mjs` AC4 | With no `?test` flag the page made no `/test/` requests and had no `__jjTest`. Against a server answering `/test/` with 404 (the production realm's rule, via the node stand-in), `?test` asked once, got 404, and the host booted as shipped. `assertTestable` refuses `jammers.dilger.dev`. |

The server's own realm gate moved verbatim to the child bead **br-p1-f05b-wfl.1 (P1-F05b.1)**. It waits on P1-N02,
because `jj-server` is a stub until the Asupersync pin (P1-F03).

Native: `cargo test -p jj-wasm-host --features testing` runs 10 tests. `spawning_through_the_surface_and_stepping_held_matches_the_native_fixture_run`
checks the same hash against the `jj-fixture` loop.

## Notes

- The capture's `commit` is the build's HEAD. The Mac run built from a tree with uncommitted changes on top of
  `4a8dc90`; CI's captures name their own commit.
- `backend` reads "none" and `assets` holds a note: the host has no renderer or vehicle assets until R01 lands.
- The `web` CI job now runs on a rust runner, because the host bundles the worker's WASM. It builds both WASM builds
  and the pages, runs the bundle and origin checks, then runs these tests.
