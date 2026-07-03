/**
 * Weapon Lab harness — a deterministic, DOM-free rig that drives the REAL
 * `WeaponSystem` against production weapon rules.
 *
 * Design goals (bead br-weapon-test-lab-zas):
 * - Production path only: all weapon behaviour (selection, placement, firing,
 *   projectile/mine/zone/continuous updates, damage, shield/stun) runs inside
 *   the real `WeaponSystem`. The harness supplies ONLY render/damage adapters
 *   and fake vehicles; it never re-implements a weapon rule.
 * - Determinism: time comes from a `SimClock` and randomness from the seeded
 *   `weapons` RNG stream of a `GameRunContext`. Same seed + same scripted
 *   inputs => byte-identical diagnostics.
 *
 * Used by both the browser `/weapon-lab` surface and the vitest suites, so it
 * must stay free of `window`, `document`, and `THREE`.
 */
import { EventBus } from '../engine/EventBus.js';
import { SimClock } from '../engine/Clock.js';
import { GameRunContext } from '../engine/GameRunContext.js';
import { ResourceLoader } from '../resources/ResourceLoader.js';
import { TrackFactory } from '../resources/TrackFactory.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';

export const WEAPON_LAB_DIAGNOSTICS_SCHEMA = 'jj.debugLab.diagnostics.v1';
export const WEAPON_LAB_DIAGNOSTICS_VERSION = 'jj.weaponLab.diagnostics.v1';
const TRACK_ASSET_PREFIX = 'static/assets/tracks';
const TRACK_CONTEXT_CACHE = new Map();
const TRACK_CONFIG_MODULES = import.meta.glob('../../assets/tracks/*.json', {
    eager: true,
    import: 'default'
});

/** Weapon events the harness records for machine-readable diagnostics. */
export const WEAPON_EVENTS = Object.freeze([
    'weapon:ready',
    'weapon:spawned',
    'weapon:pickup',
    'weapon:fired',
    'weapon:hit',
    'weapon:explosion',
    'weapon:stun',
    'weapon:buffApplied',
    'weapon:buffExpired',
    'weapon:continuousStart',
    'weapon:continuousEnd'
]);

/** Round to 3 decimals so diagnostics compare cleanly without float noise. */
function round3(value) {
    return Math.round(value * 1000) / 1000;
}

function normalizeForJson(value) {
    if (value == null) return value;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? round3(value) : null;
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForJson(entry));
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, entry]) => entry !== undefined && typeof entry !== 'function')
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, normalizeForJson(entry)]);
        return Object.fromEntries(entries);
    }
    return String(value);
}

function stableStringify(value) {
    return JSON.stringify(normalizeForJson(value));
}

function stableHash(value) {
    const input = typeof value === 'string' ? value : stableStringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
        hash >>>= 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function applyPatch(base, patch) {
    if (base == null || typeof base !== 'object' || Array.isArray(base)) {
        return deepClone(patch);
    }
    const output = {};
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(patch || {})]);
    for (const key of keys) {
        const left = base?.[key];
        const right = patch?.[key];
        if (right === undefined) {
            output[key] = deepClone(left);
            continue;
        }
        if (left && typeof left === 'object' && !Array.isArray(left) && right && typeof right === 'object' && !Array.isArray(right)) {
            output[key] = applyPatch(left, right);
            continue;
        }
        output[key] = deepClone(right);
    }
    return output;
}

async function createTrackFactoryBackedLoader() {
    const bundledTrackLoader = {
        async loadTrack(trackId) {
            const entry = Object.entries(TRACK_CONFIG_MODULES)
                .find(([path]) => path.endsWith(`/tracks/${trackId}.json`));
            if (entry) {
                return typeof structuredClone === 'function'
                    ? structuredClone(entry[1])
                    : JSON.parse(JSON.stringify(entry[1]));
            }
            if (typeof window !== 'undefined') {
                const resourceLoader = new ResourceLoader({ basePath: '/static/assets' });
                return resourceLoader.loadTrack(trackId);
            }
            throw new Error(`Track config '${trackId}' was not bundled for the weapon lab`);
        }
    };

    if (typeof window !== 'undefined') {
        return bundledTrackLoader;
    }
    return bundledTrackLoader;
}

