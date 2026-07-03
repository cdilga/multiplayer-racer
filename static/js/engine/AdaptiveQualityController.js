/**
 * AdaptiveQualityController - deterministic decision core for the Skip Bin
 * Arcade adaptive quality ladder (br-skip-bin-arcade-design-language-5k3.39).
 *
 * "Ship the full grade, auto-degrade by hardware." This class DECIDES which
 * host grade tier + internal resolution scale to run, from (a) a one-time
 * hardware/capability heuristic and (b) a runtime fps / frame-duration stream.
 * It then DRIVES an existing RenderSystem through its public API — it does not
 * reach inside the renderer:
 *   - target.getHostGradeTiers()  -> discover the ordered tier ladder
 *   - target.setGradeTier(name)   -> shed the heaviest effects first
 *   - target.setResolutionScale(s)-> drop internal res gracefully at the floor
 *
 * The decision logic is PURE and deterministic (no THREE, DOM, EventBus, clock,
 * or randomness): the same fed sample sequence always yields the same tier/scale
 * path, so the whole ladder is unit-testable. A thin runtime shim (Phase 2 / a
 * GameHost line) feeds it `GameLoop.getFps()` each render; that shim is the only
 * place that touches the live loop.
 *
 * Design constraints (from the bead + repo invariants):
 *   - Tier stepping is the PRIMARY control (effect tiering = the G2 ladder);
 *     resolution trim is the last-resort knob once the worst tier is reached.
 *   - Hysteresis + debounce: separate down/up fps thresholds and per-direction
 *     streak counts, so a single spike never flaps the tier.
 *   - Clamp at the native ceiling and the fallback + MIN_RENDER_SCALE floor.
 *   - Manual override (5k3.37 seam) wins over the auto heuristic until cleared.
 *   - Remote weak devices start conservative and never gate the authoritative
 *     sim (the controller only picks a local presentation tier).
 *   - No per-frame logging: sample()/apply() never touch the console.
 */

// Global internal-resolution floor, mirrors RenderSystem.MIN_RENDER_SCALE.
const MIN_RENDER_SCALE = 0.5;

// The G2-calibrated host ladder (names + base resolution scales) used when a
// target renderer is not attached (pure unit context). When attached, the real
// ladder is read from target.getHostGradeTiers().
const DEFAULT_TIERS = Object.freeze([
    Object.freeze({ name: 'native', resolutionScale: 1.0 }),
    Object.freeze({ name: 'balanced', resolutionScale: 0.85 }),
    Object.freeze({ name: 'degraded', resolutionScale: 0.7 }),
    Object.freeze({ name: 'fallback', resolutionScale: 0.55 })
]);

const DEFAULT_CONFIG = Object.freeze({
    targetFps: 60,
    // Below downFps for `downDebounce` consecutive samples => step down.
    downFps: 50,
    // Above upFps for `upDebounce` consecutive samples => step up. upFps is
    // higher than downFps (a dead-band) and upDebounce is slower than
    // downDebounce, so recovery is cautious and the tier does not oscillate.
    upFps: 58,
    downDebounce: 6,
    upDebounce: 12,
    // Resolution trim step used only at the worst tier (finer than a tier jump).
    resStep: 0.1,
    minResolutionScale: MIN_RENDER_SCALE
});

const DEFAULT_MATERIAL_WARP_POLICY = Object.freeze({
    mode: 'auto',
    reduceEffects: false,
    vertexSnapIntensity: 0.35,
    affineIntensity: 0.12,
    snapGridSize: 0.5
});

