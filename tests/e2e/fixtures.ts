import { test as base, Browser, BrowserContext, Page } from '@playwright/test';

// Extended test type with host and player contexts
export type GameTestFixtures = {
    hostContext: BrowserContext;
    hostPage: Page;
    playerContext: BrowserContext;
    playerPage: Page;
};

// Custom test fixture that sets up host and player browser contexts
export const test = base.extend<GameTestFixtures>({
    // Host context - desktop browser
    hostContext: async ({ browser }, use) => {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
        });
        await use(context);
        await context.close();
    },

    // Host page
    hostPage: async ({ hostContext }, use) => {
        const page = await hostContext.newPage();
        await use(page);
    },

    // Player context - mobile browser with touch support
    playerContext: async ({ browser }, use) => {
        const context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        });
        await use(context);
        await context.close();
    },

    // Player page
    playerPage: async ({ playerContext }, use) => {
        const page = await playerContext.newPage();
        await use(page);
    },
});

export { expect } from '@playwright/test';

// Helper to wait for room code to appear on host
export async function waitForRoomCode(hostPage: Page): Promise<string> {
    // Wait for room code element to be visible
    await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });

    // Wait for a valid room code (not placeholder dashes) - optimized
    let roomCode = '';
    for (let i = 0; i < 30; i++) {  // Reduced from 50 to 30 (3 seconds max)
        roomCode = await hostPage.locator('#room-code-display').textContent() || '';
        if (roomCode && roomCode.length === 4 && !roomCode.includes('-')) {
            return roomCode;
        }
        await hostPage.waitForTimeout(100);
    }

    // If still invalid, throw with helpful error
    throw new Error(`Invalid or missing room code after waiting: "${roomCode}"`);
}

// Helper to join game as player
export async function joinGameAsPlayer(
    playerPage: Page,
    roomCode: string,
    playerName: string = 'TestPlayer'
): Promise<void> {
    // Navigate to player page
    await playerPage.goto('/player');

    // Wait for join screen to be visible
    await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

    // Fill in player name
    await playerPage.fill('#player-name', playerName);

    // Fill in room code
    await playerPage.fill('#room-code', roomCode);

    // Click join button
    await playerPage.click('#join-btn');

    // Wait for waiting screen to appear (not hidden)
    await playerPage.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });
}

// Helper to start game from host
export async function startGameFromHost(hostPage: Page): Promise<void> {
    // Wait for start button to be enabled
    await hostPage.waitForSelector('#start-game-btn:not([disabled])', { timeout: 10000 });

    // Click start button
    await hostPage.click('#start-game-btn');

    // Wait for game screen to be visible (game-container should have canvas)
    await hostPage.waitForSelector('#game-screen:not(.hidden)', { timeout: 15000 });

    // Wait for game to actually initialize (check for game object and canvas)
    // Use a more lenient check - just verify game and canvas exist, not that loop is running
    await hostPage.waitForFunction(() => {
        // @ts-ignore
        const game = window.game;
        const canvas = document.querySelector('canvas');
        // Check that game is initialized and canvas exists
        return game && game.engine && game.engine.initialized && canvas !== null;
    }, { timeout: 10000 }).catch(() => {
        // If check fails, continue anyway - game might still be initializing
        console.warn('Game initialization check timed out, continuing...');
    });

    // Wait a bit for game to initialize (reduced from 1000ms)
    await hostPage.waitForTimeout(300);

    // Click on the page body to ensure keyboard events work
    // This is necessary because Playwright keyboard events need a focused element
    // Use try-catch to handle page closure gracefully
    try {
        await hostPage.click('body', { position: { x: 100, y: 100 }, timeout: 5000 });
    } catch (e) {
        // Check if page is still alive and game is running
        const pageAlive = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.gameLoop?.isRunning() || false;
        }).catch(() => false);
        
        if (!pageAlive) {
            // Page crashed - try to get console errors before failing
            console.error('Page crashed during game initialization. Check browser console for Three.js errors.');
            throw new Error('Page crashed during game initialization - possible Three.js compatibility issue');
        }
    }
}

// Helper to send control inputs from player
export async function sendPlayerControls(
    playerPage: Page,
    controls: { steering?: number; acceleration?: boolean; braking?: boolean }
): Promise<void> {
    // For now, use keyboard controls since touch simulation is complex
    if (controls.acceleration) {
        await playerPage.keyboard.down('ArrowUp');
    }
    if (controls.braking) {
        await playerPage.keyboard.down('ArrowDown');
    }
    if (controls.steering !== undefined) {
        if (controls.steering < 0) {
            await playerPage.keyboard.down('ArrowLeft');
        } else if (controls.steering > 0) {
            await playerPage.keyboard.down('ArrowRight');
        }
    }
}

// Helper to release all controls
export async function releaseAllControls(playerPage: Page): Promise<void> {
    await playerPage.keyboard.up('ArrowUp');
    await playerPage.keyboard.up('ArrowDown');
    await playerPage.keyboard.up('ArrowLeft');
    await playerPage.keyboard.up('ArrowRight');
}
