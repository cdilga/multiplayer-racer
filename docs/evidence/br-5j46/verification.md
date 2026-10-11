# P1-D07 · Slow-host public-smoke click

2026-10-11, CyanBridge. CI3339 browser slot 4 finished the natural lap, checked both
placings and timed out after 30 s at `Start next round now`. Original CI output:
`/tmp/jj-ci3339-browser4.log`, step `round`. Its old error formatter discarded
Playwright's call log; failures now retain the complete error.

## Reproduction and attribution

Mac Apple M1 Pro, macOS 27.0.1, Node 26.10.0, Playwright Chromium/SwiftShader,
current release host WASM, local jj-server. The diagnostic uses the unchanged
seven-step public smoke, then CDP CPU throttling on the racing host only before
enabling autopilot. Phones, inputs, real WebRTC and the natural lap remain intact.
Throttling at ×12 passes and is not a reproduction; ×80 reproduces the original
30 s locator timeout. These are shared-machine stress samples, not device or
performance qualification.

`original-failure.txt` captures Intermission, both actual results buttons, their
visible CSS and nonzero screen bounds, then a global role selector timing out while
waiting to resolve the action. A narrowly scoped CSS selector also times out:
`/tmp/jj-smoke-scoped-candidate.log`. The evidence supports a stalled harness
operation on an overloaded host, rather than an absent results button. It does
not identify the exact internal Playwright cost.

Replacing that lookup with a real pointer is only half the repair. In
`pointer-trace.txt`, trusted pointerdown, pointerup and click hit the actual
results button during Intermission, and the host shows round 2 Running. A separate
diagnostic still times out in a later injected 30 s wait despite already observing
that successful click/transition (`/tmp/jj-smoke-pointer-diagnostic.log`).

## Final change

Read the actual button from the results screen, require its literal label,
enabled/visible CSS, positive bounds and an unobscured hit-tested centre. Send a
real browser mouse click there. Record its trusted event with the phase and round
at dispatch, so automatic advance cannot substitute for a successful click.
Poll the small room-state surface from the runner instead of injecting another
polling script. Require the trusted click and actual round 2 Countdown/Running
within the original **60 s** deadline; an outer timer also bounds a stalled read.
Then assert the click happened in round 1 Intermission.

Results still require exactly two placings, 1 and 2. Every original smoke step,
real join/input/resume, movement threshold and natural lap remain unchanged.
No synthetic Start command, forced finish, clock hold, retry or timeout increase
was added. The canonical publisher at `infra/previews/scripts/smoke.mjs` uses the
same guards and pointer/poll flow.

## Verification

- ×80 stress, real seven-step flow, guarded pointer and runner polling: **PASS**,
  all seven steps (`pointer-and-poll.txt`). This run precedes the outer hard-deadline
  timer addition; the ordinary final flow and CI also check that final version.
- Ordinary public smoke plus manifest/negative-path checks: **4/4 pass**, 116.19 s,
  `/tmp/jj-smoke-pointer-and-poll-normal.log`.
- Final version including the outer 60 s timer: **4/4 pass**, 114.52 s,
  `/tmp/jj-smoke-pointer-final-normal.log`.
- Canonical publisher manifest failures: **3/3 pass**, `python3 -m unittest discover
  -s infra/previews/tests -p test_smoke_manifest.py -q`.
- Both MJS files pass `node --check`.

Green CI containing this repair is required before closing. Product UI and
simulation code were not changed by this harness repair.
