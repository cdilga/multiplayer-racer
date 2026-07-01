"""Room -> Seat -> Binding registry helpers for Socket.IO room lifecycle.

This module keeps the authoritative room/seat/binding state in plain dicts so
``server.app`` can adopt it incrementally without breaking the existing tests'
direct inspection of ``game_rooms``.
"""

from __future__ import annotations

import hashlib
import secrets
import time
import uuid

try:
    from session_vocabulary import (
        DEFAULT_RULESET,
        DEFAULT_TOPOLOGY,
        ROLE_CONTROLLER,
        ROLE_HOST,
        ROLE_SPECTATOR,
        ROLE_VIEWER,
        normalize_topology,
        participant_roles,
        primary_role,
    )
except ImportError:  # pragma: no cover - import path shim
    from server.session_vocabulary import (
        DEFAULT_RULESET,
        DEFAULT_TOPOLOGY,
        ROLE_CONTROLLER,
        ROLE_HOST,
        ROLE_SPECTATOR,
        ROLE_VIEWER,
        normalize_topology,
        participant_roles,
        primary_role,
    )


PHASE_WAITING = 'waiting'
PHASE_COUNTDOWN = 'countdown'
PHASE_ACTIVE = 'active'
PHASE_FINISH_GRACE = 'finish_grace'
PHASE_ROUND_END = 'round_end'
PHASE_RESULTS = 'results'
PHASE_HOST_LOST = 'host_lost'
PHASE_CLOSED = 'closed'

ROOM_PHASES = frozenset({
    PHASE_WAITING,
    PHASE_COUNTDOWN,
    PHASE_ACTIVE,
    PHASE_FINISH_GRACE,
    PHASE_ROUND_END,
    PHASE_RESULTS,
    PHASE_HOST_LOST,
    PHASE_CLOSED,
})

ACTIVE_ROOM_PHASES = frozenset({
    PHASE_COUNTDOWN,
    PHASE_ACTIVE,
    PHASE_FINISH_GRACE,
    PHASE_ROUND_END,
})

SEAT_STATE_ACTIVE = 'active'
SEAT_STATE_AWAY = 'away'
SEAT_STATE_WAITING_NEXT_ROUND = 'waiting_next_round'
SEAT_STATE_SPECTATOR = 'spectator'
SEAT_STATE_ELIMINATED = 'eliminated'
SEAT_STATE_FINISHED = 'finished'
SEAT_STATE_DNF = 'dnf'

HOST_LOSS_GRACE_SECONDS = 30.0
ROOM_TTL_SECONDS = 300.0
STALE_CONTROLLER_SECONDS = 12.0


def now_seconds(now=None):
    return time.time() if now is None else float(now)


def _hash_token(token):
    if not token:
        return None
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


def generate_seat_token():
    return secrets.token_urlsafe(24)


def generate_match_id():
    return f'match-{uuid.uuid4().hex[:12]}'


def generate_round_id(round_number=1):
    return f'round-{round_number}'


def phase_to_game_state(phase):
    if phase in ACTIVE_ROOM_PHASES:
        return 'racing'
    if phase in (PHASE_RESULTS, PHASE_CLOSED):
        return 'finished'
    return 'waiting'


def mask_secret(value):
    if value in (None, ''):
        return None
    return '[redacted]'


def _default_stats():
    return {
        'position': [0, 0.5, 0],
        'rotation': [0, 0, 0],
        'velocity': [0, 0, 0],
        'controls': {
            'steering': 0,
            'acceleration': 0,
            'braking': 0,
        },
    }


def _new_seat(room, seat_id, player_name, can_render=False, viewer_only=False, client_instance_id=None, seat_token=None, joined_at=None):
    joined_at = now_seconds(joined_at)
    car_color = f"#{secrets.randbelow(0x1000000):06x}"
    roles = [ROLE_VIEWER] if viewer_only else participant_roles(room['topology'], can_render=can_render)
    primary = ROLE_VIEWER if viewer_only else primary_role(room['topology'], can_render=can_render)
    seat_state = SEAT_STATE_SPECTATOR if viewer_only else SEAT_STATE_ACTIVE
    raw_seat_token = seat_token or generate_seat_token()

    return {
        'seat_id': seat_id,
        'player_id': seat_id,
        'seat_token_hash': _hash_token(raw_seat_token),
        'appearance': {
            'name': player_name,
            'color': car_color,
            'number': None,
            'vehicleId': None,
            'skinId': None,
        },
        'controller_sid': None if viewer_only else None,
        'viewer_sids': [],
        'state': seat_state,
        'lease_version': 1,
        'client_instance_id': client_instance_id,
        'roles': roles,
        'role': primary,
        'joined_match_id': room.get('match_id'),
        'joined_round_id': room.get('round_id'),
        'last_seen_at': joined_at,
        'disconnected_at': None,
        'stats': _default_stats(),
    }, raw_seat_token


