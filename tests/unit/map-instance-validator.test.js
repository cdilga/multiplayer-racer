import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMapSelection, validateMapInstance } from '../../static/js/resources/mapCatalog.js';
import { validateMapData } from '../../static/js/resources/mapValidator.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const loadTrack = (id) => JSON.parse(readFileSync(resolve(repoRoot, `static/assets/tracks/${id}.json`), 'utf8'));

/**
 * Instance-level integration (br-map-authoring-tool-j3i.1 / .2): a host selection
 * must resolve to a valid MapInstance AND the concrete map data it points at must
 * pass the shared validator for the same ruleset + player count. The two layers
 * agree on ruleset and never coerce.
 */
describe('MapInstance <-> validator agreement', () => {
    it('a resolved known-race instance and its map data both validate', () => {
        const { ok, instance } = resolveMapSelection({ ruleset: 'race', entryId: 'oval', playerCount: 4 });
        expect(ok).toBe(true);
        expect(validateMapInstance(instance).ok).toBe(true);

        const dataReport = validateMapData(loadTrack(instance.resolvedMapId), {
            ruleset: instance.ruleset,
            playerCount: 4,
            lateJoinCapacity: instance.lateJoinCapacity,
            requestedTrackId: instance.resolvedMapId,
            seed: instance.seed
        });
        expect(dataReport.reasons).toEqual([]);
        expect(dataReport.ok).toBe(true);
        expect(dataReport.ruleset).toBe(instance.ruleset);
    });

    it('a resolved known-derby instance and its map data both validate', () => {
        const { ok, instance } = resolveMapSelection({ ruleset: 'derby', entryId: 'derby-arena', playerCount: 8 });
        expect(ok).toBe(true);
        expect(validateMapInstance(instance).ok).toBe(true);
        const dataReport = validateMapData(loadTrack(instance.resolvedMapId), {
            ruleset: instance.ruleset, playerCount: 8, requestedTrackId: instance.resolvedMapId
        });
        expect(dataReport.ok).toBe(true);
    });

    it('both layers refuse the same cross-ruleset coercion (oval under derby)', () => {
        // Catalog layer refuses the selection...
        const selection = resolveMapSelection({ ruleset: 'derby', entryId: 'oval', playerCount: 4 });
        expect(selection.ok).toBe(false);
        expect(selection.report.reasons).toContain('incompatible_ruleset');
        // ...and the data validator independently refuses the same map under derby.
        const dataReport = validateMapData(loadTrack('oval'), { ruleset: 'derby', playerCount: 4 });
        expect(dataReport.ok).toBe(false);
        expect(dataReport.reasons.map((r) => r.code)).toContain('incompatible_ruleset');
        // Neither ever swaps to a different map id.
        expect(dataReport.resolvedMapId).toBe('oval');
    });

    it('carries reproducibility metadata (generatorVersion/seed/paramsHash) on generated instances', () => {
        const { instance } = resolveMapSelection({
            ruleset: 'derby', entryId: 'random-derby-basin', seed: 'basin-777', playerCount: 8
        });
        expect(instance.generatorVersion).toBeTruthy();
        expect(instance.seed).toBe('basin-777');
        expect(instance.paramsHash).toMatch(/^[0-9a-f]{8}$/);
        expect(validateMapInstance(instance).ok).toBe(true);
    });
});
