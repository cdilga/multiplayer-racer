import { test, expect, gotoHost, waitForRoomCode } from './fixtures';

const selectableTracks = ['oval', 'derby-bowl', 'derby-arena', 'derby-coliseum', 'derby-dunes'];

test.describe('Track loading', () => {
    test('all selectable tracks load with surfaces, barriers, physics, and valid spawns', async ({ hostPage }) => {
        test.slow();

        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.initialized && game?.systems?.physics?.initialized && game?.track;
        }, undefined, { timeout: 120000 });

        for (const trackId of selectableTracks) {
            const result = await hostPage.evaluate(async (id) => {
                // @ts-ignore
                const game = window.game;
                await game._createTrack(id);

                let hasSurface = false;
                let hasSquareArena = false;
                let rampCount = 0;
                game.track.getMesh().traverse((child: any) => {
                    if (child.userData?.isTrackSurface) hasSurface = true;
                    if (child.userData?.isSquareArena) hasSquareArena = true;
                    if (child.userData?.isRamp) rampCount += 1;
                });

                const badSpawns = game.track
                    .getAllSpawnPositions()
                    .filter((spawn: { x: number; z: number }) => game.track.isOutOfBounds(spawn, 0));

                return {
                    trackId: game.track.configId,
                    hasSurface,
                    hasSquareArena,
                    rampCount,
                    barrierCount: game.track.barriers.length,
                    staticBodyKeys: Array.from(game.systems.physics.staticBodies.keys()),
                    badSpawns
                };
            }, trackId);

            expect(result.trackId).toBe(trackId);
            expect(result.hasSurface).toBe(true);
            expect(result.barrierCount).toBeGreaterThan(0);
            expect(result.staticBodyKeys.length).toBeGreaterThan(1);
            expect(result.badSpawns, `${trackId} has out-of-bounds spawns`).toEqual([]);

            if (trackId === 'derby-arena') {
                expect(result.hasSquareArena).toBe(true);
                expect(result.staticBodyKeys).toContain('barrier_square_wall');
            }

            if (trackId === 'oval') {
                expect(result.rampCount).toBe(2);
                expect(result.staticBodyKeys).toContain('ramp_0');
                expect(result.staticBodyKeys).toContain('ramp_1');
            }

            if (trackId === 'derby-dunes') {
                expect(result.staticBodyKeys).toContain('terrain');
                expect(result.staticBodyKeys).toContain('ramp_0');
            }
        }
    });

    test('random derby selection only returns validated fixed arenas', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        const picks = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            game.settings.mode = 'derby';
            return Array.from({ length: 20 }, () => game._resolveTrackId('random'));
        });

        expect(picks.every((trackId: string) => selectableTracks.slice(1).includes(trackId))).toBe(true);
    });
});