def _zero_controls(seat):
    seat['stats']['controls'] = {
        'steering': 0,
        'acceleration': 0,
        'braking': 0,
    }


def _find_seat_by_token(room, seat_token):
    if not seat_token:
        return None

    seat_token_hash = _hash_token(seat_token)
    for seat in room['seats'].values():
        if seat.get('seat_token_hash') == seat_token_hash:
            return seat
    return None


def lookup_seat_by_id(room, seat_id):
    if seat_id is None:
        return None
    try:
        return room['seats'].get(int(seat_id))
    except (TypeError, ValueError):
        return None


def lookup_binding_by_sid(room, sid):
    if not sid:
        return None
    binding = room.get('sid_index', {}).get(sid)
    if not binding:
        return None
    seat = lookup_seat_by_id(room, binding.get('seat_id'))
    return {
        'binding': binding,
        'seat': seat,
    }


def _seat_payload(room, seat):
    return {
        'id': seat['player_id'],
        'seat_id': seat['seat_id'],
        'name': seat['appearance']['name'],
        'car_color': seat['appearance']['color'],
        'position': seat['stats']['position'],
        'rotation': seat['stats']['rotation'],
        'velocity': seat['stats']['velocity'],
        'lease_version': seat['lease_version'],
        'controller_connected': bool(seat.get('controller_sid')),
    }


def _sync_legacy_views(room):
    room['players'] = {}
    room['disconnected_players'] = {}

    for seat in room['seats'].values():
        player_payload = {
            'id': seat['player_id'],
            'name': seat['appearance']['name'],
            'car_color': seat['appearance']['color'],
            'position': seat['stats']['position'],
            'rotation': seat['stats']['rotation'],
            'velocity': seat['stats']['velocity'],
            'controls': dict(seat['stats']['controls']),
            'lease_version': seat['lease_version'],
            'client_instance_id': seat['client_instance_id'],
        }
        if seat.get('controller_sid'):
            room['players'][seat['controller_sid']] = player_payload
        elif seat.get('state') == SEAT_STATE_AWAY:
            room['disconnected_players'][seat['player_id']] = {
                **player_payload,
                'disconnect_time': seat.get('disconnected_at'),
            }


def _touch_room(room, when=None):
    room['last_activity_at'] = now_seconds(when)


def redacted_room_snapshot(room, reason=None, when=None):
    when = now_seconds(when)
    return {
        'timestamp': when,
        'reason': reason,
        'roomCode': room.get('room_code'),
        'topology': room.get('topology'),
        'ruleset': room.get('mode', DEFAULT_RULESET),
        'phase': room.get('phase', PHASE_WAITING),
        'matchId': room.get('match_id'),
        'roundId': room.get('round_id'),
        'host': {
            'epoch': room.get('host_epoch'),
            'connected': room.get('host_sid') is not None,
            'tokenHash': mask_secret(room.get('host_token_hash')),
            'lostAt': room.get('host_lost_at'),
        },
        'seats': [
            {
                'seatId': seat['seat_id'],
                'playerId': seat['player_id'],
                'state': seat['state'],
                'leaseVersion': seat['lease_version'],
                'clientInstanceId': seat['client_instance_id'],
                'seatTokenHash': mask_secret(seat.get('seat_token_hash')),
                'appearance': {
                    'name': seat['appearance'].get('name'),
                    'color': seat['appearance'].get('color'),
                },
                'roleBindings': {
                    'controller': bool(seat.get('controller_sid')),
                    'viewers': len(seat.get('viewer_sids', [])),
                },
                'joinedMatchId': seat.get('joined_match_id'),
                'joinedRoundId': seat.get('joined_round_id'),
            }
            for seat in sorted(room.get('seats', {}).values(), key=lambda entry: entry['seat_id'])
        ],
    }


