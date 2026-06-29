# 02 — The Joystick Jammers Design Language

> **The artefact.** This is the "definitely not default Three.js" visual language: a lo-fi
> retro / PS1-PS2 "boxy" world with a point of view, applied to *every* surface from the
> landing page to the win screen.
>
> **Altitude:** art-direction. Engine specifics are named for orientation (so the planning pass
> has a vocabulary) but binding implementation lives in [04](04-implementation-plan.md) + beads.
> **Sourcing:** `[R]` = research-backed ([00](00-research-report.md)); `[S]` = synthesis.

---

## The thesis (read this, then everything else follows)

> **A grimy little world made of cardboard boxes and dying neon, filmed on a camcorder
> someone found in a skip. The world is muted, foggy, and cheap-looking *on purpose*. The
> only things allowed to be bright are the players and the danger.**

Three ideas do all the work:

1. **Constraint is the style.** The PS1 look isn't "low quality," it's a *committed set of
   limits* held everywhere `[R, OK/NORMAL]`. We pick our limits (palette, resolution, poly
   budget, filtering) and we never break them for "just this one nice asset."
2. **The world recedes; the players pop.** Environment = desaturated, dithered, fog-eaten.
   Players + hazards = the only saturated, high-contrast things on screen. This is both an
   aesthetic and a **readability law** ([01](01-what-makes-a-good-game.md) §6).
3. **Everything is the same world.** The landing page, the join screen, the lobby, the HUD, and
   the results screen are all *inside the camcorder*. Same grain, same palette, same chunky type,
   same fog. No "web UI" that looks like a different product than the game `[R, cohesion]`.

The name for the look, for shared vocabulary: **"Skip Bin Arcade."** Late-night, cheap,
nostalgic, a little broken, very fun.

---

## Current state — what to keep, invert, kill

From the codebase map (`RenderSystem.js`, `ColorGradingShader.js`, `VehicleFactory.js`,
`TrackFactory.js`, `ParticleSystem.js`, the `static/css/*` + `frontend/*`):

| Existing | Verdict | Why |
|---|---|---|
| `MeshStandardMaterial` everywhere (PBR) | **KILL / replace** | Plasticky default-three.js tell `[R]`. Move to flat/toon/vertex-lit, matte. |
| Maximal `UnrealBloom` (strength **1.5**) | **INVERT** | The "expensive modern glow" signature. Dial to a faint emissive-only bleed; bloom is for neon *signage*, not the whole frame. |
| `ColorGradingShader` (teal-orange + vignette) | **REPURPOSE** | Vignette stays (lo-fi friend). Cinematic teal-orange grade → flat **posterized** grade instead. |
| `RGBShift` chromatic aberration (always on, 0.0015) | **INVERT → juice** | Always-on CA is a modern-glossy tell. Repurpose as a *transient* hit/boost pulse ([01](01-what-makes-a-good-game.md) §3). |
| `FogExp2` density 0.008, warm sky-dome gradient | **KEEP, push harder** | Fog is a core lo-fi tool `[R]`. Make it do real work hiding a *shorter* draw distance. |
| Box-geometry cars, cylinder wheels | **KEEP — it's a gift** | Already boxy/low-poly. Lean in: bevel, asymmetry, decals. Don't replace with smooth GLBs. |
| Per-track JSON lighting overrides | **KEEP — great hook** | Perfect place to author per-arena palette/fog/mood as data. |
| Particle explosions, EMP rings, trails | **KEEP, restyle** | Restyle to chunky/dithered sprites, not soft glows. |
| PCFSoft shadows (2048²) | **REPLACE** | Soft PBR shadows are off-language. Move toward chunky/blob/hard shadows `[S]`. |
| `EffectComposer` already wired | **KEEP the scaffold** | The pass pipeline exists; we swap *which* passes run. |
| ACES-ish tonemap under composer | **DECIDE deliberately** | Likely **skip ACES** for a flat posterized grade `[R, open Q]` — playtest both. |

**Net:** this is a *vocabulary swap on an existing scaffold*, not a rewrite. The composer,
the per-track lighting data, the particle system, and the boxy meshes all survive — we change
the materials, the grade, and the post stack.

