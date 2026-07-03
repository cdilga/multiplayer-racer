import { describe, it, expect } from 'vitest';
import { DebugMenuUI, isDebugEnabled, DEBUG_FLAG_KEY } from '../../static/js/ui/DebugMenuUI.js';

/**
 * br-debug-menu-panel — the pure gating + registry logic. The RUNNING-game
 * evidence (menu appears, checkboxes flip real overlays) lives in the host-path
 * E2E (tests/e2e/debug-menu.spec.ts); these assert the logic underneath it.
 */

function fakeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v))
    };
}

// A registerable toggle backed by a plain boolean cell.
function cellToggle(id, label, initial = false) {
    const state = { on: initial };
    return {
        state,
        toggle: { id, label, isOn: () => state.on, setOn: (v) => { state.on = !!v; } }
    };
}

describe('isDebugEnabled (debug-enable feature flag)', () => {
    it('is OFF by default — normal players never see the menu', () => {
        expect(isDebugEnabled({ search: '', storage: fakeStorage() })).toBe(false);
    });

    it('is ON with ?debug=1 in the URL', () => {
        expect(isDebugEnabled({ search: '?debug=1', storage: fakeStorage() })).toBe(true);
        expect(isDebugEnabled({ search: '?foo=bar&debug=true', storage: fakeStorage() })).toBe(true);
    });

    it('is ON when localStorage opts in', () => {
        expect(isDebugEnabled({ search: '', storage: fakeStorage({ [DEBUG_FLAG_KEY]: '1' }) })).toBe(true);
    });

    it('ignores an unrelated debug value', () => {
        expect(isDebugEnabled({ search: '?debug=0', storage: fakeStorage() })).toBe(false);
    });
});

describe('DebugMenuUI registry (togglable entry per overlay)', () => {
    it('registers a toggle per overlay and preserves order', () => {
        const menu = new DebugMenuUI({ enabled: false });
        const a = cellToggle('a', 'Overlay A');
        const b = cellToggle('b', 'Overlay B');
        menu.registerToggle(a.toggle).registerToggle(b.toggle);
        expect(menu.toggleIds()).toEqual(['a', 'b']);
    });

    it('each toggle flips its overlay independently and reversibly', () => {
        const a = cellToggle('a', 'A');
        const b = cellToggle('b', 'B');
        const menu = new DebugMenuUI({ enabled: false, toggles: [a.toggle, b.toggle] });

        expect(menu.isToggleOn('a')).toBe(false);
        expect(menu.setToggle('a')).toBe(true);      // flip a on
        expect(a.state.on).toBe(true);
        expect(b.state.on).toBe(false);              // b untouched — independent
        expect(menu.isToggleOn('a')).toBe(true);

        expect(menu.setToggle('a', false)).toBe(false); // reversible
        expect(a.state.on).toBe(false);
    });

    it('re-registering the same id replaces (no duplicate rows)', () => {
        const menu = new DebugMenuUI({ enabled: false });
        menu.registerToggle(cellToggle('x', 'First').toggle);
        menu.registerToggle(cellToggle('x', 'Second').toggle);
        expect(menu.toggleIds()).toEqual(['x']);
    });

    it('ignores malformed toggles and unknown ids without throwing', () => {
        const menu = new DebugMenuUI({ enabled: false });
        menu.registerToggle(null);
        menu.registerToggle({ id: 'nope' });          // no isOn/setOn
        expect(menu.toggleIds()).toEqual([]);
        expect(menu.setToggle('missing', true)).toBeNull();
        expect(menu.isToggleOn('missing')).toBeNull();
    });

    it('init() is a no-op when the debug flag is OFF (gated)', () => {
        const menu = new DebugMenuUI({ enabled: false, container: null });
        expect(menu.init()).toBe(menu);
        expect(menu.element).toBeNull();              // nothing rendered for normal players
    });
});
