import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { Browser, BrowserContext, Page } from '@playwright/test';
import {
    test,
    expect,
    waitForRoomCode,
    joinGameAsPlayer,
    startGameFromHost,
    gotoHost
} from './fixtures';

const EVIDENCE_DIR = process.env.GRADE_LADDER_EVIDENCE_DIR || null;
const MIN_SCREENSHOT_DATA_URL_LENGTH = 10_000;

const MOBILE_CONTEXT_OPTIONS = {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
};

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
    await page.screenshot({
        path: path.join(dir, fileName),
        fullPage: false
    });
}

async function waitForRenderSystem(hostPage: Page) {
    await hostPage.waitForFunction(() => {
        // @ts-ignore
        return window.game?.systems?.render?.initialized === true;
    }, null, { timeout: 15_000 });
}

async function applyGradeTier(hostPage: Page, tierName: string) {
    const result = await hostPage.evaluate(async (requestedTier) => {
        // @ts-ignore
        const render = window.game?.systems?.render;
        if (!render) {
            return { applied: false, diagnostics: null, screenshotLength: 0 };
        }

        const applied = render.setGradeTier(requestedTier);
        await new Promise((resolve) => setTimeout(resolve, 250));
        render.resetFrameTimingSamples?.();
        await new Promise((resolve) => setTimeout(resolve, 900));

        const screenshotDataUrl = render.captureScreenshot?.() || '';
        return {
            applied,
            diagnostics: render.getGradeDiagnostics?.() || null,
            screenshotLength: screenshotDataUrl.length
        };
    }, tierName);

    expect(result.applied, `Expected ${tierName} to apply`).toBe(true);
    expect(result.diagnostics?.activeTier).toBe(tierName);
    expect(result.diagnostics?.toneMapping?.decision).toBe('skip-aces');
    expect(result.screenshotLength, `Expected ${tierName} screenshot capture to be nonblank`).toBeGreaterThan(MIN_SCREENSHOT_DATA_URL_LENGTH);

    return result.diagnostics;
}

async function createPlayer(browser: Browser, roomCode: string, playerName: string) {
    const context = await browser.newContext(MOBILE_CONTEXT_OPTIONS);
    const page = await context.newPage();
    await joinGameAsPlayer(page, roomCode, playerName);
    return { context, page };
}

async function createExtraPlayers(browser: Browser, roomCode: string, playerNames: string[]) {
    const players: Array<{ context: BrowserContext; page: Page; playerName: string }> = [];
    for (const playerName of playerNames) {
        const player = await createPlayer(browser, roomCode, playerName);
        players.push({ ...player, playerName });
    }
    return players;
}

async function closePlayers(players: Array<{ context: BrowserContext }>) {
    for (const player of players) {
        await player.context.close();
    }
}

async function driveHostVehicleBriefly(hostPage: Page) {
    await hostPage.evaluate(() => {
        // @ts-ignore
        window.gameState._testControlsOverride = true;
        // @ts-ignore
        const game = window.game;
        const vehicle = game?.vehicles?.values?.().next?.().value;
        vehicle?.setControls?.({ acceleration: 1, braking: 0, steering: 0.22 });
    });
    await hostPage.waitForTimeout(1_500);
    await hostPage.evaluate(() => {
        // @ts-ignore
        const game = window.game;
        const vehicle = game?.vehicles?.values?.().next?.().value;
        vehicle?.setControls?.({ acceleration: 0, braking: 0, steering: 0 });
    });
}

