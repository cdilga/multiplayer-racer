# Around-Couch Risk Resolution And Debug Labs Plan - 2026-06-29

> Status: planning-workflow synthesis after a five-perspective read-only committee pass.
> Scope: 2-32 player couch fun, room/seat lifecycle, race/derby late-join and result rules,
> security hardening, deterministic run tooling, shared debug labs, and Beads conversion.

> Architecture reminder: the host renders the shared 3D world for Local play. Phones and
> keyboards are controllers with light HUD only. Remote viewers may render their own view, but
> weak remote devices must degrade gracefully and must never gate Local play.

## 1. Committee Inputs

This plan integrates five perspectives:

- Player and couch-fun advocate: maximize readable chaos, recovery, fast rematch, and "one more
  round" momentum for 2-32 players.
- Architect: resolve socket-owned room state into durable rooms, seats, and role bindings.
- Security and abuse hardening: protect host authority, player seats, input ownership, names,
  appearance payloads, debug surfaces, and public Remote play.
- Determinism and tooling implementer: make the host-authoritative game reproducible through
  seeds, sim time, replay journals, static scans, and soak harnesses.
- Weapon-lab/tooling designer: make the weapon lab match the existing car-viewer pattern, using
  production code paths, visual overlays, parameter tuning, screenshots, and diagnostics.

## 2. Resolved Principles

1. **Couch spectacle first.** A shared TV world is the product. Controller screens should help the
   player drive, not compete with the host render.
2. **No hard player cap as a product promise.** The game should support 2-32 players by generating
   enough valid spawns and degrading host presentation as player count rises. "No cap" does not
   mean no budgets.
3. **Readable chaos beats raw simulation.** Labels, own-car cues, camera choices, recovery rules,
   weapon effects, and result recaps must help players understand what just happened.
4. **Late joiners should join the party without rewriting the current result.** In derby, late
   joiners wait/spectate until the next round. In race, early late join may enter with a visible
   penalty and restricted podium eligibility; finish-grace/results late joins wait for the next
   race.
5. **Security is architecture.** A room code is not proof of host or player ownership. Authority must
   come from host capability tokens, seat tokens, role bindings, lease versions, and server-derived
   player ids.
6. **Determinism target is replay, not browser lockstep.** The host remains authoritative. The goal
   is that a canonical runner can replay `buildId + seed + config + tuning hash + command journal`
   and reproduce maps, weapons, timers, event order, and quantized sim hashes.
7. **Debug labs are acceptance tools.** `/car-viewer`, `/weapon-lab`, and the future map authoring
   tool are evidence surfaces. They must use production code paths and expose assumptions as
   inspectable, tunable controls.

## 3. Core Architecture: Room -> Seat -> Binding

The current server model is close to one socket equals one player. That is the root of several
later failures: duplicate tabs, phone plus viewer, reconnect, spoofed input, host loss, and player
identity drift. Replace it with:

```text
Room
  roomCode
  topology: local | remote | mixed
  ruleset: race | derby
  phase: waiting | countdown | active | finish_grace | round_end | results | host_lost | closed
  host: { sid, hostTokenHash, epoch, lostAt }
  matchId
  roundId
  seats: Map<seatId, Seat>
  sidIndex: Map<sid, { seatId, role }>
  pairCodes: Map<pairCode, { seatId, role, expiresAt, used }>
  lastSnapshot
  createdAt
  lastActivityAt

Seat
  seatId / playerId
  seatTokenHash
  appearance: { name, color, number, vehicleId, skinId }
  controllerSid
  viewerSids[]
  state: active | away | waiting_next_round | spectator | eliminated | finished | dnf
  leaseVersion
  joinedMatchId
  joinedRoundId
  stats
  lastSeenAt
```

Only the controller binding can write input or identity. Viewers are read-only. Host-only events
require the active host binding and host capability. This model powers Local, Remote, mixed
phone-plus-screen, same-device rejoin, duplicate-tab takeover, and spectator roles without separate
ad-hoc paths.

