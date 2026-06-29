# 04 — Implementation Plan & Bead Graph

> Translates the design language ([02](02-design-language.md)) and the experience gaps
> ([03](03-experience-flow.md)) into sequenced, dependency-aware work, ready to create as beads.
>
> **Status: PROPOSED — not yet created.** Two gates first (see §0). The `br create` block in §3
> is ready to run on your say-so; I've not injected beads into your tracker unprompted.
>
> Doc altitude was "art-direction only" — so this plan names the *engineering shape* of each item
> but leaves binding shader/library choices to the spike (Phase 0) and the implementing agent.

---

## 0. Gates (must clear before Phase 1)

These are P0 and block everything downstream.

- **G1 — Ratify the pivot. ✅ DONE 2026-06-29.** Approved: **full pivot** (landing included),
  neon retained as accent (diegetic signage + reserved loud palette + landing hero accent).
  `docs/design-brief.md` annotated as superseded. Phase 5 landing re-skin (5.3) is therefore
  **in scope** — but keep one neon hero element.
- **G2 — Perf-budget spike.** The research's #1 open question ([00](00-research-report.md) §7):
  what does stacking per-material PS1 shaders + a multi-effect post pipeline cost at party
  framerates on the **host's** GPU (the host renders; phones don't)? Prototype the grade on the
  worst plausible host (an old laptop / a phone-as-host) and set the internal render resolution +
  which effects ship + whether vertex-snapping is on. **Also resolves the tone-mapping question**
  (skip ACES vs not). Everything in Phase 1 inherits this budget.

> ⚠️ Cross-reference: there's an existing bead `br-captain-call-architecture-hardening-woq.2`
> "ARCH render backend: WebGPU first-class with WebGL fallback." The grade's perf and the post
> pipeline interact with that — coordinate, don't duplicate.

---

## 1. Phasing (priority order from the [01](01-what-makes-a-good-game.md) §7 scorecard)

```
G1 ratify ─┐
G2 spike ──┴─▶ P1 GRADE ─┬─▶ P2 READABILITY ─┐
                         ├─▶ P3 JUICE (smash + boost) ─┐
                         ├─▶ P5 COHESION (UI/lobby/landing/controller/loading)
                         └─▶ P6 ARENAS (skybox/moods/props/particles)
                                                       │
P2 + P3 ──────────────────────▶ P4 WIN + LOOP CLOSE ──┘
P3 ───────────────────────────▶ P7 RETENTION + A11y + audio
```

**P1 — The render grade (foundation).** The signature camcorder look. Nothing else reads right
until this lands. Replaces PBR materials, inverts bloom, adds low-res+posterize+dither+fog+
vignette+grain. *Depends on G1, G2.*

**P2 — The loud layer / readability.** Player color discipline, name tags/markers, segmented
health bars, leader marker, danger styling. **Gates regressions** — must land alongside P1 so the
grade never hides a car or a bar. *Depends on P1.*

**P3 — Juice.** The smash (hit-stop, shake tuning, transient flash, debris, callout) and the boost
(FOV kick, speed lines, audio ramp, haptic). Highest-value *feel* work. *Depends on P1, P2.*

**P4 — The win + loop close.** Win moment (slow-mo/spotlight/huge name), results re-skin, auto-arm
rematch, between-round sting. Closes the "again" loop. *Depends on P2, P3.*

**P5 — Cohesion surfaces.** One UI system (type, sticker chrome, grain overlay), lobby-as-world,
landing re-skin, controller re-skin, loading screen. *Depends on P1; landing scope set by G1.*

**P6 — Arenas & prop kit.** Skybox restyle, the 4 per-arena moods as data, the prop kit, weapon-
pickup restyle, particle restyle. *Depends on P1.*

**P7 — Retention & polish.** Bored-loser/derby re-entry, reduce-effects accessibility toggles,
lo-fi audio pass. *Depends on P3 (juice exists to tune against).*

---

## 2. Bead specs

Epic: **`Lo-fi retro design language ("Skip Bin Arcade")`** — type `epic`, P1, label
`design-language`. Children below. AC = acceptance criteria; → = depends-on.

### Gates
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| G1 | Ratify lo-fi-retro pivot; supersede neon design-brief | question | 0 | — | Human decision recorded: full vs 3D-only. `design-brief.md` annotated as superseded. |
| G2 | Perf/look spike: PS1 grade on worst-case host GPU | task | 0 | G1 | Prototype low-res+posterize+dither+fog+vignette+grain; record fps on old laptop & phone-as-host; decide internal res, shipped effects, vertex-snap on/off, tone-mapping choice. Written findings. |

