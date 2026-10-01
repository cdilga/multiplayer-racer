import { test, expect, gotoHost, joinGameAsPlayer, startGameFromHost, waitForRoomCode } from './fixtures';

test.describe('Voronoi Party camera', () => {
    test('splits into angled cells and fuses back into one view when friends regroup', async ({
        hostPage,
        playerPage,
        browser
    }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);
        await joinGameAsPlayer(playerPage, roomCode, 'Brick One');

        const extraContexts = [];
        for (const name of ['Brick Two', 'Brick Three', 'Brick Four']) {
            const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
            const page = await context.newPage();
            await joinGameAsPlayer(page, roomCode, name);
            extraContexts.push(context);
        }

        try {
            await startGameFromHost(hostPage);
            await hostPage.locator('[data-camera-mode="party"]').click();

            const separated = await hostPage.evaluate(async () => {
                // @ts-ignore - host bootstrap exposes the game in test mode
                const game = window.game;
                const anchors = [
                    { x: -55, y: 3, z: -35 },
                    { x: 48, y: 3, z: -20 },
                    { x: -25, y: 3, z: 52 },
                    { x: 58, y: 3, z: 44 }
                ];
                [...game.vehicles.values()].forEach((vehicle, index) => {
                    const position = anchors[index];
                    vehicle.physicsBody?.setTranslation(position, true);
                    vehicle.physicsBody?.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    vehicle.mesh.position.set(position.x, position.y, position.z);
                    Object.assign(vehicle.position, position);
                });

                const render = game.systems.render;
                render.render(0.016, 0);
                await new Promise((resolve) => setTimeout(resolve, 650));
                render.render(0.016, 0);

                return {
                    info: render.getCameraModeInfo(),
                    diagnostics: render.getDiagnostics().viewportTiling,
                    cellCount: document.querySelectorAll('[data-camera-voronoi-cell]').length,
                    polygonPointCounts: Array.from(document.querySelectorAll('[data-camera-voronoi-cell]'))
                        .map((cell) => (cell.getAttribute('points') || '').trim().split(/\s+/).length),
                    tiledClass: document.body.classList.contains('camera-mode-tiled')
                };
            });

            expect(separated.info).toMatchObject({ mode: 'party', tilingMode: 'voronoi' });
            expect(separated.diagnostics).toMatchObject({
                mode: 'voronoi',
                viewportCount: 4,
                cluster: { droppedCarIds: [] },
                voronoi: { active: true, cellCount: 4 }
            });
            expect(separated.cellCount).toBe(4);
            expect(separated.polygonPointCounts.every((count) => count >= 3)).toBe(true);
            expect(separated.tiledClass).toBe(true);

            const regrouped = await hostPage.evaluate(async () => {
                // @ts-ignore
                const game = window.game;
                [...game.vehicles.values()].forEach((vehicle, index) => {
                    const position = { x: index * 3, y: 3, z: index % 2 };
                    vehicle.physicsBody?.setTranslation(position, true);
                    vehicle.physicsBody?.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    vehicle.mesh.position.set(position.x, position.y, position.z);
                    Object.assign(vehicle.position, position);
                });

                const render = game.systems.render;
                render.render(0.016, 0);
                await new Promise((resolve) => setTimeout(resolve, 650));
                render.render(0.016, 0);

                return {
                    diagnostics: render.getDiagnostics().viewportTiling,
                    cellCount: document.querySelectorAll('[data-camera-voronoi-cell]').length,
                    tiledClass: document.body.classList.contains('camera-mode-tiled')
                };
            });

            expect(regrouped.diagnostics).toMatchObject({
                mode: 'voronoi',
                viewportCount: 1,
                cluster: { finalClusterCount: 1, droppedCarIds: [] },
                voronoi: { active: false, cellCount: 1 }
            });
            expect(regrouped.cellCount).toBe(0);
            expect(regrouped.tiledClass).toBe(false);
        } finally {
            for (const context of extraContexts) await context.close();
        }
    });
});
