# Plan: Game Modes & User Flows (Local + Remote)

> Status: **planning round v2** (refined via architecture / UX / ops critique passes) ·
> Scope: epic `br-modes-remote-play-design-48a`
>
> Self-contained plan, grounded in the *current* code (verified against `server/app.py`,
> `static/js/systems/NetworkSystem.js`, `static/js/GameHost.js`,
> `static/js/resources/ProceduralTrackGenerator.js`, `static/js/player.js`, and the three
> `frontend/*/index.html` screens). Implementation beads derive from §8; the beads carry
> the authoritative task text, this doc carries the reasoning and the verified file:line
> anchors.

---

## 1. Goals & why

Two first-class ways to play:

- **Local mode** — today's couch experience: one big screen (TV/laptop) renders the shared
  world; everyone's phone is a controller. This is the product's identity; it must keep
  working *exactly* as it does now.
- **Remote mode** — friends in *different locations* play together, each on their own
  computer/phone, **each seeing the gameplay on their own screen**. Unlocks "two people on
  their own computers, in sync" and scales to any number of separated players + spectators.

Supporting capabilities the modes lean on: **deep-link invites**, **rejoinable rooms**, and
**design + asset alignment** (front-page aesthetic per `docs/design-brief.md`; recognizable,
personal cars/pickups).

**Why now:** the netcode is *already* host-authoritative with the server as a pure relay
(§2). Remote is mostly a **client-rendering + state-fanout** feature, not a netcode rewrite.

---

## 2. Current architecture (verified foundation)

- **Host-authoritative, server-as-relay.** `/host` runs the sim + canonical render; `/player`
  sends input; the server validates/clamps and **relays** (`player_control_update` →
  `player_controls_update`; `vehicle_states` → `vehicle_states_update`). The server is a
  router, not an authority.
- **State already fans to every player, but players don't render.** `vehicle_states` is
  broadcast room-wide, **but** `_buildVehicleStates` in `GameHost.js` (~:1354) emits **HUD
  fields only** (`id, speed, health, boost, wheelie, handlingState, stunt*`) — **no
  position/rotation**. `player.js:567` reads only the *own* car's HUD. The only Three.js on
  the player is the lobby car preview. Mesh transforms exist host-side
  (`vehicle.mesh.position` / `.quaternion`, synced at `GameHost.js` ~:1262).
- **Rooms are in-memory, host-owned, deleted on host disconnect.** `game_rooms[code]` =
  `{host_sid, players{}, game_state, disconnected_players{}, next_player_id, mode}`. Host
  disconnect → `del game_rooms[code]` immediately (no grace). No persistence across restart.
- **Reconnect partially exists.** Racing dropouts saved in `disconnected_players` for **5
  min**; client stores `racer_reconnect_{room}` in **sessionStorage**; `join_game` accepts a
  per-room `reconnect_id`. Host uses `reclaim_room`; `return_to_lobby` resets finished→waiting.
- **Deep-link plumbing partially exists.** `/player?room=CODE` + `/join` alias; landing join
  box already routes to `/player?room=CODE`; `/qrcode/<code>` renders a join QR.
- **Late joins already allowed during `racing`** (blocked only when `finished`).
- **Arenas are procedural but NOT reliably deterministic.** `ProceduralTrackGenerator.js:~145`
  uses `seed ?? Math.floor(Math.random()*0xFFFFFFFF)` — without an explicit shared seed,
  every client generates a *different* track. (`VehicleFactory.js:~59` also uses `Date.now()`
  for fallback ids.)
- **player_id is a monotonic counter** (`next_player_id`), and **trusted from the client**
  in input handlers — see §6.5 (spoofing).

**Implication:** ~60% plumbed for Remote. New work = (a) broadcast full transforms, (b)
viewer render scene on non-host clients, (c) shared seed + deterministic generators, (d)
durable identity, (e) host-loss grace, (f) input authorization + abuse hardening for public.

---

## 3. Vocabulary: topology, ruleset & roles

> Implemented by `br-modes-remote-play-design-48a.1`. Single source of truth:
> `server/session_vocabulary.py` + `static/js/engine/sessionVocabulary.js`.
> These three axes are **orthogonal** — topology never implies a ruleset, and
> vice versa. (Earlier drafts called the room field `mode_kind`; it is now
> `topology`, since the room already carries `mode` for the *ruleset*.)

