/**
 * Video capture script for README documentation
 * Creates a demo video showing 32 cars racing simultaneously
 * Run with: npx tsx scripts/capture-video.ts
 *
 * Prerequisites:
 * - Server running: python server/app.py
 * - ffmpeg installed for GIF conversion
 * - Works completely offline using bundled dependencies
 */
import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const OUTPUT_DIR = path.join(__dirname, '../docs/images');
const BASE_URL = 'http://localhost:8000';
const STATIC_DIR = path.join(__dirname, '../static');
const NUM_CARS = 32; // Number of cars to spawn

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

    // Intercept Three.js CDN and serve local (jsdelivr)
    await context.route('**/cdn.jsdelivr.net/npm/three**', async route => {
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
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--use-gl=egl',              // Use EGL for better WebGL in xvfb
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--disable-gpu-sandbox',
            '--enable-features=Vulkan'
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

        console.log('📹 Recording lobby...');
        await hostPage.goto(BASE_URL);
        await hostPage.waitForLoadState('networkidle');
        await hostPage.waitForTimeout(2000);

        const roomCode = await waitForRoomCode(hostPage);
        console.log(`   Room code: ${roomCode}`);

        // Show lobby for a moment
        await hostPage.waitForTimeout(1500);

        console.log(`📹 Spawning ${NUM_CARS} players...`);

        // Create player names with variety
        const playerNames = [];
        const prefixes = ['Speed', 'Turbo', 'Nitro', 'Hyper', 'Ultra', 'Mega', 'Super', 'Rocket'];
        const suffixes = ['Racer', 'King', 'Queen', 'Demon', 'Beast', 'Flash', 'Bolt', 'Storm'];

        for (let i = 0; i < NUM_CARS; i++) {
            const prefix = prefixes[i % prefixes.length];
            const suffix = suffixes[Math.floor(i / prefixes.length) % suffixes.length];
            const num = Math.floor(i / (prefixes.length * suffixes.length)) || '';
            playerNames.push(`${prefix}${suffix}${num}`);
        }

        const playerContexts: BrowserContext[] = [];
        const playerPages: Page[] = [];

        // Create all player contexts in batches to avoid overwhelming the system
        const BATCH_SIZE = 8;
        for (let batch = 0; batch < Math.ceil(NUM_CARS / BATCH_SIZE); batch++) {
            const batchStart = batch * BATCH_SIZE;
            const batchEnd = Math.min(batchStart + BATCH_SIZE, NUM_CARS);

            console.log(`   Batch ${batch + 1}/${Math.ceil(NUM_CARS / BATCH_SIZE)}: Joining players ${batchStart + 1}-${batchEnd}...`);

            // Create contexts in parallel within batch
            const batchPromises = [];
            for (let i = batchStart; i < batchEnd; i++) {
                batchPromises.push(
                    (async () => {
                        const context = await browser.newContext({
                            viewport: { width: 390, height: 844 },
                            isMobile: true,
                            hasTouch: true
                        });
                        await setupLocalRoutes(context);
                        const page = await context.newPage();

                        // Navigate and join
                        await page.goto(`${BASE_URL}/player`);
                        await page.waitForLoadState('networkidle');
                        await page.waitForSelector('#join-screen:not(.hidden)', { timeout: 10000 });
                        await page.fill('#player-name', playerNames[i]);
                        await page.fill('#room-code', roomCode);
                        await page.click('#join-btn');
                        await page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });

                        return { context, page };
                    })()
                );
            }

            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ context, page }) => {
                playerContexts.push(context);
                playerPages.push(page);
            });

            console.log(`   ✓ Batch ${batch + 1} complete (${batchEnd} players total)`);
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n✓ All ${NUM_CARS} players joined!\n`);
        await hostPage.waitForTimeout(2000);

        console.log('📹 Starting race...');
        await hostPage.waitForSelector('#start-game-btn:not([disabled])', { timeout: 10000 });
        await hostPage.click('#start-game-btn');

        // Wait for cars to spawn and physics to settle
        await hostPage.waitForTimeout(5000);

        console.log(`📹 Recording ${NUM_CARS} cars in action...`);

        // Let the cars sit for a moment so we can see all 32
        await hostPage.waitForTimeout(3000);

        // Simulate some movement with keyboard controls
        for (let i = 0; i < 4; i++) {
            await hostPage.keyboard.down('ArrowUp');
            await hostPage.waitForTimeout(1000);
            await hostPage.keyboard.down('ArrowLeft');
            await hostPage.waitForTimeout(800);
            await hostPage.keyboard.up('ArrowLeft');
            await hostPage.keyboard.down('ArrowRight');
            await hostPage.waitForTimeout(800);
            await hostPage.keyboard.up('ArrowRight');
        }
        await hostPage.keyboard.up('ArrowUp');

        // Hold for final view
        await hostPage.waitForTimeout(2000);

        console.log('\n🧹 Cleaning up contexts...');
        // Close all player contexts
        for (let i = 0; i < playerContexts.length; i++) {
            await playerContexts[i].close();
            if ((i + 1) % 10 === 0) {
                console.log(`   Closed ${i + 1}/${playerContexts.length} player contexts`);
            }
        }

        // Close host context to finalize video
        await hostContext.close();

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

            // ffmpeg command for high-quality GIF optimized for 32 cars
            // - 10fps and 800px width for reasonable file size
            // - 15 second duration to show all the action
            // - Palette optimization for better colors
            const paletteCmd = `ffmpeg -y -i "${videoPath}" -vf "fps=10,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" -t 15 "${OUTPUT_DIR}/palette.png"`;
            const gifCmd = `ffmpeg -y -i "${videoPath}" -i "${OUTPUT_DIR}/palette.png" -lavfi "fps=10,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -t 15 "${gifPath}"`;

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
        console.log(`📊 Stats:`);
        console.log(`   - Cars: ${NUM_CARS}`);
        console.log(`   - Video: ${videoPath}`);

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