class AdaptiveQualityController {
    /**
     * @param {Object} [options]
     * @param {Array<{name:string,resolutionScale:number}>} [options.tiers]
     * @param {Object} [options.config] - overrides of DEFAULT_CONFIG
     */
    constructor(options = {}) {
        this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
        this.tiers = normalizeTiers(options.tiers) || DEFAULT_TIERS.slice();

        this.target = null;

        // Active decision state.
        this.tierIndex = 0;
        this.resolutionScale = this.tiers[0].resolutionScale;
        this._slowStreak = 0;
        this._fastStreak = 0;

        // Manual override (5k3.37): when set, sampling never changes the tier.
        this.manual = false;

        // Last decision for debug overlays / evidence (set on sample, not ticked).
        this.lastDecision = null;

        this.materialWarpPolicy = { ...DEFAULT_MATERIAL_WARP_POLICY };
        this._appliedMaterialWarpKey = null;
    }

    /**
     * Classify a hardware/capability descriptor into a starting tier index.
     * Pure. Higher index = weaker device = lower tier.
     * @param {Object} caps
     * @param {number} [caps.cores] - navigator.hardwareConcurrency
     * @param {number} [caps.deviceMemory] - GB (navigator.deviceMemory)
     * @param {boolean} [caps.softwareGpu] - SwiftShader/llvmpipe etc.
     * @param {number} [caps.devicePixelRatio]
     * @param {boolean} [caps.remote] - a remote (own-viewer) participant
     * @param {number} [tierCount]
     * @returns {number} tier index 0..tierCount-1
     */
    static classifyHardware(caps = {}, tierCount = DEFAULT_TIERS.length) {
        const worst = tierCount - 1;
        // Anything clearly incapable starts at the floor tier.
        if (caps.softwareGpu === true) return worst;

        // No hardware signal at all (e.g. Safari has no deviceMemory): be
        // optimistic — start at native (one step down for a remote participant)
        // and let the runtime fps ladder demote if the device cannot hold it.
        if (!Number.isFinite(Number(caps.cores)) && !Number.isFinite(Number(caps.deviceMemory))) {
            return caps.remote === true ? Math.min(worst, 1) : 0;
        }

        let score = 0; // higher = stronger
        const cores = Number(caps.cores);
        if (Number.isFinite(cores)) {
            if (cores >= 8) score += 2;
            else if (cores >= 4) score += 1;
            else if (cores <= 2) score -= 1;
        }
        const mem = Number(caps.deviceMemory);
        if (Number.isFinite(mem)) {
            if (mem >= 8) score += 2;
            else if (mem >= 4) score += 1;
            else if (mem <= 2) score -= 1;
        }
        const dpr = Number(caps.devicePixelRatio);
        if (Number.isFinite(dpr) && dpr >= 3) score -= 1; // dense panels cost more

        // Map score -> tier index. score >= 3 native; 1..2 balanced; 0 degraded;
        // negative fallback.
        let index;
        if (score >= 3) index = 0;
        else if (score >= 1) index = Math.min(1, worst);
        else if (score >= 0) index = Math.min(2, worst);
        else index = worst;

        // Remote participants render their own view on a possibly-weak device:
        // start a guaranteed step more conservative (clamped), never gating the
        // authoritative sim.
        if (caps.remote === true) index = Math.min(worst, index + 1);

        return Math.max(0, Math.min(worst, index));
    }

    /**
     * Attach a RenderSystem-like target and set the initial tier from hardware.
     * Reads the real tier ladder from target.getHostGradeTiers() when available.
     * @param {Object} target - exposes getHostGradeTiers/setGradeTier/setResolutionScale
     * @param {Object} [caps] - hardware descriptor for the initial classification
     * @returns {AdaptiveQualityController}
     */
    attach(target, caps = {}) {
        this.target = target || null;
        // Discover the real ladder from the render system. The public API is
        // listGradeTiers(); getHostGradeTiers() is accepted as an alias.
        const lister = target && (
            typeof target.listGradeTiers === 'function' ? target.listGradeTiers
            : typeof target.getHostGradeTiers === 'function' ? target.getHostGradeTiers
            : null
        );
        if (lister) {
            const discovered = normalizeTiers(lister.call(target));
            if (discovered && discovered.length) this.tiers = discovered;
        }
        this.setInitialTier(caps);
        return this;
    }

