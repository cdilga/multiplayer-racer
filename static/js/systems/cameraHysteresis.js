/**
 * Camera layout temporal coherence (br-captain-call-architecture-hardening-woq.9).
 *
 * Dynamic split/merge/tiled camera layouts flicker if the raw "desired cluster
 * count" (derived from noisy car positions) is applied every frame. This
 * stabilizer adds:
 *  - HYSTERESIS: a dead-band around the current count — a change is only
 *    considered once the desired count clears current+splitMargin (to split) or
 *    current-mergeMargin (to merge), so jitter around a threshold never retiles.
 *  - DEBOUNCE: a considered change must persist for debounceMs before it commits,
 *    so a brief position spike does not thrash the layout.
 *  - DIAGNOSTICS: committed transitions + suppressed-thrash counters.
 *
 * Deterministic: the caller passes `now` (sim/real clock ms), so replays and
 * tests are exact.
 */
export class CameraLayoutStabilizer {
    /**
     * @param {Object} [options]
     * @param {number} [options.debounceMs=500] - a desired change must hold this long to commit
     * @param {number} [options.splitMargin=1] - desired must reach current+this to split (more tiles)
     * @param {number} [options.mergeMargin=1] - desired must fall to current-this to merge (fewer tiles)
     * @param {number} [options.initial=1] - starting cluster/tile count
     */
    constructor(options = {}) {
        this.debounceMs = options.debounceMs ?? 500;
        this.splitMargin = Math.max(1, options.splitMargin ?? 1);
        this.mergeMargin = Math.max(1, options.mergeMargin ?? 1);
        this.current = Math.max(1, Math.floor(options.initial ?? 1));
        this._pendingTarget = null;
        this._pendingDirection = null;
        this._pendingSince = null;
        this.transitions = 0;
        this.suppressedThrash = 0;
        this.lastTransitionAt = null;
        this.lastTransitionDurationMs = 0;
    }

    /**
     * Feed the raw desired count for this frame; returns the STABLE count to use.
     * @param {number} desired
     * @param {number} now - clock ms
     * @returns {number}
     */
    update(desired, now) {
        const d = Math.max(1, Math.floor(Number.isFinite(desired) ? desired : this.current));

        // Hysteresis dead-band: hold the current layout unless the desired count
        // clears the split/merge margin.
        const wantsSplit = d >= this.current + this.splitMargin;
        const wantsMerge = d <= this.current - this.mergeMargin;
        const direction = wantsSplit ? 'split' : (wantsMerge ? 'merge' : null);

        if (direction === null) {
            if (this._pendingDirection !== null) this.suppressedThrash += 1; // in-flight change fizzled
            this._pendingDirection = null;
            this._pendingSince = null;
            this._pendingTarget = null;
            return this.current;
        }

        // Debounce on DIRECTION (not the exact value) so per-frame noise around a
        // scattered target still commits once the trend holds. A direction FLIP
        // before committing is suppressed thrash.
        if (this._pendingDirection !== direction) {
            if (this._pendingDirection !== null) this.suppressedThrash += 1;
            this._pendingDirection = direction;
            this._pendingSince = now;
        }
        this._pendingTarget = d; // track the latest desired to commit to

        if (now - this._pendingSince >= this.debounceMs) {
            this.lastTransitionDurationMs = now - this._pendingSince;
            this.current = d;
            this.transitions += 1;
            this.lastTransitionAt = now;
            this._pendingDirection = null;
            this._pendingSince = null;
            this._pendingTarget = null;
        }
        return this.current;
    }

    /** Reset to a known count (e.g. on mode change). */
    reset(count = 1) {
        this.current = Math.max(1, Math.floor(count));
        this._pendingTarget = null;
        this._pendingDirection = null;
        this._pendingSince = null;
    }

    /** Diagnostics for the camera debug panel (woq.9). */
    diagnostics() {
        return {
            current: this.current,
            pendingTarget: this._pendingTarget,
            transitions: this.transitions,
            suppressedThrash: this.suppressedThrash,
            debounceMs: this.debounceMs,
            splitMargin: this.splitMargin,
            mergeMargin: this.mergeMargin,
            lastTransitionAt: this.lastTransitionAt,
            lastTransitionDurationMs: this.lastTransitionDurationMs
        };
    }
}

export default { CameraLayoutStabilizer };
