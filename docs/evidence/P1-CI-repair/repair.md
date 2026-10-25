# CI batch 8912 repair — br-dsq4

Owner: CalmLynx. Source run: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/8912

## Causes and changes

- Rust advisories: update only ctutils 0.4.3 → 0.4.4 (RUSTSEC-2026-0385), rustls-webpki 0.103.15 → 0.103.16 (0382), and webpki-roots 1.0.9 → 1.0.10 (0381). `rch exec -- cargo deny --locked check advisories` passes.
- Preparation asserted over 30 seconds remained in an intermission whose configured results + vote window is now 20 seconds. Reproduced on Mac: 18,316 ms remained. Check half of the room's actual configured results + vote interval instead. The throttled-page test uses that interval too; report the worker's extrapolated 6× time as an estimate, and assert actual worker/page deadlines. CDP does not throttle that worker; multiplying its wall time also multiplies scheduler contention and is not phone hardware evidence.
- The camera test assumed tick 203 was rendered. Reproduced `cuts: 0`: asset loading can pass that tick before camera initialization. Observe a new cut after two actual rendered frames; retain the maximum camera-to-car gap assertion. Focused browser test passes.
- Practice: the log shows its first test **passed** in 784,619 ms on software GL; the file watchdog killed the second at 900 seconds total. Both practice checks move to the existing GPU lane. That lane now builds/provides `jj` as well as `jj-server`, preserving the native full-state replay check.
- Credits opens the input drawer, which fetches a missing optional helper manifest in development bundles. Ship `{ "files": [] }` as the default; the image build still replaces it with its actual helper artifacts.
- Keep-track and JN3 results interactions raced the automatic results/vote/flyover deadline. Keep the existing controlled clock held during those interactions, then process the UI command and resume it. Player-facing deadlines are unchanged.
- R09's automatic next-round budget omitted the new six-second flyover. Include `room.between.flyoverMs` in the simulated deadline.
- R11 asserted a 300 ms animation duration, functional grid restoration, and a redundant 3-second wall time including software-GL scheduling/RPC. Preserve animation/functional assertions everywhere and end-to-end wall latency on the GPU lane.
- CI 9116 additionally starved JN3's phone refreshes for 2,491 ms: `fresh:false`, `inputDropped:true`, so the idle-cue assertion was observing dropout. Route JN3 to the GPU lane without changing its freshness or idle policy. The already GPU-selected three-phone voting/flyover test now skips software GL too: its real ten-second vote window was consumed by three browser interactions there. Keep the actual game deadlines and full assertions on GPU.
- W05 observed a live boomerang in the held simulation before the renderer consumed its snapshot. Return the frame's buffers, republish the same tick, and wait for the drawn instance before its screenshot/assertion; no extra flight ticks or relaxed instance count.
- G01 results stability also released the controlled clock before clicking, allowing the intermission to end. Keep it held through the real click, process one worker boundary, then resume. Its DOM identity checks remain unchanged.
- G07's disconnected-seat removal had the same deadline race: the next round detached `Return to lobby` during its click (CI 9116). Hold the intermission through standings inspection and the click, then process/resume. The removal, retained standings and empty-Lobby assertions remain. Focused Chromium native Metal check **passes, 8,269 ms**.
- The set-piece file watchdog fired at 900 seconds after Chromium alone passed in 747,834 ms, leaving WebKit unfinished. Stop automatic 1080p drawing while searching six-tick simulation checkpoints; explicitly paint and verify the airborne and landed snapshots. Native/WASM hashes, all three kinds, geometry checks and both browser engines remain.

## Validation

Local browser checks use Playwright Chromium on macOS arm64. Preparation harness and the camera reproduction use software rendering; gameplay journeys also exercise Chromium's native Metal GPU. Initial packages from eris's clone were stale (missing `controller_practice`); those setup failures are not product evidence. Current packages come from CI 9116's successful build, key `558383a5bee175f29bc9a49d`. Only its ignored WASM package directories were extracted; Linux node_modules were not installed on the Mac. Its matching native `jj` replay binary runs on eris against the saved clip (outputs only). The native server is built per crate on the Mac.

Completed focused checks: all nine preparation cases, camera respawn cut, Keep Track round journey, Credits host-menu journey, R11 spread-out field switch, seven shared-workflow regressions, and the GPU selection dry run for C10. `git diff --check` passes.

C10's five-car/practice/native-replay test passes in 96,377 ms on the Mac GPU (versus 784,619 ms on CI's software renderer). The three real-phone journeys could not reach the join card locally: ICE remains `checking`, channels remain `connecting`, and unavailable relay fallback returns 503. They fail before the changed assertions; they need the Linux CI/GPU environment's real WebRTC path for final validation. The R09/JN3 changes are direct corrections to the round policy documented above, not speculative gameplay patches. Do not treat these setup failures as successful journey evidence.

