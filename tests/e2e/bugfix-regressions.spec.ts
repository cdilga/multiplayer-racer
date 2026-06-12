/**
 * Regression tests for gameplay/UI bug fixes:
 * - Derby camera raised above arena walls (no occlusion)
 * - Flipped cars auto-recover (critical in derby where respawns are off)
 * - Fullscreen buttons on host display and player controller
 * - Rejoining doesn't duplicate players or waiting-screen UI
 * - Host menu (restart/lobby/reset) and player menu (reset car/leave/help)
 * - Controller input debug overlay hidden unless ?debug=1
 */
import { test, expect, waitForRoomCode, joinGameAsPlayer, gotoHost } from './fixtures';

test.describe('Bugfix Regressions', () => {

    test('escape hatches: fullscreen, menus, reset car, no debug overlay', async ({ hostPage, playerPage }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'MenuTester');
        await expect(hostPage.locator('#player-list')).toContainText('MenuTester', { timeout: 30000 });

        // Host fullscreen button and menu button are always available
        await expect(hostPage.locator('#fullscreen-toggle')).toBeVisible();
        await expect(hostPage.locator('#game-menu-btn')).toBeVisible();

        // Player fullscreen toggle shows wherever the Fullscreen API exists
        const playerFullscreenState = await playerPage.evaluate(() => {
            const root = document.documentElement as any;
            return {
                apiSupported: !!(root.requestFullscreen || root.webkitRequestFullscreen),
                buttonHidden: document.getElementById('fullscreen-toggle')?.classList.contains('hidden')
            };
        });
        if (playerFullscreenState.apiSupported) {
            expect(playerFullscreenState.buttonHidden).toBe(false);
        }

        // Start the game
        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(2000);

        // Player menu button is visible in-game; controls debug overlay is NOT
        await expect(playerPage.locator('#player-menu-btn')).toBeVisible({ timeout: 15000 });
        await playerPage.waitForTimeout(1000); // give updateLoop a chance to (not) create it
        expect(await playerPage.locator('#input-indicator').count()).toBe(0);

        // Open player menu - help text and actions are present
        await playerPage.click('#player-menu-btn');
        await expect(playerPage.locator('#player-menu')).toBeVisible();
        await expect(playerPage.locator('#player-menu-reset')).toBeVisible();
        await expect(playerPage.locator('#player-menu-leave')).toBeVisible();

        // Teleport the car far from where the reset would put it, then ask
        // for a reset from the controller and verify the host moved the car
        const teleported = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            const vehicle = game.vehicles.values().next().value;
            game.systems.physics.resetVehicle(vehicle.id, { x: 70, y: 1.5, z: 70 }, 0);
            return { id: vehicle.id };
        });
        expect(teleported.id).toBeTruthy();

        await playerPage.click('#player-menu-reset');
        await expect(playerPage.locator('#player-menu')).toBeHidden();

        const resetResult = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const vehicle = game.vehicles.values().next().value;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

            const start = Date.now();
            while (Date.now() - start < 10000) {
                const pos = vehicle.physicsBody.translation();
                const dist = Math.hypot(pos.x - 70, pos.z - 70);
                if (dist > 5) return { moved: true, dist };
                await wait(250);
            }
            const pos = vehicle.physicsBody.translation();
            return { moved: false, dist: Math.hypot(pos.x - 70, pos.z - 70) };
        });
        console.log('Player-requested reset:', JSON.stringify(resetResult));
        expect(resetResult.moved).toBe(true);

        // Host menu: open and use Back to Lobby to exit a running game
        await hostPage.click('#game-menu-btn');
        await expect(hostPage.locator('#game-menu-panel')).toBeVisible();
        await hostPage.click('#game-menu-panel [data-action="lobby"]');

        const stateAfterExit = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.game.engine.getState();
        });
        expect(stateAfterExit).toBe('lobby');
    });

    test('controller debug overlay appears with ?debug=1', async ({ hostPage, playerPage, browser }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'NoDebug');
        await expect(hostPage.locator('#player-list')).toContainText('NoDebug', { timeout: 30000 });

        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(2000);

        // Late-join a second player with the debug flag enabled
        const ctx2 = await browser.newContext();
        const debugPage = await ctx2.newPage();
        await debugPage.goto('/player?testMode=1&debug=1');
        await debugPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
        await debugPage.fill('#player-name', 'DebugGuy');
        await debugPage.fill('#room-code', roomCode);
        await debugPage.click('#join-btn');

        // Late join drops straight into the game screen; overlay should appear
        await expect(debugPage.locator('#input-indicator')).toBeAttached({ timeout: 20000 });

        // The normal player still has no overlay
        expect(await playerPage.locator('#input-indicator').count()).toBe(0);

        await ctx2.close();
    });

    test('rejoining does not duplicate players, vehicles, or waiting-screen UI', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'Rejoiner');
        await expect(hostPage.locator('#player-list')).toContainText('Rejoiner', { timeout: 30000 });

        // Reload the controller (same tab keeps its reconnect session) and rejoin
        await playerPage.reload();
        await joinGameAsPlayer(playerPage, roomCode, 'Rejoiner');

        // Give the host a moment to process leave/join events
        await hostPage.waitForTimeout(2000);

        const hostState = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            const listText = document.getElementById('player-list')?.textContent || '';
            return {
                vehicleCount: game.vehicles.size,
                networkPlayers: game.systems.network.players.size,
                nameOccurrences: (listText.match(/Rejoiner/g) || []).length
            };
        });
        console.log('Rejoin state:', JSON.stringify(hostState));
        expect(hostState.vehicleCount).toBe(1);
        expect(hostState.networkPlayers).toBe(1);
        expect(hostState.nameOccurrences).toBe(1);

        // Waiting screen must not stack duplicate name inputs or car previews
        const waitingUi = await playerPage.evaluate(() => ({
            nameChangeContainers: document.querySelectorAll('.name-change-container').length,
            previewCanvases: document.querySelectorAll('#car-preview canvas').length
        }));
        expect(waitingUi.nameChangeContainers).toBe(1);
        expect(waitingUi.previewCanvases).toBe(1);

        // Duplicate join events on the host must not spawn a second car
        const dupGuard = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const before = game.vehicles.size;
            const existing = game.systems.network.players.values().next().value;
            game.eventBus.emit('network:playerJoined', { ...existing });
            await new Promise(r => setTimeout(r, 500));
            return { before, after: game.vehicles.size };
        });
        expect(dupGuard.after).toBe(dupGuard.before);
    });

    test('derby: high camera over walls and flipped car auto-recovery', async ({ hostPage, playerPage, browser }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'FlipA');

        // Two players so the derby round doesn't end instantly
        const ctx2 = await browser.newContext();
        const playerPage2 = await ctx2.newPage();
        await joinGameAsPlayer(playerPage2, roomCode, 'FlipB');
        await expect(hostPage.locator('#player-list')).toContainText('FlipA', { timeout: 30000 });
        await expect(hostPage.locator('#player-list')).toContainText('FlipB', { timeout: 30000 });

        await hostPage.click('.mode-card[data-mode="derby"]');
        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(3000);

        // Camera profile: raised above the arena walls so they can't occlude
        const cameraState = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

            const start = Date.now();
            while (game.systems.derby.state !== 'combat' && Date.now() - start < 15000) {
                await wait(250);
            }
            // Let the camera settle toward its target
            await wait(2000);

            const wallHeight = game.track.config.geometry?.wallHeight || 15;
            return {
                derbyState: game.systems.derby.state,
                trackId: game.track.configId,
                wallHeight,
                baseCameraHeight: game.systems.render.baseCameraHeight,
                cameraY: game.systems.render.camera.position.y
            };
        });
        console.log('Derby camera:', JSON.stringify(cameraState));
        expect(cameraState.derbyState).toBe('combat');
        expect(cameraState.baseCameraHeight).toBeGreaterThan(cameraState.wallHeight);
        expect(cameraState.cameraY).toBeGreaterThan(cameraState.wallHeight);

        // Flip a car upside down; flip recovery should right it within ~5s
        const flipResult = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
            const upYOf = (body: any) => {
                const rot = body.rotation();
                return 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
            };

            const vehicle = game.vehicles.values().next().value;
            const body = vehicle.physicsBody;

            // Turn the car onto its roof (180° about X) in place
            const pos = body.translation();
            body.setTranslation({ x: pos.x, y: pos.y + 1, z: pos.z }, true);
            body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            await wait(500);

            const flippedUpY = upYOf(body);

            // Recovery threshold is 2.5s - poll up to 8s for the car to right itself
            const start = Date.now();
            let recoveredUpY = upYOf(body);
            while (Date.now() - start < 8000) {
                recoveredUpY = upYOf(body);
                if (recoveredUpY > 0.9) break;
                await wait(250);
            }

            return { flippedUpY, recoveredUpY, isDead: vehicle.isDead };
        });
        console.log('Flip recovery:', JSON.stringify(flipResult));
        expect(flipResult.flippedUpY).toBeLessThan(0); // confirmed upside down
        expect(flipResult.recoveredUpY).toBeGreaterThan(0.9); // back upright
        expect(flipResult.isDead).toBe(false); // recovery, not elimination

        await ctx2.close();
    });
});
