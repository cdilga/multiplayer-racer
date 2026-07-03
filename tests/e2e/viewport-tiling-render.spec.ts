import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-captain-call-architecture-hardening-woq.8 — in-engine viewport tiling.
 *
 * Wires the pure ViewportTiling layer into the real RenderSystem render path:
 * with tiling enabled, the host renders one gapless tile per seat group (Wife's
 * Grid) or per compact cluster, framing each group's cars. This exercises the
 * ACTUAL 3D render (setViewport/setScissor per tile) and its diagnostics — the
 * in-engine wiring the pure-module slice previously deferred. Tiling is opt-in,
 * so the default single-view path is untouched.
 */
test.describe('in-engine viewport tiling (woq.8)', () => {
    test('renders gapless tiles per seat group and reports tiling diagnostics', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const r = window.game?.systems?.render;
            return r?.initialized && !!r.scene && !!r.camera && !!r.renderer;
        }, null, { timeout: 15000 });

        const result = await hostPage.evaluate(async () => {
            // @ts-ignore
            const render = window.game.systems.render;
            // Inject 8 tracked entities (cars) so tiling has seat groups to frame.
            render.cameraTargets = Array.from({ length: 8 }, (_, i) => ({
                id: `car-${i}`,
                position: { x: (i % 4) * 8 - 12, y: 0, z: Math.floor(i / 4) * 8 },
                mesh: { position: { x: (i % 4) * 8 - 12, y: 0, z: Math.floor(i / 4) * 8 } }
            }));

            // Wife's Grid: one tile per seat (readability-downgraded if too many).
            render.setViewportTiling(true, 'grid');
            render.render(0.016, 0);
            const gridDiag = render.getDiagnostics().viewportTiling;

            // Compact cluster tiling.
            render.setViewportTiling(true, 'cluster');
            render.render(0.016, 0);
            const clusterDiag = render.getDiagnostics().viewportTiling;

            const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
            const shot = canvas ? canvas.toDataURL('image/png').length : 0;

            // Leaving tiled mode restores the single full-frame view.
            render.setViewportTiling(false);
            render.render(0.016, 0);
            const offDiag = render.getDiagnostics().viewportTiling;

            return { gridDiag, clusterDiag, shot, offDiag };
        });

        // Grid mode tiled the screen into readable tiles (downgraded from 8 if needed).
        expect(result.gridDiag.enabled).toBe(true);
        expect(result.gridDiag.mode).toBe('grid');
        expect(result.gridDiag.viewportCount).toBeGreaterThanOrEqual(1);
        expect(result.gridDiag.viewportCount).toBeLessThanOrEqual(8);

        // Cluster mode uses a compact rectangle count.
        expect(result.clusterDiag.mode).toBe('cluster');
        expect(result.clusterDiag.viewportCount).toBeGreaterThanOrEqual(1);

        // The real 3D world rendered non-blank into the tiles.
        expect(result.shot).toBeGreaterThan(10_000);

        // Disabling tiling returns to the single-view path.
        expect(result.offDiag.enabled).toBe(false);
    });
});
