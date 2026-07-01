from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
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
    removed = reap_rooms(
        game_rooms,
        host_loss_grace=HOST_LOSS_GRACE_SECONDS,
        room_ttl=ROOM_TTL_SECONDS,
    )
    for room_code in removed:
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
    return {
        'room_code': room_code,
        'phase': room.get('phase', PHASE_WAITING),
        'game_state': room.get('game_state', phase_to_game_state(PHASE_WAITING)),
        'mode': room.get('mode', DEFAULT_RULESET),
        'topology': room.get('topology', DEFAULT_TOPOLOGY),
        'match_id': room.get('match_id'),
        'round_id': room.get('round_id'),
        'host_epoch': room.get('host_epoch'),
    }


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
    emit('game_joined', join_result['join_payload'])
    emit(join_result['lifecycle_event_name'], join_result['lifecycle_payload'], room=room_code)

    stale_sid = join_result.get('old_controller_sid')
    if stale_sid:
        try:
            leave_room(room_code, sid=stale_sid)
        except TypeError:
            pass
        emit('seat_taken_over', {
            'seat_id': join_result['seat']['seat_id'],
            'player_id': join_result['seat']['player_id'],
            'lease_version': join_result['seat']['lease_version'],
        }, to=stale_sid)

    if room.get('phase') in ACTIVE_ROOM_PHASES and join_result['join_payload'].get('role') != 'viewer':
        _emit_zeroed_controls_to_host(room, join_result['seat'])

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

    emit('room_created', {
        'room_code': room_code,
        'join_url': join_url,
        'topology': topology,
        'host_token': host_token,
        'host_epoch': room_state['host_epoch'],
        'phase': room_state['phase'],
    })
    logger.info(f"Room created: {room_code} (topology={topology})")

@socketio.on('reclaim_room')
def reclaim_room(data):
    """Host re-binds (or recreates) a room under a known code after a socket
    blip or server recycle, so players using the still-displayed code can
    still join instead of hitting 'room doesn't exist'. Requires valid host
    capability token; rotates token on successful reclaim."""
    _reap_rooms_if_needed()
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid reclaim payload'})
        return

    host_sid = request.sid
    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')

    if not room_code:
        emit('error', {'message': 'Room code required'})
        return

    if not host_token or not _verify_host_token(host_token):
        emit('error', {'message': 'Invalid or expired host token'})
        logger.warning(f"Host reclaim rejected for {room_code}: invalid token")
        return

    if room_code in game_rooms:
        # Existing room: verify the token matches and rebind to the reconnected
        # host socket. Rotate token on successful reclaim.
        room = game_rooms[room_code]
        stored_token = room.get('host_token')
        if not stored_token or not hmac.compare_digest(host_token, stored_token):
            emit('error', {'message': 'Host token mismatch'})
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
    emit('room_reclaimed', {
        'room_code': room_code,
        'topology': game_rooms[room_code]['topology'],
        'host_token': new_token,
        'host_epoch': new_epoch,
        'phase': game_rooms[room_code]['phase'],
    })
    if prior_phase == PHASE_HOST_LOST:
        _emit_room_phase(room_code, include_self=False)