Preview `v02-72c51850` (built run 9116) was published at 2026-10-25T02:01:38Z. Its commit status `preview/smoke/v02-72c51850` is success: room, join-webrtc, input, resume, drive, hud, round. URL: https://jammers-preview.dilger.dev/p/v02-72c51850/

Focused results and containing CI/preview receipts are recorded below when available. No tests are quarantined and no gameplay rules are relaxed.

### Focused Linux validation, commit 86a9a888

On eris (RTX 2080 Super), Playwright Chromium, `JJ_CHROMIUM_GPU=1`, CI 9116's matching WASM and native artifacts:

- C10 practice + native full-state replay: **pass, 14,456 ms**. Three real-phone practice/join viewports: **pass, 38,468 ms**.
- JN3 real two-phone round/idle/next-round loop: **pass, 119,285 ms**. Identify samples: **5, 8, 16, 4, 21 ms**.
- Three-phone voting, host override, tie/rematch and flyover: **pass, 93,030 ms**.
- R09 real two-controller reel and automatic next round: **pass, 12,640 ms** in CI-equivalent mode (`unset JJ_CAPTURE_DIR`). The extra capture-mode run failed the separate 375x667 results readability assertion; that optional visual check has not been claimed as passing or weakened.

Local follow-up validation: W05 boomerang flight/draw/return **pass, 10,197 ms**; G01 results DOM stability and next-round click **pass, 15,644 ms**, both Chromium native Metal on Mac. JN3/voting skip only software mode, and selection includes both on GPU.

### Retained CPU coverage, commit 17cd2005

The main CI uses software rendering and does not depend on the optional GPU workflow. Rust, builds, previews, the host page tests and most browser journeys still run without a GPU worker. GPU timing/practice checks queue separately when eris is unavailable; green main CI does not assert those queued checks passed.

On eris with **JJ_CHROMIUM_GPU unset**, CI-matching native/WASM artifacts, no capture-only extras: all three set-piece kinds, airborne/landing render checkpoints, triangle fingerprints and full-state replay parity **pass in Chromium (69,556 ms) and WebKit (37,103 ms)**. Whole file: **121,027 ms**, versus the CI 9116 file watchdog at 900 seconds (Chromium alone 747,834 ms). A repeat of the old Chromium implementation was deliberately stopped after over two minutes to avoid repeating that already recorded expensive failure.

On Mac with Chromium **software rendering**, G01 DOM stability and next-round click **pass, 83,316 ms**, and W05 boomerang pickup/flight/draw/return **pass, 216,578 ms**. The eight workflow/publication regressions also pass.

On Linux/eris with software Chromium, the G07 disconnected-seat removal **passes, 92,000 ms**, and the R09 real-two-controller reel/automatic-next-round check **passes, 116,122 ms**. This confirms the round fixes on software GL as well as GPU.

Launcher-only edits now select the always-on checks job, whose workflow regression suite already covers `scripts/agents/`. Dry selection of `start.py`, the OMP overlay and `test_workflow.py` selects no game/Rust/browser/image jobs; changes to the CI planner itself still select the full matrix for validation.

### Preview tool installation

Run 9148 built its image successfully. Scheduled publisher 9150 remained in Tools: inside its deployment container, `apt-get`/`dpkg` had spent over twelve minutes installing Chromium system packages (Publish had not started). The deploy runner already has `jj-ci:d161a07c0df4`, the same pinned Ubuntu 24/Node/Playwright image as main CI. Use that image and its `/ms-playwright` headless shell, dropping per-run apt/browser installation and redundant Node setup.

Verified on TrueNAS in a fresh disposable container from that exact image: pip/websockets 15.0.1 installation, Playwright 1.62.1 installation, Chromium launch, a real page title and browser close all succeed. Deploy-secret isolation check and `git diff --check` pass. This changes deployment tooling only, not the running production app.

### CI 9148: Cruz profile fingerprint

Native/wasm checks, both Clippy runs and cargo-deny pass. The remaining lint failure is the Cruz profile's old LOD0 SHA despite its unchanged sidecar: `702e0a…` instead of committed GLB `d98892…`. `jj vehicle sync assets/profiles/cruz-missile.json` changes **only that SHA**. Geometry, collider/mass data, model script, atlas, sidecar and GLBs are unchanged.

Vehicle-validation scope: metadata synchronization **PASS**, using R81/R86, Playtest-1 §6 and master §12.3–12.5. `jj validate` passes the actual sidecar (LOD triangles 2017/886/507), synchronized profile, and surface-strips map. This is not a new whole-vehicle visual qualification; no model or rendered appearance was changed by the repair.

### CI 9148: actual preparation interval and published preview

