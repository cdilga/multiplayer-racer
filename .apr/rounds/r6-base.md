# Joystick Jammers 0.2 — First-Principles Revamp Plan

> **Status:** DRAFT r6 (2026-09-29). r1 applied the owner's answers to r0; r2 added R19–R25; r3 added R26–R28 and the Franken-stack survey (§13.6); r4 added R29–R35 (car choice, lobby UX, teams/tournaments, Mad Max shaders); r5 added R36–R50 (house-party vision); r6 adds R51–R56 (wheelie bin, preview backends + clean-up, Australianisms research, Blender greybox car, spoken copy). Next: owner approval, then
> ≥ 4 planning-workflow review rounds, then conversion to beads under label `v0.2` using §18.
>
> **Supersedes, when approved:** the camera portions of `feedback-design-pass.md` §5 (Voronoi / divider
> split), the deploy path in `.github/workflows/deploy.yml` + ppaas, the Flask/Socket.IO server, the
> current vehicle models, and the neon/lo-fi visual direction in `docs/design-brief.md` and
> `docs/design/02-design-language.md` (replaced by the comic direction in §10).
> **Builds on:** `JOYSTICK_JAMMERS_ART_PIPELINE.md` (art loop + contract idea), `game-modes-and-flows.md`
> (Local/Remote roles), `BEAD-DEFINITION-OF-DONE.md` (behavioural acceptance), the existing
> `PhysicsSimHarness` / weaponLab scenarios.

### Owner rulings captured in r1 (2026-09-29)

