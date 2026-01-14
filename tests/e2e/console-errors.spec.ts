import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, gotoHost } from './fixtures';

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
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'ErrorTest');
        await expect(hostPage.locator('#player-list')).toContainText('ErrorTest', { timeout: 30000 });

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
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'PhysicsTest');
        await expect(hostPage.locator('#player-list')).toContainText('PhysicsTest', { timeout: 30000 });

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

    test('should not have per-tick logging (performance killer)', async ({ hostPage, playerPage }) => {
        // Track all console.log and console.info calls
        const logs: { text: string; timestamp: number }[] = [];

        hostPage.on('console', (msg) => {
            const type = msg.type();
            if (type === 'log' || type === 'info') {
                logs.push({ text: msg.text(), timestamp: Date.now() });
            }
        });

        // Setup and start game
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'LogTest');
        await expect(hostPage.locator('#player-list')).toContainText('LogTest', { timeout: 30000 });
        await startGameFromHost(hostPage);

        // Clear logs from init phase - we only care about runtime logs
        logs.length = 0;

        // Let game run for a measured period
        const testDurationMs = 3000;
        const expectedMinTicks = Math.floor(testDurationMs / 16.67); // ~60fps = 180 ticks

        await hostPage.waitForTimeout(testDurationMs);

        // Get actual tick count from game (or estimate from time)
        const tickCount = await hostPage.evaluate((fallback) => {
            // @ts-ignore
            const engine = window.game?.engine;
            return engine?.tickCount || engine?.frameCount || fallback;
        }, expectedMinTicks) || expectedMinTicks;

        // Calculate log rate
        const logCount = logs.length;
        const logRate = logCount / (testDurationMs / 1000); // logs per second
        const tickRate = tickCount / (testDurationMs / 1000); // ticks per second

        // FAIL if logs are happening at tick-rate frequency
        // Allow some margin: if logs are >50% of tick rate, that's per-tick logging
        const perTickThreshold = tickRate * 0.5;

        if (logRate > perTickThreshold) {
            // Group logs by message to show what's spamming
            const logCounts: Record<string, number> = {};
            logs.forEach(log => {
                // Normalize log text (remove numbers that change each tick)
                const normalized = log.text.replace(/\d+(\.\d+)?/g, 'N');
                logCounts[normalized] = (logCounts[normalized] || 0) + 1;
            });

            const topSpammers = Object.entries(logCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([msg, count]) => `  ${count}x: ${msg.slice(0, 80)}`)
                .join('\n');

            throw new Error(
                `Per-tick logging detected! This destroys performance.\n` +
                `Log rate: ${logRate.toFixed(1)}/sec (threshold: ${perTickThreshold.toFixed(1)}/sec)\n` +
                `Total logs: ${logCount} in ${testDurationMs}ms\n` +
                `Top offenders:\n${topSpammers}\n\n` +
                `Fix: Remove console.log from update/render/step methods.`
            );
        }

        // Also fail if ANY single log message repeats at near-tick rate
        const logCounts: Record<string, number> = {};
        logs.forEach(log => {
            const normalized = log.text.replace(/\d+(\.\d+)?/g, 'N');
            logCounts[normalized] = (logCounts[normalized] || 0) + 1;
        });

        for (const [msg, count] of Object.entries(logCounts)) {
            const msgRate = count / (testDurationMs / 1000);
            if (msgRate > 10) { // More than 10/sec is suspicious
                throw new Error(
                    `Repeated logging detected: "${msg.slice(0, 60)}..."\n` +
                    `Rate: ${msgRate.toFixed(1)}/sec (${count} times in ${testDurationMs}ms)\n` +
                    `This indicates per-tick logging. Remove the log statement.`
                );
            }
        }
    });
});