**Topology** — `room['topology']`, a property of the *room*, fixed at creation,
never changed mid-session:
- `local` *(default)* — one authoritative renderer (big screen); controllers are HUD-only.
- `remote` — one authoritative host + every participant renders their own viewer.
- `mixed` — some participants co-located on a shared screen, others remote.

**Ruleset** — `room['mode']` (legacy key name), the game being played: `race` | `derby`.
Chosen later at start, independent of topology.

**Roles** (a property of a *participant*, sent on `game_joined` as `role`):
- **host** — runs the authoritative sim + canonical render. Exactly one per room.
- **controller** — owns a car, sends input. Zero-or-many. (The "Driver" in prose below.)
- **viewer** — receives synced state and renders locally. In Remote, *everyone* is a viewer.
- **spectator** — watches only, owns no car.

Combos: Local = Host(screen, not a driver) + N Drivers(phones). Remote = Host-Driver +
N Driver-Viewers + optional pure Viewers (spectators).

**Chosen Remote host model (was open; recommended & adopted here):** **host-as-player.** The
host's browser is *both* the authoritative simulator *and* a Driver-Viewer — they see the
world and drive from their own camera, no separate screen needed. This is what "two people on
their computers" actually wants. (Alternative — pure host screen + everyone joins as a
Driver-Viewer from a second tab — is the fallback if host-as-player proves too heavy; noted
in §9 as a confirm-with-user item.)

---

## 4. User flows  ← primary focus

### 4.0 Host entry & the Local/Remote choice (new screen)

Today `/host` immediately creates a room with no mode choice. Add a **Create Room** step:

- **Screen:** "How will your friends join?"
  - **Local** *(default)* — "Everyone in one room. One big screen, phones are controllers.
    Perfect for the couch."
  - **Remote** — "Everyone on their own screen, anywhere. Great for friends who can't be
    together."
  - Small `?`/"Learn more" affordance per option (first-time clarity).
- Pick → **Create Room** → room code (+ QR; + invite link for Remote). Game mode (Race/Derby)
  is still chosen later, at start, as today.
- **Mode is set at room creation and never changes mid-session.**

The landing page gets one explainer line/section distinguishing Local vs Remote so the choice
isn't the first time a user meets the concept.

### 4.1 Local mode (today's behaviour, formalized)

No UX change; "Local" just becomes an explicit, named codepath.

1. Host opens `/host`, picks **Local** (default) → `create_room` (with `topology:'local'`)
   → code + QR shown.
2. Players open `/player` (scan QR / type code), set a name → `join_game` → **waiting room**
   (car preview + mode badge). Copy: *"The big screen will show the race. Swipe to try your
   controls."*
3. Host picks Race/Derby, hits **Start** → `start_game` → `game_started`.
4. Phones are controllers (touch: steer / accelerate / brake / fire); big screen renders.
5. Match ends → results on big screen → host **returns to lobby** (replay) or closes.

### 4.2 Remote mode (new): create → invite → play → replay

1. **Create.** Host opens `/host`, picks **Remote**. Their browser becomes authoritative Host
   *and* a Driver-Viewer (renders the world + their own car). A **floating invite panel**
   (§4.2a) overlays the game canvas (non-blocking, top corner).
2. **Invite.** Host taps "Copy invite link" / "Share" / shows QR → shares
   `https://…/join/<CODE>` (§4.3).
3. **Join (remote friend).** Friend opens the link on their own computer/phone → routed
   straight into the join flow, code pre-filled → sets name → **remote lobby** (§4.2c).
4. **Start.** Host starts the match. Every participant's browser renders the **same arena**
   (shared seed, §5) with **all cars** moving (broadcast transforms, §5). Each Driver
   controls their own car; the camera follows *their* car. Pure Viewers get auto/free cam.
5. **During play.** Independent screens: own car clearly marked (bead `.6`, *critical* now
   that everyone has their own camera), own HUD, own camera mode. Host machine is source of
   truth; others mirror with light prediction on the local car.
6. **Match end → replay.** Results on every screen. Host starts another match in the *same*
   room (rejoinable, §4.4) — nobody re-shares the link, everyone stays put.

#### 4.2a Invite panel (UI spec)

