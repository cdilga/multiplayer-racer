import { test, expect } from '@playwright/test';
import { gotoHost, waitForRoomCode } from './fixtures';

// Join / onboarding flow for the player (phone) screen. These run locally and
// as regression; CI only runs full-game.spec.ts. Player navigations use
// testMode=1 to force polling-only sockets (more reliable under test).

test.describe('Player join flow', () => {
    test('arriving with ?room=abcd prefills the code uppercased and shows the banner', async ({ page }) => {
        await page.goto('/player?room=abcd&testMode=1');
        await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

        await expect(page.locator('#room-code')).toHaveValue('ABCD');
        await expect(page.locator('#auto-join-message')).toBeVisible();
        await expect(page.locator('#detected-room-code')).toHaveText('ABCD');
    });

    test('room-code input forces uppercase and strips non-alphanumerics', async ({ page }) => {
        await page.goto('/player?testMode=1');
        await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

        await page.fill('#room-code', '');
        await page.type('#room-code', 'xy9!');
        await expect(page.locator('#room-code')).toHaveValue('XY9');
    });

    test('an unknown room code surfaces a friendly inline error and re-enables join', async ({ page }) => {
        await page.goto('/player?testMode=1');
        await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

        // Wait for the socket to connect so the join attempt reaches the server.
        await page.waitForFunction(() => (window as any).gameState?.connected === true, null, { timeout: 30000 });

        await page.fill('#player-name', 'Nobody');
        await page.fill('#room-code', 'ZZZZ');
        await page.click('#join-btn');

        const error = page.locator('#error-message');
        await expect(error).toBeVisible({ timeout: 10000 });
        await expect(error).toContainText(/wasn't found|invalid/i);
        // Still on the join screen, button usable again
        await expect(page.locator('#join-screen')).toBeVisible();
        await expect(page.locator('#join-btn')).not.toHaveClass(/joining/);
    });

    test('Enter key in the form submits the join', async ({ browser }) => {
        const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const hostPage = await hostContext.newPage();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        const playerContext = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const playerPage = await playerContext.newPage();
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

        await playerPage.fill('#player-name', 'EnterKey');
        await playerPage.fill('#room-code', roomCode);
        await playerPage.press('#room-code', 'Enter');

        await playerPage.waitForFunction(
            () => (window as any).gameState && (window as any).gameState.playerId !== null,
            null,
            { timeout: 30000 }
        );
        await expect(hostPage.locator('#player-list')).toContainText('EnterKey');

        await playerContext.close();
        await hostContext.close();
    });

    test('the 🎲 button fills a random name', async ({ page }) => {
        await page.goto('/player?testMode=1');
        await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

        await page.fill('#player-name', '');
        await page.click('#generate-name-btn');
        await expect(page.locator('#player-name')).not.toHaveValue('');
    });
});
