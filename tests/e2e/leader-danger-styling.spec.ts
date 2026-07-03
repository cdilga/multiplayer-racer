import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, gotoHost } from './fixtures';

/**
 * br-skip-bin-arcade-design-language-5k3.14 — P2.4 "Leader marker + danger styling".
 *
 * Runtime (built-bundle) proof for the three acceptance items, with screenshots:
 *  1. Leader marker unmistakable  -> host overlay tags racePosition===1 `is-leader`.
 *  2. Shrinking-arena wall DANGER -> DerbySystem warning colour resolves to #FF2E2E.
 *  3. Low-health pulse            -> HUD health bar of a near-dead car reads tier-low.
 *
 * All assertions run on the host page only, preserving the host-renderer /
 * controller role split (players never render the world).
 */
test.describe('5k3.14 leader marker + danger styling (runtime)', () => {
    test('leader marker + low-health tier render on the host', async ({ hostPage, playerPage, browser }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await joinGameAsPlayer(playerPage, roomCode, 'LeadOne');
        const ctx2 = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
        const page2 = await ctx2.newPage();
        await joinGameAsPlayer(page2, roomCode, 'LeadTwo');

        try {
            await expect(hostPage.locator('#player-list')).toContainText('LeadTwo', { timeout: 30000 });
            await startGameFromHost(hostPage);
            await hostPage.waitForTimeout(900);

            await expect.poll(async () => hostPage.evaluate(() => {
                // @ts-ignore
                return window.__vehicleIdentityOverlay?.getDebugSnapshot()?.markerCount || 0;
            })).toBeGreaterThanOrEqual(2);

            // Force a deterministic race order: player 1 leads.
            await hostPage.evaluate(() => {
                // @ts-ignore
                const game = window.game;
                const vehicles = Array.from(game.vehicles.values());
                vehicles.forEach((v: any, i: number) => { v.racePosition = i + 1; });
                // @ts-ignore
                window.__vehicleIdentityOverlay?.update?.();
            });

            // exactly one unmistakable leader marker
            await expect.poll(async () => hostPage.evaluate(() => {
                // @ts-ignore
                const markers = window.__vehicleIdentityOverlay?.getDebugSnapshot?.()?.markers || [];
                return markers.filter((m: any) => m.leader).length;
            }), { timeout: 8000 }).toBe(1);
            const leaderState = await hostPage.evaluate(() => {
                // @ts-ignore
                const markers = window.__vehicleIdentityOverlay?.getDebugSnapshot?.()?.markers || [];
                return { leaderCount: markers.filter((m: any) => m.leader).length, total: markers.length };
            });
            await hostPage.screenshot({ path: 'test-results/visual/5k3.14-leader-marker.png' });

            // Drive one car to low health; the per-frame HUD loop reads
            // vehicle.health, so it must mark that bar tier-low and pulse it.
            await hostPage.evaluate(() => {
                // @ts-ignore
                const game = window.game;
                const target = game.vehicles.get(1) || Array.from(game.vehicles.values())[0];
                target.health = 15;            // 15/100 => 15% => tier-low (<=25)
                target.maxHealth = 100;
            });
            await expect.poll(async () => hostPage.evaluate(() => {
                return !!document.querySelector('.health-bar-item.tier-low');
            }), { timeout: 8000 }).toBe(true);

            const lowHealth = await hostPage.evaluate(() => {
                const lit = document.querySelector('.health-bar-item.tier-low .health-seg.is-lit');
                const anim = lit ? getComputedStyle(lit).animationName : 'none';
                return { tierLow: true, animationName: anim };
            });
            // the low-health pulse animation is actually applied to lit segments
            expect(lowHealth.animationName).toContain('health-low-pulse');
            await hostPage.screenshot({ path: 'test-results/visual/5k3.14-low-health.png' });

            // eslint-disable-next-line no-console
            console.log('[5k3.14] leaderState=' + JSON.stringify(leaderState) + ' lowHealth=' + JSON.stringify(lowHealth));
        } finally {
            await ctx2.close();
        }
    });

    test('derby shrinking wall resolves the DANGER-red warning colour', async ({ hostPage, playerPage, browser }) => {
        test.slow();
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        await joinGameAsPlayer(playerPage, roomCode, 'DangerOne');
        const ctx2 = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
        const page2 = await ctx2.newPage();
        await joinGameAsPlayer(page2, roomCode, 'DangerTwo');

        try {
            await expect(hostPage.locator('#player-list')).toContainText('DangerTwo', { timeout: 30000 });
            await hostPage.click('.mode-card[data-mode="derby"]');
            await startGameFromHost(hostPage);
            await hostPage.waitForTimeout(1400);

            const danger = await hostPage.evaluate(() => {
                // @ts-ignore
                const derby = window.game?.systems?.derby;
                if (!derby) return { present: false };
                // force an active shrink so the wall glow path runs
                derby.shrinkingActive = true;
                derby.currentDiameter = Math.min(derby.currentDiameter ?? 60, derby.originalDiameter ?? 80) * 0.7;
                derby._updateWallVisuals?.();
                return {
                    present: true,
                    warningColor: derby.warningColor,
                    warningHex: derby._warningColorHex?.()
                };
            });

            expect(danger.present).toBe(true);
            expect(String(danger.warningColor).toUpperCase()).toBe('#FF2E2E');
            expect(danger.warningHex).toBe(0xFF2E2E);
            await hostPage.screenshot({ path: 'test-results/visual/5k3.14-danger-wall.png' });

            // eslint-disable-next-line no-console
            console.log('[5k3.14] danger=' + JSON.stringify(danger));
        } finally {
            await ctx2.close();
        }
    });
});
