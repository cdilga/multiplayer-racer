# P1-R12 AC3: effects frame-cost delta at 24 tiles, headed on the Mac

Receipt: `cost.json` (re-measured 2026-10-10; replaces the 2026-10-08 file).

- Hardware: MacBook Pro (MacBookPro18,3), Apple M1 Pro, 14-core GPU, 16 GB; built-in Liquid Retina XDR 3024x1964; on the owner's
  unlocked display.
- Browser: Google Chrome 154.0.8037.98, headed (Playwright, `--channel chrome`), WebGLRenderer.
- Build: `605d18e2c287` (`npm --prefix web run build` immediately before).
- Cohort: 24 synthetic cars on 24 chase tiles over the greybox, effects demo (every family firing, about 2,000 live particles),
  look on; effects on vs `&fx=off`; 10 warm-up + 120 synchronous frames each, waited to GPU completion by a 1-pixel readback;
  three interleaved repeats; median of the repeats. Viewport 1920x1080 / 3840x2160 at DPR 1 (`res=1`, `autores=off`).
- Command: `node web/host/tests/look-cost.mjs --fx --channel chrome`

| Render size | look (ms) | look+fx (ms) | fx delta (ms) | Budget 2.0 ms |
|---|---|---|---|---|
| 1920x1080 | 7.6 | 8.3 | +0.7 | within |
| 3840x2160 | 11.1 | 13.5 | +2.4 | OVER by 0.4 |

## What changed against the undercounted receipt (df0582e)

The 2026-10-08 receipt (+0.3 ms at 1080p, +1.3 ms at 4K) was taken while each effects layer drew only its first 256 instances
(three.js cached the instanced geometry's limit; fixed in 06b05614). Re-measured with every particle drawn, the delta is
roughly double: +0.7 ms at 1080p (was +0.3) and +2.4 ms at 4K (was +1.3). Draw calls are the same (769 vs 721 without effects).

## Verdict

1080p is within the 2.0 ms budget. At 4K the effects cost 2.4 ms, 0.4 ms over. That is a real overrun, not recorded away. Next
step: the cost is fill-rate bound (it scales with pixels, +1.7 ms from 1080p to 4K), so shrink the biggest-overdraw layers
(damage smoke, wreck fire, dust puffs) at 4K by on-screen size, not by count, and re-run this command.

## Caveats

- Other apps were open on the Mac (Brave's GPU process was at about 36 % CPU, others idle). Look-vs-fx pairs are interleaved so
  both arms see it, but absolute numbers carry that noise; p90 rose at 4K (look+fx p90 16.5-17.1 ms).
- This measures GPU-complete synchronous frame cost on the built-in display's GPU, not vsync-paced pacing.
