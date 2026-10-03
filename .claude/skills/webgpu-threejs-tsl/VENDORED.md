# Vendored: webgpu-threejs-tsl

| | |
|---|---|
| Source | https://github.com/dgreenheck/webgpu-claude-skill (path `skills/webgpu-threejs-tsl/`) |
| Commit | `af2319bd01bb7cc881267a9ef42cafdaf5e9029d` (2026-04-10, "Add Cursor rules that reference the existing skill docs") |
| Fetched | 2026-10-03 as the GitHub tarball `codeload.github.com/dgreenheck/webgpu-claude-skill/tar.gz/<sha>`; nothing was installed or run |
| Author | Daniel (Dan) Greenheck; the skill declares itself aligned with three.js r183+ (README: "Last updated April 1, 2026") |
| Licence | **MIT, declared but not shipped as a file.** Upstream has no LICENSE file and GitHub's licence API reports none. README.md says "MIT License" (and that its examples derive from three.js, MIT), and `.claude-plugin/plugin.json` has `"license": "MIT"`. The `LICENSE` here is the standard MIT text reconstructed by the vendoring agent (see the note at its top). If the owner wants certainty, ask upstream to add a LICENSE file or replace this skill. |
| Bead | P1-F11 (Shader skills) |

## Read-through (2026-10-03)

Every file in the upstream repository was read before anything was copied: README.md, both `.claude-plugin/*.json`,
all five `.cursor/rules/*.mdc`, `SKILL.md`, `REFERENCE.md`, the seven `docs/*.md`, the five `examples/*.js` and the two
`templates/*.js`. The skill is documentation plus example source for three.js `WebGPURenderer` and TSL (node materials,
post-processing, compute, WGSL, device loss, limits). The `.js` files are browser examples that import `three/webgpu`
and `three/tsl`; none is executed by installing or loading the skill, and none uses `fetch`, `eval`, `import()`, shell
or any network call (they only call `TextureLoader.load` on placeholder paths such as `textures/earth_day.jpg`, which
do not exist). The docs contain ordinary web snippets (`localStorage`, `location.reload()`, a Chrome command line for
GPU-crash testing) as illustrations only. There is no installer, hook, script, binary or package manifest.

## Removed on vendoring

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`: plugin-marketplace install metadata. We vendor by copy.
- `.cursor/rules/*.mdc`: Cursor shims that `@file`-reference `skills/webgpu-threejs-tsl/...`; those paths don't exist here and Cursor isn't used.
- `README.md` (repo root): install instructions and a duplicate of `SKILL.md`. Its licence lines are quoted above.

Everything else is byte-identical to the upstream commit. sha256 of the vendored files:

```
a1bdeae07261a81e1cb4f7a2e41d775f12248dfd5a6d3b4d56424027181c1d04  docs/compute-shaders.md
6370958d89a16c5f44ee881051b60eb6f75d012670e311bdb5598eb139b4fbda  docs/core-concepts.md
6549cedb1dfe265812836fe54f22bf422495b015d6a611e82dd98b99517c22d4  docs/device-loss.md
f7d2a22aab397f6a0cd44f38c6c17746dc0fea75be78e77cef8aa8828a4bd751  docs/limits-and-features.md
3e9073bf4360577babe0d69650401aa3aa9b308444a1a830bb6996942bcd943c  docs/materials.md
99b7373b4f66e0adcd8084c8926dd074a995129bb3c2b168e3a438f5c0a68110  docs/post-processing.md
d1a55e68767d6f9fd4510368b8c9a0cf9242fa716680278b4cdfe93e59683cab  docs/wgsl-integration.md
634d2732109f5d91aa4adc389fb869553e7a6830f1e3867c816b4e966dce8e9f  examples/basic-setup.js
8fc8bd33d484741524d00843e82d02631eb3212cf3e2b0d4ba56228cb8b2d797  examples/custom-material.js
141c45e1f0596e9f1b875821d4292f136ab6f71e3759a3b3a0071a11780d4700  examples/earth-shader.js
df1eed8642987e47ad89be2b8f10e09989f0dafe633594ad22dbdb4d905dc27b  examples/particle-system.js
0f7baf448e08f36b2830dc5d980b7fa692e50020becfb533dc41100f8c7403d4  examples/post-processing.js
aa3e1828e9d02f35c149a649ff2731e2cd2ea5147c7c62796bc02ee6b99cb642  REFERENCE.md
734ac9724c9dae2a2c9ad1e59f96d37498a87871eaddb6e8a7fd903d36b2cb90  SKILL.md
98fd80dec62e15c76b6828b3e7fe81e2262e20b09e9045c5499b3a1a89b40ab5  templates/compute-shader.js
9c7f85ac318f9d16ccfb7ae91506fa750cf510abef3650b022b2211ec8fca3e3  templates/webgpu-project.js
```

## Local usage notes (nothing upstream was edited)

- Our pinned three.js is **0.182.0** (root `node_modules/three`). Upstream targets r183+. In r182 `three/webgpu` exports
  **`PostProcessing` only** (`THREE.RenderPipeline` is `undefined`, verified in a browser); `docs/post-processing.md` and the
  examples use `RenderPipeline`, which replaced `PostProcessing` in r183. Substitute the class until the pin moves, and check
  any other r183+ name in the installed build before copying a snippet.
- Joystick Jammers rules win over anything here: no CDN imports, self-hosted libraries, no arbitrary caps on cars or
  tiles. The `jammers-look` skill is the entry point for our comic look; this skill is the TSL reference behind it.
