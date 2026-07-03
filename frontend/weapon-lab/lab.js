import * as THREE from 'three';
import { DebugLabRegistry } from '../../static/js/debug/DebugLabContract.js';
import { createSafeTextElement, renderSafeText, sanitizeDisplayString } from '../../static/js/debug/SafeTextRenderer.js';
import { ResourceLoader } from '../../static/js/resources/ResourceLoader.js';
import { TrackFactory } from '../../static/js/resources/TrackFactory.js';
import {
    DEFAULT_SEED,
    SCENARIOS,
    WEAPON_LAB_SCENARIO_SCHEMA,
    exportWeaponLabScenario,
    getScenario,
    importWeaponLabScenario,
    runScenarioWithHarness,
    runAllScenarios,
    runScenario
} from '../../static/js/weaponLab/scenarios.js';

window.THREE = THREE;

const DEBUG_LAB_SCENARIO_SCHEMA = 'jj.debugLab.v1';

const $ = (id) => document.getElementById(id);
const select = $('scenario');
const summaryEl = $('summary');
const badgesEl = $('badges');
const diagnosticsEl = $('diag');
const fileInputEl = $('importFile');
const tuningForm = $('weaponTuning');

const consoleState = {
    warns: [],
    errors: []
};

const labState = {
    ready: false,
    seed: DEFAULT_SEED,
    currentScenarioId: SCENARIOS[0]?.id || null,
    playing: true,
    previewTick: 0,
    animationTime: 0,
    track: null,
    trackContext: null,
    overrideTrackId: null,
    overlay: { assumptions: true, diagnostics: true, geometry: true, picking: false },
    lastResult: null,
    lastResults: null,
    lastDiagnostics: null,
    lastScenarioExport: null,
    tuningOverrides: {
        missile: {
            behavior: { speed: 50, lifetime: 5, tracking: { enabled: true, turnRate: 3, lockRange: 30, lockAngle: 45 } }
        },
        mine: {
            behavior: { lifetime: 60, armDelay: 1, triggerRadius: 3 }
        },
        boost: {
            behavior: { duration: 3, speedMultiplier: 2, ramDamageBonus: 25 }
        },
        sniper: {
            behavior: { range: 100, lockAngle: 0.3 }
        },
        emp: {
            behavior: { radius: 15, stunDuration: 3 }
        },
        'oil-slick': {
            behavior: { zoneRadius: 6, frictionMultiplier: 0.1, lifetime: 15 }
        },
        flamethrower: {
            behavior: { coneAngle: 30, range: 8, tickRate: 0.1 },
            damage: { amount: 10 }
        }
    },
    harness: null,
    actors: [],
    activeScenario: null
};

const TUNING_FIELDS = [
    ['missileSpeed', 'missile', 'behavior.speed', 50],
    ['missileLifetime', 'missile', 'behavior.lifetime', 5],
    ['missileTurnRate', 'missile', 'behavior.tracking.turnRate', 3],
    ['missileLockAngle', 'missile', 'behavior.tracking.lockAngle', 45],
    ['mineArmDelay', 'mine', 'behavior.armDelay', 1],
    ['mineTriggerRadius', 'mine', 'behavior.triggerRadius', 3],
    ['mineLifetime', 'mine', 'behavior.lifetime', 60],
    ['boostDuration', 'boost', 'behavior.duration', 3],
    ['boostSpeed', 'boost', 'behavior.speedMultiplier', 2],
    ['boostRam', 'boost', 'behavior.ramDamageBonus', 25],
    ['sniperRange', 'sniper', 'behavior.range', 100],
    ['sniperAimTolerance', 'sniper', 'behavior.lockAngle', 0.3],
    ['empRadius', 'emp', 'behavior.radius', 15],
    ['empStun', 'emp', 'behavior.stunDuration', 3],
    ['oilRadius', 'oil-slick', 'behavior.zoneRadius', 6],
    ['oilFriction', 'oil-slick', 'behavior.frictionMultiplier', 0.1],
    ['oilLifetime', 'oil-slick', 'behavior.lifetime', 15],
    ['flameCone', 'flamethrower', 'behavior.coneAngle', 30],
    ['flameRange', 'flamethrower', 'behavior.range', 8],
    ['flameTickRate', 'flamethrower', 'behavior.tickRate', 0.1],
    ['flameDmg', 'flamethrower', 'damage.amount', 10]
];

function parseNumberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getNested(object, path) {
    return path.split('.').reduce((current, key) => (current && current[key] != null ? current[key] : undefined), object);
}

function setNested(object, path, value) {
    const keys = path.split('.');
    let cursor = object;
    keys.forEach((key, index) => {
        if (index === keys.length - 1) {
            cursor[key] = value;
            return;
        }
        if (!cursor[key] || typeof cursor[key] !== 'object') {
            cursor[key] = {};
        }
        cursor = cursor[key];
    });
}

function applyDefaultTuningInputs() {
    TUNING_FIELDS.forEach(([inputId, weaponId, path, fallback]) => {
        const input = $(inputId);
        if (!input) return;
        const value = getNested(labState.tuningOverrides, `${weaponId}.${path}`);
        if (typeof value === 'number') {
            input.value = String(value);
        } else if (typeof value === 'boolean') {
            input.value = value ? '1' : '0';
        } else if (typeof value === 'undefined') {
            setNested(labState.tuningOverrides, `${weaponId}.${path}`, fallback);
            input.value = String(fallback);
        }
    });
}

function captureTuningOverrides() {
    const next = cloneJson(labState.tuningOverrides);
    TUNING_FIELDS.forEach(([inputId, weaponId, path]) => {
        const input = $(inputId);
        if (!input) return;
        const value = parseNumberValue(input.value);
        setNested(next, `${weaponId}.${path}`, value);
    });
    labState.tuningOverrides = next;
    return next;
}

function buildWeaponOverrides() {
    return cloneJson(labState.tuningOverrides);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function estimateDataUrlBytes(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    const commaIndex = dataUrl.indexOf(',');
    const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
    return Math.max(0, Math.floor((payload.length * 3) / 4));
}

function getBuildId() {
    return window.__BUILD_ID || window.__buildId || 'dev-local';
}

function createConsoleEntry(message) {
    return {
        timestamp: Date.now(),
        message: sanitizeDisplayString(String(message || ''))
    };
}

function recordWarning(message) {
    consoleState.warns.push(createConsoleEntry(message));
}

function recordError(message) {
    consoleState.errors.push(createConsoleEntry(message));
}

function clearChildren(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function setSummary(text, className = '') {
    renderSafeText(summaryEl, sanitizeDisplayString(text));
    summaryEl.className = className;
}

function appendBadge({ pass, name, detail = '' }) {
    const badge = document.createElement('div');
    badge.className = `badge ${pass ? 'pass' : 'fail'}`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    badge.appendChild(dot);

    const content = document.createElement('span');
    content.appendChild(createSafeTextElement(sanitizeDisplayString(name), 'b'));
    if (detail) {
        const detailEl = createSafeTextElement(sanitizeDisplayString(` ${detail}`), 'span', { class: 'detail' });
        content.appendChild(detailEl);
    }
    badge.appendChild(content);
    badgesEl.appendChild(badge);
}

function renderDiagnostics(value) {
    diagnosticsEl.textContent = JSON.stringify(value, null, 2);
}

function disposeObject(object) {
    if (!object) return;
    object.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
            child.material.forEach((material) => material?.dispose?.());
        } else {
            child.material?.dispose?.();
        }
    });
}

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0d1429, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0d1429, 50, 170);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
const cameraTarget = new THREE.Vector3(0, 0, 0);
camera.position.set(0, 42, 58);
camera.lookAt(cameraTarget);

scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(30, 60, 20);
scene.add(dir);

const resourceLoader = new ResourceLoader({ basePath: '/static/assets' });
const trackFactory = new TrackFactory({ resourceLoader });

const carMaterials = [0x00ff88, 0x4cc9f0, 0xf72585, 0xffb703].map((color) => new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.2
}));
const cars = carMaterials.map((material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 5), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
});

