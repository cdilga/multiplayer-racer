/**
 * Live smoke test against the deployed game.
 * Usage: npx playwright test scripts/live-smoke.ts --config=scripts/live-smoke.config.ts
 */
import { test, expect, chromium, devices } from '@playwright/test';

const BASE = process.env.LIVE_URL || 'https://jammers.dilger.dev';

test('live: host creates room, player joins, race starts', async () => {
    test.setTimeout(300000);  // generous: cold CF cache after a deploy makes first loads slow
    const browser = await chromium.launch();

    // Host on a desktop viewport
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const host = await hostCtx.newPage();
    await host.goto(BASE + '/host?testMode=1', { waitUntil: 'domcontentloaded' });

    // Room code appears
    const codeEl = host.locator('#room-code-display');
    await expect(codeEl).not.toHaveText('----', { timeout: 30000 });
    const roomCode = (await codeEl.textContent())!.trim();
    console.log('Room code:', roomCode);

    // Join URL must use the public domain, not a LAN IP
    const joinUrl = await host.locator('#join-url').textContent();
    console.log('Join URL:', joinUrl);
    expect(joinUrl).toContain('jammers.dilger.dev');

    await host.screenshot({ path: 'test-results/live/lobby.png' });

    // Player joins from a phone profile
    const playerCtx = await browser.newContext({ ...devices['iPhone 13'] });
    const player = await playerCtx.newPage();
    console.log('Loading player page...');
    await player.goto(`${BASE}/player?testMode=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await player.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
    await player.waitForFunction(() => {
        // @ts-ignore
        return window.gameState?.connected === true;
    }, { timeout: 30000 });
    await player.fill('#player-name', 'LiveSmoke');
    await player.fill('#room-code', roomCode);
    await player.click('#join-btn');
    await player.waitForFunction(() => {
        // @ts-ignore
        return window.gameState?.playerId !== null;
    }, { timeout: 30000 });

    await expect(host.locator('#player-list')).toContainText('LiveSmoke', { timeout: 30000 });
    console.log('Player visible in host lobby');

    // Start the game
    await host.click('#start-game-btn');
    await expect(host.locator('#game-screen')).toBeVisible({ timeout: 30000 });
    await host.waitForTimeout(4000);

    // Player should be on the controller screen
    await expect(player.locator('#game-screen')).toBeVisible({ timeout: 15000 });

    // Verify the game is actually simulating (vehicle exists in the world)
    const state = await host.evaluate(() => {
        // @ts-ignore
        const game = (window as any).game;
        return {
            vehicles: game?.vehicles?.size ?? 0,
            engineState: game?.engine?.getState?.() ?? 'unknown',
            trackId: game?.track?.configId ?? 'none'
        };
    });
    console.log('Game state:', JSON.stringify(state));
    expect(state.vehicles).toBeGreaterThan(0);
    expect(['racing', 'countdown']).toContain(state.engineState);

    await host.screenshot({ path: 'test-results/live/racing.png' });
    await player.screenshot({ path: 'test-results/live/controller.png' });

    await browser.close();
});
