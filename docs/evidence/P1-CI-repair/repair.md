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

### GPU CI 9224/9236: crowded nameplate layout

R06 stalls growing from 24 to 120 live seats. Its original join helper performs 192 separate browser
round trips during the growth; batch those same Hello/Claim frames in one browser task, retaining
every seat, live simulation, capture and original assertion. That change alone still stalls locally.

The runtime nameplate updater writes one label's styles, then immediately reads its dimensions,
forcing full browser layout for every changed label. Finish all writes before measuring changed
boxes together, then run the unchanged placement algorithm. No nameplates, cars or triangles are
removed or capped. A real-module 1,000-label probe drops **1,002 layouts / 306 ms → 3 layouts /
42 ms**. All 1,000 output rows (text, dataset, styles, width and height) are byte-identical, SHA256
`f70abfbfea678a78dc5ff1db45b90fe8838e94f44bf960e0eb467654aeb5ca9b`.

The permanent browser regression exercises creation, changed font/text and cached repaint across
20 viewports × 50 labels. It retains all labels and checks text, finite geometry and horizontal
containment, with a structural budget of at most ten browser layouts per update. Against the old
committed module it **fails with 1,001 layouts**; the optimized module **passes in 1,164 ms**.
The complete live R06 journey **passes in 46,590 ms** on macOS arm64, Playwright Chromium native
Metal. Both 24-seat and 120-seat captures were inspected: rendered tiles are populated, with the
expected number badges and no blank panels. The full build uses committed map.ts via an in-memory
Vite load override to exclude another session's dirty route-draping edits; public assets/WASM come
from CI 9217. This validates the runtime candidate, not a whole-vehicle visual qualification.

GPU 9236 at `013f7eae` confirms keyboard Identify and the unchanged voting/flyover journey pass.
Its R06 fails before this optimization. FL02 and FL17 fail latency bounds while this session's
manual GPU reproductions were also using eris; that overlap confounds their measurements. Manual
eris GPU work is stopped. Leave their gameplay bounds unchanged and inspect the isolated CI run.
Do not treat the overlapping measurements as a demonstrated runtime regression or a passing check.

Main 9228 already passes checks, Rust lint, all three Rust shards, build, image and browser slots
1–3; slots 4–7 are still running at this recording. Its source predates the keyboard/JN6/HUD fixes.
Preview **v02-9388bd30** smoke passes: room C3BJ, isolation from seven previews, real WebRTC join,
input, resume, drive, HUD and round. URL: https://jammers-preview.dilger.dev/p/v02-9388bd30/ .
Containing green CI and the next built preview remain required; neither is claimed in advance.

### GPU 9248: stale animation timestamps and render lag

With no concurrent manual GPU reproduction, FL02 passes (**24,748 ms**). FL17 still reports render-lag
p99 **6.9 ticks**, while tick-to-drawn p99 is **47.2 ms**, inside its unchanged 60 ms bound. The run
also has a settings-sheet Identify failure; its detailed assertion is still pending the job's completion.

The interpolation clock projects the latest snapshot from its main-thread arrival to rAF's timestamp.
A delayed rAF callback can have a timestamp older than snapshot messages delivered before that callback.
The old code accepts negative elapsed time, projects the newest state backwards and adds scheduling
delay to its configured three-tick interpolation delay. Clamp elapsed time at zero; retain the delay,
rate steering, hitch handling, monotonic clock and latest-snapshot bound.

A deterministic real-interpolator replay delivers 120 Hz snapshots before 60 Hz callbacks whose frame
timestamps are 30 ms old. It **fails before the fix at 6.60 ticks p99 lag**, and **passes after at
3.00 ticks**. All four existing clock/smoothness/hitch tests pass unchanged, including 99% smooth-frame
requirements at 60/120/144 Hz. The complete live R06 24→120-seat journey passes again with the runtime
clock correction (**30,181 ms**, macOS arm64, Playwright Chromium native Metal, same build method as
above). Both captures inspected: populated tiles, expected badges and no blank panels. This is a
reproduced clock defect, not an increase to any FL17 budget; the containing Linux GPU result is still
required and not assumed.

### GPU 9256: Linux pulse observation and isolated infrastructure

At `f48e668b`, all three menu/settings/keyboard Identify checks and FL02 pass. The unchanged FL17
budget now passes: **301 samples**, main→worker p99 **0.2 ms**, worker→tick **8.4 ms**, tick→drawn
**36.3 ms** (60 ms bound), render lag **2.9 ticks** (five-tick bound), total-path p99 **49.2 ms**.
TURN coverage is explicitly skipped because no TURN credentials are configured; loopback is real WebRTC.

R06 still fails its transient observation on Linux (**92,536 ms** in CI; **62,456 ms** focused).
An instrumented reproduction shows the correct #108 tile in `identify` state and mark **107** (its
actual car) present, with its own new Identify event. However, crowded frames occupy the page for
**0.7–1.4 seconds** (about 38.9 million triangles, 6,500 draws). The separate polling RPC misses the
live state even though both conditions are true when the failed attempt is inspected. Simulation
and rendering remain live; no frame-rate acceptance is inferred from this functional cohort test.

