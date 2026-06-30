# 05 - Grade Performance Spike

> Status: implemented on 2026-06-29 and validation-repaired on 2026-06-30 for bead
> `br-skip-bin-arcade-design-language-5k3.2`.
>
> This is the checked-in G2 report referenced by [04-implementation-plan.md](04-implementation-plan.md)
> gate G2. It records the current host-grade ladder, the tone-map decision, the automated smoke
> harness, and representative measured evidence gathered from the live renderer.

---

## Scope guard

- **Local shared-screen host is the render target.** The laptop/desktop driving the TV owns the 3D
  world and the performance budget.
- **Local phones and keyboards are controllers/HUD only.** They are not part of the host-renderer
  budget and this spike does not treat them as such.
- **Remote viewers are separate.** They may degrade independently and must never gate Local host
  play. No Remote viewer measurements were used to block or relax the Local host ladder.

This follows `AGENTS.md` and `docs/plans/game-modes-and-flows.md` §3.

## What this spike locks now

### Tone-map decision

- **Decision:** skip ACES for the current grade stack.
- **Implementation:** `RenderSystem` now forces `renderer.toneMapping = NoToneMapping` and exposes
  that choice in stable diagnostics as `toneMapping.decision = "skip-aces"` and
  `toneMapping.mode = "NoToneMapping"`.
- **Why:** the Skip Bin Arcade direction wants a flatter, less cinematic grade. Accidental ACES on
  a post-composer path pulls the image toward the glossy Three.js default and is the wrong bias for
  the muted world / loud-player split called out in [02-design-language.md](02-design-language.md).
- **Readability check:** the native, degraded, and fallback screenshots keep player tags, lap HUD,
  and host controls readable while preserving the flatter palette.

### Current host ladder

The renderer now exposes four named host tiers:

| Tier | Resolution | Post | Bloom | Color grade | Chromatic aberration | Shadows |
|---|---:|---|---|---|---|---|
| `host-native` | `1.00` | on | on | on | on | `PCFSoftShadowMap` |
| `host-balanced` | `0.85` | on | on (reduced) | on (reduced) | off | `PCFSoftShadowMap` |
| `host-degraded` | `0.70` | on | off | on (reduced) | off | `BasicShadowMap` |
| `host-fallback` | `0.55` | off | off | off | off | off |

These are host-only tiers. The ladder is intentionally named from the Local shared-screen point of
view, not from controller hardware.

## Automated evidence harness

Commands used:

```bash
npm run build
GRADE_LADDER_EVIDENCE_DIR=artifacts/br-skip-bin-arcade-design-language-5k3.2 \
  npx playwright test \
    tests/e2e/visual-effects.spec.ts \
    tests/e2e/grade-ladder.spec.ts \
    tests/e2e/console-errors.spec.ts \
    --workers=1 --reporter=line
```

What the harness proves:

- grade tiers are enumerable and switchable at runtime;
- backend metadata stays stable while toggling tiers;
- the host canvas stays nonblank while toggling tiers;
- the committed tone-map choice is explicit in diagnostics;
- lobby, race, derby, and crowded-host scenes have screenshot evidence;
- fallback disables post-processing cleanly instead of blanking the host view.

Harness note:

- Playwright now starts the Flask server with `FLASK_DEBUG=0` so rewriting artifacts under the repo
  does not trigger the Werkzeug reloader mid-suite.

## Measured evidence

### Host/backend metadata

All captured tiers reported the same backend on the test host:

- `renderer = WebGLRenderer`
- `isWebGL2 = true`
- `precision = highp`
- `toneMapping = NoToneMapping`

### Scene timing bands

The harness records `averageRenderDurationMs` / `maxRenderDurationMs` after resetting the rolling
timing window on each tier change and sampling a short steady-state window. Those JSON files are
regenerated on every smoke run and are intentionally not treated as golden exact-match fixtures.

Numbers below are **representative observed bands** from the 2026-06-30 validation runs on this
workspace host. Fresh validation should confirm that the harness still writes populated diagnostics,
that screenshots remain nonblank/readable, and that timings stay in the same order of magnitude. It
should not fail solely because a fresh wall-clock sample differs by a few tenths of a millisecond.

#### Lobby profile (0 tracked vehicles, 1280x720 host viewport)

| Tier | Avg ms band | Max ms band |
|---|---:|---:|
| `host-native` | `0.329-0.383` | `0.800-2.400` |
| `host-balanced` | `0.314-0.419` | `1.000-4.000` |
| `host-degraded` | `0.237-0.269` | `0.500-0.800` |
| `host-fallback` | `0.117-0.156` | `0.200-0.800` |

