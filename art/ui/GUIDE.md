# Joystick Jammers UI design guide

**Status: draft (P1-U01, 2026-10-03).** P1-C01 (landing and join pages) and P1-D05 (preview index)
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
| Component sheet (every state, keyboard and gamepad focus) | `node art/ui/sheets/render.mjs components` | `components.png` |
| Brand sheet (wordmark, icons, QR rule) | `node art/ui/sheets/render.mjs brand` | `brand.png` |
| Style frames | `art/ui/frames/generate.sh <name>` | `art/ui/frames/*.png` |

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
| Phone controller | M2, style frame `frames/phone-controller.png` |
| TV race grid and per-tile HUD | style frame `frames/tv-race-grid.png`, Spike J's Cruz Missile |
| Lobby | H2's layout with H4's chrome, style frame `frames/lobby-32.png` |
| Results and intermission | H4 |

## 2. Principles

1. **The road comes first.** Chrome sits at the edges of the screen and of each tile. Nothing covers
   the road ahead or a car's identity (master §12.1 readability rule).
2. **Identity second.** Every player finds themselves by number and colour in under a second.
3. **Then the current action, the objective and immediate threats.** Standings, flavour and decoration
   come last.
4. **Comic, not childish.** Thick ink, cream paper, sticker badges and a slight hand-inked lean; text
   baselines, numbers and hit boxes stay dead straight.
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
  scaled by output height; minimum 24 px, cap height 17 px), desk at 60 cm (minimum 12 px) and
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

## 6. The identity kit (master §5.1–§5.2)

| Element | Rule | Reference |
|---|---|---|
| **Number badge** | `#` + the seat number in Barlow Condensed 900, tabular, on the seat colour, ink outline, sticker shadow; text colour from the colour's `on` value. Any number of digits (`#108`, `#999`); the badge widens, the type never shrinks below the profile minimum | H4's `#7` / `#12` / `#3` result cards |
| **Colour** | 12 identity colours in a fixed order (`tokens.identity.colors`); seat *n* takes colour (*n*−1) mod 12. Numbers are unique, so they carry identity as colours repeat; there's no cap (R66). Why 12, not master §5.1's 16: past 12 the hues stop separating under colour-vision deficiency and on a TV, and Full's patterns multiply identity later | `cvd.png` |
| **Name** | Up to 32 grapheme clusters (master §10.6). Lobby cards and results wrap to two lines and never truncate the number; the per-tile HUD shows the badge and the first 12 graphemes with an ellipsis; the full name stays in the accessible label. Rendered as text nodes with `dir="auto"` | `fonts.png` |
| **Tile badge** | Top-left corner of the player's tile: number badge + short name + source icon (phone, pad, keyboard) on a small cream sticker. The tile border is the seat colour | Style frame `tv-race-grid` |
| **Identify** | About 1.5 s (`tokens.motion.named.identify-pulse`): tile border and badge pulse and scale, a "#7 THAT'S YOU!" burst over the car, a bright outline on the car in other tiles; the controller flashes the number and colour. Auto-fires on join and respawn; rate-limited | Master §5.2 |

Colour-blind safety comes from the number (and later the pattern), never colour alone. The CVD sheet
shows adjacent seats separated by at least ΔE00 20 in normal vision and simulated protanopia,
deuteranopia and tritanopia (`check.mjs` enforces it), and badge text stays at least 3:1 in every view.

## 7. How the chrome frames the 3D world

- **TV in a race:** the screen is the grid of player tiles with thin ink gutters. Each tile carries a
  small HUD in its corners only (badge and name top-left, position and lap top-right, a slim boost meter
  along the bottom) on cream stickers; nothing else covers the road. Host controls hide during a race
  and surface on input (U02 places them).
- **TV between races (lobby, results, intermission):** H4's layout: cream panels with ink borders over
  the painted world, a saffron highlight bar under the title, cobalt numbers, the QR panel bottom-left.
- **Phone:** an ink base with cream panels and the player's colour (§10).
- The in-world look itself (toon ramp, outlines, halftone, emissives) is U05's; the chrome is drawn to
  sit on top of it with the same ink weight.

## 8. Components and focus

The component sheet (`docs/evidence/P1-U01/components.png`, source `sheets/components.html`) shows
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
| **room** | The party on this TV that people join with the code ("Room ROO7") | lobby, session, server, game |
| **round** | One race (later one derby) from countdown to results | match, game, level, heat |
| **number** | A player's seat, as players see it ("You're #7", "Reconnecting as #7") | seat, slot, player ID |
| **car** | The vehicle a player drives | vehicle, kart, ride |
| **host** | The screen running the room | server, admin |
| **controller** | The phone, pad or keyboard a player drives with | remote, client, device |

**Button verbs:** Join, Ready, Start race, Find my car, Sit out, Leave room, End room, Retry, Enter
code, Scan QR code. Sentence case, a verb first, two or three words.

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
| Lobby | The warm-up drive behind the QR and the player strip | Players are already driving while friends join |
| Grids with a gap | Balanced rows; the last row centred, its tiles wider within the aspect band; any cell still free shows the join QR and live standings | Gameplay area first (master §6.2), nothing black |
| Cameras | Third person by default, first person per seat from the controller; mocks show a mixed grid | Per-seat choice (R3) has to read side by side |
| In-world look | Master §12.1's comic treatment; if it costs too much at 24 tiles, outlines on cars and debris only | Keeps the look where players look |
| Controller in a dark room | Ink base, cream panels, the player's colour | No glare; identity stays visible |
| Lobby at 32 and beyond | Compact roster cards (badge, colour, name, Ready) reflowing into more columns down to the profile minimum, then number + name chips | Any N reads; there's never a "max players" |

## 14. Style frames

`frames/` holds the style frames made through the art pipeline (MASTER_PROMPTS + the UI block + H4
direction + subject + guards, `frames/prompts/*.txt`, generated by `frames/generate.sh` with `codex
exec`): the TV in-race grid with HUD, the lobby at 32 and the phone controller. Cars, badges and logos
in generated frames are placeholders; the real car is Spike J's Cruz Missile and the real brand is §9.