Install a MutationObserver in the page **before sending the same Identify input**, and resolve from
the actual DOM update when the existing event/tile/billboard conditions all hold. Keep the **1,500 ms
browser attempt timer**, retry count, 600-second file bound, 24/120 cohorts, live simulation, captures,
and every original functional/fit assertion. This changes the observation point, not the pulse's
duration or any gameplay rule. The complete Linux/eris RTX 2080 Super journey **passes in 23,416 ms**
with this candidate supplied on stdin against committed `f48e668b`; no remote source files edited.
Both captures inspected: every tile is populated, including the three-digit badges and #108 markers.

The two R13 failures in GPU 9256 occur **before browser creation**: local STUN never answers. Their
Docker containers remain `Created`, never started, with no coturn output. A separate readiness probe
after the batch finishes starts the same pinned coturn image successfully in **941 ms**. The two
identified abandoned CI containers were removed. R13's checks and readiness deadline are unchanged;
the isolated full file passes: Chromium real-phone identity **14,586 ms**, WebKit **33,936 ms**,
and the 1/4/24-tile pattern/draw/number/CVD check **7,659 ms** (whole file **57,029 ms**).

Preview **v02-f48e668b** passes public smoke: room **2M3N**, isolation from eight previews, WebRTC
join (host, 0 ms), input, resume, drive, HUD and round. Published by run **9260**:
https://jammers-preview.dilger.dev/p/v02-f48e668b/ . Main 9255's checks, lint, three Rust shards,
build, image and browser slots 1/2/4 pass at this recording; remaining browser slots are running.

### Main 9255: tuning readback fan-out, resize clicks and raster scheduling

Main 9255 eventually reports four failures on its software-rendered slots: R07b's post-Resume
5-second observation, FL03's Grip application at **10,721 ms** against **10,500 ms**, R11's
post-keyboard Overview observation, and R08's DPR-3 portrait screenshot after fonts loaded.
GPU **9268** at `0d6a29d6` is **green**, including FL17, R06's full 24/120 cohort and all R13
Chromium/WebKit/pattern checks; no GPU failure is waived.

Two runtime defects are reproduced and repaired:

- The lab considers fourteen tuning fields per vehicle (skipping absent fields), and every send
  scheduled an independent worker tuning read plus whole-panel refresh. A real-browser regression
  with seven complete car profiles records **113 reads** for **98 field writes** before the fix.
  Coalescing each burst and reusing the tuning response that
  confirms a vehicle switch reduces this to **9 reads**. All 98 writes, every vehicle's values,
  return to the selected vehicle and all seven vehicles' exported patch fields are checked.
- A resize between pointer-down and pointer-up on Resume replaced its DOM node, losing the click.
  `chrome.test.mjs` reproduces this with real Playwright mouse events: the old code leaves the menu
  open; the repaired resize handler uses the existing deferred-redraw protection and resumes.
  The focused software-browser regression passes in **5,100 ms** on the loaded Mac.

Focused full journeys on Linux/eris, Chromium (Playwright), RTX 2080 Super:

- R07b's original whole file passes in **33,590 ms**, including a real phone joining the decoded QR,
  pause/resume, all sixteen viewport/display-mode pairs and full screen. The matrix takes **21,844 ms**.
- R08's original whole file passes in **35,599 ms**: DPR 2 and 3, portrait and landscape, every capture
  and original layout/backing-store assertion. DPR-3 portrait takes **6,463 ms**.
- FL03's full 1080p software journey passes in **242,119 ms** with the burst-coalescing candidate:
  its five edits take **5,600 / 9,361 / 3,612 / 4,764 / 2,303 ms**, all below the unchanged 10,500 ms
  bound. The final confirmed-response reuse is additionally covered by the nine-read regression.
- The final candidate passes the complete FL03 file on Linux GPU in **85,838 ms**: no owner flag,
  1280×720 and 1920×1080, all vehicles and native patch validation. The 1080p edits take
  **479 / 556 / 515 / 749 / 572 ms**; the 720p edits take **492 / 673 / 517 / 523 / 512 ms**.

Hardware scheduling is explicit: R07b, R08 and R11 now run their **whole unmodified files** on the GPU
lane instead of repeating their full-resolution raster work on SwiftShader. The unchanged R07b
matrix passes in **24,624 ms** on GPU even before the resize fix; an isolated Linux software run
stalls for **225,837 ms** and times out waiting for Display & sound to become stable. Main 9255
spent **301,600 ms** in R11 and exhausted the 30-second DPR-3 screenshot deadline. No timeout,
cohort, gameplay requirement, screenshot or assertion is removed or relaxed. A full-selection audit
proves all **87 journey/smoke files** still run, these three whole files are in GPU selection, and
the tuning and menu regressions remain CPU targets.

The Vite candidate build uses committed `map.ts` through a load hook to preserve another session's
dirty route-draping edits. Local pinned whole-web typecheck reports only those dirty map edits
(`lo`/`hi` possibly undefined, lines 377–387); the author sessions were notified. There are no
diagnostics in the owned repair paths. Exact committed-source typechecking remains a CI check.

