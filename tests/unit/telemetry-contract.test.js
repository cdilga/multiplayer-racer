import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryService, ALLOWED_EVENT_NAMES, MAX_PROPERTY_VALUE_LENGTH, MAX_PROPERTY_DEPTH } from '../../static/js/telemetry/TelemetryService.js';

describe('telemetry contract - event names', () => {
    it('enforces allowlisted event names', () => {
        const service = new TelemetryService({ enabled: true, release: 'test', role: 'host', source: 'Test' });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');

        expect(() => {
            service.emit('gameplay:match:started');
        }).not.toThrow();

        expect(() => {
            service.emit('invalid:event:name');
        }).toThrow('not allowlisted');
    });

    it('contains all documented product event names', () => {
        const productEvents = [
            'gameplay:match:started',
            'gameplay:match:ended',
            'gameplay:player:joined',
            'gameplay:player:left',
            'gameplay:race:lap_completed',
            'gameplay:race:finished',
            'gameplay:derby:elimination',
            'gameplay:weapon:fired',
            'gameplay:spawn:respawn',
            'error:gameplay:crash',
            'error:network:disconnect',
            'error:network:reconnect'
        ];

        for (const name of productEvents) {
            expect(ALLOWED_EVENT_NAMES.has(name), `${name} should be allowlisted`).toBe(true);
        }
    });

    it('contains all documented server event names', () => {
        const serverEvents = [
            'server:room:created',
            'server:room:closed',
            'server:spawn:validation_failed',
            'error:server:crash'
        ];

        for (const name of serverEvents) {
            expect(ALLOWED_EVENT_NAMES.has(name), `${name} should be allowlisted`).toBe(true);
        }
    });

    it('contains all documented perf event names', () => {
        const perfEvents = [
            'perf:render:frame_sample',
            'perf:physics:step_sample',
            'perf:network:latency_sample',
            'perf:server:request_sample'
        ];

        for (const name of perfEvents) {
            expect(ALLOWED_EVENT_NAMES.has(name), `${name} should be allowlisted`).toBe(true);
        }
    });

    it('rejects per-frame and per-tick event names', () => {
        const service = new TelemetryService({ enabled: true, release: 'test', role: 'host', source: 'Test' });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');

        const forbiddenNames = ['render:frame:tick', 'physics:step:tick', 'update:every:frame'];

        for (const name of forbiddenNames) {
            expect(() => {
                service.emit(name);
            }).toThrow('not allowlisted');
        }
    });
});

describe('telemetry contract - required fields', () => {
    let service;

    beforeEach(() => {
        service = new TelemetryService({
            enabled: true,
            release: 'test-v1',
            role: 'host',
            source: 'GameHost',
            env: 'production'
        });
        service.setRoomAnalyticsId('room-test123');
        service.setMatchId('match-test123');
        service.setPlayerAnalyticsId('player-test123');
    });

    it('includes all required fields in emitted events', () => {
        service.emit('gameplay:match:started', { playerCount: 4 });

        const event = service.queue[0];
        expect(event).toBeDefined();
        expect(event.eventName).toBe('gameplay:match:started');
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('number');
        expect(event.release).toBe('test-v1');
        expect(event.roomAnalyticsId).toBe('room-test123');
        expect(event.matchId).toBe('match-test123');
        expect(event.playerAnalyticsId).toBe('player-test123');
        expect(event.env).toBe('production');
        expect(event.role).toBe('host');
        expect(event.source).toBe('GameHost');
    });

    it('throws on missing correlation IDs', () => {
        const serviceNoId = new TelemetryService({ enabled: true, release: 'test', role: 'host', source: 'Test' });

        expect(() => {
            serviceNoId.emit('gameplay:match:started');
        }).toThrow('roomAnalyticsId');
    });

    it('allows optional gameplay context fields', () => {
        const service2 = new TelemetryService({
            enabled: true,
            release: 'test',
            role: 'host',
            source: 'GameHost'
        });
        service2.setRoomAnalyticsId('room-123');
        service2.setMatchId('match-123');
        service2.setPlayerAnalyticsId('player-123');

        service2.emit('gameplay:match:started', {
            playerCount: 4,
            mode: 'race',
            trackId: 'track-v1',
            mapSeed: 12345
        });

        const event = service2.queue[0];
        expect(event.properties).toEqual({
            playerCount: 4,
            mode: 'race',
            trackId: 'track-v1',
            mapSeed: 12345
        });
    });
});

