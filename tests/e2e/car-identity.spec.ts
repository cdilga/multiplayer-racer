import { test, expect } from '@playwright/test';

/**
 * br-car-identity-system — RUNNING-game evidence (anti-narrowing).
 *
 * On the real host path with cars spawned:
 *  - each car gets a CURATED, distinct color (not the old random 24-bit value),
 *  - each car shows a persistent roof number,
 *  - when a car is driven off-screen its marker shows a directional arrow that
 *    points toward the car (asserted against the real overlay + THREE projection).
 */

const HEX = /^#[0-9a-f]{6}$/i;
// Curated palette (server/car_palette.py) — seat 1 and seat 2 colors.
const CURATED_FIRST_TWO = ['#e6194b', '#3cb44b'];

test.describe('Car identity (br-car-identity-system)', () => {
    test('curated distinct colors + roof numbers + off-screen arrow', async ({ browser }) => {
        const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const hostPage = await hostContext.newPage();
        await hostPage.goto('/host?testMode=1');
        await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });

        let roomCode = '';
        for (let i = 0; i < 40; i++) {
            roomCode = (await hostPage.locator('#room-code-display').textContent()) || '';
            if (roomCode.length === 4 && !roomCode.includes('-')) break;
            await hostPage.waitForTimeout(50);
        }
        expect(roomCode.length).toBe(4);

        const contexts = [hostContext];
        for (let i = 1; i <= 2; i++) {
            const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
            contexts.push(ctx);
            const page = await ctx.newPage();
            await page.goto('/player?testMode=1');
            await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
            await page.fill('#room-code', roomCode);
            await page.fill('#player-name', `Racer${i}`);
            await page.click('#join-btn');
            await page.waitForFunction(() => (window as any).gameState?.playerId != null, undefined, { timeout: 60000 });
            await expect(hostPage.locator('#player-list')).toContainText(`Racer${i}`);
        }

        await hostPage.waitForFunction(() => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            return btn && !btn.disabled && btn.checkVisibility?.();
        }, undefined, { timeout: 60000 });
        await hostPage.evaluate(() => (document.querySelector('#start-game-btn') as HTMLButtonElement)?.click());

        await hostPage.waitForFunction(
            () => (window as any).game?.engine?.initialized && document.querySelector('canvas') && (window as any).game?.vehicles?.size >= 2,
            undefined,
            { timeout: 120000 }
        );

        // === Curated, distinct colors (not random) ===
        const colors = await hostPage.evaluate(() =>
            Array.from((window as any).game.vehicles.values()).map((v: any) => String(v.color || '').toLowerCase())
        );
        expect(colors.length).toBeGreaterThanOrEqual(2);
        for (const c of colors) expect(c).toMatch(HEX);
        expect(new Set(colors).size).toBe(colors.length); // all distinct — no confusable pair
        // Deterministic curation: a random assignment could not produce these exact values.
        expect(new Set(colors)).toEqual(new Set([...CURATED_FIRST_TWO].map((c) => c.toLowerCase())));

        // === Overlay is up; markers carry a persistent roof number ===
        await hostPage.waitForFunction(() => (window as any).__vehicleIdentityOverlay, undefined, { timeout: 30000 });
        const roofNumbers = await hostPage.evaluate(() => {
            const snap = (window as any).__vehicleIdentityOverlay.getDebugSnapshot();
            return snap.markers.map((m: any) => m.numberText);
        });
        expect(roofNumbers.length).toBeGreaterThanOrEqual(2);
        for (const n of roofNumbers) expect(String(n)).toMatch(/\d/);

        // === Off-screen car yields a directional arrow ===
        const arrow = await hostPage.evaluate(() => {
            const game = (window as any).game;
            const overlay = (window as any).__vehicleIdentityOverlay;
            const v: any = Array.from(game.vehicles.values())[0];
            const pid = String(v.playerId ?? v.id);
            // Teleport far off the right edge and re-run the overlay this frame.
            v.mesh.position.set(6000, v.mesh.position.y, 0);
            v.mesh.updateMatrixWorld(true);
            overlay.update();
            const snap = overlay.getDebugSnapshot();
            const marker = snap.markers.find((m: any) => String(m.playerId) === pid);
            return marker ? { offscreen: marker.offscreen, angle: marker.arrowAngleDeg } : null;
        });
        expect(arrow).not.toBeNull();
        expect(arrow!.offscreen).toBe(true);
        expect(Number.isFinite(arrow!.angle)).toBe(true);
        // Car pushed off the RIGHT edge -> arrow points roughly rightward (~0deg).
        expect(Math.abs(arrow!.angle)).toBeLessThan(45);

        for (const ctx of contexts) await ctx.close();
    });
});
