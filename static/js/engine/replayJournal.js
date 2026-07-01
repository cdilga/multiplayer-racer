/**
 * replayJournal - deterministic command/event journal + snapshotter.
 *
 * The operational foundation for br-around-couch-risk-resolution-3xv.10: it turns
 * the deterministic GameRunContext (.5) + named RNG streams (.6) into a recordable
 * journal that a headless replay, a soak harness, and bug reports can consume.
 *
 * A journal captures:
 *   - the initial run context (buildId, seed, ruleset, topology, tuningHash, fixedDt)
 *     and the room config,
 *   - ordered control commands and host events (monotonic seq, per-tick),
 *   - per-stream RNG draw counters at each snapshot,
 *   - periodic quantized state hashes (float noise removed) so replays can report
 *     the first divergent tick.
 *
 * PURE + deterministic: no time, no globals, no THREE/Rapier/socket. Secrets
 * (host/seat tokens, passwords) are redacted before they ever enter the journal,
 * so it is privacy-safe for bug reports.
 *
 * Usage:
 *   import { ReplayJournal } from './engine/replayJournal.js';
 *   const journal = new ReplayJournal(runContext, { roomConfig });
 *   journal.recordCommand(tick, seatId, { steering, acceleration });
 *   journal.recordEvent(tick, 'race:start', { laps: 3 });
 *   journal.snapshot(tick, worldState);
 *   const data = journal.toJSON(); // safe to persist / attach to a bug report
 */

import { hashSeed, DEFAULT_STREAMS } from './Rng.js';
import { stableStringify } from './GameRunContext.js';

/** Bump when the on-disk journal shape changes. */
export const JOURNAL_SCHEMA_VERSION = 1;

/** Keys that must never be written into a journal (redacted to a marker). */
export const REDACTED_KEYS = Object.freeze([
    'host_token', 'hostToken',
    'seat_token', 'seatToken', 'seatTokenHash',
    'registration_token', 'registrationToken',
    'token', 'secret', 'password', 'authorization'
]);

const REDACTION_MARKER = '[REDACTED]';

/**
 * Deep-copy `value`, replacing any REDACTED_KEYS with a marker. Returns a plain
 * JSON-safe structure (functions/undefined dropped).
 * @param {*} value
 * @returns {*}
 */
export function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = REDACTED_KEYS.includes(key) ? REDACTION_MARKER : redact(value[key]);
        }
        return out;
    }
    return value;
}

/**
 * Deep-quantize numbers to `precision` steps so sub-quantum float noise does not
 * perturb a snapshot hash. Non-numbers pass through.
 * @param {*} value
 * @param {number} [precision=1000] - reciprocal of the quantum (1000 => 1e-3)
 * @returns {*}
 */
export function quantize(value, precision = 1000) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return value; // preserve NaN/Inf so replays can flag them
        return Math.round(value * precision) / precision;
    }
    if (Array.isArray(value)) return value.map((v) => quantize(v, precision));
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) out[key] = quantize(value[key], precision);
        return out;
    }
    return value;
}

/**
 * 8-char hex digest of a quantized, stably-stringified value.
 * @param {*} value
 * @param {number} [precision=1000]
 * @returns {string}
 */
export function quantizedHash(value, precision = 1000) {
    return hashSeed(stableStringify(quantize(value, precision))).toString(16).padStart(8, '0');
}

