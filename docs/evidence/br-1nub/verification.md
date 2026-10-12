# P1-C05 host journey repair — br-1nub

2026-10-11; macOS arm64, Playwright Chromium, real host/testing worker and
emulated standard pads plus keyboard events. Browser emulation, not hardware.
Web build includes the working P1-C12 cluster data and uses the real WASM sim.

The original affected-path check failed both journeys: Keys A turned 36.71° with
zero steer, and the new seat never appeared after a fixed 200 ms neutral window.
An unchanged motion setup reproduced the first failure again in 16.63 s total.
`before.json` records the actual start/end positions, headings and applied inputs.
Keys A had throttle 1/steer 0 but changed from 90° to 61.85°, beside the turning
pad (centres at [107.43, 6.49] and [109.52, 5.33] in the road plane). The motion
probe mixed routing with physical car contact. Joining sources one at a time
while the earlier ones kept driving also changed the start pose before measurement.

The repair neutralises each source after claiming, then uses journalled placement
on four separate stretches of the real straight. All four then use their original
inputs. The original 300-tick motion period, speed/heading envelopes and isolated
unplug assertions remain. `after.json` captures the measured physical result:

- Pad 1: 12.05 m/s, 0° turn.
- Pad 2: 6.47 m/s, 66.54° turn.
- Keys A: 12.09 m/s, 0° turn.
- Keys B: −2.17 m/s, 20.80° turn.

The leave journey now waits until the real local sampler reports Identify released
after both chord buttons are released. Only then is the new press made. A fixed
200 ms timer could fit wholly between samples on a software-rendered host. The
original five-second seat deadline and all Identify, hold-chord, held-seat, new-seat,
sit-out/return assertions remain. The expected idle drawer rows follow cluster data.

`JJ_C05_DIAGNOSTICS=1 node --test web/host/tests/input.test.mjs`: **2/2 pass**,
60.30 s total (motion/unplug 33.39 s; Identify/leave/rejoin/sit-out 25.98 s).
No retries or increased deadlines. CI qualification is required before closure.
