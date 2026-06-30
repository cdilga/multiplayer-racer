/**
 * Durable evidence capture for br-modes-remote-play-design-48a.5 — the NON-results
 * surfaces the bead acceptance requires screenshots of: phone join, phone waiting
 * room, phone in-game controller HUD, and the host lobby. Complements
 * capture.mjs (results-race/derby/reduced-motion).
 *
 * Drives the REAL app (built dist/ served by Flask) through the genuine
 * host -> player join -> start-game flow (same path as tests/e2e/fixtures.ts), so
 * every PNG is the actual tokenized surface in a real session — NOT a mock and NOT
 * a forced/faked DOM state. If a surface cannot be reached for real it FAILS
 * honestly (no fabricated screenshots).
 *
 * Run from the repo root (build first so dist/ is fresh):
 *   npm run build
 *   source ~/.pyenv/versions/multiplayer-racer/bin/activate && FLASK_DEBUG=0 python server/app.py &   # :8000
 *   node .ntm/evidence/48a5/capture-surfaces.mjs
 *   # then stop the server
 *
 * Override the base URL with BASE_URL=... (default http://localhost:8000).
 * Headless software GL (SwiftShader) is slow; timeouts are deliberately generous.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE_URL || 'http://localhost:8000';
const out = (name) => resolve(here, name);
const results = [];

// Software SwiftShader GL is slow; keep DSF=1 and freeze animations so the raster
// capture cannot stall on the render loop. Long budget for the screenshot itself.
const SHOT = { animations: 'disabled', timeout: 120000 };

const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

// --- Host context (desktop big screen) ---------------------------------------
const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const hostPage = await hostCtx.newPage();
const hostErrors = [];
hostPage.on('pageerror', (e) => hostErrors.push(String(e)));

let roomCode = null;
try {
    await hostPage.goto(`${base}/host?testMode=1`, { waitUntil: 'load' });
    await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 60000 });
    await hostPage.waitForFunction(() => {
        const t = document.querySelector('#room-code-display')?.textContent || '';
        return t.length === 4 && !t.includes('-');
    }, null, { timeout: 30000 });
    roomCode = (await hostPage.locator('#room-code-display').textContent())?.trim();
    await hostPage.waitForTimeout(500);
    await hostPage.screenshot({ path: out('host-lobby.png'), ...SHOT });
    results.push({ surface: 'host-lobby.png', ok: true, roomCode, pageErrors: hostErrors.slice() });
} catch (e) {
    results.push({ surface: 'host-lobby.png', ok: false, error: String(e), pageErrors: hostErrors.slice() });
}

// --- Player context (mobile phone controller) --------------------------------
const playerCtx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
});
const playerPage = await playerCtx.newPage();
const playerErrors = [];
playerPage.on('pageerror', (e) => playerErrors.push(String(e)));

// 1) Phone JOIN screen
try {
    await playerPage.goto(`${base}/player?testMode=1`, { waitUntil: 'load' });
    await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
    await playerPage.waitForTimeout(300);
    await playerPage.screenshot({ path: out('player-join.png'), ...SHOT });
    results.push({ surface: 'player-join.png', ok: true, pageErrors: playerErrors.slice() });
} catch (e) {
    results.push({ surface: 'player-join.png', ok: false, error: String(e), pageErrors: playerErrors.slice() });
}

// 2) Phone WAITING room (real join into the host's room)
let joined = false;
try {
    if (!roomCode) throw new Error('no host room code (host lobby capture failed) — cannot join');
    await playerPage.waitForFunction(() => window.gameState?.connected === true, null, { timeout: 30000 });
    await playerPage.fill('#player-name', 'EvidenceP1');
    await playerPage.fill('#room-code', roomCode);
    await playerPage.click('#join-btn', { noWaitAfter: true });
    // CPU is contended by the host's software-GL lobby render loop, so the join
    // round-trip can be slow — generous budget; surface the inline error if the
    // join is actually rejected.
    try {
        await playerPage.waitForFunction(() => window.gameState && window.gameState.playerId !== null, null, { timeout: 90000 });
    } catch (e) {
        const err = await playerPage.locator('#error-message').textContent().catch(() => null);
        const hasGS = await playerPage.evaluate(() => typeof window.gameState);
        throw new Error(`join did not register (gameState typeof=${hasGS}, #error-message="${(err || '').trim()}"): ${e.message}`);
    }
    await playerPage.waitForFunction(() => {
        const w = document.querySelector('#waiting-screen');
        return w && !w.classList.contains('hidden');
    }, null, { timeout: 60000 });
    joined = true;
    await playerPage.waitForTimeout(500);
    await playerPage.screenshot({ path: out('player-waiting.png'), ...SHOT });
    results.push({ surface: 'player-waiting.png', ok: true, roomCode, pageErrors: playerErrors.slice() });
} catch (e) {
    results.push({ surface: 'player-waiting.png', ok: false, error: String(e), pageErrors: playerErrors.slice() });
}

// 3) Phone in-game CONTROLLER HUD — REAL game start only (no faked DOM state).
try {
    if (!joined) throw new Error('player never joined — cannot reach in-game HUD');
    await hostPage.waitForFunction(() => {
        const b = document.querySelector('#start-game-btn');
        return b && !b.disabled && (b.checkVisibility ? b.checkVisibility() : true);
    }, null, { timeout: 60000 });
    await hostPage.evaluate(() => document.querySelector('#start-game-btn')?.click());
    // Host fully boots the race under software GL before broadcasting start —
    // slow under double-context SwiftShader, so wait for engine init first.
    await hostPage.waitForFunction(() => window.game?.engine?.initialized && document.querySelector('canvas'), null, { timeout: 180000 });
    // Player transitions to the game-screen controller HUD on game_started.
    await playerPage.waitForFunction(() => {
        const g = document.querySelector('#game-screen');
        return g && !g.classList.contains('hidden');
    }, null, { timeout: 120000 });
    await playerPage.waitForTimeout(800);
    await playerPage.screenshot({ path: out('player-controller-hud.png'), ...SHOT });
    results.push({ surface: 'player-controller-hud.png', ok: true, pageErrors: playerErrors.slice() });
} catch (e) {
    results.push({ surface: 'player-controller-hud.png', ok: false, error: String(e), pageErrors: playerErrors.slice() });
}

await browser.close();

// --- Report (with file existence + size) -------------------------------------
console.log('\n=== capture-surfaces results ===');
for (const r of results) {
    const f = out(r.surface);
    const bytes = existsSync(f) ? statSync(f).size : 0;
    console.log(JSON.stringify({ ...r, bytes }));
}
const allOk = results.every((r) => r.ok && existsSync(out(r.surface)) && statSync(out(r.surface)).size > 0);
console.log('ALL_OK', allOk);
process.exit(allOk ? 0 : 1);