def append_room_trace(room, reason, when=None):
    room.setdefault('trace', []).append(redacted_room_snapshot(room, reason=reason, when=when))


def new_room_state(room_code, host_sid, host_token, topology=DEFAULT_TOPOLOGY, now=None):
    created_at = now_seconds(now)
    room = {
        'room_code': room_code,
        'host_sid': host_sid,
        'host_token': host_token,
        'host_token_hash': _hash_token(host_token),
        'host_epoch': 1,
        'host_lost_at': None,
        'phase_before_host_loss': PHASE_WAITING,
        'topology': normalize_topology(topology),
        'mode': DEFAULT_RULESET,
        'phase': PHASE_WAITING,
        'game_state': phase_to_game_state(PHASE_WAITING),
        'match_id': None,
        'round_id': None,
        'round_number': 0,
        'seats': {},
        'sid_index': {
            host_sid: {
                'seat_id': None,
                'role': ROLE_HOST,
                'binding': 'host',
            }
        },
        'pending_takeovers': {},
        'last_snapshot': None,
        'created_at': created_at,
        'last_activity_at': created_at,
        'reap_at': None,
        'next_player_id': 1,
        'players': {},
        'disconnected_players': {},
        'trace': [],
    }
    append_room_trace(room, 'room_created', created_at)
    return room


def set_room_phase(room, phase, when=None):
    room['phase'] = phase if phase in ROOM_PHASES else PHASE_WAITING
    room['game_state'] = phase_to_game_state(room['phase'])
    _touch_room(room, when)
    append_room_trace(room, f'phase:{room["phase"]}', when)


def begin_room_match(room, when=None):
    room['round_number'] = int(room.get('round_number', 0)) + 1
    room['match_id'] = generate_match_id()
    room['round_id'] = generate_round_id(room['round_number'])
    set_room_phase(room, PHASE_ACTIVE, when)


def end_room_match(room, when=None):
    set_room_phase(room, PHASE_RESULTS, when)


def return_room_to_lobby(room, when=None):
    room['round_id'] = None
    room['match_id'] = None
    room['round_number'] = 0
    for seat in room['seats'].values():
        if seat['state'] in (SEAT_STATE_WAITING_NEXT_ROUND, SEAT_STATE_FINISHED, SEAT_STATE_DNF):
            seat['state'] = SEAT_STATE_ACTIVE
    set_room_phase(room, PHASE_WAITING, when)
    _sync_legacy_views(room)


def _bind_viewer_sid(room, seat, sid):
    if sid not in seat['viewer_sids']:
        seat['viewer_sids'].append(sid)
    room['sid_index'][sid] = {
        'seat_id': seat['seat_id'],
        'role': ROLE_VIEWER,
        'binding': 'viewer',
    }


def _unbind_sid(room, sid):
    binding = room.get('sid_index', {}).pop(sid, None)
    if not binding:
        return

    seat = lookup_seat_by_id(room, binding.get('seat_id'))
    if not seat:
        return

    if binding.get('binding') == 'controller' and seat.get('controller_sid') == sid:
        seat['controller_sid'] = None
    if sid in seat.get('viewer_sids', []):
        seat['viewer_sids'] = [viewer_sid for viewer_sid in seat['viewer_sids'] if viewer_sid != sid]


def _bind_controller(room, seat, sid, client_instance_id, can_render=False, when=None):
    now = now_seconds(when)
    seat['controller_sid'] = sid
    seat['client_instance_id'] = client_instance_id
    seat['state'] = SEAT_STATE_ACTIVE
    seat['last_seen_at'] = now
    seat['disconnected_at'] = None
    seat['roles'] = participant_roles(room['topology'], can_render=can_render)
    seat['role'] = primary_role(room['topology'], can_render=can_render)
    room['sid_index'][sid] = {
        'seat_id': seat['seat_id'],
        'role': ROLE_CONTROLLER,
        'binding': 'controller',
    }
    if ROLE_VIEWER in seat['roles']:
        _bind_viewer_sid(room, seat, sid)


