import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, gotoHost } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.24');

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

async function installResultsHarness(hostPage) {
    await waitForHostReadyAndClearWarmup(hostPage);
    await hostPage.waitForFunction(() => !!(window as any).ResultsUI, null, { timeout: 30000 });
    await hostPage.evaluate(() => {
        document.querySelector('#derby-standings-sting-test-container')?.remove();
        const container = document.createElement('div');
        container.id = 'derby-standings-sting-test-container';
        document.body.appendChild(container);
        const events: Record<string, Function[]> = {};
        const eventBus = {
            on(type: string, callback: Function) {
                events[type] = events[type] || [];
                events[type].push(callback);
            },
            emit(type: string, payload: unknown) {
                for (const callback of events[type] || []) callback(payload);
            }
        };
        const ui = new (window as any).ResultsUI({
            container,
            eventBus,
            derbyStingDurationMs: 650,
            winMomentDurationMs: 80,
            rematchCountdownDurationMs: 3000,
            rematchCountdownTickMs: 250
        });
        ui.init();
        (window as any).__derbyStandingsStingUI = ui;
        (window as any).__derbyStandingsStingBus = eventBus;
    });
}

async function getStingLayout(hostPage) {
    return hostPage.locator('#derby-standings-sting-test-container .results-derby-sting').evaluate((root) => {
        const card = root.querySelector('.results-derby-sting-card') as HTMLElement;
        const rows = [...root.querySelectorAll('.results-derby-sting-row')] as HTMLElement[];
        const winner = root.querySelector('.results-derby-sting-winner') as HTMLElement;
        const badge = root.querySelector('.results-derby-sting-badge') as HTMLElement;
        const rootBox = root.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        const winnerBox = winner.getBoundingClientRect();
        const badgeBox = badge.getBoundingClientRect();
        const rowBoxes = rows.map((row) => {
            const box = row.getBoundingClientRect();
            return {
                top: box.top,
                bottom: box.bottom,
                left: box.left,
                right: box.right,
                width: box.width,
                height: box.height
            };
        });
        const boxesOverlap = (a, b) => !(
            a.right <= b.left ||
            b.right <= a.left ||
            a.bottom <= b.top ||
            b.bottom <= a.top
        );
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            root: {
                top: rootBox.top,
                bottom: rootBox.bottom,
                left: rootBox.left,
                right: rootBox.right,
                width: rootBox.width,
                height: rootBox.height
            },
            card: {
                top: cardBox.top,
                bottom: cardBox.bottom,
                left: cardBox.left,
                right: cardBox.right,
                width: cardBox.width,
                height: cardBox.height,
                boxShadow: getComputedStyle(card).boxShadow,
                borderTopWidth: getComputedStyle(card).borderTopWidth
            },
            winner: {
                text: winner.textContent,
                width: winnerBox.width,
                right: winnerBox.right
            },
            badge: {
                text: badge.textContent,
                left: badgeBox.left,
                width: badgeBox.width
            },
            rowBoxes,
            rowCount: rowBoxes.length,
            rootInsideViewport:
                rootBox.top >= 0 &&
                rootBox.left >= 0 &&
                rootBox.right <= window.innerWidth &&
                rootBox.bottom <= window.innerHeight,
            cardInsideRoot:
                cardBox.top >= rootBox.top &&
                cardBox.left >= rootBox.left &&
                cardBox.right <= rootBox.right + 1 &&
                cardBox.bottom <= rootBox.bottom + 1,
            rowsInsideCard: rowBoxes.every((box) =>
                box.top >= cardBox.top &&
                box.left >= cardBox.left &&
                box.right <= cardBox.right + 1 &&
                box.bottom <= cardBox.bottom + 1
            ),
            rowOverlapCount: rowBoxes.reduce((count, box, index) => {
                return count + rowBoxes.slice(index + 1).filter((other) => boxesOverlap(box, other)).length;
            }, 0),
            winnerBadgeOverlap: boxesOverlap(winnerBox, badgeBox)
        };
    });
}

test.describe('5k3.24 derby standings sting', () => {
    test('round-end event shows a quick host-only standings sting without opening results modal', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        await hostPage.setViewportSize({ width: 1280, height: 720 });

        await gotoHost(hostPage);
        await installResultsHarness(hostPage);

        await hostPage.evaluate(() => {
            (window as any).__derbyStandingsStingBus.emit('derby:roundEnd', {
                round: 2,
                winnerId: 'Grace',
                scores: {
                    Grace: 9,
                    Ada: 5,
                    Linus: 3,
                    Hopper: 1
                },
                eliminationOrder: [
                    { playerId: 'Hopper' },
                    { playerId: 'Linus' },
                    { playerId: 'Ada' }
                ]
            });
        });

        const harness = hostPage.locator('#derby-standings-sting-test-container');
        await expect(harness.locator('.results-derby-sting')).toBeVisible();
        await expect(harness.locator('.results-ui')).not.toBeVisible();
        await expect(harness.locator('#results-derby-sting-round')).toHaveText('Round 2');
        await expect(harness.locator('#results-derby-sting-winner')).toHaveText('Grace wins');
        await expect(harness.locator('.results-derby-sting-row')).toHaveCount(3);
        await expect(harness.locator('.results-derby-sting-row').first()).toContainText('Grace');

        const diagnostics = {
            state: await hostPage.evaluate(() => {
                const ui = (window as any).__derbyStandingsStingUI;
                return ui.getDerbyStandingsStingDiagnostics();
            }),
            layout: await getStingLayout(hostPage),
            loadingOverlayVisible: await hostPage.locator('#loading-overlay').isVisible()
        };

        expect(diagnostics.state).toMatchObject({
            active: true,
            completed: false,
            hidden: false,
            modalVisible: false,
            round: 2,
            winnerName: 'Grace',
            rowCount: 3,
            durationMs: 650
        });
        expect(diagnostics.layout.viewport).toEqual({ width: 1280, height: 720 });
        expect(diagnostics.layout.rootInsideViewport).toBe(true);
        expect(diagnostics.layout.cardInsideRoot).toBe(true);
        expect(diagnostics.layout.rowsInsideCard).toBe(true);
        expect(diagnostics.layout.rowOverlapCount).toBe(0);
        expect(diagnostics.layout.winnerBadgeOverlap).toBe(false);
        expect(diagnostics.layout.card.height).toBeLessThanOrEqual(180);
        expect(diagnostics.layout.card.borderTopWidth).toBe('4px');
        expect(diagnostics.layout.card.boxShadow).not.toBe('none');
        expect(diagnostics.loadingOverlayVisible).toBe(false);

        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'derby-standings-sting.png'),
            fullPage: true
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'derby-standings-sting-diagnostics.json'),
            JSON.stringify(diagnostics, null, 2)
        );

        await expect.poll(async () => hostPage.evaluate(() => {
            const ui = (window as any).__derbyStandingsStingUI;
            return ui.getDerbyStandingsStingDiagnostics();
        }), { timeout: 2500 }).toMatchObject({
            active: false,
            completed: true,
            hidden: true,
            modalVisible: false
        });
    });
});
