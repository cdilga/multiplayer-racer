/**
 * Video capture script for README documentation
 * Creates a demo video showing the full game flow with 8 cars
 * Run with: npx tsx scripts/capture-video.ts
 *
 * Prerequisites:
 * - Server running: python server/app.py
 * - ffmpeg installed for GIF conversion
 * - Project built: npm run build
 * - GPU-enabled environment (local machine with graphics card)
 *   NOTE: This script will crash in CI/containers with software rendering
 *   due to the 8-car scenario being very slow in SwiftShader mode
 */
import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const OUTPUT_DIR = path.join(__dirname, '../docs/images');
const BASE_URL = 'http://localhost:8000';
const STATIC_DIR = path.join(__dirname, '../static');

/**
 * Setup route interception to serve local dependencies
 * This allows video capture to work in restricted network environments
 */
async function setupLocalRoutes(context: BrowserContext): Promise<void> {
    // Intercept Skypack CDN requests for Rapier and serve local files
    await context.route('**/cdn.skypack.dev/@dimforge/rapier3d-compat**', async route => {
        const localPath = path.join(STATIC_DIR, 'vendor/rapier/rapier.es.js');
        if (fs.existsSync(localPath)) {
            const body = fs.readFileSync(localPath);
            await route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: body
            });
        } else {
            // Fallback to network if local file doesn't exist
            await route.continue();
        }
    });

    // Intercept Three.js CDN and serve local
    await context.route('**/cdnjs.cloudflare.com/ajax/libs/three.js/**', async route => {
        const localPath = path.join(STATIC_DIR, 'vendor/three.min.js');
        if (fs.existsSync(localPath)) {
            const body = fs.readFileSync(localPath);
            await route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: body
            });
        } else {
            await route.continue();
        }
    });

    // Intercept Socket.IO CDN and serve local
    await context.route('**/cdn.socket.io/**', async route => {
        const localPath = path.join(STATIC_DIR, 'vendor/socket.io.min.js');
        if (fs.existsSync(localPath)) {
            const body = fs.readFileSync(localPath);
            await route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: body
            });
        } else {
            await route.continue();
        }
    });
}

async function waitForRoomCode(page: Page): Promise<string> {
    console.log('  Waiting for room code...');
    await page.waitForSelector('#room-code-display', { timeout: 20000 });
    await page.waitForFunction(
        () => {
            const el = document.getElementById('room-code-display');
            return el && el.textContent && el.textContent.trim().length > 0;
        },
        { timeout: 25000 }
    );
    const roomCode = await page.locator('#room-code-display').textContent();
    if (!roomCode) throw new Error('No room code found');
    return roomCode.trim();
}

