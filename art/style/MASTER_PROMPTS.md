# Joystick Jammers — master style prompts

**Purpose:** one shared visual language for every image-generation prompt in the project (vehicles, props,
worlds, UI, VFX, crowd, marketing). Every prompt = **MASTER STYLE + asset-type block + subject + GUARDS**.
Keep these blocks verbatim so outputs stay consistent; change them only deliberately (and regenerate refs).

Direction: *Outback comic motorsport festival* (plan §12, `docs/plans/v0.2-experience-direction.md`) —
cute, chunky, toy-like, funny; comic ink; a hint of sun-bleached Mad Max grit and glowing emissives.

---

## 1. MASTER STYLE (prepend to every prompt)

> Joystick Jammers house style: a cute, chunky, toy-like 3D look, like a premium stylised party game.
> Soft rounded forms with big simple shapes and exaggerated proportions — oversized wheels and heads,
> short stubby bodies, generous bevels, no thin fiddly parts. Low-poly-friendly: clean readable
> silhouettes built from a few confident shapes with smooth shading, not noisy detail. Bold comic
> treatment: tasteful dark ink outlines of even weight, two-to-three tone cel shading with a warm key
> light and cool shadow, a subtle halftone texture only in the shadows. Colour: saturated but harmonious —
> warm sunbaked ochres, red earth and cream as the base, with cobalt, saffron and electric teal accents,
> and one bright player colour per vehicle. A light touch of Australian outback festival grit: sun-faded
> paint, a few friendly dents and dust, stickers and hand-painted numbers — playful, never grim or
> militaristic. Small glowing emissive details (lights, exhausts, signs) that pop. Materials read as
> painted toy plastic, rubber and a little chrome. Friendly, funny, full of personality, readable from
> across a room.

## 2. GUARDS (append to every prompt)

> No real brands, logos, badges or trademarked names; no real people; no text other than what is asked
> for. No real landmarks or sacred sites (no Uluru or Kata Tjuta likenesses), no Aboriginal or Torres
> Strait Islander art, symbols or motifs. No gore, weapons realism or military styling. Family friendly.

## 3. Asset-type blocks

**VEHICLE**
> Subject is a single vehicle as a collectible toy: three-quarter front view, slightly elevated camera,
> centred with margin, on a plain warm cream background with a soft contact shadow. Big wheels that fill
> the arches, visible chunky suspension stance, a short cute body, clear headlight "eyes" and a friendly
> grille "mouth" without literal faces. Space on the roof for a big race number in a white roundel.

**VEHICLE TURNAROUND (for modelling)**
> Orthographic turnaround sheet of the same vehicle: front, left side, rear and top views, aligned on a
> shared ground line and scale, flat even lighting, no perspective, plain white background, no shadows,
> thin clean outlines, consistent proportions between views.

**PROP**
> Subject is a single stylised prop as a chunky toy object, three-quarter view, plain warm cream
> background, soft contact shadow. Exaggerated friendly proportions, rounded edges, big readable parts,
> bold ink outline. Designed to be knocked over and squished in a comic way.

**PROP TURNAROUND (for modelling)**
> Orthographic turnaround sheet of the prop: front, side, back and top, aligned, flat lighting, white
> background, clean outlines, consistent proportions.

**ENVIRONMENT / VIGNETTE**
> A small diorama-like slice of a fictional Australian outback race venue at golden hour: red dirt road
> with tyre tracks, chunky rounded red rock formations (fictional, generic), spinifex tufts, a few festival
> props (flags, tyre stacks, hay bales, a food van), big sky with graphic clouds. Readable depth, the road
> and its next turn clearly visible. Camera: three-quarter high angle like a game camera.

**UI / SCREEN**
> A game UI screen for a TV, 16:9: sticker-style panels with thick slightly hand-inked (not wobbly)
> borders, warm cream paper and deep navy ink as the base, bold condensed display type for titles and a
> clean legible sans for labels, big touch-friendly buttons, a large QR code block, player cards with
> number, colour and pattern. Straight text baselines; playful, not childish.

**VFX / COMIC FX**
> Comic impact effects as stickers on a flat background: onomatopoeia burst words in chunky outlined
> letters, speed lines, dust puffs, sparks, smoke rings, a stylised flame — bold shapes, limited palette,
> ink outline, easy to read at small size.

**CROWD / CHARACTERS**
> Cute chunky festival spectators as toy figures: big heads, simple rounded bodies, sun hats, eskies,
> folding chairs, waving flags; diverse and friendly; no real people, no caricatures.

## 4. Palette (reference hex; identity colours are separate and always win)

| Role | Colours |
|---|---|
| Base (world) | red earth `#C8622E`, ochre `#D9A441`, sun cream `#F3E3C3`, sandstone `#E0B389` |
| Ink / UI | deep navy `#15203A`, paper cream `#FFF4DE` |
| Accents | cobalt `#1E5BFF`, saffron `#FFB400`, electric teal `#00C2B8` |
| Emissive | headlight `#FFF3C4`, brake `#FF3B30`, boost `#4FC3FF`, hazard `#FF7A00` |

## 5. Modelling rules that follow from the style (for Blender)

- Few, well-placed polygons: big bevelled primary forms, supporting edge loops only where silhouette or
  deformation needs them (dent zones, wheel arches); no micro-detail in geometry — put it in decals.
- Exaggerate: wheels ~1.4× real, overhangs ~0.7×, cabin slightly oversized, rounded roof; props get
  bulbous, soft shapes (a wheelie bin is pudgy and friendly, lid like a cap).
- Silhouette test at 40 px must still read; outline in-engine, not baked into textures.
- Budgets: car LOD0 ≤ ~10k tris incl. dent loops; props ≤ ~1.5k; debris pieces ≤ 300.
