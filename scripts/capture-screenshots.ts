/**
 * Screenshot capture script for README documentation
 * Run with: npx tsx scripts/capture-screenshots.ts
 */
import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, '../docs/images');
const BASE_URL = 'http://localhost:8000';

async function waitForRoomCode(page: Page): Promise<string> {
    // Wait for room code with extended timeout and debug logging
    console.log('  Waiting for room code to appear...');

    // First wait for the element to exist
    await page.waitForSelector('#room-code-display', { timeout: 10000 });

    // Then wait for it to have content
    await page.waitForFunction(
        () => {
            const el = document.getElementById('room-code-display');
            return el && el.textContent && el.textContent.trim().length > 0;
        },
        { timeout: 15000 }
    );

    const roomCode = await page.locator('#room-code-display').textContent();
    if (!roomCode) throw new Error('No room code found');
    console.log(`  Room code: ${roomCode.trim()}`);
    return roomCode.trim();
}

async function captureScreenshots() {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('🚀 Starting screenshot capture...\n');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // Create host context (large screen - TV/monitor)
        const hostContext = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 2
        });
        const hostPage = await hostContext.newPage();

        // Enable console logging for debugging
        hostPage.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`  Browser error: ${msg.text()}`);
            }
        });

        // Create player contexts (mobile devices)
        const player1Context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 2
        });
        const player1Page = await player1Context.newPage();

        const player2Context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 2
        });
        const player2Page = await player2Context.newPage();

        // ========== LOBBY SCREEN ==========
        console.log('📸 1/6 Capturing Lobby Screen...');
        await hostPage.goto(BASE_URL);

        // Wait for page to fully load and socket to connect
        await hostPage.waitForLoadState('networkidle');
        await hostPage.waitForTimeout(2000);

        const roomCode = await waitForRoomCode(hostPage);

        await hostPage.screenshot({
            path: path.join(OUTPUT_DIR, 'lobby-screen.png'),
            fullPage: false
        });
        console.log('  ✅ Lobby screen captured\n');

        // ========== PLAYER JOIN SCREEN ==========
        console.log('📸 2/6 Capturing Player Join Screen...');
        await player1Page.goto(`${BASE_URL}/player?room=${roomCode}`);
        await player1Page.waitForLoadState('networkidle');
        await player1Page.waitForTimeout(1000);

        await player1Page.screenshot({
            path: path.join(OUTPUT_DIR, 'player-join.png'),
            fullPage: false
        });
        console.log('  ✅ Player join screen captured\n');

        // ========== PLAYERS JOINING ==========
        console.log('📸 3/6 Players joining the game...');

        // Player 1 joins
        await player1Page.fill('#player-name', 'SpeedyRacer');
        await player1Page.click('#join-btn');
        await player1Page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });
        console.log('  Player 1 (SpeedyRacer) joined');

        // Player 2 joins
        await player2Page.goto(`${BASE_URL}/player?room=${roomCode}`);
        await player2Page.waitForLoadState('networkidle');
        await player2Page.waitForTimeout(500);
        await player2Page.fill('#player-name', 'TurboKing');
        await player2Page.click('#join-btn');
        await player2Page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });
        console.log('  Player 2 (TurboKing) joined');

        await hostPage.waitForTimeout(1000);

        // Capture lobby with players
        await hostPage.screenshot({
            path: path.join(OUTPUT_DIR, 'lobby-with-players.png'),
            fullPage: false
        });
        console.log('  ✅ Lobby with players captured\n');

        // ========== RACING VIEW ==========
        console.log('📸 4/6 Starting game and capturing racing view...');

        // Wait for start button to be enabled
        await hostPage.waitForSelector('#start-game-btn:not([disabled])', { timeout: 10000 });
        await hostPage.click('#start-game-btn');

        // Wait for game to initialize and physics to settle
        await hostPage.waitForTimeout(3000);

        await hostPage.screenshot({
            path: path.join(OUTPUT_DIR, 'racing-action.png'),
            fullPage: false
        });
        console.log('  ✅ Racing action captured\n');

        // ========== MOBILE CONTROLLER ==========
        console.log('📸 5/6 Capturing mobile controller view...');
        await player1Page.waitForTimeout(500);

        await player1Page.screenshot({
            path: path.join(OUTPUT_DIR, 'mobile-controller.png'),
            fullPage: false
        });
        console.log('  ✅ Mobile controller captured\n');

        // ========== GAMEPLAY ACTION ==========
        console.log('📸 6/6 Capturing gameplay with car movement...');

        // Simulate acceleration via keyboard on host (for testing purposes)
        await hostPage.keyboard.down('ArrowUp');
        await hostPage.waitForTimeout(2000);
        await hostPage.keyboard.up('ArrowUp');

        await hostPage.screenshot({
            path: path.join(OUTPUT_DIR, 'gameplay-action.png'),
            fullPage: false
        });
        console.log('  ✅ Gameplay action captured\n');

        console.log('═══════════════════════════════════════');
        console.log('🎉 All screenshots captured successfully!');
        console.log(`📁 Output directory: ${OUTPUT_DIR}`);
        console.log('═══════════════════════════════════════\n');

        // List captured files
        const files = fs.readdirSync(OUTPUT_DIR);
        console.log('Captured files:');
        files.forEach(f => console.log(`  - ${f}`));

    } catch (error) {
        console.error('\n❌ Error capturing screenshots:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

captureScreenshots().catch(err => {
    console.error(err);
    process.exit(1);
});
