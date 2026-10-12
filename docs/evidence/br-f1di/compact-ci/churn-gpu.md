# Rendered churn belongs in the GPU lane

CI run3673, browser slot2, failed JN5 while the tenth tile was joining. The host reported 6,521,598 triangles, 454 draws and a 5,049.7 ms frame. Phone signalling stayed open; the host's current negotiation was still installing its local description after 10.7 seconds. This software-rendered run did not qualify player-facing join latency.

JN5 now runs its complete twelve-seat rendered cohort in the existing GPU lane. It skips on software GL, and `scripts/ci/plan.mjs --full` selects it alongside the existing GPU journeys. No cohort, tile or gameplay count was reduced, and the GPU three-second drop-in bound is unchanged.

Correction (2026-10-12): the initial Mac run set `JJ_CHROMIUM_GPU=native`, but an isolated renderer probe found that headless Chromium silently chose SwiftShader without `--enable-gpu`. Its observed 33.9 s pass and p95=218 ms are browser measurements, not native-GPU qualification.

The launch helper now enables the GPU explicitly. JN5 reads the actual renderer from the host's WebGL context and refuses a software renderer for its hardware cohort. The repeated Mac run reports **ANGLE Metal Renderer: Apple M1 Pro**: full twelve-seat journey passes in38.8 s; drop-in samples174/213/171/186/190 ms, p95=213 ms. Ten real phone contexts plus two keyboard clusters use real jj-server and actual rendering. Lobby, Countdown, Running, results and return to Lobby all complete; the grid grows to twelve and shrinks correctly. The three-second target is retained.

This is a Mac browser run, not the eris Linux GPU lane or physical phone hardware. Containing GPU CI remains required before the owner-flow qualification is complete.
