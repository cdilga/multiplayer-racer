import { test, expect, gotoHost, joinGameAsPlayer, startGameFromHost, waitForRoomCode } from './fixtures';

test.describe('Host camera modes', () => {
    test('can switch between party, chase, and hood views from the host controls', async ({ hostPage, playerPage }) => {
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await joinGameAsPlayer(playerPage, roomCode, 'CameraRacer');
        await expect(hostPage.locator('#player-list')).toContainText('CameraRacer', { timeout: 30000 });
        await expect(hostPage.locator('#camera-controls')).toBeVisible({ timeout: 10000 });

        await startGameFromHost(hostPage);
        await hostPage.waitForTimeout(500);

        await hostPage.locator('[data-camera-mode="chase"]').click();
        await expect(hostPage.locator('[data-camera-mode="chase"]')).toHaveClass(/active/);
        await expect(hostPage.locator('#camera-focus-label')).toContainText('CameraRacer');

        const chaseState = await hostPage.evaluate(async () => {
            await new Promise(resolve => setTimeout(resolve, 350));
            // @ts-ignore - game is exposed by the host bootstrap
            const render = window.game.systems.render;
            return {
                mode: render.getCameraModeInfo().mode,
                focusName: render.getCameraModeInfo().focusName,
                fov: render.camera.fov,
                cameraY: render.camera.position.y
            };
        });

        expect(chaseState).toMatchObject({
            mode: 'chase',
            focusName: 'CameraRacer'
        });
        expect(chaseState.cameraY).toBeLessThan(15);

        await hostPage.locator('[data-camera-mode="hood"]').click();
        await expect(hostPage.locator('[data-camera-mode="hood"]')).toHaveClass(/active/);

        const hoodState = await hostPage.evaluate(async () => {
            await new Promise(resolve => setTimeout(resolve, 350));
            // @ts-ignore - game is exposed by the host bootstrap
            const render = window.game.systems.render;
            return {
                mode: render.getCameraModeInfo().mode,
                fov: render.camera.fov,
                cameraY: render.camera.position.y
            };
        });

        expect(hoodState.mode).toBe('hood');
        expect(hoodState.fov).toBeGreaterThan(55);
        expect(hoodState.cameraY).toBeLessThan(chaseState.cameraY);

        await hostPage.locator('[data-camera-mode="party"]').click();
        await expect(hostPage.locator('[data-camera-mode="party"]')).toHaveClass(/active/);
        await expect.poll(async () => hostPage.evaluate(() => {
            // @ts-ignore - game is exposed by the host bootstrap
            return window.game.systems.render.getCameraModeInfo().mode;
        })).toBe('party');
    });
});