Overlay on the host's game/lobby screen, front-page styled (neon border, glass, pill
buttons):
- **Room code** — large, with copy-to-clipboard.
- **Copy invite link** — copies `https://…/join/<CODE>`; toast "Copied!".
- **Share** — `navigator.share` where available (mobile share sheet); fallback to copy.
- **QR** — toggleable, points at the join URL.

#### 4.2b Driver input methods (was undefined — critical)

A laptop Driver has no touchscreen. Define input per device:
- **Touch (phone):** existing joystick + pedals + fire (Local and Remote).
- **Keyboard (desktop, Remote):** arrows/WASD steer, ↑/W accelerate, ↓/S brake, Space fire.
  A buried keyboard handler already exists (`player.js` ~:1364–1394) — surface it, make it
  primary on large screens, and **show a controls legend** in the remote lobby + a small
  persistent hint in-game: `[← →] Steer  [↑] Go  [↓] Brake  [Space] Fire`.
- **Auto-detect default:** keyboard for large viewports, touch for phones; allow either.
- **Spectators:** no input; camera auto/free.

#### 4.2c Remote lobby (distinct from Local waiting room)

- **Player list:** "Who's here" + names + car colors.
- **Your car preview** with a clear **"YOU"** badge/glow (feeds bead `.6`).
- **Mode badge + expectation:** "RACE — you'll see your car (and everyone's) here, from your
  own camera."
- **Controls legend** (§4.2b) so the player knows how to drive *before* the match starts.
- Optional one-time "what is Remote mode" explainer (first visit).

### 4.3 Deep-link invite flow