---

## Relationship to the neon brief (the reconciliation)

`docs/design-brief.md` says **neon-arcade/Tron, landing page wins.** This language supersedes
that direction (pending your ratification — see [README](README.md)). The neon work is **not
wasted** — it's *relocated*:

- **Neon becomes diegetic light, not the canvas.** Cyan/green/pink stop being the whole screen
  and become **emissive signage inside a dark world**: glowing track edges, headlight cones,
  weapon pickups, danger strips, the leader's "target." Bloom is reserved for *these* only.
- **The neon palette = the "loud" reserved colors** of rule #2. The environment is grimy; neon is
  what the players and hazards are made of. So the brief's colors live on — just on 5% of the
  pixels instead of 100%.
- **The landing page's energy survives** via motion, type, and a single hero neon element against
  a grimy posterized field — rather than an all-neon gradient sweep.

If you'd rather keep the landing page fully neon and only retro-fy the 3D, that's a one-section
change here — flag it.

---

## 1. Palette

Two palettes, strictly separated. **This separation is the most important rule in the doc.**

### A. World palette — "the skip bin" (muted, ~6-8 colors, used for 95% of pixels)
Grimy, desaturated, slightly warm-to-sickly. Think wet cardboard, rust, concrete, dusk.
```
INK        #14110F   near-black brown — fog base, deepest shadow
ASPHALT    #2A2620   dark warm grey  — ground, walls
CARDBOARD  #6B5A41   muted tan       — props, ramps, boxes
RUST       #7A4A2E   oxidized orange — accents, wear
SICK-GREEN #4B5A3A   olive/moss      — environment tint, "off" feeling
DUSK       #3A3550   desaturated indigo — sky upper, distance
HAZE       #8A7E6B   warm grey       — fog tint near horizon
BONE       #C9BBA0   off-white       — the lightest the world gets (worn paint)
```
Rule: **nothing in the environment is fully saturated and nothing is pure white.** Everything is
dithered/posterized toward this set `[R, posterization]`.

### B. Player & danger palette — "the loud" (saturated, reserved, used for ~5% of pixels)
These colors are **forbidden in the environment.** When the eye sees them, it means *a player or
a threat* — instant readability `[S + R]`. This is where the neon brief's colors go:
```
P1 HOT-PINK   #FF2E88     P5 ACID-GREEN  #5CFF6A
P2 CYAN       #2EE8FF     P6 ORANGE      #FF8A2E
P3 YELLOW     #FFD23E     P7 PURPLE      #B14CFF
P4 RED        #FF3B3B     P8 WHITE-HOT   #FFFFFF (reserve for emphasis)
DANGER        #FF2E2E     glow strips, shrinking-arena walls, low-health pulse
BOOST         #2EE8FF / #FFD23E flame
```
These are the only things allowed to **bloom** and to sit at full saturation against the grime.

---

## 2. Shape language — "boxy, honest, a bit wrong"

`[S]`, consistent with the existing box-geometry cars.

- **Everything is built from boxes, wedges, and cylinders.** No smooth organic curves. A car is a
  box + a smaller box (cabin) + 4 cylinders. A tree is a brown box + a green box. A barrel is a
  short cylinder. This is a *gift* — it's cheap, fast, and on-language.
- **Low, honest poly counts.** Visible facets are good. Don't subdivide to smooth — the facet *is*
  the style. More polys only where affine-warp readability demands it `[R]`.
- **Deliberate asymmetry & wear.** Perfect boxes read as "programmer placeholder." Tilt them 2°,
  dent a corner, slap a misaligned decal. "A bit wrong" = charming + intentional.
- **Chunky proportions.** Big readable silhouettes. A car should be recognizable as *that
  player's car* from across the room at thumbnail size.
- **Decals over geometry.** Liveries, numbers, racing stripes, rust streaks, sponsor gibberish —
  applied as nearest-filtered texture decals on the boxes, not modeled. Cheap personality.

**Prop kit (the "box of bits" every arena draws from):** crate, barrel, tyre stack, traffic
cone, jersey barrier, ramp wedge, chain-link panel, hazard-stripe sign, dead car husk, oil drum.
Authored once, recolored per arena via the world palette.