describe('telemetry contract - property bounds', () => {
    let service;

    beforeEach(() => {
        service = new TelemetryService({
            enabled: true,
            release: 'test',
            role: 'host',
            source: 'Test'
        });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');
    });

    it('rejects string properties exceeding max length', () => {
        const tooLong = 'x'.repeat(MAX_PROPERTY_VALUE_LENGTH + 1);

        expect(() => {
            service.emit('gameplay:match:started', { description: tooLong });
        }).toThrow('exceeds');
    });

    it('accepts properties within bounds', () => {
        const withinBounds = 'x'.repeat(MAX_PROPERTY_VALUE_LENGTH);

        service.emit('gameplay:match:started', { description: withinBounds });
        expect(service.queue.length).toBe(1);
    });

    it('rejects deeply nested properties', () => {
        const deep = {
            level1: {
                level2: {
                    level3: 'too deep'
                }
            }
        };

        expect(() => {
            service.emit('gameplay:match:started', deep);
        }).toThrow('depth');
    });

    it('accepts flat and shallow properties', () => {
        const shallow = {
            level1: {
                level2: 'ok'
            }
        };

        service.emit('gameplay:match:started', shallow);
        expect(service.queue.length).toBe(1);
    });

    it('validates property types', () => {
        expect(() => {
            service.emit('gameplay:match:started', 'not an object');
        }).toThrow('must be an object');
    });
});

describe('telemetry contract - privacy', () => {
    let service;

    beforeEach(() => {
        service = new TelemetryService({
            enabled: true,
            release: 'test',
            role: 'host',
            source: 'Test'
        });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');
    });

    it('rejects raw player display names', () => {
        expect(() => {
            service.emit('gameplay:match:started', { player1: 'Alice', player2: 'Bob' });
        }).toThrow('Privacy violation');
    });

    it('rejects raw IP addresses', () => {
        expect(() => {
            service.emit('server:room:created', { clientIp: '192.168.1.1' });
        }).toThrow('Privacy violation');
    });

    it('rejects tokens and secrets', () => {
        expect(() => {
            service.emit('error:server:crash', { apiToken: 'secret123' });
        }).toThrow('Privacy violation');
    });

    it('rejects socket IDs', () => {
        expect(() => {
            service.emit('gameplay:player:joined', { socket_id: 'abc123xyz' });
        }).toThrow('Privacy violation');
    });

    it('allows anonymous playerAnalyticsId', () => {
        service.emit('gameplay:match:started', { activePlayerId: 'player-123' });
        expect(service.queue.length).toBe(1);
    });

    it('allows roomAnalyticsId in properties for debugging', () => {
        service.emit('server:room:created', { roomId: 'room-123' });
        expect(service.queue.length).toBe(1);
    });
});

describe('telemetry contract - correlation', () => {
    let hostService, controllerService, serverService;

    beforeEach(() => {
        hostService = new TelemetryService({
            enabled: true,
            release: 'abc1234',
            role: 'host',
            source: 'GameHost',
            env: 'production'
        });

        controllerService = new TelemetryService({
            enabled: true,
            release: 'abc1234',
            role: 'controller',
            source: 'Player',
            env: 'production'
        });

        serverService = new TelemetryService({
            enabled: true,
            release: 'abc1234',
            role: 'server',
            source: 'Flask',
            env: 'production'
        });

        const roomId = 'room-xyz789';
        const matchId = 'match-550e8400';
        const playerId = 'player-a7f2c9e1';

        for (const svc of [hostService, controllerService, serverService]) {
            svc.setRoomAnalyticsId(roomId);
            svc.setMatchId(matchId);
            svc.setPlayerAnalyticsId(playerId);
        }
    });

    it('shares release across host, controller, and server', () => {
        hostService.emit('gameplay:match:started', { playerCount: 4 });
        controllerService.emit('error:network:disconnect', { duration_ms: 500 });
        serverService.emit('server:room:created', { mapSeed: 12345 });

        const hostEvent = hostService.queue[0];
        const controllerEvent = controllerService.queue[0];
        const serverEvent = serverService.queue[0];

        expect(hostEvent.release).toBe('abc1234');
        expect(controllerEvent.release).toBe('abc1234');
        expect(serverEvent.release).toBe('abc1234');
    });

    it('shares roomAnalyticsId across all roles', () => {
        hostService.emit('gameplay:match:started', {});
        controllerService.emit('perf:network:latency_sample', { latency_ms: 35 });
        serverService.emit('server:room:created', {});

        const hostEvent = hostService.queue[0];
        const controllerEvent = controllerService.queue[0];
        const serverEvent = serverService.queue[0];

        expect(hostEvent.roomAnalyticsId).toBe('room-xyz789');
        expect(controllerEvent.roomAnalyticsId).toBe('room-xyz789');
        expect(serverEvent.roomAnalyticsId).toBe('room-xyz789');
    });

    it('shares matchId across all roles', () => {
        hostService.emit('gameplay:race:finished', { position: 1 });
        controllerService.emit('gameplay:weapon:fired', { weaponType: 'missile' });
        serverService.emit('error:server:crash', { code: 'ENOENT' });

        const hostEvent = hostService.queue[0];
        const controllerEvent = controllerService.queue[0];
        const serverEvent = serverService.queue[0];

        expect(hostEvent.matchId).toBe('match-550e8400');
        expect(controllerEvent.matchId).toBe('match-550e8400');
        expect(serverEvent.matchId).toBe('match-550e8400');
    });

    it('uses anonymous playerAnalyticsId instead of display names', () => {
        hostService.emit('gameplay:match:started', {});
        controllerService.emit('gameplay:weapon:fired', {});
        serverService.emit('server:room:created', {});

        const hostEvent = hostService.queue[0];
        const controllerEvent = controllerService.queue[0];
        const serverEvent = serverService.queue[0];

        expect(hostEvent.playerAnalyticsId).toBe('player-a7f2c9e1');
        expect(controllerEvent.playerAnalyticsId).toBe('player-a7f2c9e1');
        expect(serverEvent.playerAnalyticsId).toBe('player-a7f2c9e1');

        expect(hostEvent.properties).not.toHaveProperty('displayName');
        expect(controllerEvent.properties).not.toHaveProperty('displayName');
        expect(serverEvent.properties).not.toHaveProperty('displayName');
    });
});