const pickupMeshes = [];
function ensurePickupMeshes(count) {
    while (pickupMeshes.length < count) {
        const cube = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 2),
            new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffaa00, emissiveIntensity: 0.6 })
        );
        cube.visible = false;
        scene.add(cube);
        pickupMeshes.push(cube);
    }
}
ensurePickupMeshes(6);

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function getScenarioCamera(scenario) {
    const fallback = { position: { x: 0, y: 42, z: 58 }, lookAt: { x: 0, y: 0, z: 0 } };
    return scenario?.camera || fallback;
}

function applyCameraState(cameraState) {
    const position = cameraState?.position || { x: 0, y: 42, z: 58 };
    const lookAt = cameraState?.lookAt || { x: 0, y: 0, z: 0 };
    camera.position.set(position.x, position.y, position.z);
    cameraTarget.set(lookAt.x, lookAt.y, lookAt.z);
    camera.lookAt(cameraTarget);
}

function currentCameraState() {
    return {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        lookAt: { x: cameraTarget.x, y: cameraTarget.y, z: cameraTarget.z }
    };
}

function positionCarsFromTrack(track) {
    const positions = track?.spawnPositions || [];
    cars.forEach((car, index) => {
        const spawn = positions[index] || {
            x: Math.cos((index / cars.length) * Math.PI * 2) * 16,
            y: 1.5,
            z: Math.sin((index / cars.length) * Math.PI * 2) * 16,
            rotation: -((index / cars.length) * Math.PI * 2)
        };
        car.position.set(spawn.x, spawn.y || 1.5, spawn.z);
        car.rotation.y = spawn.rotation || 0;
    });
}

function updatePickupPreview(diagnostics) {
    const spawned = diagnostics?.spawnedWeapons || [];
    pickupMeshes.forEach((mesh, index) => {
        const pickup = spawned[index];
        if (!pickup) {
            mesh.visible = false;
            return;
        }
        mesh.visible = true;
        mesh.position.set(pickup.x, pickup.y || 2.5, pickup.z);
    });
}

async function loadPreviewTrack(trackId) {
    if (!trackId) return null;
    if (labState.track?.mesh) {
        scene.remove(labState.track.mesh);
        disposeObject(labState.track.mesh);
    }
    const track = await trackFactory.create(trackId);
    labState.track = track;
    labState.trackContext = {
        trackId: track.id,
        trackName: track.config?.name || track.id,
        mode: track.config?.type || null,
        geometryType: track.config?.geometry?.type || null,
        assetPath: `static/assets/tracks/${trackId}.json`,
        spawnCount: track.spawnPositions?.length || 0
    };
    scene.add(track.mesh);
    positionCarsFromTrack(track);
    return track;
}

function getSelectedScenario() {
    return getScenario(labState.currentScenarioId);
}

function buildWeaponScenarioExport() {
    const scenario = getSelectedScenario();
    return exportWeaponLabScenario(scenario.id, {
        seed: labState.seed,
        diagnostics: labState.lastDiagnostics,
        actors: labState.lastResult?.scenario?.actors || [],
        track: labState.lastDiagnostics?.trackContext || labState.trackContext,
        mapContext: labState.lastDiagnostics?.trackContext || labState.trackContext,
        overrides: {
            arenaConfigPatch: {},
            weaponOverrides: cloneJson(labState.tuningOverrides)
        },
        camera: currentCameraState(),
        overlay: cloneJson(labState.overlay),
        buildId: getBuildId()
    });
}

function buildDebugLabScenario() {
    const weaponScenario = buildWeaponScenarioExport();
    return {
        schema: DEBUG_LAB_SCENARIO_SCHEMA,
        seed: weaponScenario.seed,
        preset: weaponScenario.preset,
        toolName: 'weapon-lab',
        timestamp: new Date().toISOString(),
        buildId: getBuildId(),
        diagnosticsHash: weaponScenario.diagnosticsHash,
        tuningOverrides: weaponScenario.overrides,
        customData: {
            weaponScenario,
            track: weaponScenario.track,
            overlay: weaponScenario.overlay
        }
    };
}

