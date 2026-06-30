/**
 * Repeatable evidence capture for br-modes-remote-play-design-48a.5 (ResultsUI
 * token alignment). Drives the REAL ResultsUI component via results-harness.html
 * and writes durable screenshots next to this script.
 *
 * Run from the repo root:
 *   python3 -m http.server 8011 &           # serve the repo (ES modules need http, not file://)
 *   node .ntm/evidence/48a5/capture.mjs      # node resolves @playwright/test from repo node_modules
 *
 * Override the base URL with BASE_URL=... if you use a different port.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE_URL || 'http://localhost:8011';
const harness = `${base}/.ntm/evidence/48a5/results-harness.html`;

async function shoot(browser, { reducedMotion, name, action }) {
    const ctx = await browser.newContext({
        viewport: { width: 1000, height: 760 },
        reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
        deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(harness, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
    await page.evaluate(action);
    await page.waitForTimeout(400);
    // Verify the chrome actually resolved a shared token (not a blank/blacked-out
    // canvas) — read the computed title color and the content background.
    const probe = await page.evaluate(() => {
        const title = document.querySelector('.results-title');
        const content = document.querySelector('.results-content');
        return {
            titleColor: title && getComputedStyle(title).color,
            contentBg: content && getComputedStyle(content).backgroundColor,
            visible: !!document.querySelector('.results-ui:not(.hidden)'),
        };
    });
    await page.screenshot({ path: resolve(here, name) });
    await ctx.close();
    console.log(name, JSON.stringify({ ...probe, pageErrors: errors }));
}

const browser = await chromium.launch();
await shoot(browser, { name: 'results-race.png', action: () => window.showRace() });
await shoot(browser, { name: 'results-derby.png', action: () => window.showDerby() });
await shoot(browser, { name: 'results-derby-reduced-motion.png', reducedMotion: true, action: () => window.showDerby() });
await browser.close();
console.log('done');
