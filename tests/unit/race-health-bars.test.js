import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RaceUI } from '../../static/js/ui/RaceUI.js';

/**
 * br-skip-bin-arcade-design-language-5k3.13 (P2.3) — Chunky segmented health bars.
 *
 * Unit-level proof of the pure segmentation/tier logic (deterministic, no DOM).
 * DOM/visual/overlap proof lives in tests/e2e/health-bars.spec.ts.
 */

describe('RaceUI health segmentation logic', () => {
    it('exposes a fixed segment count (chunky, not continuous)', () => {
        expect(RaceUI.SEGMENT_COUNT).toBe(10);
    });

    it('healthPercent clamps to 0..100 and tolerates bad maxHealth', () => {
        expect(RaceUI.healthPercent(50, 100)).toBe(50);
        expect(RaceUI.healthPercent(200, 100)).toBe(100); // clamp high
        expect(RaceUI.healthPercent(-10, 100)).toBe(0);   // clamp low
        expect(RaceUI.healthPercent(50, 0)).toBe(50);     // maxHealth<=0 -> treat as 100
    });

    it('lights zero segments only when dead', () => {
        expect(RaceUI.segmentsLit(0)).toBe(0);
    });

    it('lights all segments at full health', () => {
        expect(RaceUI.segmentsLit(100)).toBe(10);
    });

    it('keeps at least one segment lit while alive (nearly-dead still reads)', () => {
        expect(RaceUI.segmentsLit(1)).toBe(1);
        expect(RaceUI.segmentsLit(4)).toBe(1);   // rounds to 0 but floored to 1
        expect(RaceUI.segmentsLit(0.5)).toBe(1);
    });

    it('maps percent to discrete segment counts', () => {
        expect(RaceUI.segmentsLit(70)).toBe(7);
        expect(RaceUI.segmentsLit(45)).toBe(5); // 4.5 -> 5
        expect(RaceUI.segmentsLit(25)).toBe(3); // 2.5 -> 3
        expect(RaceUI.segmentsLit(15)).toBe(2); // 1.5 -> 2
    });

    it('never exceeds the segment count', () => {
        for (let p = 0; p <= 100; p++) {
            const lit = RaceUI.segmentsLit(p);
            expect(lit).toBeGreaterThanOrEqual(0);
            expect(lit).toBeLessThanOrEqual(RaceUI.SEGMENT_COUNT);
        }
    });

    it('tiers health into high/medium/low bands', () => {
        expect(RaceUI.healthTier(100)).toBe('high');
        expect(RaceUI.healthTier(51)).toBe('high');
        expect(RaceUI.healthTier(50)).toBe('medium');
        expect(RaceUI.healthTier(26)).toBe('medium');
        expect(RaceUI.healthTier(25)).toBe('low');
        expect(RaceUI.healthTier(0)).toBe('low');
    });
});

describe('RaceUI source is dither-safe (no thin gradient fills)', () => {
    const src = readFileSync(
        fileURLToPath(new URL('../../static/js/ui/RaceUI.js', import.meta.url)),
        'utf8'
    );

    it('renders a fixed segment track, not a width-animated gradient fill', () => {
        expect(src).toMatch(/health-bar-segments/);
        expect(src).toMatch(/health-seg/);
        expect(src).toMatch(/is-lit/);
        // Old continuous gradient fill is gone.
        expect(src).not.toMatch(/health-bar-fill/);
        expect(src).not.toMatch(/linear-gradient\([^)]*#00ff88/);
    });

    it('uses flat solid loud-palette colors for the tiers', () => {
        expect(src).toMatch(/#5CFF6A/); // LOUD.P5 acid green
        expect(src).toMatch(/#FFD23E/); // LOUD.P3 yellow
        expect(src).toMatch(/#FF3B3B/); // LOUD.P4 red
    });
});