export class ReplayJournal {
    /**
     * @param {import('./GameRunContext.js').GameRunContext} [context] - the run context (for identity + RNG counters)
     * @param {Object} [options]
     * @param {Object} [options.roomConfig] - room/tuning config to record (redacted)
     * @param {number} [options.quantizePrecision=1000] - snapshot hash quantization
     */
    constructor(context = null, options = {}) {
        const described = context && typeof context.describe === 'function' ? context.describe() : {};
        this.schemaVersion = JOURNAL_SCHEMA_VERSION;
        this.quantizePrecision = options.quantizePrecision || 1000;

        // Redacted run identity (never includes tokens/secrets).
        this.context = redact({
            buildId: described.buildId ?? null,
            seed: described.seed ?? null,
            ruleset: described.ruleset ?? null,
            topology: described.topology ?? null,
            tuningProfileId: described.tuningProfileId ?? null,
            tuningHash: described.tuningHash ?? null,
            fixedDt: described.fixedDt ?? null,
            deterministic: described.deterministic ?? null
        });
        this.roomConfig = redact(options.roomConfig || {});

        // The RngStreams to read draw counters from (never persisted directly).
        this._rng = context && context.rng ? context.rng : null;

        this.entries = [];   // ordered { seq, tick, type:'command'|'event', ... }
        this.snapshots = []; // { seq, tick, stateHash, drawCounters }
        this._seq = 0;
    }

    /**
     * Record a control command for a seat at a tick (redacted, ordered).
     * @param {number} tick
     * @param {string|number} seatId
     * @param {Object} command
     * @returns {ReplayJournal} this
     */
    recordCommand(tick, seatId, command = {}) {
        this._append({ type: 'command', tick, seatId, command: redact(command) });
        return this;
    }

    /**
     * Record a host/game event at a tick (redacted, ordered).
     * @param {number} tick
     * @param {string} name
     * @param {Object} [data]
     * @returns {ReplayJournal} this
     */
    recordEvent(tick, name, data = {}) {
        this._append({ type: 'event', tick, name, data: redact(data) });
        return this;
    }

    /** @private */
    _append(entry) {
        this.entries.push({ seq: this._seq++, ...entry });
    }

    /**
     * Per-stream RNG draw counts for streams that have actually been drawn from.
     * Does NOT instantiate unused streams (avoids side effects / phantom streams).
     * @returns {Object<string, number>}
     */
    drawCounters() {
        const counters = {};
        if (!this._rng) return counters;
        const names = typeof this._rng.names === 'function' ? this._rng.names() : DEFAULT_STREAMS;
        for (const name of names) {
            if (typeof this._rng.has === 'function' && !this._rng.has(name)) continue;
            const state = this._rng.stream(name).getState();
            counters[name] = state.count;
        }
        return counters;
    }

    /**
     * Record a periodic snapshot: a quantized state hash + current RNG draw
     * counters. Two runs that diverge will produce a different stateHash at the
     * first divergent tick, which a replay can report.
     * @param {number} tick
     * @param {*} state - the world/sim state to hash (quantized)
     * @returns {{seq:number, tick:number, stateHash:string, drawCounters:Object}}
     */
    snapshot(tick, state = {}) {
        const snap = {
            seq: this._seq++,
            tick,
            stateHash: quantizedHash(state, this.quantizePrecision),
            drawCounters: this.drawCounters()
        };
        this.snapshots.push(snap);
        return snap;
    }

    /** @returns {number} number of recorded entries */
    get length() {
        return this.entries.length;
    }

    /**
     * The full, JSON-safe, redacted journal (safe to persist / attach to a bug report).
     * @returns {Object}
     */
    toJSON() {
        return {
            schemaVersion: this.schemaVersion,
            context: this.context,
            roomConfig: this.roomConfig,
            entries: this.entries,
            snapshots: this.snapshots
        };
    }

    /**
     * A compact excerpt (for bug reports): identity + the last N entries + the
     * latest snapshot. Redaction already applied at record time.
     * @param {number} [maxEntries=20]
     * @returns {Object}
     */
    excerpt(maxEntries = 20) {
        return {
            schemaVersion: this.schemaVersion,
            context: this.context,
            recentEntries: this.entries.slice(-Math.max(0, maxEntries)),
            latestSnapshot: this.snapshots.length ? this.snapshots[this.snapshots.length - 1] : null,
            totalEntries: this.entries.length,
            totalSnapshots: this.snapshots.length
        };
    }
}

// Non-module global fallback (matches the rest of the engine).
if (typeof window !== 'undefined') {
    window.ReplayJournal = ReplayJournal;
}