The first deadline repair read `room.intermissionMs`, which now means only the results hold (10,000 ms), not the director's results + vote interval (20,000 ms). CI's throttled-page case staged a map in **7,579 ms**, failing the accidentally halved 5,000 ms bound. `between_json()` exposes both real intervals; `between_total_ms()` adds them for the director. Both preparation checks now use that same sum and retain the half-interval margin (10,000 ms), without changing gameplay timing. Evidence is written before the throttled assertions so a future failure retains its measurements.

Downloaded CI 9148's build artifact `ebacc61585b50148f3ebec4a` and extracted only `web/dist-test` into OS scratch (no Linux node_modules installed on Mac). Chromium 151/macOS arm64 measured throttled staging **1,516 / 1,598 / 3,666 / 2,965 ms** with that fresh build before the assertion correction. The source and configured profile confirm the separate 10-second results and vote windows.

The full focused file then exposed a second test-clock issue: its 1,200-tick manual step can cross the finish and spend up to 20 simulated seconds of Intermission before checking its remaining time (reproduced **9,675 ms** remaining, despite subsecond generation). Observe the finish in 120-tick/two-second steps instead, preserving the same total lap-search budget and half-interval readiness assertion. No runtime simulation, procgen or gameplay deadline changes.

After both corrections, all **nine preparation checks pass** against that CI artifact (Chromium 151/macOS arm64, 91,794 ms total on the shared Mac). The next track is ready with **18,925 / 20,000 ms** remaining. Throttled reroll-to-staged samples: **1,773 / 1,607 / 4,075 / 4,318 ms**; worker samples: **306 / 246 / 1,491 / 3,219 ms**. `python3 -m unittest discover -s scripts/agents -p 'test_*.py'` also passes all eight checks, including the real Beads concurrent-claim canary.

Publisher **9169** used the baked browser image and completed successfully, from runner start 02:55:58Z to cleanup 03:00:44Z. At **2026-10-25T03:00:38Z**, preview **v02-1d3eb78f** passed smoke: room ARVR, isolation from four other previews, join-webrtc (host, 2 ms), input, resume, drive, HUD and round. URL: https://jammers-preview.dilger.dev/p/v02-1d3eb78f/ . Image source: CI 9148. Preview remains independent of the red batch.

### CI 9187: LFS references and native build memory (TurquoiseSnow)

Repair resumed after NobleMoose explicitly released it. Source run:
http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/9187 at `a13a9b3f`.

- Checks: seven Hawk likeness tests read Git LFS pointers as PNGs. The observed reference hash
  `d73a19a503bbb4a4ef1239046210701e318c388916d1c0b48c62e81d187f9eb0` exactly matches
  `git show HEAD:art/vehicles/hawk-dash/refs/lod-plus-1.png` (the pointer). Its object ID is the expected
  `409e7e0edbca72dd5784c116e1fadb6381a4f09cd9f87b8d0b8f1958942541aa`. The mask PNG parse failures
  have the same cause. Pull `art/vehicles/**` before vehicle checks; keep all hashes and shape/defect assertions.
- Build: TrueNAS kernel journal confirms a memory-cgroup OOM for container `7833c7aa490f…`, the exact
  run-9187 build container. At 03:50:30 UTC, its 8 GiB limit was exhausted and `rustc` was killed
  (8,311,628 KiB anonymous RSS). Browser slots then failed fetching that absent build, before running tests.
  Share the existing small-container Cargo policy between Rust tests and the web/native build: four compile
  jobs below 12 GiB; larger/unlimited runners keep Cargo defaults, and explicit settings take precedence.

Focused checks use the pinned Node 26.10.0 on macOS arm64: all 12 Hawk likeness tests and all four Cargo-memory
policy regressions pass. Shell syntax and whitespace checks pass. A full local checks attempt intersects
NobleMoose's actively changing roster files: Tradie Ute bake/vehicle-review fail; the other completed checks pass.
Those uncommitted roster changes are outside this repair and are not reverted or included. An initial run with
the desktop's unpinned Node 26.7.0 could not discover test directories; that setup failure is not CI evidence.

Native reproduction: TrueNAS, image `jj-ci:d161a07c0df4`, pinned Rust 1.99.0, same `ci-cache` target directory
as the failed build, clean committed source at `dac0fcf8` mounted read-only. With **8 GiB memory and swap
limits** and `CARGO_BUILD_JOBS=4`, `cargo build --locked -p jj-server --bin jj-server` **passes in 6m 55s**.
It recompiles Asupersync rather than reading a previously successful library. Cgroup peak is **7,586,271,232
bytes (7.07 GiB)**; `memory.events` reports **zero max, OOM and OOM-kill events**. The newer unmodified CI
9217 build also passes on a 16 GiB runner, consistent with the diagnosed resource limit.

Containing CI and preview results follow when complete; no CI success is claimed in advance.

### CI 9217: preparation staging cost

