import { test, expect, gotoHost, waitForRoomCode } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ARTIFACT_DIR = 'artifacts/br-skip-bin-arcade-design-language-5k3.10';

test.describe.configure({ mode: 'serial' });

const CAR_CONFIG = {
    id: 'material-warp-readable-probe',
    visual: {
        body: { width: 2, height: 1, length: 4, color: 0xff2e88 },
        roof: { color: 0x222222 },
        wheels: { radius: 0.5, thickness: 0.3, segments: 12, color: 0x111111 },
    },
};

test('host WebGL scene compiles material-warp hook and toggles world only', async ({ hostPage }) => {
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    hostPage.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' || /shader|glsl|WebGLProgram/i.test(text)) {
            consoleIssues.push(`${message.type()}: ${text}`);
        }
    });
    hostPage.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoHost(hostPage);
    await waitForRoomCode(hostPage);

    await hostPage.waitForFunction(
        () => window.game?.systems?.render?.initialized === true
            && !!window.game?.trackFactory
            && !!window.game?.vehicleFactory,
        null,
        { timeout: 20000 }
    );

    const result = await hostPage.evaluate((config) => {
        // @ts-ignore
        const game = window.game;
        const render = game.systems.render;
        const scene = render.getScene ? render.getScene() : render.scene;

        const ground = game.trackFactory._createGround({
            visual: {
                ground: {
                    size: 30,
                    color: '#675f48',
                },
            },
        });
        ground.name = 'material-warp-world-probe';
        ground.position.set(0, 0, 0);
        scene.add(ground);

        const car = game.vehicleFactory._createVisualMesh(config, { playerId: 'material-warp-probe' });
        car.name = 'material-warp-readable-probe';
        car.position.set(0, 0.05, 0);
        scene.add(car);

        const disabled = render.setMaterialWarpEnabled({
            enabled: false,
            vertexSnapIntensity: 0,
            affineIntensity: 0,
            snapGridSize: 0.7,
        });
        const disabledScreenshot = render.captureScreenshot({ maxWidth: 640, quality: 0.72 }) || '';

        const enabled = render.setMaterialWarpEnabled({
            enabled: true,
            vertexSnapIntensity: 0.6,
            affineIntensity: 0.2,
            snapGridSize: 0.7,
        });
        const enabledScreenshot = render.captureScreenshot({ maxWidth: 640, quality: 0.72 }) || '';

        const restored = render.setMaterialWarpEnabled({
            enabled: false,
            vertexSnapIntensity: 0,
            affineIntensity: 0,
            snapGridSize: 0.7,
        });

        return {
            disabled,
            enabled,
            restored,
            disabledScreenshotLength: disabledScreenshot.length,
            enabledScreenshotLength: enabledScreenshot.length,
            disabledScreenshot,
            enabledScreenshot,
            grade: render.getGradeDiagnostics?.() || null,
        };
    }, CAR_CONFIG);

    expect(pageErrors).toEqual([]);
    expect(consoleIssues).toEqual([]);

    expect(result.disabledScreenshotLength).toBeGreaterThan(10_000);
    expect(result.enabledScreenshotLength).toBeGreaterThan(10_000);

    expect(result.disabled.schema).toBe('jj.materialWarp.diagnostics.v1');
    expect(result.disabled.hookInstalled).toBeGreaterThan(0);
    expect(result.disabled.eligible).toBeGreaterThan(0);
    expect(result.disabled.exempt).toBeGreaterThan(0);
    expect(result.disabled.active).toBe(0);
    expect(result.disabled.worldVertexDeltaMax).toBe(0);

    expect(result.enabled.active).toBeGreaterThan(0);
    expect(result.enabled.roles.world?.eligible || 0).toBeGreaterThan(0);
    expect(result.enabled.roles.world?.active || 0).toBeGreaterThan(0);
    expect(result.enabled.roles['vehicle-readable']?.exempt || 0).toBeGreaterThan(0);
    expect(result.enabled.roles['vehicle-readable']?.active || 0).toBe(0);
    expect(result.enabled.vehicleReadableActive).toBe(0);
    expect(result.enabled.activeVertexSnapIntensity).toBeCloseTo(0.6, 4);
    expect(result.enabled.activeAffineIntensity).toBeCloseTo(0.2, 4);
    expect(result.enabled.activeSnapGridSize).toBeCloseTo(0.7, 4);
    expect(result.enabled.worldVertexDeltaMax).toBeGreaterThan(0.01);

    expect(result.restored.active).toBe(0);
    expect(result.restored.worldVertexDeltaMax).toBe(0);

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, 'material-warp-diagnostics.json'), JSON.stringify({
        disabled: result.disabled,
        enabled: result.enabled,
        restored: result.restored,
        grade: result.grade,
        disabledScreenshotLength: result.disabledScreenshotLength,
        enabledScreenshotLength: result.enabledScreenshotLength,
        consoleIssues,
        pageErrors,
    }, null, 2));

    await hostPage.screenshot({ path: resolve(ARTIFACT_DIR, 'material-warp-host.png') });
});

