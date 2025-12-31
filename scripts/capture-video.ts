/**
 * Video capture script for README documentation
 * Creates a demo video showing the full game flow
 * Run with: npx tsx scripts/capture-video.ts
 */
import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const OUTPUT_DIR = path.join(__dirname, '../docs/images');
const BASE_URL = 'http://localhost:8000';

async function waitForRoomCode(page: Page): Promise<string> {
    await page.waitForSelector('#room-code-display', { timeout: 10000 });
    await page.waitForFunction(
        () => {
            const el = document.getElementById('room-code-display');
            return el && el.textContent && el.textContent.trim().length > 0;
        },
        { timeout: 15000 }
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

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
        const hostPage = await hostContext.newPage();

        // Create player contexts
        const player1Context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const player1Page = await player1Context.newPage();

        const player2Context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const player2Page = await player2Context.newPage();

        console.log('📹 Recording lobby...');
        await hostPage.goto(BASE_URL);
        await hostPage.waitForLoadState('networkidle');
        await hostPage.waitForTimeout(2000);

        const roomCode = await waitForRoomCode(hostPage);
        console.log(`   Room code: ${roomCode}`);

        // Show lobby for a moment
        await hostPage.waitForTimeout(1500);

        console.log('📹 Players joining...');
        // Player 1 joins
        await player1Page.goto(`${BASE_URL}/player?room=${roomCode}`);
        await player1Page.waitForLoadState('networkidle');
        await player1Page.fill('#player-name', 'SpeedDemon');
        await player1Page.click('#join-btn');
        await player1Page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });
        await hostPage.waitForTimeout(1000);

        // Player 2 joins
        await player2Page.goto(`${BASE_URL}/player?room=${roomCode}`);
        await player2Page.waitForLoadState('networkidle');
        await player2Page.fill('#player-name', 'TurboKing');
        await player2Page.click('#join-btn');
        await player2Page.waitForSelector('#waiting-screen:not(.hidden)', { timeout: 10000 });
        await hostPage.waitForTimeout(1500);

        console.log('📹 Starting race...');
        await hostPage.waitForSelector('#start-game-btn:not([disabled])', { timeout: 10000 });
        await hostPage.click('#start-game-btn');
        await hostPage.waitForTimeout(3000);

        console.log('📹 Recording racing action...');
        // Simulate some racing with keyboard controls
        for (let i = 0; i < 3; i++) {
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
        await hostPage.waitForTimeout(1000);

        // Close contexts to finalize video
        await hostContext.close();
        await player1Context.close();
        await player2Context.close();

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
            // - Scale to 640px width
            // - 15 fps for smaller size
            // - Generate palette for better colors
            // - Limit to 10 seconds
            const paletteCmd = `ffmpeg -y -i "${videoPath}" -vf "fps=12,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" -t 12 "${OUTPUT_DIR}/palette.png"`;
            const gifCmd = `ffmpeg -y -i "${videoPath}" -i "${OUTPUT_DIR}/palette.png" -lavfi "fps=12,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -t 12 "${gifPath}"`;

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
