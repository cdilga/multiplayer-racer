/**
 * Video capture script for README documentation
 * Creates a demo video showing 32 cars racing simultaneously
 * Run with: npx tsx scripts/capture-video.ts
 *
 * Prerequisites:
 * - Server running: python server/app.py
 * - ffmpeg installed for GIF conversion
 *
 * Note: Works completely offline! All dependencies (Socket.IO, Three.js, Rapier)
 * are bundled in static/vendor/ and served by Flask.
 */
import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Type declaration for window.socket
declare global {
    interface Window {
        socket?: { connected?: boolean };
    }
}

const OUTPUT_DIR = path.join(__dirname, '../docs/images');
const BASE_URL = 'http://localhost:8000';
const NUM_CARS = 16; // Number of cars to spawn (32 causes timeout issues)

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
        console.log('📹 Starting recording...');
        const hostContext = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            recordVideo: {
                dir: OUTPUT_DIR,
                size: { width: 1280, height: 720 }
            }
        });
        const hostPage = await hostContext.newPage();

        // Log browser console for debugging
        hostPage.on('console', msg => {
            const text = msg.text();
            if (msg.type() === 'error' || text.includes('Rapier')) {
                console.log(`  [Browser] ${text}`);
            }
        });

        await hostPage.goto(BASE_URL);
        await hostPage.waitForLoadState('networkidle');
        await hostPage.waitForTimeout(1000);

        const roomCode = await waitForRoomCode(hostPage);
        console.log(`   Room code: ${roomCode}`);

        console.log(`📹 Joining ${NUM_CARS} players quickly...`);

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

        // Create players as fast as possible - no delays
        for (let i = 0; i < NUM_CARS; i++) {
            console.log(`   Joining player ${i + 1}/${NUM_CARS}: ${playerNames[i]}...`);

            const context = await browser.newContext({
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true
            });
            const page = await context.newPage();

            await page.goto(`${BASE_URL}/player`);
            await page.waitForLoadState('networkidle');

            await page.waitForSelector('#join-screen:not(.hidden)', { timeout: 10000 });
            await page.fill('#player-name', playerNames[i]);
            await page.fill('#room-code', roomCode);
            await page.click('#join-btn');
            await page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });

            playerContexts.push(context);
            playerPages.push(page);
        }

        console.log(`\n✓ All ${NUM_CARS} players joined!\n`);
        await hostPage.waitForTimeout(500);

        // Scroll to ensure start button is visible
        console.log('📹 Scrolling to start button...');
        await hostPage.evaluate(() => {
            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) {
                startBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
        await hostPage.waitForTimeout(1000);

        console.log('📹 Starting race...');
        // Try to click start button even if disabled (force-enable if needed)
        await hostPage.evaluate(() => {
            const startBtn = document.getElementById('start-game-btn') as HTMLButtonElement;
            if (startBtn) {
                startBtn.disabled = false; // Force enable
                startBtn.click();
            }
        });

        // Wait for countdown and race start
        await hostPage.waitForTimeout(4000);

        console.log(`📹 Recording ${NUM_CARS} cars racing...`);

        // Simulate race with keyboard controls
        for (let i = 0; i < 6; i++) {
            await hostPage.keyboard.down('ArrowUp');
            await hostPage.waitForTimeout(1500);
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
        for (const context of playerContexts) {
            await context.close();
        }
        console.log(`   Closed ${playerContexts.length} player contexts`);

        await hostContext.close();

        console.log('\n✅ Video recording complete!');

        // Find the recorded video file
        const files = fs.readdirSync(OUTPUT_DIR);
        const videoFile = files.find(f => f.endsWith('.webm') && f !== 'gameplay-demo.webm');

        if (videoFile) {
            const sourcePath = path.join(OUTPUT_DIR, videoFile);
            fs.renameSync(sourcePath, videoPath);
            console.log(`📁 Video saved: ${videoPath}`);

            // Convert to GIF using ffmpeg with speed manipulation
            console.log('\n🔄 Converting to GIF with optimized timing...');
            const gifPath = path.join(OUTPUT_DIR, 'gameplay-demo.gif');
            const speedupPath = path.join(OUTPUT_DIR, 'speedup-temp.webm');

            // Create sped-up video:
            // - Skip first 8s (loading)
            // - Speed up 8s-20s (player joining) by 10x -> ~1.2s in output
            // - Show 20s+ (gameplay) at normal speed for 13.8s
            // - Total: ~15 seconds (1.2s joining + 13.8s gameplay)
            const speedupCmd = `ffmpeg -y -i "${videoPath}" -filter_complex "[0:v]trim=start=8:end=20,setpts=PTS/10[v1];[0:v]trim=start=20,setpts=PTS-STARTPTS[v2];[v1][v2]concat=n=2:v=1:a=0,fps=10,scale=800:-1:flags=lanczos[vout]" -map "[vout]" -t 15 "${speedupPath}"`;

            const paletteCmd = `ffmpeg -y -i "${speedupPath}" -vf "palettegen=stats_mode=diff" "${OUTPUT_DIR}/palette.png"`;
            const gifCmd = `ffmpeg -y -i "${speedupPath}" -i "${OUTPUT_DIR}/palette.png" -lavfi "[0:v][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "${gifPath}"`;

            try {
                console.log('   Creating sped-up video (joining 10x faster)...');
                execSync(speedupCmd, { stdio: 'pipe' });
                console.log('   Generating color palette...');
                execSync(paletteCmd, { stdio: 'pipe' });
                console.log('   Creating optimized GIF...');
                execSync(gifCmd, { stdio: 'pipe' });

                // Clean up temp files
                fs.unlinkSync(path.join(OUTPUT_DIR, 'palette.png'));
                fs.unlinkSync(speedupPath);

                const gifSize = fs.statSync(gifPath).size / (1024 * 1024);
                console.log(`\n✅ GIF created: ${gifPath}`);
                console.log(`   Size: ${gifSize.toFixed(2)} MB`);
                console.log(`   Duration: ~15 seconds (joining sped up 10x, then gameplay)`);

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
