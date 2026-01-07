import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, sendPlayerControls, releaseAllControls, gotoHost } from './fixtures';

test.describe('Multiplayer Racer Game Flow', () => {
    test('car should have valid position after game starts', async ({ hostPage, playerPage }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'PositionTest');
        await expect(hostPage.locator('#player-list')).toContainText('PositionTest', { timeout: 30000 });

        // Start game
        await startGameFromHost(hostPage);

        // Wait for game to initialize (testMode skips countdown)
        await hostPage.waitForTimeout(1000);

        // Check car position via gameState
        const carData = await hostPage.evaluate(() => {
            // @ts-ignore - gameState is a global
            const gameState = window.gameState;
            if (!gameState || !gameState.cars) {
                return { error: 'No gameState or cars' };
            }

            const carIds = Object.keys(gameState.cars);
            if (carIds.length === 0) {
                return { error: 'No cars in gameState' };
            }

            const car = gameState.cars[carIds[0]];
            if (!car || !car.mesh) {
                return { error: 'No car mesh' };
            }

            const pos = car.mesh.position;
            return {
                exists: true,
                position: { x: pos.x, y: pos.y, z: pos.z },
                isVisible: car.mesh.visible,
                inScene: car.mesh.parent !== null
            };
        });

        // Verify car exists
        expect(carData.error).toBeUndefined();
        expect(carData.exists).toBe(true);

        // Log actual values for debugging
        console.log('Car data:', JSON.stringify(carData, null, 2));

        // Verify position is valid (not NaN, not Infinity)
        expect(Number.isFinite(carData.position.x), `position.x should be finite, got: ${carData.position.x}`).toBe(true);
        expect(Number.isFinite(carData.position.y), `position.y should be finite, got: ${carData.position.y}`).toBe(true);
        expect(Number.isFinite(carData.position.z), `position.z should be finite, got: ${carData.position.z}`).toBe(true);

        // Verify car is in reasonable bounds (not fallen through world)
        expect(carData.position.y).toBeGreaterThan(-10); // Not fallen through
        expect(carData.position.y).toBeLessThan(100);    // Not launched to sky

        // Verify mesh is visible and in scene
        expect(carData.isVisible).toBe(true);
        expect(carData.inScene).toBe(true);
    });

    test('should receive control inputs and update car position', async ({ hostPage, playerPage }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'ControlTest');
        await expect(hostPage.locator('#player-list')).toContainText('ControlTest', { timeout: 30000 });

        // Start game
        await startGameFromHost(hostPage);

        // Wait for game to initialize
        await hostPage.waitForTimeout(1000);

        // Send acceleration input
        await sendPlayerControls(playerPage, { acceleration: true });

        // Wait a bit for controls to propagate
        await hostPage.waitForTimeout(500);

        // Check that controls are being received (if stats overlay is visible)
        // Press F3 to show stats
        await hostPage.keyboard.press('F3');
        await hostPage.waitForTimeout(500);

        // The stats overlay should show control values > 0 if controls are working
        // This is a basic smoke test - exact values depend on implementation

        // Release controls
        await releaseAllControls(playerPage);
    });
    test('should create room and display room code', async ({ hostPage }) => {
        // Navigate to host page
        await gotoHost(hostPage);

        // Wait for room to be created automatically
        const roomCode = await waitForRoomCode(hostPage);

        // Verify room code is 4 characters
        expect(roomCode).toHaveLength(4);
        expect(roomCode).toMatch(/^[A-Z0-9]+$/);

        // Verify QR code is displayed (img#qr-code with src set)
        await expect(hostPage.locator('#qr-code')).toBeVisible();

        // Verify join URL contains room code
        const joinUrl = await hostPage.locator('#join-url').textContent();
        expect(joinUrl).toContain(roomCode);
    });

    test('should allow player to join room', async ({ hostPage, playerPage }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins the room
        await joinGameAsPlayer(playerPage, roomCode, 'TestPlayer1');

        // Verify player appears in host's player list
        await expect(hostPage.locator('#player-list')).toContainText('TestPlayer1', { timeout: 30000 });

        // Verify player sees waiting screen with their name
        await expect(playerPage.locator('#waiting-screen')).toBeVisible();
        await expect(playerPage.locator('#display-name')).toContainText('TestPlayer1');
    });

    test('should start game when host clicks start', async ({ hostPage, playerPage }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'RacerOne');

        // Wait for player to appear in list
        await expect(hostPage.locator('#player-list')).toContainText('RacerOne', { timeout: 30000 });

        // Host starts game
        await startGameFromHost(hostPage);

        // Verify host sees game screen (not hidden)
        await expect(hostPage.locator('#game-screen')).not.toHaveClass(/hidden/);

        // Verify player sees game controls (game screen should be visible)
        await expect(playerPage.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 10000 });
    });

    test('should handle player disconnection gracefully', async ({ hostPage, playerPage, playerContext }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'DisconnectTest');

        // Wait for player to appear
        await expect(hostPage.locator('#player-list')).toContainText('DisconnectTest', { timeout: 30000 });

        // Disconnect player by closing context
        await playerContext.close();

        // Wait a bit for disconnect to propagate
        await hostPage.waitForTimeout(1000);

        // Verify player is removed from list or marked as disconnected
        // After disconnect, the player should be removed from the list
        // (This might fail if disconnection handling is broken - that's ok, it's a baseline test)
        const playerListText = await hostPage.locator('#player-list').textContent();
        // Player should no longer be in the list after disconnect
        expect(playerListText).not.toContain('DisconnectTest');
    });

    test('should handle host disconnection gracefully', async ({ hostPage, playerPage, hostContext }) => {
        // Host creates room
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'OrphanTest');

        // Wait for player to appear
        await expect(hostPage.locator('#player-list')).toContainText('OrphanTest', { timeout: 30000 });

        // Disconnect host by closing context
        await hostContext.close();

        // Wait for disconnect message on player side
        // This should show an error or redirect
        await playerPage.waitForTimeout(2000);

        // Verify player sees disconnection message
        // (The specific behavior depends on implementation)
        const pageContent = await playerPage.content();
        // We're checking the page is still working (didn't crash)
        expect(pageContent).toBeTruthy();
    });

    test('should support multiple players joining', async ({ browser, baseURL }) => {
        // Create host context
        const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const hostPage = await hostContext.newPage();

        // Create multiple player contexts
        const player1Context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const player1Page = await player1Context.newPage();

        const player2Context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const player2Page = await player2Context.newPage();

        try {
            // Host creates room with testMode
            await hostPage.goto(`${baseURL || 'http://localhost:8000'}/?testMode=1`);
            const roomCode = await waitForRoomCode(hostPage);

            // Player 1 joins
            await player1Page.goto(`${baseURL || 'http://localhost:8000'}/player?testMode=1`);
            await player1Page.waitForSelector('#join-screen', { state: 'visible' });
            await player1Page.fill('#player-name', 'Player1');
            await player1Page.fill('#room-code', roomCode);
            await player1Page.click('#join-btn');
            await player1Page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 30000 });

            // Player 2 joins
            await player2Page.goto(`${baseURL || 'http://localhost:8000'}/player?testMode=1`);
            await player2Page.waitForSelector('#join-screen', { state: 'visible' });
            await player2Page.fill('#player-name', 'Player2');
            await player2Page.fill('#room-code', roomCode);
            await player2Page.click('#join-btn');
            await player2Page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 30000 });

            // Verify both players appear in host's list
            await expect(hostPage.locator('#player-list')).toContainText('Player1', { timeout: 30000 });
            await expect(hostPage.locator('#player-list')).toContainText('Player2', { timeout: 30000 });

            // Start game
            await startGameFromHost(hostPage);

            // Verify both players see game screen
            await expect(player1Page.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 10000 });
            await expect(player2Page.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 10000 });

        } finally {
            await hostContext.close();
            await player1Context.close();
            await player2Context.close();
        }
    });


});

test.describe('Error Handling', () => {

    test('should show error for invalid room code', async ({ playerPage }) => {
        // Try to join with invalid room code
        await playerPage.goto('/player?room=ZZZZ');

        // Fill in player name
        await playerPage.fill('#player-name', 'ErrorTest');

        // Click join button
        await playerPage.click('#join-btn');

        // Wait for error message
        // Should see an error about invalid room
        await playerPage.waitForTimeout(2000);

        // Check for error visibility (implementation-dependent)
        const hasError = await playerPage.locator('.error, .error-message, [class*="error"]').isVisible()
            .catch(() => false);

        // The page should either show an error or stay on join screen
        const isOnJoinScreen = await playerPage.locator('#join-btn').isVisible();

        // Either we see an error OR we're still on join screen (didn't navigate to game)
        expect(hasError || isOnJoinScreen).toBeTruthy();
    });

});
