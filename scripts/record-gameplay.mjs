// Records a short real gameplay clip (host big-screen view) by driving a live
// race with several bot players, then leaves the .webm in /tmp for ffmpeg to
// turn into a GIF. Run while the Flask server is up on :8000.
//
//   node scripts/record-gameplay.mjs
//
import { chromium } from 'playwright';

const BASE = 'http://localhost:8000';
const OUT_DIR = '/tmp/gameplay-rec';
const PLAYERS = ['Ace', 'Blaze', 'Comet', 'Dash'];

// Mirror the project's local GPU flags so WebGL renders with hardware accel.
const args = [
    '--use-gl=angle', '--use-angle=default', '--enable-gpu-rasterization',
    '--enable-webgl', '--enable-webgl2', '--ignore-gpu-blocklist',
    '--no-sandbox',
];

const browser = await chromium.launch({ args });

// Host context records video at 1280x720.
const hostCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const host = await hostCtx.newPage();
await host.goto(`${BASE}/host?testMode=1`, { waitUntil: 'domcontentloaded' });

await host.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });
let roomCode = '';
for (let i = 0; i < 60; i++) {
    roomCode = (await host.locator('#room-code-display').textContent())?.trim() || '';
    if (roomCode.length === 4 && !roomCode.includes('-')) break;
    await host.waitForTimeout(50);
}
console.log('room', roomCode);

// Join players.
const playerCtxs = [];
const playerPages = [];
for (const name of PLAYERS) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/player?testMode=1`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
    await p.fill('#player-name', name);
    await p.fill('#room-code', roomCode);
    await p.click('#join-btn');
    await p.waitForFunction(() => window.gameState && window.gameState.playerId !== null, null, { timeout: 30000 });
    playerCtxs.push(ctx);
    playerPages.push(p);
}
console.log('joined', playerPages.length);

// Start the race.
await host.waitForFunction(() => {
    const btn = document.querySelector('#start-game-btn');
    return btn && !btn.disabled;
}, null, { timeout: 30000 });
await host.evaluate(() => document.querySelector('#start-game-btn')?.click());
await host.waitForFunction(() => window.game?.engine?.initialized && document.querySelector('canvas'), null, { timeout: 60000 });
console.log('race started');

// Drive: everyone accelerates; each player carves a different arc so the pack
// spreads across the track and the camera has something to chase.
const steer = ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].keyboard.down('ArrowUp');
}
// Hold ~11s of motion, wiggling steering for visual interest.
const start = Date.now();
let toggle = false;
while (Date.now() - start < 11000) {
    toggle = !toggle;
    for (let i = 0; i < playerPages.length; i++) {
        const key = steer[(i + (toggle ? 1 : 0)) % steer.length];
        await playerPages[i].keyboard.down(key);
    }
    await host.waitForTimeout(900);
    for (let i = 0; i < playerPages.length; i++) {
        await playerPages[i].keyboard.up('ArrowLeft');
        await playerPages[i].keyboard.up('ArrowRight');
    }
    await host.waitForTimeout(150);
}

// Close the host context to flush the video file.
await hostCtx.close();
for (const ctx of playerCtxs) await ctx.close();
await browser.close();

// Report the produced video path.
import { readdirSync } from 'fs';
const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.webm'));
console.log('VIDEO=' + (files.length ? `${OUT_DIR}/${files[files.length - 1]}` : 'NONE'));
