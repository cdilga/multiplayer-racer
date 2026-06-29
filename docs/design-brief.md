> ⚠️ **SUPERSEDED 2026-06-29.** The neon-arcade / Tron direction described below is **no longer
> the aesthetic source of truth.** The project pivoted (ratified, gate G1) to a **lo-fi retro /
> PS1 "Skip Bin Arcade"** language — see [`docs/design/`](design/README.md). The neon palette
> survives only as *diegetic emissive signage*, the reserved player/danger "loud" colors, and a
> single landing hero accent — not as the whole canvas. Keep this file for the captured CSS token
> snapshot and history; do not treat its direction as current.

# Joystick Jammers — Design Brief

*Extracted from the live game CSS (`static/css/landing.css`, `host.css`, `player.css`).
Paste this into claude.ai/design as the starting prompt, then iterate from there.*

---

## Direction & source of truth

**The front page (landing) is the canonical aesthetic.** It's the look we like and the
one to lean into. The token snapshot below was captured from `landing.css` as a
convenient starting point — but the **landing page itself is the source of truth**, not
this document. If the live landing page and this brief ever disagree, the landing page wins.

**Gameplay should be brought into alignment with the front page**, not the other way
around. The in-game host and phone-controller UIs currently share the same palette but
predate the polished landing treatment (glows, glass panels, pill buttons, neon gradient
sweeps, the drifting grid). The standing intent is: **every in-game surface — lobby,
HUD, menus, results, controller — should feel like it belongs to the same world as the
front page.** When designing or reviewing any gameplay UI, the test is "would this sit
comfortably next to the landing page?"

This is a *living direction*, deliberately phrased about consistency rather than the
current state: as the front page evolves, gameplay follows it.

---

## The vibe

A **neon arcade / Tron** aesthetic on a dark navy canvas. Think late-night couch
multiplayer: glowing cyan and electric-green accents, hot-pink danger highlights,
soft outer glows on interactive elements, and a faint drifting grid in the
background. High energy, playful, but readable — not cluttered RGB-vomit.

Mood words: **electric, arcade, neon, late-night, punchy, frictionless.**

---

## Color tokens

```
/* Backgrounds — dark navy, layered */
--bg-deep:    #0d1429   /* deepest layer / text-on-neon */
--bg-base:    #1a1a2e   /* page background */
--bg-panel:   #16213e   /* cards, inputs, panels */

/* Neon accents */
--cyan:   #4cc9f0   /* primary accent, links, info */
--green:  #00ff88   /* success / "go" / primary CTA */
--indigo: #4361ee   /* secondary buttons, depth */
--pink:   #f72585   /* danger / brake / derby mode / focus */

/* Text */
--text:        #ffffff
--text-muted:  #8d99ae   /* slate-grey for secondary copy */

/* Surfaces & borders */
--surface:        rgba(22, 33, 62, 0.72)    /* translucent panel (glass) */
--surface-solid:  #16213e
--border:         rgba(76, 201, 240, 0.18)  /* faint cyan hairline */
--border-strong:  rgba(76, 201, 240, 0.45)

/* Status (in-game) */
error:  #e63946   /* on rgba(230,57,70,0.2) wash */
derby:  #FF4444 / #ff6644   /* combat red */
race:   #44FF88   /* race-mode green */
```

**Palette ratio:** ~70% dark navy, ~20% neutral text, ~10% saturated neon. The neon
is for accents and interaction — never large fills.

---

## Glows (the signature move)

Outer glows are what make this feel arcade. Apply to focused inputs, active
buttons, badges, and key icons:

```
--glow-cyan:  0 0 24px rgba(76, 201, 240, 0.5);
--glow-green: 0 0 24px rgba(0, 255, 136, 0.5);
--glow-pink:  0 0 24px rgba(247, 37, 133, 0.5);
```

Use `filter: drop-shadow(var(--glow-cyan))` on SVG/emoji icons, and `box-shadow`
on buttons/cards on hover/focus. Pair colored glow with matching colored border.

