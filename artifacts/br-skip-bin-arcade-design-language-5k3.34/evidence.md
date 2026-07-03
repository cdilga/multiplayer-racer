# br-skip-bin-arcade-design-language-5k3.34 — Evidence

**Scope:** restyle fire/explosion, EMP, smoke, sparks, and vehicle trails to read
chunky / dithered / lo-fi (hard-edged) rather than soft additive glows. Visual/
style-only — no gameplay, damage, physics, or networking changes; no per-frame
logging. Implemented by CobaltTiger inside reserved files only.

## Files changed (reservations only)
- `static/js/systems/ParticleSystem.js` (3460)
- `static/js/systems/TrailSystem.js` (3461)
- `tests/unit/particle-style-language.test.js` (3462, new)
- `artifacts/br-skip-bin-arcade-design-language-5k3.34/**` (3463)

No RenderSystem / GameHost / WeaponSystem / Vehicle / materials / e2e / postprocessing files were touched.

## What changed (real runtime behavior, not unused metadata)
ParticleSystem:
- Presets carry explicit chunky `shape`: `explosion-fire`/`explosion-large`/`smoke` → `chunk`; `sparks` → `shard`. `vehicle-destroy` stays `box` (5k3.18, unchanged).
- `_particleGeometry()` consumes those: `chunk` → heavily-faceted low-poly `SphereGeometry(0.5, 5, 3)`; `shard` → small `BoxGeometry(0.18)`; `box` → `BoxGeometry(0.6)`; default → smooth sphere.
- Particle material is now hard-edged: explicit `THREE.NormalBlending` (never additive) + `dithering: true`.
- EMP `emp-shockwave` preset gains `ringSegments: 8`; `_createShockwaveGroup()` builds `RingGeometry(0.1, 0.5, ringSegments)` (was a smooth 32) and the ring material is normal-blended + dithered.

TrailSystem (was additive "MAXIMAL glow"):
- Default `config` is lo-fi: `blending: 'normal'`, `dithering: true`, chunkier `particleSize: 0.5`, fewer `density: 60`, `fadeSteps: 4`.
- Trail `PointsMaterial` consumes the config: `NormalBlending` (additive only if explicitly configured), `dithering` from config, chunky size.
- Age fade is quantized into hard bands via new pure helper `_quantizeFade()` (posterized), replacing the smooth gradient multiply.

## Effect-family → assertion map (tests/unit/particle-style-language.test.js, 12 tests)
| Effect family | Assertion(s) | Test |
|---|---|---|
| Fire/explosion geometry | low-poly faceted sphere, `widthSegments`/`heightSegments` < smooth 8 | `fire/explosion uses a heavily-faceted low-poly sphere` |
| Smoke geometry | chunky low-poly puff, `widthSegments <= 5` | `smoke uses a chunky low-poly puff` |
| Sparks geometry | hard-edged boxy shard, `isBoxGeometry`, width < debris box | `sparks are hard-edged boxy shards` |
| Shape metadata consumed | presets expose `chunk`/`chunk`/`shard` | `presets carry explicit chunky shape metadata` |
| Particle material (fire/explosion/smoke/sparks) | `blending === NormalBlending` (not additive) + `dithering === true` | `particle material uses normal blending + dithering` |
| EMP shockwave | `RingGeometry.thetaSegments <= 8` and `!= 32`, ring material dithered | `EMP shockwave is a chunky low-segment ring` |
| Trail defaults | `blending 'normal'` (not additive), `dithering true`, chunky size, `fadeSteps >= 2` | `default trail config is lo-fi` |
| Trail material | created `PointsMaterial` normal-blended + dithered + chunky size | `created trail material uses NORMAL (not additive) blending` |
| Trail fade | `_quantizeFade` returns exact `k/steps` bands; in-band values collapse | `quantizes the fade into hard bands (posterized)` |
| 5k3.18 non-regression | vehicle-destroy still `isBoxGeometry`, preset `shape === 'box'` | `vehicle-destroy debris is still boxy` |
| 5k3.18 non-regression | disabled → `null`, no group | `still returns null ... when disabled` |
| 5k3.18 non-regression | no-scene → `null`, no group | `still returns null ... with no scene` |

## Commands + results
- `npx vitest run tests/unit/particle-style-language.test.js tests/unit/particle-system-debris.test.js`
  - **PASS — Test Files 2 passed (2); Tests 21 passed (21)** (12 new restyle + 9 preserved 5k3.18 debris).
  - Log: `particle-style-vitest.log`
- `npm run build`
  - **PASS** — vite `✓ built in ~2.5s` (only the pre-existing >500kB chunk-size warning).
  - Log: `build.log`

## Preserved behavior
- 5k3.18 vehicle-destroy box debris + its 9 tests still pass.
- Cleanup/expiry, disable (`setEnabled(false)` → no new debris), and no-scene/no-THREE guards untouched and re-asserted here.
- No per-frame logging added (trail/particle update paths emit nothing per frame).

## Posture
Bead remains `in_progress`. Requesting fresh validation. Not closed.