describe('telemetry contract - no-op disabled', () => {
    it('does not emit or queue when disabled', () => {
        const service = new TelemetryService({ enabled: false });

        service.emit('gameplay:match:started', { playerCount: 4 });
        expect(service.getQueueSize()).toBe(0);
    });

    it('returns correct queue size', () => {
        const service = new TelemetryService({ enabled: true, release: 'test', role: 'host', source: 'Test' });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');

        expect(service.getQueueSize()).toBe(0);
        service.emit('gameplay:match:started', {});
        expect(service.getQueueSize()).toBe(1);
        service.emit('gameplay:player:joined', {});
        expect(service.getQueueSize()).toBe(2);
    });

    it('allows clearing the queue', () => {
        const service = new TelemetryService({ enabled: true, release: 'test', role: 'host', source: 'Test' });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');

        service.emit('gameplay:match:started', {});
        expect(service.getQueueSize()).toBe(1);
        service.clear();
        expect(service.getQueueSize()).toBe(0);
    });
});

describe('telemetry contract - debug mode', () => {
    it('logs events to console when debug enabled', () => {
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));

        const service = new TelemetryService({
            enabled: true,
            debug: true,
            release: 'test',
            role: 'host',
            source: 'Test'
        });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');

        service.emit('gameplay:match:started', { playerCount: 4 });

        expect(logs.some((log) => log.includes('[TELEMETRY]'))).toBe(true);
        expect(logs.some((log) => log.includes('gameplay:match:started'))).toBe(true);

        console.log = originalLog;
    });

    it('includes telemetry marker in debug output', () => {
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));

        const service = new TelemetryService({
            enabled: true,
            debug: true,
            release: 'test',
            role: 'host',
            source: 'Test'
        });
        service.setRoomAnalyticsId('room-123');
        service.setMatchId('match-123');
        service.setPlayerAnalyticsId('player-123');

        service.emit('gameplay:match:started', {});

        const telemetryLog = logs.find((log) => log.includes('[TELEMETRY]'));
        expect(telemetryLog).toBeDefined();

        console.log = originalLog;
    });
});

describe('telemetry contract - sample events', () => {
    it('produces valid host match-started event', () => {
        const service = new TelemetryService({
            enabled: true,
            release: 'abc1234',
            role: 'host',
            source: 'GameHost',
            env: 'production'
        });
        service.setRoomAnalyticsId('room-xyz789');
        service.setMatchId('550e8400-e29b-41d4-a716-446655440000');
        service.setPlayerAnalyticsId('a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1');

        service.emit('gameplay:match:started', {
            playerCount: 4,
            mode: 'race'
        });

        const event = service.queue[0];
        expect(event.eventName).toBe('gameplay:match:started');
        expect(event.role).toBe('host');
        expect(event.properties.playerCount).toBe(4);
        expect(event.properties.mode).toBe('race');
    });

    it('produces valid controller error event', () => {
        const service = new TelemetryService({
            enabled: true,
            release: 'abc1234',
            role: 'controller',
            source: 'Player',
            env: 'production',
            deviceClass: 'mobile',
            browserFamily: 'Chrome'
        });
        service.setRoomAnalyticsId('room-xyz789');
        service.setMatchId('550e8400-e29b-41d4-a716-446655440000');
        service.setPlayerAnalyticsId('a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1');

        service.emit('error:network:disconnect', {
            duration_ms: 5000
        });

        const event = service.queue[0];
        expect(event.eventName).toBe('error:network:disconnect');
        expect(event.role).toBe('controller');
        expect(event.properties.duration_ms).toBe(5000);
    });

    it('produces valid perf sample event', () => {
        const service = new TelemetryService({
            enabled: true,
            release: 'abc1234',
            role: 'host',
            source: 'GameHost'
        });
        service.setRoomAnalyticsId('room-xyz789');
        service.setMatchId('550e8400-e29b-41d4-a716-446655440000');
        service.setPlayerAnalyticsId('a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1');

        service.emit('perf:render:frame_sample', {
            fps: 58,
            drawCalls: 120
        });

        const event = service.queue[0];
        expect(event.eventName).toBe('perf:render:frame_sample');
        expect(event.properties.fps).toBe(58);
        expect(event.properties.drawCalls).toBe(120);
    });
});
