import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VehicleIdentityOverlay } from '../../static/js/ui/VehicleIdentityOverlay.js';
import { RaceUI } from '../../static/js/ui/RaceUI.js';
import { DerbySystem } from '../../static/js/systems/DerbySystem.js';

/**
 * br-skip-bin-arcade-design-language-5k3.14 — P2.4 "Leader marker + danger styling".
 *
 * Acceptance proven here (unit level; screenshot/diagnostic proof lives in the
 * evidence artifact):
 *  1. Leader marker is unmistakable: the host-only VehicleIdentityOverlay tags
 *     the race leader (racePosition === 1) with the `is-leader` state, and the
 *     stylesheet gives that state a distinct gold crown treatment.
 *  2. Shrinking-arena wall pulses DANGER red: DerbySystem defaults the wall
 *     warning colour to #FF2E2E (loud DANGER red) and the emissive intensity
 *     oscillates while shrinking.
 *  3. Low-health pulse: RaceUI's segmented bar animates the lit segments of a
 *     `tier-low` player.
 *
 * The overlay stays host-only — this drives the exact same host `update()` path
 * the GameHost uses, with no controller/player role involved.
 */

// ---- minimal fake DOM ------------------------------------------------------

function makeClassList() {
    const set = new Set();
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c, on) => {
            const want = on === undefined ? !set.has(c) : !!on;
            if (want) set.add(c); else set.delete(c);
            return want;
        }
    };
}

function makeEl(tag = 'div') {
    const children = [];
    const el = {
        tagName: tag,
        _tag: tag,
        className: '',
        id: '',
        textContent: '',
        dataset: {},
        style: {
            _props: {},
            setProperty(k, v) { this._props[k] = v; }
        },
        classList: makeClassList(),
        children,
        appendChild(c) { children.push(c); return c; },
        remove() {},
        getBoundingClientRect() {
            return { left: 0, top: 0, right: 60, bottom: 40, width: 60, height: 40 };
        }
    };
    return el;
}

function makeDocument() {
    const byId = new Map();
    const head = makeEl('head');
    return {
        head,
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => byId.get(id) || null,
        querySelector: (sel) => byId.get(sel) || null,
        _register(el) { if (el.id) byId.set(el.id, el); }
    };
}

// Fake THREE.Vector3 that projects a vehicle's mesh.matrixWorld.ndcX to NDC so
// two markers land far enough apart to both survive de-overlap.
class FakeVector3 {
    constructor() { this.x = 0; this.y = 0; this.z = 0; }
    setFromMatrixPosition(m) { this.x = (m && m.ndcX) || 0; this.y = 0; this.z = 0; return this; }
    project() { return this; }
}

function makeVehicle(playerId, ndcX, racePosition) {
    return {
        playerId,
        playerName: `P${playerId}`,
        color: '#12abef',
        racePosition,
        mesh: {
            visible: true,
            matrixWorld: { ndcX },
            position: { x: 0, y: 0, z: 0 }
        }
    };
}

function installGlobals(doc) {
    const styleEls = [];
    // patch head.appendChild to register style ids for getElementById/querySelector
    doc.head.appendChild = (c) => { styleEls.push(c); doc._register(c); return c; };
    global.document = doc;
    global.window = {
        innerWidth: 1280,
        innerHeight: 720,
        THREE: { Vector3: FakeVector3 },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    };
    return styleEls;
}

// ---------------------------------------------------------------------------

