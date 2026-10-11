# P1-G04 late-join isolation repair

2026-10-11, CyanBridge. This is CI/journey repair evidence, not device qualification.

CI 3309 failed the existing-driver speed assertion; added diagnostics in 4ede85be captured
its recurrence on CI 3319, browser slot 3 (truenas-ci Linux x64 container,
image jj-ci:6df24842ee3e, Chromium/SwiftShader). `ci3319-crash.json` retains the complete
before/after existing car state and exact build/run. Before: x=174.33 m, heading 90°,
25.54 m/s, throttle 1. After one observed second: x=184.70 m at the greybox bend's
barrier, 0.002 m/s forward, front detached, throttle still 1 and no autopilot. The
fixture drives straight into scenery while a slower join/readback takes place;
this is not evidence that the newcomer reset its input or stole its seat.

The journey now stages that already-moving car on a clear straight and holds the
worker's clock during the real QR/code/ICE join, pumping ticks for actual commands.
It then steps exactly 120 ticks in small batches while real phones continue sending
fresh frames. A single synchronous jump was rejected during development because it
correctly aged out the last input packet before another browser frame arrived.

Original QR decode, typed-code join, independent driving, key cluster, camera,
Recover, four tiles and same-seat/same-endpoint/same-car reload checks remain.
The late-join check retains speed >4 m/s and additionally asserts the existing car
identity, full throttle from its real controller and unchanged part health/states.
No product physics, freshness timeout or assertion threshold changed.

Final Mac Apple M1 Pro, 16 GiB, macOS 27.0.1, Node 26.10.0,
Playwright Chromium/SwiftShader, real local jj-server and WebRTC:

- Normal standalone journey: **1/1 pass, 17.39 seconds**.
  `/tmp/jj-jn1-fixed-straight.log`.
- Host CDP CPU throttle 4: **1/1 pass, 18.99 seconds**.
  `/tmp/jj-jn1-fixed-straight-throttled.log`.

Before these final runs, the first staging attempt used an invalid pose field and
failed before the late-join assertion; the next one exposed the stale-input jump
above. Neither is passing evidence. Green CI containing this repair is required
before closing br-udkg.

CI 3331 exposed a separate Recover fixture failure before the late join: `A never
stopped` at line 190. Down brakes and then becomes reverse near rest; a wall-clock
poll can skip the brief stopped interval. Recover now samples three-tick intervals
with the worker held while the real phone continues sending, then releases the
stick and acknowledges neutral input before returning to the live clock. The
original speed threshold and real Recover action remain. This diagnosis follows
the pinned vehicle rule and the failed CI stage; that run did not capture the
car's braking trajectory, so missed sampling is an inference, not a measured trace.

Final repaired journey, same Mac/Chromium/SwiftShader and native server, host CDP
CPU throttle 4: **1/1 passed, 28.84 seconds**. Log:
`/tmp/jj-jn1-recover-fixed-throttled.log`. Green CI is still required before closing.