    /**
     * Set the starting tier/scale from a hardware descriptor and push it to the
     * target (if attached). Resets streak state.
     * @param {Object} [caps]
     * @returns {number} chosen tier index
     */
    setInitialTier(caps = {}) {
        const index = AdaptiveQualityController.classifyHardware(caps, this.tiers.length);
        this.tierIndex = index;
        this.resolutionScale = this.tiers[index].resolutionScale;
        this._slowStreak = 0;
        this._fastStreak = 0;
        this._applyToTarget(true);
        return index;
    }

    /**
     * Pin a specific tier (manual / accessibility override, 5k3.37). While
     * manual, sample() records fps but never changes the tier.
     * @param {string|number} tier - tier name or index
     * @returns {boolean} whether the tier was recognized
     */
    setManualTier(tier) {
        const index = this._resolveTierIndex(tier);
        if (index == null) return false;
        this.manual = true;
        this.tierIndex = index;
        this.resolutionScale = this.tiers[index].resolutionScale;
        this._slowStreak = 0;
        this._fastStreak = 0;
        this._applyToTarget(true);
        return true;
    }

    /** Resume automatic adaptation after a manual override. */
    setAuto() {
        this.manual = false;
        this._slowStreak = 0;
        this._fastStreak = 0;
        this._applyToTarget(true);
        return this;
    }

    /**
     * Update the presentation-only material warp policy that is applied whenever
     * the quality tier/scale changes. Manual settings own this policy; the
     * adaptive controller only reapplies it on tier transitions.
     * @param {Object} policy
     * @returns {Object} resolved material-warp config
     */
    setMaterialWarpPolicy(policy = {}) {
        this.materialWarpPolicy = {
            ...this.materialWarpPolicy,
            ...policy,
            mode: normalizeMaterialWarpMode(policy.mode ?? this.materialWarpPolicy.mode),
            reduceEffects: !!(policy.reduceEffects ?? this.materialWarpPolicy.reduceEffects),
            vertexSnapIntensity: clamp01(policy.vertexSnapIntensity ?? this.materialWarpPolicy.vertexSnapIntensity),
            affineIntensity: clamp01(policy.affineIntensity ?? this.materialWarpPolicy.affineIntensity),
            snapGridSize: clampPositive(policy.snapGridSize ?? this.materialWarpPolicy.snapGridSize, DEFAULT_MATERIAL_WARP_POLICY.snapGridSize)
        };
        const config = this._resolveMaterialWarpForCurrentTier();
        this._applyMaterialWarp(config, true);
        return config;
    }

    /**
     * Feed one runtime sample (an fps number, or {fps} / {frameMs}). Returns the
     * decision for this sample. Applies a change to the target only when the
     * tier or resolution actually moved. NEVER logs.
     * @param {number|Object} sample
     * @returns {{changed:boolean, action:string, tier:string, tierIndex:number, resolutionScale:number, fps:number}}
     */
    sample(sample) {
        const fps = readFps(sample);
        const cfg = this.config;

        // Manual mode: observe only, never adapt.
        if (this.manual || !Number.isFinite(fps)) {
            return this._record('manual_or_invalid', false, fps);
        }

        const worst = this.tiers.length - 1;

        if (fps < cfg.downFps) {
            this._slowStreak += 1;
            this._fastStreak = 0;
            if (this._slowStreak >= cfg.downDebounce) {
                this._slowStreak = 0;
                return this._stepDown(worst, fps);
            }
            return this._record('slow_pending', false, fps);
        }

        if (fps > cfg.upFps) {
            this._fastStreak += 1;
            this._slowStreak = 0;
            if (this._fastStreak >= cfg.upDebounce) {
                this._fastStreak = 0;
                return this._stepUp(fps);
            }
            return this._record('fast_pending', false, fps);
        }

        // Inside the dead-band: stable, bleed off both streaks.
        this._slowStreak = 0;
        this._fastStreak = 0;
        return this._record('stable', false, fps);
    }

