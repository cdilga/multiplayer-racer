import { afterEach, describe, expect, it } from 'vitest';
import { GameHost } from '../../static/js/GameHost.js';
import { LobbyUI } from '../../static/js/ui/LobbyUI.js';

const originalDocument = globalThis.document;

afterEach(() => {
    globalThis.document = originalDocument;
});

function makeHostHarness() {
    const events = [];
    const host = Object.create(GameHost.prototype);
    host.vehicles = new Map();
    host.lobbyWorld = { enabled: true, lastUpdateAt: 0, banter: [] };
    host.eventBus = {
        emit: (event, data) => events.push({ event, data })
    };
    host.engine = { getState: () => 'lobby' };
    return { host, events };
}

function makeVehicle(id, name = `Player ${id}`) {
    return {
        id,
        playerId: id,
        playerName: name,
        color: '#2EE8FF',
        controls: { steering: 1, acceleration: 1, braking: 0 },
        position: { x: id * 2, y: 1.5, z: 0 },
        spawnPosition: { x: id * 2, y: 1.5, z: 0, rotation: 0 },
        mesh: {
            visible: true,
            position: { x: id * 2, y: 1.5, z: 0 },
            rotation: { y: 0 },
            userData: {}
        },
        wheelMeshes: [
            { rotation: { x: 0 } }
        ]
    };
}

function makeStyle() {
    return {
        values: {},
        setProperty(name, value) {
            this.values[name] = value;
        }
    };
}

function makeElement(tagName = 'div') {
    return {
        tagName: tagName.toUpperCase(),
        children: [],
        className: '',
        textContent: '',
        innerHTML: '',
        style: makeStyle(),
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            return child;
        },
        replaceChildren(...children) {
            this.children = children;
            children.forEach((child) => {
                child.parentNode = this;
            });
        }
    };
}

function installFakeDocument() {
    globalThis.document = {
        createElement: (tagName) => makeElement(tagName),
        body: makeElement('body')
    };
}

describe('GameHost lobby-as-world diagnostics', () => {
    it('marks joined lobby vehicles as visible idle world cars without applying race controls', () => {
        const { host } = makeHostHarness();
        const vehicle = makeVehicle(1, 'Mika');
        host.vehicles.set(1, vehicle);

        host._prepareLobbyWorldVehicle(vehicle);
        host._updateLobbyWorld(1 / 60, 2);

        expect(vehicle.controls).toEqual({ steering: 0, acceleration: 0, braking: 0 });
        expect(vehicle.mesh.visible).toBe(true);
        expect(vehicle.mesh.userData.lobbyWorld).toBe(true);
        expect(vehicle.wheelMeshes[0].rotation.x).toBeGreaterThan(0);

        const diagnostics = host.getLobbyWorldDiagnostics();
        expect(diagnostics.state).toBe('lobby');
        expect(diagnostics.vehicleCount).toBe(1);
        expect(diagnostics.visibleVehicleCount).toBe(1);
        expect(diagnostics.vehicles[0]).toMatchObject({
            playerId: 1,
            name: 'Mika',
            visible: true,
            lobbyWorld: true,
            hasMesh: true
        });
    });

    it('records short join/leave banter for the lobby rail', () => {
        const { host, events } = makeHostHarness();

        host._recordLobbyBanter({ id: 1, name: 'Ari', color: '#FF2E88' });
        host._recordLobbyBanter({ id: 2, name: 'Bo', color: '#2EE8FF' });
        host._recordLobbyBanter({ id: 1, name: 'Ari', color: '#FF2E88', action: 'left' });

        expect(host.lobbyWorld.banter.map((entry) => entry.line)).toEqual([
            'Ari rolled into the yard',
            'Bo rolled into the yard',
            'Ari rolled out'
        ]);
        expect(events.every((entry) => entry.event === 'lobby:worldBanter')).toBe(true);
    });
});

describe('LobbyUI lobby-as-world safe text rendering', () => {
    it('renders player names and banter as literal text with guarded colors', () => {
        installFakeDocument();
        const playerList = makeElement('ul');
        const playerCount = makeElement('span');
        const lobbyBanter = makeElement('div');
        const ui = Object.create(LobbyUI.prototype);
        const hostile = '<img src=x onerror=alert(1)>';

        ui.players = [
            {
                id: 'p1',
                name: hostile,
                color: 'red; background: url(javascript:alert(1))'
            }
        ];
        ui.elements = { playerList, playerCount, lobbyBanter };

        ui._updatePlayerList();
        ui._updateBanter([
            {
                line: `${hostile} rolled into the yard`,
                color: 'var(--vehicle-accent); background: red'
            }
        ]);

        const playerRow = playerList.children[0];
        const playerColor = playerRow.children[0];
        const playerName = playerRow.children[1];
        const banterLine = lobbyBanter.children[0];

        expect(playerCount.textContent).toBe('1');
        expect(playerColor.style.background).toBe('#888');
        expect(playerName.textContent).toBe(hostile);
        expect(playerName.children).toHaveLength(0);
        expect(banterLine.textContent).toBe(`${hostile} rolled into the yard`);
        expect(banterLine.children).toHaveLength(0);
        expect(banterLine.style.values['--banter-color']).toBe('#ffffff');
    });
});
