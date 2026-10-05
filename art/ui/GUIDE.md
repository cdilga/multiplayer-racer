# Joystick Jammers UI design guide

**Status: draft (P1-U01, 2026-10-03; design language reworked in P1-U01.3 for R102, §5a).** P1-C01
(landing and join pages) and P1-D05 (preview index)
build from this draft. Every other UI task waits for the owner's G-DESIGN verdict at P1-U04, which
freezes the accepted guide, tokens and mocks in `art/ui/accepted/<date>/`. Changes after that follow
the playtest loop (Playtest-1 plan §13.4).

Everything an agent needs to draw any UI element is data in [`tokens.json`](tokens.json), validated by
[`tokens.schema.json`](tokens.schema.json). This guide explains the decisions and names the reference
image for each element. Each decision below is **one worked proposal with a one-line why**
(owner, 2026-10-03: no menus of options on obvious things); the owner redirects at P1-U04.

| Check | Run | Evidence |
|---|---|---|
| Schema, WCAG AA for every named pair, badge contrast, adjacent seats under CVD, promised files | `node art/ui/check.mjs` (exits non-zero naming each failure) | `docs/evidence/P1-U01/check.txt` |
| CVD simulation sheet | `node art/ui/sheets/render.mjs cvd` | `cvd.png`, `cvd.json` |
| Font stress render | `node art/ui/sheets/render.mjs fonts` | `fonts.png`, `fonts.json` |
| Component sheet (every state, keyboard and gamepad focus, and §00 the design language) | `node art/ui/sheets/render.mjs components` | `components.png` (round 0); `docs/evidence/P1-U01.3/after/components.png` (R102) |
| Brand sheet (wordmark, icons, QR rule) | `node art/ui/sheets/render.mjs brand` | `brand.png` |
| Style frames | `node art/ui/frames/generate.mjs <name>` | `art/ui/frames/*.webp` |

## 1. References

| Reference | Path | Authority |
|---|---|---|
| **H4 round highlights** | `docs/plans/ux-study-2026-09-29/images/H4-host-round-results-v2.png` | **Most authoritative** (owner 2026-10-02): ink-and-cream comic panels, bold condensed italic headings, saffron and cobalt accents, a painted outback world behind the chrome |
| M2 controller settings | `docs/plans/ux-study-2026-09-29/images/M2-mobile-control-settings-v2.png` | The two-stick controls ("the controls are good", owner) |
| H1 landing, M1 join | `docs/plans/ux-study-2026-09-29/images/H1-host-landing-v1.png`, `M1-mobile-join-v2.png` | Where the roster goes (the ute with the bullbar). Generated brand badges, like M1's grille, are placeholders and never ship |
| H2 lobby | `docs/plans/ux-study-2026-09-29/images/H2-host-lobby-v2.png` | Lobby layout idea only; its kangaroo inside the QR breaks the QR rule (§9) |
| The Cruz Missile (Spike J) | `spikes/art-pipeline/J-cruze-lowpoly/out/evidence/ladder_L0_hero.png` | The car every in-game tile shows in Playtest 1 |
| **Superseded** | `art/style/refs/ui_lobby.png` | The drivers'-heads-out cartoony look; don't use |

Generated images are style references. Their cars, logos and decorative copy are illustrative; the
tokens and this guide are what ships.

**The reference image for each element** (`H4` = the H4 image above; sheets are in
`docs/evidence/P1-U01/`):

| Element | Reference image |
|---|---|
| Palette, paper and ink | H4 (panels and background), `cvd.png` (identity colours) |
| Display and body type, tabular numbers | H4 ("ROUND HIGHLIGHTS", "NEXT ROUND STARTS IN 42s"), `fonts.png` |
| Panels, ink outline, sticker shadow, wobble | H4's highlight and vote panels, `components.png` §02 |
| Buttons (primary, secondary, destructive) | H4's "Start next round now" / "Hide replay" / "Return everyone to lobby", `components.png` §01 |
| Number badge, colour, name, tile badge | H4's result cards (`#7 Dusty`, `#12 Pip`, `#3 Ash`), `cvd.png`, `fonts.png` |
| Status chips, toasts, confirmations, errors, progress | M2's autopilot banner and toggles, `components.png` §03–§08 |
| Focus (keyboard and gamepad) | `components.png` §09 |
| Wordmark, app icon, favicon | H4's top-left lockup, `brand.png` |
| QR and room code | H4's "Jump in · ROO7" block (minus H2's kangaroo), `brand.png` |
| Phone controller | M2, style frame `frames/phone-controller.webp` |
| TV race grid and per-tile HUD | style frame `frames/tv-race-grid.webp`, Spike J's Cruz Missile |
| Lobby | H2's layout with H4's chrome, style frame `frames/lobby-32.webp` |
| Results and intermission | H4 |

