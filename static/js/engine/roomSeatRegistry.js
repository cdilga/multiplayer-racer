const ACTIVE_PHASES = new Set(['countdown', 'active', 'finish_grace', 'round_end']);
const hasOwn = (payload, key) => Object.prototype.hasOwnProperty.call(payload, key);

function ensureRoom(registry, roomCode, payload = {}) {
    if (!registry.rooms.has(roomCode)) {
        registry.rooms.set(roomCode, {
            roomCode,
            roomAnalyticsId: payload.room_analytics_id || null,
            topology: payload.topology || 'local',
            mode: payload.mode || 'race',
            phase: payload.phase || 'waiting',
            matchId: payload.match_id || null,
            roundId: payload.round_id || null,
            hostEpoch: payload.host_epoch || 1,
            seats: new Map(),
            pendingTakeover: null,
        });
    }
    return registry.rooms.get(roomCode);
}

function ensureSeat(room, payload = {}) {
    const seatId = payload.seat_id ?? payload.player_id;
    if (!room.seats.has(seatId)) {
        room.seats.set(seatId, {
            seatId,
            playerId: payload.player_id ?? seatId,
            playerAnalyticsId: payload.player_analytics_id || null,
            seatToken: payload.seat_token || null,
            leaseVersion: payload.lease_version || 1,
            clientInstanceId: payload.client_instance_id || null,
            role: payload.role || 'controller',
            controllerActive: payload.role !== 'viewer',
            viewerCount: payload.role === 'viewer' ? 1 : 0,
            phase: payload.phase || room.phase,
            lateJoin: !!payload.is_late_join,
        });
    }
    return room.seats.get(seatId);
}

export function createRoomSeatRegistry() {
    return { rooms: new Map() };
}

export function acceptJoin(registry, payload) {
    const room = ensureRoom(registry, payload.room_code, payload);
    room.roomAnalyticsId = payload.room_analytics_id || room.roomAnalyticsId;
    room.topology = payload.topology || room.topology;
    room.mode = payload.mode || room.mode;
    room.phase = payload.phase || room.phase;
    if (hasOwn(payload, 'match_id')) room.matchId = payload.match_id;
    if (hasOwn(payload, 'round_id')) room.roundId = payload.round_id;
    if (hasOwn(payload, 'host_epoch')) room.hostEpoch = payload.host_epoch;

    const seat = ensureSeat(room, payload);
    const viewerOnly = payload.role === 'viewer';
    seat.playerId = payload.player_id ?? seat.playerId;
    seat.playerAnalyticsId = payload.player_analytics_id || seat.playerAnalyticsId;
    seat.seatToken = payload.seat_token || seat.seatToken;
    seat.leaseVersion = payload.lease_version ?? seat.leaseVersion;
    if (!viewerOnly) {
        seat.clientInstanceId = payload.client_instance_id || seat.clientInstanceId;
        seat.role = payload.role || seat.role;
        seat.controllerActive = true;
    }
    seat.viewerCount = viewerOnly ? seat.viewerCount + 1 : seat.viewerCount;
    seat.phase = payload.phase || room.phase;
    seat.lateJoin = !!payload.is_late_join;
    room.pendingTakeover = null;
    return seat;
}

export function noteTakeoverRequired(registry, payload) {
    const room = ensureRoom(registry, payload.room_code, payload);
    room.pendingTakeover = {
        seatId: payload.seat_id,
        playerId: payload.player_id,
        leaseVersion: payload.lease_version,
        phase: payload.phase || room.phase,
    };
    return room.pendingTakeover;
}

export function applyRoomPhase(registry, payload) {
    const room = ensureRoom(registry, payload.room_code, payload);
    room.roomAnalyticsId = payload.room_analytics_id || room.roomAnalyticsId;
    room.phase = payload.phase || room.phase;
    room.mode = payload.mode || room.mode;
    room.topology = payload.topology || room.topology;
    if (hasOwn(payload, 'match_id')) room.matchId = payload.match_id;
    if (hasOwn(payload, 'round_id')) room.roundId = payload.round_id;
    if (hasOwn(payload, 'host_epoch')) room.hostEpoch = payload.host_epoch;

    for (const seat of room.seats.values()) {
        seat.phase = room.phase;
        if (room.phase === 'host_lost') {
            seat.controllerActive = false;
        } else if (ACTIVE_PHASES.has(room.phase) && seat.role !== 'viewer') {
            seat.controllerActive = true;
        }
    }
    return room;
}

export function applySeatTakenOver(registry, payload) {
    const room = ensureRoom(registry, payload.room_code || '', payload);
    const seat = room.seats.get(payload.seat_id);
    if (!seat) {
        return null;
    }
    seat.leaseVersion = payload.lease_version ?? seat.leaseVersion;
    seat.controllerActive = false;
    return seat;
}

export function getRoomSnapshot(registry, roomCode) {
    const room = registry.rooms.get(roomCode);
    if (!room) {
        return null;
    }
    return {
        roomCode: room.roomCode,
        roomAnalyticsId: room.roomAnalyticsId,
        topology: room.topology,
        mode: room.mode,
        phase: room.phase,
        matchId: room.matchId,
        roundId: room.roundId,
        hostEpoch: room.hostEpoch,
        pendingTakeover: room.pendingTakeover ? { ...room.pendingTakeover } : null,
        seats: Array.from(room.seats.values())
            .sort((a, b) => a.seatId - b.seatId)
            .map((seat) => ({
                seatId: seat.seatId,
                playerId: seat.playerId,
                playerAnalyticsId: seat.playerAnalyticsId,
                seatToken: seat.seatToken,
                leaseVersion: seat.leaseVersion,
                clientInstanceId: seat.clientInstanceId,
                role: seat.role,
                controllerActive: seat.controllerActive,
                viewerCount: seat.viewerCount,
                phase: seat.phase,
                lateJoin: seat.lateJoin,
            })),
    };
}