## 4. Host Loss And Rejoin Policy

Host disconnect must not delete the room immediately.

Resolved behavior:

- On host disconnect, set `phase = host_lost`, clear `host.sid`, record `hostLostAt`, freeze control
  mutation, keep `lastSnapshot`, and broadcast a paused host-loss state.
- Same host token may reclaim for a default 30 second grace window. Reclaim rotates the host token
  and increments host epoch.
- If not reclaimed, resolve to a preserved lobby or clean results state, then reap by TTL.
- Host migration is explicitly v2; do not invent host election in this pass.
- Players keep seats during host-loss grace. Controllers show waiting/reconnect state rather than
  invalid room errors.

## 5. Duplicate Tabs And Takeover

Every controller claim includes `seatToken`, `clientInstanceId`, `role`, and `leaseVersion`.

Resolved behavior:

- If the old controller heartbeat is stale, the new controller takes over automatically.
- If the old controller is active, show a takeover prompt. Accepting increments `leaseVersion`,
  evicts the old controller, and rejects stale input.
- Viewer duplicates are allowed unless the room is explicitly locked down.
- Host duplicate follows the host token plus epoch rule.

## 6. Security Hardening

### 6.1 Immediate Critical Fixes

- `reclaim_room` must require a signed host capability token, not only a room code.
- Reconnect must require a random seat token. A numeric `reconnect_id` or sequential `player_id`
  is not a secret.
- `player_control_update` must derive the player/seat from `request.sid`; payload `player_id` is
  advisory at most and should be ignored for authority.
- Host-to-player world-state events require authenticated host role. Non-host `vehicle_states`,
  arbitrary `reset_player_position`, and legacy mutation endpoints must be removed or host-gated.
- Player reset becomes self-scoped `request_car_reset` with cooldown and host approval.

### 6.2 Validation Rules

- `room_code`: current generator is `^[A-Z]{4}$`; validate shape and rate-limit lookup. It is never
  enough to prove ownership.
- `player_name`: trim, normalize, cap to 12-16 grapheme clusters, reject control/bidi layout
  characters, store canonical text, never HTML.
- `appearance`: colors must match `^#[0-9A-Fa-f]{6}$`; vehicle/decal ids must be manifest enums; no
  client URLs, CSS, class names, or style strings.
- `controls`: finite numbers only; steering in `[-1,1]`, acceleration/braking in `[0,1]`, fire as a
  boolean/edge event; server rate cap per controller.
- `host events`: require current host token/sid/epoch; validate topology, ruleset, track, laps, and
  tuning profile against enums/ranges.
- `weapon/reset/name`: rate-limit and cooldown; weapon ids only over the wire, display names/icons
  resolved from local whitelist.

### 6.3 Rendering Safety

Replace dynamic HTML interpolation for player-provided or manifest-provided strings with DOM nodes
and `textContent`. This covers lobby player names, health bars, result rows, debug overlays,
controller weapon display, mobile error logs, car-viewer stats, and future map/weapon lab labels.

## 7. Race Lifecycle

Race completion should not wait forever for the last stuck or AFK player.

Resolved behavior:

- First finisher starts `finish_grace` instead of ending immediately.
- Default finish grace is 30 seconds, configurable per ruleset/tuning profile.
- If all active racers finish before the timer, close early.
- At grace expiry, unfinished racers receive DNF and are ranked by progress:
  lap, checkpoint/track progress, distance to next gate, last progress time, then stable seat id only
  as a display tiebreaker.
- Late join during early active race may enter if before a configured threshold, but is flagged
  `late_join`, starts from a safe last-place spawn, and has restricted podium eligibility unless
  human playtesting later proves that rule too harsh.
- Late join during finish grace, results, or after a winner is locked becomes spectator or
  `waiting_next_race`.
- Server must have a real finished/results handler. Host `end_game` cannot remain a no-op.

## 8. Derby Lifecycle

Derby should be a quick round loop with clear fairness rules.

Resolved behavior:

