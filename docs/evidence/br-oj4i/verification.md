# Test evidence destination verification

2026-10-11, CyanBridge. Mac Apple M1 Pro, 16 GiB, macOS 27.0.1; Node 26.10.0; local Playwright engines.

The shared tree already contained modified receipts/images and untracked captures when this check began. Those files were preserved. The baseline recorded SHA-256 for **2,604 existing evidence files** before running `web/tests` and `web/host/tests`.

The complete local run finished: **346 tests, 327 passed, 13 failed, 5 skipped** (about 99 minutes). It is not a green test receipt. Missing Android SDK tests were skipped; no simulator run is claimed. The failed tests were retained for repair rather than weakening their assertions.

Comparing the evidence bytes against the baseline after the full run and subsequent focused reruns found **2,603 unchanged files**. The one difference, `docs/evidence/br-2mxa/self-review.md`, was an intentional manual review edit committed in `7cc006d9`; its current bytes match that commit and HEAD. No test writes that Markdown file. The pre-existing dirty receipts and captures were preserved, not replaced with test-run numbers.

Tests now default to OS scratch. `evidencePath()` honors explicit `JJ_EVIDENCE_DIR` / `JJ_EVIDENCE`; capture suites use explicit `JJ_CAPTURE_DIR`. Evidence-writing tests document their opt-in destination. The original full-run failures include stale WASM parity, lap/tuning harness assumptions, churn, dropout, join-card and smoke checks; focused repairs and reruns are recorded separately, not relabelled as a passing full run.

The acceptance phrase “leaves git status clean under docs/evidence/” is **not literally satisfied** while preserved pre-existing modifications remain. The byte comparison proves that the full run did not rewrite them. This bead remains open pending resolution of that pre-existing state and green CI; this receipt does not authorize discarding or committing degraded receipts.