export async function loadTrackContext(trackId) {
    if (!trackId) {
        throw new Error('loadTrackContext: trackId is required');
    }
    if (TRACK_CONTEXT_CACHE.has(trackId)) {
        return TRACK_CONTEXT_CACHE.get(trackId);
    }

    const resourceLoader = await createTrackFactoryBackedLoader();
    const trackFactory = new TrackFactory({ resourceLoader });
    let config = trackFactory.configCache.get(trackId);
    if (!config) {
        config = await trackFactory.resourceLoader.loadTrack(trackId);
        trackFactory.configCache.set(trackId, config);
    }

    const geometry = config.geometry || {};
    const trackContext = {
        source: 'TrackFactory-backed',
        trackId: config.id || trackId,
        trackName: config.name || trackId,
        mode: config.type || (['oval', 'rectangle', 'spline'].includes(geometry.type) ? 'race' : 'derby'),
        geometryType: geometry.type || 'unknown',
        assetPath: `${TRACK_ASSET_PREFIX}/${trackId}.json`,
        spawnCount: config.spawn?.positions?.length || 0,
        weaponConfig: normalizeForJson(config.weapons || {}),
        config
    };

    TRACK_CONTEXT_CACHE.set(trackId, trackContext);
    return trackContext;
}

/**
 * Build a fake vehicle that satisfies the slice of the Vehicle contract the
 * WeaponSystem reads: identity, dead flag, and a mesh with position + heading.
 * @param {Object} spec
 */
export function createFakeVehicle(spec = {}) {
    const {
        id,
        playerId,
        x = 0,
        y = 0.5,
        z = 0,
        heading = 0,
        isDead = false
    } = spec;

    if (id == null || playerId == null) {
        throw new Error('createFakeVehicle: id and playerId are required');
    }

    return {
        id,
        playerId,
        isDead,
        // Minimal mesh stand-in: WeaponSystem only reads position + rotation.y
        // and (when THREE is present) attaches child effect meshes. In node
        // THREE is absent, so add()/remove() are never called.
        mesh: {
            position: { x, y, z },
            rotation: { x: 0, y: heading, z: 0 },
            children: [],
            add(child) {
                this.children.push(child);
            },
            remove(child) {
                this.children = this.children.filter((entry) => entry !== child);
            }
        },
        invulnerable: false
    };
}

function normalizeActorSpec(spec = {}) {
    if (!spec || typeof spec !== 'object') {
        return null;
    }
    const id = spec.id;
    const playerId = spec.playerId;
    if (!Number.isFinite(spec.x) && !Number.isFinite(spec.position?.x)) {
        return null;
    }
    const position = spec.position || {};
    return {
        id: String(id),
        playerId: Number(playerId),
        x: Number.isFinite(spec.x) ? Number(spec.x) : Number(position.x || 0),
        y: Number.isFinite(spec.y) ? Number(spec.y) : Number(position.y || 0.5),
        z: Number.isFinite(spec.z) ? Number(spec.z) : Number(position.z || 0),
        heading: Number.isFinite(spec.heading) ? Number(spec.heading) : Number(spec.rotationY || 0)
    };
}

/**
 * Create a deterministic Weapon Lab harness wrapping a real WeaponSystem.
 * @param {Object} [options]
 * @param {number} [options.seed=0xC0FFEE] - seed for the deterministic run context
 * @param {number} [options.fixedDt=1/60] - simulation step in seconds
 * @returns {Object} harness API
 */