def join_seat(
    room,
    sid,
    *,
    player_name,
    seat_token=None,
    reconnect_id=None,
    client_instance_id=None,
    can_render=False,
    viewer_only=False,
    force_takeover=False,
    now=None,
):
    current_time = now_seconds(now)
    _touch_room(room, current_time)

    seat = _find_seat_by_token(room, seat_token)
    if seat is None and reconnect_id is not None:
        seat = lookup_seat_by_id(room, reconnect_id)

    existing = seat is not None
    seat_token_value = seat_token
    stale_sid = None
    takeover_kind = None

    if seat is None:
        seat_id = room['next_player_id']
        room['next_player_id'] = seat_id + 1
        seat, created_token = _new_seat(
            room,
            seat_id,
            player_name,
            can_render=can_render,
            viewer_only=viewer_only,
            client_instance_id=client_instance_id,
            joined_at=current_time,
        )
        room['seats'][seat_id] = seat
        seat_token_value = created_token
    else:
        if not seat_token_value:
            seat_token_value = generate_seat_token()
            seat['seat_token_hash'] = _hash_token(seat_token_value)
        if not viewer_only:
            seat['appearance']['name'] = player_name or seat['appearance']['name']

    active_controller_sid = seat.get('controller_sid')
    active_client_instance = seat.get('client_instance_id')
    is_reconnecting = existing and active_controller_sid is None and not viewer_only

    if viewer_only:
        _bind_viewer_sid(room, seat, sid)
        seat['last_seen_at'] = current_time
    elif active_controller_sid and active_controller_sid != sid:
        same_instance = bool(client_instance_id) and client_instance_id == active_client_instance
        stale_controller = seat.get('last_seen_at') is None or (
            current_time - float(seat['last_seen_at']) > STALE_CONTROLLER_SECONDS
        )
        if force_takeover or same_instance or stale_controller:
            stale_sid = active_controller_sid
            takeover_kind = 'confirmed' if force_takeover else ('same_instance' if same_instance else 'stale_heartbeat')
            _unbind_sid(room, active_controller_sid)
            seat['lease_version'] = int(seat.get('lease_version', 1)) + 1
            _bind_controller(room, seat, sid, client_instance_id, can_render=can_render, when=current_time)
        else:
            room['pending_takeovers'][sid] = {
                'seat_id': seat['seat_id'],
                'player_name': player_name,
                'client_instance_id': client_instance_id,
                'can_render': can_render,
                'requested_at': current_time,
            }
            append_room_trace(room, 'takeover_prompted', current_time)
            return {
                'status': 'takeover_required',
                'payload': {
                    'player_id': seat['player_id'],
                    'seat_id': seat['seat_id'],
                    'player_name': seat['appearance']['name'],
                    'lease_version': seat['lease_version'],
                    'phase': room['phase'],
                },
            }
    else:
        _bind_controller(room, seat, sid, client_instance_id, can_render=can_render, when=current_time)

    if not viewer_only:
        _zero_controls(seat)

    if room['phase'] == PHASE_RESULTS and seat['state'] == SEAT_STATE_ACTIVE:
        seat['state'] = SEAT_STATE_WAITING_NEXT_ROUND
    if room['phase'] == PHASE_HOST_LOST and seat['state'] == SEAT_STATE_ACTIVE:
        seat['state'] = SEAT_STATE_AWAY if viewer_only else SEAT_STATE_ACTIVE

    _sync_legacy_views(room)
    append_room_trace(room, 'seat_joined' if not existing else 'seat_rebound', current_time)

    is_late_join = room['phase'] in ACTIVE_ROOM_PHASES and not is_reconnecting
    join_payload = {
        'player_id': seat['player_id'],
        'seat_id': seat['seat_id'],
        'seat_token': seat_token_value,
        'lease_version': seat['lease_version'],
        'client_instance_id': client_instance_id,
        'name': seat['appearance']['name'],
        'car_color': seat['appearance']['color'],
        'reconnected': is_reconnecting or takeover_kind is not None,
        'is_late_join': is_late_join,
        'game_state': room['game_state'],
        'phase': room['phase'],
        'mode': room.get('mode', DEFAULT_RULESET),
        'topology': room['topology'],
        'role': ROLE_VIEWER if viewer_only else seat['role'],
        'roles': [ROLE_VIEWER] if viewer_only else list(seat['roles']),
        'takeover_kind': takeover_kind,
    }

    lifecycle_event_name = 'player_reconnected' if existing else 'player_joined'
    lifecycle_payload = _seat_payload(room, seat)

    return {
        'status': 'joined',
        'seat': seat,
        'join_payload': join_payload,
        'lifecycle_event_name': lifecycle_event_name,
        'lifecycle_payload': lifecycle_payload,
        'old_controller_sid': stale_sid,
        'takeover_kind': takeover_kind,
    }


