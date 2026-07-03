import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, gotoHost } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.22');

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
        document.querySelector('#results-reskin-test-container')?.remove();
        const container = document.createElement('div');
        container.id = 'results-reskin-test-container';
        document.body.appendChild(container);
        const ui = new (window as any).ResultsUI({
            container,
            winMomentDurationMs: opts.winMomentDurationMs,
            rematchCountdownDurationMs: opts.rematchCountdownDurationMs,
            rematchCountdownTickMs: opts.rematchCountdownTickMs
        });
        ui.eventBus = null;
        ui.init();
        (window as any).__resultsReskinAutoStarts = 0;
        ui.setOnPlayAgain(() => {
            (window as any).__resultsReskinAutoStarts += 1;
        });
        (window as any).__resultsReskinUI = ui;
    }, {
        winMomentDurationMs: options.winMomentDurationMs ?? 80,
        rematchCountdownDurationMs: options.rematchCountdownDurationMs ?? 3000,
        rematchCountdownTickMs: options.rematchCountdownTickMs ?? 250
    });
}

async function getLayoutDiagnostics(hostPage) {
    return hostPage.locator('#results-reskin-test-container .results-ui').evaluate((root) => {
        const card = root.querySelector('.results-content');
        const podium = root.querySelector('.results-podium');
        const table = root.querySelector('.results-table');
        const actions = root.querySelector('.results-actions');
        const rematch = root.querySelector('.results-rematch');
        const label = root.querySelector('.results-chrome-label');
        const title = root.querySelector('.results-title');
        const cardBox = card.getBoundingClientRect();
        const boxes = { podium, table, actions, rematch, label, title };
        const rects = Object.fromEntries(Object.entries(boxes).map(([key, element]) => {
            const box = element.getBoundingClientRect();
            return [key, {
                top: box.top,
                bottom: box.bottom,
                left: box.left,
                right: box.right,
                width: box.width,
                height: box.height,
                visible: box.width > 0 && box.height > 0
            }];
        }));
        const withinCard = Object.fromEntries(Object.entries(rects).map(([key, box]) => [
            key,
            box.top >= cardBox.top &&
                box.left >= cardBox.left &&
                box.right <= cardBox.right + 1 &&
                box.bottom <= cardBox.bottom + 1
        ]));
        const style = getComputedStyle(card);
        const uiAfter = getComputedStyle(root, '::after');
        return {
            rects,
            withinCard,
            card: {
                width: cardBox.width,
                height: cardBox.height,
                maxHeight: style.maxHeight,
                overflowY: style.overflowY,
                borderTopWidth: style.borderTopWidth,
                borderRadius: style.borderRadius,
                boxShadow: style.boxShadow
            },
            title: {
                text: title.textContent,
                textShadow: getComputedStyle(title).textShadow,
                textTransform: getComputedStyle(title).textTransform
            },
            chromeLabel: {
                text: label.textContent,
                textTransform: getComputedStyle(label).textTransform
            },
            scanline: {
                content: uiAfter.content,
                opacity: uiAfter.opacity
            }
        };
    });
}

