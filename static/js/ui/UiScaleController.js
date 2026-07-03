/**
 * UiScaleController
 *
 * Single source of truth for host UI scale. Writes `--ui-scale` onto the document
 * root so every host surface can express sizes as `calc(var(--ui-scale) * ...)`.
 *
 *   --ui-scale = deviceClassScale(vmin) * userPref
 *
 * deviceClassScale gives each *known* screen class a tuned nudge (phone-as-host is
 * compact, a 4K couch screen reads a touch larger); the per-element clamp()s do the
 * continuous in-between scaling. userPref is the host's manual size control,
 * persisted in the existing `visualSettings` localStorage blob.
 *
 * No per-frame work: applies on init and on a rAF-debounced resize only.
 */

const STORAGE_KEY = 'visualSettings';
const MIN_PREF = 0.7;
const MAX_PREF = 1.4;
const STEP = 0.1;

const clampPref = (v) => Math.max(MIN_PREF, Math.min(MAX_PREF, Math.round(v / STEP) * STEP));

function vmin() {
    return Math.min(window.innerWidth, window.innerHeight);
}

/** Tuned multipliers for the known host screen classes. */
function deviceClassScale(v) {
    if (v <= 480) return 0.9;      // phone-as-host (also gets .host-compact layout)
    if (v <= 1500) return 1.0;     // laptop / tablet / 1080p–1440p TV (reference)
    return 1.12;                   // 4K couch screen — nudge up for viewing distance
}

function loadPref() {
    try {
        const blob = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const v = parseFloat(blob.uiScale);
        return Number.isFinite(v) ? clampPref(v) : 1.0;
    } catch (e) {
        return 1.0;
    }
}

function savePref(pref) {
    try {
        const blob = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        blob.uiScale = pref;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch (e) {
        // localStorage unavailable — scale still applies for this session
    }
}

class UiScaleController {
    constructor() {
        this.userPref = loadPref();
        this._raf = 0;
        this._listening = false;
        this._onResize = () => this._schedule();
    }

    /** Apply current scale and start listening for resizes. Idempotent. */
    init() {
        this.apply();
        if (!this._listening) {
            window.addEventListener('resize', this._onResize, { passive: true });
            this._listening = true;
        }
        return this;
    }

    _schedule() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = 0;
            this.apply();
        });
    }

    apply() {
        const v = vmin();
        const scale = deviceClassScale(v) * this.userPref;
        document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
        if (document.body) {
            document.body.classList.toggle('host-compact', v <= 480);
        }
    }

    getUserPref() {
        return this.userPref;
    }

    getEffectiveScale() {
        return deviceClassScale(vmin()) * this.userPref;
    }

    setUserPref(pref) {
        this.userPref = clampPref(pref);
        savePref(this.userPref);
        this.apply();
        return this.userPref;
    }

    /** Step the manual size control by one notch (+1 / -1). Returns clamped pref. */
    nudge(dir) {
        return this.setUserPref(this.userPref + dir * STEP);
    }

    canIncrease() {
        return this.userPref < MAX_PREF - 1e-9;
    }

    canDecrease() {
        return this.userPref > MIN_PREF + 1e-9;
    }
}

// Single shared instance — host UI is one scale context per device.
export const uiScale = new UiScaleController();
export { MIN_PREF, MAX_PREF, STEP };