### P1 — Grade
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 1.1 | Low-res render target + nearest-neighbor upscale | feature | 1 | G2 | World renders at chosen internal res, upscaled crisp (`image-rendering: pixelated`); fps within budget. |
| 1.2 | Posterize + ordered (Bayer) dither post pass | feature | 1 | 1.1 | World color banded to palette + signature dither; tuneable band count; matches [02](02-design-language.md) §3. |
| 1.3 | Replace PBR with flat/toon/vertex-lit matte materials | feature | 1 | G2 | Cars/track/props no longer `MeshStandardMaterial`; toon ramp or flat; no plastic spec. |
| 1.4 | Invert bloom → emissive-only diegetic glow | task | 1 | 1.3 | Full-frame bloom gone; bloom gated to neon signage/headlights/pickups only. |
| 1.5 | Short draw distance + fog-eaten horizon; deliberate tone-map | feature | 1 | 1.1 | Far-plane shortened, fog hides edge, fog color = horizon band; tone mapping set per G2 (not inherited). |
| 1.6 | Vignette + animated film grain | task | 2 | 1.2 | Camcorder grain + vignette over the frame; reduce-effects respects it (see 7.2). |
| 1.7 | Blob/contact shadows replace soft PBR shadow maps | feature | 2 | 1.3 | Per-car dithered contact shadow; PCFSoft maps removed/optional; reads on host screen. |
| 1.8 | (Optional, gated by G2) per-material vertex snap + affine warp | feature | 3 | 1.3 | Subtle wobble on world; cars likely exempt for readability; toggleable. |

### P2 — Readability / loud layer
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 2.1 | Reserve loud palette; forbid it in environment | task | 1 | 1.2 | Env uses world palette only; player/danger colors never appear in environment art. |
| 2.2 | Persistent per-car name tag + color marker | feature | 1 | 2.1 | Every car has an always-visible overhead tag/marker; "which is mine?" < 1s under the grade. |
| 2.3 | Chunky segmented health bars | feature | 1 | 2.1 | Health legible at host-screen distance; not thin gradients; survives dither. |
| 2.4 | Leader marker + danger styling (shrink wall, low health) | feature | 2 | 2.2 | Leader unmistakable; shrinking-arena wall pulses DANGER red; low-health pulse. |

### P3 — Juice
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 3.1 | Smash hit-stop (sim freeze ~80-120ms) on big impacts | feature | 1 | 1.3,2.3 | Brief freeze on heavy collision/elimination; event-driven (no per-tick log); tuneable. |
| 3.2 | Impact screen-shake curves (tune existing/`three-screenshake`) | task | 1 | 3.1 | Shake scaled to impact, sharp decay; reuses existing camera shake, not a rebuild. |
| 3.3 | Transient CA/posterize flash on smash (repurpose RGBShift) | feature | 2 | 1.2,3.1 | One-frame chromatic/posterize pulse on kill; reuses retired always-on CA. |
| 3.4 | Chunky boxy debris on elimination | feature | 2 | 1.3 | Debris matches shape language; restyled from existing `ParticleSystem`. (Coord w/ `...woq.6` debris field.) |
| 3.5 | Host-screen smash callout stingers ("X WRECKED Y") | feature | 2 | 2.2 | Room-facing text beat on the shared screen; the social layer of juice. |
| 3.6 | Boost feel: FOV kick + dithered speed lines + audio ramp + haptic | feature | 1 | 1.5 | Wire to existing wheelie/boost intent (`docs/WHEELIE_DESIGN_INTENT.md`); phone buzz on boost. |

### P4 — Win + loop close
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 4.1 | The win moment (slow-mo + spotlight winner + huge name) | feature | 1 | 2.2,3.5 | Winning is a <1s-legible beat before any table; loud-color spotlight on grimy world. |
| 4.2 | Results screen re-skin (sticker chrome, optional CRT framing) | feature | 2 | 4.1 | Results in the UI system (§5.1); scanlines allowed on this framing screen. |
| 4.3 | Auto-arm rematch (host-screen countdown, cancelable) | feature | 1 | 4.1 | "Again" is the default; rematch counts down unless canceled; cars back idling. |
| 4.4 | Between-round standings sting (derby) | task | 2 | 4.1 | Quick sting, not a wait-screen. |

### P5 — Cohesion surfaces
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 5.1 | UI system: 2 typefaces + sticker chrome + shared grain overlay | feature | 1 | 1.6 | DOM/canvas UI reads as inside the camcorder; no glass/blur; one type system; body text legible. |
| 5.2 | Lobby-as-world (cars idling in arena, name tags, banter) | feature | 1 | 2.2,5.1 | Lobby is a diegetic scene; your car is on the big screen the moment you join. |
| 5.3 | Landing/sign-in re-skin (scope per G1) | feature | 2 | 5.1 | Landing matches the world; show-don't-tell smash clip; neon survives as hero accent. |
| 5.4 | Controller re-skin (flavor without hurting touch legibility/latency) | feature | 2 | 5.1 | Phone matches palette/grain but controls always thumb-findable; latency unchanged. |
| 5.5 | Alive in-language loading screen | task | 2 | 5.1 | No bare spinner; cars assembling / camcorder warming; near-instant target. |

