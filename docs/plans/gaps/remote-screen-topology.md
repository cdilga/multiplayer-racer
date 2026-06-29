# Gap: Two-Devices-One-Seat (Remote-Screen Duplication Topology)

> **Status:** gap-design v1 · fills To-Do **item 2** and the §10 / §14 #10 placeholder in
> `feedback-design-pass.md`, and extends `game-modes-and-flows.md` (§3 roles, §4.2 Remote, §4.4
> tokens, §5.3 `ViewerGameHost`, §6 host authority, §6.5 input auth).
>
> **Scope of this doc:** the *undesigned* case where **one player uses two physical devices** — a
> laptop/tablet rendering the synced host view **and** a phone driving — both bound to **one player
> seat**. The base plan designs Local (phones = controllers, host renders) and Remote (each
> participant renders + drives) but assumes **one device per participant**. This is the bridge.
>
> **Method (house style):** *Problem (grounded)* → *Options* → *Recommendation* → *beads* → *Tests*,
> with `file:line` anchors and human-decision flags. Implementation beads **extend** the existing
> game-modes `.2/.3/.4/.11` and `feedback-design-pass` `FB-invite`/`FB-rejoin` — they do **not**
> duplicate them.

> **Owner decisions locked 2026-06-29:** two-devices-one-seat is a **universal seat capability** for
> Local and Remote, not a Remote-only mode. Same-device rejoin must recover the same player identity;
> rejoining to the same world location is desirable but best-effort. Cross-device identity recovery is
> best-effort only because there are no accounts in the current phase.

---

## 1. Problem (grounded)

Item 2's verbatim ask: an invite lets the recipient choose **"controller only (I CAN see the host's
big screen)"** *or* **"duplicate the screen because I CAN'T see it (remote mode, synced to host) —
**AND** their phone still controls."** `feedback-design-pass.md` §10 folds the *chooser* into the
existing plan but explicitly defers the **two-devices-one-seat** topology to §14 #10 as "New topology
beyond the game-modes plan's one-device assumption — confirm before `FB-invite`."

**Why the base plan doesn't already cover it.** The server keys players by socket:
`room['players'][request.sid]` (`server/app.py:527`), one sid per seat. A seat's `player_id` is a
monotonic counter (`app.py:518`) and input is matched by a client-supplied `player_id` in the
`player_control_update` payload (`app.py:391`). The render path (`ViewerGameHost`, game-modes §5.3)
and the input path (`player.js` → `player_control_update`, `player.js:1554-1617`) are both assumed to
live **in the same browser** — game-modes §3's "Host-as-player" / "Driver-Viewer" combos all bundle
*render* and *drive* into one device. Nothing today lets a **separate screen** and a **separate
phone** resolve to the **same seat**.

**The missing primitive:** a seat that can have **two device bindings by role** — one *controller*
(input) and one *viewer* (render) — on **different devices**, reconciled to one durable token
(game-modes §4.4) and one `player_id`.

**The hidden coupling:** rendering a remote screen requires the host to **broadcast full transforms**
(game-modes §5.2) and the room to carry a **shared seed** (game-modes §5.1). In pure **Local** mode
neither happens (`_buildVehicleStates`, `GameHost.js:~1354`, emits HUD-only). So even **one**
remote-screen participant in an otherwise-Local couch game flips on the Remote rendering machinery for
that room. That cross-mode implication is the single biggest design decision here (§7, decision **D1**).

---

## 2. The model: a seat is one identity with up-to-two device bindings

This generalizes game-modes §3's roles from *"one participant = one device"* to *"one **seat** =
one-or-two **device bindings**, tagged by role."* Nothing about the existing role vocabulary changes;
we just stop assuming the Driver and the Viewer live in the same browser.