- Combat spawn lock: once combat starts, new seats become `waiting_next_round` and can spectate/view
  only. They are registered into `DerbySystem` at the next round reset.
- Joining during `round_end` joins the next round. Joining after match end goes to results/lobby.
- Eliminations are grouped by fixed sim tick. Simultaneous eliminations produce tied placements.
- If all remaining cars die in the same elimination group, the round has no sole winner and awards
  tied points.
- Sudden death starts when combat has stalled: default after 45 seconds, if no meaningful damage,
  hit, or movement occurs for 20 seconds. Pressure may be shrink, hazard, weapon spawn escalation, or
  another visible arena pressure.
- Hard cap default is 180 seconds. At cap, rank survivors by health percent, damage dealt, hits
  dealt, then joint tie if still equal.
- Match results support `winnerIds[]`, not a forced single winner.

## 9. 2-32 Player Around-Couch Fun System

This is not one feature; it is a set of budgets and feedback loops.

### 9.1 Spawn And Join

- `generateSpawns(track, N) -> Spawn[N]` is foundational. It must produce non-overlapping,
  on-ground, in-bounds, sane-heading spawns for N up to at least 64 in tests.
- The 32-player claim is blocked until spawn generation and map validity pass.
- Late join and respawn use the same spawn safety rules; no modulo reuse.

### 9.2 Presentation Degradation

Host tiers:

- 2-8 players: full labels, identity, audio voices, particles, and per-car accents.
- 9-16 players: decluttered labels, capped voice count, capped particles, simpler far-car effects,
  stronger own-car and team/seat markers.
- 17-32 players: LOD/instanced vehicles where chosen, strict particle caps, audio priority by
  proximity/relevance, compact results and HUD grouping, optional overhead or grid camera mode.

Remote viewers degrade independently. Their weakness must not affect Local host play.

### 9.3 Recovery And Comeback

- Recovery should return players to control quickly. Wall catches, flips, bad landings, bowl seams,
  and stuck states should create a funny penalty, not dead waiting.
- Derby OOB can be elimination if the arena rules say so, but it must be visible and fair.
- Comeback/rubber-band tuning should help trailing players rejoin the contest without randomizing
  wins. Any assist should be measurable and playtest-gated.

### 9.4 Results As Story

Results should summarize the social story:

- race winner, podium, best lap, DNF, late-join flag, biggest comeback, cleanest boost/stunt;
- derby round winners, eliminations, survival time, damage/hits, tied eliminations, sudden-death
  outcome;
- one-button rematch and return-to-lobby remain visible on host and controllers.

## 10. Determinism And Replay Tooling

### 10.1 Target

Do not attempt browser-to-browser deterministic lockstep. The host is authoritative. The target is
canonical replay:

```text
buildId + seed + room config + tuning profile hash + command/event journal
  -> same map hash
  -> same spawn hash
  -> same pickup schedule
  -> same timer expiries
  -> same event ordering
  -> same quantized final sim hash on the canonical runner
```

### 10.2 GameRunContext

Introduce a run context:

```text
GameRunContext
  buildId
  roomCode
  topology
  ruleset
  seed
  tick
  fixedDt
  simTimeMs
  tuningProfileId
  tuningHash
  clock
  rng
```

Use `RealClock` only for requestAnimationFrame, UI, perf telemetry, and real-world network
measurement. Use `SimClock` for gameplay, timers, replay, labs, and tests.

Named RNG streams:

- `map`
- `spawn`
- `weapons`
- `gameplay`
- `bots`
- `effects`
- `cosmetics`
- `lab`

Streams should have child keys so adding one weapon draw does not reorder map generation or unrelated
systems.

### 10.3 Migration Scope

Gameplay-critical paths must stop using direct `Date.now()`, `performance.now()`, and `Math.random()`
except through allowlisted adapters. Priority migrations:

