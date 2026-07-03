import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, gotoHost } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.19');

test('host smash callout shows attributed X WRECKED Y stinger', async ({ hostPage }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });

    await gotoHost(hostPage);
    await hostPage.waitForFunction(() => !!(window as any).__smashCalloutOverlay, null, { timeout: 30000 });

    const result = await hostPage.evaluate(() => {
        const game = (window as any).game;
        game.vehicles.set('attacker-player', { id: 'car-attacker', playerName: 'Ada' });
        game.vehicles.set('victim-player', { id: 'car-victim', playerName: 'Grace' });
        game.eventBus.emit('damage:destroyed', {
            vehicleId: 'car-victim',
            playerId: 'victim-player',
            sourcePlayerId: 'attacker-player',
            sourceWeaponId: 'rocket'
        });
        const overlay = (window as any).__smashCalloutOverlay;
        return overlay.getDiagnostics();
    });

    expect(result.visible).toBe(true);
    expect(result.text).toBe('Ada WRECKED Grace');
    expect(result.lastCallout).toMatchObject({
        attackerName: 'Ada',
        victimName: 'Grace',
        sourcePlayerId: 'attacker-player',
        playerId: 'victim-player',
        weaponId: 'rocket'
    });

    await expect(hostPage.locator('.smash-callout-overlay')).toBeVisible();
    await expect(hostPage.locator('.smash-callout-text')).toHaveText('Ada WRECKED Grace');
    await hostPage.screenshot({
        path: resolve(ARTIFACT_DIR, 'smash-callout-attributed.png'),
        fullPage: true
    });
    writeFileSync(resolve(ARTIFACT_DIR, 'smash-callout-diagnostics.json'), JSON.stringify(result, null, 2));
});
