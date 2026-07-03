/**
 * Shared deterministic MapInstance validator (br-map-authoring-tool-j3i.1 / .2).
 *
 * ONE fail-loud validator used by shipped maps, seeded procedural maps, authoring
 * previews, host start, and late-join spawn checks — instead of scattered ad-hoc
 * checks in TrackFactory, ProceduralTrackGenerator, host start, and editor code.
 *
 * It validates the loaded map/track data (the shipped track-JSON shape) against a
 * ruleset + player-count context and returns a machine-readable ValidationReport
 * with structured failure reasons for host blocked-start UI, authoring overlays,
 * Playwright evidence, replay, and bug reports.
 *
 * Deep frame/winding/clearance math is delegated to the shared geometry kernel
 * rather than duplicated here.
 */

import {
    signedArea2D,
    validateSpawnSet,
    measurePairwiseSpawnDistances
} from '../geometry/GeometryKernel.js';
import { RULESETS } from './mapCatalog.js';

export const MAP_VALIDATOR_VERSION = 'jj-mapvalidator-1';

/**
 * Minimum centre-to-centre distance two initial spawns must keep. Shipped grids
 * pack cars ~2 units apart on the start rank, so this catches genuine overlaps
 * (near-duplicate spawn points) without flagging tight-but-valid grids.
 */
const DEFAULT_MIN_SPAWN_DISTANCE = 1.5;

function reason(code, detail) {
    return detail === undefined ? { code } : { code, detail };
}

/** True for a derby-shaped map (arena containment, no lap checkpoints). */
function isDerbyMap(mapData) {
    return mapData.type === 'derby' || (mapData.derby !== undefined && mapData.derby !== null);
}

function rulesetOf(mapData) {
    return isDerbyMap(mapData) ? 'derby' : 'race';
}

function spawnPositions(mapData) {
    const positions = mapData?.spawn?.positions;
    return Array.isArray(positions) ? positions : [];
}

function toKernelSpawns(positions) {
    return positions.map((p, index) => ({
        id: p.id ?? `spawn-${index}`,
        position: { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 },
        rotation: p.rotation
    }));
}

function checkpointLoopPoints(checkpoints) {
    return checkpoints
        .filter((cp) => cp && cp.position)
        .map((cp) => ({ x: cp.position.x ?? 0, z: cp.position.z ?? 0 }));
}

function validateGeometry(mapData, reasons) {
    const geometry = mapData.geometry;
    if (!geometry || typeof geometry !== 'object' || !geometry.type) {
        reasons.push(reason('missing_geometry'));
        return;
    }
    if (isDerbyMap(mapData)) {
        // Derby containment: a closed arena needs a positive extent and walls.
        const extent = geometry.diameter ?? geometry.radius ?? geometry.size;
        if (!(extent > 0)) reasons.push(reason('missing_geometry', 'derby extent'));
        if (!(geometry.wallHeight > 0)) reasons.push(reason('open_derby_boundary'));
    } else {
        // Race track: needs a drivable band.
        const hasBand = geometry.trackWidth > 0
            || (geometry.outerRadius > 0 && geometry.innerRadius >= 0
                && geometry.outerRadius > geometry.innerRadius);
        if (!hasBand) reasons.push(reason('missing_geometry', 'race band'));
    }
}

function validateRaceCheckpoints(mapData, reasons) {
    const checkpoints = Array.isArray(mapData.checkpoints) ? mapData.checkpoints : [];
    if (checkpoints.length < 3) {
        reasons.push(reason('missing_checkpoints'));
        return;
    }
    if (!checkpoints.some((cp) => cp && cp.isFinishLine)) {
        reasons.push(reason('missing_finish_line'));
    }
    // Winding: the checkpoint loop must enclose a non-degenerate area (a real
    // circuit), otherwise gate-crossing/lap detection is ambiguous.
    const area = signedArea2D(checkpointLoopPoints(checkpoints));
    if (Math.abs(area) < 1e-6) {
        reasons.push(reason('bad_checkpoint_winding', area));
    }
}