function getDiagnostics() {
    const base = cloneJson(labState.lastDiagnostics || {
        schema: 'jj.debugLab.diagnostics.v1',
        version: 'jj.weaponLab.diagnostics.v1',
        toolName: 'weapon-lab',
        preset: labState.currentScenarioId,
        timestamp: 0,
        tick: 0,
        state: {},
        warnings: [],
        errors: [],
        metrics: {},
        productionPaths: [],
        trackContext: labState.trackContext,
        determinism: { hash: null, equalityArtifact: null }
    });

    base.schema = 'jj.debugLab.diagnostics.v1';
    base.version = base.version || 'jj.weaponLab.diagnostics.v1';
    base.timestamp = Date.now();
    base.tick = labState.previewTick;
    base.state = {
        ...(base.state || {}),
        selectedScenario: labState.currentScenarioId,
        playing: labState.playing,
        hasCanvas: !!renderer.domElement,
        overlay: cloneJson(labState.overlay),
        tuning: cloneJson(labState.tuningOverrides),
        activeScenario: labState.activeScenario,
        harnessPreset: labState.currentScenarioId,
        trackContext: labState.trackContext || base.trackContext || null
    };
    base.metrics = {
        ...(base.metrics || {}),
        canvasWidth: renderer.domElement.width,
        canvasHeight: renderer.domElement.height,
        previewAnimationMs: Math.round(labState.animationTime * 1000)
    };
    base.warnings = [...(base.warnings || []), ...consoleState.warns];
    base.errors = [...(base.errors || []), ...consoleState.errors];
    base.trackContext = labState.trackContext || base.trackContext || null;
    base.hooksAvailable = {
        reset: true,
        stepFrame: true,
        stepSecond: true,
        playPause: true,
        takeScreenshot: true,
        getDiagnostics: true,
        getConsoleLogs: true,
        exportScenario: true,
        importScenario: true,
        runChecks: true
    };
    base.textRenderingSafe = true;
    base.consoleSpyActive = true;
    base.scenarioSchema = WEAPON_LAB_SCENARIO_SCHEMA;
    return base;
}

function getConsoleLogs() {
    return {
        warns: [...consoleState.warns],
        errors: [...consoleState.errors]
    };
}

function renderResult(result) {
    clearChildren(badgesEl);
    let passed = 0;
    for (const item of result.checks) {
        if (item.pass) passed += 1;
        appendBadge(item);
    }
    const allPassed = passed === result.checks.length;
    setSummary(`${result.name || result.id}: ${passed}/${result.checks.length} checks ${allPassed ? 'PASS' : 'FAIL'}`, allPassed ? 'ok' : 'bad');
    renderDiagnostics(getDiagnostics());
    updatePickupPreview(result.diagnostics);
    return allPassed;
}

function renderRunAll(results) {
    clearChildren(badgesEl);
    let totalPass = 0;
    let totalChecks = 0;
    for (const result of results) {
        const passed = result.checks.filter((item) => item.pass).length;
        totalPass += passed;
        totalChecks += result.checks.length;
        appendBadge({
            pass: passed === result.checks.length,
            name: result.name,
            detail: `${passed}/${result.checks.length}`
        });
    }
    const allPassed = totalPass === totalChecks;
    setSummary(`All scenarios: ${totalPass}/${totalChecks} checks ${allPassed ? 'PASS' : 'FAIL'}`, allPassed ? 'ok' : 'bad');
    renderDiagnostics({
        schema: 'jj.weaponLab.runAllSummary.v1',
        preset: labState.currentScenarioId,
        totalPass,
        totalChecks,
        results: results.map((result) => ({
            id: result.id,
            diagnostics: result.diagnostics
        }))
    });
    updatePickupPreview(labState.lastResult?.diagnostics || results[0]?.diagnostics || null);
    return allPassed;
}

async function ensureScenarioTrack(scenario) {
    const trackId = labState.overrideTrackId || scenario.trackId;
    await loadPreviewTrack(trackId);
    applyCameraState(currentCameraState());
}

