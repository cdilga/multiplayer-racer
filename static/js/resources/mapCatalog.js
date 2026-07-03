/**
 * Map catalog, seed contract, and MapInstance schema (br-map-authoring-tool-j3i.1).
 *
 * The single shared vocabulary that known maps, random presets, generated maps,
 * host selection, authoring export, bug reports, and replay tooling must agree on.
 *
 * Design rules enforced here:
 *  - A host-selectable option (MapCatalogEntry) resolves to exactly one concrete,
 *    immutable MapInstance carrying {ruleset, source, recipeId, seed,
 *    generatorVersion, params, paramsHash, resolvedMapId, targetPlayers,
 *    lateJoinCapacity} — enough to reproduce the match exactly.
 *  - "Random" means VISIBLE seeded generation (a recorded SeedSpec), never an
 *    unrecorded Math.random.
 *  - Topology (terrain/geometry) is separate from ruleset; a Race map is never
 *    silently coerced into Derby or vice-versa. Incompatible selections FAIL loud
 *    with a structured reason instead of swapping to a different map id.
 *
 * This module is the schema + seed contract + selection resolver. The deeper
 * geometry/collider/spawn validity checks live in the shared MapInstance validator
 * (br-map-authoring-tool-j3i.2), which consumes the MapInstance shape defined here.
 */

import { stableStringify } from '../geometry/GeometryKernel.js';

/** Bump when the generation contract changes in a way that alters output. */
export const GENERATOR_VERSION = 'jj-mapgen-1';

/** Rulesets are the game modes a map can be played under. Topology is separate. */
export const RULESETS = Object.freeze(['race', 'derby']);

/**
 * How a catalog entry produces its geometry:
 *  - known:      a shipped, named, deterministic map (no generation).
 *  - procedural: a recipe generates geometry from a seed (random preset).
 *  - seeded:     a recipe replays a caller-supplied seed (pasted/custom seed).
 */
export const MAP_SOURCES = Object.freeze(['known', 'procedural', 'seeded']);

/** The four fields that make a generated map exactly reproducible. */
export const SEED_SPEC_FIELDS = Object.freeze([
    'seed',
    'generatorVersion',
    'recipeId',
    'paramsHash'
]);

const MAX_SEED_STRING_LENGTH = 64;
const SEED_STRING_PATTERN = /^[A-Za-z0-9_-]+$/;

/* -------------------------------------------------------------------------- */
/* Hashing                                                                     */
/* -------------------------------------------------------------------------- */