test.describe('5k3.22 results screen reskin', () => {
    test('race results use sticker/CRT chrome without crowding rematch strip', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });

        await gotoHost(hostPage);
        await installResultsHarness(hostPage);

        await hostPage.evaluate(() => {
            const ui = (window as any).__resultsReskinUI;
            ui.showResults([
                { position: 1, playerId: 'Ada', finishTime: 61000, bestLapTime: 20000 },
                { position: 2, playerId: 'Grace', finishTime: 64000, bestLapTime: 21000 },
                { position: 3, playerId: 'Linus', finishTime: 69000, bestLapTime: 22000 }
            ]);
        });

        await expect.poll(async () => hostPage.evaluate(() => {
            const ui = (window as any).__resultsReskinUI;
            return {
                win: ui.getWinMomentDiagnostics(),
                rematch: ui.getRematchCountdownDiagnostics()
            };
        }), { timeout: 2000 }).toMatchObject({
            win: { active: false, completed: true },
            rematch: { active: true, hidden: false }
        });

        const harness = hostPage.locator('#results-reskin-test-container');
        await expect(harness.locator('.results-chrome-label')).toHaveText('Skip Bin Arcade Results');
        await expect(harness.locator('.results-title')).toHaveText('Race Complete!');
        await expect(harness.locator('.results-table')).toBeVisible();
        await expect(harness.locator('.results-rematch')).toBeVisible();
        await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();

        const diagnostics = await getLayoutDiagnostics(hostPage);
        expect(diagnostics.chromeLabel.textTransform).toBe('uppercase');
        expect(diagnostics.title.textTransform).toBe('uppercase');
        expect(diagnostics.title.textShadow).not.toBe('none');
        expect(diagnostics.card.overflowY).toBe('auto');
        expect(diagnostics.card.borderTopWidth).toBe('4px');
        expect(diagnostics.card.boxShadow).not.toBe('none');
        expect(diagnostics.scanline.content).not.toBe('none');
        expect(Number(diagnostics.scanline.opacity)).toBeGreaterThan(0);
        expect(diagnostics.withinCard.podium).toBe(true);
        expect(diagnostics.withinCard.table).toBe(true);
        expect(diagnostics.withinCard.actions).toBe(true);
        expect(diagnostics.withinCard.rematch).toBe(true);
        expect(diagnostics.card.height).toBeLessThanOrEqual(648);

        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'results-reskin-race.png'),
            fullPage: true
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'results-reskin-race-diagnostics.json'),
            JSON.stringify(diagnostics, null, 2)
        );
    });

    test('derby results and canceled rematch strip remain readable inside the card', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });

        await gotoHost(hostPage);
        await installResultsHarness(hostPage);

        await hostPage.evaluate(() => {
            const ui = (window as any).__resultsReskinUI;
            ui.showDerbyResults({
                winnerId: 'Grace',
                standings: [
                    { position: 1, playerId: 'Grace', roundWins: 2, totalPoints: 10 },
                    { position: 2, playerId: 'Ada', roundWins: 1, totalPoints: 7 },
                    { position: 3, playerId: 'Linus', roundWins: 0, totalPoints: 4 }
                ]
            });
        });

        await expect.poll(async () => hostPage.evaluate(() => {
            const ui = (window as any).__resultsReskinUI;
            return ui.getRematchCountdownDiagnostics();
        }), { timeout: 2000 }).toMatchObject({
            active: true,
            hidden: false
        });

        const harness = hostPage.locator('#results-reskin-test-container');
        await harness.locator('#results-rematch-cancel').click();

        const canceled = await hostPage.evaluate(() => {
            const ui = (window as any).__resultsReskinUI;
            return {
                rematch: ui.getRematchCountdownDiagnostics(),
                autoStarts: (window as any).__resultsReskinAutoStarts
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

        const layout = await harness.locator('.results-rematch').evaluate((panel) => {
            const card = panel.closest('.results-content');
            const copy = panel.querySelector('.results-rematch-copy');
            const kicker = copy.querySelector('.results-rematch-kicker');
            const count = copy.querySelector('#results-rematch-count');
            const label = copy.querySelector('#results-rematch-label');
            const button = panel.querySelector('#results-rematch-cancel');
            const cardBox = card.getBoundingClientRect();
            const panelBox = panel.getBoundingClientRect();
            const kickerBox = kicker.getBoundingClientRect();
            const countBox = count.getBoundingClientRect();
            const labelBox = label.getBoundingClientRect();
            const buttonBox = button.getBoundingClientRect();
            const intersects = (a, b) => a.right > b.left &&
                a.left < b.right &&
                a.bottom > b.top &&
                a.top < b.bottom;
            return {
                kickerText: kicker.textContent,
                countText: count.textContent,
                labelText: label.textContent,
                labelHidden: getComputedStyle(label).display === 'none',
                panelWithinCard:
                    panelBox.top >= cardBox.top &&
                    panelBox.left >= cardBox.left &&
                    panelBox.right <= cardBox.right + 1 &&
                    panelBox.bottom <= cardBox.bottom + 1,
                kickerButtonOverlap: intersects(kickerBox, buttonBox),
                countButtonOverlap: intersects(countBox, buttonBox),
                labelButtonOverlap: intersects(labelBox, buttonBox)
            };
        });
        expect(layout).toMatchObject({
            kickerText: 'Rematch canceled',
            countText: 'Canceled',
            labelText: '',
            labelHidden: true,
            panelWithinCard: true,
            kickerButtonOverlap: false,
            countButtonOverlap: false,
            labelButtonOverlap: false
        });

        const diagnostics = await getLayoutDiagnostics(hostPage);
        expect(diagnostics.withinCard.table).toBe(true);
        expect(diagnostics.withinCard.actions).toBe(true);
        expect(diagnostics.withinCard.rematch).toBe(true);
        expect(diagnostics.card.height).toBeLessThanOrEqual(648);

        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'results-reskin-derby-canceled.png'),
            fullPage: true
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'results-reskin-derby-canceled-diagnostics.json'),
            JSON.stringify({ canceled, layout, diagnostics }, null, 2)
        );
    });
});