async function runChecks(targetScenarioId = labState.currentScenarioId, options = {}) {
    const scenario = getScenario(targetScenarioId);
    if (!scenario) {
        throw new Error(`runChecks: unknown scenario '${targetScenarioId}'`);
    }

    labState.currentScenarioId = scenario.id;
    if (select.value !== scenario.id) {
        select.value = scenario.id;
    }
    if (Number.isFinite(options.seed)) {
        labState.seed = Number(options.seed);
    }

    await ensureScenarioTrack(scenario);
    const { result, harness } = await runScenarioWithHarness(scenario.id, {
        seed: labState.seed,
        arenaConfigPatch: options.arenaConfigPatch || {},
        weaponOverrides: options.weaponOverrides || captureTuningOverrides(),
        actors: options.actors || [],
        skipDefaultActors: Array.isArray(options.actors) && options.actors.length > 0
    });
    labState.harness = harness;
    labState.activeScenario = scenario.id;
    labState.lastResult = result;
    labState.lastResults = null;
    labState.lastDiagnostics = result.diagnostics;
    labState.trackContext = result.diagnostics.trackContext || labState.trackContext;
    labState.lastScenarioExport = buildWeaponScenarioExport();
    renderResult(result);
    return result;
}

async function runAllChecks() {
    const results = await runAllScenarios({ seed: labState.seed });
    labState.lastResults = results;
    labState.lastResult = results.find((result) => result.id === labState.currentScenarioId) || results[0] || null;
    labState.lastDiagnostics = labState.lastResult?.diagnostics || null;
    labState.lastScenarioExport = labState.lastResult ? buildWeaponScenarioExport() : null;
    renderRunAll(results);
    return results;
}

function screenshotDataUrl() {
    return renderer.domElement.toDataURL('image/png');
}

async function takeScreenshot() {
    const dataUrl = screenshotDataUrl();
    return {
        success: dataUrl.startsWith('data:image/png;base64,'),
        timestampMs: Date.now(),
        fileSizeBytes: estimateDataUrlBytes(dataUrl),
        mimeType: 'image/png'
    };
}

async function resetScenario() {
    labState.harness = null;
    labState.previewTick = 0;
    labState.animationTime = 0;
    consoleState.warns.length = 0;
    consoleState.errors.length = 0;
    const scenario = getSelectedScenario();
    applyCameraState(getScenarioCamera(scenario));
    return runChecks(labState.currentScenarioId);
}

function stepFrame() {
    if (labState.harness) {
        labState.harness.tick(1);
        labState.lastDiagnostics = labState.harness.diagnostics();
        labState.lastResult = {
            id: labState.currentScenarioId,
            name: getSelectedScenario()?.name || labState.currentScenarioId,
            checks: [],
            diagnostics: labState.lastDiagnostics,
            scenario: buildWeaponScenarioExport()
        };
        labState.previewTick = labState.lastDiagnostics.tick;
        updatePickupPreview(labState.lastDiagnostics);
    } else {
        labState.previewTick += 1;
    }
    labState.animationTime += 1 / 60;
    renderDiagnostics(getDiagnostics());
    return getDiagnostics();
}

function stepSecond() {
    if (labState.harness) {
        labState.harness.tick(60);
        labState.lastDiagnostics = labState.harness.diagnostics();
        labState.lastResult = {
            id: labState.currentScenarioId,
            name: getSelectedScenario()?.name || labState.currentScenarioId,
            checks: [],
            diagnostics: labState.lastDiagnostics,
            scenario: buildWeaponScenarioExport()
        };
        labState.previewTick = labState.lastDiagnostics.tick;
        updatePickupPreview(labState.lastDiagnostics);
    } else {
        labState.previewTick += 60;
    }
    labState.animationTime += 1;
    renderDiagnostics(getDiagnostics());
    return getDiagnostics();
}

function playPause() {
    labState.playing = !labState.playing;
    renderDiagnostics(getDiagnostics());
    return { playing: labState.playing, tick: labState.previewTick };
}