## 2. Principles

1. **The road comes first.** Chrome sits at the edges of the screen and of each tile. Nothing covers
   the road ahead or a car's identity (master §12.1 readability rule).
2. **Identity second.** Every player finds themselves by number and colour in under a second.
3. **Then the current action, the objective and immediate threats.** Standings, flavour and decoration
   come last.
4. **Comic, not childish; hand-made, not web-grid** (R102). Thick ink, cream paper, sticker badges,
   torn banners and slants that feel alive (§5a); body text, numbers and hit boxes stay dead straight.
5. **Same words, same marks everywhere.** TV, phone and announcer use one vocabulary (§11).

## 3. Colour

Two foundations: warm **paper** cream (`#FFF4DE`) and deep **ink** navy (`#15203A`). Accents are used
sparingly: **saffron** (`#FFB400`) for the primary action and emphasis, **cobalt** (`#1E5BFF`) for
selection, links, keyboard focus and big numbers on paper, **teal** as a festival accent. Red earth,
ochre and sandstone belong to the *world* (illustration and backgrounds), never to UI text. Semantic
colours: danger `#B3261E` (destructive, errors), success `#17703A`, warning `#FF7A00`, each with a pale tint
for panels and toasts.

Every text/background combination the UI uses is a **named contrast pair** in `tokens.json`;
`check.mjs` holds each to WCAG AA at its intended size (4.5:1 normal text, 3:1 large text and UI
graphics). A combination that isn't named isn't allowed. Why: contrast is checked, not eyeballed.

**Player identity colours are separate from the UI palette** and always win over livery or team trim
(experience direction §2).

## 4. Type

| Face | Use | Files |
|---|---|---|
| **Barlow Condensed** 800, 900, 900 italic | Event titles and headings (uppercase), numbers, countdowns, the room code | `fonts/barlow-condensed-*.woff2` |
| **Barlow Semi Condensed** 500, 600, 700 | Labels, buttons, names, body copy (sentence case) | `fonts/barlow-semi-condensed-*.woff2` |

Why Barlow: a condensed, DIN-like grotesque reads as motorsport broadcast (H4's headings) and stays
legible at 3 m; one superfamily keeps metrics consistent between display and body; both are OFL with
tabular figures. The WOFF2 files are subset by `fonts/subset.py` (Latin, Latin Extended, Vietnamese,
punctuation; every OpenType feature kept) and licensed in `fonts/OFL.txt`. Other scripts fall back to
the device's system font through the named stack in `tokens.fonts.fallback` (system-ui, Segoe UI, Noto
Sans and its CJK, Arabic and Devanagari cuts); never a remote font service (R70).

- **Numbers** (scores, positions, lap counts, timers, countdowns, seat numbers) always use
  `font-variant-numeric: tabular-nums` so they don't jitter as they change.
