import { describe, expect, it } from 'vitest';
import { DamageSystem } from '../../static/js/systems/DamageSystem.js';

function makeBus() {
    return {
        events: [],
        emit(event, data) {
            this.events.push({ event, data });
        }
    };
}

describe('DamageSystem smash attribution', () => {
    it('carries weapon attacker attribution into damage:destroyed', () => {
        const bus = makeBus();
        const damage = new DamageSystem({ eventBus: bus });
        damage.enabled = true;
        damage.registerVehicle({
            id: 'car-victim',
            playerId: 'victim-player',
            health: 0,
            maxHealth: 100,
            takeDamage() {
                return true;
            }
        });

        damage.applyDamage('car-victim', 120, {
            type: 'weapon',
            sourcePlayerId: 'attacker-player',
            weaponId: 'rocket'
        });

        const destroyed = bus.events.find((entry) => entry.event === 'damage:destroyed');
        expect(destroyed?.data).toMatchObject({
            vehicleId: 'car-victim',
            playerId: 'victim-player',
            sourcePlayerId: 'attacker-player',
            sourceWeaponId: 'rocket',
            source: {
                type: 'weapon',
                sourcePlayerId: 'attacker-player',
                weaponId: 'rocket'
            }
        });
    });

    it('keeps no-source destruction usable for victim fallback callouts', () => {
        const bus = makeBus();
        const damage = new DamageSystem({ eventBus: bus });
        damage.enabled = true;
        damage.registerVehicle({
            id: 'car-victim',
            playerId: 'victim-player',
            health: 0,
            maxHealth: 100,
            takeDamage() {
                return true;
            }
        });

        damage.applyDamage('car-victim', 120);

        const destroyed = bus.events.find((entry) => entry.event === 'damage:destroyed');
        expect(destroyed?.data).toMatchObject({
            vehicleId: 'car-victim',
            playerId: 'victim-player',
            source: null,
            sourcePlayerId: null,
            sourceVehicleId: null,
            sourceWeaponId: null
        });
    });
});