function exportCurrentScenario() {
    labState.lastScenarioExport = buildWeaponScenarioExport();
    return cloneJson(labState.lastScenarioExport);
}

async function importScenario(scenario) {
    try {
        const parsed = importWeaponLabScenario(scenario);
        labState.seed = parsed.seed;
        labState.currentScenarioId = parsed.preset;
        labState.overrideTrackId = parsed.track?.trackId || parsed.mapContext?.trackId || null;
        labState.tuningOverrides = {
            ...labState.tuningOverrides,
            ...(parsed.overrides?.weaponOverrides || {})
        };
        labState.overlay = {
            ...labState.overlay,
            ...(parsed.overlay || {})
        };
        applyDefaultTuningInputs();
        select.value = parsed.preset;
        await ensureScenarioTrack(getSelectedScenario());
        applyCameraState(parsed.camera || getScenarioCamera(getSelectedScenario()));
        const result = await runChecks(parsed.preset, {
            seed: parsed.seed,
            actors: parsed.actors || [],
            arenaConfigPatch: parsed.overrides?.arenaConfigPatch || {},
            weaponOverrides: parsed.overrides?.weaponOverrides || labState.tuningOverrides
        });
        return {
            success: true,
            scenario: exportCurrentScenario(),
            diagnostics: result.diagnostics
        };
    } catch (error) {
        const message = error?.message || 'Scenario import failed';
        recordError(message);
        return { success: false, error: message };
    }
}

function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function renderHostileLabel(payload) {
    const rootId = 'weapon-lab-safe-text-root';
    let root = document.getElementById(rootId);
    if (!root) {
        root = document.createElement('div');
        root.id = rootId;
        root.setAttribute('aria-hidden', 'true');
        root.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(root);
    }

    const element = createSafeTextElement('', 'span', {
        'data-debug-lab-safe-text': 'hostile-label'
    });
    renderSafeText(element, sanitizeDisplayString(payload));
    root.replaceChildren(element);
    return {
        textContent: element.textContent,
        innerHTML: element.innerHTML,
        childElementCount: element.childElementCount
    };
}

const weaponLabApi = {
    get ready() {
        return labState.ready;
    },
    get scenarios() {
        return SCENARIOS.map((scenario) => ({
            id: scenario.id,
            name: scenario.name,
            description: scenario.description,
            trackId: scenario.trackId
        }));
    },
    async run(id, options = {}) {
        return runScenario(id, { seed: Number.isFinite(options.seed) ? options.seed : labState.seed });
    },
    async runAll(options = {}) {
        return runAllScenarios({ seed: Number.isFinite(options.seed) ? options.seed : labState.seed });
    },
    runAndRender: (id) => runChecks(id),
    runAllAndRender: () => runAllChecks(),
    runChecks: (id = labState.currentScenarioId, options = {}) => runChecks(id, options),
    reset: () => resetScenario(),
    stepFrame: () => stepFrame(),
    stepSecond: () => stepSecond(),
    playPause: () => playPause(),
    screenshot: () => screenshotDataUrl(),
    takeScreenshot: () => takeScreenshot(),
    getDiagnostics: () => getDiagnostics(),
    getConsoleLogs: () => getConsoleLogs(),
    exportScenario: () => exportCurrentScenario(),
    importScenario: (scenario) => importScenario(scenario),
    get lastResult() {
        return labState.lastResult;
    },
    get lastResults() {
        return labState.lastResults;
    },
    get lastDiagnostics() {
        return labState.lastDiagnostics;
    },
    get lastScenarioExport() {
        return labState.lastScenarioExport;
    }
};

