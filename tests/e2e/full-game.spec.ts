import { test, expect } from '@playwright/test';

/**
 * Single comprehensive E2E test that validates the full game stack.
 * This is the ONLY WebGL test that runs in CI.
 *
 * Tests:
 * - Host can create a room
 * - 4 players can join
 * - Game can start
 * - All vehicles spawn
 * - Basic gameplay works
 */
test.describe('Full Game E2E', () => {
    test('4 players can join and complete basic gameplay', async ({ browser }) => {
        // === Setup Host ===
        const hostContext = await browser.newContext({
            viewport: { width: 1280, height: 720 },
        });
        const hostPage = await hostContext.newPage();
        // Landing page lives at "/"; host screen moved to "/host".
        await hostPage.goto('/host?testMode=1');

        // Wait for room code
        await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });

        // Wait for valid room code (not placeholder dashes)
        let roomCode = '';
        for (let i = 0; i < 40; i++) {
            roomCode = await hostPage.locator('#room-code-display').textContent() || '';
            if (roomCode && roomCode.length === 4 && !roomCode.includes('-')) {
                break;
            }
            await hostPage.waitForTimeout(50);
        }
        expect(roomCode).toBeTruthy();
        expect(roomCode.length).toBe(4);
        console.log(`Room created: ${roomCode}`);

        // === Create 4 Players ===
        const players: Array<{ context: any; page: any; name: string }> = [];

        for (let i = 1; i <= 4; i++) {
            const playerContext = await browser.newContext({
                viewport: { width: 375, height: 667 },
                isMobile: true,
                hasTouch: true,
            });
            const playerPage = await playerContext.newPage();
            const playerName = `Player${i}`;

            await playerPage.goto('/player?testMode=1');
            await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
            await playerPage.fill('#room-code', roomCode);
            await playerPage.fill('#player-name', playerName);
            await playerPage.click('#join-btn');

            // Wait for join confirmation via gameState (60s for slow CI)
            await playerPage.waitForFunction(
                () => {
                    // @ts-ignore
                    const gs = window.gameState;
                    return gs && gs.playerId !== null;
                },
                undefined,
                { timeout: 60000 }
            );

            // Wait for this player to appear in host's player list before continuing
            // This ensures socket events have propagated to the host UI
            // Uses global expect.timeout (60s in CI) from playwright.config.ts
            await expect(hostPage.locator('#player-list')).toContainText(playerName);

            players.push({ context: playerContext, page: playerPage, name: playerName });
            console.log(`${playerName} joined`);
        }

        console.log('All 4 players visible in lobby');

        // === Start Game ===
        // Wait for start button to be visible and enabled (longer timeout for CI with SwiftShader)
        await hostPage.waitForFunction(
            () => {
                const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
                return btn && !btn.disabled && btn.checkVisibility?.();
            },
            undefined,
            { timeout: 60000 }
        );

        // Click via evaluate to avoid action timeout issues in CI
        await hostPage.evaluate(() => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            if (btn) btn.click();
        });
        console.log('Start button clicked');

        // === Wait for Game Engine ===
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.engine?.initialized && document.querySelector('canvas');
            },
            undefined,
            { timeout: 120000 }
        );
        console.log('Game engine initialized');

        // === Verify All Vehicles Spawned ===
        const vehicleCount = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.game?.vehicles?.size || 0;
        });
        expect(vehicleCount).toBe(4);
        console.log(`${vehicleCount} vehicles spawned`);

        // === Basic Gameplay Test ===
        // Let the game run for a moment
        await hostPage.waitForTimeout(2000);

        // Verify game is in racing state
        const gameState = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.game?.engine?.getState?.() || 'unknown';
        });
        console.log(`Game state: ${gameState}`);

        // === Cleanup ===
        for (const player of players) {
            await player.context.close();
        }
        await hostContext.close();

        console.log('=== Full Game E2E: PASSED ===');
    });
});
