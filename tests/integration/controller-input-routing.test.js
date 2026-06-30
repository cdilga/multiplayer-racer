import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlMapper } from '../../static/js/input/ControlMapper.js';
import {
    RemapStore,
    REMAP_STORAGE_KEY,
    DEVICE_TOKEN_STORAGE_KEY,
    buildSourceKey
} from '../../static/js/input/RemapStore.js';

class FakeClassList {
    constructor() {
        this.classes = new Set();
    }

    add(...names) {
        for (const name of names) this.classes.add(name);
    }

    remove(...names) {
        for (const name of names) this.classes.delete(name);
    }

    toggle(name, force) {
        if (force === true) {
            this.classes.add(name);
            return true;
        }
        if (force === false) {
            this.classes.delete(name);
            return false;
        }
        if (this.classes.has(name)) {
            this.classes.delete(name);
            return false;
        }
        this.classes.add(name);
        return true;
    }

    contains(name) {
        return this.classes.has(name);
    }
}

class FakeElement {
    constructor(ownerDocument, id = '', tagName = 'div') {
        this.ownerDocument = ownerDocument;
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.listeners = {};
        this.style = {
            setProperty(name, value) {
                this[name] = value;
            }
        };
        this.classList = new FakeClassList();
        this.dataset = {};
        this.attributes = {};
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.isContentEditable = false;
    }

    addEventListener(type, listener) {
        this.listeners[type] ??= [];
        this.listeners[type].push(listener);
    }

    removeEventListener(type, listener) {
        const listeners = this.listeners[type] || [];
        this.listeners[type] = listeners.filter((entry) => entry !== listener);
    }

    dispatchEvent(event) {
        const listeners = this.listeners[event.type] || [];
        event.target ??= this;
        for (const listener of listeners) {
            listener(event);
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) {
            this.ownerDocument.elements.set(child.id, child);
        }
        return child;
    }

    querySelector(selector) {
        return this.ownerDocument.querySelector(selector);
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    closest(selector) {
        if (selector === '.hidden' && this.classList.contains('hidden')) {
            return this;
        }
        return null;
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }
}

class FakeDocument {
    constructor() {
        this.elements = new Map();
        this.listeners = {};
        this.hidden = false;
        this.activeElement = null;
        this.body = this._createRegisteredElement('body', 'body');
        this.documentElement = this._createRegisteredElement('html', 'html');

        [
            'join-screen',
            'waiting-screen',
            'game-screen',
            'player-name',
            'room-code',
            'join-btn',
            'error-message',
            'display-name',
            'display-room',
            'car-preview',
            'steering-wheel',
            'accelerate-btn',
            'brake-btn',
            'speed',
            'controls-container',
            'generate-name-btn',
            'auto-join-message',
            'detected-room-code',
            'player-menu',
            'player-menu-btn',
            'player-menu-reset',
            'player-menu-replay-tutorial',
            'player-menu-report-bug',
            'player-menu-leave',
            'player-menu-close',
            'join-controls-btn',
            'control-remap-summary-join',
            'control-remap-summary-menu',
            'player-menu-controls',
            'control-remap-modal',
            'control-remap-status',
            'control-remap-close',
            'control-remap-reset',
            'control-remap-gamepad-notice',
            'control-remap-touch-options',
            'control-remap-keyboard-presets',
            'control-remap-keyboard-actions',
            'control-remap-gamepad-actions',
            'tutorial-overlay',
            'tutorial-veil',
            'tutorial-spotlight',
            'tutorial-card',
            'tutorial-progress',
            'tutorial-title',
            'tutorial-body',
            'tutorial-next',
            'tutorial-skip'
        ].forEach((id) => this.getElementById(id));
    }

    _createRegisteredElement(id, tagName = 'div') {
        const element = new FakeElement(this, id, tagName);
        this.elements.set(id, element);
        return element;
    }

    createElement(tagName) {
        return new FakeElement(this, '', tagName);
    }

