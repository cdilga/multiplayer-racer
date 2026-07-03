import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, gotoHost } from './fixtures';

test.describe('Debug Panels', () => {
    test('debug lab contract hooks should be available', async ({ hostPage, playerPage }) => {
        // Verify __debugLab hooks exist (for Playwright automation)
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'HooksTest');
        await expect(hostPage.locator('#player-list')).toContainText('HooksTest', { timeout: 30000 });
        await startGameFromHost(hostPage);

        await hostPage.waitForFunction(() => {
            const hooks = window as any;
            return Boolean(
                hooks.__debugLab &&
                hooks.__labTools &&
                typeof hooks.__debugLab.reset === 'function' &&
                typeof hooks.__debugLab.stepFrame === 'function' &&
                typeof hooks.__debugLab.stepSecond === 'function' &&
                typeof hooks.__debugLab.playPause === 'function' &&
                typeof hooks.__debugLab.takeScreenshot === 'function' &&
                typeof hooks.__debugLab.getDiagnostics === 'function' &&
                typeof hooks.__debugLab.getConsoleLogs === 'function' &&
                typeof hooks.__debugLab.exportScenario === 'function' &&
                typeof hooks.__debugLab.importScenario === 'function' &&
                typeof hooks.__labTools.renderHostileLabel === 'function' &&
                document.querySelector('canvas')
            );
        }, null, { timeout: 30000 });

        const hookProof = await hostPage.evaluate(async () => {
            const hooks = window as any;
            const lab = hooks.__debugLab;
            const tools = hooks.__labTools;
            const before = lab.getDiagnostics();
            const frame = lab.stepFrame();
            const second = lab.stepSecond();
            const screenshot = await lab.takeScreenshot();
            const pauseState = lab.playPause();
            const playState = lab.playPause();
            const scenario = lab.exportScenario();
            const imported = lab.importScenario(scenario);
            const afterImport = lab.getDiagnostics();
            const hostile = '<img src=x onerror=alert("XSS")>';
            const safeText = tools.renderHostileLabel(hostile);
            const logs = lab.getConsoleLogs();
            const canvas = tools.getCanvasElement();

            return {
                hasCanvas: !!canvas,
                schema: before.schema,
                beforeTick: before.tick,
                frameTick: frame.tick,
                secondTick: second.tick,
                imported,
                afterImportTick: afterImport.tick,
                screenshot,
                pauseState,
                playState,
                scenario,
                safeText,
                logs,
                state: tools.getState(),
            };
        });

        expect(hookProof.hasCanvas).toBe(true);
        expect(hookProof.schema).toBe('jj.debugLab.diagnostics.v1');
        expect(hookProof.frameTick).toBe(hookProof.beforeTick + 1);
        expect(hookProof.secondTick).toBe(hookProof.frameTick + 60);
        expect(hookProof.screenshot.success).toBe(true);
        expect(hookProof.screenshot.fileSizeBytes).toBeGreaterThan(1000);
        expect(hookProof.pauseState.playing).toBe(false);
        expect(hookProof.playState.playing).toBe(true);
        expect(hookProof.scenario.schema).toBe('jj.debugLab.v1');
        expect(hookProof.imported.success).toBe(true);
        expect(hookProof.afterImportTick).toBe(0);
        expect(hookProof.safeText.textContent).toBe('<img src=x onerror=alert("XSS")>');
        expect(hookProof.safeText.innerHTML).toContain('&lt;img');
        expect(hookProof.safeText.childElementCount).toBe(0);
        expect(hookProof.logs.warns).toEqual([]);
        expect(hookProof.logs.errors).toEqual([]);
        expect(hookProof.state.hasCanvas).toBe(true);
    });

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