test.describe('Host Grade Ladder', () => {
    test('lobby tiers keep stable metadata and a nonblank fallback path', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await waitForRenderSystem(hostPage);

        const availableTiers = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.game?.systems?.render?.listGradeTiers?.() || [];
        });

        expect(availableTiers.map((tier: any) => tier.tierName)).toEqual([
            'host-native',
            'host-balanced',
            'host-degraded',
            'host-fallback'
        ]);

        const diagnosticsByTier: Record<string, unknown> = {};
        const backendNames = new Set<string>();

        for (const tierName of ['host-native', 'host-balanced', 'host-degraded', 'host-fallback']) {
            const diagnostics = await applyGradeTier(hostPage, tierName);
            backendNames.add(diagnostics.backend.renderer);
            diagnosticsByTier[tierName] = diagnostics;
            await captureEvidenceShot(hostPage, `lobby-${tierName}.png`);
        }

        expect(backendNames.size).toBe(1);
        expect((diagnosticsByTier['host-fallback'] as any)?.postProcessing?.enabled).toBe(false);
        expect((diagnosticsByTier['host-native'] as any)?.postProcessing?.enabled).toBe(true);

        writeEvidenceJson('lobby-grade-diagnostics.json', diagnosticsByTier);
    });

    test('race tiers capture native, degraded, and fallback host scenes', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'GradeRace');
        await expect(hostPage.locator('#player-list')).toContainText('GradeRace', { timeout: 30_000 });
        await startGameFromHost(hostPage);
        await hostPage.waitForTimeout(2_500);
        await driveHostVehicleBriefly(hostPage);

        const diagnosticsByTier: Record<string, unknown> = {};

        for (const tierName of ['host-native', 'host-degraded', 'host-fallback']) {
            const diagnostics = await applyGradeTier(hostPage, tierName);
            diagnosticsByTier[tierName] = diagnostics;
            await captureEvidenceShot(hostPage, `race-${tierName}.png`);
        }

        expect((diagnosticsByTier['host-native'] as any)?.trackedVehicles).toBeGreaterThanOrEqual(1);
        expect((diagnosticsByTier['host-degraded'] as any)?.resolutionScale).toBeLessThan(
            (diagnosticsByTier['host-native'] as any)?.resolutionScale
        );

        writeEvidenceJson('race-grade-diagnostics.json', diagnosticsByTier);
    });

    test('derby and crowded-host scenes capture the ladder without blanking the canvas', async ({
        hostPage,
        playerPage,
        browser
    }) => {
        test.slow();

        const extraPlayers: Array<{ context: BrowserContext; page: Page; playerName: string }> = [];

        try {
            await gotoHost(hostPage);
            const roomCode = await waitForRoomCode(hostPage);
            await joinGameAsPlayer(playerPage, roomCode, 'DerbyLead');
            await expect(hostPage.locator('#player-list')).toContainText('DerbyLead', { timeout: 30_000 });

            const joinedPlayers = await createExtraPlayers(browser, roomCode, [
                'Seat02',
                'Seat03',
                'Seat04',
                'Seat05',
                'Seat06'
            ]);
            extraPlayers.push(...joinedPlayers);

            for (const player of joinedPlayers) {
                await expect(hostPage.locator('#player-list')).toContainText(player.playerName, { timeout: 30_000 });
            }

            await captureEvidenceShot(hostPage, 'lobby-high-player-host-native.png');

            await hostPage.click('.mode-card[data-mode="derby"]');
            await hostPage.waitForTimeout(300);
            await hostPage.click('#start-game-btn');
            await hostPage.waitForTimeout(4_000);

            const derbyDiagnostics = await applyGradeTier(hostPage, 'host-native');
            await captureEvidenceShot(hostPage, 'derby-host-native.png');
            const derbyFallbackDiagnostics = await applyGradeTier(hostPage, 'host-fallback');
            await captureEvidenceShot(hostPage, 'derby-host-fallback.png');
            const crowdedDiagnostics = await applyGradeTier(hostPage, 'host-degraded');
            await captureEvidenceShot(hostPage, 'derby-high-player-host-degraded.png');

            expect(derbyDiagnostics.trackedVehicles).toBeGreaterThanOrEqual(1);
            expect(crowdedDiagnostics.trackedVehicles).toBeGreaterThanOrEqual(6);
            expect(derbyFallbackDiagnostics.postProcessing.enabled).toBe(false);

            writeEvidenceJson('derby-high-player-diagnostics.json', {
                derbyNative: derbyDiagnostics,
                derbyFallback: derbyFallbackDiagnostics,
                crowdedHostDegraded: crowdedDiagnostics
            });
        } finally {
            await closePlayers(extraPlayers);
        }
    });
});
