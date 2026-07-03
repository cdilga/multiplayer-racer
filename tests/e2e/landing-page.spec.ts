import { test, expect } from '@playwright/test';

/**
 * Landing page (marketing entry point) tests.
 *
 * baseURL is http://localhost:8000 (set in playwright.config.ts).
 * CI only runs full-game.spec.ts, so this suite is for local / regression use.
 *
 * Stable selectors (data-testid) added on the landing page:
 *   - [data-testid="hero-title"]       brand title text "Joystick Jammers"
 *   - [data-testid="host-cta"]         primary "Host Now" button -> /host
 *   - [data-testid="join-form"]        the join <form>
 *   - [data-testid="join-code-input"]  4-letter room code input
 *   - [data-testid="join-submit"]      join submit button
 *   - [data-testid="join-plain"]       plain "Join a game" link -> /player
 */

test.describe('Landing page', () => {
    test('shows the hero and is not the host game screen', async ({ page }) => {
        await page.goto('/');

        // Hero brand title is visible.
        await expect(page.getByTestId('hero-title')).toHaveText('Joystick Jammers');
        await expect(page.getByTestId('gameplay-visual')).toBeVisible();
        await expect(page.getByTestId('gameplay-image')).toHaveJSProperty('complete', true);
        const visualSize = await page.getByTestId('gameplay-image').evaluate((img: HTMLImageElement) => ({
            width: img.naturalWidth,
            height: img.naturalHeight,
        }));
        expect(visualSize.width).toBeGreaterThan(100);
        expect(visualSize.height).toBeGreaterThan(100);

        // The host-only room code display must NOT exist on the landing.
        await expect(page.locator('#room-code-display')).toHaveCount(0);
    });

    test('"Host Now" CTA navigates to /host', async ({ page }) => {
        await page.goto('/');

        const hostCta = page.getByTestId('host-cta');

        // It should target /host (href may include preserved query, but starts with /host).
        await expect(hostCta).toHaveAttribute('href', /\/host/);

        await hostCta.click();
        await page.waitForURL(/\/host/);
        expect(page.url()).toContain('/host');
    });

    test('join box submits an uppercased code to /player?room=CODE', async ({ page }) => {
        await page.goto('/');

        await page.getByTestId('join-code-input').fill('abcd');
        await page.getByTestId('join-submit').click();

        await page.waitForURL(/\/player\?room=ABCD/);
        expect(page.url()).toContain('/player?room=ABCD');
    });

    test('dev bypass (?dev=1) redirects straight to /host', async ({ page }) => {
        await page.goto('/?dev=1');

        await page.waitForURL(/\/host/);
        expect(page.url()).toContain('/host');
    });

    test('captures first-viewport evidence on desktop and mobile', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/?dev=0');
        await expect(page.getByTestId('host-cta')).toBeVisible();
        await expect(page.getByTestId('join-form')).toBeVisible();
        await page.screenshot({
            path: 'artifacts/br-skip-bin-arcade-design-language-5k3.27/landing-desktop.png',
            fullPage: false,
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/?dev=0');
        await expect(page.getByTestId('host-cta')).toBeVisible();
        await expect(page.getByTestId('join-form')).toBeVisible();
        await expect(page.getByTestId('gameplay-visual')).toBeVisible();
        await page.screenshot({
            path: 'artifacts/br-skip-bin-arcade-design-language-5k3.27/landing-mobile.png',
            fullPage: false,
        });
    });
});