- **Link shape:** path-style `/join/<CODE>` (clean) **and** keep `?room=CODE` back-compat.
  Optional `?mode=remote` hint (room's real mode is server-authoritative).
- **Open behaviour (≤2 taps):** route into join with code **pre-filled and hidden**; show
  *"You're joining a game with <Host Name>. Set your name:"* (host name fetched if available);
  user enters/accepts a name → **Join** → lobby.
- **Share affordances:** copy-link + `navigator.share` + QR (host panel §4.2a; any Remote
  participant's menu).
- **Failure states — neon-styled, never a dead end** (always a button, never just text):
  - Room full → *"That game's full. [Spectate] · [Create your own]"*
  - Room ended / not found → *"That game ended or the host left. [Host a game] · [Try another code]"*
  - Invalid/expired code → *"That code doesn't exist. [Create your own]"*
- **Mid-session join:** a link must drop a latecomer into a live room (late joins already
  allowed during `racing`). Host spawns them in a safe zone; viewers mark them "late/new".

### 4.4 Rejoin / reconnect — systems **and** what the user sees

- **Durable identity.** Issue a per-device **player token** in `localStorage`
  (`jammers_player_token`), independent of socket/room. Server keys per-player state by it.
  **Reconcile with the existing monotonic `player_id`:** within a room, a token maps to a
  stable seat/`player_id`; new players still get a `next_player_id`. Accept the old per-room
  `reconnect_id` (sessionStorage) as a fallback so deployed clients keep working (§6.5 covers
  token spoofing/scope).
- **User-visible states (designed, not incidental):**
  - *Own connection drops:* "Connection lost — reconnecting…" (spinner); auto-resume to the
    same car if the host is alive.
  - *Host drops (Remote):* all viewers see "Host disconnected — game paused, waiting…"; on a
    timeout (grace window, §6) → "Host didn't return. [View results] · [Leave]"; on recovery
    → "Host's back! Resuming."
  - *After a match:* host "Return to lobby" returns players to the lobby ("Ready for another
    round?"), not a kick.
- **Cleanup.** Abandoned rooms (no host + no participants past a timeout) are reaped (§6.6).

---

## 5. Technical design — Remote viewer rendering

Four pieces, with the verified gaps:

1. **Shared procedural seed (determinism gap is real).** `ProceduralTrackGenerator.js:~145`
   falls back to `Math.random()` — make **seed required** for viewer-bound generation (fail
   loud if missing). Seed lifecycle: host generates/derives a seed (e.g. from room + mode) at
   start, stores it on the room, and the server includes `{seed, mode, arenaParams}` in
   `game_started` **and** sends it to late joiners on (re)connect. Audit *all* generators
   (track, derby arena, decorations) for hidden `Math.random()`/`Date.now()`.
2. **Full transform broadcast.** Enrich `_buildVehicleStates` (`GameHost.js:~1354`) with per
   car `position{x,y,z}` + `rotation` (quaternion `[x,y,z,w]`) alongside existing HUD fields,
   read from `vehicle.mesh.position/.quaternion`. Relay already fans to all; update
   `player.js:567` to consume **all** cars, not just self. Rate ~10–20 Hz to start.
3. **Viewer render scene — separate class, do not reuse GameHost.** GameHost is coupled to
   physics/input/damage/weapons. Build a lightweight **`ViewerGameHost`** (~200–300 LOC) that
   reuses `Engine` / `RenderSystem` / `ResourceLoader` / track factory but **skips**
   PhysicsSystem/InputSystem/DamageSystem/WeaponSystem: build arena from seed, spawn a
   physics-less car mesh per `id`, interpolate toward incoming transforms, render. Camera
   follows the local Driver's car; Viewers get auto/free cam.
4. **Own-car responsiveness.** v1: pure mirror (snap to host state — ship it). v2:
   client-side prediction/interpolation for the local car to hide latency. Keep the split so
   v1 isn't blocked on prediction. Add transform **interpolation** (lerp between last two
   snapshots) so motion is smooth at 60fps over ~10–20 Hz updates; snap on large desync.

**Scaling:** fanout cost grows with participants (Socket.IO emits N times per room). Start
flat-rate; if it strains, add delta-encoding + reduced rate for distant/non-local cars +
sequence numbers for drop detection. **Measure, don't pre-optimize** (no per-frame logging —
use counters/overlay).

---

## 6. Host authority, migration & failure

Today host disconnect = **instant room delete** (`server/app.py` ~:647–650) — directly
conflicts with a grace window. Required changes:

- **v1 (graceful):** on host disconnect, **don't delete**; set `host_sid=None` +
  `host_lost_time`, emit `host_disconnected`, keep the room alive for a grace window (~30s)
  so the host can `reclaim_room`. On lapse, end the match cleanly back to a preserved lobby
  and let the reaper (§6.6) collect it. Snapshot last-known `vehicle_states` on host loss to
  enable both clean results and future migration.
- **v2 (migration):** elect a new host from connected Drivers; seed its sim from the snapshot
  and resume. Hard — explicitly deferred, but the snapshot in v1 keeps the door open.

### 6.5 Security & abuse hardening (gates public Remote)

- **Input authorization (CRITICAL).** `player_control_update` (app.py:~391) trusts
  client-supplied `player_id` → a client can drive *another* player's car. Verify the
  sender's socket actually owns the claimed `player_id` before relaying; reject + log
  otherwise. Apply the same ownership check to `request_car_reset`/`reset_position` and
  `weapon_fire`/`weapon_fired`.
- **Vehicle-state validation.** `handle_vehicle_states` relays arbitrary payloads. Confirm
  sender is the room host; drop NaN/out-of-bounds positions before fanout (cheap, protects
  viewer renderers).
- **Room-code brute force.** 4 letters = 456,976 codes. For public Remote, lengthen codes
  (5–6 chars) and rate-limit `join_game` per IP (e.g. 10/min) with logging. LAN/Local can
  keep 4.
- **Token spoofing/scope.** `localStorage` tokens are XSS-readable; scope state by
  `{token, room_code}`, treat tokens as opaque, and don't let a token claim a seat in a room
  it never joined.

### 6.6 Ops & resilience (for a public Remote server)

- **Room TTL + reaping.** Track `created_time` + `last_activity_time`; a background sweep
  reaps idle rooms (waiting-but-empty, finished-and-abandoned, host-lost-past-grace) so
  `game_rooms` doesn't grow unbounded. Tunable via env.
- **Server-restart resilience.** All rooms die on restart (in-memory). Acceptable for v1;
  note it. If Remote uptime matters, consider file/Redis-backed room snapshots later.
- **Observability.** Extend `/health` (or add `/metrics`): rooms by state, player counts,
  join failures, spoof rejections, host losses. No per-frame logging.

---

## 7. Design & asset alignment (parallel stream)

Interleaved because Remote adds *new* surfaces (Create-Room screen, invite panel, remote
lobby, viewer HUD, spectator UI) that should be born on-brand:

- Restyle existing surfaces (controller, host lobby, HUD, results) to the front-page
  aesthetic — tokens/glows/glass/pills/gradients (`docs/design-brief.md`); new Remote
  surfaces use the system from day one.
- **Assets:** car models; **own-car identification** (marker/arrow/nameplate in the player's
  color — critical for per-player cameras in Remote); car customization (color/skin persisted
  via player token); pickup models; usability/onboarding (Local-vs-Remote explainer at the
  decision point; spectator affordances; reconnect/host-loss copy).

---

## 8. Work breakdown → beads (dependency-ordered)

| Bead | Title | Depends on | Key refinements from this plan |
|---|---|---|---|
| `.1` | Game-mode architecture (Local/Remote, roles) | — | Add `mode_kind` to room + **Create-Room mode-choice screen** (§4.0); name roles; refactor current flow into Local, no UX change. |
| `.3` | Rejoinable rooms (durable token, reconnect, persist) | `.1` | Durable `localStorage` token reconciled with monotonic `player_id`; **host-loss grace window** + room snapshot (§6); **room TTL/reaping** (§6.6); user-visible reconnect states (§4.4). |
| `.2` | Remote Play mode | `.1`, `.3` | **Seed broadcast + generator determinism** (§5.1); **full transform payload** (§5.2); **separate `ViewerGameHost`** (§5.3); **driver keyboard input + legend** (§4.2b); interpolation; pure-mirror v1. |
| `.4` | Deep-link invites | `.1`, `.3` | `/join/<CODE>`; pre-filled+hidden code; **failure-state copy**; mid-session join; invite panel (§4.2a). |
| `.11`*| Security & abuse hardening | `.1` | **NEW** — input authorization (anti-spoof), vehicle-state validation, code length + join rate-limit, token scope (§6.5). Gates public Remote. |
| `.5` | In-game design alignment | — (parallel) | §7; re-check vs live landing; style new Remote surfaces. |
| `.6` | Own-car identification | rel `.8` | Elevated for Remote (per-player cameras); also label "YOU" in remote lobby. |
| `.7` | Car models | — | Asset work. |
| `.8` | Car customization | rel `.3` | Persist via durable token. |
| `.9` | Pickup models | — | Asset work. |
| `.10`| Usability / learn-to-play | — | Local-vs-Remote explainer; spectator affordances; reconnect/host-loss copy; controls legend. |

\* `.11` is proposed-new in this round; create it when polishing beads.

**Sequence:** `.1` → (`.3` ∥ `.11` ∥ `.5`/`.6`/`.7`/`.8`) → `.2` → `.4`. Assets/design run
in parallel throughout. `.11` (security) blocks any **public** Remote test.

---

## 9. Open decisions (need a human call)

1. **Remote host model** — adopt **host-as-player** (recommended in §3) vs pure host screen +
   everyone joins as Driver-Viewer. Drives `.1`/`.2`.
2. **Spectators in v1** — ship pure-Viewer spectating now (adds a "Watch/Drive" choice in the
   join flow) vs Drivers-only first.
3. **Remote deploy target** — internet Remote needs a publicly reachable server. Is
   `jammers.dilger.dev` the canonical Remote host? (Decides whether `.11` security work is
   mandatory-now vs LAN-deferred.)
4. **Identity scope** — anonymous device token only (recommended for a no-install party game)
   vs optional accounts later.

---

## 10. Test strategy

- **Local regression:** `full-game.spec.ts` passes unchanged under explicit Local mode.
- **Determinism:** same seed → byte-identical arena geometry across two viewer instances
  (unit test the generators).
- **Remote E2E:** two browser contexts (host + remote driver) → same arena both screens, all
  cars move on both, own car identifiable, keyboard drives on desktop; drop the remote driver
  and rejoin to the same seat; finish a match and start another in the same room.
- **Host-loss:** kill host mid-match → viewers see paused state; host `reclaim_room` within
  grace → resume; past grace → clean results, room reaped.
- **Deep-link:** `/join/<CODE>` → lobby in ≤2 taps; room-full / room-ended → styled fallback
  with a working CTA, never a dead end.
- **Security:** a client spoofing another `player_id` is rejected; out-of-bounds vehicle
  state is dropped; join rate-limit triggers.
- Project rules: `npm run build` before browser/E2E; **no per-frame logging**; verify visuals
  via headed Playwright/screenshots.
```
