# Vendored: threejs-aaa-graphics-builder

| | |
|---|---|
| Source | https://github.com/majidmanzarpour/threejs-game-skills (path `skills/threejs-aaa-graphics-builder/`) |
| Commit | `8286774b22a2566bf894dbc825825c16921866af` (2026-09-28, "Tune skills for Claude Opus 5.5, cut QA token cost, and add music generation") |
| Fetched | 2026-10-03 as the GitHub tarball `codeload.github.com/majidmanzarpour/threejs-game-skills/tar.gz/<sha>`; nothing was installed or run |
| Author | Majid Manzarpour |
| Licence | **MIT**, with a LICENSE file upstream ("Copyright (c) 2026 Majid Manzarpour"); copied byte-for-byte from the repository root to `LICENSE` here. GitHub's licence API also reports `mit`. |
| Bead | P1-F11 (Shader skills) |

## Read-through (2026-10-03)

Read in full before copying: `SKILL.md`, `agents/openai.yaml`, the four `references/*.md`, and the three
`assets/scorecard-anchors/*.jpg` calibration screenshots (opened and viewed; valid 800x450 JPEGs). Also read, but **not**
vendored: the repo `LICENSE`, `README.md`, `AGENTS.md`, `package.json`, `.gitignore` and `install.sh`.

The vendored folder is Markdown, one 8-line YAML UI stub and three JPEGs. It contains no scripts, hooks, binaries or
network calls; the only code is three.js snippets in the Markdown (materials, `onBeforeCompile` patches, a sky dome,
an `EffectComposer` chain), and none of it runs on install or on load. `install.sh` (not run, not vendored) is a copy
script that rsyncs every skill into `~/.claude/skills` / `~/.codex/skills` and does `rm -rf` on the destination of a
same-named skill when `--force` is given; that is why we vendor by hand. The repo's `package.json` only declares
Playwright and pngjs dev dependencies and shell/Python/Node helper scripts for the *other* skills; none were taken.

## Removed on vendoring

Nothing was removed from `skills/threejs-aaa-graphics-builder/`. Every file in it is byte-identical to the upstream
commit. sha256:

```
f6a86bb25e222e66e82c40652c720c172084334e814ab5cb6d9a44d63b2829df  agents/openai.yaml
bfca5ae29fe4675a435eeb6bb75eedd96370376528c1801b6fa6edebfcdf2b18  assets/scorecard-anchors/scene-1.jpg
27d363f0feb8bff85f704ebf7b850365e387d67bbfc0de4affb9d7275fb110e8  assets/scorecard-anchors/scene-2.jpg
5fc81e5d20a9e3b281e02fed068b6de489f87f05f77dcdbf915f3be450515f2a  assets/scorecard-anchors/scene-3.jpg
40a0ffc0324a2f90c8fb261837cba72581ea151fe87b2be2fb899df4de27e68f  references/authoring-recipes.md
7884909330d1d2863c3cacf987d5b691cafeae716849183d5aaf68b70ffc982e  references/shader-cookbook.md
8da9799dc229557ac4e489e7e2a9048c5b401c444f3c26c67810e2bb5da89bda  references/technical-art.md
97b27303a978e68294d9cbf2e6951f4b98e72765c306d13ea1884b0441c65391  references/visual-scorecard.md
6656c3a0c3553cf78e0e64665bd6e697e06eeebbe2276b10538483820688f7b6  SKILL.md
306512561953da83863404efe11ba8845c6a7cf47a8744321c7cbd67f9944304  LICENSE
```

## Local usage notes (nothing upstream was edited)

- The skill points at siblings that are **not vendored** and must not be assumed to exist: `threejs-game-director`
  (including `scripts/probe_asset_credentials.sh` and `references/asset-recovery.md`), `threejs-qa-release`
  (`scripts/inspect-threejs-canvas.mjs`), `threejs-image-generator`, `threejs-3d-generator`, and the scaffold's
  `npm run inspect:canvas`. Skip those steps; `jammers-look` lists what replaces them here.
- Its defaults for Vite scaffolds, external generation keys, `EffectComposer` post and three `^0.184` do not override
  Joystick Jammers rules (self-hosted assets only, art via the Codex imagegen/Blender pipeline in master section 12.2,
  `WebGPURenderer` post as in `webgpu-threejs-tsl`, pinned three 0.182.0). The useful parts for us are the render
  budgets (`technical-art.md`), the scorecard and anchors (`visual-scorecard.md`) and `shader-cookbook.md`
  (`onBeforeCompile` patterns for the WebGLRenderer route, PMREM environment, glass and cheap tricks).
- `shader-cookbook.md` says three `^0.184`; the repo pins 0.182.0. `RoomEnvironment()` and `scene.environmentIntensity`
  notes there were not re-verified against 0.182.
