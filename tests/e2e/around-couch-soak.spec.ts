import { test, expect, gotoHost, joinGameAsPlayer, startGameFromHost, waitForRoomCode } from './fixtures';

const soakPlayers = Number(process.env.JJ_SOAK_PLAYERS || 0);
const soakSocketOptions = {
    socketTransport: 'hybrid' as const,
};

test.describe('Around Couch Soak', () => {
    test.skip(!Number.isFinite(soakPlayers) || soakPlayers < 2, 'Set JJ_SOAK_PLAYERS to run the spawn soak.');

    test(`host supports ${soakPlayers} joined controllers with distinct generated spawns`, async ({ browser }) => {
        test.setTimeout(300000);
        test.slow();

        const hostContext = await browser.newContext({
            viewport: { width: 1280, height: 720 }
        });
        const hostPage = await hostContext.newPage();
        const players: Array<{ context: any; page: any }> = [];

        try {
            // Keep testMode shortcuts, but allow websocket upgrades so the
            // 32-controller soak exercises the production transport path.
            await gotoHost(hostPage, soakSocketOptions);
            const roomCode = await waitForRoomCode(hostPage);

            for (let index = 0; index < soakPlayers; index++) {
                const context = await browser.newContext({
                    viewport: { width: 375, height: 667 },
                    isMobile: true,
                    hasTouch: true,
                    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
                });
                const page = await context.newPage();
                players.push({ context, page });

                await joinGameAsPlayer(page, roomCode, `Soak${index + 1}`, soakSocketOptions);
                await hostPage.waitForFunction(
                    (expected) => {
                        // @ts-ignore
                        return window.game?.vehicles?.size === expected;
                    },
                    index + 1,
                    { timeout: 60000 }
                );
            }

            await startGameFromHost(hostPage);
            await hostPage.waitForTimeout(1500);

            const result = await hostPage.evaluate(() => {
                // @ts-ignore
                const game = window.game;
                const vehicles = Array.from(game?.vehicles?.values?.() || []);
                const snapshots = vehicles.map((vehicle: any) => ({
                    playerId: vehicle.playerId,
                    spawnPosition: vehicle.spawnPosition
                        ? {
                            x: vehicle.spawnPosition.x,
                            y: vehicle.spawnPosition.y,
                            z: vehicle.spawnPosition.z
                        }
                        : null,
                    currentPosition: vehicle.mesh
                        ? {
                            x: vehicle.mesh.position.x,
                            y: vehicle.mesh.position.y,
                            z: vehicle.mesh.position.z
                        }
                        : null
                }));

                const pairStats = (key: 'spawnPosition' | 'currentPosition') => {
                    let minDistance = Number.POSITIVE_INFINITY;
                    let closestPair: [string, string] | null = null;

                    for (let i = 0; i < snapshots.length; i++) {
                        for (let j = i + 1; j < snapshots.length; j++) {
                            const a = snapshots[i][key];
                            const b = snapshots[j][key];
                            if (!a || !b) continue;
                            const distance = Math.hypot(a.x - b.x, a.z - b.z);
                            if (distance < minDistance) {
                                minDistance = distance;
                                closestPair = [snapshots[i].playerId, snapshots[j].playerId];
                            }
                        }
                    }

                    return {
                        minDistance: Number.isFinite(minDistance) ? minDistance : null,
                        closestPair
                    };
                };

                return {
                    vehicleCount: vehicles.length,
                    generatedSpawnCount: game?.track?.generatedSpawns?.length || 0,
                    spawnDiagnostics: game?.track?.spawnGenerationMetadata || null,
                    spawnPairs: pairStats('spawnPosition'),
                    currentPairs: pairStats('currentPosition')
                };
            });

            expect(result.vehicleCount).toBe(soakPlayers);
            expect(result.generatedSpawnCount).toBeGreaterThanOrEqual(soakPlayers);
            expect(result.spawnDiagnostics?.validation?.valid).toBe(true);
            expect(result.spawnPairs.minDistance).toBeGreaterThanOrEqual(3.5 - 0.01);
            expect(result.currentPairs.minDistance).toBeGreaterThan(2.0);
        } finally {
            for (const player of players) {
                await player.context.close();
            }
            await hostContext.close();
        }
    });
});