@socketio.on('return_to_lobby')
def return_to_lobby(data):
    """Host returned to the lobby: reset room state so subsequent joins are
    treated as fresh lobby joins, not mid-race late joins. Requires valid host
    token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid return_to_lobby payload'})
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code:
        emit('error', {'message': 'Room code required'})
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        emit('error', {'message': error_msg})
        return

    return_room_to_lobby(game_rooms[room_code])
    emit('returned_to_lobby', to=room_code)
    _emit_room_phase(room_code)
    logger.info(f"Room {room_code} returned to lobby")


@socketio.on('player_control_update')
def player_control_update(data):
    """
    Handle player control updates.
    Very simple, as all we need to do is some model validation and then pass through the controls as is to the correct room!
    """
    if not isinstance(data, dict):
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
        return

    seq_valid, seq = _optional_sequence(data)
    if not seq_valid:
        return

    # Validate room existence and host availability
    if not room_code or room_code not in game_rooms:
        return

    room = game_rooms[room_code]
    host_sid = room.get('host_sid')
    if not host_sid or room.get('phase') == PHASE_HOST_LOST:
        return

    # Drop non-finite / malformed controls (NaN, Infinity, non-numeric) before
    # they reach seat state or the host physics loop; finite values are clamped
    # to their axis ranges.
    safe_controls = validate_finite_controls(controls)
    if safe_controls is None:
        return

    seat = update_seat_controls(
        room,
        player_sid,
        safe_controls,
        lease_version=lease_version,
        client_instance_id=client_instance_id,
    )
    if not seat:
        return

    declared_player_id = data.get('player_id')
    if declared_player_id not in (None, seat['player_id']):
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
def on_join_game(data):
    """Handle player joining a game room"""
    _reap_rooms_if_needed()
    if not isinstance(data, dict):
        emit('join_error', {'message': 'Invalid join payload'})
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
        emit('join_error', {'message': 'Invalid room code'})
        return

    # Get room
    room = game_rooms[room_code]
    if room.get('phase') == 'closed':
        emit('join_error', {'message': 'Room is closed'})
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
        emit('controller_takeover_required', join_result['payload'])
        logger.info(
            f"Seat takeover prompt for room {room_code} seat {join_result['payload']['seat_id']}"
        )
        return

    _complete_join(room_code, room, join_result)


@socketio.on('confirm_controller_takeover')
def confirm_controller_takeover_event(data):
    if not isinstance(data, dict):
        emit('join_error', {'message': 'Invalid takeover payload'})
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    seat_token = data.get('seat_token')
    client_instance_id = data.get('client_instance_id')
    if not room_code or room_code not in game_rooms:
        emit('join_error', {'message': 'Invalid room code'})
        return

    room = game_rooms[room_code]
    join_result = confirm_pending_takeover(
        room,
        request.sid,
        seat_token=seat_token,
        client_instance_id=client_instance_id,
    )
    if join_result.get('status') != 'joined':
        emit('join_error', {'message': 'Takeover request expired'})
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
def start_game(data):
    """Host starts the game in a room. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid start_game payload'})
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code:
        emit('error', {'message': 'Room code required'})
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        emit('error', {'message': error_msg})
        return

    begin_room_match(game_rooms[room_code])
    emit('game_started', _room_phase_payload(room_code), to=room_code)
    _emit_room_phase(room_code)
    logger.info(f"Game started in room {room_code}")


@socketio.on('end_game')
def end_game(data):
    """Host publishes the reliable end-of-match results snapshot. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid results payload'})
        return
    _reap_rooms_if_needed()

    room_code = (data.get('room_code') or '').upper()
    host_token = data.get('host_token')
    host_epoch = data.get('host_epoch')

    if not room_code:
        emit('error', {'message': 'Room code required'})
        return

    is_valid, error_msg = _check_host_authority(room_code, host_token, host_epoch)
    if not is_valid:
        emit('error', {'message': error_msg})
        return

    room = game_rooms[room_code]

    seq_valid, seq = _optional_sequence(data)
    if not seq_valid:
        emit('error', {'message': 'Invalid results payload'})
        return

    results = _normalize_results_payload(data.get('results'))
    if results is None:
        emit('error', {'message': 'Invalid results payload'})
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
    logger.info(f"Game ended in room {room_code}")

@socketio.on('mode_selected')
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
    emit('mode_selected', {'mode': mode}, to=room_code, include_self=False)
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
def handle_disconnect():
    """Handle client disconnection."""
    _reap_rooms_if_needed()
    client_sid = request.sid

    for room_code, room_data in list(game_rooms.items()):
        if client_sid not in room_data.get('sid_index', {}):
            continue

        disconnect_result = disconnect_binding(room_data, client_sid)
        if disconnect_result['status'] == 'host_lost':
            payload = _room_phase_payload(room_code)
            payload['grace_seconds'] = HOST_LOSS_GRACE_SECONDS
            payload['last_snapshot_at'] = (room_data.get('last_snapshot') or {}).get('captured_at')
            emit('host_disconnected', payload, to=room_code, include_self=False)
            _emit_room_phase(room_code, include_self=False)
            logger.info(f"Host disconnected, room {room_code} entering host-loss grace")
            break

        if disconnect_result['status'] != 'seat_away':
            continue

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
            logger.info(f"Seat {seat['seat_id']} disconnected from room {room_code}")
        break

@socketio.on('reset_player_position')
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

@app.route('/health')
def health():
    """Liveness endpoint for deploy health checks."""
    return jsonify({
        'status': 'ok',
        'rooms': len(game_rooms)
    })


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
    logger.info(f"E2E reset cleared {room_count} rooms")
    return jsonify({'status': 'ok', 'rooms_cleared': room_count})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    # Debug stays on for local development; deployments set FLASK_DEBUG=0
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)
