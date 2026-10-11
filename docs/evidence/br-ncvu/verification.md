# P1-G03 / br-ncvu — start the idle journey from actual manual control

CI 3369 (`e6a68021`, browser 6) failed JN3's idle cue. `ci-failure.json` records
fresh input, a closed menu, `inputDropped: true`, `idleCued: false`, and 39,634 ms
without deliberate input. The original journey also failed locally in 69.28 s;
`local-failure.json` records the same already-dropped state (48,592 ms idle).

Startup rendering or tutorial input can trigger dropout before the idle scenario.
A car already handed to autopilot does not earn another idle warning until the
player deliberately takes it back. The journey now applies input from both real
joined controllers and waits for fresh/manual cars, then releases both sticks and
waits for the applied neutral input. This uses the real handback path. The existing
idle cue, takeover, five Identify checks, natural one-lap finish, results and next
round assertions and their deadlines remain in place. There is no retry or finish
command.

Validation on macOS/arm64, Playwright Chromium, software WebGL/SwiftShader,
two mobile browser contexts and loopback WebRTC, working tree based on `333c5b24`:

```sh
PATH=/Users/cdilga/.nvm/versions/node/v26.10.0/bin:$PATH \
JJ_SERVER_BIN=/tmp/jj-macos-server-w01 \
node --test web/tests/journeys/jn3-round-loop.test.mjs
```

1/1 passed, 140.90 s total. Identify press-to-pulse: 1198, 1101, 1229, 1481,
1339 ms; these are software-renderer timing samples, not GPU latency qualification.
Both players finished naturally, the TV and phone results appeared, and round 2
started. Log: `/tmp/jj-jn3-serial.log`. A preceding concurrent cohort run passed
idle/takeover but failed Identify; it is not qualification.
