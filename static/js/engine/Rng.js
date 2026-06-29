/**
 * Rng - Deterministic, named random number streams for the run context.
 *
 * Why this exists:
 *   Gameplay generation (maps, spawns, weapons, bots, effects, ...) must be
 *   reproducible from a single run seed AND independent per system, so that a
 *   change in one system's draw order can never perturb another system's
 *   results. We get that by deriving each named stream's seed from
 *   (rootSeed, streamName) instead of sharing one global generator. Child keys
 *   derive further independent sub-streams from (streamSeed, key), so even
 *   inside a stream two subsystems do not interfere.
 *
 * Algorithm:
 *   - mulberry32 PRNG (same family already used by ProceduralTrackGenerator).
 *   - xmur3 string hash to turn "rootSeed:streamName" / "streamSeed:>childKey"
 *     into a well-mixed 32-bit seed.
 *
 * Usage:
 *   import { RngStreams } from './engine/Rng.js';
 *   const rng = new RngStreams(12345);
 *   rng.stream('map').next();        // [0, 1)
 *   rng.gameplay.int(1, 6);          // dice roll, inclusive
 *   rng.spawn.child('player:3').next();
 */

/**
 * The canonical gameplay RNG streams. Each is independently seeded from the
 * run seed, so drawing from one never advances another.
 * @type {ReadonlyArray<string>}
 */
const DEFAULT_STREAMS = Object.freeze([
    'map',
    'spawn',
    'weapons',
    'gameplay',
    'bots',
    'effects',
    'cosmetics',
    'lab'
]);

/**
 * xmur3 string hash - produces a deterministic 32-bit seed from a string.
 * @param {string} str
 * @returns {function(): number} generator of successive 32-bit hash values
 */
function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

/**
 * Deterministic 32-bit seed from any string.
 * @param {string} str
 * @returns {number} uint32
 */
function hashSeed(str) {
    return xmur3(String(str))();
}

/**
 * A single deterministic random stream (mulberry32). Holds its own state, so
 * it can be serialized for replay via getState/setState.
 */
class RngStream {
    /**
     * @param {number} seed - 32-bit seed for this stream
     * @param {string} [label] - human-readable label for debugging
     */
    constructor(seed, label = '') {
        this.seed = seed >>> 0;
        this.label = label;
        this._a = this.seed;
        this._count = 0;
    }

    /**
     * Advance the generator and return the raw 32-bit value.
     * @returns {number} uint32
     * @private
     */
    _nextU32() {
        let a = this._a;
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        this._a = a;
        this._count++;
        return (t ^ (t >>> 14)) >>> 0;
    }

    /**
     * Next float in [0, 1).
     * @returns {number}
     */
    next() {
        return this._nextU32() / 4294967296;
    }

    /**
     * Next raw 32-bit unsigned integer.
     * @returns {number}
     */
    nextU32() {
        return this._nextU32();
    }

    /**
     * Float in [min, max).
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    range(min, max) {
        return min + (max - min) * this.next();
    }

    /**
     * Integer in [min, max] inclusive.
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    int(min, max) {
        const lo = Math.ceil(min);
        const hi = Math.floor(max);
        if (hi < lo) return lo;
        return lo + Math.floor(this.next() * (hi - lo + 1));
    }

    /**
     * Boolean with probability p of being true.
     * @param {number} [p=0.5]
     * @returns {boolean}
     */
    bool(p = 0.5) {
        return this.next() < p;
    }

    /**
     * Pick a random element from a non-empty array.
     * @template T
     * @param {T[]} arr
     * @returns {T|undefined}
     */
    pick(arr) {
        if (!arr || arr.length === 0) return undefined;
        return arr[this.int(0, arr.length - 1)];
    }

    /**
     * In-place Fisher-Yates shuffle using this stream.
     * @template T
     * @param {T[]} arr
     * @returns {T[]} the same array, shuffled
     */
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    /**
     * Derive an independent child stream from a key. The child seed depends
     * only on (this.seed, key) - NOT on how many values this stream has drawn -
     * so child streams are stable regardless of parent draw order.
     * @param {string|number} key
     * @returns {RngStream}
     */
    child(key) {
        return new RngStream(
            hashSeed(`${this.seed}:>${key}`),
            this.label ? `${this.label}/${key}` : String(key)
        );
    }