```
                         ┌──────────────────────── SEAT ────────────────────────┐
                         │  player_id: 7  (monotonic, app.py:518)                │
                         │  seat_token : durable, localStorage (game-modes §4.4) │
                         │  appearance : { color, number:7, name:"SpicyKoala" }  │
                         │  bindings:                                            │
   PHONE  ──input──────▶ │    controller  = sid_A   (exactly one; sends input)   │
   (controller binding)  │    viewers[]   = [sid_B] (zero-or-many; render only)  │ ◀──transforms── HOST
   LAPTOP ◀──render───── │                                                       │     (game-modes §5.2)
   (viewer binding)      └───────────────────────────────────────────────────────┘
```

The same structure expresses **every** mode with no special cases — that's the test that it's the
right abstraction:

| Configuration | `controller` binding | `viewers[]` binding |
|---|---|---|
| **Local** seat (today) | phone sid | *(none — host renders the shared screen)* |
| **Remote** single-device seat (game-modes §4.2) | the one device's sid | the **same** sid (renders + drives) |
| **Two-devices-one-seat** (this doc) | phone sid | laptop/tablet sid (**different device**) |
| Pure **spectator** (game-modes §3) | *(none)* | one sid (render only, no seat car) |

**Authority rule (kills split-brain before it starts):** the **controller binding is the sole writer**
of seat state — input *and* identity (name/color/number/scheme). A **viewer binding is strictly
read-only**: it renders broadcast transforms and displays identity it is *told*. There is no path by
which a viewer mutates the seat, so the phone and screen **cannot disagree** about anything
load-bearing (see §5).

---

## 3. The join-time chooser UX

The invite link (`/join/<CODE>`, game-modes §4.3) currently lands straight in the name+join flow.
The key refinement: **disambiguate by *entry method*, not by asking everyone.** Most joins already
carry an unambiguous signal about whether the joiner can see the host screen — so only the genuinely
ambiguous case ever sees a chooser.

### 3.1 Entry method *is* the disambiguator (the core rule)

