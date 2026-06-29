# Joystick Jammers — Captain's Calls Before Bead Polishing

> Status: owner decisions locked 2026-06-29.
> Purpose: consolidate the decisions that should guide the Beads conversion pass. This is the short
> canonical register; detailed rationale remains in the referenced planning docs.

## 1. Pre-polish gate stays first

Broad polishing should not run ahead of `br-69r`. The next work is a Beads reconciliation pass:
extract the recent plan details, add missing beads, update existing beads, and wire dependencies so the
graph reflects the acceptance/CI gates.

## 2. WebGPU is the strategic host-rendering path

WebGPU is first-class for the host renderer even before universal browser support. WebGL fallback is
mandatory operational safety, not the design target. WebGPU-only enhancements are allowed behind
capability checks if the fallback remains playable.

Source: `docs/plans/architecture-findings-and-hardening-2026-06-29.md`.

## 3. Local and Remote both support uncapped seats

No player-count cap should be introduced for Local or Remote variants. If 60 players join and it gets
messy, the game degrades render/audio/physics quality rather than refusing seats.

Implication: no-cap spawn generation is foundational, not a keyboard-only edge case.

## 4. Two-devices-one-seat is a universal seat capability

Remote-screen duplication should not be Remote-mode-only. A seat may bind a controller and a viewer in
both Local and Remote flows:

- Local: big-screen host still renders the shared world; optional remote viewers can attach when needed.
- Remote: each participant can render locally; a phone may still be paired as controller.

This preserves the architecture rule that phones are controllers in Local mode while allowing remote
friends or mixed setups to see their own viewer.

## 5. Rejoin identity is strict on same device, best-effort across devices

If the same device rejoins, it must recover the same player identity/seat. Rejoining near the same
location/car state is desirable but not a hard product requirement. If the player changes device and
there is no account, reconciliation is best-effort only; do not build account-like identity recovery to
solve that case.

Implication: the phone/controller device token is the canonical identity anchor for now. Accounts remain
out of scope.

## 6. Camera defaults and modes

Default camera behavior:

- keep an "all cars in view" mode as a first-class mode;
- use the elegant cluster-split director by default when cars separate, for N clusters, not only two;
- use an overhead/auto-framed crowd fallback when viewport budgets or performance require it;
- make per-player follow grid a configurable mode named **Wife's Grid Mode**.

Wife's Grid Mode follows players like Mario Kart-style per-player panes. It is a config/play option, not
the default crowd camera.

## 7. Inputs are configurable, remappable, and locally saved

Device input is `DeviceSource -> ControlFrame -> ControlScheme -> seat`.

Decisions:

- auto-suggest analog controls when hardware supports them;
- expose digital variants in the picker;
- support remapping;
- save mappings locally for now;
- use "Press A to join" as the default gamepad claim model, with host-configurable auto-claim later;
- warn about keyboard ghosting but do not hard-cap key-region players.

## 8. No-cap spawn generation is promoted

`generateSpawns(track, N) -> Spawn[N]` is a foundational bead. It must guarantee length N,
non-overlap, valid ground/support, race heading sanity, derby ring placement, and late-join behavior.
It should use the pure geometry/math kernel and feed the map-validity gate.

## 9. Persistent debris is called

Derby/debris design should treat debris as a persistent round-level hazard field, bounded by an
accumulating budget and eviction policy. Detached wheels are the prime hazard and are evicted last.
Overflow degrades to cosmetic particles/shards rather than exceeding the budget.

## 10. Bug reporting policy

Browser clients must never know about, shell out to, or directly call local developer tools such as
`br`, `gh`, or other maintainer CLIs. Ban this in policy.

The browser sends sanitized reports to a server endpoint or falls back to email. Local maintainer tooling
may then drain report stores into Beads using trusted local credentials outside the request path.

## 11. Vehicle assets: go forward, but gated

Use the planned asset path:

- Kenney-first / cataloged assets;
- normalized material roles (`paint`, `tyre`, `glass`, `metal`, `light`);
- vehicle-model-validation evidence;
- first two pilot cars reviewed by the human coordinator before broad rollout.

Do not fan out across the full catalog until the pilot gate passes.

## 12. No paid work yet

Do not implement paid accounts, subscriptions, payment flows, or online gating in the current gameplay
polish phase.

Allowed now:

- anonymous durable device token for reconnect/local preferences;
- clean seams so an account can later own multiple device tokens;
- build/deploy/versioning metadata needed for reports and stale-client handling.

Deferred:

- account login;
- paid offline/self-host SKU;
- hosted-online subscription;
- cosmetic store;
- payment provider integration.

The product direction remains: Local stays free, hosted online stays free-while-small, and any paid work
requires a later explicit go decision.

## 13. Beads to create or update

- `ARCH-run-context`
- `ARCH-journal-replay`
- `ARCH-seat-leases`
- `ARCH-protocol-manifest`
- `ARCH-render-backend`
- `ARCH-build-cache`
- `ARCH-controller-split`
- `ARCH-math-kernel`
- `ARCH-perf-budgets`
- `FB-spawngen` / promoted `br-fb-spawncap-qi9`
- `FB-camcluster`
- `FB-camtile`
- `FB-camstable`
- `FB-wifes-grid-mode`
- `FB-gamepad`
- `FB-remap`
- `FB-bugtrk-triage`
- `FB-debris`
- `FB-debrisperf`

The bead conversion pass should decide exact IDs and dependency edges, but the above names capture the
owner-approved intent.
