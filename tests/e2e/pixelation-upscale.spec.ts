import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { Browser, BrowserContext, Page } from '@playwright/test';
import {
    test,
    expect,
    gotoHost
} from './fixtures';

/**
 * P1.1 (br-skip-bin-arcade-design-language-5k3.3): low-res render target +
 * nearest-neighbor (crisp) upscale.
 *
 * Proves the mechanism, not just a screenshot:
 *  - the canvas is marked image-rendering: pixelated (crisp upscale);
 *  - sub-native grade tiers render into an internal buffer genuinely SMALLER
 *    than the display surface (upscaleFactor > 1) on BOTH dpr=1 and dpr=2,
 *    which is the regression the old dpr-multiply hid on high-DPR panels;
 *  - the native tier renders up-to-native (the low-res look is the floor);
 *  - window resize recomputes the internal buffer proportionally;
 *  - the upscaled frame is non-blank and shows real scene variance.
 */

const EVIDENCE_DIR = process.env.PIXELATION_EVIDENCE_DIR || null;

function ensureEvidenceDir() {
    if (!EVIDENCE_DIR) return null;
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    return EVIDENCE_DIR;
}

function writeEvidenceJson(fileName: string, payload: unknown) {
    const dir = ensureEvidenceDir();
    if (!dir) return;
    writeFileSync(path.join(dir, fileName), JSON.stringify(payload, null, 2));
}

async function captureEvidenceShot(page: Page, fileName: string) {
    const dir = ensureEvidenceDir();
    if (!dir) return;
    await page.locator('#game-container canvas').screenshot({ path: path.join(dir, fileName) });
}

async function waitForRenderSystem(hostPage: Page) {
    await hostPage.waitForFunction(() => {
        // @ts-ignore
        return window.game?.systems?.render?.initialized === true;
    }, null, { timeout: 15_000 });
}

async function applyTierAndRead(hostPage: Page, tierName: string) {
    return hostPage.evaluate(async (requestedTier) => {
        // @ts-ignore
        const render = window.game?.systems?.render;
        if (!render) return null;
        render.setGradeTier(requestedTier);
        // Let the resize/composer settle and a couple of frames render.
        await new Promise((resolve) => setTimeout(resolve, 350));
        const diagnostics = render.getGradeDiagnostics?.() || null;
        // Read back the live computed CSS so we prove the stylesheet/inline
        // style actually resolved to a crisp value in the browser.
        const canvas = render.getRenderer?.()?.domElement || null;
        const computedImageRendering = canvas
            ? getComputedStyle(canvas).imageRendering
            : null;
        return { diagnostics, computedImageRendering };
    }, tierName);
}

/**
 * Sample the canvas back-buffer and return the highest luminance variance over
 * a few rendered frames (0 == blank). Retrying over frames removes the
 * transient-blank-frame race: captureScreenshot() can fire between a scene
 * swap and the first repaint, which is a capture artefact, not a blank world.
 */
async function canvasVariance(hostPage: Page, attempts = 6) {
    let best = -1;
    for (let i = 0; i < attempts; i++) {
        const variance = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            const dataUrl = render?.captureScreenshot?.();
            if (!dataUrl) return Promise.resolve(-1);
            return new Promise<number>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = img.width;
                    c.height = img.height;
                    const ctx = c.getContext('2d');
                    if (!ctx) return resolve(-1);
                    ctx.drawImage(img, 0, 0);
                    const { data } = ctx.getImageData(0, 0, c.width, c.height);
                    let sum = 0;
                    let sumSq = 0;
                    let n = 0;
                    // Stride to keep this cheap; luminance only.
                    for (let j = 0; j < data.length; j += 4 * 97) {
                        const lum = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
                        sum += lum;
                        sumSq += lum * lum;
                        n++;
                    }
                    if (n === 0) return resolve(-1);
                    const mean = sum / n;
                    resolve(sumSq / n - mean * mean);
                };
                img.onerror = () => resolve(-1);
                img.src = dataUrl;
            });
        });
        if (variance > best) best = variance;
        if (best > 5) break;
        await hostPage.waitForTimeout(120);
    }
    return best;
}

const ALL_TIERS = ['host-native', 'host-balanced', 'host-degraded', 'host-fallback'] as const;
const SUB_NATIVE_TIERS = ['host-balanced', 'host-degraded', 'host-fallback'] as const;