- **QR scan → ALWAYS controller-only. No chooser.** Scanning the host's on-screen QR means you are
  *physically at the host screen* and can see it — that's the only way to scan it. So a QR-scan join
  commits **straight to a controller-only seat** (today's join; game-modes §4.2b input) and **never
  shows the "screen or controller?" question.** This is the common couch case and stays zero-friction.
- **Link click (phone OR computer) → AMBIGUOUS → show the chooser.** A shared invite link (pasted in
  chat) could be opened by someone *local* who can see the screen (wants controller-only) **or**
  someone *remote* who can't (wants a synced screen-mirror + their phone still controls). The link
  carries no location signal, so this is the **only** path that asks: *"Can you see the host's
  screen?"*

**Requirement: the QR URL and the invite-link URL must be distinguishable** so the client knows which
path to take. The QR encodes a flagged URL — `/join/<CODE>?via=qr` (recommended; one query flag,
server-ignorable, the room's real mode stays server-authoritative per game-modes §4.3) — while the
copy/share invite link stays plain `/join/<CODE>`. The client branches on `via=qr`: present →
controller-only commit (skip chooser); absent → chooser. (Decision **D5** in §7 picks query-flag vs
a separate path.)

### 3.2 Chooser copy — link-click path only (on-brand, neon/glass, never a dead end)

> **"You're joining <Host Name>'s game."**
> **Can you see the host's big screen?**
>
> - **✅ Yes — just be my controller.** *"Your phone drives. Watch the action on the big screen."*
>   → **controller-only** path (today's join; game-modes §4.2b input).
> - **🚫 No — open a screen here too.** *"This device shows the game (synced to the host) and your
>   phone steers. You'll pair them in one tap."* → **remote-screen + paired-controller** path.
> - *(tertiary)* **👀 Just watching.** → pure spectator (game-modes §3; gated by decision D4 there).
>
> **First-timer explainer (the in-game "what does this mean?" affordance).** A `?` / "What's the
> difference?" link under the chooser opens a one-screen explainer (reuses the game-modes §4.0
> Local-vs-Remote explainer pattern + `feedback-design-pass` §9 onboarding surfaces):
> *"**Controller** = your phone is a gamepad; the action shows on the **host's** screen — pick this if
> you're in the same room. **Screen here** = this device becomes a live mirror of the game (synced to
> the host) and your phone still steers — pick this if you're **somewhere else** and can't see the
> host's screen."* This is the only place a first-timer meets "screen mirror" vs "controller", so it
> must teach, not just label.

### 3.3 Device-aware defaulting on the chooser (so it's ~1 tap, principle: walk-up-and-play)

Within the link-click chooser, the **opening device** sets the default highlight (viewport / pointer /
touch heuristics already used for input auto-detect, game-modes §4.2b):

- **Link opened on a phone** (small viewport, touch): default-highlight **"Yes — controller only"**
  (likely a friend in the room). The "No" option then means *"this phone is also my screen"* →
  single-device Remote (game-modes §4.2, already designed) — **not** a second device.
- **Link opened on a laptop/desktop** (large viewport, no touch): default-highlight **"No — open a
  screen here."** A laptop can't be a good controller; the natural pairing is *this screen + my
  phone*. This is the headline two-devices case.

So the chooser surfaces the two-device path **without a separate "do you have two devices?"
question** — entry method gates *whether* the chooser appears at all, and (on the link path) the
opening device plus the chosen answer determine the topology.

### 3.4 What each entry resolves to

| Entry | Chooser? | Resolves to | Second device? |
|---|---|---|---|
| **QR scan** (`?via=qr`) | **no** | **controller-only** seat (joystick/pedals/fire, or keyboard legend) → `controller` binding | no |
| **Link click**, answer **Yes** | yes | controller-only seat → `controller` binding | no |
| **Link click** on a **phone**, answer **No** | yes | `ViewerGameHost` + controller UI in **one** browser (game-modes §4.2 single-device Remote) | no |
| **Link click** on a **laptop**, answer **No** | yes | **`ViewerGameHost`** + a **"Pair your phone" QR/code** → `viewer` binding, awaiting a controller | yes (phone pairs in, §4) |

---

## 4. Two-device pairing: binding a phone and a screen to one seat

Two **separate** devices cannot share a `localStorage` `seat_token` (game-modes §4.4) — that's the
whole difficulty. The bridge is a **short-lived, single-use `pair_code`** the server issues to the
first device and the second device redeems. The `pair_code` is the *only* new cross-device primitive.

### 4.1 Handshake (screen-first — the laptop case, the headline)

```
LAPTOP                          SERVER                            PHONE
  │  join_game{code, role:viewer}  │                                │
  │ ───────────────────────────▶   │ create seat (player_id=7,      │
  │                                │  seat_token=T7), bind viewer,  │
  │                                │  mint pair_code=ABC123 (TTL 5m,│
  │  game_joined{player_id:7,      │  single-use)                   │
  │   seat_token:T7, pair_code,    │                                │
  │ ◀───────────────────────────   │  appearance}                   │
  │ render ViewerGameHost          │                                │
  │ + show QR → /pair/ABC123       │       scan QR / type ABC123    │
  │                                │   ◀─── pair_seat{pair_code:ABC123, role:controller}
  │                                │  resolve→seat 7; bind          │
  │                                │  controller=phone sid;         │
  │                                │  invalidate pair_code;         │
  │                                │  hand phone seat_token=T7      │
  │   seat_paired{role:controller}│  paired{player_id:7, seat_token,│
  │ ◀───────────────────────────  │ ───────────────────────────▶   │ appearance}
  │ "Controller paired ✓"          │                                │ "You are 7 · green · SpicyKoala"
```

### 4.2 Handshake (phone-first — symmetric)

The phone joins as `controller`, gets `seat_token` + `pair_code`, and shows *"Pair a screen"* (QR to
`/pair/<code>`). A laptop opening that pair URL binds as `viewer`. Identical mechanics, roles swapped.
This covers a player who started as a normal controller and *then* wants a bigger screen.

### 4.3 What each device persists & shows after pairing

- **Both devices store `seat_token` in `localStorage`** (server hands it to the second device during
  pair). This makes **either** device's reconnect a one-tap reclaim of seat 7 (game-modes §4.4;
  `feedback-design-pass` `FB-rejoin` F2a) by presenting `{seat_token, room_code, role}`.
