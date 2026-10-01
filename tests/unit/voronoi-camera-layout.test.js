import { describe, expect, it } from 'vitest';
import {
    buildVoronoiLayout,
    projectGroupCentroids
} from '../../static/js/geometry/VoronoiCameraLayout.js';

function polygonArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
}

describe('Voronoi camera layout', () => {
    it('uses one seamless full-screen cell when every subject belongs to one group', () => {
        const layout = buildVoronoiLayout([
            { id: 'together', x: 640, y: 360 }
        ], { width: 1280, height: 720 });

        expect(layout.mode).toBe('whole');
        expect(layout.cells).toHaveLength(1);
        expect(layout.cells[0].polygon).toEqual([
            { x: 0, y: 0 },
            { x: 1280, y: 0 },
            { x: 1280, y: 720 },
            { x: 0, y: 720 }
        ]);
        expect(polygonArea(layout.cells[0].polygon)).toBe(1280 * 720);
    });

    it('builds an angled perpendicular-bisector split for two diagonal groups', () => {
        const layout = buildVoronoiLayout([
            { id: 'north-west', x: 240, y: 160 },
            { id: 'south-east', x: 1040, y: 560 }
        ], { width: 1280, height: 720 });

        expect(layout.mode).toBe('voronoi');
        expect(layout.cells).toHaveLength(2);
        expect(layout.cells.every((cell) => cell.polygon.length >= 3)).toBe(true);
        const dividerPoints = layout.cells
            .flatMap((cell) => cell.polygon)
            .filter((point) =>
                (point.x > 0 && point.x < 1280) || (point.y > 0 && point.y < 720)
            );
        expect(new Set(dividerPoints.map((point) => `${point.x}:${point.y}`)).size).toBeGreaterThanOrEqual(2);

        const totalArea = layout.cells.reduce((sum, cell) => sum + polygonArea(cell.polygon), 0);
        expect(totalArea).toBeCloseTo(1280 * 720, 3);
    });

    it('covers the screen exactly with deterministic convex cells for a crowd', () => {
        const seeds = [
            { id: 'a', x: 180, y: 120 },
            { id: 'b', x: 980, y: 170 },
            { id: 'c', x: 370, y: 610 },
            { id: 'd', x: 1120, y: 570 },
            { id: 'e', x: 670, y: 360 }
        ];
        const first = buildVoronoiLayout(seeds, { width: 1280, height: 720 });
        const second = buildVoronoiLayout(seeds, { width: 1280, height: 720 });

        expect(first).toEqual(second);
        expect(first.cells).toHaveLength(5);
        expect(first.cells.every((cell) => cell.polygon.length >= 3)).toBe(true);
        expect(first.cells.every((cell) => cell.clipPath.startsWith('polygon('))).toBe(true);

        const totalArea = first.cells.reduce((sum, cell) => sum + polygonArea(cell.polygon), 0);
        expect(totalArea).toBeCloseTo(1280 * 720, 2);
    });

    it('projects world-space group centroids into directional, screen-safe seeds', () => {
        const seeds = projectGroupCentroids([
            { id: 'left', centroid: { x: -60, z: 20 } },
            { id: 'middle', centroid: { x: 0, z: -40 } },
            { id: 'right', centroid: { x: 80, z: 50 } }
        ], { width: 1000, height: 500, paddingRatio: 0.12 });

        expect(seeds.map((seed) => seed.id)).toEqual(['left', 'middle', 'right']);
        expect(seeds[0].x).toBeLessThan(seeds[1].x);
        expect(seeds[1].x).toBeLessThan(seeds[2].x);
        expect(seeds.every((seed) => seed.x >= 120 && seed.x <= 880)).toBe(true);
        expect(seeds.every((seed) => seed.y >= 60 && seed.y <= 440)).toBe(true);
    });
});
