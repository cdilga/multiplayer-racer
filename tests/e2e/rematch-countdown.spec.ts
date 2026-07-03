import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, gotoHost } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.23');

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

async function installResultsHarness(hostPage, options = {}) {
    await waitForHostReadyAndClearWarmup(hostPage);
    await hostPage.waitForFunction(() => !!(window as any).ResultsUI, null, { timeout: 30000 });
    await hostPage.evaluate((opts) => {
        document.querySelector('#rematch-test-container')?.remove();
        const container = document.createElement('div');
        container.id = 'rematch-test-container';
        document.body.appendChild(container);
        const ui = new (window as any).ResultsUI({
            container,
            winMomentDurationMs: opts.winMomentDurationMs,
            rematchCountdownDurationMs: opts.rematchCountdownDurationMs,
            rematchCountdownTickMs: opts.rematchCountdownTickMs
        });
        ui.eventBus = null;
        ui.init();
        (window as any).__rematchAutoStarts = 0;
        ui.setOnPlayAgain(() => {
            (window as any).__rematchAutoStarts += 1;
        });
        (window as any).__rematchResultsUI = ui;
    }, {
        winMomentDurationMs: options.winMomentDurationMs ?? 120,
        rematchCountdownDurationMs: options.rematchCountdownDurationMs ?? 3000,
        rematchCountdownTickMs: options.rematchCountdownTickMs ?? 250
    });
}

