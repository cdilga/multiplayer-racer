import { test, expect, gotoHost, joinGameAsPlayer, startGameFromHost, waitForRoomCode } from './fixtures';

async function joinExtraPlayers(browser, roomCode: string, names: string[]) {
    const contexts: Array<{ context: any; page: any; name: string }> = [];

    for (const name of names) {
        const context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const page = await context.newPage();
        await joinGameAsPlayer(page, roomCode, name);
        contexts.push({ context, page, name });
    }

    return contexts;
}

test.describe('Host camera modes', () => {
    test('can switch into multi-camera views from the host controls', async ({ hostPage, playerPage, browser }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await joinGameAsPlayer(playerPage, roomCode, 'CameraRacer');
        await expect(hostPage.locator('#player-list')).toContainText('CameraRacer', { timeout: 30000 });
        const extraPlayers = await joinExtraPlayers(browser, roomCode, ['WingOne', 'WingTwo', 'WingThree']);
        await expect(hostPage.locator('#player-list')).toContainText('WingThree', { timeout: 30000 });
        await expect(hostPage.locator('#camera-controls')).toBeVisible({ timeout: 10000 });

        try {
            await startGameFromHost(hostPage);
            await hostPage.waitForTimeout(800);

            await expect.poll(async () => hostPage.evaluate(() => {
                // @ts-ignore - host bootstrap exposes the overlay globally
                return window.__vehicleIdentityOverlay?.getDebugSnapshot()?.markerCount || 0;
            })).toBe(4);

            await hostPage.locator('[data-camera-mode="party"]').click();
            await expect(hostPage.locator('[data-camera-mode="party"]')).toHaveClass(/active/);
            await expect(hostPage.locator('[data-camera-focus-controls]')).toBeHidden();

            const partyState = await hostPage.evaluate(() => {
                // @ts-ignore - game is exposed by the host bootstrap
                const render = window.game.systems.render;
                render.render(0.016, 0);
                return {
                    info: render.getCameraModeInfo(),
                    diagnostics: render.getDiagnostics().viewportTiling,
                    savedMode: localStorage.getItem('jj_camera_mode'),
                    frameCount: document.querySelectorAll('[data-camera-viewport-frame]').length,
                    tiledBodyClass: document.body.classList.contains('camera-mode-tiled'),
                    visibleIdentityMarkerCount: Array.from(document.querySelectorAll('.vehicle-id-marker'))
                        .filter((marker) => getComputedStyle(marker).display !== 'none').length
                };
            });
            expect(partyState.info).toMatchObject({
                mode: 'party',
                tiled: true,
                tilingMode: 'voronoi'
            });
            expect(partyState.diagnostics).toMatchObject({
                enabled: true,
                mode: 'voronoi',
                viewportCount: 1,
                cluster: { droppedCarIds: [] },
                voronoi: { active: false, cellCount: 1 }
            });
            expect(partyState.frameCount).toBe(0);
            expect(partyState.savedMode).toBe('party');
            expect(partyState.tiledBodyClass).toBe(false);
            expect(partyState.visibleIdentityMarkerCount).toBeGreaterThanOrEqual(3);

            await hostPage.locator('[data-camera-mode="grid"]').click();
            await expect(hostPage.locator('[data-camera-mode="grid"]')).toHaveClass(/active/);

            const gridState = await hostPage.evaluate(() => {
                // @ts-ignore - game is exposed by the host bootstrap
                const render = window.game.systems.render;
                render.render(0.016, 0);
                return {
                    info: render.getCameraModeInfo(),
                    diagnostics: render.getDiagnostics().viewportTiling,
                    frameCount: document.querySelectorAll('[data-camera-viewport-frame]').length
                };
            });
            expect(gridState.info).toMatchObject({ mode: 'grid', tiled: true, tilingMode: 'grid' });
            expect(gridState.diagnostics).toMatchObject({ enabled: true, mode: 'grid' });
            expect(gridState.diagnostics.viewportCount).toBe(4);
            expect(gridState.frameCount).toBe(4);

            await hostPage.locator('[data-camera-mode="chase"]').click();
            await expect(hostPage.locator('[data-camera-mode="chase"]')).toHaveClass(/active/);
            await expect(hostPage.locator('[data-camera-focus-controls]')).toBeVisible();
            await expect(hostPage.locator('#camera-focus-label')).toContainText('CameraRacer');

            const chaseState = await hostPage.evaluate(async () => {
                await new Promise(resolve => setTimeout(resolve, 350));
                // @ts-ignore - game is exposed by the host bootstrap
                const render = window.game.systems.render;
                // @ts-ignore - overlay bootstrap stores a debug helper globally
                const overlay = window.__vehicleIdentityOverlay;
                const snapshot = overlay?.getDebugSnapshot?.() || null;
                const preferred = snapshot?.markers?.find((marker) => marker.preferred);
                return {
                    mode: render.getCameraModeInfo().mode,
                    focusName: render.getCameraModeInfo().focusName,
                    fov: render.camera.fov,
                    cameraY: render.camera.position.y,
                    preferredId: preferred?.playerId || null,
                    visibleMarkers: snapshot?.visibleCount || 0
                };
            });

            expect(chaseState).toMatchObject({
                mode: 'chase',
                focusName: 'CameraRacer',
                preferredId: '1'
            });
            expect(await hostPage.evaluate(() => {
                // @ts-ignore
                return window.game.systems.render.getDiagnostics().viewportTiling.enabled;
            })).toBe(false);
            expect(chaseState.visibleMarkers).toBeGreaterThanOrEqual(3);
            expect(chaseState.cameraY).toBeLessThan(15);
            await hostPage.screenshot({ path: 'test-results/visual/own-car-chase-focus.png' });

            await hostPage.locator('[data-camera-mode="hood"]').click();
            await expect(hostPage.locator('[data-camera-mode="hood"]')).toHaveClass(/active/);

            const hoodState = await hostPage.evaluate(async () => {
                await new Promise(resolve => setTimeout(resolve, 350));
                // @ts-ignore - game is exposed by the host bootstrap
                const render = window.game.systems.render;
                // @ts-ignore
                const overlay = window.__vehicleIdentityOverlay;
                const snapshot = overlay?.getDebugSnapshot?.() || null;
                const preferred = snapshot?.markers?.find((marker) => marker.preferred);
                return {
                    mode: render.getCameraModeInfo().mode,
                    fov: render.camera.fov,
                    cameraY: render.camera.position.y,
                    preferredId: preferred?.playerId || null
                };
            });

            expect(hoodState.mode).toBe('hood');
            expect(hoodState.preferredId).toBe('1');
            expect(hoodState.fov).toBeGreaterThan(55);
            expect(hoodState.cameraY).toBeLessThan(chaseState.cameraY);

            await hostPage.locator('[data-camera-mode="party"]').click();
            await expect(hostPage.locator('[data-camera-mode="party"]')).toHaveClass(/active/);
            await expect.poll(async () => hostPage.evaluate(() => {
                // @ts-ignore - game is exposed by the host bootstrap
                return window.game.systems.render.getCameraModeInfo().mode;
            })).toBe('party');
        } finally {
            for (const extraPlayer of extraPlayers) {
                await extraPlayer.context.close();
            }
        }
    });

    test('restores a saved multi-camera mode when the host reloads', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            return window.game?.systems?.render?.initialized;
        });

        await hostPage.evaluate(() => localStorage.setItem('jj_camera_mode', 'split'));

        await hostPage.reload();
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            return window.game?.systems?.render?.initialized;
        });
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            return window.game?.systems?.render?.getCameraModeInfo?.().mode === 'party';
        });

        const restored = await hostPage.evaluate(() => {
            // @ts-ignore
            return window.game.systems.render.getCameraModeInfo();
        });
        expect(restored).toMatchObject({ mode: 'party', tiled: true, tilingMode: 'voronoi' });
        await expect.poll(() => hostPage.evaluate(() => localStorage.getItem('jj_camera_mode'))).toBe('party');
    });
});
