# P1-C02 launch repair — br-vkdo

2026-10-11; macOS 27.0.1 arm64, Playwright Chromium, SwiftShader, native
jj-server, testing WASM host, real join URL and WebRTC. Gamepad/touch input is
browser emulation, not a physical-device qualification.

CI3359 browser3 failed the original 15-second launch assertion with throttle 1,
steer -1 and wheelie false. The local original journey passed, so CPU-throttled
host runs captured the detector state rather than retrying the CI lane.

At host CPU throttle 8, the pre-fix pull emitted a wheelie action carrying
`preloadMs: 1200`, despite the runner's nominal 500 ms hold. The controller was
preloading immediately before the snap, emitted one action, and left preload
with cooldown 0.99975. The real host never satisfied wheelie within 15 seconds
(`/tmp/jj-c02-preload-diagnostic.log`, 36.94 s including setup/teardown).

Neutral followed immediately by another pull is a dip back into the existing
250 ms release window: it preserves the preceding brake preload. On a busy host,
that preceding brake stage lasts longer and can engage reverse. The sim refuses
a launch while reversing faster than 0.5 m/s. A runner timer alone therefore does
not establish a fresh, physically valid launch.

The repaired journey waits for the controller's actual preload reset, uses the
full-brake detent outside the preload zone until forward speed is within 0.2 m/s
and at least three wheels contact the road, then performs one 500 ms pull and snap.
It asserts the emitted preload is at least 350 and below 900 ms and still requires
the real host's wheelie. No utility command, retry, deadline increase or physics
change was added. The session data surface now exposes preload, cooldown and its
most recent detected action to diagnose future failures.

Validation:

- `JJ_C02_CPU_RATE=8 JJ_C02_DIAGNOSTICS=1 node --test web/tests/journeys/c02-wire.test.mjs`:
  1/1 pass, 12.77 s total; actual preload **503 ms**. Original steer, lean, throttle,
  brake/reverse, launch, simultaneous throttle/lock, drift and neutral checks pass.
- `node --test web/tests/journeys/c02-wire.test.mjs`: 1/1 pass, 6.17 s total.
- `npm --prefix web run typecheck`: pass.

CI qualification remains required before closing this bead.
