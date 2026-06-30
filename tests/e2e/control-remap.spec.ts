import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoHost, waitForRoomCode } from './fixtures';

const MOBILE_CONTEXT = {
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
};

const ARTIFACT_DIR = 'artifacts/br-captain-call-architecture-hardening-woq.5';

async function capture(page: Page, fileName: string) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
        path: `${ARTIFACT_DIR}/${fileName}`,
        fullPage: true,
    });
}

async function waitForJoinScreen(page: Page) {
    await page.goto('/player?testMode=1');
    await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
}

async function joinCurrentPage(page: Page, roomCode: string, playerName: string) {
    await page.fill('#player-name', playerName);
    await page.fill('#room-code', roomCode);
    await page.click('#join-btn');
    await page.waitForFunction(
        () => {
            // @ts-ignore
            const gs = window.gameState;
            return gs && gs.playerId !== null;
        },
        null,
        { timeout: 30000 }
    );
}

test.describe('player control remaps', () => {
    test('persist across refresh and rejoin on the same device while another device keeps defaults', async ({ browser }) => {
        const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const playerContextA = await browser.newContext(MOBILE_CONTEXT);
        const playerContextB = await browser.newContext(MOBILE_CONTEXT);

        try {
            const hostPage = await hostContext.newPage();
            await gotoHost(hostPage);
            const roomCode = await waitForRoomCode(hostPage);

            const playerPageA = await playerContextA.newPage();
            await waitForJoinScreen(playerPageA);

            await playerPageA.click('#join-controls-btn');
            await expect(playerPageA.locator('#control-remap-modal')).toBeVisible();
            await playerPageA.click('[data-touch-scheme="southpaw"]');
            await playerPageA.click('[data-keyboard-preset="ijkl"]');
            await expect(playerPageA.locator('#control-remap-summary-join')).toContainText('Steer right · pedals left');
            await expect(playerPageA.locator('#control-remap-summary-join')).toContainText('IJKL');
            await capture(playerPageA, 'same-device-remap-before-refresh.png');

            await playerPageA.click('#control-remap-close');
            await joinCurrentPage(playerPageA, roomCode, 'RemapPersistA');

            await playerPageA.reload({ waitUntil: 'domcontentloaded' });
            await playerPageA.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
            await expect(playerPageA.locator('#control-remap-summary-join')).toContainText('Steer right · pedals left');
            await expect(playerPageA.locator('#control-remap-summary-join')).toContainText('IJKL');
            await capture(playerPageA, 'same-device-remap-after-refresh.png');

            await joinCurrentPage(playerPageA, roomCode, 'RemapPersistB');

            const playerPageB = await playerContextB.newPage();
            await waitForJoinScreen(playerPageB);
            await expect(playerPageB.locator('#control-remap-summary-join')).toContainText('Steer left · pedals right');
            await expect(playerPageB.locator('#control-remap-summary-join')).toContainText('WASD + Arrows');
            await expect(playerPageB.locator('#control-remap-summary-join')).not.toContainText('IJKL');
            await capture(playerPageB, 'second-device-defaults.png');
        } finally {
            await playerContextB.close();
            await playerContextA.close();
            await hostContext.close();
        }
    });

    test('supports keyboard access, escape close, and reset defaults from the remap modal', async ({ browser }) => {
        const playerContext = await browser.newContext(MOBILE_CONTEXT);

        try {
            const page = await playerContext.newPage();
            await waitForJoinScreen(page);

            const launcher = page.locator('#join-controls-btn');
            await launcher.focus();
            await page.keyboard.press('Enter');
            await expect(page.locator('#control-remap-modal')).toBeVisible();

            await page.keyboard.press('Escape');
            await expect(page.locator('#control-remap-modal')).toBeHidden();
            await expect(launcher).toBeFocused();

            await launcher.click();
            await page.click('[data-touch-scheme="southpaw"]');
            await page.click('[data-keyboard-preset="ijkl"]');
            await expect(page.locator('#control-remap-summary-join')).toContainText('Steer right · pedals left');
            await expect(page.locator('#control-remap-summary-join')).toContainText('IJKL');

            await page.click('#control-remap-reset');
            await expect(page.locator('#control-remap-summary-join')).toContainText('Steer left · pedals right');
            await expect(page.locator('#control-remap-summary-join')).toContainText('WASD + Arrows');
            await expect(page.locator('#control-remap-status')).toContainText('Reset to the local default control layout.');
            await capture(page, 'remap-reset-accessibility.png');
        } finally {
            await playerContext.close();
        }
    });
});
