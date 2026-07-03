import { mkdirSync } from 'node:fs';
import { test, expect, gotoHost, joinGameAsPlayer, waitForRoomCode } from './fixtures';

test.describe('Lobby as world', () => {
    test('joined cars idle visibly in the host lobby with name tags and banter', async ({ hostPage, playerPage, browser }) => {
        test.slow();
        mkdirSync('artifacts/br-skip-bin-arcade-design-language-5k3.26', { recursive: true });

        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await joinGameAsPlayer(playerPage, roomCode, 'LobbyOne');
        const secondContext = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true
        });
        const secondPage = await secondContext.newPage();

        try {
            await joinGameAsPlayer(secondPage, roomCode, 'LobbyTwo');
            await expect(hostPage.locator('#player-list')).toContainText('LobbyTwo', { timeout: 30000 });
            await expect(hostPage.locator('#lobby-banter')).toContainText('rolled into the yard', { timeout: 10000 });

            await expect.poll(async () => hostPage.evaluate(() => {
                // @ts-ignore - exposed by host bootstrap
                return window.game?.getLobbyWorldDiagnostics?.() || null;
            }), { timeout: 30000 }).toMatchObject({
                state: 'lobby',
                vehicleCount: 2,
                visibleVehicleCount: 2
            });

            await expect.poll(async () => hostPage.evaluate(() => {
                // @ts-ignore - host bootstrap exposes the overlay globally
                const snapshot = window.__vehicleIdentityOverlay?.getDebugSnapshot?.();
                return {
                    markerCount: snapshot?.markerCount || 0,
                    visibleCount: snapshot?.visibleCount || 0
                };
            }), { timeout: 30000 }).toMatchObject({
                markerCount: 2,
                visibleCount: 2
            });

            const presentation = await hostPage.evaluate(() => {
                const lobby = document.querySelector('.lobby-content');
                const canvas = document.querySelector('#game-container canvas');
                const markers = Array.from(document.querySelectorAll('.vehicle-id-marker'))
                    .filter((element) => getComputedStyle(element).display !== 'none')
                    .map((element) => element.getBoundingClientRect().toJSON());
                const lobbyRect = lobby?.getBoundingClientRect();
                const viewportWidth = window.innerWidth;
                return {
                    canvasVisible: !!canvas && getComputedStyle(canvas).display !== 'none',
                    lobbyWidthRatio: lobbyRect ? lobbyRect.width / viewportWidth : 1,
                    markerCount: markers.length,
                    markers
                };
            });

            expect(presentation.canvasVisible).toBe(true);
            expect(presentation.lobbyWidthRatio).toBeLessThan(0.62);
            expect(presentation.markerCount).toBe(2);

            await hostPage.screenshot({
                path: 'artifacts/br-skip-bin-arcade-design-language-5k3.26/lobby-as-world-2p.png',
                fullPage: true
            });
        } finally {
            await secondContext.close();
        }
    });
});
