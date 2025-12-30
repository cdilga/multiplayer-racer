import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost } from './fixtures';

test.describe('Car Reset Functionality', () => {
    test('car should reset to original spawn position after moving', async ({ hostPage, playerPage }) => {
        // Setup game
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'ResetTest');
        await expect(hostPage.locator('#player-list')).toContainText('ResetTest', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Let car settle after spawn drop
        await hostPage.waitForTimeout(2000);

        // Get spawn position (should be stored on the car)
        const spawnPosition = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            if (!gameState || !gameState.cars) return null;

            const carIds = Object.keys(gameState.cars);
            if (carIds.length === 0) return null;

            const car = gameState.cars[carIds[0]];
            if (!car) return null;

            // Return the stored spawn position
            return car.spawnPosition || null;
        });

        expect(spawnPosition, 'Spawn position should be stored on car').not.toBeNull();
        console.log('Spawn position:', spawnPosition);

        // Enable test control override
        await hostPage.evaluate(() => {
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Move the car forward for a few seconds
        for (let i = 0; i < 30; i++) {
            await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0) {
                    const car = gameState.cars[carIds[0]];
                    car.controls = {
                        acceleration: 1.0,
                        braking: 0,
                        steering: 0
                    };
                    car.lastControlUpdate = Date.now();
                }
            });
            await hostPage.waitForTimeout(100);
        }

        // Wait for physics to settle
        await hostPage.waitForTimeout(500);

        // Get position after moving
        const movedPosition = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                if (car && car.mesh) {
                    return {
                        x: car.mesh.position.x,
                        y: car.mesh.position.y,
                        z: car.mesh.position.z
                    };
                }
            }
            return null;
        });

        expect(movedPosition, 'Car should have a valid position after moving').not.toBeNull();
        console.log('Position after moving:', movedPosition);

        // Calculate distance from spawn
        const distanceFromSpawn = Math.sqrt(
            Math.pow(movedPosition!.x - spawnPosition!.x, 2) +
            Math.pow(movedPosition!.z - spawnPosition!.z, 2)
        );
        console.log('Distance from spawn:', distanceFromSpawn);
        expect(distanceFromSpawn, 'Car should have moved away from spawn').toBeGreaterThan(1);

        // Stop acceleration before reset
        await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                car.controls = {
                    acceleration: 0,
                    braking: 0,
                    steering: 0
                };
            }
        });

        // Click the reset button for this car
        await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                // Call resetCarPosition directly
                // @ts-ignore
                if (typeof window.resetCarPosition === 'function') {
                    // @ts-ignore
                    window.resetCarPosition(carIds[0]);
                }
            }
        });

        // Wait for reset and physics to complete
        await hostPage.waitForTimeout(1000);

        // Get position after reset
        const resetPosition = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                if (car && car.mesh) {
                    return {
                        x: car.mesh.position.x,
                        y: car.mesh.position.y,
                        z: car.mesh.position.z
                    };
                }
            }
            return null;
        });

        expect(resetPosition, 'Car should have a valid position after reset').not.toBeNull();
        console.log('Position after reset:', resetPosition);

        // Calculate distance from spawn after reset
        const distanceFromSpawnAfterReset = Math.sqrt(
            Math.pow(resetPosition!.x - spawnPosition!.x, 2) +
            Math.pow(resetPosition!.z - spawnPosition!.z, 2)
        );
        console.log('Distance from spawn after reset:', distanceFromSpawnAfterReset);

        // Car should be back at spawn position (within small tolerance for physics settling)
        expect(distanceFromSpawnAfterReset, 'Car should be back at spawn position after reset').toBeLessThan(0.5);
    });

    test('reset all cars should reset all cars to their spawn positions', async ({ hostPage, playerPage }) => {
        // Setup game
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'ResetAllTest');
        await expect(hostPage.locator('#player-list')).toContainText('ResetAllTest', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Let car settle
        await hostPage.waitForTimeout(2000);

        // Get spawn position
        const spawnPosition = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                return car.spawnPosition || null;
            }
            return null;
        });

        expect(spawnPosition, 'Spawn position should be stored').not.toBeNull();

        // Enable test control override and move the car
        await hostPage.evaluate(() => {
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Move car
        for (let i = 0; i < 30; i++) {
            await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0) {
                    const car = gameState.cars[carIds[0]];
                    car.controls = {
                        acceleration: 1.0,
                        braking: 0,
                        steering: 0.5 // Also turn to make it more interesting
                    };
                    car.lastControlUpdate = Date.now();
                }
            });
            await hostPage.waitForTimeout(100);
        }

        await hostPage.waitForTimeout(500);

        // Call resetAllCars
        await hostPage.evaluate(() => {
            // @ts-ignore
            if (typeof window.resetAllCars === 'function') {
                // @ts-ignore
                window.resetAllCars();
            }
        });

        await hostPage.waitForTimeout(500);

        // Verify car is back at spawn
        const resetPosition = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                if (car && car.mesh) {
                    return {
                        x: car.mesh.position.x,
                        y: car.mesh.position.y,
                        z: car.mesh.position.z
                    };
                }
            }
            return null;
        });

        const distanceFromSpawn = Math.sqrt(
            Math.pow(resetPosition!.x - spawnPosition!.x, 2) +
            Math.pow(resetPosition!.z - spawnPosition!.z, 2)
        );

        expect(distanceFromSpawn, 'Car should be back at spawn after resetAllCars').toBeLessThan(0.5);
    });
});
