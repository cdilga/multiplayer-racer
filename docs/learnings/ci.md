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

## Pointer bytes, native compile memory and queued input (br-dsq4, 2026-10-25)

- Likeness checks need actual reference PNGs and masks. CI 9187's bad SHA was exactly the Git LFS pointer's SHA;
  its `oid` was the expected PNG hash. Pull `art/vehicles/**` before checking, rather than blessing pointer hashes.
- A rustc SIGKILL needs the runner's cgroup/kernel evidence. CI 9187 exhausted its 8 GiB container compiling
  Asupersync; four Cargo jobs rebuilt it successfully at 7.07 GiB peak, with zero OOM events. The shared
  `cargo-memory.sh` policy applies to native web builds as well as Rust tests; explicit job settings win.
- A periodic keyboard sampler can miss down and up delivered before its next timer. Reproduce with both events
  in one browser task through the real room. Send discrete Identify edges immediately; keep periodic held-input
  refresh. A longer synthetic key hold only hides the lost-tap bug.
- Layout observations can themselves be starved by repeated software frames. The 99-player HUD fixture drew
  11.3 million triangles per frame; a software frame reached 90.9 s despite all 99 HUD boxes existing. Stop the
  fixture's draw loop after the real layout is placed, then explicitly draw its settled frame before asserting.
  Keep every tile, car, text/containment assertion and the original timeout. Frame-rate checks remain separate.

Measurements and reproductions: `docs/evidence/P1-CI-repair/repair.md` and `staging-profile.json` beside it.

## Crowded DOM layout and GPU measurements (br-dsq4, 2026-10-25)

- Reading offset dimensions immediately after each label's style update forces layout per label. Batch
  all writes, then all required measurements, then placement. The real 1,000-label module retained
  byte-identical output while reducing 1,002 layouts to three. CDP LayoutCount provides a deterministic
  structural regression without a machine-dependent millisecond budget.
- Synthetic cohort setup need not force a browser round trip between every Hello and Claim frame.
  Feed every original frame in one task when the assertion concerns the resulting crowded room.
- Never overlap manual GPU reproductions with eris's GPU CI latency checks: both share the actual GPU
  and scheduler. This session overlapped FL02/FL17 in run 9236; those failures need isolated evidence,
  not relaxed bounds. `eris.sh --run` also enables capture-only checks via JJ_CAPTURE_DIR; explicitly
  unset it when reproducing a CI journey that does not enable captures.
- rAF's timestamp is the frame's time, not callback execution time. A snapshot can arrive between
  them. Never extrapolate it backwards from its arrival: negative elapsed time inflated the smoothing
  delay from three ticks to 6.6 in a deterministic 30 ms delayed-callback replay. Clamping elapsed time
  at zero preserves smooth playback and the original latency budget.
- Observe short UI transients in the page before sending the triggering input. At 120 seats eris
  draws 0.7–1.4-second frames; R06's separate polling RPC missed the correct #108 tile/marker even
  though the post-timeout diagnostic saw both. A preinstalled MutationObserver records the same
  event, tile and billboard together, retaining the attempt timer and every original assertion.

### Tuning bursts and full-resolution browser work (2026-10-25, br-dsq4)

The Feel Lab's fourteen-field edit in a seven-car browser fixture scheduled 98 delayed tuning
readbacks in addition to switch reads. Coalesce the field burst and reuse the read that confirmed the selected
vehicle: the browser probe retains all 98 writes and seven exported profiles with 9 rather than 113
worker reads. A display resize must defer menu DOM replacement during a pointer press, just as a
room update does; otherwise Resume loses its click between down and up.

Full-resolution live raster journeys belong on hardware when SwiftShader starves browser actions:
the same R07b matrix takes 24.6 seconds on RTX 2080 and stalls for 225.8 seconds on software button
stability. CI selection now schedules all of R07b/R08/R11 on GPU, with their assertions and cohorts
intact. Audit the union of CPU and GPU selections when changing scheduling; all 87 journey/smoke
files remain covered, with focused menu/tuning regressions still on CPU.

