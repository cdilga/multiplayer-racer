# Gap: Full Input Expansion (device-agnostic seats — phone + keyboard + game controller)

> **Status:** gap-design v1 · extends Theme B of `feedback-design-pass.md` (§6, items 13–16, **29**)
> and the beads `FB-scheme` / `FB-twin` / `FB-keys` / `FB-ghost` / `FB-rearfire` (§13). Adds a new
> first-class input device — the **game controller (Gamepad API)** — by waking the dormant
> `static/js/input/InputManager.js` gamepad path, and unifies phone + keyboard + gamepad under one
> `ControlScheme` abstraction so they can all play in the **same** game at once.
>
> **Scope of this doc:** the *undesigned* parts of item 29 + the owner's expansion — (1) game-controller
> support as a peer device, (2) **mixed** device types in one game simultaneously, (3) **two control
> fidelities everywhere**: a digital A-B button mode *and* full analog (stick + trigger), with
> **pressure-sensitive analog buttons** used where the hardware reports them and graceful degradation to
> digital where it doesn't, (4) **no caps** — N gamepads → N seats, N keyboards by key-region, N phones,
> with spawn generation that produces N spawns for arbitrary N.
>
> **Method (house style):** *Problem (grounded)* → *Options* → *Recommendation* → *beads* → *Tests*,
> with `file:line` anchors and human-decision flags. Beads here **extend** `FB-scheme`/`FB-keys` and add
> new beads/scope (`FB-gamepad`, `FB-spawngen`, `FB-remap`); they do **not** duplicate the Theme-B beads.

> **Owner decisions locked 2026-06-29:** Local and Remote both remain uncapped for all device varieties.
> Controls must be configurable/remappable and saved locally for now. Auto-suggest analog where hardware
> supports it, expose digital variants, default gamepads to "Press A to join", warn about keyboard
> ghosting without hard-capping, and promote no-cap spawn generation to a foundational bead.

---

## 1. Problem (grounded)

The throughline of Theme B is *"controls should be swappable, self-teaching, and uncapped"*
(`feedback-design-pass.md:426`). Three things block the device half of that today:

**(a) Input is hardwired to touch, and the unused modules are richer than what ships.** The live
controller is imperative DOM built in `initGameControls` (`player.js:1272-1349`): a horizontal steering
joystick, accel/brake pedals, and a center fire button (`player.js:1287-1306`, `player.css:560`).
Keyboard is arrows-only, with a **duplicate** global handler (`player.js:1364-1394` and again
`:1826-1856`). Meanwhile `static/js/input/InputManager.js` already contains a **complete, working
Gamepad API path** — `gamepadconnected`/`disconnected` listeners (`InputManager.js:135-151`),
`pollGamepad()` reading `navigator.getGamepads()` with a deadzone (`:156-179`), and a source-mixer that
picks the largest-magnitude axis across touch/gamepad/keyboard (`:216-264`) — but it is **never
instantiated** (`enableGamepad` defaults `false` at `:26`; nothing in `player.js` constructs it).
`TouchController.js` (tilt + zones) is likewise dead. The capability exists; it's just not wired.

**(b) There is no device-agnostic seat.** The control payload is a flat
`{steering, acceleration, braking}` object (`player.js:17-21`) that the client clamps and the server
relays verbatim (`app.py:407-426`). The host doesn't know *what* produced those numbers, which is good —
**the seat is already device-agnostic at the wire** — but the *client* has no abstraction: the touch
path writes `gameState.controls` directly, and there's no notion of "this seat is driven by a gamepad
on index 2" vs "a phone" vs "WASD". `FB-scheme` (`feedback-design-pass.md:1191`) introduces the
`ControlScheme` data abstraction; this doc makes it the layer that **also** unifies gamepad and keyboard,
not just touch layouts.

**(c) Fidelity is implicitly digital, and the analog signal the hardware already provides is thrown
away.** The touch path produces near-binary values (joystick → steering, pedal press → accel = 1). The
keyboard path is strictly digital (`InputManager.js:102-128`: steering ∈ {−1,0,1}, accel ∈ {0,1}). Yet
`pollGamepad` *already* reads `gamepad.buttons[7]?.value` (`:175`) — the Gamepad API reports a **float
0..1** for analog triggers and pressure-sensitive buttons — and then that analog richness is flattened
the moment it meets a digital scheme. There is no place in the model that says "this input is analog,
use the float" vs "this input is digital, use 0/1."

