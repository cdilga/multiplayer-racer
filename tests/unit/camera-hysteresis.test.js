import { describe, it, expect } from 'vitest';
import { CameraLayoutStabilizer } from '../../static/js/systems/cameraHysteresis.js';

// Feed a scripted (desired, dtMs) trace and return the stable-count series.
function run(stab, trace) {
    let now = 0;
    const out = [];
    for (const [desired, dt] of trace) {
        now += dt;
        out.push(stab.update(desired, now));
    }
    return out;
}

describe('CameraLayoutStabilizer (woq.9)', () => {
    it('commits a change only after it persists past the debounce', () => {
        const s = new CameraLayoutStabilizer({ debounceMs: 500, initial: 1 });
        // Desired jumps to 3 and holds; commits only after 500ms.
        expect(s.update(3, 100)).toBe(1);   // pending starts
        expect(s.update(3, 400)).toBe(1);   // still within debounce
        expect(s.update(3, 650)).toBe(3);   // 550ms held -> commit
        expect(s.transitions).toBe(1);
    });

    it('a brief spike does NOT retile (debounced), and counts as suppressed thrash', () => {
        const s = new CameraLayoutStabilizer({ debounceMs: 500, initial: 1 });
        expect(s.update(4, 100)).toBe(1);   // spike -> pending
        expect(s.update(1, 150)).toBe(1);   // back to 1 within 50ms -> spike fizzles
        expect(s.current).toBe(1);
        expect(s.transitions).toBe(0);
        expect(s.suppressedThrash).toBeGreaterThan(0);
    });

    it('hysteresis dead-band ignores jitter around the current count', () => {
        // Split needs current+2; a desired that oscillates 1<->2 never splits from 1.
        const s = new CameraLayoutStabilizer({ debounceMs: 200, splitMargin: 2, mergeMargin: 2, initial: 1 });
        const series = run(s, [[2, 100], [1, 100], [2, 100], [1, 100], [2, 100]]);
        expect(series.every((c) => c === 1)).toBe(true);
        expect(s.transitions).toBe(0);
    });

    it('a scatter -> converge -> scatter trace stays below a thrash threshold', () => {
        const s = new CameraLayoutStabilizer({ debounceMs: 500, splitMargin: 1, mergeMargin: 1, initial: 1 });
        // 60 frames @ ~16ms. Cars scatter (want 4) for 1s, converge (want 1) for 1s,
        // scatter again (want 4) for 1s — each phase held well past debounce, but with
        // per-frame noise of +/-1 that must NOT cause extra transitions.
        const trace = [];
        const phase = (base, frames) => {
            for (let i = 0; i < frames; i++) {
                const noise = (i % 3 === 0) ? 1 : (i % 3 === 1 ? -1 : 0);
                trace.push([Math.max(1, base + noise), 16]);
            }
        };
        phase(4, 62);   // ~1s scatter
        phase(1, 62);   // ~1s converge
        phase(4, 62);   // ~1s scatter
        run(s, trace);
        // The genuine layout changes are 1->4, 4->1, 1->4 = 3 transitions. Noise must
        // not inflate this: assert we stayed at or below that (thrash suppressed).
        expect(s.transitions).toBeLessThanOrEqual(3);
        expect(s.transitions).toBeGreaterThanOrEqual(2);
        // Ends scattered (near 4, allowing the +/-1 noise at the commit frame).
        expect(s.current).toBeGreaterThanOrEqual(3);
        expect(s.current).toBeLessThanOrEqual(5);
    });

    it('exposes diagnostics for the camera debug panel', () => {
        const s = new CameraLayoutStabilizer({ debounceMs: 300, initial: 2 });
        s.update(5, 100); s.update(5, 500);
        const d = s.diagnostics();
        expect(d).toMatchObject({ current: 5, transitions: 1, debounceMs: 300 });
        expect(d).toHaveProperty('suppressedThrash');
        expect(d).toHaveProperty('lastTransitionDurationMs');
    });
});
