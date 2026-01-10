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

// Helper to navigate to host page with test mode for faster socket connections
export async function gotoHost(hostPage: Page): Promise<void> {
    await hostPage.goto('/?testMode=1');
}

// Helper to wait for room code to appear on host
export async function waitForRoomCode(hostPage: Page): Promise<string> {
    // Wait for room code element to be visible (longer timeout for CI with SwiftShader)
    await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });

    // Wait for a valid room code (not placeholder dashes) - fast polling
    let roomCode = '';
    for (let i = 0; i < 40; i++) {  // 40 * 50ms = 2 seconds max
        roomCode = await hostPage.locator('#room-code-display').textContent() || '';
        if (roomCode && roomCode.length === 4 && !roomCode.includes('-')) {
            return roomCode;
        }
        await hostPage.waitForTimeout(50);  // Faster polling
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
    // Navigate to player page with testMode flag for faster socket connections
    await playerPage.goto('/player?testMode=1');

    // Wait for join screen to be visible
    await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

    // Fill in player name
    await playerPage.fill('#player-name', playerName);

    // Fill in room code
    await playerPage.fill('#room-code', roomCode);

    // Click join button
    await playerPage.click('#join-btn');

    // Wait for game state to indicate we've joined (via JavaScript)
    // This is more reliable than waiting for CSS class changes which depend on socket timing
    await playerPage.waitForFunction(
        () => {
            // @ts-ignore - gameState is a global
            const gs = window.gameState;
            return gs && gs.playerId !== null;
        },
        { timeout: 30000 }
    );
}

// Helper to start game from host
export async function startGameFromHost(hostPage: Page): Promise<void> {
    // Wait for start button to be enabled
    await hostPage.waitForSelector('#start-game-btn', { timeout: 30000 });
    await hostPage.waitForFunction(
        () => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            return btn && !btn.disabled;
        },
        { timeout: 30000 }
    );

    // Click start button
    await hostPage.evaluate(() => {
        const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
        if (btn) btn.click();
    });

    // Wait for game to be ready (canvas + game object initialized)
    await hostPage.waitForFunction(() => {
        // @ts-ignore
        const game = window.game;
        return game?.engine?.initialized && document.querySelector('canvas');
    }, { timeout: 30000 });
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