**(d) The "no caps" promise is contradicted by spawn generation.** Verified: there is **no server-side
player cap** (`feedback-design-pass.md:83`, re-confirmed — `player_control_update` never checks a count,
`app.py:384-426`). But the **client** caps hard: `Track.getSpawnPosition(playerIndex)` does
`playerIndex % this.spawnPositions.length` (`Track.js:153`), and the procedural generator emits exactly
**`gridRows = 8` × 2 sides = 16** spawns (`ProceduralTrackGenerator.js:170-196`); derby JSON ships
**16** (`derby-arena.json` spawn.positions). So player 17 silently **spawns on top of** player 1. "Let
them be free" (principle 6, `:134`) fails at N > 16 today — not by blocking the join, but worse, by
overlapping cars.

**The missing primitive:** a **device adapter layer** under `ControlScheme` that (i) enumerates and binds
*any* input device to a seat, (ii) tags each control axis with a **fidelity** so analog is read where
present and degrades to digital where not, and (iii) a spawn generator that produces **N** non-overlapping
spawns for arbitrary N.

---

## 2. The model: Device → ControlScheme → seat (one device-agnostic pipeline)

The unifying idea is that **every** input device — a phone touchscreen, a USB/Bluetooth gamepad, a
region of a keyboard — is just a **`DeviceSource`** that produces a normalized **`ControlFrame`**, and a
**`ControlScheme`** maps that frame to the seat's wire payload. The host never learns the device type;
the seat stays device-agnostic exactly as it is today (`app.py:407`).

```
   ┌─────────────┐     raw events      ┌──────────────┐   ControlFrame    ┌──────────────┐
   │ DeviceSource │ ───────────────────▶│ ControlScheme │ ────────────────▶ │ seat payload │
   │  (per device)│  axes/buttons w/    │ (data-driven  │  {steering,       │ {steering,   │
   │              │  fidelity tags      │  mapping)     │   throttle,       │  acceleration,│
   └─────────────┘                     └──────────────┘   fireDir, ...}    │  braking}    │
        ▲                                      ▲                            └──────┬───────┘
        │ auto-detect + bind                   │ picker / auto-suggest             │ player_control_update
   ┌────┴──────────────────────────────────────┴────┐                       (player.js:1554, app.py:391)
   │ TouchSource │ GamepadSource[i] │ KeyRegionSource │                             ▼
   │ (player.js  │ (InputManager     │ (key-set        │                      host sim → car
   │  joystick)  │  gamepad path)    │  partition)     │
   └─────────────────────────────────────────────────┘
```

**`DeviceSource` contract.** Each source exposes a small, uniform surface:

```
DeviceSource {
  id            // "touch", "gamepad:2", "kbd:wasd"
  kind          // 'touch' | 'gamepad' | 'keyboard'
  capabilities  // { analogSteer: bool, analogThrottle: bool, pressureButtons: bool }
  poll() -> ControlFrame   // called each tick (gamepad) or event-driven (touch/keyboard)
}

ControlFrame {                       // device-neutral, fidelity-tagged
  steer:    { value: -1..1, analog: bool },
  throttle: { value:  0..1, analog: bool },   // forward
  reverse:  { value:  0..1, analog: bool },   // back/brake
  fireFwd:  { value:  0..1, analog: bool },   // analog where a pressure button drives it
  fireBack: { value:  0..1, analog: bool },
  buttons:  { ... }                            // scheme-specific extras
}
```

`capabilities` is what drives auto-suggest (§4) and lets a scheme *declare what fidelity it expects* and
*adapt to what the device offers* (§3). The `analog` flag on each axis is what the scheme reads to decide
"use this float" vs "snap to 0/1" — fidelity is **per-axis**, not per-device, because a single gamepad can
have an analog stick *and* digital face buttons at once.

**Why this is the right seam.** The server already proves the seat is device-agnostic (a flat
`{steering, acceleration, braking}`, `app.py:407`). All we're adding is a **client-side** translation
layer so that any device can produce that payload, and so the *richer* twin-shooter payload (fire
direction, `FB-twin`/`FB-rearfire`) has one place to be assembled. `ControlScheme` (`FB-scheme`) is the
mapping; `DeviceSource` is the new sibling abstraction this doc contributes.

---

## 3. Fidelity: digital A-B, full analog, and pressure-sensitive buttons (the owner's core ask)

