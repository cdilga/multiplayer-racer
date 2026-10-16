# br-xlvx.6 (Loops): self-review

The test map's loop (`maps/test/loop.json`: radius 8 m, entry 64, exit 79, 18 m sideways shift) is shown in the real host. A
Cruz enters 25 m before the loop at 22 m/s at full throttle, under `web/tests/journeys/loop-ride.test.mjs`. The run used a
local build (the host wasm from the shared tree, local jj-server) with Playwright Chromium and Playwright WebKit on the Mac,
2026-10-17. For each engine, the journey asserted:
- the uploaded loop triangles hash as the native collision mesh (`45d155fdea1c1d0c`);
- the car is upside down at the top (tick 230, 15.6 m up, upY −0.94);
- it is back on the road upright by tick 360;
- the full WASM state hash equals native's (`933949fe…`).

## Looked at

- `chromium-top-side-1920x1080.jpg`, `chromium-top-side-1366x768.jpg`, `webkit-top-side-1920x1080.jpg` and
  `webkit-top-side-1366x768.jpg`: a camera in the car's frame, on its side, at the top. The car hangs upside down under the
  deck inside the loop, and its livery and wheels read.
- `chromium-top-chase-1920x1080.jpg`, `chromium-top-chase-1366x768.jpg`, `webkit-top-chase-1920x1080.jpg` and
  `webkit-top-chase-1366x768.jpg`: the player's own chase camera at the same tick, which is now the loop shot. The whole loop
  is framed, with the car upside down at the top, and there is no off-screen arrow.
- `chromium-out-chase-1366x768.jpg` and `webkit-out-chase-1366x768.jpg`: after the exit, the chase is back behind the car on
  the road.

## Defects found and fixed

- **The chase camera lost the car.** A chase camera behind the car ended up outside the deck at the top. It looked at the
  deck's back with the car hidden, and its heading swung through 180° as the car turned over.
  - The rig now cuts to a loop shot while a car is up on a loop (`camera/rig.ts` `loopShot`, data in `camera.json` `loop`),
    and cuts back at the exit. `__jjRender.cameras()[seat].loop` shows the shot.
  - A side-on loop shot also hid the car: the barrier walls hang down at the top exactly as far as the car does. The angle
    (40° round from side-on, 0.4 of the way up) was picked by raycasting the loop mesh from a ring of camera positions.
- **The off-screen arrow pointed at a visible car.** The arrow projected the car through the camera's matrices from the
  last frame, so on any cut (a respawn, or the loop shot) it showed an arrow for one frame. It now updates the camera's
  matrices first (`render/world.ts`).
- **The drawn loop could differ from the collider.**
  - Chromium's and WebKit's `Math.sin` differ from Rust's libm in the last bit for some angles. After the Frenet frame's
    differences, that moved deck vertices by up to 1.5e-10 m. Usually that changes nothing in f32, but here it flipped two
    f32 values, and the drawn loop stopped hashing as the collision mesh.
  - jj-map and loop.ts now share a `sin_cos` series with only + − × ÷, and sqrt in place of hypot. Node, Chromium, WebKit
    and native now agree bit for bit (a scratch comparison found 0 differing f64s of 1,764). A jj-map test holds the series
    within 1e-15 of libm.
- **The deck lay exactly on the ground at its ends.** The deck's surface now sits the road ribbon's 5 cm off its centre line
  (`DECK_LIFT_M`), so it can't z-fight the ground.

## Remaining defects

- The loop's shadow on the ground has stair-stepped edges near the entry (visible in the chase captures, lower left of the
  deck). This is the shadow map's resolution over a large object, which is renderer-wide (the car's shadow shows the same
  texels), not loop geometry.
- The loop shot is a cut, not a blend. A cut reads as a TV camera change, but a playtest may want a short blend.

## Not covered

- Generated maps: placing loops in the terrain-first procgen is br-xlvx.6.4, so there's no grid of tiles or TV overview with
  a loop yet.
- Several tiles at once: each seat's camera takes the loop shot on its own, but no capture here shows 4 or more tiles.
- Phone controllers: the controller shows no world, so a loop changes nothing there.
- Real devices: these are Playwright Chromium and WebKit on a Mac, not a TV or Safari.
