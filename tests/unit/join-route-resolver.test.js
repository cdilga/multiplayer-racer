import { describe, it, expect } from 'vitest';
import {
    resolveJoinRoute,
    VIA,
    ENTRY_INTENT,
    ENTRY_KIND,
    ROOM_STATUS
} from '../../static/js/engine/joinRouteResolver.js';
import { ROLE, TOPOLOGY, ROLES } from '../../static/js/engine/sessionVocabulary.js';

/**
 * br-captain-call-architecture-hardening-woq.11 (Slice 1) — join-route resolver.
 *
 * Asserts the deterministic route matrix documented in
 * docs/contracts/join-route-matrix.md across every acceptance-listed entry case:
 * host QR, copied Local/Remote/mixed invite, pair QR, reconnect, manual code,
 * invalid/expired/ended room, high-occupancy/capacity-stress, controller-only,
 * second-screen/viewer-with-phone-pair, same-device viewer+controller, and
 * spectator/viewer-only — plus the no-user-agent-only guarantee and determinism.
 */

const open = (extra = {}) => ({ status: ROOM_STATUS.OPEN, topology: TOPOLOGY.LOCAL, ...extra });

describe('join-route resolver — host QR (context-rich)', () => {
    it('routes host-lobby QR straight to controller/HUD only, no chooser, no renderer', () => {
        const d = resolveJoinRoute({ via: VIA.HOST_QR, room: 'WXYZ', roomState: open() });
        expect(d.entryKind).toBe(ENTRY_KIND.HOST_QR_CONTROLLER);
        expect(d.role).toBe(ROLE.CONTROLLER);
        expect(d.startRenderer).toBe(false);
        expect(d.showChooser).toBe(false);
    });
});

describe('join-route resolver — copied/shared invites (context-poor)', () => {
    it('shows the chooser for a copied invite with no intent', () => {
        const d = resolveJoinRoute({ via: VIA.COPIED_INVITE, room: 'WXYZ', roomState: open() });
        expect(d.entryKind).toBe(ENTRY_KIND.COPIED_INVITE_CHOOSER);
        expect(d.showChooser).toBe(true);
        expect(d.role).toBeNull();
        expect(d.startRenderer).toBe(false);
    });

    it('shows the chooser for a hand-typed manual code with no intent', () => {
        const d = resolveJoinRoute({ via: VIA.MANUAL_CODE, room: 'WXYZ', roomState: open() });
        expect(d.entryKind).toBe(ENTRY_KIND.MANUAL_CODE_CHOOSER);
        expect(d.showChooser).toBe(true);
    });

    it('defaults an unknown via to the chooser (safe, never a blind bind)', () => {
        const d = resolveJoinRoute({ via: 'totally-unknown', room: 'WXYZ', roomState: open() });
        expect(d.showChooser).toBe(true);
        expect(d.role).toBeNull();
    });
});

describe('join-route resolver — explicit intent (second-screen / controller / spectator)', () => {
    it('"use this device as my screen" on a remote room => viewer + renderer + pair prompt', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SCREEN,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.REMOTE }),
            capability: { canRenderViewer: true }
        });
        expect(d.entryKind).toBe(ENTRY_KIND.REMOTE_SCREEN_VIEWER);
        expect(d.role).toBe(ROLE.VIEWER);
        expect(d.startRenderer).toBe(true);
        expect(d.pairPrompt).toBe(true); // phone can pair as the controller for this seat
    });

    it('screen intent on a mixed room also renders + pairs', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SCREEN,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.MIXED }),
            capability: { canRenderViewer: true }
        });
        expect(d.role).toBe(ROLE.VIEWER);
        expect(d.startRenderer).toBe(true);
        expect(d.pairPrompt).toBe(true);
    });

    it('screen intent where the device cannot render viewer => degrades, still bound', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SCREEN,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.REMOTE }),
            capability: { canRenderViewer: false }
        });
        expect(d.role).toBe(ROLE.VIEWER);
        expect(d.startRenderer).toBe(false);
        expect(d.degrade).toBe(true);
    });

    it('"I can see the game screen" => controller-only, never starts the renderer', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.CONTROLLER,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.REMOTE })
        });
        expect(d.entryKind).toBe(ENTRY_KIND.CONTROLLER_ONLY);
        expect(d.role).toBe(ROLE.CONTROLLER);
        expect(d.startRenderer).toBe(false);
    });

    it('"watch only" on a remote room => read-only spectator with own view', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SPECTATOR,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.REMOTE }),
            capability: { canRenderViewer: true }
        });
        expect(d.entryKind).toBe(ENTRY_KIND.SPECTATOR);
        expect(d.role).toBe(ROLE.SPECTATOR);
        expect(d.readOnly).toBe(true);
        expect(d.startRenderer).toBe(true);
    });

    it('"watch only" on a local room => spectator watches the big screen, no local render', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SPECTATOR,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.LOCAL })
        });
        expect(d.role).toBe(ROLE.SPECTATOR);
        expect(d.readOnly).toBe(true);
        expect(d.startRenderer).toBe(false);
    });

    it('same-device viewer+controller where supported => controller that renders its own view', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.VIEWER_CONTROLLER,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.REMOTE }),
            capability: { sameDeviceViewerController: true }
        });
        expect(d.entryKind).toBe(ENTRY_KIND.SAME_DEVICE_VIEWER_CONTROLLER);
        expect(d.role).toBe(ROLE.CONTROLLER);
        expect(d.startRenderer).toBe(true);
    });

    it('same-device viewer+controller where NOT supported => falls back to chooser', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.VIEWER_CONTROLLER,
            room: 'WXYZ',
            roomState: open(),
            capability: { sameDeviceViewerController: false }
        });
        expect(d.showChooser).toBe(true);
        expect(d.role).toBeNull();
    });
});

