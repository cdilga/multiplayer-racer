# CI learnings (append-only)

## 2026-10-07 · Gitea 1.27 Actions: what works and what doesn't

- **No dynamic matrix.** `matrix: x: ${{ fromJSON(needs.plan.outputs.list) }}` leaves the job named with the literal
  expression and stuck in `waiting` forever (runs 1440, 1443). Use a static matrix and a job-level
  `if: fromJSON(needs.plan.outputs.n) >= matrix.slot`; job-level `if` may read `matrix` (run 1444 skipped slot 3).
- **`upload-artifact@v4`/`download-artifact@v4` refuse** any server that isn't github.com ("GHESNotSupportedError").
  `@v3` works: 100 MB of random data uploaded in ~10 s from triton (run 1446).
- A job after a skipped matrix leg is skipped too unless its `if` says `!cancelled() && !failure()`.
- `github.token` reads the repo's commit statuses and action runs through the API (anonymous reads get 403).
- A stuck `waiting` run can't be cancelled or deleted through the API (`/actions/runs/<id>/cancel` is 404; DELETE says
  "this workflow run is not done"); the web UI's cancel does it.
- act_runner uses a job `container: image:` that exists on the host without pulling when `force_pull` is false, so a
  locally built image (`jj-ci:<hash>`) needs no registry. The runner's `container.options` (the `/cargo-cache`
  volume) still apply to it.

## 2026-10-07 · Where the old CI's time went (runs 1400-1422)

- **web, 25-33 min on truenas-rust:** `npx playwright install --with-deps` was 10 min on TrueNAS (0.6 min on
  triton): the apt step, every job. The job image now carries the libraries and the headless shell.
- **rust Test, 11.4 min (19.4 on TrueNAS):** not compilation (warm) but unoptimised test runtime, one binary at a time
  (`bank` 85 s, `biomes` 65 s, `scenarios` 2 min, `feel` 62 s). opt-level 1 plus nextest's parallel binaries.
- **Runner slots:** two `rust` runners carried three `rust` jobs, so journeys queued behind web; and the per-branch
  concurrency group serialises runs, so every push waited for the previous run's 30 minutes.
- **image smoke, 2 min:** one `docker run curlimages/curl` per probe costs ~8 s on TrueNAS; one long-lived curl
  container and `docker exec` instead.

## 2026-10-07 · GPU in containers

- triton's GTX 1080 (driver 470) inside `--gpus all` with `NVIDIA_DRIVER_CAPABILITIES=all`: no NVIDIA Vulkan ICD is
  injected, and mounting the host's `nvidia_icd.json` gets "Could not get 'vkCreateInstance'" from
  `libGLX_nvidia.so.0`; the loader falls back to llvmpipe. ANGLE-on-Vulkan there would be software rendering.
- eris (RTX 2080 Super, driver 610) as a host-executor runner works: R06 at 24 and 120 seats ran (not skipped) in
  23 s, C06's identify menu in 9 s (gpu.yml run 1455).

## 2026-10-07 · dcg and the worker guard on CI files

- Write workflow YAML and scripts that mention `cargo … --workspace` with the Write tool (the worker guard matches the
  text in any Bash command). Redirects to computed paths and `git push -f` are blocked by dcg: push experiment
  branches under a new name (`ci-lab-N`) built with `git commit-tree` and a temporary `GIT_INDEX_FILE`, so the shared
  working tree never changes branch.

## A tag push runs the workflows of the tagged commit (2026-10-08)

Gitea evaluates `on:` from the workflow files **in the commit a pushed tag points at**, not the default branch's. Adding
`branches: ["**"]` to ci.yml/gpu.yml stops tag runs only for commits that already carry that filter: migrating the old
preview register into `preview/`/`retired/` tags on six older commits (created through the API with a user token)
started 12 full CI and GPU runs (2095–2108, cancelled through the web UI). Tags the publisher creates with the
workflow's own token start nothing (Gitea doesn't trigger runs from its actions token). A hand-pushed `pin/<id>` on a
commit older than 1f250489 still starts runs there: cancel them, or pin with the deploy workflow's token.

## `$$` isn't unique across job containers (2026-10-08)

Run 2189's browser (1) on triton died unpacking a corrupt cached web build ("Decoding error (36): Corrupted block
detected"). Jobs are containers sharing `/cargo-cache/jj-prebuilt`, and a shell's `$$` in one container is usually the
same small PID as in the next, so two slots fetching the same key wrote one `.<key>.<pid>` temp file together. Temp
names now come from `mktemp`, and every archive is checked on read (zstd's frame checksum, plus the sha256 Gitea records
for the store copy): a corrupt cached copy is refetched, a corrupt stored one is dropped and the slot builds in place.

## Judging a bead by "its" run (2026-10-08)

With several lanes pushing, ci.yml's waiting run is replaced on every push (`cancel-in-progress: false` keeps the
running one), so most commits never get a run of their own. `scripts/ci/green-for.py` judges a commit by any completed,
successful run on a commit that contains it; close.sh and the verifier use it.

## Native vs WASM hashes: never hash a `usize` (2026-10-17, br-lekz)

Seven native-vs-WASM suites went red in one batch (CI 5495: F12 and JN4 replays, generated-jump, duels, feel, lab and
set-piece scenes). The cause was one line in the autopilot's `hash_into`: `self.on.unwrap_or((usize::MAX, ..))` cast to
u64. `usize` is 32-bit on wasm32, so the sentinel hashed as `0x0000_0000_FFFF_FFFF` there and `0xFFFF_FFFF_FFFF_FFFF`
natively, for every autopilot car not on a fork. Hashed state uses fixed-width integers and `u64` sentinels
(`map_or(u64::MAX, |i| i as u64)`). The first suspect, a vendored-parry patch landed in the same batch, was innocent:
read the batch's diffs for target-width and iteration-order hazards before reverting.

## A hung browser target holds the whole queue (2026-10-17)

CI 5450's lab-scenes hung after its own 30-min test timeout, and the runner didn't enforce the job's `timeout-minutes`,
so the run, and with it the branch's concurrency group, sat 45 min with every newer run waiting. There's no cancel in the
Gitea API: the job was ended by killing its slot process in the container (`sudo -n docker exec <id> pkill -f
run-slot.mjs` on the runner host). `run-slot.mjs` now wraps each target in `timeout -k 30` (3x its learned time, 15-25
min).

## Stale controller input on a loaded journey is the phones, not the host (br-bcuy, 2026-10-17)

FL02's four phone pages and its host share one browser. At 2x CPU throttle every seat read 1.1-3.8 s stale and snaps missed
the start window. The per-batch stamps (`__jjTest.netStamps()`) put the time on the phone side: main thread to worker
at most 17 ms and worker to applied at most 12 ms, while one phone's batches arrived up to 2.3 s apart (p95 ~100 ms). The
phones send on a `setInterval`, and a starved page fires it late. A real phone is its own device, so this is a harness
artefact. Lighten the host page instead (FL02 renders the software-GL host at 960x540; it passes on SwiftShader again).
