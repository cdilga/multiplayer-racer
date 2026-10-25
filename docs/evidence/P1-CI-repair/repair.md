# CI batch 8912 repair — br-dsq4

Owner: CalmLynx. Source run: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/8912

## Causes and changes

- Rust advisories: update only ctutils 0.4.3 → 0.4.4 (RUSTSEC-2026-0385), rustls-webpki 0.103.15 → 0.103.16 (0382), and webpki-roots 1.0.9 → 1.0.10 (0381). `rch exec -- cargo deny --locked check advisories` passes.
- Preparation asserted over 30 seconds remained in an intermission whose configured results + vote window is now 20 seconds. Reproduced on Mac: 18,316 ms remained. Check half of the room's actual configured interval instead. The throttled-page test uses that interval too; report the worker's extrapolated 6× time as an estimate, and assert actual worker/page deadlines. CDP does not throttle that worker; multiplying its wall time also multiplies scheduler contention and is not phone hardware evidence.
- The camera test assumed tick 203 was rendered. Reproduced `cuts: 0`: asset loading can pass that tick before camera initialization. Observe a new cut after two actual rendered frames; retain the maximum camera-to-car gap assertion. Focused browser test passes.
- Practice: the log shows its first test **passed** in 784,619 ms on software GL; the file watchdog killed the second at 900 seconds total. Both practice checks move to the existing GPU lane. That lane now builds/provides `jj` as well as `jj-server`, preserving the native full-state replay check.
- Credits opens the input drawer, which fetches a missing optional helper manifest in development bundles. Ship `{ "files": [] }` as the default; the image build still replaces it with its actual helper artifacts.
- Keep-track and JN3 results interactions raced the automatic results/vote/flyover deadline. Keep the existing controlled clock held during those interactions, then process the UI command and resume it. Player-facing deadlines are unchanged.
- R09's automatic next-round budget omitted the new six-second flyover. Include `room.between.flyoverMs` in the simulated deadline.
- R11 asserted a 300 ms animation duration, functional grid restoration, and a redundant 3-second wall time including software-GL scheduling/RPC. Preserve animation/functional assertions everywhere and end-to-end wall latency on the GPU lane.

## Validation

Local browser checks use Playwright Chromium on macOS arm64. Preparation harness and the camera reproduction use software rendering; gameplay journeys also exercise Chromium's native Metal GPU. Initial packages from eris's clone were stale (missing `controller_practice`); those setup failures are not product evidence. Current packages come from CI 9116's successful build, key `558383a5bee175f29bc9a49d`. Only its ignored WASM package directories were extracted; Linux node_modules were not installed on the Mac. Its matching native `jj` replay binary runs on eris against the saved clip (outputs only). The native server is built per crate on the Mac.

Completed focused checks: all nine preparation cases, camera respawn cut, Keep Track round journey, Credits host-menu journey, R11 spread-out field switch, seven shared-workflow regressions, and the GPU selection dry run for C10. `git diff --check` passes.

C10's five-car/practice/native-replay test passes in 96,377 ms on the Mac GPU (versus 784,619 ms on CI's software renderer). The three real-phone journeys could not reach the join card locally: ICE remains `checking`, channels remain `connecting`, and unavailable relay fallback returns 503. They fail before the changed assertions; they need the Linux CI/GPU environment's real WebRTC path for final validation. The R09/JN3 changes are direct corrections to the round policy documented above, not speculative gameplay patches. Do not treat these setup failures as successful journey evidence.

Preview `v02-72c51850` (built run 9116) was published at 2026-10-25T02:01:38Z. Its commit status `preview/smoke/v02-72c51850` is success: room, join-webrtc, input, resume, drive, hud, round. URL: https://jammers-preview.dilger.dev/p/v02-72c51850/

Focused results and containing CI/preview receipts are recorded below when available. No tests are quarantined and no gameplay rules are relaxed.
