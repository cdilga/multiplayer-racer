# Joystick Jammers — Architecture Findings & Hardening Pass

> Status: planning pass v1, owner direction locked 2026-06-29; ready to convert into Beads after review.
> Scope: cross-cutting software, client/server, renderer, deployment, and game-design architecture.
> This supplements `feedback-design-pass.md` and `game-modes-and-flows.md`; it does not replace them.
>
> **Owner decision (2026-06-29):** move toward the cutting edge even where browser support is not
> universal. WebGPU should become the first-class host-rendering direction, with WebGL fallback and
> kill switches used to keep the game playable while the project moves forward aggressively.
>
> **Decision register:** `docs/plans/captains-calls-2026-06-29.md` is the canonical owner-call summary
> for bead conversion. It locks universal seat capability, strict same-device rejoin identity, no-cap
> spawn generation, bug-reporting tool boundaries, Kenney-first vehicle rollout, and no paid work yet.

## 1. Why this pass exists

The current polish plan is strong on concrete gameplay feedback: camera readability, map validity,
controller schemes, vehicle feel, assets, and onboarding. The next risk is architectural drift:
features continue to land inside large browser-side files, while time, randomness, transport behavior,
join/rejoin identity, asset loading, and render backend decisions remain partly implicit.

This pass identifies the constraints and highest-leverage architecture moves that keep the game:

- maintainable enough for multi-agent implementation;
- deterministic enough for replay, Remote mode, and empirical tuning;
- fast enough on the Local host renderer, where the full 3D world actually runs;
- forgiving enough for phone sleep, reconnects, refreshes, and deploy rollouts;
- ambitious enough to use advanced methods where they buy real player experience, not novelty.

## 2. Current constraints and smells to address

### 2.1 Runtime determinism is not yet a system boundary

The engine loop uses a fixed timestep, which is the right base. But gameplay systems still directly
read wall clock and random sources:

- `GameLoop` uses fixed updates, but `performance.now()` is still embedded throughout gameplay.
- `PhysicsSystem` uses `performance.now()` and `Date.now()` for stun, reverse, and wheelie timers.
- `WeaponSystem` uses `Math.random()` for spawn timing, weapon choice, and pickup positions.
- `GameHost._resolveTrackId()` uses `Math.random()` for random derby arena selection.

Finding: deterministic simulation cannot be retrofitted at the end. Remote viewer sync, replayable bug
reports, physics sweeps, reproducible map failures, and fair reconnect recovery all need a single run
context that owns seed, tick, clock, and random streams.

### 2.2 Protocol behavior is still too stringly typed

Socket events exist as ad-hoc payloads. Some ownership checks exist, but there are still historical
patterns where client payloads carry authority-sensitive identifiers. The Remote plan already calls out
input authorization as a public-Remote gate.

Finding: before Remote and 60-player stress work grow, the socket protocol needs event schemas,
ownership rules, sequence numbers, and explicit QoS lanes.

### 2.3 Join/rejoin is a product-critical distributed-state problem

Current reconnect support uses per-room `sessionStorage` records and server-side disconnected-player
state during racing. That helps phone refresh/sleep, but it is not yet the durable identity model
described in `game-modes-and-flows.md`.

Smells:

- reconnect identity is tied to room-local player ids rather than an opaque durable device token;
- host disconnect deletes rooms immediately in current server flow;
- stale socket takeover exists, but the user-visible state machine is underspecified;
- reconnect should preserve identity, customization, current car, controller ownership, and visual
  “away/recovering” state, not just rejoin a room code.

Finding: join/rejoin should become a first-class session subsystem with a seat lease model.

### 2.4 Rendering needs a backend boundary so WebGPU can be first-class

Three.js now documents `WebGPURenderer` as the newer renderer that attempts WebGPU and falls back to a
WebGL 2 backend. MDN still marks WebGPU as limited availability rather than Baseline, and support varies
by browser/platform. The owner decision is to move toward WebGPU anyway: not because every client can
run it today, but because the host renderer is the strategic performance and fidelity frontier.

Therefore the right move is not “WebGPU only”; it is a first-class renderer backend architecture:

- make WebGPU the preferred host renderer where supported;
- fall back to WebGL 2 automatically when the browser/device cannot run it;
- preserve a legacy `WebGLRenderer` escape hatch until parity is proven;
- collect renderer backend, adapter limits, frame timing, draw-call, and visual-parity evidence.

