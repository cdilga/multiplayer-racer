# Responsive Host-UI Sizing Plan

*2026-06-28. Addresses `feedback-design-pass.md` item #20 ("Bigger setup for big screens —
scales BAD") and the phone-as-host complaint. Scope: how the **host** UI (lobby, HUD,
overlays, results, menus) sizes itself across screens from a phone-as-host up to a 4K TV.*

---

## 1. Problem & root cause

The host renders on anything from a phone (~390 CSS px tall, landscape) to a 4K TV driven by
a laptop (up to 2160 CSS px tall at DPR 1). Reported symptoms:

- **4K TV:** UI too small — QR code unscannable from the couch, room code / HUD tiny.
- **Phone-as-host:** UI too big — elements dominate / overflow.

**Root cause:** the host UI is built almost entirely in **hardcoded `px`**, injected by each
component's `_addStyles()` method. There are **no media queries, no `clamp()`, no design
tokens, and no scaling logic** anywhere in host mode. `px` is an absolute unit, so a fixed
210px QR is 5% of a 3840px screen and 54% of a 390px one — the same code is simultaneously
"too small" and "too big."

Representative offenders (all fixed px):

| Element | Current | File |
|---|---|---|
| Lobby QR | `210px` | `LobbyUI.js` `_addStyles` (~766) |
| Room code | `40px` | `LobbyUI.js` (~700) |
| Mode card | `180px` wide | `LobbyUI.js` |
| HUD timer | `28px` | `RaceUI.js` (~158) |
| HUD speed value | `48px` | `RaceUI.js` (~244) |
| Countdown number | `200px` | `RaceUI.js` |
| In-game overlay QR | `120px` / `100px` | `RoomCodeOverlayUI.js` (~104) |
| Camera name labels | `16px` base | `RenderSystem.js` (~587) |

The pattern we want already exists in the codebase — `landing.css` uses
`clamp(2.6rem, 8vw, 5rem)`, and `design-brief.md` states the goal outright: *"Readable from
the couch. Everything must scale to 1080p AND 4K."* It just never reached the host UI.

---

## 2. Goals & non-goals

**Goals**
- One coherent system so every host surface scales with screen size, tuned to feel
  hand-made at the **known target screens** and degrade gracefully everywhere between.
- A QR code that stays scannable on a phone and is comfortably large on a 4K TV.
- A **manual UI-size control** the host can nudge (viewing distance is undetectable in the
  browser — this is the honest fallback), persisted across sessions.
- Replace scattered hardcoded `px` with central design tokens (aligns with design-brief
  principle "config over hardcoded").

**Non-goals**
- Touching the Three.js render resolution / `devicePixelRatio` (already capped at 2 in
  `RenderSystem.js:283`) — that's a separate GPU-budget concern, not UI sizing.
- The phone **controller** UI (`player.css`) — that already has orientation handling and is
  out of scope here.
- A full visual redesign — this is a sizing/scaling pass, palette and components unchanged.

---

## 3. The model

Three layers, composed:

```
effective size = userPref  ×  deviceClassScale  ×  clamp(floor, k·vmin, ceiling)
                  └ manual ┘   └ known-screen ┘    └ continuous viewport scaling ┘
                   slider       bucket tuning        (the workhorse)
```

1. **Continuous scaling (CSS, the workhorse).** Every size is a token defined as
   `clamp(floor, k·vmin, ceiling)`. We scale by **`vmin`** (the smaller viewport dimension =
   height on a landscape host) because that tracks "how much room is on screen" and won't
   blow up on ultra-wide monitors. The `floor` protects phones (keeps the QR scannable, text
   legible); the `ceiling` stops 4K going absurd; `vmin` does the work in between. **This
   alone fixes both reported symptoms with zero JS.**

2. **Device-class bucket (JS, the tuning knob for known screens).** A small controller sets a
   `--ui-scale` multiplier via `matchMedia`/resize, giving each *known* screen class a tuned
   nudge (e.g. a 4K couch screen reads a touch larger; a phone-host a touch smaller + compact
   layout). This is how we "focus on known sizes" without abandoning the continuum.

