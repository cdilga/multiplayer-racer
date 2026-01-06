import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost } from './fixtures';

test.describe('Car Reset Functionality', () => {
    test('car should reset to original spawn position after moving', async ({ hostPage, playerPage }) => {
        // Capture browser console logs
        const consoleLogs: string[] = [];
        hostPage.on('console', (msg) => {
            const text = msg.text();
            if (text.includes('🔧') || text.includes('Reset') || msg.type() === 'error') {
                consoleLogs.push(`[${msg.type()}] ${text}`);
                console.log(`HOST CONSOLE [${msg.type()}]:`, text);
            }
        });

        // Also capture page errors
        hostPage.on('pageerror', (error) => {
            console.log('PAGE ERROR:', error);
        });

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

        // Move the car forward (reduced iterations)
        for (let i = 0; i < 15; i++) {
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
            await hostPage.waitForTimeout(50); // Reduced from 100ms
        }

        // Wait for physics to settle (reduced from 500ms)
        await hostPage.waitForTimeout(200);

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

        // Call reset directly through game object instead of window.resetCarPosition
        const resetResult = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);

            console.log('🔧 In evaluate: carIds:', carIds);
            console.log('🔧 In evaluate: game exists:', !!game);
            console.log('🔧 In evaluate: game.resetVehicleToSpawn:', typeof game?.resetVehicleToSpawn);

            if (carIds.length > 0 && game) {
                const carId = carIds[0];
                console.log('🔧 Calling game.resetVehicleToSpawn with carId:', carId);
                try {
                    game.resetVehicleToSpawn(carId);
                    console.log('🔧 game.resetVehicleToSpawn completed');
                } catch (e) {
                    console.log('🔧 ERROR:', e);
                }

                // Check vehicle state after reset
                const car = gameState.cars[carId];
                const currentPos = car.mesh?.position || null;
                return {
                    carId: carId,
                    currentPos: currentPos,
                    hasPhysicsBody: !!car.physicsBody,
                    spawnPosition: car.spawnPosition
                };
            }
            return null;
        });

        console.log('Reset result:', resetResult);

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

    // Parameterized test for both reset buttons
    const resetButtonTests = [
        {
            name: 'Reset All Cars button',
            buttonSelector: '#reset-all-cars-btn',
            screenshotPrefix: 'reset-all-cars',
            playerName: 'AllCarsBtn'
        }
        // Note: Individual car reset buttons (.car-reset-btn) are a v1 feature
        // not yet implemented in v2. Skip that test for now.
    ];

    for (const { name, buttonSelector, screenshotPrefix, playerName } of resetButtonTests) {
        test(`${name} should reset car to spawn position`, async ({ hostPage, playerPage }) => {
            // Setup game
            await hostPage.goto('/');
            const roomCode = await waitForRoomCode(hostPage);
            await joinGameAsPlayer(playerPage, roomCode, playerName);
            await expect(hostPage.locator('#player-list')).toContainText(playerName, { timeout: 10000 });

            // Start game
            await startGameFromHost(hostPage);

            // Let car settle
            await hostPage.waitForTimeout(2000);

            // Enable test control override
            await hostPage.evaluate(() => {
                // @ts-ignore
                window.gameState._testControlsOverride = true;
            });

            // Get spawn position
            const spawnPosition = await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0) {
                    return gameState.cars[carIds[0]].spawnPosition;
                }
                return null;
            });
            expect(spawnPosition, 'Spawn position should exist').not.toBeNull();
            console.log('Spawn position:', spawnPosition);

            // Move the car away from spawn
            for (let i = 0; i < 30; i++) {
                await hostPage.evaluate(() => {
                    // @ts-ignore
                    const gameState = window.gameState;
                    const carIds = Object.keys(gameState.cars);
                    if (carIds.length > 0) {
                        gameState.cars[carIds[0]].controls = {
                            acceleration: 1.0,
                            braking: 0,
                            steering: 0
                        };
                        gameState.cars[carIds[0]].lastControlUpdate = Date.now();
                    }
                });
                await hostPage.waitForTimeout(100);
            }

            // Stop controls
            await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0) {
                    gameState.cars[carIds[0]].controls = { acceleration: 0, braking: 0, steering: 0 };
                }
            });

            // Get position after moving
            const movedPosition = await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0 && gameState.cars[carIds[0]].mesh) {
                    const pos = gameState.cars[carIds[0]].mesh.position;
                    return { x: pos.x, y: pos.y, z: pos.z };
                }
                return null;
            });
            console.log('Position after moving:', movedPosition);

            const distanceMoved = Math.sqrt(
                Math.pow(movedPosition!.x - spawnPosition!.x, 2) +
                Math.pow(movedPosition!.z - spawnPosition!.z, 2)
            );
            console.log('Distance moved:', distanceMoved);
            // Car should have moved at least 1 meter (matching other tests)
            expect(distanceMoved, 'Car should have moved').toBeGreaterThan(1);

            // Press F3 to open stats overlay (where the reset buttons are)
            await hostPage.keyboard.press('F3');
            await hostPage.waitForTimeout(500);

            // Take screenshot before clicking reset
            await hostPage.screenshot({ path: `test-results/${screenshotPrefix}-before.png` });

            // Click the reset button
            const resetButton = hostPage.locator(buttonSelector).first();
            await expect(resetButton, `${name} should be visible`).toBeVisible({ timeout: 5000 });
            await resetButton.click();

            // Wait for reset
            await hostPage.waitForTimeout(1000);

            // Take screenshot after reset
            await hostPage.screenshot({ path: `test-results/${screenshotPrefix}-after.png` });

            // Get position after clicking button
            const resetPosition = await hostPage.evaluate(() => {
                // @ts-ignore
                const gameState = window.gameState;
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0 && gameState.cars[carIds[0]].mesh) {
                    const pos = gameState.cars[carIds[0]].mesh.position;
                    return { x: pos.x, y: pos.y, z: pos.z };
                }
                return null;
            });
            console.log('Position after button reset:', resetPosition);

            const distanceFromSpawn = Math.sqrt(
                Math.pow(resetPosition!.x - spawnPosition!.x, 2) +
                Math.pow(resetPosition!.z - spawnPosition!.z, 2)
            );
            console.log(`Distance from spawn after ${name}:`, distanceFromSpawn);
            expect(distanceFromSpawn, `Car should be back at spawn after clicking ${name}`).toBeLessThan(1);
        });
    }

    test('upside-down car should reset to correct orientation', async ({ hostPage, playerPage }) => {
        // Setup game
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'FlipTest');
        await expect(hostPage.locator('#player-list')).toContainText('FlipTest', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Let car settle after spawn drop
        await hostPage.waitForTimeout(2000);

        // Enable test control override
        await hostPage.evaluate(() => {
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Move the car forward a bit first
        console.log('Moving car forward...');
        for (let i = 0; i < 20; i++) {
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

        // Stop controls
        await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                car.controls = { acceleration: 0, braking: 0, steering: 0 };
            }
        });

        // Directly flip the car upside down by setting its rotation
        // This is more reliable than trying to flip via physics simulation
        console.log('Flipping car upside down programmatically...');
        await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                if (car && car.physicsBody) {
                    // Rotate 180 degrees around Z axis to flip upside down
                    // Quaternion for 180 deg rotation around Z: (0, 0, 1, 0)
                    car.physicsBody.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
                    // Zero out velocities
                    car.physicsBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    car.physicsBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                }
            }
        });

        // Let physics settle
        await hostPage.waitForTimeout(500);

        // Take screenshot of flipped state
        await hostPage.screenshot({ path: 'test-results/car-flipped-state.png', fullPage: true });

        // Check if car is upside down using the rapierPhysics function
        const isUpsideDown = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                if (car && car.physicsBody && typeof rapierPhysics.isCarUpsideDown === 'function') {
                    return rapierPhysics.isCarUpsideDown(car.physicsBody);
                }
            }
            return false;
        });

        console.log('Is car upside down:', isUpsideDown);
        expect(isUpsideDown, 'Car should be upside down after flipping').toBe(true);

        // Stop controls before reset
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

        // Call reset
        await hostPage.evaluate(() => {
            // @ts-ignore
            const carIds = Object.keys(window.gameState.cars);
            if (carIds.length > 0 && typeof window.resetCarPosition === 'function') {
                // @ts-ignore
                window.resetCarPosition(carIds[0]);
            }
        });

        // Wait for reset to complete
        await hostPage.waitForTimeout(1000);

        // Take screenshot after reset
        await hostPage.screenshot({ path: 'test-results/car-reset-state.png', fullPage: true });

        // Check car is no longer upside down
        const isStillUpsideDown = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                const car = gameState.cars[carIds[0]];
                if (car && car.physicsBody && typeof rapierPhysics.isCarUpsideDown === 'function') {
                    return rapierPhysics.isCarUpsideDown(car.physicsBody);
                }
            }
            return false;
        });

        console.log('Is car still upside down after reset:', isStillUpsideDown);
        expect(isStillUpsideDown, 'Car should NOT be upside down after reset').toBe(false);

        // Also verify position is back at spawn
        const spawnPosition = await hostPage.evaluate(() => {
            // @ts-ignore
            const gameState = window.gameState;
            const carIds = Object.keys(gameState.cars);
            if (carIds.length > 0) {
                return gameState.cars[carIds[0]].spawnPosition;
            }
            return null;
        });

        const currentPosition = await hostPage.evaluate(() => {
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

        if (spawnPosition && currentPosition) {
            const distanceFromSpawn = Math.sqrt(
                Math.pow(currentPosition.x - spawnPosition.x, 2) +
                Math.pow(currentPosition.z - spawnPosition.z, 2)
            );
            console.log('Distance from spawn after reset:', distanceFromSpawn);
            expect(distanceFromSpawn, 'Car should be back at spawn position').toBeLessThan(1);
        }
    });
});
