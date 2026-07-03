import { describe, expect, it, vi } from 'vitest';
import { SmashCalloutOverlay } from '../../static/js/ui/SmashCalloutOverlay.js';

function makeGame() {
    return {
        vehicles: new Map([
            ['attacker-player', { id: 'car-attacker', playerName: 'Ada' }],
            ['victim-player', { id: 'car-victim', playerName: 'Grace' }]
        ]),
        systems: {
            network: {
                players: new Map()
            }
        }
    };
}

describe('SmashCalloutOverlay', () => {
    it('formats attributed X WRECKED Y stingers when attacker and victim are available', () => {
        const overlay = new SmashCalloutOverlay({ gameHost: makeGame() });
        const callout = overlay.buildCallout({
            playerId: 'victim-player',
            sourcePlayerId: 'attacker-player',
            sourceWeaponId: 'rocket'
        });

        expect(callout).toMatchObject({
            text: 'Ada WRECKED Grace',
            attackerName: 'Ada',
            victimName: 'Grace',
            sourcePlayerId: 'attacker-player',
            playerId: 'victim-player',
            weaponId: 'rocket'
        });
    });

    it('falls back to victim-only copy when no attacker exists', () => {
        const overlay = new SmashCalloutOverlay({ gameHost: makeGame() });
        const callout = overlay.buildCallout({ playerId: 'victim-player' });

        expect(callout.text).toBe('Grace GOT WRECKED');
        expect(callout.attackerName).toBeNull();
    });

    it('uses safe textContent and caps queued stingers', () => {
        const root = {
            classList: {
                classes: new Set(['hidden']),
                add(name) { this.classes.add(name); },
                remove(name) { this.classes.delete(name); }
            },
            dataset: {}
        };
        const textEl = { textContent: '' };
        const timerApi = {
            setTimeout: vi.fn(() => 7),
            clearTimeout: vi.fn()
        };
        const overlay = new SmashCalloutOverlay({
            gameHost: makeGame(),
            timerApi,
            maxQueue: 2,
            durationMs: 50
        });
        overlay.root = root;
        overlay.textEl = textEl;

        const callout = overlay.handleDestroyed({
            attackerName: '<img onerror=alert(1)>',
            victimName: '<b>Grace</b>'
        });
        overlay.handleDestroyed({ victimName: 'Bob' });
        overlay.handleDestroyed({ victimName: 'Linus' });

        expect(callout.text).toBe('<img onerror=alert(1)> WRECKED <b>Grace</b>');
        expect(textEl.textContent).toBe(callout.text);
        expect(root.dataset.hasAttacker).toBe('true');
        expect(overlay.queue).toHaveLength(2);
        expect(timerApi.setTimeout).toHaveBeenCalledWith(expect.any(Function), 50);
    });
});
