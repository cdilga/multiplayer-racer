/**
 * DebugMenuUI (br-debug-menu-panel) — a single in-game menu that toggles every
 * debug overlay independently, gated behind a debug-enable flag so normal players
 * never see it.
 *
 * The other feedback beads (boundary-deflection, orientation-cues, car-identity,
 * camera guides…) each ship a debug overlay to *prove* their evidence; this menu
 * is the one place to flip them on/off in the running game.
 *
 * Design:
 *  - Registry-driven: each entry is `{ id, label, isOn(), setOn(bool) }`, so the
 *    menu is decoupled from what the overlays actually are.
 *  - Gated: `isDebugEnabled()` (URL `?debug=1` or localStorage `jj_debug=1`).
 *    Default OFF — the reveal key and menu do nothing for a normal player.
 *  - State is visible (checkbox reflects `isOn()`) and reversible (click again).
 */

const DEBUG_FLAG_KEY = 'jj_debug';

/**
 * Is the debug feature flag enabled for this session? Pure, side-effect free.
 * @param {Object} [env] - injectable {search, storage} for testing
 * @returns {boolean}
 */
function isDebugEnabled(env = {}) {
    const search = env.search ?? (typeof window !== 'undefined' ? window.location?.search : '') ?? '';
    const storage = env.storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    try {
        const params = new URLSearchParams(search);
        if (params.get('debug') === '1' || params.get('debug') === 'true') return true;
    } catch { /* malformed search string — fall through */ }
    try {
        if (storage && storage.getItem(DEBUG_FLAG_KEY) === '1') return true;
    } catch { /* storage may throw in privacy mode */ }
    return false;
}

class DebugMenuUI {
    /**
     * @param {Object} options
     * @param {HTMLElement} [options.container=document.body]
     * @param {Array<{id:string,label:string,isOn:function():boolean,setOn:function(boolean):void}>} [options.toggles]
     * @param {boolean} [options.enabled] - override the debug flag (mostly for tests)
     * @param {string} [options.revealKey='F1'] - key that shows/hides the menu
     */
    constructor(options = {}) {
        this.container = options.container || (typeof document !== 'undefined' ? document.body : null);
        this.enabled = options.enabled ?? isDebugEnabled();
        this.revealKey = options.revealKey || 'F1';
        this.toggles = [];
        this.visible = false;
        this.element = null;
        this._listEl = null;
        this._onKeyDown = this._onKeyDown.bind(this);
        (options.toggles || []).forEach((t) => this.registerToggle(t));
    }

    /**
     * Register a debug overlay toggle. Ignored (no throw) if malformed so a broken
     * overlay can't take the whole menu down.
     */
    registerToggle(toggle) {
        if (!toggle || typeof toggle.id !== 'string') return this;
        if (typeof toggle.isOn !== 'function' || typeof toggle.setOn !== 'function') return this;
        const existing = this.toggles.findIndex((t) => t.id === toggle.id);
        const entry = { id: toggle.id, label: toggle.label || toggle.id, isOn: toggle.isOn, setOn: toggle.setOn };
        if (existing >= 0) this.toggles[existing] = entry;
        else this.toggles.push(entry);
        if (this.element) this._renderRows();
        return this;
    }

    /** IDs of registered toggles, in order. */
    toggleIds() {
        return this.toggles.map((t) => t.id);
    }

    /** Flip one toggle by id; returns the new state (or null if unknown / disabled). */
    setToggle(id, on) {
        const entry = this.toggles.find((t) => t.id === id);
        if (!entry) return null;
        const next = typeof on === 'boolean' ? on : !entry.isOn();
        entry.setOn(next);
        if (this.element) this._renderRows();
        return next;
    }

    /** Current on/off state of a toggle by id (null if unknown). */
    isToggleOn(id) {
        const entry = this.toggles.find((t) => t.id === id);
        return entry ? !!entry.isOn() : null;
    }

    init() {
        if (!this.enabled || !this.container || typeof document === 'undefined') return this;
        this._createElements();
        if (typeof window !== 'undefined') window.addEventListener('keydown', this._onKeyDown);
        return this;
    }

    _onKeyDown(event) {
        if (event.key === this.revealKey) {
            event.preventDefault();
            this.toggleMenu();
        }
    }

    toggleMenu() { this.visible ? this.hide() : this.show(); }

    show() {
        if (!this.element) return;
        this.visible = true;
        this.element.classList.remove('hidden');
        this._renderRows();
    }

    hide() {
        if (!this.element) return;
        this.visible = false;
        this.element.classList.add('hidden');
    }

    _createElements() {
        let el = this.container.querySelector('#debug-menu');
        if (!el) {
            el = document.createElement('div');
            el.id = 'debug-menu';
            el.className = 'hidden';
            this.container.appendChild(el);
        }
        this.element = el;

        if (!document.querySelector('#debug-menu-styles')) {
            const style = document.createElement('style');
            style.id = 'debug-menu-styles';
            style.textContent = `
                #debug-menu {
                    position: fixed; top: 20px; right: 20px;
                    background: rgba(0,0,0,0.85); color: #7CF9FF;
                    font-family: var(--font-mono, monospace); font-size: 13px;
                    padding: 14px 16px; border: 2px solid #7CF9FF; border-radius: 6px;
                    z-index: 200; min-width: 240px;
                }
                #debug-menu.hidden { display: none; }
                #debug-menu .debug-menu-header { font-weight: bold; margin-bottom: 10px; letter-spacing: 1px; }
                #debug-menu .debug-menu-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; cursor: pointer; }
                #debug-menu .debug-menu-row input { cursor: pointer; }
                #debug-menu .debug-menu-empty { opacity: 0.6; font-style: italic; }
            `;
            document.head.appendChild(style);
        }

        const header = document.createElement('div');
        header.className = 'debug-menu-header';
        header.textContent = `Debug Menu (${this.revealKey})`;
        this.element.appendChild(header);

        this._listEl = document.createElement('div');
        this._listEl.className = 'debug-menu-list';
        this.element.appendChild(this._listEl);
        this._renderRows();
    }

    _renderRows() {
        if (!this._listEl) return;
        this._listEl.textContent = '';
        if (!this.toggles.length) {
            const empty = document.createElement('div');
            empty.className = 'debug-menu-empty';
            empty.textContent = 'No debug overlays registered';
            this._listEl.appendChild(empty);
            return;
        }
        for (const t of this.toggles) {
            const row = document.createElement('label');
            row.className = 'debug-menu-row';
            row.setAttribute('data-toggle-id', t.id);

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = !!t.isOn();
            box.setAttribute('data-toggle-checkbox', t.id);
            box.addEventListener('change', () => this.setToggle(t.id, box.checked));

            const text = document.createElement('span');
            text.textContent = t.label;

            row.appendChild(box);
            row.appendChild(text);
            this._listEl.appendChild(row);
        }
    }

    destroy() {
        if (typeof window !== 'undefined') window.removeEventListener('keydown', this._onKeyDown);
        if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
        this.element = null;
        this._listEl = null;
    }
}

export { DebugMenuUI, isDebugEnabled, DEBUG_FLAG_KEY };
export default DebugMenuUI;
