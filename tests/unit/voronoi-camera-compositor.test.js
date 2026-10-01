import { describe, expect, it } from 'vitest';
import { buildVoronoiLayout } from '../../static/js/geometry/VoronoiCameraLayout.js';
import {
    MAX_VORONOI_CAMERA_CELLS,
    VoronoiCameraCompositor,
    renderVoronoiCameraTarget
} from '../../static/js/rendering/VoronoiCameraCompositor.js';

describe('VoronoiCameraCompositor', () => {
    it('lets the render target establish its physical viewport at high device pixel ratios', () => {
        const calls = [];
        const renderer = {
            setRenderTarget: (target) => calls.push(['target', target]),
            setScissorTest: (enabled) => calls.push(['scissor', enabled]),
            setViewport: (...args) => calls.push(['viewport', ...args]),
            clear: (...args) => calls.push(['clear', ...args]),
            render: (...args) => calls.push(['render', ...args])
        };
        const target = { width: 990, height: 477 };
        const scene = {};
        const camera = {
            updateMatrixWorld: (force) => calls.push(['camera-matrix', force])
        };

        renderVoronoiCameraTarget(renderer, target, scene, camera);

        expect(calls).toEqual([
            ['target', target],
            ['scissor', false],
            ['camera-matrix', true],
            ['clear', true, true, true],
            ['render', scene, camera]
        ]);
        expect(calls.some(([name]) => name === 'viewport')).toBe(false);
    });

    it('allocates a scaled camera target per active cell and wires all shader inputs', () => {
        const compositor = new VoronoiCameraCompositor({ maxCells: 6 });
        const layout = buildVoronoiLayout([
            { id: 'a', x: 140, y: 90 },
            { id: 'b', x: 860, y: 110 },
            { id: 'c', x: 300, y: 430 },
            { id: 'd', x: 760, y: 410 }
        ], { width: 1000, height: 500 });
        const targets = compositor.ensureTargets(4, layout.width, layout.height);
        const calls = [];
        const renderer = {
            setRenderTarget: (target) => calls.push(['target', target]),
            setScissorTest: (enabled) => calls.push(['scissor', enabled]),
            setViewport: (...args) => calls.push(['viewport', ...args]),
            render: (scene, camera) => calls.push(['render', scene, camera])
        };

        compositor.compose(renderer, layout, { fusion: 0.65 });

        expect(MAX_VORONOI_CAMERA_CELLS).toBe(8);
        expect(targets).toHaveLength(4);
        expect(targets[0].width).toBe(720);
        expect(targets[0].height).toBe(360);
        expect(compositor.material.uniforms.uCellCount.value).toBe(4);
        expect(compositor.material.uniforms.uFusion.value).toBeCloseTo(0.65);
        expect(compositor.material.uniforms.uMap3.value).toBe(targets[3].texture);
        const firstRect = compositor.material.uniforms.uRects.value[0];
        expect(firstRect.x + firstRect.z / 2).toBeCloseTo(layout.cells[0].centroid.x / layout.width);
        expect(firstRect.y + firstRect.w / 2).toBeCloseTo(1 - (layout.cells[0].centroid.y / layout.height));
        expect(calls.at(-1)[0]).toBe('render');
        expect(compositor.getDiagnostics()).toMatchObject({
            active: true,
            cellCount: 4,
            fusion: 0.65,
            targetWidth: 720,
            targetHeight: 360
        });

        compositor.dispose();
        expect(compositor.targets).toEqual([]);
    });
});
