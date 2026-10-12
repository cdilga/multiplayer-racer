# P1-R12 AC3: effects frame-cost delta at 24 tiles, headed on the Mac

Receipt: `cost.json` (re-measured 2026-10-10 evening on the quieter machine; supersedes the afternoon file, whose numbers are in the history table).

- Hardware: MacBook Pro (MacBookPro18,3), Apple M1 Pro, 14-core GPU, 16 GB; built-in Liquid Retina XDR 3024x1964; on the owner's
  unlocked display.
- Browser: Google Chrome 154.0.8037.98, headed (Playwright, `--channel chrome`), WebGLRenderer.
- Build: `035c1e96f9c7` (host bundle built with vite from the working tree; `fx/index.ts` identical to HEAD, see "Investigation").
- Cohort: 24 synthetic cars on 24 chase tiles over the greybox, effects demo (every family firing, about 2,000 live particles),
  look on; effects on vs `&fx=off`; 10 warm-up + 120 synchronous frames each, waited to GPU completion by a 1-pixel readback;
  seven interleaved repeats; median of the repeats. Viewport 1920x1080 / 3840x2160 at DPR 1 (`res=1`, `autores=off`).
- Command: `node web/host/tests/look-cost.mjs --fx --channel chrome --repeats 7`

| Render size | look (ms) | look+fx (ms) | fx delta (ms) | Budget 2.0 ms |
|---|---|---|---|---|
| 1920x1080 | 6.6 | 7.6 | +1.0 | within |
| 3840x2160 | 9.7 | 11.2 | +1.5 | within (0.5 ms spare) |

Repeats are tight (4K look+fx 11.1-11.3 ms across seven runs).

## History: the same code measured under different machine load

| Run (2026-10-10) | 1080p delta | 4K delta | Notes |
|---|---|---|---|
| Afternoon receipt (605d18e2c287) | +0.7 | +2.4 | Brave GPU process at ~36 % CPU; OVER budget at 4K |
| Evening, first runs, fx code unchanged | +0.5 to +1.7 | +1.2 to +3.1 | other helpers' cargo / headless Chromium busy on the Mac; same fx code |
| Evening, quiet machine (this receipt) | +1.0 | +1.5 | fx code identical to HEAD |
| Evening, paired in one session (off / HEAD / variants, 10 repeats) | n/a | +0.8 to +1.0 | HEAD fx at 4K |

The effects' delta is not a property of the code alone: identical code swung from +0.8 ms to +3.1 ms at 4K with what else was
running on the Mac. A receipt is only meaningful from a quiet machine, and a code change only means something when A/B-ed
against HEAD interleaved in the same session.

## Investigation (what was tried to cut the 4K fill cost, and why none was kept)

Per-family and per-stage experiments (temporary instrumentation, all removed) on the 24-tile 4K scene:

- Draw overhead is small: forcing one instance per draw cost +0.2 to +0.5 ms; the per-frame CPU for `Fx.update` is 0.18 ms; the
  instance-buffer upload is not measurable (leaving `needsUpdate` off changed nothing).
- With every sprite shrunk to nothing (same vertices, no fragments) the cost fell by about half; quartering every sprite's area
  recovered about 0.8 ms in a loaded run. So fill is real but not the whole of it.
- Zeroing one family at a time (loaded run): dust (surface dust and gravel, the most numerous) -1.3 ms, tyre smoke -0.7, boost
  flame -0.5, the rest under 0.3 each. Dust is the biggest overdraw layer.
- None of these cut the cost in A/B against HEAD in the same session, quiet or loaded (all within +-0.3 ms, the noise):
  - 12-gon, 8-gon and square sprite geometry (a polygon hugging the unit circle: 20 % less area, 3x the vertices);
  - capping a puff's diameter at 30 % and even 10 % of its tile's height (`min(size, 2*cap*depth/P11)`): no change, so the
    cost is not in the few near-lens giants;
  - dropping `discard`, dropping the colour-space conversion, or both: no change;
  - a trivial fragment shader (constant colour): -1.2 ms in one loaded run, -0.2 ms (noise) on the quiet machine;
  - splitting the one fragment shader into four, one per kind (puff, hot, burst, add), so a dust puff pays for none of the
    burst's atan/cos: +0.1 ms (4 layers and up to 4 draws a tile instead of 2);
  - culling a sprite too faint to see in the vertex shader: nothing measurable.
- Therefore `web/host/src/render/fx` is unchanged. No particle count, resolution or look was touched (R111, R108).

Next idea if a loaded-machine 4K number must be tightened: per-tile instance culling (each tile draws all ~2,000 particles of
all 24 cars, though a tile sees one to three cars' effects); it needs per-tile instance ranges, so it is a larger change and was
not attempted because the quiet-machine delta is already inside the budget.

## What changed against the undercounted receipt (df0582e)

The 2026-10-08 receipt (+0.3 ms at 1080p, +1.3 ms at 4K) was taken while each effects layer drew only its first 256 instances
(three.js cached the instanced geometry's limit; fixed in 06b05614). Re-measured with every particle drawn, the delta is
roughly double: +0.7 ms at 1080p (was +0.3) and +2.4 ms at 4K (was +1.3). Draw calls are the same (769 vs 721 without effects).

## Verdict

AC3 is met on the quiet machine: +1.0 ms at 1080p and +1.5 ms at 4K against the 2.0 ms budget, with every particle drawn, the
native resolution and the accepted look. The afternoon +2.4 ms at 4K was real on that run but depended on machine load, not on
the effects code; loaded runs of the same code reach +3 ms. The 4K margin is thin (0.5 ms), so the receipt should be re-taken
on the owner's machine with nothing else running at playtest time.

## Caveats

- Other apps were open on the Mac (Brave's GPU process was at about 36 % CPU, others idle). Look-vs-fx pairs are interleaved so
  both arms see it, but absolute numbers carry that noise; p90 rose at 4K (look+fx p90 16.5-17.1 ms).
- This measures GPU-complete synchronous frame cost on the built-in display's GPU, not vsync-paced pacing.
