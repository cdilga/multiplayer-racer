import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.join(process.cwd(), 'artifacts/br-skip-bin-arcade-design-language-5k3.29');

function ensureArtifactDir() {
    fs.mkdirSync(artifactDir, { recursive: true });
}

async function writeDiagnostics(name: string, payload: unknown) {
    ensureArtifactDir();
    fs.writeFileSync(
        path.join(artifactDir, name),
        JSON.stringify(payload, null, 2)
    );
}

function hostUrl(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({
        testMode: '1',
        ...overrides
    });
    return `/host?${params.toString()}`;
}

async function waitForHostRoomCode(hostPage: Page) {
    await hostPage.waitForFunction(() => {
        const text = document.getElementById('room-code-display')?.textContent || '';
        return text.length === 4 && !text.includes('-');
    }, { timeout: 15000 });

    return (await hostPage.locator('#room-code-display').textContent()) || '';
}

test.describe('Host Loading Overlay', () => {
    test('slow init shows in-language progress and then auto-hides within a bound', async ({ hostPage }) => {
        test.slow();
        ensureArtifactDir();

        await hostPage.goto(hostUrl({
            loadingOverlayShowDelayMs: '0',
            loadingOverlayTimeoutMs: '8000',
            testInitDelayMs: '1200',
            testInitDelayAt: 'before-rapier'
        }));

        const loadingOverlay = hostPage.locator('#loading-overlay');
        await expect(loadingOverlay).toBeVisible({ timeout: 5000 });
        await expect(hostPage.locator('.loading-title')).toHaveText('Camcorder warming', { timeout: 5000 });
        await expect(hostPage.locator('#loading-text')).toContainText('physics tape', { timeout: 5000 });
        await expect(hostPage.locator('#loading-step')).toHaveText('Step 2 of 5', { timeout: 5000 });
        await expect(hostPage.locator('.loading-rig')).toBeVisible();
        await expect(hostPage.locator('.loading-car')).toHaveCount(2);
        await hostPage.screenshot({
            path: path.join(artifactDir, 'loading-overlay-visible.png'),
            fullPage: true
        });

        const startedAt = Date.now();
        const roomCode = await waitForHostRoomCode(hostPage);
        expect(roomCode).toHaveLength(4);
        expect(Date.now() - startedAt).toBeLessThan(15000);

        await expect(loadingOverlay).toBeHidden({ timeout: 5000 });
        await expect(hostPage.locator('#error-overlay')).toBeHidden();

        const normalState = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.__hostLoadingOverlay;
        });
        expect(normalState.wasShown).toBe(true);
        expect(normalState.completed).toBe(true);
        expect(normalState.timedOut).toBe(false);
        expect(normalState.lastText).toContain('Rolling to the lobby');
        expect(normalState.loadingStepNumber).toBe(5);
        await writeDiagnostics('loading-overlay-normal.json', {
            roomCode,
            elapsedMs: Date.now() - startedAt,
            state: normalState
        });
    });

    test('reduced motion keeps the in-language state static', async ({ hostPage }) => {
        ensureArtifactDir();
        await hostPage.emulateMedia({ reducedMotion: 'reduce' });

        await hostPage.goto(hostUrl({
            loadingOverlayShowDelayMs: '0',
            loadingOverlayTimeoutMs: '8000',
            testInitDelayMs: '1200',
            testInitDelayAt: 'before-rapier'
        }));

        const loadingOverlay = hostPage.locator('#loading-overlay');
        await expect(loadingOverlay).toBeVisible({ timeout: 5000 });
        await expect(hostPage.locator('.loading-title')).toHaveText('Camcorder warming');
        await expect(hostPage.locator('#loading-text')).toContainText('physics tape');

        const motionState = await hostPage.evaluate(() => {
            const car = document.querySelector('.loading-car');
            const track = document.querySelector('.loading-track');
            return {
                carAnimation: car ? getComputedStyle(car).animationName : '',
                trackAnimation: track ? getComputedStyle(track).animationName : ''
            };
        });
        expect(motionState.carAnimation).toBe('none');
        expect(motionState.trackAnimation).toBe('none');
        await hostPage.screenshot({
            path: path.join(artifactDir, 'loading-overlay-reduced-motion.png'),
            fullPage: true
        });
        await writeDiagnostics('loading-overlay-reduced-motion.json', motionState);
    });

    test('keyboard skip dismisses the overlay while init continues', async ({ hostPage }) => {
        await hostPage.goto(hostUrl({
            loadingOverlayShowDelayMs: '0',
            loadingOverlayTimeoutMs: '8000',
            testInitDelayMs: '2500',
            testInitDelayAt: 'before-rapier'
        }));

        const loadingOverlay = hostPage.locator('#loading-overlay');
        const skipButton = hostPage.locator('#loading-skip-btn');
        await expect(skipButton).toBeVisible({ timeout: 5000 });
        await skipButton.focus();
        await expect(skipButton).toBeFocused();
        await hostPage.keyboard.press('Enter');
        await expect(loadingOverlay).toBeHidden({ timeout: 5000 });

        const skippedRoomCode = await waitForHostRoomCode(hostPage);
        expect(skippedRoomCode).toHaveLength(4);

        const skippedState = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.__hostLoadingOverlay;
        });
        expect(skippedState.dismissed).toBe(true);
        expect(skippedState.completed).toBe(true);
        expect(skippedState.errorVisible).toBe(false);
    });

    test('stalled init swaps the spinner for a retryable error state', async ({ hostPage }) => {
        await hostPage.goto(hostUrl({
            loadingOverlayShowDelayMs: '0',
            loadingOverlayTimeoutMs: '600',
            testInitStallAt: 'before-rapier'
        }));

        const loadingOverlay = hostPage.locator('#loading-overlay');
        await expect(loadingOverlay).toBeVisible({ timeout: 5000 });

        const errorOverlay = hostPage.locator('#error-overlay');
        await expect(errorOverlay).toBeVisible({ timeout: 5000 });
        await expect(loadingOverlay).toBeHidden({ timeout: 5000 });
        await expect(hostPage.locator('#error-title')).toHaveText('Still starting up');
        await expect(hostPage.locator('#error-message')).toContainText('taking longer than expected');

        const retryButton = hostPage.locator('#error-retry-btn');
        await retryButton.focus();
        await expect(retryButton).toBeFocused();

        const stalledState = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.__hostLoadingOverlay;
        });
        expect(stalledState.timedOut).toBe(true);
        expect(stalledState.errorVisible).toBe(true);
    });
});