Finding: make WebGPU a first-class production path early. Fallbacks are operational safety, not a reason
to design to the lowest common denominator.

### 2.5 Deployment caching is partially solved but not complete

The Flask server already does a good thing for built `/assets/*`: content-hashed Vite assets are served
with long immutable caching, while HTML and `/static/*` are `no-cache`.

Remaining issue: core game modules are still loaded from `/static/js/...`, for example the host boot path
imports `/static/js/GameHost.js`. These files are copied by Vite publicDir rather than content-hashed
into the full module graph. Revalidation avoids most stale-code failures, but it gives weaker guarantees
than hashed deploy artifacts and makes “which version is this client running?” harder to answer.

Finding: deployment should have a coherent asset strategy: hashed runtime graph, no-cache HTML/manifest,
build id surfaced to client/server, and a reload prompt when a client is running an old build.

### 2.6 Large files are becoming ownership boundaries by accident

Current high-risk files:

- `static/js/player.js` is the phone controller app, tutorial, reconnect behavior, HUD, touch handling,
  keyboard path, and socket glue.
- `static/js/GameHost.js` orchestrates systems, room state, track loading, vehicle creation, recovery,
  state broadcast, and test globals.
- `PhysicsSystem`, `RenderSystem`, and `WeaponSystem` are all over 1,300 lines.

Finding: this is manageable now, but each new feature should create a sharper subsystem boundary rather
than add another responsibility to these files.

## 3. Research-backed directions

### 3.1 WebGPU as the strategic renderer backend

Source guidance:

- MDN marks WebGPU as limited availability and secure-context only.
- Three.js docs say `WebGPURenderer` attempts a WebGPU backend and falls back to WebGL 2.
- Chrome’s WebGPU docs emphasize lower JavaScript overhead and access to modern GPU capabilities.

Direction:

Create a `RendererBackend` abstraction and make `webgpu-auto` the strategic default for the host render
path once parity gates pass. Keep `webgl2` and `webgl-legacy` explicit modes. Expose backend choice in
debug settings and persist it for test comparisons.

Bias:

- choose WebGPU-oriented APIs and abstractions for new render work;
- keep WebGL compatibility by adapting the backend, not by freezing the engine at the older model;
- allow WebGPU-only enhancements behind capability gates when they materially improve the host
  experience;
- never require a phone Local controller to support WebGPU.

Acceptance gates:

- startup chooses backend deterministically: `webgpu-auto`, `webgl2-forced`, or `webgl-legacy`;
- host render works on Chrome/Edge with WebGPU, Safari/Firefox where available, and WebGL fallback
  elsewhere;
- visual parity snapshots cover lobby, race, derby, particles, trails, labels, and vehicle assets;
- perf harness records backend, adapter limits, renderer info, CPU frame time, GPU-ish proxy metrics,
  draw calls, triangles, and post-processing state;
- one config/env kill switch can force WebGL if WebGPU regresses in production;
- no player-facing phone Local controller path depends on WebGPU.

Non-goals:

- do not migrate every material/effect to custom WebGPU shaders before proving parity;
- do not block map/reconnect/controller polish on WebGPU;
- do not use WebGPU capability as a join requirement.
- do not let incomplete Safari/Firefox support prevent the host renderer from advancing.

### 3.2 Fixed timestep plus authoritative snapshots

Source guidance:

- Gaffer’s fixed timestep and snapshot interpolation articles remain the standard reference for
  simulation stability and networked state smoothing.
- Valve/Source-style networking separates command input, server authority, and interpolated snapshots.

Direction:

Add a command/state journal and formal snapshot pipeline:

- host simulation consumes ordered player commands by tick;
- host periodically emits compact state snapshots with sequence number and build id;
- clients/controllers treat snapshots as latest known truth;
- Remote viewers interpolate between snapshots; Local phones consume HUD state only.

This is not a full deterministic lockstep game. Rapier/browser floating-point differences make lockstep
too fragile. The host remains authoritative; determinism is for reproducibility, testing, and replay
confidence.

### 3.3 QoS lanes for networking

Source guidance:

- Socket.IO has buffered reliable behavior by default, which is valuable for commands but risky for
  transient high-frequency state after reconnect.
