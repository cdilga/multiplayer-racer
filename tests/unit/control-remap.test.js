import { describe, expect, it } from 'vitest';
import { ControlMapper } from '../../static/js/input/ControlMapper.js';
import {
    RemapStore,
    REMAP_STORAGE_KEY,
    DEVICE_TOKEN_STORAGE_KEY,
    buildSourceKey
} from '../../static/js/input/RemapStore.js';

function createStorage(initialEntries = {}, { throwOnWrite = false } = {}) {
    const state = new Map(Object.entries(initialEntries));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            if (throwOnWrite) {
                throw new Error('storage unavailable');
            }
            state.set(key, String(value));
        },
        removeItem(key) {
            if (throwOnWrite) {
                throw new Error('storage unavailable');
            }
            state.delete(key);
        },
        dump() {
            return Object.fromEntries(state.entries());
        }
    };
}

describe('control remap persistence', () => {
    it('stores touch, keyboard, and per-pad remaps separately in local storage', () => {
        const storage = createStorage();
        const store = new RemapStore({ storage });

        const deviceToken = store.getDeviceToken();
        expect(deviceToken).toMatch(/^jj-device-/);

        store.setSource({
            kind: 'touch',
            sourceId: 'primary',
            schemeId: 'southpaw',
            summary: 'Steer right · pedals left',
            bindings: {}
        });
        store.setSource({
            kind: 'keyboard',
            sourceId: 'primary',
            schemeId: 'ijkl',
            summary: 'IJKL',
            bindings: ControlMapper.KEYBOARD_REGION_PRESETS.ijkl.bindings
        });
        store.setSource({
            kind: 'gamepad',
            sourceId: 'xinput-controller-1',
            schemeId: 'custom',
            summary: 'Custom pad',
            bindings: {
                steerLeft: ['axis:left-stick-x:negative'],
                steerRight: ['axis:left-stick-x:positive'],
                accelerate: ['button:south'],
                brake: ['button:lt'],
                fire: ['button:rb']
            }
        });

        const persisted = JSON.parse(storage.dump()[REMAP_STORAGE_KEY]);
        expect(storage.dump()[DEVICE_TOKEN_STORAGE_KEY]).toBe(deviceToken);
        expect(persisted.deviceToken).toBe(deviceToken);
        expect(persisted.sources).toMatchObject({
            [buildSourceKey('touch', 'primary')]: {
                kind: 'touch',
                sourceId: 'primary',
                schemeId: 'southpaw',
                summary: 'Steer right · pedals left'
            },
            [buildSourceKey('keyboard', 'primary')]: {
                kind: 'keyboard',
                sourceId: 'primary',
                schemeId: 'ijkl',
                summary: 'IJKL'
            },
            [buildSourceKey('gamepad', 'xinput-controller-1')]: {
                kind: 'gamepad',
                sourceId: 'xinput-controller-1',
                schemeId: 'custom',
                summary: 'Custom pad'
            }
        });
    });

    it('falls back to in-memory storage when localStorage writes fail', () => {
        const storage = createStorage({}, { throwOnWrite: true });
        const store = new RemapStore({ storage });

        const deviceToken = store.getDeviceToken();
        expect(deviceToken).toMatch(/^jj-device-/);

        store.setSource({
            kind: 'keyboard',
            sourceId: 'primary',
            schemeId: 'wasd',
            summary: 'WASD',
            bindings: ControlMapper.KEYBOARD_REGION_PRESETS.wasd.bindings
        });

        expect(store.getSource('keyboard', 'primary')).toMatchObject({
            kind: 'keyboard',
            sourceId: 'primary',
            schemeId: 'wasd',
            summary: 'WASD'
        });
        expect(storage.dump()[REMAP_STORAGE_KEY]).toBeUndefined();
    });
});

describe('ControlMapper remap API', () => {
    it('tracks custom touch, keyboard, and gamepad remaps without mutating the control contract', () => {
        const mapper = new ControlMapper();

        expect(mapper.setTouchScheme('southpaw').valid).toBe(true);
        expect(mapper.setKeyboardPreset('ijkl').valid).toBe(true);
        expect(mapper.setKeyboardActionBinding('fire', ['KeyP'], {
            schemeId: 'custom',
            fallbackPresetId: 'ijkl'
        }).valid).toBe(true);
        expect(mapper.setGamepadActionBinding('accelerate', ['button:rb'], {
            schemeId: 'custom',
            sourceId: 'pad-a',
            fallbackPresetId: 'standard'
        }).valid).toBe(true);

        expect(mapper.getKnownKeyboardCodes().has('KeyP')).toBe(true);
        expect(mapper.getRemapState()).toEqual({
            touch: {
                schemeId: 'southpaw',
                summary: 'Steer right · pedals left'
            },
            keyboard: {
                schemeId: 'custom',
                summary: 'Custom keyboard',
                bindings: {
                    steerLeft: ['KeyJ'],
                    steerRight: ['KeyL'],
                    accelerate: ['KeyI'],
                    brake: ['KeyK'],
                    fire: ['KeyP']
                }
            },
            gamepad: {
                schemeId: 'custom',
                sourceId: 'pad-a',
                summary: 'Custom pad',
                bindings: {
                    steerLeft: ['axis:left-stick-x:negative', 'button:dpad-left'],
                    steerRight: ['axis:left-stick-x:positive', 'button:dpad-right'],
                    accelerate: ['button:rb'],
                    brake: ['button:lt'],
                    fire: ['button:south']
                }
            }
        });

        mapper.setTouchInput(0.2, 1, 0, false);
        mapper.step(220);
        expect(mapper.touchInput.steering).toBeCloseTo(0.2, 6);
        expect(mapper.getDebugValues().touchRaw.steering).toBeCloseTo(0.2, 6);
        expect(mapper.getControls()).toEqual({
            steering: mapper.getDebugValues().touchShaped.steering,
            acceleration: mapper.getDebugValues().touchShaped.acceleration,
            braking: 0,
            fire: false
        });
    });

    it('rejects conflicting keyboard and gamepad bindings', () => {
        const mapper = new ControlMapper();

        const keyboardResult = mapper.setKeyboardBindings({
            steerLeft: ['KeyA'],
            steerRight: ['KeyA'],
            accelerate: ['KeyW'],
            brake: ['KeyS'],
            fire: ['Space']
        });
        expect(keyboardResult.valid).toBe(false);
        expect(keyboardResult.errors[0]).toMatch(/Keyboard conflict/i);

        const gamepadResult = mapper.setGamepadBindings({
            steerLeft: ['button:dpad-left'],
            steerRight: ['button:dpad-right'],
            accelerate: ['button:rt'],
            brake: ['button:rt'],
            fire: ['button:south']
        });
        expect(gamepadResult.valid).toBe(false);
        expect(gamepadResult.errors[0]).toMatch(/Gamepad conflict/i);
    });
});