3. **Manual user preference (JS + localStorage).** A `−/+` "Screen size" control multiplies
   `--ui-scale`, persisted via the **existing** `visualSettings` localStorage pattern in
   `LobbyUI.js`. Covers the undetectable viewing-distance variable and accessibility.

`--ui-scale = deviceClassScale × userPref`, written to `document.documentElement`. Tokens are
`calc(var(--ui-scale) * clamp(...))`. We deliberately **do not** scale the root `font-size`
globally (avoids surprising knock-on effects); tokens are explicit and self-contained.

---

## 4. Target screen classes (what we tune to)

Landscape host; `vmin` = viewport height in CSS px. Note DPR: a 4K TV at DPR 1 reports
vmin≈2160 (scales big — this is the user's "too small with fixed px" case); a 4K panel driven
"looks like 1080p" reports vmin≈1080 and is treated identically to a real 1080p TV, which is
correct (it *is* a 1080 CSS canvas).

| Class | Typical CSS vmin | deviceClassScale | Notes |
|---|---|---|---|
| Phone-as-host | ≤ 480 | `0.9` + `.host-compact` | Floors dominate; stack columns, trim non-essential HUD |
| Laptop / tablet | 481–900 | `1.0` | Baseline |
| 1080p–1440p TV | 901–1500 | `1.0` | **Reference target** (1080p = canonical) |
| 4K couch (DPR 1) | > 1500 | `1.12` | Nudge up for couch distance |

Buckets set `--ui-scale`; the `clamp()` inside each token still interpolates the in-between
sizes, so unusual resolutions degrade smoothly rather than snapping.

---

## 5. Token catalog (starting values — tune in-browser)

Live in a `:root` block in `static/css/host.css` (always loaded by the host page).
Values picked so the **reference 1080p** lands near today's good sizes, 4K grows, phone
shrinks. `k·vmin` shown as the percentage of vmin.

```css
:root {
  --ui-scale: 1;                                  /* set by UiScaleController */

  /* QR */
  --qr-lobby:      calc(var(--ui-scale) * clamp(150px, 22vmin, 460px));
  --qr-overlay:    calc(var(--ui-scale) * clamp(96px,  11vmin, 220px));

  /* Codes & headings */
  --fs-room-code:  calc(var(--ui-scale) * clamp(28px, 5.5vmin, 110px));
  --fs-countdown:  calc(var(--ui-scale) * clamp(72px, 18vmin,  360px));

  /* HUD */
  --fs-hud-timer:  calc(var(--ui-scale) * clamp(16px, 2.8vmin, 60px));
  --fs-hud-lap:    calc(var(--ui-scale) * clamp(15px, 2.4vmin, 52px));
  --fs-hud-speed:  calc(var(--ui-scale) * clamp(22px, 4.6vmin, 96px));
  --fs-health:     calc(var(--ui-scale) * clamp(11px, 1.4vmin, 26px));
  --fs-namelabel:  calc(var(--ui-scale) * clamp(12px, 1.6vmin, 30px)); /* RenderSystem base */

  /* Layout */
  --w-mode-card:   calc(var(--ui-scale) * clamp(150px, 24vmin, 360px));
  --fs-button:     calc(var(--ui-scale) * clamp(15px, 1.9vmin, 36px));
  --pad-panel:     calc(var(--ui-scale) * clamp(10px, 1.6vmin, 32px));
  --gap-lg:        calc(var(--ui-scale) * clamp(12px, 2.2vmin, 48px));
}
```

Sanity check (deviceClassScale & userPref = 1):

| Token | Phone (390) | 1080p | 4K DPR1 (2160) |
|---|---|---|---|
| `--qr-lobby` | 150px (floor) | 238px | 460px (ceil) |
| `--fs-room-code` | 28px (floor) | 59px | 110px (ceil) |
| `--fs-hud-timer` | 16px (floor) | 30px | 60px (ceil) |
| `--fs-countdown` | 72px (floor) | 194px | 360px (ceil) |

userPref then scales all of these uniformly (range `0.7–1.4`, step `0.1`).

---

## 6. The scale controller

New module `static/js/ui/UiScaleController.js`:

- On init and on `resize` (debounced), read `min(innerWidth, innerHeight)`, map to a
  device-class bucket → `deviceClassScale`, toggle `.host-compact` on `<body>` for the phone
  bucket.
- Read `userPref` from the existing `visualSettings` store; `--ui-scale =
  deviceClassScale × userPref`; write to `document.documentElement.style`.
- Expose `setUserScale(v)` / `getUserScale()` / `getEffectiveScale()`; persist `userPref`
  through `LobbyUI`'s existing `_saveVisualSettingsToStorage()` (extend `visualSettings` with
  a `uiScale` field — no new storage key).