### P6 — Arenas & props
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 6.1 | Skybox restyle: flat gradient/box domes, no HDRIs | feature | 2 | 1.5 | Skies in world palette; fog meets sky seamlessly. |
| 6.2 | Per-arena moods as data (Dusk Lot / Sodium Tunnel / Toxic Dunes / VHS Stadium) | feature | 2 | 6.1 | Authored via existing per-track JSON lighting; 4 distinct moods. |
| 6.3 | Boxy prop kit (crate/barrel/tyres/cone/barrier/ramp/sign/husk/drum) | feature | 2 | 1.3 | Reusable kit, recolored per arena via world palette. |
| 6.4 | Restyle weapon pickups → chunky bobbing loud-glow shapes | feature | 3 | 1.4 | Pickups are the bloomed loud layer; not soft particles. |
| 6.5 | Restyle particles (fire/EMP/smoke/trails) to chunky/dithered | task | 3 | 1.2 | Effects on-language, not soft glows. |

### P7 — Retention & polish
| # | Title | Type | P | → | AC |
|---|---|---|---|---|---|
| 7.1 | Bored-loser fix: fast derby re-entry / spectator-with-agency | feature | 2 | 4.3 | Eliminated players aren't just waiting; short rounds or re-entry. (Coord w/ `...3xv.8` derby late-joins.) |
| 7.2 | Reduce-effects accessibility toggles (extend existing) | task | 2 | 1.6 | Host can dial dither/grain/scanline/shake; readability path preserved. |
| 7.3 | Lo-fi audio pass (crunchy engines, smash crunch, tape hiss) | feature | 3 | 3.1 | Audio matches the camcorder world; smash audio lands the hit. |

**Cross-references (don't duplicate existing beads):** camera tiling/stability
(`...woq.7/.8/.9`), debris field (`...woq.6`), render backend (`...woq.2`), derby late-joins/ties
(`...3xv.8`), comeback/fun-budget tuning (`...3xv.9`), curated map gate (`...3xv.13`). Several P3/P6/P7
items should *extend* those rather than re-create them — link as deps when creating.

---

## 3. Ready-to-run `br create` block

> Run **after G1 is ratified.** Creates the epic, then children, then dependencies. Adjust IDs to
> the actual epic ID `br` assigns (shown after the first command). All carry label
> `design-language`. (Newlines for readability; run sequentially.)

```bash
# 1) Epic
br create --type=epic --priority=1 --label=design-language \
  --title='Lo-fi retro design language ("Skip Bin Arcade")' \
  --description='Pivot the whole experience to a committed lo-fi PS1-PS2 look per docs/design/. Grimy posterized world, loud players, one camcorder grade across landing→win, readable always.'
# → note the assigned epic id, e.g. br-lo-fi-retro-...-xxx ; use it as $EPIC below.

# 2) Gates
br create --type=question --priority=0 --label=design-language --parent=$EPIC \
  --title='G1: Ratify lo-fi-retro pivot; supersede neon design-brief' \
  --description='Human decision: full pivot (landing incl.) vs 3D-only. Annotate docs/design-brief.md as superseded. See docs/design/README.md.'
br create --type=task --priority=0 --label=design-language --parent=$EPIC \
  --title='G2: Perf/look spike — PS1 grade on worst-case host GPU' \
  --description='Prototype low-res+posterize+dither+fog+vignette+grain; measure fps on old laptop & phone-as-host; decide internal res, shipped effects, vertex-snap on/off, tone-mapping (skip ACES?). Resolves docs/design/00 open Qs 4&5.'

# 3) Children — repeat br create for each row in §2 (P1.1 … P7.3), --parent=$EPIC,
#    --label=design-language, type/priority from the table, --title/--description from AC.

# 4) Dependencies — for each "→" in §2:
#    br dep add <child> <depends-on>
#    e.g.  br dep add <1.1> <G2> ;  br dep add <2.2> <2.1> ;  br dep add <3.1> <2.3> ; ...

# 5) Sync
br sync --flush-only
```

I can generate the full explicit command list (every child + every `br dep add`) and run it once
you ratify G1 — just say "create the beads."

---

## 4. Suggested first sprint

Once G1/G2 clear, the smallest slice that *proves the language on screen* and de-risks the rest:

1. **1.1 + 1.2 + 1.3 + 1.5** — the grade on the race scene (low-res, posterize/dither, matte
   materials, fog). One arena, one car. This is the "does it feel like our game now?" moment.
2. **2.2 + 2.3** — name tags + health bars, so the grade doesn't regress readability.
3. **3.1 + 3.2** — hit-stop + shake on the smash: the first taste of *feel*.

That slice alone validates the pivot before investing in cohesion surfaces and arenas. Use the
[01](01-what-makes-a-good-game.md) §7 scorecard as the playtest rubric.
