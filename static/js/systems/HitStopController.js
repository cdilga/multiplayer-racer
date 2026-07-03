/**
 * HitStopController - Deterministic decision/timing core for smash hit-stop.
 *
 * "Hit-stop" is a 1-3 frame sub-perceptual freeze on a heavy collision or
 * elimination that sells impact weight ("weight, not lag"). This class is the
 * PURE core: it decides *whether* an impact deserves a hit-stop, *which* mode
 * to use, and *how many render frames* it lasts, then counts those frames down.
 *
 * It has NO dependency on THREE, the DOM, the EventBus, or any renderer — a
 * thin HitStopSystem (Phase 2) wires this to impact events and applies the
 * resulting state to the camera / involved meshes. Keeping the logic pure makes
 * it fully unit-testable and deterministic.
 *
 * Design constraints (from br-skip-bin-arcade-design-language-5k3.15):
 *   - Physics runs on a FIXED deterministic timestep. Hit-stop is a
 *     render/presentation effect only: this controller NEVER scales physics
 *     time. `physicsTimeScale` is always 1 — asserted by tests.
 *   - NOT global slow-mo on the shared host screen. Context decides the mode:
 *       * 'shared-race'  -> 'camera-punch' (a brief camera kick; nothing freezes)
 *       * 'focused'      -> 'freeze'       (localized visual freeze of the beat)
 *   - Severity threshold = the "sweet spot": light taps are ignored so the
 *     effect reads as weight, not lag.
 *   - 1-3 frame hard cap. Rapid repeat impacts REFRESH the window but never
 *     STACK past the cap (anti-lag).
 *   - Deterministic: identical call sequences produce identical state. No
 *     wall-clock, no randomness.
 *   - No per-tick logging: tick() never logs. Debug reads `lastImpact`.
 *
 * Usage:
 *   const hs = new HitStopController();
 *   hs.registerImpact({ severity: 0.9, context: 'focused', elimination: true });
 *   // once per render frame:
 *   const state = hs.tick(); // { active, mode, framesRemaining, framesTotal, intensity, progress }
 */

/** Effect modes. 'none' = no active effect. */
const MODE_NONE = 'none';
const MODE_FREEZE = 'freeze';
const MODE_CAMERA_PUNCH = 'camera-punch';

/** Contexts that steer the mode. Unknown contexts default to shared-race. */
const CONTEXT_SHARED_RACE = 'shared-race';
const CONTEXT_FOCUSED = 'focused';

/**
 * Default tunable configuration. Severity is a normalised 0..1 impact strength
 * (callers map their raw damage/impulse into this range, e.g. damage/40).
 */
const DEFAULT_CONFIG = Object.freeze({
    // Below this severity a plain collision produces no hit-stop (weight, not lag).
    heavyThreshold: 0.25,
    // Severity band upper bounds -> frame counts. Ascending, last band = maxFrames.
    // severity in [heavyThreshold, band1) -> 1 frame; [band1, band2) -> 2; >=band2 -> 3.
    band1: 0.55,
    band2: 0.80,
    // Hard cap on freeze/punch length in render frames.
    maxFrames: 3,
    // Eliminations always land the strongest beat regardless of measured severity.
    eliminationFrames: 3,
    // Floor on camera-punch intensity so an elimination punch is never limp.
    eliminationMinIntensity: 0.8,
});

class HitStopController {
    /**
     * @param {Object} [options] - Partial overrides of DEFAULT_CONFIG.
     */
    constructor(options = {}) {
        this.config = { ...DEFAULT_CONFIG, ...options };

        // Active effect state (frame-based, never time-based).
        this.mode = MODE_NONE;
        this.framesRemaining = 0;
        this.framesTotal = 0;
        this.intensity = 0;

        // Last registered impact decision, for debug overlays (read-only usage).
        // Set only on registerImpact (event-driven), never in tick().
        this.lastImpact = null;
    }

    /**
     * Update tunable constants at runtime (mirrors DamageSystem/cameraShake).
     * @param {Object} partial - Subset of config keys to override.
     */
    setConfig(partial = {}) {
        this.config = { ...this.config, ...partial };
    }

    /**
     * Normalise a context string to a known value. Unknown/missing contexts
     * default to 'shared-race' — the SAFE default that never freezes the world.
     * @param {string} context
     * @returns {'shared-race'|'focused'}
     */
    static normalizeContext(context) {
        return context === CONTEXT_FOCUSED ? CONTEXT_FOCUSED : CONTEXT_SHARED_RACE;
    }

    /**
     * Map a normalised severity (0..1) to a frame count using the config bands.
     * Returns 0 when below the heavy threshold.
     * @param {number} severity
     * @param {Object} [config=this.config]
     * @returns {number} 0..maxFrames
     */
    severityToFrames(severity, config = this.config) {
        const s = Number.isFinite(severity) ? severity : 0;
        if (s < config.heavyThreshold) return 0;
        if (s < config.band1) return 1;
        if (s < config.band2) return 2;
        return config.maxFrames;
    }

