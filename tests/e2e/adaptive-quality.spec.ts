import { test, expect, gotoHost, waitForRoomCode } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * br-skip-bin-arcade-design-language-5k3.39 — runtime wiring proof.
 *
 * Proves the AdaptiveQualityController is instantiated + attached to the LIVE
 * host RenderSystem, that the host render loop feeds it real fps, and that a
 * synthetic slow-frame burst drives the tier/resolution DOWN and a fast burst
 * recovers it — all observed through the real RenderSystem.getGradeDiagnostics().
 */

const ARTIFACT_DIR = 'artifacts/br-skip-bin-arcade-design-language-5k3.39';

test('adaptive quality controller is wired into the live host render path', async ({ hostPage }) => {
    await gotoHost(hostPage);
    await waitForRoomCode(hostPage);

    // Render system booted.
    await hostPage.waitForFunction(
        // @ts-ignore
        () => window.game?.systems?.render?.initialized === true,
        null,
        { timeout: 20000 }
    );

    // Controller exposed + fed real fps by the host render loop.
    await hostPage.waitForFunction(
        () => {
            // @ts-ignore
            const c = window.__JJ_ADAPTIVE__;
            return !!c && !!c.lastDecision && Number.isFinite(c.lastDecision.fps);
        },
        null,
        { timeout: 20000 }
    );

    const result = await hostPage.evaluate(() => {
        // @ts-ignore
        const c = window.__JJ_ADAPTIVE__;
        // @ts-ignore
        const render = window.game.systems.render;

        const attachedToLiveRender = c.target === render;
        const hostFedFps = c.lastDecision ? c.lastDecision.fps : null;
        const tierNames = c.tiers.map((t: any) => t.name);

        // Drive to a native baseline (synchronous burst => atomic, no rAF between).
        for (let i = 0; i < 240; i++) c.sample(240);
        const baseline = {
            tierIndex: c.state.tierIndex,
            tier: c.state.tier,
            resolutionScale: render.getGradeDiagnostics().resolutionScale,
        };

        // Sustained slow frames => step down through the real host path.
        for (let i = 0; i < 96; i++) c.sample(12);
        const underLoad = {
            tierIndex: c.state.tierIndex,
            tier: c.state.tier,
            resolutionScale: render.getGradeDiagnostics().resolutionScale,
        };

        // Recovery => climb back up.
        for (let i = 0; i < 240; i++) c.sample(240);
        const recovered = {
            tierIndex: c.state.tierIndex,
            tier: c.state.tier,
            resolutionScale: render.getGradeDiagnostics().resolutionScale,
        };

        return { attachedToLiveRender, hostFedFps, tierNames, baseline, underLoad, recovered };
    });

    // Wiring assertions.
    expect(result.attachedToLiveRender).toBe(true);
    expect(typeof result.hostFedFps).toBe('number');       // host loop fed real fps
    expect(result.tierNames.length).toBeGreaterThanOrEqual(2);

    // Baseline climbed to native (best tier, full resolution).
    expect(result.baseline.tierIndex).toBe(0);
    expect(result.baseline.resolutionScale).toBeCloseTo(1.0, 5);

    // Slow frames dropped tier + resolution through the REAL render diagnostics.
    expect(result.underLoad.tierIndex).toBeGreaterThan(result.baseline.tierIndex);
    expect(result.underLoad.resolutionScale).toBeLessThan(result.baseline.resolutionScale);
    expect(result.underLoad.resolutionScale).toBeGreaterThanOrEqual(0.5); // never below the floor

    // Recovery raised it back above the under-load value.
    expect(result.recovered.resolutionScale).toBeGreaterThan(result.underLoad.resolutionScale);

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, 'runtime-wiring.json'), JSON.stringify(result, null, 2));
});
