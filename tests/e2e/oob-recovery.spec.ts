import { test, expect, waitForRoomCode, gotoHost, joinGameAsPlayer, startGameFromHost } from './fixtures';

/**
 * br-oob-death-reset — a car that leaves the playable area is recovered.
 *
 * Behavioral (host path): a race car forced below the kill-plane is destroyed and
 * respawned back onto the map within a bounded time — never sits frozen off-map.
 */
test.describe('out-of-bounds recovery (oob-death-reset)', () => {
    test('a race car forced below the kill-plane respawns back in bounds', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'OobDriver');
        await expect(hostPage.locator('#player-list')).toContainText('OobDriver', { timeout: 30000 });
        await startGameFromHost(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.vehicles?.size >= 1 && game.engine.getState() === 'racing';
        }, undefined, { timeout: 30000 });

        // Slam the car far outside the playable area (X = 400, well past the 220
        // bound). With no ground there it also falls below the kill-plane.
        await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            const vehicle = game.vehicles.values().next().value;
            game.systems.physics.resetVehicle(vehicle.id, { x: 400, y: 3, z: 0 }, 0);
        });

        // Let the mesh sync from physics, then confirm it really is off-map.
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const vehicle = window.game.vehicles.values().next().value;
            const p = vehicle.mesh?.position || vehicle.position;
            return p && (Math.abs(p.x) > 220 || p.y < -20);
        }, undefined, { timeout: 5000 });

        // Within a bounded time (grace 1.5s + respawn delay 3s) the recovery
        // destroys + respawns it back on the map — never frozen off-map.
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            const vehicle = game.vehicles.values().next().value;
            const p = vehicle.mesh?.position || vehicle.position;
            return p && p.y > -20 && Math.abs(p.x) < 220 && Math.abs(p.z) < 220;
        }, undefined, { timeout: 12000 });

        const after = await hostPage.evaluate(() => {
            // @ts-ignore
            const vehicle = window.game.vehicles.values().next().value;
            const p = vehicle.mesh?.position || vehicle.position;
            return { y: p.y, x: p.x, z: p.z, isDead: vehicle.isDead };
        });
        // Recovered onto the map, upright and in-bounds, not frozen off-map.
        expect(after.y).toBeGreaterThan(-20);
        expect(Math.abs(after.x)).toBeLessThan(220);
        expect(Math.abs(after.z)).toBeLessThan(220);
    });

    test('in derby, an out-of-bounds car is eliminated (not respawned)', async ({ hostPage, playerPage, browser }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await hostPage.click('.mode-card[data-mode="derby"]');
        await joinGameAsPlayer(playerPage, roomCode, 'DerbyOob');
        // A SECOND player (own context) so combat continues after one is eliminated
        // (a 1-player derby ends instantly and leaves the combat state).
        const p2Context = await browser.newContext();
        const p2Page = await p2Context.newPage();
        await joinGameAsPlayer(p2Page, roomCode, 'DerbySurvivor');
        await expect(hostPage.locator('#player-list')).toContainText('DerbySurvivor', { timeout: 30000 });
        await startGameFromHost(hostPage);
        // Wait for derby combat with both cars spawned.
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.vehicles?.size >= 2 && game.systems.derby?.state === 'combat';
        }, undefined, { timeout: 30000 });

        // Capture the destruction that OOB triggers (routes to derby elimination),
        // then slam the car out of the arena.
        await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            // @ts-ignore
            window.__oobDestroyed = [];
            // @ts-ignore
            game.eventBus.on('damage:destroyed', (d) => window.__oobDestroyed.push(d.vehicleId));
            const vehicle = game.vehicles.values().next().value;
            game.systems.physics.resetVehicle(vehicle.id, { x: 400, y: 3, z: 0 }, 0);
        });

        // Derby OOB = elimination: a destruction fires and survivors drop from 2
        // to 1 (the OOB car is eliminated, not respawned; the other survives).
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            // @ts-ignore
            const destroyed = (window.__oobDestroyed || []).length > 0;
            return destroyed && game.systems.derby.getSurvivorCount() <= 1;
        }, undefined, { timeout: 12000 });

        const eliminated = await hostPage.evaluate(() => ({
            // @ts-ignore
            destroyedCount: (window.__oobDestroyed || []).length,
            // @ts-ignore
            survivors: window.game.systems.derby.getSurvivorCount()
        }));
        expect(eliminated.destroyedCount).toBeGreaterThan(0);
        expect(eliminated.survivors).toBeLessThanOrEqual(1);
    });
});