const debugLabAdapter = {
    reset: () => weaponLabApi.reset(),
    stepFrame: () => weaponLabApi.stepFrame(),
    stepSecond: () => weaponLabApi.stepSecond(),
    playPause: () => weaponLabApi.playPause(),
    takeScreenshot: () => weaponLabApi.takeScreenshot(),
    getDiagnostics: () => weaponLabApi.getDiagnostics(),
    getConsoleLogs: () => weaponLabApi.getConsoleLogs(),
    exportScenario: () => buildDebugLabScenario(),
    importScenario: (scenario) => {
        if (scenario?.schema === DEBUG_LAB_SCENARIO_SCHEMA) {
            const embedded = scenario.customData?.weaponScenario;
            if (!embedded) {
                return { success: false, error: 'Debug-lab scenario missing customData.weaponScenario' };
            }
            return weaponLabApi.importScenario(embedded);
        }
        return weaponLabApi.importScenario(scenario);
    },
    labTools: {
        getCanvasElement: () => renderer.domElement,
        getRenderer: () => renderer,
        getScene: () => scene,
        getState: () => getDiagnostics().state,
        renderHostileLabel
    }
};

function animatePreview() {
    if (labState.playing) {
        labState.previewTick += 1;
        labState.animationTime += 1 / 60;
    }
    pickupMeshes.forEach((mesh, index) => {
        if (!mesh.visible) return;
        mesh.rotation.y += labState.playing ? 0.03 : 0;
        const offset = Math.sin(labState.animationTime * 2 + index) * 0.4;
        mesh.position.y = 2.5 + offset;
    });
    renderer.render(scene, camera);
}

SCENARIOS.forEach((scenario) => {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.name;
    select.appendChild(option);
});
$('count').textContent = String(SCENARIOS.length);
select.value = labState.currentScenarioId;

$('run').addEventListener('click', () => runChecks(select.value).catch((error) => {
    recordError(error.message);
    setSummary(`Error: ${error.message}`, 'bad');
}));
$('runAll').addEventListener('click', () => runAllChecks().catch((error) => {
    recordError(error.message);
    setSummary(`Error: ${error.message}`, 'bad');
}));
$('reset').addEventListener('click', () => resetScenario().catch((error) => {
    recordError(error.message);
    setSummary(`Error: ${error.message}`, 'bad');
}));
$('stepFrame').addEventListener('click', () => stepFrame());
$('stepSecond').addEventListener('click', () => stepSecond());
$('playPause').addEventListener('click', () => playPause());
$('shot').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = screenshotDataUrl();
    link.download = `weapon-lab-${labState.currentScenarioId}.png`;
    link.click();
});
$('export').addEventListener('click', () => {
    downloadJson(`weapon-lab-${labState.currentScenarioId}.json`, exportCurrentScenario());
});
$('import').addEventListener('click', () => fileInputEl.click());
fileInputEl.addEventListener('change', async () => {
    const [file] = fileInputEl.files || [];
    if (!file) return;
    try {
        const payload = JSON.parse(await file.text());
        const result = await importScenario(payload);
        if (!result.success) {
            throw new Error(result.error);
        }
    } catch (error) {
        const message = error?.message || 'Failed to import scenario JSON';
        recordError(message);
        setSummary(`Error: ${message}`, 'bad');
    } finally {
        fileInputEl.value = '';
    }
});
select.addEventListener('change', async () => {
    labState.currentScenarioId = select.value;
    labState.overrideTrackId = null;
    try {
        await resetScenario();
    } catch (error) {
        recordError(error.message);
        setSummary(`Error: ${error.message}`, 'bad');
    }
});

TUNING_FIELDS.forEach(([inputId]) => {
    const input = $(inputId);
    if (!input) return;
    input.addEventListener('change', () => {
        captureTuningOverrides();
    });
});

if (tuningForm) {
    tuningForm.addEventListener('submit', (event) => {
        event.preventDefault();
        captureTuningOverrides();
    });
}

renderer.setAnimationLoop(animatePreview);

window.__weaponLab = weaponLabApi;
DebugLabRegistry.register('weapon-lab', debugLabAdapter);

(async () => {
    try {
        const scenario = getSelectedScenario();
        applyCameraState(getScenarioCamera(scenario));
        applyDefaultTuningInputs();
        await ensureScenarioTrack(scenario);
        await runChecks(scenario.id);
        labState.ready = true;
    } catch (error) {
        const message = error?.message || 'Weapon lab failed to initialise';
        recordError(message);
        setSummary(`Error: ${message}`, 'bad');
        renderDiagnostics(getDiagnostics());
    }
})();
