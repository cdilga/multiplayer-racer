/**
 * buildInfo - Build identity + client/server build-skew detection.
 *
 * Build identity (buildId / buildSha / buildTime) is injected at build time by
 * Vite via `define` (see vite.config.js). When the constants are not injected
 * (dev server, unit tests, non-bundled use), they fall back to deterministic
 * dev placeholders so nothing throws and dev never false-alarms as "stale".
 *
 * The server exposes the same identity at `GET /version` and `dist/version.json`.
 * After a deploy, a client that is still running the old bundle can detect the
 * skew and prompt a reload instead of silently sending payloads that may no
 * longer match the server contract.
 *
 * All comparison logic here is pure and unit-testable; the DOM banner lives in
 * buildSkewBanner.js and the network suppression flag is `window.__buildStale`.
 */

// `typeof X` on an undeclared identifier is safe (returns 'undefined') and does
// not throw, so this works both before and after Vite's text substitution.
/* global __BUILD_ID__, __BUILD_SHA__, __BUILD_TIME__ */
const _id = (typeof __BUILD_ID__ !== 'undefined') ? __BUILD_ID__ : 'dev';
const _sha = (typeof __BUILD_SHA__ !== 'undefined') ? __BUILD_SHA__ : 'unknown';
const _time = (typeof __BUILD_TIME__ !== 'undefined') ? __BUILD_TIME__ : 'dev';

/** Frozen build identity for this client bundle. */
export const BUILD_INFO = Object.freeze({
    buildId: String(_id),
    buildSha: String(_sha),
    buildTime: String(_time)
});

/**
 * Canonical telemetry release string derived from the existing woq.3 build
 * identity contract. Prefer the full sha when known; otherwise fall back to the
 * shorter build id so dev/source mode still exposes a stable string.
 * @param {{buildId?: string, buildSha?: string}} [buildInfo=BUILD_INFO]
 * @returns {string}
 */
export function getReleaseId(buildInfo = BUILD_INFO) {
    const buildSha = String(buildInfo?.buildSha ?? '');
    if (buildSha && buildSha !== 'unknown' && buildSha !== 'dev') {
        return buildSha;
    }
    return String(buildInfo?.buildId ?? 'unknown');
}

/**
 * Pure skew test. True only when both ids are known, real (non-dev) builds and
 * they differ. Unknown/missing/dev ids never report skew, so local dev and
 * partial deploys never nag.
 * @param {string} clientBuildId
 * @param {string} serverBuildId
 * @returns {boolean}
 */
export function isBuildSkewed(clientBuildId, serverBuildId) {
    if (!clientBuildId || !serverBuildId) return false;
    const c = String(clientBuildId);
    const s = String(serverBuildId);
    if (c === 'dev' || s === 'dev' || c === 'unknown' || s === 'unknown') return false;
    return c !== s;
}

// Module-level latest-known skew state, surfaced to bug reports + diagnostics.
let _skewState = { checked: false, stale: false, serverBuildId: null };

/** Latest known skew state (copy). */
export function getSkewState() {
    return { ..._skewState };
}

/**
 * Record an observed server build id and recompute skew against this client.
 * @param {string} serverBuildId
 * @param {string} [clientBuildId=BUILD_INFO.buildId] - override the client id
 *        (used by tests to simulate a real injected build id; production passes
 *        the baked-in id by default).
 * @returns {{checked: boolean, stale: boolean, serverBuildId: (string|null)}}
 */
export function recordServerBuild(serverBuildId, clientBuildId = BUILD_INFO.buildId) {
    const stale = isBuildSkewed(clientBuildId, serverBuildId);
    _skewState = { checked: true, stale, serverBuildId: serverBuildId || null };
    if (typeof window !== 'undefined') {
        if (stale) window.__buildStale = true;
        else delete window.__buildStale;
    }
    return getSkewState();
}

/**
 * Whether the network layer should suppress sending contract/control payloads.
 * True once a real build skew has been observed: a stale client must not keep
 * driving the (possibly changed) server contract silently.
 * @returns {boolean}
 */
export function shouldSuppressSend() {
    return _skewState.checked && _skewState.stale === true;
}

/** Reset skew state (test hook). */
export function _resetSkewState() {
    _skewState = { checked: false, stale: false, serverBuildId: null };
    if (typeof window !== 'undefined') delete window.__buildStale;
}

/**
 * Fetch the server version manifest and recompute skew. Network/parse failures
 * are swallowed (we never want version-checking to break the game); they leave
 * the previous skew state intact.
 * @param {Object} [opts]
 * @param {Function} [opts.fetchImpl] - fetch implementation (defaults to global)
 * @param {string} [opts.url='/version']
 * @returns {Promise<{checked: boolean, stale: boolean, serverBuildId: (string|null)}>}
 */
export async function checkBuildSkew(opts = {}) {
    const url = opts.url || '/version';
    const fetchImpl = opts.fetchImpl ||
        (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return getSkewState();
    try {
        const resp = await fetchImpl(url, { cache: 'no-store' });
        const data = await resp.json();
        return recordServerBuild(data && data.buildId, opts.clientBuildId);
    } catch (e) {
        return getSkewState();
    }
}

// Non-module global for legacy/script consumers and diagnostics.
if (typeof window !== 'undefined') {
    window.BUILD_INFO = BUILD_INFO;
}
