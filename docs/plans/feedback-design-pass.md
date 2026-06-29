# Joystick Jammers — Feedback Design Pass

> **Status:** v1 — **validated (3 passes, 8 agent reviews across Claude + Codex, incl. a Jeff
> harness-grounding pass; steady-state — see §15/§16)**, with owner pre-polish decisions folded in
> on 2026-06-29. Built from the 29 captured To-Do subtasks
> (`docs/plans/feedback-captured-2026-06-28.md`), a verified code map of the live game, the
> aesthetic source of truth (`docs/design-brief.md`), and the existing remote-play plan
> (`docs/plans/game-modes-and-flows.md`).
>
> **Method (Jeff Emanuel planning workflow):** front-load reasoning, keep it self-contained,
> ground every claim in `file:line`, give *options* with trade-offs and a recommendation per
> item, and make each item testable. This document is the reasoning artifact; implementation
> beads derive from §13.
>
> **How to read:** §1–§3 set context and principles. §4 maps the 29 items to themes. §5–§13 are
> the design themes — each item gets: *Problem (grounded)* → *Root cause* (if a bug) → *Options*
> → *Recommendation* → *Test*. §12 is the test/sim/playtest harness the whole plan leans on.
> §14 lists owner-resolved decisions plus the remaining human/playtest calls.
>
> **Research folded in (2026-06-28):** a `/deep-research` pass (24 verified claims) is integrated;
> citations and the honest list of *unverified* sub-topics live in `research-brief-2026-06-28.md`.
> Items marked *"first-principles"* are deliberate engineering judgment the research could **not**
> corroborate (wall-slide deflection, steering-assist ranges, TV label sizing, weapon recipes,
> named-title balance) — they are settled by the §12 harness + playtest, not by citation.

---

## 1. Goal & why

The game works and is fun in bursts, but a wave of hands-on feedback says the **presentation,
controls, physics feel, map reliability, and onboarding** aren't yet at the bar where a stranger
can walk up to a TV, scan a code, and *immediately* have a great time — and where many friends
(local **or** remote, up to "60 players and it sucks, let them be free") can pile in without
friction. The 29 items are overwhelmingly about **feel and clarity at the big-screen + many-player
scale**, plus a cluster of **map geometry bugs** and a smaller **business/identity** strand.

This pass turns that raw feedback into a single, validated design surface: concrete options for
each item, the bugs' root causes (several already found in code), and — critically — **a way to
test physics and feel empirically instead of by vibes**, because "friction too aggressive",
"suspension bouncy", "auto-steer", "camera angle clearer" are all tuning problems that deserve
measurement, not guesswork (this is also a standing CLAUDE.md rule: *don't multiply values by
1000 to make it work — investigate root cause*).

---

## 2. Current architecture (verified foundation)

Condensed from a full code map (each line carries a real anchor; the §5–§11 themes cite more).

- **Render / camera** — single Three.js `PerspectiveCamera` (`RenderSystem.js:249`). Three modes
  (`party`/`chase`/`hood`, `RenderSystem.js:51-75`); `party` auto-frames all cars via a
  bounding-box fit (`RenderSystem.js:687-746`, `baseCameraHeight=15`, `baseCameraDepth=20`,
  FOV 45–68). **No `setViewport`/`setScissor` anywhere — no split-screen exists.** Name labels
  are **DOM overlays**, distance-scaled `0.6–1.2×` with a hard pixel font (`RenderSystem.js:547-591`,
  scale formula `:587`). Mode switch via buttons + keys `C`/`V`, persisted `jj_camera_mode`
  (`GameHost.js:287-319`). HUD font sizes are **hardcoded px** (`RaceUI.js` timer 28px:158,
  lap 24px:167, countdown 200px:206, speed 48px:186).
- **Input / controller** — left horizontal joystick = steer, right pedals = accel/brake
  (`player.js:1329-1349`, `Joystick.js`), center **triangle** fire button
  (`player.css:560`, clip-path polygon). Keyboard = arrows only (`player.js:1364-1394`, a
  **duplicate** global handler at `:1826-1856`). `InputManager.js` (gamepad) and
  `TouchController.js` (tilt) exist but are **never instantiated** (dead/reference code). Tutorial
  is a spotlight-step system (`player.js:197-232, 417-466`) — **no animated "ghost" gesture demo**.
  Inputs emit `player_control_update` at 60 Hz → server validates/relays to host
  (`player.js:1554-1617`, `app.py:384-426`).
- **Vehicle physics (Rapier)** — `DynamicRayCastVehicleController` (`PhysicsSystem.js:642-664`).
  Tunables in `static/assets/vehicles/default.json` and live-editable via the **F2 panel**
  (`PhysicsTuningUI.js`): engineForce 200, brakeForce 50, frictionSlip 1000, steering maxAngle
  0.38 / highSpeedReduction 0.45 / smoothing 0.3, suspensionStiffness 30, wallSlideGrip 0.2,
  mass 32. Wall barriers use **friction 0.15, `CombineRule.Min`** (`PhysicsSystem.js:406-416`);
  a **wall-slide** feature drops frictionSlip to `wallSlideGrip` (0.2) on contact
  (`:799-806`). Flip recovery: up-vector `<0.35` for `2.5 s` → auto-right (`GameHost.js:1378-1432`).
  `Track.isOutOfBounds()` exists (`Track.js:320`) but only race-respawn-on-destroy consumes it.
  Damage is collision-event based; ground does not damage (`DamageSystem.js:128-181`).
- **Tracks / arenas** — procedural circuits via Catmull-Rom spline over 9–12 radial control points
  (`ProceduralTrackGenerator.js:145-287`; seed fallback `Math.random()` at `:146`). Derby arenas
  are JSON (`static/assets/tracks/derby-*.json`) + a square/bowl/dunes barrier builder. Lobby
  dropdown selects track/arena (`LobbyUI.js:613-633`).
- **Audio** — fully synthesized Web Audio: weapons in `audioManager.js` (missile `:783-822`,
  explosion `:828-869`), 5-gear engine synth (`audio/EngineSynth.js`).
- **Networking** — host-authoritative, server-as-relay; rooms in-memory, **deleted on host
  disconnect**; `disconnected_players` holds racing dropouts 5 min; reconnect via per-room
  `reconnect_id` (sessionStorage). **No hard player cap server-side** (verified — the real limits
  are spawn-slot count, e.g. 16 in derby JSON, and client perf).
- **Existing plan overlap** — `docs/plans/game-modes-and-flows.md` already designs Local vs Remote
  modes, deep-link invites, durable tokens, host-loss grace. Item 2 and item 24 below **defer to
  and extend** that plan rather than re-deriving it.

