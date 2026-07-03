/**
 * Weapon Lab scenarios — deterministic presets that exercise the REAL
 * `WeaponSystem` behaviours end to end (bead br-weapon-test-lab-zas).
 *
 * Each scenario:
 *  - builds a fresh seeded harness (see ./harness.js),
 *  - scripts a production-faithful situation (positions, fire, time),
 *  - returns machine-readable `diagnostics` plus a list of `checks`
 *    ({ name, pass, detail }) that the lab UI renders as pass/fail badges and
 *    the vitest suites assert on.
 *
 * No weapon rule is re-implemented here: every outcome comes from the real
 * WeaponSystem reacting to scripted inputs. Pure ESM, no DOM / THREE.
 */
import { createLabHarness, stableHash, stableStringify } from './harness.js';

export const DEFAULT_SEED = 0xC0FFEE;
export const WEAPON_LAB_SCENARIO_SCHEMA = 'jj.weaponLabScenario.v1';
const DEFAULT_TRACK_ID = 'derby-bowl';

function getBuildId() {
    return (typeof window !== 'undefined' && (window.__BUILD_ID || window.__buildId)) || 'dev-local';
}

function check(name, pass, detail = '') {
    return { name, pass: !!pass, detail };
}

/** After a scenario, prove clearAll() drains transient state. */
function cleanupChecks(h) {
    h.weaponSystem.clearAll();
    const { pickups, projectiles, effects } = {
        pickups: h.weaponSystem.pickups.size,
        projectiles: h.weaponSystem.projectiles.size,
        effects: h.weaponSystem.effects.size
    };
    return check(
        'cleanup drains pickups/projectiles/effects',
        pickups === 0 && projectiles === 0 && effects === 0,
        `pickups=${pickups} projectiles=${projectiles} effects=${effects}`
    );
}

async function createScenarioHarness(scenario, seed, options = {}) {
    const h = await createLabHarness({ seed, presetId: scenario.id }).init();
    await h.loadTrack(scenario.trackId || DEFAULT_TRACK_ID);
    h.applyArenaConfigPatch(options.arenaConfigPatch || {});
    h.applyWeaponOverrides(options.weaponOverrides || {});
    h.applyActors(options.actors || []);
    return h;
}

function buildScenarioExport(scenario, h, options = {}) {
    const diagnostics = options.diagnostics || h.diagnostics();
    return {
        schema: WEAPON_LAB_SCENARIO_SCHEMA,
        toolName: 'weapon-lab',
        version: 1,
        preset: scenario.id,
        seed: h.seed,
        buildId: getBuildId(),
        track: diagnostics.trackContext,
        mapContext: diagnostics.trackContext,
        overrides: {
            arenaConfigPatch: {},
            weaponOverrides: {},
            ...(options.overrides || {})
        },
        actors: h.snapshotActors(),
        camera: options.camera || scenario.camera || null,
        overlay: options.overlay || scenario.overlay || null,
        diagnosticsHash: diagnostics.determinism?.hash || stableHash(diagnostics)
    };
}

function withScenarioMetadata(scenario, h, checks) {
    const diagnostics = h.diagnostics();
    return {
        _harness: h,
        id: scenario.id,
        checks,
        diagnostics,
        scenario: buildScenarioExport(scenario, h, { diagnostics })
    };
}

/**
 * pickup-field: enable production spawning in an empty arena and let pickups
 * accumulate. Proves deterministic selection + placement + cadence.
 */