- map and random arena selection;
- spawn generation;
- race and derby timers;
- physics timers for stun, reverse, wheelie, stunt boost, bad landing;
- weapon spawn cadence, weapon selection, pickup placement, projectile/effect lifetimes, mine arm
  time, buff expiry, EMP stun, continuous tick rate;
- replay/bug-report journal.

### 10.4 Acceptance Gates

- Static scan fails on direct clock/RNG calls in gameplay-critical paths outside the allowlist.
- Same seed plus same tuning plus same command script produces matching map, spawn, event, and final
  sim hashes.
- 30/60/120 fps render pacing produces the same sim tick count and final quantized sim hash.
- Replay smoke reports the first divergent tick if hashes differ.
- Bug reports include build id, seed, tuning hash, tick, command/event excerpt, and latest snapshot
  hash.

## 11. Shared Debug-Lab Pattern

All labs should share a recognizable contract:

- full-screen production render path;
- compact inspector panel;
- deterministic reset/step/play controls;
- scenario import/export JSON;
- screenshot button and Playwright screenshot hook;
- visible overlays for assumptions;
- machine-readable diagnostics;
- `window.__toolName` hook for tests;
- no per-frame console spam;
- parameter tuning for uncertain defaults.

## 12. Weapon Lab

The weapon lab should be like `/car-viewer`: a local tool that uses the real production path and
turns uncertainty into visible/tunable state.

Proposed route and files:

- `/weapon-lab`
- `frontend/weapon-lab/index.html`
- `frontend/weapon-lab/lab.js`
- Vite input beside host/player/landing/car-viewer if applicable.

Core behavior:

- Instantiate real `WeaponSystem`.
- Use fake render/damage harnesses only as adapters, not duplicate weapon logic.
- Load production tracks through `TrackFactory`, not hand-built sketches.
- Provide presets: pickup field, missile chase, mine arming, oil slick, rail gun, EMP blast,
  shield/boost, flamethrower cone, and crowd stress.
- Draw spawn areas, hit radii, cone/line volumes, trajectories, target health, buffs, stun timers,
  inventory, and emitted weapon events.
- Provide tunables for all behavior families: projectile, deployable, buff, hitscan, AOE, zone,
  continuous, damage, falloff, progression, and spawn cadence.
- Provide `Reset`, `Step 1 frame`, `Step 1 sec`, `Play/Pause`, `Screenshot`, `Export JSON`, and
  `Run checks`.

Scenario schema starts as:

```json
{
  "schema": "jj.weaponLabScenario.v1",
  "seed": 12345,
  "trackId": "derby-arena",
  "preset": "mine-arming",
  "arenaConfigPatch": {
    "weapons": { "enabled": true, "spawnInterval": [6, 10], "maxActive": 4 }
  },
  "weaponOverrides": {},
  "actors": [],
  "camera": { "mode": "orbit", "showOverlays": true }
}
```

## 13. Map Authoring Tool

The map authoring tool remains blocked by map validity. It should not become a pretty editor that
exports broken worlds.

Requirements:

- Race and derby authoring in one tool.
- Deterministic seed browser and tuning controls.
- Validator overlays for surfaces, colliders, checkpoint planes, spawn footprints, wall normals,
  out-of-bounds zones, raycast hits, pickup zones, and geometry failures.
- Export package includes JSON, seed, tuning profile hash, screenshot, and validator report.
- At least one race map and one derby arena must round-trip through normal host loading.

## 14. Car Viewer And Vehicle QA

The existing `/car-viewer` is the template for all labs. It should continue to be promoted into the
vehicle QA tool and must also be hardened:

- production catalog mode as well as debug-car manifest mode;
- raw versus normalized comparison;
- material role diagnostics and texture/material budgets;
- host-like lighting presets and screenshot hooks;
- safe text rendering for model names, errors, and diagnostics;
- same debug-lab export/screenshot convention as weapon lab and map authoring.

## 15. Bead Conversion Map

The following Beads should exist after conversion or update:

- `ARCH-protocol-manifest`: socket event schemas, reliable/volatile lanes, sequence numbers,
  role ownership, host/controller/viewer authority.
