import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost } from './fixtures';

test.describe('Race Completion', () => {

    test('should complete race after driving through all checkpoints for required laps', async ({ hostPage, playerPage }) => {
        // Host creates room
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'RaceCompleter');
        await expect(hostPage.locator('#player-list')).toContainText('RaceCompleter', { timeout: 10000 });

        // Start game with just 1 lap to make test faster
        await startGameFromHost(hostPage);

        // Wait for countdown to finish and race to start
        await hostPage.waitForTimeout(4000);

        // Set the race to 1 lap AFTER the game starts (so it applies to this race)
        await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            if (game && game.systems && game.systems.race) {
                game.systems.race.totalLaps = 1;
            }
        });

        // Enable test controls override so network doesn't interfere
        await hostPage.evaluate(() => {
            // @ts-ignore
            if (!window.gameState) window.gameState = {};
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Get the vehicle and simulate completing a lap by teleporting through checkpoints
        // Checkpoints are at: (0,-45), (45,0), (0,45), (-45,0)
        const raceCompleted = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            if (!game || !game.vehicles || game.vehicles.size === 0) {
                return { error: 'No game or vehicles' };
            }

            const vehicle = game.vehicles.values().next().value;
            if (!vehicle) {
                return { error: 'No vehicle found' };
            }

            // Helper to wait
            const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            // Get race system
            const raceSystem = game.systems.race;
            if (!raceSystem) {
                return { error: 'No race system' };
            }

            // Get initial state
            const initialLap = vehicle.currentLap;
            const initialState = raceSystem.getState();

            // Simulate driving through each checkpoint
            // Track has 4 checkpoints: 0 (finish at z=-45), 1 (x=45), 2 (z=45), 3 (x=-45)
            const checkpoints = [
                { x: 45, z: 0 },    // Checkpoint 1
                { x: 0, z: 45 },    // Checkpoint 2
                { x: -45, z: 0 },   // Checkpoint 3
                { x: 0, z: -45 },   // Checkpoint 0 (finish line) - crossing completes lap
            ];

            // Teleport vehicle to each checkpoint to simulate driving
            for (const cp of checkpoints) {
                // Update vehicle position
                vehicle.position = { x: cp.x, y: 1.5, z: cp.z };

                // Also update the mesh position to match
                if (vehicle.mesh) {
                    vehicle.mesh.position.set(cp.x, 1.5, cp.z);
                }

                // Use the PhysicsSystem's resetVehicle method to properly move the physics body
                if (game.systems.physics) {
                    game.systems.physics.resetVehicle(vehicle.id, { x: cp.x, y: 1.5, z: cp.z }, 0);
                }

                // Trigger race system update to detect checkpoint
                raceSystem.update(0.016);
                await wait(100);
            }

            // Wait for race system to process
            await wait(500);

            // Get final state
            const finalLap = vehicle.currentLap;
            const finalState = raceSystem.getState();
            const isFinished = vehicle.finished;

            return {
                success: true,
                initialLap,
                finalLap,
                initialState,
                finalState,
                isFinished,
                vehicleId: vehicle.id
            };
        });

        console.log('Race completion result:', JSON.stringify(raceCompleted, null, 2));

        // Check if race completed
        if (raceCompleted.error) {
            console.error('Error:', raceCompleted.error);
        }

        // The vehicle should have completed at least 1 lap
        expect(raceCompleted.finalLap).toBeGreaterThanOrEqual(1);

        // The vehicle should be marked as finished (since we set 1 lap)
        expect(raceCompleted.isFinished).toBe(true);

        // Race state should be 'finished'
        expect(raceCompleted.finalState).toBe('finished');
    });

    test('should show results UI after race completes', async ({ hostPage, playerPage }) => {
        // Host creates room
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'ResultsTester');
        await expect(hostPage.locator('#player-list')).toContainText('ResultsTester', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Wait for countdown
        await hostPage.waitForTimeout(4000);

        // Simulate race completion by directly calling the race finish event
        await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            if (!game) return;

            // Emit race finished event with mock results
            game.eventBus.emit('race:finished', {
                results: [
                    {
                        position: 1,
                        vehicleId: 'test-vehicle',
                        playerId: 'ResultsTester',
                        finishTime: 45000,
                        lapTimes: [15000, 15000, 15000],
                        bestLapTime: 14500
                    }
                ],
                totalTime: 45000
            });
        });

        // Wait for results UI to appear
        await hostPage.waitForTimeout(500);

        // Check that results UI is visible
        const resultsVisible = await hostPage.locator('.results-ui').isVisible();
        expect(resultsVisible).toBe(true);

        // Check that the results UI is not hidden
        await expect(hostPage.locator('.results-ui')).not.toHaveClass(/hidden/);

        // Check for expected content
        await expect(hostPage.locator('.results-title')).toContainText('Race Complete');
    });

    test('should return to lobby when clicking Back to Lobby button', async ({ hostPage, playerPage }) => {
        // Host creates room
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);

        // Player joins
        await joinGameAsPlayer(playerPage, roomCode, 'LobbyReturner');
        await expect(hostPage.locator('#player-list')).toContainText('LobbyReturner', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Wait for countdown
        await hostPage.waitForTimeout(4000);

        // Emit race finished event to show results
        await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            if (!game) return;

            game.eventBus.emit('race:finished', {
                results: [
                    {
                        position: 1,
                        vehicleId: 'test-vehicle',
                        playerId: 'LobbyReturner',
                        finishTime: 30000,
                        lapTimes: [10000, 10000, 10000],
                        bestLapTime: 9500
                    }
                ],
                totalTime: 30000
            });
        });

        // Wait for results UI to appear
        await hostPage.waitForTimeout(1000);

        // Verify results UI is visible
        await expect(hostPage.locator('.results-ui')).toBeVisible({ timeout: 5000 });

        // Click Back to Lobby button via JS to avoid viewport issues
        await hostPage.evaluate(() => {
            const btn = document.querySelector('#results-lobby') as HTMLButtonElement;
            if (btn) btn.click();
        });

        // Wait for state transition
        await hostPage.waitForTimeout(1000);

        // After clicking back to lobby, verify the results UI is hidden
        await expect(hostPage.locator('.results-ui')).toHaveClass(/hidden/, { timeout: 5000 });
    });

});
