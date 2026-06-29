# 00 — Research Report: Lo-fi Retro Look & Party-Game Design

> **Provenance.** Deep-research harness run 2026-06-29 (`wf_adba2592-8f1`).
> 5 search angles → 23 sources fetched → 82 falsifiable claims extracted →
> top 25 put through **3-vote adversarial verification** (≥2/3 refutations kills a claim) →
> **24 confirmed, 1 refuted**. Confidence tags below are the harness's, not added after.
>
> **How to read this.** The rendering recipes and the Jackbox party-design principles are
> well-supported. The racer-specific *juice* catalogue and several cohesion/UI specifics
> were **not** covered by surviving claims — those gaps are filled in
> [01-what-makes-a-good-game.md](01-what-makes-a-good-game.md) and
> [02-design-language.md](02-design-language.md) and are clearly marked there as
> *design synthesis*, not cited fact.

---

## Executive summary

A browser-based Three.js party racer escapes the "default Three.js" look by deliberately
fighting the engine's out-of-the-box defaults (untextured `MeshStandardMaterial`, flat unlit
silhouettes, plasticky PBR, no fog, no post-processing) and replacing them with an intentional,
internally consistent lo-fi / PS1-PS2 visual grammar. That grammar is a **specific named
technique set**, not a vibe: low-precision vertex snapping (pixel wobble), affine
(non-perspective-correct) texture mapping (texture warp), nearest-neighbor texture filtering,
15-bit color with ordered (Bayer) dithering plus posterization, short draw distance masked by
fog, low-resolution render targets upscaled with pixelation, and CRT/scanline/vignette/grain
overlays. Most of these ship ready-made in Three.js's official `RenderPixelatedPass` and the
`pmndrs/postprocessing` effect suite, or as small custom vertex/fragment shaders.

Cohesion comes from carrying that point of view across the *whole* experience — skyboxes,
prop shape language, UI, lobby/results — the way demakes such as *OK/NORMAL* enforce hardware
limits to stay authentic. For party-game design specifically, the best-documented playbook is
Jackbox's: speak "media language" (TV pacing), restrict input to a tiny vocabulary so learning
one game teaches all, gate every concept on immediate comprehension, and use a host-driven
"Interactive Conversation Interface" for spectator energy.

Confidence is **high** on the rendering recipes (primary Three.js examples/library + corroborating
dev blogs) and **high** on the Jackbox principles (first-party quotes), but **weak** on
racer-specific juice and on comeback/win-condition/session-length design, which the verified
claim set under-covers.

---

## 1. Why generic Three.js looks generic — and the fixes

### The flat/unlit tell
A 3D object rendered with a non-lit material (canonically `MeshBasicMaterial`) reads as a flat
2D outline, not a solid form, because human depth perception relies on subtle shading gradients
across a surface ("shape-from-shading"). Lesson: even a stylized lo-fi scene needs *some*
shading model — vertex/flat lighting, toon ramps, or baked gradients — to read as 3D.
*(source: discoverthreejs.com/book/first-steps/physically-based-rendering) (high)*

### The tone-mapping / washed-out tell
Once you add an `EffectComposer`, tone mapping is **deactivated** inside the post-processing
render pass for more correct color management. If you don't re-apply it, output looks washed
out / gray (e.g. AgX vs ACES Filmic). Fix: set the renderer to no tone mapping and add an
explicit `ToneMapping` effect **last** in the pipeline. **For a deliberately lo-fi look you may
want to skip ACES Filmic entirely** and grade toward a flatter, posterized palette — the point
is tone mapping must be a *deliberate choice*, not an accidental default.
*(source: threejs-journey.com/lessons/post-processing-with-r3f) (high; R3F-flavored but applies to vanilla EffectComposer)*