describe('join-route resolver — pair QR', () => {
    it('valid pair QR binds a controller to the existing seat (no new seat)', () => {
        const d = resolveJoinRoute({
            via: VIA.PAIR_QR,
            pairToken: 'pt-123',
            room: 'WXYZ',
            roomState: open({ pairTokenValid: true })
        });
        expect(d.entryKind).toBe(ENTRY_KIND.PAIR_CONTROLLER);
        expect(d.role).toBe(ROLE.CONTROLLER);
        expect(d.bindToExistingSeat).toBe(true);
        expect(d.startRenderer).toBe(false);
    });

    it('invalid/expired pair token => explicit fallback join, never a silent duplicate seat', () => {
        const d = resolveJoinRoute({
            via: VIA.PAIR_QR,
            pairToken: 'pt-expired',
            room: 'WXYZ',
            roomState: open({ pairTokenValid: false })
        });
        expect(d.entryKind).toBe(ENTRY_KIND.PAIR_FALLBACK_JOIN);
        expect(d.bindToExistingSeat).toBe(false);
        expect(d.showChooser).toBe(true);
    });
});

describe('join-route resolver — reconnect', () => {
    it('restores a prior controller role/seat', () => {
        const d = resolveJoinRoute({
            via: VIA.RECONNECT,
            reconnectToken: 'rt-1',
            room: 'WXYZ',
            roomState: open({ priorRole: ROLE.CONTROLLER })
        });
        expect(d.entryKind).toBe(ENTRY_KIND.RECONNECT_RESTORE);
        expect(d.role).toBe(ROLE.CONTROLLER);
        expect(d.startRenderer).toBe(false);
    });

    it('restores a prior viewer role and resumes rendering', () => {
        const d = resolveJoinRoute({
            via: VIA.RECONNECT,
            reconnectToken: 'rt-2',
            room: 'WXYZ',
            roomState: open({ priorRole: ROLE.VIEWER })
        });
        expect(d.role).toBe(ROLE.VIEWER);
        expect(d.startRenderer).toBe(true);
    });

    it('unrestorable role => safe recovery + chooser, never a guessed role', () => {
        const d = resolveJoinRoute({
            via: VIA.RECONNECT,
            reconnectToken: 'rt-3',
            room: 'WXYZ',
            roomState: open({ priorRole: null })
        });
        expect(d.entryKind).toBe(ENTRY_KIND.RECONNECT_UNRESTORABLE);
        expect(d.recovery).toBe(true);
        expect(d.showChooser).toBe(true);
        expect(d.role).toBeNull();
    });
});

