import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { Browser, BrowserContext, Page, chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import {
    test,
    expect,
    joinGameAsPlayer,
    startGameFromHost,
    waitForRoomCode
} from './fixtures';

const ARTIFACT_DIR = path.resolve('artifacts/br-captain-call-architecture-hardening-woq.2');
const MIN_RENDER_SCREENSHOT_LENGTH = 10_000;

function ensureArtifactDir() {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function writeArtifactJson(fileName: string, payload: unknown) {
    ensureArtifactDir();
    writeFileSync(path.join(ARTIFACT_DIR, fileName), JSON.stringify(payload, null, 2));
}

function assertNonBlankPng(buffer: Buffer, label: string) {
    const png = PNG.sync.read(buffer);
    let count = 0;
    let sum = 0;
    let sumSquares = 0;
    const step = 16;

    for (let y = 0; y < png.height; y += step) {
        for (let x = 0; x < png.width; x += step) {
            const idx = (png.width * y + x) << 2;
            const alpha = png.data[idx + 3];
            if (alpha === 0) continue;
            const luma =
                (png.data[idx] * 0.2126)
                + (png.data[idx + 1] * 0.7152)
                + (png.data[idx + 2] * 0.0722);
            count += 1;
            sum += luma;
            sumSquares += luma * luma;
        }
    }

    const mean = count ? sum / count : 0;
    const variance = count ? (sumSquares / count) - (mean * mean) : 0;
    const stddev = Math.sqrt(Math.max(0, variance));

    expect(count, `${label} should have sampled visible pixels`).toBeGreaterThan(50);
    expect(stddev, `${label} should not be a flat/blank screenshot`).toBeGreaterThan(4);

    return {
        width: png.width,
        height: png.height,
        sampledPixels: count,
        lumaMean: mean,
        lumaStddev: stddev
    };
}

async function waitForRenderSystem(page: Page) {
    await page.waitForFunction(() => {
        // @ts-ignore
        return window.game?.systems?.render?.initialized === true;
    }, null, { timeout: 90_000 });
}

async function captureBackendEvidence(page: Page, label: string) {
    await page.waitForTimeout(700);
    const diagnostics = await page.evaluate(async () => {
        // @ts-ignore
        const render = window.game?.systems?.render;
        render?.resetFrameTimingSamples?.();
        await new Promise((resolve) => setTimeout(resolve, 800));
        const screenshot = render?.captureScreenshot?.() || '';
        return {
            navigatorGpu: !!navigator.gpu,
            secureContext: isSecureContext,
            renderDiagnostics: render?.getRenderDiagnostics?.() || null,
            gradeDiagnostics: render?.getGradeDiagnostics?.() || null,
            screenshotLength: screenshot.length
        };
    });

    expect(diagnostics.renderDiagnostics?.backend, `${label} backend`).toBeTruthy();
    expect(diagnostics.renderDiagnostics?.rendererType, `${label} renderer type`).toBeTruthy();
    expect(diagnostics.renderDiagnostics?.deviceLimits, `${label} device limits`).toBeTruthy();
    expect(diagnostics.gradeDiagnostics?.backend?.backendDiagnostics?.activeApi, `${label} active API`).toBeTruthy();
    expect(diagnostics.screenshotLength, `${label} render capture`).toBeGreaterThan(MIN_RENDER_SCREENSHOT_LENGTH);

    const screenshot = await page.screenshot({ fullPage: false });
    ensureArtifactDir();
    const screenshotPath = path.join(ARTIFACT_DIR, `${label}.png`);
    writeFileSync(screenshotPath, screenshot);
    const screenshotMetrics = assertNonBlankPng(screenshot, label);
    const payload = {
        label,
        screenshotPath,
        screenshotMetrics,
        visualParityNotes: 'Host scene rendered nonblank; backend diagnostics captured from the live RenderSystem.',
        ...diagnostics
    };
    writeArtifactJson(`${label}-diagnostics.json`, payload);
    return payload;
}

async function startScene(hostPage: Page, playerPage: Page, mode: 'race' | 'derby') {
    await hostPage.goto('/host?testMode=1&renderer=webgpu');
    const roomCode = await waitForRoomCode(hostPage);
    await joinGameAsPlayer(playerPage, roomCode, mode === 'race' ? 'BackendRace' : 'BackendDerby');
    await expect(hostPage.locator('#player-list')).toContainText(
        mode === 'race' ? 'BackendRace' : 'BackendDerby',
        { timeout: 30_000 }
    );

    if (mode === 'derby') {
        await hostPage.click('.mode-card[data-mode="derby"]');
        await hostPage.waitForTimeout(300);
    }

    await startGameFromHost(hostPage);
    await waitForRenderSystem(hostPage);
    await hostPage.waitForTimeout(mode === 'race' ? 1_500 : 2_500);
}

async function assertControllerDoesNotOwnWorldRenderer(playerPage: Page) {
    const controllerState = await playerPage.evaluate(() => ({
        // @ts-ignore
        hasHostWorldRender: !!window.gameHost?.systems?.render,
        // @ts-ignore
        hasGameWorldRender: !!window.game?.systems?.render,
        canvasCount: document.querySelectorAll('canvas').length,
        path: location.pathname
    }));

    expect(controllerState.hasHostWorldRender).toBe(false);
    expect(controllerState.hasGameWorldRender).toBe(false);
    return controllerState;
}

async function closeContext(context: BrowserContext | null) {
    if (context) {
        await context.close();
    }
}

test.describe('WebGPU-first renderer backend evidence', () => {
    test('race scene records backend diagnostics and keeps local player as controller only', async ({
        hostPage,
        playerPage
    }) => {
        await startScene(hostPage, playerPage, 'race');
        const raceEvidence = await captureBackendEvidence(hostPage, 'race-backend');
        const controllerState = await assertControllerDoesNotOwnWorldRenderer(playerPage);
        writeArtifactJson('race-controller-guard.json', { controllerState, raceBackend: raceEvidence.renderDiagnostics });
    });

    test('derby scene records backend diagnostics and nonblank host rendering', async ({ hostPage, playerPage }) => {
        test.slow();
        await startScene(hostPage, playerPage, 'derby');
        await captureBackendEvidence(hostPage, 'derby-backend');
    });

    test('explicit WebGPU browser attempt records native path or browser limitation', async () => {
        test.slow();
        let browser: Browser | null = null;
        let context: BrowserContext | null = null;

        try {
            browser = await chromium.launch({
                headless: true,
                args: [
                    '--enable-unsafe-webgpu',
                    '--ignore-gpu-blocklist',
                    '--enable-gpu-rasterization',
                    '--use-gl=angle',
                    '--use-angle=default'
                ]
            });
            context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
            const page = await context.newPage();
            await page.goto('http://localhost:8000/host?testMode=1&renderer=webgpu');
            await waitForRoomCode(page);
            await waitForRenderSystem(page);
            const evidence = await captureBackendEvidence(page, 'explicit-webgpu-attempt');

            const activeApi = evidence.renderDiagnostics?.activeApi;
            const limitation =
                evidence.navigatorGpu
                    ? evidence.renderDiagnostics?.fallbackReason || null
                    : 'navigator.gpu was not exposed by this Playwright Chromium run';

            writeArtifactJson('explicit-webgpu-attempt-summary.json', {
                navigatorGpu: evidence.navigatorGpu,
                secureContext: evidence.secureContext,
                activeApi,
                nativeWebGPU: evidence.renderDiagnostics?.nativeWebGPU ?? null,
                limitation,
                backend: evidence.renderDiagnostics?.backend,
                adapterInfo: evidence.renderDiagnostics?.adapterInfo,
                deviceLimits: evidence.renderDiagnostics?.deviceLimits
            });

            if (evidence.navigatorGpu && activeApi === 'webgpu') {
                expect(evidence.renderDiagnostics?.nativeWebGPU).toBe(true);
            } else {
                expect(limitation).toBeTruthy();
            }
        } finally {
            await closeContext(context);
            if (browser) {
                await browser.close();
            }
        }
    });
});
