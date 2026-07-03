/**
 * RenderSystem - Manages Three.js rendering
 *
 * Responsibilities:
 * - Initialize Three.js scene, camera, renderer (via backend adapter)
 * - Add/remove meshes
 * - Sync mesh positions from physics
 * - Handle camera following
 * - Manage lighting
 *
 * Usage:
 *   const render = new RenderSystem({ eventBus, container: document.getElementById('game') });
 *   await render.init();
 *   render.addMesh(vehicle.mesh);
 */

import { selectRendererBackend, createRenderer as createBackendRenderer } from '../rendering/RendererBackend.js';
import { getBrowserTelemetry, getRuntimeTelemetryContext } from '../telemetry/index.js';
import { setLoFiWarpIntensity } from '../resources/MaterialFactory.js';

const DEFAULT_FOG_COLOR = 0x1a0f0a;
const DEFAULT_FOG_DENSITY = 0.008;
// 5k3.7: deliberately short draw distance (legacy was 1000). Must stay larger
// than the camera-locked sky-dome radius (500) so the dome never clips.
const SHORT_DRAW_DISTANCE = 600;
const MAX_RENDER_PIXEL_RATIO = 2;
const MIN_RENDER_SCALE = 0.5;
const FRAME_TIMING_WINDOW = 120;
const IMPACT_SHAKE_CURVE = Object.freeze({
    lightThreshold: 0.12,
    mediumThreshold: 0.42,
    heavyThreshold: 0.72,
    baseImpulse: 0.08,
    mediumImpulse: 0.23,
    heavyImpulse: 0.48,
    eliminationImpulse: 0.72,
    maxImpact: 0.95,
    decayPerFrame: 0.58,
    hitStopPunchY: 0.1,
    hitStopPunchZ: -0.92
});
const TRANSIENT_SMASH_FLASH_CURVE = Object.freeze({
    minSeverity: 0.5,
    frames: 3,
    maxFrames: 4,
    chromaticAmount: 0.006,
    gradingBoost: 0.22,
    ditherBoost: 0.22,
    posterizeBandDrop: 2,
    maxChromaticAmount: 0.008
});

const HOST_GRADE_TIER_DEFINITIONS = Object.freeze({
    'host-native': Object.freeze({
        label: 'Native full grade',
        resolutionScale: 1,
        postProcessing: true,
        bloomEnabled: true,
        bloomStrength: 1.5,
        bloomRadius: 0.4,
        bloomThreshold: 0.85,
        colorGradingEnabled: true,
        gradingIntensity: 0.7,
        posterizeBandCount: 7,
        ditherStrength: 0.55,
        scanlineAmount: 0.08,
        vignetteAmount: 0.3,
        filmGrainAmount: 0.12,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        fogEnabled: true,
        fogDensity: DEFAULT_FOG_DENSITY,
        shadowsEnabled: false,
        shadowMapType: 'none'  // 5k3.9: blob contact shadows replace full-scene shadow maps
    }),
    'host-balanced': Object.freeze({
        label: 'Balanced shared-screen host',
        resolutionScale: 0.85,
        postProcessing: true,
        bloomEnabled: true,
        bloomStrength: 0.9,
        bloomRadius: 0.25,
        bloomThreshold: 0.92,
        colorGradingEnabled: true,
        gradingIntensity: 0.62,
        posterizeBandCount: 6,
        ditherStrength: 0.5,
        scanlineAmount: 0.05,
        vignetteAmount: 0.22,
        filmGrainAmount: 0.08,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        fogEnabled: true,
        fogDensity: 0.007,
        shadowsEnabled: false,
        shadowMapType: 'none'  // 5k3.9: blob contact shadows replace full-scene shadow maps
    }),
    'host-degraded': Object.freeze({
        label: 'Degraded shared-screen host',
        resolutionScale: 0.7,
        postProcessing: true,
        bloomEnabled: false,
        bloomStrength: 0,
        bloomRadius: 0,
        bloomThreshold: 1,
        colorGradingEnabled: true,
        gradingIntensity: 0.5,
        posterizeBandCount: 5,
        ditherStrength: 0.42,
        scanlineAmount: 0.03,
        vignetteAmount: 0.16,
        filmGrainAmount: 0.05,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        fogEnabled: true,
        fogDensity: 0.006,
        shadowsEnabled: false,
        shadowMapType: 'none'  // 5k3.9
    }),
    'host-fallback': Object.freeze({
        label: 'Fallback no-post host',
        resolutionScale: 0.55,
        postProcessing: false,
        bloomEnabled: false,
        bloomStrength: 0,
        bloomRadius: 0,
        bloomThreshold: 1,
        colorGradingEnabled: false,
        gradingIntensity: 0,
        posterizeBandCount: 0,
        ditherStrength: 0,
        scanlineAmount: 0,
        vignetteAmount: 0,
        filmGrainAmount: 0,
        chromaticAberrationEnabled: false,
        chromaticAberrationAmount: 0,
        fogEnabled: true,
        fogDensity: 0.005,
        shadowsEnabled: false,
        shadowMapType: 'none'  // 5k3.9
    })
});

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
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

class RenderSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container] - Container for renderer
     * @param {Object} [options.cameraConfig] - Camera configuration
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;
        this.cameraConfig = options.cameraConfig || {};

        // Renderer backend (WebGPU-first, WebGL fallback)
        this.rendererBackend = null;
        this.rendererBackendPreference = null;

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Render diagnostics for bug reports and performance analysis
        this.renderDiagnostics = {
            backend: null,
            adapterInfo: null,
            deviceLimits: null,
            requiredFeatures: [],
            fallbackReason: null,
            fallback: null,
            activeApi: null,
            rendererType: null,
            nativeWebGPU: null,
            selectionPreference: null,
            frameTimings: [],
            drawCalls: 0,
            playerCount: 0,
            viewportMode: 'host',
            visualParity: 'verified'
        };

        // Post-processing
        this.postProcessing = {
            enabled: true,
            composer: null,
            passes: {},
            initError: null,
            unsupported: false
        };

        // Host-grade ladder. Local shared-screen hosts are the performance target;
        // Local controllers remain HUD-only and are intentionally not modeled here.
        this.gradeTiers = HOST_GRADE_TIER_DEFINITIONS;
        this.activeGradeTier = 'host-native';
        this.resolutionScale = this.gradeTiers[this.activeGradeTier].resolutionScale;
        this.maxPixelRatio = MAX_RENDER_PIXEL_RATIO;
        this._filmGrainOverride = null;
        this._ditherStrengthOverride = null;
        this._scanlineAmountOverride = null;

        // Lighting
        this.lights = {};

        // Camera target (for following)
        this.cameraTarget = null;
        this.cameraOffset = { x: 0, y: 15, z: 20 };
        this.cameraLookOffset = { x: 0, y: 0, z: -5 };
        this.cameraSmoothing = 0.15;  // Smoothing factor for camera (higher = more responsive)

        // Host camera modes:
        // - party keeps all cars visible on the shared screen
        // - chase follows one selected car from behind
        // - hood sits low and forward on the selected car for a driving view
        this.cameraMode = this.cameraConfig.mode || 'party';
        this.cameraModeOrder = ['party', 'chase', 'hood'];
        this.cameraFocusTarget = null;
        this.focusCameraConfigs = {
            chase: {
                forwardOffset: -11,
                height: 5,
                lookAhead: 10,
                lookHeight: 1.4,
                fov: 58,
                smoothing: 0.24
            },
            hood: {
                forwardOffset: 2.2,
                height: 1.25,
                lookAhead: 18,
                lookHeight: 1.1,
                fov: 68,
                smoothing: 0.45
            }
        };

        // Multi-vehicle camera (keeps all vehicles in view)
        this.cameraTargets = [];  // Array of entities to track
        this.cameraLookTarget = { x: 0, y: 0, z: 0 };  // Current look-at point
        this.baseFOV = 50;  // Base field of view (reduced for tighter framing)
        this.targetFOV = 50;  // Target field of view
        this.currentFOV = 50;  // Current FOV (smoothed)
        this.fovSmoothing = 0.15;  // FOV transition speed (higher = faster)
        this.cameraMultiSmoothing = 0.15;  // Multi-vehicle camera position smoothing
        this.minFOV = 45;  // Minimum FOV (most zoomed in)
        this.maxFOV = 68;  // Maximum FOV (zoomed out for spread-out fields)
        this.boundsPadding = 10;  // Padding around vehicle bounds (in world units)
        this.baseCameraHeight = 15;  // Base camera height
        this.baseCameraDepth = 20;   // Base camera depth (distance behind center)
        this.minCameraDepth = 15;    // Minimum distance
        this.maxCameraDepth = 150;   // Maximum distance (procedural circuits are large)
        this.targetCameraDepth = 20; // Current target depth
        this.currentCameraDepth = 20; // Current depth (smoothed)

        // Camera shake effect (speed-based and collision-based)
        this.cameraShake = {
            enabled: true,
            intensity: 0.15,          // Maximum shake intensity
            speedThreshold: 60,       // km/h - speed above which shake activates
            currentOffset: { x: 0, y: 0, z: 0 },
            decayRate: IMPACT_SHAKE_CURVE.decayPerFrame,
            collisionIntensity: IMPACT_SHAKE_CURVE.heavyImpulse,
            impactCap: IMPACT_SHAKE_CURVE.maxImpact,
            impactCurve: IMPACT_SHAKE_CURVE,
            impact: 0,                // Current impact shake (decays to 0)
            time: 0,                  // Internal time counter for noise
            diagnostics: {
                lastImpulse: 0,
                lastSeverity: 0,
                lastSource: null,
                peakImpact: 0,
                samples: []
            }
        };
        this.hitStopCameraPunch = {
            framesRemaining: 0,
            framesTotal: 0,
            intensity: 0,
            lastSource: null,
            appliedFrames: 0,
            lastOffset: { x: 0, y: 0, z: 0 }
        };
        this.transientSmashFlash = {
            framesRemaining: 0,
            framesTotal: 0,
            intensity: 0,
            lastSource: null,
            appliedFrames: 0,
            lastFrameIndex: 0,
            lastValues: null,
            // 5k3.17: accessibility reduce-effects gate. When true, heavy/
            // elimination smashes never enable the CA/posterize/dither pulse.
            reduceEffects: false,
            diagnostics: {
                triggeredCount: 0,
                ignoredCount: 0,
                suppressedCount: 0,
                samples: []
            }
        };

        // Headlight flicker effect
        this.headlightFlicker = {
            enabled: true,
            speedThreshold: 80,       // km/h - speed above which flicker activates
            flickerChance: 0.1,       // Chance per frame to flicker
            flickerIntensity: 0.3     // How much intensity varies
        };

        // Tracked meshes
        this.meshes = new Map();  // entityId -> mesh
        this.nameTags = new Map(); // entityId -> DOMElement

        // Overlay container for name tags
        this.overlayContainer = null;

        // Rolling render timings for focused perf evidence without per-frame logs.
        this.frameTiming = {
            frameCount: 0,
            lastRenderDurationMs: 0,
            averageRenderDurationMs: 0,
            maxRenderDurationMs: 0,
            sampleWindow: []
        };

        // Default camera parameters, restored when leaving special tracks
        // (derby arenas override these to look over the tall walls)
        this._defaultCameraParams = {
            offset: { ...this.cameraOffset },
            lookOffset: { ...this.cameraLookOffset },
            baseCameraHeight: this.baseCameraHeight,
            minCameraDepth: this.minCameraDepth,
            maxCameraDepth: this.maxCameraDepth
        };

        // State
        this.initialized = false;
        this.paused = false;
    }

    /**
     * Override camera follow parameters (e.g. high angle for walled arenas)
     * @param {Object} params
     * @param {Object} [params.offset] - Single-target follow offset { x, y, z }
     * @param {Object} [params.lookOffset] - Look-at offset { x, y, z }
     * @param {number} [params.baseCameraHeight] - Multi-target camera height
     * @param {number} [params.minCameraDepth]
     * @param {number} [params.maxCameraDepth]
     */
    setCameraParams(params = {}) {
        if (params.offset) this.cameraOffset = { ...params.offset };
        if (params.lookOffset) this.cameraLookOffset = { ...params.lookOffset };
        if (params.baseCameraHeight !== undefined) this.baseCameraHeight = params.baseCameraHeight;
        if (params.minCameraDepth !== undefined) this.minCameraDepth = params.minCameraDepth;
        if (params.maxCameraDepth !== undefined) this.maxCameraDepth = params.maxCameraDepth;
    }

    /**
     * Restore default camera parameters
     */
    resetCameraParams() {
        this.setCameraParams(this._defaultCameraParams);
    }

    /**
     * Set host camera mode.
     * @param {'party'|'chase'|'hood'} mode
     * @returns {boolean} True if accepted
     */
    setCameraMode(mode) {
        if (!this.cameraModeOrder.includes(mode)) return false;
        this.cameraMode = mode;
        return true;
    }

    /**
     * Cycle through host camera modes.
     * @returns {string} Active camera mode
     */
    cycleCameraMode() {
        const currentIndex = this.cameraModeOrder.indexOf(this.cameraMode);
        const nextIndex = (currentIndex + 1) % this.cameraModeOrder.length;
        this.cameraMode = this.cameraModeOrder[nextIndex];
        return this.cameraMode;
    }

    /**
     * Set the player-centric camera focus.
     * @param {Object|string|number|null} targetOrId
     * @returns {Object|null}
     */
    setCameraFocus(targetOrId) {
        if (!targetOrId) {
            this.cameraFocusTarget = null;
            return null;
        }

        if (typeof targetOrId === 'object') {
            this.cameraFocusTarget = targetOrId;
            return this.cameraFocusTarget;
        }

        const targetId = String(targetOrId);
        this.cameraFocusTarget = this.cameraTargets.find((target) =>
            String(target.id) === targetId || String(target.playerId) === targetId
        ) || null;

        return this.cameraFocusTarget;
    }

    /**
     * Cycle the focused player for chase/hood modes.
     * @param {number} direction
     * @returns {Object|null}
     */
    cycleCameraFocus(direction = 1) {
        if (this.cameraTargets.length === 0) {
            this.cameraFocusTarget = null;
            return null;
        }

        const current = this._getCameraFocusTarget();
        const currentIndex = Math.max(0, this.cameraTargets.indexOf(current));
        const nextIndex = (currentIndex + direction + this.cameraTargets.length) % this.cameraTargets.length;
        this.cameraFocusTarget = this.cameraTargets[nextIndex];
        return this.cameraFocusTarget;
    }

    /**
     * @returns {Object|null}
     */
    getCameraFocusTarget() {
        return this._getCameraFocusTarget();
    }

    /**
     * @returns {Object}
     */
    getCameraModeInfo() {
        const focus = this._getCameraFocusTarget();
        return {
            mode: this.cameraMode,
            focusId: focus ? (focus.id || focus.playerId) : null,
            focusName: focus ? (focus.playerName || focus.name || `Player ${focus.playerId || focus.id}`) : null,
            targetCount: this.cameraTargets.length
        };
    }

    /**
     * Return the named shared-screen host grade tiers.
     * @returns {Object[]}
     */
    listGradeTiers() {
        return Object.entries(this.gradeTiers).map(([tierName, config]) => ({
            tierName,
            ...config
        }));
    }

    /**
     * Apply one of the named host-grade tiers.
     * @param {string} tierName
     * @returns {boolean}
     */
    setGradeTier(tierName) {
        if (!this.gradeTiers[tierName]) return false;
        this.activeGradeTier = tierName;
        this.resolutionScale = this.gradeTiers[tierName].resolutionScale;
        this._resetFrameTimingSamples();
        this._applyGradeTierSettings();
        this._emit('render:gradeTierChanged', {
            tierName,
            diagnostics: this.getGradeDiagnostics()
        });
        return true;
    }

    /**
     * Manual/accessibility override for animated film-grain strength — the seam
     * P7.2 (5k3.37, reduce-effects / manual visual settings) wires into. Pass a
     * 0..1 amount to force grain (0 = grain off for reduce-effects), or null to
     * clear the override and follow the auto grade-tier ladder again.
     * @param {number|null} amount
     * @returns {RenderSystem}
     */
    setFilmGrainAmount(amount) {
        if (amount === null || amount === undefined) {
            this._filmGrainOverride = null;
        } else {
            this._filmGrainOverride = Math.max(0, Math.min(1, Number(amount) || 0));
        }
        this._applyColorGradingManualOverrides();
        return this;
    }

    /**
     * Manual/accessibility override for ordered dither strength. Pass null to
     * clear the override and follow the active grade tier again.
     * @param {number|null} amount
     * @returns {RenderSystem}
     */
    setDitherStrength(amount) {
        if (amount === null || amount === undefined) {
            this._ditherStrengthOverride = null;
        } else {
            this._ditherStrengthOverride = Math.max(0, Math.min(1, Number(amount) || 0));
        }
        this._applyColorGradingManualOverrides();
        return this;
    }

    /**
     * Manual/accessibility override for scanline intensity. Pass null to clear
     * the override and follow the active grade tier again.
     * @param {number|null} amount
     * @returns {RenderSystem}
     */
    setScanlineAmount(amount) {
        if (amount === null || amount === undefined) {
            this._scanlineAmountOverride = null;
        } else {
            this._scanlineAmountOverride = Math.max(0, Math.min(1, Number(amount) || 0));
        }
        this._applyColorGradingManualOverrides();
        return this;
    }

    _applyColorGradingManualOverrides() {
        const pass = this.postProcessing?.passes?.colorGrading;
        if (!pass?.uniforms) return;

        const tierConfig = this.gradeTiers[this.activeGradeTier] || this.gradeTiers['host-native'];
        if (pass.uniforms.filmGrainAmount) {
            pass.uniforms.filmGrainAmount.value =
                this._filmGrainOverride != null
                    ? this._filmGrainOverride
                    : tierConfig?.filmGrainAmount ?? 0;
        }
        if (pass.uniforms.ditherStrength) {
            pass.uniforms.ditherStrength.value =
                this._ditherStrengthOverride != null
                    ? this._ditherStrengthOverride
                    : tierConfig?.ditherStrength ?? 0;
        }
        if (pass.uniforms.scanlineAmount) {
            pass.uniforms.scanlineAmount.value =
                this._scanlineAmountOverride != null
                    ? this._scanlineAmountOverride
                    : tierConfig?.scanlineAmount ?? 0;
        }
    }

    /**
     * Override the current render resolution scale for diagnostics or future
     * adaptive quality control. Scale is clamped to the current native target.
     * @param {number} scale
     * @returns {boolean}
     */
    setResolutionScale(scale) {
        if (!Number.isFinite(scale)) return false;
        this.resolutionScale = Math.max(MIN_RENDER_SCALE, Math.min(1, scale));
        this._resetFrameTimingSamples();
        this._applyResolutionScale();
        return true;
    }

    /**
     * Reset rolling frame timing samples.
     */
    resetFrameTimingSamples() {
        this._resetFrameTimingSamples();
    }

    _syncBackendDiagnostics() {
        if (!this.rendererBackend) {
            return { ...this.renderDiagnostics };
        }

        const backendDiagnostics = this.rendererBackend.getDiagnostics?.() || {};
        this.renderDiagnostics.backend = backendDiagnostics.backend ?? this.rendererBackend.name ?? null;
        this.renderDiagnostics.adapterInfo = backendDiagnostics.adapterInfo ?? null;
        this.renderDiagnostics.deviceLimits = backendDiagnostics.deviceLimits ?? null;
        this.renderDiagnostics.requiredFeatures = backendDiagnostics.requiredFeatures ?? [];
        this.renderDiagnostics.supportedFeatures = backendDiagnostics.supportedFeatures ?? [];
        this.renderDiagnostics.fallback = backendDiagnostics.fallback ?? null;
        this.renderDiagnostics.fallbackReason =
            backendDiagnostics.fallback?.reason
            ?? backendDiagnostics.reason
            ?? null;
        this.renderDiagnostics.activeApi = backendDiagnostics.activeApi ?? null;
        this.renderDiagnostics.rendererType =
            backendDiagnostics.rendererType
            ?? this.renderer?.constructor?.name
            ?? null;
        this.renderDiagnostics.nativeWebGPU = backendDiagnostics.nativeWebGPU ?? null;
        this.renderDiagnostics.rendererInitialized =
            backendDiagnostics.rendererInitialized
            ?? this.renderer?.initialized
            ?? null;
        this.renderDiagnostics.selectionPreference = this.rendererBackendPreference
            ? { ...this.rendererBackendPreference }
            : null;
        return { ...this.renderDiagnostics };
    }

    /**
     * Return render diagnostics for bug reports and performance analysis.
     * Includes backend selection, adapter info, device limits, and frame timing.
     * @returns {Object}
     */
    getRenderDiagnostics() {
        const diagnostics = this._syncBackendDiagnostics();
        // Add current frame metrics
        if (this.renderer?.info?.render) {
            diagnostics.drawCalls = this.renderer.info.render.calls || 0;
        }
        diagnostics.frameTimings = this.frameTiming.averageRenderDurationMs
            ? [this.frameTiming.averageRenderDurationMs]
            : [];
        return diagnostics;
    }

    /**
     * Public render diagnostics (tone mapping, fog, grade, backend). Alias of
     * getGradeDiagnostics used by design-language evidence specs (e.g. 5k3.7).
     * @returns {Object}
     */
    getDiagnostics() {
        return this.getGradeDiagnostics();
    }

    /**
     * Return stable renderer metadata for perf/evidence capture.
     * @returns {Object}
     */
    getGradeDiagnostics() {
        const renderer = this.renderer;
        const scene = this.scene;
        const activeTierConfig = this.gradeTiers[this.activeGradeTier] || null;
        const size = renderer ? renderer.getSize(new THREE.Vector2()) : { x: 0, y: 0 };
        const renderInfo = renderer?.info?.render || {};
        const memoryInfo = renderer?.info?.memory || {};
        const capabilities = renderer?.capabilities || {};
        const backendDiagnostics = this.getRenderDiagnostics();

        return {
            activeTier: this.activeGradeTier,
            tierConfig: activeTierConfig ? { ...activeTierConfig } : null,
            resolutionScale: this.resolutionScale,
            effectivePixelRatio: renderer?.getPixelRatio?.() ?? null,
            renderTarget: this._getRenderTargetMetrics(),
            viewport: {
                width: size.x ?? 0,
                height: size.y ?? 0
            },
            backend: {
                backendAdapter: this.rendererBackend?.name ?? 'unknown',
                backendDiagnostics,
                renderer: renderer?.isWebGLRenderer
                    ? 'WebGLRenderer'
                    : renderer?.isWebGPURenderer
                        ? 'WebGPURenderer'
                        : renderer?.constructor?.name ?? null,
                activeApi: backendDiagnostics.activeApi ?? null,
                nativeWebGPU: backendDiagnostics.nativeWebGPU ?? null,
                fallback: backendDiagnostics.fallback ?? null,
                isWebGL2: capabilities?.isWebGL2 ?? null,
                precision: capabilities?.precision ?? null,
                maxTextures: capabilities?.maxTextures ?? null,
                maxTextureSize: capabilities?.maxTextureSize ?? null,
                maxCubemapSize: capabilities?.maxCubemapSize ?? null
            },
            toneMapping: {
                decision: 'skip-aces',
                mode: this._getToneMappingName(renderer?.toneMapping)
            },
            fog: {
                enabled: !!scene?.fog,
                density: scene?.fog?.density ?? null,
                color: scene?.fog?.color?.getHex?.() ?? null
            },
            postProcessing: {
                enabled: this.postProcessing.enabled,
                composerReady: !!this.postProcessing.composer,
                initError: this.postProcessing.initError,
                bloomEnabled: !!this.postProcessing.passes.bloom?.enabled,
                bloomStrength: this.postProcessing.passes.bloom?.strength ?? null,
                colorGradingEnabled: !!this.postProcessing.passes.colorGrading?.enabled,
                colorGradingStyle: this.postProcessing.passes.colorGrading?.enabled
                    ? 'skip-bin-arcade-posterize-dither'
                    : null,
                gradingIntensity: this.postProcessing.passes.colorGrading?.uniforms?.gradingIntensity?.value ?? null,
                posterizeBandCount: this.postProcessing.passes.colorGrading?.uniforms?.posterizeBandCount?.value ?? null,
                ditherStrength: this.postProcessing.passes.colorGrading?.uniforms?.ditherStrength?.value ?? null,
                ditherOverride: this._ditherStrengthOverride ?? null,
                ditherPattern: this.postProcessing.passes.colorGrading?.enabled ? 'bayer-4x4' : null,
                scanlineAmount: this.postProcessing.passes.colorGrading?.uniforms?.scanlineAmount?.value ?? null,
                scanlineOverride: this._scanlineAmountOverride ?? null,
                vignetteAmount: this.postProcessing.passes.colorGrading?.uniforms?.vignetteAmount?.value ?? null,
                filmGrainAmount: this.postProcessing.passes.colorGrading?.uniforms?.filmGrainAmount?.value ?? null,
                filmGrainScale: this.postProcessing.passes.colorGrading?.uniforms?.filmGrainScale?.value ?? null,
                filmGrainSpeed: this.postProcessing.passes.colorGrading?.uniforms?.filmGrainSpeed?.value ?? null,
                filmGrainAnimated: !!(this.postProcessing.passes.colorGrading?.enabled
                    && (this.postProcessing.passes.colorGrading?.uniforms?.filmGrainAmount?.value ?? 0) > 0),
                filmGrainOverride: this._filmGrainOverride ?? null,
                chromaticAberrationEnabled: !!this.postProcessing.passes.chromaticAberration?.enabled,
                chromaticAberrationAmount: this.postProcessing.passes.chromaticAberration?.uniforms?.amount?.value ?? null
            },
            shadows: {
                enabled: renderer?.shadowMap?.enabled ?? null,
                type: this._getShadowMapTypeName(renderer?.shadowMap?.type),
                // 5k3.9: full-scene soft shadows are replaced by per-car blob
                // contact shadows. Report the mode so validators/diagnostics see
                // contact/disabled, never PCFSoft.
                mode: renderer?.shadowMap?.enabled ? 'full-scene' : 'contact-blob'
            },
            renderInfo: {
                calls: renderInfo.calls ?? null,
                triangles: renderInfo.triangles ?? null,
                lines: renderInfo.lines ?? null,
                points: renderInfo.points ?? null,
                frame: renderInfo.frame ?? null,
                geometries: memoryInfo.geometries ?? null,
                textures: memoryInfo.textures ?? null,
                programs: Array.isArray(renderer?.info?.programs) ? renderer.info.programs.length : null
            },
            frameTiming: {
                frameCount: this.frameTiming.frameCount,
                lastRenderDurationMs: this.frameTiming.lastRenderDurationMs,
                averageRenderDurationMs: this.frameTiming.averageRenderDurationMs,
                maxRenderDurationMs: this.frameTiming.maxRenderDurationMs
            },
            cameraMode: this.getCameraModeInfo(),
            trackedVehicles: this.cameraTargets.length || (this.cameraTarget ? 1 : 0),
            nameTagCount: this.nameTags.size
        };
    }

    /**
     * Toggle the optional per-material world warp across currently rendered
     * scene materials. Presentation-only: it does not affect physics, input, or
     * authoritative game state.
     * @param {Object} [options]
     * @returns {Object} material-warp diagnostics after applying the toggle
     */
    setMaterialWarpEnabled(options = {}) {
        const enabled = Boolean(options.enabled);
        const vertexSnapIntensity = enabled ? clamp01(options.vertexSnapIntensity ?? 0.35) : 0;
        const affineIntensity = enabled ? clamp01(options.affineIntensity ?? 0.12) : 0;
        const snapGridSize = clampPositive(options.snapGridSize ?? 0.5, 0.5);

        this._forEachSceneMaterial((material) => {
            const warp = material.userData?.skipBinWarp;
            if (!warp || warp.exempt || !warp.eligible) {
                return;
            }
            setLoFiWarpIntensity(material, {
                ...warp,
                enabled,
                vertexSnapIntensity,
                affineIntensity,
                snapGridSize
            });
        });

        return this.getMaterialWarpDiagnostics();
    }

    /**
     * Count and sample material-warp state from the live scene.
     * @returns {Object}
     */
    getMaterialWarpDiagnostics() {
        const diagnostics = {
            schema: 'jj.materialWarp.diagnostics.v1',
            totalMaterials: 0,
            hookInstalled: 0,
            eligible: 0,
            exempt: 0,
            active: 0,
            inactiveEligible: 0,
            roles: {},
            activeVertexSnapIntensity: 0,
            activeAffineIntensity: 0,
            activeSnapGridSize: null,
            worldVertexDeltaMax: 0,
            vehicleReadableActive: 0
        };

        this._forEachSceneMaterial((material, object) => {
            const warp = material.userData?.skipBinWarp || null;
            diagnostics.totalMaterials += 1;
            if (material.userData?.skipBinWarpHookInstalled) {
                diagnostics.hookInstalled += 1;
            }
            if (!warp) return;

            const role = warp.role || 'unclassified';
            diagnostics.roles[role] = diagnostics.roles[role] || {
                total: 0,
                eligible: 0,
                exempt: 0,
                active: 0
            };
            diagnostics.roles[role].total += 1;

            if (warp.eligible) {
                diagnostics.eligible += 1;
                diagnostics.roles[role].eligible += 1;
            }
            if (warp.exempt) {
                diagnostics.exempt += 1;
                diagnostics.roles[role].exempt += 1;
            }
            if (warp.enabled) {
                diagnostics.active += 1;
                diagnostics.roles[role].active += 1;
                diagnostics.activeVertexSnapIntensity = Math.max(
                    diagnostics.activeVertexSnapIntensity,
                    Number(warp.vertexSnapIntensity) || 0
                );
                diagnostics.activeAffineIntensity = Math.max(
                    diagnostics.activeAffineIntensity,
                    Number(warp.affineIntensity) || 0
                );
                diagnostics.activeSnapGridSize = Number(warp.snapGridSize) || diagnostics.activeSnapGridSize;
                if (role === 'world' || role === 'decorative-prop') {
                    diagnostics.worldVertexDeltaMax = Math.max(
                        diagnostics.worldVertexDeltaMax,
                        this._estimateWarpVertexDelta(object, warp)
                    );
                }
                if (role === 'vehicle-readable') {
                    diagnostics.vehicleReadableActive += 1;
                }
            } else if (warp.eligible) {
                diagnostics.inactiveEligible += 1;
            }
        });

        return diagnostics;
    }

    _forEachSceneMaterial(callback) {
        if (!this.scene || typeof this.scene.traverse !== 'function') {
            return;
        }

        this.scene.traverse((object) => {
            const materials = object?.material
                ? (Array.isArray(object.material) ? object.material : [object.material])
                : [];
            materials.forEach((material) => {
                if (material) {
                    callback(material, object);
                }
            });
        });
    }

    _estimateWarpVertexDelta(object, warp) {
        const position = object?.geometry?.attributes?.position;
        const grid = Number(warp?.snapGridSize) || 0;
        const intensity = Number(warp?.vertexSnapIntensity) || 0;
        if (!position || grid <= 0 || intensity <= 0) {
            return 0;
        }

        const count = Math.min(position.count || 0, 128);
        let maxDelta = 0;
        for (let i = 0; i < count; i++) {
            const x = position.getX(i);
            const y = position.getY(i);
            const z = position.getZ(i);
            const sx = Math.floor(x / grid + 0.5) * grid;
            const sy = Math.floor(y / grid + 0.5) * grid;
            const sz = Math.floor(z / grid + 0.5) * grid;
            const dx = (sx - x) * intensity;
            const dy = (sy - y) * intensity;
            const dz = (sz - z) * intensity;
            maxDelta = Math.max(maxDelta, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        return maxDelta;
    }

    /**
     * Initialize Three.js
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        console.log('RenderSystem: Initializing...');

        // Select and initialize renderer backend (WebGPU-first, WebGL fallback)
        try {
            this.rendererBackendPreference = this._resolveRendererBackendPreference();
            this.rendererBackend = await selectRendererBackend(this.rendererBackendPreference);
            console.log(`RenderSystem: Selected backend: ${this.rendererBackend.name}`);
        } catch (error) {
            console.error('RenderSystem: Failed to select renderer backend:', error);
            throw new Error('No compatible renderer backend available');
        }

        // Capture backend diagnostics
        this._syncBackendDiagnostics();

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a0f0a);  // Midnight (Sunset Neon theme)

        // Create sky dome first so the fog colour can match its horizon band.
        this._createSkyDome();

        // Fog (5k3.7): FogExp2 whose colour equals the sky-dome horizon band, so
        // the world dissolves into the sky with no hard seam at the draw edge.
        const horizonColor = this.skyDome?.material?.uniforms?.horizonColor?.value;
        this.scene.fog = new THREE.FogExp2(horizonColor ? horizonColor.getHex() : 0x4a2510, 0.008);

        // Create camera. Draw distance (5k3.7) is deliberately short — capped well
        // under the legacy 1000 — but still larger than the camera-locked sky dome
        // (radius 500) so the dome never clips.
        const aspect = window.innerWidth / window.innerHeight;
        const cameraFar = Math.min(this.cameraConfig.far || SHORT_DRAW_DISTANCE, SHORT_DRAW_DISTANCE);
        this.camera = new THREE.PerspectiveCamera(
            this.cameraConfig.fov || this.baseFOV,
            aspect,
            this.cameraConfig.near || 0.1,
            cameraFar
        );
        this.camera.position.set(0, 20, 30);
        this.camera.lookAt(0, 0, 0);

        // Create renderer using selected backend
        // preserveDrawingBuffer keeps the buffer readable so the bug
        // reporter can grab a screenshot via canvas.toDataURL() at any time.
        try {
            this.renderer = await createBackendRenderer(this.rendererBackend, {
                antialias: true,
                alpha: false,
                preserveDrawingBuffer: true
            });
            this._syncBackendDiagnostics();
            console.log(`RenderSystem: Renderer created (${this.rendererBackend.name})`);
        } catch (error) {
            console.error('RenderSystem: Failed to create renderer:', error);
            throw new Error(`Failed to create ${this.rendererBackend.name} renderer: ${error.message}`);
        }

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1;
        // 5k3.9: blob contact shadows replace full-scene soft shadow maps.
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this._applyPixelatedUpscale();
        this._applyResolutionScale();
        this._emitTelemetryWebGLInit();

        // Add to container
        this.container.appendChild(this.renderer.domElement);

        // Create overlay container for name tags
        this.overlayContainer = document.createElement('div');
        this.overlayContainer.id = 'name-tag-overlay';
        this.overlayContainer.className = 'name-tag-overlay'; // Add class for styling
        this.overlayContainer.style.position = 'absolute';
        this.overlayContainer.style.top = '0';
        this.overlayContainer.style.left = '0';
        this.overlayContainer.style.width = '100%';
        this.overlayContainer.style.height = '100%';
        this.overlayContainer.style.pointerEvents = 'none';
        this.overlayContainer.style.overflow = 'hidden';
        this.overlayContainer.style.zIndex = '10';
        this.container.appendChild(this.overlayContainer);

        // Setup default lighting
        this._setupDefaultLighting();
        this._applyGradeTierSettings();

        // Initialize post-processing (async, but don't block initialization)
        this._initPostProcessing().catch((error) => {
            this.postProcessing.initError = String(error);
            console.warn('RenderSystem: Post-processing initialization failed, continuing without it:', error);
            this.postProcessing.enabled = false;
        });

        // Handle window resize (bound once so destroy() can remove it)
        this._boundOnResize = this._onResize.bind(this);
        window.addEventListener('resize', this._boundOnResize);
        this._boundOnContextLost = this._onContextLost.bind(this);
        const canvas = this.renderer?.domElement;
        canvas?.addEventListener?.('webglcontextlost', this._boundOnContextLost, false);

        // Impact shake on crashes and explosions
        if (this.eventBus) {
            this.eventBus.on('damage:vehicleCollision', (data) => {
                const severity = clamp01((Number(data?.damage) || 0) / 40);
                this.addImpactShake({
                    damage: data?.damage ?? 10,
                    source: 'damage:vehicleCollision'
                });
                this.triggerTransientSmashFlash({
                    severity,
                    source: 'damage:vehicleCollision'
                });
            });
            this.eventBus.on('weapon:explosion', (data) => {
                this.addImpactShake({
                    severity: data?.severity ?? 0.8,
                    source: 'weapon:explosion'
                });
                this.triggerTransientSmashFlash({
                    severity: data?.severity ?? 0.8,
                    source: 'weapon:explosion'
                });
            });
            this.eventBus.on('damage:destroyed', () => {
                this.addImpactShake({
                    severity: 1,
                    elimination: true,
                    source: 'damage:destroyed'
                });
                this.triggerTransientSmashFlash({
                    severity: 1,
                    elimination: true,
                    source: 'damage:destroyed'
                });
            });
        }

        this.initialized = true;
        this._emit('render:ready');
        console.log('RenderSystem: Ready');
    }

    _emitTelemetryWebGLInit() {
        const telemetry = getBrowserTelemetry?.();
        if (!telemetry?.capture) {
            return;
        }
        const backendDiagnostics = this._syncBackendDiagnostics();
        telemetry.capture('perf:webgl:init', {
            backend: this.rendererBackend?.name || 'unknown',
            activeApi: backendDiagnostics.activeApi || null,
            nativeWebGPU: backendDiagnostics.nativeWebGPU ?? null,
            backendGrade: this.activeGradeTier || 'host-native',
            isWebGL2: !!this.renderer?.isWebGL2,
            drawingBufferWidth: this.renderer?.domElement?.width || null,
            drawingBufferHeight: this.renderer?.domElement?.height || null,
            ...(getRuntimeTelemetryContext ? getRuntimeTelemetryContext() : {}),
        });
    }

    _resolveRendererBackendPreference() {
        const preference = {
            // Keep WebGL as the default host path until the WebGPU compositor has
            // parity with the existing visual-effects stack. WebGPU remains an
            // explicit first-class backend via query/localStorage/diagnostics.
            preferWebGPU: false,
            forceWebGL: true,
            killswitch: false,
            source: 'default-webgl-visual-effects-parity'
        };

        if (typeof window === 'undefined') {
            return preference;
        }

        const params = new URLSearchParams(window.location?.search || '');
        const queryValue = (
            params.get('renderer')
            || params.get('renderBackend')
            || params.get('backend')
            || ''
        ).toLowerCase();
        const webgpuFlag = (params.get('webgpu') || '').toLowerCase();
        const forceWebGLFlag = (params.get('forceWebGL') || params.get('force-webgl') || '').toLowerCase();
        const disableWebGPUFlag = (params.get('disableWebGPU') || params.get('disable-webgpu') || '').toLowerCase();
        const globalPreference = String(window.__JJ_RENDERER_BACKEND__ || '').toLowerCase();
        let storedPreference = '';
        try {
            storedPreference = String(window.localStorage?.getItem('jjRendererBackend') || '').toLowerCase();
        } catch (e) {
            storedPreference = '';
        }

        const requested = queryValue || webgpuFlag || forceWebGLFlag || disableWebGPUFlag || globalPreference || storedPreference;
        if (queryValue === 'webgpu' || webgpuFlag === '1' || webgpuFlag === 'true' || globalPreference === 'webgpu' || storedPreference === 'webgpu') {
            return {
                preferWebGPU: true,
                forceWebGL: false,
                killswitch: false,
                source: queryValue === 'webgpu' || webgpuFlag ? 'query-webgpu' : 'stored-webgpu'
            };
        }

        if (
            queryValue === 'webgl'
            || queryValue === 'webgl2'
            || forceWebGLFlag === '1'
            || forceWebGLFlag === 'true'
            || disableWebGPUFlag === '1'
            || disableWebGPUFlag === 'true'
            || globalPreference === 'webgl'
            || storedPreference === 'webgl'
        ) {
            return {
                preferWebGPU: false,
                forceWebGL: true,
                killswitch: disableWebGPUFlag === '1' || disableWebGPUFlag === 'true',
                source: requested ? 'explicit-webgl' : preference.source
            };
        }

        return preference;
    }

    _onContextLost(event = {}) {
        event.preventDefault?.();
        const telemetry = getBrowserTelemetry?.();
        if (telemetry?.capture) {
            telemetry.capture('perf:webgl:context_lost', {
                backend: this.rendererBackend?.name || 'unknown',
                reason: String(event?.reason || 'unknown'),
                ...(getRuntimeTelemetryContext ? getRuntimeTelemetryContext() : {})
            });
        }
        if (typeof window !== 'undefined' && window.__JJ_TELEMETRY__?.captureWebGLContextLoss) {
            window.__JJ_TELEMETRY__.captureWebGLContextLoss(event, {
                source: 'RenderSystem',
            });
        }
    }

    /**
     * Add a one-off impact shake (decays automatically). Accepts the legacy
     * numeric impulse path plus structured impact data for severity diagnostics.
     * @param {number|Object} impact - Shake impulse or impact descriptor
     */
    addImpactShake(impact) {
        const resolved = this._resolveImpactShakeImpulse(impact);
        if (resolved.impulse <= 0) return resolved;
        this.cameraShake.impact = Math.min(
            this.cameraShake.impactCap ?? IMPACT_SHAKE_CURVE.maxImpact,
            this.cameraShake.impact + resolved.impulse
        );
        this.cameraShake.diagnostics.lastImpulse = resolved.impulse;
        this.cameraShake.diagnostics.lastSeverity = resolved.severity;
        this.cameraShake.diagnostics.lastSource = resolved.source;
        this.cameraShake.diagnostics.peakImpact = Math.max(
            this.cameraShake.diagnostics.peakImpact,
            this.cameraShake.impact
        );
        this._recordImpactShakeSample(this.cameraShake.impact);
        return resolved;
    }

    getImpactShakeDiagnostics() {
        return {
            enabled: this.cameraShake.enabled,
            impact: this.cameraShake.impact,
            decayRate: this.cameraShake.decayRate,
            impactCap: this.cameraShake.impactCap,
            curve: { ...this.cameraShake.impactCurve },
            diagnostics: {
                ...this.cameraShake.diagnostics,
                samples: [...this.cameraShake.diagnostics.samples]
            }
        };
    }

    sampleImpactShakeDecay(impact, frameCount = 12) {
        const resolved = this._resolveImpactShakeImpulse(impact);
        const samples = [];
        let value = resolved.impulse;
        for (let frame = 0; frame <= frameCount; frame++) {
            samples.push({
                frame,
                impact: Number(value.toFixed(6))
            });
            value = this._decayImpactShakeValue(value, 1 / 60);
        }
        return {
            resolved,
            samples
        };
    }

    /**
     * Trigger a short render-only hit-stop camera punch. This is separate from
     * physics/update timing and never changes global simulation speed.
     * @param {Object} options
     * @param {number} options.frames
     * @param {number} options.intensity
     * @param {string} [options.source]
     */
    triggerHitStopCameraPunch(options = {}) {
        const frames = Math.max(0, Math.min(3, Math.round(options.frames || 0)));
        if (frames <= 0) return;
        const intensity = Math.max(0, Math.min(1, Number(options.intensity) || 0));
        this.hitStopCameraPunch.framesRemaining = Math.max(
            this.hitStopCameraPunch.framesRemaining,
            frames
        );
        this.hitStopCameraPunch.framesTotal = Math.max(
            this.hitStopCameraPunch.framesTotal,
            frames
        );
        this.hitStopCameraPunch.intensity = Math.max(this.hitStopCameraPunch.intensity, intensity);
        this.hitStopCameraPunch.lastSource = options.source || 'hit-stop';
    }

    getHitStopRenderDiagnostics() {
        return {
            framesRemaining: this.hitStopCameraPunch.framesRemaining,
            framesTotal: this.hitStopCameraPunch.framesTotal,
            intensity: this.hitStopCameraPunch.intensity,
            lastSource: this.hitStopCameraPunch.lastSource,
            appliedFrames: this.hitStopCameraPunch.appliedFrames,
            lastOffset: { ...this.hitStopCameraPunch.lastOffset },
            physicsTimeScale: 1
        };
    }

    /**
     * Enable/disable the accessibility reduce-effects gate for the transient
     * smash flash (the 5k3.37 manual/a11y seam wires this). When enabled, any
     * in-flight pulse is cleared to neutral immediately and future triggers are
     * suppressed. Clearing it restores the normal pulse behavior.
     * @param {boolean} enabled
     * @returns {RenderSystem}
     */
    setTransientSmashFlashReduceEffects(enabled) {
        this.transientSmashFlash.reduceEffects = !!enabled;
        if (this.transientSmashFlash.reduceEffects) {
            // Force neutral: kill any active pulse so nothing lingers.
            this.transientSmashFlash.framesRemaining = 0;
            this.transientSmashFlash.framesTotal = 0;
            this.transientSmashFlash.intensity = 0;
        }
        return this;
    }

    triggerTransientSmashFlash(options = {}) {
        const curve = TRANSIENT_SMASH_FLASH_CURVE;
        const severity = options.elimination ? 1 : clamp01(options.severity);

        // 5k3.17 reduce-effects gate: suppress the flash entirely (even heavy /
        // elimination). Return triggered=false + reason, and keep the pulse neutral.
        if (this.transientSmashFlash.reduceEffects) {
            this.transientSmashFlash.framesRemaining = 0;
            this.transientSmashFlash.framesTotal = 0;
            this.transientSmashFlash.intensity = 0;
            this.transientSmashFlash.diagnostics.suppressedCount += 1;
            return {
                triggered: false,
                severity,
                reason: 'reduce-effects'
            };
        }

        if (severity < curve.minSeverity) {
            this.transientSmashFlash.diagnostics.ignoredCount += 1;
            return {
                triggered: false,
                severity,
                reason: 'below-threshold'
            };
        }

        const intensity = clamp01(options.intensity ?? severity);
        const frames = Math.max(1, Math.min(
            curve.maxFrames,
            Math.round(options.frames ?? (options.elimination ? curve.maxFrames : curve.frames))
        ));

        this.transientSmashFlash.framesRemaining = Math.max(
            this.transientSmashFlash.framesRemaining,
            frames
        );
        this.transientSmashFlash.framesTotal = Math.max(
            this.transientSmashFlash.framesTotal,
            frames
        );
        this.transientSmashFlash.intensity = Math.max(this.transientSmashFlash.intensity, intensity);
        this.transientSmashFlash.lastSource = options.source || 'smash-flash';
        this.transientSmashFlash.diagnostics.triggeredCount += 1;

        return {
            triggered: true,
            severity,
            intensity: this.transientSmashFlash.intensity,
            frames: this.transientSmashFlash.framesRemaining,
            source: this.transientSmashFlash.lastSource
        };
    }

    getTransientSmashFlashDiagnostics() {
        return {
            framesRemaining: this.transientSmashFlash.framesRemaining,
            framesTotal: this.transientSmashFlash.framesTotal,
            intensity: this.transientSmashFlash.intensity,
            lastSource: this.transientSmashFlash.lastSource,
            appliedFrames: this.transientSmashFlash.appliedFrames,
            lastFrameIndex: this.transientSmashFlash.lastFrameIndex,
            lastValues: this.transientSmashFlash.lastValues
                ? { ...this.transientSmashFlash.lastValues }
                : null,
            curve: { ...TRANSIENT_SMASH_FLASH_CURVE },
            diagnostics: {
                ...this.transientSmashFlash.diagnostics,
                samples: this.transientSmashFlash.diagnostics.samples.map((sample) => ({ ...sample }))
            },
            physicsTimeScale: 1
        };
    }

    sampleTransientSmashFlash(options = {}, frameCount = 5) {
        const render = new RenderSystem({ eventBus: null, container: this.container || {} });
        render.postProcessing = {
            enabled: true,
            composer: null,
            passes: this._createTransientSmashFlashTestPasses()
        };
        render.activeGradeTier = this.activeGradeTier;
        render.gradeTiers = this.gradeTiers;
        // Mirror the reduce-effects gate onto the sampled instance so the
        // deterministic sampler faithfully reflects this instance's state.
        render.setTransientSmashFlashReduceEffects(this.transientSmashFlash.reduceEffects);
        const triggerResult = render.triggerTransientSmashFlash(options);
        const samples = [];
        for (let frame = 0; frame < frameCount; frame++) {
            samples.push(render._applyTransientSmashFlash());
        }
        return {
            triggerResult,
            trigger: render.getTransientSmashFlashDiagnostics(),
            samples
        };
    }

    /**
     * Initialize post-processing (Bloom effect)
     * @private
     * @returns {Promise<void>}
     */
    async _initPostProcessing() {
        try {
            if (this.renderer?.isWebGPURenderer && this.renderer?.isWebGLRenderer !== true) {
                this.postProcessing.initError = 'Post-processing compositor is WebGL-only for this renderer path';
                this.postProcessing.unsupported = true;
                this.postProcessing.enabled = false;
                return;
            }

            // Import post-processing modules (Vite resolves from node_modules)
            const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
            const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
            const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
            const { ShaderPass } = await import('three/examples/jsm/postprocessing/ShaderPass.js');
            const { RGBShiftShader } = await import('three/examples/jsm/shaders/RGBShiftShader.js');

            // Create composer
            this.postProcessing.composer = new EffectComposer(this.renderer);

            // Add render pass
            const renderPass = new RenderPass(this.scene, this.camera);
            this.postProcessing.composer.addPass(renderPass);
            this.postProcessing.passes.render = renderPass;

            // Add bloom pass with MAXIMAL settings
            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                1.5,  // strength - MAXIMAL!
                0.4,  // radius
                0.85  // threshold
            );
            this.postProcessing.composer.addPass(bloomPass);
            this.postProcessing.passes.bloom = bloomPass;

            // Add posterize + ordered dither grade pass (after bloom)
            try {
                const { ColorGradingShader } = await import('../shaders/ColorGradingShader.js');
                const colorGradingPass = new ShaderPass(ColorGradingShader);
                colorGradingPass.uniforms.gradingIntensity.value = 0.7;
                colorGradingPass.uniforms.posterizeBandCount.value = 7;
                colorGradingPass.uniforms.ditherStrength.value = 0.55;
                colorGradingPass.uniforms.scanlineAmount.value = 0.08;
                colorGradingPass.uniforms.vignetteAmount.value = 0.3;
                // Animated film grain seed values; _applyGradeTierSettings sets the
                // per-tier amount and _renderScene advances `time` each frame.
                colorGradingPass.uniforms.filmGrainAmount.value = 0.12;
                colorGradingPass.uniforms.filmGrainScale.value = 1.5;
                colorGradingPass.uniforms.filmGrainSpeed.value = 12.0;
                this.postProcessing.composer.addPass(colorGradingPass);
                this.postProcessing.passes.colorGrading = colorGradingPass;
            } catch (error) {
                console.warn('RenderSystem: Failed to load ColorGradingShader, skipping posterize grade:', error);
            }

            // Add chromatic aberration pass (after color grading)
            try {
                const rgbShiftPass = new ShaderPass(RGBShiftShader);
                rgbShiftPass.uniforms.amount.value = 0.0015; // Subtle speed warp
                this.postProcessing.composer.addPass(rgbShiftPass);
                this.postProcessing.passes.chromaticAberration = rgbShiftPass;
            } catch (error) {
                console.warn('RenderSystem: Failed to add chromatic aberration, skipping:', error);
            }

            this._applyGradeTierSettings();
            console.log('RenderSystem: Post-processing initialized with all effects');
        } catch (error) {
            console.error('RenderSystem: Error loading post-processing modules:', error);
            throw error; // Re-throw so caller can handle
        }
    }

    /**
     * Setup default lighting
     * @private
     */
    _setupDefaultLighting() {
        // Ambient light - warm amber for sunset atmosphere
        const ambient = new THREE.AmbientLight(0xffaa44, 0.3);
        this.scene.add(ambient);
        this.lights.ambient = ambient;

        // Directional light (golden sun)
        const directional = new THREE.DirectionalLight(0xffcc66, 0.5);
        directional.position.set(50, 100, 50);
        directional.castShadow = true;

        // Shadow camera setup
        directional.shadow.camera.left = -50;
        directional.shadow.camera.right = 50;
        directional.shadow.camera.top = 50;
        directional.shadow.camera.bottom = -50;
        directional.shadow.camera.near = 0.5;
        directional.shadow.camera.far = 200;
        directional.shadow.mapSize.width = 2048;
        directional.shadow.mapSize.height = 2048;

        this.scene.add(directional);
        this.lights.directional = directional;
    }

    /**
     * Create sky dome with gradient
     * @private
     */
    _createSkyDome() {
        // Create large inverted sphere for sky
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);

        // Custom shader material for gradient sky
        const skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                // Skybox in the world palette (5k3.30): flat gradient dome, no HDRI.
                // Dusk zenith -> warm rust horizon band -> ink base. The horizon
                // band doubles as the FogExp2 colour (5k3.7) so world dissolves into
                // sky with no seam.
                topColor: { value: new THREE.Color(0x3A3550) },     // DUSK
                bottomColor: { value: new THREE.Color(0x14110F) },  // INK
                horizonColor: { value: new THREE.Color(0x7A4A2E) }, // RUST (horizon glow)
                offset: { value: 33 },
                exponent: { value: 0.6 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform vec3 horizonColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    // Two-stage gradient: bottom to horizon, horizon to top
                    vec3 color;
                    if (h < 0.3) {
                        color = mix(bottomColor, horizonColor, h / 0.3);
                    } else {
                        color = mix(horizonColor, topColor, (h - 0.3) / 0.7);
                    }
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false
        });

        const skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
        skyDome.name = 'skyDome';
        this.scene.add(skyDome);
        this.skyDome = skyDome;
    }

    /**
     * Configure lighting from track config
     * @param {Object} lightingConfig
     */
    setLighting(lightingConfig) {
        if (lightingConfig.ambient) {
            this.lights.ambient.color.set(lightingConfig.ambient.color);
            this.lights.ambient.intensity = lightingConfig.ambient.intensity;
        }

        if (lightingConfig.directional) {
            const dir = lightingConfig.directional;
            this.lights.directional.color.set(dir.color);
            this.lights.directional.intensity = dir.intensity;
            if (dir.position) {
                this.lights.directional.position.set(
                    dir.position.x,
                    dir.position.y,
                    dir.position.z
                );
            }
        }
    }

    /**
     * Render frame (called each animation frame)
     * @param {number} dt - Delta time
     * @param {number} interpolation - Physics interpolation factor
     */
    render(dt, interpolation) {
        if (!this.initialized || this.paused) return;

        // Update camera if following target
        this._updateCamera(dt);

        // Camera-lock the sky dome (5k3.7): keep its centre on the camera so the
        // short far-plane always encloses it, even on large procedural circuits
        // where the camera roams far from the origin.
        if (this.skyDome) {
            this.skyDome.position.copy(this.camera.position);
        }

        // Update name tag positions
        this._updateNameTags();

        const renderStartedAt = nowMs();
        this._renderScene();
        this._recordFrameTiming(nowMs() - renderStartedAt);
    }

    /**
     * Update name tag screen positions
     * @private
     */
    _updateNameTags() {
        if (!this.overlayContainer || this.nameTags.size === 0) return;

        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const vector = new THREE.Vector3();

        for (const [id, tagData] of this.nameTags) {
            const { element, entity } = tagData;

            // Get world position
            if (entity.mesh) {
                vector.setFromMatrixPosition(entity.mesh.matrixWorld);
            } else if (entity.position) {
                vector.set(entity.position.x, entity.position.y, entity.position.z);
            } else {
                continue;
            }

            // Offset tag above vehicle (roughly 2.2 meters)
            vector.y += 2.2;

            // Project to screen
            vector.project(this.camera);

            // Check if behind camera or outside clip space
            if (vector.z > 1) {
                element.style.display = 'none';
                continue;
            }

            element.style.display = '';
            const x = (vector.x * widthHalf) + widthHalf;
            const y = -(vector.y * heightHalf) + heightHalf;

            element.style.left = `${x}px`;
            element.style.top = `${y}px`;

            // Optional: scale with distance to keep UI readable
            const distance = this.camera.position.distanceTo(entity.mesh?.position || entity.position);
            const scale = Math.max(0.6, Math.min(1.2, 35 / distance));
            element.style.transform = `translate(-50%, -100%) scale(${scale})`;
            element.style.opacity = Math.max(0.4, Math.min(1, 60 / distance));
        }
    }

    /**
     * Update camera position (follow target or multiple targets)
     * @private
     */
    _updateCamera(dt) {
        if (this.cameraMode !== 'party' && this._updateFocusedCamera(dt)) {
            return;
        }

        // If we have multiple targets, use multi-vehicle camera
        if (this.cameraTargets.length > 1) {
            this._updateMultiVehicleCamera(dt);
            return;
        }

        // Single target fallback
        if (!this.cameraTarget) return;

        // Get target position
        let targetPos;
        if (this.cameraTarget.mesh) {
            targetPos = this.cameraTarget.mesh.position;
        } else if (this.cameraTarget.position) {
            targetPos = this.cameraTarget.position;
        } else {
            return;
        }

        // Calculate desired camera position
        const desiredPos = {
            x: targetPos.x + this.cameraOffset.x,
            y: targetPos.y + this.cameraOffset.y,
            z: targetPos.z + this.cameraOffset.z
        };

        // Smooth camera movement (frame-rate independent using exponential decay)
        // smoothFactor = 1 - e^(-speed * dt), approximated for small dt as speed * dt
        const smoothFactor = Math.min(1, this.cameraSmoothing * dt * 60); // Normalized to 60fps
        this.camera.position.x += (desiredPos.x - this.camera.position.x) * smoothFactor;
        this.camera.position.y += (desiredPos.y - this.camera.position.y) * smoothFactor;
        this.camera.position.z += (desiredPos.z - this.camera.position.z) * smoothFactor;

        // Look at target
        const lookAt = {
            x: targetPos.x + this.cameraLookOffset.x,
            y: targetPos.y + this.cameraLookOffset.y,
            z: targetPos.z + this.cameraLookOffset.z
        };
        this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);

        // Apply camera shake effect
        this._applyCameraShake(dt);
    }

    /**
     * Update a player-centric chase or hood camera.
     * @private
     * @param {number} dt
     * @returns {boolean} True when a focused camera was applied
     */
    _updateFocusedCamera(dt) {
        const target = this._getCameraFocusTarget();
        const config = this.focusCameraConfigs[this.cameraMode];
        if (!target || !config) return false;

        const targetPos = this._getTargetWorldPosition(target);
        if (!targetPos) return false;

        const forward = this._getTargetForward(target);
        const desiredPos = targetPos.clone()
            .addScaledVector(forward, config.forwardOffset)
            .add(new THREE.Vector3(0, config.height, 0));
        const lookAt = targetPos.clone()
            .addScaledVector(forward, config.lookAhead)
            .add(new THREE.Vector3(0, config.lookHeight, 0));

        const smoothFactor = Math.min(1, config.smoothing * dt * 60);
        this.camera.position.lerp(desiredPos, smoothFactor);
        this.camera.lookAt(lookAt);

        const fovSmoothFactor = Math.min(1, this.fovSmoothing * dt * 60);
        this.currentFOV += (config.fov - this.currentFOV) * fovSmoothFactor;
        this.camera.fov = this.currentFOV;
        this.camera.updateProjectionMatrix();

        this._applyCameraShake(dt);
        return true;
    }

    /**
     * Update camera to keep all tracked vehicles in view
     * Uses dynamic camera distance calculation with 3D geometry
     * @private
     */
    _updateMultiVehicleCamera(dt) {
        if (this.cameraTargets.length === 0) return;

        // Calculate bounding box of all vehicles
        const bounds = this._calculateVehicleBounds();
        if (!bounds) return;

        // Calculate center point of all vehicles
        const center = {
            x: (bounds.min.x + bounds.max.x) / 2,
            y: (bounds.min.y + bounds.max.y) / 2,
            z: (bounds.min.z + bounds.max.z) / 2
        };

        // Frame-rate independent smoothing factor
        const smoothFactor = Math.min(1, this.cameraMultiSmoothing * dt * 60); // Normalized to 60fps
        const fovSmoothFactor = Math.min(1, this.fovSmoothing * dt * 60);

        // Smooth the look target
        this.cameraLookTarget.x += (center.x - this.cameraLookTarget.x) * smoothFactor;
        this.cameraLookTarget.y += (center.y - this.cameraLookTarget.y) * smoothFactor;
        this.cameraLookTarget.z += (center.z - this.cameraLookTarget.z) * smoothFactor;

        // Calculate required camera distance and FOV based on bounding box and window dimensions
        const { distance, fov } = this._calculateOptimalCameraPosition(bounds, center);

        // Update target values
        this.targetCameraDepth = distance;
        this.targetFOV = fov;

        // Smooth transitions
        this.currentCameraDepth += (this.targetCameraDepth - this.currentCameraDepth) * this.cameraMultiSmoothing;
        this.currentFOV += (this.targetFOV - this.currentFOV) * this.fovSmoothing;

        // Update camera FOV
        this.camera.fov = this.currentFOV;
        this.camera.updateProjectionMatrix();

        // Calculate camera position (above and behind center, at calculated distance)
        const desiredPos = {
            x: this.cameraLookTarget.x + this.cameraOffset.x,
            y: this.cameraLookTarget.y + this.baseCameraHeight,
            z: this.cameraLookTarget.z + this.currentCameraDepth  // Dynamic distance
        };

        // Smooth camera movement (frame-rate independent)
        this.camera.position.x += (desiredPos.x - this.camera.position.x) * smoothFactor;
        this.camera.position.y += (desiredPos.y - this.camera.position.y) * smoothFactor;
        this.camera.position.z += (desiredPos.z - this.camera.position.z) * smoothFactor;

        // Look at center
        this.camera.lookAt(
            this.cameraLookTarget.x + this.cameraLookOffset.x,
            this.cameraLookTarget.y + this.cameraLookOffset.y,
            this.cameraLookTarget.z + this.cameraLookOffset.z
        );

        // Apply camera shake effect
        this._applyCameraShake(dt);
    }

    /**
     * Apply speed-based camera shake effect
     * Uses pseudo-Perlin noise for smooth, organic shake motion
     * @private
     * @param {number} dt - Delta time in seconds
     */
    _applyCameraShake(dt) {
        if (!this.cameraShake.enabled) {
            this._applyHitStopCameraPunch();
            return;
        }

        // Impact shake (collisions/explosions) decays each frame.
        if (this.cameraShake.impact > 0.001) {
            this.cameraShake.impact = this._decayImpactShakeValue(this.cameraShake.impact, dt);
            this._recordImpactShakeSample(this.cameraShake.impact);
        } else {
            this.cameraShake.impact = 0;
        }

        // Get maximum speed from all tracked vehicles
        const maxSpeed = this._getMaxVehicleSpeed();

        // Only shake above speed threshold (unless an impact is active)
        if (maxSpeed < this.cameraShake.speedThreshold && this.cameraShake.impact === 0) {
            // Decay any existing shake
            this.cameraShake.currentOffset.x *= this.cameraShake.decayRate;
            this.cameraShake.currentOffset.y *= this.cameraShake.decayRate;
            this.cameraShake.currentOffset.z *= this.cameraShake.decayRate;
            this._applyHitStopCameraPunch();
            return;
        }

        // Calculate shake intensity based on speed (0 to 1)
        const speedFactor = Math.max(0, Math.min(
            (maxSpeed - this.cameraShake.speedThreshold) / 100,
            1.0
        ));
        const intensity = this.cameraShake.intensity * speedFactor + this.cameraShake.impact;

        // Update time for noise
        this.cameraShake.time += dt * 10;
        const t = this.cameraShake.time;

        // Generate smooth noise using multiple sine waves (pseudo-Perlin)
        const noiseX = Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.2) * 0.3 + Math.sin(t * 5.1) * 0.2;
        const noiseY = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 4.1) * 0.3 + Math.sin(t * 6.7) * 0.2;
        const noiseZ = Math.sin(t * 1.9) * 0.4 + Math.sin(t * 3.8) * 0.35 + Math.sin(t * 5.5) * 0.25;

        // Set target offset
        this.cameraShake.currentOffset.x = noiseX * intensity;
        this.cameraShake.currentOffset.y = noiseY * intensity * 0.5; // Less vertical shake
        this.cameraShake.currentOffset.z = noiseZ * intensity * 0.3; // Even less depth shake

        // Apply offset to camera position
        this.camera.position.x += this.cameraShake.currentOffset.x;
        this.camera.position.y += this.cameraShake.currentOffset.y;
        this.camera.position.z += this.cameraShake.currentOffset.z;

        this._applyHitStopCameraPunch();
    }

    _resolveImpactShakeImpulse(impact) {
        const curve = this.cameraShake?.impactCurve || IMPACT_SHAKE_CURVE;
        if (typeof impact === 'number') {
            const impulse = Math.max(0, Number(impact) || 0);
            return {
                impulse: Math.min(curve.maxImpact, impulse),
                severity: clamp01(impulse / Math.max(curve.eliminationImpulse, 0.001)),
                source: 'legacy'
            };
        }

        const descriptor = impact || {};
        const severity = descriptor.elimination
            ? 1
            : clamp01(descriptor.severity ?? ((Number(descriptor.damage) || 0) / 40));
        let impulse = 0;
        if (descriptor.elimination || severity >= curve.heavyThreshold) {
            const t = descriptor.elimination
                ? 1
                : (severity - curve.heavyThreshold) / Math.max(0.001, 1 - curve.heavyThreshold);
            impulse = curve.heavyImpulse + (curve.eliminationImpulse - curve.heavyImpulse) * clamp01(t);
        } else if (severity >= curve.mediumThreshold) {
            const t = (severity - curve.mediumThreshold) /
                Math.max(0.001, curve.heavyThreshold - curve.mediumThreshold);
            impulse = curve.mediumImpulse + (curve.heavyImpulse - curve.mediumImpulse) * clamp01(t);
        } else if (severity >= curve.lightThreshold) {
            const t = (severity - curve.lightThreshold) /
                Math.max(0.001, curve.mediumThreshold - curve.lightThreshold);
            impulse = curve.baseImpulse + (curve.mediumImpulse - curve.baseImpulse) * clamp01(t);
        }

        return {
            impulse: Math.min(curve.maxImpact, Math.max(0, impulse)),
            severity,
            source: descriptor.source || 'impact'
        };
    }

    _decayImpactShakeValue(value, dt) {
        if (value <= 0.001) return 0;
        const decayRate = this.cameraShake?.decayRate ?? IMPACT_SHAKE_CURVE.decayPerFrame;
        return value * Math.pow(decayRate, Math.max(0, dt) * 60);
    }

    _recordImpactShakeSample(value) {
        const samples = this.cameraShake?.diagnostics?.samples;
        if (!samples) return;
        samples.push(Number(value.toFixed(6)));
        if (samples.length > 18) {
            samples.shift();
        }
    }

    _applyHitStopCameraPunch() {
        if (this.hitStopCameraPunch.framesRemaining <= 0) {
            this.hitStopCameraPunch.lastOffset = { x: 0, y: 0, z: 0 };
            return;
        }

        const progress = this.hitStopCameraPunch.framesRemaining /
            Math.max(1, this.hitStopCameraPunch.framesTotal);
        const amount = this.hitStopCameraPunch.intensity * (progress * progress);
        const offset = {
            x: 0,
            y: amount * IMPACT_SHAKE_CURVE.hitStopPunchY,
            z: amount * IMPACT_SHAKE_CURVE.hitStopPunchZ
        };
        this.camera.position.x += offset.x;
        this.camera.position.y += offset.y;
        this.camera.position.z += offset.z;
        this.hitStopCameraPunch.lastOffset = offset;
        this.hitStopCameraPunch.framesRemaining -= 1;
        this.hitStopCameraPunch.appliedFrames += 1;
        if (this.hitStopCameraPunch.framesRemaining <= 0) {
            this.hitStopCameraPunch.framesRemaining = 0;
            this.hitStopCameraPunch.intensity = 0;
        }
    }

    _applyTransientSmashFlash() {
        const colorGradingPass = this.postProcessing?.passes?.colorGrading || null;
        const chromaticAberrationPass = this.postProcessing?.passes?.chromaticAberration || null;
        const tierConfig = this.gradeTiers[this.activeGradeTier] || this.gradeTiers['host-native'];
        const baseValues = {
            chromaticAmount: tierConfig.chromaticAberrationAmount ?? 0,
            chromaticEnabled: !!(tierConfig.postProcessing && tierConfig.chromaticAberrationEnabled),
            gradingIntensity: tierConfig.gradingIntensity ?? 0,
            posterizeBandCount: tierConfig.posterizeBandCount ?? 0,
            ditherStrength: tierConfig.ditherStrength ?? 0
        };

        if (this.transientSmashFlash.framesRemaining <= 0) {
            const frameIndex = this.transientSmashFlash.lastFrameIndex + 1;
            this._applyTransientSmashFlashValues(baseValues, 0);
            this.transientSmashFlash.lastValues = {
                ...baseValues,
                pulseIntensity: 0
            };
            this.transientSmashFlash.lastFrameIndex = frameIndex;
            return {
                frameIndex,
                pulseIntensity: 0,
                ...baseValues
            };
        }

        const curve = TRANSIENT_SMASH_FLASH_CURVE;
        const frameIndex = this.transientSmashFlash.appliedFrames + 1;
        const progress = this.transientSmashFlash.framesRemaining /
            Math.max(1, this.transientSmashFlash.framesTotal);
        const pulseIntensity = this.transientSmashFlash.intensity * progress;
        const values = {
            chromaticEnabled: true,
            chromaticAmount: Math.min(
                curve.maxChromaticAmount,
                Math.max(baseValues.chromaticAmount, curve.chromaticAmount * pulseIntensity)
            ),
            gradingIntensity: Math.min(1, baseValues.gradingIntensity + curve.gradingBoost * pulseIntensity),
            posterizeBandCount: Math.max(
                2,
                Math.round(baseValues.posterizeBandCount - curve.posterizeBandDrop * pulseIntensity)
            ),
            ditherStrength: Math.min(1, baseValues.ditherStrength + curve.ditherBoost * pulseIntensity),
            pulseIntensity
        };

        this._applyTransientSmashFlashValues(values, pulseIntensity);
        this.transientSmashFlash.framesRemaining -= 1;
        this.transientSmashFlash.appliedFrames += 1;
        this.transientSmashFlash.lastFrameIndex = frameIndex;
        this.transientSmashFlash.lastValues = { ...values };
        this.transientSmashFlash.diagnostics.samples.push({
            frameIndex,
            source: this.transientSmashFlash.lastSource,
            ...values
        });
        if (this.transientSmashFlash.diagnostics.samples.length > 16) {
            this.transientSmashFlash.diagnostics.samples.shift();
        }
        if (this.transientSmashFlash.framesRemaining <= 0) {
            this.transientSmashFlash.framesRemaining = 0;
            this.transientSmashFlash.intensity = 0;
        }

        return {
            frameIndex,
            ...values
        };
    }

    _applyTransientSmashFlashValues(values, pulseIntensity) {
        const colorGradingPass = this.postProcessing?.passes?.colorGrading || null;
        if (colorGradingPass?.uniforms) {
            if (colorGradingPass.uniforms.gradingIntensity) {
                colorGradingPass.uniforms.gradingIntensity.value = values.gradingIntensity;
            }
            if (colorGradingPass.uniforms.posterizeBandCount) {
                colorGradingPass.uniforms.posterizeBandCount.value = values.posterizeBandCount;
            }
            if (colorGradingPass.uniforms.ditherStrength) {
                colorGradingPass.uniforms.ditherStrength.value =
                    this._ditherStrengthOverride != null
                        ? this._ditherStrengthOverride
                        : values.ditherStrength;
            }
        }

        const chromaticAberrationPass = this.postProcessing?.passes?.chromaticAberration || null;
        if (chromaticAberrationPass?.uniforms?.amount) {
            chromaticAberrationPass.enabled = values.chromaticEnabled || pulseIntensity > 0;
            chromaticAberrationPass.uniforms.amount.value = values.chromaticAmount;
        }
    }

    _createTransientSmashFlashTestPasses() {
        return {
            colorGrading: {
                enabled: true,
                uniforms: {
                    gradingIntensity: { value: this.gradeTiers[this.activeGradeTier]?.gradingIntensity ?? 0 },
                    posterizeBandCount: { value: this.gradeTiers[this.activeGradeTier]?.posterizeBandCount ?? 0 },
                    ditherStrength: { value: this.gradeTiers[this.activeGradeTier]?.ditherStrength ?? 0 },
                    scanlineAmount: { value: this.gradeTiers[this.activeGradeTier]?.scanlineAmount ?? 0 },
                    vignetteAmount: { value: this.gradeTiers[this.activeGradeTier]?.vignetteAmount ?? 0 },
                    filmGrainAmount: { value: this.gradeTiers[this.activeGradeTier]?.filmGrainAmount ?? 0 }
                }
            },
            chromaticAberration: {
                enabled: false,
                uniforms: {
                    amount: { value: 0 }
                }
            }
        };
    }

    /**
     * Get the maximum speed of all tracked vehicles in km/h
     * @private
     * @returns {number} Maximum speed in km/h
     */
    _getMaxVehicleSpeed() {
        let maxSpeed = 0;
        const targets = this.cameraTargets.length > 0 ? this.cameraTargets :
                        (this.cameraTarget ? [this.cameraTarget] : []);

        for (const target of targets) {
            if (target.physicsBody) {
                const vel = target.physicsBody.linvel();
                const speedMps = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
                const speedKmh = speedMps * 3.6;
                maxSpeed = Math.max(maxSpeed, speedKmh);
            }
        }
        return maxSpeed;
    }

    /**
     * Calculate bounding box of all tracked vehicles
     * @private
     * @returns {Object|null} { min: {x,y,z}, max: {x,y,z} }
     */
    _calculateVehicleBounds() {
        if (this.cameraTargets.length === 0) return null;

        const bounds = {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity }
        };

        for (const target of this.cameraTargets) {
            let pos;
            if (target.mesh) {
                pos = target.mesh.position;
            } else if (target.position) {
                pos = target.position;
            } else {
                continue;
            }

            bounds.min.x = Math.min(bounds.min.x, pos.x);
            bounds.min.y = Math.min(bounds.min.y, pos.y);
            bounds.min.z = Math.min(bounds.min.z, pos.z);
            bounds.max.x = Math.max(bounds.max.x, pos.x);
            bounds.max.y = Math.max(bounds.max.y, pos.y);
            bounds.max.z = Math.max(bounds.max.z, pos.z);
        }

        // Add padding
        bounds.min.x -= this.boundsPadding;
        bounds.min.z -= this.boundsPadding;
        bounds.max.x += this.boundsPadding;
        bounds.max.z += this.boundsPadding;

        return bounds;
    }

    /**
     * Calculate optimal camera position and FOV to fit all vehicles
     * Uses window dimensions and 3D frustum calculations
     * @private
     * @param {Object} bounds - Bounding box of all vehicles
     * @param {Object} center - Center point of all vehicles
     * @returns {Object} { distance: number, fov: number }
     */
    _calculateOptimalCameraPosition(bounds, center) {
        // Get window dimensions
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const aspect = windowWidth / windowHeight;

        // Calculate bounding box dimensions in world space
        const boundsWidth = bounds.max.x - bounds.min.x;
        const boundsDepth = bounds.max.z - bounds.min.z;
        const boundsHeight = bounds.max.y - bounds.min.y;

        // For top-down-ish camera, we care about horizontal (x) and forward (z) spread
        // The camera looks down at an angle, so we need to account for projection

        // Camera angle from vertical (we're at height=15, looking down)
        const cameraHeight = this.baseCameraHeight;

        // Calculate the effective size we need to fit in view
        // We need to fit both the width and depth, considering the camera angle
        const effectiveWidth = boundsWidth;
        const effectiveDepth = boundsDepth;

        // Calculate required distance for horizontal constraint (width)
        // Using frustum geometry: width = 2 * distance * tan(fov/2) * aspect
        // Solving for distance: distance = width / (2 * tan(fov/2) * aspect)
        const fovRad = this.baseFOV * (Math.PI / 180);
        const halfFovTan = Math.tan(fovRad / 2);

        // Calculate distance needed for width constraint
        const distanceForWidth = (effectiveWidth / 2) / (halfFovTan * aspect);

        // Calculate distance needed for depth constraint
        // We need to ensure the forward/backward spread is visible
        const distanceForDepth = (effectiveDepth / 2) / halfFovTan;

        // Use the larger distance to ensure everything fits
        let requiredDistance = Math.max(distanceForWidth, distanceForDepth);

        // Add extra distance for the camera height (pythagoras)
        // The actual distance from camera to center includes the height component
        const diagonalDistance = Math.sqrt(requiredDistance * requiredDistance + cameraHeight * cameraHeight);

        // Add some margin for safety
        const margin = 1.2; // 20% extra space
        requiredDistance = diagonalDistance * margin;

        // Clamp to min/max bounds
        const clampedDistance = Math.max(this.minCameraDepth, Math.min(this.maxCameraDepth, requiredDistance));

        // Calculate FOV adjustment if distance is maxed out
        // If we've hit max distance, increase FOV slightly to fit everything
        let adjustedFOV = this.baseFOV;
        if (requiredDistance > this.maxCameraDepth) {
            // Need wider FOV to compensate
            const fovIncrease = Math.min(10, (requiredDistance - this.maxCameraDepth) / 2);
            adjustedFOV = this.baseFOV + fovIncrease;
        }

        // Clamp FOV to limits
        adjustedFOV = Math.max(this.minFOV, Math.min(this.maxFOV, adjustedFOV));

        return {
            distance: clampedDistance,
            fov: adjustedFOV
        };
    }

    /**
     * Add a vehicle to be tracked by the camera
     * @param {Object} target - Entity with mesh or position
     */
    addCameraTarget(target) {
        if (!this.cameraTargets.includes(target)) {
            this.cameraTargets.push(target);
            if (!this.cameraFocusTarget) {
                this.cameraFocusTarget = target;
            }

            // Create name tag if target has a name
            if (target.playerName && this.overlayContainer) {
                this._createNameTag(target);
            }
        }
    }

    /**
     * Remove a vehicle from camera tracking
     * @param {Object} target - Entity to remove
     */
    removeCameraTarget(target) {
        const index = this.cameraTargets.indexOf(target);
        if (index !== -1) {
            this.cameraTargets.splice(index, 1);

            // Remove name tag
            const id = target.id || target.playerId;
            const tagData = this.nameTags.get(id);
            if (tagData) {
                this.overlayContainer.removeChild(tagData.element);
                this.nameTags.delete(id);
            }

            if (this.cameraFocusTarget === target) {
                this.cameraFocusTarget = this.cameraTargets[Math.min(index, this.cameraTargets.length - 1)] || null;
            }
        }
    }

    /**
     * Create a name tag DOM element for an entity
     * @private
     */
    _createNameTag(entity) {
        const tag = document.createElement('div');
        tag.className = 'player-name-tag';
        tag.textContent = entity.playerName;
        tag.style.position = 'absolute';
        tag.style.color = entity.color || '#fff';
        tag.style.padding = '2px 8px';
        tag.style.background = 'rgba(0,0,0,0.5)';
        tag.style.borderRadius = '4px';
        tag.style.fontSize = '12px';
        tag.style.fontFamily = 'monospace';
        tag.style.fontWeight = 'bold';
        tag.style.whiteSpace = 'nowrap';
        tag.style.transform = 'translate(-50%, -100%)';
        tag.style.border = `1px solid ${entity.color || '#fff'}`;
        tag.style.pointerEvents = 'none';

        this.overlayContainer.appendChild(tag);
        this.nameTags.set(entity.id || entity.playerId, { element: tag, entity });
    }

    /**
     * Clear all camera targets
     */
    clearCameraTargets() {
        this.cameraTargets = [];
        this.cameraFocusTarget = null;
    }

    /**
     * Add a mesh to the scene
     * @param {THREE.Object3D} mesh
     * @param {string} [entityId] - Associated entity ID
     */
    addMesh(mesh, entityId) {
        this.scene.add(mesh);

        if (entityId) {
            this.meshes.set(entityId, mesh);
        }
    }

    /**
     * Remove a mesh from the scene
     * @param {THREE.Object3D|string} meshOrId - Mesh or entity ID
     */
    removeMesh(meshOrId) {
        let mesh;

        if (typeof meshOrId === 'string') {
            mesh = this.meshes.get(meshOrId);
            this.meshes.delete(meshOrId);
        } else {
            mesh = meshOrId;
            // Find and remove from map
            for (const [id, m] of this.meshes) {
                if (m === mesh) {
                    this.meshes.delete(id);
                    break;
                }
            }
        }

        if (mesh && typeof mesh.traverse === 'function') {
            this.scene.remove(mesh);

            // Dispose geometry and materials
            mesh.traverse((child) => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
    }

    /**
     * Get mesh by entity ID
     * @param {string} entityId
     * @returns {THREE.Object3D|undefined}
     */
    getMesh(entityId) {
        return this.meshes.get(entityId);
    }

    /**
     * Set camera follow target
     * @param {Object} target - Entity or object with mesh/position
     */
    setCameraTarget(target) {
        this.cameraTarget = target;
        if (!this.cameraFocusTarget) {
            this.cameraFocusTarget = target;
        }
    }

    /**
     * Clear camera target
     */
    clearCameraTarget() {
        this.cameraTarget = null;
    }

    /**
     * Pick a valid camera focus, falling back to the primary target.
     * @private
     * @returns {Object|null}
     */
    _getCameraFocusTarget() {
        if (this.cameraFocusTarget && this.cameraTargets.includes(this.cameraFocusTarget)) {
            return this.cameraFocusTarget;
        }

        if (this.cameraTargets.length > 0) {
            this.cameraFocusTarget = this.cameraTargets[0];
            return this.cameraFocusTarget;
        }

        return this.cameraTarget || null;
    }

    /**
     * @private
     * @param {Object} target
     * @returns {THREE.Vector3|null}
     */
    _getTargetWorldPosition(target) {
        if (target.mesh) {
            const position = new THREE.Vector3();
            if (typeof target.mesh.getWorldPosition === 'function') {
                target.mesh.getWorldPosition(position);
                return position;
            }
            return new THREE.Vector3(target.mesh.position.x, target.mesh.position.y, target.mesh.position.z);
        }

        if (target.position) {
            return new THREE.Vector3(target.position.x, target.position.y, target.position.z);
        }

        return null;
    }

    /**
     * @private
     * @param {Object} target
     * @returns {THREE.Vector3}
     */
    _getTargetForward(target) {
        const forward = new THREE.Vector3(0, 0, 1);

        if (target.mesh && typeof target.mesh.getWorldQuaternion === 'function') {
            const quaternion = new THREE.Quaternion();
            target.mesh.getWorldQuaternion(quaternion);
            forward.applyQuaternion(quaternion);
        } else if (target.physicsBody && typeof target.physicsBody.rotation === 'function') {
            const rotation = target.physicsBody.rotation();
            const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
            forward.applyQuaternion(quaternion);
        } else if (target.rotation && target.rotation.y !== undefined) {
            forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), target.rotation.y);
        }

        forward.y = 0;
        if (forward.lengthSq() < 0.0001) {
            forward.set(0, 0, 1);
        }
        return forward.normalize();
    }

    /**
     * Set camera offset for following
     * @param {Object} offset - { x, y, z }
     */
    setCameraOffset(offset) {
        this.cameraOffset = { ...this.cameraOffset, ...offset };
    }

    /**
     * Set camera position directly
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setCameraPosition(x, y, z) {
        this.camera.position.set(x, y, z);
    }

    /**
     * Make camera look at point
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setCameraLookAt(x, y, z) {
        this.camera.lookAt(x, y, z);
    }

    /**
     * Sync mesh position from entity
     * @param {Entity} entity
     */
    syncMeshFromEntity(entity) {
        if (!entity.mesh) return;

        entity.mesh.position.set(
            entity.position.x,
            entity.position.y,
            entity.position.z
        );
        entity.mesh.rotation.set(
            entity.rotation.x,
            entity.rotation.y,
            entity.rotation.z
        );
    }

    /**
     * Sync mesh position from physics body
     * @param {Entity} entity
     */
    syncMeshFromPhysics(entity) {
        if (!entity.mesh || !entity.physicsBody) return;

        const pos = entity.physicsBody.translation();
        const rot = entity.physicsBody.rotation();

        entity.mesh.position.set(pos.x, pos.y, pos.z);
        entity.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    /**
     * Handle window resize
     * @private
     */
    _onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this._applyResolutionScale();
    }

    /**
     * Get scene
     * @returns {THREE.Scene}
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get camera
     * @returns {THREE.Camera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get renderer
     * @returns {THREE.WebGLRenderer}
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Capture a screenshot of the current scene as a data URL.
     * Forces a fresh render first so the back buffer is up to date, then
     * downscales to keep the resulting image small enough to download/email.
     *
     * @param {Object} [opts]
     * @param {number} [opts.maxWidth=1280] - Max width of the output image
     * @param {number} [opts.quality=0.8] - JPEG quality (0-1)
     * @returns {string|null} data URL (image/jpeg) or null if capture failed
     */
    captureScreenshot({ maxWidth = 1280, quality = 0.8 } = {}) {
        if (!this.renderer || !this.scene || !this.camera) return null;

        try {
            // Render one fresh frame so the buffer reflects the current state.
            this._renderScene();

            const source = this.renderer.domElement;
            const scale = Math.min(1, maxWidth / source.width);
            const w = Math.max(1, Math.round(source.width * scale));
            const h = Math.max(1, Math.round(source.height * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(source, 0, 0, w, h);

            return canvas.toDataURL('image/jpeg', quality);
        } catch (error) {
            console.warn('RenderSystem: Screenshot capture failed:', error);
            return null;
        }
    }

    /**
     * Pause rendering
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume rendering
     */
    resume() {
        this.paused = false;
    }

    /**
     * Render the current scene using the active post-processing state.
     * Falls back to a plain render if the composer is unavailable or errors.
     * @private
     */
    _renderScene() {
        this._applyTransientSmashFlash();
        if (this.postProcessing.enabled && this.postProcessing.composer) {
            try {
                // Advance the film-grain animation clock (seconds). No logging.
                const grade = this.postProcessing.passes.colorGrading;
                if (grade && grade.uniforms.time) {
                    grade.uniforms.time.value = nowMs() / 1000;
                }
                this.postProcessing.composer.render();
                return;
            } catch (error) {
                console.warn('RenderSystem: Composer render failed, using standard render:', error);
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Apply the currently selected host-grade tier to the live renderer.
     * @private
     */
    _applyGradeTierSettings() {
        const tierConfig = this.gradeTiers[this.activeGradeTier];
        if (!tierConfig) return;

        this.resolutionScale = tierConfig.resolutionScale;
        this._applyResolutionScale();

        if (this.scene) {
            if (tierConfig.fogEnabled) {
                if (!this.scene.fog) {
                    // Keep fog on the sky-dome horizon band (5k3.7) so a tier
                    // toggle never reintroduces a hard horizon seam.
                    const horizonColor = this.skyDome?.material?.uniforms?.horizonColor?.value;
                    this.scene.fog = new THREE.FogExp2(
                        horizonColor ? horizonColor.getHex() : DEFAULT_FOG_COLOR,
                        tierConfig.fogDensity
                    );
                }
                this.scene.fog.density = tierConfig.fogDensity;
            } else {
                this.scene.fog = null;
            }
        }

        if (this.renderer) {
            this.renderer.shadowMap.enabled = tierConfig.shadowsEnabled;
            this.renderer.shadowMap.type = this._resolveShadowMapType(tierConfig.shadowMapType);
            this.renderer.shadowMap.needsUpdate = true;
        }

        const bloomPass = this.postProcessing.passes.bloom;
        if (bloomPass) {
            bloomPass.enabled = !!(tierConfig.postProcessing && tierConfig.bloomEnabled);
            bloomPass.strength = tierConfig.bloomStrength;
            bloomPass.radius = tierConfig.bloomRadius;
            bloomPass.threshold = tierConfig.bloomThreshold;
        }

        const colorGradingPass = this.postProcessing.passes.colorGrading;
        if (colorGradingPass) {
            colorGradingPass.enabled = !!(tierConfig.postProcessing && tierConfig.colorGradingEnabled);
            colorGradingPass.uniforms.gradingIntensity.value = tierConfig.gradingIntensity;
            colorGradingPass.uniforms.posterizeBandCount.value = tierConfig.posterizeBandCount;
            colorGradingPass.uniforms.vignetteAmount.value = tierConfig.vignetteAmount;
            this._applyColorGradingManualOverrides();
        }

        const chromaticAberrationPass = this.postProcessing.passes.chromaticAberration;
        if (chromaticAberrationPass) {
            chromaticAberrationPass.enabled = !!(tierConfig.postProcessing && tierConfig.chromaticAberrationEnabled);
            chromaticAberrationPass.uniforms.amount.value = tierConfig.chromaticAberrationAmount;
        }

        this.postProcessing.enabled = !this.postProcessing.unsupported && tierConfig.postProcessing;
    }

    /**
     * Resolve the effective renderer pixel ratio for the current resolution
     * scale.
     *
     * The Skip Bin Arcade grade renders the world into a deliberately low-res
     * internal target and upscales it crisp (nearest-neighbor). For that chunky
     * floor to read identically on a dpr=1 TV/monitor (the real shared-screen
     * host) AND a high-DPR dev laptop, a sub-native `resolutionScale` is treated
     * as a fraction of CSS (logical) pixels, NOT of device pixels. Multiplying
     * by devicePixelRatio (the old behaviour) left scale=0.7 at 1.4x on a retina
     * panel — above CSS-native, so it never actually looked low-res there.
     *
     * At full scale (>= 1) we render up to native (capped at maxPixelRatio) so
     * the host can use its display when there is headroom: "the low-res look is
     * the floor, not a fixed value" (docs/design/02-design-language.md).
     * @private
     * @returns {number}
     */
    _resolveEffectivePixelRatio() {
        const devicePixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const nativePixelRatio = Math.min(this.maxPixelRatio, devicePixelRatio);

        if (this.resolutionScale >= 1) {
            return nativePixelRatio;
        }

        // Genuinely sub-native: a fraction of CSS pixels, clamped to the floor.
        // Never exceed native (a tiny dpr<1 panel still renders crisp at native).
        return Math.max(MIN_RENDER_SCALE, Math.min(nativePixelRatio, this.resolutionScale));
    }

    /**
     * Apply the current resolution scale to the live renderer/composer.
     * @private
     */
    _applyResolutionScale() {
        if (!this.renderer) return;

        const effectivePixelRatio = this._resolveEffectivePixelRatio();

        this.renderer.setPixelRatio(effectivePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);

        if (this.postProcessing.composer) {
            // EffectComposer caches the pixel ratio it was constructed with, so
            // its internal render targets ignore later tier changes unless we
            // push the new ratio here. Without this, the post-processed path
            // would silently keep the old internal resolution.
            if (typeof this.postProcessing.composer.setPixelRatio === 'function') {
                this.postProcessing.composer.setPixelRatio(effectivePixelRatio);
            }
            this.postProcessing.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    /**
     * Mark the canvas for nearest-neighbor (crisp) upscaling so the low-res
     * internal target reads as chunky pixel-art rather than a bilinear blur.
     * Set inline (in addition to host.css) so the grade holds even when the
     * stylesheet is absent, e.g. in headless test harnesses.
     * @private
     */
    _applyPixelatedUpscale() {
        const canvas = this.renderer?.domElement;
        if (!canvas || !canvas.style) return;
        // Assign the spec value last; browsers keep the final value they parse.
        canvas.style.imageRendering = 'optimizeSpeed';
        canvas.style.imageRendering = '-moz-crisp-edges';
        canvas.style.imageRendering = '-webkit-optimize-contrast';
        canvas.style.imageRendering = 'crisp-edges';
        canvas.style.imageRendering = 'pixelated';
    }

    /**
     * Report the low-res render target vs the display surface so the crisp
     * upscale is independently inspectable (evidence/tests/adaptive control).
     * @private
     * @returns {Object}
     */
    _getRenderTargetMetrics() {
        const renderer = this.renderer;
        const displayWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
        const displayHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
        let internalWidth = 0;
        let internalHeight = 0;

        if (renderer && typeof renderer.getDrawingBufferSize === 'function') {
            const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
            internalWidth = Math.round(buffer.x);
            internalHeight = Math.round(buffer.y);
        }

        const canvas = renderer?.domElement || null;
        const imageRendering = canvas?.style?.imageRendering || null;
        const upscaleFactor = internalWidth > 0
            ? Number((displayWidth / internalWidth).toFixed(4))
            : null;

        return {
            internalWidth,
            internalHeight,
            displayWidth,
            displayHeight,
            // The internal target is display * effectivePixelRatio; resolutionScale
            // is the requested tier scale before DPR/native resolution. Surfaced
            // here so the block is self-contained for evidence/adaptive control.
            resolutionScale: this.resolutionScale,
            effectivePixelRatio: renderer?.getPixelRatio?.() ?? null,
            devicePixelRatio: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
            // > 1 means the internal buffer is smaller than the display and is
            // being upscaled (the low-res / pixelated regime).
            upscaleFactor,
            isUpscaled: upscaleFactor !== null ? upscaleFactor > 1.0001 : null,
            imageRendering,
            crispUpscale: imageRendering === 'pixelated' || imageRendering === 'crisp-edges'
        };
    }

    /**
     * Record one render duration into the rolling metrics window.
     * @private
     * @param {number} durationMs
     */
    _recordFrameTiming(durationMs) {
        if (!Number.isFinite(durationMs)) return;

        const samples = this.frameTiming.sampleWindow;
        samples.push(durationMs);
        if (samples.length > FRAME_TIMING_WINDOW) {
            samples.shift();
        }

        this.frameTiming.frameCount += 1;
        this.frameTiming.lastRenderDurationMs = durationMs;
        this.frameTiming.maxRenderDurationMs = Math.max(this.frameTiming.maxRenderDurationMs, durationMs);
        this.frameTiming.averageRenderDurationMs =
            samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    }

    /**
     * Clear the rolling render metrics.
     * @private
     */
    _resetFrameTimingSamples() {
        this.frameTiming.frameCount = 0;
        this.frameTiming.lastRenderDurationMs = 0;
        this.frameTiming.averageRenderDurationMs = 0;
        this.frameTiming.maxRenderDurationMs = 0;
        this.frameTiming.sampleWindow = [];
    }

    /**
     * @private
     * @param {string} shadowMapType
     * @returns {number}
     */
    _resolveShadowMapType(shadowMapType) {
        // 5k3.9: PCFSoft is removed from the Skip Bin grade ladder. Unknown /
        // 'none' resolve to BasicShadowMap; full-scene shadows are disabled per
        // tier via shadowsEnabled, and blob contact shadows do the grounding.
        switch (shadowMapType) {
            case 'pcf':
                return THREE.PCFShadowMap;
            case 'basic':
            case 'none':
            default:
                return THREE.BasicShadowMap;
        }
    }

    /**
     * @private
     * @param {number} shadowMapType
     * @returns {string}
     */
    _getShadowMapTypeName(shadowMapType) {
        switch (shadowMapType) {
            case THREE.BasicShadowMap:
                return 'BasicShadowMap';
            case THREE.PCFShadowMap:
                return 'PCFShadowMap';
            case THREE.PCFSoftShadowMap:
                return 'PCFSoftShadowMap';
            default:
                return shadowMapType == null ? 'unknown' : String(shadowMapType);
        }
    }

    /**
     * @private
     * @param {number} toneMapping
     * @returns {string}
     */
    _getToneMappingName(toneMapping) {
        switch (toneMapping) {
            case THREE.NoToneMapping:
                return 'NoToneMapping';
            case THREE.LinearToneMapping:
                return 'LinearToneMapping';
            case THREE.ReinhardToneMapping:
                return 'ReinhardToneMapping';
            case THREE.CineonToneMapping:
                return 'CineonToneMapping';
            case THREE.ACESFilmicToneMapping:
                return 'ACESFilmicToneMapping';
            case THREE.NeutralToneMapping:
                return 'NeutralToneMapping';
            default:
                return toneMapping == null ? 'unknown' : String(toneMapping);
        }
    }

    /**
     * Emit event
     * @private
     */
    _emit(event, data) {
        if (this.eventBus) {
            this.eventBus.emit(event, data);
        }
    }

    /**
     * Destroy renderer
     */
    destroy() {
        window.removeEventListener('resize', this._boundOnResize);
        const canvas = this.renderer?.domElement;
        if (canvas && this._boundOnContextLost) {
            canvas.removeEventListener('webglcontextlost', this._boundOnContextLost, false);
        }

        // Remove all meshes
        for (const [id, mesh] of this.meshes) {
            this.removeMesh(mesh);
        }
        this.meshes.clear();

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.initialized = false;
    }
}

// Export for ES Modules
export { RenderSystem, HOST_GRADE_TIER_DEFINITIONS };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.RenderSystem = RenderSystem;
}