| # | Ruling |
|---|---|
| R1 | **Joystick Jammers is completely separate from Physical Soccer.** No shared code, crates, repos, deploy repo, runners-as-dependency or imports. Physical Soccer was a *reference for ideas that worked*; we re-implement what we need, in our own shape. Don't copy things we don't need. |
| R2 | **Rust replaces the Python server on day 0.** No load-test gate. Structure the Rust workspace in the Jeffrey Emanuel style (§13.2). |
| R3 | Cameras: a **dynamically resizing grid** of all players as they join (drop-in mid-round), with **per-car first-person or third-person** view; plus a **shared Overview** camera for derby/arena. |
| R4 | Strong **identification** on both controller and screen, plus an **Identify** button that flashes the player's number on both. |
| R5 | Drop-in: join and start driving ASAP, mid-round; scores just won't be good until the next round. |
| R6 | Killcam **only in derby modes**. Races get an end-of-race **highlight reel** of major events. No random mode rotation. |
| R7 | More fun car physics: better to drive as a racer and as a derby car, **real suspension feel**. |
| R8 | Cars are **destructible into parts** (chassis, wheels, body panels, doors, bumpers…); debris stays on the field for the whole match and becomes obstacles. **Environmental destruction** exists and realistically damages cars. Too damaged ⇒ **respawn nearby with a small time penalty**. |
| R9 | Weapons: the current eight are the starting list; a **big list** follows on the roadmap. More modes on the roadmap too. |
| R10 | New mode ideas all approved ("maximum fun"): Stunt Arena, King of the Bowl, Team modes, Ghost role, bot fillers (and more on the roadmap). |
| R11 | **Procedural tracks, much better**, themed on **Australian locations**: beach, forest, city, outback grassland, desert and other iconic places. On-track and off-track surfaces with different properties; dunes, jumps and environmental features. If procedural can't be made fun, come back to the owner and author maps directly. |
| R12 | **Comic-adjacent, bold visual style**; UI with tastefully not-quite-straight lines. |
| R13 | Audio: **Australian announcer** picked from a TTS model's latent space; **music regenerated** keeping the original vibe; **engine/SFX regenerated**. |
| R14 | Host works on **a phone, a laptop or a TV at any resolution or aspect ratio**. Keep a path to **2nd/3rd displays** as a future first-party feature for even more players. |
| R15 | Reference TV: **TCL 4K TV**. Reference host: **this laptop** (the owner's Mac). GPU runners: the shared TrueNAS runners; if they're not configured for general use, make them general (owner permission granted). |
| R16 | Models: **replace entirely**. |
| R17 | "Atlas" isn't essential; what matters is **contracts between the art pipeline and the game**. Study the art-loop team's tooling from their Spider-Man game *conceptually* to inform ours; don't copy their scripts. |
| R18 | Deploy via **Gitea** with rainbow previews, far more scripting and no agent hand-holding. |
| R19 | Announcer: **FrankenTTS** (offline tool), voice picked from its latent/speaker space. |
| R20 | Wreck respawn time penalty starts at **~2 s** (tuned in playtests). |
| R21 | **Derby = points for damage in a timed round.** No knock-outs: early playtests showed people got bored when knocked out too long. Wrecked cars respawn fast and keep playing. |
| R22 | 0.2 must fix the two biggest playtest complaints: **"which car am I?"** and **cars too small on screen despite heaps of room**. |
| R23 | The **host can switch camera modes at any time** (mid-round too). Derby defaults to Overview. |
| R24 | **Procedural generation is the main aim for all maps**, including proper derby arenas; the pipeline must also allow hand-crafting a specific map later. |
| R25 | First theme: **Australian outback around Uluru and Kata Tjuta (the Olgas)**, with crazy jumps and water that flows sometimes. |
| R26 | **Procedural generation runs at runtime in the browser**: the host makes a fresh map for each round, no build step, no server. |
| R27 | Survey Jeffrey Emanuel's projects for more we should use; FrankenSQLite stands out. |
| R28 | Debug logs and analytics need a proper design, but **later** (placeholder §17.3). |
| R29 | **Players choose their car.** Cars have different stats, including niche ones (damping, wheelbase, turning circle…). Roughly balanced; more cars later. |
| R30 | Roster includes **classic Australian vehicles, restyled and renamed** (vibe, not exact specs): AU Falcon, Mitsubishi Triton, 100 Series LandCruiser, Suzuki DR-Z 400, Ford Laser, Holden Barina, Holden Cruze; plus racing cars, generic cars and go-kart-ish things with Aussie flavour. All in the funky style with made-up names. |
| R31 | **Per-player car select and Ready-up**, with **host force-start**. Before forcing, warn not-ready players (visual + haptics on mobile/pads where possible). Sensible UX overall. |
| R32 | **Team and solo** modes; good **tournament / round progression and scoring**. |
| R33 | **Name selection** for players. |
| R34 | **Brilliant shaders with a slightly Mad Max feel and emissive effects throughout.** |
| R35 | **Use RCH liberally** for remote builds this time. |

#### The house-party vision (r5)

> Throw it on the TV and anyone can have a bunch of fun. It runs on anything, can grow to more screens,
> everything just works, and there are laughs all round. Not super-intense competition, but with a
> competitive edge, so anyone can play.

| # | Ruling |
|---|---|
| R36 | **There is never a "waiting for a slot" experience.** Anyone can drop into the room at any time and play. The room has proper **End game** and **Disband room** features. |
| R37 | Late joiners should get neither too much advantage nor disadvantage. Derby is the hard case (earlier players have had longer to score), so it gets explicit fairness rules (§10.9). |
| R38 | **Auto round progression** with a timeout and options. A **bigger QR between rounds** invites people to join. **Voting** on the next map/mode. |
| R39 | **Party Mix** (a varied, voted mix) is the default, but the same system also runs **straight Derby tournaments and Race tournaments**, so the host can tailor it to how serious the group is. |
| R40 | **L-plates assist** approved: it helps newcomers have fun but must **not** let them beat skilled players, and the car shows **real L-plates visible to everyone** in game. |
| R41 | **"Surprise me"** for name/car, clearly labelled as automatic. |
| R42 | **Soft competition** approved: lots of comic awards, everyone features in the highlight reel. |
| R43 | **Chaos events** approved, with sensible variants (flash flood, cyclone, …), mostly for race modes. |
| R44 | A wrecked derby player waiting to respawn can do something environmental (send in debris, etc.). |
| R45 | **Autopilot bot** takes over a car when its player goes idle or drops out. **No auto-pause** on dropout (manual pause is allowed). May change after playtesting. |
| R46 | Races end at most a **timeout after the first finisher**; unfinished cars are placed by current progress; finishing inside the time earns a **points boost**. All of this is host-configurable with sensible defaults. |
| R47 | **Runs on anything, without overthinking it:** target GPU-capable phones and laptops (often a laptop plugged into a TV, sometimes with a discrete GPU). Never *limit* what people can do; a weaker host just ends up with fewer players in practice. A lower-fidelity settings menu is **deferred**. Extra screens later could simply be another phone added as a display. |
| R48 | **Short URLs live under the existing `jammers.dilger.dev`** for everything (index, join, promoted builds, previews). |
| R49 | **Spike: can the host run a small TTS at runtime** (so the announcer can say players' actual names)? Extra screens are a **stretch** goal. |
| R50 | At the end of each round the **highlight reel plays by default**, with a timer (~1 min) while the next round gets ready. Scope is tiered: **Minimum build** (one car, one mode, one theme, everything working, for the first playable couch test), **Full build**, **Stretch**. |
| R51 | The derby mayhem "skip bin" is a **wheelie bin with a red lid**, full of rubbish including nappies. |
| R52 | **Rainbow previews genuinely have separate backends.** Clean-up policy: always keep the latest; auto-clean after a day, leaving at most the 3 most recent, unless the owner pinned one. Previews can be rebuilt from source, so deleting them is safe. |
| R53 | **Research pass on Australianisms** (e.g. "Latest to rock up") for comic awards and other copy. |
| R54 | The **Minimum-build greybox car is designed and textured in Blender**: an early test of the whole art pipeline, not a placeholder primitive. |
| R55 | FrankenTTS pre-rendering of generated **names is dropped**. FrankenTTS renders **all other spoken copy** (announcer lines, awards, chaos warnings, countdowns, numbers/colours). |
| R56 | Derby is **3 minutes**, ranked by raw points: players present from the start are more likely to win, and penalising late joiners is fine. Theme order is the plan's call (§11.1). |

---

## 0. How to read this plan

| § | Decides |
|---|---|
| 1 | What 0.2 is, keep/rewrite, decision register, gates |
| 2 | Fun pillars |
| 3 | Vocabulary and roles |
| 4 | Controls: twin-stick phones, gamepads and keyboards anywhere |
| 5 | Identification and the Identify button |
| 6 | Screens, cameras, the dynamic grid, drop-in, any-aspect hosts, future multi-display |
| 7 | Vehicle physics: suspension, fun, robustness, tuning loop |
| 8 | Destruction: cars into parts, debris, environment, damage and respawn |
| 9 | Weapons as data cards, starting list and roadmap |
| 10 | Modes, killcam (derby), highlight reel (race), roadmap |
| 11 | Procedural Australian tracks and surfaces |
| 12 | Comic visual style and the art pipeline with contracts |
| 13 | Architecture: Rust workspace, host/controller JS, protocol |
| 14 | Audio: announcer, music, engines, SFX |
| 15 | Deterministic scenarios, captures, camera regression |
| 16 | Gitea + rainbow deploys, fully scripted |
| 17 | Testing, budgets, acceptance |
| 18 | Milestones and bead-ready cuts |
| 19 | Risks, open questions, next steps |

Status words: **REQUIRED** (owner ruling), **RECOMMENDED** (plan's call, owner may reverse),
**CANDIDATE** (must pass a greybox/playtest before production), **ROADMAP** (after 0.2).

---

## 1. Executive summary and decisions

### 1.1 What 0.2 is

Joystick Jammers is a **couch-first car party game**: one host screen (a phone, laptop or 4K TV)
renders the world; everyone else plays with whatever they have — a phone, a gamepad plugged into any
device in the room, or a key cluster on a shared keyboard. People can drop in at any moment and be
driving within seconds. Races and derbies are physical, destructive and loud; cars shed doors and
wheels that stay on the track as obstacles; an Australian announcer calls it; the look is bold and
comic.

0.2 is a deliberate, significant rework:

1. **Rust server from day 0** (relay + room services), a clean Rust workspace (§13).
2. **Controls become source-agnostic and twin-stick** (§4), with **identification** built in (§5).
3. **Dynamic grid** with drop-in and **per-car first/third person**, plus a **shared Overview** for
   arenas; **any screen size or aspect**; a path to extra displays (§6).
4. **Suspension-forward, fun car physics** measured by a scenario bank (§7).
5. **Part-based destruction** with persistent debris and destructible environments (§8).
6. **Procedural Australian tracks** with real surface variety (§11).
7. **Comic-adjacent visual rebuild** through a contract-driven art pipeline; all models replaced (§12).
8. **Audio rebuild**: announcer, music, engines, SFX (§14).
9. **Gitea + scripted rainbow deploys** (§16).

### 1.2 Keep / rewrite / retire

| Area | Decision | Why |
|---|---|---|
| Three.js host renderer | **Keep** | Mature, bundled, WebGPU fallback exists. The gap is content and shading, not the engine. |
| Rapier (`@dimforge/rapier3d-compat`) + `DynamicRayCastVehicleController` | **Keep** in the browser host; rebuild the vehicle layer on top | Already Rust→WASM. Our instability is tuning/geometry (CLAUDE.md: don't ×1000). |
| `PhysicsRuntime`, `PhysicsSimHarness`, weaponLab scenarios, `replayJournal`, `Rng`, `Clock` | **Keep and promote** into the scenario bank (§15) | Headless, seeded, injectable-clock: the right base. |
| `GameHost.js` (2.8k lines), `player.js` (3.5k lines) | **Rewrite** as thin orchestrators over systems | Input, camera, net and presentation all change at once; a clean cut is cheaper than surgery. |
| Voronoi camera, `VoronoiCameraCompositor`, `CameraClusterKernel`, cluster hysteresis | **Retire** | R3: dynamic grid + shared Overview. |
| Flask + Socket.IO (`server/`) | **Replace day 0** with the Rust workspace | R2. |
| All vehicle models and the vehicle catalogue | **Replace** | R16; new models must meet the destruction contract (§8, §12.4). |
| Neon / lo-fi retro direction | **Replace** with the comic direction | R12. |
| GitHub Actions + ppaas deploy | **Replace** with Gitea CI + our own protected deploy repo | R18. |
| Beads / `br` / Agent Mail swarm | **Keep** | Works. |

### 1.3 Decision register

| ID | Status | Decision | Rationale |
|---|---|---|---|
| D1 | REQUIRED | Camera modes: **Dynamic Grid** (every player a tile, resizing as players join/leave) and **Shared Overview** (one camera, no split, arena maps only). The host picks; the mode supplies a default. | R3. Grid is fair and predictable; Overview keeps arena chaos legible. |
| D2 | REQUIRED | Each car chooses **third-person chase** or **first-person (bonnet/cockpit)** for its own tile, from its controller, at any time. | R3. |
| D3 | REQUIRED | **Drop-in any time**: a new player gets a tile and a car at the next safe spawn within ~2 s; they score normally from then on but start behind. | R5. |
| D4 | REQUIRED | **Identify** button on every controller flashes the player's number/colour on the controller and pulses their tile/car on the host. | R4. |
| D5 | REQUIRED | Host works at **any resolution and aspect** (portrait phone to ultrawide to 4K TV); layouts are computed, never hard-coded. | R14. |
| D6 | REQUIRED | The render architecture treats the output as **N display surfaces** (N = 1 in 0.2), so 2nd/3rd displays can be added later without redesign. | R14. |
| D7 | REQUIRED | **Rust workspace replaces the Python server on day 0.** | R2. |
| D8 | REQUIRED | Twin-stick phone controller and gamepad parity; pads/keyboards work plugged into any device. | Owner, r0. |
| D9 | REQUIRED | Part-based car destruction; debris persists for the match; environmental destruction; heavy damage ⇒ nearby respawn + small time penalty. | R8. |
| D10 | REQUIRED | Procedural tracks with Australian themes, on/off-track surfaces, dunes, jumps and features. | R11. |
| D11 | REQUIRED | Comic-adjacent style; wobbly-but-tasteful UI lines. | R12. |
| D12 | REQUIRED | Killcam in derby only; race highlight reel at the finish. | R6. |
| D13 | REQUIRED | No shared code or dependency with Physical Soccer. | R1. |
| D14 | RECOMMENDED | One normalised **ControlFrame**, identical whatever the source; physics never sees the source type. | Makes phone vs pad fairness testable. |
| D15 | RECOMMENDED | Fixed-step **120 Hz** physics with interpolated rendering; all tuning numbers are versioned data with a rationale. | Better contacts, suspension and debris at speed; render-rate-independent feel. Cost checked in G-PERF. |
| D16 | RECOMMENDED | Weapons are **data cards** with physical effects (impulse/force/zone), counterplay and scenario fixtures. | Sweepable, testable, extensible to the big list. |
| D17 | RECOMMENDED | Post-processing runs **once** on the composited frame, never per tile. | Makes 24 tiles affordable with the comic outline/grade intact. |
| D18 | RECOMMENDED | The **art↔game contract** is machine-checked in CI. A model failing it cannot ship. | R17; art must never silently break physics or destruction. |
| D19 | RECOMMENDED | No explicit rubber-banding. Comeback comes from mechanics (respawn near the pack, pickups weighted by distance to the action, debris/hazards). | Keeps skill meaningful; consistent with the 5k3.35 wont-fix. |
| D20 | RECOMMENDED | Previews are cheap and frequent; stable promotion is an owner decision on an immutable tested candidate. | Rainbow deploy idea; no "green build = production". |
| D21 | RECOMMENDED | Playtest rounds use a written round record; repairs land before new building. | Worked well as a fun-maximising loop. |

### 1.4 Gates (they gate specific work, not everything)

| Gate | Question | Blocks | Evidence |
|---|---|---|---|
| G-PERF | On this laptop driving the TCL 4K TV: fps at N = 4/8/12/16/24 tiles, first- and third-person mix, with debris at match-end density? | Default quality ladder, art triangle/texture budgets, debris caps | §6.7 spike |
| G-FEEL | Owner accepts the 0.2 driving "feel reference" (race + derby). | Weapon balance, final vehicle archetypes | Playtest round record |
| G-LOOK | Owner approves the comic look: hero car, one Australian theme, UI kit, at 1/4/24 tiles and Overview. | Mass asset production | In-game captures + contact sheet |
| G-PROC | Are procedural tracks fun after two tuning rounds? | Whether to hand-author maps (R11 escape hatch) | Playtest round verdict |
| G-SIM | Are JS/WASM sweeps too slow for the tuning loop? | Moving the sim core into a Rust crate (§13.5) | Sweep timing |

---

## 2. Fun pillars

Check every feature against these.

1. **Find your car in one glance** — at the smallest tile, from the couch (§5).
2. **Physical, not scripted.** Crashes, weapons, stunts and destruction are forces and contacts;
   multi-car chaos emerges. The *next* action should be legible from what you can see; the *outcome*
   may surprise.
3. **Low floor, high ceiling.** Driving within 10 s of joining; practice visibly wins (lines,
   drifting, boost timing, jumps, weapon leading, using debris).
4. **Nobody is out of the fun for long.** Drop-in, fast respawns, no derby knock-outs (R21), one-press rematch.
5. **Any controller, equal footing.** A phone player can beat a pad player.
6. **Bold, comic, juicy.** Every hit has hit-stop, sound, a comic impact graphic and a camera response
   sized to the event.
7. **Zero-friction session.** QR → driving in < 20 s; setup never hides the QR.

Anti-goals: hidden catch-up; invisible timers that make identical situations behave differently;
cameras that thrash; art that only looks good in Blender; features copied from elsewhere without a need.

---

## 3. Vocabulary and roles

### 3.1 Roles

- **Host** renders the world and owns the simulation and room authority. Any device: phone, laptop,
  TV browser.
- **Controllers** (phones, keyboards, pads, hub laptops) send input and show a light HUD; they don't
  render the world in Local mode.
- **Remote mode** viewers render their own view on their own device; degrade gracefully, never gate.
- **Server** (Rust, §13): serves the static bundles, the relay between controllers and host, room
  codes and QR routes, telemetry/bug-report intake. It does not simulate.

### 3.2 Typed vocabulary

| Primitive | Meaning |
|---|---|
| `Room` | The party: settings, humans, teams, rounds, build binding. Results don't end it. |
| `Host` | Simulation authority and main display(s). |
| `Display` | One output surface the host renders to (1 in 0.2; §6.6). |
| `Endpoint` | One controller page/app run with resumable membership; may carry several sources and humans. |
| `InputSource` | Touch surface, gamepad, keyboard cluster, or the host's own keyboard/pads. |
| `Human` | A person: name, number, colour, team. |
| `Channel` | One ControlFrame stream bound to one `Car`. |
| `Binding` | Physical input → channel, from a versioned preset. |
| `Car` | Simulated vehicle: body, parts, damage, weapon slot, camera preference. |
| `Seat` | Stable room slot surviving reconnects. |
| `Tile` | A car's screen region on a display. |

**Invariant:** no integer named `playerId` means more than one of these. Today's code overloads
socket id / player id / car index; the rewrite fixes that at every boundary. (Rust gives us typed
newtype IDs for free: `HumanId`, `SeatId`, `CarId`, `EndpointId`, `ChannelId`.)

### 3.3 Required topologies (each becomes an e2e or device-matrix row)

| Topology | Example |
|---|---|
| 1 phone = 1 human | Default. |
| 1 phone = 2 humans | Landscape phone split: each half is a one-stick auto-throttle preset. |
| Host + 4 USB/BT pads | Claim a pad by pressing a button on it. |
| Host keyboard = 2–4 humans | WASD / arrows / IJKL / numpad clusters. |
| Hub laptop with 4 pads | A laptop opens `/hub` and contributes its pads/keys. |
| Android phone + USB-OTG pad; iPhone + BT pad | Phone hides touch sticks once the pad is claimed. |
| Phone as host | A phone renders the game (small grid or Overview) while other phones control it. |
| 24 mixed on the 4K TV | Phones, host pads, hub pads, keyboard clusters. |

---

## 4. Controls

### 4.1 The ControlFrame

```text
ControlFrame v1 (per channel, per sample)
  steer      i8   [-127, 127]  after source shaping (deadzone, curve)
  throttle   u8   [0, 255]
  brake      u8   [0, 255]     brake held near standstill = reverse (as today)
  aim        u8?  angle/256     only in aim presets
  buttons    u16  fire, boost, handbrake/drift, wheelie/stunt, horn, respawn, camera-toggle,
                  identify, pause
  edges      u16  pressed-since-last-frame per button (short taps survive polling/coalescing)
  seq        u32
  source     enum touch|pad|keys|hub  (telemetry only; the simulation must ignore it)
```

Sent as state + edges at a fixed 60 Hz (or on change, rate-limited). The Rust protocol crate owns the
codec (§13.3); the JS side uses the same schema via generated bindings, so the two cannot drift.

### 4.2 Phone twin-stick layout

Landscape, full-height regions, nothing small in the thumb paths:

```text
┌───────────────────────────────┬───────────────────────────────┐
│ LEFT THUMB — STEER            │ RIGHT THUMB — DRIVE + ACT     │
│ floating stick, x only        │ floating stick:               │
│                               │  up = throttle (analog)       │
│ hold outer edge = handbrake   │  down = brake / reverse       │
│                               │  flick up = boost             │
│                               │  pull down + release = wheelie│
│                               │  tap (no drag) = FIRE         │
│ ┌────────┐                    │ [weapon icon + charge ring]   │
│ │ 🎮 #7  │ [👁 3rd/1st] [⚡ID] │ [damage meter]                │
│ └────────┘ identity chip      │                               │
└───────────────────────────────┴───────────────────────────────┘
```

- **Floating sticks** (origin where the thumb lands) replace the fixed `Joystick.js`.
- **Analog throttle on the right stick** is what lets a phone compete with a pad's trigger.
- **Tap-to-fire** uses a tap threshold (short, little travel; tuned in G-FEEL) so throttle isn't
  interrupted.
- **Presets** (per human, remembered per device): `twin-stick` (default), `twin-aim` (right stick aims,
  fire on release, auto-throttle; for derby), `one-thumb` (auto-throttle; accessibility),
  `split-phone-2p`.
- **Lost-pointer lifecycle:** a lost/cancelled pointer releases its stick and re-arms; a backgrounded
  page releases every held input. "Car drove with no input" must be impossible (30-min soak test).
- **Portrait-locked phones** rotate the landscape composition in place with corrected touch mapping.
- **Wake lock** while in a room. **Haptics** (`navigator.vibrate`) on hits/pickups where supported;
  never required.
- HUD stays light: identity chip, weapon, boost, damage, position/points, camera toggle, Identify.

### 4.3 Gamepads and keyboards

| Source | Default binding |
|---|---|
| Pad (standard mapping) | L-stick X steer; RT throttle; LT brake/reverse; A boost; B handbrake; X fire; Y wheelie; R-stick aim (aim preset) / look-back (default); R3 camera toggle; Select identify; Start pause. Platform glyphs. |
| Keyboard clusters (≤ 4 per keyboard) | WASD + Space/Shift/Q/E/R; Arrows + RCtrl/RShift/,/./ ; IJKL + U/O/H/;; Numpad 8456 + 0/Enter/7/9. Warn about ghosting when > 2 clusters are claimed. |

Per-source shaping (deadzone, response curve, **steer rate-limit for digital keys** so keyboard
steering isn't bang-bang) is data with fixtures. `steeringAuthority`/`steeringAssist` run *after* the
ControlFrame and are source-blind.

**Overview camera option:** in a single overhead camera, some players want camera-relative steering
("push the stick where you want to go"). Offered as the `overview-relative` preset in derby; the
playtest decides whether it's the default there.

### 4.4 Plugged in anywhere

| Where the device is | Route |
|---|---|
| Host device (USB/BT) | In-process: host Gamepad API / key events → local endpoint. Works with no network. |
| A phone (Android OTG/BT, iOS BT) | Phone endpoint → server relay → host. |
| A hub laptop (`/hub`) | Hub endpoint carrying N sources → relay → host; one batched frame per tick. |
| Remote player | Their own device's pad/keys/touch, same ControlFrame. |

Claim-by-press: a pad appears as *unclaimed* in the lobby's **input drawer** until someone presses a
button; no phantom players per plugged-in device. Device, human and car counts are shown separately.
Pads visible per browser/OS are **measured** and recorded (XInput caps at 4 on Windows; other backends
differ); beyond the limit, add a hub.

### 4.5 Join speed and reconnect

- QR → controller **bootstrap** page (no game assets, no THREE) → seat claim → driving.
  Target TTI ≤ 1.5 s on a mid Android over venue Wi-Fi (measured).
- Seat credential in storage; resuming reclaims the same seat, car and score. Connection quality dot on
  the controller chip.
- **Autopilot (R45):** if a player's input goes silent (disconnect, locked phone, or no input for
  ~20 s while their car is stuck/idle), a **bot takes over their car** with a visible 🤖 badge on the car
  and tile. It drives deliberately *badly-but-sensibly* (medium-low skill bot, no weapon use) so it
  keeps the car in play without earning much. When the player returns, any input hands control back
  instantly. **No auto-pause** on dropout; the host can pause manually at any time.

---

## 5. Identification

Readability pillar #1, and the top playtest complaint (R22): in a 24-player grid or a busy Overview, "which one am I?" must be answered in under a second. Car *size* is the other half of the complaint; see §6.4.

### 5.1 Identity kit (every car, every surface)

| Element | Screen | Controller |
|---|---|---|
| **Number** (1–99, assigned at seat, stable for the session) | Huge roof number, number badge on the tile corner, number on the nameplate above the car in other tiles/Overview | Big number in the identity chip |
| **Colour + pattern** (curated palette of 16 colours × distinct pattern: stripes, checks, flames, dots, zigzag…) | Car paint, tile border, trail tint | Chip background + pattern; controller UI accent |
| **Name** | Tile label; Overview nameplate (scaled to stay ≥ 28 px at 4K) | Header |
| **Source icon** | Small icon on the tile badge: 📱 / 🎮 / ⌨ | Shown for hub/pad seats (a pad seat on a phone shows "🎮 #7") |

Colour-blind safety comes from pattern + number, never colour alone. Tile order in the grid follows
seat order (join order), never race position — you learn where you are on the TV.

### 5.2 Identify button

- Press **Identify** (controller button / pad Select / key) ⇒ for ~1.5 s: the player's tile border and
  number badge pulse and scale up, a comic "#7 THAT'S YOU!" burst appears over their car, their car
  gets a bright outline visible in *other* tiles and in Overview; the controller flashes the same
  number/colour full-screen (and vibrates where supported).
- Auto-fires once on join and on respawn, so newcomers get it without asking.
- Rate-limited (e.g. once per 3 s per player) so it can't be used to obscure others.
- Test: capture scenario `identify-24` asserts the pulse is visible in the right tile and nowhere else.

---

## 6. Screens and cameras

### 6.1 Camera modes

| Mode | For | Behaviour |
|---|---|---|
| **Dynamic Grid** | Races and any mode | One tile per car; the grid resizes as players join/leave; each car chooses first- or third-person. |
| **Shared Overview** | Derby/arena maps | One camera framing the action, no split. |
| **Auto** (default) | — | Arena maps default to Overview; tracks to Grid. |

The host can switch Grid ⇄ Overview **at any time, including mid-round** (R23; ~300 ms animated transition) (arena maps only for Overview; on
track maps it's disabled with an explanation — a course doesn't fit one readable frame).

### 6.2 Dynamic grid layout

Pure function in the render layer: `layout(displayRect, safeArea, cars[], prefs) → tiles[]`.

- Choose rows × cols with rows·cols ≥ N, minimising unused area, subject to each tile's aspect staying
  in a playable band (target ~1.2–2.0 for third person; first person tolerates a little narrower).
- Works for **any display aspect**: a portrait phone host gets a vertical stack (1×2, 2×2, 2×3…); an
  ultrawide gets more columns. Nothing assumes 16:9.
- Spare cells show a **filler**: QR "join now", mini-map, leaderboard or kill feed. Never black.
- **Resizing is animated** (~300 ms ease) when N changes; existing tiles keep their relative order.
  During a round, tiles never reshuffle because of position changes — only joins/leaves reflow.
- **Leaves:** a disconnected player's tile shows "reconnecting…" for the grace period, then is removed
  at the next reflow.

Reference numbers at 3840×2160 (for budgeting, not a fixed table):

| N | Grid | Tile px |
|---|---|---|
| 4 | 2×2 | 1920×1080 |
| 6 | 2×3 | 1280×1080 |
| 9 | 3×3 | 1280×720 |
| 12 | 3×4 | 960×720 |
| 16 | 4×4 | 960×540 |
| 20 | 4×5 | 768×540 |
| 24 | 4×6 | 640×540 |

For N = 2 on 16:9, side-by-side tiles are too tall and stacked tiles too wide; the kernel picks
letterboxed side-by-side or 2×2 with fillers — G-LOOK decides which looks better.

### 6.3 Per-car view: first person or third person

- **Third person (default):** spring-damped chase with speed-scaled look-ahead, collision-aware pull-in,
  FOV/pitch by tile-size class (smaller tiles → slightly wider FOV and higher pitch).
- **First person:** bonnet or cockpit camera from a `cam_fp` node in the car model (contract §12.4),
  with head-bob from suspension (subtle, comfort-limited), speed FOV kick and a visible bonnet/wheel
  edge so you feel the car. Damage is visible (cracked-glass overlay, flapping bonnet).
- Toggle any time from the controller; remembered per human.
- Both cameras show **threat arrows** at tile edges (incoming missile, car close behind) and the
  off-screen arrow to your car if the camera ever loses it.
- On respawn: cut, not swoop. Heavy hit: trauma shake scaled to tile size.

### 6.4 Shared Overview (arena)

**Cars must be big (R22).** Playtests found cars too small even with lots of empty screen. Fixes, in
priority order:

1. **Arena size scales with the car count.** The derby generator (§11.4) sizes the arena for the
   expected N and the camera never frames empty arena: it frames the *cars' bounding box*, not the
   arena bounds.
2. **Minimum car size:** the camera zooms/tilts so the median car is at least a target screen height
   (start: ≥ 6 % of screen height at 4K, ≥ 80 px), within the arena clamp. If the cars are too spread
   out to meet that, it keeps the pack (densest cluster) at size and shows off-screen arrows with
   numbers for outliers, rather than zooming out to fit everyone tiny.
3. **Screen-filling framing:** frame to the display's aspect (no letterboxing); HUD in thin edge bands.
4. **Bigger cars in derby**: derby profiles may use a larger visual scale (with matching colliders)
   if G-LOOK shows it reads better.
5. **Host override:** zoom bias slider and instant switch to Grid (R23).

Acceptance: scenario `derby-overview-24` and `derby-overview-8` assert median car height ≥ target and
empty-arena fraction of the frame ≤ a measured threshold.

- Frames all alive cars plus margin, clamped to arena bounds, fixed pitch (≈ 55–65°), never rotates,
  critically damped zoom. At high N it settles at "whole arena" and stays — stability beats tightness.
- Identity: nameplate + number + colour ring under each car, scaled by camera distance.
- Derby killcam plays as picture-in-picture or full-screen interstitial (§10.3).

### 6.5 Drop-in flow

1. Scan QR → claim seat → choose name (optional; auto name + number assigned instantly).
2. Host reserves a tile immediately (grid reflows) showing "#12 GET READY" with the identity kit.
3. Car spawns at the next safe spawn point **near the back of the pack** (race) or a free edge spawn
   (derby), with 1.5 s spawn protection (ghosted, no collisions) and the Identify pulse.
4. Scoring: race: they're classified from where they actually finish; derby: see the late-join
   fairness rules in §10.9. Next round they're a normal starter (R5).
5. **No slot limit, ever (R36).** There's no queue and no "room full". The grid just grows (§6.2); on a
   weak host that means smaller tiles, which the host can answer by switching to Overview. The only
   hard limits are resource-safety ones (e.g. relay message rate), and those show a clear message
   instead of silently refusing.

### 6.6 Any host, any aspect, future extra displays

- Everything on screen is laid out from the display rect: HUD, grid, fillers, overlays. UI scale uses
  viewing-distance profiles (TV / desk / handheld) chosen from size + pixel density, host override.
- **Phone host:** landscape preferred; portrait works with the vertical grid; small N or Overview by
  default. Fullscreen + wake lock requested from a user gesture; iOS gets the Add-to-Home-Screen hint.
- **Multi-display (ROADMAP, designed now):** the renderer takes a list of `Display` surfaces. In 0.2
  there is one. Later a second browser window/device can register as **Display 2** of the same room
  (joins via a display QR, receives state snapshots like a remote viewer, renders its assigned subset
  of tiles). The grid kernel already assigns tiles to displays, so 2nd/3rd screens only add a transport
  and a "which tiles go where" policy. This lifts the player ceiling beyond one screen.
  **STRETCH (R49):** the first version is simply "add a phone (or another laptop) as a display": scan
  the display QR, and it takes a share of the tiles.
- **Hardware target (R47):** GPU-capable phones and laptops, typically a laptop driving a TV. We don't
  cap players on weak hosts; they naturally run fewer. A "lower visual fidelity" settings menu is
  **deferred** (the automatic render-scale ladder stays, since it's cheap).

### 6.7 Rendering many tiles cheaply (G-PERF)

- One scene, instanced meshes; per tile: `setViewport` + `setScissor` + camera; per-camera culling.
- One shared shadow map per frame.
- **Post once** (D17): all tiles render into one full-resolution target; the comic outline, grade and
  halftone passes run once. Tile borders are drawn after post so effects don't bleed.
- Per-tile LOD by projected size in *that* tile; debris switches to merged/low LOD far away.
- Render-scale ladder driven by the existing `AdaptiveQualityController`, host override.
- Spike output: fps/frametime p50/p95 at N = 4/8/12/16/24 (third-person, then 50 % first-person),
  1080p and 4K, WebGL2 and WebGPU, fresh match and match-end debris density — on this laptop to the TCL
  TV, plus one phone host. Numbers set defaults; this plan asserts none.

---

## 7. Vehicle physics — suspension, fun and robustness

### 7.1 Principles

- Keep Rapier's `DynamicRayCastVehicleController`; never hand-roll suspension (CLAUDE.md).
- Fixed-step 120 Hz game time, accumulator + interpolation; cap catch-up at 8 steps/frame, then pause
  and resync rather than burst. Express impulses as F·dt so the step rate never changes feel.
- Every number is versioned data (`assets/vehicles/*.json`, `physics-profiles/*.json`) with a
  rationale and a fixture.
- Safety clamps (max speeds, NaN/Inf → neutral respawn + bounded diagnostic trace) exist but must never
  be what makes something fun.

### 7.2 What "more fun to drive" means (targets for the feel reference)

| Feel | Mechanism |
|---|---|
| **Visible, bouncy suspension** | Longer travel, softer springs with strong damping; body roll in corners, squat on launch, dive on braking; visual chassis offset driven by real wheel compression. Landing a jump compresses, rebounds once, settles. |
| **Drifting that's controllable** | Rear friction-slip reduction on handbrake with a smooth recovery curve; counter-steer works; drift builds boost. |
| **Airtime that's satisfying** | Mild in-air pitch/roll control (small torque from steer/throttle while airborne) so you can level a landing — skill, not auto-leveling. |
| **Weight you can feel** | Archetypes (light/medium/heavy + oddballs) with different mass, grip, suspension and knockback resistance. |
| **Surfaces matter** | Per-surface grip/rolling resistance/particles/sound (§11.3): tarmac, dirt, sand, mud, grass, gravel, wet, ice-free (Australia). |
| **Derby punch** | Ramming transfers momentum convincingly; front bumpers are stronger than doors (§8); T-bones matter. |
| **Wheelies and stunts** | The intentional wheelie input (existing 196.x work) kept, measured and rewarded in Stunt Arena. |

### 7.3 Robustness catalogue (each = scenario + invariant)

| Failure class | Fix direction | Scenario / invariant |
|---|---|---|
| Escaping the bowl / OOB | Lips, CCD, OOB reset | `bowl-rim-ram`: 200 seeded rams → 0 escapes |
| Flipped and stuck | Rounded cabin collider so cars roll back; gentle, visible self-right torque only when inverted and slow; respawn button after 2 s | `flip-recover`: from 12 inverted poses, ≥ 90 % upright within 3 s without input |
| Tunnelling at boost speed | CCD on chassis and fast debris; min wall thickness in the map validator | `boost-into-wall` over speed × angle |
| Pile-up explosions | Mass ratios ≤ 3:1, contact force caps | `pile-24`: no body exceeds v_max; energy decays |
| Suspension pogo / jitter | Damping ratio floor in profile validation | `idle-settle`: no-input car rests within envelope in 2 s |
| Debris jams that trap cars forever | Debris mass/size rules, sleep, push-through thresholds (§8) | `debris-field-drive`: a car can always drive out of a debris pile |
| Weapons launching cars to space | Per-card impulse caps + per-car knockback budget | §9 |
| Non-determinism | Seeded RNG, stable iteration order, no wall clock in sim | `replay-identity`: same inputs + seed ⇒ same trace hash (same build) |

### 7.4 Controllability metrics and invariants

Per scenario and archetype: 0–60 % top-speed time, top speed, stop distance, turn radius vs speed,
slalom success, drift entry/exit angle and speed retained, wall deflection, jump airtime and landing
stability, suspension settle time, wheelie envelope, recovery time after a hit, knockback per weapon,
"authority" (heading change from full steer in 0.5 s at 5/15/30 m/s), surface deltas.

Invariants: inputs matter in every grounded state; idle cars go quiet; no dominant mash (boost-forever
isn't the best line); every non-OOB state is recoverable within 3 s; mirrored scenarios mirror;
archetypes occupy distinct regions on the balance chart. Numbers are tolerance envelopes around the
owner-accepted feel reference, plus owner judgement. No single "fun score".

### 7.5 The tuning loop

```text
 sweep-picked candidate ─► scripted rainbow preview (§16) ─► couch playtest round
        ▲                                                         │
        └── repairs first ◄── investigation (scenarios, sweeps) ◄─ round record
```

Round record: `docs/playtests/round-YYYY-MM-DD.md` — per-area tables (`# | What we heard |
Decision/action`), owner decisions, root causes, the preview ID played, child beads under label
`playtest-round-<date>`. Repairs land before new building.

Tooling: a `sim` CLI over the headless runtime (`sim sweep --profile heavy --param
suspension.stiffness=18..30:2 --scenarios slalom,jump,wall --seeds 8` → CSV + HTML balance chart);
**bot drivers** (waypoint racer with skill noise; derby seek-and-ram/flee) used for sweeps *and* as bot
fillers (§10); per-car debug overlay (suspension, contacts, slip, CoM, damage) behind the debug menu;
the tuning panel exports a profile diff committable as data. No per-frame logging.

---

### 7.6 Vehicle roster and stats (R29, R30)

#### Stats model

Every vehicle is a data profile (`assets/vehicles/<id>.json`) with **real physical parameters** that
drive the Rapier vehicle controller, plus **derived display stats** for the select screen:

| Group | Physical parameters (shown in the "Nerd stats" panel) |
|---|---|
| Chassis | mass, centre-of-mass height, wheelbase, track width, collider shape, drag |
| Suspension | rest length, travel, spring stiffness, **damping (compression/rebound)**, anti-roll |
| Tyres | radius, friction slip (front/rear), lateral grip curve, surface affinities (tarmac vs sand vs mud) |
| Steering | max steer angle, steer speed, **turning circle** (derived from wheelbase + max angle, shown in metres) |
| Drivetrain | drive (FWD/RWD/AWD), engine force curve, top speed, boost capacity, brake force |
| Damage | armour per zone (§8), part HP, ram strength (front bumper), knockback resistance |
| Weapons | weapon slot count / mount (most 1; heavies can carry a bigger mount) |

**Display stats** (0–10 bars, derived by the `sim` harness from measured scenarios, not hand-typed):
Speed, Acceleration, Handling, Grip, Toughness, Weight, Off-road, Air (jump/landing), plus the niche
raw numbers in an expandable **Nerd stats** view (damping, wheelbase, turning circle, CoM height,
power-to-weight). Showing measured stats keeps the select screen honest after tuning changes.

#### Balance rule

Each vehicle gets the same **budget**: its position on the balance chart (§7.4) must sit on the
"frontier", strong somewhere and weak somewhere, measured by bots across reference tracks, derby arenas
and surfaces. Acceptance: in bot races on the reference track set, no vehicle's median finish is better
than the others by more than a set margin; in bot derbies, no vehicle's damage points per minute
dominate. Terrain can favour a car (the 4WD wins on sand, the hatch on tarmac); overall nothing
dominates. CMA-ES tuning (§13.6) helps find budgets; owner playtests judge feel. **Roughly balanced,
not identical.**

#### Starting roster (all new models, funky comic style, made-up names)

Names are placeholders to riff on. **No real badges, logos or trademarked names** in-game or in
assets; the vibe is "inspired by", with exaggerated proportions.

| Class | Inspired by | Working name | Character |
|---|---|---|---|
| **Aussie Classics** | Ford AU Falcon (sedan) | **"Fairlane Fury"** / "The Gull" | Big RWD family sedan: soft suspension, wallowy roll, great top speed, heavy ram, poor turning circle. Classic derby tank-lite. |
| | Holden Cruze (small sedan) | **"Cruz Missile"** | Honest all-rounder; the "starter car" baseline everything is balanced around. |
| | Ford Laser (80s/90s hatch) | **"Laser Beam"** | Light FWD hatch: nimble, tight turning circle, fragile, loves tarmac. |
| | Holden Barina (tiny hatch) | **"Barra-ina"** | Tiny, zippy, very short wheelbase (twitchy), bounces off everything, cheap to repair. |
| **Utes & 4WDs** | Mitsubishi Triton (dual-cab ute) | **"Tri-Tonne"** | Ute with a tray: stiff rear, bouncy when empty, good off-road, tray can catch debris for laughs. |
| | Toyota 100 Series LandCruiser | **"Land Crusher"** | Heavy AWD 4WD: long travel, high CoM (rolls if careless), best on sand/mud/water crossings, huge armour, slow to turn. |
| **Two-wheel** | Suzuki DR-Z 400 (dirt bike) | **"Dirt Zed"** | Dirt bike: fastest off-road, great in the air, very fragile, tiny target. **CANDIDATE** — a bike needs lean physics (see note). |
| **Racers** | Generic touring/rally car | **"Bathurst Bullet"** | Low, stiff, high grip, top speed; hates sand. |
| | Open-wheel racer | **"Wing Nut"** | Open-wheeler: extreme grip and speed on tarmac, falls apart in derby. |
| | Rally hatch | **"Gravel Rash"** | AWD rally: best on dirt/gravel, drifts beautifully. |
| **Generic** | Panel van | **"Sin Bin"** | 70s panel van with airbrushed side art: heavy, big side ram, surprisingly fast. |
| | Road-train prime mover (cab only) | **"Roo Bar Royale"** | Heaviest vehicle: giant roo bar (front armour), slow, near-unstoppable ram; long turning circle. |
| **Karts & oddballs** | Go-kart | **"Billy Kart"** | Tiny, very low, super twitchy, tight turning circle, great in packs. |
| | Ride-on mower / servo trolley kart | **"Snag Sled"** | Joke kart with a BBQ on the back (emissive coals). Slow but tiny and hard to hit. |

**Dirt bike note:** Rapier's raycast vehicle is 4-wheel-stable. The bike is built as a 2-wheel raycast
vehicle with an upright-assist torque and visual lean (or a narrow hidden outrigger collider). It's
**CANDIDATE**: it ships only if it drives well and survives the scenario bank; otherwise it waits for
a later roster.

Roadmap cars: Kingswood, HQ ute, Commodore VN wagon, Hilux, Troopy, Mini Moke, Datsun 120Y,
EH Holden, ice-cream van, school bus, mail scooter, lawn bowls cart, surf-rescue buggy.

Each vehicle has **two or three paint schemes**, plus the player's identity colour and pattern from
§5 (identity always wins over livery).

## 8. Destruction

### 8.1 Car anatomy

Every car model is authored as parts (contract §12.4):

```text
chassis (core, never detaches)
├── body_front / body_rear (bumpers)      detachable
├── bonnet, boot                          detachable (hinged first, then detach)
├── door_L, door_R                        detachable (hinged first, then detach)
├── wheel_FL/FR/RL/RR                     detachable (loss = handling change, not instant death)
├── glass (windscreen/windows)            shatter → particle + decal only
├── spoiler / roof rack / scoops          detachable (archetype flair)
└── lights (head/brake)                   break → emissive off
```

Each part has: hit points, the collider it contributes while attached, its debris collider/mass when
detached, attachment type (fixed → hinged → detached), and which zone of the chassis it protects.

### 8.2 Damage model

- Damage comes from **impulse magnitude at contact**, mapped to the nearest zone/part, scaled by the
  other body's mass and relative speed, minus a threshold (small bumps do nothing). Weapons apply
  damage through the same path (plus card-specific extras).
- Visual stages per part: pristine → dented (vertex-morph or swapped mesh) → hanging (hinge joint) →
  detached (becomes debris).
- **Handling consequences** are gentle and readable: lost wheel = limp (pulls to one side, less grip,
  sparks from the hub), lost bumper = zone more vulnerable, heavy chassis damage = smoke and reduced
  top speed. Never uncontrollable.
- **Too damaged ⇒ respawn** (R8): when chassis integrity hits zero, the car bursts (comic KABOOM), its
  remaining parts become debris, and the player respawns **nearby** — race: last checkpoint on the
  racing line with a small time penalty (~2 s to start, R20); derby: free edge spawn after ~2 s, damage points already scored are kept
  per mode rules. 1.5 s spawn protection.

### 8.3 Persistent debris

- Detached parts stay **for the whole match** (R8) as dynamic bodies that go to sleep when still.
  They're obstacles: cars can push, hit, launch and get stuck on them.
- Budget and safety: debris count is capped per match by G-PERF numbers; above the cap, the *oldest
  small* debris is merged into static props (still there, still colliding, no longer simulated), so
  the field keeps its history without the solver cost growing unbounded.
- "Stuck" rules: debris mass and shape are chosen so a car can always escape a pile with throttle +
  steer (scenario `debris-field-drive`); wheels are rounded; panels are thin but not paper-thin (CCD
  for fast ones).
- Debris keeps its owner's colour/pattern, so the track tells the match's story.

### 8.4 Environmental destruction

- Destructible props per theme (§11): fences, signs, bins, eskies, surfboard racks, water tanks,
  road cones, wooden posts, bus shelters, stacks of tyres, market stalls, and the **wheelie bin** (green body, **red lid**; on impact the lid
  flaps open and it sprays rubbish debris: crushed cans, pizza boxes, banana peels and **nappies**. The
  nappies are light, squashy debris that stick to windscreens for a second. Comic, not gross-out:
  cartoon-styled, no realistic textures).
- Each is a contract asset with pre-fractured pieces (authored or Voronoi-fractured in Blender by
  script), break threshold, piece masses and a "damage to car" factor — **heavy things damage cars
  realistically** (a water tank or concrete barrier hurts; a cardboard sign doesn't).
- Pieces become debris under the same persistence/budget rules.
- Some props are **hazards by design** (rolling barrels, falling signs) — CANDIDATE per theme.

### 8.5 Tests

Scenarios: `door-detach-at-threshold`, `wheel-loss-limp`, `chassis-zero-respawn`, `debris-persist-match`
(debris present at match end, count within cap), `debris-merge-oldest`, `prop-break-car-damage`,
`destruction-determinism`. Captures: `debris-field-end-of-derby`, `car-damage-stages` (contact sheet).

---

## 9. Weapons

### 9.1 Starting list (from `static/js/systems/WeaponSystem.js`)

Homing Missile (projectile), Proximity Mine (deployable), Nitro Boost (buff), Oil Slick (zone),
Rail Gun (hitscan), Energy Shield (buff), EMP Blast (aoe), Flamethrower (continuous).

### 9.2 Card schema

```json
{
  "id": "homing-missile", "version": 1,
  "class": "projectile",
  "physics": { "impulse": 9.0, "upwardBias": 0.35, "torqueImpulse": 2.0, "maxDeltaV": 14 },
  "damage":  { "amount": 35, "partBias": "rear" },
  "timing":  { "armMs": 250, "lifetimeMs": 4000 },
  "targeting": { "coneDeg": 50, "turnRateDegPerS": 140, "leadFactor": 0.5 },
  "counterplay": ["shield", "sharp-turn", "wall", "debris"],
  "presentation": { "vfx": "missile-smoke", "sfx": "missile", "comic": "KA-BLAM", "hitStopMs": 60 },
  "rationale": "why these numbers"
}
```

Rules: effects are forces, zones or bounded authority changes (EMP lowers steer/throttle gain
visibly for a bounded time, never to zero), never teleports or scripted poses. Every card lists
counterplay; a card without counterplay fails review. Damage routes through §8.2 so weapons break parts.

### 9.3 Per-card scenarios

`hit-stationary`, `hit-crossing`, `miss`, `self-hit`, `vs-shield`, `airborne-target`,
`into-wall-behind-target`, `vs-debris` (debris blocks/absorbs), `chain` (mine→mine, missile→oil),
`24-car-crowd`, `respawn-during-effect`, `cleanup`. Invariants: knockback within envelope; no OOB
launch from a single hit on arenas; per-car knockback budget prevents juggling; state fully drained at
round end; determinism hash stable.

### 9.4 Balance and juice

Sweeps against bot fights: derby time-to-wreck, race position swing per hit, hit rate for average vs
skilled bots, and how often a hit produces a multi-car outcome. Pickup placement/weighting by distance
to the action (D19). Presentation per card: wind-up tell (victims can react), hit-stop, victim-tile
shake, comic impact word, SFX, announcer hook, kill-feed line.

### 9.5 ROADMAP: the big list

Seed list, each needing a card, scenarios and a playtest verdict before shipping: harpoon/tow cable,
bouncing bomb, magnet, giant boxing glove, ramp dropper, wrecking ball, spike strip, tornado,
glue/tar, bumper-car shockwave, boomerang, portal pair, "roo" (a kangaroo crossing hazard you
summon), cricket-ball cannon, sprinkler slick, snag-sizzle smoke screen, meat-pie mine, lifesaver
buoy trap, thong-flip jump, emu stampede.

---

## 10. Modes

### 10.1 0.2 mode set (all approved, R10)

| Mode | Camera default | Notes |
|---|---|---|
| **Race** (procedural tracks, weapons on/off) | Grid | Laps/checkpoints, drop-in, destruction on. |
| **Derby** (timed, points for damage) | Overview | Score points for damage dealt (bonus for part detaches, wrecks, combos); wrecked cars respawn in ~2 s and keep playing; no knock-outs (R21); killcam on wrecks. |
| **Stunt Arena** | Overview | Score airtime, flips, wheelies, near misses, destruction combos. |
| **King of the Bowl** | Overview | Hold the moving centre zone; points while inside and uncontested. |
| **Team Race / Team Derby** | Either | 2–4 teams; team colours group tiles; team score. |
| **Wrecked-player mayhem** (was "Ghost role") | Overview | While a wrecked derby car waits to respawn (R44), its player aims a drone marker and **sends in debris or an environmental hit** (drop a tyre stack, roll a barrel, tip over a **wheelie bin**, call a small dust devil). One telegraphed action per wait; it can deal a little damage, which earns the sender a few points; bounded so it can't decide the winner. |
| **Bot fillers** | — | Host can fill to N cars with bots (easy/medium/hard) so 2 humans still get a lively race. Bots leave as humans drop in. |

Each still needs a greybox + playtest round verdict on *tuning*, not on whether it exists.

### 10.2 Session flow

```text
Lobby ─► Garage (per player: name, car, paint, ready) ─► Countdown ─► Round (drop-in OK)
  ▲                                                                          │
  └──── Between rounds: results + highlight reel/killcam ─► standings ─► next round / next event
```

No random mode rotation (R6). Instead the host picks an event format (§10.7), and in **Party Mix** the
players vote on what comes next (§10.8). Between rounds the flow runs itself (§10.8).

### 10.3 Derby killcam

Presentation-side ring buffer of transforms and contact events (~6 s, all cars, debris and
projectiles; no re-simulation). On a wreck: short skippable replay (PIP in Overview, or a between-life
interstitial), slow-mo into the impact, comic impact frame, announcer line. Skip by host or by a
majority vote of connected players. Buffer ≤ 10 MB at 24 cars.

### 10.4 Race highlight reel

At the finish, while results tally: a 20–40 s auto-edited reel of the race's **major events** — biggest
crashes (impulse), wrecks, weapon hits with multi-car outcomes, longest airtime, photo finish, lead
changes. Built from the same ring buffer plus an **event log** scored by "excitement"
(impulse, involved cars, position change, rarity). Cinematic cameras (orbit, low-angle, slow-mo),
comic captions ("#7 DOORS #3!"), announcer commentary. Skippable. Longer-horizon storage: keep a
decimated transform log (e.g. 20 Hz) for the whole race so early events are eligible, within a memory
budget measured in G-PERF.

### 10.5 ROADMAP modes

Capture the Esky (CTF), Tag / "It" (you're on fire), Demolition Soccer, Survival (shrinking arena /
bushfire ring), Delivery run, Gauntlet (one runner vs everyone), Rally stages with ghost times,
Elimination race (last place removed each lap), Heist.

---

### 10.6 Lobby, garage and ready-up UX (R31, R33)

**Host screen (lobby):** big QR + room code always visible; the player strip (one card per human:
number, name, colour/pattern, car thumbnail, controller icon, **READY / choosing…** state); mode, event
format, theme and camera settings in a side panel the host drives; a **Start** control.

**Controller (garage), three steps, each one screen, thumb-sized:**

1. **Name** — prefilled with a fun generated Aussie name ("Captain Snag", "Dusty Ute", "Big Kev" style,
   from a curated word list, profanity-filtered), editable. Remembered per device; **🎲 reroll**
   button. Names are unique in the room (suffix added if not).
2. **Car** — swipe carousel of vehicles; each shows the model turntable image, class, the 0–10 stat
   bars, one-line character blurb and a "Nerd stats" expander (damping, wheelbase, turning circle…).
   The host screen mirrors the choice live on the player's card. Paint scheme picker.
3. **Ready** — one big **READY** button. Tapping again un-readies. Any change (car/name) keeps ready
   state unless the player un-readies.

Pads and keyboard players do the same on the **host screen** in their own small panel (d-pad/stick to
browse, A to confirm), placed next to their player card.

**Starting rules:**

- The round starts automatically when **all connected humans are ready** (3-2-1 countdown, cancelled if
  someone un-readies).
- **Host force-start:** host presses **Start now**. If anyone isn't ready:
  1. A **10 s "Starting soon" warning** begins (host-configurable 5–15 s). Not-ready players' controllers
     flash an orange full-screen banner "Host is starting in 10 — tap READY or you'll get a random car",
     with a **vibration pattern** (Android `navigator.vibrate`; gamepad rumble via `vibrationActuator`
     where the browser supports it; iOS has no web vibration, so it's visual + a sound). Their card on the
     host screen pulses.
  2. At zero: not-ready players get **their current selection** (or a random car if none) and drop
     straight into the round. Nobody is ever left behind.
  3. Host can press **Start now** again to skip the countdown.
- **Mid-round drop-ins** (§6.5) skip the garage: they get the default name + a random car (or last used),
  and can change car at their next respawn from the controller's garage button.
- **Between rounds:** players can change car/name while the results play; the next round uses the same
  ready flow (with a shorter default warning, 5 s).

UX acceptance: from QR scan, a newcomer can name, pick a car and ready up in ≤ 30 s; a host with 12
players waiting on one can force-start and that player gets the warning on their phone within 150 ms.

### 10.7 Solo, teams, events and scoring (R32)

**Solo or teams** is a lobby toggle for every mode:

- **Solo:** everyone for themselves.
- **Teams:** 2–4 teams; players pick a team in the garage (or host auto-balances by count / by standings).
  Team colour shows as a **tile-border stripe and car roof band**, but personal identity (number + colour
  + pattern) stays; teammates' nameplates get a team icon. No friendly-fire damage points (damage to
  teammates still happens physically, scores nothing). Team score = sum of members' round points
  (race: points by finishing position; derby: damage points).

**Event formats** (host picks):

| Format | How it works |
|---|---|
| **Quick Match** | One round, results, rematch. |
| **Series** | N rounds (3/5/7) of one mode or a host-built playlist (e.g. Race → Derby → Race). Championship points per round; standings between rounds. |
| **Cup** (tournament) | Series with a finale: the last round is worth double and uses the top players' map vote. |
| **Knockout Cup** (large groups) | Heats of ≤ 12 cars in rotation; top finishers advance to semis/final; eliminated players keep playing a parallel "Bogan Bowl" derby on the same screen as fillers. CANDIDATE, needs a greybox (it must obey the "nobody sits out" pillar). |

**Scoring:**

- **Race points** by position (e.g. 25-18-15-12-10-8-6-4-2-1, then 1 for finishing) + small bonuses
  (fastest lap, most damage dealt, biggest air). Drop-ins classify from where they finish (R5).
- **Derby points** = damage points (damage dealt, part detaches, wrecks caused, combos), converted to
  championship points by rank at the end of the timed round.
- Team: sum of members; ties broken by best individual result.
- Standings screen between rounds: animated bars, movement arrows, "on the podium" callouts, announcer
  line. Session leaderboard persists until the room ends; stored locally on the host (and in `jj-store`
  as anonymous session stats).
- **Awards** at the end of a Series/Cup: Most Wrecks, Biggest Air, Most Doors Lost, Ute of the Day, etc.
  Comic trophy cards; shareable screenshot.



### 10.8 Party flow: auto progression, voting, Party Mix (R38, R39, R50)

**The loop runs itself.** Nobody needs to touch the laptop for a party to keep going.

```text
Round ends ─► Highlight reel (plays by default, ~60 s timer, skippable by vote/host)
   │            • side panel: round results, soft-competition awards (§10.10)
   │            • BIG QR + short URL: "Jump in! jammers.dilger.dev/j/ROO7"
   │            • controllers: vote for next map/mode, change car/name, ready up
   │            • host device: generating next map (§11.2a)
   ▼
Next round auto-starts when the timer ends (or earlier if everyone has readied)
```

- **Timer defaults:** highlight/intermission 60 s; skip early when all connected players are ready or
  the host skips; ready-up is *optional* in Party Mix (nobody is warned or forced, they simply play with
  their current car); force-start warnings (§10.6) apply only to tournament formats.
- **Voting:** each controller gets 2–3 options for the next round (mode + theme/map seed, shown as
  cards with a thumbnail). Most votes wins; ties are random; the host can veto or pick directly.
  In tournament formats voting is limited to the map, since the mode is fixed.
- **Presets (tailor to the group):**

| Preset | What it is | For |
|---|---|---|
| **Party Mix** (default) | Voted mix of race, derby, stunt and king-of-the-bowl rounds, running party scoreboard, soft awards, chaos events on | Mixed groups, house parties |
| **Derby Tournament** | Series/Cup of derby rounds, standings, voting on arena only | Groups who want to smash things properly |
| **Race Tournament** | Series/Cup of races, standings, voting on track only, chaos events optional | Groups who want to race properly |
| **Custom** | Everything from §10.7 and host settings | Organisers |

- **End game and Disband (R36):** the host can **End game** (show the final standings, awards and the
  night's reel, then return to the lobby with everyone still connected) or **Disband room** (everyone's
  controller shows a friendly "Thanks for playing" with the final standings, and room credentials are
  cleared). A room left empty for a while ends itself.
- **Host settings with defaults** (all in one place, remembered on the host device): intermission
  length, race finish timeout, finish bonus, derby length, chaos events on/off/frequency, L-plates
  allowed, family-friendly mode, voting on/off, team mode, autopilot on/off.

### 10.9 Late-join fairness (R37, R46)

**Race:**
- Late joiners start at the back of the pack (§6.5) and classify where they finish.
- **Finish timeout:** after the first car finishes, everyone else has **30 s** (host setting). When it
  expires, unfinished cars are ranked by their current race progress (lap + distance along the
  racing line).
- **Finish bonus:** cars that actually cross the line inside the timeout get a **+2 championship points**
  bonus (host setting), so finishing matters even from the back.

**Derby (timed, 3 minutes, points for damage) (R56):** rank by **raw damage points**. Players who were
there from the start are more likely to win, and that's intended: a late joiner is penalised and the
field isn't precisely level. Late joiners still play, score, feature in the reel and can win awards
(e.g. "Latest to Rock Up"). Autopilot points are halved so walking away doesn't farm points.

### 10.10 Soft competition, L-plates, "Surprise me" (R40–R42)

**Soft competition (R42):**
- Every round gives out **5–8 comic awards** spread across as many different players as possible:
  Most Doors Lost, Best Crash, Biggest Air, Most Scenic Route, Longest Wheelie, Friendly Fire Champion,
  Slowest Finisher Ever, Autopilot Enjoyer, Most Debris Dropped, Roo Magnet, **Latest to Rock Up** (latest drop-in), plus the Australianisms from the research pass below. An award picker prefers
  players who haven't received one recently.
- **Everyone appears in the highlight reel at least once** per round when they had any notable event;
  the reel director (§10.4) reserves slots for players not yet featured.
- The winner still gets the podium and the announcer's big line: the competitive edge stays.

**L-plates (R40):**
- A per-player toggle in the garage: **auto-throttle, steering assist (existing `steeringAssist`),
  auto-recover from flips/stuck, softer knockback taken**.
- **Balanced to be fun, not winning:** L-plate cars get a **lower top speed (~85 %)** and **no boost
  stacking**, so assists make driving easy but a skilled player is always faster. Acceptance: in bot
  races, a skilled bot beats the L-plates bot on every reference track; an unskilled bot with L-plates
  finishes races it would otherwise fail.
- **Real L-plates, visible to everyone:** a yellow square with a black "L" mounted front and rear on
  the car (part of the vehicle contract: an `lplate_front`/`lplate_rear` mount on every model), plus a
  small L badge on the tile and nameplate. It's the Australian learner plate, so it's also a joke
  everyone in the room gets.

**"Surprise me" (R41):** one button in the garage for name and car; the result is shown with a
**"🎲 Picked for you"** tag and can be changed with one tap. A mid-round drop-in gets this automatically,
labelled the same way.

**Australianisms research pass (R53):** before copy is written, a short research task collects
Australian slang and cultural references suitable for award titles, announcer lines, car blurbs, chaos
warnings, UI copy and generated names, e.g. "Latest to Rock Up", "Flat Out Like a Lizard Drinking",
"Carked It" (most wrecks), "Dropped a Clanger", "Fair Dinkum Finish", "Couldn't Organise a Piss-up…"
(family-friendly variant needed), "She'll Be Right" (most repaired damage), "Maccas Run" (fastest lap),
"Bogan of the Day", "Chucked a U-ey" (most reversing), "Servo Pie" (most damage taken).
Output: `docs/copy/australianisms.md`, a table with the term, meaning, where it fits, a family-friendly
flag, and a regional/cultural sensitivity note (avoid slurs and anything punching down; no Indigenous
cultural terms used as jokes). The owner reviews the list; the approved subset feeds the award table,
announcer script (R55) and name generator.

### 10.11 Chaos events (R43)

Short, telegraphed, whole-room moments that reshuffle the pack and make everyone yell together. Each
is a data-driven event card (like weapons) with a warning phase (announcer line + on-screen banner +
visible signs in the world), an active phase and a clean-up. Mostly in **race** modes; a few derby-safe
ones.

| Event | Where | What happens |
|---|---|---|
| **Flash flood** | Race (Red Centre first) | Creek crossings flood (§11.5); current pushes cars, splash-downs on ramps |
| **Cyclone** | Race (coastal themes) | Strong crosswind gusts that push cars and lift light debris; rain makes surfaces slick; spinning debris |
| **Roo stampede** | Race + derby | A mob of kangaroos bounds across the track (soft collisions, big comic reactions) |
| **Dust storm** | Race | Visibility drops to near-field; headlights and emissive underglow matter; announcer loses it |
| **Road train** | Race | A giant road train thunders across a crossing; timing the gap is the game |
| **Hailstorm** | Race + derby | Dents everything a little, ice on the track briefly |
| **Bushfire front** | Race (grassland/forest) | Smoke and a creeping fire line that cuts a shortcut or opens a new one (never traps cars) |
| **Magpie swooping season** | Race + derby | A magpie harasses the leader (small steering nudges, loud) |
| **Drop bear** | Race | Joke event: something falls on the leader's roof |

Frequency: 0–2 per round (host setting: off / some / lots). Rules: always telegraphed ≥ 3 s ahead;
never places a car out of bounds; every card has scenarios (§15) like weapons; they are chaotic but
never decide a race on their own; the leader is slightly more likely to be the target (a mechanical,
visible comeback, consistent with D19).

## 11. Procedural Australian tracks

### 11.1 Themes

**First theme (R25): Red Centre, the outback around Uluru and Kata Tjuta.** Every generator feature is built and tuned here first (§11.5). **Build order:** Red Centre → Beach → Outback grassland → Forest → City → Desert dunes. Theme notes: Beach (Gold Coast / Bondi feel), Forest (eucalypt, tall timber), City (Sydney/Melbourne laneways,
harbour), Outback grassland (red dirt, spinifex, windmills), Desert (dunes, salt flats, Uluru-style
monoliths in the distance), plus candidates: Great Ocean Road cliffs, Snowy Mountains (dry alpine),
Tropical north / rainforest, Mining town, Wine country. A theme is a **presentation + surface + feature
palette**, not new code.

### 11.2 Generator architecture

**Procedural first, authoring possible (R24).** Every map, race or derby, is a **map document**
(`jj.map.v1`, schema in `jj-contracts`): course graph/arena shape, terrain parameters or heightfield,
surface map, feature list, dressing rules, spawns, checkpoints, water events. The generator is a
function `seed + theme + constraints → map document`. The game only ever loads map documents. So a
hand-crafted map later is just a map document written by hand or with an editor, or a generated one
that was pinned and edited. Both go through the same validator and scenarios. No separate code path.

Separate **structure** from **presentation** (art-pipeline doc §4), all deterministic by seed:

1. **Course graph:** closed loop (race) or bounded arena (derby) from a seed + constraints: length,
   corner mix (hairpins, sweepers, chicanes), elevation budget, width variation, overtaking zones,
   shortcut branches (risk/reward), crossovers/bridges (CANDIDATE).
2. **Terrain:** heightfield per theme — dunes (sand), rolling grass, rocky outcrops, beach slope into
   shallows; the track is carved into it with banking where the corner wants it.
3. **Surface map:** on-track (tarmac, dirt, gravel, sand-packed) and off-track (soft sand, mud, grass,
   shallow water, scrub) painted by rules (theme + curvature + elevation), each with a physics
   material (§11.3).
4. **Features:** jumps (with landing zones verified by simulation), dunes, whoops, ramps, water
   splashes, narrow bridges, tunnels, destructible prop clusters (§8.4), hazards.
5. **Dressing:** curated, validated kit pieces per theme (fences, signs, trees, buildings, landmarks)
   placed by rules, never arbitrary.
6. **Validation:** the existing map validator extended: drivable width, wall thickness, jump landings
   (bot-simulated), no unreachable checkpoints, spawn clearance for N = 24, camera clearance for chase
   and first-person cams, lap-time target band (bot laps), overtaking opportunities count.
7. **Fun scoring (for curation, not generation truth):** bot-race metrics — lead changes, pack
   spread, number of jumps/surface transitions, crash rate per corner. Seeds that score badly are
   rejected; seeds that play well in rounds are **pinned** as a curated seed list per theme.

### 11.2a Runtime generation in the browser (R26)

- The generator is a **Rust crate `jj-procgen` compiled to WASM**, run in a **Web Worker** on the host.
  The same crate runs natively in CI and in the `sim`/sweep tools, so a seed makes the same map in the
  browser, in tests and in tuning runs (same build). One implementation, no JS/Rust drift.
- Output is a `jj.map.v1` document (plus meshes/heightfield buffers passed as transferables). The host
  builds render meshes and Rapier colliders from it. Generation runs **during the lobby, results or
  countdown** for the *next* round, so it never delays play; the lobby shows a live preview of the
  upcoming map with a **Reroll** button for the host.
- **Budgets (targets, measured in G-PERF):** generate + validate ≤ 1.5 s on this laptop, ≤ 4 s on a
  phone host; peak worker memory bounded. If a phone host is too slow, the generator uses a lighter
  detail level for the same seed rather than a different layout.
- **Runtime checks vs offline checks:** the fast structural validator (width, walls, landings by
  ballistic check, spawn clearance, reachability) runs in the browser on every map; a failing seed is
  silently rerolled. Full **bot fun-scoring** is too slow for runtime; it runs **offline** in CI/sweeps
  to tune the generator's parameters and constraints, so runtime maps land in the fun zone by
  construction.
- **Seeds are shareable:** a round's seed + theme + generator version is shown on the results screen;
  "play this map again" reuses it. Players can **rate a map** (👍/👎 on their controller after a round);
  ratings go to the server (§13.6, FrankenSQLite) and feed generator tuning. A hand-crafted or pinned map
  (R24) is just a stored map document the host loads instead of generating.
- Generator versions are pinned per build; a seed is only guaranteed to reproduce within the same
  generator version.

### 11.3 Surfaces

| Surface | Grip | Rolling resistance | Notes |
|---|---|---|---|
| Tarmac | high | low | baseline |
| Packed dirt | medium | low-medium | drift-friendly, dust |
| Gravel | medium-low | medium | spray, rattle |
| Soft sand / dunes | low | high | slows, big rooster tails, jumps |
| Wet sand (beach) | medium | medium | fast shoreline line |
| Mud | low | high | splatter decals on cars |
| Grass | medium-low | medium | |
| Shallow water | low | high | splash, brief slow |

Each has grip, rolling resistance, particle, tyre sound and decal rules; values are data with
fixtures (scenario `surface-deltas`).

### 11.4 Derby arena generation (R24)

Derby maps are generated as proper derby arenas, not race tracks with a camera change:

- **Shapes:** bowl, stadium oval, figure-eight crossover, quarry pit, multi-level (ramps up to a
  plateau), island (water moat), each sized to the expected car count (§6.4).
- **Features:** centre mound or pillar clusters to ram around, ramps and kickers for aerial hits,
  destructible props at the edges, soft walls (tyre stacks, hay bales) vs hard walls (rock), debris
  catch zones that don't trap.
- **Rules:** no dead corners (bots must reach every region), sightlines for the Overview camera, spawn
  ring with clearance for 24, validated lips (no escapes).
- **Fun scoring:** bot derbies measure hits per minute, how spread out the hits are (not one choke
  point), wreck rate and time spent stuck.

### 11.5 First theme: Red Centre (Uluru and Kata Tjuta)

- **Look:** red sand and ochre dirt, spinifex, desert oaks, salt pans, huge sky; Uluru-like and
  Kata Tjuta-like domes on the horizon and as landforms the track sweeps around.
- **Track features:** tracks weave between clusters of red domes (Olgas-like) through canyons and
  gorges; **crazy jumps** over dry creek beds, dune kickers, rock ledges and road-train crossings.
- **Water that flows sometimes:** seasonal creeks and **flash floods**. Creek crossings are dry on
  most seeds. On some seeds, or partway through a race, water flows through them: shallow water
  surface (slow, splash), a moving current that pushes cars sideways, and some ramps turn into
  splash-downs. Telegraphed (rumble + announcer + a water front you can see) so it's a fun hazard, not
  a gotcha. Built as a map-document "water event" so any theme can reuse it.
- **Derby:** quarry pit and dry claypan bowl arenas ringed by red rock.
- **Cultural respect:** Uluru and Kata Tjuta are sacred to the Anangu traditional owners (climbing
  Uluru has been banned since 2019). The game uses **fictionalised, inspired-by** red-rock landforms,
  doesn't use real names on in-game sites, and never has cars jumping off or driving over the real
  monoliths. The real silhouettes, if used at all, are distant scenery. Check with the owner before any
  marketing uses the real names.

### 11.6 G-PROC

Two tuning rounds on procedural tracks. If they still aren't fun, stop and ask the owner; the fallback
is hand-authored maps using the same kit pieces and validator (R11).

---

## 12. Visual style and the art pipeline

### 12.1 Direction: bold comic

- **Look:** cel/toon shading with 2–3 tone ramps, **thick ink outlines** (screen-space edge detection on
  depth + normals + object ID, run once in post), halftone dots in shadows, bold flat colours with a
  saturated curated palette, comic speed lines at high speed, impact words ("KRUNCH!", "BOOF!") as
  sprites on big events, squash on landings (visual only).
- **Cars:** chunky exaggerated proportions (big wheels, stubby bodies, oversized archetype flair) so
  they read at 40 px; paint from masks (player colour + pattern); decals and huge roof numbers.
- **Worlds:** Australian themes rendered as comic panels — strong silhouettes, graphic skies,
  stylised foliage cards, limited-palette ground textures per surface.
- **UI:** hand-inked feel — panels, buttons and borders with **slightly irregular, not-quite-straight
  edges** (procedurally jittered SVG paths or 9-slice textures with a subtle wobble, consistent per
  element, never animated jitter), bold display type, sticker-style badges, comic speech-bubble
  callouts. Tasteful: wobble is a few pixels at TV scale, text stays crisp and straight.
- **Readability rule:** comic effects never cover identity (number/colour) or the road ahead.

### 12.1a Shaders: comic + a bit of Mad Max, with emissive everywhere (R34)

The comic base (toon ramps, ink outlines, halftone) gets a **post-apocalyptic, sun-bleached, hot-metal**
layer, with **emissive highlights** so everything pops at night and in the grid:

| Shader / effect | What it does | Notes |
|---|---|---|
| **Car paint** | Toon-ramped paint from masks + identity colour, **rust and scorch creep** driven by damage (mask B), edge-worn bare metal on corners (curvature bake), dust layer by surface driven over | Ramp stays bold so identity reads |
| **Hot metal / exhaust** | Exhaust tips and turbo pipes **glow orange→white** with RPM and boost; heat-shimmer (screen-space distortion) behind cars at high revs | Distortion only in larger tiles / Overview |
| **Emissive kit** | Headlights, taillights, **light bars and roo-bar spotlights**, underglow in team/identity colour, glowing roof number option at night, weapon charge glows | Selective bloom (existing emissive-only bloom) run once in post |
| **Boost flames** | Stylised comic flame sprites + emissive cone; blue at full boost | |
| **Sparks and embers** | GPU particles on scrapes, part detaches, wreck bursts; embers linger on the track | Per-tile particle budgets |
| **Damage glow** | Heavily damaged cars show glowing cracks and smoke; wrecks leave burning husks with flickering emissive for a few seconds, then smoulder | Debris stays (§8), glow fades |
| **Sky and light** | Harsh sun, long shadows, heat haze on the horizon, **dust storms** as a theme weather event; dusk/night variants with orange sky and emissive-lit tracks | Fog gradient per theme |
| **Ground** | Sun-cracked clay, red dirt with tyre-track decals that accumulate, sand with wind ripples; wet surfaces get specular sheen | Tyre tracks persist like debris |
| **Environment emissive** | Servo signs, neon pub signs, flares at checkpoints, glowing flash-flood warning markers | |
| **Post (once, D17)** | Warm grade (orange/teal), vignette, subtle film grain, comic halftone in shadows, chromatic fringe on big hits only | Grade profile per theme and per time of day |

Guard rails: emissive is **informative first** (identity underglow, weapon charge, hazards) and
decorative second; effect intensity scales down with tile size; every effect has a quality-ladder cost
measured in G-PERF; night/dusk variants must pass the readability captures.

G-LOOK approves this on a hero car, one theme and the UI kit before mass production. The ratified
language replaces `docs/design/02-design-language.md` as source of truth.

### 12.2 Tools

| Tool | Role |
|---|---|
| Claude/Codex orchestrator | Owns the goal; runs inspect → modify/generate → export → run game → capture → critique. |
| Blender MCP | Interactive modelling, silhouettes, UV inspection, part splitting, bakes, previews. |
| `tools/blender/*.py` (headless) | Every repeatable step: normalise, tag semantics, split parts, fracture props, UV/bake, LOD, export, validate. |
| ChatGPT/Codex image generation | Concepts, decals, fictional sponsors, signs, surface textures, foliage cards, comic impact words, UI textures; given UV layouts/masks when registration matters. |
| blender-image-to-3d | Concept → rough mesh for props/blockouts; always cleaned up by script before it can pass the contract. |
| Three.js shaders | Toon ramps, outlines (post), halftone, paint masks, damage/dirt blends, emissive states, surface-specific effects. |

### 12.3 Contracts between art and game (R17)

The principle (informed conceptually by how studio art-loop tooling works — e.g. the tooling discussed
for Insomniac's Spider-Man — not by copying scripts): **the game declares what it needs as a
machine-readable contract; the art pipeline produces assets that prove they meet it; CI checks the
proof.** Artists/agents can change anything that keeps the contract.

Concretely:

- `art/contracts/*.schema.json` — one per asset class (vehicle, destructible prop, kit piece,
  surface texture set, UI element, comic effect sprite).
- Each exported asset ships a **sidecar** (`*.asset.json`) declaring contract version, node names,
  parts, budgets, textures and bake provenance.
- `tools/validate-assets` (Rust CLI in the workspace, §13.2, plus a Blender-side pre-export check)
  validates GLB + sidecar against the schema and budgets; runs in CI and as a pre-export hook.
- The game loads assets **only through the contract**: it reads the sidecar, not guesses from mesh
  names. A contract version bump is a deliberate, reviewed change on both sides.
- Asset **preview captures** (§15) are part of the contract evidence for vehicles and destructibles.

### 12.4 Vehicle contract (summary; full spec in `art/contracts/vehicle.schema.json`)

- Units metres, one documented forward axis, origin at ground between axles.
- Parts as named nodes per §8.1, each with its own mesh, collider proxy `col_<part>`, attachment
  point, hinge axis for hinged parts, mass fraction, damage-stage variants (`<part>_dent`).
- `wheel_*` pivots at hubs; `cam_fp` (first-person camera), `cam_tp_target`, `com`, `exhaust_*`,
  `light_head_*`, `light_brake_*`.
- Materials by semantic name: paint, tyre, wheel, glass, plastic, metal, headlight, brakelight,
  interior, decal, underside. UV0 main, UV1 bakes. One mask texture (R paint, G pattern, B dirt/damage,
  A emissive) + palette/ramp; comic style keeps texture budgets small.
- LOD0/1/2; triangle and texture budgets from G-PERF (start: 5k/2k/500 tris per intact car).
- Physics sidecar: archetype, mass, suspension hardpoints; references the vehicle profile.
- Round-trip: reloads in Blender and Three.js with identical nodes and bounds.

### 12.5 Per-car pipeline

1. Concepts (imagegen; 3 silhouettes per archetype) → owner picks.
2. Blockout (image-to-3D or hand) → normalise script → silhouette check at 40 px.
3. Clean topology, part split, UV, semantics (Blender MCP).
4. Bakes; decals registered on UV layout.
5. Export GLB + LODs + colliders + sidecar → validator.
6. Physics fit → scenario bank green → balance-chart placement.
7. In-game captures → before/after critique; iterate while a visible improvement remains.
8. `vehicle-model-validation` gate → merge.

Starting roster: see §7.6 (fourteen vehicles in five classes, all new models).

---

## 13. Architecture

### 13.1 Shape of the system

```text
┌────────── Rust server (day 0) ──────────┐
│ static bundles · relay · rooms/codes ·  │◄──WSS──► controllers (phones, hubs)
│ QR routes · telemetry/bug intake ·      │
│ health/readiness                        │◄──WSS──► host (browser: Three.js + Rapier WASM)
└─────────────────────────────────────────┘                  │ (host-local pads/keys in-process)
```

The host stays authoritative; the server forwards and manages rooms. Remote viewers get compact host
snapshots through the same relay.

### 13.2 Rust workspace (Jeffrey Emanuel-style structure)

Conventions taken from his projects (frankensqlite, asupersync, beads_rust, mcp_agent_mail_rust) —
the conventions only, no shared code:

- Many small crates with a **common prefix** and one job each, layered bottom-up: types → errors →
  pure logic (sans-I/O) → adapters → binaries. Lower layers never depend on higher ones.
- Workspace-level `[workspace.package]`, `[workspace.dependencies]` and `[workspace.lints]`:
  `#![forbid(unsafe_code)]`, clippy pedantic (+ nursery where it pays) as errors.
- **Async runtime: asupersync, no Tokio** (and nothing that pulls in tokio/hyper/axum/reqwest);
  enforced by `cargo deny` bans + a graph check script.
- Pinned `rust-toolchain.toml`; `deny.toml` for licences/advisories/bans.
- Inline unit tests per crate; cross-crate integration tests in `tests/`; a dedicated **harness** crate
  and **e2e** crate; `benches/` with criterion; fuzz targets for decoders.
- Machine-readable contract files at the root (TOML/JSON) for protocol versions and supported
  surfaces, checked by tests.
- Robot-friendly CLIs (`--json` output) for every tool agents use.

Proposed workspace (`jj-*`):

| Crate | Layer | Responsibility |
|---|---|---|
| `jj-types` | types | Newtype IDs (`HumanId`, `SeatId`, `CarId`, `EndpointId`, `ChannelId`, `RoomCode`), `ControlFrame`, enums. `no_std`-friendly, WASM-safe. |
| `jj-error` | types | Shared error types. |
| `jj-protocol` | pure | Versioned wire messages, bounded codec, golden fixtures, compat rules; generates TS bindings for host/controller. |
| `jj-room` | pure (sans-I/O) | Room/seat/endpoint state machine: join, claim, resume, leave, drop-in, identify routing, host lease. Deterministic reducer. |
| `jj-relay` | pure | Routing core: forward frames host⇄endpoints, queues, backpressure, fan-out of snapshots to remote viewers. No sockets. |
| `jj-contracts` | pure | Art/asset contract schemas + validators (vehicle, prop, kit, surface, UI). |
| `jj-scenario` | pure | Scenario file format + result/trace schema shared by the sim harness and CI reports. |
| `jj-net` | adapter | asupersync WebSocket + HTTP adapters binding `jj-relay`/`jj-room` to sockets. |
| `jj-static` | adapter | Static bundle serving with immutable build paths, cache headers, build-skew info. |
| `jj-telemetry` | adapter | Telemetry and bug-report intake (replaces the Python drainer). |
| `jj-server` | binary | Composes the above; config via env only; `/healthz`, `/readyz`. One OCI image. |
| `jj-tools` | binary | `jj` CLI: `validate-assets`, `publish`, `deploy status`, `sweep-report`, `protocol check` — all `--json`. |
| `jj-harness` | test | Fake host + N fake controllers (load bots) against a real server. |
| `jj-e2e` | test | Cross-crate e2e scenarios. |
| `jj-procgen` | pure (WASM + native) | Runtime procedural map generator and fast validator (§11.2a); emits `jj.map.v1`. Deterministic by seed + generator version. |
| `jj-store` | adapter | FrankenSQLite-backed persistence on the server: telemetry, bug reports, map ratings, session stats, feedback (§13.6). |
| `jj-sim` | CANDIDATE (G-SIM) | Vehicle/weapon sim core in Rust (rapier3d), compiled to WASM for the host and native for sweeps. |

### 13.3 Protocol v1 (new, day 0)

- Messages: `Hello{protocol, build, caps}`, `JoinRoom`, `ClaimSource{preset}`, `Frame{channel,
  ControlFrame}` (newest wins; stale dropped), `Identify`, `CameraPref{fp|tp}`, `HudUpdate`
  (host→controller ≤ 10 Hz: position, weapon, boost, damage, points, events), `Haptic`, `Snapshot`
  (host→remote viewers 20–30 Hz, quantised), room lifecycle, `BugReport`.
- Explicit integer wire tags; bounded decode; golden fixtures in `jj-protocol`; the JS side imports
  generated bindings, never hand-written duplicates.
- Room codes + QR routes stay compatible with the current `join-route-matrix.md` intent.
- Build pinning: a room records the host build; controllers load the matching controller bundle from
  an immutable path so previews and stable never mix.

### 13.4 Host & controller JS layout

```text
static/js/
  engine/    GameLoop (fixed 120 Hz + interpolation), EventBus, StateMachine, Clock, Rng, replayJournal
  input/     ControlFrame (generated), sources/{touch,gamepad,keyboard}, shaping, presets/
  net/       RelayClient (generated protocol), HostBridge
  sim/       PhysicsRuntime, Vehicle, Damage/Destruction, Debris, Weapons(cards), Surfaces, modes/*
  track/     procedural generator, themes/, validator, fun-scorer
  render/    Displays, GridLayout, ChaseCam, FirstPersonCam, OverviewCam, Composer(post once),
             ComicOutline/Toon/Halftone, LOD, materials/
  replay/    ring buffer, event log, killcam, highlight reel director
  ui/        host HUD, lobby + input drawer, results, identify overlay, controller UI
  scenarios/ shared definitions (sim + capture + replay)
  host.js / controller.js / hub.js   thin orchestrators (controller & hub never import THREE)
```

Rules: `sim/` imports no THREE and no DOM (headless-runnable); `render/` reads sim state and never
writes it. New modules in TypeScript.

### 13.5 G-SIM

Measure a 500-run sweep (24 cars × 20 s × 120 Hz) in Node with the same Rapier WASM across worker
threads. Under ~5 min on this laptop ⇒ stay in JS. Otherwise build `jj-sim` and run sweeps natively
(same-build determinism only; no cross-target bit-identity assumed).

### 13.6 Jeffrey Emanuel projects: what we use (R27)

Surveyed his GitHub (`gh repo list Dicklesworthstone`) on 2026-09-29. Status and dates are from each
repo's README at that time; re-check versions when adopting.

| Project | Use in Jammers | Status for us | Why / caveats |
|---|---|---|---|
| **asupersync** | Async runtime for the whole Rust server | **ADOPT** | Structural cancel-correctness; mandatory no-Tokio convention (§13.2). |
| **FrankenSQLite** (`fsqlite`) | `jj-store`: server-side storage for telemetry events, bug reports, map ratings, session history, playtest feedback | **ADOPT** | Pure Rust, concurrent writers, fits the asupersync/no-Tokio graph (it's the stack's own database). Keeps rooms themselves in memory — the host is authoritative and room state doesn't need a DB. Admission: exact query subset used, crash/restore test, backup of the DB volume. |
| **fsqlite-wasm** | Host-side local store in the browser: favourite seeds, local stats, remembered presets | **CANDIDATE** | Nice symmetry (same SQL both sides), but IndexedDB is enough for small key/value data. Only adopt if host-side data grows (e.g. local leaderboards, replay library). Measure bundle size first. |
| **fastapi_rust** | HTTP routing layer in `jj-net`/`jj-server` (static, health, bug/telemetry endpoints) | **ADOPT, with a fallback** | Built on asupersync; "early development" — if a needed feature (e.g. WebSocket upgrade) is missing, use asupersync's own HTTP/WS primitives directly behind the same `jj-net` interface. |
| **FrankenTTS** (`franken_tts`) | Announcer voice (R19) | **ADOPT (offline tool)** | Qwen3-TTS zero-shot voice cloning, CPU, one binary, deterministic, `ftts robot` JSON mode. Speaker (`.spk`) picked by sampling/auditioning the latent/speaker space. Output WAV/OGG files ship; the model never ships. |
| **wasm_cmaes / fast_cmaes** | CMA-ES optimiser for **physics tuning sweeps** (search suspension/drift/weapon params against metric targets) and **generator parameter tuning** against bot fun-scores | **ADOPT (tooling)** | Derivative-free optimisation is exactly the "find params that hit the feel envelope" problem. `fast_cmaes` in native sweep tools; `wasm_cmaes` if we run tuning in the browser tuning panel. Owner still judges feel — the optimiser proposes candidates. |
| **remote_compilation_helper** (RCH) | Offload **all** heavy builds from the laptop: cargo builds/tests/clippy, WASM builds (`jj-procgen`, `jj-protocol` bindings), headless sim sweeps and CMA-ES runs, Blender batch jobs where possible | **ADOPT, use liberally** | Owner ruling R35. Keeps the laptop free for perf work and live playtests; agents never run heavy builds locally by default (see §13.7). |
| **automated_plan_reviser_pro** (`apr`) | Runs the ≥ 4 GPT Pro review rounds of *this* plan | **ADOPT (process)** | Automates the planning-workflow review loop (`apr run N`). |
| **ultimate_bug_scanner** (`ubs`), **dcg**, **slb**, beads_rust/beads_viewer, mcp_agent_mail, ntm, cass | Existing agent tooling | **KEEP** | Already part of the workflow. |
| **fastmcp_rust** | A `jj-mcp` debug server so agents can drive the game: load a scenario, set seeds, spawn bots, trigger captures, read metrics | **CANDIDATE** | Useful for the art/visual QA loop and bug repro. Build only once the scenario bank and capture tools exist, and only as a dev-only binary. |
| **franken_threed** | Three.js specializer with Rust/WASM + WebGPU core — would target exactly our "many tiles at 4K" cost | **WATCH, not for 0.2** | README says plan stage, no compiler/renderer yet. Revisit if G-PERF fails and it has matured; our Three.js code stays compatible with it by design. |
| **FrankenSim** | Certified geometry/physics kernel | **SKIP for 0.2** | Rapier is working for vehicles; FrankenSim targets simulation/design optimisation, not real-time games. Possibly useful later for offline geometry (e.g. fracture/mesh checks). |
| **frankengit** | Git forge | **SKIP** | Owner chose Gitea. |
| **toon_rust** | Token-efficient format for agent context | **OPTIONAL** | Could make scenario/metric dumps cheaper for agents to read; not needed. |
| frankensearch, frankenredis, frankentui, franken_whisper, franken_ocr, science ports | — | **SKIP** | No game need. |

### 13.7 Remote builds with RCH (R35)

- **Default:** every agent routes `cargo build/test/clippy/check`, `wasm-pack`/`wasm-bindgen` builds and
  workspace test runs through RCH to remote workers (devbox + TrueNAS runners). Local cargo is the
  exception (tiny single-crate checks, or RCH unavailable), not the norm.
- Set up in M0 (V2-01): RCH hooks installed for Claude/Codex agents in this repo, workers registered,
  a `jj doctor` check that fails if RCH isn't routing, and `AGENTS.md` updated with the rule.
- Cargo discipline to keep workers fast: shared `CARGO_TARGET_DIR` per worker, slim dev profiles
  (`debug = "line-tables-only"`, incremental for dev), `sccache`-style caching where RCH supports it,
  and a reclaim script for old targets.
- Long jobs (scenario sweeps, CMA-ES tuning, procgen fun-scoring, 24-bot soaks, headless Blender
  exports) run on remote workers too, writing results as artefacts the agent pulls back.
- Frontend `vite build --watch` stays local (it's fast and feeds the live browser); perf/G-PERF runs
  stay on this laptop + TCL TV by definition.

### 13.8 Day-0 migration

1. Stand up the workspace and `jj-server` serving the current `dist/` + a protocol v1 relay.
2. Port the host/controller transport from Socket.IO to the generated protocol client.
3. Port telemetry/bug-report intake and build-skew info.
4. Delete `server/` (Python), `requirements.txt`, pyenv/`.python-version` from the project once the
   full-game e2e passes on Rust. Update `CLAUDE.md`/`AGENTS.md` dev commands (`cargo run -p jj-server`
   + `vite build --watch`).

---

## 14. Audio

| Asset | Approach |
|---|---|
| **Announcer** | Offline TTS; pick an Australian-sounding voice **directly from the model's latent/speaker space** (sample speaker embeddings, audition, keep the best seed/embedding as the voice definition). Engine: **FrankenTTS** (R19), used as an offline *tool* (no project code dependency). Script of lines per event (start, lead change, big crash, wreck, photo finish, drop-in welcome, Aussie colour lines). Rendered offline to files; runtime only plays files. |
| **Music** | Regenerate offline with a local music model (e.g. YuE-class score-only generation), prompted and reference-guided to **keep the current vibe and style**; stems where possible for adaptive intensity (lobby, race, final lap, derby, results). |
| **Engines** | Regenerate: per-archetype engine layers (idle, low, mid, high, load/off-load) authored/generated then driven by RPM and throttle at runtime (evolve `EngineSynth` into a layered sample+synth hybrid); damage adds rattle/misfire layers. |
| **SFX** | Regenerate the full set: impacts by material and size, part detach, glass, debris scrape, surface tyre loops (tarmac/dirt/gravel/sand/mud/water), weapon cards, UI (comic pops), prop breaks, crowd. Use the existing `sound-engineer` / `suno-sounds` skills and the sound pipeline doc. |

**Runtime names (R49, spike):** the announcer is pre-rendered, so it can't say typed names. Two paths,
tested in a spike:
1. **Runtime TTS on the host:** check whether a small TTS model can run in the host browser (WASM/WebGPU)
   fast enough to render a name clip in the lobby (target ≤ 2 s per name on a laptop, done in the
   background) in a voice close enough to the FrankenTTS announcer. If so, name clips are generated
   when a player joins and spliced into lines ("…and it's **Big Kev** in the Land Crusher!").
2. **Fallback:** if runtime TTS isn't viable, the announcer refers to players by **number and
   colour** ("Number 7, the orange one!"). Names are **not** pre-rendered (R55).

**Everything else spoken is pre-rendered with FrankenTTS (R55):** announcer lines, countdowns, lap
calls, chaos-event warnings, award names, numbers 1–99, colours and patterns, car names, mode/theme
names, results lines, drop-in welcomes. The spoken script lives in `audio/script/*.toml` (one entry per
line, with variants) and is regenerated by one command whenever copy changes.

Mix rules: announcer ducks music; per-tile sounds aren't duplicated — the host mixes one scene with
distance-based attenuation from the pack/Overview centre, plus priority for big events. Audio review
is a listening round with a written record.

---

## 15. Scenarios, captures and camera regression

### 15.1 One scenario, three uses

A scenario = `{map/generator seed, theme, cars[profile, spawn], scripted ControlFrames or bot+seed,
weapon/prop events, duration, camera mode + per-car view, capture ticks}` (format owned by
`jj-scenario`). The same file runs:

1. **Headless sim** (Node + Rapier WASM) → metrics + trace hash.
2. **Host in a browser** (Playwright, fixed clock) → screenshots at capture ticks.
3. **Replay** from the replay journal → bug-report repro, highlight-reel tests.

Capture set: `hero-car`, `4-pack`, `8-pack`, `16-spread`, `24-pack`, `first-person-4`, `mixed-fp-tp-12`,
`identify-24`, `drop-in-mid-race`, `car-collision`, `car-damage-stages`, `wheel-loss`, `wreck-respawn`,
`debris-field-end-of-derby`, `prop-break`, `race-start`, `fast-corner`, `jump-landing`, `dunes`,
`surface-transitions`, `track-overview`, `derby-overview-24`, `killcam`, `highlight-reel`, one per
theme, one per weapon, `portrait-phone-host`, `ultrawide-host`.

### 15.2 Camera/grid regression suite

N ∈ {1, 2, 3, 4, 6, 9, 12, 16, 20, 24} × displays {portrait phone, 16:9 1080p, 16:9 4K, 21:9} ×
{Grid third-person, Grid mixed first/third, Overview (arena)}: assert tile rects (pure unit tests on
the layout kernel), seat-order stability, animated reflow on join/leave, identity badge presence
(pixel probes), no black tiles, filler content, own-car visible ≥ 40 px in third person. Goldens with
a perceptual tolerance; updated only by an explicit commit carrying before/after sheets.

### 15.3 Visual critique loop

Captures → HTML contact sheet → deterministic checks (identity coverage, car-vs-ground contrast per
theme, text size, outline presence) → vision-LLM rubric (`game-model-prep`) → human glance. Runs on
asset PRs and nightly on the GPU runner.

---

## 16. Gitea + rainbow deploys, fully scripted

### 16.1 Design goals

Jammers owns its whole path: its own Gitea repo, its own protected deploy repo (`jammers-deploy`),
its own runner labels, its own previews. Physical Soccer showed the *shape* works (immutable
candidates, protected deploy repo, isolated preview hostnames, register with expiry, owner-approved
promotion). It also showed where agents ended up hand-holding; 0.2 designs those out:

| Hand-holding cause | 0.2 fix |
|---|---|
| A new build/check script per milestone | **One command:** `jj publish preview [--slug x]`, `jj publish stable --candidate <digest>`, `jj deploy status`. Preview type is data. |
| Expiry clean-up was manual for a long time | **Reconciler from day one**: scheduled job reconciles register → running apps/DNS/routes; idempotent; drift reported. |
| Agents improvising on the NAS (docker-group quirk, middleware) | Fixed, tested deploy scripts with a **preflight** (docker access, disk, memory headroom, DNS token scope) that fails with **reason codes** and documented remedies. |
| Candidates claiming lanes they didn't pass | Manifest is generated by CI only; `publish` refuses missing/failed required lanes and names them. |
| "Does it actually work?" was manual | Mandatory **public smoke** after every publish: load host, create room, join 2 headless controllers via the advertised URL, drive 5 s, assert movement + HUD, record in the register. |

### 16.2 Pipeline

```text
push/PR to Gitea
  fast lane     cargo fmt/clippy/test, cargo deny + no-tokio check, JS lint/typecheck/unit,
                headless scenario bank, asset contract validation, protocol goldens
  browser lane  Playwright e2e (join/drop-in/identify/drive/respawn/results, hub, keyboard clusters,
                reconnect), grid suite
  visual lane   captures + goldens + contact sheet (asset/render changes + nightly, GPU runner)
  candidate     main only, after lanes: multi-arch OCI image (jj-server with bundled dist) →
                Gitea OCI registry by digest; web bundle + manifest + evidence → Gitea packages
jammers-deploy (protected runner; no PR access; manifests are data)
  publish preview  verify manifest vs Gitea run → app + DNS + tunnel route → smoke → register row
  reconciler       expire, remove, re-smoke retained, report drift
  publish stable   owner promotion manifest → same bytes, atomic pointer flip → smoke
```

**Everything lives under `jammers.dilger.dev` (R48):**

| Path | Purpose |
|---|---|
| `jammers.dilger.dev/` | Landing + "Host a game" |
| `jammers.dilger.dev/j/<CODE>` | **Short join URL** shown under the QR (4-letter code, e.g. `/j/ROO7`) |
| `jammers.dilger.dev/c` | Controller entry (type a code) |
| `jammers.dilger.dev/hub` | Hub route for pads/keyboards on another laptop |
| `jammers.dilger.dev/display/<CODE>` | STRETCH: add a screen as an extra display |
| `jammers.dilger.dev/b/<build>/…` | Immutable promoted builds (rooms pin their build) |
| `jammers.dilger.dev/p/<slug>/…` | Rainbow previews, routed by the front router to **that preview's own backend container** |

Previews are path-based, not separate hostnames. Tradeoff: they share the stable origin, so browser
storage keys are **namespaced by build/preview**, and preview code is only served from immutable,
manifest-listed bundles (never arbitrary uploads). If a preview ever needs real origin isolation, a
first-level `jj-<slug>.dilger.dev` hostname is the fallback. Previews show their build and a **Back to
stable** link. Rollback = promote the previous manifest (new rooms only).

### 16.2a Preview isolation and clean-up policy (R52)

**Every preview is a full, separate backend.** Each gets its own `jj-server` container (its own relay,
rooms, `jj-store` FrankenSQLite database on its own volume, its own config and secrets), started from the
preview's candidate image. The only shared piece is the front router that maps `/p/<slug>/` to the
right container (and `/` to stable). A preview can never read or write stable's rooms or data, and
vice versa. The public smoke test (§16.1) runs against the preview's own backend.

**Clean-up (enforced by the reconciler, hourly):**

| Rule | Behaviour |
|---|---|
| Always keep the latest | The newest preview is never removed, whatever its age. |
| Auto-clean after a day | Previews older than **24 h** are removed… |
| …leaving at most 3 | …but the **3 most recent** are kept, and never more than 3 unpinned previews exist at once (publishing a 4th removes the oldest unpinned one). |
| Pinned | `jj preview pin <slug>` (owner only) exempts a preview from all clean-up until `unpin`. Pins are listed in `jj deploy status`. |
| Removal | Stops and deletes the container, its volume and its route; the register row is archived. Candidate images and evidence stay in the Gitea registries, and a preview can be **rebuilt from source** at any time (`jj publish preview --commit <sha>`). |

Resource guard: `publish` checks memory/disk headroom on the NAS first and refuses (with a reason code)
rather than starving stable.

### 16.3 Runners

Use the shared TrueNAS runners, including the GPU runner, for CI lanes. If they're scoped to another
repo or not general, reconfigure them as **general runners** available to the Jammers repo (owner
permission, R15) — a runner is infrastructure, not a code dependency. The deploy runner is separate,
scoped to `jammers-deploy` only, with no PR access. Record actual GPU/backend in perf evidence; reject
software-rendered numbers.

### 16.4 Migration

1. Create the Gitea repo (primary) with GitHub as a passive mirror.
2. Port CI to `.gitea/workflows/`; keep GitHub Actions until parity, then disable deploy there.
3. First preview through `jammers-deploy` while stable remains on ppaas.
4. Flip stable after three consecutive clean scripted publishes; retire `.github/workflows/deploy.yml`
   and the ppaas dependency.

---

## 17. Testing, budgets, acceptance

### 17.1 Test layers

| Layer | Content |
|---|---|
| Rust unit/integration | IDs, protocol codec + goldens + fuzz, room reducer (join/drop-in/resume/identify), relay routing, contracts validators. |
| JS unit | Layout kernel (any aspect), ControlFrame shaping + parity, presets, cards, surfaces, highlight scoring. |
| Scenarios | §7.3, §7.4, §8.5, §9.3, surfaces, procedural validation; determinism hashes. |
| Browser e2e | Topologies §3.3; 24-bot soak via `jj-harness`; phone-host route. |
| Visual | §15 captures, grid suite, goldens. |
| Perf | G-PERF matrix nightly on the GPU runner + manual on this laptop → TCL TV. |
| Device matrix (human) | Pads × browsers × OS; iOS/Android twin-stick; hub laptop; phone host. |
| Playtest rounds | Written records. |

Every gameplay/UX bead follows `BEAD-DEFINITION-OF-DONE.md` (source row, observable behaviour,
play-shaped check).

### 17.2 Budgets (targets to validate, not claims)

| Budget | Target |
|---|---|
| Host fps, 8 tiles, 4K on TCL TV from this laptop | ≥ 60, p95 frame ≤ 20 ms |
| Host fps, 24 tiles, 4K | ≥ 60 at a quality step chosen by G-PERF; ≥ 45 floor |
| Overview, 24 cars + end-of-derby debris, 4K | ≥ 60 |
| Phone host, 4 tiles or Overview | ≥ 30, playable |
| Controller → host apply (venue Wi-Fi, server on NAS) | p95 ≤ 50 ms |
| QR scan → driving (newcomer) | ≤ 20 s median |
| Drop-in: seat claim → car on track | ≤ 3 s |
| Identify: press → visible on screen | ≤ 150 ms |
| Controller bootstrap TTI | ≤ 1.5 s mid Android |
| Own car in smallest tile (third person) | ≥ 40 px tall |
| Physics | 0 rim escapes; ≥ 90 % flip self-recovery; debris always escapable; stable hashes |
| Deploy | preview publish ≤ 10 min, zero manual steps; reconciler drift 0 |

### 17.3 Debug logs and analytics (R28 — design later)

Placeholder so it isn't lost. A later cut designs: which gameplay analytics we collect (session length,
drop-ins, rounds per session, mode/theme choices, map ratings, rage-quits, controller types, camera-mode
switches, identify presses), privacy rules, retention, dashboards, and the debug-log policy (no
per-frame logs; structured one-time and event logs; bounded diagnostic traces on faults). It builds on
the existing `docs/contracts/telemetry-contract.md` and `jj-telemetry` + `jj-store` (FrankenSQLite).
0.2 only needs: bug-report intake, error traces, and map ratings working end to end.

### 17.4 0.2 release acceptance

Technical: all gates passed; two consecutive playtest rounds with no P0/P1 repairs outstanding; stable
promoted through the scripted path.

**Party acceptance (the real test):** a house party of **10+ people including non-gamers** on the TCL TV,
running in Party Mix for 45+ minutes with nobody driving the laptop, where:
- median QR scan → driving ≤ 20 s, and nobody needs help joining;
- people drop in and out throughout and nobody ever waits for a slot;
- nobody is idle for more than ~1 minute without something to do (driving, voting, mayhem, reel);
- every player gets at least one award or reel moment over the night;
- L-plate players finish races and have fun but don't win against skilled players;
- the group asks for "one more" (recorded in the playtest round notes, honestly).

---

## 18. Milestones and bead-ready cuts

### 18.0 Release tiers (R50)

| Tier | What's in it | Goal |
|---|---|---|
| **Minimum build** (first playable couch test) | Rust server day 0, protocol, twin-stick + pads + keys, identity + Identify, drop-in, dynamic grid + Overview, **one car** (the baseline "Cruz Missile" **designed and textured in Blender** through the real pipeline and contract, R54), **one mode** (Race), **one theme** (Red Centre procedural, runtime generation), basic suspension feel, autopilot, auto round progression with the highlight reel (simple version), end game/disband, scripted preview deploy. | Prove the whole loop works end to end on a real couch with the TCL TV, **including the art pipeline** (one real Blender-made car in game). World art can be placeholder. |
| **Full build (0.2)** | Everything else in §4–§17: roster, derby + all modes, destruction and debris, weapons, chaos events, L-plates, voting and Party Mix, tournaments, soft awards, comic + Mad Max look, audio, more themes. | The house-party acceptance in §17.4. |
| **Stretch** | Extra screens (add a phone/laptop as a display), runtime TTS names (if the spike works), dirt bike, Knockout Cup, `jj-mcp`, low-fidelity settings menu, extra themes/cars/weapons from the roadmap lists. | Hardest features, after the party works. |

Minimum-build cut list: V2-01…V2-08, V2-10, V2-11, V2-12, V2-16, V2-17, V2-18, V2-20, V2-21, V2-22,
V2-30, V2-40 (basic), V2-44, V2-50, V2-55, V2-58, V2-73 (race only), V2-76/77 (simple reel),
V2-61, V2-82, V2-82a, V2-100…V2-103. Everything else is Full or Stretch as tagged in §18.2.

### 18.1 Milestones

```text
M0 Foundations (Rust day 0, module skeleton, scenario bank, Gitea CI)
 ├─► M1 Controls, identity & drop-in ─────────────┐
 ├─► M2 Displays, grid, cameras (G-PERF) ─────────┤
 ├─► M3 Deploy pipeline ──────────────────────────┤
 ├─► M4 Driving feel & suspension (G-FEEL) ───────┼─► M6 Destruction ─► M7 Weapons & modes ─┐
 ├─► M5 Procedural Australian tracks (G-PROC) ────┘                                         ├─► M10 0.2 release
 ├─► M8 Comic look & art pipeline (G-LOOK) → asset production ──────────────────────────────┤
 └─► M9 Audio ──────────────────────────────────────────────────────────────────────────────┘
```

### 18.2 Cuts

| ID | Cut | Depends on | Acceptance (summary) |
|---|---|---|---|
| V2-00 | Plan approved + ≥ 4 review rounds | — | Steady state. |
| **M0** | | | |
| V2-01 | Rust workspace skeleton: `jj-types`, `jj-error`, lints, deny, toolchain, no-tokio check; **RCH set up for all agents** (§13.7) | V2-00 | `cargo clippy -D warnings`, deny, graph check green — run via RCH; `jj doctor` confirms routing. |
| V2-02 | `jj-protocol` v1 + TS binding generation + goldens + fuzz | V2-01 | JS and Rust round-trip every golden. |
| V2-03 | `jj-room` + `jj-relay` (sans-I/O) with drop-in, resume, identify routing | V2-02 | Reducer property tests. |
| V2-04 | `jj-net` (fastapi_rust or asupersync HTTP/WS), `jj-static`, `jj-telemetry`, `jj-server` binary + health | V2-03 | Serves dist; e2e join works. |
| V2-04b | `jj-store` on FrankenSQLite: bug reports, telemetry, map ratings; backup + restore test | V2-04 | Crash/restore test passes; DB on a mounted volume. |
| V2-05 | Port host/controller transport to protocol v1; delete Python server | V2-04 | full-game e2e on Rust; `server/` removed; docs updated. |
| V2-06 | JS module skeleton (§13.4), fixed-step 120 Hz loop, sim/render lint rule | V2-00 | Headless sim runs a scenario in Node. |
| V2-07 | Scenario bank (`jj-scenario` format) + runner migrating `PhysicsSimHarness` + weaponLab | V2-06 | 10 scenarios ported; hashes stable ×10. |
| V2-08 | Gitea repo + mirror + CI lanes; shared runners made general | V2-01 | Lanes green on Gitea main. |
| **M1** | | | |
| V2-10 | ControlFrame + typed vocabulary + parity test | V2-02, V2-06 | Swapping source changes nothing. |
| V2-11 | Phone twin-stick controller (presets, lost-pointer lifecycle, rotation, wake lock) | V2-10 | Newcomer drives in 10 s; 30-min no-stuck soak. |
| V2-12 | Host pads + keyboard clusters, claim-by-press, input drawer | V2-10 | 4 pads + 2 clusters on one host. |
| V2-13 | Pads on phones (OTG/BT) | V2-11 | iOS + Android device rows. |
| V2-14 | `/hub` route | V2-10, V2-05 | Hub laptop with 4 pads plays. |
| V2-15 | Split-phone-2p preset | V2-11 | Two humans on one phone race. |
| V2-16 | Identity kit (numbers, colour+pattern palette, badges, nameplates) | V2-10 | `identify-24` capture; colour-blind check. |
| V2-17 | Identify button end to end | V2-16, V2-03 | Press → visible ≤ 150 ms on both sides. |
| V2-18 | Drop-in flow (tile reserve, back-of-pack spawn, protection, scoring rule) | V2-03, V2-20 | `drop-in-mid-race` capture; seat → car ≤ 3 s. |
| **M2** | | | |
| V2-20 | Display abstraction (N surfaces) + dynamic grid kernel (any aspect) + fillers + animated reflow | V2-06 | Layout tests all aspects/N. |
| V2-21 | Third-person chase cam + first-person cam + per-car toggle | V2-20 | Captures `first-person-4`, `mixed-fp-tp-12`. |
| V2-22 | Shared Overview cam with car-size rules (§6.4) + host mid-round camera switch; retire Voronoi code | V2-20 | `derby-overview-8/24`: median car ≥ target size, no thrash; switch works mid-round. |
| V2-23 | Post-once composer, shared shadows, per-tile LOD, render-scale ladder | V2-20 | Works at N = 24. |
| V2-24 | G-PERF spike + decision (defaults, art/debris budgets) | V2-23 | Budget table filled with measured numbers. |
| V2-25 | Camera/grid regression suite + goldens | V2-21, V2-22, V2-07 | In CI visual lane. |
| V2-26 | Phone-host + any-aspect UI scaling profiles | V2-20 | `portrait-phone-host`, `ultrawide-host` captures. |
| **M3** | | | |
| V2-30 | `jammers-deploy` repo + `jj publish preview` + public smoke | V2-08, V2-04 | Zero-manual preview ×3. |
| V2-31 | Reconciler + register + clean-up policy (§16.2a: keep latest, 24 h, max 3, pins) + per-preview isolated backends | V2-30 | Policy tests: 5 publishes leave the right 3; pinned survives; preview data isolated from stable; drift 0. |
| V2-32 | Stable promotion + rollback | V2-30 | Promote/rollback drill. |
| V2-33 | Retire ppaas for Jammers | V2-31, V2-32, V2-05 | jammers.dilger.dev on the Gitea path. |
| **M4** | | | |
| V2-40 | Vehicle model v2: suspension feel, drift, air control, surfaces hook, robustness items | V2-07 | §7.3 scenarios green. |
| V2-41 | Metrics + `sim sweep` CLI + CMA-ES tuning (fast_cmaes) + balance chart | V2-40 | Chart for ≥ 3 archetypes; CMA-ES run proposes a candidate profile. |
| V2-42 | Bot drivers (racer + derby), reused as bot fillers | V2-40 | Bots lap reference tracks; derby bots fight. |
| V2-43 | G-SIM measurement | V2-41 | Decision recorded. |
| V2-45 | Vehicle stats model: physical profile schema, derived display stats from scenarios, turning-circle/wheelbase etc. exposed | V2-41 | Stats regenerate automatically after tuning. |
| V2-46 | Balance pass across the roster with bots + CMA-ES; balance acceptance thresholds | V2-45, V2-42 | No vehicle dominates race or derby medians beyond margin. |
| V2-44 | Feel reference + playtest round (G-FEEL) | V2-41, V2-11, V2-12, V2-30 | Owner accepts or repairs listed. |
| **M5** | | | |
| V2-50 | Generator v2: course graph, terrain, surface map, features, validator | V2-07 | Seeds validate; bots lap. |
| V2-51 | Surface physics materials + particles/sound hooks | V2-40, V2-50 | `surface-deltas` scenario. |
| V2-52 | Red Centre theme first (§11.5), then beach, outback grassland, forest, city, desert dunes (kits via M8) | V2-50, V2-85 | Red Centre capture + playtest; one capture per later theme. |
| V2-55 | Map document `jj.map.v1` + loader; generator emits it; hand-authoring path (pin + edit) | V2-61 | Generated and hand-edited maps load via the same path and validator. |
| V2-56 | Derby arena generator (§11.4) sized to car count | V2-50, V2-55 | Bot derbies meet the fun-scoring thresholds; no escapes. |
| V2-58 | `jj-procgen` Rust→WASM in a Web Worker; runtime generate + validate + silent reroll; lobby preview + Reroll; seed display + replay | V2-55, V2-02 | Laptop ≤ 1.5 s, phone ≤ 4 s (measured); same seed ⇒ same map in browser and native. |
| V2-59 | Map ratings on controllers → `jj-store`; CMA-ES generator tuning against bot fun-scores | V2-58, V2-53, V2-04b | Ratings stored; tuning run produces a committed parameter set. |
| V2-57 | Water events: seasonal creeks + telegraphed flash floods (surface, current, splash-downs) | V2-51, V2-55 | `flash-flood` scenario: flow pushes cars, telegraph shown, no stuck cars. |
| V2-53 | Fun-scorer + curated seed list per theme | V2-42, V2-50 | Seed list committed. |
| V2-54 | Procedural playtest rounds ×2 → G-PROC verdict | V2-53, V2-44 | Continue, or escalate to owner for authored maps. |
| **M6** | | | |
| V2-60 | Part-based damage model + stages + handling consequences | V2-40, V2-61 | `door-detach`, `wheel-loss-limp` green. |
| V2-61 | Vehicle + destructible contracts (`jj-contracts`, schemas, validator CLI) | V2-01 | Bad asset fails CI with a named rule. |
| V2-62 | Persistent debris + budget/merge + escapability | V2-60, V2-24 | `debris-persist-match`, `debris-field-drive`. |
| V2-63 | Wreck → nearby respawn + time penalty | V2-60 | `chassis-zero-respawn`. |
| V2-64 | Environmental destruction (fractured props, car damage by mass) | V2-62, V2-52 | `prop-break-car-damage`. |
| **M7** | | | |
| V2-70 | Weapon cards schema + migrate 8 weapons (damage via §8) | V2-44, V2-60 | Cards validate. |
| V2-71 | Per-card scenario sets + balance sweeps | V2-70, V2-42 | §9.3 green. |
| V2-72 | Weapon juice pass (tells, comic impacts, per-tile shake, kill feed) | V2-71, V2-21 | Playtest round record. |
| V2-73 | Mode rules framework + Race + timed points-for-damage Derby | V2-44 | Both playable end to end; no knock-outs in derby. |
| V2-74 | Stunt Arena, King of the Bowl, Team modes | V2-73 | Each tuned through a round. |
| V2-75 | Wrecked-player mayhem (§10.1) + bot fillers | V2-73, V2-42 | Round verdicts. |
| V2-100 | Party flow: auto progression, intermission timer, big-QR intermission screen, end game / disband | V2-73, V2-03 | 45-min unattended session runs; disband clears controllers. |
| V2-101 | Autopilot bot takeover + return, no auto-pause, manual pause | V2-42, V2-03 | Pull a phone's network: bot drives within 2 s; reconnect hands back. |
| V2-102 | Race finish timeout + progress ranking + finish bonus; host settings panel with defaults | V2-73 | Scenario: timeout ranks by progress; settings persist. |
| V2-103 | Short URLs + path routing under jammers.dilger.dev (`/j/CODE`, `/c`, `/hub`, `/b/`, `/p/`) | V2-04, V2-30 | All routes smoke-tested on stable and a preview. |
| V2-104 | Voting on next map/mode + Party Mix / Derby Tournament / Race Tournament presets | V2-100, V2-79d | Each preset runs a full session. |
| V2-105 | Derby scoring: 3-min timed round, raw-point ranking, halved autopilot points | V2-73 | Scenario: late joiner ranks on raw points; autopilot points halved. |
| V2-106 | Soft awards engine + reel "everyone featured" rule | V2-77 | Awards spread across players in a 10-bot session. |
| V2-107 | L-plates: assists, speed cap, balance acceptance, visible L-plate mounts in the vehicle contract | V2-46, V2-61 | Skilled bot always beats L-plate bot; plates visible in captures. |
| V2-108 | Chaos event cards + first set (flash flood, cyclone, roo stampede, dust storm, road train, hail) | V2-57, V2-51 | Each has telegraph + scenarios; no OOB placements. |
| V2-109 | "Surprise me" + labelled auto-picks | V2-79a | Tag visible on controller and host card. |
| V2-110 | SPIKE: runtime TTS on the host for player names | V2-90 | Decision recorded with timings; number + colour fallback in place either way. |
| V2-112 | Australianisms research pass → `docs/copy/australianisms.md`; owner review | V2-00 | Approved list feeds awards, announcer script and names. |
| V2-113 | Spoken copy script (`audio/script/*.toml`) + one-command FrankenTTS render of all non-name lines | V2-90, V2-112 | Every in-game spoken line has a rendered file; regen is one command. |
| V2-111 | STRETCH: add a phone/laptop as an extra display | V2-20, V2-17 | Two-screen session with 30+ players. |
| V2-76 | Replay ring buffer + event log; derby killcam | V2-21, V2-73 | ≤ 10 MB at 24 cars; skip vote. |
| V2-77 | Race highlight reel director | V2-76 | `highlight-reel` capture; owner enjoys it. |
| V2-78 | Session scoreboard + one-press rematch | V2-73 | e2e. |
| V2-79a | Garage on controller + host panel for pads/keys: name (generated + edit + reroll), car carousel with stats + Nerd stats, paint, READY | V2-16, V2-11, V2-12, V2-46 | Newcomer names, picks, readies ≤ 30 s. |
| V2-79b | Ready-up rules + host force-start with warning countdown, visual + haptics (vibrate / gamepad rumble), random-car fallback | V2-79a, V2-03 | Warning reaches phone ≤ 150 ms; nobody left behind. |
| V2-79c | Solo/teams toggle, team assignment + auto-balance, team visuals, no friendly-fire scoring | V2-73, V2-16 | Team race + team derby end to end. |
| V2-79d | Event formats (Quick, Series, Cup; Knockout Cup greybox), points tables, standings screen, awards | V2-73, V2-78 | Series of 5 runs end to end with standings. |
| **M8** | | | |
| V2-80 | Comic render stack: toon ramps, post outline, halftone, speed lines, impact words | V2-23 | Works at N = 24 within G-PERF. |
| V2-81 | UI kit with wobbly ink lines (host HUD, lobby, results, controller) — owner mock first | V2-16 | Owner-approved mock, then build. |
| V2-82 | `tools/blender/` scripts: normalise, parts split, fracture, bake, LOD, export | V2-61 | One car concept → GLB by script + MCP. |
| V2-82a | **Minimum-build car:** "Cruz Missile" designed, UV'd and textured in Blender (via MCP + scripts), parts split per §8.1, contract sidecar, in game via the real loader | V2-61, V2-82 | Passes contract validator + `vehicle-model-validation`; readable at 40 px; drives in the Minimum build. |
| V2-83 | G-LOOK: hero car, one theme, UI kit | V2-80, V2-81, V2-82, V2-21 | Owner approves at 1/4/24 tiles + Overview. |
| V2-84 | Car roster (§7.6: 14 vehicles, 5 classes, all new, made-up names; bike CANDIDATE) | V2-83, V2-60, V2-46 | All pass contract + `vehicle-model-validation`; scenarios green; balance acceptance met. |
| V2-86 | Mad Max / emissive shader set (§12.1a) + day/dusk/night grades | V2-80 | Readability captures pass at night; costs within G-PERF ladder. |
| V2-85 | Theme kits + destructible props for 5 themes | V2-83 | Validated kits. |
| **M9** | | | |
| V2-90 | Announcer: latent-space Aussie voice selection + line script + render | V2-00 | Listening round approves voice. |
| V2-91 | Music regeneration keeping the vibe; adaptive stems | V2-00 | Listening round. |
| V2-92 | Engine layers per archetype + damage layers; runtime engine mixer | V2-84 | Listening round in-game. |
| V2-93 | SFX set regeneration (impacts, parts, surfaces, weapons, UI, props) | V2-72, V2-64 | Listening round. |
| **M10** | | | |
| V2-99 | 0.2 qualification: 16+ couch session on TCL 4K, phone-host session, promotion | all | §17.4. |

### 18.3 Parallelism

After M0's first cuts, tracks with little file overlap: **Rust server** (crates/), **Controls/identity**
(input/, ui/controller), **Displays/cameras** (render/), **Deploy** (separate repo), **Art pipeline**
(tools/blender, art/), **Audio** (offline). Physics, tracks and destruction start once the scenario
bank exists. NTM swarms stay ≤ 5 panes.

---

## 19. Risks, open questions, next steps

### 19.1 Risks

| Risk | Mitigation |
|---|---|
| Rewrite stalls a playable game for weeks | Current game stays live as stable; 0.2 ships as rainbow previews from M1; every milestone playable. |
| Day-0 Rust swap breaks joining | Full-game e2e must pass on Rust before `server/` is deleted (V2-05); previews first. |
| 24 tiles + first person + debris too slow | G-PERF early; debris merge; render-scale ladder; default grid cap = measured N with a readability banner above. |
| Destruction makes cars uncontrollable or tracks impassable | Gentle handling consequences; escapability scenarios; debris budget. |
| Procedural tracks not fun | Fun-scorer, curated seeds, two rounds, then the owner's authored-maps fallback (G-PROC). |
| Comic outlines hurt readability at small tiles | Outline width by tile size; identity rule overrides effects; G-LOOK at 24 tiles. |
| Twin-stick worse for newcomers | Presets + one-thumb fallback + playtest. |
| Image-to-3D output is messy | Always cleaned up by script; contract validator gates. |
| Deploy still needs hand-holding | Reason-coded preflight, reconciler, "zero manual ×3" before retiring ppaas. |
| Scope creep from the roadmap lists | Roadmap items need a card/greybox + round verdict; nothing ships unplaytested. Minimum → Full → Stretch tiers (§18.0). |
| Party features make the game feel random or unfair | Chaos events telegraphed and bounded; L-plates speed-capped; all switchable in host settings; tournament presets turn most of it off. |
| Autopilot farms points or feels spooky | Weak bot, no weapons, halved points, not counted as present; visible 🤖 badge. |
| Path-based previews share the stable origin | Namespaced storage; only manifest-listed immutable bundles served; hostname fallback. |

### 19.2 Open questions for the owner

Answered in r2–r5. Remaining (defaults apply if unanswered):

None. All answered (R1–R56). Theme order: **Red Centre → Beach → Outback grassland → Forest → City →
Desert dunes** (chosen for maximum contrast between consecutive themes).

### 19.3 Next steps

1. Owner approves r5 (and answers §19.2, or accepts the defaults).
2. ≥ 4 planning-workflow review rounds, integrated in place.
3. Convert §18.2 into beads under label `v0.2` with dependency edges; reconcile with
   `scripts/reconcile_plans_to_beads.py`.
4. Build the **Minimum build** tier first (§18.0), starting with M0 (V2-01, V2-06, V2-08) and the G-PERF spike path in parallel.
