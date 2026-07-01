import { describe, it, expect } from 'vitest';
import {
    validateFiniteControls,
    canonicalizeName,
    validateColor,
    validateAppearance,
    resolveWeaponId,
    RateLimiter,
    WEAPON_WHITELIST,
    DEFAULT_COLOR,
    DEFAULT_NAME,
} from '../../static/js/engine/controllerValidation.js';
import { sanitizeDisplayString, escapeHtml } from '../../static/js/debug/SafeTextRenderer.js';

/**
 * Seat input ownership + abuse-control contract (3xv.4).
 *
 * These exercise the SAME pure validators the server enforces
 * (server/input_safety.py) so the client and server agree on: finite control
 * validation, cooldown/rate limits, appearance schema, whitelist weapon ids,
 * and safe text for player/model/weapon/debug labels. No socket globals.
 */
describe('controller ownership - finite control validation', () => {
    it('clamps in-range finite controls', () => {
        expect(validateFiniteControls({ steering: 0.5, acceleration: 0.2, braking: 0 }))
            .toEqual({ steering: 0.5, acceleration: 0.2, braking: 0 });
    });

    it('clamps out-of-range values into their axis ranges', () => {
        const out = validateFiniteControls({ steering: 5, acceleration: 9, braking: -3 });
        expect(out).toEqual({ steering: 1, acceleration: 1, braking: 0 });
    });

    it('drops the whole update when any axis is NaN or Infinity', () => {
        expect(validateFiniteControls({ steering: NaN, acceleration: 0, braking: 0 })).toBeNull();
        expect(validateFiniteControls({ steering: 0, acceleration: Infinity, braking: 0 })).toBeNull();
        expect(validateFiniteControls({ steering: 0, acceleration: 0, braking: -Infinity })).toBeNull();
        expect(validateFiniteControls({ steering: 'not-a-number', acceleration: 0, braking: 0 })).toBeNull();
    });

    it('defaults missing axes to 0 and rejects non-objects', () => {
        expect(validateFiniteControls({})).toEqual({ steering: 0, acceleration: 0, braking: 0 });
        expect(validateFiniteControls(null)).toBeNull();
        expect(validateFiniteControls('steering=1')).toBeNull();
    });
});

describe('controller ownership - appearance schema', () => {
    it('canonicalizes names: trims, collapses whitespace, caps length', () => {
        expect(canonicalizeName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
        expect(canonicalizeName('a'.repeat(50)).length).toBe(20);
    });

    it('strips control chars and falls back to default when empty', () => {
        expect(canonicalizeName("\u0000\u0007\u200b")).toBe(DEFAULT_NAME);
        expect(canonicalizeName('hi\u200bthere')).toBe('hithere'); // ZWSP stripped
        expect(canonicalizeName('word\tword')).toBe('wordword'); // tab is a control char -> stripped
        expect(canonicalizeName('a b   c')).toBe('a b c'); // real spaces collapse but survive
        expect(canonicalizeName(12345)).toBe(DEFAULT_NAME);
    });

    it('an XSS-looking name is preserved as literal text (rendering escapes it)', () => {
        // The canonical value keeps the characters (they are harmless as data);
        // the safety guarantee is that it renders as literal text, never markup.
        const evil = '<img src=x onerror=alert(1)>';
        const name = canonicalizeName(evil);
        expect(name).toContain('<img');
        // Rendering path escapes every markup-significant char.
        const escaped = escapeHtml(name);
        expect(escaped).not.toContain('<img');
        expect(escaped).toContain('&lt;img');
        // sanitizeDisplayString is safe to feed the same value.
        expect(typeof sanitizeDisplayString(evil)).toBe('string');
    });

    it('validates color to hex-or-default (no arbitrary CSS)', () => {
        expect(validateColor('#FFAA00')).toBe('#ffaa00');
        expect(validateColor('#abc')).toBe('#abc');
        expect(validateColor('red; background:url(x)')).toBe(DEFAULT_COLOR);
        expect(validateColor('javascript:alert(1)')).toBe(DEFAULT_COLOR);
        expect(validateColor(null)).toBe(DEFAULT_COLOR);
    });

    it('validateAppearance returns a canonical {name,color}', () => {
        expect(validateAppearance({ name: '  Bo  ', color: '#00FF88' }))
            .toEqual({ name: 'Bo', color: '#00ff88' });
        expect(validateAppearance('garbage')).toEqual({ name: DEFAULT_NAME, color: DEFAULT_COLOR });
    });
});

describe('controller ownership - weapon whitelist', () => {
    it('resolves every whitelisted id (case/space-insensitive)', () => {
        for (const w of WEAPON_WHITELIST) {
            expect(resolveWeaponId(w)).toBe(w);
            expect(resolveWeaponId(`  ${w.toUpperCase()} `)).toBe(w);
        }
    });

    it('rejects unknown / forged weapon ids', () => {
        expect(resolveWeaponId('nuke')).toBeNull();
        expect(resolveWeaponId('missile; drop table')).toBeNull();
        expect(resolveWeaponId('')).toBeNull();
        expect(resolveWeaponId(42)).toBeNull();
        expect(resolveWeaponId(null)).toBeNull();
    });
});

describe('controller ownership - rate limiting (deterministic clock)', () => {
    it('allows once per interval per key, blocks spam in between', () => {
        let t = 1000;
        const rl = new RateLimiter(500, { clock: () => t });

        expect(rl.allow('fire')).toBe(true);   // t=1000 first
        expect(rl.allow('fire')).toBe(false);  // t=1000 within cooldown
        t = 1400;
        expect(rl.allow('fire')).toBe(false);  // 400ms < 500ms
        t = 1500;
        expect(rl.allow('fire')).toBe(true);   // 500ms elapsed
    });

    it('tracks cooldowns per key independently', () => {
        let t = 0;
        const rl = new RateLimiter(1000, { clock: () => t });
        expect(rl.allow('seat-1:fire')).toBe(true);
        expect(rl.allow('seat-2:fire')).toBe(true);   // different key, not blocked
        expect(rl.allow('seat-1:fire')).toBe(false);  // seat-1 still cooling down
    });

    it('accepts an explicit now and supports reset', () => {
        const rl = new RateLimiter(100);
        expect(rl.allow('reset', 0)).toBe(true);
        expect(rl.allow('reset', 50)).toBe(false);
        rl.reset('reset');
        expect(rl.allow('reset', 50)).toBe(true);
    });
});