    getElementById(id) {
        if (!this.elements.has(id)) {
            const tagName = ['player-name', 'room-code'].includes(id)
                ? 'input'
                : id === 'join-btn'
                    ? 'button'
                    : 'div';
            this._createRegisteredElement(id, tagName);
        }
        return this.elements.get(id);
    }

    querySelector(selector) {
        const selectors = selector.split(',').map((entry) => entry.trim()).filter(Boolean);
        for (const entry of selectors) {
            if (entry.startsWith('#')) {
                return this.getElementById(entry.slice(1));
            }
            if (entry.startsWith('.')) {
                const className = entry.slice(1);
                for (const element of this.elements.values()) {
                    if (element.classList.contains(className)) {
                        return element;
                    }
                }
            }
        }
        return null;
    }

    addEventListener(type, listener) {
        this.listeners[type] ??= [];
        this.listeners[type].push(listener);
    }

    removeEventListener(type, listener) {
        const listeners = this.listeners[type] || [];
        this.listeners[type] = listeners.filter((entry) => entry !== listener);
    }

    dispatchEvent(event) {
        const listeners = this.listeners[event.type] || [];
        event.target ??= this;
        for (const listener of listeners) {
            listener(event);
        }
    }

    listenerCount(type) {
        return (this.listeners[type] || []).length;
    }
}

const originalGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    location: globalThis.location,
    io: globalThis.io,
    ControlMapper: globalThis.ControlMapper,
    Joystick: globalThis.Joystick,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    localStorage: globalThis.localStorage
};

function overrideGlobal(name, value) {
    Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true
    });
}

function createMemoryStorage(initialEntries = {}) {
    const state = new Map(Object.entries(initialEntries));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            state.set(key, String(value));
        },
        removeItem(key) {
            state.delete(key);
        },
        snapshot() {
            return Object.fromEntries(state.entries());
        }
    };
}

function installPlayerHarness(options = {}) {
    const document = new FakeDocument();
    const storage = createMemoryStorage(options.storageEntries);
    const gamepads = Array.isArray(options.gamepads) ? [...options.gamepads] : [];
    const socket = {
        emitted: [],
        handlers: {},
        id: 'socket-1',
        on(event, handler) {
            this.handlers[event] = handler;
        },
        emit(event, payload) {
            this.emitted.push({ event, payload });
        },
        getEmittedEvents() {
            return [...this.emitted];
        }
    };
    const windowListeners = {};

    const window = {
        document,
        location: { search: '', href: 'http://localhost/player' },
        navigator: {
            userAgent: 'vitest',
            vibrate: () => {},
            getGamepads: () => gamepads
        },
        addEventListener(type, listener) {
            windowListeners[type] ??= [];
            windowListeners[type].push(listener);
        },
        removeEventListener(type, listener) {
            const listeners = windowListeners[type] || [];
            windowListeners[type] = listeners.filter((entry) => entry !== listener);
        },
        dispatchEvent(event) {
            const listeners = windowListeners[event.type] || [];
            event.target ??= this;
            for (const listener of listeners) {
                listener(event);
            }
        },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        localStorage: storage,
        ControlMapper,
        RemapStore,
        Joystick: class FakeJoystick {
            constructor(config = {}) {
                this.config = config;
            }

            setEnabled() {}
        },
        performance
    };

    overrideGlobal('window', window);
    overrideGlobal('document', document);
    overrideGlobal('navigator', window.navigator);
    overrideGlobal('location', window.location);
    overrideGlobal('io', () => socket);
    overrideGlobal('ControlMapper', ControlMapper);
    overrideGlobal('RemapStore', RemapStore);
    overrideGlobal('Joystick', window.Joystick);
    overrideGlobal('requestAnimationFrame', window.requestAnimationFrame);
    overrideGlobal('cancelAnimationFrame', window.cancelAnimationFrame);
    overrideGlobal('localStorage', window.localStorage);

    return {
        document,
        socket,
        storage,
        window,
        setGamepads(nextGamepads = []) {
            gamepads.length = 0;
            gamepads.push(...nextGamepads);
        }
    };
}

async function loadPlayerModule() {
    vi.resetModules();
    await import('../../static/js/player.js');
    return globalThis.window.__playerControlMapperTestHooks;
}

