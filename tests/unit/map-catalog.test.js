import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GENERATOR_VERSION,
    RULESETS,
    MAP_SOURCES,
    SEED_SPEC_FIELDS,
    MAP_CATALOG,
    MAP_RECIPES,
    computeParamsHash,
    normalizeSeed,
    makeSeedSpec,
    validateSeedSpec,
    listCatalogEntries,
    resolveMapSelection,
    validateMapInstance
} from '../../static/js/resources/mapCatalog.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactDir = resolve(repoRoot, 'artifacts/br-map-authoring-tool-j3i.1');
const artifactPath = resolve(artifactDir, 'map-instance-examples.json');

describe('map catalog - vocabulary', () => {
    it('exposes the ruleset/source/seed vocabulary', () => {
        expect(RULESETS).toEqual(['race', 'derby']);
        expect(MAP_SOURCES).toEqual(['known', 'procedural', 'seeded']);
        expect(SEED_SPEC_FIELDS).toEqual(['seed', 'generatorVersion', 'recipeId', 'paramsHash']);
    });

    it('ships known race + derby entries and random race + derby recipes', () => {
        expect(MAP_CATALOG.oval.compatibleRulesets).toEqual(['race']);
        expect(MAP_CATALOG['derby-arena'].compatibleRulesets).toEqual(['derby']);
        expect(listCatalogEntries('race', MAP_CATALOG).map((e) => e.id)).toContain('random-race-classic');
        expect(listCatalogEntries('derby', MAP_CATALOG).map((e) => e.id)).toContain('random-derby-basin');
        // Ruleset filtering never leaks a race map into the derby list.
        expect(listCatalogEntries('derby', MAP_CATALOG).map((e) => e.id)).not.toContain('oval');
    });
});

describe('map catalog - seed contract', () => {
    it('hashes params deterministically and independent of key order', () => {
        const a = computeParamsHash({ arenaSize: 'medium', symmetry: 'loose' });
        const b = computeParamsHash({ symmetry: 'loose', arenaSize: 'medium' });
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{8}$/);
        expect(computeParamsHash({ arenaSize: 'large' })).not.toBe(a);
    });

    it('normalizes valid seeds and rejects malformed input', () => {
        expect(normalizeSeed(42)).toBe(42);
        expect(normalizeSeed('42')).toBe(42);
        expect(normalizeSeed('AB12_cd-9')).toBe('AB12_cd-9');
        expect(normalizeSeed('  trimmed  ')).toBe('trimmed');

        expect(normalizeSeed(-1)).toBeNull();
        expect(normalizeSeed(1.5)).toBeNull();
        expect(normalizeSeed(NaN)).toBeNull();
        expect(normalizeSeed(Infinity)).toBeNull();
        expect(normalizeSeed('')).toBeNull();
        expect(normalizeSeed('has space')).toBeNull();
        expect(normalizeSeed('bad!chars')).toBeNull();
        expect(normalizeSeed('x'.repeat(65))).toBeNull();
        expect(normalizeSeed({})).toBeNull();
        expect(normalizeSeed(null)).toBeNull();
    });

    it('builds a SeedSpec that derives paramsHash and validates fully', () => {
        const spec = makeSeedSpec({ seed: 7, recipeId: 'derby-basin-v1', params: { arenaSize: 'medium' } });
        expect(spec.seed).toBe(7);
        expect(spec.generatorVersion).toBe(GENERATOR_VERSION);
        expect(spec.recipeId).toBe('derby-basin-v1');
        expect(spec.paramsHash).toBe(computeParamsHash({ arenaSize: 'medium' }));
        expect(validateSeedSpec(spec)).toEqual({ ok: true, reasons: [] });
    });

    it('rejects a SeedSpec missing any reproducibility field', () => {
        expect(validateSeedSpec({ seed: null, generatorVersion: 'v', recipeId: 'r', paramsHash: 'h' }).reasons)
            .toContain('malformed_seed');
        expect(validateSeedSpec({ seed: 1, recipeId: 'r', paramsHash: 'h' }).reasons)
            .toContain('missing_generator_version');
        expect(validateSeedSpec({ seed: 1, generatorVersion: 'v', paramsHash: 'h' }).reasons)
            .toContain('missing_recipe_id');
        expect(validateSeedSpec({ seed: 1, generatorVersion: 'v', recipeId: 'r' }).reasons)
            .toContain('missing_params_hash');
    });
});