- **Case:** display headings uppercase; labels and buttons sentence case. Units stay lower case inside an uppercase heading ("NEXT ROUND STARTS IN 42s", as H4).
- **Type scale per viewing profile** (`tokens.type.profiles`): TV at 3 m (sized in px at 1080p and
  scaled by output height; minimum 24 px, so cap height 16.8 px: Barlow's caps are 0.7 em), desk at 60 cm (minimum 12 px) and
  handheld at 30 cm (minimum 13 px). U02, U03, R07 and C02 measure their mocks against these minimums.

## 5. Space, layout, ink and wobble

- **Space** steps of 4 px (`tokens.space.steps`), doubled on the TV profile.
- **Minimum touch target 48 px** with an 8 px gap (`tokens.layout`). The controller's sticks are far
  bigger: each stick region spans at least 45 % of the long side (C02 tunes).
- **TV-safe margins:** text and the QR stay inside title-safe (5 % of each dimension); other chrome
  inside action-safe (3.5 %). Game tiles may bleed to the screen edge.
- **Ink outline:** 4 px at TV scale (1080p), 3 px desk, 2.5 px handheld. **Sticker shadow:** a hard
  5 px ink offset straight down (scaled with the outline per profile), never blurred; on ink
  surfaces the shadow is black at 55 %.
- **Panel wobble** (master §12.1): panel and badge *outlines* follow a seeded, slightly irregular
  path, 2.5 px amplitude at TV scale and 5–9 segments per edge. The seed is the element's stable id, so
  a panel looks the same everywhere and never animates. Text baselines, content boxes, hit boxes and
  focus rings stay straight rectangles. `sheets/tokens-css.js` has a reference `wobblePath()`.

## 5a. Design language (R102, owner POC round 1)

The owner found round 0 sterile: a web grid with the same rounded corner on everything. The language now
comes from the four reference screens in `refs/owner-2026-10-03/` (pause menu, intermission highlights,
phone vote, phone join). **We take their language, never their content:** not their copy, slogans or
painted signs, vote cards or voting flow, car art or liveries (ours are code-built, R81), mode, track or
course names, or logo lockup. Every primitive is data in `tokens.language`. Section 00 of the component
sheet draws each one and a free screen built only from them.

| Owner's point | What we do | Token |
|---|---|---|
| 1. Non-web feel, not strictly grid-aligned | On free screens (join, lobby, pause, intermission, results) panels anchor to the art, not a column grid. They tilt up to ±1.5° (seeded per element, like the wobble), step off alignment by 8–24 px (TV 16–48) and may overlap a neighbour. Lists, tables, forms, the race grid and anything a gamepad walks in order stay aligned | `slant.panelTiltMaxDeg`, `placement` |
| 2. Big images and renders | The hero render (the player's car, a highlight) takes at least 30% of a free screen. It's a cut-out with an ink outline and sticker shadow and may break a panel's edge, never over text. Until the renderer makes its own, the sheets use Spike J's L0 hero cut out by `renders/make.py` | `renders` |
| 3. A contrasting banner behind heading type | **Heading banner:** torn ink, paper display type, one saffron accent word, rotated −2°; it may overhang the panel it heads. Section labels are **tags:** saffron, warning-orange or teal brush swatches, skewed −10° and tilted −3° | `banner.heading`, `banner.tag` |
| 4. Still very compact | Panels pad 16 px (TV 32), rows sit 8 px apart, and section gaps are a step tighter than round 0 | `density` |
| 5. Slants and high contrast that feel alive | Banners rotate, tags and strips skew, and burst ticks (cobalt, saffron on ink) frame the one action that matters on a screen, at most once. Every colour behind text passes WCAG AA, checked by `check.mjs` | `slant`, `banner.slip`, `textBacking` |
| 6. Colour behind some text | **Strips** put success, cobalt, ink or saffron behind one short line (a result, a status, a points value), never behind a paragraph. A saffron **highlighter** stroke goes under the player's own word | `banner.strip`, `banner.underline` |

**Corners (no uniform radius).** Panels are square (2 px desk, 3 px TV) or wobbled. Banners, tags and strips
are torn or brushed. Buttons and fields get a small radius (4 px desk, 6 px TV, `layout.radiusPx`).
Badges get 3 px desk, 4 px TV. Only status chips and toggle tracks are pills.

**Shapes are code, seeded and still:** `sheets/tokens-css.js` has `paintPath()` (torn banners, brushed
tags and strips), `strokePath()` (the highlighter) and `tiltFor()`. They're seeded by the element's id
like `wobblePath()`, so a banner keeps its teeth everywhere, and they never animate. The POC mocks get them,
and the corner and slant variables, from `poc/shared/tokens.js`. The game's Rust/WASM UI builds the same
shapes from the same tokens.

## 6. The identity kit (master §5.1–§5.2)

| Element | Rule | Reference |
|---|---|---|
| **Number badge** | `#` + the seat number in Barlow Condensed 900, tabular, on the seat colour, ink outline, sticker shadow; text colour from the colour's `on` value. Any number of digits (`#108`, `#999`); the badge widens, the type never shrinks below the profile minimum | H4's `#7` / `#12` / `#3` result cards |
| **Colour** | 12 identity colours in a fixed order (`tokens.identity.colors`); seat *n* takes colour (*n*−1) mod 12. Numbers are unique, so they carry identity as colours repeat; there's no cap (R66). Why 12, not master §5.1's 16: past 12 the hues stop separating under colour-vision deficiency and on a TV, and Full's patterns multiply identity later | `cvd.png` |
| **Name** | Up to 32 grapheme clusters (master §10.6). Lobby cards and results wrap to two lines and never truncate the number; the per-tile HUD shows the badge and up to 12 graphemes with an ellipsis (fewer when the tile is narrow; on the
smallest tiles the HUD drops to number, place and lap); the full name stays in the accessible label. Rendered as text nodes with `dir="auto"` | `fonts.png` |
| **Tile badge** | Top-left corner of the player's tile: number badge + short name + source icon (phone, pad, keyboard) on a small cream sticker. The tile border is the seat colour | Style frame `tv-race-grid` |
| **Identify** | About 1.5 s (`tokens.motion.named.identify-pulse`): "Cooee #7" over a transparent, high-exposure flash in the seat colour, tweened (R99; reduced motion has no flash: the label and a held border carry it, P1-U05.6), the tile border and badge pulse, a bright outline on the car in other tiles; the controller plays the same flash in the player's colour. Auto-fires on join and respawn; rate-limited | Master §5.2, R99, `poc/tv` `#identify` |

Colour-blind safety comes from the number (and later the pattern), never colour alone. The CVD sheet
shows adjacent seats separated by at least ΔE00 20 in normal vision and simulated protanopia,
deuteranopia and tritanopia (`check.mjs` enforces it), and badge text stays at least 3:1 in every view.

## 7. How the chrome frames the 3D world

- **TV in a race:** the screen is the grid of player tiles with thin ink gutters. **Every player tile has
  exactly the same area at any N** (R95): one tile size in whole pixels, in the 1.2–2.0 aspect band, as
  large as the screen allows; empty cells at the end of the last row and any margins hold the join QR,
  standings, the room code or the painted backdrop, never black and never a larger tile
  (`poc/tv/grid.js`, checked by `poc/tv/grid-check.mjs`). Each tile carries a small HUD in its corners
  only (badge and name top-left, position and lap on one line top-right, a slim boost meter along the
  bottom) on cream stickers, every pill one line high and scaled with the tile (7.5% of its height, 16–32
  px at 1080p); nothing else covers the road. Name plates over cars are only for Derby and other
  single-shared-screen modes (R100). Host controls live in a **footer band** under the grid (R96, P1-U02.3,
  after Physical Soccer's host footer): the join (room code, address, player count, a QR that hovers big and
  pauses), race readouts or a global caption, the logo, Pause, Fullscreen and the host menu, which swaps the
  band's middle for its buttons in place. Diagnostics grow the band upward. Anything needing the whole screen
  (settings, players and controllers, End round, Disband) is in the pause flow, which pauses first. Nothing but
  the countdown and the Identify flash covers a playing tile.
- **TV between races (lobby, results, intermission):** H4's layout: cream panels with ink borders over
  the painted world, a saffron highlight bar under the title, cobalt numbers, the QR panel bottom-left.
- **Phone:** an ink base with cream panels and the player's colour (§10).
- The in-world look itself (toon ramp, outlines, halftone, emissives) is U05's; the chrome is drawn to
  sit on top of it with the same ink weight.

## 8. Components and focus

The component sheet (`docs/evidence/P1-U01.3/after/components.png`, source `sheets/components.html`) shows
every component in every state: primary (saffron), secondary (paper) and destructive (danger) buttons;
panels; badges and status chips; toasts; confirmations; progress and loading; errors; disabled; text
input; and **focus for keyboard and gamepad**. Pressed buttons drop onto their sticker shadow.

- **Keyboard focus:** a cobalt ring (saffron on ink), 3 px desk / 6 px TV, offset from the element.
- **Gamepad focus:** a thicker saffron ring with an ink hairline either side (saffron alone is only
  1.6:1 on paper), a saffron chevron tab on the element's leading edge and a small lift, so the
  selection reads from the couch.
- Focus is a real state on every interactive element and is never hidden for looks (experience
  direction §3). Every control has a screen-reader label.

**Icons:** Lucide (ISC, `icons/LICENSE`), vendored as SVG in `icons/` at stroke 2.5 on a 24 grid,
coloured with `currentColor`. Only the set listed in `tokens.icons.set` ships; add icons there first.

## 9. Brand

- **One wordmark:** `brand/wordmark.svg` ("JOYSTICK" over "JAMMERS", Barlow Condensed Black Italic as
  outlines; ink and saffron with ink outlines and a sticker shadow) and `brand/wordmark-on-ink.svg` for
  dark backgrounds. Every generated image drew a different logo; this one replaces them all.
- **App icon and favicon:** `brand/app-icon.svg` with 512, 192 and 180 (Apple touch) PNGs, and
  `brand/favicon.svg`, `favicon-32.png`, `favicon.ico`.
- **The QR rule** (`brand/qr-rule.svg`, `tokens.qr`): a plain black-on-white code, error correction M,
  a quiet zone of at least 4 modules on every side, **nothing in the middle**, at least 8 px per module
  on the TV. The room code sits *beside* the code, never inside it, in the display face. Why: a logo in
  the middle (H2's kangaroo) and a missing quiet zone are the commonest reasons phone cameras fail to
  scan from a couch.

## 10. The controller in a dim room

The phone's base is **ink navy with cream panels and the player's colour** as the accent; the TV keeps
H4's cream panels. Why: a cream phone screen glares in a dark living room and pulls eyes off the TV,
while the ink base keeps the sticks visible and lets the player's colour carry identity. Labels stay
small and quiet; the two sticks dominate (M2's layout). U03 shows it on real phone sizes.

## 11. Copy voice and glossary

**Voice:** short, friendly, plain Australian English. The UI tells people what to do next; jokes belong
to the announcer and the comic impact words (tone matches P1-A00's announcer copy). Never blame the
player, never use jargon (no "peer", "ICE", "session"), never shout in body copy.

**Spelling:** Australian: colour, centre, licence (noun), tyre, organise, favourite, metre.

**Glossary: one word each.**

| Say | Means | Don't say |
|---|---|---|
| **room** | The party on this TV that people join with the code ("Room ROO7") | session, server, game |
| **lobby** | The screen where players gather and get Ready before a round (H4: "Return everyone to lobby") | waiting room, menu |
| **round** | One race (later one derby) from countdown to results | match, game, level, heat |
| **number** | A player's seat, as players see it ("You're #7", "Reconnecting as #7") | seat, slot, player ID |
| **car** | The vehicle a player drives | vehicle, kart, ride |
| **host** | The screen running the room | server, admin |
| **controller** | The phone, pad or keyboard a player drives with | remote, client, device |

**Button verbs:** Join, Ready, Start race, Identify, Sit out, Leave room, End round (everyone back to the
lobby, the party stays), Disband room (everyone disconnected; master plan's End/Disband), Retry, Enter
code, Scan QR code. Join states read "Finding room…", "No room with code…" (R112); the mocks follow
the plan and the owner decides room vs game at the design review. Sentence case, a verb first, two or three words.

**States in words:** "Reconnecting as #7…", "Autopilot is driving your car. Everyone else keeps
racing.", "Host paused: back in a moment", "Room ROO7 has ended. Ask the host for the new code."

## 12. Motion

Durations, easings and named motions with their **reduced-motion versions** are in `tokens.motion`
(sticker-in, identify-pulse, countdown-beat, reflow, results-reveal, toast, wreck-shake). Motion is
energetic broadcast: elastic sticker entrances, punchy countdown beats, quick reflow. Reduced motion
removes shake, flashes, overshoot and scale, never information, controls or timing. U05 builds the
motion reel from these values.

## 13. Starting proposals for the POC (Playtest-1 plan §3a)

| Question | Proposal | Why |
|---|---|---|
| Lobby | Every player on one screen (joining / choosing / ready) over a still view of the upcoming track, the QR sharing the layout (R110; the warm-up drive is gone) | Everyone can see who's in and who's ready at a glance |
| Grids with a gap | Balanced rows; the last row centred, its tiles wider within the aspect band; any cell still free shows the join QR and live standings | Gameplay area first (master §6.2), nothing black |
| Cameras | Third person by default, first person per seat from the controller; mocks show a mixed grid | Per-seat choice (R3) has to read side by side |
| In-world look | Master §12.1's comic treatment; if it costs too much at 24 tiles, outlines on cars and debris only | Keeps the look where players look |
| Controller in a dark room | Ink base, cream panels, the player's colour | No glare; identity stays visible |
| Lobby at 32 and beyond | Compact roster cards (badge, colour, name, Ready) reflowing into more columns down to the profile minimum, then number + name chips | Any N reads; there's never a "max players" |

## 14. Style frames

`frames/` holds the style frames made through the art pipeline (a style lock on H4 + MASTER_PROMPTS + the
UI block + H4 direction + subject + guards, `frames/prompts/*.txt`, generated by `frames/generate.mjs`
with Meta's Muse Image and H4 as the reference image): the TV in-race grid with HUD, the lobby at 32, the
phone controller with its lobby, and the derby Overview. `frames/README.md` lists the picks. Cars, badges and logos
in generated frames are placeholders; the real car is Spike J's Cruz Missile and the real brand is §9.
