/**
 * ManualVisualSettingsController
 *
 * Pure-ish application layer for br-skip-bin-arcade-design-language-5k3.37
 * slice A. It owns the manual visual settings schema, persistence into the
 * existing `visualSettings` localStorage blob, and application through injected
 * host presentation seams. It does not create UI and does not touch the network
 * or simulation.
 */

const STORAGE_KEY = 'visualSettings';
const MIN_RESOLUTION_SCALE = 0.5;
const MAX_RESOLUTION_SCALE = 1;

const DEFAULT_SETTINGS = Object.freeze({
    visualQualityMode: 'auto',
    resolutionScale: null,
    reduceEffects: false,
    materialWarpMode: 'auto',
    vertexSnapIntensity: 0.35,
    affineIntensity: 0.12,
    snapGridSize: 0.5,
    filmGrain: null,
    ditherStrength: null,
    scanline: null,
    bloom: 1,
    fog: 0.008,
    shake: 0.15,
    postProcessing: true
});

class ManualVisualSettingsController {
    /**
     * @param {Object} [options]
     * @param {Storage} [options.storage]
     * @param {Document} [options.doc]
     * @param {Object} [options.render]
     * @param {Object} [options.adaptiveQuality]
     * @param {Object} [options.grainOverlay]
     * @param {string} [options.storageKey]
     * @param {Object} [options.defaults]
     */
    constructor(options = {}) {
        this.storage = options.storage || safeLocalStorage();
        this.doc = options.doc || (typeof document !== 'undefined' ? document : null);
        this.render = options.render || null;
        this.adaptiveQuality = options.adaptiveQuality || null;
        this.grainOverlay = options.grainOverlay || null;
        this.storageKey = options.storageKey || STORAGE_KEY;
        this.defaults = { ...DEFAULT_SETTINGS, ...(options.defaults || {}) };
        this.settings = this.normalizeSettings(this._readStoredBlob());
        this.lastApplied = null;
        this._lastMaterialWarpKey = null;
    }

    /**
     * Return a normalized settings object while preserving unknown keys such as
     * uiScale that share the same visualSettings blob.
     * @param {Object} input
     * @returns {Object}
     */
    normalizeSettings(input = {}) {
        const source = isPlainObject(input) ? input : {};
        const out = { ...source, ...this.defaults, ...source };

        out.visualQualityMode = normalizeQualityMode(out.visualQualityMode);
        out.resolutionScale = normalizeNullableNumber(out.resolutionScale, MIN_RESOLUTION_SCALE, MAX_RESOLUTION_SCALE);
        out.reduceEffects = !!out.reduceEffects;
        out.materialWarpMode = normalizeMaterialWarpMode(out.materialWarpMode);
        out.vertexSnapIntensity = normalizeNumber(out.vertexSnapIntensity, 0, 1, this.defaults.vertexSnapIntensity);
        out.affineIntensity = normalizeNumber(out.affineIntensity, 0, 1, this.defaults.affineIntensity);
        out.snapGridSize = normalizeNumber(out.snapGridSize, 0.05, 4, this.defaults.snapGridSize);
        out.filmGrain = normalizeNullableNumber(out.filmGrain, 0, 1);
        out.ditherStrength = normalizeNullableNumber(out.ditherStrength, 0, 1);
        out.scanline = normalizeNullableNumber(out.scanline, 0, 1);
        out.bloom = normalizeNumber(out.bloom, 0, 2, this.defaults.bloom);
        out.fog = normalizeNumber(out.fog, 0, 0.02, this.defaults.fog);
        out.shake = normalizeNumber(out.shake, 0, 0.5, this.defaults.shake);
        out.postProcessing = out.postProcessing !== false;

        return out;
    }

    /** @returns {Object} current normalized settings snapshot. */
    getSettings() {
        return { ...this.settings };
    }

    /**
     * Merge a partial update, persist it, and apply it to injected seams.
     * @param {Object} patch
     * @param {Object} [options]
     * @param {boolean} [options.persist=true]
     * @param {boolean} [options.apply=true]
     * @returns {Object} normalized settings snapshot
     */
    update(patch = {}, options = {}) {
        const persist = options.persist !== false;
        const shouldApply = options.apply !== false;
        this.settings = this.normalizeSettings({ ...this.settings, ...(patch || {}) });
        if (persist) this.save();
        if (shouldApply) this.apply();
        return this.getSettings();
    }

