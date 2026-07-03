import { describe, expect, it, vi } from 'vitest';
import { DerbySystem, DERBY_STATES } from '../../static/js/systems/DerbySystem.js';
import { RaceUI } from '../../static/js/ui/RaceUI.js';

function makeEventBus() {
    const events = [];
    return {
        events,
        emit: vi.fn((type, payload) => {
            events.push({ type, payload });
        }),
        on: vi.fn()
    };
}

function makeVehicle(id, playerId) {
    return {
        id,
        playerId,
        health: 100,
        maxHealth: 100,
        isDead: false
    };
}

function makeClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, force) => {
            const shouldAdd = force === undefined ? !classes.has(name) : !!force;
            if (shouldAdd) classes.add(name);
            else classes.delete(name);
            return shouldAdd;
        }
    };
}

describe('Derby loser engagement pressure', () => {
    it('starts explicit arena pressure after an elimination without changing round flow or scoring', () => {
        const eventBus = makeEventBus();
        const derby = new DerbySystem({ eventBus });
        const collider = { setRadius: vi.fn() };

        derby.initialized = true;
        derby.state = DERBY_STATES.COMBAT;
        derby.currentRound = 1;
        derby.roundStartTime = 0;
        derby.shrinkingEnabled = true;
        derby.shrinkingActive = false;
        derby.currentDiameter = 80;
        derby.minDiameter = 40;
        derby.shrinkRate = 0.5;
        derby.setWallCollider(collider);

        derby.registerVehicle(makeVehicle('v-ada', 'Ada'));
        derby.registerVehicle(makeVehicle('v-grace', 'Grace'));
        derby.registerVehicle(makeVehicle('v-linus', 'Linus'));

        derby._onVehicleDestroyed({ vehicleId: 'v-linus', playerId: 'Linus' });

        expect(derby.state).toBe(DERBY_STATES.COMBAT);
        expect(derby.roundScores).toEqual([]);
        expect(derby.roundWins.get('Ada')).toBe(0);
        expect(derby.roundWins.get('Grace')).toBe(0);
        expect(derby.roundWins.get('Linus')).toBe(0);
        expect(derby.vehicles.get('v-linus').eliminated).toBe(true);
        expect(derby.vehicles.get('v-linus').vehicle.isDead).toBe(false);
        expect(derby.shrinkingActive).toBe(true);

        const shrink = eventBus.events.find((event) => event.type === 'derby:wallsShrinking');
        expect(shrink.payload).toMatchObject({
            reason: 'loser-pressure',
            eliminatedPlayerId: 'Linus',
            currentDiameter: 80,
            minDiameter: 40,
            rate: 0.5
        });

        const pressure = eventBus.events.find((event) => event.type === 'derby:loserPressure');
        expect(pressure.payload).toMatchObject({
            eliminatedVehicleId: 'v-linus',
            eliminatedPlayerId: 'Linus',
            eliminationOrder: 1,
            survivorsLeft: 2,
            targetPlayerId: 'Ada',
            targetVehicleId: 'v-ada',
            pressureType: 'arena-shrink-started',
            arenaPressureActive: true,
            reentry: 'next-round',
            noSpeedAssist: true,
            noCurrentRoundRespawn: true
        });

        expect(derby.getLoserPressureDiagnostics()).toMatchObject({
            active: true,
            eventCount: 1,
            shrinkingActive: true,
            state: DERBY_STATES.COMBAT
        });
    });

    it('does not emit loser pressure when the elimination ends the round', () => {
        const eventBus = makeEventBus();
        const derby = new DerbySystem({ eventBus });
        derby.initialized = true;
        derby.state = DERBY_STATES.COMBAT;
        derby.shrinkingEnabled = true;

        derby.registerVehicle(makeVehicle('v-ada', 'Ada'));
        derby.registerVehicle(makeVehicle('v-grace', 'Grace'));

        derby._onVehicleDestroyed({ vehicleId: 'v-grace', playerId: 'Grace' });

        expect(eventBus.events.some((event) => event.type === 'derby:loserPressure')).toBe(false);
        expect(derby.getLoserPressureDiagnostics()).toMatchObject({
            active: false,
            eventCount: 0
        });
    });
});

describe('RaceUI loser engagement banner', () => {
    it('renders a non-modal host banner and auto-hides through timerApi', () => {
        const callbacks = [];
        const timerApi = {
            setTimeout: vi.fn((callback) => {
                callbacks.push(callback);
                return callbacks.length;
            }),
            clearTimeout: vi.fn()
        };
        const ui = new RaceUI({
            container: {},
            timerApi,
            loserEngagementDurationMs: 900
        });
        ui.element = { classList: makeClassList(['hidden']) };
        ui.elements = {
            loserEngagement: {
                classList: makeClassList(['hidden']),
                dataset: {}
            },
            loserEngagementPlayer: { textContent: '' },
            loserEngagementTarget: { textContent: '' },
            loserEngagementPressure: { textContent: '' }
        };

        ui.showLoserEngagement({
            eliminatedPlayerId: 'Linus',
            targetPlayerId: 'Ada',
            pressureType: 'arena-shrink-started'
        });

        expect(timerApi.setTimeout).toHaveBeenCalledWith(expect.any(Function), 900);
        expect(ui.getLoserEngagementDiagnostics()).toMatchObject({
            visible: true,
            active: true,
            completed: false,
            hidden: false,
            eliminatedPlayerId: 'Linus',
            targetPlayerId: 'Ada',
            pressureType: 'arena-shrink-started',
            durationMs: 900,
            text: {
                player: 'Linus is out',
                target: 'Ada is target',
                pressure: 'Arena pressure active'
            }
        });

        callbacks.shift()();

        expect(timerApi.clearTimeout).toHaveBeenCalled();
        expect(ui.getLoserEngagementDiagnostics()).toMatchObject({
            active: false,
            completed: true,
            hidden: true
        });
    });

    it('clears the banner when the HUD hides', () => {
        const ui = new RaceUI({ container: {} });
        ui.element = { classList: makeClassList() };
        ui.countdownElement = { classList: makeClassList() };
        ui.elements = {
            loserEngagement: {
                classList: makeClassList(),
                dataset: {}
            },
            loserEngagementPlayer: { textContent: '' },
            loserEngagementTarget: { textContent: '' },
            loserEngagementPressure: { textContent: '' }
        };

        ui.showLoserEngagement({
            eliminatedPlayerId: 'Grace',
            targetPlayerId: 'Ada',
            pressureType: 'leader-target'
        });
        ui.hide();

        expect(ui.getLoserEngagementDiagnostics()).toMatchObject({
            visible: false,
            active: false,
            hidden: true
        });
    });
});