`JJ_CHROMIUM_GPU` configures Chromium ANGLE, not Firefox. Eris's native GPU runner inherits an
interactive Wayland display and has no Xvfb; headless Firefox can fail navigation or lack WebGL
without that desktop. The complete eight-pad Firefox check belongs in required CPU CI's explicit
Xvfb/Mesa environment (6.7 s in main 9281), with the duplicate Linux GPU invocation skipped. Keep
its eight-source assertions and deadlines, and retain Chromium's measured 24-source GPU checks.

Round phase and simulated car state must come from the same worker observation. Reading a cached
page Countdown before awaiting worker speeds misclassified a post-GO 2.978 m/s sample in GPU9293;
a 500 ms margin did not prevent it. `observe.host.phase` now carries the actual director phase
beside those cars. The existing `countdownMs` describes pause/resume, and `car.race.held` describes
respawn holds; neither identifies the director's start grid.

Controller orientation callbacks can replace a pressed Ready button, just as host menu resizes
can lose Resume. A fixed-viewport orientation-notification probe reproduces the missing click in
Chromium and WebKit. Keep pressed buttons alive through native click, then perform the pending
orientation rebuild; test both the single action and completion of the deferred redraw. A Ready
retry or forced start would hide the lost interaction rather than repair it.

Docker launch and service readiness are separate clocks. GPU9304's STUN container spent 11.17 s
between create and start, then the fixture killed it 37.6 ms after start because Docker launch had
consumed the readiness deadline. Await `docker run --detach` first, then attach logs and perform the
unchanged real STUN binding probe. The delayed-start regression fails the old fixture and passes
the fix; an empty service log alone does not establish a broken service or unreachable UDP.

New bundled LFS asset families need hydration in the cached web builder **and** source-based
browser journeys, including native GPU CI. The trailer added `assets/promo/**`, outside the older
vehicle/brand/audio lists. Without it, the real server returns 200 and `video/mp4` for a 133-byte
pointer; bytes 4–7 are `ion ` instead of `ftyp`. Keep the trailer's byte-signature/playback assertions,
hydrate the source objects, and invalidate any archive already built from the pointer bytes.

`preload="none"` does not guarantee zero media requests: Linux WebKit probes an attached video
source before play. Keep the URL unattached until an explicit viewer gesture, then enable native
controls and call play. Preserve scraper-visible `og:video` metadata separately. Test the real
button click in both engines; evaluating `video.play()` directly can miss an unusable affordance.

Software-rendering reproductions can also contaminate eris's GPU latency run through CPU
contention. Do not assume that selecting SwiftShader isolates a manual browser from hardware CI.
GPU9332 had a 4015 ms input-to-tick maximum while the 12-thread host's recent load exceeded 20;
the same-source isolated FL17 probe retained all budgets and passed (8.6 ms worker-to-tick p99,
43.1 ms tick-to-drawn p99, no sampled pauses). The four-second shape is consistent with the
existing one-second stall hold plus three-second resume countdown; the aggregate latency receipt
alone does not identify the pause reason. Record resource pressure and pause transitions before
changing latency limits or gameplay. Keep manual host-browser work off eris during GPU CI.

Lobby roster churn must not rebuild its action controls either. A real mouse-down, Ready/unplugged
update, then mouse-up loses Start on the old full-`innerHTML` renderer. Keep the shell/buttons/QR
mounted, update the roster and text in place, and bind handlers once. Preserve a brushed button's
SVG when changing its label (update a label span). Test the actual press across the update plus
empty/new-player/mode transitions; a DOM assertion alone misses the lost action.

Camera fixture checks must synchronize the rendered tick with the observed worker pose before
projecting that pose through a camera. Three ten-millisecond paint attempts are not a snapshot
delivery guarantee: an 80 ms delayed delivery reproduced tick-6 car versus tick-0 camera and four
false out-of-frame results. Wait for the actual matching rendered tick; retain the ride steps,
frustum limits, sample cadence and tile cohorts.

JN5's return to Lobby opens a car sheet asynchronously. Selecting Leave once with `count()` can
retain the play-screen action after that sheet covers it. Use a locator that resolves the sheet's
Leave or the uncovered play-screen action at click time; keep both confirmation taps and the host
seat-removal assertion. A passing drop-in timing sample alone does not qualify the full churn loop.
