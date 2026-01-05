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

    // Wait for a valid room code (not placeholder dashes)
    let roomCode = '';
    for (let i = 0; i < 50; i++) {  // Try for up to 5 seconds
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
    // Wait for start button to be enabled by checking it's not disabled
    // First wait for the button to exist
    await hostPage.waitForSelector('#start-game-btn', { timeout: 30000 });

    // Wait until button is enabled (not having disabled attribute)
    await hostPage.waitForFunction(
        () => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            return btn && !btn.disabled;
        },
        { timeout: 30000 }
    );

    // Click start button via JavaScript to bypass viewport checks
    await hostPage.evaluate(() => {
        const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
        if (btn) btn.click();
    });

    // Wait for game screen to be visible (game-container should have canvas)
    await hostPage.waitForSelector('#game-screen:not(.hidden)', { timeout: 15000 });

    // Wait a bit for game to initialize
    await hostPage.waitForTimeout(1000);

    // Focus the page for keyboard events (use evaluate to avoid viewport issues)
    await hostPage.evaluate(() => document.body.focus());
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
