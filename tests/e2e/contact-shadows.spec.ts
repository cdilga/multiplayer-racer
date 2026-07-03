import { test, expect, gotoHost, waitForRoomCode } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * br-skip-bin-arcade-design-language-5k3.9 — contact shadows, browser proof.
 *
 * Proves on the live host that (a) the render config dropped PCFSoft/full-scene
 * soft shadows and reports contact-blob mode, and (b) the production
 * VehicleFactory build path produces exactly one grounded, transparent,
 * dithered (CanvasTexture) contact-shadow blob per car — added to the live scene
 * and captured in a screenshot.
 */

const ARTIFACT_DIR = 'artifacts/br-skip-bin-arcade-design-language-5k3.9';

const CAR_CONFIG = {
    id: 'contact-shadow-probe',
    visual: {
        body: { width: 2, height: 1, length: 4, color: 0xff2e88 },
        roof: { color: 0x222222 },
        wheels: { radius: 0.5, thickness: 0.3, segments: 12, color: 0x111111 },
    },
};

test('host render uses per-car contact-shadow blobs, not PCFSoft full-scene shadows', async ({ hostPage }) => {
    await gotoHost(hostPage);
    await waitForRoomCode(hostPage);

    await hostPage.waitForFunction(
        // @ts-ignore
        () => window.game?.systems?.render?.initialized === true && !!window.game?.vehicleFactory,
        null,
        { timeout: 20000 }
    );

    const result = await hostPage.evaluate((config) => {
        // @ts-ignore
        const render = window.game.systems.render;
        const diag = render.getGradeDiagnostics?.() || {};
        const tiers = (render.listGradeTiers?.() || []).map((t: any) => ({
            tierName: t.tierName, shadowsEnabled: t.shadowsEnabled, shadowMapType: t.shadowMapType,
        }));

        // Build a car through the real production factory (real THREE + document).
        // @ts-ignore
        const car = window.game.vehicleFactory._createVisualMesh(config, { playerId: 'probe' });
        const shadows = car.children.filter((c: any) => c.userData && c.userData.isContactShadow);
        const shadow = shadows[0];
        const anyPartCastsShadow = car.children.some((c: any) => c.castShadow === true);

        // Drop it into the live scene so it actually renders, then screenshot.
        // @ts-ignore
        const scene = render.getScene ? render.getScene() : render.scene;
        car.position.set(0, 0, 0);
        if (scene && scene.add) scene.add(car);

        return {
            shadowsDiag: diag.shadows || null,
            tiers,
            contactShadowCount: shadows.length,
            shadowTransparent: !!(shadow && shadow.material && shadow.material.transparent),
            shadowHasTextureMap: !!(shadow && shadow.material && shadow.material.map),
            shadowCastsReal: shadow ? shadow.castShadow : null,
            shadowReceivesReal: shadow ? shadow.receiveShadow : null,
            shadowGroundedY: shadow ? shadow.position.y : null,
            anyPartCastsShadow,
        };
    }, CAR_CONFIG);

    // (a) Render dropped PCFSoft / full-scene soft shadows.
    expect(result.shadowsDiag).not.toBeNull();
    expect(result.shadowsDiag.mode).toBe('contact-blob');
    expect(result.shadowsDiag.enabled).toBeFalsy();
    expect(result.shadowsDiag.type).not.toBe('PCFSoftShadowMap');
    expect(result.tiers.length).toBeGreaterThanOrEqual(2);
    expect(result.tiers.every((t) => t.shadowsEnabled === false)).toBe(true);
    expect(result.tiers.every((t) => t.shadowMapType !== 'pcf-soft')).toBe(true);

    // (b) Exactly one grounded, transparent, dithered contact-shadow blob per car.
    expect(result.contactShadowCount).toBe(1);
    expect(result.shadowTransparent).toBe(true);
    expect(result.shadowHasTextureMap).toBe(true);      // CanvasTexture dithered blob
    expect(result.shadowCastsReal).toBe(false);
    expect(result.shadowReceivesReal).toBe(false);
    expect(result.shadowGroundedY).toBeGreaterThan(0);
    expect(result.shadowGroundedY).toBeLessThan(0.1);
    expect(result.anyPartCastsShadow).toBe(false);

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, 'contact-shadows-diagnostics.json'), JSON.stringify(result, null, 2));
    await hostPage.screenshot({ path: resolve(ARTIFACT_DIR, 'contact-shadow-host.png') });
});