- WebTransport datagrams and WebRTC DataChannels are viable future transports for unreliable/low-latency
  state, but they add deployment and browser complexity.

Direction:

Keep Socket.IO, but define lanes:

- reliable ordered: join, seat claim, start, mode select, fire, reset, scoring, results;
- latest-state/volatile: vehicle snapshots, HUD telemetry, perf samples;
- bulk/bootstrap: replay chunks, debug bundles, map packages, late-join snapshots.

RaptorQ-style erasure coding is not useful for live controls. It may become useful for bootstrap/debug
bundles or large Remote late-join state over unreliable future transport, but only after measurement.

### 3.4 Advanced math where it actually helps

Good targets:

- blue-noise / Poisson-disk sampling for non-overlapping spawns, pickups, props, and spectator markers;
- capacity-constrained Voronoi / power diagrams for camera cluster budgeting and fair arena partitioning;
- property-based and metamorphic tests for geometry invariants across thousands of seeds;
- multi-objective search for handling/camera/weapon tuning once the sim harness exists.

Bad targets:

- clever network coding for per-frame controls;
- WebGPU compute as a novelty before renderer architecture and perf budgets prove the target workload;
- hidden auto-steering as default without playtest evidence.

## 4. Proposed architecture additions

### ARCH-1: `GameRunContext`

Create an injectable runtime context:

```js
{
  buildId,
  roomCode,
  modeKind,
  gameMode,
  seed,
  tick,
  fixedDt,
  clock: { nowMs(), nowTick(), advanceTick() },
  rng: { gameplay(), cosmetics(), effects(), map(), weapons() }
}
```

Rules:

- gameplay-affecting systems may not call `Math.random()`, `Date.now()`, or `performance.now()`
  directly;
- cosmetic-only randomness may use a separate non-authoritative stream, but it must be labeled;
- bug reports and replay journals include `buildId`, seed, room config, and current tick.

Bead-ready scope:

- add context type/module;
- inject it into `GameHost`, `PhysicsSystem`, `WeaponSystem`, map generation, and recovery timers;
- add lint/test scan that fails on new gameplay-clock/random direct calls outside allowlisted adapters;
- preserve current behavior with a compatibility wrapper.

### ARCH-2: Command/state journal and replay runner

Record enough to reproduce a session:

- room config, mode, track/arena id, seed, build id;
- ordered input commands by `{playerId, sequence, tick, controls}`;
- host events: start, pickup spawn, weapon fire, reset, disconnect/reconnect, elimination, finish;
- periodic authoritative snapshots for recovery and bisecting divergence.

Uses:

- bug reporter attaches a compressed journal excerpt;
- replay runner reproduces map/physics/control bugs in browser or headless harness;
- reconnect can bootstrap from latest authoritative snapshot;
- playtest comparisons become evidence rather than notes.

Bead-ready scope:

- define journal schema and size limits;
- implement in-memory ring buffer first;
- expose debug export;
- add one replay smoke test for a short deterministic run.

### ARCH-3: Session/seat leases for join and rejoin

Replace ad-hoc reconnect semantics with a small state machine:

- device token: opaque, durable `localStorage` id, scoped by room on server;
- seat lease: `{seatId/playerId, deviceTokenHash, currentSocket, state, expiresAt}`;
- states: `joining`, `connected`, `disconnected_grace`, `reclaiming`, `spectating`, `expired`;
- host state: `host_connected`, `host_grace`, `host_reclaimed`, `host_expired`;
- visual state: connected car normal, disconnected car transparent/ghosted, reclaiming car recovering.

Rules:

- a rejoin claims the same seat when the token matches;
- a newer socket can replace a stale socket without duplicating the player;
- host loss pauses or freezes room state for a grace window instead of deleting immediately;
- expired seats are reaped explicitly and reported to host/controller UI;
- every transition emits a user-visible reason, not just a generic error.

Bead-ready scope:

- server-side `RoomSession`/`SeatLease` module;
- client-side `ReconnectController` for phone;
- visible reconnect states on phone and host;
- tests for phone sleep/reload, stale socket takeover, host reconnect, and expired room.

### ARCH-4: Protocol manifest and transport lanes

Create a single protocol description:

