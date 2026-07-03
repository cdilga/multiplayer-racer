import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-around-couch-risk-resolution-3xv.10 — runtime journal in bug reports.
 *
 * Once a match starts, GameHost runs a ReplayJournal and collectDebugInfo() (the
 * bug-report data source) carries the deterministic run identity + a redacted
 * replay excerpt (recent commands/events + the latest snapshot hash). This is the
 * "bug reports include buildId/seed/tuningHash/current tick/journal excerpt/latest
 * snapshot hash" acceptance, verified against the real host.
 */
test.describe('runtime replay journal in bug reports (3xv.10)', () => {
    test('a started match records a journal and surfaces it in collectDebugInfo', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForFunction(() => {
            // @ts-ignore
            const game = window.game;
            return game?.engine?.initialized && game?.systems?.physics?.initialized;
        }, undefined, { timeout: 120000 });

        const info = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            await game._onStartGame({ mode: 'race', track: 'oval' });
            // Let the loop run so >=1 throttled snapshot (every 60 ticks) is taken.
            await new Promise((r) => setTimeout(r, 1500));
            const debug = game.collectDebugInfo();
            return {
                hasJournal: !!debug.replayJournal,
                schemaVersion: debug.replayJournal?.schemaVersion ?? null,
                hasContext: !!debug.replayJournal?.context,
                totalSnapshots: debug.replayJournal?.totalSnapshots ?? 0,
                latestSnapshotHash: debug.replayJournal?.latestSnapshot?.stateHash ?? null,
                // Run identity block.
                runContextKeys: debug.runContext ? Object.keys(debug.runContext) : [],
                // Privacy: no token/secret substrings leaked into the excerpt.
                blobHasSecret: /host_token|seat_token|password|secret/i.test(JSON.stringify(debug.replayJournal || {}))
            };
        });

        expect(info.hasJournal).toBe(true);
        expect(info.schemaVersion).toBe(1);
        expect(info.hasContext).toBe(true);
        // A throttled snapshot was taken and its hash is exposed.
        expect(info.totalSnapshots).toBeGreaterThan(0);
        expect(info.latestSnapshotHash).toBeTruthy();
        // Run identity carries the replay-reproduction fields.
        expect(info.runContextKeys).toEqual(
            expect.arrayContaining(['buildId', 'seed', 'tuningHash', 'tick'])
        );
        // Privacy-safe: redaction keeps tokens/secrets out of the bug-report blob.
        expect(info.blobHasSecret).toBe(false);
    });
});