describe('map catalog - resolution: happy paths', () => {
    it('resolves a known race map with no coercion or seed', () => {
        const { ok, instance, report } = resolveMapSelection({
            ruleset: 'race', entryId: 'oval', playerCount: 4
        });
        expect(ok).toBe(true);
        expect(instance.source).toBe('known');
        expect(instance.resolvedMapId).toBe('oval');
        expect(instance.seed).toBeNull();
        expect(report.reasons).toEqual([]);
        expect(validateMapInstance(instance)).toEqual({ ok: true, reasons: [] });
    });

    it('resolves a known derby map', () => {
        const { ok, instance } = resolveMapSelection({
            ruleset: 'derby', entryId: 'derby-arena', playerCount: 8
        });
        expect(ok).toBe(true);
        expect(instance.ruleset).toBe('derby');
        expect(validateMapInstance(instance).ok).toBe(true);
    });

    it('resolves a random (procedural) race map with a generated visible seed', () => {
        const { ok, instance } = resolveMapSelection({
            ruleset: 'race', entryId: 'random-race-classic', seed: 12345, playerCount: 6
        });
        expect(ok).toBe(true);
        expect(instance.source).toBe('procedural');
        expect(instance.recipeId).toBe('race-classic-v1');
        expect(instance.seed).toBe(12345);
        expect(instance.paramsHash).toBe(computeParamsHash(MAP_RECIPES['race-classic-v1'].defaultParams));
        expect(validateMapInstance(instance).ok).toBe(true);
    });

    it('resolves a pasted seeded derby map deterministically', () => {
        const selection = {
            ruleset: 'derby', entryId: 'random-derby-basin', seed: 'basin-777', playerCount: 8
        };
        const first = resolveMapSelection(selection);
        const second = resolveMapSelection(selection);
        expect(first.ok).toBe(true);
        expect(first.instance.seed).toBe('basin-777');
        // Same selection => byte-identical instance (reproducible).
        expect(JSON.stringify(first.instance)).toBe(JSON.stringify(second.instance));
    });
});

