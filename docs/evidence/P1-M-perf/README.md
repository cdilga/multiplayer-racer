# P1-M perf (br-cxqk): WASM map prepare back under 1.5 s

Receipt (BrownHill, 2026-10-18). Hardware: eris (the RCH worker and the browser box; not the owner's laptop).

## What changed

| Commit | Change | Maps |
|---|---|---|
| a95a5c6d | The prepare ladder's gate: a draw stops right after set-piece placement when it is already short of its set pieces or its relief. `choose_landmark` judges each spot's view from each eye once. `smooth_curvature` re-judges only the points it moved. | unchanged (goldens) |
| 3f1aaf6a | Set-piece site checks find nearby road through a 32 m grid of the route. | unchanged (goldens) |
| 4cc2b72e | GENERATOR_VERSION 28: set pieces try the course's beat straights first; a first-round site is refused on sight before the stamp. Bridge deck feet meet the outside road's grade. | re-blessed |
| 985b5315 | `wasm_parity` asserts the 1.5 s budget again; the throttled reroll test drops its quarantine (br-nc2q). | - |

## Numbers (the guard sample: `playtest::prepare` on seeds 0-23, the four-biome mix)

| Build | Before (v27, 2026-10-17) | After (v28, 985b5315) |
|---|---|---|
| Native release (rch, `rhythm diag_prepare_cost`) | mean 857 ms, worst 2.5 s | mean ~220-410 ms, worst ~0.4-0.7 s (worker load varies ~2x) |
| WASM, CI's profile (`cargo test --target wasm32-unknown-unknown -p jj-procgen --test wasm_parity`, Node on eris) | CI run 5283: worst 16 s, mean 1.9 s | worst 807-865 ms, mean 448-460 ms |
| WASM release, Node on eris | (2026-10-17) worst 8.0 s, mean 1.7 s | worst 703 ms, mean 389 ms |
| Draws per seed (deterministic, every target) | worst 9, mean 3.46 | worst 8, mean 3.12 |

Browser: `web/host/tests/prepare.test.mjs` passes 9/9 in Chromium on eris at 985b5315, including the 6x CPU throttle
reroll test (quarantined at 46 s on generator 24; the whole test took 15.5 s).

## Acceptance

- AC1 (CI budget test, worst <= 1500 ms, no relaxed guard): `generate_and_validate_in_wasm_stays_inside_the_laptop_budget`
  asserts worst <= 1500 ms, plus a tightened redraw guard (worst 9, mean 3.5). Passes on eris at CI's profile.
- AC2 (the owner's laptop, Chromium, release host WASM): **not measured here.** The owner's Mac is in use and off limits
  for tests; eris's Chromium run above is a stand-in, labelled as such.
- AC3 (every FL15/FL16 gate kept, deterministic across targets): the gates are unchanged (the early gate stops only draws
  the full checks would reject); `wasm_parity`'s golden seeds and recipes match native in WASM (4/4).

## Where the time goes now (native, the guard sample, before 3f1aaf6a)

Set-piece placement ~45% (stamp cell loops ~3.1 s, site checks 2.1 s of a 14 s sample), validate ~20%, terrain ~15%.
44 of 59 rejected draws are short of their set pieces: the course's beat straights leave ~40 m of kicker positions.
