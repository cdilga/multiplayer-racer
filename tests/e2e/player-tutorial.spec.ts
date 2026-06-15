import { test, expect, gotoHost, startGameFromHost, waitForRoomCode } from './fixtures';

test.describe('Player first-run tutorial', () => {
    test('shows first-run hints, persists completion, and can replay from the menu', async ({ hostPage, playerPage }) => {
        await playerPage.addInitScript(() => {
            localStorage.removeItem('jj_player_tutorial_done_v1');
        });

        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await playerPage.goto('/player?testMode=1');
        await expect(playerPage.locator('#tutorial-overlay')).toBeVisible({ timeout: 10000 });
        await expect(playerPage.locator('#tutorial-title')).toHaveText('Join from the big screen');

        await playerPage.locator('#tutorial-next').click();
        await expect(playerPage.locator('#tutorial-overlay')).toBeHidden();
        await expect.poll(async () => playerPage.evaluate(() =>
            localStorage.getItem('jj_player_tutorial_done_v1')
        )).toBeNull();

        await playerPage.fill('#player-name', 'TutorialRacer');
        await playerPage.fill('#room-code', roomCode);
        await playerPage.click('#join-btn');
        await playerPage.waitForFunction(() => {
            // @ts-ignore - gameState is exposed for tests
            return window.gameState?.playerId !== null;
        }, { timeout: 30000 });
        await expect(hostPage.locator('#player-list')).toContainText('TutorialRacer', { timeout: 30000 });

        await startGameFromHost(hostPage);

        await expect(playerPage.locator('#tutorial-overlay')).toBeVisible({ timeout: 10000 });
        await expect(playerPage.locator('#tutorial-title')).toHaveText('Steer on the left');

        await playerPage.locator('#tutorial-next').click();
        await expect(playerPage.locator('#tutorial-title')).toHaveText('Drive on the right');
        await playerPage.locator('#tutorial-next').click();
        await expect(playerPage.locator('#tutorial-title')).toHaveText('Watch speed and status');
        await playerPage.locator('#tutorial-next').click();
        await expect(playerPage.locator('#tutorial-title')).toHaveText('Recover from trouble');
        await playerPage.locator('#tutorial-next').click();

        await expect(playerPage.locator('#tutorial-overlay')).toBeHidden();
        await expect.poll(async () => playerPage.evaluate(() =>
            localStorage.getItem('jj_player_tutorial_done_v1')
        )).toBe('1');

        await playerPage.locator('#player-menu-btn').click();
        await playerPage.locator('#player-menu-replay-tutorial').click();
        await expect(playerPage.locator('#tutorial-overlay')).toBeVisible();
        await expect(playerPage.locator('#tutorial-title')).toHaveText('Steer on the left');

        await playerPage.locator('#tutorial-skip').click();
        await expect(playerPage.locator('#tutorial-overlay')).toBeHidden();
    });
});
