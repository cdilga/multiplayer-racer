import { describe, it, expect } from 'vitest';
import {
    tileViewports,
    splitTwo,
    verifyTiling,
    resolveViewportBudget,
    assignSeatsToViewports,
    buildWifesGrid,
    ASPECT_BOUNDS,
    DEFAULT_MIN_TILE,
} from '../../static/js/geometry/ViewportTiling.js';

const HD = { width: 1920, height: 1080 };
const UHD = { width: 3840, height: 2160 };

function tilesCoverExactly(layout) {
    const rep = verifyTiling(layout);
    return rep.covered && !rep.overlap;
}

describe('ViewportTiling - core tiling invariants (woq.8)', () => {
    it('K=1 is a single full-screen viewport', () => {
        const layout = tileViewports(1, HD);
        expect(layout.viewports).toHaveLength(1);
        const v = layout.viewports[0];
        expect(v).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
        expect(tilesCoverExactly(layout)).toBe(true);
    });

    it('K=2 landscape splits side-by-side; portrait stacks', () => {
        const land = tileViewports(2, HD);
        expect(land.rows).toBe(1);
        expect(land.viewports.map((v) => v.width)).toEqual([960, 960]);
        expect(land.viewports.map((v) => v.height)).toEqual([1080, 1080]);
        expect(tilesCoverExactly(land)).toBe(true);

        const port = tileViewports(2, { width: 1080, height: 1920 });
        expect(port.rows).toBe(2);
        expect(port.viewports.map((v) => v.height)).toEqual([960, 960]);
        expect(tilesCoverExactly(port)).toBe(true);
    });

    it('splitTwo matches the K=2 orientation rule', () => {
        expect(splitTwo(HD).rows).toBe(1);
        expect(splitTwo({ width: 1080, height: 1920 }).rows).toBe(2);
    });

    it('K>=3 produces compact rectangles that tile with no gaps/overlap and bounded aspect', () => {
        for (const k of [3, 4, 5, 6, 8, 9, 12, 16]) {
            for (const screen of [HD, UHD]) {
                const layout = tileViewports(k, screen);
                expect(layout.viewports).toHaveLength(k);
                const rep = verifyTiling(layout);
                expect(rep.covered, `k=${k} covers screen`).toBe(true);
                expect(rep.overlap, `k=${k} no overlap`).toBe(false);
                expect(rep.aspectWithinBounds, `k=${k} aspect in [${ASPECT_BOUNDS.min},${ASPECT_BOUNDS.max}]`).toBe(true);
            }
        }
    });

    it('is deterministic: identical inputs -> identical output', () => {
        const a = tileViewports(7, HD);
        const b = tileViewports(7, HD);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('HUD-safe content insets stay strictly inside each tile', () => {
        const layout = tileViewports(8, HD, {});
        for (const v of layout.viewports) {
            expect(v.content.x).toBeGreaterThan(v.x - 1e-9);
            expect(v.content.y).toBeGreaterThan(v.y - 1e-9);
            expect(v.content.x + v.content.width).toBeLessThanOrEqual(v.x + v.width + 1e-9);
            expect(v.content.y + v.content.height).toBeLessThanOrEqual(v.y + v.height + 1e-9);
            expect(v.content.width).toBeGreaterThan(0);
            expect(v.content.height).toBeGreaterThan(0);
        }
    });
});

describe('ViewportTiling - stable seat -> viewport assignment', () => {
    it('assigns by seatId, independent of input order (join/rejoin/order changes)', () => {
        const seatsA = [{ seatId: 3 }, { seatId: 1 }, { seatId: 2 }];
        const seatsB = [{ seatId: 2 }, { seatId: 3 }, { seatId: 1 }]; // reordered
        const mapA = assignSeatsToViewports(seatsA, 3);
        const mapB = assignSeatsToViewports(seatsB, 3);
        expect([...mapA.entries()].sort()).toEqual([...mapB.entries()].sort());
        // seatId 1 -> vp 0, 2 -> vp 1, 3 -> vp 2 (sorted seatId order)
        expect(mapA.get(1)).toBe(0);
        expect(mapA.get(2)).toBe(1);
        expect(mapA.get(3)).toBe(2);
    });

    it('a seat keeps its slot when another seat leaves and rejoins (seat persistence)', () => {
        const before = assignSeatsToViewports([1, 2, 3, 4], 4);
        // seat 2 disconnects; grid recomputed with 3 seats but same viewport count
        const during = assignSeatsToViewports([1, 3, 4], 4);
        expect(during.get(1)).toBe(before.get(1)); // seat 1 unchanged
        // seat 2 rejoins with the SAME seatId -> reclaims its stable slot
        const after = assignSeatsToViewports([1, 2, 3, 4], 4);
        expect(after.get(2)).toBe(before.get(2));
        expect(after.get(4)).toBe(before.get(4));
    });

    it('accepts raw seat ids or seat objects and round-robins when seats exceed viewports', () => {
        const map = assignSeatsToViewports([1, 2, 3, 4, 5], 2);
        expect(map.get(1)).toBe(0);
        expect(map.get(2)).toBe(1);
        expect(map.get(3)).toBe(0); // round-robin, stable by seatId
        expect(map.get(4)).toBe(1);
        expect(map.get(5)).toBe(0);
    });
});

describe("ViewportTiling - Wife's Grid Mode", () => {
    it('gives each seat its own viewport when they fit readably', () => {
        const seats = [1, 2, 3, 4].map((seatId) => ({ seatId }));
        const grid = buildWifesGrid(seats, HD);
        expect(grid.mode).toBe('wifes-grid');
        expect(grid.degraded).toBe(false);
        expect(grid.budget.viewportCount).toBe(4);
        expect(grid.layout.viewports).toHaveLength(4);
        expect(tilesCoverExactly(grid.layout)).toBe(true);
        // stable per-seat assignment
        expect(grid.assignment.get(1)).toBe(0);
        expect(grid.assignment.get(4)).toBe(3);
    });

    it('assignment is stable across join/rejoin and order changes', () => {
        const g1 = buildWifesGrid([{ seatId: 5 }, { seatId: 1 }, { seatId: 9 }], HD);
        const g2 = buildWifesGrid([{ seatId: 9 }, { seatId: 5 }, { seatId: 1 }], HD); // reordered
        expect([...g1.assignment.entries()].sort()).toEqual([...g2.assignment.entries()].sort());
        // a camera transition / rebuild with the same seats yields the same map
        const g3 = buildWifesGrid([{ seatId: 1 }, { seatId: 5 }, { seatId: 9 }], HD);
        expect([...g3.assignment.entries()].sort()).toEqual([...g1.assignment.entries()].sort());
    });

    it('downgrades to fewer readable viewports when there are too many seats', () => {
        const many = Array.from({ length: 32 }, (_, i) => ({ seatId: i + 1 }));
        const grid = buildWifesGrid(many, HD);
        expect(grid.requestedViewports).toBe(32);
        expect(grid.degraded).toBe(true);
        expect(grid.budget.viewportCount).toBeLessThan(32);
        // every rendered tile is still readable (>= min tile after HUD inset)
        for (const v of grid.layout.viewports) {
            expect(v.content.width).toBeGreaterThanOrEqual(DEFAULT_MIN_TILE.width - 1e-6);
            expect(v.content.height).toBeGreaterThanOrEqual(DEFAULT_MIN_TILE.height - 1e-6);
        }
        // all 32 seats still map to a viewport (clustered), none dropped
        expect(grid.assignment.size).toBe(32);
    });
});

describe('ViewportTiling - readability + performance guards', () => {
    it('reports viewport count and never returns unreadable tiles', () => {
        const budget = resolveViewportBudget(16, HD);
        expect(budget.requested).toBe(16);
        expect(budget.viewportCount).toBeGreaterThanOrEqual(1);
        const layout = tileViewports(budget.viewportCount, HD);
        for (const v of layout.viewports) {
            expect(v.content.width).toBeGreaterThanOrEqual(DEFAULT_MIN_TILE.width - 1e-6);
            expect(v.content.height).toBeGreaterThanOrEqual(DEFAULT_MIN_TILE.height - 1e-6);
        }
    });

    it('4K fits more readable viewports than 1080p (resolution feeds the ladder)', () => {
        const hd = resolveViewportBudget(16, HD);
        const uhd = resolveViewportBudget(16, UHD);
        expect(uhd.viewportCount).toBeGreaterThanOrEqual(hd.viewportCount);
    });

    it('flags degradation with a reason when the request exceeds what fits', () => {
        const budget = resolveViewportBudget(64, { ...HD, maxViewports: 16 });
        expect(budget.degraded).toBe(true);
        expect(budget.viewportCount).toBeLessThanOrEqual(16);
        expect(['below_readable', 'over_budget']).toContain(budget.reason);
    });

    it('does not downgrade when the request already fits readably', () => {
        const budget = resolveViewportBudget(2, HD);
        expect(budget.viewportCount).toBe(2);
        expect(budget.degraded).toBe(false);
        expect(budget.reason).toBeNull();
    });
});
