# Test evidence destination verification

2026-10-11, CyanBridge. Mac Apple M1 Pro, 16 GiB, macOS 27.0.1; Node 26.10.0; local Playwright engines.

The shared tree already contained modified receipts/images and untracked captures when this check began. Those files were preserved. The baseline recorded SHA-256 for **2,604 existing evidence files** before running `web/tests` and `web/host/tests`.

The complete local run finished: **346 tests, 327 passed, 13 failed, 1 cancelled, 5 skipped** (about 99 minutes). It is not a green test receipt. Missing Android SDK tests were skipped; no simulator run is claimed. The failed tests were retained for repair rather than weakening their assertions.

Comparing the evidence bytes against the baseline after the full run and subsequent focused reruns found **2,603 unchanged files**. The one difference, `docs/evidence/br-2mxa/self-review.md`, was an intentional manual review edit committed in `7cc006d9`; its current bytes match that commit and HEAD. No test writes that Markdown file. The pre-existing dirty receipts and captures were preserved, not replaced with test-run numbers.

Tests now default to OS scratch. `evidencePath()` honors explicit `JJ_EVIDENCE_DIR` / `JJ_EVIDENCE`; capture suites use explicit `JJ_CAPTURE_DIR`. Evidence-writing tests document their opt-in destination. The original full-run failures include stale WASM parity, lap/tuning harness assumptions, churn, dropout, join-card and smoke checks; focused repairs and reruns are recorded separately, not relabelled as a passing full run.

The acceptance phrase “leaves git status clean under docs/evidence/” is **not literally satisfied** while preserved pre-existing modifications remain. The byte comparison proves that the full run did not rewrite them. This bead remains open pending resolution of that pre-existing state and green CI; this receipt does not authorize discarding or committing degraded receipts.

Fresh JN5 repair run: `node --test web/tests/journeys/jn5-churn.test.mjs`, default SwiftShader,
**1/1 passed in 498 seconds** on this Mac. The two sampled Ready keys are held until acknowledged.
The worker is held before finishing the race, preventing a queued Intermission view from freezing
the next round instead. Results → Lobby uses a real pointer click after asserting visibility,
without waiting for stable animation frames; the actual Lobby transition remains asserted.
The original 12-player growth, own-input drive, Leave/Sit out, standings and final two-player
assertions are preserved. Drop-in p95 was 13,255 ms on software WebGL; this is not GPU timing
qualification. Log: `/tmp/jj-jn5-standalone-forced-pointer.log`.


Fresh standalone R07b join-card run on the same Mac/Chromium/SwiftShader:
**2/2 pass**, 320 seconds total. The docked footer QR pauses the live race; a
real phone joins from its decoded screen QR; Resume and pause-menu QR are
verified. The original TV/desk/handheld/auto sizes and full-screen matrix
fit and decode without changing the assertions. Log `/tmp/jj-r07b-standalone.log`.
This focused passing rerun does not relabel the earlier full run as green.

Fresh complete public smoke against the patched release host WASM and actual
local server/controllers: **4/4 passed, 119.94 seconds**, unchanged assertions.
Log: `/tmp/jj-smoke-standalone-dominance.log`. This is a focused passing rerun;
the earlier 346-test run and preserved dirty-evidence constraint remain as stated.
