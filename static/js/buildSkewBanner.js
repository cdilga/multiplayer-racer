/**
 * buildSkewBanner - user-visible reload prompt when the client bundle is older
 * than the deployed server build.
 *
 * On init it fetches the server /version (via buildInfo.checkBuildSkew) and, if
 * a real skew is detected, renders a fixed banner with a Reload button and sets
 * window.__buildStale so the network layer (player.js / host) stops sending
 * stale-contract payloads. Fail-open: any error leaves the game playable.
 *
 * Exposes window.__buildSkew = { check, force, isStale } so E2E can drive the
 * stale path against the real /version endpoint by simulating an old client id
 * (no route interception).
 */
import { checkBuildSkew, getSkewState, recordServerBuild } from './buildInfo.js';

const BANNER_ID = 'build-skew-banner';

function renderBanner() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(BANNER_ID)) return;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:99999',
        'background:#b3261e', 'color:#fff', 'padding:10px 14px',
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
        'font-size:14px', 'display:flex', 'align-items:center',
        'justify-content:center', 'gap:12px', 'box-shadow:0 2px 8px rgba(0,0,0,.4)'
    ].join(';');

    const msg = document.createElement('span');
    msg.textContent = 'A new version of the game is available - reload to keep playing.';

    const btn = document.createElement('button');
    btn.id = 'build-skew-reload';
    btn.textContent = 'Reload';
    btn.style.cssText = [
        'background:#fff', 'color:#b3261e', 'border:0', 'border-radius:6px',
        'padding:6px 14px', 'font-weight:700', 'cursor:pointer'
    ].join(';');
    btn.addEventListener('click', () => {
        if (typeof location !== 'undefined' && location.reload) location.reload();
    });

    banner.appendChild(msg);
    banner.appendChild(btn);
    document.body.appendChild(banner);
}

function applyState(state) {
    if (state && state.stale) renderBanner();
    return state;
}

/**
 * Check skew against the real server and show the banner if stale.
 * @param {Object} [opts] forwarded to checkBuildSkew (fetchImpl/url/clientBuildId)
 * @returns {Promise<object>} skew state
 */
export async function check(opts = {}) {
    const state = await checkBuildSkew(opts);
    return applyState(state);
}

/**
 * Force the stale path by recording a server build id against a simulated
 * client id (E2E hook). Fetches real /version when serverBuildId is omitted.
 * @param {string} clientBuildId
 * @param {string} [serverBuildId] - if omitted, fetched from /version
 * @returns {Promise<object>} skew state
 */
export async function force(clientBuildId, serverBuildId) {
    if (serverBuildId !== undefined) {
        return applyState(recordServerBuild(serverBuildId, clientBuildId));
    }
    return applyState(await checkBuildSkew({ clientBuildId }));
}

/** Initialize on page load. Safe to call once per page. */
export function initBuildSkew(opts = {}) {
    if (typeof window !== 'undefined') {
        window.__buildSkew = { check, force, isStale: () => getSkewState().stale };
    }
    // Fire and forget; never block bootstrap on the version check.
    try {
        check(opts);
    } catch (e) { /* fail-open */ }
}

if (typeof window !== 'undefined') {
    window.initBuildSkew = initBuildSkew;
}
