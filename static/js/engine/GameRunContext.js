/**
 * GameRunContext - the deterministic foundation every run is built on.
 *
 * It bundles the identity of a run (buildId, roomCode, topology, ruleset),
 * its deterministic seed and tuning, and the two time/randomness primitives:
 *
 *   - clock     : SimClock  (deterministic gameplay/replay time)
 *   - realClock : RealClock (wall time for rAF/UI/perf)
 *   - rng       : RngStreams (named, independent, seedable random streams)
 *
 * Seed policy:
 *   A seed is *required* for deterministic gameplay generation. When a test or
 *   replay harness asks for `deterministic: true`, omitting the seed throws -
 *   reproducibility would otherwise be a lie. In production (no harness), a
 *   context is still always created: if no seed is supplied one is generated
 *   from entropy and recorded with seedSource: 'generated', so the run can be
 *   reported and, if needed, reproduced later.
 *
 * Usage:
 *   import { GameRunContext } from './engine/GameRunContext.js';
 *
 *   // deterministic (tests / replay)
 *   const ctx = GameRunContext.create({ seed: 12345, ruleset: 'race', deterministic: true });
 *
 *   // production default (no harness)
 *   const ctx = GameRunContext.create({ buildId, roomCode, ruleset: 'derby', topology: 'local' });
 *
 *   ctx.stream('map').next();
 *   ctx.step();              // advance one fixed sim tick
 *   ctx.describe();          // loggable summary incl. tuningHash
 */

import { SimClock, RealClock, DEFAULT_FIXED_DT } from './Clock.js';
import { RngStreams, hashSeed } from './Rng.js';
import {
    ROOM_TOPOLOGIES,
    DEFAULT_TOPOLOGY,
    isValidTopology,
    DEFAULT_RULESET
} from './sessionVocabulary.js';

/**
 * Stable JSON stringify (sorted keys) so a tuning object always hashes the
 * same regardless of key insertion order.
 * @param {*} value
 * @returns {string}
 */
function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * Deterministic hash of a tuning profile, as an 8-char hex string so it reads
 * cleanly in logs/telemetry and changes whenever the profile or values change.
 * @param {string} profileId
 * @param {Object} [tuning]
 * @returns {string}
 */
function hashTuning(profileId, tuning) {
    const h = hashSeed(`${profileId || 'default'}|${stableStringify(tuning || {})}`);
    return h.toString(16).padStart(8, '0');
}

/**
 * Best-effort 32-bit entropy for production runs that don't supply a seed.
 * Deterministic code paths never reach this (they require an explicit seed).
 * @returns {number} uint32
 */
function defaultEntropy() {
    const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const d = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    const r = Math.random();
    return (Math.imul((d ^ Math.floor(t * 1000)) >>> 0, 2654435761) ^ Math.floor(r * 4294967296)) >>> 0;
}

class GameRunContext {
    /**
     * Prefer GameRunContext.create(); the constructor assumes a resolved seed.
     * @param {Object} options
     */
    constructor(options = {}) {
        this.buildId = options.buildId || 'dev';
        this.roomCode = options.roomCode != null ? options.roomCode : null;
        this.topology = options.topology || DEFAULT_TOPOLOGY;
        this.ruleset = options.ruleset != null ? options.ruleset : null;

        this.seed = options.seed >>> 0;
        this.seedSource = options.seedSource || 'provided';
        this.deterministic = options.deterministic === true;

        this.fixedDt = options.fixedDt || DEFAULT_FIXED_DT;

        this.tuningProfileId = options.tuningProfileId || 'default';
        this.tuning = options.tuning || {};
        this.tuningHash = options.tuningHash || hashTuning(this.tuningProfileId, this.tuning);

        this.clock = options.clock || new SimClock({
            fixedDt: this.fixedDt,
            startMs: options.startMs || 0,
            startTick: options.startTick || 0
        });
        this.realClock = options.realClock || new RealClock({ now: options.now });
        this.rng = options.rng || new RngStreams(this.seed, options.streamNames);
    }

    /**
     * Build a run context, applying the seed policy described in the file header.
     * @param {Object} [options]
     * @param {number} [options.seed] - required when deterministic is true
     * @param {boolean} [options.deterministic=false] - test/replay harness mode
     * @param {function(): number} [options.entropy] - seed source for production
     * @param {string} [options.buildId]
     * @param {string|null} [options.roomCode]
     * @param {('local'|'remote'|'mixed')} [options.topology='local']
     * @param {string|null} [options.ruleset]
     * @param {number} [options.fixedDt=1/60]
     * @param {string} [options.tuningProfileId]
     * @param {Object} [options.tuning]
     * @returns {GameRunContext}
     */
    static create(options = {}) {
        const deterministic = options.deterministic === true;

        if (options.topology != null && !isValidTopology(options.topology)) {
            throw new Error(
                `GameRunContext: unknown topology '${options.topology}' (expected ${ROOM_TOPOLOGIES.join('/')})`
            );
        }

        let seed = options.seed;
        let seedSource;

        if (seed === undefined || seed === null) {
            if (deterministic) {
                throw new Error(
                    'GameRunContext: seed is required for deterministic gameplay generation ' +
                    '(test/replay harness). Pass options.seed.'
                );
            }
            const entropy = typeof options.entropy === 'function' ? options.entropy : defaultEntropy;
            seed = entropy() >>> 0;
            seedSource = 'generated';
        } else {
            if (!Number.isFinite(seed)) {
                throw new Error(`GameRunContext: seed must be a finite number, got ${seed}`);
            }
            seed = seed >>> 0;
            seedSource = 'provided';
        }

        return new GameRunContext({ ...options, seed, seedSource, deterministic });
    }

    /** @returns {number} current sim tick */
    get tick() {
        return this.clock.tick;
    }

    /** @returns {number} current deterministic sim time in ms */
    get simTimeMs() {
        return this.clock.simTimeMs;
    }

    /**
     * Advance the deterministic sim clock by whole fixed steps.
     * @param {number} [steps=1]
     * @returns {{tick: number, simTimeMs: number, dt: number}}
     */
    step(steps = 1) {
        return this.clock.step(steps);
    }

    /**
     * Shorthand for ctx.rng.stream(name).
     * @param {string} name
     * @returns {import('./Rng.js').RngStream}
     */
    stream(name) {
        return this.rng.stream(name);
    }

    /**
     * A loggable / telemetry-friendly summary of the run (no live objects).
     * @returns {Object}
     */
    describe() {
        return {
            buildId: this.buildId,
            roomCode: this.roomCode,
            topology: this.topology,
            ruleset: this.ruleset,
            seed: this.seed,
            seedSource: this.seedSource,
            deterministic: this.deterministic,
            fixedDt: this.fixedDt,
            tick: this.tick,
            simTimeMs: this.simTimeMs,
            tuningProfileId: this.tuningProfileId,
            tuningHash: this.tuningHash
        };
    }

    /** @returns {Object} same as describe() */
    toJSON() {
        return this.describe();
    }
}

export { GameRunContext, hashTuning, stableStringify, defaultEntropy };

// Non-module global fallback (matches the rest of the engine).
if (typeof window !== 'undefined') {
    window.GameRunContext = GameRunContext;
}