The exact committed-source build and pinned typecheck pass in main **9281** at
`76a5c6ea61b0feecea5b593dd605f864714961a8`. Publisher **9284** publishes image
`sha256:0fca3774509f7726bd180a82776499ee23afd63d3ee142f9be4beb11627f4c4c` at
https://jammers-preview.dilger.dev/p/v02-76a5c6ea/ . Public smoke **PASS**: room **839Y**,
isolation from ten other previews, WebRTC join (host, 0 ms), input, resume, drive, HUD and round.
Main 9281 and GPU 9282 are still running at this recording; GPU 9282 has a Firefox eight-pad
failure whose deferred stack is still pending, so this is not yet a green repair handoff.

### GPU 9282: Firefox's duplicate graphics environment

The completed GPU batch reports **40 passes**, one configured TURN skip and one failure: Firefox's
eight-pad test times out in `page.goto` after **30,000 ms**, waiting for the generic `load` event,
before any pad assertion. All R06, R07b, R08, R11 and R13 checks pass unchanged.

The required CPU run of the **same complete Firefox test** passes in main 9281 / browser 5,
job **19399**, in **6,736 ms**, using the fixture's existing Xvfb/Mesa path. The native GPU runner
has no Xvfb and inherits `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-1`, `MOZ_ENABLE_WAYLAND=1` from its
desktop. A focused Linux reproduction without that desktop reports WebGL unsupported; with the
runner's display environment the unchanged eight-pad test passes in **7,179 ms**. This exposes a
desktop-dependent duplicate setup, not a missing pad or a limit on sources.

Firefox's whole eight-pad check now runs once in **required CPU CI**, with every assertion and
the original navigation, readiness, claim and whole-test deadlines unchanged. Only its duplicate
Linux GPU invocation is skipped. Chromium's 24-source/input-age GPU checks and the rest of C12
remain intact. The full-selection audit confirms the eight-pad Firefox case remains a CPU target
and C12 remains in the GPU selection. No gameplay acceptance is quarantined or omitted.

### Containing-run verification

GPU **9288** at `b43febb20a98273483b9878699621f44c1d5e50c` completes successfully at
2026-10-25T07:42:43Z: **41 passes, zero failures**, one existing unconfigured TURN skip.
It contains every runtime repair through `76a5c6ea`, plus the trailer/server changes. The unchanged
Firefox eight-pad check also passes in this batch (**11,778 ms**), consistent with its diagnosed
desktop-dependent duplicate environment. The final scheduling fix `a2f5fec0` still needs its own
containing main/GPU receipts; this preceding green run alone does not close the repair.

Run: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/9288

Full original R07b viewport/display-mode matrix, R08 DPR/orientation cases, R11 overview checks,
R06 24/120-seat Identify and R13 Chromium/WebKit identity/pattern checks all pass. FL17 retains
its original bounds: **302 samples**, main→worker p99 **0.5 ms**, worker→tick **8.6 ms**,
tick→drawn **42.7 ms**, render lag **3.2 ticks**. The measured loopback total is **77.6 ms**;
TURN is not claimed as tested.

Main **9281** at `76a5c6ea61b0feecea5b593dd605f864714961a8` completes successfully at
2026-10-25T07:50:03Z: all **14 jobs green**, including seven browser shards, all three Rust
partitions, lint, checks, build and image. The committed-source tuning-readback and resize-click
regressions pass in this run. This establishes the runtime repair; final main **9297** at the
containing roster commit `56252cf5` starts immediately afterward to validate the later Firefox
scheduling change and other published work.

Run: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/9281

### GPU 9293: atomic start observations and controller orientation clicks

The completed final-scheduling batch reports **38 passes, two failures**, and two explicit skips
(unconfigured TURN and duplicate Firefox coverage retained in required CPU CI). Its exact failures:

- FL02: `no car drove off before GO (fastest 2.978 m/s)`. All four cars' recorded travel is the same
  **0.41 m**. The test reads the page's cached Countdown, then asynchronously asks the worker for
  car speeds. A delayed query can return after GO while retaining the earlier phase. The old
  500 ms wall-time margin cannot make those reads atomic. Add the director's phase to the worker's
  existing `observe.host` response, and sample the speeds only when that same response says
  Countdown. The original **1.5 m/s** bound, all four phones, their launch outcomes and callouts,
  real countdown duration and all deadlines remain. Every observed Countdown sample now counts,
  including the final 500 ms, and an explicit assertion requires a nonempty countdown sample set.
- R13 WebKit: the first phone stays unready, with **five commands**, while the second is ready
  with **six**; both WebRTC links stay connected. An orientation callback rebuilds the controller's
  play screen immediately and can remove Ready between pointer-down and click. A deterministic
  real-browser probe dispatches that callback during the press, keeping the viewport fixed to
  isolate DOM replacement: the old controller loses the click in **both Chromium and WebKit**.
  Reuse the host menu's deferred-redraw approach: retain pressed buttons through native click,
  then apply the pending orientation rebuild. This also preserves the existing settings/car-sheet
  rehosting path. No Ready retry, forced start or test deadline change is introduced.

Focused validation on macOS arm64, pinned Node 26.10.0 and Playwright:

- The permanent Ready regression fails before the runtime fix in both engines (no click within
  its two-second observation), then passes in **349 / 695 ms**. It checks exactly one Ready action
  reaches the session and the deferred rebuild actually completes. The full controller file passes
  **all 13 checks in 6,849 ms**, including touch isolation, orientation, fullscreen and wake lock.