    /**
     * Load from storage, normalizing and preserving unknown blob keys.
     * @returns {Object}
     */
    load() {
        this.settings = this.normalizeSettings(this._readStoredBlob());
        return this.getSettings();
    }

    /**
     * Save the current normalized settings into the existing visualSettings blob.
     * @returns {boolean}
     */
    save() {
        if (!this.storage) return false;
        try {
            const existing = this._readStoredBlob();
            this.storage.setItem(this.storageKey, JSON.stringify({ ...existing, ...this.settings }));
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Apply current settings through injected presentation seams.
     * @returns {Object} diagnostic summary of applied values
     */
    apply() {
        const s = this.settings;
        const reduce = !!s.reduceEffects;
        const render = this.render;
        const adaptive = this.adaptiveQuality;

        if (adaptive) {
            if (reduce) {
                call(adaptive, 'setManualTier', 'host-fallback');
            } else if (s.visualQualityMode === 'auto') {
                call(adaptive, 'setAuto');
            } else {
                call(adaptive, 'setManualTier', s.visualQualityMode);
            }
            call(adaptive, 'setMaterialWarpPolicy', {
                mode: s.materialWarpMode,
                reduceEffects: reduce,
                vertexSnapIntensity: s.vertexSnapIntensity,
                affineIntensity: s.affineIntensity,
                snapGridSize: s.snapGridSize
            });
        }

        const policyTier = resolvePolicyTier(s, adaptive);
        const materialWarp = resolveMaterialWarpSettings({
            mode: s.materialWarpMode,
            reduceEffects: reduce,
            visualQualityMode: s.visualQualityMode,
            adaptiveTier: policyTier,
            vertexSnapIntensity: s.vertexSnapIntensity,
            affineIntensity: s.affineIntensity,
            snapGridSize: s.snapGridSize
        });

        if (render) {
            if (s.resolutionScale != null) call(render, 'setResolutionScale', s.resolutionScale);
            applyMaterialWarp(render, materialWarp, this);
            if (typeof render.setFilmGrainAmount === 'function') {
                render.setFilmGrainAmount(reduce ? 0 : s.filmGrain);
            }
            applyOptionalRenderSetter(render, 'setDitherStrength', reduce ? 0 : s.ditherStrength);
            applyOptionalRenderSetter(render, 'setScanlineAmount', reduce ? 0 : s.scanline);
            applyOptionalRenderSetter(render, 'setChromaticAberrationAmount', reduce ? 0 : null);
            // 5k3.17: gate the transient smash CA/posterize flash on reduce-effects.
            call(render, 'setTransientSmashFlashReduceEffects', reduce);
            applyRenderPostProcessing(render, reduce ? false : s.postProcessing);
            applyBloom(render, reduce ? 0 : s.bloom);
            applyFog(render, reduce ? Math.min(s.fog, 0.003) : s.fog);
            applyShake(render, reduce ? 0 : s.shake);
        }

        if (this.grainOverlay) {
            call(this.grainOverlay, 'setEnabled', !reduce && s.filmGrain !== 0);
            if (typeof this.grainOverlay.setIntensity === 'function') {
                this.grainOverlay.setIntensity(reduce ? 0 : (s.filmGrain == null ? 0.06 : s.filmGrain));
            }
        }

        setReduceEffectsClass(this.doc, reduce);

        this.lastApplied = {
            visualQualityMode: reduce ? 'host-fallback' : s.visualQualityMode,
            resolutionScale: s.resolutionScale,
            reduceEffects: reduce,
            bloom: reduce ? 0 : s.bloom,
            fog: reduce ? Math.min(s.fog, 0.003) : s.fog,
            shake: reduce ? 0 : s.shake,
            postProcessing: reduce ? false : s.postProcessing,
            filmGrain: reduce ? 0 : s.filmGrain,
            ditherStrength: reduce ? 0 : s.ditherStrength,
            scanline: reduce ? 0 : s.scanline,
            materialWarp
        };
        return { ...this.lastApplied };
    }

    /** Enable the accessibility reduce-effects path. */
    enableReduceEffects() {
        return this.update({ reduceEffects: true });
    }

    /** Disable reduce-effects and re-apply the user's saved manual/auto values. */
    disableReduceEffects() {
        return this.update({ reduceEffects: false });
    }

    _readStoredBlob() {
        if (!this.storage) return {};
        try {
            const raw = this.storage.getItem(this.storageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return isPlainObject(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }
}

function safeLocalStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
        return null;
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQualityMode(value) {
    if (value === 'auto') return 'auto';
    if (typeof value === 'string' && value.trim()) return value;
    return 'auto';
}

function normalizeMaterialWarpMode(value) {
    if (value === 'off' || value === false) return 'off';
    if (value === 'on' || value === true) return 'on';
    return 'auto';
}

function normalizeNullableNumber(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
}

function normalizeNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function call(target, method, ...args) {
    if (target && typeof target[method] === 'function') {
        return target[method](...args);
    }
    return undefined;
}

function applyOptionalRenderSetter(render, method, value) {
    if (typeof render?.[method] === 'function') {
        render[method](value);
    }
}

function applyRenderPostProcessing(render, enabled) {
    if (render?.postProcessing) {
        render.postProcessing.enabled = !!enabled;
    }
}

function applyBloom(render, value) {
    const bloom = render?.postProcessing?.passes?.bloom;
    if (bloom) bloom.strength = value;
}

function applyFog(render, value) {
    if (render?.scene?.fog) render.scene.fog.density = value;
}

function applyShake(render, value) {
    if (render?.cameraShake) render.cameraShake.intensity = value;
}

function resolvePolicyTier(settings, adaptive) {
    if (settings.reduceEffects) return 'host-fallback';
    if (settings.visualQualityMode && settings.visualQualityMode !== 'auto') return settings.visualQualityMode;
    return adaptive?.state?.tier || adaptive?.lastDecision?.tier || 'host-native';
}

function resolveMaterialWarpSettings(options = {}) {
    const reduceEffects = !!options.reduceEffects;
    const mode = normalizeMaterialWarpMode(options.mode);
    const tier = normalizeTierName(options.visualQualityMode && options.visualQualityMode !== 'auto'
        ? options.visualQualityMode
        : options.adaptiveTier);
    const vertexSnapIntensity = normalizeNumber(options.vertexSnapIntensity, 0, 1, DEFAULT_SETTINGS.vertexSnapIntensity);
    const affineIntensity = normalizeNumber(options.affineIntensity, 0, 1, DEFAULT_SETTINGS.affineIntensity);
    const snapGridSize = normalizeNumber(options.snapGridSize, 0.05, 4, DEFAULT_SETTINGS.snapGridSize);

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
        vertexSnapIntensity: enabled ? vertexSnapIntensity : 0,
        affineIntensity: enabled ? affineIntensity : 0,
        snapGridSize
    };
}

function normalizeTierName(value) {
    const tier = String(value || 'native').replace(/^host-/, '');
    if (tier === 'native' || tier === 'balanced' || tier === 'degraded' || tier === 'fallback') {
        return tier;
    }
    return 'native';
}

function applyMaterialWarp(render, config, owner) {
    if (typeof render?.setMaterialWarpEnabled !== 'function') return;
    const key = JSON.stringify(config);
    if (owner && owner._lastMaterialWarpKey === key) return;
    render.setMaterialWarpEnabled(config);
    if (owner) owner._lastMaterialWarpKey = key;
}

function setReduceEffectsClass(doc, enabled) {
    const body = doc?.body;
    if (body?.classList?.toggle) {
        body.classList.toggle('reduce-effects', !!enabled);
    }
}

ManualVisualSettingsController.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
ManualVisualSettingsController.MIN_RESOLUTION_SCALE = MIN_RESOLUTION_SCALE;
ManualVisualSettingsController.MAX_RESOLUTION_SCALE = MAX_RESOLUTION_SCALE;
ManualVisualSettingsController.resolveMaterialWarpSettings = resolveMaterialWarpSettings;

export { ManualVisualSettingsController, resolveMaterialWarpSettings };

if (typeof window !== 'undefined') {
    window.ManualVisualSettingsController = ManualVisualSettingsController;
}
