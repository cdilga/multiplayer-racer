# P1-C14 · Drawer Leave projection

2026-10-11, CyanBridge. CI3354, browser6, c14-controls AC1:

```text
AssertionError: 'playing' !== 'left'
c14-controls.test.mjs:102
```

The journey had already observed zero live seats after Leave. The local input
drawer renders independently every 500 ms, so its old `playing` projection could
still be on screen at that instant. The original assertion crossed those two
clocks without waiting for the visible result.

The journey now waits for that row's actual `data-state=left` within its existing
30 s wait, then retains the equality check and subsequent Add/new-seat and
keyboard-off/on checks. No deadline, retry or product behavior changed.

Local candidate (Mac M1 Pro, macOS 27.0.1, Node 26.10.0, Playwright Chromium,
real jj-server/WebRTC): **6 behavioral checks pass**, 36.62 s; two optional visual
capture rows skipped because no capture destination was requested.
`/tmp/jj-c12-and-c14-controls.log`. This candidate also carries P1-C12's additional
numpad data; the controls-page test reads the cluster data rather than assuming
there are exactly two layouts.

Green CI containing this repair is required before closing.
