/**
 * Clock - Two distinct notions of time for the run context.
 *
 *   SimClock  - fixed-step, deterministic time for gameplay, tests and replay.
 *               Advances only when you call step(). simTimeMs is derived from
 *               the tick count, so it never drifts relative to the simulation.
 *
 *   RealClock - wall-clock time for rAF / UI / perf measurement. Reads an
 *               injectable `now()` (defaults to performance.now / Date.now),
 *               so it is the ONLY place non-deterministic time enters gameplay
 *               code paths.
 *
 * Rule of thumb (see bead acceptance "Scope guard"):
 *   gameplay timers + generation -> SimClock; UI/perf timing -> RealClock.
 *
 * Usage:
 *   import { SimClock, RealClock } from './engine/Clock.js';
 *   const sim = new SimClock({ fixedDt: 1/60 });
 *   sim.step();            // advance one tick
 *   sim.nowMs();           // deterministic sim time in ms
 *
 *   const real = new RealClock();
 *   real.elapsedMs();      // wall time since construction
 */

const DEFAULT_FIXED_DT = 1 / 60;

/**
 * Default wall-clock reader: monotonic performance.now when available, else
 * Date.now. Used by RealClock when no `now` is injected.
 * @returns {number} milliseconds
 */
function defaultNow() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

/**
 * Fixed-step deterministic clock. Gameplay/tests/replay advance it explicitly.
 */
class SimClock {
    /**
     * @param {Object} [options]
     * @param {number} [options.fixedDt=1/60] - seconds per tick
     * @param {number} [options.startMs=0] - sim time offset in ms
     * @param {number} [options.startTick=0] - initial tick
     */
    constructor(options = {}) {
        this.fixedDt = options.fixedDt || DEFAULT_FIXED_DT;
        this.startMs = options.startMs || 0;
        this._startTick = options.startTick || 0;
        this.tick = this._startTick;
        this.simTimeMs = this._timeForTick(this.tick);
    }

    /**
     * @param {number} tick
     * @returns {number} sim time in ms for a tick (drift-free; derived, not summed)
     * @private
     *
     * startMs is the sim time AT startTick (the resume point), so a clock
     * resumed at {startTick: 10, startMs: 5000} reads 5000ms at tick 10.
     */
    _timeForTick(tick) {
        return this.startMs + (tick - this._startTick) * this.fixedDt * 1000;
    }

    /**
     * Advance the simulation by a whole number of fixed steps.
     * @param {number} [steps=1]
     * @returns {{tick: number, simTimeMs: number, dt: number}}
     */
    step(steps = 1) {
        if (!Number.isInteger(steps) || steps < 0) {
            throw new Error(`SimClock.step: steps must be a non-negative integer, got ${steps}`);
        }
        this.tick += steps;
        this.simTimeMs = this._timeForTick(this.tick);
        return { tick: this.tick, simTimeMs: this.simTimeMs, dt: this.fixedDt };
    }

    /**
     * Current deterministic sim time in milliseconds.
     * @returns {number}
     */
    nowMs() {
        return this.simTimeMs;
    }

    /**
     * Current deterministic sim time in seconds.
     * @returns {number}
     */
    nowSeconds() {
        return this.simTimeMs / 1000;
    }

    /**
     * Reset back to the initial tick/time.
     * @returns {SimClock} this
     */
    reset() {
        this.tick = this._startTick;
        this.simTimeMs = this._timeForTick(this.tick);
        return this;
    }

    /**
     * Serializable snapshot (for replay). Self-sufficient: includes the full
     * clock configuration, not just the tick, so a snapshot can be restored
     * into any SimClock and reproduce the exact sim time.
     * @returns {{tick: number, fixedDt: number, startMs: number, startTick: number}}
     */
    getState() {
        return {
            tick: this.tick,
            fixedDt: this.fixedDt,
            startMs: this.startMs,
            startTick: this._startTick
        };
    }

    /**
     * Restore from a getState snapshot. Restores the clock configuration
     * (fixedDt/startMs/startTick) as well as the tick, so a fresh clock can
     * adopt a snapshot without being pre-configured. Missing fields fall back
     * to the current values (tolerates older/partial snapshots).
     * @param {{tick?: number, fixedDt?: number, startMs?: number, startTick?: number}} state
     * @returns {SimClock} this
     */
    setState(state) {
        if (!state) return this;
        if (Number.isFinite(state.fixedDt)) this.fixedDt = state.fixedDt;
        if (Number.isFinite(state.startMs)) this.startMs = state.startMs;
        if (Number.isFinite(state.startTick)) this._startTick = state.startTick;
        this.tick = Number.isFinite(state.tick) ? state.tick : 0;
        this.simTimeMs = this._timeForTick(this.tick);
        return this;
    }
}

/**
 * Wall-clock adapter for rAF/UI/perf. Wraps an injectable time source.
 */
class RealClock {
    /**
     * @param {Object} [options]
     * @param {function(): number} [options.now] - returns current time in ms
     */
    constructor(options = {}) {
        this._now = typeof options.now === 'function' ? options.now : defaultNow;
        this._start = this._now();
    }

    /**
     * Current wall-clock time in ms (from the injected/default source).
     * @returns {number}
     */
    nowMs() {
        return this._now();
    }

    /**
     * Current wall-clock time in seconds.
     * @returns {number}
     */
    nowSeconds() {
        return this._now() / 1000;
    }

    /**
     * Milliseconds elapsed since this clock was created (or last reset).
     * @returns {number}
     */
    elapsedMs() {
        return this._now() - this._start;
    }

    /**
     * Reset the elapsed-time origin to "now".
     * @returns {RealClock} this
     */
    reset() {
        this._start = this._now();
        return this;
    }
}

export { SimClock, RealClock, defaultNow, DEFAULT_FIXED_DT };

// Non-module global fallback (matches the rest of the engine).
if (typeof window !== 'undefined') {
    window.SimClock = SimClock;
    window.RealClock = RealClock;
}
