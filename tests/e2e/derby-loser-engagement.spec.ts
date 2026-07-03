import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, gotoHost } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.36');

async function waitForHostReadyAndClearWarmup(hostPage) {
    await hostPage.waitForFunction(() => {
        const loading = (window as any).__hostLoadingOverlay;
        return loading?.completed === true && loading?.loadingVisible === false;
    }, null, { timeout: 30000 });

    await hostPage.evaluate(() => {
        document.getElementById('loading-overlay')?.classList.add('hidden');
        document.getElementById('error-overlay')?.classList.add('hidden');
    });

    await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();
}

async function installRaceHarness(hostPage) {
    await waitForHostReadyAndClearWarmup(hostPage);
    await hostPage.waitForFunction(() => !!(window as any).RaceUI, null, { timeout: 30000 });
    await hostPage.evaluate(() => {
        const selectorsToHide = [
            '.lobby-ui',
            '.lobby-panel',
            '#lobby-ui',
            '#room-code-display',
            '#qr-code',
            '#qr-code-container',
            '.qr-code',
            '.mode-selection',
            '.mode-card',
            '.track-selector',
            '.laps-selector',
            '#start-game-btn',
            '.visual-settings-panel',
            '#loading-overlay',
            '#error-overlay'
        ];
        const hiddenSelectors = [];
        for (const selector of selectorsToHide) {
            for (const element of document.querySelectorAll(selector)) {
                (element as HTMLElement).style.display = 'none';
                (element as HTMLElement).classList.add('hidden');
                hiddenSelectors.push(selector);
            }
        }
        (window as any).__derbyLoserEngagementHiddenChrome = hiddenSelectors;

        document.querySelector('#derby-loser-engagement-test-container')?.remove();
        const container = document.createElement('div');
        container.id = 'derby-loser-engagement-test-container';
        document.body.appendChild(container);
        const ui = new (window as any).RaceUI({
            container,
            loserEngagementDurationMs: 1200
        });
        ui.eventBus = null;
        ui.init();
        ui.setMode('derby');
        ui.show();
        ui.updateHealthBars([
            { id: 'Ada', name: 'Ada', color: '#5CFF6A', health: 100, maxHealth: 100 },
            { id: 'Grace', name: 'Grace', color: '#FFD23E', health: 72, maxHealth: 100 },
            { id: 'Linus', name: 'Linus', color: '#FF3B3B', health: 0, maxHealth: 100 }
        ]);
        ui.showLoserEngagement({
            eliminatedPlayerId: 'Linus',
            targetPlayerId: 'Ada',
            pressureType: 'arena-shrink-started'
        });
        (window as any).__derbyLoserEngagementUI = ui;
    });
}

async function getLayoutDiagnostics(hostPage) {
    return hostPage.locator('#derby-loser-engagement-test-container .race-ui').evaluate((root) => {
        const banner = root.querySelector('.loser-engagement-banner') as HTMLElement;
        const hudTop = root.querySelector('.hud-top') as HTMLElement;
        const health = root.querySelector('.hud-health-bars') as HTMLElement;
        const speed = root.querySelector('.hud-bottom') as HTMLElement;
        const cameraControls = document.querySelector('#camera-controls') as HTMLElement | null;
        const fullscreen = document.querySelector('#fullscreen-btn') as HTMLElement | null;
        const lobbySelectors = [
            '.lobby-ui',
            '.lobby-panel',
            '#lobby-ui',
            '#room-code-display',
            '#qr-code',
            '#qr-code-container',
            '.qr-code',
            '.mode-selection',
            '.mode-card',
            '.track-selector',
            '.laps-selector',
            '#start-game-btn',
            '.visual-settings-panel'
        ];
        const box = (element: HTMLElement | null) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height,
                visible: rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none'
            };
        };
        const overlaps = (a, b) => {
            if (!a || !b || !a.visible || !b.visible) return false;
            return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        };
        const bannerBox = box(banner);
        const hudTopBox = box(hudTop);
        const healthBox = box(health);
        const speedBox = box(speed);
        const cameraBox = box(cameraControls);
        const fullscreenBox = box(fullscreen);
        const isVisible = (element: Element) => {
            const html = element as HTMLElement;
            const rect = html.getBoundingClientRect();
            const style = getComputedStyle(html);
            return rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) !== 0;
        };
        const visibleLobbyChrome = lobbySelectors.flatMap((selector) => {
            return [...document.querySelectorAll(selector)]
                .filter(isVisible)
                .map(() => selector);
        });
        const canvas = document.querySelector('canvas') as HTMLElement | null;
        const canvasBox = box(canvas);
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            state: (window as any).__derbyLoserEngagementUI.getLoserEngagementDiagnostics(),
            boxes: {
                banner: bannerBox,
                hudTop: hudTopBox,
                health: healthBox,
                speed: speedBox,
                cameraControls: cameraBox,
                fullscreen: fullscreenBox,
                canvas: canvasBox
            },
            hiddenChromeCount: ((window as any).__derbyLoserEngagementHiddenChrome || []).length,
            visibleLobbyChrome,
            canvasVisible: !!canvasBox?.visible,
            bannerInsideViewport:
                bannerBox.top >= 0 &&
                bannerBox.left >= 0 &&
                bannerBox.right <= window.innerWidth &&
                bannerBox.bottom <= window.innerHeight,
            overlaps: {
                hudTop: overlaps(bannerBox, hudTopBox),
                health: overlaps(bannerBox, healthBox),
                speed: overlaps(bannerBox, speedBox),
                cameraControls: overlaps(bannerBox, cameraBox),
                fullscreen: overlaps(bannerBox, fullscreenBox)
            },
            styles: {
                bannerDisplay: getComputedStyle(banner).display,
                bannerPosition: getComputedStyle(banner).position,
                pointerEvents: getComputedStyle(root).pointerEvents,
                boxShadow: getComputedStyle(banner).boxShadow
            },
            loadingOverlayVisible: !!document.querySelector('#loading-overlay:not(.hidden)')
        };
    });
}