```js
{
  event: "player_control_update",
  direction: "controller->server->host",
  lane: "reliable-command",
  owner: "socket must own seat",
  schema: { roomCode, playerId, sequence, tick, controls },
  rateLimit: "60hz per connected driver, downshiftable",
  dropPolicy: "reject stale sequence; clamp values"
}
```

Bead-ready scope:

- define manifest for existing events;
- add server validators and ownership checks from manifest;
- add sequence numbers to control updates;
- make vehicle snapshots latest-state/volatile where possible;
- document future WebTransport/WebRTC lane only as a later option.

### ARCH-5: Renderer backend architecture, WebGPU first-class

Introduce `RendererBackend`:

- `webgpu-auto`: strategic default for host rendering after parity; uses Three `WebGPURenderer` and
  its backend selection;
- `webgl2-forced`: uses WebGPU renderer’s WebGL 2 backend or a forced fallback path where practical;
- `webgl-legacy`: current `WebGLRenderer` path as a safety valve until parity is proven.

Implementation direction:

- isolate renderer construction from `RenderSystem`;
- create a feature probe that records `navigator.gpu`, adapter info when available, selected backend,
  limits, and fallback reason;
- centralize render capabilities: instancing, post-processing, shader nodes, MSAA/antialias, bloom,
  texture formats, maximum lights/effects;
- keep visual effects authored against a small internal material/effect API where possible.
- for new host-rendering features, design the primary implementation against the WebGPU-capable
  capability model, then supply a reduced WebGL implementation when needed.

Acceptance:

- current game renders unchanged through legacy WebGL;
- WebGPU path can be enabled with `?renderer=webgpu` or debug setting immediately;
- once parity passes on target host devices, `webgpu-auto` is the default host renderer;
- fallback is automatic and visible in debug overlay;
- build/test covers both `webgpu-auto` and forced WebGL on at least one browser runner;
- perf report compares backend cost for N cars, particles, bloom, and labels.
- WebGPU-only enhancements are allowed behind capability checks when the fallback remains playable.

### ARCH-6: Deployment asset graph and invalidation

Target policy:

- HTML shell and build manifest: `Cache-Control: no-cache`;
- content-hashed JS/CSS/assets: `public, max-age=31536000, immutable`;
- mutable room/Qr/api/socket responses: no-store or no-cache as appropriate;
- static media with non-hashed URLs: either content-hash them or keep no-cache/revalidate;
- client stores and reports `buildId`;
- if server build id changes while a controller/host is in lobby, show a reload prompt;
- do not hard-reload mid-race unless the client is unrecoverably incompatible.

Current gap:

- Vite-hashed `/assets/*` already has immutable caching;
- `/static/js/*` game modules are copied public files and revalidated, not immutable hashed modules.

Bead-ready scope:

- move core runtime JS imports into the Vite module graph or emit a generated content-hash manifest for
  `/static/js/*`;
- add `/build-info.json` with git SHA/build time/package version/asset manifest hash;
- include build id in socket hello and bug reports;
- add cache-header tests for HTML, assets, static JS, audio, and build info;
- add stale-client UX for lobby/controller pages.

### ARCH-7: Controller app split

Split `player.js` into:

- `ControllerApp`;
- `ConnectionState`;
- `ReconnectController`;
- `ControlMapper`;
- `ControllerHUD`;
- `TutorialRunner`;
- `ControllerProtocolClient`.

Bead-ready scope:

- move code without behavior change;
- keep `window.gameState` compatibility for existing E2E until tests move to a stable test API;
- add module-level unit tests around `ControlMapper` and `ReconnectController`;
- no Remote viewer code goes into phone controller modules.

### ARCH-8: Pure math/geometry kernel

Create pure modules for:

- centerline frames and winding;
- curve offset and miter/self-intersection repair;
- spawn generation for arbitrary N;
- Poisson/blue-noise placement for pickups/props;
- checkpoint gates;
- camera cluster assignment and viewport budgeting.

Bead-ready scope:

- no Three/Rapier imports in the kernel;
- property tests over seed ranges;
- debug schematic render consumes kernel output, not independent geometry math;
- map validator becomes a client of this kernel.

### ARCH-9: Performance budgets and observability

Add a production-safe perf surface:

- `PerformanceObserver` for Long Animation Frames where supported;
- per-frame buckets: physics ms, render ms, UI ms, network msg/s, snapshot bytes/s;
- render counters: draw calls, triangles, materials, textures, cars, particles, labels;
- audio counters: engine voices, SFX voices;
- room counters: players connected, reconnecting, spectators, stale clients;
- backend counters: renderer backend, WebGPU adapter/fallback reason.

Bead-ready scope:

- debug overlay panel and structured one-shot export;
- no per-frame console logs;
- CI proxy tests for counter presence;
- hardware/GPU-runner perf gate later.

## 5. Suggested bead list

| Bead | Title | Depends on | Acceptance evidence |
|---|---|---|---|
| `ARCH-run-context` | Inject `GameRunContext` for seed/clock/RNG/build id | none | direct clock/RNG scan, deterministic seed smoke |
| `ARCH-journal-replay` | Command/state journal + replay export/smoke | `ARCH-run-context` | replay reproduces short run; bug export includes journal |
| `ARCH-seat-leases` | Durable join/rejoin seat lease state machine | none | phone sleep/reload, stale socket takeover, host grace tests |
| `ARCH-protocol-manifest` | Socket protocol schemas, ownership, sequence numbers, lanes | `ARCH-seat-leases` | spoof rejection, stale command drop, schema tests |
| `ARCH-render-backend` | Renderer backend abstraction with WebGPU first-class and fallback | none | WebGPU/fallback selection, visual parity, debug backend report |
| `ARCH-build-cache` | Build id, hashed runtime graph, cache invalidation tests, stale-client UX | none | header tests, build-info endpoint, reload prompt |
| `ARCH-controller-split` | Split phone controller app into focused modules | `ARCH-seat-leases` optional | no behavior change, controller E2E still green |
| `ARCH-math-kernel` | Pure geometry/spawn/camera math kernel | none | property tests over seeds, debug render consumes same output |
| `ARCH-perf-budgets` | Runtime perf counters and budget overlay/export | `ARCH-render-backend` | counter export, no per-frame logging, backend metrics |

## 6. Recommended sequencing

1. `ARCH-build-cache` can land early and reduces deploy uncertainty immediately.
2. `ARCH-seat-leases` should land before deeper invite/rejoin/Remote work.
3. `ARCH-run-context` should land before sim harness, map randomness, weapon randomness, and replay.
4. `ARCH-protocol-manifest` follows seat leases so ownership rules are grounded in the final identity model.
5. `ARCH-render-backend` should start early in parallel: WebGPU is the forward host-rendering path,
   fallback keeps unsupported devices playable, and map/rejoin/controller polish should not wait on it.
6. `ARCH-controller-split` should happen before adding multiple controller schemes and tutorials.
7. `ARCH-math-kernel` supports map validity, spawn scaling, camera clustering, and pickup placement.
8. `ARCH-journal-replay` and `ARCH-perf-budgets` turn the above into evidence loops.

## 7. Locked decisions and remaining human calls

Locked:

1. WebGPU is the strategic first-class host renderer direction even before universal browser support.
2. WebGL fallback remains mandatory so unsupported devices can still host/play.
3. WebGPU-only improvements are acceptable behind capability checks if the fallback experience stays
   coherent and playable.

Remaining calls:

1. How aggressive should stale-client handling be? Recommendation: prompt in lobby/menu; avoid forced
   reload mid-race unless protocol incompatibility makes continuation unsafe.
2. Should join/rejoin device tokens be anonymous-only for now? Recommendation: yes. Accounts can link
   tokens later; do not block party UX on account identity.
3. How much replay data can bug reports attach? Recommendation: ring buffer with a strict size cap and
   explicit privacy review before uploading screenshots/journals automatically.

## 8. Source references

- MDN WebGPU API: limited availability and secure-context requirements.
- Three.js `WebGPURenderer` docs: WebGPU backend with WebGL 2 fallback behavior.
- Chrome WebGPU overview/troubleshooting: performance motivation and adapter failure realities.
- Gaffer on Games: fixed timestep and snapshot interpolation.
- Socket.IO client offline behavior: default buffering risk for transient state.
- RFC 6330 RaptorQ: useful for bulk erasure-coded delivery, not live per-frame controls.
- Blue-noise / capacity-constrained Voronoi literature: useful for spawn, pickup, and camera partitioning.