The saved failing receipt reports reroll-to-staged **5,283 / 5,974 / 12,806 / 10,170 ms** with the page at 6×
CPU throttle, against the unchanged **10,000 ms** half-intermission bound. Worker times are **838 / 712 /
3,509 / 1,501 ms**. The first repair did not change this test or its deadline.

CDP CPU profiling of the exact CI harness identifies quad emission, repeated CSS colour parsing and mesh assembly
as the main-thread costs. A separate same-source comparison excludes unrelated uncommitted route-draping edits.
`staging-profile.json` records hardware, build, raw samples, ranked hotspots and the output hashes.

Extract the existing `Soup` API into its own module, cache each colour's linear RGB per builder, and write corner
attributes directly into growing Float32 buffers. Growth follows all input geometry; it introduces no count cap.
Float32 conversion moves earlier, before any geometry arithmetic, and the original Three.js normal computation and
face/corner overrides remain. Triangle order, winding, colours and normal bytes match the pre-change golden exactly.

On the shared Mac, 20 paired assembly samples (30,000 quads; three warmups) have nearest-rank medians **19.83 →
6.88 ms**, with retained scheduler outliers. In the four-seed CDP profiles, quad self time falls **1,946 → 288 ms**
(new buffer growth takes 260 ms). Reroll samples are **1,718 / 1,652 / 4,501 / 2,757 ms** before and **1,128 /
1,088 / 3,051 / 1,970 ms** after. Worker time and scheduler load also vary; these are local measurements, not device
qualification or a prediction that CI has passed.

All **nine unchanged preparation tests pass** against the optimized harness (Chromium/macOS arm64, **30,708 ms**
total; the throttled four-seed test takes 7,396 ms total). The byte-golden test and standalone strict typecheck of
`soup.ts` pass. Whole-web typechecking currently finds errors in another session's uncommitted route-draping block;
those hunks are neither reverted nor committed by this repair. The complete checks script passes on clean committed
source on **eris/Linux** after `npm ci` refreshes its missing locked `three-mesh-bvh` dependency.

### CI 9217: acknowledge real input before dropout

JN6 failed `A drives itself` before disconnecting the phone. Its fixed 1,500 ms sleep did not acknowledge
the fresh deliberate input or handback after startup rendering. Match JN3's existing baseline: observe the seat
fresh, outside the menu, without dropped input, and its car player-driven with throttle, before disconnecting.
Dropout and reconnect bounds, same-car assertion and room continuity remain unchanged.

Focused Linux/eris validation uses pinned Node 26.10.0, Playwright Chromium and the current GPU-lane
`jj-server` binary against committed web source `9388bd30` plus the test supplied on stdin (no remote source edits).
GPU run passes in **10,252 ms**, takeover after **2,121 ms**; software-GL run passes in **43,253 ms**,
takeover observed after **5,261 ms** within its existing 6-second software bound. An initial reproduction
accidentally used eris's stale October-18 debug server; it is excluded. Mac real-WebRTC setup remains blocked
before joining, so it is not counted as journey validation.

### CI 9217: keyboard edges and 99-player HUD observation

- Keyboard Identify: the held Q test timed out waiting for its tile pulse. Input polling can miss both
  queued key events if down and up arrive before its next timer. A deterministic regression dispatches
  both real DOM keyboard events in one browser task, after the existing held-key journey and cooldown.
  This **fails before the fix** on Linux/GPU at the new pulse assertion (10-second timeout). Sample the
  Identify press and release immediately in the key handler; periodic input refresh, helper ownership,
  Ready routing and axis ramps remain unchanged. The held-key and queued-tap assertions both pass
  after the fix: Linux/GPU **10,976 ms**. All three menu/settings/keyboard journeys pass on Linux
  software GL in **37,958 ms** (keyboard case **19,904 ms**).
- The 99-player HUD layout fixture times out at its existing **89,100 ms** bound, reproduced on the Mac
  (case **94,434 ms**). Native-GPU introspection finds all 99 boxes/rects and **11,273,315 triangles**,
  2,773 calls in a frame; software frames reach **90,901 ms** and starve the observation while continuing
  to redraw. In layout-only HUD cases, observe the real renderer placing every box, stop its continuous
  frame loop, then explicitly draw the settled layout after the existing 400 ms reflow interval.
  Every car, tile, backing resolution and layout/text/containment assertion remains; no timeout increases.
  All five unchanged cohort assertions (1/2/8/32/99) pass with software rendering on Mac (**36,082 ms**,
  99 case **21,456 ms**) and Linux/eris (**30,959 ms**, 99 case **23,592 ms**).

Linux checks use Node 26.10.0, Playwright Chromium, current committed web source and server. The candidate
input module is supplied to Vite's load hook in memory, with compiled outputs in eris's run directory;
no remote source files are edited. Test candidates run on stdin.
