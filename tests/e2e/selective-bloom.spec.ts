import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-skip-bin-arcade-design-language-5k3.6 — bloom inverted to emissive-only.
 *
 * The host post-processing runs a TWO-composer selective-bloom pipeline: an
 * off-screen bloom pass over only BLOOM_LAYER / emissive objects, composited
 * additively over the full scene. Full-frame bloom is gone; the render is still
 * non-blank and back-compat diagnostics (passes.bloom) remain present.
 */
test.describe('selective bloom — emissive-only diegetic glow (5k3.6)', () => {
    test('host runs a two-composer selective bloom, not full-frame, and renders non-blank', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const r = window.game?.systems?.render;
            return r?.initialized && !!r.renderer;
        }, null, { timeout: 15000 });

        // Give post-processing (dynamic imports) a moment to initialize.
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const pp = window.game?.systems?.render?.postProcessing;
            return pp && (pp.bloomComposer || pp.unsupported || pp.initError);
        }, null, { timeout: 15000 }).catch(() => {});

        const probe = await hostPage.evaluate(async () => {
            // @ts-ignore
            const render = window.game.systems.render;
            const pp = render.postProcessing;
            const diag = render.getDiagnostics().postProcessing;
            // Force a couple of frames through the selective pipeline.
            render.render(0.016, 0);
            render.render(0.016, 0);
            const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
            return {
                unsupported: !!pp.unsupported,
                hasTwoComposers: !!(pp.bloomComposer && pp.composer && pp.bloomComposer !== pp.composer),
                selectiveBloom: diag.selectiveBloom,
                fullFrameBloom: diag.fullFrameBloom,
                hasBloom: diag.bloomEnabled !== undefined && !!pp.passes?.bloom,
                bloomLayer: diag.bloomLayer,
                shot: canvas ? canvas.toDataURL('image/png').length : 0
            };
        });

        // On the WebGL post-processing path the selective pipeline must be active.
        if (!probe.unsupported) {
            expect(probe.hasTwoComposers).toBe(true);
            expect(probe.selectiveBloom).toBe(true);
            expect(probe.fullFrameBloom).toBe(false);
            expect(probe.hasBloom).toBe(true);       // back-compat: passes.bloom present
            expect(probe.bloomLayer).toBeGreaterThan(0);
        }
        // Either way the host renders non-blank.
        expect(probe.shot).toBeGreaterThan(10_000);
    });
});