---

## Typography

- **Font:** system sans stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
  (No custom webfont; keep it fast.) Monospace for codes: `'SF Mono', Monaco, 'Cascadia Code', monospace`.
- **Weights:** big and bold — headings at **800–900**, buttons/labels **700**.
- **Hero title:** `clamp(2.6rem, 8vw, 5rem)`, weight 900, tight tracking (`-0.02em`).
- **Brand name gets an animated neon gradient sweep** across green→cyan→indigo→pink→green
  using `background-clip: text` + transparent fill.
- **Eyebrows / kickers / badges:** small (0.75–0.8rem), bold, UPPERCASE, wide letter-spacing
  (`0.08em`–`0.12em`), colored cyan or pink.
- Codes (room codes) are uppercase, monospace, wide letter-spacing (`0.3em`–`0.4em`).

---

## Shape & spacing

- **Spacing scale:** 8px base — `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4 / 6rem`.
- **Radii:** `--radius-md: 0.75rem`, `--radius-lg: 1.25rem`, `--radius-full: 9999px` (pills).
- **Buttons are pill-shaped** (`border-radius: 9999px`), min-height 48px (58px for `--lg`),
  generous horizontal padding.
- **Cards** use the translucent `--surface` with `backdrop-filter: blur(8–12px)` (glassmorphism),
  faint cyan hairline border, `--radius-lg`.
- Max content width `1140px`. Sticky blurred header, 64px tall.

---

## Components

- **Primary button:** gradient `linear-gradient(135deg, green, cyan)`, dark text (`--bg-deep`),
  green drop-shadow; lifts `translateY(-2px)` and intensifies glow on hover.
- **Ghost button:** transparent, cyan text, 2px `--border-strong` border; gains cyan glow on hover.
- **Inputs:** dark panel fill, 2px border, pill radius; on focus → **pink border + pink glow**,
  no default outline.
- **Badges/eyebrows:** pill, uppercase, with a small pulsing green status dot.
- **Mode cards (Race vs Derby):** Race = cyan accent + cyan glow; Derby = pink/red accent + pink glow.
  Each has a radial corner glow tinted to its accent.
- **List bullets:** small green rotated squares (diamonds) with green glow, not dots.
- **Focus ring (a11y):** `3px solid cyan`, `outline-offset: 3px`.

---

## Motion (subtle, never seizure-y)

- Background **grid slowly drifts** toward horizon (`gridDrift`, 18s linear, masked top/bottom).
- Layered **radial neon glows** fixed behind everything (indigo top-left, pink top-right, green bottom).
- Hero brand name **gradient sweep** (6s linear loop).
- Status dot **pulse** (1.8s), hero visual gentle **float** (6s), neon trail **dash** animations.
- Standard transition: `200ms ease`. Hover = lift + glow.
- **All decorative motion must respect `prefers-reduced-motion: reduce`** (kill animations).

---

## Background recipe

```css
/* fixed, behind content */
background:
  radial-gradient(ellipse 80% 60% at 12% 8%,  rgba(67,97,238,0.35),  transparent 60%),
  radial-gradient(ellipse 70% 50% at 88% 18%, rgba(247,37,133,0.28), transparent 60%),
  radial-gradient(ellipse 90% 70% at 50% 100%, rgba(0,255,136,0.18), transparent 60%),
  linear-gradient(160deg, #0d1429 0%, #1a1a2e 45%, #16213e 100%);

/* + a faint 48px cyan grid (rgba(76,201,240,0.06)) masked to fade at top/bottom */
```

---

## Do / Don't

- **Do** keep backgrounds dark and let neon accents pop sparingly.
- **Do** pair every colored glow with a matching colored border.
- **Do** use pill buttons, bold weights, uppercase micro-labels.
- **Don't** put neon as large flat fills or use more than ~3 accent colors in one view.
- **Don't** use light/white backgrounds — this system is dark-only.
- **Don't** add heavy custom fonts; stay on the fast system stack.
