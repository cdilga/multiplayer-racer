import { test, expect, waitForRoomCode, joinGameAsPlayer, gotoHost } from './fixtures';

// Detect CI environment for conditional behavior
const isCI = !!process.env.CI;

/**
 * Diagnostic tests to identify CI issues with game startup.
 * These tests provide detailed logging at each step to identify failure points.
 *
 * NOTE: fullPage screenshots disabled in CI - SwiftShader makes WebGL screenshots
 * take 30-50+ seconds, causing timeouts. Use viewport-only screenshots instead.
 */
test.describe('CI Diagnostic Tests', () => {
    test('DIAGNOSTIC: full game startup sequence with detailed logging', async ({ hostPage, playerPage }) => {
        // Capture all console output for debugging
        const hostLogs: string[] = [];
        const playerLogs: string[] = [];

        hostPage.on('console', msg => hostLogs.push(`[${msg.type()}] ${msg.text()}`));
        hostPage.on('pageerror', err => hostLogs.push(`[PAGE_ERROR] ${err.message}`));
        playerPage.on('console', msg => playerLogs.push(`[${msg.type()}] ${msg.text()}`));
        playerPage.on('pageerror', err => playerLogs.push(`[PAGE_ERROR] ${err.message}`));

        // Helper: fast screenshot (no fullPage in CI due to SwiftShader slowness)
        const takeScreenshot = async (page: typeof hostPage, name: string) => {
            try {
                await page.screenshot({
                    path: `test-results/${name}.png`,
                    fullPage: false, // Viewport only - fullPage is too slow with WebGL
                    timeout: 10000   // Short timeout - don't block test progress
                });
            } catch (e) {
                console.log(`Screenshot ${name} skipped (timeout or error)`);
            }
        };

        console.log('=== STEP 1: Host page navigation ===');
        await gotoHost(hostPage);
        console.log('Host page loaded');
        await takeScreenshot(hostPage, 'diag-01-host-loaded');

        console.log('=== STEP 2: Wait for room code ===');
        let roomCode: string;
        try {
            roomCode = await waitForRoomCode(hostPage);
            console.log('Room code obtained:', roomCode);
        } catch (e) {
            console.log('ERROR getting room code:', e);
            console.log('Host logs:', hostLogs.slice(-30));
            await takeScreenshot(hostPage, 'diag-error-room-code');
            throw e;
        }
        await takeScreenshot(hostPage, 'diag-02-room-code-ready');

        console.log('=== STEP 3: Player joins ===');
        try {
            await joinGameAsPlayer(playerPage, roomCode, 'DiagPlayer');
            console.log('Player joined successfully');
        } catch (e) {
            console.log('ERROR joining as player:', e);
            console.log('Player logs:', playerLogs.slice(-30));
            await takeScreenshot(playerPage, 'diag-error-player-join');
            throw e;
        }

        // Skip host screenshot here - it's slow with WebGL. Player page is fast.
        await takeScreenshot(playerPage, 'diag-03-player-joined-player');

        console.log('=== STEP 4: Check start button state ===');
        const startBtnState = await hostPage.evaluate(() => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            return {
                exists: !!btn,
                disabled: btn?.disabled,
                visible: btn?.checkVisibility?.() ?? false,
                text: btn?.textContent,
                classes: btn?.className
            };
        });
        console.log('Start button state:', JSON.stringify(startBtnState, null, 2));

        // Wait for button to be enabled
        console.log('=== STEP 5: Wait for start button to be enabled ===');
        try {
            await hostPage.waitForSelector('#start-game-btn', { timeout: 30000 });
            await hostPage.waitForFunction(
                () => {
                    const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
                    return btn && !btn.disabled;
                },
                { timeout: 30000 }
            );
            console.log('Start button is enabled');
        } catch (e) {
            console.log('ERROR waiting for start button:', e);
            const debugInfo = await hostPage.evaluate(() => {
                const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
                const playerList = document.querySelector('#player-list');
                return {
                    btnExists: !!btn,
                    btnDisabled: btn?.disabled,
                    btnText: btn?.textContent,
                    playerListHTML: playerList?.innerHTML?.substring(0, 500)
                };
            });
            console.log('Debug info:', JSON.stringify(debugInfo, null, 2));
            console.log('Host logs:', hostLogs.slice(-30));
            await takeScreenshot(hostPage, 'diag-error-start-btn');
            throw e;
        }

        console.log('=== STEP 6: Click start button ===');
        await hostPage.evaluate(() => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            if (btn) btn.click();
        });
        console.log('Start button clicked');

        console.log('=== STEP 7: Wait for game engine initialization ===');
        try {
            await hostPage.waitForFunction(() => {
                // @ts-ignore
                const game = window.game;
                const hasEngine = !!game?.engine;
                const isInitialized = game?.engine?.initialized;
                const hasCanvas = !!document.querySelector('canvas');
                console.log(`Game check: engine=${hasEngine}, initialized=${isInitialized}, canvas=${hasCanvas}`);
                return game?.engine?.initialized && document.querySelector('canvas');
            }, { timeout: 60000 }); // Longer timeout for WebGL init with SwiftShader
            console.log('Game engine initialized!');
        } catch (e) {
            console.log('ERROR waiting for game engine:', e);
            const gameState = await hostPage.evaluate(() => {
                // @ts-ignore
                const game = window.game;
                return {
                    gameExists: !!game,
                    engineExists: !!game?.engine,
                    engineInitialized: game?.engine?.initialized,
                    canvasExists: !!document.querySelector('canvas'),
                    // @ts-ignore
                    gameStateExists: !!window.gameState
                };
            });
            console.log('Game state:', JSON.stringify(gameState, null, 2));
            console.log('Host logs (last 50):', hostLogs.slice(-50));
            await takeScreenshot(hostPage, 'diag-error-game-init');
            throw e;
        }

        // Final screenshot - may be slow but worth capturing if game started
        await takeScreenshot(hostPage, 'diag-06-game-running');

        console.log('=== SUCCESS: All steps completed ===');
        console.log('Host logs summary:', hostLogs.length, 'entries');
        console.log('Player logs summary:', playerLogs.length, 'entries');
    });

    test('player page should load and show join screen', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });
        await playerPage.screenshot({ path: 'test-results/ci-diagnostic-player-page.png' });
        await expect(playerPage.locator('#player-name')).toBeVisible();
        await expect(playerPage.locator('#room-code')).toBeVisible();
        await expect(playerPage.locator('#join-btn')).toBeVisible();
    });
});