### The cohesion fix: stylize the shading itself
Cel/toon shading is a cheap, high-impact way to leave "default PBR plastic" behind: Three.js's
`MeshToonMaterial` uses a `gradientMap` texture (filtered with `NearestFilter`) to **quantize**
Lambert-style lighting into discrete bands — color quantization applied to *light* rather than
texels. Two-tone ramp = hard light/shadow; more steps = more bands.
*(sources: learnwithhasan.com/threejs-guide + Three.js core docs) (high)*

---

## 2. The named lo-fi / PS1-PS2 technique set

The PS1 aesthetic is a specific bundle of artifacts: vertex snapping (pixel wobble), affine
texture mapping (warp), short draw distance masked by fog/darkness, jagged edges (no AA), CRT
blurriness. *OK/NORMAL*'s dev (98DEMAKE / Toni Kortelahti) enforced the original PlayStation's
hardware limits to keep the look authentic — **the design principle: pick your constraints and
hold to them everywhere.** *(source: gamesradar.com PS1-resurgence feature) (medium, corroborated)*

### Vertex snapping / jitter ("the wobble")
Origin: PS1's GTE was fixed-point/integer-only, so vertices snapped to a pixel grid. Emulate in
a **vertex shader**: divide clip-space position by `w`, snap `xy` to a low grid, multiply back:
```glsl
vec2 resolution = vec2(320, 240);
vec4 pos = projectionMatrix * mvPosition;
pos.xyz /= pos.w;
pos.xy = floor(resolution * pos.xy) / resolution;
pos.xyz *= pos.w;
```
*(source: romanliutikov.com/blog/ps1-style-graphics-in-threejs) (high)*
⚠️ **Refuted variant:** a Codrops formula `gl_Position.xy = floor(...) / ... * gl_Position.w`
failed verification (vote 1-2). Prefer the divide-by-w / snap / multiply-back form above.

### Affine (non-perspective-correct) texture mapping ("the warp")
PS1 interpolated UVs using only screen-space (x,y), ignoring per-vertex z (no perspective
correction). Artifact: within each triangle textures stay parallel to two edges → visible
warping/seams, worst at sharp angles and on large near-camera polys, **reduced by more polygon
density**. Implementation reverses the GPU's perspective-correct interpolation:
vertex `vUv = uv * gl_Position.w;` → fragment `uv = vUv / vPos.w;`
*(sources: danielilett.com PS1 affine tutorial + romanliutikov.com) (high)*

### Nearest-neighbor texture filtering ("blocky texels")
PS1 had no texture filtering. In Three.js: `map.minFilter = LinearFilter; map.magFilter =
NearestFilter;` plus CSS `image-rendering: pixelated;` on the canvas. `magFilter = NearestFilter`
produces the blocky upscale. *(source: romanliutikov.com) (high)*

### 15-bit color, banding, ordered (Bayer) dithering, posterization
PS1 commonly used **15-bit color** (32,768 colors) and ~128×128 textures → visible banding.
Era + modern fix: **ordered dithering** (a tiled Bayer-matrix threshold map) + **posterization**,
often in **YUV** space. Reference shader: `ditherAndPosterize(gl_FragCoord.xy, color, 15.0, 1.0)`.
- Ordered dithering: a precomputed Bayer matrix is tiled across the screen; each pixel's
  position selects a cell; that cell's threshold is compared against luminance → a predictable
  repeating crosshatch (not random noise). Larger matrices (4×4, 8×8) = more refined.
- Posterization formula: `floor(color * (n - 1) + 0.5) / (n - 1)` maps a channel to `n` levels;
  `n=2` per channel = 2³ = 8 total colors.
*(sources: romanliutikov.com; blog.maximeheckel.com art-of-dithering; codrops real-time-dithering) (high)*
*Nuance: PS1 hardware used 4×4 ordered dither; popular modern recreations use 8×8 — fine for the look, not hardware-faithful.*

