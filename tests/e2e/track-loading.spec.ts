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

    test('host start consumes the shared MapInstance validator, fail-loud on invalid (n47/j3i.2)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.initialized && game?.systems?.physics?.initialized && game?.track;
        }, undefined, { timeout: 120000 });

        const probe = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            // Build a shipped track: the host must run it through the shared
            // validator and record an OK report (proves adoption at host start).
            await game._createTrack('oval');
            const valid = game.lastArenaValidation;

            // A structurally-broken arena must fail loud with structured reasons.
            const brokenReport = game._validateArena(
                { id: 'broken-arena', geometry: { type: 'square', diameter: 70, wallHeight: 0 }, derby: {}, spawn: { positions: [] } },
                'broken-arena'
            );

            return {
                validOk: valid?.ok ?? null,
                validVersion: valid?.validatorVersion ?? null,
                validResolved: valid?.resolvedMapId ?? null,
                brokenOk: brokenReport?.ok ?? null,
                brokenReasons: (brokenReport?.reasons || []).map((r: any) => r.code)
            };
        });

        // Valid shipped map: adopted + validated at host start.
        expect(probe.validOk).toBe(true);
        expect(probe.validVersion).toBeTruthy();
        expect(probe.validResolved).toBe('oval');

        // Broken map: fail-loud with structured reasons (missing spawns/physics + open boundary).
        expect(probe.brokenOk).toBe(false);
        expect(probe.brokenReasons).toEqual(
            expect.arrayContaining(['open_derby_boundary', 'missing_physics', 'missing_spawns'])
        );
    });

    test('an invalid arena blocks the start and stays in lobby, never spawning (n47)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.initialized && game?.systems?.physics?.initialized;
        }, undefined, { timeout: 120000 });

        const result = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            const events: any[] = [];
            game.eventBus?.on?.('host:map_blocked', (e: any) => events.push(e));
            // @ts-ignore — force the validator to reject so the blocked-start path runs.
            window.__jjForceMapInvalid = true;
            // Procedural race track always rebuilds -> re-validates -> forced invalid.
            await game._onStartGame({ mode: 'race', track: 'procedural' });
            const state = game.engine.getState();
            // @ts-ignore
            window.__jjForceMapInvalid = false;
            return {
                blocked: game.mapStartBlocked === true,
                state,
                blockedEvents: events.length,
                validationOk: game.lastArenaValidation?.ok ?? null,
                reasons: (game.lastArenaValidation?.reasons || []).map((r: any) => r.code)
            };
        });

        expect(result.blocked).toBe(true);
        expect(result.validationOk).toBe(false);
        expect(result.reasons).toContain('forced_invalid_test');
        // Stayed in lobby (never entered countdown/racing) and fired the blocked event.
        expect(result.state).toBe('lobby');
        expect(result.blockedEvents).toBeGreaterThan(0);
    });

    test('an unknown track id fails loud and blocks the start (no hidden fallback) (n47)', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.initialized && game?.systems?.physics?.initialized;
        }, undefined, { timeout: 120000 });

        const result = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            await game._onStartGame({ mode: 'race', track: 'this-track-does-not-exist-xyz' });
            return {
                blocked: game.mapStartBlocked === true,
                state: game.engine.getState(),
                reasons: (game.lastArenaValidation?.reasons || []).map((r: any) => r.code)
            };
        });

        expect(result.blocked).toBe(true);
        expect(result.state).toBe('lobby');
        expect(result.reasons).toContain('track_build_failed');
    });
});
