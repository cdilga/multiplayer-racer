import { test, expect, waitForRoomCode, joinGameAsPlayer, gotoHost } from './fixtures';

test.describe('Game Modes', () => {

    test('procedural race track renders with weapons', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'VisualOne');
        await expect(hostPage.locator('#player-list')).toContainText('VisualOne', { timeout: 30000 });

        await hostPage.screenshot({ path: 'test-results/visual/lobby.png' });

        // Start race on procedural track (default option)
        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(3000);
        await hostPage.screenshot({ path: 'test-results/visual/race-procedural.png' });

        // Drive a bit for trails/motion
        await hostPage.evaluate(() => {
            // @ts-ignore
            window.gameState._testControlsOverride = true;
            // @ts-ignore
            const game = window.game;
            const vehicle = game.vehicles.values().next().value;
            vehicle.setControls({ acceleration: 1, braking: 0, steering: 0.2 });
        });
        await hostPage.waitForTimeout(4000);
        await hostPage.screenshot({ path: 'test-results/visual/race-driving.png' });

        // Check weapon pickups eventually appear (progression phase 0 spawns in 8-12s)
        const pickupInfo = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const start = Date.now();
            while (Date.now() - start < 20000) {
                if (game.systems.weapons.pickups.size > 0) break;
                await new Promise(r => setTimeout(r, 500));
            }
            return {
                pickups: game.systems.weapons.pickups.size,
                running: game.systems.weapons.running,
                enabled: game.systems.weapons.enabled,
                trackId: game.track.configId
            };
        });
        console.log('Weapon state:', JSON.stringify(pickupInfo));
        expect(pickupInfo.trackId).toContain('procedural');
        expect(pickupInfo.running).toBe(true);
        expect(pickupInfo.pickups).toBeGreaterThan(0);

        await hostPage.screenshot({ path: 'test-results/visual/race-with-pickups.png' });

        // Player controller should have the fire button in race mode
        await expect(playerPage.locator('#fire-btn')).toBeVisible();
        await expect(playerPage.locator('#weapon-indicator')).toBeVisible();
        await playerPage.screenshot({ path: 'test-results/visual/player-controller.png' });
    });

    test('derby arena renders with weapons', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'DerbyDude');
        await expect(hostPage.locator('#player-list')).toContainText('DerbyDude', { timeout: 30000 });

        // Select derby mode
        await hostPage.click('.mode-card[data-mode="derby"]');
        await hostPage.waitForTimeout(500);
        await hostPage.screenshot({ path: 'test-results/visual/lobby-derby.png' });

        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(5000);

        const derbyInfo = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            return {
                trackId: game.track.configId,
                derbyState: game.systems.derby.state,
                weaponsEnabled: game.systems.weapons.enabled
            };
        });
        console.log('Derby state:', JSON.stringify(derbyInfo));
        expect(derbyInfo.trackId).toContain('derby');

        await hostPage.screenshot({ path: 'test-results/visual/derby-arena.png' });
    });

    test('destroyed car explodes, ghosts, and respawns', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'Boomer');
        await expect(hostPage.locator('#player-list')).toContainText('Boomer', { timeout: 30000 });

        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(2000);

        const result = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const vehicle = game.vehicles.values().next().value;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

            // Kill the car via the damage system
            game.systems.damage.applyDamage(vehicle.id, 10000);
            await wait(300);

            const deadState = {
                isDead: vehicle.isDead,
                meshVisible: vehicle.mesh.visible,
                physicsEnabled: game.systems.physics.getVehicleBody(vehicle.id)?.isEnabled?.() ?? null
            };

            // Respawn delay is 3s - wait it out
            await wait(3800);

            const respawnState = {
                isDead: vehicle.isDead,
                meshVisible: vehicle.mesh.visible,
                health: vehicle.health,
                maxHealth: vehicle.maxHealth,
                physicsEnabled: game.systems.physics.getVehicleBody(vehicle.id)?.isEnabled?.() ?? null
            };

            return { deadState, respawnState };
        });
        console.log('Respawn cycle:', JSON.stringify(result));

        expect(result.deadState.isDead).toBe(true);
        expect(result.deadState.meshVisible).toBe(false);
        if (result.deadState.physicsEnabled !== null) {
            expect(result.deadState.physicsEnabled).toBe(false);
        }

        expect(result.respawnState.isDead).toBe(false);
        expect(result.respawnState.meshVisible).toBe(true);
        expect(result.respawnState.health).toBe(result.respawnState.maxHealth);
        if (result.respawnState.physicsEnabled !== null) {
            expect(result.respawnState.physicsEnabled).toBe(true);
        }
    });

    test('two-player derby: elimination, rounds, match end, play again', async ({ hostPage, playerPage, browser }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'DerbyA');

        // Second player from a fresh context
        const ctx2 = await browser.newContext();
        const playerPage2 = await ctx2.newPage();
        await joinGameAsPlayer(playerPage2, roomCode, 'DerbyB');

        await expect(hostPage.locator('#player-list')).toContainText('DerbyA', { timeout: 30000 });
        await expect(hostPage.locator('#player-list')).toContainText('DerbyB', { timeout: 30000 });

        await hostPage.click('.mode-card[data-mode="derby"]');
        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(3000);

        // Round 1: eliminate the first vehicle, second should win the round
        const round1 = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

            // Wait for derby combat to begin
            const start = Date.now();
            while (game.systems.derby.state !== 'combat' && Date.now() - start < 15000) {
                await wait(250);
            }
            if (game.systems.derby.state !== 'combat') {
                return { error: 'combat never started', state: game.systems.derby.state };
            }

            const vehicles = [...game.vehicles.values()];
            game.systems.damage.applyDamage(vehicles[0].id, 10000);
            await wait(1000);

            return {
                state: game.systems.derby.state,
                round: game.systems.derby.currentRound,
                victimDead: vehicles[0].isDead,
                victimRespawned: false
            };
        });
        console.log('Round 1:', JSON.stringify(round1));
        expect(round1.error).toBeUndefined();
        expect(round1.victimDead).toBe(true);
        expect(['round_end', 'countdown', 'combat']).toContain(round1.state);

        // Wait for round 2 to start (3s inter-round delay + countdown skip in test mode)
        const round2 = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

            const start = Date.now();
            while (Date.now() - start < 20000) {
                if (game.systems.derby.currentRound >= 2 && game.systems.derby.state === 'combat') break;
                await wait(300);
            }

            const vehicles = [...game.vehicles.values()];
            const round = game.systems.derby.currentRound;
            const state = game.systems.derby.state;
            const allAlive = vehicles.every(v => !v.isDead && v.health === v.maxHealth);

            if (state !== 'combat') {
                return { round, state, allAlive, error: 'round 2 combat never started' };
            }

            // Eliminate the same vehicle again - second straight win ends the match
            game.systems.damage.applyDamage(vehicles[0].id, 10000);
            await wait(1500);

            return {
                round,
                allAliveAtRoundStart: allAlive,
                finalState: game.systems.derby.state
            };
        });
        console.log('Round 2:', JSON.stringify(round2));
        expect(round2.error).toBeUndefined();
        expect(round2.round).toBe(2);
        expect(round2.allAliveAtRoundStart).toBe(true);
        expect(round2.finalState).toBe('match_end');

        // Results screen with Play Again should restart the derby
        await expect(hostPage.locator('#results-play-again')).toBeVisible({ timeout: 10000 });
        await hostPage.click('#results-play-again');

        const restarted = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
            const start = Date.now();
            while (Date.now() - start < 15000) {
                if (game.systems.derby.state === 'combat' && game.systems.derby.currentRound === 1) break;
                await wait(250);
            }
            const vehicles = [...game.vehicles.values()];
            return {
                state: game.systems.derby.state,
                round: game.systems.derby.currentRound,
                allAlive: vehicles.every(v => !v.isDead)
            };
        });
        console.log('Play Again:', JSON.stringify(restarted));
        expect(restarted.state).toBe('combat');
        expect(restarted.round).toBe(1);
        expect(restarted.allAlive).toBe(true);

        await ctx2.close();
    });
});