---

## 3. The signature render grade — the "camcorder" look

The post stack is what makes a screenshot *instantly* read as our game `[R, full-screen Effect
passes]`. Layering (final order in [04](04-implementation-plan.md); concept here):

1. **Low-res render target → upscale nearest-neighbor.** The whole world renders chunky and is
   blown up crisp `[R, RenderPixelatedPass / low-res target]`. This is the foundation; tune the
   internal resolution to taste (and to mobile-host perf — open Q in [00](00-research-report.md)).
2. **Posterize** the color to the world palette band count `[R]`. Flat, banded, cheap-looking.
3. **Ordered (Bayer) dither** to fake the missing colors and add the signature crosshatch
   texture `[R]`. This is the single most recognizable ingredient.
4. **Distance fog** doing real work — short far-plane, fog hides the edge of the world `[R]`.
5. **Vignette** — darken edges (already have it; keep) `[R]`.
6. **Film grain** — light, animated. The "found camcorder tape" feel `[R]`.
7. **(Optional, gated) scanline / dot-screen** — for menus/results "on a CRT" framing, or a global
   subtle setting `[R]`. Probably *off* during gameplay for readability; *on* for framing screens.
8. **Transient chromatic-aberration / posterize-flash** — NOT always on. Fired on smash/boost as
   juice ([01](01-what-makes-a-good-game.md) §3) `[R]`.
9. **Tone mapping decided deliberately** — likely skip ACES for a flat posterized grade; pick
   explicitly, don't inherit `[R]`.

### Per-material (not post) — the PS1 "wobble"
Optional, applied in the cars'/world's vertex+fragment shaders, *not* a post pass `[R]`:
- **Vertex snapping** — the gentle pixel-grid wobble `[R]`. Use *sparingly* — full PS1 jitter can
  hurt readability of fast-moving cars. Consider snapping the world but not the cars. `[S]`
- **Affine texture warp** — the texture wobble on decals/ground `[R]`. Subtle; more polys reduce
  it where needed.
- **Nearest-neighbor texture filtering** on all textures `[R]`.

> **Readability override (from [01](01-what-makes-a-good-game.md) §6):** the grade applies to the
> *world*. Players, HUD, name tags, and danger are pushed the opposite way — kept crisp,
> high-contrast, saturated. Never dither a health bar into illegibility.

---

## 4. Skyboxes & atmosphere

`[R, fog + cohesion] + [S]`. The sky is part of the palette, not a photo.

- **No photographic HDRIs, ever.** That's a default-three.js tell. Skies are **flat gradient
  domes or hand-built box skyboxes** in the world palette (the existing shader sky-dome is the
  right approach — restyle its colors to "the skip bin").
- **Fog meets sky** — the far fog color *is* the horizon band, so the world dissolves into the sky
  with no hard seam. Short draw distance is hidden, not apologized for `[R]`.
- **Per-arena moods authored as data** (per-track JSON lighting already supports this):
  - **"Dusk Lot"** — derelict car park at sunset; sodium-orange haze, long shadows.
  - **"Sodium Tunnel"** — underground, near-black, headlights + neon strips do all the lighting.
  - **"Toxic Dunes"** — sickly green sky, dust fog (reuses the existing dunes terrain).
  - **"VHS Stadium"** — night arena under buzzing floodlights, heavy grain + optional scanlines.
- **Cheap dynamic touches:** a flat textured moon/sun sprite, a few scrolling cloud quads, dust
  motes — all nearest-filtered and dithered. Sparingly.

---

## 5. Lighting

`[R, "stylize the shading" + flat/unlit tell] + [S]`.

- **Flat / vertex / toon shading, not PBR.** Discrete light bands, not smooth speculars `[R]`.
  `MeshToonMaterial` gradient ramps are the cheap path `[R]`; or flat-shaded with baked vertex
  tints.
- **One committed key light per arena** (the existing directional sun) + a colored ambient fill
  from the world palette. Authored per-arena as data.
