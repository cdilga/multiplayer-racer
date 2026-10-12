# Same-turn layout measurement

CI 3450 (12e09f39, browser job 7791) sampled the caption and drawer in one browser evaluation, then asked for the free-drive QR's box in another browser round trip. The welcome cue expired between those calls: the first box retained the caption at y=686–726, while the later QR had returned to its ordinary bottom=16px position (y=519–752). This pair does not describe one rendered state.

The journey now reads the QR, caption, drawer and complete text in one DOM turn. It preserves the actual cue/lifetime, six live samples per top/bottom scroll position, five viewports, seven source rows, full-text and separation assertions, and expiry checks. No CSS or product lifetime changed.

Validation: `JJ_SERVER_BIN=/tmp/jj-macos-server-w01 node --test --test-name-pattern='welcome caption' web/tests/journeys/c12-many-controllers.test.mjs`: four passes (Chromium/WebKit × free drive/room), 119.525 seconds on macOS/arm64 with the real local Rust server. New full CI is still required; controller resume and JN5 failed separately in CI 3450.
