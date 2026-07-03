import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from '@playwright/test';

const VISUAL_ARTIFACT = 'test-results/visual/weapon-lab-all-pass.png';
const DIAGNOSTICS_ARTIFACT = 'artifacts/weapon-lab/diagnostics-sample.json';
const SCENARIO_ARTIFACT = 'artifacts/weapon-lab/scenario-sample.json';

function ensureParentDir(path: string) {
    mkdirSync(dirname(path), { recursive: true });
}

test.describe('Weapon Test Lab', () => {
    test('loads, exposes deterministic hooks, and emits evidence artifacts with no console errors', async ({ page }) => {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await page.goto('/weapon-lab');
        await page.waitForFunction(() => (window as any).__weaponLab?.ready === true, null, { timeout: 30000 });

        const hookShape = await page.evaluate(() => {
            const lab = (window as any).__weaponLab;
            return {
                scenarios: lab.scenarios.map((scenario: any) => scenario.id),
                hasReset: typeof lab.reset === 'function',
                hasStepFrame: typeof lab.stepFrame === 'function',
                hasStepSecond: typeof lab.stepSecond === 'function',
                hasGetDiagnostics: typeof lab.getDiagnostics === 'function',
                hasRunChecks: typeof lab.runChecks === 'function',
                hasExportScenario: typeof lab.exportScenario === 'function',
                hasImportScenario: typeof lab.importScenario === 'function'
            };
        });

        expect(hookShape.scenarios).toEqual([
            'pickup-field',
            'missile-chase',
            'mine-arming',
            'oil-slick',
            'shield-block',
            'emp-stun',
            'flamethrower-cone'
        ]);
        expect(hookShape.hasReset).toBe(true);
        expect(hookShape.hasStepFrame).toBe(true);
        expect(hookShape.hasStepSecond).toBe(true);
        expect(hookShape.hasGetDiagnostics).toBe(true);
        expect(hookShape.hasRunChecks).toBe(true);
        expect(hookShape.hasExportScenario).toBe(true);
        expect(hookShape.hasImportScenario).toBe(true);

        await expect.poll(async () => page.locator('#badges .badge').count(), { timeout: 15000 }).toBeGreaterThan(0);

        const stepProof = await page.evaluate(async () => {
            const lab = (window as any).__weaponLab;
            const before = lab.getDiagnostics();
            lab.stepFrame();
            const afterFrame = lab.getDiagnostics();
            lab.stepSecond();
            const afterSecond = lab.getDiagnostics();
            await lab.reset();
            const afterReset = lab.getDiagnostics();
            return {
                beforeTick: before.tick,
                afterFrameTick: afterFrame.tick,
                afterSecondTick: afterSecond.tick,
                afterResetPreset: afterReset.preset,
                trackId: afterReset.trackContext?.trackId,
                trackSource: afterReset.trackContext?.source
            };
        });
        expect(stepProof.afterFrameTick).toBeGreaterThan(stepProof.beforeTick);
        expect(stepProof.afterSecondTick).toBeGreaterThan(stepProof.afterFrameTick);
        expect(stepProof.afterResetPreset).toBe('pickup-field');
        expect(stepProof.trackId).toBe('derby-bowl');
        expect(stepProof.trackSource).toBe('TrackFactory-backed');

        const results = await page.evaluate(async () => {
            return await (window as any).__weaponLab.runAll();
        });
        expect(results.length).toBe(7);
        for (const result of results) {
            const failed = result.checks.filter((item: any) => !item.pass).map((item: any) => item.name);
            expect(failed, `failing checks in ${result.id}`).toEqual([]);
            expect(result.diagnostics.trackContext?.source).toBe('TrackFactory-backed');
            expect(result.scenario?.schema).toBe('jj.weaponLabScenario.v1');
        }

        await page.locator('#runAll').click();
        await expect.poll(async () => page.locator('#badges .badge.pass').count()).toBe(7);
        expect(await page.locator('#badges .badge.fail').count()).toBe(0);

        const screenshot = await page.evaluate(async () => {
            const lab = (window as any).__weaponLab;
            const shot = await lab.takeScreenshot();
            return {
                metadata: shot,
                dataUrl: lab.screenshot()
            };
        });
        expect(screenshot.metadata.success).toBe(true);
        expect(screenshot.dataUrl.startsWith('data:image/png;base64,')).toBe(true);

        const artifacts = await page.evaluate(async () => {
            const lab = (window as any).__weaponLab;
            const resetA = await lab.runChecks('missile-chase', { seed: 42 });
            const resetB = await lab.runChecks('missile-chase', { seed: 42 });
            const resetC = await lab.runChecks('missile-chase', { seed: 7 });
            const scenario = lab.exportScenario();
            const imported = await lab.importScenario(scenario);
            const diagnostics = lab.getDiagnostics();
            return {
                scenario,
                imported,
                diagnostics,
                determinism: {
                    sameSeedHashA: resetA.diagnostics.determinism.hash,
                    sameSeedHashB: resetB.diagnostics.determinism.hash,
                    sameSeedEqual: resetA.diagnostics.determinism.hash === resetB.diagnostics.determinism.hash,
                    differentSeedHash: resetC.diagnostics.determinism.hash,
                    differentSeedChanged: resetA.diagnostics.determinism.hash !== resetC.diagnostics.determinism.hash
                }
            };
        });

        expect(artifacts.scenario.schema).toBe('jj.weaponLabScenario.v1');
        expect(artifacts.scenario.track.trackId).toBe('derby-bowl');
        expect(artifacts.scenario.camera).toBeTruthy();
        expect(artifacts.scenario.overlay).toBeTruthy();
        expect(artifacts.imported.success).toBe(true);
        expect(artifacts.diagnostics.schema).toBe('jj.debugLab.diagnostics.v1');
        expect(artifacts.diagnostics.trackContext.trackId).toBe('derby-bowl');
        expect(artifacts.diagnostics.trackContext.source).toBe('TrackFactory-backed');
        expect(artifacts.diagnostics.hooksAvailable.runChecks).toBe(true);
        expect(Array.isArray(artifacts.diagnostics.events)).toBe(true);
        expect(artifacts.diagnostics.events[0]).toHaveProperty('type');
        expect(artifacts.diagnostics.events[0]).toHaveProperty('atMs');
        expect(artifacts.determinism.sameSeedEqual).toBe(true);
        expect(artifacts.determinism.differentSeedChanged).toBe(true);

        await page.screenshot({ path: VISUAL_ARTIFACT });
        ensureParentDir(DIAGNOSTICS_ARTIFACT);
        ensureParentDir(SCENARIO_ARTIFACT);
        writeFileSync(DIAGNOSTICS_ARTIFACT, JSON.stringify({
            schema: 'jj.weaponLabEvidence.v1',
            generatedBy: 'tests/e2e/weapon-lab.spec.ts',
            scenario: artifacts.scenario,
            diagnostics: artifacts.diagnostics,
            determinism: artifacts.determinism
        }, null, 2));
        writeFileSync(SCENARIO_ARTIFACT, JSON.stringify(artifacts.scenario, null, 2));

        const distinctColors = await page.evaluate(async () => {
            const url: string = (window as any).__weaponLab.screenshot();
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });
            const scratch = document.createElement('canvas');
            scratch.width = 64;
            scratch.height = 64;
            const ctx = scratch.getContext('2d')!;
            ctx.drawImage(img, 0, 0, 64, 64);
            const data = ctx.getImageData(0, 0, 64, 64).data;
            const seen = new Set<string>();
            for (let index = 0; index < data.length; index += 4) {
                seen.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
            }
            return seen.size;
        });
        expect(distinctColors).toBeGreaterThan(5);

        const criticalErrors = consoleErrors.filter((error) => !error.includes('favicon.ico'));
        expect(criticalErrors, `console errors: ${criticalErrors.join(' | ')}`).toEqual([]);
        expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    });
});