export function createLabHarness(options = {}) {
    const seed = (options.seed ?? 0xC0FFEE) >>> 0;
    const fixedDt = options.fixedDt || 1 / 60;
    const presetId = options.presetId || null;

    const clock = new SimClock({ fixedDt });
    const runContext = GameRunContext.create({ seed, deterministic: true, clock });
    const eventBus = new EventBus();

    // Fake damage adapter: records every production damage call verbatim.
    const damageRecords = [];
    const damageSystem = {
        applyDamage(vehicleId, amount, meta = {}) {
            damageRecords.push({
                vehicleId,
                amount,
                type: meta.type,
                weaponId: meta.weaponId,
                sourcePlayerId: meta.sourcePlayerId,
                atMs: clock.nowMs()
            });
        }
    };

    // Record weapon events (no render adapter: renderSystem stays null).
    const events = [];
    for (const type of WEAPON_EVENTS) {
        eventBus.on(type, (data) => {
            events.push({ type, data: data || {}, atMs: clock.nowMs() });
        });
    }

    const weaponSystem = new WeaponSystem({
        eventBus,
        renderSystem: null,
        damageSystem,
        runContext
    });

    const vehicles = new Map();

        const harness = {
        seed,
        fixedDt,
        presetId,
        clock,
        runContext,
        eventBus,
        weaponSystem,
        damageSystem,
        damageRecords,
        events,
        vehicles,
        trackContext: null,
        baseTrackConfig: null,
        warnings: [],
        errors: [],

        /** Initialise the weapon definitions + event wiring. */
        async init() {
            await weaponSystem.init();
            return harness;
        },

        /** Configure the arena geometry/weapon pacing via the production path. */
        setArena(config) {
            weaponSystem.setArenaConfig(config);
            return harness;
        },

        /** Load production track/arena config via TrackFactory-backed loading. */
        async loadTrack(trackId) {
            const trackContext = await loadTrackContext(trackId);
            harness.trackContext = trackContext;
            harness.baseTrackConfig = deepClone(trackContext.config);
            weaponSystem.setArenaConfig(trackContext.config);
            return trackContext;
        },

        /** Apply a patch to the active track configuration via production arena config path. */
        applyArenaConfigPatch(patch = {}) {
            if (!harness.trackContext) {
                throw new Error('applyArenaConfigPatch: loadTrack() must be called first');
            }
            const nextConfig = applyPatch(harness.baseTrackConfig || harness.trackContext.config || {}, patch);
            harness.trackContext.config = nextConfig;
            weaponSystem.setArenaConfig(nextConfig);
            return nextConfig;
        },

        /** Apply live overrides to weapon definitions through production rule data. */
        applyWeaponOverrides(overrides = {}) {
            const weaponOverrides = overrides?.weaponOverrides || overrides;
            for (const [weaponId, patch] of Object.entries(weaponOverrides || {})) {
                const original = weaponSystem.weaponDefs.get(weaponId);
                if (!original || !patch || typeof patch !== 'object') continue;
                weaponSystem.weaponDefs.set(weaponId, applyPatch(deepClone(original), patch));
            }
            return true;
        },

        /** Add and register a fake vehicle. */
        addVehicle(spec) {
            const vehicle = createFakeVehicle(spec);
            vehicles.set(vehicle.id, vehicle);
            weaponSystem.registerVehicle(vehicle);
            return vehicle;
        },

        /** Add provided actors from scenario JSON. */
        applyActors(actors = []) {
            if (!Array.isArray(actors) || actors.length === 0) {
                return harness;
            }
            for (const actor of actors) {
                const normalized = normalizeActorSpec(actor);
                if (!normalized) continue;
                if (vehicles.has(normalized.id)) continue;
                harness.addVehicle(normalized);
            }
            return harness;
        },

        /** Move a vehicle (by id) to a new position/heading. */
        moveVehicle(id, { x, y, z, heading } = {}) {
            const vehicle = vehicles.get(id);
            if (!vehicle) throw new Error(`moveVehicle: unknown vehicle ${id}`);
            if (x != null) vehicle.mesh.position.x = x;
            if (y != null) vehicle.mesh.position.y = y;
            if (z != null) vehicle.mesh.position.z = z;
            if (heading != null) vehicle.mesh.rotation.y = heading;
            return vehicle;
        },

        getVehicle(id) {
            return vehicles.get(String(id));
        },

        /** Put a known weapon directly into a player's inventory. */
        giveWeapon(playerId, weaponId) {
            const def = weaponSystem.weaponDefs.get(weaponId);
            if (!def) throw new Error(`giveWeapon: unknown weapon ${weaponId}`);
            weaponSystem.inventory.set(playerId, { weaponId, weaponData: def });
            return def;
        },

        /** Fire a player's held weapon through the production fire path. */
        fire(playerId) {
            weaponSystem.fireWeapon(playerId);
            return harness;
        },

        /** Begin pickup spawning (production lifecycle). */
        startSpawning() {
            weaponSystem.start();
            return harness;
        },

        /** Advance the sim by N fixed steps, updating the weapon system each step. */
        tick(steps = 1) {
            if (!Number.isInteger(steps) || steps < 0) {
                throw new Error(`tick: steps must be a non-negative integer, got ${steps}`);
            }
            for (let i = 0; i < steps; i++) {
                clock.step(1);
                weaponSystem.update(fixedDt);
            }
            return harness;
        },

        /** Advance by an (approximate) number of seconds of sim time. */
        advanceSeconds(seconds) {
            const steps = Math.max(0, Math.round(seconds / fixedDt));
            harness.tick(steps);
            return steps;
        },

        /** All recorded events of a given type. */
        eventsOfType(type) {
            return events.filter((e) => e.type === type);
        },

        /** Damage records targeting a specific vehicle id. */
        damageTo(vehicleId) {
            return damageRecords.filter((d) => d.vehicleId === vehicleId);
        },

        /** Total damage dealt to a vehicle id across all records. */
        totalDamageTo(vehicleId) {
            return harness.damageTo(vehicleId).reduce((sum, d) => sum + d.amount, 0);
        },

        /** Snapshot current actor state for diagnostics/export. */
        snapshotActors() {
            return Array.from(vehicles.values()).map((vehicle) => ({
                id: vehicle.id,
                playerId: vehicle.playerId,
                position: normalizeForJson(vehicle.mesh?.position || {}),
                heading: round3(vehicle.mesh?.rotation?.y || 0),
                isDead: !!vehicle.isDead,
                invulnerable: !!vehicle.invulnerable,
                stunned: !!vehicle.stunned,
                inOilSlick: !!vehicle.inOilSlick
            }));
        },

        /**
         * Machine-readable, deterministic diagnostics snapshot. Floats are
         * rounded so identical seeds/scripts produce identical JSON.
         */
        diagnostics() {
            const live = {
                pickups: weaponSystem.pickups.size,
                projectiles: weaponSystem.projectiles.size,
                effects: weaponSystem.effects.size
            };
            const trackContext = harness.trackContext ? {
                source: harness.trackContext.source,
                trackId: harness.trackContext.trackId,
                trackName: harness.trackContext.trackName,
                mode: harness.trackContext.mode,
                geometryType: harness.trackContext.geometryType,
                assetPath: harness.trackContext.assetPath,
                spawnCount: harness.trackContext.spawnCount,
                weaponConfig: harness.trackContext.weaponConfig
            } : null;
            const base = {
                schema: WEAPON_LAB_DIAGNOSTICS_SCHEMA,
                version: WEAPON_LAB_DIAGNOSTICS_VERSION,
                toolName: 'weapon-lab',
                preset: presetId,
                seed,
                timestamp: round3(clock.nowMs()),
                tick: clock.tick,
                simTimeMs: round3(clock.nowMs()),
                live,
                state: {
                    seed,
                    preset: presetId,
                    trackContext,
                    live,
                    actors: harness.snapshotActors()
                },
                warnings: [...harness.warnings],
                errors: [...harness.errors],
                metrics: {
                    fixedDtMs: round3(fixedDt * 1000),
                    simTimeMs: round3(clock.nowMs()),
                    live
                },
                productionPaths: [
                    'static/js/systems/WeaponSystem.js',
                    'static/js/engine/GameRunContext.js',
                    'static/js/resources/TrackFactory.js',
                    ...(trackContext?.assetPath ? [trackContext.assetPath] : [])
                ],
                trackContext,
                spawnedWeapons: harness
                    .eventsOfType('weapon:spawned')
                    .map((e) => ({
                        pickupId: e.data.pickupId,
                        weaponId: e.data.weaponId,
                        atMs: round3(e.atMs),
                        x: round3(e.data.position?.x ?? 0),
                        y: round3(e.data.position?.y ?? 0),
                        z: round3(e.data.position?.z ?? 0)
                    })),
                damage: damageRecords.map((d) => ({
                    atMs: round3(d.atMs),
                    vehicleId: d.vehicleId,
                    amount: round3(d.amount),
                    type: d.type || null,
                    weaponId: d.weaponId,
                    sourcePlayerId: d.sourcePlayerId
                })),
                events: events.map((e) => ({
                    type: e.type,
                    atMs: round3(e.atMs),
                    data: normalizeForJson(e.data || {})
                }))
            };
            const canonicalJson = stableStringify(base);
            return {
                ...base,
                determinism: {
                    hash: stableHash(canonicalJson),
                    canonicalJsonLength: canonicalJson.length,
                    equalityArtifact: `${presetId || 'custom'}:${seed}:${stableHash(canonicalJson)}`
                }
            };
        },

        /** Tear down the underlying weapon system. */
        destroy() {
            weaponSystem.destroy();
        }
    };

    return harness;
}

export { stableHash, stableStringify };