    /**
     * Decide the effect for an impact WITHOUT mutating controller state. Pure.
     * @param {Object} impact
     * @param {number} [impact.severity=0] - Normalised 0..1 impact strength.
     * @param {string} [impact.context] - 'shared-race' | 'focused'.
     * @param {boolean} [impact.elimination=false] - Did the impact eliminate a car?
     * @returns {{ mode: string, frames: number, intensity: number, context: string }}
     */
    classify(impact = {}) {
        const { severity = 0, elimination = false } = impact;
        const context = HitStopController.normalizeContext(impact.context);
        const cfg = this.config;

        // Frame budget: eliminations force the max beat; otherwise band-mapped.
        let frames = elimination
            ? cfg.eliminationFrames
            : this.severityToFrames(severity, cfg);
        frames = Math.max(0, Math.min(cfg.maxFrames, frames));

        if (frames <= 0) {
            return { mode: MODE_NONE, frames: 0, intensity: 0, context };
        }

        // Mode is governed by context, NOT by elimination, so the shared host
        // screen is never globally frozen — a mid-race elimination still uses a
        // camera punch rather than a freeze.
        const mode = context === CONTEXT_FOCUSED ? MODE_FREEZE : MODE_CAMERA_PUNCH;

        let intensity = Math.max(0, Math.min(1, Number.isFinite(severity) ? severity : 0));
        if (elimination) {
            intensity = Math.max(intensity, cfg.eliminationMinIntensity);
        }

        return { mode, frames, intensity, context };
    }

    /**
     * Register an impact and (if it qualifies) start/refresh the hit-stop.
     *
     * Refresh, don't stack: a new qualifying impact extends the window to the
     * longer of the two frame counts (capped), and upgrades mode/intensity when
     * the new beat is stronger. Repeated hits therefore never accumulate lag.
     *
     * @param {Object} impact - { severity, context, elimination }
     * @returns {{ mode, frames, intensity, context }} the decision (mode 'none' if ignored)
     */
    registerImpact(impact = {}) {
        const decision = this.classify(impact);
        this.lastImpact = { ...impact, decision };

        if (decision.mode === MODE_NONE) {
            return decision;
        }

        if (!this.active) {
            // Fresh effect.
            this.mode = decision.mode;
            this.framesRemaining = decision.frames;
            this.framesTotal = decision.frames;
            this.intensity = decision.intensity;
            return decision;
        }

        // Already active: refresh window to the longer beat (never sum), and
        // adopt the stronger effect's mode/intensity when it upgrades.
        const refreshed = Math.min(
            this.config.maxFrames,
            Math.max(this.framesRemaining, decision.frames)
        );

        const upgrades =
            decision.frames > this.framesRemaining ||
            decision.intensity > this.intensity;

        if (upgrades) {
            this.mode = decision.mode;
            this.intensity = Math.max(this.intensity, decision.intensity);
        }

        this.framesRemaining = refreshed;
        this.framesTotal = Math.max(this.framesTotal, refreshed);
        return decision;
    }

    /**
     * Advance exactly one render frame. Decrements the active window and clears
     * the effect when it expires. NEVER logs. Safe to call every frame.
     * @returns {Object} current state snapshot (see `state`)
     */
    tick() {
        if (this.framesRemaining > 0) {
            this.framesRemaining -= 1;
            if (this.framesRemaining <= 0) {
                this._clear();
            }
        }
        return this.state;
    }

    /**
     * Clear the active effect back to idle.
     * @private
     */
    _clear() {
        this.mode = MODE_NONE;
        this.framesRemaining = 0;
        this.framesTotal = 0;
        this.intensity = 0;
    }

    /**
     * Reset everything, including debug state.
     */
    reset() {
        this._clear();
        this.lastImpact = null;
    }

    /** @returns {boolean} whether an effect is currently running. */
    get active() {
        return this.framesRemaining > 0 && this.mode !== MODE_NONE;
    }

    /**
     * Physics time scale is ALWAYS 1: hit-stop is render-only and must never
     * slow the fixed-timestep simulation (determinism/replay safety).
     * @returns {number} always 1
     */
    get physicsTimeScale() {
        return 1;
    }

    /**
     * Whether the involved vehicles' meshes should be visually held this frame.
     * True only in freeze mode; a camera punch never freezes meshes.
     * @returns {boolean}
     */
    get freezesMeshes() {
        return this.active && this.mode === MODE_FREEZE;
    }

    /**
     * Normalised remaining progress 0..1 (1 at start, 0 at end) for easing a
     * camera-punch ease-out. 0 when idle.
     * @returns {number}
     */
    get progress() {
        if (!this.active || this.framesTotal <= 0) return 0;
        return this.framesRemaining / this.framesTotal;
    }

    /**
     * Immutable snapshot of current effect state.
     * @returns {{active:boolean, mode:string, framesRemaining:number, framesTotal:number, intensity:number, progress:number, physicsTimeScale:number}}
     */
    get state() {
        return {
            active: this.active,
            mode: this.mode,
            framesRemaining: this.framesRemaining,
            framesTotal: this.framesTotal,
            intensity: this.intensity,
            progress: this.progress,
            physicsTimeScale: this.physicsTimeScale,
        };
    }
}

// Exported mode/context constants for the Phase 2 system + tests.
HitStopController.MODE_NONE = MODE_NONE;
HitStopController.MODE_FREEZE = MODE_FREEZE;
HitStopController.MODE_CAMERA_PUNCH = MODE_CAMERA_PUNCH;
HitStopController.CONTEXT_SHARED_RACE = CONTEXT_SHARED_RACE;
HitStopController.CONTEXT_FOCUSED = CONTEXT_FOCUSED;
HitStopController.DEFAULT_CONFIG = DEFAULT_CONFIG;

// Export for ES Modules
export { HitStopController };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.HitStopController = HitStopController;
}
