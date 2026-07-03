import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, gotoHost } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.21');

async function waitForHostReadyAndClearWarmup(hostPage) {
    await hostPage.waitForFunction(() => {
        const loading = (window as any).__hostLoadingOverlay;
        return loading?.completed === true && loading?.loadingVisible === false;
    }, null, { timeout: 30000 });

    await hostPage.evaluate(() => {
        document.getElementById('loading-overlay')?.classList.add('hidden');
        document.getElementById('error-overlay')?.classList.add('hidden');
    });

    await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();
}

async function installWinMomentHarness(hostPage) {
    await waitForHostReadyAndClearWarmup(hostPage);
    await hostPage.waitForFunction(() => !!(window as any).ResultsUI, null, { timeout: 30000 });
    await hostPage.evaluate(() => {
        document.querySelector('#win-moment-test-container')?.remove();
        const container = document.createElement('div');
        container.id = 'win-moment-test-container';
        document.body.appendChild(container);
        const ui = new (window as any).ResultsUI({
            container,
            winMomentDurationMs: 850
        });
        ui.eventBus = null;
        ui.init();
        (window as any).__winMomentResultsUI = ui;
    });
}

test.describe('5k3.21 host win moment', () => {
    test('race winner gets a sub-one-second host beat before the results table', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });

        await gotoHost(hostPage);
        await installWinMomentHarness(hostPage);

        const immediate = await hostPage.evaluate(() => {
            const ui = (window as any).__winMomentResultsUI;
            ui.showResults([
                { position: 1, playerId: 'Ada', finishTime: 61234, bestLapTime: 20000 },
                { position: 2, playerId: 'Grace', finishTime: 64000, bestLapTime: 21000 }
            ]);
            return ui.getWinMomentDiagnostics();
        });

        expect(immediate).toMatchObject({
            visible: true,
            active: true,
            mode: 'race',
            winnerName: 'Ada',
            tableHidden: true,
            winMomentHidden: false
        });
        expect(immediate.durationMs).toBeLessThan(1000);

        const harness = hostPage.locator('#win-moment-test-container');
        await expect(harness.locator('.results-win-moment')).toBeVisible();
        await expect(harness.locator('.results-win-name')).toHaveText('Ada');
        await expect(harness.locator('.results-table')).not.toBeVisible();
        await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();
        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'win-moment-race.png'),
            fullPage: true
        });

        await expect.poll(async () => hostPage.evaluate(() => {
            return (window as any).__winMomentResultsUI.getWinMomentDiagnostics();
        }), { timeout: 2500 }).toMatchObject({
            active: false,
            completed: true,
            tableHidden: false,
            winMomentHidden: true
        });
        await expect(harness.locator('.results-table')).toBeVisible();

        const finalDiagnostics = await hostPage.evaluate(() => {
            return (window as any).__winMomentResultsUI.getWinMomentDiagnostics();
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'win-moment-race-diagnostics.json'),
            JSON.stringify({ immediate, finalDiagnostics }, null, 2)
        );
    });

    test('derby match winner uses winnerId and then reveals derby standings', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });

        await gotoHost(hostPage);
        await installWinMomentHarness(hostPage);

        const immediate = await hostPage.evaluate(() => {
            const ui = (window as any).__winMomentResultsUI;
            ui.showDerbyResults({
                winnerId: 'Grace',
                standings: [
                    { position: 1, playerId: 'Ada', roundWins: 1, totalPoints: 7 },
                    { position: 2, playerId: 'Grace', roundWins: 2, totalPoints: 10 }
                ]
            });
            return ui.getWinMomentDiagnostics();
        });

        expect(immediate).toMatchObject({
            active: true,
            mode: 'derby',
            winnerName: 'Grace',
            tableHidden: true
        });
        expect(immediate.durationMs).toBeLessThan(1000);

        const harness = hostPage.locator('#win-moment-test-container');
        await expect(harness.locator('.results-win-name')).toHaveText('Grace');
        await expect(harness.locator('.results-table')).not.toBeVisible();
        await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();
        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'win-moment-derby.png'),
            fullPage: true
        });

        await expect.poll(async () => hostPage.evaluate(() => {
            return (window as any).__winMomentResultsUI.getWinMomentDiagnostics();
        }), { timeout: 2500 }).toMatchObject({
            active: false,
            completed: true,
            tableHidden: false
        });

        const finalDiagnostics = await hostPage.evaluate(() => {
            return (window as any).__winMomentResultsUI.getWinMomentDiagnostics();
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'win-moment-derby-diagnostics.json'),
            JSON.stringify({ immediate, finalDiagnostics }, null, 2)
        );
    });
});