    /**
     * Serializable state snapshot (for replay).
     * @returns {{seed: number, a: number, count: number, label: string}}
     */
    getState() {
        return { seed: this.seed, a: this._a, count: this._count, label: this.label };
    }

    /**
     * Restore from a snapshot produced by getState. Restores the seed and label
     * too (not just the accumulator), so a restored stream is self-sufficient:
     * a later reset()/clone() reproduces the serialized stream, not whatever
     * seed this instance was constructed with. Missing fields fall back to the
     * current values (tolerates older/partial snapshots).
     * @param {{a?: number, count?: number, seed?: number, label?: string}} state
     * @returns {RngStream} this
     */
    setState(state) {
        if (!state) return this;
        if (Number.isFinite(state.seed)) this.seed = state.seed >>> 0;
        if (typeof state.label === 'string') this.label = state.label;
        this._a = Number.isFinite(state.a) ? state.a >>> 0 : this.seed;
        this._count = state.count || 0;
        return this;
    }

    /**
     * Reset the stream back to its initial seed.
     * @returns {RngStream} this
     */
    reset() {
        this._a = this.seed;
        this._count = 0;
        return this;
    }

    /**
     * A fresh stream with the same seed and no draws.
     * @returns {RngStream}
     */
    clone() {
        return new RngStream(this.seed, this.label);
    }
}

/**
 * A set of named, independently-seeded RngStreams derived from one run seed.
 * Default stream names are exposed as lazy getters (e.g. `streams.gameplay`).
 */
class RngStreams {
    /**
     * @param {number} seed - the run seed
     * @param {string[]} [names=DEFAULT_STREAMS] - stream names to expose as getters
     */
    constructor(seed, names = DEFAULT_STREAMS) {
        this.seed = seed >>> 0;
        this._names = names.slice();
        this._streams = new Map();

        for (const name of this._names) {
            // Skip names that would clobber methods/fields.
            if (name in this) continue;
            Object.defineProperty(this, name, {
                get: () => this.stream(name),
                enumerable: true
            });
        }
    }

    /**
     * Get (creating on first use) the stream for a name. Its seed is derived
     * from (this.seed, name), so streams never share generator state.
     * @param {string} name
     * @returns {RngStream}
     */
    stream(name) {
        let s = this._streams.get(name);
        if (!s) {
            s = new RngStream(hashSeed(`${this.seed}:${name}`), name);
            this._streams.set(name, s);
        }
        return s;
    }

    /**
     * @param {string} name
     * @returns {boolean} whether a stream has been instantiated
     */
    has(name) {
        return this._streams.has(name);
    }

    /**
     * @returns {string[]} the declared stream names
     */
    names() {
        return this._names.slice();
    }

    /**
     * Reset every instantiated stream to its seed.
     * @returns {RngStreams} this
     */
    reset() {
        for (const s of this._streams.values()) s.reset();
        return this;
    }

    /**
     * Serializable state of all instantiated streams (for replay).
     * @returns {{seed: number, streams: Object<string, object>}}
     */
    getState() {
        const streams = {};
        for (const [name, s] of this._streams.entries()) {
            streams[name] = s.getState();
        }
        return { seed: this.seed, streams };
    }

    /**
     * Restore stream states from a getState snapshot.
     * @param {{streams: Object<string, object>}} state
     * @returns {RngStreams} this
     */
    setState(state) {
        if (!state || !state.streams) return this;
        for (const [name, snap] of Object.entries(state.streams)) {
            this.stream(name).setState(snap);
        }
        return this;
    }
}

export { RngStream, RngStreams, hashSeed, mulberry32Stream, DEFAULT_STREAMS };

/**
 * Convenience: a bare RngStream from a numeric seed (mulberry32 family).
 * @param {number} seed
 * @param {string} [label]
 * @returns {RngStream}
 */
function mulberry32Stream(seed, label) {
    return new RngStream(seed >>> 0, label);
}

// Non-module global fallback (matches the rest of the engine).
if (typeof window !== 'undefined') {
    window.RngStream = RngStream;
    window.RngStreams = RngStreams;
}