### Pixelation via low-res render target ("the chunky base")
Three.js ships an official **`RenderPixelatedPass`** (`three/examples/jsm/postprocessing/`),
shown by the `webgl_postprocessing_pixel` example, with a pixel-size parameter — no need to write
it from scratch. A newer TSL `PixelationPassNode` also exists. General base technique: render to a
low-res target, upscale nearest-neighbor. *(sources: threejs.org pixel example; learnwithhasan.com) (high)*

### CRT / scanlines / halftone / vignette / grain / chromatic aberration
`pmndrs/postprocessing` bundles the lo-fi vocabulary as ready-made effects: **Pixelation,
Scanline** (CRT lines, density+scroll), **Dot-Screen** (halftone), **Vignette, Noise/Grain,
Chromatic Aberration** (channel separation). *(source: github.com/pmndrs/postprocessing) (high)*

### How these are architected
Dithering/posterization/scanlines are **full-screen post passes** (custom `Effect` subclasses)
that act like an image filter on the already-rendered scene — they apply to any scene without
touching individual materials. **Vertex snapping and affine mapping must live in the object
materials' vertex/fragment shaders**, not in a post pass. *(source: blog.maximeheckel.com) (high)*

### Suggested layering order (synthesis across the rendering sources)
1. Per-material vertex shader = snap + affine UVs.
2. Textures = nearest-neighbor, small dimensions.
3. Render scene into a **low-res target**.
4. Post stack = posterize → ordered (Bayer) dither (YUV) → optional scanline/dot-screen →
   vignette → grain → (optional) chromatic aberration → explicit tone mapping **last**.
5. Upscale to canvas with `image-rendering: pixelated`.
6. **Short far-plane + distance fog** to hide draw distance and pop-in.

---

## 3. Building a cohesive design language across the whole experience

- Strongest documented principle: **commit to your constraints and apply them everywhere.**
  *OK/NORMAL* used warped textures, jagged edges, CRT blur and enforced PS1 hardware limits to
  keep the whole game authentic and evoke a consistent intentional mood — the look is a **point
  of view, not a filter.** *(source: gamesradar.com) (medium)*
- Implication for the racer: the same lo-fi grammar (limited posterized palette, dithering,
  chunky props, nearest-filtered textures, fog-masked distance) extends beyond the race scene to
  the skybox, environment, lobby/join, HUD typography, transitions, and win/lose/results — so
  every screen reads as the same designed world.
- **Honest caveat:** verified evidence is rich on the *rendering* half of cohesion and thin on
  concrete UI/menu/typography/transition specifics from named games. Those recommendations in
  doc 02 are reasoned extrapolation of "enforce your constraints everywhere," not independently
  cited findings.

---

## 4. Juice / game-feel for arcade party racers — UNDER-SOURCED

The surviving, adversarially-verified claim set did **not** include direct sources for the
racer-specific juice catalogue (screen shake, speed lines, impact frames, FOV kick, particle
layering, who's-winning readability, comeback mechanics). The closest transferable principle:
visual feedback effects (a brief chromatic-aberration pulse, vignette/scanline flash, pixelation
hit, posterize flash) are cheap to layer as full-screen passes and can be **triggered on
impacts/boosts**. *(sources: pmndrs/postprocessing; maximeheckel.com) (medium, as applied to juice)*

Two sources were *fetched* but their specific claims didn't reach the verified top-25:
`anpetersen.me/2015/01/16/for-the-sake-of-screen-shake.html` (Vlambeer "screenshake" lineage) and
`github.com/felixmariotto/three-screenshake` (a ready Three.js camera-shake lib).
**Treat the juice catalogue in [01](01-what-makes-a-good-game.md) §3 as design synthesis.**

---

## 5. What makes a multiplayer party game "good" (Jackbox playbook)

Jackbox is the best-documented party-design source in the verified set; its principles transfer
directly to a host-screen + phone-controller racer.

- **Speak "media language," not game mechanics.** Pacing/timing modeled on TV keeps non-gamers
  and elderly players engaged. *("they're tuned in because we're speaking media language")
  (builtinchicago.org) (high)*
- **Restrict the input vocabulary so learning one game teaches all.** Jackbox limits the phone to
  drawing/selection/text; "once the user plays a few, they have essentially learned how to play
  all of them." For a racer: a minimal touch controller (steer + one action), reused identically
  across modes. *(builtinchicago.org) (high)*
- **Host-driven "Interactive Conversation Interface" for spectator energy.** A real-feeling host on
  the shared screen "pulls players along" — "a weird hybrid of passive and active media." The big
  screen carries the energy; phones do light interaction. *(builtinchicago.org) (high)*
- **Gate every concept on immediate comprehension.** Core question, literally: *"Do players
  understand it right away?"* — applied before and during development. *(gamerant.com;
  builtinchicago.org) (high)*