#### Race profile (1 tracked vehicle)

| Tier | Avg ms band | Max ms band |
|---|---:|---:|
| `host-native` | `0.360-0.495` | `1.000-7.200` |
| `host-degraded` | `0.250-0.351` | `0.400-2.500` |
| `host-fallback` | `0.186-0.233` | `0.400-0.800` |

#### Crowded derby host profile (6 tracked vehicles)

| Tier | Avg ms band | Max ms band |
|---|---:|---:|
| `host-native` | `0.658-0.845` | `1.100-5.200` |
| `host-degraded` | `0.554-0.906` | `1.200-3.300` |
| `host-fallback` | `0.450-0.543` | `1.100-2.600` |

Interpretation:

- On the sampled machine, **fallback stayed in the cheapest timing band in every captured scene**,
  but the intermediate `balanced` and `degraded` tiers were not perfectly monotonic in every sample
  window. That is why the proposed adaptive controller relies on rolling averages, spike checks, and
  hysteresis instead of single snapshots.
- `host-fallback` is the readability floor: fog stays on, the scene remains legible, and the canvas
  does not blank even after post-processing and shadows are shed.
- The current measurements are for the **existing** render stack. When posterize/dither/grain and
  optional vertex snap land in later beads, this table must be rerun because those are expected to
  move the dominant cost.

## Adaptive ladder decision

This spike does not ship the full automatic controller from bead `...5k3.39`, but it does lock the
ladder inputs and the degrade/recover policy that controller should use.

### Detection inputs

- renderer backend and capability metadata from `getGradeDiagnostics()`
- rolling `averageRenderDurationMs`
- rolling `maxRenderDurationMs`
- tracked-vehicle count / camera target count
- post-processing init failure

### Degrade order

1. Preserve the Local shared-screen host view first; never budget against Local controller devices.
2. If future beads add `vertex snap`, `affine warp`, `dither`, or `grain`, shed those before the
   current ladder touches readability-critical world structure.
3. For the current committed stack, use:
   1. `host-native` -> `host-balanced`
   2. `host-balanced` -> `host-degraded`
   3. `host-degraded` -> `host-fallback`
4. The fallback floor may disable post-processing and shadows, but it must keep:
   - a nonblank 3D scene
   - fog/horizon separation
   - readable name tags and HUD
   - stable backend diagnostics

### Threshold proposal for `...5k3.39`

These are the thresholds this spike recommends for the adaptive controller:

| Transition | Enter when | Recover when |
|---|---|---|
| native -> balanced | avg render `> 8 ms` for a 120-frame window, or repeated spikes `> 16 ms` | avg render `< 6 ms` for 240 frames |
| balanced -> degraded | avg render `> 12 ms` for a 120-frame window, or repeated spikes `> 20 ms` | avg render `< 9 ms` for 240 frames |
| degraded -> fallback | avg render `> 16 ms`, repeated spikes `> 28 ms`, or post stack init failure | avg render `< 12 ms` for 240 frames and no init failure |

Rationale:

- `16.7 ms` is the 60 fps frame budget, so the ladder should step down before the host render alone
  consumes that entire budget.
- Recovery is intentionally slower than degradation to avoid visible oscillation on a shared screen.
- Max-spike checks exist because couch readability is harmed by repeated hitching even when the
  average is technically acceptable.

## Artifact set

Primary artifacts live under `artifacts/br-skip-bin-arcade-design-language-5k3.2/`.

Key screenshots:

- `lobby-host-native.png`
- `lobby-host-fallback.png`
- `race-host-native.png`
- `race-host-fallback.png`
- `derby-host-native.png`
- `derby-host-fallback.png`
- `lobby-high-player-host-native.png`
- `derby-high-player-host-degraded.png`

Key metrics:

- `lobby-grade-diagnostics.json`
- `race-grade-diagnostics.json`
- `derby-high-player-diagnostics.json`

Automated coverage:

- `tests/e2e/grade-ladder.spec.ts`
- `tests/e2e/visual-effects.spec.ts`
- `tests/e2e/console-errors.spec.ts`

## Residual risks

1. **Single physical host sample.** This workspace only produced one real host-browser profile. The
   ladder thresholds above are therefore calibrated from one normal host plus a crowded-scene stress
   case, not from a second weak laptop or weak Remote renderer device.
2. **Future grade passes will change the cost mix.** Posterize/dither/grain and optional vertex
   snap are not yet landed, so bead `...5k3.39` should treat these numbers as the baseline for the
   current stack and rerun once those effects exist.
3. **Remote viewer evidence is still separate work.** That is intentional. Remote viewers must
   degrade independently and must not redefine the Local host ladder.
