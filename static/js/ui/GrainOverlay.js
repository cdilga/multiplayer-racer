/**
 * GrainOverlay — shared camcorder film-grain DOM overlay (Skip Bin Arcade).
 *
 * br-skip-bin-arcade-design-language-5k3.25 (P5.1) slice A. This is the DOM
 * counterpart of the WebGL film grain shipped in 5k3.8: a single full-frame
 * overlay so the DOM UI reads as if it is *inside the camcorder*, coherent with
 * the rendered world.
 *
 * Contract:
 *   - `pointer-events: none` — it NEVER steals touch/mouse input (controller
 *     latency and HUD interactivity are unaffected).
 *   - Sits above the world canvas but below interactive HUD (z-index 40; HUD
 *     uses higher z). Purely presentational.
 *   - Reduce-effects / a11y aware: `prefers-reduced-motion` stops the animation
 *     (CSS), and `setEnabled(false)` / the `.reduce-effects` root class removes
 *     it entirely.
 *   - Animation is CSS `steps()` only — NO requestAnimationFrame, NO per-frame
 *     logging, zero per-frame JS cost.
 *
 * All styling lives in the shared CSS (`.sb-grain-overlay` in host/player/
 * landing.css); this module only creates/toggles the element and its knobs.
 *
 * Usage:
 *   import { GrainOverlay } from './ui/GrainOverlay.js';
 *   const grain = new GrainOverlay();
 *   grain.attach();                 // adds the overlay to <body>
 *   grain.setIntensity(0.06);
 *   if (GrainOverlay.prefersReducedMotion()) grain.setEnabled(false);
 */

const OVERLAY_CLASS = 'sb-grain-overlay';
const DEFAULT_INTENSITY = 0.06;

export class GrainOverlay {
    /**
     * @param {Object} [options]
     * @param {Document} [options.doc] - Document to operate on (injectable for tests).
     * @param {number} [options.intensity] - Initial 0..1 grain opacity.
     * @param {string} [options.className] - Overlay class (defaults to `sb-grain-overlay`).
     */
    constructor(options = {}) {
        this.doc = options.doc || (typeof document !== 'undefined' ? document : null);
        this.className = options.className || OVERLAY_CLASS;
        this.intensity = clamp01(options.intensity == null ? DEFAULT_INTENSITY : options.intensity);
        this.enabled = true;
        this.element = null;
    }

    /**
     * Create + insert the overlay element. Idempotent. No-op without a document.
     * @param {HTMLElement} [target] - Defaults to `document.body`.
     * @returns {HTMLElement|null} the overlay element (or null when headless).
     */
    attach(target) {
        if (!this.doc || typeof this.doc.createElement !== 'function') return null;
        if (this.element) return this.element;

        const host = target || this.doc.body;
        if (!host || typeof host.appendChild !== 'function') return null;

        const el = this.doc.createElement('div');
        el.className = this.className;
        // Belt-and-braces: enforce the no-input contract even if CSS is missing.
        if (el.style) el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
        el.dataset.enabled = String(this.enabled);
        this.element = el;
        this._applyIntensity();
        host.appendChild(el);
        return el;
    }

    /** Remove the overlay from the DOM. */
    detach() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        return this;
    }

    /**
     * Enable/disable the overlay. Disabled => hidden via `data-enabled="false"`
     * (the CSS hides it). Use for reduce-effects / manual off.
     * @param {boolean} on
     */
    setEnabled(on) {
        this.enabled = !!on;
        if (this.element) this.element.dataset.enabled = String(this.enabled);
        return this;
    }

    /** @returns {boolean} whether the overlay is currently enabled. */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Set grain strength (0..1). 0 is effectively invisible; the overlay stays
     * in the DOM but contributes nothing (reduce-effects can also fully disable).
     * @param {number} value
     */
    setIntensity(value) {
        this.intensity = clamp01(value);
        this._applyIntensity();
        return this;
    }

    /** @returns {number} the current 0..1 grain intensity. */
    getIntensity() {
        return this.intensity;
    }

    /** @private */
    _applyIntensity() {
        if (this.element && this.element.style && typeof this.element.style.setProperty === 'function') {
            this.element.style.setProperty('--sb-grain-opacity', String(this.intensity));
        }
    }

    /**
     * True when the environment asks for reduced motion (a11y). Callers use this
     * to `setEnabled(false)`.
     * @param {Window} [win]
     * @returns {boolean}
     */
    static prefersReducedMotion(win) {
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!w || typeof w.matchMedia !== 'function') return false;
        try {
            return !!w.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) {
            return false;
        }
    }
}

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

// Non-module global for parity with the other UI modules' load pattern.
if (typeof window !== 'undefined') {
    window.GrainOverlay = GrainOverlay;
}