Three fidelities must **all** work, on a per-axis basis, with graceful degradation. The rule is a single
**`readAxis(frame.axis, schemeFidelity)`** helper, so every scheme gets the same behavior for free:

| Fidelity | What the device gives | How the scheme reads it | Examples |
|---|---|---|---|
| **Digital / A-B** | button down/up → `{value: 0 or 1, analog: false}` | use as-is; `steer` from a left/right button pair resolves to {−1,0,1} | keyboard; d-pad; face-button accel/reverse; phone tap zones |
| **Full analog** | stick axis / analog trigger → `{value: float, analog: true}` | use the float directly; apply deadzone (`InputManager.js:170`) + optional response curve | gamepad left stick = steer, RT/LT triggers = throttle/brake |
| **Pressure-sensitive button** | `gamepad.buttons[i].value` ∈ 0..1 (`InputManager.js:175`) | **if `analog === true`, use the float**; else fall back to the pressed bit (`button.pressed ? 1 : 0`) | analog triggers/face buttons that report pressure |

**The degradation rule (one line, applied everywhere).** A scheme declares the fidelity it *wants* per
action (`mapping.throttle.fidelity = 'analog'`). `readAxis` honors it **only if the device supplied an
analog sample** for that axis (`frame.throttle.analog === true`); otherwise it uses the digital value.
So:

- An **analog scheme on a gamepad with analog triggers** → smooth 0..1 throttle (pressure-sensitive).
- The **same analog scheme on a gamepad whose triggers are digital** (or whose face buttons aren't
  pressure-aware) → `button.value` comes back as exactly 1.0 on press / 0.0 on release, so it *already*
  degrades to A-B with no special-casing — the Gamepad API guarantees `value` ∈ [0,1] and is `0`/`1` for
  non-analog buttons.
- A **digital scheme on any device** → ignores the float, snaps to 0/1, giving the deliberate "two-button
  accel/reverse" feel the owner wants even on a gamepad.

**Where the analog sample comes from.** Gamepad: `gamepad.buttons[i].value` (float) and `gamepad.axes[i]`
(float, already deadzoned at `InputManager.js:170-172`). Touch: the steering `Joystick` already produces
a continuous −1..1 (`player.js:1329`), so touch-steer is **analog** and touch pedals are **digital**
(tap = 1) — a phone is therefore a *mixed-fidelity* device, which the per-axis `analog` flag handles
naturally. Keyboard: always digital by construction (`InputManager.js:102-128`).

**Recommendation.** Implement `readAxis(frame.axis, wantFidelity)` as the single chokepoint; tag every
`ControlFrame` axis with `analog` at the source; have schemes **declare** desired fidelity per action and
**adapt** via `readAxis`. This is the cleanest expression of the owner's "read analog where present,
gracefully degrade to digital" requirement, and it needs no device-type branching in the schemes.

