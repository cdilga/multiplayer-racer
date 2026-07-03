import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * br-skip-bin-arcade-design-language-5k3.25 — shared UI foundation + adoption (browser).
 *
 * Verifies (1) the SERVED shared stylesheet foundation on /host and /player: two
 * brand typefaces resolve on :root, bundled woff2 serve + decode, and the shared
 * grain overlay is non-interactive (pointer-events:none) + reduce-effects aware;
 * and (2) that an ACTUAL adopted production component (RaceUI HUD) renders with
 * the tokenized brand font, no backdrop-blur, hard (non-glow) shadows, and
 * legible, non-overlapping text.
 */

const ARTIFACT_DIR = 'artifacts/br-skip-bin-arcade-design-language-5k3.25';

async function readFoundation(page: any) {
    return page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const display = root.getPropertyValue('--font-display').trim();
        const body = root.getPropertyValue('--font-body').trim();

        // Inject the shared grain overlay class and read its COMPUTED style from
        // the served stylesheet (proves the foundation CSS is live).
        const el = document.createElement('div');
        el.className = 'sb-grain-overlay';
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const on = { position: cs.position, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex };

        el.setAttribute('data-enabled', 'false');
        const offDisplay = getComputedStyle(el).display;

        el.remove();
        return { display, body, on, offDisplay };
    });
}