test.describe('P1.1 low-res render target + crisp upscale', () => {
    test('canvas upscales crisp and sub-native tiers render a genuinely smaller internal target (dpr=1)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRenderSystem(hostPage);

        const byTier: Record<string, any> = {};

        for (const tierName of ALL_TIERS) {
            const result = await applyTierAndRead(hostPage, tierName);
            expect(result, `tier ${tierName} produced diagnostics`).not.toBeNull();
            const { diagnostics, computedImageRendering } = result!;
            const rt = diagnostics.renderTarget;

            // Crisp upscale is in force (inline + stylesheet both target pixelated).
            expect(computedImageRendering, `computed image-rendering for ${tierName}`).toBe('pixelated');
            expect(rt.crispUpscale, `crispUpscale flag for ${tierName}`).toBe(true);

            // Display surface is the full window regardless of internal res.
            expect(rt.displayWidth).toBe(1280);
            expect(rt.displayHeight).toBe(720);
            expect(rt.internalWidth).toBeGreaterThan(0);
            expect(rt.internalHeight).toBeGreaterThan(0);

            byTier[tierName] = rt;
            await captureEvidenceShot(hostPage, `dpr1-${tierName}.png`);
        }

        // Native renders up-to-native: at dpr=1 the buffer equals the display
        // (no upscale) — the low-res look is the floor, not forced everywhere.
        expect(byTier['host-native'].internalWidth).toBe(1280);
        expect(byTier['host-native'].isUpscaled).toBe(false);

        // Every sub-native tier renders a strictly smaller internal buffer that
        // is then upscaled (the chunky regime).
        for (const tierName of SUB_NATIVE_TIERS) {
            expect(byTier[tierName].internalWidth, `${tierName} internal < display`).toBeLessThan(1280);
            expect(byTier[tierName].isUpscaled, `${tierName} isUpscaled`).toBe(true);
            expect(byTier[tierName].upscaleFactor, `${tierName} upscaleFactor`).toBeGreaterThan(1);
        }

        // Monotonic: lower tier => smaller internal buffer => more upscaling.
        expect(byTier['host-balanced'].internalWidth)
            .toBeGreaterThan(byTier['host-degraded'].internalWidth);
        expect(byTier['host-degraded'].internalWidth)
            .toBeGreaterThan(byTier['host-fallback'].internalWidth);

        writeEvidenceJson('dpr1-render-target.json', byTier);
    });

    test('frame timing stays within the host budget across the ladder (render-scale + fps diagnostics)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRenderSystem(hostPage);

        const fpsByTier: Record<string, any> = {};
        for (const tierName of ALL_TIERS) {
            const sample = await hostPage.evaluate(async (tier) => {
                // @ts-ignore
                const render = window.game?.systems?.render;
                render.setGradeTier(tier);
                render.resetFrameTimingSamples();
                // Render a sustained burst so the rolling window fills.
                await new Promise((resolve) => setTimeout(resolve, 1200));
                const d = render.getGradeDiagnostics();
                return {
                    resolutionScale: d.resolutionScale,
                    effectivePixelRatio: d.effectivePixelRatio,
                    internalPixels: d.renderTarget.internalWidth * d.renderTarget.internalHeight,
                    frameCount: d.frameTiming.frameCount,
                    avgMs: d.frameTiming.averageRenderDurationMs,
                    maxMs: d.frameTiming.maxRenderDurationMs
                };
            }, tierName);

            // The render loop is actually advancing (not a frozen single frame).
            expect(sample.frameCount, `${tierName} accrued frames`).toBeGreaterThan(10);
            // 60fps budget = 16.6ms/frame; a low-res host frame must clear it with
            // headroom on the GPU-accelerated local runner.
            expect(sample.avgMs, `${tierName} avg render ms under budget`).toBeLessThan(16.6);
            fpsByTier[tierName] = sample;
        }

        // Sanity: lower tiers shed internal pixels (the lever that buys fps).
        expect(fpsByTier['host-fallback'].internalPixels)
            .toBeLessThan(fpsByTier['host-native'].internalPixels);

        writeEvidenceJson('frame-timing.json', fpsByTier);
    });

    test('the upscaled fallback frame is non-blank', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRenderSystem(hostPage);

        await applyTierAndRead(hostPage, 'host-fallback');
        const variance = await canvasVariance(hostPage);
        // A blank canvas has ~0 variance; the lobby world carries real contrast.
        expect(variance, 'fallback-tier canvas luminance variance').toBeGreaterThan(5);
        writeEvidenceJson('fallback-variance.json', { variance });
    });

    test('resize recomputes the internal buffer proportionally (dpr=1)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRenderSystem(hostPage);

        await applyTierAndRead(hostPage, 'host-degraded'); // resolutionScale 0.7

        const before = (await applyTierAndRead(hostPage, 'host-degraded'))!.diagnostics.renderTarget;
        expect(before.displayWidth).toBe(1280);
        expect(before.internalWidth).toBe(Math.round(1280 * 0.7));

        await hostPage.setViewportSize({ width: 900, height: 600 });
        // Resize handler is debounced through a frame; give it a beat.
        await hostPage.waitForTimeout(300);
        const after = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.game?.systems?.render?.getGradeDiagnostics?.()?.renderTarget || null;
        });

        expect(after.displayWidth).toBe(900);
        expect(after.internalWidth).toBe(Math.round(900 * 0.7));
        // Still genuinely sub-native after resize.
        expect(after.isUpscaled).toBe(true);

        writeEvidenceJson('resize-render-target.json', { before, after });
    });
});

test.describe('P1.1 high-DPR edge case', () => {
    test('sub-native tiers stay genuinely low-res on a dpr=2 display', async ({ browser }) => {
        const context: BrowserContext = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: 2
        });
        const page = await context.newPage();
        try {
            await gotoHost(page);
            await waitForRenderSystem(page);

            const dpr = await page.evaluate(() => window.devicePixelRatio);
            expect(dpr, 'context devicePixelRatio').toBe(2);

            const byTier: Record<string, any> = {};
            for (const tierName of ALL_TIERS) {
                const result = await applyTierAndRead(page, tierName);
                byTier[tierName] = result!.diagnostics.renderTarget;
            }

            // The whole point of the fix: on dpr=2 the old code did
            // pixelRatio = dpr * scale, so scale<1 still rendered ABOVE
            // CSS-native (e.g. 2 * 0.85 = 1.7 => 2176px > 1280px) and never
            // looked low-res. Now every sub-native tier is < display width.
            for (const tierName of SUB_NATIVE_TIERS) {
                expect(byTier[tierName].internalWidth, `${tierName} internal < display @dpr2`)
                    .toBeLessThan(1280);
                expect(byTier[tierName].isUpscaled, `${tierName} isUpscaled @dpr2`).toBe(true);
            }

            // Native still supersamples up to native (2x) when there's headroom.
            expect(byTier['host-native'].internalWidth).toBe(2560);
            expect(byTier['host-native'].isUpscaled).toBe(false);

            writeEvidenceJson('dpr2-render-target.json', byTier);
        } finally {
            await context.close();
        }
    });
});