- **The bright lights are diegetic and few:** headlights, neon signage, weapon glows, fire. These
  are the *only* emissive/bloomed elements (reconciliation §). Darkness is a feature — it makes
  the neon mean something.
- **Shadows:** prefer **blob/contact shadows** (a dithered dark quad under each car) over
  expensive soft shadow maps `[S]`. Cheaper, more on-language, and they read clearly on the host
  screen. Hard stylized shadows acceptable; soft PBR shadows are off-language.

---

## 6. Typography & UI chrome (one system, all screens)

`[S, research-flagged gap]`. The research is thin on cited UI specifics — this is reasoned from
"same world everywhere" `[R, cohesion]`. The rule: **the UI lives inside the camcorder too.**

- **Two typefaces, max.**
  - **Display:** a chunky, slightly-condensed pixel/blocky face for big moments (room code,
    "GO!", winner name, callouts). Boxy, loud, confident. Possibly bitmap-rendered so it dithers
    with the world.
  - **Body/HUD:** a clean, *legible* small face (a crisp pixel font or a plain system sans) for
    anything that must be read fast — health, lap, names. **Legibility wins over flavor here.**
- **Chrome = cheap signage, not glassmorphism.** Panels are flat painted rectangles with a 1-2px
  hard border, slight rotation/wear, like a sticker slapped on the screen. No soft shadows, no
  blur, no glass. (This is the biggest visible departure from the current neon glass panels.)
- **Color discipline:** UI uses the **world palette** for chrome and the **loud palette** only for
  player-owned / actionable / dangerous elements — same law as the 3D.
- **Texture continuity:** the same grain + posterize + (framing) scanline that's on the 3D is on
  the 2D UI, so DOM/canvas UI and the game render as one image. (Implementation note for 04: the
  grain/scanline can be a full-screen overlay above both.)
- **Motion:** snappy, mechanical, slightly cheap — hard cuts, quick slides, a little jitter. No
  smooth 300ms web easing; think "menu on a game console", not "SaaS dashboard."

---

## 7. Do / Don't board

| ✅ DO | ❌ DON'T |
|---|---|
| Commit limits everywhere (palette, res, polys) `[R]` | Make "one nice high-fidelity asset" that breaks the limits |
| Let fog hide a short draw distance `[R]` | Add a clean photographic HDRI skybox `[R, tell]` |
| Flat/toon/vertex shading, matte surfaces `[R]` | Ship default `MeshStandardMaterial` PBR `[R, tell]` |
| Bloom only on diegetic neon | Maximal full-frame bloom (the current 1.5) |
| Posterize + dither the world `[R]` | Smooth gradients / 16M-color realism |
| Reserve the loud palette for players + danger | Paint the environment in saturated neon |
| Keep cars/HUD crisp & high-contrast for readability `[S]` | Dither/fog/jitter the things players must track |
| Decals for personality on boxy meshes | Model high-poly detail |
| Transient CA/flash as juice on hits `[R]` | Always-on chromatic aberration `[R, tell]` |
| One UI system inside the camcorder | A "web UI" that looks like a different product `[R]` |
| Blob/hard stylized shadows `[S]` | Soft PBR shadow maps |
| Pick tone mapping deliberately `[R]` | Inherit ACES by accident `[R, tell]` |

---

## 8. How it applies, surface by surface (pointer)

The full beat-by-beat walkthrough — landing, join, lobby, countdown, race, derby, results, loop
— with the specific treatment and gaps at each step is in
[03-experience-flow.md](03-experience-flow.md). The one-line version of the law, repeated at every
surface: **grimy world, loud players, same camcorder, readable always.**

## 9. Cohesion checklist (apply to any new screen or asset)

1. Does it use the **world palette** for ~everything and the **loud palette** only for
   player/danger/action?
2. Is it **matte** (no glass, no soft shadow, no plastic spec)?
3. Does it carry the **grain + posterize + dither**?
4. Is anything the player must read kept **crisp and high-contrast** despite the grade? `[S]`
5. Could a stranger glance at it and say "that's the same game as that other screen"? `[R]`
6. Did we **hold a limit** rather than break it for this one asset? `[R]`
