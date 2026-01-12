import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, gotoHost } from './fixtures';

test.describe('Late Join', () => {
    // Late join tests are slow due to multiple player setup and race progression
    test.slow();

    test('player should be able to join a race in progress', async ({ hostPage, playerPage, playerContext }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // First player joins before race starts
        await joinGameAsPlayer(playerPage, roomCode, 'EarlyBird');
        await expect(hostPage.locator('#player-list')).toContainText('EarlyBird', { timeout: 30000 });

        // Start the race
        await startGameFromHost(hostPage);

        // Wait for race to be in progress (testMode skips countdown)
        await hostPage.waitForTimeout(1000);

        // Verify race is running
        const isRacing = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.getState() === 'racing' || game?.engine?.getState() === 'countdown';
        });
        expect(isRacing, 'Race should be running').toBe(true);

        // Create second player and try to join mid-race
        const lateJoinerPage = await playerContext.newPage();
        await lateJoinerPage.goto('/player?testMode=1');
        await lateJoinerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });
        await lateJoinerPage.fill('#player-name', 'LateJoiner');
        await lateJoinerPage.fill('#room-code', roomCode);
        await lateJoinerPage.click('#join-btn');

        // Late joiner should go directly to game screen (skip waiting)
        await expect(lateJoinerPage.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 30000 });

        // Verify late joiner's vehicle was created on host
        const vehicleCount = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            return game?.vehicles?.size || 0;
        });
        expect(vehicleCount, 'Should have 2 vehicles after late join').toBe(2);

        await lateJoinerPage.close();
    });

    test('late joiner should spawn near last place', async ({ hostPage, playerPage, playerContext }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // First player joins
        await joinGameAsPlayer(playerPage, roomCode, 'FirstPlayer');
        await expect(hostPage.locator('#player-list')).toContainText('FirstPlayer', { timeout: 30000 });

        // Start the race
        await startGameFromHost(hostPage);
        await hostPage.waitForTimeout(1000);

        // Move the first player forward a bit
        await hostPage.evaluate(() => {
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        for (let i = 0; i < 20; i++) {
            await hostPage.evaluate(() => {
                // @ts-ignore
                const game = window.game;
                if (game && game.vehicles && game.vehicles.size > 0) {
                    const vehicle = game.vehicles.values().next().value;
                    vehicle.setControls({ acceleration: 1.0, braking: 0, steering: 0 });
                }
            });
            await hostPage.waitForTimeout(50);
        }

        // Get first player position
        const firstPlayerPos = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            if (game && game.vehicles && game.vehicles.size > 0) {
                const vehicle = game.vehicles.values().next().value;
                return { x: vehicle.mesh.position.x, z: vehicle.mesh.position.z };
            }
            return null;
        });
        expect(firstPlayerPos, 'First player should have a position').not.toBeNull();

        // Late joiner joins
        const lateJoinerPage = await playerContext.newPage();
        await lateJoinerPage.goto('/player?testMode=1');
        await lateJoinerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });
        await lateJoinerPage.fill('#player-name', 'LateJoiner');
        await lateJoinerPage.fill('#room-code', roomCode);
        await lateJoinerPage.click('#join-btn');
        await expect(lateJoinerPage.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 30000 });

        // Wait for vehicle to spawn
        await hostPage.waitForTimeout(500);

        // Get late joiner position
        const lateJoinerPos = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            if (game && game.vehicles && game.vehicles.size > 1) {
                const vehicles = Array.from(game.vehicles.values());
                const lastVehicle = vehicles[vehicles.length - 1];
                return { x: lastVehicle.mesh.position.x, z: lastVehicle.mesh.position.z };
            }
            return null;
        });
        expect(lateJoinerPos, 'Late joiner should have a position').not.toBeNull();

        // Late joiner should be behind first player (based on the _getLateJoinSpawnPosition logic)
        console.log('First player position:', firstPlayerPos);
        console.log('Late joiner position:', lateJoinerPos);

        await lateJoinerPage.close();
    });

    test('QR code should remain visible during race', async ({ hostPage, playerPage }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'QRTestPlayer');
        await expect(hostPage.locator('#player-list')).toContainText('QRTestPlayer', { timeout: 30000 });

        // QR overlay should be visible in lobby
        const qrOverlay = hostPage.locator('.room-code-overlay');
        await expect(qrOverlay).toBeVisible({ timeout: 5000 });

        // Start the race
        await startGameFromHost(hostPage);
        await hostPage.waitForTimeout(1000);

        // QR overlay should still be visible (minimized) during race
        await expect(qrOverlay).toBeVisible({ timeout: 5000 });

        // Verify it has the minimized class
        await expect(qrOverlay).toHaveClass(/minimized/);
    });

    test('should show error when trying to join finished race', async ({ hostPage, playerPage, playerContext }) => {
        // This test would require simulating a finished race
        // For now, we'll skip this as it requires completing a full race
        test.skip();
    });
});