describe('5k3.14 leader marker + danger styling', () => {
    let savedDocument, savedWindow;
    beforeEach(() => {
        savedDocument = global.document;
        savedWindow = global.window;
    });
    afterEach(() => {
        global.document = savedDocument;
        global.window = savedWindow;
    });

    describe('leader marker (host-only VehicleIdentityOverlay)', () => {
        function buildOverlay() {
            const doc = makeDocument();
            const styleEls = installGlobals(doc);

            const overlayContainer = makeEl('div');
            const camera = { position: { distanceTo: () => 40 } };
            const renderSystem = {
                camera,
                overlayContainer,
                getCameraFocusTarget: () => null,
                getCameraModeInfo: () => ({ mode: 'party' }),
                nameTags: null
            };
            const eventBus = { on: () => () => {} };
            const vehicles = new Map();
            vehicles.set('1', makeVehicle('1', -0.5, 1));  // leader
            vehicles.set('2', makeVehicle('2', 0.5, 2));   // chaser
            const gameHost = { eventBus, vehicles, systems: { render: renderSystem } };

            const overlay = new VehicleIdentityOverlay({
                gameHost, eventBus, renderSystem, overlayContainer
            });
            return { overlay, styleEls };
        }

        it('flags racePosition===1 as the leader and no one else', () => {
            const { overlay } = buildOverlay();
            expect(overlay.init()).toBe(true);

            const snap = overlay.getDebugSnapshot();
            const leader = snap.markers.find((m) => m.playerId === '1');
            const chaser = snap.markers.find((m) => m.playerId === '2');

            expect(leader).toBeTruthy();
            expect(chaser).toBeTruthy();
            expect(leader.leader).toBe(true);
            expect(chaser.leader).toBe(false);
        });

        it('injects an unmistakable gold-crown leader style', () => {
            const { overlay, styleEls } = buildOverlay();
            overlay.init();
            const css = styleEls.map((s) => s.textContent).join('\n');

            expect(css).toContain('.vehicle-id-marker.is-leader');
            // crown glyph (👑, U+1F451) makes the leader read at a glance
            expect(css).toContain('\\1F451');
            expect(css.toUpperCase()).toContain('#FFD23E');
        });

        it('also honours an explicit vehicle.isLeader for non-race modes', () => {
            const doc = makeDocument();
            installGlobals(doc);
            const overlayContainer = makeEl('div');
            const renderSystem = {
                camera: { position: { distanceTo: () => 40 } },
                overlayContainer,
                getCameraFocusTarget: () => null,
                getCameraModeInfo: () => ({ mode: 'party' }),
                nameTags: null
            };
            const eventBus = { on: () => () => {} };
            const v = makeVehicle('9', 0, undefined);
            v.isLeader = true;
            const vehicles = new Map([['9', v]]);
            const gameHost = { eventBus, vehicles, systems: { render: renderSystem } };
            const overlay = new VehicleIdentityOverlay({ gameHost, eventBus, renderSystem, overlayContainer });
            overlay.init();

            const snap = overlay.getDebugSnapshot();
            expect(snap.markers.find((m) => m.playerId === '9').leader).toBe(true);
        });
    });

    describe('shrinking-arena wall DANGER pulse (DerbySystem)', () => {
        function makeMaterial() {
            return { emissiveIntensity: 0, emissive: { value: null, setHex(h) { this.value = h; } } };
        }
        function makeGroupWall(n = 3) {
            const children = [];
            for (let i = 0; i < n; i++) children.push({ isMesh: true, material: makeMaterial() });
            return {
                scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
                material: undefined,
                traverse(fn) { fn(this); for (const c of children) fn(c); },
                _children: children
            };
        }
        function makeDerby() {
            const derby = new DerbySystem({ eventBus: { emit() {} } });
            derby.setArenaConfig({
                geometry: { diameter: 80 },
                derby: { shrinking: { enabled: true, startTime: 0, rate: 10, minDiameter: 40 } }
                // note: no warningColor -> must fall back to DANGER default
            });
            derby.shrinkStartTime = 0;
            return derby;
        }

        it('defaults the wall warning colour to DANGER red #FF2E2E', () => {
            const derby = makeDerby();
            expect(derby.warningColor).toBe('#FF2E2E');
            expect(derby._warningColorHex()).toBe(0xFF2E2E);
        });

        it('glows every child mesh DANGER red while shrinking', () => {
            const derby = makeDerby();
            const wall = makeGroupWall(3);
            derby.setWallMesh(wall);
            derby.shrinkingActive = true;
            derby.currentDiameter = 60;
            derby._updateWallVisuals();
            for (const child of wall._children) {
                expect(child.material.emissive.value).toBe(0xFF2E2E);
                expect(child.material.emissiveIntensity).toBeGreaterThan(0);
            }
        });

        it('pulses the wall (emissive intensity oscillates with the clock)', () => {
            const derby = makeDerby();
            const wall = makeGroupWall(1);
            derby.setWallMesh(wall);
            derby.shrinkingActive = true;
            derby.currentDiameter = 60;

            const mat = wall._children[0].material;
            let now = 0;
            derby._nowMs = () => now;

            now = 0;      derby._updateWallVisuals(); const a = mat.emissiveIntensity;
            now = 100;    derby._updateWallVisuals(); const b = mat.emissiveIntensity;
            now = 300;    derby._updateWallVisuals(); const c = mat.emissiveIntensity;

            // sin-driven: the three samples are not all identical (it throbs).
            expect(a === b && b === c).toBe(false);
        });
    });

    describe('low-health pulse (RaceUI)', () => {
        it('animates the lit segments of a tier-low player', () => {
            const doc = makeDocument();
            const styleEls = [];
            doc.head.appendChild = (c) => { styleEls.push(c); doc._register(c); return c; };
            global.document = doc;

            // _addStyles() only touches document; call it in isolation.
            RaceUI.prototype._addStyles.call({});
            const css = styleEls.map((s) => s.textContent).join('\n');

            expect(css).toContain('.tier-low');
            expect(css).toContain('--health-color: #FF3B3B');
            expect(css).toContain('.health-bar-item.tier-low .health-seg.is-lit');
            expect(css).toContain('@keyframes health-low-pulse');
            expect(css).toContain('animation: health-low-pulse');
        });
    });
});