    /**
     * Step one notch toward lower quality: drop a tier first; only trim the
     * resolution once at the worst tier (last resort). Clamped.
     * @private
     */
    _stepDown(worst, fps) {
        if (this.tierIndex < worst) {
            this.tierIndex += 1;
            this.resolutionScale = this.tiers[this.tierIndex].resolutionScale;
            return this._record('tier_down', this._applyToTarget(), fps);
        }
        // Worst tier already: squeeze internal resolution down to the floor.
        const next = Math.max(this.config.minResolutionScale, round2(this.resolutionScale - this.config.resStep));
        if (next < this.resolutionScale) {
            this.resolutionScale = next;
            return this._record('res_down', this._applyToTarget(), fps);
        }
        return this._record('floor', false, fps); // nothing left to shed
    }

    /**
     * Step one notch toward higher quality: at the worst tier, restore trimmed
     * resolution first; otherwise promote a tier. Clamped at native.
     * @private
     */
    _stepUp(fps) {
        const worst = this.tiers.length - 1;
        const tierBase = this.tiers[this.tierIndex].resolutionScale;
        if (this.tierIndex === worst && this.resolutionScale < tierBase) {
            const next = Math.min(tierBase, round2(this.resolutionScale + this.config.resStep));
            this.resolutionScale = next;
            return this._record('res_up', this._applyToTarget(), fps);
        }
        if (this.tierIndex > 0) {
            this.tierIndex -= 1;
            this.resolutionScale = this.tiers[this.tierIndex].resolutionScale;
            return this._record('tier_up', this._applyToTarget(), fps);
        }
        return this._record('ceiling', false, fps); // already native
    }

    /**
     * Push the current tier/scale to the target renderer, only calling a setter
     * when its value changed. Returns whether anything was applied.
     * @param {boolean} [force] - apply even if unchanged (initial/manual set)
     * @private
     */
    _applyToTarget(force = false) {
        const t = this.target;
        if (!t) return force;
        let applied = false;
        const name = this.tiers[this.tierIndex]?.name;
        if (name && typeof t.setGradeTier === 'function' && (force || name !== this._appliedTier)) {
            t.setGradeTier(name);
            this._appliedTier = name;
            applied = true;
        }
        if (typeof t.setResolutionScale === 'function' && (force || this.resolutionScale !== this._appliedScale)) {
            t.setResolutionScale(this.resolutionScale);
            this._appliedScale = this.resolutionScale;
            applied = true;
        }
        if (this._applyMaterialWarp(this._resolveMaterialWarpForCurrentTier(), force)) {
            applied = true;
        }
        return applied;
    }

    _resolveMaterialWarpForCurrentTier() {
        return resolveMaterialWarpForTier(this.tiers[this.tierIndex]?.name, this.materialWarpPolicy);
    }

    _applyMaterialWarp(config, force = false) {
        const t = this.target;
        if (!t || typeof t.setMaterialWarpEnabled !== 'function') return false;
        const key = JSON.stringify(config);
        if (!force && key === this._appliedMaterialWarpKey) return false;
        t.setMaterialWarpEnabled(config);
        this._appliedMaterialWarpKey = key;
        return true;
    }

    /** @private */
    _record(action, changed, fps) {
        const decision = {
            changed: !!changed || action === 'tier_down' || action === 'tier_up'
                || action === 'res_down' || action === 'res_up',
            action,
            tier: this.tiers[this.tierIndex]?.name ?? null,
            tierIndex: this.tierIndex,
            resolutionScale: this.resolutionScale,
            fps: Number.isFinite(fps) ? fps : null
        };
        // A pending/stable/clamped result is not a change even if a streak moved.
        if (action === 'slow_pending' || action === 'fast_pending' || action === 'stable'
            || action === 'floor' || action === 'ceiling' || action === 'manual_or_invalid') {
            decision.changed = false;
        }
        this.lastDecision = decision;
        return decision;
    }

