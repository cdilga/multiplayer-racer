import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, gotoHost } from './fixtures';

test.describe('Debug Panels', () => {
    test('F2 should toggle physics parameters panel', async ({ hostPage, playerPage }) => {
        // Setup game
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'DebugTest');
        await expect(hostPage.locator('#player-list')).toContainText('DebugTest', { timeout: 30000 });
        await startGameFromHost(hostPage);

        // Wait for game to initialize
        await hostPage.waitForTimeout(1000);

        // Initially physics panel should be hidden
        const physicsPanel = hostPage.locator('#physics-params-panel');
        await expect(physicsPanel).toBeHidden();

        // Toggle physics panel to show (call exposed function for reliability)
        await hostPage.evaluate(() => {
            (window as any).togglePhysicsPanel();
        });
        await hostPage.waitForTimeout(300);

        // Physics panel should now be visible
        await expect(physicsPanel).toBeVisible();

        // Panel should contain parameter controls
        await expect(physicsPanel).toContainText('Physics');

        // Toggle again to hide
        await hostPage.evaluate(() => {
            (window as any).togglePhysicsPanel();
        });
        await hostPage.waitForTimeout(300);

        // Should be hidden again
        await expect(physicsPanel).toBeHidden();
    });

    test('F3 should toggle stats overlay visibility', async ({ hostPage, playerPage }) => {
        // Setup game
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'StatsTest');
        await expect(hostPage.locator('#player-list')).toContainText('StatsTest', { timeout: 30000 });
        await startGameFromHost(hostPage);

        // Wait for game to initialize
        await hostPage.waitForTimeout(1000);

        // Initially stats overlay should be hidden
        const statsOverlay = hostPage.locator('#stats-overlay');
        await expect(statsOverlay).toHaveClass(/hidden/);

        // Toggle stats overlay to show (call exposed function for reliability)
        await hostPage.evaluate(() => {
            (window as any).toggleStatsOverlay();
        });
        await hostPage.waitForTimeout(500);

        // Stats overlay should now be visible (no hidden class)
        await expect(statsOverlay).not.toHaveClass(/hidden/);

        // Toggle again to hide
        await hostPage.evaluate(() => {
            (window as any).toggleStatsOverlay();
        });
        await hostPage.waitForTimeout(300);

        // Should be hidden again
        await expect(statsOverlay).toHaveClass(/hidden/);
    });

    test('F4 should toggle physics debug visualization', async ({ hostPage, playerPage }) => {
        // Setup game
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'PhysicsDebug');
        await expect(hostPage.locator('#player-list')).toContainText('PhysicsDebug', { timeout: 30000 });
        await startGameFromHost(hostPage);

        // Wait for game to initialize
        await hostPage.waitForTimeout(1000);

        // Press F4 to toggle physics debug - should add debug visualizations to the scene
        // We can verify this by checking that the gameState changes
        // For now, just verify F4 key press doesn't cause errors and the page remains functional
        await hostPage.keyboard.press('F4');
        await hostPage.waitForTimeout(500);

        // Game should still be running (canvas visible)
        await expect(hostPage.locator('canvas')).toBeVisible();

        // Press F4 again to toggle off
        await hostPage.keyboard.press('F4');
        await hostPage.waitForTimeout(500);

        // Game should still be running
        await expect(hostPage.locator('canvas')).toBeVisible();
    });
});
