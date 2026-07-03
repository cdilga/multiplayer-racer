import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GrainOverlay } from '../../static/js/ui/GrainOverlay.js';

/**
 * br-skip-bin-arcade-design-language-5k3.25 slice A — GrainOverlay behavior.
 *
 * Proves the shared grain overlay: attaches a non-interactive element, toggles
 * on/off (reduce-effects), clamps intensity into a CSS var, detaches cleanly,
 * and never logs (no per-frame cost — animation is pure CSS).
 */

// Minimal fake DOM (no jsdom dependency).
function fakeElement() {
    const el = {
        className: '',
        attributes: {},
        dataset: {},
        parentNode: null,
        children: [],
        style: {
            _props: {},
            pointerEvents: '',
            setProperty(k, v) { this._props[k] = v; },
            getProperty(k) { return this._props[k]; }
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            child.parentNode = null;
            return child;
        }
    };
    return el;
}

function fakeDoc() {
    const body = fakeElement();
    return {
        body,
        createElement: () => fakeElement()
    };
}

describe('GrainOverlay — non-interactive attach/detach', () => {
    let doc;
    beforeEach(() => { doc = fakeDoc(); });

    it('attaches an overlay with the shared class and pointer-events:none', () => {
        const grain = new GrainOverlay({ doc });
        const el = grain.attach();
        expect(el).toBeTruthy();
        expect(el.className).toBe('sb-grain-overlay');
        expect(el.style.pointerEvents).toBe('none');   // never steals input
        expect(el.attributes['aria-hidden']).toBe('true');
        expect(doc.body.children).toContain(el);
    });

    it('attach is idempotent (does not stack overlays)', () => {
        const grain = new GrainOverlay({ doc });
        grain.attach();
        grain.attach();
        expect(doc.body.children.length).toBe(1);
    });

    it('detach removes the element from the DOM', () => {
        const grain = new GrainOverlay({ doc });
        grain.attach();
        grain.detach();
        expect(doc.body.children.length).toBe(0);
        expect(grain.element).toBeNull();
    });

    it('is a safe no-op without a document (headless / controller)', () => {
        const grain = new GrainOverlay({ doc: null });
        expect(grain.attach()).toBeNull();
    });
});

describe('GrainOverlay — reduce-effects toggle', () => {
    let doc;
    beforeEach(() => { doc = fakeDoc(); });

    it('setEnabled(false) marks the overlay disabled (CSS hides it)', () => {
        const grain = new GrainOverlay({ doc });
        grain.attach();
        grain.setEnabled(false);
        expect(grain.isEnabled()).toBe(false);
        expect(grain.element.dataset.enabled).toBe('false');
        grain.setEnabled(true);
        expect(grain.element.dataset.enabled).toBe('true');
    });

    it('prefersReducedMotion reads matchMedia and is false when unavailable', () => {
        expect(GrainOverlay.prefersReducedMotion({})).toBe(false);
        expect(GrainOverlay.prefersReducedMotion({
            matchMedia: (q) => ({ matches: q.includes('reduce') })
        })).toBe(true);
    });
});

describe('GrainOverlay — intensity clamps into the CSS var', () => {
    let doc;
    beforeEach(() => { doc = fakeDoc(); });

    it('clamps intensity to 0..1 and writes --sb-grain-opacity', () => {
        const grain = new GrainOverlay({ doc });
        grain.attach();
        grain.setIntensity(5);
        expect(grain.getIntensity()).toBe(1);
        expect(grain.element.style.getProperty('--sb-grain-opacity')).toBe('1');
        grain.setIntensity(-3);
        expect(grain.getIntensity()).toBe(0);
        grain.setIntensity(0.06);
        expect(grain.element.style.getProperty('--sb-grain-opacity')).toBe('0.06');
    });

    it('non-finite intensity coerces to 0', () => {
        const grain = new GrainOverlay({ doc, intensity: NaN });
        expect(grain.getIntensity()).toBe(0);
    });
});

describe('GrainOverlay — never logs (no per-frame cost)', () => {
    let log, warn, err;
    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        err = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('attach/toggle/intensity/detach produce zero console output', () => {
        const doc = fakeDoc();
        const grain = new GrainOverlay({ doc });
        grain.attach();
        for (let i = 0; i < 50; i++) grain.setIntensity(i / 50);
        grain.setEnabled(false);
        grain.setEnabled(true);
        grain.detach();
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
    });
});
