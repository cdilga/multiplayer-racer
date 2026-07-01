/**
 * controllerValidation - pure, testable input-safety helpers (3xv.4).
 *
 * The JS mirror of server/input_safety.py. Same canonical contract for
 * untrusted controller payloads so the client can pre-canonicalize and the
 * server can enforce, and both agree:
 *
 *  - validateFiniteControls(controls): drop NaN/Infinity, clamp ranges, or null
 *  - canonicalizeName(raw): NFKC + strip control chars + collapse ws + cap length
 *  - validateColor / validateAppearance: hex-or-default color + name schema
 *  - resolveWeaponId(raw): whitelist wire weapon ids (unknown -> null)
 *  - RateLimiter: deterministic per-key cooldown (fire/reset/name spam)
 *
 * Pure (no DOM, no globals); the safe-RENDER contract lives in
 * static/js/debug/SafeTextRenderer.js. This guards the canonical VALUES.
 */

export const WEAPON_WHITELIST = Object.freeze([
    'missile', 'mine', 'boost', 'oil_slick',
    'sniper', 'shield', 'emp', 'flamethrower',
]);

const WEAPON_SET = new Set(WEAPON_WHITELIST);

export const DEFAULT_COLOR = '#4cc9f0';
export const DEFAULT_NAME = 'Player';
export const NAME_MAX_LENGTH = 20;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// Unicode control + format characters (category C*). Uses the \p{C} property.
const CONTROL_CHAR_RE = /\p{C}/gu;

const CONTROL_RANGES = {
    steering: [-1, 1],
    acceleration: [0, 1],
    braking: [0, 1],
};

/**
 * Return a clamped {steering, acceleration, braking}, or null if any axis is
 * non-numeric or non-finite (NaN/Infinity). Missing axes default to 0.
 * @param {*} controls
 * @returns {{steering:number,acceleration:number,braking:number}|null}
 */
export function validateFiniteControls(controls) {
    if (!controls || typeof controls !== 'object') return null;
    const out = {};
    for (const [key, [lo, hi]] of Object.entries(CONTROL_RANGES)) {
        const raw = key in controls ? controls[key] : 0;
        const val = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(val)) return null;
        out[key] = Math.max(lo, Math.min(hi, val));
    }
    return out;
}

/**
 * Server-canonical display name: NFKC, strip control/format chars, collapse
 * whitespace, trim, cap length; fall back to default when empty.
 * @param {*} raw
 * @param {{maxLength?:number, default?:string}} [opts]
 * @returns {string}
 */
export function canonicalizeName(raw, opts = {}) {
    const maxLength = opts.maxLength ?? NAME_MAX_LENGTH;
    const fallback = opts.default ?? DEFAULT_NAME;
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.normalize('NFKC').replace(CONTROL_CHAR_RE, '');
    const collapsed = normalized.replace(/\s+/g, ' ').trim();
    const capped = collapsed.slice(0, maxLength).trim();
    return capped || fallback;
}

/**
 * Accept only #rgb / #rrggbb hex; otherwise the default (no arbitrary CSS).
 * @param {*} raw
 * @param {{default?:string}} [opts]
 * @returns {string}
 */
export function validateColor(raw, opts = {}) {
    const fallback = opts.default ?? DEFAULT_COLOR;
    if (typeof raw === 'string') {
        const candidate = raw.trim();
        if (HEX_COLOR_RE.test(candidate)) return candidate.toLowerCase();
    }
    return fallback;
}

/**
 * Canonical {name, color} appearance schema from an untrusted payload.
 * @param {*} raw
 * @returns {{name:string, color:string}}
 */
export function validateAppearance(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return { name: canonicalizeName(data.name), color: validateColor(data.color) };
}

/**
 * Return the canonical whitelisted weapon id, or null if not allowed.
 * @param {*} raw
 * @returns {string|null}
 */
export function resolveWeaponId(raw) {
    if (typeof raw !== 'string') return null;
    const key = raw.trim().toLowerCase();
    return WEAPON_SET.has(key) ? key : null;
}

/**
 * Minimal per-key cooldown limiter on an injectable clock. allow(key, now)
 * returns true at most once per minIntervalMs per key. Deterministic: pass an
 * explicit `now` (ms) or inject a clock in tests instead of using Date.now.
 */
export class RateLimiter {
    constructor(minIntervalMs, { clock } = {}) {
        this.minIntervalMs = Number(minIntervalMs);
        this._last = new Map();
        this._clock = clock || (() => Date.now());
    }

    allow(key, now) {
        const current = now === undefined ? this._clock() : Number(now);
        const last = this._last.get(key);
        if (last !== undefined && current - last < this.minIntervalMs) return false;
        this._last.set(key, current);
        return true;
    }

    reset(key) {
        if (key === undefined) this._last.clear();
        else this._last.delete(key);
    }
}
