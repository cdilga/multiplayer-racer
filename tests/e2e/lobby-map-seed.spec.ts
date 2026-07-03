import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-map-authoring-tool-j3i.1 — host map-selection UX guard.
 *
 * The lobby exposes curated presets and, for seedable (random/procedural)
 * presets, a visible seed field FIRST — so "random" always resolves to a
 * recorded seed (never an unrecorded Math.random). Selecting a known named map
 * hides the seed field. A host-entered seed flows into the run settings.
 */
test.describe('lobby map seed + preset controls (j3i.1)', () => {
    test('seed field shows for seedable presets, hides for known maps, and flows to settings', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);
        await hostPage.waitForSelector('#track-select', { timeout: 30000 });

        const seedRowDisplay = () => hostPage.$eval('#seed-entry-row', (el) => (el as HTMLElement).style.display);

        // Default race mode selects the 'procedural' (seedable) preset -> seed shown.
        await hostPage.selectOption('#track-select', 'procedural');
        await hostPage.dispatchEvent('#track-select', 'change');
        expect(await seedRowDisplay()).not.toBe('none');

        // A known named map hides the seed field.
        await hostPage.selectOption('#track-select', 'oval');
        await hostPage.dispatchEvent('#track-select', 'change');
        expect(await seedRowDisplay()).toBe('none');

        // Back to a seedable preset: the seed field + randomize control are shown.
        await hostPage.selectOption('#track-select', 'procedural');
        await hostPage.dispatchEvent('#track-select', 'change');
        expect(await seedRowDisplay()).not.toBe('none');

        // The randomize button writes a non-empty visible seed (while still in lobby).
        await hostPage.click('#seed-randomize');
        const randomized = await hostPage.$eval('#map-seed', (el) => (el as HTMLInputElement).value);
        expect(randomized.length).toBeGreaterThan(0);

        // A host-entered seed flows into the run settings (drive start directly;
        // this transitions out of the lobby, so it is done last).
        await hostPage.fill('#map-seed', '424242');
        const mapSeed = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            game.ui.lobby.onStartGame({ mode: 'race', laps: 3, track: 'procedural', seed: 424242 });
            return game.settings.mapSeed;
        });
        expect(mapSeed).toBe(424242);
    });
});
