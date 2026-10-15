# br-bwju.7 self-review: roster plumbing

Captured by `web/tests/journeys/v-roster-mixed.test.mjs` (headless Chromium, software GL, loopback WebRTC). Every image was opened and looked at.

## Looked at

Local build (2026-10-11):

- `phone-picker-cruz-844x390.png`, `phone-picker-ute-844x390.png`: the picker offers both roster vehicles (two thumbnails, arrows, stats, blurb, Done). The Cruz has its hero render. The Ute is a blue "ute" silhouette: there is no hero render for it yet (gap; the roster row has no `art`).
- `tv-mixed-two-cars-1280x720.png`: two seats in free drive, Cruz (red) and Ute (blue) side by side in their own tiles. Each is its own model (tray, bull bar, roof stripes on the ute). The existing key-help panel and QR card overlap nothing new.
- `tv-mixed-grid-12-1920x1080.png`: 12 synthetic cars alternating the two vehicles; the ute and the Cruz are told apart at distance.
- `tv-tuning-ute-1280x720.png`: the tuning panel with the vehicle selector set to `tradie-ute`.

## Defects found and fixed

Local round: none in the roster frames (the picker, tiles and grid draw each vehicle). Deployed round: the
owner-lobby-settings journey seeded the remembered car under `jj.car.test`, but the key is per realm (`jj.car.<realm>`,
`preview` on a deployed build), so on the preview it failed with "Cruz Missile" preselected instead of the Ute. The journey now
reads the realm from `version` and seeds that key; the product was right.

## Remaining defects

Honest gaps: the Ute hero art is a silhouette; ute engine sound is data only (nobody listened); native `cargo clippy` for jj-wasm-host and jj-fixture is blocked by another helper's `jj-procgen/src/tuning/mod.rs:138` (useless format!); `jj-sim/tests/damage.rs` fails in the shared tree but passes at HEAD, which looks like the concurrent surface work (not isolated).

Owner feedback 2026-10-12: implementation and 74 inspected local Chromium/WebKit images are recorded at `../br-f1di/self-review.md` and `../br-f1di/receipt.md`. Deployed verification remains pending.
- The Ute's picker art is a silhouette (no hero render yet); the Car chooser rework is br-bwju.9.
- Seen on the deployed build, host-lobby layout outside this bead, filed as br-zhuw: at 915x412 the Keys legend runs under
  the footer bar; WebKit's welcome toast covers the Start race hint and pad box while it shows.

### Deployed recapture, 2026-10-16 (WhiteStream)

Preview `https://jammers-preview.dilger.dev/p/v02-a1f7bf4b/`: `v-roster-mixed.test.mjs` on eris (Chromium, software GL) 2/2
pass; `owner-lobby-settings.test.mjs` from the Mac (Playwright Chromium and WebKit) 2/2 pass with the realm fix. Opened in
six contact sheets:

- `deployed-frames/tv-mixed-two-cars-1280x720.jpg`, `deployed-frames/tv-mixed-grid-12-1920x1080.jpg`, `deployed-frames/tv-tuning-ute-1280x720.jpg`: a race with a red Cruz and a blue Ute, each its own model (tray, bar, stripes); a 12-car mixed grid; the owner tuning panel scoped to `tradie-ute`.
- `deployed-frames/phone-picker-cruz-844x390.jpg`, `deployed-frames/phone-picker-ute-844x390.jpg`: the picker with both vehicles, stats and blurb; Use this vehicle prominent.
- `deployed-frames/chromium-phone-choice.jpg`, `deployed-frames/webkit-phone-choice.jpg`, `deployed-frames/chromium-phone-choice-landscape.jpg`, `deployed-frames/webkit-phone-choice-landscape.jpg`: join → the remembered Tradie Ute preselected, choosing shown up front (Car 2 of 2), Ready disabled until chosen; resize keeps one picker.
- `deployed-frames/chromium-phone-ready.jpg`, `deployed-frames/webkit-phone-ready.jpg`: after Use this vehicle, the sticks and Ready.
- `deployed-frames/chromium-lobby-1920x1080.jpg`, `deployed-frames/webkit-lobby-1920x1080.jpg`, `deployed-frames/chromium-lobby-1366x768.jpg`, `deployed-frames/webkit-lobby-1366x768.jpg`, `deployed-frames/chromium-lobby-915x412.jpg`, `deployed-frames/webkit-lobby-915x412.jpg`, `deployed-frames/chromium-lobby-412x915.jpg`, `deployed-frames/webkit-lobby-412x915.jpg`, `deployed-frames/chromium-lobby-375x667.jpg`, `deployed-frames/webkit-lobby-375x667.jpg`, `deployed-frames/chromium-lobby-three.jpg`, `deployed-frames/webkit-lobby-three.jpg`: "Join → choose your vehicle → Ready", every seat shows its vehicle, keys/pad players pick theirs in the seat cards (915x412: see br-zhuw).
- `deployed-frames/chromium-lobby-pad-choice-412x915.jpg`, `deployed-frames/webkit-lobby-pad-choice-412x915.jpg`, `deployed-frames/chromium-lobby-pad-choice-375x667.jpg`, `deployed-frames/webkit-lobby-pad-choice-375x667.jpg`: a pad player choosing visibly on a tall host.
- `deployed-frames/chromium-host-fullscreen-1920x1080.jpg`, `deployed-frames/webkit-host-fullscreen-1920x1080.jpg`: after the host goes full screen, the lobby and Display & sound panel intact.

## Not covered

Real phones, iOS Safari (Playwright WebKit is not Safari), physical pads and the owner's TV (br-iysy); the Ute's engine sound
was not listened to; a mixed round past two vehicles waits for more roster rows (no cap: the picker and grid read the roster).