**Decision flag D-fid:** should fidelity be **user-selectable** (a toggle: "I want simple two-button
driving" even on a gamepad) or purely **auto** from capabilities? Recommend **auto-suggest the analog
scheme when capabilities allow, but expose a per-scheme digital variant in the picker** — some players
genuinely prefer A-B even with a stick. (Ties to the §4 picker.)

---

## 4. Device auto-detect + scheme assignment (mixed devices in one game)

The owner wants phone + gamepad + keyboard players **in the same game at once**. Because the seat is
device-agnostic (§2), this is purely a *client binding* problem: each participant's browser detects its
own device(s) and picks a scheme; the host just receives seat payloads and can't tell them apart.

**Auto-detect heuristics** (extends the `FB-scheme` B1b auto-suggest, `feedback-design-pass.md:460`):

| Signal | Inferred device | Default scheme |
|---|---|---|
| `gamepadconnected` fires (`InputManager.js:136`) | game controller | **Gamepad-analog** (stick steer + trigger throttle), or **Gamepad-AB** if digital-only |
| touch + small viewport (existing input auto-detect, game-modes §4.2b) | phone | **Classic** (joystick + pedals) or **Twin-shooter** (`FB-twin`) |
| physical keyboard, no touch, large viewport | keyboard | **Keyboard** scheme (`FB-keys`, WASD/arrows + shoot keys) |

Auto-suggest is a *default*, never a lock: the picker (B1a) lets any participant override, and the chosen
scheme persists per device token (ties to identity, §10/§11.6 of the base plan). A participant can hold a
gamepad *and* have a keyboard; the picker shows the detected devices and lets them bind one to their seat.

**The two real-world topologies for "many devices on one machine":**

- **Many gamepads, one machine → many seats.** `navigator.getGamepads()` returns an **array indexed by
  controller** (`InputManager.js:159`); each non-null index is a distinct physical controller. Enumerate
  the array → **one seat per index** (§5). This is the clean, OS-supported multi-local path.
- **Many keyboards, one machine → key-region seats.** A browser **cannot** tell which physical keyboard
  sent a keydown, so "N keyboards" resolves to **key-region partitioning** (B3a,
  `feedback-design-pass.md:489`): seat 1 = WASD + `Q`/`E`, seat 2 = `IJKL` + `U`/`O`, seat 3 = arrows +
  `,`/`.`, etc. Each `KeyRegionSource` owns a disjoint key-set; a shared `keydown` listener routes a key
  to whichever region claims it. **Honest local limit:** practical up to ~3–4 players before key-sets
  collide and **keyboard ghosting** (the keyboard's own hardware drops simultaneous keypresses, esp. on
  membrane keyboards) bites — this is a hardware constraint, not a software cap, and we don't pretend it
  away. Beyond that, each player uses their own device (the Remote path, B3b).

**Recommendation.** B1a picker + B1b auto-suggest, generalized to gamepad and keyboard; the picker shows
*all* detected devices and binds one per seat. Multiple gamepads each get their own seat automatically;
multiple keyboards via opt-in key-region seats with an honest "~4 players, watch for ghosting" note in the
UI.

---

## 5. Multi-gamepad enumeration → seats

`navigator.getGamepads()` is the whole mechanism. The dormant code already handles a *single* gamepad
(`this.gamepadIndex`, `InputManager.js:47,138`); the expansion is to track the **set** of connected
indices and mint a seat per index.

**Design.**
- On `gamepadconnected` (`:136`), add `e.gamepad.index` to a `connectedPads: Set`; on `gamepaddisconnected`
  (`:142`), remove it and mark that seat "controller away" (reuse the ghosted-car / reconnect treatment
  from `FB-rejoin`, since a dropped gamepad is functionally a dropped controller).
- Each tick, `pollGamepads()` iterates `navigator.getGamepads()`; for each non-null pad, read
  axes/buttons → `ControlFrame` (fidelity-tagged) → that seat's scheme → seat payload. This is
  `pollGamepad` (`:156-179`) generalized from one index to the array.
- **Seat assignment:** when a new pad connects, either (a) auto-claim a new seat (local-couch default), or
  (b) show a "Press A to join as Player N" prompt (the console-game idiom — avoids a stray controller
  grabbing a seat). Recommend **(b)** for walk-up clarity, **(a)** as a host setting.
- **Capability probe:** on first poll, inspect `gamepad.mapping` (`"standard"` vs `""`) and whether
  `buttons[6/7].value` ever leaves {0,1} to set `capabilities.pressureButtons`. `mapping === "standard"`
  guarantees the RT/LT-as-triggers layout `pollGamepad` assumes (`:175-176`); for non-standard pads, fall
  back to a stick-only analog scheme or the AB scheme. (Non-standard mapping is the **biggest
  cross-device gotcha** — see §8.)

**Why no cap here.** The array is the only limit; the browser will report as many pads as the OS exposes.
The honest physical ceiling is **USB hub bandwidth / Bluetooth radio limits** (a powered hub can run 4–8
controllers comfortably; cheap hubs starve past ~4) — again a hardware reality we surface, not a software
cap. N pads → N seats, full stop.

---

## 6. No-cap spawn generation (the actual blocker for "let them be free")

This is the one place the no-cap promise breaks in code (§1d). Two fixes, both small:

- **`Track.getSpawnPosition` must not wrap (`Track.js:153`).** The `playerIndex % length` modulo silently
  overlaps cars. Replace with a generator that **produces a spawn for any index**: when `index >=
  spawnPositions.length`, synthesize additional non-overlapping spawns by extending the grid (more rows
  back along the start straight for race; concentric rings outward for derby) rather than aliasing onto an
  existing slot.
- **`ProceduralTrackGenerator` must take `gridRows` from N, not a constant 8 (`:170`).** Parameterize the
  grid by the joined-player count: `gridRows = ceil(N / 2)` (2 lanes), clamped only by track length, with
  rows trailing further back as needed. Derby arenas generate concentric spawn rings sized to N.

**Recommendation (B3c, `feedback-design-pass.md:498`).** Make spawn generation a pure function
`generateSpawns(track, N) -> Spawn[N]` that is **guaranteed length N** and **non-overlapping** (assert
pairwise distance ≥ car footprint). No join is ever blocked on count; rendering degrades per principle 6
(`FB-perf` LOD/markers) as N grows, but **seats and spawns are unbounded**. This is what makes the
"60 players and it sucks, let them be free" line (`:33`) literally true instead of aspirational.

**Cross-bead note.** This consumes game-modes §4.2b (the late-join spawn path,
`GameHost.js:684-695,776`) and is promoted out of `FB-keys` into **`FB-spawngen`** (or the existing
`br-fb-spawncap-qi9`, renamed/split if the graph already has it). The
`_getLateJoinSpawnPosition` / `getSpawnPosition(this.vehicles.size)` callers
(`GameHost.js:690,776`) all route through the same generator, so fixing it once covers race, derby,
late-join, respawn, keyboard, gamepad, phone, Local, and Remote seats.

---

## 7. Reuse vs delete (one input path)

Per B1c (`feedback-design-pass.md:462`): **reuse** `InputManager.js` (adopt its gamepad path as
`GamepadSource`) and `TouchController.js` (tilt becomes a `TouchSource` variant / Tilt-steer scheme),
**delete** the duplicate keyboard handler (`player.js:1826-1856`) so there is exactly one input path.
The live touch DOM (`initGameControls`, `player.js:1272-1349`) gets refactored into a `TouchSource` +
scheme renderer rather than thrown away. Net: `InputManager` becomes the real, instantiated hub it was
always written to be (its source-mixer `_selectLargest`, `:251`, even handles a player using two devices
on one seat).

---

## 8. The biggest gotcha (call it out loud)

**Gamepad mapping is not guaranteed `"standard"`, and analog-button reporting is wildly inconsistent
across hardware/OS/browser.** The dormant `pollGamepad` hardcodes the standard layout — left stick = axis
0, RT = button 7, LT = button 6 (`InputManager.js:171-176`). That's correct **only** when
`gamepad.mapping === "standard"`. Off-brand pads, some Bluetooth controllers, and certain browser/OS
combos report `mapping === ""` with a vendor-specific axis/button order, so "RT" might be axis 5 or button
5. Worse, **whether a trigger reports analog pressure at all** (`button.value` ∈ (0,1) vs only {0,1})
varies by device *and* driver — the very pressure-sensitivity the owner wants is the least portable part
of the Gamepad API. **Mitigation, and why our model survives it:** the `capabilities` probe (§5) detects
non-standard mapping and missing pressure, and the per-axis `analog` flag + `readAxis` degradation (§3)
means a pad that *claims* analog but reports only {0,1} **automatically** behaves as A-B — no crash, no
dead control, just lower fidelity. We **never** assume a layout silently (principle 9,
`feedback-design-pass.md:144`): non-standard pads fall back to stick-steer + button-throttle and are
flagged in the picker ("basic controller detected"). This is the one area to test on real hardware, not
just synthetic gamepad mocks.

---

## 9. Bead breakdown (extends existing Theme-B beads)

| Bead | Parent (existing) | What this expansion ADDS |
|---|---|---|
| **FB-gamepad** *(new)* | `FB-scheme` (`feedback-design-pass.md:1191`) | Wake `InputManager.js` gamepad path as a `GamepadSource`: instantiate it, track **`connectedPads` set** (multi-pad, §5), `pollGamepads()` over the `getGamepads()` array → one seat per index; capability probe (`mapping`, pressure); "Press A to join" seat-claim; gamepad-drop = controller-away (reuse `FB-rejoin`). Depends on the **`DeviceSource`/`ControlFrame`** seam landing in `FB-scheme`. |
| **FB-scheme** *(scope add)* | itself (`:1191`) | Introduce the **`DeviceSource` → `ControlFrame` → scheme** pipeline (§2) and the **per-axis fidelity** model with `readAxis(axis, wantFidelity)` (§3): digital / analog / pressure-button degradation. Schemes declare desired fidelity per action; `TouchSource`/`KeyRegionSource`/`GamepadSource` are the three sources. Delete the duplicate keyboard handler (`player.js:1826-1856`); refactor `initGameControls` into a `TouchSource` + renderer (§7). Generalize auto-suggest (B1b) to gamepad + keyboard (§4). |
| **FB-remap** *(new/scope add)* | `FB-scheme` | Configurable per-device/per-scheme remaps with local persistence. Store mappings locally for now (keyed by durable device token/source id), validate for conflicts/missing required actions, and expose reset-to-default. No account sync in this phase. |
| **FB-spawngen** *(new/promoted)* | `FB-keys`, `FB-mapvalid-allmodes`, `br-fb-spawncap-qi9` | **No-cap spawn generation** (§6): `Track.getSpawnPosition` stops wrapping (`Track.js:153`); `ProceduralTrackGenerator` grid from N (`:170`); `generateSpawns(track,N)->Spawn[N]` guaranteed-length, non-overlapping, on valid ground/support, with sane race heading and derby rings. Covers late-join/derby rings (`GameHost.js:684,776`) and feeds the map-validity gate. |
| **FB-keys** *(scope add)* | itself (`:1194`) | **Key-region partitioning** as N `KeyRegionSource`s with disjoint key-sets (§4) + honest ghosting/~4-player note in UI. Depends on `FB-spawngen` for uncapped seats rather than owning spawn generation itself. |
| **FB-twin** | itself (`:1193`) | Unchanged scope, but its richer payload (steer + directional fire + throttle) is now assembled through the same `ControlFrame` → scheme mapping, so the **same twin-shooter scheme works on a gamepad** (left stick = steer + fire-dir on its two axes, right trigger = throttle) as on a phone. Still depends on `FB-rearfire` for the host-side directional weapon. |
| **FB-ghost** | itself (`:1195`) | Tutorials become **device-aware**: the ghost demos the gesture for the *bound device* (thumb on a touch knob, a stick-tilt diagram for gamepad, a key-press diagram for keyboard), driven by the scheme's `tutorial[]` data + the source's `kind`. |

**Sequence.** `FB-scheme` (the `DeviceSource`/`ControlFrame`/`readAxis` seam) is the keystone — it
unblocks `FB-gamepad`, `FB-remap`, the gamepad/keyboard half of `FB-twin`/`FB-keys`, and the device-aware
`FB-ghost`. `FB-spawngen` is foundational and can run in parallel once the map-validity interfaces are
clear. Order: **`FB-scheme` → (`FB-gamepad` ∥ `FB-remap` ∥ `FB-keys`)**, with **`FB-spawngen` feeding
`FB-keys` and map validity**, then `FB-twin`/`FB-ghost`. All sit
in **Wave 3** of `feedback-design-pass.md` §13 (`:1221`), alongside the existing Theme-B chain
`FB-scheme`→`FB-rearfire`→`FB-twin`, `FB-scheme`→`FB-keys`/`FB-ghost`.

**Resolved owner decisions.**
- **D-fid (§3):** auto-suggest analog when capabilities allow, and expose a digital variant in the picker.
- **D-claim (§5):** "Press A to join" is the default; auto-claim can exist later as a host setting.
- **D-keylimit (§4):** keyboard ghosting is a soft warning, never a software cap.
- **D-remap:** remaps are required, configurable, and saved locally for now.
- **D-spawn:** no-cap spawn generation is promoted to a foundational bead, not buried inside keyboard work.

---

## 10. Tests

Built on `feedback-design-pass.md` §6.1/§6.3 tests and §12 harness. Gamepad tests use a **synthetic
`getGamepads()` mock** for the deterministic cases (CI) plus a **manual real-hardware pass** for the
non-standard-mapping/pressure gotcha (§8), which mocks can't honestly cover.

- **Analog read where present, degrades to digital (§3 — the core fidelity test).**
  Unit: feed a `ControlFrame` with `throttle.value = 0.42, analog: true` through an analog scheme →
  assert seat `acceleration === 0.42`. Same scheme, `throttle.value = 1, analog: false` (digital button)
  → assert `acceleration === 1` (degraded, no crash). Digital scheme + `analog: true, value: 0.42` →
  asserts it **snaps to 1** (scheme overrides device fidelity downward). Pressure button: gamepad mock
  `buttons[7].value = 0.6` → `acceleration === 0.6`; mock `value` only ever {0,1} → behaves as A-B.
- **Three mixed device types in one game (§4 — the headline).** E2E: one browser context drives via a
  **synthetic gamepad**, one via **touch** (Playwright touch on `#steering-area`), one via **keyboard**
  (WASD) — all join the **same room**. Drive a scripted input on each → assert the **host** receives three
  distinct, correct seat payloads and three cars move independently. Proves the seat is device-agnostic
  end-to-end.
- **N gamepads → N seats (§5).** Unit/E2E: mock `navigator.getGamepads()` returning K non-null pads at
  distinct indices → assert K seats created, each polled independently; disconnect index 1 → that seat
  goes "controller away" (not gone), others unaffected; reconnect → seat reclaimed.
- **No join blocked by count + non-overlapping spawns (§6).** Unit: `generateSpawns(track, N)` for
  N ∈ {1, 16, 17, 33, 64} returns **exactly N** spawns with pairwise distance ≥ car footprint (this is
  what fails today at N=17 via the `% length` wrap). Soak/E2E: extend the 32-Playwright-controller chaos
  test (`feedback-design-pass.md:508`) so 17+ controllers all spawn without overlap and no join is
  rejected.
- **Key-region isolation (§4).** Unit: two `KeyRegionSource`s with disjoint key-sets → a key in set A
  never moves seat B's car; assert no cross-fire (reuses the `FB-keys` planned test, `:506`).
- **Single input path (§7).** Regression: assert the duplicate keyboard handler is gone (only one
  `keydown` route to controls) and arrows/WASD still drive after the refactor.
- **Non-standard gamepad fallback (§8 — manual + mock).** Mock a pad with `mapping: ""` → assert it does
  **not** crash and falls back to a stick-steer + button-throttle scheme flagged "basic controller";
  manual pass with a real off-brand/Bluetooth pad confirms no dead controls.

Project rules: `npm run build` before any browser/E2E; **no per-frame logging** (gamepad polling runs at
tick rate — log connect/disconnect once, never per poll, per CLAUDE.md).

---

## 11. Summary

- **Unifying input model:** every input device — phone touchscreen, game controller, keyboard region — is
  a **`DeviceSource`** that emits a device-neutral, **fidelity-tagged `ControlFrame`**; a data-driven
  **`ControlScheme`** (`FB-scheme`) maps that frame to the seat's wire payload. The host stays
  device-agnostic (it already is — `{steering, acceleration, braking}`, `app.py:407`), so **phone +
  gamepad + keyboard players coexist in one game** with zero server changes. The dormant, already-complete
  gamepad path in `InputManager.js` (`:135-179`) becomes the `GamepadSource`; the duplicate keyboard
  handler is deleted so there's one input path.
- **Digital / analog / pressure handling:** fidelity is **per-axis**, carried by an `analog` flag on each
  `ControlFrame` axis and resolved by a single `readAxis(axis, wantFidelity)` chokepoint. A scheme
  *declares* the fidelity it wants and *adapts* to what the device offers — analog stick/trigger and
  pressure-sensitive buttons (`gamepad.buttons[i].value`, a float 0..1) are used where present, and the
  **exact same code degrades to digital 0/1** where the hardware doesn't report pressure, because a
  non-analog button's `value` is already guaranteed to be {0,1}. A digital A-B scheme can also override
  *downward* (snap a stick to {−1,0,1}) for players who want simple two-button driving even on a gamepad.
- **No caps, honestly:** multiple gamepads enumerate via `navigator.getGamepads()` (one seat per array
  index, §5); multiple keyboards via disjoint key-region sources (§4); spawn generation becomes a
  guaranteed-length, non-overlapping `generateSpawns(track, N)` that replaces the silent
  `playerIndex % spawnPositions.length` wrap (`Track.js:153`) and the constant 16-spawn grid
  (`ProceduralTrackGenerator.js:170`) — so N seats really get N distinct spawns. We surface the real
  *physical* limits (keyboard ghosting ~4 players; USB-hub/Bluetooth bandwidth) without ever imposing a
  software cap.
- **Biggest gotcha:** **gamepad mapping isn't guaranteed `"standard"` and analog-pressure reporting is the
  least portable corner of the Gamepad API** — the very pressure-sensitivity asked for is the most
  device/OS/browser-dependent signal. The per-axis `analog` flag + capability probe make a pad that lies
  about analog degrade cleanly to A-B instead of producing a dead control, but this is the one area that
  needs a **real-hardware test pass**, not just synthetic mocks.
```