async function captureVideo() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('🎬 Starting video capture...\n');

    // Use headed mode with xvfb for proper WebGL rendering
    // Run with: xvfb-run npx tsx scripts/capture-video.ts
    const useHeadless = process.env.HEADLESS !== 'false';

    const browser = await chromium.launch({
        headless: useHeadless,
        args: [
            // SwiftShader software rendering (same as CI tests)
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-gpu',
            // WebGL flags
            '--enable-webgl',
            '--enable-webgl2',
            '--ignore-gpu-blocklist',
            // Stability flags for containers
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-audio-output',
            '--mute-audio'
        ]
    });

    const videoPath = path.join(OUTPUT_DIR, 'gameplay-demo.webm');

    try {
        // Create host context with video recording
        const hostContext = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            recordVideo: {
                dir: OUTPUT_DIR,
                size: { width: 1280, height: 720 }
            }
        });
        // Setup local routes to bypass CDN restrictions
        await setupLocalRoutes(hostContext);
        const hostPage = await hostContext.newPage();

        // Log browser console for debugging
        hostPage.on('console', msg => {
            const text = msg.text();
            if (msg.type() === 'error' || text.includes('Rapier')) {
                console.log(`  [Browser] ${text}`);
            }
        });

        // Create 8 player contexts for full lobby
        const playerNames = [
            'SpeedDemon', 'TurboKing', 'NitroQueen', 'DriftMaster',
            'RocketRacer', 'ThunderBolt', 'BlazeFury', 'StormChaser'
        ];

        const playerContexts: BrowserContext[] = [];
        const playerPages: Page[] = [];

        for (let i = 0; i < 8; i++) {
            const playerContext = await browser.newContext({
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true
            });
            await setupLocalRoutes(playerContext);
            playerContexts.push(playerContext);
            playerPages.push(await playerContext.newPage());
        }

        console.log('📹 Recording lobby...');
        await hostPage.goto(BASE_URL);
        await hostPage.waitForLoadState('networkidle');
        await hostPage.waitForTimeout(2000);

        const roomCode = await waitForRoomCode(hostPage);
        console.log(`   Room code: ${roomCode}`);

        // Show lobby for a moment
        await hostPage.waitForTimeout(1500);

        console.log('📹 Players joining...');
        // All 8 players join
        for (let i = 0; i < playerPages.length; i++) {
            const playerPage = playerPages[i];
            const playerName = playerNames[i];

            await playerPage.goto(`${BASE_URL}/player`);
            await playerPage.waitForLoadState('networkidle');
            await playerPage.waitForSelector('#join-screen:not(.hidden)', { timeout: 10000 });
            await playerPage.fill('#player-name', playerName);
            await playerPage.fill('#room-code', roomCode);
            await playerPage.click('#join-btn');
            await playerPage.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });
            console.log(`  Player ${i + 1} (${playerName}) joined`);
            await hostPage.waitForTimeout(500);
        }

        // Extra pause to show full lobby
        await hostPage.waitForTimeout(1500);

        console.log('📹 Starting race...');
        await hostPage.waitForSelector('#start-game-btn:not([disabled])', { timeout: 10000 });
        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(3000);

        console.log('📹 Recording racing action with 8 cars...');
        // Simulate racing with keyboard controls - longer for 8 cars
        for (let i = 0; i < 5; i++) {
            await hostPage.keyboard.down('ArrowUp');
            await hostPage.waitForTimeout(800);
            await hostPage.keyboard.down('ArrowLeft');
            await hostPage.waitForTimeout(600);
            await hostPage.keyboard.up('ArrowLeft');
            await hostPage.waitForTimeout(800);
            await hostPage.keyboard.down('ArrowRight');
            await hostPage.waitForTimeout(600);
            await hostPage.keyboard.up('ArrowRight');
        }
        await hostPage.keyboard.up('ArrowUp');
        await hostPage.waitForTimeout(2000);

        // Close contexts to finalize video
        await hostContext.close();
        for (const playerContext of playerContexts) {
            await playerContext.close();
        }

        console.log('\n✅ Video recording complete!');

        // Find the recorded video file
        const files = fs.readdirSync(OUTPUT_DIR);
        const videoFile = files.find(f => f.endsWith('.webm') && f !== 'gameplay-demo.webm');

        if (videoFile) {
            const sourcePath = path.join(OUTPUT_DIR, videoFile);
            fs.renameSync(sourcePath, videoPath);
            console.log(`📁 Video saved: ${videoPath}`);

            // Convert to GIF using ffmpeg
            console.log('\n🔄 Converting to GIF...');
            const gifPath = path.join(OUTPUT_DIR, 'gameplay-demo.gif');

            // ffmpeg command for high-quality GIF:
            // - Scale to 800px width
            // - 12 fps for smaller size
            // - Generate palette for better colors
            // - Limit to 15 seconds for 8-car scenario
            const paletteCmd = `ffmpeg -y -i "${videoPath}" -vf "fps=12,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" -t 15 "${OUTPUT_DIR}/palette.png"`;
            const gifCmd = `ffmpeg -y -i "${videoPath}" -i "${OUTPUT_DIR}/palette.png" -lavfi "fps=12,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -t 15 "${gifPath}"`;

            try {
                console.log('   Generating color palette...');
                execSync(paletteCmd, { stdio: 'pipe' });
                console.log('   Creating optimized GIF...');
                execSync(gifCmd, { stdio: 'pipe' });

                // Clean up palette
                fs.unlinkSync(path.join(OUTPUT_DIR, 'palette.png'));

                const gifSize = fs.statSync(gifPath).size / (1024 * 1024);
                console.log(`\n✅ GIF created: ${gifPath}`);
                console.log(`   Size: ${gifSize.toFixed(2)} MB`);

                // If GIF is too large, create a more compressed version
                if (gifSize > 10) {
                    console.log('\n⚠️  GIF is large, creating compressed version...');
                    const compressedGifPath = path.join(OUTPUT_DIR, 'gameplay-demo-compressed.gif');
                    const compressCmd = `ffmpeg -y -i "${videoPath}" -vf "fps=10,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" -t 10 "${compressedGifPath}"`;
                    execSync(compressCmd, { stdio: 'pipe' });
                    const compressedSize = fs.statSync(compressedGifPath).size / (1024 * 1024);
                    console.log(`   Compressed size: ${compressedSize.toFixed(2)} MB`);
                }
            } catch (ffmpegError) {
                console.error('   ffmpeg conversion failed:', ffmpegError);
            }
        }

        console.log('\n🎉 Video capture complete!');

    } catch (error) {
        console.error('\n❌ Error:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

captureVideo().catch(err => {
    console.error(err);
    process.exit(1);
});
