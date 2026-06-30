/**
 * determinism.js - determinism policy + runtime helpers.
 *
 * Two jobs:
 *
 *  1. RUNTIME: give gameplay systems a uniform way to read deterministic time
 *     and randomness from a GameRunContext, with a safe fallback when no context
 *     has been attached (isolated unit use). Production always attaches the
 *     engine's context, so the fallback only matters in tests/tools.
 *
 *  2. POLICY (consumed by tests/determinism-static-scan): the lists + scanner
 *     that enforce "no direct Date.now / performance.now / Math.random in
 *     gameplay-critical paths". UI/perf/cosmetic/audio/controller adapters are
 *     explicitly allowlisted; a couple of files are flagged PENDING because the
 *     migration is blocked by another agent's active file reservation.
 *
 * Wall-clock + entropy live ONLY in allowlisted engine adapters (Clock.js /
 * GameRunContext.js), so gameplay files never name the banned globals directly.
 */

import { GameRunContext } from './GameRunContext.js';

// --- Runtime helpers --------------------------------------------------------

let _fallback = null;

/**
 * A lazily-created, process-shared fallback run context for code paths that run
 * without an engine-supplied context (isolated unit tests, dev tools). Shared so
 * systems without a context still agree on streams. Never used in production,
 * where Engine.init() attaches the real context to every system.
 * @returns {GameRunContext}
 */
export function fallbackRunContext() {
    if (!_fallback) {
        _fallback = GameRunContext.create({ buildId: 'fallback' });
    }
    return _fallback;
}

/**
 * @param {GameRunContext|null|undefined} ctx
 * @returns {GameRunContext} the given context or the shared fallback
 */
export function resolveRunContext(ctx) {
    return ctx || fallbackRunContext();
}

// --- Static-scan policy -----------------------------------------------------

/** Globals that are non-deterministic and banned from gameplay-critical paths. */
export const BANNED_PATTERNS = Object.freeze([
    { token: 'Date.now', re: /\bDate\s*\.\s*now\s*\(/ },
    { token: 'performance.now', re: /\bperformance\s*\.\s*now\s*\(/ },
    { token: 'Math.random', re: /\bMath\s*\.\s*random\s*\(/ }
]);

/** Inline marker that allows a single banned call on the same source line. */
export const ALLOW_MARKER = 'determinism-allow';

/**
 * Gameplay-critical source files that MUST be free of direct banned calls
 * (paths are repo-relative). These have been migrated to GameRunContext.
 */
export const GAMEPLAY_SOURCES = Object.freeze([
    'static/js/systems/WeaponSystem.js',
    'static/js/systems/RaceSystem.js',
    'static/js/systems/DerbySystem.js',
    'static/js/systems/DamageSystem.js',
    'static/js/resources/ProceduralTrackGenerator.js'
]);

/**
 * Files allowed to use the banned globals because they are UI / perf / cosmetic
 * / audio / controller / engine adapters - not deterministic gameplay sim.
 * Maps repo-relative path -> reason.
 */
export const ALLOWLISTED_SOURCES = Object.freeze({
    'static/js/engine/Clock.js': 'RealClock/defaultNow: the allowlisted wall-clock adapter',
    'static/js/engine/GameRunContext.js': 'defaultEntropy: seed generation for production runs',
    'static/js/engine/GameLoop.js': 'rAF/perf frame pacing (RealClock domain)',
    'static/js/systems/ParticleSystem.js': 'cosmetic particle visuals',
    'static/js/systems/TrailSystem.js': 'cosmetic trail visuals',
    'static/js/systems/RenderSystem.js': 'render-only (no sim state)',
    'static/js/entities/Vehicle.js': 'cosmetic explosion/debris/smoke particles + damage-flash animation timing',
    'static/js/entities/Entity.js': 'cosmetic/UI id + visual timing',
    'static/js/resources/VehicleFactory.js': 'cosmetic material/id variation',
    'static/js/ui/StatsOverlayUI.js': 'UI overlay timing',
    'static/js/ui/DebugOverlayUI.js': 'UI overlay timing',
    'static/js/ui/PhysicsTuningUI.js': 'UI overlay timing',
    'static/js/audioManager.js': 'audio scheduling (RealClock domain)',
    'static/js/audio/EngineSynth.js': 'audio synthesis timing',
    'static/js/player.js': 'phone controller device (not host gameplay sim)'
});

/**
 * Gameplay files that still contain banned calls but could not be migrated in
 * this pass because they are held by another agent's exclusive reservation.
 * Tracked explicitly (and surfaced by the scan as warnings) so the gap is
 * visible and not silently allowlisted forever.
 * Maps repo-relative path -> reason / follow-up.
 */
export const PENDING_SOURCES = Object.freeze({
    'static/js/GameHost.js':
        'random arena selection + host timers; file exclusively reserved by MaroonSpire (bead .6 follow-up)',
    'static/js/systems/PhysicsSystem.js':
        'physics timers (stun/reverse/wheelie/stunt boost/bad landing); file exclusively reserved by PearlDog (bead .6 follow-up)'
});

/**
 * Scan a single source file's text for banned non-deterministic calls.
 * Strips line + block comments first, and honours an inline `determinism-allow`
 * marker that permits banned calls on the same original line.
 * @param {string} content - file contents
 * @returns {Array<{line: number, token: string, text: string}>} violations
 */
export function scanSource(content) {
    const rawLines = content.split('\n');

    // Strip block comments while preserving line count (replace with spaces).
    const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = noBlock.split('\n');

    const violations = [];
    for (let i = 0; i < lines.length; i++) {
        let code = lines[i];
        const rawLine = rawLines[i] || '';

        // Drop line comments (best-effort; good enough for source scanning).
        const lineCommentIdx = code.indexOf('//');
        if (lineCommentIdx !== -1) code = code.slice(0, lineCommentIdx);

        // Inline allow marker on the original line permits this line.
        if (rawLine.includes(ALLOW_MARKER)) continue;

        for (const { token, re } of BANNED_PATTERNS) {
            if (re.test(code)) {
                violations.push({ line: i + 1, token, text: rawLine.trim() });
            }
        }
    }
    return violations;
}