describe('map catalog - resolution: fail-loud rejections', () => {
    it('rejects an unknown map entry', () => {
        const { ok, report } = resolveMapSelection({ ruleset: 'race', entryId: 'nope', playerCount: 4 });
        expect(ok).toBe(false);
        expect(report.reasons).toContain('unknown_map_entry');
    });

    it('rejects incompatible ruleset WITHOUT silently swapping the map id', () => {
        // A race-only map selected under the derby ruleset must fail, not coerce.
        const { ok, instance, report } = resolveMapSelection({
            ruleset: 'derby', entryId: 'oval', playerCount: 4
        });
        expect(ok).toBe(false);
        expect(instance).toBeNull();
        expect(report.reasons).toContain('incompatible_ruleset');
        // The requested id is echoed; it is never replaced by a derby map.
        expect(report.requestedEntryId).toBe('oval');
        expect(report.resolvedMapId).toBe('oval');
    });

    it('rejects an unknown recipe id for a generated entry', () => {
        const brokenCatalog = {
            'ghost-recipe': {
                id: 'ghost-recipe',
                label: 'Ghost',
                source: 'procedural',
                compatibleRulesets: ['race'],
                recipeId: 'does-not-exist',
                defaultParams: {},
                seedPolicy: { visible: true, editable: true, randomizeButton: true },
                validation: { minPlayers: 1, targetPlayers: 8, lateJoinCapacity: 12 }
            }
        };
        const { ok, report } = resolveMapSelection(
            { ruleset: 'race', entryId: 'ghost-recipe', seed: 1, playerCount: 4 },
            brokenCatalog
        );
        expect(ok).toBe(false);
        expect(report.reasons).toContain('unknown_recipe');
    });

    it('rejects a malformed seed on a seeded selection', () => {
        const { ok, report } = resolveMapSelection({
            ruleset: 'derby', entryId: 'random-derby-basin', seed: 'bad seed!', playerCount: 8
        });
        expect(ok).toBe(false);
        expect(report.reasons).toContain('malformed_seed');
    });

    it('rejects invalid or over-capacity player counts', () => {
        expect(resolveMapSelection({ ruleset: 'race', entryId: 'oval', playerCount: 0 }).report.reasons)
            .toContain('invalid_player_count');
        expect(resolveMapSelection({ ruleset: 'race', entryId: 'oval', playerCount: 2.5 }).report.reasons)
            .toContain('invalid_player_count');
        // oval lateJoinCapacity is 12; 20 players exceeds it.
        expect(resolveMapSelection({ ruleset: 'race', entryId: 'oval', playerCount: 20 }).report.reasons)
            .toContain('capacity_exceeded');
        // A requested capacity above the entry ceiling is rejected.
        expect(resolveMapSelection({ ruleset: 'race', entryId: 'oval', playerCount: 4, lateJoinCapacity: 99 }).report.reasons)
            .toContain('invalid_late_join_capacity');
    });
});

describe('map catalog - MapInstance schema guard', () => {
    it('flags a coerced (mismatched) map id', () => {
        const coerced = {
            ruleset: 'derby', source: 'known', catalogEntryId: 'oval', recipeId: null,
            seed: null, generatorVersion: GENERATOR_VERSION, params: {}, paramsHash: computeParamsHash({}),
            resolvedMapId: 'derby-arena', targetPlayers: 8, lateJoinCapacity: 16
        };
        expect(validateMapInstance(coerced).reasons).toContain('coerced_map_id');
    });

    it('flags a generated instance with an incomplete seed contract', () => {
        const instance = {
            ruleset: 'race', source: 'procedural', catalogEntryId: 'random-race-classic',
            recipeId: 'race-classic-v1', seed: null, generatorVersion: GENERATOR_VERSION,
            params: {}, paramsHash: '', resolvedMapId: 'random-race-classic',
            targetPlayers: 8, lateJoinCapacity: 12
        };
        const result = validateMapInstance(instance);
        expect(result.ok).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining(['malformed_seed', 'missing_params_hash']));
    });
});

describe('map catalog - evidence artifact', () => {
    it('persists example MapInstances for known/random race+derby and a pasted seed', () => {
        const examples = {
            knownRace: resolveMapSelection({ ruleset: 'race', entryId: 'oval', playerCount: 4 }).instance,
            knownDerby: resolveMapSelection({ ruleset: 'derby', entryId: 'derby-arena', playerCount: 8 }).instance,
            randomRace: resolveMapSelection({ ruleset: 'race', entryId: 'random-race-classic', seed: 12345, playerCount: 6 }).instance,
            randomDerby: resolveMapSelection({ ruleset: 'derby', entryId: 'random-derby-basin', seed: 999, playerCount: 8 }).instance,
            pastedSeed: resolveMapSelection({ ruleset: 'derby', entryId: 'random-derby-basin', seed: 'basin-777', playerCount: 8 }).instance
        };
        for (const instance of Object.values(examples)) {
            expect(validateMapInstance(instance).ok).toBe(true);
        }
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(artifactPath, JSON.stringify({
            bead: 'br-map-authoring-tool-j3i.1',
            generatorVersion: GENERATOR_VERSION,
            examples
        }, null, 2) + '\n');
        expect(existsSync(artifactPath)).toBe(true);
    });
});
