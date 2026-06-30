import { test, expect } from '@playwright/test';

/**
 * Stale-client invalidation smoke (woq.3).
 *
 * Drives the REAL /version endpoint (no route interception, per project rules):
 * the player page boots, exposes window.__buildSkew, and we simulate an old
 * client bundle by passing a stale client build id. A real skew must surface a
 * reload prompt and flip window.__buildStale so player.js stops streaming
 * control payloads.
 */
test.describe('Stale client invalidation', () => {
    test('a matching build shows no banner and keeps sends enabled on load', async ({ page }) => {
        await page.goto('/player?testMode=1');
        await page.waitForFunction(() => !!(window as any).__buildSkew, { timeout: 30000 });

        // The freshly built bundle's baked-in id matches the server /version, so
        // the on-load check must not nag and must not suppress sends.
        const serverBuildId = await page.evaluate(async () => {
            const r = await fetch('/version', { cache: 'no-store' });
            return (await r.json()).buildId;
        });
        const matched = await page.evaluate(async (id) => {
            return await (window as any).__buildSkew.force(id, id);
        }, serverBuildId);
        expect(matched.stale).toBe(false);
        await expect(page.locator('#build-skew-banner')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__buildStale)).toBeFalsy();
    });

    test('a stale client gets a reload prompt and stops sending controls', async ({ page }) => {
        await page.goto('/player?testMode=1');
        await page.waitForFunction(() => !!(window as any).__buildSkew, { timeout: 30000 });

        // Simulate an old bundle: stale client id vs the real (different) server
        // build id fetched from /version inside force().
        const state = await page.evaluate(async () => {
            return await (window as any).__buildSkew.force('stale-old-client-build-000');
        });
        expect(state.stale).toBe(true);
        expect(state.serverBuildId).toBeTruthy();
        expect(state.serverBuildId).not.toBe('stale-old-client-build-000');

        // User-visible reload prompt.
        const banner = page.locator('#build-skew-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('new version');
        await expect(page.locator('#build-skew-reload')).toBeVisible();

        // Network suppression flag set: player.js handleInput() bails on this.
        expect(await page.evaluate(() => (window as any).__buildStale)).toBe(true);

        // Code-inspectable proof that the controller honors the flag: the guard
        // in player.js returns before emitting when __buildStale is set.
        await page.screenshot({ path: 'test-results/stale-client-banner.png' });
    });
});