- `ARCH-seat-leases`: Room -> Seat -> Binding registry, durable tokens, controller/viewer bindings,
  lease versions, duplicate-tab takeover, host-loss grace, TTL.
- `SEC-host-capability`: host token, `reclaim_room` hardening, host event role checks.
- `SEC-seat-input-html-hardening`: player reconnect tokens, input from `request.sid`, safe
  rendering, appearance validation, endpoint lockdown.
- `RACE-finish-grace-dnf`: first finisher grace, DNF ranking, late-join race policy, server results
  state.
- `DERBY-next-round-ties-stalemate`: late joins wait for next round, simultaneous elimination groups,
  sudden death, hard cap, multi-winner results.
- `COUCH-2-32-fun-budget`: presentation degradation, recovery/comeback rules, result story, 32-seat
  soak acceptance.
- `DET-run-context-core`: `GameRunContext`, sim clock, real clock, named RNG streams.
- `DET-clock-rng-migration`: static scan and migration of gameplay timers/RNG for maps, physics,
  race/derby, and weapons.
- `DET-replay-soak-bug-report`: replay journal, headless sim, 2-32 soak, bug-report run context.
- `DEBUG-lab-shared-pattern`: shared lab hooks, screenshot/export/diagnostic conventions.
- `br-weapon-test-lab-zas`: update with car-viewer-like production path, deterministic scenario,
  visual overlays, and parameter tuning.
- `br-map-authoring-tool-j3i`: update to depend on deterministic seed/validator/debug-lab pattern.

## 16. Dependency Order

1. `br-69r` remains the pre-polish readiness gate and should track that these missing architecture,
   security, determinism, and lifecycle beads exist with acceptance gates.
2. `ARCH-protocol-manifest`.
3. `DET-run-context-core` can run in parallel with `ARCH-protocol-manifest`.
4. `ARCH-seat-leases` depends on `ARCH-protocol-manifest`.
5. `SEC-host-capability` and `SEC-seat-input-html-hardening` depend on the protocol manifest and
   feed into seat leases.
6. `RACE-finish-grace-dnf` and `DERBY-next-round-ties-stalemate` depend on protocol/seat decisions
   and on deterministic time for final acceptance.
7. `br-fb-spawncap-qi9` must complete before any 32-player claim.
8. `br-fb-mapvalid-allmodes-n47` remains the gate before map authoring.
9. `DET-clock-rng-migration` depends on `DET-run-context-core`.
10. `DET-replay-soak-bug-report` depends on deterministic migration plus spawn generation.
11. `DEBUG-lab-shared-pattern` can start after `DET-run-context-core`.
12. `br-weapon-test-lab-zas` depends on debug-lab pattern and weapon RNG/clock migration.
13. `br-map-authoring-tool-j3i` depends on map validity, deterministic seed, and debug-lab pattern.

## 17. Normal CI Versus Opt-In Gates

Normal CI:

- unit/integration tests for protocol validation, seat ownership, security, race/derby lifecycle,
  deterministic RNG/clock, and weapon/map deterministic units;
- static direct-clock/direct-random scan;
- one small Playwright host-path gate for map validity and one lab smoke where stable.

Opt-in or nightly:

- full 32-controller soak;
- broad browser matrix;
- GPU/render performance sweeps;
- visual/audio snapshot galleries;
- long replay sweeps.

## 18. Resolved Defaults

The owner accepted the proposed defaults on 2026-06-29:

- **Race late join:** always allow the player into the room/seat. During active race, allow current-race
  entry only before the first finisher and before 50 percent of expected race duration, with visible
  `late_join` status and restricted podium eligibility. During finish grace/results, queue or spectate
  until the next race.
- **Derby sudden death:** use visible shrink/arena pressure first. Add weapon escalation only if
  playtests show shrink pressure is not producing enough action.
- **High-player camera:** keep shared camera as the default, use overhead fallback when the shared
  camera cannot keep the pack readable, and keep Wife's Grid Mode opt-in.
