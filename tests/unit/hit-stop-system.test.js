import { describe, it, expect } from 'vitest';
import { HitStopSystem } from '../../static/js/systems/HitStopSystem.js';

function createEventBus() {
    const listeners = new Map();
    return {
        on(eventName, handler) {
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
            return () => listeners.get(eventName)?.delete(handler);
        },
        emit(eventName, payload) {
            for (const handler of listeners.get(eventName) || []) {
                handler(payload);
            }
        },
        listenerCount(eventName) {
            return listeners.get(eventName)?.size || 0;
        }
    };
}

function createRenderSystem() {
    const calls = [];
    return {
        calls,
        triggerHitStopCameraPunch(payload) {
            calls.push(payload);
        },
        getHitStopRenderDiagnostics() {
            return {
                appliedFrames: calls.reduce((sum, call) => sum + call.frames, 0),
                physicsTimeScale: 1
            };
        }
    };
}

describe('HitStopSystem runtime adapter', () => {
    it('maps heavy shared-race collisions to camera punch without mesh hold', async () => {
        const eventBus = createEventBus();
        const renderSystem = createRenderSystem();
        const hitStop = new HitStopSystem({ eventBus, renderSystem });
        await hitStop.init();

        eventBus.emit('damage:vehicleCollision', {
            vehicleA: 'car-a',
            vehicleB: 'car-b',
            damage: 36
        });

        expect(renderSystem.calls).toHaveLength(1);
        expect(renderSystem.calls[0]).toMatchObject({
            frames: 3,
            source: 'damage:vehicleCollision',
            vehicleIds: ['car-a', 'car-b']
        });
        expect(hitStop.shouldHoldVehicleMesh('car-a')).toBe(false);
        expect(hitStop.getDiagnostics().physicsTimeScale).toBe(1);
    });

    it('maps eliminations to focused mesh hold and clears after render ticks', async () => {
        const eventBus = createEventBus();
        const renderSystem = createRenderSystem();
        const hitStop = new HitStopSystem({ eventBus, renderSystem });
        await hitStop.init();

        eventBus.emit('damage:destroyed', { vehicleId: 'car-a' });

        expect(renderSystem.calls).toHaveLength(0);
        expect(hitStop.shouldHoldVehicleMesh('car-a')).toBe(true);
        expect(hitStop.shouldHoldVehicleMesh('car-b')).toBe(false);

        hitStop.tick();
        expect(hitStop.shouldHoldVehicleMesh('car-a')).toBe(true);
        hitStop.tick();
        expect(hitStop.shouldHoldVehicleMesh('car-a')).toBe(true);
        hitStop.tick();
        expect(hitStop.shouldHoldVehicleMesh('car-a')).toBe(false);

        const diagnostics = hitStop.getDiagnostics();
        expect(diagnostics.meshHoldFrames).toBe(3);
        expect(diagnostics.physicsTimeScale).toBe(1);
        expect(diagnostics.timeline.at(-1).after.active).toBe(false);
    });

    it('ignores light impacts and unsubscribes cleanly on destroy', async () => {
        const eventBus = createEventBus();
        const renderSystem = createRenderSystem();
        const hitStop = new HitStopSystem({ eventBus, renderSystem });
        await hitStop.init();

        expect(eventBus.listenerCount('damage:barrierCollision')).toBe(1);
        eventBus.emit('damage:barrierCollision', { vehicleId: 'car-a', damage: 2 });
        expect(renderSystem.calls).toHaveLength(0);
        expect(hitStop.shouldHoldVehicleMesh('car-a')).toBe(false);

        hitStop.destroy();
        expect(eventBus.listenerCount('damage:barrierCollision')).toBe(0);
    });
});
