import { test, expect, waitForRoomCode, gotoHost, joinGameAsPlayer, startGameFromHost } from './fixtures';

/**
 * br-kick-car-force-reconnect — full loop: host kicks a car -> despawn -> that
 * phone is bounced to the rejoin flow -> the seat is immediately re-joinable.
 */
test.describe('host kick a car (kick-car)', () => {
    test('kicking a player despawns the car, bounces the phone to rejoin, frees the seat', async ({ hostPage, playerPage, browser }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Three players, each its own device (own context).
        await joinGameAsPlayer(playerPage, roomCode, 'Keeper1');
        const p2ctx = await browser.newContext();
        const p2 = await p2ctx.newPage();
        await joinGameAsPlayer(p2, roomCode, 'KickMe2');
        const p3ctx = await browser.newContext();
        const p3 = await p3ctx.newPage();
        await joinGameAsPlayer(p3, roomCode, 'Keeper3');
        await expect(hostPage.locator('#player-list')).toContainText('KickMe2', { timeout: 30000 });

        await startGameFromHost(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.vehicles?.size >= 3 && game.engine.getState() === 'racing';
        }, undefined, { timeout: 30000 });

        // The player id KickMe2 was assigned.
        const p2Id = await p2.evaluate(() => (window as any).gameState.playerId);
        expect(p2Id).toBeTruthy();

        // Host kicks player 2 (the host player-list ✕ button calls this same path).
        await hostPage.evaluate((id) => {
            // @ts-ignore
            window.game.kickPlayer(id);
        }, p2Id);

        // 1) The kicked car despawns on the host (3 -> 2), keepers remain.
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            return window.game.vehicles.size === 2;
        }, undefined, { timeout: 8000 });

        // 2) The kicked phone is bounced to the join/rejoin flow (not frozen).
        await expect(p2.locator('#join-screen')).toBeVisible({ timeout: 8000 });

        // 3) The freed seat is immediately re-joinable (no ghost car left behind).
        await joinGameAsPlayer(p2, roomCode, 'Rejoined2');
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            // Back to 3 cars, and no duplicate ghost seats.
            return game.vehicles.size === 3;
        }, undefined, { timeout: 30000 });

        await p2ctx.close();
        await p3ctx.close();
    });
});