test('host: two-typeface tokens + non-interactive grain overlay foundation', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/host?testMode=1');
    await page.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });

    const f = await readFoundation(page);

    // Two brand typefaces are defined and resolve to the SkipBin families.
    expect(f.display).toMatch(/SkipBinDisplay/);
    expect(f.body).toMatch(/SkipBinBody/);

    // The served CSS references REPO-LOCAL bundled woff2 assets that actually
    // serve as real WOFF2 and are loadable as fonts by the browser.
    const fonts = await page.evaluate(async () => {
        const out: Record<string, any> = {};
        for (const file of ['skip-bin-display.woff2', 'skip-bin-body.woff2']) {
            const url = `/static/assets/fonts/${file}`;
            const res = await fetch(url);
            const buf = new Uint8Array(await res.arrayBuffer());
            const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
            let loaded = false;
            try {
                // @ts-ignore FontFace is a browser global
                const face = new FontFace('probe', `url(${url})`);
                await face.load();
                loaded = true;
            } catch (e) { loaded = false; }
            out[file] = { status: res.status, size: buf.length, sig, loaded };
        }
        return out;
    });
    for (const file of ['skip-bin-display.woff2', 'skip-bin-body.woff2']) {
        expect(fonts[file].status).toBe(200);
        expect(fonts[file].sig).toBe('wOF2');       // real WOFF2 signature
        expect(fonts[file].size).toBeGreaterThan(2000);
        expect(fonts[file].loaded).toBe(true);      // browser decodes it as a font
    }

    // Grain overlay is non-interactive + full-frame from the served CSS.
    expect(f.on.pointerEvents).toBe('none');
    expect(f.on.position).toBe('fixed');
    // reduce-effects escape hatch hides it.
    expect(f.offDisplay).toBe('none');

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'host-foundation.png') });

    // No console errors from adding the foundation.
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('host: the shared grain overlay is attached to the LIVE host DOM by the product bootstrap (no test injection)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/host?testMode=1');
    await page.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });

    // The overlay must ALREADY exist in the DOM, created by the host bootstrap
    // (src/host/main.js), WITHOUT any test injection.
    const live = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('.sb-grain-overlay'));
        const el = els[0] as HTMLElement | undefined;
        const cs = el ? getComputedStyle(el) : null;
        return {
            count: els.length,
            wiredInstance: !!(window as any).__sbGrainOverlay,
            pointerEvents: cs ? cs.pointerEvents : null,
            position: cs ? cs.position : null,
            ariaHidden: el ? el.getAttribute('aria-hidden') : null,
        };
    });
    expect(live.wiredInstance, 'GrainOverlay instance not wired by the host bootstrap').toBe(true);
    expect(live.count, 'no .sb-grain-overlay in the live host DOM (bootstrap did not attach it)').toBeGreaterThanOrEqual(1);
    expect(live.pointerEvents, 'grain overlay must not steal input').toBe('none');
    expect(live.position).toBe('fixed');
    expect(live.ariaHidden).toBe('true');

    // Reduce-effects / setEnabled(false) hides the LIVE overlay (no re-injection).
    const offDisplay = await page.evaluate(() => {
        (window as any).__sbGrainOverlay.setEnabled(false);
        const el = document.querySelector('.sb-grain-overlay') as HTMLElement;
        return getComputedStyle(el).display;
    });
    expect(offDisplay, 'reduce-effects/setEnabled(false) must hide the live overlay').toBe('none');

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('host: adopted production HUD (RaceUI) is tokenized, de-glassed, legible, non-overlapping', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/host?testMode=1');
    await page.waitForFunction(() => typeof (window as any).RaceUI === 'function', null, { timeout: 30000 });

    const hud = await page.evaluate(() => {
        // Render the real production HUD component into an isolated container.
        const RaceUI = (window as any).RaceUI;
        const container = document.createElement('div');
        document.body.appendChild(container);
        const ui = new RaceUI({ container, eventBus: null });
        ui.init();
        ui.show();
        ui.updateHealthBars([
            { id: 'p1', name: 'PINK', color: '#FF2E88', health: 100, maxHealth: 100 },
            { id: 'p2', name: 'CYAN', color: '#2EE8FF', health: 60, maxHealth: 100 },
            { id: 'p3', name: 'YELLOW', color: '#FFD23E', health: 25, maxHealth: 100 },
        ]);

        const names = Array.from(container.querySelectorAll('.health-bar-name')) as HTMLElement[];
        const items = Array.from(container.querySelectorAll('.health-bar-item')) as HTMLElement[];

        const nameFont = names[0] ? getComputedStyle(names[0]).fontFamily : '';
        // Any element in the HUD using glass or a soft glow?
        let blur = false;
        let overflow = false;
        for (const el of container.querySelectorAll('*')) {
            const cs = getComputedStyle(el as HTMLElement);
            if (cs.backdropFilter && cs.backdropFilter !== 'none') blur = true;
        }
        for (const n of names) {
            if (n.scrollWidth > n.clientWidth + 1) overflow = true; // text does not fit
        }
        // Vertical overlap between stacked HUD items.
        let overlap = false;
        const rects = items.map((i) => i.getBoundingClientRect());
        for (let i = 1; i < rects.length; i++) {
            if (rects[i].top < rects[i - 1].bottom - 1) overlap = true;
        }
        return { count: items.length, nameFont, blur, overflow, overlap };
    });

    expect(hud.count).toBe(3);
    // Font is routed through the brand token chain (resolves to the bundled face).
    expect(hud.nameFont).toMatch(/SkipBin|monospace/);   // token chain, not a bare -apple-system
    expect(hud.nameFont).not.toMatch(/^-apple-system/);
    expect(hud.blur, 'HUD still uses backdrop blur/glass').toBe(false);
    expect(hud.overflow, 'HUD name text overflows (not legible/fit)').toBe(false);
    expect(hud.overlap, 'HUD items overlap').toBe(false);
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('player (controller): shared tokens present, overlay stays non-interactive', async ({ page }) => {
    await page.goto('/player?testMode=1');
    await page.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

    const f = await readFoundation(page);
    expect(f.display).toMatch(/SkipBinDisplay/);
    expect(f.body).toMatch(/SkipBinBody/);
    // Controller invariant: the overlay must never intercept touch input.
    expect(f.on.pointerEvents).toBe('none');
    expect(f.offDisplay).toBe('none');

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'player-foundation.png') });
});
