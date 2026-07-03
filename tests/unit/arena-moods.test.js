import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * br-skip-bin-arcade-design-language-5k3.31
 * P6.2: Per-arena moods as data — authored via existing per-track JSON lighting;
 * 4 distinct moods (Dusk Lot / Sodium Tunnel / Toxic Dunes / VHS Stadium), all in
 * the world palette (no loud/neon lighting).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = (id) => JSON.parse(readFileSync(resolve(repoRoot, `static/assets/tracks/${id}.json`), 'utf8'));

const DERBY_ARENAS = ['derby-arena', 'derby-bowl', 'derby-coliseum', 'derby-dunes'];

// WORLD_PALETTE (static/js/visual/palette.js), upper-case hex strings.
const WORLD_PALETTE = new Set([
    '#14110F', '#2A2620', '#6B5A41', '#7A4A2E', '#4B5A3A', '#3A3550', '#8A7E6B', '#C9BBA0'
]);

describe('per-arena moods as data (5k3.31)', () => {
    it('each derby arena declares a named mood via its lighting data', () => {
        const moods = DERBY_ARENAS.map((id) => load(id).lighting?.mood);
        for (const mood of moods) {
            expect(mood, 'arena is missing lighting.mood').toBeTruthy();
            expect(typeof mood.id).toBe('string');
            expect(typeof mood.name).toBe('string');
        }
        // Four DISTINCT moods.
        expect(new Set(moods.map((m) => m.id)).size).toBe(4);
        expect(new Set(moods.map((m) => m.name)).size).toBe(4);
    });

    it('ships the four named Skip Bin moods', () => {
        const names = DERBY_ARENAS.map((id) => load(id).lighting?.mood?.name);
        expect(new Set(names)).toEqual(new Set(['Dusk Lot', 'Sodium Tunnel', 'Toxic Dunes', 'VHS Stadium']));
    });

    it('every mood lights the arena from the world palette (no loud/neon light)', () => {
        for (const id of DERBY_ARENAS) {
            const lighting = load(id).lighting || {};
            const ambient = String(lighting.ambient?.color || '').toUpperCase();
            const directional = String(lighting.directional?.color || '').toUpperCase();
            expect(WORLD_PALETTE.has(ambient), `${id} ambient ${ambient} not in world palette`).toBe(true);
            expect(WORLD_PALETTE.has(directional), `${id} directional ${directional} not in world palette`).toBe(true);
        }
    });

    it('moods are visually distinct (ambient colours differ across arenas)', () => {
        const ambients = DERBY_ARENAS.map((id) => String(load(id).lighting?.ambient?.color || '').toUpperCase());
        expect(new Set(ambients).size).toBe(4);
    });
});