describe('join-route resolver — invalid / expired / ended rooms', () => {
    for (const [status, kind] of [
        [ROOM_STATUS.INVALID, ENTRY_KIND.INVALID_ROOM],
        [ROOM_STATUS.EXPIRED, ENTRY_KIND.EXPIRED_ROOM],
        [ROOM_STATUS.ENDED, ENTRY_KIND.ROOM_ENDED],
        [ROOM_STATUS.REVOKED, ENTRY_KIND.REVOKED_ROOM]
    ]) {
        it(`${status} room => recovery, no role, no renderer`, () => {
            const d = resolveJoinRoute({ via: VIA.HOST_QR, room: 'WXYZ', roomState: { status } });
            expect(d.entryKind).toBe(kind);
            expect(d.recovery).toBe(true);
            expect(d.role).toBeNull();
            expect(d.startRenderer).toBe(false);
        });
    }

    it('a dead room beats even a reconnect token (cannot bind into it)', () => {
        const d = resolveJoinRoute({
            via: VIA.RECONNECT,
            reconnectToken: 'rt-x',
            room: 'WXYZ',
            roomState: { status: ROOM_STATUS.ENDED, priorRole: ROLE.CONTROLLER }
        });
        expect(d.entryKind).toBe(ENTRY_KIND.ROOM_ENDED);
        expect(d.recovery).toBe(true);
    });

    it('missing room and no tokens => missing-room recovery', () => {
        const d = resolveJoinRoute({ via: VIA.MANUAL_CODE, room: '', roomState: open() });
        expect(d.entryKind).toBe(ENTRY_KIND.MISSING_ROOM);
        expect(d.recovery).toBe(true);
    });
});

describe('join-route resolver — capacity stress (no arbitrary rejection)', () => {
    it('host QR into a capacity-stressed room still binds a controller, degraded', () => {
        const d = resolveJoinRoute({
            via: VIA.HOST_QR,
            room: 'WXYZ',
            roomState: open({ capacityStressed: true })
        });
        // Still a real bind — NOT a capacity-limit rejection.
        expect(d.role).toBe(ROLE.CONTROLLER);
        expect(d.recovery).toBe(false);
        expect(d.capacityStress).toBe(true);
        expect(d.degrade).toBe(true);
    });

    it('screen intent under capacity stress still binds the viewer with degrade flagged', () => {
        const d = resolveJoinRoute({
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SCREEN,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.REMOTE, capacityStressed: true }),
            capability: { canRenderViewer: true }
        });
        expect(d.role).toBe(ROLE.VIEWER);
        expect(d.capacityStress).toBe(true);
        expect(d.degrade).toBe(true);
        expect(d.recovery).toBe(false);
    });
});

describe('join-route resolver — no user-agent-only + vocabulary + determinism', () => {
    it('never flags a user-agent-only decision, and only emits manifest ROLE values', () => {
        const samples = [
            { via: VIA.HOST_QR, room: 'A', roomState: open() },
            { via: VIA.COPIED_INVITE, intent: ENTRY_INTENT.SCREEN, room: 'A', roomState: open({ topology: TOPOLOGY.REMOTE }), capability: { canRenderViewer: true } },
            { via: VIA.PAIR_QR, pairToken: 'p', room: 'A', roomState: open({ pairTokenValid: true }) },
            { via: VIA.RECONNECT, reconnectToken: 'r', room: 'A', roomState: open({ priorRole: ROLE.VIEWER }) },
            { via: VIA.COPIED_INVITE, intent: ENTRY_INTENT.SPECTATOR, room: 'A', roomState: open() }
        ];
        for (const s of samples) {
            const d = resolveJoinRoute(s);
            expect(d.usedUserAgentOnly).toBe(false);
            if (d.role !== null) expect(ROLES).toContain(d.role);
        }
    });

    it('intent decides role independently of any device/user-agent capability', () => {
        // Same "controller" intent resolves identically regardless of capability object.
        const a = resolveJoinRoute({ via: VIA.COPIED_INVITE, intent: ENTRY_INTENT.CONTROLLER, room: 'A', roomState: open(), capability: { canRenderViewer: true, sameDeviceViewerController: true } });
        const b = resolveJoinRoute({ via: VIA.COPIED_INVITE, intent: ENTRY_INTENT.CONTROLLER, room: 'A', roomState: open(), capability: {} });
        expect(a.role).toBe(ROLE.CONTROLLER);
        expect(b.role).toBe(ROLE.CONTROLLER);
        expect(a.entryKind).toBe(b.entryKind);
    });

    it('is deterministic: identical inputs => identical decision', () => {
        const input = {
            via: VIA.COPIED_INVITE,
            intent: ENTRY_INTENT.SCREEN,
            room: 'WXYZ',
            roomState: open({ topology: TOPOLOGY.MIXED, capacityStressed: true }),
            capability: { canRenderViewer: true }
        };
        expect(JSON.stringify(resolveJoinRoute(input))).toBe(JSON.stringify(resolveJoinRoute(input)));
    });

    it('normalizes case/whitespace in via and intent', () => {
        const d = resolveJoinRoute({ via: '  HOST_QR ', room: 'A', roomState: open() });
        expect(d.entryKind).toBe(ENTRY_KIND.HOST_QR_CONTROLLER);
    });
});