function xmur3(str) {
    let hash = 1779033703 ^ str.length;
    for (let index = 0; index < str.length; index += 1) {
        hash = Math.imul(hash ^ str.charCodeAt(index), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
    }
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

/**
 * Deterministic 8-hex hash of a params object. Uses the shared canonical
 * stringify so key order and equivalent numeric forms hash identically.
 * @param {Object} [params]
 * @returns {string}
 */
export function computeParamsHash(params = {}) {
    return xmur3(stableStringify(params ?? {})).toString(16).padStart(8, '0');
}

/* -------------------------------------------------------------------------- */
/* Seed contract                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a raw seed into the canonical form, or return null if malformed.
 * Accepts a non-negative safe integer, or an alphanumeric token (<=64 chars,
 * [A-Za-z0-9_-]). Rejects NaN/Infinity, negatives, empty, and non-primitives.
 * @param {number|string} raw
 * @returns {number|string|null}
 */
export function normalizeSeed(raw) {
    if (typeof raw === 'number') {
        if (!Number.isInteger(raw) || raw < 0 || !Number.isSafeInteger(raw)) return null;
        return raw;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length > MAX_SEED_STRING_LENGTH) return null;
        if (!SEED_STRING_PATTERN.test(trimmed)) return null;
        // A purely-numeric string is treated as its integer seed for stability.
        if (/^\d+$/.test(trimmed)) {
            const asNumber = Number(trimmed);
            return Number.isSafeInteger(asNumber) ? asNumber : trimmed;
        }
        return trimmed;
    }
    return null;
}

/**
 * Build a SeedSpec {seed, generatorVersion, recipeId, paramsHash}. If paramsHash
 * is omitted it is derived from params. Does not validate; use validateSeedSpec.
 * @param {{seed?:number|string, generatorVersion?:string, recipeId?:string, params?:Object, paramsHash?:string}} [input]
 * @returns {{seed:*, generatorVersion:string, recipeId:*, paramsHash:*}}
 */
export function makeSeedSpec({
    seed,
    generatorVersion = GENERATOR_VERSION,
    recipeId,
    params,
    paramsHash
} = {}) {
    const resolvedHash = paramsHash ?? (params !== undefined ? computeParamsHash(params) : undefined);
    return {
        seed: normalizeSeed(seed),
        generatorVersion,
        recipeId,
        paramsHash: resolvedHash
    };
}

/**
 * Validate a SeedSpec has every reproducibility field and a well-formed seed.
 * @param {Object} seedSpec
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function validateSeedSpec(seedSpec) {
    const reasons = [];
    if (!seedSpec || typeof seedSpec !== 'object') {
        return { ok: false, reasons: ['seed_spec_missing'] };
    }
    if (seedSpec.seed === null || seedSpec.seed === undefined) {
        reasons.push('malformed_seed');
    }
    if (!seedSpec.generatorVersion) reasons.push('missing_generator_version');
    if (!seedSpec.recipeId) reasons.push('missing_recipe_id');
    if (!seedSpec.paramsHash) reasons.push('missing_params_hash');
    return { ok: reasons.length === 0, reasons };
}

/* -------------------------------------------------------------------------- */
/* Catalog + recipes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Generator/template definitions. Each recipe declares which rulesets it can
 * produce and its default tunable params.
 */
export const MAP_RECIPES = Object.freeze({
    'race-classic-v1': Object.freeze({
        id: 'race-classic-v1',
        label: 'Classic Circuit',
        compatibleRulesets: Object.freeze(['race']),
        generatorVersion: GENERATOR_VERSION,
        defaultParams: Object.freeze({
            trackLength: 'medium',
            corners: 'medium',
            jumpDensity: 'medium',
            weaponDensity: 'standard'
        })
    }),
    'derby-basin-v1': Object.freeze({
        id: 'derby-basin-v1',
        label: 'Derby Basin',
        compatibleRulesets: Object.freeze(['derby']),
        generatorVersion: GENERATOR_VERSION,
        defaultParams: Object.freeze({
            arenaSize: 'medium',
            terrainIntensity: 'medium',
            jumpDensity: 'medium',
            weaponDensity: 'standard',
            symmetry: 'loose'
        })
    })
});

function knownEntry(id, label, ruleset, validation) {
    return Object.freeze({
        id,
        label,
        source: 'known',
        compatibleRulesets: Object.freeze([ruleset]),
        recipeId: null,
        defaultParams: Object.freeze({}),
        seedPolicy: Object.freeze({ visible: false, editable: false, randomizeButton: false }),
        validation: Object.freeze(validation)
    });
}

function recipeEntry(id, label, ruleset, recipeId, validation) {
    return Object.freeze({
        id,
        label,
        source: 'procedural',
        compatibleRulesets: Object.freeze([ruleset]),
        recipeId,
        defaultParams: MAP_RECIPES[recipeId].defaultParams,
        seedPolicy: Object.freeze({ visible: true, editable: true, randomizeButton: true }),
        validation: Object.freeze(validation)
    });
}

/**
 * The shipped default catalog: shipped known maps plus random recipes. Host
 * setup filters this by ruleset. Keyed by entry id for O(1) resolution.
 */
export const MAP_CATALOG = Object.freeze({
    oval: knownEntry('oval', 'Oval Circuit', 'race', { minPlayers: 1, targetPlayers: 8, lateJoinCapacity: 12 }),
    'derby-arena': knownEntry('derby-arena', 'Derby Arena', 'derby', { minPlayers: 1, targetPlayers: 8, lateJoinCapacity: 16 }),
    'derby-bowl': knownEntry('derby-bowl', 'Derby Bowl', 'derby', { minPlayers: 1, targetPlayers: 8, lateJoinCapacity: 16 }),
    'derby-coliseum': knownEntry('derby-coliseum', 'Derby Coliseum', 'derby', { minPlayers: 1, targetPlayers: 12, lateJoinCapacity: 24 }),
    'derby-dunes': knownEntry('derby-dunes', 'Derby Dunes', 'derby', { minPlayers: 1, targetPlayers: 16, lateJoinCapacity: 32 }),
    'random-race-classic': recipeEntry('random-race-classic', 'Random Race Circuit', 'race', 'race-classic-v1', { minPlayers: 1, targetPlayers: 8, lateJoinCapacity: 12 }),
    'random-derby-basin': recipeEntry('random-derby-basin', 'Random Derby Basin', 'derby', 'derby-basin-v1', { minPlayers: 1, targetPlayers: 8, lateJoinCapacity: 16 })
});

/**
 * List catalog entries compatible with a ruleset (host map selector source).
 * @param {string} ruleset
 * @param {Object} [catalog]
 * @returns {Object[]}
 */
export function listCatalogEntries(ruleset, catalog = MAP_CATALOG) {
    return Object.values(catalog).filter((entry) => entry.compatibleRulesets.includes(ruleset));
}

/* -------------------------------------------------------------------------- */
/* Resolution + validation                                                     */
/* -------------------------------------------------------------------------- */

function isValidPlayerCount(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Resolve a host map selection into a concrete MapInstance + ValidationReport,
 * or fail loud with structured reasons. Never coerces to a different map.
 *
 * @param {Object} selection
 * @param {string} selection.ruleset       - 'race' | 'derby'
 * @param {string} selection.entryId        - MapCatalogEntry id being selected
 * @param {number|string} [selection.seed]  - required for seeded; optional (auto) for procedural
 * @param {Object} [selection.params]       - generation params (defaults from recipe/entry)
 * @param {number} selection.playerCount    - intended players at start
 * @param {number} [selection.lateJoinCapacity] - override entry capacity (must not exceed it)
 * @param {Object} [catalog]
 * @returns {{ok:boolean, instance:(Object|null), report:Object}}
 */
export function resolveMapSelection(selection = {}, catalog = MAP_CATALOG) {
    const {
        ruleset,
        entryId,
        seed,
        params,
        playerCount,
        lateJoinCapacity
    } = selection;

    const reasons = [];
    const report = {
        ok: false,
        ruleset,
        requestedEntryId: entryId,
        resolvedMapId: null,
        seed: null,
        playerCount,
        lateJoinCapacity: null,
        validatorVersion: GENERATOR_VERSION,
        seedSpec: null,
        reasons
    };

    if (!RULESETS.includes(ruleset)) {
        reasons.push('unknown_ruleset');
        return { ok: false, instance: null, report };
    }

    const entry = catalog[entryId];
    if (!entry) {
        reasons.push('unknown_map_entry');
        return { ok: false, instance: null, report };
    }

    // No hidden coercion: an incompatible selection FAILS; it is never swapped to
    // a compatible map of the requested ruleset.
    if (!entry.compatibleRulesets.includes(ruleset)) {
        reasons.push('incompatible_ruleset');
    }

    const generated = entry.source !== 'known';
    if (generated && !MAP_RECIPES[entry.recipeId]) {
        reasons.push('unknown_recipe');
    }

    // Player count / capacity.
    const capacity = lateJoinCapacity ?? entry.validation.lateJoinCapacity;
    if (!isValidPlayerCount(playerCount)) {
        reasons.push('invalid_player_count');
    } else {
        if (playerCount < entry.validation.minPlayers) reasons.push('below_min_players');
        if (!isValidPlayerCount(capacity) || capacity > entry.validation.lateJoinCapacity) {
            reasons.push('invalid_late_join_capacity');
        } else if (playerCount > capacity) {
            reasons.push('capacity_exceeded');
        }
    }

    // Seed contract for generated maps.
    let seedSpec = null;
    if (generated && MAP_RECIPES[entry.recipeId]) {
        const recipe = MAP_RECIPES[entry.recipeId];
        const resolvedParams = params ?? recipe.defaultParams;
        if (entry.source === 'seeded' && (seed === undefined || seed === null)) {
            reasons.push('missing_seed');
        }
        const normalizedSeed = normalizeSeed(seed);
        if ((seed !== undefined && seed !== null) && normalizedSeed === null) {
            reasons.push('malformed_seed');
        }
        seedSpec = makeSeedSpec({
            seed: normalizedSeed,
            generatorVersion: recipe.generatorVersion,
            recipeId: recipe.id,
            params: resolvedParams
        });
        // procedural without a supplied seed is allowed at resolve-time only if a
        // seed is generated upstream (visible). Here we simply flag the gap so the
        // caller must attach one before start rather than falling to Math.random.
        if (seedSpec.seed === null && entry.source === 'procedural') {
            reasons.push('unseeded_generation');
        }
    }

    report.resolvedMapId = entry.id;
    report.seed = seedSpec ? seedSpec.seed : entry.id;
    report.lateJoinCapacity = capacity;
    report.seedSpec = seedSpec;

    if (reasons.length > 0) {
        return { ok: false, instance: null, report };
    }

    const instance = Object.freeze({
        ruleset,
        source: entry.source,
        catalogEntryId: entry.id,
        recipeId: entry.recipeId,
        seed: seedSpec ? seedSpec.seed : null,
        generatorVersion: GENERATOR_VERSION,
        params: generated ? (params ?? MAP_RECIPES[entry.recipeId].defaultParams) : {},
        paramsHash: seedSpec ? seedSpec.paramsHash : computeParamsHash({}),
        resolvedMapId: entry.id,
        targetPlayers: entry.validation.targetPlayers,
        lateJoinCapacity: capacity
    });

    report.ok = true;
    return { ok: true, instance, report };
}

/**
 * Schema-level validation of a resolved MapInstance: shape, seed contract for
 * generated maps, and no ruleset/id coercion. (Geometry/collider/spawn checks
 * are the separate MapInstance validator, j3i.2.)
 * @param {Object} instance
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function validateMapInstance(instance) {
    const reasons = [];
    if (!instance || typeof instance !== 'object') {
        return { ok: false, reasons: ['instance_missing'] };
    }
    if (!RULESETS.includes(instance.ruleset)) reasons.push('unknown_ruleset');
    if (!MAP_SOURCES.includes(instance.source)) reasons.push('unknown_source');
    if (!instance.resolvedMapId) reasons.push('missing_resolved_map_id');
    if (instance.catalogEntryId && instance.resolvedMapId
        && instance.catalogEntryId !== instance.resolvedMapId) {
        reasons.push('coerced_map_id');
    }
    if (!instance.generatorVersion) reasons.push('missing_generator_version');
    if (!isValidPlayerCount(instance.targetPlayers)) reasons.push('invalid_target_players');
    if (!isValidPlayerCount(instance.lateJoinCapacity)) reasons.push('invalid_late_join_capacity');

    if (instance.source !== 'known') {
        const seedCheck = validateSeedSpec({
            seed: instance.seed,
            generatorVersion: instance.generatorVersion,
            recipeId: instance.recipeId,
            paramsHash: instance.paramsHash
        });
        reasons.push(...seedCheck.reasons);
    }

    return { ok: reasons.length === 0, reasons };
}

export default {
    GENERATOR_VERSION,
    RULESETS,
    MAP_SOURCES,
    SEED_SPEC_FIELDS,
    MAP_RECIPES,
    MAP_CATALOG,
    computeParamsHash,
    normalizeSeed,
    makeSeedSpec,
    validateSeedSpec,
    listCatalogEntries,
    resolveMapSelection,
    validateMapInstance
};
