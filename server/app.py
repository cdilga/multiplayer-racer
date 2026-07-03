from flask import Flask, render_template, request, jsonify, send_file, send_from_directory, g, make_response
from flask_socketio import SocketIO, emit, join_room, leave_room
from functools import wraps
import os
import random
import string
import json
import logging
import socket
import qrcode
import io
from PIL import Image
import platform
import subprocess
import re
import hmac
import hashlib
import time

# Shared session vocabulary (topology / ruleset / role). Dual-import so the
# module resolves both when run directly (`python server/app.py`, where
# server/ is on sys.path) and when imported as a package (`server.app`, as the
# tests do).
try:
    from input_safety import (
        validate_finite_controls, canonicalize_name, validate_appearance,
        resolve_weapon_id, RateLimiter,
    )
    from session_vocabulary import (
        DEFAULT_TOPOLOGY, normalize_topology,
        DEFAULT_RULESET, RULESETS, participant_roles, primary_role,
    )
    from room_seats import (
        ACTIVE_ROOM_PHASES,
        HOST_LOSS_GRACE_SECONDS,
        PHASE_ACTIVE,
        PHASE_HOST_LOST,
        PHASE_RESULTS,
        PHASE_WAITING,
        ROOM_TTL_SECONDS,
        append_room_trace,
        begin_room_match,
        confirm_pending_takeover,
        disconnect_binding,
        end_room_match,
        join_seat,
        lookup_binding_by_sid,
        lookup_seat_by_id,
        mark_host_lost,
        new_room_state,
        phase_to_game_state,
        reap_rooms,
        reclaim_host,
        redacted_room_snapshot,
        return_room_to_lobby,
        touch_controller,
        update_seat_controls,
        update_seat_motion,
        update_seat_name,
    )
    from telemetry import ServerTelemetry
except ImportError:  # pragma: no cover - import path shim
    from server.input_safety import (
        validate_finite_controls, canonicalize_name, validate_appearance,
        resolve_weapon_id, RateLimiter,
    )
    from server.session_vocabulary import (
        DEFAULT_TOPOLOGY, normalize_topology,
        DEFAULT_RULESET, RULESETS, participant_roles, primary_role,
    )
    from server.room_seats import (
        ACTIVE_ROOM_PHASES,
        HOST_LOSS_GRACE_SECONDS,
        PHASE_ACTIVE,
        PHASE_HOST_LOST,
        PHASE_RESULTS,
        PHASE_WAITING,
        ROOM_TTL_SECONDS,
        append_room_trace,
        begin_room_match,
        confirm_pending_takeover,
        disconnect_binding,
        end_room_match,
        join_seat,
        lookup_binding_by_sid,
        lookup_seat_by_id,
        mark_host_lost,
        new_room_state,
        phase_to_game_state,
        reap_rooms,
        reclaim_host,
        redacted_room_snapshot,
        return_room_to_lobby,
        touch_controller,
        update_seat_controls,
        update_seat_motion,
        update_seat_name,
    )
    from server.telemetry import ServerTelemetry

# Central bug-report store (woq.4). The public request path only sanitizes +
# appends; it never imports or invokes the maintainer drainer (triage.py).
try:
    from report_store import (
        sanitize_report, validate_report, is_honeypot, append_report,
        MAX_TOTAL_PAYLOAD_BYTES,
    )
except ImportError:  # pragma: no cover - package import path shim
    from server.report_store import (
        sanitize_report, validate_report, is_honeypot, append_report,
        MAX_TOTAL_PAYLOAD_BYTES,
    )

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check if dist/ exists (production build from Vite)
dist_path = os.path.join(os.path.dirname(__file__), '..', 'dist')
if os.path.exists(dist_path):
    # Production: serve from Vite build output
    # Vite's publicDir copies static/ contents to dist/ root
    logger.info('Production mode: Serving from dist/')
    app = Flask(__name__,
                static_folder='../dist',
                static_url_path='/static',
                template_folder='../dist/frontend')
else:
    # Development: serve from source (when using Vite dev server)
    logger.info('Development mode: Serving from source')
    app = Flask(__name__,
                static_folder='../static',
                template_folder='../frontend')

app.config['SECRET_KEY'] = 'race_game_secret!'
# Configure SocketIO - keep defaults for stability during long-polling
# Shorter intervals caused "transport error" disconnects
socketio = SocketIO(app, cors_allowed_origins="*")

# Serve Vite bundled assets in production mode
if os.path.exists(dist_path):
    @app.route('/assets/<path:filename>')
    def serve_assets(filename):
        """Serve Vite bundled assets from dist/assets/.

        These filenames are content-hashed by Vite, so any change to a file
        produces a new name. That makes them safe to cache forever - a rebuild
        (including a local dev rebuild) invalidates them automatically because
        the URL changes.
        """
        response = send_from_directory(os.path.join(dist_path, 'assets'), filename)
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response

    @app.route('/host-assets.json')
    def host_assets_manifest():
        """Critical-path host bundles, so the landing page can prefetch them
        while the visitor reads - making "Host Now" start almost instantly.

        Hash-adaptive: parses the built host HTML for its /assets references
        and adds the dynamically-imported GameHost chunk (which isn't listed
        in the HTML). Cheap to compute and never stale because it reflects the
        current build on disk.
        """
        refs = set()
        host_html = os.path.join(dist_path, 'frontend', 'host', 'index.html')
        try:
            with open(host_html, 'r', encoding='utf-8') as f:
                refs.update(re.findall(r'/assets/[A-Za-z0-9_.\-]+\.(?:js|css)', f.read()))
        except OSError:
            pass
        try:
            for fn in os.listdir(os.path.join(dist_path, 'assets')):
                if fn.startswith('GameHost-') and fn.endswith('.js'):
                    refs.add('/assets/' + fn)
        except OSError:
            pass
        response = jsonify({'assets': sorted(refs)})
        response.headers['Cache-Control'] = 'no-cache'
        return response

    @app.after_request
    def set_cache_headers(response):
        """Keep caching correct across rebuilds (critical on a local dev box):
        - hashed /assets/* -> immutable (set in serve_assets above)
        - HTML documents    -> no-cache, so a new build's hashes are picked up
        - other /static/*   -> revalidate via ETag (cheap 304s), never stale
        """
        if 'Cache-Control' in response.headers:
            return response
        content_type = response.headers.get('Content-Type', '')
        if content_type.startswith('text/html') or request.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'no-cache'
        return response


# --- Build identity / deploy versioning (woq.3) -----------------------------
# The server advertises the exact build it is serving so a browser still running
# an older bundle can detect the skew after a redeploy and prompt a reload. The
# identity is written by the Vite build into dist/version.json; env vars and a
# 'dev' fallback keep the endpoint working in source/dev mode.
_BUILD_IDENTITY_CACHE = None
# mtime of dist/version.json when the cache was populated (None = no manifest was
# readable, e.g. dev/source mode). The cache is invalidated when this changes.
_BUILD_IDENTITY_MTIME = None