def confirm_pending_takeover(room, sid, *, seat_token=None, client_instance_id=None, now=None):
    pending = room.get('pending_takeovers', {}).pop(sid, None)
    if not pending:
        return {'status': 'missing'}

    seat = lookup_seat_by_id(room, pending['seat_id'])
    if seat is None:
        return {'status': 'missing'}

    return join_seat(
        room,
        sid,
        player_name=pending['player_name'],
        seat_token=seat_token,
        reconnect_id=seat['seat_id'],
        client_instance_id=client_instance_id or pending.get('client_instance_id'),
        can_render=pending.get('can_render', False),
        force_takeover=True,
        now=now,
    )


def touch_controller(room, sid, lease_version=None, client_instance_id=None, now=None):
    current_time = now_seconds(now)
    binding = lookup_binding_by_sid(room, sid)
    if not binding:
        return False

    seat = binding['seat']
    if seat is None or binding['binding'].get('binding') != 'controller':
        return False

    if lease_version is not None:
        try:
            if int(lease_version) != int(seat['lease_version']):
                return False
        except (TypeError, ValueError):
            return False
    if client_instance_id is not None and seat.get('client_instance_id') not in (None, client_instance_id):
        return False

    seat['last_seen_at'] = current_time
    seat['disconnected_at'] = None
    _touch_room(room, current_time)
    _sync_legacy_views(room)
    return True


def update_seat_controls(room, sid, controls, lease_version=None, client_instance_id=None, now=None):
    if room['phase'] in (PHASE_HOST_LOST, PHASE_CLOSED):
        return None

    if not touch_controller(room, sid, lease_version=lease_version, client_instance_id=client_instance_id, now=now):
        return None

    binding = lookup_binding_by_sid(room, sid)
    seat = binding['seat']
    seat['stats']['controls'] = {
        'steering': controls.get('steering', 0),
        'acceleration': controls.get('acceleration', 0),
        'braking': controls.get('braking', 0),
    }
    _sync_legacy_views(room)
    return seat


def update_seat_motion(room, sid, position, rotation, velocity, now=None):
    if room['phase'] not in ACTIVE_ROOM_PHASES:
        return None

    if not touch_controller(room, sid, now=now):
        return None

    binding = lookup_binding_by_sid(room, sid)
    seat = binding['seat']
    seat['stats']['position'] = position
    seat['stats']['rotation'] = rotation
    seat['stats']['velocity'] = velocity
    _sync_legacy_views(room)
    return seat


def update_seat_name(room, sid, new_name, now=None):
    binding = lookup_binding_by_sid(room, sid)
    if not binding or not binding['seat'] or binding['binding'].get('binding') != 'controller':
        return None

    seat = binding['seat']
    seat['appearance']['name'] = new_name
    touch_controller(room, sid, now=now)
    _sync_legacy_views(room)
    append_room_trace(room, 'seat_renamed', now)
    return seat


def mark_host_lost(room, sid, now=None):
    if room.get('host_sid') != sid:
        return False

    current_time = now_seconds(now)
    room['phase_before_host_loss'] = room.get('phase', PHASE_WAITING)
    room['host_sid'] = None
    room['host_lost_at'] = current_time
    room['reap_at'] = None
    room['sid_index'].pop(sid, None)
    room['phase'] = PHASE_HOST_LOST
    room['game_state'] = phase_to_game_state(PHASE_WAITING)
    _touch_room(room, current_time)
    append_room_trace(room, 'host_lost', current_time)
    return True


def reclaim_host(room, sid, host_token, now=None):
    current_time = now_seconds(now)
    if not room.get('host_token') or room['host_token'] != host_token:
        return False

    was_host_lost = room.get('phase') == PHASE_HOST_LOST
    room['host_sid'] = sid
    room['host_epoch'] = int(room.get('host_epoch', 1)) + 1
    room['host_lost_at'] = None
    room['reap_at'] = None
    room['sid_index'][sid] = {
        'seat_id': None,
        'role': ROLE_HOST,
        'binding': 'host',
    }
    if was_host_lost:
        room['phase'] = room.get('phase_before_host_loss') or PHASE_WAITING
        room['game_state'] = phase_to_game_state(room['phase'])
    _touch_room(room, current_time)
    append_room_trace(room, 'host_reclaimed', current_time)
    return True


