# CI speed, 2026-11-14 (br-15gd, BrightPelican)

Gitea CI on `main`, measured from job start/completion times (`tea api …/actions/runs/<id>/jobs`). "Full" means the
plan selected every suite (135 browser files, 219-263 targets; rust all).

## Where the time went (run 15095, before)

| | |
|---|---|
| Wall | 47.2 min (12228: 39.2, 12188: 39.2, 12019: 37.0) |
| Browser work | 8840 slot-seconds over 7 slots on triton-ci (4) + truenas-ci (3) |
| Queueing | the 7 browser jobs shared those 7 runner slots with 3 rust-test jobs and the build: slot 7 started 19 min in |
| CPU | triton at 94-97 % with only 4 SwiftShader slots (node exporter, 19:00-19:10 UTC) |
| Longest Rust test | `arena::there_is_no_cap_a_thousand_cars_get_a_bowl_and_a_place_each` 786 s |
| Longest browser target | `bots-lplates` lobby layout check 592 s (the world drew at full rate under the opaque Lobby) |
| Checkout | ~2 min per job (52 s fetch + 74 s writing a ~1.2 GB tree) |
| Build | WASM 149 s then native 119 s, serial |

## What changed

| Change | Commit | Effect measured |
|---|---|---|
| Arena placement scans only cells near a piece | 409b1fdc | 786 s -> 0.49 s; arena goldens unchanged |
| durations.json from run 15095 | 409b1fdc | the packer knows the newer journeys |
| eris-browser runner: 4 slots with the RTX 2080 Super passed through; `JJ_CHROMIUM_GPU=render` | c0abd05c | journeys render on the GPU with the same assertions |
| Browser matrix 7 -> 11 | c0abd05c | 11 browser jobs at once when eris is on |
| Native and WASM builds overlap (>= 12 GB jobs) | c0abd05c | about 2 min off a cold build |
| World draws only on change under the opaque Lobby | 619f5c78 | lobby layout check 592 s -> 47 s in CI (71 s on eris SwiftShader) |
| Host page tests take `slotArgs` (GPU on a GPU slot) | a13a2789 | resolution + kit tests 136 s -> 41 s on eris |
| Crossing bank split per recipe case | 1a1359d4 | 685 s -> 7 tests of 50-65 s |
| Sparse, blobless checkout | 1e8ed046, reverted 15c4066d | checkout 2 min -> 10 s, but LFS pulls went one blob at a time and checks reads docs/evidence: reverted |

## After

| Run | Commit | Selection | Wall | Notes |
|---|---|---|---|---|
| 17027 | c0abd05c | full | 26.9 min | first run on 11 slots; build 6.2 min (cold native dir); rust-test (3) 23.4 min on TrueNAS (crossing bank 685 s, since split) |
| 17038 | b840dba9 | full (carried) | 24.1 min | lobby fix in; two TrueNAS-slot timeouts under load (input pad, g-kept-tracks), both pass on eris |
| 17118 | a68ef029 | full | 32.6 min | build 3.3 min (warm, overlapped); eris GPU slots 10.8-15.4 min; triton slots 9.3-18.8 min; TrueNAS slots 18.8-26.5 min (the long pole). Two reds: a corrupt git pack in one TrueNAS job's checkout (infra, rerun), and the new lap-lines journey hung past 900 s on SwiftShader: moved to the GPU-only lane (49 s on the RTX 2080) |

## Not done / next

- A typical single-area push is still bounded by the build (~3-6 min before any slot starts) and the longest real-time
  journeys (~4 min each). The acceptance's <= 10 min verdict for a single-area push needs those journeys stepped (R90)
  rather than raced in real time; tracked on br-15gd.
- TrueNAS slots (8 GB, SwiftShader, busy host) are the slowest and flakiest; the GPU slots on eris are the fastest.
- No guarantee was dropped: no test removed, skipped or loosened; the crossing bank keeps all 49 laps.
