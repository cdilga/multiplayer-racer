import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost } from './fixtures';

test.describe('Console Error Monitoring', () => {
    test('game should run without console errors after starting', async ({ hostPage, playerPage }) => {
        // Collect console errors
        const consoleErrors: string[] = [];
        const consoleWarnings: string[] = [];

        hostPage.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            } else if (msg.type() === 'warning') {
                consoleWarnings.push(msg.text());
            }
        });

        // Also capture page errors (uncaught exceptions)
        const pageErrors: string[] = [];
        hostPage.on('pageerror', (error) => {
            pageErrors.push(error.message);
        });

        // Setup game
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'ErrorTest');
        await expect(hostPage.locator('#player-list')).toContainText('ErrorTest', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Let the game run for a few seconds to capture any physics errors
        await hostPage.waitForTimeout(3000);

        // Toggle some debug panels to exercise more code paths
        await hostPage.keyboard.press('F3'); // Toggle stats
        await hostPage.waitForTimeout(500);
        await hostPage.keyboard.press('F4'); // Toggle physics debug
        await hostPage.waitForTimeout(500);

        // Let game run a bit more
        await hostPage.waitForTimeout(2000);

        // Filter out known acceptable warnings
        const criticalErrors = consoleErrors.filter(err => {
            // Filter out errors that are acceptable or expected
            return !err.includes('favicon.ico');
        });

        // Filter out known acceptable warnings
        // Note: The Rapier deprecation warning was fixed by avoiding double init() calls
        // (see rapierPhysics.js and host.js changes). But we keep the filter as a safeguard
        // in case of CDN changes or race conditions.
        const criticalWarnings = consoleWarnings.filter(warn => {
            return !warn.includes('deprecated parameters');
        });

        // Log all errors for debugging test failures
        if (criticalErrors.length > 0) {
            console.log('Console errors found:', criticalErrors);
        }
        if (criticalWarnings.length > 0) {
            console.log('Console warnings found:', criticalWarnings);
        }
        if (pageErrors.length > 0) {
            console.log('Page errors found:', pageErrors);
        }

        // Assert no critical errors
        expect(criticalErrors, `Found ${criticalErrors.length} console errors: ${criticalErrors.slice(0, 5).join(', ')}`).toHaveLength(0);
        expect(pageErrors, `Found ${pageErrors.length} page errors: ${pageErrors.slice(0, 5).join(', ')}`).toHaveLength(0);
    });

    test('physics should maintain valid car positions throughout gameplay', async ({ hostPage, playerPage }) => {
        // Setup game
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'PhysicsTest');
        await expect(hostPage.locator('#player-list')).toContainText('PhysicsTest', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Sample car positions over time
        const positionSamples: { x: number; y: number; z: number; timestamp: number }[] = [];

        for (let i = 0; i < 10; i++) {
            await hostPage.waitForTimeout(500);

            const carData = await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                if (!gameState || !gameState.cars) return null;

                const carIds = Object.keys(gameState.cars);
                if (carIds.length === 0) return null;

                const car = gameState.cars[carIds[0]];
                if (!car || !car.mesh) return null;

                return {
                    x: car.mesh.position.x,
                    y: car.mesh.position.y,
                    z: car.mesh.position.z,
                    timestamp: Date.now()
                };
            });

            if (carData) {
                positionSamples.push(carData);

                // Verify position is valid at each sample
                expect(Number.isFinite(carData.x), `Position x should be finite at sample ${i}`).toBe(true);
                expect(Number.isFinite(carData.y), `Position y should be finite at sample ${i}`).toBe(true);
                expect(Number.isFinite(carData.z), `Position z should be finite at sample ${i}`).toBe(true);

                // Verify position is in reasonable bounds
                expect(carData.y).toBeGreaterThan(-50);
                expect(carData.y).toBeLessThan(100);
            }
        }

        // Should have at least some valid samples
        expect(positionSamples.length).toBeGreaterThan(5);
    });
});