**Map-surfaced findings** (detailed in §8; ✅ = confirmed bug, re-verified against source by a Codex
review pass; ⚠ = investigated and found *not* a bug):
1. ✅ **Circular curb collider rotated by `angle` (θ) when the code's own comment says the tangent is
   `θ+π/2`** (`PhysicsSystem.js:438` comment vs `:443` `setRotation(_eulerToQuat(0, angle, 0))`) — the
   collider's long axis points radially, not tangentially → jagged, "not circular", catches cars. Item
   **8** *and* a prime suspect for **27**/**28**. **Fix is *not* a blind `+π/2`** — this file's yaw
   convention maps local-X with a negative-Z sign, so derive yaw from the tangent
   (`atan2(-tangent.z, tangent.x)`) and guard with a `longAxis·radius ≈ 0` invariant (§8.1, §12.3).
2. ⚠ **Spline edge-barrier yaw — NOT a confirmed bug (downgraded).** `atan2(-dz, dx)`
   (`PhysicsSystem.js:378`) is the *correct* formula to align the collider's local-X with an X/Z
   segment under the Three/Rapier Y-rotation convention, and matches the start-line convention
   (`TrackFactory.js:503`). Item **27** "inverted corners" is explained by bug #1 (the curb), not this.
   Keep an invariant test here, but as *coverage*, not a known break.
3. ✅ **Derby shrink scales the wall *mesh* only, not the collider** (`DerbySystem.js:381`) →
   visual/physics desync. Note: the scaled object (`track.barriers[0]`) is usually a **`THREE.Group`**,
   not a mesh (`TrackFactory.js:611,665`), so the glow-material update (`DerbySystem.js:384`) is *also*
   unreliable, and `DerbySystem.setWallCollider()` (`:187`) is **dead API** never wired. Item **5**.
4. ✅ **Checkpoints are axis-aligned boxes with no tangent orientation** (`Track.js:204-216`,
   "Simple box check"; procedural checkpoints store no tangent at `ProceduralTrackGenerator.js:206`)
   → on curves they misalign with car flow. **Also: detection ignores Y entirely** (`Track.js:204`
   takes `{x,y,z}` but only tests `dx<halfWidth && dz<halfWidth`), so airborne/under-track cars can
   trigger checkpoints. Item **5**.
5. ✅ **Loading spinner never auto-dismisses / has no skip** (`host/index.html:243-246`) → item **10**.
6. ✅ **QR overlay `z-index:1000` bottom-left can cover the HUD** (`RoomCodeOverlayUI.js:74-85`) → item **11**.
7. ✅ **Derby inward push is frame-rate dependent** — `pushForce = 10` applied per update without
   `dt` scaling (`DerbySystem.js:397`); violates the CLAUDE.md frame-rate-independence intent → item **5**.

---

## 3. Design principles (the bar every option is measured against)

1. **Walk-up-and-play.** A first-timer should be driving within ~10 s of scanning, with zero
   reading. Onboarding teaches by *doing* (animated demos), not text walls.
2. **Readable from the couch.** The big screen is viewed from 2–4 m away. Everything — cars,
   names, HUD, the action — must be legible at that distance, scaling to 1080p **and** 4K TVs.
   "Current scales are BAD" (item 20) is the headline; treat TV legibility as a first-class target.
3. **Chaos that's fair.** Many players + weapons = chaos; lean in, but keep comebacks possible and
   skill rewarded. Research-backed catch-up = **rubber-banding** (temporarily boost trailing
   players and/or inhibit the leader) — not random griefing. (Named-title weapon-balance/pacing
   specifics and chaos-vs-skill ratios were *not* verified; treat tuning as playtest-driven, §12.5.)
4. **Feel is tuned, not guessed.** Every "feel" change (friction, suspension, steering assist,
   camera angle, zoom) is exposed as a parameter and validated against an objective metric in the
   sim harness (§12) before it's called done.
5. **One visual world.** Every surface obeys `docs/design-brief.md` (neon/Tron, glass panels, pill
   buttons, glows). New surfaces (scheme picker, settings, splitscreen frames) are born on-brand.
6. **No player caps, graceful degradation.** "Let the players be free" — never block a join on a
   count; instead degrade quality (fewer viewports, simpler cars) as N grows.
7. **Reversible & data-driven.** Prefer config (JSON / scheme data / tunables) over hardcoded
   values, so options can be A/B'd and playtested without code changes.
8. **Every debug/visual aid is a togglable in-game setting.** Anything we add as a debug overlay or
   visual aid (collider debug-draw, geometry debug-render, name-tag/identity overlays, camera
   target-size guides, FX toggles, the asset-viewer's switches) ships with a **corresponding menu
   entry to turn it on/off** — gathered under a **debug panel** (extend the existing F2 panel), with an
   eventual single **debug-enable mode / feature flag** to gate the whole set for testing. Default: wire
   *everything* configurable now; flag-gate later. (New bead `FB-debugmenu`.)
9. **Verify *correctness*, not just *presence* — and never silently assume a coordinate.** The
   headlight mix-up (placed at an *assumed* "forward = −Z" and screenshot-checked only for "does it
   glow") is the §8.0 bug-class at the tooling layer: a check that confirms a feature *renders* but not
   that it's *semantically right*. Verification must assert placement/orientation against a **known,
   explicit reference** (e.g. a forward-axis the model declares), and any forward/handedness assumption
   must be **made explicit and visually indicated**, not baked into a sign. (Forward axis is a
   convention the asset normalization establishes — §11.5 `FB-assetnorm` — not a runtime guess.)

---

## 4. Feedback → theme map

| # | Item (abbrev) | Theme | Section |
|---|---|---|---|
| 17 | Camera clearer/higher angle, big-screen | A. Camera & presentation | §5 |
| 18 | Split camera when cars too far | A | §5 |
| 19 | Full n-player dynamic splitscreen grid | A | §5 |
| 20 | Bigger setup for big screens (scales BAD) | A | §5 |
| 21 | Names & badges much bigger | A | §5 |
| 22 | Switch camera modes in settings | A | §5 |
| 23 | Derby default ONE overhead, aggressive zoom, higher angle | A | §5 |
| 13 | Better tutorial + LHS "ghost" move demo | B. Controllers & input | §6 |
| 14 | LHS fwd/back shooting instead of fire triangle | B | §6 |
| 15 | RHS accel fwd/back stick | B | §6 |
| 16 | Configurable control schemes + per-scheme tutorial | B | §6 |
| 29 | Keyboard schemes, any N keyboards, no caps | B | §6 |
| 25 | Automatic out-of-bounds reset (like flipping) | C. Physics & feel | §7 |
| 28 | Boundary friction / deflection / bouncy / auto-steer | C | §7 |
| 5 | Fix bugs with maps | D. Maps & tracks | §8 |
| 6 | Better map system | D | §8 |
| 8 | Fix curb | D | §8 |
| 27 | Corners of generated maps inverted | D | §8 |
| 9 | Fix scrolly join window + transparent | E. Join/onboarding UX | §9 |
| 10 | Fix spinners on start, skip them | E | §9 |
| 11 | Hide in-progress join QR in lobby | E | §9 |
| 12 | Join screen no scrolling, nav buttons only | E | §9 |
| 2 | Invite system: controller-only vs remote-screen | F. Multiplayer flow | §10 |
| 24 | Rejoin weak / stuck; DC'd car transparent | F | §10 |
| 26 | Gun sounds bad, esp. homing missile | G. Audio | §11 |
| 7 | Actual game assets | H. Assets | §11.5 |
| 1 | Account / pay-once-offline / $6-mo-online | I. Identity & business | §11.6 |
| 3 | Account system? | I | §11.6 |
| 4 | Bug tracker | I | §11.6 |

---

## 5. Theme A — Camera & big-screen presentation (items 17–23)

This is the single highest-leverage theme: it's what everyone sees, and "scales are BAD" + "names
bigger" + "camera angle clearer" are blunt signals the current view doesn't read from a couch. The
seven items are really **three** systems: (1) a **presentation-scale / TV-mode** pass, (2) a
**dynamic multi-viewport camera director**, (3) **mode selection & per-mode defaults** (incl. the
derby overhead). 18 and 19 are the *same* system at different thresholds.

### 5.1 Big-screen scaling & legibility (items 17, 20, 21)

**Problem (grounded).** HUD font sizes and paddings are hardcoded px (`RaceUI.js:158/167/186/206/244`),
so on a 4K TV they're physically tiny; the camera sits at a shallow ~37° look-down
(`height 15 / depth 20`, `RenderSystem.js:88-89`) which flattens cars against the track and makes
spatial relationships hard to read at distance; name tags shrink to `0.6×` of a 12px font far away
(`RenderSystem.js:587`), i.e. ~7px — invisible across a room.

**Options.**
- **A1a — Presentation scale token.** Introduce a single `presentationScale` derived from viewport
  size (e.g. `clamp(1, vmin/600, 2.5)`) and drive *all* HUD typography/padding off `clamp()`/`vmin`
  units instead of px. One change fixes "scales are BAD" across resolutions. Cheap, high impact.
- **A1b — Explicit "TV / Big-screen" mode.** A host-side toggle (auto-on when viewport ≥ ~1440p or
  when `?tv=1`) that bumps `presentationScale`, raises name-tag floor, thickens car outlines/markers,
  and enlarges countdown/positions. Lets the couch case be loud without bloating laptop play.
- **A1c — Higher camera angle-of-incidence.** Raise the height:depth ratio from ~0.75 to ~1.2–1.5
  (more top-down) so cars separate visually and the track reads as a map. Expose `cameraPitch` /
  height & depth as tunables; per-mode defaults (race steeper than chase). *(Research found no
  verified TV-specific angle-of-incidence/label-sizing heuristics — this is first-principles; settle
  via the §12.4 visual harness at 1080p and 4K.)*
- **A1d — Labels at *constant screen-space size*, not world-distance-scaled (the actual fix).** The
  root cause is `scale = 0.6..1.2 × (35/distance)` (`RenderSystem.js:587`): identity shrinks with
  distance exactly when you need it. Replace with **billboarded sprites sized in screen pixels** (NDC /
  CSS px), clamped to a viewport-relative band — **floor `clamp(18px, 2.2vmin, 40px)`** so a 4K TV gets
  big labels and a phone-controller stays sane — *independent of how far the car is*. This is the
  "names & badges much bigger" (item 21) fix, and it's a prerequisite for splitscreen (DOM overlays
  don't know about viewports, §5.2).
- **A1e — Importance scaling + declutter (so it's readable, not a text wall at N players).**
  - **Importance:** your own label renders **1.3–1.5× larger + brighter** than others (see §5.4);
    leader/last-place get a subtle bump; on a hit/overtake a label can briefly enlarge then settle.
  - **Declutter:** when projected labels overlap, fade/shrink the *lower-priority, farther* ones and
    keep own + nearest; never stack >~K legible labels in one region. (Greedy screen-space collision
    pass each frame — cheap.)
  - **Legibility treatment:** dark pill + bright bold text + 1px outline/halo so it reads over the
    neon track regardless of what's behind it (design-brief); car-color as the pill border/glow, not
    the text fill (colored text on a neon bg is the unreadable case).

**Recommendation.** A1a + A1c now (loudest complaints), A1b umbrella toggle, **A1d is the real
label-size fix and should land in Wave 1 with `FB-names`** (it's a small, self-contained change to the
existing tag code, doesn't need splitscreen first); A1e folds in alongside.

**Test (readability gate, not just "≥ N px").** Headless visual harness at 1920×1080 **and** 3840×2160,
fixed seed, 8 *and* 24 cars: assert (a) **every** car's label rendered height ≥ floor px *regardless of
its distance* (this is what fails today); (b) own-car label is the largest; (c) **no more than K labels
overlap** in any screen region (declutter works); (d) all cars within frame; (e) HUD ≥ target % of
screen height. Measured via `boundingBox()` / projected size, not pixel-diff (§12.4).

### 5.2 Dynamic multi-viewport camera director (items 18, 19)

**Problem (grounded).** Today one camera must contain everyone (`party` mode), so as cars scatter it
zooms out until cars are specks — exactly when you most need to see them. There is no splitscreen
machinery at all (no `setViewport`/`setScissor`).

**Design — one director, three arbitrated mechanisms** (see the *revised recommendation* below; the
naïve "K viewports per cluster as default" is explicitly **rejected** by the research correction).
Each frame the `CameraDirector`:
1. Computes car clusters (single-linkage on world positions; two cars join a cluster if within
   `clusterRadius`), with hysteresis on the thresholds to avoid flicker.
2. **1 cluster →** single auto-framed viewport (today's behavior, A2a).
3. **2 clusters →** the elegant any-angle **2-player divider split** (A2b) — *not* a tiled grid.
4. **3+ clusters →** fall back to a **single auto-framed/overhead** view (A2a), **not** an
   auto-quadrant grid. The per-player tiled grid (A2c) is **opt-in only** (settings), rendered via
   `setViewport`/`setScissor`. So item 18 = the 2-cluster split; item 19 = the opt-in A2c grid.

**Research correction (important — changes the design).** A *fair* N-way split (equal-area,
direction-indicating, fusible, centered, continuous) is **mathematically impossible for 3+ players**
(Lenz, *Fair Voronoi Split-screen for N-Player Games*, EuroCG'18, Thm 2.3; see
`research-brief-2026-06-28.md`). So the elegant dynamic split is fundamentally a **2-player**
technique, and the crowd case must relax fairness. This *splits* the design into three distinct
mechanisms rather than one knob:

**Options for the split policy.**
- **A2a — Crowd default = single auto-framed camera (keep & polish).** For 3+ cars in one cluster,
  the right answer is *not* a tiled grid — it's the existing bounding-box `party` cam (or the §5.3
  overhead for derby), improved per §5.1 (higher angle, bigger labels, LOD). This is the
  research-backed default for "many players on one screen".
- **A2b — Elegant 2-player dynamic split (the LEGO move, done exactly).** When the scene resolves to
  **two** clusters, render a true any-angle split: two cameras → two viewports/render-targets → a
  **full-screen quad shader that chooses, per pixel, which texture to show**; the divider is the
  **perpendicular bisector** of the two cluster centers (one `arctan`). Cameras ride the segment
  between clusters — **midpoint when close → merge to one view; fixed distance when far → split**
  (hysteresis). This is item 18 done well, and it's cheap and exact.
- **A2c — Per-player equal-tile grid (opt-in "everyone gets a box", item 19).** K = N players in a
  reflowing equal-tile grid. Honest framing: this is an **unfair** layout (it gives up the
  direction-indicating/fusible properties the 2-player split has) and costs **N scene renders** — a
  chaos-mode toy, not the default. Cap N or degrade hard (principle 6).

**Cost & mitigation (feasibility-checked).** Each viewport re-renders the scene → draw calls × K, and
each car adds several meshes + 2 point lights (`VehicleFactory.js:127,275`); a Codex pass judged the
2-player split feasible but the **per-player grid not viable past ~8** without downgrading distant views
to **markers/LOD or remote-client rendering** (32 is not a browser/TV mode otherwise). Build
`CameraDirector` as **two implementations**, not one knob: (a) a 2-player **render-target divider
shader**, (b) a **scissor grid** — they do *not* share acceptance criteria. **Split-mode
post-processing policy:** `single = full composer`; `2-player = bloom reduced or off`; `grid = composer
off`. Note this trades against principle 5 (neon glow is core to the design-brief) — flag split/grid as
a deliberately lower-fidelity mode.

**Cross-system dependencies (review fixes).** (1) DOM name tags project through the single
`this.camera` + `window.innerWidth/Height` (`RenderSystem.js:547`) and **break under multiple
viewports** → **`FB-camdir` depends on `FB-names`** (world-space sprites must land *first*). (2) Define
**per-viewport HUD ownership** (does each split get its own speed/lap HUD?) and where the §9 QR overlay
renders in a split — currently undefined.

**Recommendation (revised).** `CameraDirector` arbitrates between **A2a** (1 cluster — default),
**A2b** (2 clusters — elegant split), and falls back to A2a (auto-frame everyone) for 3+ clusters
rather than an unfair multi-tile; expose **A2c** purely as an opt-in "grid" mode in settings (§5.3).
Build A2a polish + A2b first; A2c later behind a toggle.

**Full algorithm (the N>2 / item-19 case) → `gaps/camera-dynamic-split.md`.** A research-backed synthesis
gives the concrete pipeline **cluster → budget-cap → assign → tile → stabilize**: natural single-linkage
grouping by `mergeDist` → **capacitated (PACK-style) coarsen to viewport budget B** → K-policy tile
(K=1 full / K=2 LEGO bisector / **K≥3 squarified treemap** weighted by importance) → near-top-down angle
(collapses to 2D ground-plane partitioning) → hysteresis+debounce+lerp for no flicker. Items 18 & 19 are the
*same pipeline at different B*. Includes the worked 16-player {3 tight,4 medium,9 scattered}→K=4 example, the
verified novel link (capacity-constrained Voronoi ≡ optimal transport, deferred vs treemap), and decomposes
`FB-camdir` into **`FB-camcluster`/`FB-camtile`/`FB-camstable`**, all params wired to the A3d tuning panel.

**Test.** Unit-test the clustering/layout math (given car positions → expected K and viewport rects);
unit-test the 2-player divider == perpendicular bisector of the cluster centers;
Playwright snapshot the 1/2/4-way layouts at a fixed seed; sim-harness asserts no viewport thrash
(K changes < X per second) under scripted scatter-and-regroup.

### 5.3 Mode selection, settings, and derby overhead (items 22, 23)

**Problem (grounded).** Modes exist (`party/chase/hood`) and cycle via keys, but there's no
discoverable **settings** surface (item 22), and derby currently reuses the same follow logic when it
wants a single near-overhead, aggressively-zoomed, high-incidence camera (item 23).

**Options.**
- **A3a — Settings panel** (host-side, on-brand) exposing: camera mode (party / chase / hood /
  **auto-split** / **grid** / **overhead**), TV-mode toggle, camera pitch/zoom sliders, name-tag size.
  Persist per the existing `jj_camera_*` localStorage pattern.
- **A3b — Per-mode camera defaults as data.** A small config map (`cameraProfiles`) so Race defaults
  to auto-split-follow and **Derby defaults to `overhead`**: a single high camera centered on the
  arena, pitch near top-down, zoom tracking the *shrinking* arena (tie to `DerbySystem` diameter) so
  it stays tight as the bowl closes. This directly answers item 23.
- **A3c — Spectator/"director" auto-cam** that picks the most interesting cluster (most cars, recent
  hits) for pure viewers — nice-to-have, defer.
- **A3d — Live camera tuning panel (the complex params have no objective metric → tune them by hand).**
  The CameraDirector's hard-to-guess knobs — cluster/merge/split distances + hysteresis frames,
  `maxAutoViewports`, `targetCarScreenFraction`, per-mode pitch/zoom, treemap weights, smoothing — are
  exposed in a **live debug panel** (extends the existing F2 `PhysicsTuningUI` pattern; `localStorage`-
  persisted). Rationale (a real distinction): **physics** params are dialed by the §12.2 sim against
  *objective* metrics; **camera feel** has *no* objective metric, so it's settled by **playtest**
  (§12.5) with a live panel as the instrument. Ship sensible defaults as starting points, then dial by
  eye — *especially* for the Voronoi/split modes where we genuinely don't know the right values yet.
  Gated by `FB-debugmenu` (principle 8); owned by `FB-camset`. (Generalizes: any subjective/feel
  parameter we can't measure → expose + tune, never hardcode a guess.)

**Recommendation.** A3a + A3b. Derby overhead is a quick, high-satisfaction win and a good first
consumer of `cameraProfiles`.

**Test.** E2E: select each mode from settings → assert active camera matches; derby start → assert
overhead profile active and zoom follows arena diameter as it shrinks.

### 5.4 Car identity & "where's my car?" (items 21 + own-car ID — elevated to its own system)

**Problem.** This was under-served (folded into name tags). It's a distinct, hard problem at party
scale: every player must *instantly* find **their** car (after a respawn, a glance away, or a 24-car
pile-up), and everyone must tell cars apart — from across a room, at small on-screen size. **Color
alone fails:** distinguishable hues run out past ~8–12 cars, wash out at distance, and exclude ~8% of
players (colorblind). Current code has only a per-car color + a tiny name tag.

**Design — redundant, layered identity (no single cue carries it).**
- **Curated max-distinguishable palette**, not arbitrary RGB: ~12 hand-picked, mutually-distinct,
  colorblind-aware hues assigned round-robin; **beyond 12, identity rides the number/pattern**, not a
  near-duplicate color.
- **A bold roof number/letter on every car** — readable from the high/overhead camera (where most of
  the action is seen) even when the name tag is occluded or tiny. This is the workhorse cue.
- **The same number + color + name on the player's phone** ("you are **7**, green, *SpicyKoala*"), so
  there's a physical anchor: glance at phone → know what to look for on the TV.
- **Own-car emphasis (the "where's my car" fix):** your car gets a **pulsing chevron/arrow above it**
  + a brighter outline + larger label; the chevron is loud at round start and after respawn, then
  fades while you're clearly tracking it, and **re-asserts when your car is off-screen, idle, or just
  reset**. (This is the game-modes plan's own-car-ID bead `.6`, made concrete and elevated because
  per-player cameras in Remote/splitscreen make it critical.)
- **Off-screen indicator:** when your car leaves your viewport (scatter, splitscreen, big arena), a
  screen-edge arrow points to it with distance — so you're never lost.
- **Spectator/derby readability:** in the overhead derby cam, numbers + the curated palette do the
  identification; eliminated cars desaturate.

**Recommendation.** Ship **palette + phone mirror + own-car chevron + billboard nametag/number** as one
bead (`FB-carid`) early — high-impact for *every* mode, unblocks splitscreen/Remote readability;
off-screen arrows fold in with `FB-camdir`.

**Debug-viewer finding (2026-06-28) — billboard is primary, roof decal is secondary.** Testing both on
the CC0 models: a **constant-screen-size billboard nametag** (`Sprite`, `sizeAttenuation:false` →
readable from *any* angle incl. overhead, scales with viewport so bigger on a TV) is the reliable
cross-model cue. A **roof-number decal is model-dependent** — reads on flat roofs, but is small/occluded
from straight overhead on sloped-roof sports cars and **absent on open karts** — so it needs a
normalized **roof-number mount** per model (`FB-assetnorm`) and is *secondary*. Lead with the billboard
(number + name + color pill); add the roof decal only where the silhouette supports it.

**Test.** Visual harness: at 24 cars on 4K, every car's number is ≥ floor px and own-car chevron is
present; an automated check that no two on-screen cars share both color *and* number; controller E2E
asserts the phone shows the matching number/color; off-screen arrow appears when own car exits frame.

### 5.5 Car size & orientation across every camera mode (items 17, 18, 20, 23)

**Problem (owner-flagged).** Across the modes the camera was **(1) not aggressive enough on zoom** —
cars too small to read — and **(2) not high enough an angle** to actually *drive* (you can't judge a
car's position/heading from a shallow look). And the depth/orientation cues that should compensate —
**emissive trails, smoke, lights** — were **too faint to orient by**. (Tracks/front-lights help but
aren't enough.) This spans *all* the modes we're adding, so it's one cross-mode policy, not per-mode
guesswork.

**The unifying mechanic: frame to a *target car size*, and split before you shrink.** Today `party`
fits *everyone* in frame, so cars shrink to specks as they scatter. Replace "fit all" with a per-mode
**`targetCarScreenFraction`** — the minimum on-screen silhouette a car must occupy (fraction of
viewport min-dimension). The director drives zoom to *hold* that floor; **when the spread would force
cars below it, that's the trigger to split (§5.2) — never to zoom out into specks.** This is what makes
the zoom "aggressive" by construction. Plus a per-mode **`cameraPitch`** (angle of incidence) raised
enough to read X/Z position. Both are tunables (F2 + settings, §5.3).

| Mode | target car size | pitch / incidence | how you orient |
|---|---|---|---|
| **party** (crowd) | medium-large; clamp zoom-out, **split** rather than shrink | **raise to ~50–60°** (from today's ~37°) so the track reads as a map | trail + ground shadow + heading chevron + roof number |
| **chase** (follow) | own car dominant | low-ish (driving feel) | forward track, front lights, trail |
| **hood** (in-car) | n/a | ~horizon | track ahead (immersive; niche) |
| **overhead** (derby default, item 23) | large; **zoom tracks the shrinking arena** so cars stay big | **near top-down ~70–85°** | model read is lost top-down → leans hard on **roof number/color + heading chevron + trail** (§5.4) |
| **auto-split (2p) / grid (per-player)** | each viewport frames its cluster/player to the *same* target size | per-mode as above | same cues, per viewport |

**Orientation cues, scaled up so they actually read (the "particles not visible enough" fix).** At
higher/zoomed angles you trade model detail for map readability, so compensate with strong,
*size-independent* cues — and **scale their size/intensity with `presentationScale` and zoom** so they
hold up on a TV and when zoomed out:
- **Bloom-boosted emissive trails + smoke** — the `EffectComposer` bloom already exists
  (`RenderSystem.js:370`); drive trail width/emissive intensity off zoom distance so a far/zoomed car
  still leaves a legible glowing wake. Speed-scaled trail length doubles as a motion/heading cue.
- **A ground contact shadow / blob** under each car — at high angles this anchors the car to the track
  (the depth cue you lose when the camera goes top-down).
- **A heading chevron/arrow** on or just ahead of each car (loudest on own car, §5.4) — tells you which
  way a small/top-down car is pointing.
- **Front lights + car-color under-glow** — direction *and* identity, on-brand neon.

**Beads.** Target-size framing + per-mode pitch live in **`FB-camdir`/`FB-camset`** (the director owns
zoom/pitch); the cue work is **`FB-orient`** (trails/smoke/shadow/chevron/under-glow, scaled for
readability), which pairs with `FB-carid` (§5.4).

**Test.** Visual harness per mode at a scripted spread (8 and 24 cars, 1080p + 4K): assert each car's
silhouette ≥ `targetCarScreenFraction`; assert the **split triggers** exactly when the target can't be
met (not a zoom-out); assert orientation cues render (chevron present, trail/shadow visible, emissive
above a brightness floor); derby overhead holds car size as the arena shrinks.

---

## 6. Theme B — Controllers & input schemes (items 13–16, 29)

The throughline: **controls should be swappable, self-teaching, and uncapped**. Today there's one
hardwired layout (left-steer / right-pedals / center-fire-triangle) and arrows-only keyboard, with
two unused input modules already sitting in the tree.

### 6.1 A `ControlScheme` abstraction (items 14, 15, 16)

**Problem (grounded).** The controller layout is imperative DOM built in `initGameControls`
(`player.js:1272-1349`), the fire button is a fixed center triangle (`player.css:560`), and there's no
notion of selectable schemes. `InputManager.js` / `TouchController.js` exist but are never wired up.

**Design.** Define schemes as **data** — `{id, name, description, regions[], tutorial[], mapping}` —
and a renderer that builds the controller DOM + binds inputs from a scheme. Ship a small library:
- **Classic** (current): left steer joystick, right accel/brake pedals, center fire.
- **Twin-shooter** (items 14 + 15) — *steering must not be dropped (review fix)*: **left** stick =
  **steer on its horizontal axis** *and* fire forward/backward on its vertical axis (a press-up =
  fire-forward, press-down = fire-back, replacing the center triangle); **right** stick = 1-D throttle
  (up = forward, down = reverse/brake). (An earlier draft assigned the left stick purely to
  aim/shoot, which left nothing steering the car — corrected here.) **Rear-firing is a
  host-authoritative weapon change, not just an input remap** — `WeaponSystem` only fires forward
  today, so this scheme depends on a new directional-fire bead (`FB-rearfire`, §13), not only
  `FB-scheme`. Research supports the **left-moves / right-aims-fires
  half-screen** split (transfers from twin-stick shooters; large invisible zones maximize the active
  field). **Tension to resolve (principle 1):** dynamic/floating sticks and *invisible* zones test
  best for experienced players, but *visible/discoverable* controls (Mario Kart Tour style) test
  better for first-run learnability — which is our explicit goal. **Resolution:** show visible control
  hints/affordances that fade once the player is driving, over invisible active zones; static elements
  get a dead-zone so taps don't twitch the car. (gamedeveloper.com twin-stick usability; MDN mobile
  touch — both *secondary* sources, design-tradeoff not law.)
- **Pedals+aim**, **Tilt-steer** (reuse `TouchController` tilt), etc. as the library grows.

**Options.**
- **B1a — Scheme picker** in the waiting room + a quick-swap in the in-game menu; persisted per device
  token (ties to identity, §10/§11.6). Each scheme shows its **description** and a **tutorial** (§6.2).
- **B1b — Auto-suggest** a scheme by device (touch → Classic/Twin; physical keyboard → Keyboard scheme;
  gamepad → wire up the dormant `InputManager` gamepad path).
- **B1c — Delete the dead duplicate keyboard handler** (`player.js:1826-1856`) and the unused modules,
  or fold them into the scheme system so there's one input path.

**Recommendation.** B1a + B1b; reuse rather than delete (`TouchController` tilt, `InputManager`
gamepad) by adopting them as schemes; remove the *duplicate* keyboard handler to kill ambiguity.

**Test.** Unit-test scheme→mapping (input event → action). E2E: pick each scheme, drive a scripted
input, assert the host receives the expected `controls`. Playwright snapshot each scheme's layout.

### 6.2 Self-teaching tutorials with an animated "ghost" (item 13)

**Problem (grounded).** The tutorial is static spotlight cards (`player.js:417-466`) — it *points* at
the steering area but never *shows the motion*. Item 13 wants a left-side "ghost" that demonstrates
move-left-right.

**Design.** Per-scheme, scripted **ghost gestures**: a translucent thumb/knob that loops the actual
gesture (steer left↔right, hold-to-accelerate, swipe-to-shoot) over the real control, with a one-line
caption. Driven by the scheme's `tutorial[]` data so every scheme — including future ones — teaches
itself. Skippable, replayable (existing `jj_player_tutorial_done_v1` gate).

**Test.** E2E: first run shows ghost animation over `#steering-area`; assert element present and
animating; "Skip"/"Replay" work; completion persists.

### 6.3 Keyboard schemes & "no player caps" (item 29)

**Problem (grounded).** Keyboard is arrows-only (`player.js:1364-1394`). Item 29 wants WASD+arrows,
nearby keys for forward/back shooting, **any number of keyboards, no max**.

**Reality check & options.** A browser can't distinguish *which* physical keyboard sent a keydown, so
"N keyboards" resolves to two real patterns:
- **B3a — Many keyboard *players*, one machine, by key-region partitioning.** Player 1 = WASD + e.g.
  `Q`/`E` shoot; Player 2 = arrows + `,`/`.`; Player 3 = `IJKL` + `U`/`O`; … A keyboard scheme defines
  its key-set; multiple local keyboard players each pick a non-overlapping set. Practical up to ~3–4
  before keys collide / keyboard ghosting bites.
- **B3b — Many keyboard players, each their own browser/device** (the Remote-mode path, §10): every
  player opens `/player` on their own laptop and uses the full WASD scheme. This is the clean route to
  "60 players" and pairs with the existing Remote plan.
- **B3c — Remove any artificial cap.** Verified: no server-side player cap exists; the real limits are
  **spawn-slot count** (e.g. 16 in derby JSON) and client perf. Make spawn slots generate
  procedurally for arbitrary N, and degrade rendering (§5.2 principle 6) rather than block joins.

**Recommendation.** Ship the **Keyboard scheme** (WASD+arrows+shoot keys) as a first-class scheme
(B3a for couch-keyboard, B3b via Remote for scale), and audit/parameterize spawn generation so N is
unbounded (B3c).

**Test.** Unit: keyboard scheme maps WASD/arrows/shoot keys correctly; two key-region players don't
cross-fire. Load/E2E: spawn generator produces N non-overlapping spawns for N up to e.g. 64; the
32-Playwright-controller chaos test (already a project idea) extended as a soak test.

---

## 7. Theme C — Vehicle physics & feel (items 25, 28)

The crux of "feel". Item 28 bundles four asks — boundary deflection, "bouncy" suspension, auto-steer,
and curb-assisted steering — and item 25 wants OOB auto-reset. All are tuning/assist problems best
settled in the **sim harness** (§12), not by eyeballing.

### 7.1 Boundary feel: deflect, don't stop (item 28a)

**Problem (grounded).** Feedback: "friction on the boundaries is too aggressive, cars essentially stop
instead of being pushed around." Yet wall friction is *low* (0.15, `CombineRule.Min`,
`PhysicsSystem.js:406-416`) and a wall-slide feature already cuts frictionSlip to 0.2 on contact
(`:799-806`). So the stop isn't sliding friction — the likely culprits are: (i) the **inverted curb
collider** (§8.1, `PhysicsSystem.js:438-443`) presenting a jagged radial face that catches the chassis;
(ii) the **raycast tyres still pinning laterally** even at 0.2 slip when hitting near head-on; (iii)
**low restitution** so glancing hits don't deflect; (iv) the chassis collider's own friction (0.5)
biting on contact.

**Research lever (high confidence).** Rapier exposes **`side_friction_stiffness`** per wheel (added
v0.18.0) to tune **lateral/side** grip *independently* of longitudinal `friction_slip`; **low side
friction = more slide/drift**. And the API explicitly warns that **`friction_slip` set too high
causes "instantaneous braking"** — our value is **1000** (the arcade max from the three.js example),
which is a prime suspect for "cars stop dead." So the boundary feel has a cleaner lever than the
current "drop frictionSlip to 0.2 on contact" hack: **drop *side* friction on wall contact** to let
the car keep sliding forward while losing only lateral bite. **Confirmed available:** a Codex pass
verified `wheelSideFrictionStiffness(i)` / `setWheelSideFrictionStiffness(i, v)` are exposed in the
installed `@dimforge/rapier3d-compat@0.19.3` (`node_modules/.../control/ray_cast_vehicle_controller.d.ts:206`)
— so add a `sideFrictionStiffness` default to `default.json` and wire it into the F2 panel as a
first-class lever; no fallback needed.

**Options.**
- **C1a — Fix the curb collider first** (§8.1). Likely removes much of the "catch". Prerequisite.
- **C1b — Lateral-grip drop on wall contact (research-backed).** On `inWallContact`, reduce
  `side_friction_stiffness` (not just `friction_slip`) so the tyres stop pinning the car perpendicular
  to the wall and it slides *along* it keeping forward speed. Tunable; supersedes the current
  blunt frictionSlip×0.2.
- **C1c — Velocity redirection on wall contact.** Decompose chassis velocity into into-wall (normal)
  and along-wall (tangent); damp normal, preserve tangent (explicit "slide along the wall"). Use if
  C1b alone isn't enough; strength tunable.
- **C1d — Angled curb / banked rails** (the user's own suggestion: "small angled sections like a
  curb"). Replace/augment vertical race-edge walls with a low, outward-sloped curb surface (the derby
  **bowl wall** already does this at 30°, `PhysicsSystem.js:516-555`) that physically *ramps* the car
  back toward the track instead of a vertical stop. Most "arcade" feel; needs geometry + collider work.
- **C1e — Restitution bump** for glancing hits so contact nudges cars trackward.
- **C1f — Reconsider `frictionSlip 1000`** globally — the three.js arcade example uses 1000 for grip,
  but if cornering feels rail-locked, lateral slide should come from `side_friction_stiffness`, not
  from lowering `frictionSlip` (which would hurt acceleration). Settle in the sim harness (§12.2).

**Recommendation.** C1a (bug) → C1b (lateral-grip drop — cheap, research-backed, big feel win) →
C1d (angled curb — best feel, more work; do for race edges as the derby bowl proves it), with C1c/C1e
as tuning. All gated on sim-harness metrics ("speed retention grazing a wall at 30° ≥ target",
"time-stopped-against-wall ≈ 0").

### 7.2 Suspension bounciness (item 28b)

**Problem/Options.** "More suspension bouncy" = softer, livelier suspension. Rapier gives three
independent setters (research-confirmed): `setWheelSuspensionStiffness` (push harder — raise if it
doesn't hold the car up), `setWheelSuspensionCompression` (damping while compressing), and
`setWheelSuspensionRelaxation` (**raise to stop overshoot/bounce**, lower for more bounce). So
"bouncy" = lower stiffness and/or **lower relaxation** + more `maxTravel`. Lower `suspensionStiffness`
(from 30 — the three.js arcade example uses **24**) and/or raise `maxTravel` (0.3); tune
`relaxation`/`compression` (`default.json:113-116`). Expose `maxTravel`, `relaxation`, `compression`
in the F2 panel (currently only stiffness is live-tunable). Tune for a readable lean/squash on bumps
and landings without porpoising. Validate in sim (jump test: peak suspension travel, settle time, no
oscillation blow-up).

### 7.3 Steering assist / auto-steer (item 28c)

**Problem (grounded).** Only speed-sensitive lock + input smoothing exist (`PhysicsSystem.js:858-883`);
no assist. Item 28 wants "auto-steering type physics" — casual help.

**Options.**
- **C3a — Centerline/aim assist.** When steering input is light, bias heading toward the track
  tangent / next-checkpoint direction (race) or away from the nearest wall (derby). Strength
  configurable (0 = pure manual for skilled players). *(Research found no verified strength ranges for
  arcade steering assist — this is first-principles; dial strength in the sim harness, §12.2.)* Aside:
  our `steering.maxAngle` is **0.38 rad ≈ 22°**, much tighter than the three.js arcade example's
  **45°** — widening it is a cheap, separate responsiveness lever worth sweeping alongside assist.
- **C3b — Counter-steer near walls.** Add a small corrective yaw away from an imminent wall (works
  with C1b/C1c to keep casual drivers on track).
- **C3c — Assist as an accessibility/skill toggle**, surfaced in settings, default OFF unless playtest
  data earns a different default. The owner is skeptical of hidden auto-steering; treat it as an
  experiment, not as a product assumption.

**Recommendation.** Build C3a/C3c only as a **feature-flagged, playtest-gated candidate**, default OFF
for normal play until it wins a blind playtest. C3b stays folded into boundary work. Validate with two
tracks: (1) objective proof that the assist can help a no-steer-but-accelerate bot complete a lap, and
(2) human A/B proof that players feel more in control rather than patronized or "rail guided." If the
A/B result is mixed, ship the improved steering lock/side-friction/wall-deflection work without hidden
auto-steering.

### 7.4 Automatic out-of-bounds reset (item 25)

**Problem (grounded).** Flip recovery auto-rights after 2.5 s (`GameHost.js:1378-1432`), but there's
no symmetric handling for *out of bounds / fell off* — `Track.isOutOfBounds()` (`Track.js:320`) is only
used on race-destroy.

**Design.** Generalize the flip-recovery timer into a **recovery state machine** with multiple
triggers: flipped (existing), out-of-bounds (`isOutOfBounds` true), or below a **kill-plane Y**. After
`recoverSeconds` in any bad state → reset to last checkpoint / safe spawn facing forward, zero
velocity, with the same "recovering…" feedback.

**⚠ Mode branch (review fix — recovery vs. elimination).** In **Derby**, leaving the (shrinking)
arena is the *win/lose condition*, so OOB there must be an **elimination/damage event owned by
`DerbySystem`**, **never** a reset — otherwise the recovery machine would *resurrect a car that was
just pushed out*, undoing the elimination. So: *flipped-in-bounds* → self-right (both modes);
*out-of-arena in Derby* → eliminate; *OOB/kill-plane in Race* → respawn at last checkpoint. `FB-oob`
must branch on mode and must not fire while `DerbySystem` owns the boundary. Add a visible countdown
(race) / elimination feedback (derby) so neither feels like a freeze.

**Test.** Sim: drive a bot off the edge / below kill-plane → assert reset within `recoverSeconds` to a
valid on-track pose; never permanently lost. E2E: same, asserting the UX countdown shows.

> **All of §7 is the primary client of the physics-sim harness (§12.2): every parameter above gets a
> swept range and an objective pass/fail metric, so "feel" is dialed in by data, then confirmed by
> playtest — never by multiplying a number until it looks OK.**

---

## 8. Theme D — Maps & tracks (items 5, 6, 8, 27)

Two of these are **confirmed geometry bugs**; the other two are a quality/architecture push. But first
the *root-cause class* — because fixing individual rotations won't stop the next inverted apex.

### 8.0 The bug class & the generalised fix (the "inverted apex" pattern)

**Root cause (named).** The curb bug, the inverted-corner apexes, and the edge-barrier suspicion are
all the **same failure**: *orientation* (yaw / normal direction / winding) is **re-derived ad-hoc in
each builder** (`computeEdges`, `_createCircularBarrier`, `_createEdgeBarrier`, checkpoint placement,
spawn rotations…), each with its own `atan2`/sign, and **nothing ever renders the result to confirm the
math.** So a sign error survives — "we mess with coords and forget to visually check later." Fixing one
rotation leaves the rest of the family live. The fix is structural, two parts:

**Part A — One geometry frame as the single source of truth (kill ad-hoc orientation).**
- Compute the centerline once as a parametric curve, then derive a **per-sample frame {tangent,
  normal, up}** with **one** documented convention (centerline **canonicalized to CCW**; `normal` =
  tangent rotated +90° = the *outward* side). **Every** consumer — track ribbon, curbs, barriers,
  checkpoint gates, spawn rotations, banking — reads orientation from that frame. No builder recomputes
  yaw from raw coords. One correct definition, reused, eliminates the whole class.
- **Canonicalize winding** after generating control points (signed area → reverse if negative);
  inverted apexes frequently come from inconsistent winding flipping the normal on some segments.
- **Apex/offset specifically:** a naive normal-offset (curb/edge) self-intersects or flips on a sharp
  convex corner when the tangent rotates >90° between samples. Treat it as what it is — **polygon/curve
  offsetting** — with **miter handling + a self-intersection detect-and-repair** pass on the offset
  loop (or sample densely + clamp). This is the concrete fix for "some corner apexes are inverted."

**Part B — Make visual checking an automated gate, not a habit (so we *can't* forget).**
- A **headless top-down schematic render** of every generated track to a PNG per seed: centerline,
  left/right edges, **curbs drawn as their actual oriented rectangles** (so a wrong long-axis is
  *visible*), checkpoint gates as oriented lines, **normals as little arrows**, spawn positions as
  arrows. A reversed corner or a radial curb leaps out of the picture.
- A **golden-seed contact sheet**: render ~12 fixed seeds to one image, eyeball it **once**, then
  snapshot-lock it — so any future "mess with coords" change visibly breaks the gallery in CI.
- Backed by the §12.3 **invariants** (curb long-axis ⟂ tangent; normals point to the drivable side;
  no self-intersection; consistent winding; min corner radius) that fail the math automatically.
- **Standing principle (add to the geometry code's house rules):** *every geometry transform ships
  with both an invariant assertion **and** a line in the debug-render.* That's what converts
  "forgot to check" from a recurring bug into an impossible one.

This is the `FB-geoframe` foundation; `FB-curb`, `FB-checkpt`, and `FB-mapqual` (§8.4) build on it
rather than each re-deriving orientation.

### 8.1 Fix the curb (item 8) & inverted corners (item 27)

**Root cause — confirmed (curb) + corrected (spline).** `_createCircularBarrier`
(`PhysicsSystem.js:429-450`) places 48 box colliders around the circle but rotates each by the
**radial angle θ** while the code's own comment (`:438`) says the tangent is **θ + π/2**. So each curb
box's long axis points *outward* (radial) instead of *around* the circle (tangential): the ring of
curbs becomes a jagged cog, not a smooth band — exactly "curbs not circular" (item 8) and a contributor
to cars catching/stopping (§7.1). **This is the single root cause behind item 27 "inverted corners"
too** — the curbs, not the spline edges. *(Earlier-suspected `_createEdgeBarrier` yaw `atan2(-dz,dx)`
at `:378` was re-verified as **correct** for this Y-rotation convention — see §2 #2 — so it is not the
inversion source.)*

**Options.**
- **D1a — Correct the curb tangent rotation by deriving yaw from the tangent vector**
  (`atan2(-tangent.z, tangent.x)`, matching this file's negative-Z convention) — **not** a blind
  `θ+π/2`, which would be convention-fragile. Small, high-value fix; the highest ROI change in the
  backlog (touches items 8, 27, and 28a). Also fix the bugs in §2 #3/#4/#7 (derby Group/collider/
  dt, checkpoint-Y) in the same map-reliability sweep.
- **D1b — Geometry invariant tests** (§12.3): assert each curb collider's long axis is **⟂ its
  radius** (`longAxis·radius ≈ 0`); assert each edge-barrier normal points toward the **drivable
  side** (nearest centerline sample) — *per-edge* (inner edge points inward, outer outward), **not** a
  blanket "outward". The curb invariant *fails today* and pins the bug, then guards the fix.
- **D1c — Unify barrier construction** so spline/circular/square share one "place box along a tangent"
  helper, eliminating the per-shape sign mistakes.

**Recommendation.** D1a + D1b immediately (likely the cheapest, highest-impact fixes in the whole
backlog — they touch items 8, 27, and 28a at once), D1c as cleanup.

### 8.2 Derby shrink desync (part of item 5)

**Root cause — confirmed.** `DerbySystem` scales the wall **mesh** (`this.wallMesh.scale.set(...)`,
`:381`) but the **physics collider** stays full-size (built once in `PhysicsSystem`). Cars collide
with an invisible old wall or phase through the visible new one.

**Options.** D2a — rebuild/resize the wall collider in lockstep with the visual scale each shrink
step; or D2b — drive both from a single `arenaRadius(t)` source. Recommend D2b. Test: sim asserts a
car at the visual wall radius is in contact with a collider (no gap) at several shrink stages.

### 8.3 Checkpoint orientation (part of item 5)

**Root cause — confirmed.** Checkpoints are AABBs with no rotation (`Track.js:204-216`,
`ProceduralTrackGenerator.js:200-212`); on curved sections the box faces world axes, not track flow →
cars crossing at an angle can miss it or trigger the wrong one. Option: store each checkpoint's
**tangent** at generation and test crossing against an oriented gate (line-segment crossing along the
tangent), not an AABB. Test: a bot following the racing line crosses every checkpoint in order on
curvy seeds.

### 8.4 Better map system (item 6)

**Problem.** Procedural tracks regenerate non-deterministically (`Math.random` seed fallback `:146`),
geometry quality is uneven, and arenas are a mix of JSON + hardcoded builders.

**Options.**
- **D4a — Quality pass on the generator.** Guarantee non-self-intersecting closed loops. Our radial
  control points already avoid self-intersection; the **research-canonical** alternative for more
  varied shapes is **convex-hull-of-random-points → midpoint-displace hull edges → spline-interpolate**
  (bitesofcode / juangallostra). Add a minimum-corner-radius and minimum-width check + reject/retry;
  add banking on corners (ties to §7 feel), varied widths, and optional surface zones (ice/dirt) and
  hazards — already on the roadmap (`GAME_IMPROVEMENT_IDEAS.md`). For a future high-quality generator,
  **repulsive curves** (IEEE CoG 2024) grow a provably non-intersecting loop then add deliberate
  crossings/bridges in a separate stage. **All of this runs on the §8.0 geometry frame** (one
  orientation source) and is **gated by the §8.0 debug-render + invariants**, so richer generation
  can't reintroduce reversed apexes.
- **D4a′ — "Interesting", measured.** Don't just randomize — constrain for *fun*: a generated track
  must hit a **mix of corner types** (≥1 hairpin, some sweepers, ≥1 chicane), a **min/max corner
  radius**, **variable width** (pinch points + overtaking straights), and a target lap length;
  reject-and-retry seeds that fail. This makes "more interesting tracks" a checklist the generator
  satisfies, not a hope, and each criterion is assertable in the validator.
- **D4b — Data-driven tracks** (matches the architecture vision in CLAUDE.md): a track *spec* schema
  (control points or full geometry + curbs + checkpoints + surfaces + props) so tracks can be
  hand-authored, generated, *or* shared, and validated by one validator.
- **D4c — Deterministic seeding everywhere** (required seed, fail-loud on missing) — also unblocks
  Remote determinism (existing plan §5) and reproducible sim/visual tests.
- **D4d — A track validator** (§12.3) run in CI + at generation time: closed loop, no
  self-intersection, drivable min-width, curb tangency, checkpoint orientation, spawn validity.

**Recommendation.** D4c + D4d first (cheap, unlock testing & remote), then D4a quality, with D4b as the
target architecture the quality work migrates toward.

---

## 9. Theme E — Join / onboarding UX (items 9, 10, 11, 12)

Small surface, big first-impression impact. All four are concrete and mostly already root-caused.

- **Scrolly / non-transparent join (9, 12).** Cause: `.container` uses `overflow-y:auto` + flex with
  `margin:auto 0` (`player.css:31-43, 225-232`); the mobile soft-keyboard pushes content and the page
  scrolls. **Options:** (E1a) lock to `100dvh`, `overflow:hidden`, fit content; handle the keyboard via
  the `visualViewport` API (shift inputs into view without page scroll) — recommended; (E1b) convert
  join into **paged steps** (name → code → join) navigated by buttons (item 12's "only nav buttons");
  (E1c) make the panel translucent glass per design-brief (item 9). Recommend E1a + E1c, with E1b as
  the structure. **Test:** Playwright mobile viewport with focused input asserts `scrollY===0` and no
  overflow; visual snapshot confirms translucency.
- **Spinners on start (10).** Cause: `#loading-overlay` spinner has no auto-dismiss/skip
  (`host/index.html:243-246`). **Options:** (E2a) add a hard timeout + "Skip" button; (E2b) only show
  the spinner if init exceeds ~Xms (the recent caching/preload commit already shortened startup) and
  show *progress* not an infinite spinner; (E2c) preload further so the spinner rarely appears.
  Recommend E2b + E2a. **Test:** E2E asserts overlay auto-hides within a bound and Skip dismisses it.
- **QR overlay in lobby (11).** Cause: persistent overlay at `z-index:1000` bottom-left
  (`RoomCodeOverlayUI.js:74-85`) can cover the HUD; lobby also shows its own big QR. **Options:** a
  small **visibility state machine** — big QR *only* in lobby/waiting, small overlay *only* during
  racing (minimized, repositioned out of the lap-counter zone, lower z-index), never both. **Test:**
  E2E asserts overlay hidden in lobby and not overlapping HUD bounds during racing.

These pair naturally with the **design-alignment** stream (existing plan §7): restyle join/lobby/HUD
to the front-page aesthetic while fixing the mechanics.

---

## 10. Theme F — Multiplayer flow (items 2, 24)

Both are already substantially designed in `docs/plans/game-modes-and-flows.md`; here we **extend**,
not duplicate.

- **Invite system, controller-vs-remote (item 2).** The existing plan covers Local/Remote modes and
  deep-link `/join/<CODE>` invites (§4.2–4.3 there). Item 2 adds a **join-time choice for the
  invitee**: *"I can see the big screen → join as **controller only**"* vs *"I can't see it → open the
  **remote screen** (synced to host) and my phone still controls."* Design: the invite link lands on a
  chooser ("Can you see the host's screen?") → controller-only path (today's join) or remote-viewer
  path (`ViewerGameHost` from the existing plan §5.3) with the phone still sending input. Folds cleanly
  into beads `.2`/`.4` of that plan. **Test:** the existing plan's Remote E2E + a chooser-path test.
- **Rejoin weak / stuck; DC'd car transparent (item 24).** The existing plan's durable-token +
  host-loss-grace work (§4.4, §6) addresses "stuck" structurally. Item 24 adds two concrete UX
  requirements: (F2a) **one-tap rejoin** (durable `localStorage` token → reclaim the same seat without
  retyping anything); (F2b) **on disconnect, render the car semi-transparent** (and optionally
  non-colliding/ghosted) so it's visibly "away" rather than a solid stuck obstacle, reverting on
  rejoin or being reaped on timeout. **Test:** drop a player mid-race → host shows their car
  transparent within the grace window; rejoin restores solidity + control in one tap; past timeout the
  car is reaped.

---

## 11. Theme G — Audio (item 26)

**Problem (grounded).** Weapon SFX are synthesized; the homing missile especially is "terrible". The
missile launch is a square-wave + bandpass-noise sweep (`audioManager.js:783-822`); explosion is
noise-boom + sine-sub (`:828-869`). Cheap synth tells: single oscillator, no layering, abrupt/clicky
envelopes, no tail/space, piercing high-frequency whine on the homing track.

**Options.**
- **G1a — Re-synthesize with layering & better envelopes (research-backed idioms).** A good arcade
  weapon sound layers (i) a *transient* (white-noise burst: `data[i]=Math.random()*2-1` over
  `sampleRate*dur`, shaped by a BiquadFilter), (ii) a *body* (pitched osc, or **FM**: modulator →
  GainNode → `carrier.frequency`), (iii) a *tail* (filtered noise/reverb). The single biggest "cheap
  vs believable" lever is the **envelope idiom**: `gain.cancelScheduledValues(t)` →
  `setValueAtTime(0,t)` → `linearRampToValueAtTime(peak, t+attack)` → `linearRampToValueAtTime(0,
  t+len−release)` (de-clicked, smooth). For the **homing missile**: replace the piercing whine with a
  lower, wobbling tracking tone (gentle LFO pitch wobble) + airy whoosh and a soft tail — present but
  not fatiguing on repeat.
- **G1a′ — Adopt the jsfxr/sfxr parameter model.** Rather than ad-hoc oscillators, drive each weapon
  from an sfxr-style param set (envelope attack/sustain/punch/decay, base freq + slide, vibrato,
  arpeggiation, duty cycle/PWM, retrigger, flanger, LPF/HPF). This makes the per-weapon **sound spec**
  (below) concrete, tweakable, and reproducible, and is a known-good route to "game-y but not cheap".
  *(Note: no weapon-specific carrier/modulator recipes survived verification — the param model is the
  validated scaffold; the actual values are a tuning/playtest exercise.)* Unlock audio via
  `AudioContext.resume()` on first user gesture (already relevant with phones-as-controllers).
- **G1b — Author samples and bundle them.** Generate high-quality SFX with the `suno-sounds` /
  `sound-engineer` skills (or a free SFX library) and **bundle as assets** (allowed — the no-CDN rule
  is about runtime deps, not local audio files). Trade synthesis flexibility for guaranteed quality.
- **G1c — Hybrid:** sampled one-shots for the worst offenders (homing, explosion), keep synthesis for
  cheap/variable sounds (engine, UI).

**Recommendation.** G1c. Fix the homing missile first (loudest complaint) via a better-layered
synth *or* a bundled sample; build a small **per-weapon sound spec** so each weapon's layers/envelope
are data, reviewable, and swappable.

**Test (§12.4).** Render each SFX through an `OfflineAudioContext` and assert objective properties:
peak amplitude < clip ceiling, duration in range, no DC offset, dominant frequency below a
"not-piercing" ceiling for the homing track, presence of a decay tail. Subjective sign-off via
playtest — audio quality ultimately needs ears.

### 11.5 Theme H — Assets (item 7)

**Problem.** Cars/pickups are simple/procedural; "actual game assets" wants real models. A *menu* of
options isn't an approach — and two tempting paths are traps: AI **image→3D** still yields bad
topology/UVs/scale for hero meshes, and bespoke modelling becomes an art project that stalls the
gameplay polish. The approach has to deliver quality *fast*, stay *consistent* (one art style),
perform at N players + mobile, slot into the existing `VehicleFactory`/JSON pipeline, carry identity
(§5.4), and **never gate the fun.**

**Approach (opinionated, in order):**
1. **Base meshes = a curated CC0 low-poly library** — Kenney *Car Kit* / Quaternius *Ultimate
   Vehicles* (consistent style, game-ready, low-poly, zero licensing risk). Pick **3–5 silhouettes**
   (hatch, muscle, truck, buggy) so cars aren't identical; load each as glTF from JSON via
   `VehicleFactory` (matches the data-driven vision). This gets *real* assets in days, not weeks.
2. **Identity & variety via *material + decal*, not geometry.** One base mesh + a dedicated **"paint"
   material slot** recolored per player at runtime (60 players = 1 mesh + 60 material instances —
   cheap), plus a **roof-number decal texture** (§5.4). This is where AI *does* work well: generate
   **2D liveries / decals / number sheets / pickup glyphs / skybox**, never the 3D. So: library for
   meshes, AI for textures/decals/props-2D.
3. **AI image→3D only for low-stakes static props** (pickup crates, cones, scenery) where topology
   matters less — via Meshy/Tripo/Rodin — **and only if** it passes the validation gate below. Never
   for cars.
4. **A hard asset-validation gate (so quality is enforced, not hoped):** every asset must load via the
   resource pipeline, sit within a **poly budget**, fit its **collider/bounding box** at the right
   **scale & origin**, and pass a **visual snapshot**. An asset-load smoke test (extends the existing
   harness) blocks anything that's wrong-scale or too heavy.
5. **Off the critical path.** Gameplay polish ships on the current primitive cars; real assets swap in
   **behind a flag** via `VehicleFactory` without blocking any other wave. Assets are parallel polish.

**Recommendation.** Library meshes + runtime paint/decal/number + AI-for-2D-only + the validation gate
+ keep it flag-gated and parallel. Ties directly to §5.4 identity (the number/color/livery *are* the
asset-level identity) and the game-modes plan beads `.7`/`.8`. **Test:** asset-load smoke (loads,
poly ≤ budget, fits collider, correct scale/origin) + visual snapshot per silhouette.

**Spike result (2026-06-28 — full report: `asset-spike-2026-06-28.md`).** A background spike confirmed
this approach and sharpened it:
- **The mesh problem is already solved; the real work is a loader.** `VehicleFactory` today builds cars
  from boxes/cylinders and loads **no glTF at all** — so `FB-assets` is mainly *adding a `GLTFLoader`
  path* (the meshes exist for free). Kenney/Quaternius already deliver the two things AI mesh-gen and
  pure-procedural both fumble: a **clean recolorable material split** and **correct scale/origin for a
  box collider**.
- **Starter set (5 CC0 silhouettes, downloaded + verified, ~2k tris, separated wheels):** Kenney
  `hatchback-sports`, `sedan-sports`, `truck`, `race-future`, `kart-ooli` (+ `wheel-default`) remains
  the first source set, with Quaternius `truck_l200` as a useful comparison model. The raw-download
  assumption that source names/materials are enough is superseded by the debug-viewer findings below:
  selectable GLBs must be normalized before runtime.
- **Recolor architecture (refined by debug viewer):** runtime should tint normalized `paint` materials
  and force normalized `tyre` materials black. Per-car material clones ship first; `FB-instperf`
  decides whether per-instance-color shaders are needed later.
- **AI confirmed 2D-only:** image→3D still unreliable for hero recolorable car meshes (baked albedo,
  arbitrary scale/origin, fused wheels, wasteful topology); production-ready for **numbers/decals/
  liveries/track textures** (Ideogram for numbers, FLUX-LayerDiffuse/`gpt-image-1` for transparent
  decals). If bespoke meshes are ever needed: Tripo/Meshy low-poly or **Sloyd** (parametric, clean
  topology); self-hosted **SPAR3D** is the only free/no-account path.
- **Perf question → §14 #11:** per-player recolor needs a *unique material per car*, which fights
  `InstancedMesh`. Needs a **perf spike at 60 cars on the *host renderer* (the big-screen device that
  renders the world in Local mode) — NOT a phone** (phones/keyboards are controllers, they render
  nothing; Remote viewers render on their own device and just degrade). Per-instance color attribute +
  shader vs. accepting N draw calls; this chooses an optimization path, not Kenney-vs-Quaternius.

**Debug-viewer findings (`frontend/car-viewer/`, validated in-browser 2026-06-28).** A live viewer over
the staged GLBs sharpened the pipeline into concrete requirements:
- **Recolor needs a per-model *normalization*, not runtime name-guessing.** Name heuristics don't
  generalize — Kenney shares **one** material across body+wheels; Quaternius splits materials but
  **doesn't name the body "body"**. The robust runtime method that worked on both: **clone the material
  per mesh, then tint `body` and force `wheel`→black**, with a **dominant-material fallback** (largest
  non-wheel/glass/light material = paint) when no body is named. Cleanest long-term: an **offline
  Blender (`bpy`) normalization pass** that stamps a material convention onto every model —
  `paint` (recolor) / `tyre` (black) / `glass`,`metal` (neutral) / `light` (emissive) — so the runtime
  is a trivial, reliable `paint.color = playerColor`. *(Per-mesh cloning ↑ material count → feeds the
  §14 #11 instancing perf question.)*
- **Wheels must be forced black/neutral**, independent of body color (validated — `tyre` group).
- **Lights/emissive + neon under-glow read well with bloom** (the §5.5 cues) — confirmed in the viewer
  (emissive headlights/taillights + car-color under-glow disc through an `UnrealBloomPass`). Many
  library cars have **no separate light meshes**, so we add small emissive headlight/taillight geo +
  an under-glow at the chassis — an asset-step, not just a material toggle.
- **Rigging is per-model and must be validated.** The cars expose separable `wheel-*` meshes (✓
  steer/spin), but **pivot correctness varies** — steering yaws a wheel only if its origin is at the
  wheel centre, and suspension travel needs the body movable relative to wheels. The viewer's
  rig-test (spin + steer + suspension bob) is the eyeball check; the asset gate must assert per model:
  ≥4 separable wheels, front-axle identifiable, sane wheel pivots (so `PhysicsSystem`'s wheel-transform
  sync looks right).
- **Collider-vs-mesh fit is a real bug class (not the viewer's old AABB artifact).** The viewer's
  collider proxy showed the game's *fixed* JSON cuboid doesn't wrap real models (e.g. excludes a kart
  driver's head) → hitboxes that don't match visuals when we swap primitives→glTF. The asset gate must
  **assert collider fit per model** (extent/origin/proportion, per-silhouette collider, not one global
  box), and we add an **in-game oriented-collider debug overlay** (the §8.0 "every transform ships with
  a debug-render" principle, extended from track geometry to vehicles).

**Second-pass vehicle-selection pipeline (`asset-spike-2026-06-28.md`, §"Second-pass refinement").**
Treat vehicle selection as a catalog and appearance workflow, not only an art import. Add a
`vehicles/catalog.json` and per-vehicle manifests; only catalog IDs can be selected or sent over the
network. Normalize GLBs offline to `paint`/`tyre`/`glass`/`metal`/`light`, stable wheel names, declared
scale, number-mount, and collider-fit metadata; then the runtime loader stays small and reliable.
Recommended v1: Kenney-first source breadth, normalized material conventions, roof-quad numbers,
per-car material clones, and `FB-instperf` after the GLB path to decide whether instancing is actually
needed.

**Required skill gate:** `.claude/skills/vehicle-model-validation/SKILL.md` must be used before
closing any vehicle model import, normalization, catalog/manifest, loader, or selection bead. Its
PASS report is part of the bead evidence: screenshots/visual proof, rig/state preview where relevant,
collider/debug overlay, and automated/manual checks are required separately from gameplay tuning.

### 11.6 Theme I — Identity & business (items 1, 3, 4)

Lower gameplay priority; flagged for a human product call (§14). Grounded where possible.

- **Bug tracker (item 4).** An in-game bug reporter already exists (commit `ab11436`) and there's a
  beads-based tracker + an "analytics/bug submission" idea (`IDEAS_NEEDING_REFINEMENT.md`). **Options:**
  (I4a) route in-game reports → GitHub issues via `gh`; (I4b) → beads (`br`) for dev workflow; (I4c) a
  lightweight DB + a triage view with community voting (the existing idea). **⚠ The browser cannot
  safely shell out to `gh`/`br`** — this needs a **server endpoint** (`POST /report`) with auth/rate-
  limiting, spam handling, and screenshot/privacy rules, which stores reports centrally. A trusted
  local maintainer drainer promotes real reports into `br`/optional `gh` outside the browser and public
  request path. Recommend the thin endpoint + drainer near-term, I4c if a player-facing board is wanted.
- **Account system (item 3).** Builds on the existing plan's **anonymous device token**: optional
  email/account that *links* device tokens for cross-device identity, cosmetics, and entitlements.
  **Recommendation:** stay anonymous-token-first (no-install party game); add accounts only when
  monetization or cross-device persistence demands it.
- **Monetization (item 1).** "Pay once for offline, $6/mo for online; one month then chargeback can
  kill me." **Options:** (I1a) a one-time purchase for an **offline/self-host build** (Steam/itch or a
  downloadable bundle — already an `IDEAS` strand) + a **subscription** for the hosted online service;
  (I1b) Stripe with chargeback mitigation (Radar, address/identity checks, start with low exposure /
  proration, dunning). **Recommendation:** treat as a separate product track *after* the gameplay
  polish lands; the chargeback fear is real and argues for a low-risk launch (small audience, manual
  review) before scaling. **Owner call for this phase:** no paid work yet; leave only token/account seams.

---

## 12. Test, simulation & playtest harness  ← required deliverable

The user's explicit ask: *in-band testing, how we'd build the test harness, whether we can run physics
sims with params to empirically test, or otherwise playtest.* Yes — we can, and most of the §5–§11
work depends on it. Seven layers (§12.1–§12.7):

### 12.1 What exists (verified — the harness is NOT greenfield; build on these)
A prior build-out (incl. "Fable" agent runs, Jun 2026) already laid real scaffolding; this plan
*extends* it rather than starting over:
- **19 Playwright E2E spec files** (`tests/e2e/*`: full-game, game-modes, camera-modes, camera-zoom,
  car-reset, late-join, race-completion, console-errors, visual-effects, bugfix-regressions, …), with a
  **multi-context fixture** (`tests/e2e/fixtures.ts`) that drives a **desktop host + a touch player in
  one test** (both via `?testMode=1`) — true multiplayer is already exercised. **CI scope is narrow,
  though:** only `full-game.spec.ts` runs in CI (`playwright.config.ts:47-56`, `test:ci:e2e`); the full
  suite is opt-in via `npm run test:e2e:all`. Owner decision (2026-06-29): keep the fast-test philosophy,
  but expand normal CI where it matters. Fast unit/integration invariants join `npm test`; the **exhaustive
  map-validity matrix belongs mostly in unit/integration CI**, while normal E2E CI gets **one small
  Playwright gate** that proves the real host start path validates, blocks invalid input, and starts a
  representative race + derby arena. Heavy visual/perf/manual suites and the full browser matrix stay
  opt-in/nightly.
- **Headless physics already runs green in Node (vitest):** `tests/integration/vehicle-physics.test.ts`
  steps a **raw RAPIER world + dynamic body** (`world.step()`, 5 tests, ~84 ms) → proves Rapier-WASM
  works headless; `tests/integration/track-physics.test.ts` builds `PhysicsSystem` **barriers** headless
  by injecting `RAPIER`/`world` and bypassing `init()`. *(What's still unproven is only the
  `PhysicsSystem` **vehicle controller + drive logic** stepped headless — that's the `FB-runtime` gap,
  §12.2, now narrowed to coupling+clock, not "can Rapier run in Node".)*
- **In-band introspection already exists and is the established handle:** tests and tooling read live
  state off **`window.game`** (vehicles/engine/track), and a **`?testMode=1`** URL flag exists — used by
  the existing **`scripts/live-smoke.ts`** to assert the deployed game is *actually simulating*
  (`game.vehicles.size > 0`, `engineState ∈ {racing,countdown}`). §12.4's `window.__jjTestResult`
  should extend this same `window.game` convention, not invent a parallel one.
- **A live/production smoke harness** (`scripts/live-smoke.ts` + standalone `live-smoke.config.ts`,
  no local `webServer`, targets `LIVE_URL`) + **screenshot/video capture scripts**
  (`scripts/capture-screenshots.ts`, `capture-video.ts`, `record-gameplay.mjs`) — reusable for §12.4
  visual gates and §12.5 stress runs.
- **F2 live tuning panel** (`PhysicsTuningUI.js`) — lets a human sweep physics params at runtime with
  localStorage persistence: the manual seed of the empirical harness.
- **Test commands:** `npm test` = unit + integration (vitest) + server (python unittest); E2E is
  separate (`test:e2e` / `test:e2e:all`). The new `npm run sim` (§12.2) joins this set.

### 12.2 Physics-sim harness (empirical tuning) — feasible **after a Wave-0 extraction**

**Feasibility (verified by a Codex pass — more involved than first stated).** `PhysicsSystem`'s *core
physics* is **not** coupled to Three.js/DOM, and two existing green vitest integration tests narrow the
risk: `vehicle-physics.test.ts` steps a **raw RAPIER world + rigid body** (`world.step()`) → Rapier-WASM
in Node is *proven*; `track-physics.test.ts:15` builds `PhysicsSystem` **barriers** headless by injecting
`RAPIER`/`world` and bypassing `init()`. So `FB-runtime` is **not** "can physics run in Node" (answered:
yes) — it's narrowly the `PhysicsSystem` **vehicle-controller + drive-logic** coupling and clock. Three
things block a clean headless *vehicle* sim today: (a) `init()`→`_loadRapier()` reads `window.RAPIER`
(`PhysicsSystem.js:80`), but the tests already show the workaround (inject `RAPIER`/`world` directly) →
`ReferenceError` in Node; (b) `update()` mutates full `Vehicle` entities via `syncEntityFromPhysics()`
and `createVehicleBody()` needs a rich vehicle object (`:130`, `:579`); (c) drive logic reads
**wall-clock** `Date.now()`/`performance.now()` for reverse delay, stun, wheelie, stunt, bad-landing
timers (`:772`) → **non-deterministic** fast-forward.

**⇒ `FB-runtime` is a Wave-0 prerequisite** for every sim-gated bead (FB-wall/susp/assist/derbywall/
mapqual/rubberband). It extracts a small **`PhysicsRuntime`**: injectable `rapier`, **injectable `clock`** (sim
time, not wall-clock), fixed timestep, and a **`SimVehicleAdapter`** (minimal vehicle stand-in).
`PhysicsSystem` stays the browser-facing wrapper over it. **First task = a one-day spike** proving
`PhysicsRuntime` steps in Node deterministically. **Fallback scope (be honest):** a headless
**Playwright page** stepping the *real* client covers **single-scenario regression gating only — NOT
parameter sweeps**. Sweeps need hundreds–thousands of fast fast-forwarded runs, and the client's
wall-clock timers (`Date.now()`/`performance.now()`, `PhysicsSystem.js:772+`) mean you *cannot*
fast-forward without the injectable clock — which *is* `FB-runtime`'s hard part. So the **clock
extraction is not optional**; the Playwright fallback only buys the easy Node-vs-browser piece and
keeps regression gates alive, it does **not** de-risk the sweep-driven tuning in §7. (See §14 risk #1.)

**Then the sim provides:**
- **Deterministic bot drivers** — spec each as a *fixed* controller so metrics measure physics, not
  bot quality: a **pure-pursuit** line-follower (fixed lookahead) for race, a **seek/ram** controller
  for derby. *Validate the bot on a known-good tune before trusting any derived metric.* (Exception:
  the no-steer test below is bot-independent — keep it.)
- **Self-determinism gate (run first):** same seed + same script ⇒ identical metrics across repeats
  (within ε). Note Rapier-WASM float determinism may differ CI-vs-local → pin sims to one canonical
  runner or use tolerance bands, else "feel" gates flake.
- **Objective metrics (redefined for rigor):**
  - **Wall deflection (item 28a)** — scenario is a fixed `(entry speed v0, approach angle α, straight
    wall)` with the **engine OFF / coasting through the contact window** (so engine force can't inflate
    the result), swept over α∈{15,30,45,60}°, with **four** complementary gates: (i) **tangential-
    retention vs ideal slide** `v_tangential_out / (v0·cosα) ≥ ~0.9` (vs the wall's analytic tangent);
    (ii) a **normal-restitution bound** `v_normal_out / v_normal_in ≤ r_max` — *required* to distinguish
    "slide along" from "pinball bounce" (a high-restitution bounce also retains tangential speed, so (i)
    alone would greenlight the very bounciness open-decision #3 hasn't settled); (iii) **stopped-time** =
    total seconds with `speed < 0.1·v0` (relative, not an absolute 0.5 m/s floor — a 20 m/s car grinding
    at 0.6 m/s *is* the complaint) while `inWallContact` `< 0.2 s`; (iv) **heading-realignment** — the
    *positive* "pushed around the track" outcome — heading converges to within ε of the track tangent
    (race) / arena-inward (derby) within N m / M s; **scoped to the assist-ON config** (with assist off,
    pure physics needn't actively realign — see C3c). *(ε, N, M, r_max are tuned in the harness, not
    guessed here.)*
  - **Suspension "bouncy" (item 28b):** Rapier's raycast suspension is *not* a clean linear 2nd-order
    system (separate compression/relaxation damping; ray force → 0 at full extension; contact on/off),
    so a single damping-ratio fit is **a diagnostic, not the gate**. Gate instead on a heave jump-test:
    **overshoot ∈ [lo, hi]%** (lively-but-settling) **and** sign-changes-before-settle ≤ k; report ζ
    and peak travel as diagnostics; settle-time is expressed *relative to* the swept stiffness (not a
    fixed T). Add a **separate front-rear pitch-oscillation gate** for porpoising (a heave test can't
    see pitch-coupled oscillation).
  - **Steering & accel (for the maxAngle/engineForce sweeps):** turn-radius-at-speed, time-to-90°-
    heading-change; 0→top-speed time and top speed. (Sweeps need pass/fail, not just CSV.)
  - **Assist (item 28c):** *bot-independent* — assist-on no-steer-but-accelerate bot completes a lap;
    assist-off bot doesn't.
  - **Recovery (item 25):** bot driven off-edge/below-kill-plane resets to a valid on-track pose within
    `recoverSeconds`; never permanently lost. (Derby variant asserts *elimination*, §7.4.)
  - **Tunnelling/CCD:** fast car vs thin wall at high `engineForce` — assert no position step jumps a
    collider (guards derby desync and fast race cars).
  - Plus: lap time, OOB/flip counts, checkpoint order/coverage, NaN/Inf invariants.
- **Parameter sweeps:** grid-search `{sideFrictionStiffness, wallSlideGrip, wall friction/restitution,
  suspension stiffness/travel/relaxation/compression, steering assist strength, steering.maxAngle,
  engineForce}`; emit CSV **and** a versioned **`baseline-metrics.json`** per canonical tune so the sim
  gates on *relative deltas* (regression-catching), not only absolute thresholds — **with tolerance
  bands** (Rapier-WASM floats may differ CI-vs-local, so the baseline gate needs the same ε as the
  self-determinism gate, and the canonical runner is the throughput bottleneck for physics-PR gating).
  This is how §7's "feel" is *dialed by data* — satisfying principle 4 and the CLAUDE.md anti-"×1000" rule.
- **Runs as** a Node/Vitest target (`npm run sim`) after `FB-runtime`, or the Playwright fallback;
  cheap enough for nightly + physics-PR gating.

### 12.3 Geometry invariant tests (the map bugs)
Pure unit tests over generator/barrier output — no browser:
- Curb collider long-axis ⟂ radius (pins §8.1 curb bug — the actual inverted-corner cause; **fails today**).
- Edge-barrier normal points toward the **drivable side** (nearest centerline), tested **per-edge**
  (inner inward, outer outward) — *coverage* for the (verified-correct) spline yaw, **passes today**,
  not a known break (see §2 #2).
- Closed-loop, no self-intersection, drivable min-width (track validator, §8.4 D4d).
- Checkpoint tangent matches track flow (§8.3).
- Derby collider radius == visual radius at each shrink step (§8.2).
- Deterministic: same seed → identical geometry (enables every visual snapshot below).
- **Top-down schematic debug-render per seed** (§8.0 Part B): headless PNG of centerline / edges /
  curbs-as-oriented-rects / checkpoint gates / normal-arrows / spawns; a **golden-seed contact sheet**
  (~12 seeds) eyeballed once then snapshot-locked, so any orientation regression breaks CI visibly.
  This is the automated answer to "we forget to visually check."

### 12.4 In-band & visual/audio testing
- **In-band assertions / "test mode" — with a machine-readable contract.** *Extend the existing
  `?testMode=1` flag + `window.game` handle* (already used by `scripts/live-smoke.ts`): a
  `?test=<scenario>` URL param runs scripted scenarios in the *live* client and **sets
  `window.__jjTestResult = {scenario, pass, metrics}`** (read from `window.game` state, plus one
  structured console line) that a Playwright wrapper asserts on — *not* just an on-screen overlay (an
  overlay alone is a manual tool, not a gate). Scenarios: "scatter cars →
  assert viewport count == cluster count"; "drive off edge → assert reset"; "no NaN velocities". Lets
  us exercise real render+physics+camera paths headless sim can't.
- **Visual (camera/UI) — measure bounds, don't pixel-diff.** Use Playwright-native `locator.boundingBox()`
  / `page.evaluate(() => …getBoundingClientRect()/projected sprite size)` rather than image snapshots
  (GPU/AA/font-flaky on software-rendered CI). Pin the numbers at deterministic seed and two resolutions: name-tag height **≥28px @ 3840×2160,
  ≥18px @ 1920×1080**; all cars fully inside frame with ≥K px padding; join `scrollY===0` + no overflow
  (§9). Add a **clarity gate** (the real point of items 17/20): mean pairwise on-screen car-centroid
  separation ≥ S px and per-car projected silhouette ≥ A px² at a scripted spread; and a **derby
  zoom-tightness** gate (arena circle fills ≥ P% of viewport min-dim at each shrink step).
- **Audio — feasibility + determinism caveats.** `OfflineAudioContext` is available in
  **Playwright/Chromium, not plain Node/Vitest**, and `AudioManager` touches `window` at module load
  and owns its own context (`audioManager.js:66,957`) → first extract **SFX builders that accept a
  `BaseAudioContext`/destination**, and **seed the noise** (`_getSfxNoiseBuffer()` uses `Math.random()`
  at `:875`) so spectral bounds aren't flaky. Then assert: peak < clip ceiling; duration band; no DC
  offset; **spectral centroid below a Hz ceiling** for the homing track (stronger than dominant-freq);
  a numerically-defined decay tail; and **cross-weapon loudness normalization** (integrated LUFS within
  ±X LU) so no SFX is perceptually 10× louder — a likely "sounds bad" cause. Humans judge final taste.

### 12.5 Playtest methodology (instrumented, not vibes)
Empirical sim tunes the *parameters*; humans judge *fun* — but with structure and a pass bar:
- **Couch test:** ≥5 first-timers, a **fixed task script**, per-dimension **1–5 Likert** (camera
  readability, control clarity, wall feel, audio), **plus auto-captured metrics** (time-to-first-move,
  time-to-first-lap, wall-contact count, reset count, abandon rate). **Pass bar:** median
  time-to-drive **< 10 s**; ≥80% complete onboarding without asking.
- **Blind A/B from sim candidates:** feed the **top-2 tunes from the §12.2 sweep** (assist on/off,
  wall-tune A/B) into a blind comparison, so human judgment chooses between *sim-selected* candidates
  rather than open-ended vibes.
- **Remote test:** several browsers/laptops (Remote mode), keyboard schemes, rejoin/transparent-car.
- **Stress/soak:** *build* the 32-controller chaos run (currently only an idea in
  `GAME_IMPROVEMENT_IDEAS.md`, not existing infra) on the multi-context fixture, extend to 60+ — gated
  by §12.6, not just "looks OK".
- **Capture loop:** feed findings back through the **bug tracker** (item 4) → beads.

### 12.6 Performance & scale gates (the missing proof behind "no caps")
Principle 6 ("degrade, don't cap") and item 29 ("60 players") are currently *asserted*, not measured.
Add hard gates so the degradation ladder is provable:
- **Host FPS floor:** host holds **≥30 fps** (≤33 ms/frame) at N ∈ {8,16,32} with the active camera
  mode; the degradation ladder (drop post-processing → LOD distant cars → marker-only cars → cap
  auto-viewports K) **provably holds the floor** as N grows. Grid (A2c) only viable with aggressive
  downgrade above ~8. **⚠ CI runner:** standard CI is software-rendered (SwiftShader) and *can't* hit
  30 fps for any real 3D scene — run this gate on a **named GPU runner**, or substitute a deterministic
  **frame-time-budget proxy** (count draw calls / scene submissions ≤ a budget) for the CI signal and
  keep the real-fps check on hardware.
- **Audio voice limit:** cap concurrent `EngineSynth` voices (target **≤16**, nearest/loudest cars;
  distance-cull the rest) — assert live `AudioNode` count stays bounded regardless of N. (Owned by
  `FB-audio`; `FB-perf` only *asserts* the bound.)
- **Physics scale:** N `DynamicRayCastVehicleController` steps/frame at N ∈ {32,60} within a
  **physics-step budget (target ≤ ~8 ms/frame)**; add wheel sleep/LOD for distant/idle cars if exceeded.
- **Network/server load:** at N=60, N×60 Hz = **3600 msg/s** through the Flask relay (`app.py:384`) +
  host apply-per-vehicle (`GameHost.js:1247`) — assert **server p95 message-processing latency** and
  per-message validation cost stay bounded, and that the emit rate is **throttle-able** (downshift input
  Hz as N grows). (Shares the O(N) fanout concern in `game-modes-and-flows.md` §5.)

### 12.7 Per-item test traceability
Every §5–§11 option lists its own test; §13 carries a column asserting each bead ships with the test
layer(s) above. Definition of done for a "feel" item = **sim metric green + playtest sign-off**; for a
bug = **invariant test that failed now passes**; for UI = **visual snapshot + E2E**.

---

## 13. Work breakdown → beads (dependency-ordered, with test layer)

> Authoritative task text will live in beads (`br`); this is the map. "Test" = the §12 layer(s) that
> gate done-ness. Priority favors **cheap high-impact bug fixes** and **big-screen legibility** first.
> **Cross-plan deps** marked "(game-modes plan .N)" reference the existing epic
> `br-modes-remote-play-design-48a` (beads `.1`–`.11` in `game-modes-and-flows.md` §8) — those beads
> must exist in `br` before the dependent FB-* beads start; use the exact `br` IDs when creating these.

| Bead | Theme | Title | Depends on | Test layer |
|---|---|---|---|---|
| **FB-runtime** | — | **Wave-0:** extract `PhysicsRuntime` (injectable rapier+clock) + `SimVehicleAdapter`, *extending the green `tests/integration/*physics*` pattern*; headless-step spike + Playwright fallback (§12.2) | — | self (headless determinism) |
| **FB-geoframe** | D | **Geometry foundation (§8.0):** single {tangent,normal,up} frame, CCW winding canonicalize, offset-with-self-intersection-repair, + top-down debug-render & golden-seed gallery. Kills the inverted-apex *class*. | — | 12.3 geometry + golden-seed |
| **FB-mapvalid-allmodes** | D | **Pre-polish map validity gate:** valid-by-construction track specs/generators + runtime `validateArena(track, gameplayMode, N)` tripwire before spawn; invalid ids/configs **fail loud and block start** with structured telemetry/debug-render, never fallback-to-another-map; exhaustive host-renderer gameplay-mode×track matrix runs in unit/integration CI, one small Playwright CI gate proves the real host path; spawn count/no-overlap/no-penetration/on-ground/heading are part of the gate (`docs/plans/gaps/derby-map-reliability.md` §2) | FB-seed, FB-geoframe, FB-validator, `br-fb-spawncap-qi9` | 12.3 geometry, 12.4 CI E2E |
| **FB-bowltransition** | D | **Derby bowl transition:** one tangent-continuous revolved `bowlProfile` feeds both visual mesh and Rapier trimesh; fixes inverted concavity and flat-floor→wall crease; shrink boundary remains separate (`docs/plans/gaps/derby-map-reliability.md` §1) | FB-geoframe | 12.3 profile/collider invariants, debug-render, sim/playtest |
| FB-curb | D | Curb collider yaw-from-tangent via the frame (§8.1) — *curb only; derby/checkpoint owned below* | FB-geoframe | 12.3 geometry (fails→passes) |
| FB-scale | A | Presentation scale + TV mode + camera angle (§5.1) | — | 12.4 visual |
| FB-names | A | **Constant screen-space** labels (clamp 18–40px, not distance-scaled) + importance + declutter (§5.1 A1d/A1e) | FB-scale | 12.4 readability gate |
| FB-carid | A | **Car identity system:** curated palette + roof number + phone mirror + own-car chevron + off-screen arrow (§5.4); elevates game-modes `.6` | FB-names | 12.4 visual, controller E2E |
| FB-orient | A | **Orientation cues** for big-screen/high-angle: bloom-boosted trails+smoke, ground contact shadow, heading chevron, front-light **cast cone** (not an ultra-bright sphere) + under-glow — scaled by zoom/`presentationScale`; lights rigidly attached to the chassis (§5.5) | FB-scale | 12.4 visual (cue-present + emissive floor) |
| FB-debugmenu | — | Debug panel (extend F2): a togglable in-game menu entry for **every** debug overlay/visual aid (collider draw, geo debug-render, identity/camera guides, FX) + an eventual debug-enable feature flag (principle 8) | — | E2E (toggles flip state) |
| FB-simharness | — | Build headless physics-sim: bot drivers + metrics + sweeps + baseline (§12.2) | FB-runtime | self |
| FB-oob | C | Recovery state machine: flip+OOB+kill-plane; **derby OOB = elimination**, coordinates w/ DerbySystem boundary ownership (§7.4) | FB-checkpt | **in-band/E2E** (not sim-gated — a GameHost change) |
| FB-wall | C | Boundary deflection: **`sideFrictionStiffness` drop** + redirect + angled curb (§7.1) | FB-curb, FB-simharness | 12.2 sim, playtest |
| FB-susp | C | Suspension bounciness + expose travel/relax/compression in F2 (§7.2) | FB-simharness | 12.2 sim |
| FB-assist | C | Steering assist/auto-steer experiment (needs centerline tangent), feature-flagged and default OFF until blind playtest earns it (§7.3) | FB-checkpt, FB-simharness | 12.2 sim, playtest |
| FB-derbywall | D | Derby shrink collider/visual lockstep; Group glow; `dt`-scale pushForce; dead `setWallCollider` (§8.2, §2 #3/#7) — *deterministic fixes, not sim-gated* | — | 12.3 geometry (radius-match), E2E |
| FB-checkpt | D | Oriented (frame-derived) + **Y-aware** checkpoints (§8.3, §2 #4) | FB-geoframe | 12.3 geometry |
| FB-seed | D | Required deterministic seed everywhere (§8.4 D4c) — **single-owns the game-modes `.2` seed work** | — | 12.3 geometry |
| FB-validator | D | Track validator + invariant suite (drivable-side normals, winding, min-radius) (§8.4 D4d, §12.3) | FB-seed, FB-geoframe | self |
| FB-mapqual | D | Generator quality + **"interesting" checklist** (corner-type mix, variable width, lap length) (§8.4 D4a/D4a′) | FB-validator | 12.3, golden-seed |
| FB-camdir | A | CameraDirector: 1-cluster auto-frame / 2-player divider shader; **target-car-size framing (split before shrink) + per-mode pitch** (§5.2, §5.5) | FB-scale, **FB-names** | unit, 12.4 |
| FB-camgrid / FB-wifes-grid-mode | A | **Wife's Grid Mode:** per-player equal-tile/follow grid (opt-in, named mode) (§5.2 **A2c**, `gaps/camera-dynamic-split.md`) | FB-camdir, FB-perf | 12.4, 12.6 perf |
| FB-camset | A | Settings panel + per-mode profiles + derby overhead + **live camera-tuning panel** for the director's feel params (cluster/hysteresis/pitch/zoom/target-size/treemap weights), F2-style, persisted (§5.3 A3d) | FB-camdir, FB-debugmenu | E2E |
| FB-scheme | B | ControlScheme abstraction + picker + auto-suggest; **owns keyboard input** (§6.1) | — | unit, E2E |
| FB-rearfire | B | Directional/rear fire in WeaponSystem (host-authoritative) (§6.1) | — | unit, E2E |
| FB-twin | B | Twin-shooter scheme (left = steer+fire-dir, right = throttle) (§6.1) | FB-scheme, **FB-rearfire** | unit, E2E |
| FB-remap | B | Configurable per-device/per-scheme control remaps, saved locally for now; reset/default/conflict validation (`gaps/input-expansion.md`) | FB-scheme | unit, E2E |
| FB-spawngen | B/D | Promoted no-cap spawn generator: `generateSpawns(track,N)->Spawn[N]`, non-overlap/on-ground/heading/derby rings, late-join/respawn; feeds map-validity gate (`gaps/input-expansion.md`) | FB-geoframe, FB-validator | unit, soak |
| FB-keys | B | Keyboard scheme(s); key-region partitioning with ghosting warning; **consumes game-modes §4.2b** and depends on `FB-spawngen` for uncapped seats | FB-scheme, FB-spawngen | unit, soak |
| FB-ghost | B | Animated "ghost" gesture tutorials per scheme (§6.2) | FB-scheme | E2E |
| FB-join | E | Non-scrolling translucent paged join + keyboard handling (§9) | — | 12.4 visual, E2E |
| FB-spin | E | Spinner timeout/skip/progress (§9) | — | E2E |
| FB-qr | E | QR visibility state machine (§9) | — | E2E |
| FB-perf | — | Degradation ladder + FPS/audio-voice/physics/network scale gates (§12.6) | FB-camdir | 12.6 perf, soak |
| FB-rubberband | C | Rubber-band catch-up (boost trailing / inhibit leader; needs rank) (§3) | FB-simharness, FB-checkpt | 12.2 sim, playtest |
| FB-invite | F | Controller-vs-remote join chooser; **+ phone-paired-to-remote-screen topology** (§10, #2) | (game-modes plan .2/.4) | E2E |
| FB-rejoin | F | One-tap rejoin + transparent DC'd car (collision policy defined) (§10) | (game-modes plan .3) | E2E |
| FB-audio | G | Per-weapon sound spec (jsfxr model); fix homing missile; voice cull (§11) | — | 12.4 audio, playtest |
| FB-assetcatalog | H | **Vehicle catalog/manifest contract:** `vehicles/catalog.json`, per-vehicle JSON schema, `PlayerAppearance` shape, asset validator that passes with primitive `default` first; catalog IDs only, no arbitrary asset paths; close with vehicle-model-validation skill evidence (§11.5, asset-spike second pass) | — | asset gate + skill PASS |
| FB-assetnorm | H | **Offline Blender (`bpy`) normalization pass:** material convention `paint`/`tyre`/`glass`/`metal`/`light`; **stable wheel nodes** `wheel_fl`/`fr`/`rl`/`rr` (hub-centered pivots); **declared forward axis + scale + ground offset + roof-number mount + collider-fit metadata** (principle 9); headlight/tail-light/under-glow emissive geo; validate rigging (≥4 separable wheels, sane pivots); close with vehicle-model-validation skill evidence (§11.5) | FB-assetcatalog | asset gate + skill PASS |
| FB-assets | H | **Add `GLTFLoader` path to `VehicleFactory`** (loads no glTF today) + normalized 5 CC0 silhouettes + runtime recolor (tint `paint`, force `tyre` black) + roof-number quad + **per-model collider fit** + in-game collider debug overlay; flag-gated, parallel; close with vehicle-model-validation skill evidence (§11.5, §8.0) | FB-assetcatalog, FB-assetnorm | asset-load smoke, collider-fit, visual + skill PASS |
| FB-carselect | H/F | **Vehicle selection + persistence:** lobby/controller picker from catalog, color/number defaults, sanitized `PlayerAppearance` through join/reconnect/host spawn, remote-viewer-ready appearance payload; close with vehicle-model-validation evidence for selectable model previews (§11.5, game-modes `.8`) | FB-assetcatalog, FB-assets, game-modes `.3` for durable token | E2E + skill PASS |
| FB-instperf | — | Perf spike: 60 recolored cars (unique material) vs `InstancedMesh` on the **host renderer** (not a phone) → pick optimization path, not source library (§14 #11) | FB-assets | self (perf) |
| FB-lightdamage | G/H | **Tightly scoped:** headlights/tail-lights are damageable — break (go dark + small shatter) on hits at the light's position; integrate with `DamageSystem` per-part hit, not whole-car (§11.5) | FB-assetnorm | unit (light breaks on hit at light pos), E2E |
| FB-bugtrk | I | `POST /report` server endpoint → central report store; trusted local drainer promotes to `br`/optional `gh` outside the browser/request path (`gaps/bug-tracker.md`) | — | E2E |
| FB-account | I | **Deferred.** Current phase only leaves anonymous durable-token/account seams; no login or account UI yet (§11.6, `gaps/account-monetization.md`) | (game-modes plan .3) | E2E |
| FB-monetize | I | **Deferred.** No paid accounts, subscriptions, online gates, storefront, Stripe/MoR, or cosmetic store work in the current phase | FB-account | — (product) |

**Suggested sequence (revised).** **Pre-polish gate:** no broad polishing starts until the "could this
bug class land again?" gates are in place and graph-enforced: `FB-seed`, `FB-geoframe`, `FB-validator`,
`FB-mapvalid-allmodes`, spawn-cap safety (`br-fb-spawncap-qi9`), and the CI wiring that runs fast
invariants plus the small Playwright host-path gate. This is not a runtime fallback policy; it is proof
that valid shipped specs/seeds cannot construct invalid maps, and that invalid inputs fail loud before
spawn. The gate task (`br-69r`) must also audit ready polish beads for exact gate command/spec, pass bar,
CI tier, and evidence artifact before declaring the swarm ready.
**Wave 0:** `FB-runtime` (unblocks all physics tuning).
**Wave 1 (cheap, loud wins, parallel after the pre-polish gate is green):** `FB-curb`, `FB-bowltransition`,
`FB-scale`, `FB-names`→`FB-carid`, `FB-spin`, `FB-qr`, `FB-join`, `FB-audio`, `FB-checkpt`,
`FB-derbywall` (deterministic), then `FB-oob` (after `FB-checkpt`; in-band/E2E, *not* sim-gated).
`FB-assetcatalog`→`FB-assetnorm`→`FB-assets` runs parallel/flag-gated throughout; `FB-carselect`
follows once the loader path is real. **Wave 2 (needs harness):** `FB-simharness` →
`FB-wall`/`FB-susp`/`FB-rubberband`, `FB-validator`→`FB-mapqual`; `FB-assist` remains an optional
experiment behind feature flag + blind playtest, not a default handling dependency.
**Wave 3 (systems):** `FB-names`→`FB-camdir`→`FB-camset`; `FB-perf`→`FB-camgrid`;
`FB-scheme`→`FB-rearfire`→`FB-twin`, `FB-scheme`→`FB-keys`/`FB-ghost`. **Wave 4 (flow/product):**
`FB-invite`/`FB-rejoin` (with the game-modes plan), `FB-assets`, `FB-bugtrk`, then
`FB-account`/`FB-monetize`. **Single riskiest assumption:** that `FB-runtime` extraction is cheap — if
it isn't, the Playwright-stepping fallback keeps **regression checks** alive but **not the sweep-driven
tuning** (which still needs the injectable clock); treat `FB-runtime` as a **spike with a hard stop** —
on overrun, re-scope Wave 2 to bug-fixes + in-band regressions + manual F2 tuning rather than pretend
the sim timeline holds (see §14 #8).

---

## 14. Open and Resolved Decisions

Owner decisions locked on 2026-06-29 are captured canonically in
`docs/plans/captains-calls-2026-06-29.md`. Use that register when converting this plan to Beads.

1. **Splitscreen default (§5.2):** **resolved**: cluster-based auto-split is the default for N clusters;
   "all cars in view" remains a first-class mode; per-player grid is a configurable mode named
   **Wife's Grid Mode**, not the default.
2. **Steering assist default (§7.3):** owner is skeptical. Treat auto-steering as default OFF,
   feature-flagged, and playtest-gated; do not ship hidden steering correction as baseline unless A/B
   playtest clearly earns it.
3. **Curb feel target (§7.1):** how "bouncy/pinball" should walls be — preserve speed and gently
   redirect, or lively bounce? Sets the sim metric thresholds; ultimately a taste/playtest call.
4. **Audio route (§11):** invest in better *synthesis* (flexible, on-brand, free) vs *bundled
   samples* (guaranteed quality, larger assets)? (Recommend hybrid.)
5. **Asset strategy (§11.5):** **resolved**: Kenney-first / validation-first, with the first two pilot
   cars human-reviewed before broad rollout. Bespoke assets are later.
6. **Monetization (§11.6):** **resolved for current phase**: no paid accounts, subscriptions, payment
   flows, online gates, or storefront work yet. Hosted online stays free-while-small; paid work requires
   a later explicit go decision.
7. **Identity scope (§11.6):** **resolved for current phase**: anonymous durable device token only,
   locally saved preferences/remaps, and account seams. No account login now.
8. **Top schedule risk — `FB-runtime` extractability (§12.2, §13):** the existing green vitest tests
   prove Rapier runs headless, so the risk is narrowed to extracting `PhysicsSystem`'s vehicle-drive +
   clock. If that's *not* cheap, the Playwright fallback keeps **regression checks** alive but **cannot
   run parameter sweeps** — so §7's empirical *tuning* stalls until the clock is injected. Fund the
   Wave-0 spike *first* as a **hard-stop spike**; on overrun, re-scope Wave 2 to bug-fixes + in-band
   regressions + manual F2 tuning. **`FB-runtime` acceptance checklist:** (a) create the vehicle
   controller headless; (b) apply controls and step for fixed *sim* seconds; (c) same-seed runs →
   identical metrics; (d) no `Date.now()`/`performance.now()` on the runtime path; (e) no `window`
   requirement.
9. **Scale ceiling for splitscreen (§5.2, §12.6):** **direction resolved, constants still playtest**:
   all cars in view and cluster director are first-class; per-player real viewport count degrades via
   marker/LOD/overhead fallback when performance/readability requires it.
10. **Two-devices-one-seat (§10, item 2):** **resolved**: support phone-controller paired to a separate
    viewer as a universal seat capability for Local and Remote. Same-device rejoin identity is strict;
    same-location rejoin is best-effort; cross-device recovery is best-effort without accounts.
11. **Car recolor architecture (§11.5, asset spike + debug viewer):** source choice and runtime
    recolor are now separated. V1 uses cataloged, normalized assets with `paint`/`tyre` conventions;
    Kenney is the first source for breadth. `FB-instperf` decides the optimization path on the **host
    renderer** (the big-screen device — *not* a phone; phones/keyboards are controllers and render
    nothing, per AGENTS.md): per-car material clones vs. per-instance color/shader. This is a perf
    decision, not a source-library or aesthetic decision.

---

## 15. Validation log

> Per the Jeff Emanuel workflow, this plan is validated ≥2× by independent agents (Claude generalists
> + Codex reviewers), each applying the plan-review prompt, with revisions integrated in-place.

- **Round 0 (this document):** authored from feedback + verified code map + design brief + existing
  plans.
- **Deep-research integration (2026-06-28):** 24 verified claims folded in
  (`research-brief-2026-06-28.md`). Split-screen = 2-player technique (fair N-way impossible);
  `side_friction_stiffness` = the wall-slide/drift lever; `frictionSlip 1000` = prime "cars stop dead"
  suspect; jsfxr param model + envelope idiom; convex-hull/repulsive-curves. Unverified → *first-principles*.
- **Round 1 (2026-06-28) — DONE:** 4 independent reviewers, 2 models, distinct lenses — Codex
  (`codex exec`) ×2 (code-grounding/correctness; feasibility/cost) + Claude (Agent) ×2 (test-rigor;
  gaps/sequencing). Scores 4/4/4/3. **All findings integrated in-place; dispositions in §16.** Net
  changes: corrected a wrong "confirmed bug" (spline yaw), de-cased the curb fix, added 4 new code
  bugs, resolved the `side_friction_stiffness` question (present in 0.19.3), added `FB-runtime`
  (Wave-0), `FB-rearfire`, `FB-rubberband`, `FB-perf`, redefined the physics/visual/audio metrics for
  objectivity, fixed the twin-shooter steering hole and the derby reset-vs-elimination conflict, and
  added the missing FPS/network/scale gates.
- **Round 2 (2026-06-28) — DONE:** 3 reviewers re-reading the *integrated* doc — Codex
  (consistency/correctness of the revisions) + Claude ×2 (holistic build-readiness; adversarial
  pressure-test of the new harness/metric material). Scores 4/4/4. **Verdict: steady-state on
  substance** — both Claude reviewers judged it build-ready, and findings were *incremental tightening*
  (the Jeff-method signal of convergence), not structural surgery. All integrated (dispositions in
  §16 Round-2). Net: fixed a leftover §12.3 contradiction + one factual slip in my own Round-1
  integration (the `track-physics.test.ts` precedent is static-barrier-only, no `eventQueue`),
  disambiguated bead ownership, hardened the metrics (engine-off coast + restitution bound, relative
  stopped-time, ζ demoted to diagnostic + a pitch gate), put numbers on the §12.6 scale gates, and
  stated plainly that the Playwright fallback can't do sweeps.
- **Round 3 — Jeff harness-grounding pass (2026-06-28) — DONE:** triggered by scraping the prior
  "Fable" agent runs, which revealed the §12 harness was written as *greenfield* when real scaffolding
  exists. Re-grounded §12.1/§12.2/§12.4/§13 against the actual infra (19 E2E specs + multi-context
  fixture; two **green headless vitest physics tests**; the `window.game`/`?testMode=1` convention; the
  `scripts/live-smoke.ts` production smoke harness), then ran 1 Codex review (Jeff review prompt). It
  **verified every new claim against source** (incl. `window.game` exposure at `src/host/main.js:69-104`)
  and flagged precise corrections — all integrated: E2E count 19 (not ~21) + narrow CI scope;
  `FB-runtime` risk correctly narrowed to *vehicle-drive+clock* (Rapier-in-Node is proven); `FB-oob` and
  `FB-derbywall` moved to Wave 1 (not sim-gated); fallback language narrowed (regression-only, no
  sweeps); `javascript_tool`→Playwright-native; an `FB-runtime` acceptance checklist; the 32-controller
  soak reframed as to-build; cross-plan bead IDs pinned.
- **Convergence:** **8 reviews over 3 passes** (4 + 3 + 1); each pass produced strictly more
  incremental output → broad **planning steady-state**. Remaining substantive choices are quarantined
  as owner-resolved decisions or playtest/human calls in §14.
- **Refinement pass — owner-flagged gaps (2026-06-28):** still in `/planning-workflow` (no beads yet).
  The owner flagged four under-baked areas; each deepened in-place: **label size** → constant
  screen-space sizing + importance + declutter (§5.1 A1d/A1e); **car identification** → new §5.4
  multi-channel identity system (palette + roof number + phone mirror + own-car chevron + off-screen
  arrow) + `FB-carid`; **assets** → opinionated pipeline (CC0 library meshes + runtime paint/decal/
  number + AI-2D-only + validation gate, flag-gated) (§11.5); **map geometry** → owner's root-cause
  insight ("we mess with coords and forget to visually check") promoted to §8.0: one geometry frame +
  winding canonicalize + offset-with-repair + an **automated top-down debug-render/golden-seed gate**,
  with `FB-geoframe` as the foundation the curb/checkpoint/map beads build on.
- **Refinement pass 2 — camera car-size + assets spike (2026-06-28):** added §5.5 (per-mode
  *target-car-size* framing — split before shrink — + raised pitch + scaled-up orientation cues:
  trails/smoke/shadow/chevron/under-glow; `FB-camdir`/`FB-camset` + new `FB-orient`). Dispatched a
  background **asset-sourcing spike** (CC0 libraries vs AI image→3D vs program/Blender generation) —
  **complete** (`asset-spike-2026-06-28.md`): verdict = CC0 library meshes + runtime recolor + AI-2D-only;
  key finding that `VehicleFactory` loads no glTF today (so `FB-assets` is mainly a loader path); 5 CC0
  silhouettes downloaded + verified; new perf open-question (recolor vs `InstancedMesh` → `FB-instperf`,
  §14 #11). Folded into §11.5/§13/§14. **Status: still planning — not converting to beads yet.**
- **Refinement pass 3 — debug-viewer-driven principles (2026-06-28):** built a live car-asset viewer
  (`frontend/car-viewer/`) that proved the recolor/wheels/emissive/rigging pipeline and surfaced:
  principle 8 (every debug aid is a togglable in-game setting → `FB-debugmenu`), principle 9 (verify
  *correctness* not *presence*; a forward-axis assumption caused a headlight mix-up — make it an
  explicit normalization convention), a tightly-scoped `FB-lightdamage` bead (breakable head/tail
  lights), and refinements that headlight cues should be a **cast cone** (not an ultra-bright sphere)
  with lights **rigidly attached to the chassis**. **Status: still planning — not converting to beads yet.**

---

## 16. Round-1 review integration ledger

> Reviewer findings and their disposition (per the Jeff workflow's "what I wholeheartedly agree with /
> somewhat agree with / disagree with"). Raw reviews retained in the session scratch
> (`reviews/round1-*.md`).

### Wholeheartedly agreed → integrated
- **Spline edge-barrier yaw is NOT a bug** (Codex-correctness). `atan2(-dz,dx)` is correct for the
  convention; downgraded in §2 #2 and §8.1, kept only as test coverage. *This was a real error in v0.*
- **Curb fix ≠ blind `θ+π/2`** (Codex-correctness). Now yaw-from-tangent + `longAxis·radius≈0` invariant
  (§8.1 D1a/D1b).
- **`setWheelSideFrictionStiffness` IS in `rapier3d-compat@0.19.3`** (Codex-correctness). ⚠ dropped;
  promoted to the primary wall-slide/drift lever and a new F2/`default.json` param (§7.1, FB-wall).
- **Four new code bugs** (Codex-correctness): derby `pushForce` not `dt`-scaled, checkpoint ignores Y,
  `wallMesh` is a `THREE.Group` (glow update broken), `setWallCollider` dead — all added to §2/§8 and
  folded into FB-curb/FB-derbywall/FB-checkpt.
- **`FB-runtime` as a Wave-0 gate** (both Codex + Claude-gaps). Headless `PhysicsSystem` needs a
  `PhysicsRuntime` (injectable rapier + clock) + `SimVehicleAdapter`; precedent at
  `track-physics.test.ts:15`; Playwright fallback. Re-sequenced all sim-gated beads behind it (§12.2,
  §13, §14 #8).
- **Twin-shooter had no steering + contradicted its cited research** (Claude-gaps). Fixed mapping in
  §6.1 (left = steer + fire-direction; right = throttle) and flagged rear-fire as host-authoritative →
  new `FB-rearfire` bead.
- **Recovery vs. derby elimination conflict** (Claude-gaps). §7.4 now branches: derby OOB = elimination
  (owned by `DerbySystem`), never a reset.
- **Wall/suspension metrics were under-defined** (Claude-test). Replaced with tangential-retention-vs-
  ideal-slide + bounded stopped-time + heading-realignment, and a damping-ratio band for "bouncy"
  (§12.2). Added steering/accel metrics, self-determinism gate, CCD/tunnelling, golden baseline.
- **No perf/network/scale gate behind "no caps"** (both Claude). Added §12.6 (FPS floor, audio voice
  cap, physics scale, network budget) + `FB-perf`; A2c grid capped ~8 with LOD/marker downgrade.
- **Splitscreen ordering & policy** (both Codex + Claude). `FB-camdir` now depends on `FB-names`
  (world-space sprites first); split-mode post-processing policy + per-viewport HUD ownership noted;
  two implementations (divider shader vs scissor grid). Fixed the A2b→A2c typo.
- **Audio harness reality** (Codex-feasibility). `OfflineAudioContext` is Playwright/Chromium-only;
  extract SFX builders taking a `BaseAudioContext`, seed the noise; spectral-centroid + LUFS checks
  (§12.4).
- **In-band tests need a machine-readable contract** (Claude-test): `window.__jjTestResult` (§12.4).
- **Bug-report can't shell to gh/br from the browser** (Codex-feasibility): now a `POST /report`
  endpoint (§11.6, FB-bugtrk).
- **Seed/keyboard ownership vs the game-modes plan** (Claude-gaps): `FB-seed` single-owns seed work;
  `FB-scheme` owns keyboard, consuming game-modes §4.2b (§13 notes).
- **Rubber-banding was a principle with no bead** (Claude-gaps): added `FB-rubberband` (§13).
- **#2 two-devices-one-seat topology** undesigned (Claude-gaps): flagged in §10/§14 #10 + FB-invite.

### Somewhat agreed → partially integrated / noted
- **"Invariant: normals point outward" is wrong for inner walls** (Claude-test). Agreed for race tracks
  → restated as "toward the drivable side / nearest centerline" (§8.1 D1b). For the *circular* curb the
  outward sense is well-defined, so the curb invariant stays `longAxis·radius≈0`.
- **Visual tests should query bounds not pixel-diff** (Claude-test). Adopted `getBoundingClientRect`
  approach and pinned numbers (§12.4); kept a small number of seed-pinned screenshots as a coarse
  backstop where geometry isn't queryable.
- **`§12.6` over-claimed traceability for C1e/C1f/C3b** (Claude-test). Folded those under the FB-wall
  parent sweep rather than giving each its own bead — they're tuning options, not deliverables.

### Disagreed / deferred (with reason)
- **"Demote splitscreen to barely-worth-it"** — *disagree.* The 2-player divider split is cheap and
  high-delight; only the N-player *grid* is the expensive/unfair one, and it's already opt-in + capped.
  Kept the elegant 2-player path as a core feature.
- **"Make per-weapon FM recipes concrete now"** — *defer.* Research could not verify specific
  carrier/modulator recipes; forcing numbers now would be false precision. The jsfxr param model is the
  validated scaffold; values are a playtest/`FB-audio` exercise.
- **Heavy network re-architecture for 60 players** — *defer to measurement.* Added the load *gate*
  (§12.6) but not a speculative rewrite; the existing plan's "measure first" stance holds until the
  soak test shows the relay is actually the bottleneck.

### Round-2 dispositions (re-review of the integrated doc)
Round 2 found *polish, not surgery* (steady-state). All integrated:
- **Leftover §12.3 contradiction** (Codex + Claude): edge-barrier normal invariant still said "fails
  today / pins inverted-corners" after the yaw was downgraded → corrected to "drivable-side, passes
  today, coverage only."
- **Factual slip in Round-1 integration** (Codex + Claude-adversarial): the `track-physics.test.ts:15`
  precedent injects `RAPIER`/`world` but **not** `eventQueue`, and only creates **static barriers** —
  it never steps a vehicle. §12.2 corrected; `FB-runtime`'s vehicle-stepping risk no longer undersold.
- **Bead double-ownership** (all 3): `FB-curb` had absorbed derby + checkpoint-Y fixes also owned by
  `FB-derbywall`/`FB-checkpt` → titles disambiguated (curb-only; derby Group/collider/dt → FB-derbywall;
  checkpoint-Y → FB-checkpt) so parallel agents don't collide on `DerbySystem.js`/`Track.js`.
- **Metrics still gameable** (Claude-adversarial): wall scenario now **engine-off/coasting** + a
  **normal-restitution bound** (so a pinball bounce can't pass the slide test); **stopped-time made
  relative** (`< 0.1·v0`) so a 20 m/s car grinding at 0.6 m/s correctly *fails*; **heading-realignment
  scoped to assist-on**; **suspension ζ demoted to a diagnostic** (Rapier suspension isn't clean
  2nd-order; ζ redundant with overshoot; porpoising needs a separate **pitch** gate).
- **Playwright fallback oversold** (Claude-adversarial): now stated plainly it covers single-scenario
  regression **only, not sweeps** — so the `FB-runtime` clock extraction is **not optional**.
- **§12.6 gates lacked numbers / CI reality** (Claude-adversarial): added concrete targets (voice cap
  ≤16, physics ≤~8 ms/frame, network p95 @ 3600 msg/s) and flagged that the FPS gate needs a **GPU
  runner** (SwiftShader CI can't satisfy it) or a draw-call proxy.
- **Bead re-pointing** (Claude + Codex): `FB-oob` → depends on `FB-checkpt`, gated by in-band/E2E (it's
  a GameHost change, *not* sim-gated) so a cheap fix isn't trapped behind Wave-2; `FB-perf` → depends on
  `FB-camdir` (the ladder degrades camera cost, which must exist first); `FB-rubberband` → +`FB-checkpt`
  (needs ranking); voice-cull single-owned by `FB-audio` (FB-perf only asserts the bound);
  baseline-metrics gate gains tolerance bands.
- **Cosmetic** (Codex + Claude): doc status, §2 title ("Map-surfaced findings"), §12 "seven layers",
  §12.5 cross-ref (§12.6), §5.2 stale numbered steps, name-tag floor (28px@4K) — all reconciled.
- **Disagreed / deferred:** "demote splitscreen" — *disagree* (the 2-player split is cheap+delightful;
  only the opt-in grid is expensive); concrete per-weapon FM recipes — *defer* (unverified, false
  precision); QR/HUD split-layout ownership — folded as a noted sub-task of `FB-camdir`/`FB-camset`
  rather than a new bead.
