import { test, expect, gotoHost, joinGameAsPlayer, resetE2ERooms, startGameFromHost, waitForRoomCode } from './fixtures';

test.describe('Player HUD vehicle state', () => {
    test.beforeEach(async ({ request }) => {
        await resetE2ERooms(request);
    });

    test.afterEach(async ({ request }) => {
        await resetE2ERooms(request);
    });

    test('shows host-broadcast speed and boost state on the phone controller', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await joinGameAsPlayer(playerPage, roomCode, 'HudRacer');
        await expect(hostPage.locator('#player-list')).toContainText('HudRacer', { timeout: 30000 });

        await startGameFromHost(hostPage);
        await expect(playerPage.locator('#game-screen')).not.toHaveClass(/hidden/, { timeout: 10000 });
        await hostPage.evaluate(() => {
            // @ts-ignore - explicit test-mode guard keeps host state broadcasts deterministic.
            window._testMode = true;
        });

        const playerId = await playerPage.evaluate(() => {
            // @ts-ignore - gameState is exposed for tests
            return window.gameState?.playerId;
        });

        expect(playerId, 'player id should be assigned after joining').toBeTruthy();

        await hostPage.evaluate((id) => {
            // @ts-ignore - game is exposed by the host bootstrap
            window.game.systems.network.broadcastVehicleStates([{
                id,
                speed: 73,
                health: 88,
                boost: true,
                wheelie: false
            }]);
        }, playerId);

        await expect(playerPage.locator('#connection-status')).toContainText('Connected');
        await expect(playerPage.locator('#speed')).toHaveText('73 km/h', { timeout: 10000 });

        const statusIcon = playerPage.locator('#status-icon');
        await expect(statusIcon).not.toHaveClass(/hidden/);
        await expect(statusIcon).toHaveText('🔥');
        await expect(statusIcon).toHaveClass(/status-boost/);

        const hudState = await playerPage.evaluate(() => {
            // @ts-ignore - gameState is exposed for tests
            const state = window.gameState;
            return {
                speed: state.speed,
                health: state.health,
                boostActive: state.boostActive,
                wheelieActive: state.wheelieActive,
                landingBoostActive: state.landingBoostActive,
                badLandingActive: state.badLandingActive,
                stuntState: state.stuntState,
                stuntCharge: state.stuntCharge
            };
        });

        expect(hudState).toEqual({
            speed: 73,
            health: 88,
            boostActive: true,
            wheelieActive: false,
            landingBoostActive: false,
            badLandingActive: false,
            stuntState: 'idle',
            stuntCharge: 0
        });

        const hostVehicleState = await hostPage.evaluate((id) => {
            // @ts-ignore - game is exposed by the host bootstrap
            const vehicle = window.game.vehicles.get(id);
            vehicle.speed = 41;
            vehicle.speedBoost = 1;
            vehicle.handlingState = 'wheelie';
            vehicle.stateDuration = 1.25;
            vehicle.stuntState = 'charging';
            vehicle.stuntCharge = 0.42;
            vehicle.stuntBoostMultiplier = 1;
            vehicle.stuntBoostUntil = 0;
            vehicle.stuntBadLandingUntil = 0;
            return window.game._buildVehicleStates()[0];
        }, playerId);

        expect(hostVehicleState).toMatchObject({
            id: playerId,
            speed: 41,
            boost: false,
            wheelie: true,
            handlingState: 'wheelie',
            stateDuration: 1.25,
            stuntState: 'charging',
            stuntCharge: 0.42,
            landingBoost: false,
            badLanding: false
        });

        await hostPage.evaluate((state) => {
            // @ts-ignore - game is exposed by the host bootstrap
            window.game.systems.network.broadcastVehicleStates([state]);
        }, hostVehicleState);

        await playerPage.waitForFunction(() => {
            // @ts-ignore - gameState is exposed for tests
            const state = window.gameState;
            return state?.wheelieActive === true && state?.boostActive === false;
        }, null, { timeout: 10000 });
        await expect(statusIcon).toHaveText('🚲', { timeout: 10000 });
        await expect(statusIcon).toHaveClass(/status-wheelie/);
        const wheelieState = await playerPage.evaluate(() => {
            // @ts-ignore - gameState is exposed for tests
            const state = window.gameState;
            return {
                boostActive: state.boostActive,
                wheelieActive: state.wheelieActive,
                landingBoostActive: state.landingBoostActive,
                badLandingActive: state.badLandingActive,
                stuntState: state.stuntState,
                stuntCharge: state.stuntCharge
            };
        });

        expect(wheelieState).toMatchObject({
            boostActive: false,
            wheelieActive: true,
            landingBoostActive: false,
            badLandingActive: false,
            stuntState: 'charging'
        });
        expect(wheelieState.stuntCharge).toBeCloseTo(0.42);

        const landingBoostState = await hostPage.evaluate((id) => {
            // @ts-ignore - game is exposed by the host bootstrap
            const vehicle = window.game.vehicles.get(id);
            vehicle.handlingState = 'grounded';
            vehicle.stuntState = 'reward';
            vehicle.stuntBoostMultiplier = 1.35;
            vehicle.stuntBoostUntil = performance.now() + 1000;
            return window.game._buildVehicleStates()[0];
        }, playerId);

        expect(landingBoostState).toMatchObject({
            id: playerId,
            boost: true,
            wheelie: false,
            stuntState: 'reward',
            landingBoost: true
        });

        await hostPage.evaluate(() => {
            // @ts-ignore - game is exposed by the host bootstrap
            window.game.systems.network.broadcastVehicleStates(window.game._buildVehicleStates());
        });

        await expect(statusIcon).toHaveText('🔥', { timeout: 10000 });
        await expect(statusIcon).toHaveClass(/status-landing/);
        const landingHudState = await playerPage.evaluate(() => {
            // @ts-ignore - gameState is exposed for tests
            const state = window.gameState;
            return {
                boostActive: state.boostActive,
                landingBoostActive: state.landingBoostActive,
                badLandingActive: state.badLandingActive,
                stuntState: state.stuntState
            };
        });

        expect(landingHudState).toEqual({
            boostActive: true,
            landingBoostActive: true,
            badLandingActive: false,
            stuntState: 'reward'
        });

        const badLandingState = await hostPage.evaluate((id) => {
            // @ts-ignore - game is exposed by the host bootstrap
            const vehicle = window.game.vehicles.get(id);
            vehicle.handlingState = 'grounded';
            vehicle.stuntState = 'bad-landing';
            vehicle.stuntBoostMultiplier = 1;
            vehicle.stuntBadLandingUntil = performance.now() + 1000;
            return window.game._buildVehicleStates()[0];
        }, playerId);

        expect(badLandingState).toMatchObject({
            id: playerId,
            boost: false,
            wheelie: false,
            stuntState: 'bad-landing',
            landingBoost: false,
            badLanding: true
        });

        await hostPage.evaluate(() => {
            // @ts-ignore - game is exposed by the host bootstrap
            window.game.systems.network.broadcastVehicleStates(window.game._buildVehicleStates());
        });

        await expect(statusIcon).toHaveText('!', { timeout: 10000 });
        await expect(statusIcon).toHaveClass(/status-bad/);
        const badHudState = await playerPage.evaluate(() => {
            // @ts-ignore - gameState is exposed for tests
            const state = window.gameState;
            return {
                boostActive: state.boostActive,
                landingBoostActive: state.landingBoostActive,
                badLandingActive: state.badLandingActive,
                stuntState: state.stuntState
            };
        });

        expect(badHudState).toEqual({
            boostActive: false,
            landingBoostActive: false,
            badLandingActive: true,
            stuntState: 'bad-landing'
        });
    });
});