def disconnect_binding(room, sid, now=None):
    current_time = now_seconds(now)
    binding = room.get('sid_index', {}).get(sid)
    if not binding:
        return {'status': 'missing'}

    if binding.get('binding') == 'host':
        mark_host_lost(room, sid, current_time)
        return {'status': 'host_lost'}

    seat = lookup_seat_by_id(room, binding.get('seat_id'))
    if seat is None:
        room['sid_index'].pop(sid, None)
        return {'status': 'missing'}

    if binding.get('binding') == 'controller':
        seat['controller_sid'] = None
        seat['state'] = SEAT_STATE_AWAY
        seat['disconnected_at'] = current_time
        _zero_controls(seat)
    if sid in seat.get('viewer_sids', []):
        seat['viewer_sids'] = [viewer_sid for viewer_sid in seat['viewer_sids'] if viewer_sid != sid]

    room['sid_index'].pop(sid, None)
    _sync_legacy_views(room)
    _touch_room(room, current_time)
    append_room_trace(room, 'seat_disconnected', current_time)
    return {
        'status': 'seat_away',
        'seat': seat,
    }


def reap_room_if_needed(room, now=None, host_loss_grace=HOST_LOSS_GRACE_SECONDS, room_ttl=ROOM_TTL_SECONDS):
    current_time = now_seconds(now)
    if room['phase'] == PHASE_HOST_LOST and room.get('host_lost_at') is not None:
        if current_time - room['host_lost_at'] >= float(host_loss_grace):
            room['phase'] = PHASE_RESULTS if room.get('phase_before_host_loss') in ACTIVE_ROOM_PHASES else PHASE_WAITING
            room['game_state'] = phase_to_game_state(room['phase'])
            room['host_lost_at'] = None
            room['reap_at'] = current_time + float(room_ttl)
            append_room_trace(room, 'host_loss_resolved', current_time)
            return 'resolved'

    if room.get('reap_at') is not None and current_time >= float(room['reap_at']):
        room['phase'] = PHASE_CLOSED
        room['game_state'] = phase_to_game_state(PHASE_CLOSED)
        append_room_trace(room, 'room_closed', current_time)
        return 'delete'

    return 'keep'


def reap_rooms(game_rooms, now=None, host_loss_grace=HOST_LOSS_GRACE_SECONDS, room_ttl=ROOM_TTL_SECONDS):
    current_time = now_seconds(now)
    removed = []
    for room_code, room in list(game_rooms.items()):
        result = reap_room_if_needed(room, current_time, host_loss_grace=host_loss_grace, room_ttl=room_ttl)
        if result == 'delete':
            removed.append(room_code)
            del game_rooms[room_code]
    return removed


__all__ = [
    'ACTIVE_ROOM_PHASES',
    'HOST_LOSS_GRACE_SECONDS',
    'PHASE_ACTIVE',
    'PHASE_CLOSED',
    'PHASE_COUNTDOWN',
    'PHASE_FINISH_GRACE',
    'PHASE_HOST_LOST',
    'PHASE_RESULTS',
    'PHASE_ROUND_END',
    'PHASE_WAITING',
    'ROOM_TTL_SECONDS',
    'SEAT_STATE_ACTIVE',
    'SEAT_STATE_AWAY',
    'SEAT_STATE_DNF',
    'SEAT_STATE_ELIMINATED',
    'SEAT_STATE_FINISHED',
    'SEAT_STATE_SPECTATOR',
    'SEAT_STATE_WAITING_NEXT_ROUND',
    'STALE_CONTROLLER_SECONDS',
    'append_room_trace',
    'begin_room_match',
    'confirm_pending_takeover',
    'disconnect_binding',
    'end_room_match',
    'generate_match_id',
    'generate_round_id',
    'generate_seat_token',
    'join_seat',
    'lookup_binding_by_sid',
    'lookup_seat_by_id',
    'mark_host_lost',
    'new_room_state',
    'phase_to_game_state',
    'reap_room_if_needed',
    'reap_rooms',
    'reclaim_host',
    'redacted_room_snapshot',
    'return_room_to_lobby',
    'set_room_phase',
    'touch_controller',
    'update_seat_controls',
    'update_seat_motion',
    'update_seat_name',
]
