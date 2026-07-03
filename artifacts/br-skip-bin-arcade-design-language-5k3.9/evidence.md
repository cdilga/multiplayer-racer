# br-skip-bin-arcade-design-language-5k3.9 — Evidence (CobaltTiger)

**Scope:** P1.7 — replace expensive full-scene soft (PCFSoft) shadow maps with cheap
per-car dithered blob contact shadows that read on the host screen. Local-mode
invariant preserved (host renders the world; controllers unaffected); remote
viewers render the same local blob and never touch authoritative sim/network.

## Reservations (exclusive)
- 3534 `static/js/resources/VehicleFactory.js`
- 3535 `static/js/systems/RenderSystem.js`
- 3536 `tests/unit/vehicle-contact-shadow.test.js` (new)
- 3537 `tests/e2e/contact-shadows.spec.ts` (new)
- 3538 `artifacts/br-skip-bin-arcade-design-language-5k3.9/**`

RenderSystem.js + VehicleFactory.js were already dirty with other agents' WIP
(NobleBay 5k3.8 grain in RenderSystem; lo-fi-warp in MaterialFactory). My edits are
surgical/additive and preserve that WIP. No ColorGradingShader / AdaptiveQualityController
/ GameHost / TrackFactory / visual-effects.spec touched.

## What changed
VehicleFactory.js:
- `bodyMesh`, `roofMesh`, and every wheel now set `castShadow = false` — car parts no
  longer cast real shadows.
- New `_createContactShadow(width, length)` adds exactly ONE grounded blob per car:
  a flat `PlaneGeometry` quad laid on the ground at `y = 0.02`, `userData.isContactShadow`,
  `castShadow=false`, `receiveShadow=false`, `renderOrder=-1`.
- New `_createContactShadowMaterial()` / `_createContactShadowTexture()`: a nearest-filtered
  **dithered radial CanvasTexture** blob (dark centre → transparent edge, checkerboard alpha
  dither) in the browser; a plain transparent dark fallback material where no canvas exists.

RenderSystem.js:
- All four grade tiers now `shadowsEnabled: false, shadowMapType: 'none'` (were pcf-soft/basic).
- Init no longer forces PCFSoft: `renderer.shadowMap.enabled = false; type = BasicShadowMap`.
- `_resolveShadowMapType()` no longer defaults to PCFSoftShadowMap ('none'/unknown → BasicShadowMap).
- `getGradeDiagnostics().shadows` gains `mode: renderer.shadowMap.enabled ? 'full-scene' : 'contact-blob'`.

No per-frame/per-tick logging added (my diffs add zero console calls; the console lines in the
whole-file diff are pre-existing one-time init/error logs from other agents' WIP).

## Commands + results
- `npx vitest run tests/unit/vehicle-contact-shadow.test.js` => **PASS, 7 tests** (`vitest.log`).
- Regression: `+ render-grade-ladder.test.js + color-grading-shader.test.js` => **24/24 PASS**
  (my shadow changes do not regress NobleBay's 5k3.8 grade ladder).
- `npm run build` => **PASS**, vite `✓ built in 2.66s` (`build.log`).
- `npx playwright test tests/e2e/contact-shadows.spec.ts` => **1 passed (3.5s)** from a clean
  server serving freshly-built production dist (a stale dev server was killed first).

## Unit coverage → assertion
| Requirement | Test |
|---|---|
| Exactly one contact-shadow mesh per car | `adds exactly one contact-shadow blob per car` |
| Blob transparent, grounded (y 0..0.1), no cast/receive | `the contact shadow is transparent, grounded, ...` |
| No car part casts a real shadow | `no car part casts a real shadow anymore` |
| No grade tier uses pcf-soft | `no grade tier uses a pcf-soft shadow map type` |
| Resolver does not default to PCFSoft | `the shadow-type resolver no longer defaults to PCFSoftShadowMap` |
| Init does not force PCFSoft | `does not force PCFSoftShadowMap on the renderer at init` |
| Diagnostics expose contact/disabled mode | `exposes a contact/disabled shadow mode in diagnostics` |

## Runtime evidence (`contact-shadows-diagnostics.json`, real browser values)
- `shadows`: `{ enabled: false, type: 'BasicShadowMap', mode: 'contact-blob' }` — no PCFSoft.
- All 4 tiers (host-native/balanced/degraded/fallback): `shadowsEnabled: false, shadowMapType: 'none'`.
- Production `VehicleFactory._createVisualMesh` build: `contactShadowCount: 1`, `shadowTransparent: true`,
  `shadowHasTextureMap: true` (real CanvasTexture dithered blob), `shadowCastsReal: false`,
  `shadowReceivesReal: false`, `shadowGroundedY: 0.02`, `anyPartCastsShadow: false`.
- Screenshot: `contact-shadow-host.png` (blob added to the live host scene).

## Invariants
- Local host renders the world; contact shadow is a host-side mesh, controllers unchanged.
- Remote viewers build the same local blob (VehicleFactory is shared) and it never affects
  authoritative sim/network — purely visual.

## Posture
Bead remains `in_progress`. Requesting fresh validation. Not closed.