function validateSpawns(mapData, context, reasons) {
    const positions = spawnPositions(mapData);
    if (positions.length === 0) {
        reasons.push(reason('missing_spawns'));
        return;
    }

    const playerCount = context.playerCount;
    if (Number.isInteger(playerCount) && playerCount > 0 && positions.length < playerCount) {
        reasons.push(reason('insufficient_spawn_capacity', {
            available: positions.length,
            required: playerCount
        }));
    }

    // Late-join needs at least one reusable spawn candidate beyond the grid; a map
    // with zero candidates cannot place reconnecting/late players safely.
    const lateJoinCapacity = context.lateJoinCapacity;
    if (Number.isInteger(lateJoinCapacity) && lateJoinCapacity > 0 && positions.length === 0) {
        reasons.push(reason('no_late_join_candidates'));
    }

    // Overlap / clearance via the shared kernel.
    const kernelSpawns = toKernelSpawns(positions);
    const spawnReport = validateSpawnSet(kernelSpawns, {
        minPairDistance: context.minSpawnDistance ?? DEFAULT_MIN_SPAWN_DISTANCE,
        requireSupport: false
    });
    if (!spawnReport.valid) {
        const pairwise = measurePairwiseSpawnDistances(kernelSpawns);
        reasons.push(reason('unsafe_spawn_overlap', {
            minPairDistance: pairwise.minDistance
        }));
    }
}

function validatePickupZones(mapData, reasons) {
    // Only validate when explicit weapon/pickup zones are declared; shipped tracks
    // spawn pickups dynamically (no fixed zones), so absence is not a failure.
    const zones = mapData.weapons?.zones;
    if (!Array.isArray(zones) || zones.length === 0) return;

    const spawns = toKernelSpawns(spawnPositions(mapData));
    for (const zone of zones) {
        const zx = zone.x ?? zone.position?.x ?? 0;
        const zz = zone.z ?? zone.position?.z ?? 0;
        const radius = zone.radius ?? 1;
        for (const spawn of spawns) {
            const dx = spawn.position.x - zx;
            const dz = spawn.position.z - zz;
            if (Math.hypot(dx, dz) < radius) {
                reasons.push(reason('pickup_zone_overlaps_spawn', { zone: zone.id ?? null }));
                return;
            }
        }
    }
}

function validatePhysicsAlignment(mapData, reasons) {
    // Terrain/render/physics alignment: a playable map must declare physics so the
    // host colliders match the rendered geometry.
    if (!mapData.physics || typeof mapData.physics !== 'object') {
        reasons.push(reason('missing_physics'));
    }
}

/**
 * Validate loaded map/track data for a ruleset + player-count context.
 *
 * @param {Object} mapData - loaded track/map object (shipped track-JSON shape).
 * @param {Object} [context]
 * @param {string} [context.ruleset]           - intended ruleset; defaults to the map's own.
 * @param {number} [context.playerCount]        - intended players at start.
 * @param {number} [context.lateJoinCapacity]   - late-join capacity to support.
 * @param {string} [context.requestedTrackId]   - id the host asked for.
 * @param {number|string} [context.seed]
 * @param {number} [context.minSpawnDistance]
 * @returns {Object} ValidationReport
 */
export function validateMapData(mapData, context = {}) {
    const reasons = [];
    const requestedTrackId = context.requestedTrackId ?? mapData?.id ?? null;

    const report = {
        ok: false,
        requestedTrackId,
        resolvedMapId: mapData?.id ?? null,
        ruleset: context.ruleset ?? (mapData ? rulesetOf(mapData) : null),
        seed: context.seed ?? null,
        playerCount: context.playerCount ?? null,
        lateJoinCapacity: context.lateJoinCapacity ?? null,
        validatorVersion: MAP_VALIDATOR_VERSION,
        debugArtifactPaths: [],
        reasons
    };

    if (!mapData || typeof mapData !== 'object') {
        reasons.push(reason('map_data_missing'));
        return report;
    }

    // Ruleset compatibility: never silently swap a Race map into Derby or back.
    const intended = context.ruleset;
    if (intended !== undefined) {
        if (!RULESETS.includes(intended)) {
            reasons.push(reason('unknown_ruleset'));
        } else if (intended !== rulesetOf(mapData)) {
            reasons.push(reason('incompatible_ruleset', {
                requested: intended,
                mapRuleset: rulesetOf(mapData)
            }));
        }
    }

    validateGeometry(mapData, reasons);
    validatePhysicsAlignment(mapData, reasons);
    validateSpawns(mapData, context, reasons);
    validatePickupZones(mapData, reasons);

    if (rulesetOf(mapData) === 'race') {
        validateRaceCheckpoints(mapData, reasons);
    }

    report.ok = reasons.length === 0;
    return report;
}

export default {
    MAP_VALIDATOR_VERSION,
    validateMapData
};