- **Controller (phone)** shows the **identity card** ("you are **7**, green, *SpicyKoala*" — the
  phone-mirror already specced in `feedback-design-pass` §5.4 / `FB-carid`), the **control scheme**
  (`FB-scheme`), and a **link-health row**: *own connection* + *paired screen ✓/reconnecting*.
- **Viewer (laptop)** shows the full **`ViewerGameHost`** render — arena from seed, all cars, camera
  **following seat 7's car**, the **"YOU" chevron** (`FB-carid`), HUD — plus a small **controller-link
  badge** (*"phone paired ✓"* / *"reconnect your phone"*), and the pairing QR **only until** a
  controller binds (reuses the `FB-qr` visibility state machine, §9 of feedback-design-pass).

### 4.4 New server surface

- `pair_code` registry on the room: `{ pair_code → {player_id, expires_at, used} }`, TTL ~5 min,
  single-use, invalidated on first redeem (game-modes §6.6 reaper also sweeps expired codes).
- New event **`pair_seat{pair_code, role}`** (and HTTP route `/pair/<code>` that deep-links into the
  redeem flow, mirroring `/join/<CODE>`). **Note the two QR codes are distinct:** the **host's join
  QR** carries `?via=qr` and yields a *new controller-only seat* (§3.1); the **viewer's pair QR**
  points at `/pair/<code>` and *attaches a controller to an existing seat*. They must look/label
  differently ("Scan to **join**" vs "Scan to **pair your phone**") so a user never confuses them.
- `room['players']` evolves from `{sid: player}` to a **seat registry** keyed by `player_id`, each seat
  holding `{seat_token, appearance, controller_sid, viewer_sids:set}`; a `sid → (player_id, role)`
  reverse index replaces the 1:1 `request.sid` assumption (`app.py:527`). This is the concrete shape
  of game-modes §4.4's "token maps to a stable seat/`player_id`."

---

## 5. State sync & server routing (both devices → one seat)

The beauty of the read-only-viewer rule (§2): **no new sync protocol is required.** The two device
bindings ride the **two flows that already exist** in the Remote design.

| Flow | Source | Server routing | Consumer |
|---|---|---|---|
| **Input** | phone `controller` sid → `player_control_update` (`player.js:1554`, `app.py:391`) | look up `sid → (player_id, role)`; **require `role == controller`** for that `player_id`; relay to host as that seat's controls | host sim applies to seat 7's car |
| **Transforms** | host `vehicle_states_update` (full transforms, game-modes §5.2) broadcast room-wide (`app.py:442`) | unchanged room broadcast | laptop `viewer` `ViewerGameHost` interpolates seat 7 (and all cars) |
| **Identity/appearance** | phone `controller` sets name/color/number | server stores on seat, fans `seat_appearance_update` room-wide | laptop renders the label; host renders the car |

**The input-authorization change is the *same* check game-modes §6.5 / `.11` already mandates**, just
generalized: today the fix is *"verify the sender's socket owns the claimed `player_id`."* Here
"owns" = *"is the `controller` binding of that seat."* A `viewer` sid sending input is rejected +
logged (it never should). So this topology **strengthens** `.11` rather than fighting it — there is
exactly one input-authorized sid per seat, by construction.

**Transform-broadcast gate (the cross-mode hinge, decision D1).** A viewer can only render if the host
is broadcasting transforms + seed. Recommendation: **gate the broadcast on "the room has ≥1 active
viewer binding that is not the host,"** rather than on `mode_kind == 'remote'`. Effect:

