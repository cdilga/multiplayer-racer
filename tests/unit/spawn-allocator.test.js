import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpawnAllocator, createSpawnAllocator } from '../../static/js/resources/SpawnAllocator.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('SpawnAllocator - separation invariant (3xv.15)', () => {
    it('rejects exact-coordinate reuse and picks the next free candidate', () => {
        const alloc = new SpawnAllocator({ minSeparation: 3 });
        const candidates = [
            { x: 0, z: 0, id: 'a' },
            { x: 10, z: 0, id: 'b' }
        ];
        const result = alloc.allocate(candidates, { occupied: [{ id: 'live', x: 0, z: 0 }] });
        expect(result.ok).toBe(true);
        expect(result.position).toMatchObject({ x: 10, z: 0 });
        expect(result.diagnostics.rejected[0].reason).toBe('exact_point_reuse');
        expect(result.diagnostics.rejected[0].occupantId).toBe('live');
    });

    it('rejects footprint overlap within minSeparation', () => {
        const alloc = new SpawnAllocator({ minSeparation: 3 });
        // Candidate 2 units from a live car (< 3) => overlap; candidate at 12 is free.
        const result = alloc.allocate(
            [{ x: 2, z: 0 }, { x: 12, z: 0 }],
            { occupied: [{ id: 'live', x: 0, z: 0 }] }
        );
        expect(result.position).toMatchObject({ x: 12, z: 0 });
        expect(result.diagnostics.rejected[0].reason).toBe('footprint_overlap');
        expect(result.diagnostics.rejected[0].minPairDistance).toBeCloseTo(2, 6);
    });

    it('honours live reservations and post-release cooldown', () => {
        let clock = 1000;
        const alloc = new SpawnAllocator({ minSeparation: 3, cooldownMs: 500, now: () => clock });
        alloc.reserve('p1', { x: 0, z: 0 });
        // p1 holds (0,0): a candidate there is blocked.
        expect(alloc.allocate([{ x: 0, z: 0 }], {}).diagnostics.rejected[0].reason).toBe('exact_point_reuse');

        // Release => point enters cooldown, still blocked immediately.
        alloc.release('p1');
        expect(alloc.allocate([{ x: 0, z: 0 }, { x: 20, z: 0 }], {}).position).toMatchObject({ x: 20, z: 0 });

        // After cooldown expires the point frees up.
        clock += 600;
        expect(alloc.allocate([{ x: 0, z: 0 }], {}).position).toMatchObject({ x: 0, z: 0 });
    });

    it('falls back to deterministic jitter (never a stack) when all candidates collide', () => {
        const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
        let i = 0;
        const nextFloat = () => seq[(i++) % seq.length];
        const alloc = new SpawnAllocator({ minSeparation: 3, nextFloat });
        // Only one candidate and it's occupied => must jitter to a distinct point.
        const result = alloc.allocate([{ x: 0, z: 0 }], { occupied: [{ id: 'live', x: 0, z: 0 }] });
        expect(result.ok).toBe(true);
        expect(result.fallback).toBe(true);
        expect(result.reason).toBe('jitter_fallback');
        // Never the exact occupied point.
        expect(result.position.x === 0 && result.position.z === 0).toBe(false);
        // And genuinely separated from the occupant.
        expect(Math.hypot(result.position.x, result.position.z)).toBeGreaterThanOrEqual(3 - 1e-9);
    });

    it('is deterministic: identical inputs + RNG => identical placement', () => {
        const make = () => {
            const seq = [0.11, 0.22, 0.33, 0.44, 0.55, 0.66];
            let i = 0;
            return new SpawnAllocator({ minSeparation: 3, nextFloat: () => seq[(i++) % seq.length] });
        };
        const occupied = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 1, z: 0 }];
        const r1 = make().allocate([{ x: 0, z: 0 }], { occupied });
        const r2 = make().allocate([{ x: 0, z: 0 }], { occupied });
        expect(JSON.stringify(r1.position)).toBe(JSON.stringify(r2.position));
    });

    it('respects an inBounds predicate (no placement into a void)', () => {
        const alloc = new SpawnAllocator({ minSeparation: 3 });
        // Candidate at x=100 is out of bounds; x=5 is in bounds and free.
        const inBounds = (p) => Math.abs(p.x) <= 50 && Math.abs(p.z) <= 50;
        const result = alloc.allocate([{ x: 100, z: 0 }, { x: 5, z: 0 }], { inBounds });
        expect(result.position).toMatchObject({ x: 5, z: 0 });
        expect(result.diagnostics.rejected[0].reason).toBe('out_of_bounds');
    });

    it('emits structured diagnostics (occupant, min pair distance, reasons, meta)', () => {
        const alloc = createSpawnAllocator({ minSeparation: 3 });
        const result = alloc.allocate([{ x: 0, z: 0 }, { x: 30, z: 0 }], {
            occupied: [{ id: 'p7', x: 0, z: 0 }],
            meta: { requesterId: 'p17', mapId: 'derby-arena', seed: 42, ruleset: 'derby', phase: 'respawn', playerCount: 17 }
        });
        expect(result.diagnostics).toMatchObject({
            requesterId: 'p17', mapId: 'derby-arena', seed: 42, ruleset: 'derby', phase: 'respawn', playerCount: 17
        });
        expect(result.diagnostics.rejected[0]).toMatchObject({ reason: 'exact_point_reuse', occupantId: 'p7' });
    });

    it('the player-17 wrap case never reuses player-1\'s point across a full grid', () => {
        // Grid of 16 occupied spawns; a 17th placement must not land on any of them.
        const alloc = new SpawnAllocator({ minSeparation: 3 });
        const grid = Array.from({ length: 16 }, (_, i) => ({ id: `p${i + 1}`, x: (i % 4) * 6, z: Math.floor(i / 4) * 6 }));
        // Candidate list wraps back to p1's point (the classic modulo bug).
        const result = alloc.allocate([{ x: 0, z: 0 }, { x: 40, z: 40 }], { occupied: grid });
        expect(result.ok).toBe(true);
        for (const occ of grid) {
            expect(result.position.x === occ.x && result.position.z === occ.z).toBe(false);
        }
    });

    it.each([32, 64, 100])('places N=%i entrants on a real grid with no two on the same point (capacity stress)', (n) => {
        const alloc = new SpawnAllocator({ minSeparation: 2, footprintRadius: 0.8 });
        // Realistic spawns: each entrant has its own well-separated grid slot.
        const cols = 12;
        const grid = Array.from({ length: n }, (_, k) => ({ x: (k % cols) * 3, z: Math.floor(k / cols) * 3 }));
        const placed = [];
        for (let k = 0; k < n; k += 1) {
            const result = alloc.allocate([grid[k]], { occupied: placed.map((p, idx) => ({ id: `c${idx}`, ...p })) });
            expect(result.ok).toBe(true);
            placed.push({ x: result.position.x, z: result.position.z });
            alloc.reserve(`c${k}`, result.position);
        }
        const keys = new Set(placed.map((p) => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`));
        expect(keys.size).toBe(n);
    });

    it('never stacks under pathological crowding — fans out or refuses, never duplicates', () => {
        const alloc = new SpawnAllocator({ minSeparation: 3 });
        const placed = [];
        // All entrants prefer the SAME point; the allocator jitters them apart and,
        // once the local space is exhausted, refuses (ok:false) rather than stacking.
        for (let k = 0; k < 12; k += 1) {
            const r = alloc.allocate([{ x: 0, z: 0 }], { occupied: placed.map((p, i) => ({ id: `p${i}`, ...p })) });
            if (r.ok) {
                for (const p of placed) expect(p.x === r.position.x && p.z === r.position.z).toBe(false);
                placed.push({ x: r.position.x, z: r.position.z });
            } else {
                expect(r.reason).toBe('no_safe_placement');
            }
        }
    });

    it('uses no direct Math.random in the source', () => {
        const src = readFileSync(resolve(repoRoot, 'static/js/resources/SpawnAllocator.js'), 'utf8');
        expect(src).not.toMatch(/Math\.random/);
    });
});
