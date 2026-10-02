# Joystick Jammers — Visual Asset Pipeline

## Goal

Use **Claude Code as the technical-art orchestrator**, with **Blender MCP** for interactive 3D work, **Blender/Python scripts** for reproducible asset processing, **Codex-backed image generation** for 2D source art, and the **running Three.js game as the final visual authority**.

The core loop is:

**inspect → modify/generate → export → run game → capture → critique → iterate**

---

## 1. Tool responsibilities

### Claude Code
Owns the visual goal and coordinates the whole pipeline:
- inspect existing models, textures, shaders and procedural generation;
- use Blender MCP to edit and render assets;
- write repeatable Blender/Python tooling;
- call Codex image generation when useful;
- modify Three.js materials/shaders and environment code;
- run the game and inspect deterministic screenshots;
- iterate until changes are visibly better in real gameplay.

### Blender MCP
Use interactively for:
- vehicle/player/prop modelling;
- proportion and silhouette fixes;
- UV inspection and editing;
- material setup;
- baking AO / normals / masks;
- rigging where needed;
- preview renders and contact sheets.

### Blender/Python scripts
Use for anything that should be repeatable:
- import/normalisation;
- semantic material tagging;
- UV/bake setup;
- LOD generation;
- batch variants;
- GLB export;
- asset validation.

Prefer scripts under `tools/blender/` rather than undocumented manual-only workflows.

### Codex image generation
Use for suitable 2D source imagery:
- decals and fictional sponsors;
- signs and billboards;
- grunge/dirt;
- surface/fabric references;
- road markings;
- foliage cards;
- environment concepts;
- texture source material.

Do **not** blindly generate complete UV textures for arbitrary meshes. Give imagegen references, renders, masks or UV context when registration matters.

---

## 2. Asset contract

Models should expose useful semantic information to the runtime, not just geometry + one texture.

Example vehicle regions:

```text
0 paint
1 tyre
2 wheel
3 glass
4 dark plastic
5 metal
6 headlight
7 brake light
8 interior
9 decal
10 dirt/underside
```

Encode these through material slots, vertex attributes, secondary UV channels, or another consistent glTF convention.

Useful baked/runtime data may include:
- UV0: main texture coordinates;
- semantic part/material IDs;
- baked AO;
- decal/team/player masks;
- normals;
- optional roughness/metalness/emissive maps.

Document the exact convention in `art/ASSET_CONTRACT.md`.

---

## 3. Runtime materials matter

Do not expect Blender export alone to create the final look.

Use Three.js for game-specific material treatment such as:
- car-paint clearcoat and reflections;
- tyre/plastic/metal roughness;
- glass;
- brake/headlight emissive states;
- damage/dirt variation;
- player colours and identity;
- procedural micro-normal detail;
- wet/dry track response;
- environment-specific shader effects.

Keep visual variation cheap where possible: masks + shader parameters are often better than many unique textures.

---

## 4. Procedural environment generation

Procedural generation should use the same art rules as authored assets.

Separate **structure** (track layout, terrain, barriers, prop/vegetation placement) from **presentation** (reusable prop families, materials, decals, signs, lighting, fog, particles and colour variation).

Procedural systems should choose from curated, validated visual building blocks rather than inventing arbitrary styles at runtime. Use deterministic seeds for visual QA.

---

## 5. Visual QA loop

Every important change should be checked in the actual game.

Maintain deterministic capture scenarios such as:

```text
hero-car
4-player-pack
8-player-pack
16-player-spread
car-collision
car-upside-down
race-start
fast-corner
jump
track-overview
split-camera-close
split-camera-separated
```

For asset work, generate a fixed contact sheet where useful: front / side / rear / 3-quarter, clay, wireframe, UVs, material-ID view, normal gameplay camera, and crowded gameplay.

Claude should compare **before vs after** and prioritise defects visible at normal gameplay scale.

---

## 6. Objective validation

Automate checks where possible:
- dimensions and scale;
- origin/pivot;
- orientation;
- triangle count;
- UV validity;
- material/semantic IDs;
- normals;
- missing textures;
- LOD presence;
- GLB round-trip loading;
- collider compatibility;
- asset naming.

Visual polish must never silently break physics or gameplay interfaces.

---

## 7. Working rule

For every visual task:

1. Capture a baseline.
2. Identify the largest visible deficiency.
3. Make the smallest meaningful improvement.
4. Preserve gameplay/physics contracts.
5. Export and validate.
6. Run the real game.
7. Capture the same scenario.
8. Compare and critique.
9. Continue only while another material improvement is visible.

**The real Joystick Jammers gameplay view is authoritative — not the Blender viewport.**
