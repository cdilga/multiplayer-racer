# P1-W03b · Sanga physical simulation

2026-10-11, CyanBridge. This qualifies the independent simulation slice
`br-p1-w03-zn1.2`; the full W03 item and W01 parent remain in progress.

Sanga's validated 6000 ms card gives 720 ticks. Real successful use consumes the
FIFO front and sets Rapier dominance 1, without changing mass, driving forces,
controls or poses. A later use refreshes the expiry rather than multiplying the
buff. The timer is visible in CarObs as effect identity, expiry and remaining ticks.
Contact immunity covers the simulated interval's last active tick. Contacts still
attribute pushed props to the driver, while immune impulses cannot later charge
health when their episode closes. Fired records retain their causal owner and timer
through recovery; held inventory clears. Round end retires effects and restores
ordinary dominance while live debris remains dynamic.

## Physical measurements

Six committed scenarios in `scenarios/items/` run through the actual simulation
and replay their journals bit for bit. Native tests run on RCH eris (Linux, Intel
i5-12400), explicit dev/test opt level 1, Rapier 0.36.0 with the qualified W03a patch.

- Tank push: starting at 15 m/s with ordinary throttle, the driver retains
  **14.571898 m/s** (97.15%); the stationary target reaches **14.44606 m/s**.
  The target remains ahead. Actual attached convex-collider penetration is **0 m**.
  The centre gap is 3.988634 m because the target's rear bumper detached; an intact
  vehicle rectangle would misrepresent its shape. Shielded health is unchanged.
- Ram immunity: a real 15 m/s ram leaves the shielded car at approximately
  −3.1e−11 m/s and −2.8e−16° heading change, with unchanged health. Each collision
  also runs without the pickup and damages the ordinary car, proving contact occurred.
- Solid terrain: a fixed wall stops the active car at **0.013608 m/s** before the wall.
- Refresh: both uses are exactly 720 ticks. The first expiry leaves the refreshed
  buff active; the final boundary clears it. Position, velocity, mass and engine
  force match a no-item control bit for bit during ordinary driving.
- Clean expiry: deliberately overlapped on the last active tick 979, the buff ends
  exactly at tick 980. Shared EnergyGainJ is **65.5390625 J**, within the unchanged
  500 J fixture tolerance, without a launch.
- Debris attribution: car 0 owns the prop it pushed at tick 350 (contact tick 312).
  The prop's later impact on car 1 credits car 0; a later victim impulse can correctly
  transfer current ownership. Shielded health remains unchanged.

The energy ledger records authorised **normal** moving-dominance contact work
`J · dominant_surface_velocity`, excluding fixed-world and equal-group contacts.
It does not clamp a residual. Tangential moving-dominance work is not yet qualified
by this path; this receipt makes no broader energy claim.

## Verification

`RCH_REQUIRE_REMOTE=1 rch exec -- cargo test --config profile.dev.opt-level=1
--config profile.test.opt-level=1 --locked -p jj-fixture --test sanga -p jj-sim
--test item_queue --test damage --test damage_attribution --test debris -- --nocapture`:
**22/22 pass**. This includes the six Sanga scenarios, counterfactual controls,
minute-long dynamic debris and existing damage compatibility. Log:
`/tmp/jj-sanga-causal-work-and-compatibility.log`.

After adding the fired-buff recovery case, the final bank passes **76/76**:
jj-sim library 18, item_queue 9, real jj-tools CLI scenario bank 1, host/testing
library 48. Command uses the same explicit profiles and `-p jj-sim --test item_queue
-p jj-wasm-host --features testing --lib -p jj-tools --test scenarios`.
Log: `/tmp/jj-sanga-final-host-and-cli-bank.log`.

Workspace Clippy, all targets with host/testing and `-D warnings`, passes on eris:
`/tmp/jj-sanga-final-workspace-clippy.log`. Fresh release host/testing WASM and native
Mac jj CLI builds pass: `/tmp/jj-sanga-causal-release-wasm.log` and
`/tmp/jj-sanga-causal-native-cli.log`.

Mac Apple M1 Pro, macOS 27.0.1, Node 26.10.0, Playwright Chromium/SwiftShader:
the native/WASM item bank, unchanged mixed-roster golden and real controller journey
pass **3/3 in 14.52 s**. Every one of the eight item fixtures agrees on its full
native/WASM state hash; the tank hash is
`3048a533390b30d5e315eb56c1de36513d71e70ace2f6988678277d063dfed71`.
The real room/phone join goes through jj-server, WebRTC and Ready into Running.
Actual ACTION consumes Sanga at the front, reports the exact active timer, then
refuses the still-unimplemented boomerang while preserving it. The actual round
director clears inventory at Intermission. Command uses `JJ_BIN=target/debug/jj`,
`JJ_SERVER_BIN=/tmp/jj-macos-server-w01`, and `node --test` on
`web/host/tests/items-wasm.test.mjs`, `web/host/tests/roster-wasm.test.mjs` and
`web/tests/journeys/w01-item-queue.test.mjs`.
Log: `/tmp/jj-sanga-causal-live-parity.log`.

The final native workspace bank passes **456 tests, 0 failed, 1 ignored across
78 suites**, exit 0, on eris at explicit dev/test opt level 1:
`RCH_REQUIRE_REMOTE=1 rch exec -- cargo test --config profile.dev.opt-level=1
--config profile.test.opt-level=1 --locked --workspace`.
Log `/tmp/jj-sanga-final-workspace-bank.log`, 11:29–11:42 UTC.
This bank covers the Sanga changes before the subsequent segment-box optimisation.

The combined final Sanga/segment-box workspace Clippy check also passes on eris,
all targets with host/testing and `-D warnings`, explicit opt-level-1 profiles.
Log `/tmp/jj-sanga-and-box-final-clippy.log`, 11:49 UTC.

CI is required before closing. This is a simulation/data receipt; it does not
claim Sanga's armour/material/audio presentation, stations or inventory HUD are
delivered. The parent retains those requirements and the boomerang ×0.2 interaction.
No player, effect or debris caps were introduced.
