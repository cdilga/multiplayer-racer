# Engine tuning regression qualification

2026-10-12, Mac, Node 26.10.0, Playwright Chromium/SwiftShader and real jj-server. `node --test web/tests/journeys/pt1-tuning.test.mjs`: all five journeys pass.

The old engine test compared wall-clock samples on a generated course: slopes and the autopilot's next turn changed the comparison, and a loaded CI runner advanced a different number of simulation ticks. Merely waiting for four simulation seconds still reproduced the failure. Even a flat loop introduced turn braking.

The repaired journey keeps the real room, two seated cars and the real tuning panel. The existing R90 Place and Step probes put both trials on the greybox's clear straight at 15 m/s. Fresh controller packets supply full throttle every twelve ticks, so input freshness does not turn a held packet neutral. Each trial lasts exactly 480 ticks (four simulation seconds). The original coast assertion, below 60% of starting speed, remains intact. The added paired Reset trial must accelerate past the starting speed and exceed the coast result by at least 20%.

Measured: force zero applies in 537 ms; mean speed 15.0 → 8.2 m/s. Restoring the engine from the same straight/start reaches 25.8 m/s. The input-profile journey also passes (360 ms to the phone and host), generator refusal/regeneration/replay passes, and the production build still excludes owner tools.

This is deterministic behavioural evidence. Containing CI and deployed visuals remain required by the active owner-feedback bead.