afterEach(() => {
    vi.restoreAllMocks();
    overrideGlobal('window', originalGlobals.window);
    overrideGlobal('document', originalGlobals.document);
    overrideGlobal('navigator', originalGlobals.navigator);
    overrideGlobal('location', originalGlobals.location);
    overrideGlobal('io', originalGlobals.io);
    overrideGlobal('ControlMapper', originalGlobals.ControlMapper);
    overrideGlobal('Joystick', originalGlobals.Joystick);
    overrideGlobal('requestAnimationFrame', originalGlobals.requestAnimationFrame);
    overrideGlobal('cancelAnimationFrame', originalGlobals.cancelAnimationFrame);
    overrideGlobal('localStorage', originalGlobals.localStorage);
});

describe('player control routing', () => {
    it('binds one document keyboard path and preserves the control packet shape', async () => {
        const { document } = installPlayerHarness();
        const hooks = await loadPlayerModule();

        // Exactly one gameplay keydown route remains; the second keydown
        // listener is the modal capture handler for remap mode only.
        expect(document.listenerCount('keydown')).toBe(2);
        expect(document.listenerCount('keyup')).toBe(1);

        hooks.setSession({ playerId: 7, roomCode: 'ABCD', gameStarted: true });
        const event = hooks.dispatchKeyboardEvent('keydown', {
            code: 'ArrowRight',
            key: 'ArrowRight'
        });

        expect(event.defaultPrevented).toBe(true);
        hooks.advanceFrame(125);

        const packet = hooks.buildControlPacket(111);
        expect(packet.player_id).toBe(7);
        expect(packet.room_code).toBe('ABCD');
        expect(packet.timestamp).toBe(111);
        expect(packet.controls.acceleration).toBe(0);
        expect(packet.controls.braking).toBe(0);
        expect(packet.controls.steering).toBeCloseTo(0.5, 4);

        hooks.advanceFrame(125);
        expect(hooks.getControls().steering).toBeCloseTo(1, 4);

        hooks.dispatchKeyboardEvent('keyup', {
            code: 'ArrowRight',
            key: 'ArrowRight'
        });
        hooks.advanceFrame(200);
        expect(hooks.getControls().steering).toBeCloseTo(0, 4);
    });

    it('routes touch intent through the same mapper and resumes touch after keyboard release', async () => {
        installPlayerHarness();
        const hooks = await loadPlayerModule();

        hooks.setSession({ playerId: 9, roomCode: 'WXYZ', gameStarted: true });
        hooks.applyTouchIntent({ steering: -0.25, acceleration: 1, braking: 0.2 });
        expect(hooks.getControlDebug().touchRaw.steering).toBeCloseTo(-0.25, 4);
        hooks.advanceFrame(220);

        const shapedTouch = hooks.getControlDebug().touchShaped;
        let packet = hooks.buildControlPacket(222);
        expect(packet).toEqual({
            player_id: 9,
            room_code: 'WXYZ',
            controls: {
                steering: shapedTouch.steering,
                acceleration: shapedTouch.acceleration,
                braking: shapedTouch.braking
            },
            timestamp: 222
        });

        hooks.dispatchKeyboardEvent('keydown', {
            code: 'KeyD',
            key: 'd'
        });
        hooks.advanceFrame(250);

        packet = hooks.buildControlPacket(223);
        expect(packet.controls).toEqual({
            steering: 1,
            acceleration: 0,
            braking: 0
        });

        hooks.dispatchKeyboardEvent('keyup', {
            code: 'KeyD',
            key: 'd'
        });
        hooks.advanceFrame(200);

        const resumedTouch = hooks.getControlDebug().touchShaped;
        expect(hooks.getControls()).toEqual({
            steering: resumedTouch.steering,
            acceleration: resumedTouch.acceleration,
            braking: resumedTouch.braking
        });
        expect(hooks.getControlDebug().touchRaw.steering).toBeCloseTo(-0.25, 4);
    });

    it('keeps hold-up-to-go on the real accelerate button while shaping the emitted throttle', async () => {
        const { document } = installPlayerHarness();
        const hooks = await loadPlayerModule();

        hooks.setSession({ playerId: 11, roomCode: 'GO11', gameStarted: true });
        hooks.rebuildGameControls();

        const accelerateBtn = document.getElementById('accelerate-btn');
        const startEvent = {
            type: 'touchstart',
            changedTouches: [{ identifier: 7 }],
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        };

        accelerateBtn.dispatchEvent(startEvent);
        expect(startEvent.defaultPrevented).toBe(true);
        expect(hooks.getControlDebug().touchRaw.acceleration).toBe(1);
        expect(hooks.getControlDebug().touchShaped.acceleration).toBe(0);

        hooks.advanceFrame(110);
        expect(hooks.buildControlPacket(311).controls).toEqual({
            steering: 0,
            acceleration: 0.5,
            braking: 0
        });

        hooks.advanceFrame(110);
        expect(hooks.buildControlPacket(312).controls).toEqual({
            steering: 0,
            acceleration: 1,
            braking: 0
        });

        const endEvent = {
            type: 'touchend',
            changedTouches: [{ identifier: 7 }]
        };

        accelerateBtn.dispatchEvent(endEvent);
        expect(hooks.getControlDebug().touchRaw.acceleration).toBe(0);

        hooks.advanceFrame(45);
        expect(hooks.buildControlPacket(313).controls.acceleration).toBeCloseTo(0.5, 4);

        hooks.advanceFrame(45);
        expect(hooks.buildControlPacket(314).controls).toEqual({
            steering: 0,
            acceleration: 0,
            braking: 0
        });
    });

    it('fires once per Space edge and releases all controls on visibility change', async () => {
        const { document } = installPlayerHarness();
        const hooks = await loadPlayerModule();

        hooks.setSession({
            playerId: 5,
            roomCode: 'RACE',
            gameStarted: true,
            weapon: { id: 'rocket', name: 'Rocket', icon: 'R' }
        });
        hooks.clearSocketEmits();

        hooks.dispatchKeyboardEvent('keydown', { code: 'Space', key: ' ' });
        hooks.advanceFrame(16.667);

        let emits = hooks.getSocketEmits().filter((entry) => entry.event === 'weapon_fire');
        expect(emits).toHaveLength(1);

        hooks.advanceFrame(16.667);
        emits = hooks.getSocketEmits().filter((entry) => entry.event === 'weapon_fire');
        expect(emits).toHaveLength(1);

        hooks.dispatchKeyboardEvent('keyup', { code: 'Space', key: ' ' });
        hooks.setSession({
            weapon: { id: 'rocket', name: 'Rocket', icon: 'R' }
        });
        hooks.dispatchKeyboardEvent('keydown', { code: 'Space', key: ' ' });
        hooks.advanceFrame(16.667);

        emits = hooks.getSocketEmits().filter((entry) => entry.event === 'weapon_fire');
        expect(emits).toHaveLength(2);

        hooks.clearSocketEmits();
        hooks.applyTouchIntent({ steering: 0.6, acceleration: 1, braking: 0 });
        document.hidden = true;
        document.dispatchEvent({ type: 'visibilitychange' });

        expect(hooks.getControls()).toEqual({
            steering: 0,
            acceleration: 0,
            braking: 0
        });

        const lastEmit = hooks.getSocketEmits().at(-1);
        expect(lastEmit.event).toBe('player_control_update');
        expect(lastEmit.payload).toEqual({
            player_id: 5,
            room_code: 'RACE',
            controls: { steering: 0, acceleration: 0, braking: 0 },
            timestamp: expect.any(Number)
        });
    });

    it('hydrates remapped touch and keyboard settings while preserving the canonical packet shape', async () => {
        const storageEntries = {
            [DEVICE_TOKEN_STORAGE_KEY]: 'jj-device-test-a',
            [REMAP_STORAGE_KEY]: JSON.stringify({
                version: 1,
                deviceToken: 'jj-device-test-a',
                sources: {
                    [buildSourceKey('touch', 'primary')]: {
                        kind: 'touch',
                        sourceId: 'primary',
                        schemeId: 'southpaw',
                        summary: 'Steer right · pedals left',
                        bindings: {},
                        updatedAt: '2026-07-01T00:00:00.000Z'
                    },
                    [buildSourceKey('keyboard', 'primary')]: {
                        kind: 'keyboard',
                        sourceId: 'primary',
                        schemeId: 'ijkl',
                        summary: 'IJKL',
                        bindings: ControlMapper.KEYBOARD_REGION_PRESETS.ijkl.bindings,
                        updatedAt: '2026-07-01T00:00:00.000Z'
                    }
                }
            })
        };
        installPlayerHarness({ storageEntries });
        const hooks = await loadPlayerModule();

        hooks.setSession({ playerId: 12, roomCode: 'SWAP', gameStarted: true });
        const layout = hooks.rebuildGameControls();
        expect(layout).toEqual({
            schemeId: 'southpaw',
            childIds: ['pedals-area', 'steering-area', 'weapon-area']
        });

        hooks.applyTouchIntent({ steering: -0.4, acceleration: 1, braking: 0.2 });
        expect(hooks.getControlDebug().touchRaw).toMatchObject({
            steering: -0.4,
            acceleration: 1,
            braking: 0.2
        });

        hooks.dispatchKeyboardEvent('keydown', {
            code: 'KeyL',
            key: 'l'
        });
        hooks.advanceFrame(125);

        const packet = hooks.buildControlPacket(777);
        expect(packet).toEqual({
            player_id: 12,
            room_code: 'SWAP',
            controls: {
                steering: 0.5,
                acceleration: 0,
                braking: 0
            },
            timestamp: 777
        });
        expect(hooks.getRemapState()).toMatchObject({
            touch: { schemeId: 'southpaw', summary: 'Steer right · pedals left' },
            keyboard: { schemeId: 'ijkl', summary: 'IJKL' }
        });
    });

    it('restores device-specific gamepad remaps on the poll path and still emits canonical controls', async () => {
        const storageEntries = {
            [DEVICE_TOKEN_STORAGE_KEY]: 'jj-device-test-b',
            [REMAP_STORAGE_KEY]: JSON.stringify({
                version: 1,
                deviceToken: 'jj-device-test-b',
                sources: {
                    [buildSourceKey('gamepad', 'xinput-controller-1')]: {
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
                        },
                        updatedAt: '2026-07-01T00:00:00.000Z'
                    }
                }
            })
        };
        const { setGamepads } = installPlayerHarness({
            storageEntries,
            gamepads: [
                {
                    id: 'XInput Controller 1',
                    index: 0,
                    mapping: 'standard',
                    axes: [-1, 0, 0, 0],
                    buttons: Array.from({ length: 16 }, (_, index) => ({
                        pressed: index === 0,
                        value: index === 0 ? 1 : 0
                    }))
                }
            ]
        });
        const hooks = await loadPlayerModule();

        hooks.setSession({ playerId: 21, roomCode: 'PAD1', gameStarted: true });
        hooks.advanceFrame(16.667);

        expect(hooks.getRemapState().gamepad).toMatchObject({
            schemeId: 'custom',
            summary: 'Custom pad',
            sourceId: 'xinput-controller-1'
        });
        expect(hooks.getControlDebug()).toMatchObject({
            activeSource: 'gamepad',
            gamepadRaw: {
                steering: -1,
                acceleration: 1,
                braking: 0,
                fire: false,
                connected: true,
                mapping: 'standard',
                sourceId: 'xinput-controller-1'
            }
        });

        const packet = hooks.buildControlPacket(909);
        expect(packet).toEqual({
            player_id: 21,
            room_code: 'PAD1',
            controls: {
                steering: -1,
                acceleration: 1,
                braking: 0
            },
            timestamp: 909
        });

        setGamepads([]);
        hooks.advanceFrame(16.667);
        expect(hooks.getControlDebug().gamepadRaw.connected).toBe(false);
        expect(hooks.getRemapState().gamepad.sourceId).toBe('standard');
    });
});