- Instantiate once, early, in host bootstrap (`src/host/main.js` / `GameHost`) so tokens are
  correct before first paint.

No per-frame work; resize only. (Respects the repo's no-per-tick-logging rule.)

---

## 7. Manual control UX

- **Lobby:** a compact "Screen size `−` `100%` `+`" stepper added to the existing
  `settings-section` in `LobbyUI.js`. Wired to `UiScaleController.setUserScale`.
- **In-game:** the same stepper in `GameMenuUI.js` (pause menu) so it can be adjusted from the
  couch mid-game without leaving the round.
- Styling: pill buttons per design-brief; lives next to the existing visual-settings controls.

---

## 8. File-by-file change map

| File | Change |
|---|---|
| `static/css/host.css` | Add `:root` token block (§5) + `.host-compact` layout overrides (stack lobby columns, trim HUD). |
| `static/js/ui/UiScaleController.js` | **New.** Bucket detection, `--ui-scale`, persistence, public API (§6). |
| `static/js/ui/LobbyUI.js` | Migrate `_addStyles` px→`var(--…)`; add `uiScale` to `visualSettings`; add "Screen size" stepper to settings-section. |
| `static/js/ui/RaceUI.js` | Migrate HUD timer/lap/speed/countdown/health px→tokens. |
| `static/js/ui/RoomCodeOverlayUI.js` | Migrate overlay QR (`120/100px`) + code font→tokens. |
| `static/js/ui/ResultsUI.js`, `GameMenuUI.js` | Migrate px→tokens; add scale stepper to GameMenu. |
| `static/js/systems/RenderSystem.js` (~547–591) | Base name-label font from `--fs-namelabel` (or `--ui-scale`) so couch labels scale; keep distance-based 0.6–1.2× multiplier. |
| `src/host/main.js` / `GameHost.js` | Instantiate `UiScaleController` early. |
| `npm run build` | Required before any browser/E2E verification (Flask serves `dist/`). |

Keep reservations narrow per AGENTS.md — these are mostly independent `_addStyles` blocks, so
multiple agents can split RaceUI / LobbyUI / overlay without conflict.

---

## 9. Remote mode

Remote mode (`game-modes-and-flows.md` §3) has each participant render their own viewer on
their own device. This system handles that for free: every device runs the same token +
controller stack against its own `vmin`, and `userPref` persists per-device in that device's
localStorage. No extra branching — just confirm the controller initializes on the remote
viewer entry point too. Degrade gracefully, never gate.

---

## 10. Testing

Playwright responsive matrix (new spec, e.g. `tests/e2e/responsive-sizing.spec.ts`):

- Viewports: `390×844` (phone-host-ish landscape), `1366×768` (laptop), `1920×1080`,
  `3840×2160` (4K).
- For each: enter lobby, assert computed QR width within a target band for that class
  (e.g. 4K QR > 380px, phone QR ≥ 150px); assert room-code font within band.
- Assert **no overflow** at any size: `scrollWidth <= clientWidth` on lobby + HUD roots.
- HUD/countdown screenshots at min & max viewport for visual review.
- Unit-ish: `setUserScale` updates `--ui-scale` and round-trips through localStorage.
- Manual: real 4K TV + real phone (the two cases that prompted this) — the auto matrix can't
  judge couch legibility.

---

## 11. Suggested bead breakdown (label: `beads-polishing`)

1. **Foundation** — `host.css` `:root` tokens + `UiScaleController` + bootstrap wiring.
2. **Lobby** — migrate `LobbyUI` to tokens; add "Screen size" stepper + persistence.
3. **HUD** — migrate `RaceUI` (timer/lap/speed/countdown/health).
4. **Overlays & chrome** — `RoomCodeOverlayUI`, `ResultsUI`, `GameMenuUI` (+ its stepper),
   `RenderSystem` name labels.
5. **Tests** — Playwright responsive matrix + overflow assertions.
6. **Tuning pass** — adjust clamp coefficients on real 4K + phone; validate via the
   vehicle-model-validation-style "visual evidence" discipline (screenshots per class).

Ordering: 1 → (2,3,4 parallelizable) → 5 → 6.

---

## 12. Risks / open questions

- **Viewing distance is undetectable** — a 4K monitor at a desk and a 4K TV across a room can
  report identical CSS sizes but want different sizes. Mitigation = the manual control
  (accepted). Device-class buckets only approximate.
- **DPR variance** — 4K panels driven at "looks like 1080p" are treated as 1080p. This is
  correct behavior, but worth noting so it isn't mistaken for a bug during tuning.
- **Clamp floors vs phone-host layout** — floors keep things readable but a phone may still
  feel cramped; the `.host-compact` layout (column stacking, HUD trimming) carries the rest.
  Exact compact rules to be settled during the Lobby/HUD beads.
- **Coefficients are first-guess** — §5 values are starting points; the tuning pass (bead 6)
  is where they get locked against real hardware.

---

## 13. Validation pass (2026-06-28) — lobby implemented & image-validated

Built a first cut and validated it across four viewports by reading screenshots (Playwright,
`deviceScaleFactor 1`). Shipped: `--ui-scale` default in `host.css`; `UiScaleController.js`
(device-class bucket × persisted userPref, rAF-debounced resize); lobby hero elements
migrated; `#room-code-display` ID rule pointed at the token (it was overriding the class).

**Refinement to the model (§3/§5):** for a *self-contained panel* like the lobby, instead of
N independent per-token `clamp()`s, define **one base unit on the panel** and size internals
as multiples of it — cleaner and scales the whole panel from a single knob, no em-compounding:

```css
.lobby-content { --u: calc(var(--ui-scale, 1) * clamp(12px, 1.5vmin, 30px)); } /* ~16px @1080p */
.qr-code   { width: calc(var(--u) * 13); height: calc(var(--u) * 13); }
#room-code-display { font-size: calc(var(--u) * 2.7); }   /* --u inherits into descendants */
```

Per-token `clamp()` (§5) still applies to *independent* surfaces (HUD elements, overlay QR)
that don't share a panel. Use base-unit for panels, per-token for scattered chrome.

**Measured (QR & room code), baseline → after:**

| Viewport (vmin) | ui-scale | QR px (base→after) | QR % of vmin | room-code px |
|---|---|---|---|---|
| phone 844×390 (390) | 0.90 | 210 → **140** | 53.8% → **35.9%** | 48 → **29** |
| laptop 1366×768 (768) | 1.00 | 210 → **156** | 27.3% → 20.3% | 48 → **32** |
| 1080p (1080) *(ref)* | 1.00 | 210 → **211** | 19.4% → 19.5% | 48 → **44** |
| 4K 3840×2160 (2160) | 1.12 | 210 → **437** | 9.7% → **20.2%** | 48 → **91** |

QR now holds ~20% of vmin from laptop up (was 9.7–27%); the lobby panel fills 57.8% of a 4K
screen (was 28.6%); the 1080p reference is unchanged (QR 211≈210), confirming calibration.
Manual userPref verified at fixed 1080p: 0.7→QR 147px, 1.0→211px, 1.4→295px. No overflow at
any size.

**Still to do (follow-on beads):** manual `−/+` control UI in lobby settings + GameMenu (logic
ready in `UiScaleController`); HUD/overlay/results migration (`RaceUI`, `RoomCodeOverlayUI`,
`ResultsUI`) per the §5 per-token pattern — needs in-game capture, not just the lobby; deep
lobby sub-controls (sliders, audio, presets) left at fixed px; tiny host chrome (`Menu` /
`Fullscreen` corner buttons) are outside the lobby panel and still fixed — visibly small on
4K; formalize the throwaway screenshot spec into `tests/e2e/responsive-sizing.spec.ts`.