- The unchanged R13 WebKit real-phone journey also passes against public preview `v02-76a5c6ea`
  in **12,273 ms** before the fix; that establishes the failure is intermittent, not validation of
  the new runtime candidate. Background-page click probes pass; focus alone does not reproduce it.
- The new native observation regression captures Countdown, advances the real host through GO,
  and verifies the newer car observation says Running despite the earlier cached Countdown. It
  fails before the API change (`Null` versus Countdown). All **six test-surface tests pass after**
  through RCH on eris (**0.15 s** test time), including mixed-roster determinism and clip replay.
  The sim's per-car `race.held` describes respawn holds, not the director's grid hold; the initial
  fixture assertion conflating them was removed before the successful run. Likewise, the existing
  observation `countdownMs` is pause/resume time and is not used for the round's Countdown.
- Whole-web typecheck reports only the other session's existing dirty `map.ts` route-draping
  errors. No diagnostics name the repair files. The new containing CI build must verify the exact
  committed source and execute the full FL02/R13 journeys before this repair closes.

No manual eris GPU tests overlap either batch. RCH native compilation is limited to two jobs.
Devbox is temporarily unavailable, so eris is the only admitted RCH worker. The repair remains open
for containing green main/GPU results and the latest image's published smoke result.

### GPU 9304: Docker startup consumed STUN readiness

