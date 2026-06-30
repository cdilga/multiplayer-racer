# Joystick Jammers — Visual & Experience Design Language

> Created 2026-06-29. This folder is the **art-direction source of truth** for the lo-fi
> retro ("definitely not default Three.js") direction. It is a set, read in order:

| # | Doc | What it is |
|---|-----|------------|
| — | [README.md](README.md) | This index + the neon→retro pivot callout |
| 00 | [00-research-report.md](00-research-report.md) | Cited deep-research (pass 1): the lo-fi technique set, the "tells", party-game design, with sources + confidence |
| 00b | [00b-research-report-gaps.md](00b-research-report-gaps.md) | Cited deep-research (pass 2): fills the gaps pass 1 flagged — juice/game-feel, comeback/rubber-banding, session pacing, lo-fi UI |
| 01 | [01-what-makes-a-good-game.md](01-what-makes-a-good-game.md) | First-principles: what makes *this* party racer good. Goals set **before** visuals. |
| 02 | [02-design-language.md](02-design-language.md) | **The core artefact.** The lo-fi-retro / boxy visual language across every surface. |
| 03 | [03-experience-flow.md](03-experience-flow.md) | The whole funnel — landing → join → lobby → countdown → race/derby → results → loop — with the treatment and the gaps at each beat. |
| 04 | [04-implementation-plan.md](04-implementation-plan.md) | Planning pass + proposed bead graph to wire the language in. |
| 05 | [05-grade-performance-spike.md](05-grade-performance-spike.md) | G2 evidence note: host-grade ladder, tone-map decision, automated screenshots/metrics, and residual perf risks. |

---

## ⚠️ Read this first: the deliberate aesthetic pivot

The existing [`docs/design-brief.md`](../design-brief.md) declares the canonical look to be
**"neon arcade / Tron"** — glowing cyan/green/pink on dark navy, with the landing page as
the source of truth that gameplay should follow.

**This design language deliberately changes that direction** to a **lo-fi retro / PS1-PS2
"boxy" aesthetic** (in the spirit of Lethal Company, Content Warning, Buckshot Roulette).
This was a conscious choice (see the decision log below), and it spans *everything* —
landing/sign-in, join, lobby, HUD, race, results — not just the 3D scene.

This is **not** "throw away the neon work." The reconciliation (detailed in
[02-design-language.md](02-design-language.md) §"Relationship to the neon brief") is:

- The neon palette survives as **in-world emissive signage** — glowing track markings,
  headlights, weapon glows, danger strips — *inside* a darker, fog-bound, posterized world.
  Neon stops being the whole canvas and becomes the diegetic light source.
- The "expensive modern glow" stack (maximal bloom, chromatic aberration, teal-orange
  cinematic grade) is **inverted**: bloom dialled way down and gated to emissives only,
  grade flattened/posterized, chromatic aberration repurposed as a *transient juice cue*
  rather than an always-on edge effect.

**✅ RATIFIED 2026-06-29 (gate G1).** The user approved the **full pivot** (landing included),
with the explicit instruction to **"keep a bit"** of the neon — i.e. exactly the reconciliation
above: neon is retained as diegetic emissive signage, the reserved "loud" player/danger palette,
and a single landing hero accent — not as the whole canvas. `docs/design-brief.md` is now
**superseded** (annotated at its head) and is no longer the aesthetic source of truth; this
folder is.

---

## Decision log (2026-06-29)

- **G1 — pivot ratified:** full pivot (landing included), neon retained as accent per the
  reconciliation. `docs/design-brief.md` superseded.
- **Aesthetic true-north:** Lo-fi retro (Lethal-Company-leaning) — posterize + dither, low-res
  upscale, flat/vertex lighting, matte not glossy, fog as a tool, boxy low-poly. (Chosen over
  "clean toon" and "hybrid toon+retro grade".)
- **This pass delivers:** docs + planning + bead graph. **No implementation code this round.**
- **Doc altitude:** art-direction-focused. Engine specifics (shaders, passes, libraries) are
  *named for orientation* but the binding implementation decisions live in the planning pass
  (04) and the beads, not in the language doc.

## Grounding

- Current renderer reality (what exists, what to keep/invert/kill): the codebase map informing
  these docs lives inline in [02-design-language.md](02-design-language.md) §"Current state".
  Key file anchors: `static/js/systems/RenderSystem.js`, `static/js/shaders/ColorGradingShader.js`,
  `static/js/resources/VehicleFactory.js`, `static/js/resources/TrackFactory.js`,
  `static/js/systems/ParticleSystem.js`, the `static/js/ui/*` layer, and the
  `frontend/{landing,host,player}/` screens.
- Research provenance: 5 search angles → 23 sources → 82 claims → 24 survived 3-vote
  adversarial verification. Full provenance and confidence in
  [00-research-report.md](00-research-report.md).