    /** @private */
    _resolveTierIndex(tier) {
        if (typeof tier === 'number' && Number.isInteger(tier) && tier >= 0 && tier < this.tiers.length) {
            return tier;
        }
        if (typeof tier === 'string') {
            const i = this.tiers.findIndex((t) => t.name === tier);
            if (i >= 0) return i;
        }
        return null;
    }

    /** Immutable snapshot of the controller state (for diagnostics/evidence). */
    get state() {
        return {
            tier: this.tiers[this.tierIndex]?.name ?? null,
            tierIndex: this.tierIndex,
            resolutionScale: this.resolutionScale,
            manual: this.manual,
            slowStreak: this._slowStreak,
            fastStreak: this._fastStreak
        };
    }
}

function resolveMaterialWarpForTier(tierName, policy = {}) {
    const mode = normalizeMaterialWarpMode(policy.mode);
    const reduceEffects = !!policy.reduceEffects;
    const tier = normalizeTierName(tierName);
    const snapGridSize = clampPositive(policy.snapGridSize, DEFAULT_MATERIAL_WARP_POLICY.snapGridSize);

    if (reduceEffects || mode === 'off') {
        return {
            enabled: false,
            mode,
            policy: reduceEffects ? 'reduce-effects' : 'manual-off',
            tier,
            vertexSnapIntensity: 0,
            affineIntensity: 0,
            snapGridSize
        };
    }

    const autoEnabled = tier === 'native' || tier === 'balanced';
    const enabled = mode === 'on' || (mode === 'auto' && autoEnabled);
    return {
        enabled,
        mode,
        policy: mode === 'on' ? 'manual-on' : `auto-${tier}`,
        tier,
        vertexSnapIntensity: enabled ? clamp01(policy.vertexSnapIntensity) : 0,
        affineIntensity: enabled ? clamp01(policy.affineIntensity) : 0,
        snapGridSize
    };
}

function normalizeMaterialWarpMode(value) {
    if (value === 'off' || value === false) return 'off';
    if (value === 'on' || value === true) return 'on';
    return 'auto';
}

function normalizeTierName(value) {
    const tier = String(value || 'native').replace(/^host-/, '');
    if (tier === 'native' || tier === 'balanced' || tier === 'degraded' || tier === 'fallback') return tier;
    return 'native';
}

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function clampPositive(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

/** Normalize a tier list from {name,resolutionScale} or RenderSystem {tierName,resolutionScale}. */
function normalizeTiers(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const out = list.map((t) => ({
        name: t.name ?? t.tierName ?? null,
        resolutionScale: Number.isFinite(Number(t.resolutionScale)) ? Number(t.resolutionScale) : 1
    })).filter((t) => t.name);
    return out.length ? out : null;
}

/** Read an fps number from a number or {fps} / {frameMs} sample. */
function readFps(sample) {
    if (typeof sample === 'number') return sample;
    if (sample && typeof sample === 'object') {
        if (Number.isFinite(Number(sample.fps))) return Number(sample.fps);
        if (Number.isFinite(Number(sample.frameMs)) && Number(sample.frameMs) > 0) {
            return 1000 / Number(sample.frameMs);
        }
    }
    return NaN;
}

/** Round to 2 decimals to keep resolution steps clean/deterministic. */
function round2(n) {
    return Math.round(n * 100) / 100;
}

AdaptiveQualityController.MIN_RENDER_SCALE = MIN_RENDER_SCALE;
AdaptiveQualityController.DEFAULT_TIERS = DEFAULT_TIERS;
AdaptiveQualityController.DEFAULT_CONFIG = DEFAULT_CONFIG;
AdaptiveQualityController.DEFAULT_MATERIAL_WARP_POLICY = DEFAULT_MATERIAL_WARP_POLICY;
AdaptiveQualityController.resolveMaterialWarpForTier = resolveMaterialWarpForTier;

export { AdaptiveQualityController, resolveMaterialWarpForTier };

if (typeof window !== 'undefined') {
    window.AdaptiveQualityController = AdaptiveQualityController;
}