The preceding roster batch has two exact failures: JN3 Identify samples **18, 56, 45, 1609,
5 ms** against the unchanged **150 ms** bound, and R13 Chromium's fixture reports `local STUN
never answered` before any identity assertion. Neither failure is called a gameplay pass.

Docker's retained events identify the STUN startup cause, independent of a retry:
container `jj-journey-stun-192571-60706` is created at **08:16:39.409202941Z**, starts at
**08:16:50.578154540Z**, and is killed at **08:16:50.615728755Z**. The container had only
**37.6 ms** running time before the fixture killed it. The existing 15-second readiness clock
had already been consumed by Docker's create/start lifecycle; an empty coturn log was expected.

The fixture now awaits `docker run --detach` completing before starting its original 15-second
real STUN binding-response probe. Docker launch has a separate 45-second process deadline and
failure cleanup; container logs remain attached for diagnostics. The pinned coturn image,
loopback networking, transaction-ID validation and teardown stay the same. No game deadline,
latency acceptance, Ready retry or service-probe duration changes.

Focused validation with pinned Node 26.10.0:

- The permanent process-boundary regression delays Docker startup **15.5 seconds**, then answers
  actual UDP STUN binding requests. The old fixture fails in **15,625 ms**, `local STUN never
  answered`; the fixed fixture passes in **17,256 ms**, including server startup and container
  teardown. This substitutes Docker's lifecycle and the lightweight server process only; it is
  fixture proof, not a game or coturn claim.
- A separate native eris probe uses the real pinned coturn Docker image and the revised fixture.
  Its binding response arrives in **10,584 ms**, and cleanup completes. It creates no browser/GPU
  work and does not overlap CI's GPU with a manual graphics test.
- Public preview **v02-56252cf5** has smoke **PASS**: room **RFF6**, isolation from eleven other
  previews, WebRTC join (host, 1 ms), input, resume, drive, HUD and round. Publisher runs 9312/9313
  have no new image to publish; they do not establish deployment of runtime fix `9eeebccc`.
- A full Mac native-GPU JN3 run against that public preview passes in **124,344 ms** (154,510 ms
  total), Identify samples **47, 52, 41, 41, 38 ms**. This is a Mac Chromium receipt, not a Linux
  pass or a diagnosis of the isolated 1609 ms Linux sample. That latency failure remains under
  investigation; the 150 ms assertion is retained.

### Main 9297: hydrate the new trailer before bundling and source-based journeys

Browser shard 6/job **19495** fails all four new trailer cases at the MP4 signature assertion:
**`'ion ' !== 'ftyp'`**. The response is the Git LFS pointer's `version …` text, not a video.
The committed trailer `assets/promo/bring-your-friends.mp4` is an LFS pointer for
**25,715,991 bytes**, SHA-256 `14474a45ea9ef8f7fe40668cfd75e64b8a904ed6580e769a54cd63f664f7dd44`.
The three browser/build hydration lists include vehicle, brand and audio objects but omit promo
media. The image's independent full `art/**,assets/**` hydration already includes it.

Add **assets/promo/** to the cached web builder, CPU browser and native GPU hydration lists. The
browser source-based journeys rebuild Vite pages, so hydrating only the cached bundle is insufficient.
Changing `scripts/ci/build-web.sh` also changes its content-addressed build key and prevents reuse
of the old pointer-containing archive. The existing trailer tests and media bytes are unchanged.

On the Mac, with the real hydrated assets and real `jj-server`, all **four original trailer
journeys pass in 59,170 ms**: Chromium and WebKit at both `/` and `/p/trailer/`. They retain MP4
signature, media MIME, byte-range responses, scraper-visible metadata, deferred download, native
playback, captions, seeking and layout assertions. This verifies the hydrated candidate's behaviour;
the containing Linux CI run still must prove the repaired hydration pipeline itself.

A second full native Mac Chromium JN3 run passes in **123,356 ms** (152,445 ms total), samples
**39, 46, 45, 41, 44 ms**. Event-loop diagnostics record startup tasks up to 332 ms, but do not
reproduce the Linux press spike. No speculative latency patch or relaxed limit is introduced.

### Containing GPU verification at 8284620d

GPU **9320** completes successfully at **2026-10-25T08:53:06Z** on
`8284620d19658144f06cde94a43d331790b006f1`: **40 passes, zero failures**, with the existing
unconfigured TURN and duplicate Firefox skips. The required CPU Firefox case remains scheduled.
Full JN3 passes in **116,698 ms**, Identify samples **9, 9, 9, 10, 2 ms**, retaining the **150 ms**
limit and the full two-phone idle/results/next-round loop. FL02 passes with all four cars' pre-GO
travel **0.03 m**, fastest forward speed **0.01 m/s**, and the expected Early/Perfect/Launch results.
R13's real-phone identity journeys pass in Chromium **28,668 ms** and WebKit **57,502 ms** with
the revised Docker/STUN fixture. No manual eris GPU tests overlap the batch.

Run: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/9320

The local trailer pointer reproduction also exactly matches main 9297: serving the committed LFS
pointer through the real server returns **200**, `video/mp4`, **133 bytes**, signature `ion `;
hydrating the same fixture returns **25,715,991 bytes**, signature `ftyp`. This changes only scratch
fixture files and restarts the real server between the two responses; repository media is untouched.

Main **9319** has passed all three Rust partitions, lint, checks and its new-key web build. The
image job **19631** fails before any build step: fresh-checkout Git reports a corrupt packed object
`5457d999a37316710c06d111030df8e29a3c081e` (an existing evidence PNG). Gitea's blob API returns
**244,535 bytes** with the correct Git SHA-1, byte-identical to the valid local object; other jobs
check out the same commit successfully. The runner removes the failed temporary container and
volume. Gitea rejects an image-only rerun while the batch is active (`this workflow run is not
done`); the one permitted infrastructure retry is deferred until that batch finishes.

### Main 9319: enforce deferred media loading in Linux WebKit

The repaired hydration pipeline passes both Chromium trailer cases, including the real MP4
signature. WebKit now reaches the next assertion and fails both bases: **one media request before
Play, expected zero**. A focused eris Linux reproduction of the unchanged committed source
reproduces both failures (Chromium passes). `preload="none"` is a browser hint, not a guaranteed
network barrier: WebKit probes an attached source even though autoplay is off.

The poster now has a real **Play trailer** button. No video source URL exists before that
gesture; the click attaches the bundled URL, invokes playback and enables native controls. The
original scraper metadata, captions, fallback download, native player and seek support remain.
The four existing journeys click the actual affordance and retain the zero-request requirement,
now also asserting an initially empty `currentSrc` and native controls after playback starts.

- Mac pinned Node 26.10.0: all **43 landing tests pass in 23,007 ms**. The four focused trailer
  cases pass in **7,391 ms**.
- Eris Linux, real pinned Chromium/WebKit and real `jj-server`: the built candidate passes all
  **four unchanged behavioural requirements in 6,966 ms**, at production and preview bases.
  Candidate transfer contains built landing/assets outputs only; the remote code checkout is
  unmodified, and the harness is supplied through stdin.
- Local visual review: inspected ten phone/laptop/TV captures before/after resize, plus WebKit
  poster and decoded-caption playback states. An initial brush-positioning conflict was caught
  and fixed before publication. Receipt: `docs/evidence/P1-PROMO/self-review.md`.
- Whole-web typecheck still names only the unrelated, uncommitted renderer `map.ts` errors;
  the previous clean-compiler probe cannot run because the old JavaScript compiler API is absent
  from this install. The candidate's exact-source CI build remains required. No typecheck pass
  is invented and the other session's renderer is not edited.

Main 9319 now has a genuine landing-code failure as well as its disposable image checkout failure;
the next push contains this reproduced runtime fix. Do not rerun the old unchanged batch just to
get past WebKit. A public preview and deployed visual review follow the new image.

### Main 9319 follow-up: results-screen click

Browser 4/job **19627** also timed out during the real 30-second Playwright click on **Start next
round now**, after the visible/enabled/stable checks and the results DOM-identity assertions had
passed. The test keeps the simulation held through that click; this protection is retained.
A focused eris Linux SwiftShader run at `23d2027e` passes the exact unchanged journey in
**93,791 ms** (**97,297 ms** including setup). Main **9331**, browser 3/job **19691**, independently
passes the same journey (**72.5 seconds** including its slot setup). No click deadline, synthetic
click, resolution change or speculative production patch is introduced for this unreproduced timeout.

GPU **9332** reports an FL17 latency spike; the cause is still being checked. Its input-to-tick
maximum is **4015.2 ms**, consistent with the simulator's existing one-second performance-stall
hold and three-second resume countdown, but the summary alone does not prove a pause reason.
The manual software reproduction ran on eris during the GPU batch (run directory created
**09:16:33.700 UTC**); this is a scheduling mistake and is not an isolated latency receipt.
At **09:23 UTC**, eris has **12 logical CPUs**, load averages **13.13/21.48/18.12**, and CPU
pressure `some avg60=15.49 avg300=25.21`. Other projects' browser jobs are also active.
No other session's processes are stopped. An isolated FL17 probe is prepared with the original
sample count/budgets and additional pause-transition/long-task diagnostics; the current GPU batch
must finish before it runs. No successful containing GPU verdict is claimed yet.

The isolated probe at the exact same source passes in **16,601 ms** (**18,824 ms** with setup):
**301** samples, main-to-worker p99 **0.3 ms**, worker-to-tick p99 **8.6 ms**, tick-to-drawn p99
**43.1 ms**, render-lag p99 **3.5 ticks**. A 25 ms diagnostic sampler records no pause reason during
the touch run. All original sample counts and budgets are retained. This does not recover the old
run's pause reason or prove its precise trigger; it establishes an uncontended pass beside the
measured overloaded-host failure. GPU 9332 completes with **39 passes, one failure**, plus the two
existing skips. Its single infrastructure retry is job **19724**, attempt **2**, requested at
**09:30:07 UTC**; no other manual eris graphics test runs alongside it.

### Public image and trailer receipt at 23d2027e

Main 9331/image job **19696** passes the exact-source typecheck/build, two-base image smoke and
registry publication. Image digest:
`sha256:5ae9986e277b823da2a0cc5d2e3ed4401596f0c4cce760b11bbfc7d76eedffec`.
Publisher **9337**, job **19702**, succeeds; commit status `preview/smoke/v02-23d2027e` is
**success**: **room 5EY7**, isolated from **12** other previews, WebRTC join (**host, 0 ms**),
input, resume, drive, HUD and round.

Preview: https://jammers-preview.dilger.dev/p/v02-23d2027e/

The public MP4 SHA-256 is exactly the source media's
`14474a45ea9ef8f7fe40668cfd75e64b8a904ed6580e769a54cd63f664f7dd44`.
Inspected all ten public phone/laptop/TV before/after-resize captures and both WebKit poster/
playback captures. Deployed WebKit confirms zero pre-Play media requests, real click-to-play,
native controls, seven caption cues, successful seek to 16 seconds, correct MP4 byte ranges and
no page/media errors. The unchanged live-check reports only the known scrolling viewport-fold
crossings; the TV check is clean. Full receipt and twelve archived captures are in
`docs/evidence/P1-PROMO/self-review.md` and `docs/evidence/P1-PROMO/lazy-public/`.

### Main 9331: preserve Lobby actions during roster updates

Browser 7/job **19695** fails JN3's **End mid-round** case at line 132: the unchanged real Start
click times out after **30 seconds**, after resolving a visible/enabled/stable button and scrolling
it into view. The Lobby renderer keys on Ready, presence and whole seconds of unplugged time;
each change replaces its entire `innerHTML`, including Start, mode controls and QR.

A deterministic real-pointer regression against the published `23d2027e` bundle presses Start,
applies a Ready/unplugged update, then releases. It fails in **2,318 ms**: **no Start command**
arrives. The real full journey does not reproduce the CI timeout on the Mac (**148,512 ms**),
but its Playwright trace records a successful Start click taking **7,339 ms** on SwiftShader.
The deterministic lost-click defect is therefore proved separately from the precise timing of
the old CI timeout; no claim is made that its full browser trace was recovered.

Keep the Lobby shell, Start/mode buttons, roster container and QR mounted. Patch labels, counts,
mode selection, disabled state, hints and kept-track text; update roster contents with the existing
uncapped layout. Bind actions once. Start's label has its own span so mode changes preserve the
button's brush SVG. The live journey and its 30-second click deadline are unchanged.

- Five focused Chromium checks pass in **66,035 ms**, including the new real down/update/up
  regression (**3,537 ms**), the existing phone/1080p/ultrawide cohorts **1/2/8/32/99**, and Ready
  labels. The regression also checks empty-lobby disabling, newly arriving cards, Derby labels/
  hints, preserved brush and single command delivery after repeated updates.
- The full real **End mid-round → empty Lobby → ready again → Start → finish with results**
  journey passes on Mac SwiftShader in **155,880 ms** (**156,668 ms** including setup).
- WebKit at 375x667 independently passes the actual down/update/up interaction, empty Derby
  state, re-enabled three-player Derby, label and brush checks.
- All ten local phone/laptop/TV before/after-resize captures and three WebKit state captures
  were inspected; live-check is clean at all five viewports. Receipt:
  `docs/evidence/P1-R07/self-review.md`, with captures/logs in `ci-lobby/local/`.
- Whole-web typecheck still reports only the unrelated dirty `map.ts` lines 377–387. The exact
  committed-source CI build remains required; those WIP files are neither edited nor committed.

GPU9332's single retry has passed FL17 with original budgets: **302** samples, main-to-worker
p99 **0.2 ms**, worker-to-tick **8.7 ms**, tick-to-drawn **35.9 ms**, render lag **3 ticks**.
The rest of that batch and the new Lobby fix's containing main/GPU runs remain required.

### Deployed Lobby repair at d9a795cc

Main **9345**, browser 2/job **19758**, passes the unchanged real **End mid-round → empty
Lobby → ready → Start → finish/results** journey in **149.1 seconds**. The exact-source cached
web build and independent image typecheck/build pass. This verifies the repaired interaction in
Linux CI; the entire containing main and GPU batches still need their final verdicts.

GPU **9346** passes the previously intermittent settings Identify case in **4,686 ms** and FL17
in **14,630 ms**, retaining all original budgets: **302 samples**, main-to-worker p99 **0.8 ms**,
worker-to-tick **8.9 ms**, tick-to-drawn **42.6 ms**, render lag **3.3 ticks**. FL02 retains the
original four-phone assertions: **0.03 m** pre-GO travel per car, fastest forward speed
**0.01 m/s**, and the expected Early/Perfect/Launch outcomes. No Identify patch or deadline
change was introduced for the previous one-off failure.

Image job **19764** publishes digest
`sha256:f29af1f7d875c533b81a0fe1b3f7eb9a4a98da008ddfc76011c72e96c71b5269`.
Publisher **9349**, job **19768**, succeeds. At **2026-10-25T10:04:53Z**, its smoke reports
**PASS**: room **RCQ2**, isolated from **13** other previews, WebRTC join (**host, 3 ms**),
input, resume, drive, HUD and round.

Preview: https://jammers-preview.dilger.dev/p/v02-d9a795cc/

Deployed visual review passes the unchanged live-check matrix at five phone/laptop/TV sizes,
before/after fullscreen and resize. All **13** Chromium/WebKit PNGs were personally inspected
before archiving as JPEGs. WebKit independently verifies a real press across a Ready/unplugged
update sends exactly one Start command, empty Derby disables Start, and three arriving players
re-enable it with the correct hint and intact brush. No new clipping, overlap or blank content
observed. Receipt: `docs/evidence/P1-R07/self-review.md`, captures and logs in `ci-lobby/public/`.
These are Playwright browser receipts, not physical-device or Safari claims.

### GPU 9346: synchronize the frame under test and resolve the active Leave action

The completed batch has **38 passes, two failures** (plus the two existing, explicitly labelled
skips). Generated-loop loses all four tiles at five observations starting at tick **318**. JN5
exceeds the unchanged **3,000 ms** drop-in target: **3,885 / 557 / 220 / 240 / 777 ms**. Neither
failure is reported as a pass and the batch is not retried unchanged.

The camera helper stepped the worker, read its car pose, then tried painting at most three times
with ten-millisecond gaps. It could still project that pose through an older camera. A controlled
Linux GPU reproduction delays only render-snapshot delivery by **80 ms**: the old helper compares
the tick-**6** car with a tick-**0** frame, reports all **four** tiles lost, and fails the original
frustum assertion. The updated helper waits for `render.stats().tick >= observed.tick`, then
projects the same body and 1.2 m marker through the actual cameras. No ride steps, sampling
cadence, cohort, viewport, frustum limits or gameplay timing acceptance change.

- Delayed-snapshot reproduction: old helper fails; fixed helper passes **210 observations** at
  **1/4/9 tiles**, zero lost, **44,876 ms** test time. Receipts: `frame-sync-before.txt` and
  `frame-sync-after.txt` beside this file.
- Full normal generated-loop file with the fixed helper: **both tests pass**, including
  upside-down ride/native parity and all **210** camera observations; **38,945 ms** total.
- Isolated Linux GPU JN5 at exact runtime commit `d9a795cc0905d06d3b547503c3e0fd8fc894d381`
  keeps all original interactions/bounds and records **249/236/354/277/236 ms**, no pause during
  the timed arrivals. It later fails leaving the Lobby, so it is not a full-journey pass.
- A separate Mac run against the deployed image reproduces a Leave selector race: `count()`
  chooses the play-screen button before the car sheet opens; the sheet then intercepts its click.
  Resolve the sheet's Leave or the uncovered play-screen Leave at click time with one locator.
  Keep native first click, confirmation tap and the real host seat-removal assertion. The corrected
  Linux GPU journey completes **all phases, 12 → 2, Leave, Sit out and preserved standings** in
  **43,871 ms** (**49,654 ms** total), drop-ins **275/200/292/313/321 ms**, target unchanged.
  Receipt: `jn5-fixed.txt`. One renderer-unavailable pause occurs earlier, outside the timed
  arrivals; the original CI spike's pause reason is not recovered or attributed to this fix.
- The first Mac selector-candidate diagnostic reaches the final two-player state but its own
  sampler starts before the test API exists and causes page errors; it is not counted as a full
  pass. After guarding the sampler, another public run times out finding its third newcomer
  (host SSE reconnect count **8**); that WAN probe is not a Linux loopback qualification receipt.

Manual eris browser runs start only after GPU9346 has completed. The two reproduced harness
fixes are validated directly before publication; no speculative runtime, cooldown, pause or latency
patch is introduced. The exact isolated p95 passes do not explain the earlier 3,885 ms sample.

The same helper's other caller is verified too: the full generated-jump file passes **all three
tests** (Chromium, WebKit, and all **126** 1/4/9-tile camera observations) in **35,605 ms** on
eris at explicitly printed runtime SHA `d9a795cc0905d06d3b547503c3e0fd8fc894d381`. The normal
loop and jump outputs are appended to `frame-sync-after.txt`. These executions receive only the
candidate helper/test harness through stdin; eris's code checkout is unmodified. `ERIS_MIN` is
used after another session commits `d8ee872a` on the shared Mac tree; the remote SHA, rather
than eris.sh's Mac-HEAD note, identifies the runtime that actually ran.

### Main 9345 / GPU 9357: preparation cost and transient observation states

Main 9345's preparation test failed its unchanged half-intermission bound at **11,402 ms**
under the page's 6x CPU throttle. Its exact `87aa2bf8ec4409355f3a99d6` compiled web archive was
downloaded from the CI store. A Mac Chromium CPU profile of that artifact identifies repeated
normal calculation/normalisation in `Soup.mesh` among its largest staging costs. The soup has
unshared corners: calculate and normalise once per triangle, then copy to its three corners.
The Float32 rounding before normalisation is retained, as are all override normals. No map
geometry, detail, gameplay budget or timing requirement changes.

- The original complete map-soup SHA-256 golden passes unchanged for **all position, colour and
  normal bytes**. A differential test also matches three.js exactly for zero-area triangles and
  scales **0, 1e-10, 1, 1e10** (two tests pass).
- Exact compiled harness, Mac arm64 Chromium, page throttle **6x**, seeds **4/5/6/7**:
  original **1284/1146/2756/2022 ms**; candidate **1096/795/2170/1252 ms**, with the same maps.
  The candidate scratch artifact substitutes only the tested normal calculation in the CI
  chunk; unrelated dirty local procgen/map sources are excluded. These are Mac measurements,
  not a Linux or physical-phone qualification.
- All **nine** preparation checks on that candidate artifact pass in **25,497 ms**, including
  stale jobs, rerolls, failure/retry, validation and two complete rounds. Its final throttle
  samples are **844/703/1966/1121 ms**; intermission remains **20,000 ms**. Receipts:
  `prepare-normals.txt` and `prepare-normals.json`.

The G07 failures in main 9345 are browser input/scroll IPC timeouts: even the existing force-click
of Pause stalls at “scrolling into view”; the phone-host case stalls after scrolling for **120 s**.
The removal/debris assertions were not reached. This functional journey now stops only the
continuous draw loop and explicitly paints each inspected tile/capture state. The simulation
keeps running, with the same real clicks, seat cohorts, full resolutions, tick-based handback,
debris persistence and screenshots. The exact d9 runtime plus candidate test harness passes
**all four** tests in **40,147 ms** on Mac software Chromium, with each inspected frame also
synchronized to the observed simulation tick. All **five** captured states were
inspected (three correctly reflowed race tiles, confirmations, Lobby and the eight-seat phone
menu); no UI/runtime change or assertion/timeout relaxation. Receipt: `g07-explicit-paint.txt`.

GPU 9357's C12 failure snapshot has exactly the intended **five** `inputDropped` seats
(**1/7/15/23/24**), all four peers/channels connected, and **19** connected sources with fresh
input aged **41–91 ms**. Those 19 still have raw autopilot state during the intentional **30-tick**
control handback: their brake is about **1/6** and autopilot controls about **5/6**. The old
polling predicate waits for takeover of the five unplugged seats but immediately asserts that
every other blend has already finished.

A focused real-source reproduction on the exact d9 runtime claims **24 local emulated pads**,
unplugs five, then stalls the host main thread **2250 ms**. At tick **453** all **19** connected
sources have `inputDropped:false` while raw autopilot state is still present; at tick **535**
only the five unplugged seats autopilot. The predicate now waits for that complete isolated
state within its **unchanged 90 s** deadline. Every connected source must return to player
control; none is exempted. Receipt: `c12-handback.txt`. This local-source proof supplements the
full real-WebRTC cohort; it does not replace it.

An additional Mac public-preview C12 run establishes all 24 distinct seats and four connections
but fails the first drive-signature phase, before unplug/handback. Its diagnostic proves another
test race: controller pad3 is recorded with **null seat/source** after the host has counted its
new seat, before the endpoint receives the claim acknowledgement. The other 23 sources and all
24 actual car inputs match the first signature; the recorded null source can never match it.
Both network pad and keyboard setup now wait for their own acknowledged integer seat/source.
No participant, source, signature or applied-age check is removed.

With that acknowledgement wait, the **complete** public-preview journey passes **35,084 ms**
on Mac native Chromium: host, two joined laptops, two phones, **24 distinct sources**, all five
drive signatures, measured payload/applied ages, five isolated unplugs, same-car handbacks,
Leave, Remove and the leave chord. This run also injects the **2250 ms** main-thread stall
immediately after the five unplugs. Runtime is the published **v02-d9a795cc**; only the test
harness is the candidate. Receipt: `c12-public-fixed.txt`. The unchanged full Linux C12 cohort
also passes GPU 9367 in **32,724 ms**, which is not claimed as validation of the candidate fix.

GPU 9357 also misses the first WebKit Ready click in R13 (first phone **5** commands, second
**6**, both connections/channels healthy). A traced run of the complete public WebKit identity
journey passes **13,221 ms**; the missed native event remains unreproduced, so there is no
speculative patch, retry of an unchanged batch, or quarantine. Containing main/GPU receipts
are still required before closing this repair.
