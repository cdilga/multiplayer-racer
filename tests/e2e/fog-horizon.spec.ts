import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-skip-bin-arcade-design-language-5k3.7
 * P1.5: Short draw distance + fog horizon; deliberate tone-map.
 *
 * Invariants under test (see docs/design/02-design-language.md sec 3,
 * docs/design/05-grade-performance-spike.md G2):
 *  - The world dissolves into the sky with NO hard seam: the FogExp2 colour
 *    equals the sky-dome horizon band colour.
 *  - Draw distance is deliberately short: camera far-plane is shortened from
 *    the legacy 1000, while still containing the sky dome so it never clips.
 *  - The sky dome is camera-locked, so the short far-plane is safe even on
 *    large procedural circuits where the camera roams far from the origin.
 *  - Tone mapping is set deliberately (NoToneMapping per G2, not inherited).
 */

async function waitForHostRenderReady(hostPage: any) {
    await gotoHost(hostPage);
    await waitForRoomCode(hostPage);
    await hostPage.waitForFunction(
        () => {
            // @ts-ignore
            const game = window.game;
            return game?.systems?.render?.initialized === true
                && !!game?.systems?.render?.scene
                && !!game?.systems?.render?.camera;
        },
        null,
        { timeout: 15000 }
    );
    // Let a few frames run so per-frame camera-lock has applied.
    await hostPage.waitForTimeout(500);
}

test.describe('Fog horizon + short draw distance (5k3.7)', () => {
    test('fog colour equals the sky-dome horizon band (no seam)', async ({ hostPage }) => {
        await waitForHostRenderReady(hostPage);

        const probe = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            const scene = render?.scene;
            const skyDome = scene?.getObjectByName?.('skyDome');
            const horizonUniform = skyDome?.material?.uniforms?.horizonColor?.value;
            return {
                fogColor: scene?.fog?.color?.getHex?.() ?? null,
                // `.isFogExp2` is a stable flag THREE sets on the instance; the
                // constructor name is mangled by the production minifier.
                fogType: scene?.fog?.isFogExp2 ? 'FogExp2' : (scene?.fog?.constructor?.name ?? null),
                horizonColor: horizonUniform?.getHex?.() ?? null,
            };
        });

        expect(probe.fogType).toBe('FogExp2');
        expect(probe.horizonColor).not.toBeNull();
        // The whole point of the bead: fog == horizon band → seamless dissolve.
        expect(probe.fogColor).toBe(probe.horizonColor);
    });

    test('draw distance is short but still contains the sky dome', async ({ hostPage }) => {
        await waitForHostRenderReady(hostPage);

        const probe = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            const camera = render?.camera;
            const skyDome = render?.scene?.getObjectByName?.('skyDome');
            return {
                far: camera?.far ?? null,
                domeRadius: skyDome?.geometry?.parameters?.radius ?? null,
            };
        });

        expect(probe.far).not.toBeNull();
        // Deliberately shorter than the legacy 1000 draw distance.
        expect(probe.far).toBeLessThanOrEqual(600);
        // ...but still large enough to enclose the dome so it never clips.
        expect(probe.far).toBeGreaterThan(probe.domeRadius);
    });

    test('sky dome is camera-locked so the short far-plane is safe', async ({ hostPage }) => {
        await waitForHostRenderReady(hostPage);

        const probe = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            const camera = render?.camera;
            const skyDome = render?.scene?.getObjectByName?.('skyDome');
            const dx = (skyDome?.position?.x ?? 0) - (camera?.position?.x ?? 0);
            const dy = (skyDome?.position?.y ?? 0) - (camera?.position?.y ?? 0);
            const dz = (skyDome?.position?.z ?? 0) - (camera?.position?.z ?? 0);
            return {
                distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
                cameraPos: camera ? [camera.position.x, camera.position.y, camera.position.z] : null,
            };
        });

        expect(probe.cameraPos).not.toBeNull();
        // Dome centre tracks the camera within a frame's worth of slack.
        expect(probe.distance).toBeLessThan(1.0);
    });

    test('tone mapping is deliberate (NoToneMapping per G2)', async ({ hostPage }) => {
        await waitForHostRenderReady(hostPage);

        const diagnostics = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            return render?.getDiagnostics?.() ?? null;
        });

        expect(diagnostics?.toneMapping?.decision).toBe('skip-aces');
        expect(diagnostics?.toneMapping?.mode).toBe('NoToneMapping');
        // Fog colour is exposed in diagnostics for independent inspection.
        expect(diagnostics?.fog?.enabled).toBe(true);
        expect(diagnostics?.fog?.color).not.toBeNull();
    });

    test('host canvas renders non-blank', async ({ hostPage }) => {
        await waitForHostRenderReady(hostPage);

        const shot = await hostPage.evaluate(() => {
            const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
            return canvas ? canvas.toDataURL('image/png').length : 0;
        });
        expect(shot).toBeGreaterThan(10_000);
    });
});