- Pure Local couch game, nobody paired a screen → **zero** added cost (today's HUD-only
  `_buildVehicleStates`, `GameHost.js:~1354`).
- The moment a remote friend pairs a screen into *any* room (Local or Remote), the host flips on full
  transforms + ensures a shared seed (game-modes §5.1) and fans out. The friend's `ViewerGameHost`
  renders; in-room couch players are unaffected.

This makes "remote screen" **orthogonal to room mode** — a *capability of a seat*, not a property of
the room — and answers item 2 for **both** Local and Remote rooms with one mechanism. (Flagged D1
because it softens game-modes §3's "mode fixed at creation" into "host-renders + optional viewer
fanout"; needs a human call.)

---

## 6. Failure & edge cases

The asymmetry of the two bindings (controller = authority, viewer = disposable mirror) makes most of
these fall out cleanly.

| Event | Behavior | Reuses |
|---|---|---|
| **Phone (controller) drops** | Seat = "driver away": car renders **semi-transparent / ghosted** on host + all viewers; the *paired laptop* shows *"Reconnect your phone to keep driving"* with the seat still rendering. One-tap reclaim via `seat_token`. Grace window then reap. | game-modes §4.4/§6; `FB-rejoin` F2a/F2b |
| **Laptop (viewer) drops** | **Gameplay unaffected** — phone keeps driving "blind." Phone shows *"Your screen disconnected."* Viewer is a **stateless mirror**: on reconnect it re-attaches (`seat_token`, role=viewer), re-requests `{seed, mode, appearance}` (game-modes §5.1 late-join payload) and resumes from the live broadcast. No seat state lost. | game-modes §5.1 late-join; `ViewerGameHost` |
| **Both drop** | Standard seat-away → grace → reap (game-modes §6.6). Either device returning first restores the seat. | game-modes §4.4/§6.6 |
| **Phone & screen "disagree"** | **Cannot happen on load-bearing state** — viewer is read-only (§2). Only *transient render lag* differs; cured by interpolation/snap-on-desync (game-modes §5.4). Identity is single-writer (phone). | §2 authority rule |
| **Second controller tries to bind** | Reject with takeover prompt: *"This seat already has a controller. [Take over] · [Cancel]"*; Take over = reassign `controller_sid`, evict old (handles phone-swap / phone-died-grab-another). | `.11` ownership check |
| **Stale / reused / expired `pair_code`** | Single-use + TTL → *"That pairing code expired. [Show a new code]"* on the viewer; never a dead end (game-modes §4.3 failure-state copy). | game-modes §4.3 |
| **Host drops (Remote)** | Both devices of the seat see the **host-loss paused** state (game-modes §4.4); viewer shows "Host disconnected — waiting…", phone shows the same. Resume/clean-results per grace window (game-modes §6). | game-modes §6 |
| **Identity across both** | Always consistent: phone is the tactile anchor (`FB-carid` mirror), laptop shows the same number/color/name + "YOU" chevron on the car. Server is the one source (`seat_appearance_update`). | `FB-carid` |

---

## 7. Resolved owner decisions

- **D1 — Transform broadcast gate (§5, the big one):** **gate viewer fanout on ">=1 non-host viewer
  binding present."** This makes remote-screen work in **Local** rooms too and confirms the feature as
  a universal seat capability, not a Remote-only branch. Pure Local remains cheap until a viewer binds.
- **D2 — Durable token ownership:** **both devices persist `seat_token`, but the controller device is
  the identity authority and canonical same-device rejoin anchor.** The viewer token only re-attaches a
  screen. Same-device rejoin must recover the same player identity/seat; same-location recovery is
  best-effort.
- **D3 — Pair-code entry method:** **support QR and typed code**, reusing the room-code input component.
- **D4 — Takeover policy default:** **auto-prompt takeover** for a second controller, with opaque
  room-scoped tokens and `.11` ownership checks guarding abuse.
- **D5 — QR-vs-link disambiguation marker:** **use query flag `?via=qr`** on the host join QR. QR-scan
  joins skip the chooser; plain invite links show it. The host join QR and pair QR remain visually and
  semantically distinct.

---

## 8. Bead breakdown (extends existing beads — does not duplicate)

These are **sub-beads / scope additions** to beads that already exist. The new cross-device work is
small because it rides existing flows; the table is explicit about *what it adds* to each parent.

| Bead | Parent (existing) | What this topology ADDS |
|---|---|---|
| **FB-invite** (already lists "+ phone-paired-to-remote-screen topology") | game-modes `.4`, `feedback-design-pass` §10 | **Entry-method disambiguation (§3.1):** flag the host join QR (`?via=qr`, decision D5) so QR-scan **skips** the chooser (→ controller-only) while link-click **shows** it; the **§3.2 chooser** ("Can you see the host's screen?") + **first-timer explainer** + device-aware defaulting; routes to controller-only vs remote-screen+pair paths. |
| **FB-pair** *(new)* | game-modes `.4` (invites) | `pair_code` registry + TTL/single-use; `pair_seat{pair_code, role}` event + `/pair/<code>` route; the §4 handshake (screen-first **and** phone-first); hands `seat_token` to the second device; the **pair QR is visually distinct** from the host join QR (§4.4). |
| **FB-seat** *(new)* | game-modes `.1` (roles) + `.3` (durable token) | Refactor `room['players']` from `{sid:player}` to a **seat registry keyed by `player_id`** with `{controller_sid, viewer_sids[]}` + `sid→(player_id,role)` reverse index (`app.py:527`). This is the concrete shape of game-modes §4.4's token↔seat reconciliation, extended to **N sids per seat**. |
| **FB-viewergate** *(new)* | game-modes `.2` (Remote transforms) | Gate `_buildVehicleStates` full-transform broadcast on *"≥1 non-host viewer binding"* (decision D1); ensure shared seed exists (game-modes §5.1) when first viewer binds — so a Local room can host a remote screen. |
| **FB-invite** input-auth slice | game-modes `.11` (security) | Generalize the anti-spoof ownership check to *"sender sid is the seat's `controller` binding"*; reject `viewer`-sid input (`app.py:391`). |
| **FB-rejoin** | game-modes `.3`, `feedback-design-pass` §10 | Add the **two-binding failure matrix** (§6): controller-drop = ghost car + reconnect; viewer-drop = silent re-attach; second-controller takeover prompt; per-device link-health UI; strict same-device identity recovery, same-location recovery best-effort. |
| **FB-carid** slice | `feedback-design-pass` §5.4 | Identity must render **consistently across the paired pair**: phone identity card + laptop "YOU" chevron driven by one `seat_appearance_update`. |

**Sequence:** `FB-seat` (the registry refactor) is the keystone — it unblocks `FB-pair`, the
`FB-viewergate` gate, and the `.11` ownership check. Order: **`FB-seat` → `FB-pair` → (chooser in
`FB-invite` ∥ `FB-viewergate`) → `FB-rejoin` failure matrix**. All land in **Wave 4** of
feedback-design-pass §13 ("flow/product", alongside `FB-invite`/`FB-rejoin` + the game-modes plan), and
all **depend on game-modes `.2` (Remote/ViewerGameHost) being real** — there is no remote screen
without transform broadcast + `ViewerGameHost`.

---

## 9. Tests

Built on game-modes §10's Remote E2E (two browser contexts) and feedback-design-pass §12, adding a
**third context** so one seat spans two clients.

- **Entry-method gating (the core refinement):** opening **`/join/<CODE>?via=qr`** (the host QR path)
  → **no chooser**, commits straight to a controller-only seat. Opening plain **`/join/<CODE>`** (the
  link path) → **the chooser is shown** ("Can you see the host's screen?"). Assert the chooser is
  present/absent accordingly on both a phone-sized and a desktop-sized context, and that the
  "What's the difference?" explainer opens.
- **Pairing E2E (screen-first):** ctx-A (laptop) opens plain `/join/<CODE>` → chooses "No, open a
  screen" → asserts `ViewerGameHost` renders + a `pair_code` QR shows. ctx-B (phone) redeems
  `/pair/<code>` → assert **both** contexts report `player_id == 7`; phone shows the controller UI;
  laptop hides the QR and shows "controller paired".
- **Pairing E2E (phone-first):** symmetric — phone joins as controller, laptop redeems the code, same
  seat.
- **One-seat routing:** drive a scripted input on the **phone** → assert the **host** receives controls
  for `player_id 7` **and** the **laptop**'s `ViewerGameHost` moves car 7. Assert the laptop sending a
  spoofed `player_control_update` is **rejected + logged** (`.11`).
- **Viewer-on-demand broadcast (D1):** a pure-Local room emitting **HUD-only** transforms; pair a
  remote screen in → assert the host now broadcasts **full transforms** and the screen renders all
  cars; unpair → broadcast may revert (cost gate).
- **Failure matrix (§6):** (a) kill the phone → car goes transparent on host + laptop within the grace
  window; reconnect phone via `seat_token` in **one tap** → control + solidity restored. (b) kill the
  laptop → phone keeps driving; reconnect laptop → re-attaches and resumes rendering from the live
  broadcast with no seat-state loss. (c) second phone attempts to bind → takeover prompt; accept →
  old phone evicted, seat intact.
- **Pair-code hygiene:** expired/reused `pair_code` → styled "expired, show a new code" with a working
  CTA (never a dead end, game-modes §4.3); `pair_code` is single-use.
- **Identity consistency:** phone identity card number/color/name == laptop label == host car color for
  the same seat, after an `seat_appearance_update`.
- **Local regression (unchanged):** `full-game.spec.ts` with **no** viewer binding present → host stays
  HUD-only, zero added broadcast (proves the D1 gate is off by default). Project rules: `npm run build`
  before browser/E2E; **no per-frame logging**.

---

## 10. Summary

- **Pairing model:** a **seat** (one `player_id` + one durable `seat_token`, game-modes §4.4) carries
  **up to two device bindings by role** — exactly one read/write **controller** (phone: input +
  identity) and zero-or-more read-only **viewers** (laptop: `ViewerGameHost` render). Two separate
  devices bind to the same seat via a **short-lived single-use `pair_code`** (the one new primitive,
  since the two devices can't share `localStorage`); both then persist `seat_token` for one-tap
  reconnect. No new sync protocol — input rides the existing `player_control_update` flow, render rides
  the existing transform broadcast. The read-only-viewer rule makes phone/screen disagreement
  structurally impossible.
- **Chooser UX (disambiguate by entry method, not by asking everyone):** a **QR scan** means you're at
  the host screen → **always controller-only, no chooser** (zero-friction couch case; QR URL flagged
  `?via=qr`). A **shared link click** is ambiguous → it's the **only** path that shows the chooser
  *"Can you see the host's big screen?"* — **Yes → controller-only**, **No → open a synced screen here
  + pair your phone** — with a first-timer "what's the difference?" explainer and device-aware
  defaulting (phone → controller, laptop → screen).
- **Single biggest risk / decision (D1):** rendering a remote screen forces the host to broadcast full
  transforms + a shared seed (game-modes §5.1/§5.2), which **pure Local mode does not do today**.
  Gating that broadcast on *"a viewer binding exists"* (recommended) makes the feature work in **both**
  Local and Remote rooms but **softens game-modes §3's "mode is fixed at creation" invariant** into
  "host renders + optional viewer fanout" — a real architectural call that must be made before
  `FB-seat`/`FB-pair` are built.
