import { test, expect, gotoHost } from './fixtures';

/**
 * br-debug-menu-panel — RUNNING-game evidence (anti-narrowing).
 *
 * On the real host path: the debug menu is gated behind ?debug=1 (normal players
 * never see it), F1 reveals it, and each checkbox flips its own debug overlay
 * independently + reversibly — asserted against the overlays' real visibility.
 */

test.describe('Debug menu (br-debug-menu-panel)', () => {
    test('is hidden for normal players (no debug flag)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await hostPage.waitForFunction(() => Boolean((window as any).toggleDebugMenu), null, { timeout: 30000 });
        // The gate is on: no menu element is ever created for a normal player.
        expect(await hostPage.locator('#debug-menu').count()).toBe(0);
    });

    test('appears with ?debug=1, F1 reveals it, and each toggle flips its overlay', async ({ hostPage }) => {
        await gotoHost(hostPage, { debug: true });
        // Menu exists (gated on) but starts hidden until revealed.
        await hostPage.waitForSelector('#debug-menu', { state: 'attached', timeout: 30000 });
        await expect(hostPage.locator('#debug-menu')).toHaveClass(/hidden/);

        // F1 reveals the menu with a row per registered overlay.
        await hostPage.keyboard.press('F1');
        await expect(hostPage.locator('#debug-menu')).not.toHaveClass(/hidden/);
        const rowIds = await hostPage.$$eval('#debug-menu .debug-menu-row', (rows) =>
            rows.map((r) => r.getAttribute('data-toggle-id'))
        );
        expect(rowIds).toEqual(['physics-tuning', 'stats-overlay', 'collider-debug']);

        // Helper: is a given overlay currently ON (per its own .visible)?
        const overlayVisible = (id: string) => hostPage.evaluate((tid) => {
            const g = (window as any).game;
            const map: Record<string, any> = {
                'physics-tuning': g?.ui?.physicsTuning,
                'stats-overlay': g?.ui?.statsOverlay,
                'collider-debug': g?.ui?.debugOverlay
            };
            return Boolean(map[tid]?.visible);
        }, id);

        const checkbox = (id: string) => hostPage.locator(`#debug-menu input[data-toggle-checkbox="${id}"]`);

        // Flip stats-overlay ON — and ONLY it changes (independent).
        expect(await overlayVisible('stats-overlay')).toBe(false);
        expect(await overlayVisible('physics-tuning')).toBe(false);
        await checkbox('stats-overlay').check();
        await expect.poll(() => overlayVisible('stats-overlay')).toBe(true);
        expect(await overlayVisible('physics-tuning')).toBe(false); // untouched

        // Flip collider-debug ON independently.
        await checkbox('collider-debug').check();
        await expect.poll(() => overlayVisible('collider-debug')).toBe(true);

        // Reversible: uncheck stats-overlay turns it back off; collider stays on.
        await checkbox('stats-overlay').uncheck();
        await expect.poll(() => overlayVisible('stats-overlay')).toBe(false);
        expect(await overlayVisible('collider-debug')).toBe(true);

        // F1 again hides the menu (state reversible).
        await hostPage.keyboard.press('F1');
        await expect(hostPage.locator('#debug-menu')).toHaveClass(/hidden/);
    });
});
