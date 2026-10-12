# Rendered churn belongs in the GPU lane

CI run3673, browser slot2, failed JN5 while the tenth tile was joining. The host reported 6,521,598 triangles, 454 draws and a 5,049.7 ms frame. Phone signalling stayed open; the host's current negotiation was still installing its local description after 10.7 seconds. This software-rendered run did not qualify player-facing join latency.

JN5 now runs its complete twelve-seat rendered cohort in the existing GPU lane. It skips on software GL, and `scripts/ci/plan.mjs --full` selects it alongside the existing GPU journeys. No cohort, tile or gameplay count was reduced, and the GPU three-second drop-in bound is unchanged.

Local verification: Mac, headless Playwright Chromium using the native GPU (`JJ_CHROMIUM_GPU=native`), real jj-server, ten real phone contexts plus two keyboard clusters, actual host rendering. `node --test web/tests/journeys/jn5-churn.test.mjs`: passes in33.9 seconds. Drop-in samples178/158/202/175/218 ms; p95=218 ms. Lobby, Countdown, Running, results and return to Lobby all complete; the grid grows to twelve and shrinks correctly.

This is a Mac browser run, not the eris Linux GPU lane or physical phone hardware. Containing GPU CI remains required before the owner-flow qualification is complete.
