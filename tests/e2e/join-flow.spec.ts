import { test, expect, gotoHost, joinGameAsPlayer, resetE2ERooms, startGameFromHost, waitForRoomCode } from './fixtures';

// Join / onboarding flow for the player (phone) screen. These run locally and
// as regression; CI only runs full-game.spec.ts. Player navigations use
// testMode=1 to force polling-only sockets (more reliable under test).

test.describe('Player join flow', () => {
    test.beforeEach(async ({ request }) => {
        await resetE2ERooms(request);
    });

    test.afterEach(async ({ browser, request }) => {
        await Promise.all(browser.contexts().map(async (context) => {
            try {
                await context.close();
            } catch (error) {
                // Playwright may already be tearing down its fixture context.
            }
        }));
        await resetE2ERooms(request);
    });

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

    test('duplicate controller tab prompts for takeover and keeps one lobby seat', async ({ browser }) => {
        const mobileContextOptions = {
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        };
        const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const hostPage = await hostContext.newPage();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        const playerContext = await browser.newContext(mobileContextOptions);
        const primaryPage = await playerContext.newPage();
        await joinGameAsPlayer(primaryPage, roomCode, 'SeatOwner');
        await expect(hostPage.locator('#player-list')).toContainText('SeatOwner');

        const firstSeatState = await primaryPage.evaluate(() => {
            // @ts-ignore
            const state = window.gameState;
            return {
                playerId: state.playerId,
                seatId: state.seatId,
                leaseVersion: state.leaseVersion,
            };
        });

        const duplicatePage = await playerContext.newPage();
        await duplicatePage.goto('/player?testMode=1');
        await duplicatePage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
        await duplicatePage.fill('#player-name', 'SeatOwner');
        await duplicatePage.fill('#room-code', roomCode);

        const dialogPromise = duplicatePage.waitForEvent('dialog');
        await duplicatePage.dispatchEvent('#join-btn', 'click');
        const dialog = await dialogPromise;
        expect(dialog.message()).toMatch(/already connected|take over/i);
        await dialog.accept();

        await duplicatePage.waitForFunction(() => {
            // @ts-ignore
            const state = window.gameState;
            return state?.playerId !== null && Number(state?.leaseVersion) >= 2;
        }, null, { timeout: 30000 });

        const secondSeatState = await duplicatePage.evaluate(() => {
            // @ts-ignore
            const state = window.gameState;
            return {
                playerId: state.playerId,
                seatId: state.seatId,
                leaseVersion: state.leaseVersion,
            };
        });

        expect(secondSeatState.playerId).toBe(firstSeatState.playerId);
        expect(secondSeatState.seatId).toBe(firstSeatState.seatId);
        expect(secondSeatState.leaseVersion).toBeGreaterThan(firstSeatState.leaseVersion);

        await expect(primaryPage.locator('#waiting-screen')).toBeVisible({ timeout: 10000 });
        await expect(primaryPage.locator('#join-screen')).toBeHidden();

        const playerRows = hostPage.locator('#player-list li');
        await expect(playerRows).toHaveCount(1);
        await expect(playerRows.first()).toContainText('SeatOwner');

        await playerContext.close();
        await hostContext.close();
    });

    test('host loss leaves the phone on a waiting/reconnect state instead of resetting the join flow', async ({ browser }) => {
        const mobileContextOptions = {
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        };
        const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const hostPage = await hostContext.newPage();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        const playerContext = await browser.newContext(mobileContextOptions);
        const playerPage = await playerContext.newPage();
        await joinGameAsPlayer(playerPage, roomCode, 'GraceSeat');
        await startGameFromHost(hostPage);
        await expect(playerPage.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 10000 });

        const preLossState = await playerPage.evaluate(() => {
            // @ts-ignore
            const state = window.gameState;
            return {
                playerId: state.playerId,
                roomCode: state.roomCode,
            };
        });

        await hostPage.evaluate(() => {
            // @ts-ignore
            window.game.systems.network.socket.disconnect();
        });

        await expect(playerPage.locator('#waiting-screen')).toBeVisible({ timeout: 15000 });
        await expect(playerPage.locator('#join-screen')).toBeHidden();

        const postLossState = await playerPage.evaluate(() => {
            // @ts-ignore
            const state = window.gameState;
            return {
                playerId: state.playerId,
                roomCode: state.roomCode,
                roomPhase: state.roomPhase,
                gameStarted: state.gameStarted,
            };
        });

        expect(postLossState.playerId).toBe(preLossState.playerId);
        expect(postLossState.roomCode).toBe(preLossState.roomCode);
        expect(postLossState.roomPhase).toBe('host_lost');
        expect(postLossState.gameStarted).toBe(false);

        await playerContext.close();
        await hostContext.close();
    });
});
