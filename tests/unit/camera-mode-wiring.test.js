import { describe, expect, it } from 'vitest';
import { RenderSystem } from '../../static/js/systems/RenderSystem.js';

function createRenderSystem() {
    return new RenderSystem({ eventBus: null, container: {} });
}

describe('RenderSystem host camera mode wiring', () => {
    it('exposes Voronoi Party, grid, and focused modes in picker order', () => {
        const render = createRenderSystem();

        expect(render.cameraModeOrder).toEqual(['party', 'grid', 'chase', 'hood']);
    });

    it('maps Party to the Voronoi compositor and Player grid to rectangular tiling', () => {
        const render = createRenderSystem();

        expect(render.setCameraMode('party')).toBe(true);
        expect(render.getCameraModeInfo()).toMatchObject({
            mode: 'party',
            tiled: true,
            tilingMode: 'voronoi'
        });
        expect(render.viewportTiling).toMatchObject({ enabled: true, mode: 'voronoi' });

        expect(render.setCameraMode('grid')).toBe(true);
        expect(render.getCameraModeInfo()).toMatchObject({
            mode: 'grid',
            tiled: true,
            tilingMode: 'grid'
        });
        expect(render.viewportTiling).toMatchObject({ enabled: true, mode: 'grid' });
    });

    it.each(['chase', 'hood'])('leaves the multi-camera renderer when switching to %s', (mode) => {
        const render = createRenderSystem();
        render.setCameraMode('party');

        expect(render.setCameraMode(mode)).toBe(true);
        expect(render.getCameraModeInfo()).toMatchObject({
            mode,
            tiled: false,
            tilingMode: null
        });
        expect(render.viewportTiling.enabled).toBe(false);
    });

    it('cycles through the public modes while keeping tiled state in sync', () => {
        const render = createRenderSystem();

        expect(render.cycleCameraMode()).toBe('grid');
        expect(render.viewportTiling).toMatchObject({ enabled: true, mode: 'grid' });
        expect(render.cycleCameraMode()).toBe('chase');
        expect(render.viewportTiling.enabled).toBe(false);
        expect(render.cycleCameraMode()).toBe('hood');
        expect(render.cycleCameraMode()).toBe('party');
        expect(render.viewportTiling).toMatchObject({ enabled: true, mode: 'voronoi' });
    });

    it('migrates the briefly persisted rectangular split mode to Voronoi Party', () => {
        const render = createRenderSystem();

        expect(render.setCameraMode('split')).toBe(true);
        expect(render.getCameraModeInfo()).toMatchObject({
            mode: 'party',
            tiled: true,
            tilingMode: 'voronoi'
        });
    });

    it('keeps nearby friends together and splits distant groups through the cluster kernel', () => {
        const render = createRenderSystem();
        const seats = [
            { seatId: 1, clusterId: '1', entity: { position: { x: 0, y: 0, z: 0 } } },
            { seatId: 2, clusterId: '2', entity: { position: { x: 8, y: 0, z: 0 } } }
        ];

        const together = render._resolveClusterCameraGroups(seats, 0);
        expect(together.clusterResult.diagnostics).toMatchObject({
            naturalClusterCount: 1,
            finalClusterCount: 1,
            droppedCarIds: []
        });
        expect(together.viewportCount).toBe(1);
        expect([...together.assignment.values()]).toEqual([0, 0]);

        seats[1].entity.position.x = 100;
        render._resolveClusterCameraGroups(seats, 1);
        const separated = render._resolveClusterCameraGroups(seats, 700);

        expect(separated.clusterResult.diagnostics).toMatchObject({
            naturalClusterCount: 2,
            finalClusterCount: 2,
            droppedCarIds: []
        });
        expect(separated.viewportCount).toBe(2);
        expect(new Set(separated.assignment.values())).toEqual(new Set([0, 1]));
    });

    it('keeps tiled viewport coordinates in renderer-logical pixels', () => {
        const render = createRenderSystem();

        expect(render._toRendererViewport({
            x: 480,
            y: 197,
            width: 480,
            height: 197
        }, { width: 1920, height: 788 })).toEqual({
            x: 480,
            y: 394,
            width: 480,
            height: 197
        });
    });
});