test.describe('5k3.36 derby loser engagement', () => {
    test('host-only banner is short, non-modal, and clear of core HUD at 1280x720', async ({ hostPage }) => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        await hostPage.setViewportSize({ width: 1280, height: 720 });
        await gotoHost(hostPage);
        await installRaceHarness(hostPage);

        const harness = hostPage.locator('#derby-loser-engagement-test-container');
        await expect(harness.locator('.loser-engagement-banner')).toBeVisible();
        await expect(harness.locator('#loser-engagement-player')).toHaveText('Linus is out');
        await expect(harness.locator('#loser-engagement-target')).toHaveText('Ada is target');
        await expect(harness.locator('#loser-engagement-pressure')).toHaveText('Arena pressure active');
        await expect(hostPage.locator('#loading-overlay')).not.toBeVisible();
        await expect(hostPage.locator('#room-code-display')).not.toBeVisible();
        await expect(hostPage.locator('#qr-code, #qr-code-container, .qr-code')).not.toBeVisible();
        await expect.poll(async () => hostPage.locator('.mode-selection, .mode-card').evaluateAll((elements) => {
            return elements.filter((element) => {
                const html = element as HTMLElement;
                const rect = html.getBoundingClientRect();
                const style = getComputedStyle(html);
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden';
            }).length;
        })).toBe(0);

        const diagnostics = await getLayoutDiagnostics(hostPage);
        expect(diagnostics.viewport).toEqual({ width: 1280, height: 720 });
        expect(diagnostics.state).toMatchObject({
            active: true,
            completed: false,
            hidden: false,
            visible: true,
            eliminatedPlayerId: 'Linus',
            targetPlayerId: 'Ada',
            pressureType: 'arena-shrink-started',
            durationMs: 1200
        });
        expect(diagnostics.bannerInsideViewport).toBe(true);
        expect(diagnostics.visibleLobbyChrome).toEqual([]);
        expect(diagnostics.hiddenChromeCount).toBeGreaterThan(0);
        expect(diagnostics.canvasVisible).toBe(true);
        expect(diagnostics.overlaps.hudTop).toBe(false);
        expect(diagnostics.overlaps.health).toBe(false);
        expect(diagnostics.overlaps.speed).toBe(false);
        expect(diagnostics.overlaps.cameraControls).toBe(false);
        expect(diagnostics.overlaps.fullscreen).toBe(false);
        expect(diagnostics.styles.bannerPosition).toBe('absolute');
        expect(diagnostics.styles.pointerEvents).toBe('none');
        expect(diagnostics.styles.boxShadow).not.toBe('none');
        expect(diagnostics.loadingOverlayVisible).toBe(false);

        await hostPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'derby-loser-engagement-banner.png'),
            fullPage: true
        });
        writeFileSync(
            resolve(ARTIFACT_DIR, 'derby-loser-engagement-diagnostics.json'),
            JSON.stringify(diagnostics, null, 2)
        );

        await expect.poll(async () => hostPage.evaluate(() => {
            return (window as any).__derbyLoserEngagementUI.getLoserEngagementDiagnostics();
        }), { timeout: 3000 }).toMatchObject({
            active: false,
            completed: true,
            hidden: true,
            visible: true
        });
    });
});
