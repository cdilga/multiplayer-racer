import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-skip-bin-arcade-design-language-5k3.30
 * P6.1: Skybox restyle — flat gradient/box domes, no HDRIs; skies in the world
 * palette; fog meets sky seamlessly.
 *
 * The sky dome is a flat gradient ShaderMaterial (no HDRI/env map), its three
 * gradient stops are drawn from the world palette, and the FogExp2 colour equals
 * the horizon band so the world dissolves into the sky with no seam.
 */

// World palette (static/js/visual/palette.js WORLD_PALETTE), as hex ints.
const WORLD_PALETTE = new Set([
    0x14110F, 0x2A2620, 0x6B5A41, 0x7A4A2E, 0x4B5A3A, 0x3A3550, 0x8A7E6B, 0xC9BBA0
]);

test.describe('Skybox restyle — world palette, no HDRI (5k3.30)', () => {
    test('sky dome is a flat gradient in the world palette, fog meets the horizon', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.systems?.render?.initialized && !!game?.systems?.render?.scene;
        }, null, { timeout: 15000 });

        const probe = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            const scene = render?.scene;
            const dome = scene?.getObjectByName?.('skyDome');
            const u = dome?.material?.uniforms || {};
            return {
                hasDome: !!dome,
                // Flat gradient shader, not an HDRI/env-mapped material.
                isShader: dome?.material?.type === 'ShaderMaterial' || dome?.material?.isShaderMaterial === true,
                usesEnvMap: !!(dome?.material?.envMap) || !!(scene?.environment),
                top: u.topColor?.value?.getHex?.() ?? null,
                bottom: u.bottomColor?.value?.getHex?.() ?? null,
                horizon: u.horizonColor?.value?.getHex?.() ?? null,
                fog: scene?.fog?.color?.getHex?.() ?? null
            };
        });

        expect(probe.hasDome).toBe(true);
        expect(probe.isShader).toBe(true);
        expect(probe.usesEnvMap).toBe(false); // no HDRI / environment map
        // Every gradient stop is a world-palette colour.
        expect(WORLD_PALETTE.has(probe.top)).toBe(true);
        expect(WORLD_PALETTE.has(probe.bottom)).toBe(true);
        expect(WORLD_PALETTE.has(probe.horizon)).toBe(true);
        // Fog meets sky seamlessly: fog colour == horizon band.
        expect(probe.fog).toBe(probe.horizon);
    });
});
