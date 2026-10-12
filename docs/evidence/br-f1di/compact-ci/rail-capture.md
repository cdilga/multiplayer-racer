# Rail capture timeout repair

CI3673 Chromium exceeded the journey's 180-second timeout. The paint helper drew the same held collision snapshot 80 times for each capture, although its preceding tick wait had already drawn that snapshot. The helper now stops the loop, waits two animation frames for resize/layout, and draws once. No physics assertion, viewport, collision, return, health, renderer displacement or parity check was removed.

2026-10-12 Mac local `node --test web/tests/journeys/compliant-rails.test.mjs`: 4/4 green, 21.25 s. This run preceded the native-mode correction and used Chromium SwiftShader; WebKit used its platform GPU. It proves the behavior and shorter capture work, not hardware performance. Containing CI remains required.