- **The one-sentence test.** If the game sums up in one short sentence it's on track; "if it
  takes a paragraph to explain why something is fun, it can probably be streamlined." For this
  racer: *"Drive your car, smash the others, last one rolling wins."* *(gamerant.com) (high)*

**Not covered by verified claims:** win-condition design, comeback/rubber-banding mechanics, ideal
session length. (A rubber-banding source — `gamedeveloper.com/design/rubber-banding-as-a-design-requirement` —
was fetched but its claims didn't reach the verified top-25.) Treat those in
[01](01-what-makes-a-good-game.md) as synthesis.

---

## 6. Caveats & weak spots (verbatim from the harness)

- **Juice/game-feel is under-sourced.** None of the 24 verified claims directly addresses screen
  shake, speed lines, impact frames, FOV kick, particle layering, or who's-winning readability.
- **Party-design coverage is Jackbox-centric and onboarding-weighted.** Strong on accessibility,
  input simplicity, comprehension, spectator/host energy; silent on comeback mechanics, win
  conditions, session length. All Jackbox claims are secondary sources quoting first-party execs.
- **PS1 mechanism nuances.** "No floating point" is more precisely "rasterizer lacked subpixel
  precision / integer screen coords"; "ignoring z" for affine is "no divide-by-w perspective
  correction." Shader recipes are correct regardless. Modern dither recreations use 8×8 Bayer
  where hardware used 4×4.
- **Source mix.** Rendering recipes lean on dev blogs (Liutikov, Ilett, Heckel, Codrops) +
  official Three.js examples/library code; blogs corroborated by primary docs/forum/installed
  `RenderPixelatedPass.js`, so confidence is high despite the blog medium.
- **Tone-mapping detail is R3F-flavored** but applies to vanilla `EffectComposer`.
- **Time sensitivity.** Library APIs evolve — re-check class names/imports against installed
  versions. PS1 hardware facts and Jackbox philosophy are stable.

## 7. Open questions (carried into planning)

1. Concrete cited juice recipes for arcade racers (shake curves, FOV kick on boost, speed-line
   shaders, impact freeze-frames, drift/boost particle layering) and which named games document them.
2. Win conditions, comeback/rubber-banding, target session length for a non-gamer party racer.
3. Specific UI/menu/HUD-typography/transition techniques acclaimed lo-fi indies actually use.
4. **Performance budget** of stacking per-material PS1 shaders + a multi-effect post pipeline at
   party framerates on mobile-class GPUs (host screen renders; phones are controllers).
5. Does skipping ACES Filmic (toward a flat posterized grade) read better for lo-fi, and what
   `ToneMapping` choice fits the style?

---

## Appendix: confirmed claims (24/25) with sources & votes

| Claim (abbrev.) | Source | Quality | Vote |
|---|---|---|---|
| Three.js ships official `RenderPixelatedPass` for retro pixelation | threejs.org pixel example | primary | 3-0 |
| `pmndrs/postprocessing` bundles Pixelation/Scanline/Dot-Screen/Vignette/Noise/CA | github pmndrs | primary | 3-0 |
| PS1 look = vertex snapping + affine mapping + short draw distance + jagged + CRT blur | gamesradar | secondary | 3-0 |
| 98DEMAKE enforced PS1 hardware limits in OK/NORMAL for authenticity | gamesradar | secondary | 3-0 |
| Jackbox uses TV "media language" for broad accessibility | builtinchicago | secondary | 3-0 |
| Jackbox limits input (draw/select/text) → learning one teaches all | builtinchicago | secondary | 3-0 |
| Jackbox "Interactive Conversation Interface" host = spectator energy | builtinchicago | secondary | 3-0 |
| Jackbox one-sentence test for concept clarity | gamerant | secondary | 3-0 |
| Jackbox gates on immediate comprehension ("understand it right away?") | gamerant | secondary | 3-0 |
| Vertex snapping recipe (divide-by-w, floor-snap, multiply-back) | romanliutikov | blog | 2-1 |
| Affine mapping causes wobble; reduce via polygon density | romanliutikov | blog | 3-0 |
| Nearest-neighbor filtering (`magFilter=NearestFilter` + CSS pixelated) | romanliutikov | blog | 3-0 |
| 15-bit color + 128² textures → banding → 8×8 Bayer dither + posterize in YUV | romanliutikov | blog | 3-0 |
| Ordered dithering = tiled Bayer threshold map vs luminance | maximeheckel | blog | 3-0 |
| Posterize formula `floor(c*(n-1)+0.5)/(n-1)`; 2 levels = 8 colors | maximeheckel | blog | 3-0 |
| Retro effects = full-screen `Effect` subclasses over any scene | maximeheckel | blog | 3-0 |
| Real-time 4×4 Bayer ordered-dither shader | codrops | blog | 3-0 |
| Affine = UV interp from (x,y) only, ignoring z | danielilett | blog | 3-0 |
| Affine artifact: textures parallel to 2 triangle edges → seams | danielilett | blog | 3-0 |
| Affine shader: ×w in vertex, ÷w in fragment | danielilett | blog | 3-0 |
| Unlit material → flat 2D outline (depth needs shading) | discoverthreejs | blog | 3-0 |
| Tone mapping deactivated under post-processing; manage explicitly | threejs-journey | blog | 3-0 |
| Retro pixelation via Pixelate downsample pass | learnwithhasan | blog | 3-0 |
| Toon = gradient map quantizing light into steps | learnwithhasan | blog | 3-0 |

**Refuted (1):** Codrops PS1 jitter formula `gl_Position.xy = floor(...)/...*gl_Position.w`
(vote 1-2) — use the divide-by-w form instead.

### Source list
- romanliutikov.com/blog/ps1-style-graphics-in-threejs — Three.js PS1 recipes (snap, affine, dither)
- danielilett.com/2021-11-06-tut5-21-ps1-affine-textures — affine texture mapping tutorial
- blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web — dithering/posterization theory + Effect classes
- tympanus.net/codrops/2025/06/04/building-a-real-time-dithering-shader — real-time 4×4 Bayer dither
- github.com/pmndrs/postprocessing — effect library (pixelation/scanline/dot-screen/vignette/noise/CA)
- threejs.org/examples/webgl_postprocessing_pixel.html — official RenderPixelatedPass example
- learnwithhasan.com/threejs-guide — pixelate + toon shading guide
- discoverthreejs.com/book/first-steps/physically-based-rendering — why unlit looks flat
- threejs-journey.com/lessons/post-processing-with-r3f — tone mapping under post-processing
- gamesradar.com/exploring-the-resurgence-of-the-low-fi-3d-visual-style-of-the-ps1-era — PS1 techniques + OK/NORMAL
- builtinchicago.org/articles/jackbox-games-design-party-pack — Jackbox accessibility/input/host ICI
- gamerant.com/how-jackbox-makes-party-games — Jackbox comprehension gate + one-sentence test
- *(fetched, not in verified top-25:)* anpetersen.me for-the-sake-of-screen-shake; github.com/felixmariotto/three-screenshake; gamedeveloper.com/design/rubber-banding-as-a-design-requirement