test.describe('5k3.23 auto-arm rematch countdown', () => {
    test('countdown appears after win beat and can be canceled', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });

        await gotoHost(hostPage);
        await installResultsHarness(hostPage);

        const immediate = await hostPage.evaluate(() => {
            const ui = (window as any).__rematchResultsUI;
            ui.showResults([
                { position: 1, playerId: 'Ada', finishTime: 61000, bestLapTime: 20000 },
                { position: 2, playerId: 'Grace', finishTime: 64000, bestLapTime: 21000 }
            ]);
            return {
                win: ui.getWinMomentDiagnostics(),
                rematch: ui.getRematchCountdownDiagnostics()
            };
        });

        expect(immediate.win).toMatchObject({ active: true, winnerName: 'Ada', tableHidden: true });
        expect(immediate.rematch).toMatchObject({ active: false, hidden: true });

        await expect.poll(async () => hostPage.evaluate(() => {
            const ui = (window as any).__rematchResultsUI;
            return {
                win: ui.getWinMomentDiagnostics(),
                rematch: ui.getRematchCountdownDiagnostics()
            };
        }), { timeout: 2000 }).toMatchObject({
            win: { active: false, completed: true, tableHidden: false },
            rematch: { active: true, hidden: false, secondsRemaining: 3 }
        });

        const harness = hostPage.locator('#rematch-test-container');
        await expect(harness.locator('.results-rematch')).toBeVisible();
        await expect(harness.locator('#results-rematch-count')).toHaveText('3');
        await expect(harness.locator('#results-rematch-cancel')).toBeVisible();
        await expect(harness.locator('.results-win-name')).toHaveText('Ada');
        await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();
        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'rematch-countdown-armed.png'),
            fullPage: true
        });

        await harness.locator('#results-rematch-cancel').click();

        const canceled = await hostPage.evaluate(() => {
            const ui = (window as any).__rematchResultsUI;
            return {
                rematch: ui.getRematchCountdownDiagnostics(),
                autoStarts: (window as any).__rematchAutoStarts
            };
        });

        expect(canceled).toMatchObject({
            rematch: {
                active: false,
                canceled: true,
                cancelReason: 'cancel-button',
                countText: 'Canceled',
                label: ''
            },
            autoStarts: 0
        });

        await expect(harness.locator('.results-rematch-kicker')).toHaveText('Rematch canceled');
        const canceledLayout = await harness.locator('.results-rematch').evaluate((panel) => {
            const card = panel.closest('.results-content');
            const copy = panel.querySelector('.results-rematch-copy');
            const kicker = copy.querySelector('.results-rematch-kicker');
            const count = copy.querySelector('#results-rematch-count');
            const label = copy.querySelector('#results-rematch-label');
            const button = panel.querySelector('#results-rematch-cancel');
            const panelBox = panel.getBoundingClientRect();
            const cardBox = card.getBoundingClientRect();
            const kickerBox = kicker.getBoundingClientRect();
            const countBox = count.getBoundingClientRect();
            const labelBox = label.getBoundingClientRect();
            const buttonBox = button.getBoundingClientRect();
            return {
                kickerText: kicker.textContent,
                countText: count.textContent,
                labelText: label.textContent,
                labelHidden: getComputedStyle(label).display === 'none',
                countLabelOverlap: countBox.right > labelBox.left &&
                    countBox.left < labelBox.right &&
                    countBox.bottom > labelBox.top &&
                    countBox.top < labelBox.bottom,
                kickerButtonOverlap: kickerBox.right > buttonBox.left &&
                    kickerBox.left < buttonBox.right &&
                    kickerBox.bottom > buttonBox.top &&
                    kickerBox.top < buttonBox.bottom,
                countButtonOverlap: countBox.right > buttonBox.left &&
                    countBox.left < buttonBox.right &&
                    countBox.bottom > buttonBox.top &&
                    countBox.top < buttonBox.bottom,
                labelButtonOverlap: labelBox.right > buttonBox.left &&
                    labelBox.left < buttonBox.right &&
                    labelBox.bottom > buttonBox.top &&
                    labelBox.top < buttonBox.bottom,
                textBeforeButton:
                    kickerBox.right < buttonBox.left &&
                    countBox.right < buttonBox.left &&
                    labelBox.right < buttonBox.left,
                panelWithinCard:
                    panelBox.top >= cardBox.top &&
                    panelBox.left >= cardBox.left &&
                    panelBox.right <= cardBox.right &&
                    panelBox.bottom <= cardBox.bottom,
                panelBottom: panelBox.bottom,
                cardBottom: cardBox.bottom
            };
        });
        expect(canceledLayout).toMatchObject({
            kickerText: 'Rematch canceled',
            countText: 'Canceled',
            labelText: '',
            labelHidden: true,
            countLabelOverlap: false,
            kickerButtonOverlap: false,
            countButtonOverlap: false,
            labelButtonOverlap: false,
            textBeforeButton: true,
            panelWithinCard: true
        });

        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'rematch-countdown-canceled.png'),
            fullPage: true
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'rematch-countdown-cancel-diagnostics.json'),
            JSON.stringify({ immediate, canceled }, null, 2)
        );
    });

    test('uncanceled countdown invokes the play-again callback once', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });

        await gotoHost(hostPage);
        await installResultsHarness(hostPage, {
            winMomentDurationMs: 80,
            rematchCountdownDurationMs: 250,
            rematchCountdownTickMs: 50
        });

        await hostPage.evaluate(() => {
            const ui = (window as any).__rematchResultsUI;
            ui.showDerbyResults({
                winnerId: 'Grace',
                standings: [
                    { position: 1, playerId: 'Ada', roundWins: 1, totalPoints: 7 },
                    { position: 2, playerId: 'Grace', roundWins: 2, totalPoints: 10 }
                ]
            });
        });

        await expect.poll(async () => hostPage.evaluate(() => {
            const ui = (window as any).__rematchResultsUI;
            return {
                rematch: ui.getRematchCountdownDiagnostics(),
                autoStarts: (window as any).__rematchAutoStarts
            };
        }), { timeout: 3000 }).toMatchObject({
            rematch: {
                active: false,
                completed: true,
                autoStarted: true,
                hidden: true
            },
            autoStarts: 1
        });

        const autoStarted = await hostPage.evaluate(() => {
            const ui = (window as any).__rematchResultsUI;
            return {
                win: ui.getWinMomentDiagnostics(),
                rematch: ui.getRematchCountdownDiagnostics(),
                autoStarts: (window as any).__rematchAutoStarts
            };
        });

        writeFileSync(
            resolve(ARTIFACT_DIR, 'rematch-countdown-auto-diagnostics.json'),
            JSON.stringify(autoStarted, null, 2)
        );
    });
});