async function pickupField(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('pickup-field');
    const h = await createScenarioHarness(scenario, seed, options);
    h.startSpawning();
    h.advanceSeconds(40);

    const spawned = h.eventsOfType('weapon:spawned');
    const validIds = new Set(h.weaponSystem.weaponDefs.keys());
    const allValid = spawned.every((e) => validIds.has(e.data.weaponId));
    const inBounds = spawned.every((e) => {
        const p = e.data.position || {};
        return Math.hypot(p.x || 0, p.z || 0) <= 35 + 0.001;
    });
    const capped = h.weaponSystem.pickups.size <= 4 + 3; // base + late-phase extra

    const checks = [
        check('pickups spawned', spawned.length >= 3, `count=${spawned.length}`),
        check('all spawned weapon ids are defined', allValid),
        check('spawn positions stay in arena', inBounds),
        check('active pickups respect progression cap', capped, `live=${h.weaponSystem.pickups.size}`)
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/**
 * missile-chase: a homing missile fired at an enemy directly ahead must track
 * and deal its defined damage exactly once.
 */
async function missileChase(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('missile-chase');
    const h = await createScenarioHarness(scenario, seed, options);
    if (!h.getVehicle('shooter')) {
        h.addVehicle({ id: 'shooter', playerId: 1, x: 0, z: 0, heading: 0 });
    }
    if (!h.getVehicle('target')) {
        h.addVehicle({ id: 'target', playerId: 2, x: 0, z: 15, heading: 0 });
    }
    h.giveWeapon(1, 'missile');
    h.fire(1);
    h.advanceSeconds(2);

    const dmg = h.damageTo('target');
    const hit = h.eventsOfType('weapon:hit').find((e) => e.data.targetId === 2);
    const checks = [
        check('missile dealt damage once', dmg.length === 1, `records=${dmg.length}`),
        check('missile damage equals definition (70)', dmg[0]?.amount === 70, `amount=${dmg[0]?.amount}`),
        check('weapon:hit emitted for target', !!hit),
        check('missile consumed (no live projectile)', h.weaponSystem.projectiles.size === 0)
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/**
 * mine-arming: a proximity mine must NOT trigger during its arm delay, then
 * explode once armed while an enemy sits on it.
 */
async function mineArming(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('mine-arming');
    const h = await createScenarioHarness(scenario, seed, options);
    if (!h.getVehicle('owner')) {
        h.addVehicle({ id: 'owner', playerId: 1, x: 0, z: 0, heading: 0 });
    }
    // Victim sits on the deploy point (behind owner at z = -2) from t0.
    if (!h.getVehicle('victim')) {
        h.addVehicle({ id: 'victim', playerId: 2, x: 0, z: -2, heading: 0 });
    }
    h.giveWeapon(1, 'mine');
    h.fire(1);

    // armDelay is 1s; advance to 0.5s and confirm no detonation yet.
    h.advanceSeconds(0.5);
    const dmgDuringArm = h.totalDamageTo('victim');

    // Advance past the arm delay; the mine should now trigger.
    h.advanceSeconds(0.7);
    const dmgAfterArm = h.totalDamageTo('victim');
    const explosion = h.eventsOfType('weapon:explosion');

    const checks = [
        check('no detonation during arm delay', dmgDuringArm === 0, `dmg@0.5s=${dmgDuringArm}`),
        check('detonates after arming', dmgAfterArm > 0, `dmg@1.2s=${dmgAfterArm.toFixed(2)}`),
        check('explosion event emitted', explosion.length >= 1),
        check('mine consumed after explosion', h.weaponSystem.effects.size === 0)
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/**
 * oil-slick: a deployed zone must flag vehicles inside it with reduced
 * friction, and clear that flag when they leave.
 */
async function oilSlick(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('oil-slick');
    const h = await createScenarioHarness(scenario, seed, options);
    if (!h.getVehicle('owner')) {
        h.addVehicle({ id: 'owner', playerId: 1, x: 0, z: 0, heading: 0 });
    }
    const victim = h.getVehicle('victim') || h.addVehicle({ id: 'victim', playerId: 2, x: 0, z: -2, heading: 0 });
    h.giveWeapon(1, 'oil-slick');
    h.fire(1); // deploys zone behind owner at z = -2

    h.tick(1);
    const inZone = victim.inOilSlick === true && victim.oilFrictionMultiplier === 0.1;

    // Drive the victim out of the zone radius.
    h.moveVehicle('victim', { x: 0, z: 30 });
    h.tick(1);
    const cleared = victim.inOilSlick === false && victim.oilFrictionMultiplier === 1;

    const checks = [
        check('victim in zone gets reduced friction (0.1)', inZone,
            `inOilSlick=${victim.inOilSlick} mult=${victim.oilFrictionMultiplier}`),
        check('leaving the zone restores friction', cleared,
            `inOilSlick=${victim.inOilSlick} mult=${victim.oilFrictionMultiplier}`),
        check('zone still active within lifetime', h.weaponSystem.effects.size === 1)
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/**
 * shield-block: an invulnerable (shielded) target takes no weapon damage; once
 * the shield expires, the same attack lands.
 */
async function shieldBlock(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('shield-block');
    const h = await createScenarioHarness(scenario, seed, options);
    if (!h.getVehicle('shooter')) {
        h.addVehicle({ id: 'shooter', playerId: 1, x: 0, z: 0, heading: 0 });
    }
    const target = h.getVehicle('target') || h.addVehicle({ id: 'target', playerId: 2, x: 0, z: 15, heading: 0 });

    // Target raises a shield.
    h.giveWeapon(2, 'shield');
    h.fire(2);
    const shielded = target.invulnerable === true;

    // Shooter lands a missile while the shield is up.
    h.giveWeapon(1, 'missile');
    h.fire(1);
    h.advanceSeconds(2);
    const blockedDamage = h.totalDamageTo('target');
    const hitWhileShielded = h.eventsOfType('weapon:hit').some((e) => e.data.targetId === 2);

    // Let the shield (5s) expire, then attack again.
    h.advanceSeconds(4);
    const expired = target.invulnerable === false;
    h.giveWeapon(1, 'missile');
    h.fire(1);
    h.advanceSeconds(2);
    const damageAfter = h.totalDamageTo('target');

    const checks = [
        check('shield makes target invulnerable', shielded),
        check('missile collides but deals no damage while shielded', blockedDamage === 0 && hitWhileShielded,
            `dmg=${blockedDamage} hit=${hitWhileShielded}`),
        check('shield expires after duration', expired),
        check('damage lands after shield expires (70)', damageAfter === 70, `dmg=${damageAfter}`)
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/**
 * emp-stun: an EMP stuns vehicles inside its radius and spares those outside.
 */
async function empStun(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('emp-stun');
    const h = await createScenarioHarness(scenario, seed, options);
    if (!h.getVehicle('owner')) {
        h.addVehicle({ id: 'owner', playerId: 1, x: 0, z: 0, heading: 0 });
    }
    const near = h.getVehicle('near') || h.addVehicle({ id: 'near', playerId: 2, x: 5, z: 0, heading: 0 });   // within radius 15
    const far = h.getVehicle('far') || h.addVehicle({ id: 'far', playerId: 3, x: 40, z: 0, heading: 0 });    // outside radius
    h.giveWeapon(1, 'emp');
    h.fire(1);

    const stunEvents = h.eventsOfType('weapon:stun');
    const checks = [
        check('vehicle in radius is stunned', near.stunned === true && near.stunEndTime > 0,
            `stunned=${near.stunned}`),
        check('vehicle outside radius is not stunned', !far.stunned, `stunned=${far.stunned}`),
        check('stun event emitted for in-range target', stunEvents.some((e) => e.data.targetId === 2))
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/**
 * flamethrower-cone: continuous fire damages only targets inside the forward
 * cone and within range.
 */
async function flamethrowerCone(seed = DEFAULT_SEED, options = {}) {
    const scenario = getScenario('flamethrower-cone');
    const h = await createScenarioHarness(scenario, seed, options);
    if (!h.getVehicle('owner')) {
        h.addVehicle({ id: 'owner', playerId: 1, x: 0, z: 0, heading: 0 });
    } // faces +z
    if (!h.getVehicle('inCone')) {
        h.addVehicle({ id: 'inCone', playerId: 2, x: 0, z: 5, heading: 0 });
    } // ahead, in range
    if (!h.getVehicle('toSide')) {
        h.addVehicle({ id: 'toSide', playerId: 3, x: 5, z: 0, heading: 0 });
    } // 90deg, outside cone
    if (!h.getVehicle('tooFar')) {
        h.addVehicle({ id: 'tooFar', playerId: 4, x: 0, z: 20, heading: 0 });
    } // ahead but beyond range 8
    h.giveWeapon(1, 'flamethrower');
    h.fire(1);
    // Duration is 3s (tickRate 0.1s); advance just past it so the effect both
    // ticks damage and then expires (effect ends when sim time > duration).
    h.advanceSeconds(3.5);

    const inCone = h.totalDamageTo('inCone');
    const toSide = h.totalDamageTo('toSide');
    const tooFar = h.totalDamageTo('tooFar');

    const checks = [
        check('target in cone + range takes continuous damage', inCone > 0, `dmg=${inCone.toFixed(1)}`),
        check('target outside cone takes no damage', toSide === 0, `dmg=${toSide}`),
        check('target beyond range takes no damage', tooFar === 0, `dmg=${tooFar}`),
        check('continuous effect ended after duration', h.weaponSystem.effects.size === 0)
    ];
    checks.push(cleanupChecks(h));
    return withScenarioMetadata(scenario, h, checks);
}

/** Scenario registry: id -> { id, name, description, run(seed) }. */
export const SCENARIOS = [
    {
        id: 'pickup-field',
        name: 'Pickup Field',
        description: 'Deterministic pickup spawn selection + placement',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 0, y: 42, z: 58 }, lookAt: { x: 0, y: 0, z: 0 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: pickupField
    },
    {
        id: 'missile-chase',
        name: 'Missile Chase',
        description: 'Homing missile tracks and damages an enemy',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 12, y: 28, z: 42 }, lookAt: { x: 0, y: 0, z: 10 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: missileChase
    },
    {
        id: 'mine-arming',
        name: 'Mine Arming',
        description: 'Proximity mine arm delay then detonation',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 10, y: 24, z: 36 }, lookAt: { x: 0, y: 0, z: -2 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: mineArming
    },
    {
        id: 'oil-slick',
        name: 'Oil Slick',
        description: 'Friction zone applies then clears',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 8, y: 24, z: 34 }, lookAt: { x: 0, y: 0, z: 0 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: oilSlick
    },
    {
        id: 'shield-block',
        name: 'Shield Block',
        description: 'Shield blocks damage, then expires',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 10, y: 24, z: 36 }, lookAt: { x: 0, y: 0, z: 12 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: shieldBlock
    },
    {
        id: 'emp-stun',
        name: 'EMP Stun',
        description: 'EMP stuns in-radius, spares out-of-radius',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 0, y: 34, z: 48 }, lookAt: { x: 0, y: 0, z: 0 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: empStun
    },
    {
        id: 'flamethrower-cone',
        name: 'Flamethrower Cone',
        description: 'Cone damage only inside angle + range',
        trackId: DEFAULT_TRACK_ID,
        camera: { position: { x: 0, y: 22, z: 28 }, lookAt: { x: 0, y: 0, z: 8 } },
        overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
        run: flamethrowerCone
    }
];

/** Look up a scenario descriptor by id. */
export function getScenario(id) {
    return SCENARIOS.find((s) => s.id === id) || null;
}

/**
 * Run one scenario by id. Throws on unknown id so callers (and the UI) fail
 * loudly rather than silently skipping coverage.
 */
export async function runScenario(id, {
    seed = DEFAULT_SEED,
    arenaConfigPatch = {},
    weaponOverrides = {},
    actors = [],
    skipDefaultActors = false
} = {}) {
    const scenario = getScenario(id);
    if (!scenario) throw new Error(`runScenario: unknown scenario '${id}'`);
    const result = await scenario.run(seed, {
        arenaConfigPatch,
        weaponOverrides,
        actors,
        skipDefaultActors
    });
    const { _harness, ...publicResult } = result;
    return {
        name: scenario.name,
        description: scenario.description,
        ...publicResult
    };
}

export async function runScenarioWithHarness(id, {
    seed = DEFAULT_SEED,
    arenaConfigPatch = {},
    weaponOverrides = {},
    actors = [],
    skipDefaultActors = false
} = {}) {
    const scenario = getScenario(id);
    if (!scenario) throw new Error(`runScenario: unknown scenario '${id}'`);
    const result = await scenario.run(seed, {
        arenaConfigPatch,
        weaponOverrides,
        actors,
        skipDefaultActors
    });
    const { _harness, ...publicResult } = result;
    return {
        result: {
            name: scenario.name,
            description: scenario.description,
            ...publicResult
        },
        harness: _harness || null
    };
}

/** Run every scenario; returns an array of results in registry order. */
export async function runAllScenarios({ seed = DEFAULT_SEED } = {}) {
    const results = [];
    for (const scenario of SCENARIOS) {
        results.push(await runScenario(scenario.id, { seed }));
    }
    return results;
}

export function exportWeaponLabScenario(id, options = {}) {
    const scenario = getScenario(id);
    if (!scenario) {
        throw new Error(`exportWeaponLabScenario: unknown scenario '${id}'`);
    }
    const seed = Number.isFinite(options.seed) ? Number(options.seed) : DEFAULT_SEED;
    const diagnostics = options.diagnostics || null;
    const normalized = {
        schema: WEAPON_LAB_SCENARIO_SCHEMA,
        toolName: 'weapon-lab',
        version: 1,
        preset: scenario.id,
        seed,
        buildId: options.buildId || getBuildId(),
        track: options.track || diagnostics?.trackContext || {
            trackId: scenario.trackId,
            assetPath: `static/assets/tracks/${scenario.trackId}.json`
        },
        mapContext: options.mapContext || diagnostics?.trackContext || {
            trackId: scenario.trackId,
            assetPath: `static/assets/tracks/${scenario.trackId}.json`
        },
        overrides: {
            arenaConfigPatch: {},
            weaponOverrides: {},
            ...(options.overrides || {})
        },
        actors: options.actors || [],
        camera: options.camera || scenario.camera || null,
        overlay: options.overlay || scenario.overlay || null
    };
    return {
        ...normalized,
        diagnosticsHash: options.diagnosticsHash || diagnostics?.determinism?.hash || stableHash(stableStringify(normalized))
    };
}

export function importWeaponLabScenario(scenario) {
    if (!scenario || scenario.schema !== WEAPON_LAB_SCENARIO_SCHEMA) {
        throw new Error(`Weapon lab scenario must use ${WEAPON_LAB_SCENARIO_SCHEMA}`);
    }
    const preset = typeof scenario.preset === 'string' ? scenario.preset : null;
    if (!preset || !getScenario(preset)) {
        throw new Error(`Weapon lab scenario references unknown preset '${preset}'`);
    }
    return {
        preset,
        seed: Number.isFinite(scenario.seed) ? Number(scenario.seed) : DEFAULT_SEED,
        track: scenario.track || null,
        mapContext: scenario.mapContext || null,
        overrides: scenario.overrides || {},
        actors: Array.isArray(scenario.actors) ? scenario.actors : [],
        camera: scenario.camera || null,
        overlay: scenario.overlay || null,
        diagnosticsHash: scenario.diagnosticsHash || null
    };
}