def _read_build_identity():
    """Resolve {buildId, buildSha, buildTime} for the running server.

    Precedence: dist/version.json (the built bundle's identity) -> explicit env
    -> 'dev' fallback.

    The result is cached, but the cache is invalidated whenever dist/version.json
    changes on disk (tracked by mtime). A long-lived/self-hosted Flask process
    that is rebuilt IN PLACE (without a restart) - exactly what the stale-client
    E2E does, and what an `npm run build` against a running dev server does - must
    advertise the NEW build at /version, otherwise a freshly built (matching)
    client is wrongly flagged stale. Steady-state calls still avoid re-reading the
    file because the mtime is unchanged.
    """
    global _BUILD_IDENTITY_CACHE, _BUILD_IDENTITY_MTIME

    version_path = os.path.join(dist_path, 'version.json')
    try:
        mtime = os.path.getmtime(version_path)
    except OSError:
        mtime = None  # no built manifest -> dev/source mode

    # Serve the cache only while the manifest on disk is unchanged.
    if _BUILD_IDENTITY_CACHE is not None and mtime == _BUILD_IDENTITY_MTIME:
        return _BUILD_IDENTITY_CACHE

    identity = {'buildId': 'dev', 'buildSha': 'unknown', 'buildTime': 'dev'}
    manifest_loaded = False
    if mtime is not None:
        try:
            with open(version_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for key in ('buildId', 'buildSha', 'buildTime'):
                value = data.get(key)
                if isinstance(value, str) and value:
                    identity[key] = value
            manifest_loaded = True
        except (OSError, ValueError):
            manifest_loaded = False

    if not manifest_loaded:
        # No readable built manifest (dev/source mode) - fall back to env then
        # defaults. Track mtime as None so a later real build is picked up.
        mtime = None
        identity['buildId'] = os.environ.get('BUILD_ID', identity['buildId'])
        identity['buildSha'] = os.environ.get('BUILD_SHA', identity['buildSha'])
        identity['buildTime'] = os.environ.get('BUILD_TIME', identity['buildTime'])

    _BUILD_IDENTITY_CACHE = identity
    _BUILD_IDENTITY_MTIME = mtime
    return identity


def _build_release(identity=None):
    """Canonical release string for telemetry/socket correlation.

    Reuses the woq.3 build identity contract: prefer the full buildSha when a
    real built manifest is present, otherwise fall back to buildId so dev/source
    mode still has a stable, non-empty release string.
    """
    identity = identity or _read_build_identity()
    build_sha = str(identity.get('buildSha') or '')
    if build_sha and build_sha not in ('unknown', 'dev'):
        return build_sha
    return str(identity.get('buildId') or 'unknown')


def _build_identity_payload():
    identity = _read_build_identity()
    return {
        'build_id': identity.get('buildId'),
        'build_sha': identity.get('buildSha'),
        'build_time': identity.get('buildTime'),
        'release': _build_release(identity),
    }


def _room_correlation_payload(room):
    return {
        'room_analytics_id': room.get('room_analytics_id'),
        'match_id': room.get('match_id'),
        'round_id': room.get('round_id'),
    }


def _with_server_metadata(payload, room=None):
    enriched = dict(payload or {})
    if room is not None:
        enriched.update(_room_correlation_payload(room))
    enriched.update(_build_identity_payload())
    return enriched


server_telemetry = ServerTelemetry(
    release=_build_release(),
    env=os.environ.get('TELEMETRY_ENV') or os.environ.get('FLASK_ENV') or os.environ.get('ENV') or 'local',
)


def _telemetry_room(room_code):
    if not room_code:
        return None
    return game_rooms.get(str(room_code).upper())


def _telemetry_player_analytics_id(room, *, sid=None, seat=None):
    if seat is not None:
        return seat.get('player_analytics_id')
    if room is None:
        return None
    binding = lookup_binding_by_sid(room, sid or request.sid)
    if not binding or not binding.get('seat'):
        return None
    return binding['seat'].get('player_analytics_id')


def _telemetry_sensitive_values(data=None):
    values = []
    if isinstance(data, dict):
        for key in ('room_code', 'player_name', 'seat_token', 'host_token', 'join_url', 'name'):
            value = data.get(key)
            if value not in (None, ''):
                values.append(value)
    remote_addr = getattr(request, 'remote_addr', None)
    if remote_addr:
        values.append(remote_addr)
    sid = getattr(request, 'sid', None)
    if sid:
        values.append(sid)
    return tuple(values)


def _safe_error_fingerprint(value):
    text = str(value or '').strip()
    if re.fullmatch(r'[A-Za-z0-9_.:-]{6,96}', text):
        return text[:96]
    return None


def _telemetry_request_context():
    payload = request.get_json(silent=True)
    payload_keys = sorted(payload.keys()) if isinstance(payload, dict) else []
    return {
        'method': request.method,
        'path': request.path,
        'query_keys': sorted(request.args.keys()),
        'payload_keys': payload_keys,
        'content_type': request.content_type,
        'remote_addr': request.remote_addr,
    }


def _telemetry_socket_context(data=None):
    payload_keys = sorted(data.keys()) if isinstance(data, dict) else []
    return {
        'method': 'SOCKET',
        'path': None,
        'namespace': getattr(request, 'namespace', '/'),
        'query_keys': [],
        'payload_keys': payload_keys,
        'content_type': 'application/json',
        'remote_addr': getattr(request, 'remote_addr', None) or request.environ.get('REMOTE_ADDR'),
        'sensitive_values': _telemetry_sensitive_values(data),
    }


def _telemetry_event(event_name, handler, *, room=None, room_analytics_id=None, match_id=None,
                     player_analytics_id=None, properties=None, source='SocketIO',
                     sensitive_values=None):
    return server_telemetry.emit(
        event_name,
        handler=handler,
        room=room,
        room_analytics_id=room_analytics_id,
        match_id=match_id,
        player_analytics_id=player_analytics_id,
        source=source,
        properties=properties,
        sensitive_values=sensitive_values,
    )


def _telemetry_validation_failure(handler, bucket, *, room=None, room_analytics_id=None,
                                  match_id=None, player_analytics_id=None, source='SocketIO',
                                  emit_event=True, sensitive_values=None):
    return server_telemetry.record_validation_failure(
        handler=handler,
        bucket=bucket,
        room=room,
        room_analytics_id=room_analytics_id,
        match_id=match_id,
        player_analytics_id=player_analytics_id,
        source=source,
        emit_event=emit_event,
        sensitive_values=sensitive_values,
    )


def _emit_error_message(channel, message, *, handler, bucket, room=None, room_analytics_id=None,
                        match_id=None, player_analytics_id=None, source='SocketIO',
                        emit_validation_event=True, sensitive_values=None):
    _telemetry_validation_failure(
        handler,
        bucket,
        room=room,
        room_analytics_id=room_analytics_id,
        match_id=match_id,
        player_analytics_id=player_analytics_id,
        source=source,
        emit_event=emit_validation_event,
        sensitive_values=sensitive_values,
    )
    emit(channel, {'message': message})


def _emit_join_error_message(message, *, handler, bucket, room=None, room_analytics_id=None,
                             match_id=None, player_analytics_id=None, sensitive_values=None):
    _telemetry_event(
        'server:player:join_failed',
        handler,
        room=room,
        room_analytics_id=room_analytics_id,
        match_id=match_id,
        player_analytics_id=player_analytics_id,
        source='SocketIO',
        properties={'bucket': bucket},
        sensitive_values=sensitive_values,
    )
    _telemetry_validation_failure(
        handler,
        bucket,
        room=room,
        room_analytics_id=room_analytics_id,
        match_id=match_id,
        player_analytics_id=player_analytics_id,
        source='SocketIO',
        emit_event=False,
        sensitive_values=sensitive_values,
    )
    emit('join_error', {'message': message})


def _instrument_socket_handler(handler_name):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            started_at = time.perf_counter()
            data = args[0] if args else None
            succeeded = False
            try:
                result = fn(*args, **kwargs)
                succeeded = True
                return result
            except Exception as exc:
                room = _telemetry_room((data or {}).get('room_code') if isinstance(data, dict) else None)
                server_telemetry.record_socket_handler(handler_name, 'exception', time.perf_counter() - started_at)
                server_telemetry.record_exception(
                    exc,
                    handler=handler_name,
                    kind='socket',
                    room=room,
                    player_analytics_id=_telemetry_player_analytics_id(room),
                    source='SocketIO',
                    context=_telemetry_socket_context(data),
                )
                raise
            finally:
                if succeeded:
                    server_telemetry.record_socket_handler(handler_name, 'ok', time.perf_counter() - started_at)
        return wrapped
    return decorator


@app.route('/version')
def version_manifest():
    """Stable version endpoint for client/server build-skew detection.

    Always no-cache so a redeployed server immediately answers with the new
    build id; an old client compares it against its baked-in build id and shows
    a reload prompt instead of silently sending stale-contract payloads.
    """
    response = jsonify({'manifest': 'jj-build-version', **_read_build_identity()})
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response


@app.before_request
def _telemetry_before_request():
    g.telemetry_started_at = time.perf_counter()
    g.telemetry_request_recorded = False


@app.after_request
def _telemetry_after_request(response):
    started_at = getattr(g, 'telemetry_started_at', None)
    if started_at is not None and not getattr(g, 'telemetry_request_recorded', False):
        server_telemetry.record_request(
            request.endpoint or request.path or 'unknown',
            response.status_code,
            time.perf_counter() - started_at,
        )
        g.telemetry_request_recorded = True
    return response


@app.teardown_request
def _telemetry_teardown_request(exc):
    if exc is None:
        return None
    if request.path.startswith('/socket.io'):
        return None

    payload = request.get_json(silent=True)
    room_code = None
    if isinstance(payload, dict):
        room_code = payload.get('room_code')
    if room_code is None and request.view_args:
        room_code = request.view_args.get('room_code')
    room = _telemetry_room(room_code)
    server_telemetry.record_exception(
        exc,
        handler=request.endpoint or request.path or 'unknown',
        kind='http',
        room=room,
        player_analytics_id=_telemetry_player_analytics_id(room),
        source='Flask',
        context={
            **_telemetry_request_context(),
            'sensitive_values': _telemetry_sensitive_values(payload) + tuple(request.args.values()) + tuple((request.view_args or {}).values()),
        },
    )

    started_at = getattr(g, 'telemetry_started_at', None)
    if started_at is not None and not getattr(g, 'telemetry_request_recorded', False):
        server_telemetry.record_request(
            request.endpoint or request.path or 'unknown',
            getattr(exc, 'code', 500),
            time.perf_counter() - started_at,
        )
        g.telemetry_request_recorded = True
    return None


# Game rooms dictionary
# Structure: {
#   'room_code': {
#     'host_sid': host_session_id,
#     'topology': 'local'|'remote'|'mixed',  # ROOM topology, fixed at creation
#     'mode': 'race'|'derby',                 # RULESET (legacy key name)
#     'players': {
#       player_sid: {
#         'id': player_id,
#         'name': player_name,
#         'car_color': car_color,
#         'position': [x, y, z],
#         'rotation': [x, y, z],
#         'velocity': [x, y, z]
#       }
#     },
#     'game_state': 'waiting'|'racing'|'finished',
#     'disconnected_players': {
#       player_id: {
#         'name': player_name,
#         'car_color': car_color,
#         'position': [x, y, z],
#         'rotation': [x, y, z],
#         'velocity': [x, y, z],
#         'disconnect_time': timestamp
#       }
#     }
#   }
# }
game_rooms = {}

# Abuse controls (3xv.4): per-seat cooldowns for spammable actions. Keyed by
# "<room>:<seat_id>" so one seat cannot flood the host with fire/reset/name
# events. Intervals are generous enough for normal play, tight enough to stop
# floods. Deterministic clock injection is used by the tests.
_fire_rate_limiter = RateLimiter(0.1)     # <= 10 fire intents/sec per seat
_reset_rate_limiter = RateLimiter(1.0)    # <= 1 car-reset/sec per seat
_name_rate_limiter = RateLimiter(2.0)     # <= 1 name change / 2s per seat


def _reap_rooms_if_needed():
    prior_rooms = {room_code: room for room_code, room in game_rooms.items()}
    removed = reap_rooms(
        game_rooms,
        host_loss_grace=HOST_LOSS_GRACE_SECONDS,
        room_ttl=ROOM_TTL_SECONDS,
    )
    for room_code in removed:
        room = prior_rooms.get(room_code)
        if room is not None:
            _telemetry_event(
                'server:room:closed',
                'reap_rooms',
                room=room,
                source='Flask',
                properties={
                    'reason': 'ttl_expired',
                    'playerCount': len(room.get('seats', {})),
                    'duration_ms': int(max((time.time() - room.get('created_at', time.time())) * 1000, 0)),
                },
            )
        logger.info(f"Room {room_code} reaped after TTL expiry")


def _generate_host_token():
    """Generate a signed host capability token."""
    timestamp = str(int(time.time()))
    nonce = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
    message = f"{timestamp}:{nonce}".encode()
    secret = app.config['SECRET_KEY'].encode()
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return f"{timestamp}:{nonce}:{signature}"


def _verify_host_token(token, max_age_seconds=3600):
    """Verify a host capability token and return True if valid."""
    if not token or not isinstance(token, str):
        return False

    parts = token.split(':')
    if len(parts) != 3:
        return False

    timestamp_str, nonce, signature = parts
    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return False

    # Check token age (default 1 hour)
    if time.time() - timestamp > max_age_seconds:
        return False

    # Verify signature
    message = f"{timestamp_str}:{nonce}".encode()
    secret = app.config['SECRET_KEY'].encode()
    expected_sig = hmac.new(secret, message, hashlib.sha256).hexdigest()

    return hmac.compare_digest(signature, expected_sig)


def _check_host_authority(room_code, host_token, host_epoch):
    """Validate host authority for a world-state mutation.

    Returns (is_valid, error_message). Only returns True if:
    - Socket is the current host
    - Token matches the stored token (not expired)
    - Epoch matches (rejects stale events from old reclaim)
    """
    if room_code not in game_rooms:
        return False, 'Room not found'

    room = game_rooms[room_code]
    current_sid = request.sid
    stored_token = room.get('host_token')
    stored_epoch = room.get('host_epoch')

    # Socket is not the current host
    if room.get('host_sid') != current_sid:
        return False, 'Not the current host'

    # Token or epoch missing/mismatched
    if not stored_token or not host_token:
        return False, 'Invalid host token'

    if not hmac.compare_digest(host_token, stored_token):
        return False, 'Host token mismatch (may have been rotated)'

    if host_epoch is None or host_epoch != stored_epoch:
        return False, 'Stale host epoch (room may have been reclaimed)'

    return True, None


def _new_room_state(room_code, host_sid, topology=DEFAULT_TOPOLOGY):
    """Build a fresh room-state dict with an explicit, validated topology.

    Topology is the room's distribution axis (local/remote/mixed) and is kept
    separate from the ruleset (race/derby, stored under the legacy ``mode``
    key). Unknown topology values coerce to the default so the Local path can
    never be broken by a bad client hint.
    """
    return new_room_state(
        room_code,
        host_sid,
        _generate_host_token(),
        topology=topology,
    )


def _room_phase_payload(room_code):
    room = game_rooms[room_code]
    return _with_server_metadata({
        'room_code': room_code,
        'phase': room.get('phase', PHASE_WAITING),
        'game_state': room.get('game_state', phase_to_game_state(PHASE_WAITING)),
        'mode': room.get('mode', DEFAULT_RULESET),
        'topology': room.get('topology', DEFAULT_TOPOLOGY),
        'host_epoch': room.get('host_epoch'),
    }, room)


def _emit_room_phase(room_code, *, include_self=True):
    if room_code not in game_rooms:
        return
    emit('room_phase', _room_phase_payload(room_code), to=room_code, include_self=include_self)


def _seat_binding_sids(seat):
    if not seat:
        return []
    sids = []
    controller_sid = seat.get('controller_sid')
    if controller_sid:
        sids.append(controller_sid)
    for viewer_sid in seat.get('viewer_sids', []):
        if viewer_sid and viewer_sid not in sids:
            sids.append(viewer_sid)
    return sids


def _emit_to_seat_bindings(event_name, payload, seat):
    for sid in _seat_binding_sids(seat):
        emit(event_name, payload, to=sid)


def _emit_zeroed_controls_to_host(room, seat):
    host_sid = room.get('host_sid')
    if not host_sid or not seat:
        return

    controls = seat.get('stats', {}).get('controls', {})
    emit('player_controls_update', {
        'player_id': seat['player_id'],
        'seat_id': seat['seat_id'],
        'lease_version': seat['lease_version'],
        'steering': float(controls.get('steering', 0) or 0),
        'acceleration': float(controls.get('acceleration', 0) or 0),
        'braking': float(controls.get('braking', 0) or 0),
        'timestamp': int(time.time() * 1000),
    }, to=host_sid)


def _complete_join(room_code, room, join_result):
    join_room(room_code)
    emit('game_joined', _with_server_metadata(join_result['join_payload'], room))
    emit(
        join_result['lifecycle_event_name'],
        _with_server_metadata(join_result['lifecycle_payload'], room),
        room=room_code
    )

    stale_sid = join_result.get('old_controller_sid')
    if stale_sid:
        try:
            leave_room(room_code, sid=stale_sid)
        except TypeError:
            pass
        emit('seat_taken_over', _with_server_metadata({
            'seat_id': join_result['seat']['seat_id'],
            'player_id': join_result['seat']['player_id'],
            'lease_version': join_result['seat']['lease_version'],
        }, room), to=stale_sid)

    if room.get('phase') in ACTIVE_ROOM_PHASES and join_result['join_payload'].get('role') != 'viewer':
        _emit_zeroed_controls_to_host(room, join_result['seat'])

    join_event_name = 'server:player:reconnected' if join_result['join_payload']['reconnected'] else 'server:player:joined'
    _telemetry_event(
        join_event_name,
        'join_game',
        room=room,
        player_analytics_id=join_result['seat'].get('player_analytics_id'),
        source='SocketIO',
        properties={
            'role': join_result['join_payload'].get('role'),
            'lateJoin': bool(join_result['join_payload'].get('is_late_join')),
            'topology': room.get('topology'),
            'leaseVersion': join_result['seat'].get('lease_version'),
            'takeoverKind': join_result['join_payload'].get('takeover_kind'),
        },
        sensitive_values=_telemetry_sensitive_values(join_result['join_payload']),
    )

    action = "reconnected to" if join_result['join_payload']['reconnected'] else "joined"
    logger.info(
        f"Player {join_result['seat']['appearance']['name']} "
        f"(ID: {join_result['seat']['player_id']}) {action} room {room_code}"
    )


def _coerce_non_negative_int(value):
    """Parse a non-negative integer from int/float/string input."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return int(value) if value >= 0 and value.is_integer() else None
    if isinstance(value, str):
        candidate = value.strip()
        return int(candidate) if candidate.isdigit() else None
    return None


def _optional_sequence(data, field='seq'):
    """Return (is_valid, seq_or_none) for an optional monotonic sequence."""
    if not isinstance(data, dict) or field not in data:
        return True, None
    seq = _coerce_non_negative_int(data.get(field))
    return seq is not None, seq


def _normalize_result_row(entry):
    """Validate and normalize one host-authored result row."""
    if not isinstance(entry, dict):
        return None

    position = _coerce_non_negative_int(entry.get('position'))
    player_id = _coerce_non_negative_int(entry.get('playerId'))
    if position is None or position < 1 or player_id is None or player_id < 1:
        return None

    normalized = {
        'position': position,
        'playerId': player_id
    }

    vehicle_id = entry.get('vehicleId')
    if vehicle_id is not None:
        if isinstance(vehicle_id, bool) or not isinstance(vehicle_id, (int, str)):
            return None
        normalized['vehicleId'] = vehicle_id

    for key in ('finishTime', 'bestLapTime', 'totalPoints'):
        value = entry.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        normalized[key] = value

    if entry.get('roundWins') is not None:
        round_wins = _coerce_non_negative_int(entry.get('roundWins'))
        if round_wins is None:
            return None
        normalized['roundWins'] = round_wins

    return normalized


def _normalize_results_payload(results):
    """Validate the reliable end-of-match results snapshot."""
    if not isinstance(results, list):
        return None

    normalized = []
    for entry in results:
        row = _normalize_result_row(entry)
        if row is None:
            return None
        normalized.append(row)
    return normalized

# Public base URL when deployed behind a reverse proxy / Cloudflare tunnel.
# Unset for local development (LAN IP detection is used instead).
PUBLIC_URL = os.environ.get('PUBLIC_URL', '').rstrip('/')


def get_join_url(room_code, local_ip=None, port=None):
    """Build the URL players use to join a room.

    Deployed: PUBLIC_URL drives it. Local: LAN IP + port so phones on the
    same network can reach the host machine.
    """
    if PUBLIC_URL:
        return f"{PUBLIC_URL}/player?room={room_code}"
    if local_ip is None:
        local_ip = get_local_ip()
    if port is None:
        port = request.environ.get('SERVER_PORT', 8000)
        if 'Host' in request.headers:
            host_parts = request.headers['Host'].split(':')
            if len(host_parts) > 1:
                port = host_parts[1]
    return f"http://{local_ip}:{port}/player?room={room_code}"


def get_local_ip():
    """Get the local IP address of this machine for LAN connections.
    Uses multiple methods to find the most likely local network IP.
    Prioritizes addresses in the 192.168.x.x range which are most
    common for home networks."""
    private_ips = []
    
    # Method 1: Try using socket connection (but this can pick VPN interfaces)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith('127.'):
            private_ips.append(ip)
    except Exception as e:
        logger.error(f"Error getting IP via socket method: {e}")
    
    # Method 2: Try platform-specific commands
    system = platform.system()
    try:
        if system == 'Darwin':  # macOS
            cmd = "ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}'"
            output = subprocess.check_output(cmd, shell=True)
            ips = output.decode().strip().split('\n')
            for ip in ips:
                if ip and not ip.startswith('127.'):
                    private_ips.append(ip)
        elif system == 'Linux':
            cmd = "hostname -I"
            output = subprocess.check_output(cmd, shell=True)
            ips = output.decode().strip().split()
            for ip in ips:
                if ip and not ip.startswith('127.'):
                    private_ips.append(ip)
        elif system == 'Windows':
            cmd = "ipconfig | findstr /i \"IPv4 Address\""
            output = subprocess.check_output(cmd, shell=True)
            ips = re.findall(r'(\d+\.\d+\.\d+\.\d+)', output.decode())
            for ip in ips:
                if ip and not ip.startswith('127.'):
                    private_ips.append(ip)
    except Exception as e:
        logger.error(f"Error getting IP via platform-specific method: {e}")
    
    # If we have IPs, rank them by preference
    if private_ips:
        # Prefer 192.168.x.x networks (most common for home networks)
        for ip in private_ips:
            if ip.startswith('192.168.'):
                return ip
        
        # Next prefer 10.x.x.x networks
        for ip in private_ips:
            if ip.startswith('10.'):
                return ip
        
        # Last try 172.16-31.x.x networks
        for ip in private_ips:
            if re.match(r'^172\.(1[6-9]|2[0-9]|3[0-1])\.', ip):
                return ip
        
        # If none of the above patterns matched but we have IPs, return the first one
        return private_ips[0]
    
    # Fallback to localhost if all methods fail
    logger.warning("Could not determine local IP address, defaulting to localhost")
    return '127.0.0.1'

def generate_room_code(length=4):
    """Generate a random room code of uppercase letters."""
    return ''.join(random.choices(string.ascii_uppercase, k=length))

def _get_host_info():
    """Get local IP and port for host templates."""
    local_ip = get_local_ip()
    port = request.environ.get('SERVER_PORT', 5000)
    # For some reason, SERVER_PORT may not be accurate on all systems
    # Check for host header to get actual port
    if 'X-Forwarded-Host' in request.headers:
        host_parts = request.headers['X-Forwarded-Host'].split(':')
        if len(host_parts) > 1:
            port = host_parts[1]
    elif 'Host' in request.headers:
        host_parts = request.headers['Host'].split(':')
        if len(host_parts) > 1:
            port = host_parts[1]
    return local_ip, port

@app.route('/')
def landing():
    """Serve the marketing landing page (Kahoot-style entry point).

    "Host Now" routes to /host, "Join Game" routes to /player. A dev bypass
    (?dev=1, handled client-side) skips straight to the host for fast local
    iteration.
    """
    return render_template('landing/index.html')

@app.route('/host')
def host():
    """Serve the host interface (big screen)."""
    local_ip, port = _get_host_info()
    return render_template('host/index.html', local_ip=local_ip, port=port)

@app.route('/player')
@app.route('/join')
def player():
    """Serve the player interface."""
    # Get room code from query parameters if available
    room_code = request.args.get('room', '')
    return render_template('player/index.html', room_code=room_code)


@app.route('/join/<room_code>')
def join_room_deeplink(room_code):
    """Deep-link join with the room in the path (woq.11).

    The room lives in the path; ``via``/``intent``/``pair``/``reconnect`` query
    params carry the explicit entry intent that the client-side
    ``joinRouteResolver`` consumes — the join role is derived from typed route
    state, never from user-agent sniffing. Serving the same player template keeps
    Local phones controller/HUD-only; the resolver decides chooser vs direct bind.
    """
    return render_template('player/index.html', room_code=(room_code or '').upper())

@app.route('/weapon-lab')
def weapon_lab():
    """Serve the standalone weapon test lab (dev surface).

    Mirrors the host/player/car-viewer surfaces: a Vite-built page that drives
    the real WeaponSystem through deterministic scenarios for debugging and
    automated checks. Built into dist/frontend/weapon-lab/ via the Vite input.
    """
    return render_template('weapon-lab/index.html')

@app.route('/qrcode/<room_code>')
def generate_qr_code(room_code):
    """Generate a QR code for joining a specific room."""
    try:
        local_ip = get_local_ip()
        # Default port for Flask is 5000, but check headers for actual port
        port = request.environ.get('SERVER_PORT', 5000)
        if 'X-Forwarded-Host' in request.headers:
            host_parts = request.headers['X-Forwarded-Host'].split(':')
            if len(host_parts) > 1:
                port = host_parts[1]
        elif 'Host' in request.headers:
            host_parts = request.headers['Host'].split(':')
            if len(host_parts) > 1:
                port = host_parts[1]
            
        # Generate the URL with the room code
        join_url = get_join_url(room_code, local_ip, port)
        
        # Create QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(join_url)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Save to byte stream
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        return send_file(img_byte_arr, mimetype='image/png')
    except Exception as e:
        logger.error(f"Error generating QR code: {e}")
        return jsonify({"error": str(e)}), 500

@socketio.on('create_room')
@_instrument_socket_handler('create_room')
def create_room(data=None):
    """Host creates a new game room.

    The optional ``topology`` field on ``data`` fixes the room as Local
    (default), Remote, or Mixed for its lifetime. Local preserves today's
    behaviour exactly: big screen renders, phones are controllers.
    """
    _reap_rooms_if_needed()
    host_sid = request.sid
    topology = normalize_topology((data or {}).get('topology'))
    room_code = generate_room_code()

    # Ensure room code is unique
    while room_code in game_rooms:
        room_code = generate_room_code()

    room_state = _new_room_state(room_code, host_sid, topology)
    game_rooms[room_code] = room_state
    host_token = room_state['host_token']

    join_room(room_code)

    # Get join URL with proper IP for display
    local_ip = get_local_ip()
    port = request.environ.get('SERVER_PORT', 8000)
    if 'Host' in request.headers:
        host_parts = request.headers['Host'].split(':')
        if len(host_parts) > 1:
            port = host_parts[1]
    join_url = get_join_url(room_code, local_ip, port)

    emit('room_created', _with_server_metadata({
        'room_code': room_code,
        'join_url': join_url,
        'topology': topology,
        'host_token': host_token,
        'host_epoch': room_state['host_epoch'],
        'phase': room_state['phase'],
    }, room_state))
    _telemetry_event(
        'server:room:created',
        'create_room',
        room=room_state,
        source='SocketIO',
        properties={
            'topology': topology,
            'phase': room_state['phase'],
            'playerCount': 0,
        },
        sensitive_values=_telemetry_sensitive_values({'room_code': room_code, 'join_url': join_url, 'host_token': host_token}),
    )
    logger.info(f"Room created: {room_code} (topology={topology})")

@socketio.on('reclaim_room')
@_instrument_socket_handler('reclaim_room')
def reclaim_room(data):
    """Host re-binds (or recreates) a room under a known code after a socket
    blip or server recycle, so players using the still-displayed code can
    still join instead of hitting 'room doesn't exist'. Requires valid host
    capability token; rotates token on successful reclaim."""
    _reap_rooms_if_needed()
    if not isinstance(data, dict):
        _emit_error_message('error', 'Invalid reclaim payload', handler='reclaim_room', bucket='invalid_payload')
        return

    host_sid = request.sid
    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')

    if not room_code:
        _emit_error_message('error', 'Room code required', handler='reclaim_room', bucket='missing_room_code', sensitive_values=_telemetry_sensitive_values(data))
        return

    if not host_token or not _verify_host_token(host_token):
        _emit_error_message('error', 'Invalid or expired host token', handler='reclaim_room', bucket='invalid_host_token', sensitive_values=_telemetry_sensitive_values(data))
        logger.warning(f"Host reclaim rejected for {room_code}: invalid token")
        return

    if room_code in game_rooms:
        # Existing room: verify the token matches and rebind to the reconnected
        # host socket. Rotate token on successful reclaim.
        room = game_rooms[room_code]
        stored_token = room.get('host_token')
        if not stored_token or not hmac.compare_digest(host_token, stored_token):
            _emit_error_message('error', 'Host token mismatch', handler='reclaim_room', bucket='host_token_mismatch', room=room, sensitive_values=_telemetry_sensitive_values(data))
            logger.warning(f"Host reclaim rejected for {room_code}: token mismatch")
            return

        prior_phase = room.get('phase')
        reclaim_host(room, host_sid, host_token)
        room['host_token'] = _generate_host_token()
        room['host_token_hash'] = hashlib.sha256(room['host_token'].encode('utf-8')).hexdigest()
        room.setdefault('topology', DEFAULT_TOPOLOGY)
        new_token = room['host_token']
        new_epoch = room['host_epoch']
        logger.info(f"Host reconnected, rebound room {room_code} (epoch={new_epoch})")
    else:
        # Room was lost - recreate it empty under the same code. Token must still
        # be valid (but won't match stored token since room is new).
        prior_phase = None
        game_rooms[room_code] = _new_room_state(room_code, host_sid, data.get('topology'))
        new_token = game_rooms[room_code]['host_token']
        new_epoch = game_rooms[room_code]['host_epoch']
        logger.info(f"Host reclaimed missing room {room_code}")

    join_room(room_code)
    emit('room_reclaimed', _with_server_metadata({
        'room_code': room_code,
        'topology': game_rooms[room_code]['topology'],
        'host_token': new_token,
        'host_epoch': new_epoch,
        'phase': game_rooms[room_code]['phase'],
    }, game_rooms[room_code]))
    _telemetry_event(
        'server:room:reclaimed',
        'reclaim_room',
        room=game_rooms[room_code],
        source='SocketIO',
        properties={
            'topology': game_rooms[room_code]['topology'],
            'phase': game_rooms[room_code]['phase'],
            'reboundExistingRoom': prior_phase is not None,
            'priorPhase': prior_phase,
        },
        sensitive_values=_telemetry_sensitive_values({'room_code': room_code, 'host_token': new_token}),
    )
    if prior_phase == PHASE_HOST_LOST:
        _emit_room_phase(room_code, include_self=False)


@socketio.on('return_to_lobby')
@_instrument_socket_handler('return_to_lobby')
def return_to_lobby(data):
    """Host returned to the lobby: reset room state so subsequent joins are
    treated as fresh lobby joins, not mid-race late joins. Requires valid host
    token and epoch."""
    if not isinstance(data, dict):
        _emit_error_message('error', 'Invalid return_to_lobby payload', handler='return_to_lobby', bucket='invalid_payload')
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code:
        _emit_error_message('error', 'Room code required', handler='return_to_lobby', bucket='missing_room_code', sensitive_values=_telemetry_sensitive_values(data))
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        _emit_error_message('error', error_msg, handler='return_to_lobby', bucket='invalid_host_authority', room=_telemetry_room(room_code), sensitive_values=_telemetry_sensitive_values(data))
        return

    return_room_to_lobby(game_rooms[room_code])
    emit('returned_to_lobby', _room_phase_payload(room_code), to=room_code)
    _emit_room_phase(room_code)
    _telemetry_event(
        'server:room:returned_to_lobby',
        'return_to_lobby',
        room=game_rooms[room_code],
        source='SocketIO',
        properties={'phase': game_rooms[room_code]['phase']},
        sensitive_values=_telemetry_sensitive_values(data),
    )
    logger.info(f"Room {room_code} returned to lobby")


@socketio.on('player_control_update')
@_instrument_socket_handler('player_control_update')
def player_control_update(data):
    """
    Handle player control updates.
    Very simple, as all we need to do is some model validation and then pass through the controls as is to the correct room!
    """
    if not isinstance(data, dict):
        _telemetry_validation_failure('player_control_update', 'invalid_payload', source='SocketIO', emit_event=False)
        return
    _reap_rooms_if_needed()

    # The sending socket is authoritative for controller identity. We still
    # accept the legacy payload `player_id` field, but only as a consistency
    # check so a duplicate tab or spoofing client cannot impersonate another
    # seat.
    player_sid = request.sid
    room_code = (data.get('room_code') or '').upper()
    controls = data.get('controls')
    timestamp = data.get('timestamp')
    lease_version = data.get('lease_version')
    client_instance_id = data.get('client_instance_id')
    if not room_code or not isinstance(controls, dict) or timestamp is None:
        _telemetry_validation_failure('player_control_update', 'invalid_payload', room=_telemetry_room(room_code), source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    seq_valid, seq = _optional_sequence(data)
    if not seq_valid:
        _telemetry_validation_failure('player_control_update', 'invalid_seq', room=_telemetry_room(room_code), source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    # Validate room existence and host availability
    if not room_code or room_code not in game_rooms:
        _telemetry_validation_failure('player_control_update', 'room_not_found', source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    room = game_rooms[room_code]
    host_sid = room.get('host_sid')
    if not host_sid or room.get('phase') == PHASE_HOST_LOST:
        _telemetry_validation_failure('player_control_update', 'host_unavailable', room=room, source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    # Drop non-finite / malformed controls (NaN, Infinity, non-numeric) before
    # they reach seat state or the host physics loop; finite values are clamped
    # to their axis ranges.
    safe_controls = validate_finite_controls(controls)
    if safe_controls is None:
        _telemetry_validation_failure('player_control_update', 'invalid_controls', room=room, source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    seat = update_seat_controls(
        room,
        player_sid,
        safe_controls,
        lease_version=lease_version,
        client_instance_id=client_instance_id,
    )
    if not seat:
        _telemetry_validation_failure('player_control_update', 'binding_rejected', room=room, source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    declared_player_id = data.get('player_id')
    if declared_player_id not in (None, seat['player_id']):
        _telemetry_validation_failure('player_control_update', 'player_id_mismatch', room=room, player_analytics_id=seat.get('player_analytics_id'), source='SocketIO', emit_event=False, sensitive_values=_telemetry_sensitive_values(data))
        return

    steering = safe_controls['steering']
    acceleration = safe_controls['acceleration']
    braking = safe_controls['braking']

    # Create validated control update
    control_update = {
        'player_id': seat['player_id'],
        'seat_id': seat['seat_id'],
        'lease_version': seat['lease_version'],
        'steering': steering,
        'acceleration': acceleration,
        'braking': braking,
        'timestamp': timestamp
    }
    if seq is not None:
        control_update['seq'] = seq

    # Forward the control update to the host only
    emit('player_controls_update', control_update, to=host_sid)


@socketio.on('vehicle_states')
def handle_vehicle_states(data):
    """Handle vehicle state updates from host. Forward to all players in the room.
    Requires valid host token and epoch; silently drops if invalid (volatile lane policy).
    """
    if not isinstance(data, dict):
        return

    room_code = (data.get('room_code') or '').upper()
    vehicles = data.get('vehicles')
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')
    seq_valid, seq = _optional_sequence(data)

    if not room_code or room_code not in game_rooms or not seq_valid or not isinstance(vehicles, list):
        return

    # Volatile lane: drop silently on invalid token/epoch
    is_valid, _ = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        return

    room = game_rooms[room_code]
    room['last_snapshot'] = {
        'captured_at': time.time(),
        'seq': seq,
        'vehicles': vehicles,
    }

    # Broadcast to everyone in the room (including self/host, but players will filter)
    payload = {
        'room_code': room_code,
        'vehicles': vehicles
    }
    if seq is not None:
        payload['seq'] = seq
    emit('vehicle_states_update', payload, room=room_code)


@socketio.on('join_game')
@_instrument_socket_handler('join_game')
def on_join_game(data):
    """Handle player joining a game room"""
    _reap_rooms_if_needed()
    if not isinstance(data, dict):
        _emit_join_error_message('Invalid join payload', handler='join_game', bucket='invalid_payload')
        return

    # Server-canonical display name at join (NFKC, strip control chars, cap
    # length, safe default). Rendered as literal text on host/player (3xv.4).
    player_name = canonicalize_name(data.get('player_name'))
    room_code = (data.get('room_code') or '').upper()
    reconnect_id = data.get('reconnect_id')  # Legacy fallback only
    seat_token = data.get('seat_token')
    client_instance_id = data.get('client_instance_id')
    can_render = bool(data.get('can_render'))
    viewer_only = (data.get('role') == 'viewer') or bool(data.get('viewer_only'))

    # Validate room code
    if not room_code or room_code not in game_rooms:
        _emit_join_error_message('Invalid room code', handler='join_game', bucket='invalid_room_code', sensitive_values=_telemetry_sensitive_values(data))
        return

    # Get room
    room = game_rooms[room_code]
    if room.get('phase') == 'closed':
        _emit_join_error_message('Room is closed', handler='join_game', bucket='room_closed', room=room, sensitive_values=_telemetry_sensitive_values(data))
        return

    join_result = join_seat(
        room,
        request.sid,
        player_name=player_name,
        seat_token=seat_token,
        reconnect_id=reconnect_id,
        client_instance_id=client_instance_id,
        can_render=can_render,
        viewer_only=viewer_only,
    )

    if join_result['status'] == 'takeover_required':
        emit('controller_takeover_required', _with_server_metadata(join_result['payload'], room))
        _telemetry_event(
            'server:player:takeover_prompted',
            'join_game',
            room=room,
            source='SocketIO',
            properties={
                'seatId': join_result['payload']['seat_id'],
                'phase': room.get('phase'),
            },
            sensitive_values=_telemetry_sensitive_values(data),
        )
        logger.info(
            f"Seat takeover prompt for room {room_code} seat {join_result['payload']['seat_id']}"
        )
        return

    _complete_join(room_code, room, join_result)


@socketio.on('confirm_controller_takeover')
@_instrument_socket_handler('confirm_controller_takeover')
def confirm_controller_takeover_event(data):
    if not isinstance(data, dict):
        _emit_join_error_message('Invalid takeover payload', handler='confirm_controller_takeover', bucket='invalid_payload')
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    seat_token = data.get('seat_token')
    client_instance_id = data.get('client_instance_id')
    if not room_code or room_code not in game_rooms:
        _emit_join_error_message('Invalid room code', handler='confirm_controller_takeover', bucket='invalid_room_code', sensitive_values=_telemetry_sensitive_values(data))
        return

    room = game_rooms[room_code]
    join_result = confirm_pending_takeover(
        room,
        request.sid,
        seat_token=seat_token,
        client_instance_id=client_instance_id,
    )
    if join_result.get('status') != 'joined':
        _emit_join_error_message('Takeover request expired', handler='confirm_controller_takeover', bucket='takeover_expired', room=room, sensitive_values=_telemetry_sensitive_values(data))
        return

    _complete_join(room_code, room, join_result)


@socketio.on('seat_heartbeat')
def seat_heartbeat(data):
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    if not room_code or room_code not in game_rooms:
        return

    touch_controller(
        game_rooms[room_code],
        request.sid,
        lease_version=data.get('lease_version'),
        client_instance_id=data.get('client_instance_id'),
    )

@socketio.on('start_game')
@_instrument_socket_handler('start_game')
def start_game(data):
    """Host starts the game in a room. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        _emit_error_message('error', 'Invalid start_game payload', handler='start_game', bucket='invalid_payload')
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code:
        _emit_error_message('error', 'Room code required', handler='start_game', bucket='missing_room_code', sensitive_values=_telemetry_sensitive_values(data))
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        _emit_error_message('error', error_msg, handler='start_game', bucket='invalid_host_authority', room=_telemetry_room(room_code), sensitive_values=_telemetry_sensitive_values(data))
        return

    begin_room_match(game_rooms[room_code])
    emit('game_started', _room_phase_payload(room_code), to=room_code)
    _emit_room_phase(room_code)
    _telemetry_event(
        'server:game:started',
        'start_game',
        room=game_rooms[room_code],
        source='SocketIO',
        properties={
            'topology': game_rooms[room_code].get('topology'),
            'playerCount': len(game_rooms[room_code].get('seats', {})),
        },
        sensitive_values=_telemetry_sensitive_values(data),
    )
    logger.info(f"Game started in room {room_code}")


@socketio.on('end_game')
@_instrument_socket_handler('end_game')
def end_game(data):
    """Host publishes the reliable end-of-match results snapshot. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        _emit_error_message('error', 'Invalid results payload', handler='end_game', bucket='invalid_payload')
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code:
        _emit_error_message('error', 'Room code required', handler='end_game', bucket='missing_room_code', sensitive_values=_telemetry_sensitive_values(data))
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        _emit_error_message('error', error_msg, handler='end_game', bucket='invalid_host_authority', room=_telemetry_room(room_code), sensitive_values=_telemetry_sensitive_values(data))
        return

    room = game_rooms[room_code]

    seq_valid, seq = _optional_sequence(data)
    if not seq_valid:
        _emit_error_message('error', 'Invalid results payload', handler='end_game', bucket='invalid_seq', room=room, sensitive_values=_telemetry_sensitive_values(data))
        return

    results = _normalize_results_payload(data.get('results'))
    if results is None:
        _emit_error_message('error', 'Invalid results payload', handler='end_game', bucket='invalid_results', room=room, sensitive_values=_telemetry_sensitive_values(data))
        return

    end_room_match(room)
    payload = {
        'room_code': room_code,
        'mode': room.get('mode', DEFAULT_RULESET),
        'topology': room.get('topology', DEFAULT_TOPOLOGY),
        'results': results,
        'phase': room.get('phase'),
        'match_id': room.get('match_id'),
        'round_id': room.get('round_id'),
    }
    if seq is not None:
        payload['seq'] = seq

    emit('game_end', payload, room=room_code)
    _emit_room_phase(room_code)
    _telemetry_event(
        'server:game:ended',
        'end_game',
        room=room,
        source='SocketIO',
        properties={
            'topology': room.get('topology'),
            'resultsCount': len(results),
            'phase': room.get('phase'),
        },
        sensitive_values=_telemetry_sensitive_values(data),
    )
    logger.info(f"Game ended in room {room_code}")

@socketio.on('mode_selected')
@_instrument_socket_handler('mode_selected')
def mode_selected(data):
    """Host broadcasts mode selection to all players. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid mode_selected payload'})
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    mode = data.get('mode')
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code or not mode:
        emit('error', {'message': 'Room code and mode required'})
        return

    # Validate mode is one of the allowed rulesets
    if mode not in RULESETS:
        emit('error', {'message': f'Invalid mode: {mode}'})
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        emit('error', {'message': error_msg})
        return

    # Store the selected mode
    game_rooms[room_code]['mode'] = mode

    # Broadcast to all players in the room (except host)
    emit('mode_selected', _with_server_metadata({'mode': mode}, game_rooms[room_code]), to=room_code, include_self=False)
    logger.info(f"Mode selected in room {room_code}: {mode}")

@socketio.on('player_update')
def player_update(data):
    """Player sends position and rotation updates."""
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    player_sid = request.sid
    room_code = (data.get('room_code') or '').upper()
    position = data.get('position')
    rotation = data.get('rotation')
    velocity = data.get('velocity')

    if room_code not in game_rooms:
        return

    seat = update_seat_motion(game_rooms[room_code], player_sid, position, rotation, velocity)
    if not seat:
        return

    emit('player_position_update', {
        'player_id': seat['player_id'],
        'seat_id': seat['seat_id'],
        'position': position,
        'rotation': rotation,
        'velocity': velocity
    }, to=game_rooms[room_code]['host_sid'])

@socketio.on('disconnect')
@_instrument_socket_handler('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    _reap_rooms_if_needed()
    client_sid = request.sid

    for room_code, room_data in list(game_rooms.items()):
        if client_sid not in room_data.get('sid_index', {}):
            continue

        disconnect_result = disconnect_binding(room_data, client_sid)
        if disconnect_result['status'] == 'host_lost':
            server_telemetry.increment('jj_server_disconnects_total', labels={'cause': 'host', 'phase': room_data.get('phase', 'unknown')})
            payload = _room_phase_payload(room_code)
            payload['grace_seconds'] = HOST_LOSS_GRACE_SECONDS
            payload['last_snapshot_at'] = (room_data.get('last_snapshot') or {}).get('captured_at')
            emit('host_disconnected', payload, to=room_code, include_self=False)
            _emit_room_phase(room_code, include_self=False)
            _telemetry_event(
                'server:host:disconnected',
                'disconnect',
                room=room_data,
                source='SocketIO',
                properties={
                    'phase': room_data.get('phase'),
                    'graceSeconds': HOST_LOSS_GRACE_SECONDS,
                    'hadSnapshot': bool(room_data.get('last_snapshot')),
                },
            )
            logger.info(f"Host disconnected, room {room_code} entering host-loss grace")
            break

        if disconnect_result['status'] != 'seat_away':
            continue

        server_telemetry.increment(
            'jj_server_disconnects_total',
            labels={
                'cause': 'seat',
                'can_reconnect': str(room_data.get('phase') in ACTIVE_ROOM_PHASES).lower(),
            },
        )

        seat = disconnect_result['seat']
        if room_data.get('phase') in ACTIVE_ROOM_PHASES:
            _emit_zeroed_controls_to_host(room_data, seat)
            logger.info(
                f"Seat {seat['seat_id']} controller disconnected during active phase in room {room_code}"
            )
        elif room_data.get('host_sid'):
            emit('player_left', {
                'player_id': seat['player_id'],
                'seat_id': seat['seat_id'],
                'player_name': seat['appearance']['name'],
                'can_reconnect': True,
            }, to=room_data['host_sid'])
        _telemetry_event(
            'server:player:left',
            'disconnect',
            room=room_data,
            player_analytics_id=seat.get('player_analytics_id'),
            source='SocketIO',
            properties={
                'phase': room_data.get('phase'),
                'canReconnect': True,
                'seatId': seat['seat_id'],
            },
        )
        if room_data.get('phase') in ACTIVE_ROOM_PHASES:
            logger.info(f"Seat {seat['seat_id']} disconnected from room {room_code}")
        break

@socketio.on('reset_player_position')
@_instrument_socket_handler('reset_player_position')
def handle_reset_position(data):
    """Handle resetting a player's position.
    Requires valid host token and epoch (destructive host action).
    """
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')
    player_id = data.get('player_id')
    position = data.get('position')
    rotation = data.get('rotation')

    if not room_code or room_code not in game_rooms:
        return

    # Validate host authority (token + epoch + SID)
    is_valid, _ = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        logger.warning(f"reset_player_position rejected for {room_code}: invalid host authority")
        return

    seat = lookup_seat_by_id(game_rooms[room_code], player_id)
    if not seat:
        return

    seat['stats']['position'] = position
    seat['stats']['rotation'] = rotation
    seat['stats']['velocity'] = [0, 0, 0]

    logger.info(f"Resetting position for player {player_id} in room {room_code} to {position}")

    _emit_to_seat_bindings('position_reset', {
        'position': position,
        'rotation': rotation
    }, seat)

    emit('player_position_update', {
        'player_id': player_id,
        'seat_id': seat['seat_id'],
        'position': position,
        'rotation': rotation,
        'velocity': [0, 0, 0]
    }, to=game_rooms[room_code]['host_sid'])
            
@socketio.on('weapon_fire')
@_instrument_socket_handler('weapon_fire')
def handle_weapon_fire(data):
    """Handle weapon fire event from player."""
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    player_sid = request.sid
    room_code = (data.get('room_code') or '').upper()

    if not room_code or room_code not in game_rooms:
        return

    room = game_rooms[room_code]
    binding = lookup_binding_by_sid(room, player_sid)
    if not binding or not binding.get('seat') or binding['binding'].get('binding') != 'controller':
        return

    seat = binding['seat']
    # Abuse control (3xv.4): cap fire-intent rate per seat so one controller
    # cannot flood the host with fire events.
    if not _fire_rate_limiter.allow(f"{room_code}:{seat['seat_id']}"):
        return

    # Forward to host
    emit('weapon_fire', {
        'player_id': seat['player_id'],
        'seat_id': seat['seat_id'],
    }, to=room['host_sid'])

    logger.debug(f"Player {seat['player_id']} fired weapon in room {room_code}")

@socketio.on('request_car_reset')
@_instrument_socket_handler('request_car_reset')
def handle_request_car_reset(data):
    """Player asks the host to un-stick their car (reset to a safe spot)."""
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    player_sid = request.sid
    room_code = (data.get('room_code') or '').upper()

    if not room_code or room_code not in game_rooms:
        return

    room = game_rooms[room_code]
    binding = lookup_binding_by_sid(room, player_sid)
    if not binding or not binding.get('seat') or binding['binding'].get('binding') != 'controller':
        return

    seat = binding['seat']
    # Abuse control (3xv.4): cap car-reset rate per seat (a reset can teleport a
    # car to a safe spot, so spamming it is an exploit).
    if not _reset_rate_limiter.allow(f"{room_code}:{seat['seat_id']}"):
        return
    emit('car_reset_request', {'player_id': seat['player_id'], 'seat_id': seat['seat_id']}, to=room['host_sid'])
    logger.info(f"Player {seat['player_id']} requested car reset in room {room_code}")

@socketio.on('weapon_pickup')
@_instrument_socket_handler('weapon_pickup')
def handle_weapon_pickup(data):
    """Handle weapon pickup notification from host to player.
    Requires valid host token and epoch (not just host SID).
    """
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')
    target_player_id = data.get('player_id')

    if not room_code or room_code not in game_rooms:
        return

    # Validate host authority (token + epoch + SID)
    is_valid, _ = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        logger.warning(f"weapon_pickup rejected for {room_code}: invalid host authority")
        return

    room = game_rooms[room_code]

    seat = lookup_seat_by_id(room, target_player_id)
    if not seat:
        return

    # Resolve the wire weapon id against the whitelist; drop unknown ids so a
    # bad/forged id never reaches the controller (3xv.4).
    weapon_id = resolve_weapon_id(data.get('weaponId'))
    if weapon_id is None:
        logger.warning(f"weapon_pickup dropped for {room_code}: unknown weapon id")
        return

    _emit_to_seat_bindings('weapon_pickup', {
        'weaponId': weapon_id,
        'weaponName': data.get('weaponName'),
        'icon': data.get('icon')
    }, seat)

@socketio.on('weapon_fired')
@_instrument_socket_handler('weapon_fired')
def handle_weapon_fired(data):
    """Handle weapon fired notification from host to player.
    Requires valid host token and epoch (not just host SID).
    """
    if not isinstance(data, dict):
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')
    target_player_id = data.get('player_id')

    if not room_code or room_code not in game_rooms:
        return

    # Validate host authority (token + epoch + SID)
    is_valid, _ = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        logger.warning(f"weapon_fired rejected for {room_code}: invalid host authority")
        return

    room = game_rooms[room_code]

    seat = lookup_seat_by_id(room, target_player_id)
    if not seat:
        return

    # Resolve the wire weapon id against the whitelist; drop unknown ids (3xv.4).
    weapon_id = resolve_weapon_id(data.get('weaponId'))
    if weapon_id is None:
        logger.warning(f"weapon_fired dropped for {room_code}: unknown weapon id")
        return

    _emit_to_seat_bindings('weapon_fired', {
        'weaponId': weapon_id
    }, seat)

@socketio.on('update_player_name')
@_instrument_socket_handler('update_player_name')
def update_player_name(data):
    """Handle player name update."""
    if not isinstance(data, dict):
        emit('name_updated', {'success': False, 'message': 'Invalid payload'})
        return
    _reap_rooms_if_needed()

    player_sid = request.sid
    raw_name = data.get('name')
    if not isinstance(raw_name, str) or not raw_name.strip():
        emit('name_updated', {'success': False, 'message': 'Invalid name'})
        return
    # Server-canonical display name: NFKC, strip control/format chars, collapse
    # whitespace, cap length. The canonical VALUE is what is stored/broadcast;
    # clients render it as literal text (SafeTextRenderer), so markup never runs.
    new_name = canonicalize_name(raw_name)

    for room_code, room_data in game_rooms.items():
        binding = lookup_binding_by_sid(room_data, player_sid)
        if not binding or not binding.get('seat') or binding['binding'].get('binding') != 'controller':
            continue

        # Abuse control (3xv.4): rate-limit name changes per seat (anti name-spam).
        if not _name_rate_limiter.allow(f"{room_code}:{binding['seat']['seat_id']}"):
            emit('name_updated', {'success': False, 'message': 'Changing name too fast'})
            return

        seat = update_seat_name(room_data, player_sid, new_name)
        if not seat:
            break

        emit('name_updated', {
            'success': True,
            'name': new_name
        })

        emit('player_name_updated', {
            'player_id': seat['player_id'],
            'seat_id': seat['seat_id'],
            'name': new_name
        }, to=room_data['host_sid'])

        logger.info(
            f"Player name changed in room {room_code}: {seat['player_id']} -> {new_name}"
        )
        return
    
    # Player not found in any room
    emit('name_updated', {'success': False, 'message': 'Player not in a room'})
    logger.warning(f"Failed to update player name: Player not in a room")


@app.route('/metrics')
def metrics():
    response = app.response_class(
        server_telemetry.render_metrics(game_rooms),
        mimetype='text/plain',
    )
    response.headers['Content-Type'] = 'text/plain; version=0.0.4; charset=utf-8'
    return response


@app.route('/telemetry/report-submission', methods=['POST'])
def telemetry_report_submission():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        _telemetry_validation_failure(
            'telemetry_report_submission',
            'invalid_payload',
            source='Flask',
            sensitive_values=_telemetry_sensitive_values(),
        )
        return jsonify({'error': 'invalid payload'}), 400

    room_analytics_id = data.get('room_analytics_id') or data.get('roomAnalyticsId')
    match_id = data.get('match_id') or data.get('matchId')
    player_analytics_id = data.get('player_analytics_id') or data.get('playerAnalyticsId')
    description = data.get('description')
    error_fingerprint = _safe_error_fingerprint(
        data.get('fingerprint') or data.get('error_fingerprint') or data.get('errorFingerprint')
    )
    properties = {
        'reportRole': data.get('role') or 'unknown',
        'reportSource': data.get('source') or 'unknown',
        'descriptionProvided': bool(description),
        'descriptionLength': len(str(description or '')),
        'screenshotAttached': bool(data.get('screenshot_attached') or data.get('screenshotAttached')),
        'wasStale': bool(data.get('was_stale') or data.get('wasStale')),
    }
    if error_fingerprint:
        properties['fingerprint'] = error_fingerprint
    _telemetry_event(
        'server:report:submitted',
        'telemetry_report_submission',
        room_analytics_id=room_analytics_id,
        match_id=match_id,
        player_analytics_id=player_analytics_id,
        source='Flask',
        properties=properties,
        sensitive_values=_telemetry_sensitive_values(data),
    )
    return jsonify({'status': 'accepted'}), 202


@app.route('/health')
def health():
    """Liveness endpoint for deploy health checks."""
    return jsonify({
        'status': 'ok',
        'rooms': len(game_rooms)
    })


# Central bug-report intake (woq.4). Public, sanitizing, and deliberately dumb:
# it validates, scrubs, rate-limits, and appends to a bounded ndjson store. It
# NEVER touches br/gh/shell — the maintainer drainer (triage.py) does that.
REPORTS_STORE_PATH = os.environ.get(
    'JJ_REPORTS_PATH',
    os.path.join(os.path.dirname(__file__), '..', '.reports', 'reports.ndjson'),
)
REPORT_ALLOWED_ORIGIN = os.environ.get('JJ_REPORT_ALLOWED_ORIGIN', '*')
_report_rate_limiter = RateLimiter(min_interval=2.0)  # per-IP, 1 report / 2s


def _report_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = REPORT_ALLOWED_ORIGIN
    response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response


@app.route('/report', methods=['POST', 'OPTIONS'])
def submit_report():
    if request.method == 'OPTIONS':
        return _report_cors_headers(make_response('', 204))

    if request.content_length and request.content_length > MAX_TOTAL_PAYLOAD_BYTES:
        return _report_cors_headers(make_response(jsonify({'error': 'too_large'}), 413))

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _report_cors_headers(make_response(jsonify({'error': 'invalid_payload'}), 400))

    # Honeypot: silently accept (never store) a bot submission.
    if is_honeypot(data):
        return _report_cors_headers(make_response(jsonify({'status': 'ok'}), 200))

    # Per-IP rate limit.
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr) or 'unknown'
    if not _report_rate_limiter.allow(client_ip):
        return _report_cors_headers(make_response(jsonify({'error': 'rate_limited'}), 429))

    ok, reason = validate_report(data)
    if not ok:
        return _report_cors_headers(make_response(jsonify({'error': reason}), 400))

    row = append_report(data, REPORTS_STORE_PATH, client_ip=client_ip)
    return _report_cors_headers(
        make_response(jsonify({'status': 'stored', 'clientReportId': row['clientReportId']}), 200)
    )


@app.route('/__test__/reset-rooms', methods=['POST'])
def reset_test_rooms():
    """Clear in-memory rooms for local E2E isolation.

    This is intentionally narrow: it only works from loopback and only when the
    caller presents the test header used by Playwright helpers.
    """
    if request.remote_addr not in ('127.0.0.1', '::1'):
        return jsonify({'error': 'not found'}), 404
    if request.headers.get('X-JJ-E2E-Reset') != '1':
        return jsonify({'error': 'not found'}), 404

    room_count = len(game_rooms)
    game_rooms.clear()
    server_telemetry.clear()
    logger.info(f"E2E reset cleared {room_count} rooms")
    return jsonify({'status': 'ok', 'rooms_cleared': room_count})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    # Debug stays on for local development; deployments set FLASK_DEBUG=0
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)