test('adaptive/manual/reduce-effects policy drives live material warp', async ({ hostPage }) => {
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    hostPage.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' || /shader|glsl|WebGLProgram/i.test(text)) {
            consoleIssues.push(`${message.type()}: ${text}`);
        }
    });
    hostPage.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoHost(hostPage);
    await waitForRoomCode(hostPage);
    await hostPage.waitForFunction(
        () => window.game?.systems?.render?.initialized === true
            && !!window.__JJ_ADAPTIVE__
            && !!window.game?.trackFactory
            && !!window.game?.vehicleFactory,
        null,
        { timeout: 20000 }
    );

    const result = await hostPage.evaluate(async (config) => {
        // @ts-ignore
        const game = window.game;
        // @ts-ignore
        const adaptive = window.__JJ_ADAPTIVE__;
        const render = game.systems.render;
        const scene = render.getScene ? render.getScene() : render.scene;

        const ground = game.trackFactory._createGround({
            visual: { ground: { size: 30, color: '#675f48' } },
        });
        ground.name = 'material-warp-policy-world-probe';
        scene.add(ground);

        const car = game.vehicleFactory._createVisualMesh(config, { playerId: 'material-warp-policy-probe' });
        car.name = 'material-warp-policy-readable-probe';
        scene.add(car);

        const tierNames = adaptive.tiers.map((t: any) => t.name);
        const nativeTier = tierNames[0];
        const degradedTier = tierNames.find((t: string) => /degraded/.test(t)) || tierNames[Math.min(2, tierNames.length - 1)];
        const fallbackTier = tierNames[tierNames.length - 1];

        adaptive.setManualTier(nativeTier);
        const autoNativePolicy = adaptive.setMaterialWarpPolicy({
            mode: 'auto',
            reduceEffects: false,
            vertexSnapIntensity: 0.6,
            affineIntensity: 0.2,
            snapGridSize: 0.7,
        });
        const autoNative = render.getMaterialWarpDiagnostics();

        adaptive.setManualTier(degradedTier);
        const autoDegraded = render.getMaterialWarpDiagnostics();

        localStorage.setItem('visualSettings', JSON.stringify({ uiScale: 1.23, customFutureKey: 'keep' }));
        const mod = await import('/static/js/ui/ManualVisualSettingsController.js');
        const manual = new mod.ManualVisualSettingsController({
            render,
            adaptiveQuality: adaptive,
            storage: localStorage,
        });

        manual.update({
            visualQualityMode: fallbackTier,
            materialWarpMode: 'on',
            reduceEffects: false,
            vertexSnapIntensity: 0.5,
            affineIntensity: 0.18,
            snapGridSize: 0.8,
        });
        const manualOn = render.getMaterialWarpDiagnostics();

        manual.update({ reduceEffects: true });
        const reduceEffectsOff = render.getMaterialWarpDiagnostics();
        const savedAfterReduce = JSON.parse(localStorage.getItem('visualSettings') || '{}');

        manual.update({
            reduceEffects: false,
            visualQualityMode: nativeTier,
            materialWarpMode: 'auto',
            vertexSnapIntensity: 0.6,
            affineIntensity: 0.2,
            snapGridSize: 0.7,
        });
        const restored = render.getMaterialWarpDiagnostics();
        const restoredScreenshot = render.captureScreenshot({ maxWidth: 640, quality: 0.72 }) || '';

        return {
            tierNames,
            autoNativePolicy,
            autoNative,
            autoDegraded,
            manualOn,
            reduceEffectsOff,
            restored,
            restoredScreenshotLength: restoredScreenshot.length,
            savedAfterReduce,
            grade: render.getGradeDiagnostics?.() || null,
        };
    }, CAR_CONFIG);

    expect(pageErrors).toEqual([]);
    expect(consoleIssues).toEqual([]);

    expect(result.autoNativePolicy.enabled).toBe(true);
    expect(result.autoNative.active).toBeGreaterThan(0);
    expect(result.autoNative.roles.world?.active || 0).toBeGreaterThan(0);
    expect(result.autoNative.vehicleReadableActive).toBe(0);
    expect(result.autoNative.worldVertexDeltaMax).toBeGreaterThan(0.01);

    expect(result.autoDegraded.active).toBe(0);
    expect(result.autoDegraded.worldVertexDeltaMax).toBe(0);

    expect(result.manualOn.active).toBeGreaterThan(0);
    expect(result.manualOn.worldVertexDeltaMax).toBeGreaterThan(0.01);
    expect(result.manualOn.vehicleReadableActive).toBe(0);

    expect(result.reduceEffectsOff.active).toBe(0);
    expect(result.reduceEffectsOff.worldVertexDeltaMax).toBe(0);
    expect(result.savedAfterReduce.uiScale).toBe(1.23);
    expect(result.savedAfterReduce.customFutureKey).toBe('keep');

    expect(result.restored.active).toBeGreaterThan(0);
    expect(result.restored.worldVertexDeltaMax).toBeGreaterThan(0.01);
    expect(result.restored.vehicleReadableActive).toBe(0);
    expect(result.restoredScreenshotLength).toBeGreaterThan(10_000);

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, 'material-warp-diagnostics.json'), JSON.stringify({
        adaptiveManualTimeline: result,
        consoleIssues,
        pageErrors,
    }, null, 2));
    await hostPage.screenshot({ path: resolve(ARTIFACT_DIR, 'material-warp-host.png') });
});
