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
    from session_vocabulary import (
        DEFAULT_TOPOLOGY, normalize_topology,
        DEFAULT_RULESET, RULESETS, participant_roles, primary_role,
    )
except ImportError:  # pragma: no cover - import path shim
    from server.session_vocabulary import (
        DEFAULT_TOPOLOGY, normalize_topology,
        DEFAULT_RULESET, RULESETS, participant_roles, primary_role,
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


def _read_build_identity():
    """Resolve {buildId, buildSha, buildTime} for the running server.

    Precedence: dist/version.json (the built bundle's identity) -> explicit env
    -> 'dev' fallback. Read once and memoized; a redeploy restarts the process,
    so there is no stale-cache risk here.
    """
    global _BUILD_IDENTITY_CACHE
    if _BUILD_IDENTITY_CACHE is not None:
        return _BUILD_IDENTITY_CACHE

    identity = {'buildId': 'dev', 'buildSha': 'unknown', 'buildTime': 'dev'}
    version_path = os.path.join(dist_path, 'version.json')
    try:
        with open(version_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for key in ('buildId', 'buildSha', 'buildTime'):
            value = data.get(key)
            if isinstance(value, str) and value:
                identity[key] = value
    except (OSError, ValueError):
        # No built manifest (dev/source mode) — fall back to env then defaults.
        identity['buildId'] = os.environ.get('BUILD_ID', identity['buildId'])
        identity['buildSha'] = os.environ.get('BUILD_SHA', identity['buildSha'])
        identity['buildTime'] = os.environ.get('BUILD_TIME', identity['buildTime'])

    _BUILD_IDENTITY_CACHE = identity
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


def _new_room_state(host_sid, topology=DEFAULT_TOPOLOGY):
    """Build a fresh room-state dict with an explicit, validated topology.

    Topology is the room's distribution axis (local/remote/mixed) and is kept
    separate from the ruleset (race/derby, stored under the legacy ``mode``
    key). Unknown topology values coerce to the default so the Local path can
    never be broken by a bad client hint.
    """
    return {
        'host_sid': host_sid,
        'host_token': _generate_host_token(),
        'host_epoch': 1,
        'topology': normalize_topology(topology),
        'players': {},
        'game_state': 'waiting',
        'disconnected_players': {},
        'next_player_id': 1
    }


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
    host_sid = request.sid
    topology = normalize_topology((data or {}).get('topology'))
    room_code = generate_room_code()

    # Ensure room code is unique
    while room_code in game_rooms:
        room_code = generate_room_code()

    room_state = _new_room_state(host_sid, topology)
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
        'host_epoch': room_state['host_epoch']
    })
    logger.info(f"Room created: {room_code} (topology={topology})")

@socketio.on('reclaim_room')
def reclaim_room(data):
    """Host re-binds (or recreates) a room under a known code after a socket
    blip or server recycle, so players using the still-displayed code can
    still join instead of hitting 'room doesn't exist'. Requires valid host
    capability token; rotates token on successful reclaim."""
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
        stored_token = game_rooms[room_code].get('host_token')
        if not stored_token or not hmac.compare_digest(host_token, stored_token):
            emit('error', {'message': 'Host token mismatch'})
            logger.warning(f"Host reclaim rejected for {room_code}: token mismatch")
            return

        game_rooms[room_code]['host_sid'] = host_sid
        game_rooms[room_code]['host_epoch'] += 1
        game_rooms[room_code]['host_token'] = _generate_host_token()
        game_rooms[room_code].setdefault('topology', DEFAULT_TOPOLOGY)
        new_token = game_rooms[room_code]['host_token']
        new_epoch = game_rooms[room_code]['host_epoch']
        logger.info(f"Host reconnected, rebound room {room_code} (epoch={new_epoch})")
    else:
        # Room was lost - recreate it empty under the same code. Token must still
        # be valid (but won't match stored token since room is new).
        game_rooms[room_code] = _new_room_state(host_sid, data.get('topology'))
        new_token = game_rooms[room_code]['host_token']
        new_epoch = game_rooms[room_code]['host_epoch']
        logger.info(f"Host reclaimed missing room {room_code}")

    join_room(room_code)
    emit('room_reclaimed', {
        'room_code': room_code,
        'topology': game_rooms[room_code]['topology'],
        'host_token': new_token,
        'host_epoch': new_epoch
    })


@socketio.on('return_to_lobby')
def return_to_lobby(data):
    """Host returned to the lobby: reset room state so subsequent joins are
    treated as fresh lobby joins, not mid-race late joins. Requires valid host
    token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid return_to_lobby payload'})
        return

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

    game_rooms[room_code]['game_state'] = 'waiting'
    game_rooms[room_code]['disconnected_players'] = {}
    emit('returned_to_lobby', to=room_code)
    logger.info(f"Room {room_code} returned to lobby")


@socketio.on('player_control_update')
def player_control_update(data):
    """
    Handle player control updates.
    Very simple, as all we need to do is some model validation and then pass through the controls as is to the correct room!
    """
    if not isinstance(data, dict):
        return

    # The sending socket is authoritative for controller identity. We still
    # accept the legacy payload `player_id` field, but only as a consistency
    # check so a duplicate tab or spoofing client cannot impersonate another
    # seat.
    player_sid = request.sid
    room_code = (data.get('room_code') or '').upper()
    controls = data.get('controls')
    timestamp = data.get('timestamp')
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
    if not host_sid:
        return

    player_data = room.get('players', {}).get(player_sid)
    if not player_data:
        return

    declared_player_id = data.get('player_id')
    if declared_player_id not in (None, player_data['id']):
        return

    # Validate control values are within expected ranges
    try:
        steering = max(-1.0, min(1.0, float(controls.get('steering', 0))))
        acceleration = max(0.0, min(1.0, float(controls.get('acceleration', 0))))
        braking = max(0.0, min(1.0, float(controls.get('braking', 0))))
    except (TypeError, ValueError):
        return

    # Create validated control update
    control_update = {
        'player_id': player_data['id'],
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
    import time

    player_name = data.get('player_name', 'Player')
    room_code = data.get('room_code', '').upper()
    reconnect_id = data.get('reconnect_id')  # Optional: for reconnection

    # Validate room code
    if not room_code or room_code not in game_rooms:
        emit('error', {'message': 'Invalid room code'})
        return

    # Get room
    room = game_rooms[room_code]

    # Check for reconnection - allow during racing if player was disconnected
    is_reconnecting = False
    reconnect_data = None

    if reconnect_id and reconnect_id in room.get('disconnected_players', {}):
        # Player is reconnecting
        reconnect_data = room['disconnected_players'][reconnect_id]
        # Only allow reconnection within 5 minutes
        if time.time() - reconnect_data.get('disconnect_time', 0) < 300:
            is_reconnecting = True
            del room['disconnected_players'][reconnect_id]
            logger.info(f"Player {player_name} reconnecting to room {room_code}")

    # Check game state for join eligibility
    is_late_join = room['game_state'] == 'racing' and not is_reconnecting

    # Block joins only when race is finished (allow late joins during racing)
    if room['game_state'] == 'finished' and not is_reconnecting:
        emit('error', {'message': 'Race has ended. Wait for next race.'})
        return

    # Rejoin while the old socket is still lingering (e.g. page reload before
    # the disconnect fires): take over the stale entry instead of duplicating
    # the player in the room
    stale_sid = None
    if reconnect_id and not is_reconnecting:
        for sid, player in room['players'].items():
            if player['id'] == reconnect_id and sid != request.sid:
                stale_sid = sid
                break

    if is_reconnecting and reconnect_data:
        # Restore player with same ID and color
        player_id = reconnect_id
        car_color = reconnect_data['car_color']
        position = reconnect_data['position']
        rotation = reconnect_data['rotation']
        velocity = reconnect_data['velocity']
    elif stale_sid:
        stale_player = room['players'].pop(stale_sid)
        # Tell the host to drop the ghost before the rejoin lands
        emit('player_left', {
            'player_id': stale_player['id'],
            'player_name': stale_player['name'],
            'can_reconnect': False
        }, to=room['host_sid'])
        logger.info(f"Player {player_name} rejoined room {room_code}, replacing stale session")

        player_id = stale_player['id']
        car_color = stale_player['car_color']
        position = stale_player['position']
        rotation = stale_player['rotation']
        velocity = [0, 0, 0]
    else:
        # Monotonic player ID - counting current players is collision-prone
        # (a leaver shrinks the count and the next joiner duplicates an ID)
        player_id = room.get('next_player_id', len(room['players']) + 1)
        room['next_player_id'] = player_id + 1
        # Generate random car color
        car_color = f"#{random.randint(0, 0xFFFFFF):06x}"
        position = [0, 0.5, 0]
        rotation = [0, 0, 0]
        velocity = [0, 0, 0]

    # Add player to room
    room['players'][request.sid] = {
        'id': player_id,
        'name': player_name,
        'car_color': car_color,
        'position': position,
        'rotation': rotation,
        'velocity': velocity,
        'controls': {
            'steering': 0,
            'acceleration': 0,
            'braking': 0
        }
    }

    # Join Socket.IO room
    join_room(room_code)

    # Player roles are CAPABILITIES, derived from topology (kept separate from
    # the ruleset `mode`). A participant may hold more than one:
    #   * Local  -> ['controller']  (input + HUD only; the host renders the
    #               shared world -- enforced regardless of any can_render hint).
    #   * Remote -> ['controller','viewer']  (driver-viewer: drives + renders).
    #   * Mixed  -> ['controller'] for co-located HUD-only players, or
    #               ['controller','viewer'] for those that render (can_render).
    room_topology = room.get('topology', DEFAULT_TOPOLOGY)
    can_render = bool(data.get('can_render'))
    player_roles = participant_roles(room_topology, can_render=can_render)
    player_role = primary_role(room_topology, can_render=can_render)

    # Notify player they've joined
    emit('game_joined', {
        'player_id': player_id,
        'name': player_name,
        'car_color': car_color,
        'reconnected': is_reconnecting,
        'is_late_join': is_late_join,
        'game_state': room['game_state'],
        'mode': room.get('mode', DEFAULT_RULESET),
        'topology': room_topology,
        'role': player_role,
        'roles': player_roles
    })

    # Notify everyone in the room about new/reconnected player (including host)
    # Using room broadcast instead of direct emit to host_sid for better reliability
    event_name = 'player_reconnected' if is_reconnecting else 'player_joined'
    emit(event_name, {
        'id': player_id,
        'name': player_name,
        'car_color': car_color,
        'position': position,
        'rotation': rotation,
        'velocity': velocity
    }, room=room_code)

    action = "reconnected to" if is_reconnecting else "joined"
    logger.info(f"Player {player_name} (ID: {player_id}) {action} room {room_code}")

@socketio.on('start_game')
def start_game(data):
    """Host starts the game in a room. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid start_game payload'})
        return

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

    game_rooms[room_code]['game_state'] = 'racing'
    emit('game_started', to=room_code)
    logger.info(f"Game started in room {room_code}")


@socketio.on('end_game')
def end_game(data):
    """Host publishes the reliable end-of-match results snapshot. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid results payload'})
        return

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

    room['game_state'] = 'finished'
    payload = {
        'room_code': room_code,
        'mode': room.get('mode', DEFAULT_RULESET),
        'topology': room.get('topology', DEFAULT_TOPOLOGY),
        'results': results
    }
    if seq is not None:
        payload['seq'] = seq

    emit('game_end', payload, room=room_code)
    logger.info(f"Game ended in room {room_code}")

@socketio.on('mode_selected')
def mode_selected(data):
    """Host broadcasts mode selection to all players. Requires valid host token and epoch."""
    if not isinstance(data, dict):
        emit('error', {'message': 'Invalid mode_selected payload'})
        return

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
    player_sid = request.sid
    room_code = data.get('room_code')
    position = data.get('position')
    rotation = data.get('rotation')
    velocity = data.get('velocity')
    
    if (room_code not in game_rooms or 
        player_sid not in game_rooms[room_code]['players'] or
        game_rooms[room_code]['game_state'] != 'racing'):
        return
    
    # Update player data
    player_data = game_rooms[room_code]['players'][player_sid]
    player_data['position'] = position
    player_data['rotation'] = rotation
    player_data['velocity'] = velocity
    
    # Send update to host
    emit('player_position_update', {
        'player_id': player_data['id'],
        'position': position,
        'rotation': rotation,
        'velocity': velocity
    }, to=game_rooms[room_code]['host_sid'])

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    import time

    client_sid = request.sid

    # Check if disconnected client was a host
    for room_code, room_data in list(game_rooms.items()):
        if room_data['host_sid'] == client_sid:
            # Host disconnected, notify all players and close the room
            emit('host_disconnected', to=room_code)
            del game_rooms[room_code]
            logger.info(f"Host disconnected, room {room_code} closed")
            break

        # Check if disconnected client was a player
        if client_sid in room_data['players']:
            player_data = room_data['players'][client_sid]
            player_id = player_data['id']

            # If game is racing, save player state for reconnection
            if room_data['game_state'] == 'racing':
                room_data['disconnected_players'][player_id] = {
                    'name': player_data['name'],
                    'car_color': player_data['car_color'],
                    'position': player_data['position'],
                    'rotation': player_data['rotation'],
                    'velocity': player_data['velocity'],
                    'disconnect_time': time.time()
                }
                logger.info(f"Player {player_data['name']} disconnected (can reconnect) from room {room_code}")
            else:
                logger.info(f"Player {player_data['name']} disconnected from room {room_code}")

            del room_data['players'][client_sid]

            # Notify host about player disconnect
            emit('player_left', {
                'player_id': player_id,
                'player_name': player_data['name'],
                'can_reconnect': room_data['game_state'] == 'racing'
            }, to=room_data['host_sid'])

            break

@socketio.on('reset_player_position')
def handle_reset_position(data):
    """Handle resetting a player's position.
    Requires valid host token and epoch (destructive host action).
    """
    if not isinstance(data, dict):
        return

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

    # Find the player in the room
    player_sid = None
    for sid, player_data in game_rooms[room_code]['players'].items():
        if player_data['id'] == player_id:
            player_sid = sid
            # Update player position and rotation
            player_data['position'] = position
            player_data['rotation'] = rotation
            player_data['velocity'] = [0, 0, 0]  # Reset velocity

            logger.info(f"Resetting position for player {player_id} in room {room_code} to {position}")

            # Notify the player to reset their position
            emit('position_reset', {
                'position': position,
                'rotation': rotation
            }, to=sid)

            # Also notify the host for visual updates
            emit('player_position_update', {
                'player_id': player_id,
                'position': position,
                'rotation': rotation,
                'velocity': [0, 0, 0]
            }, to=game_rooms[room_code]['host_sid'])
            break
            
@socketio.on('weapon_fire')
def handle_weapon_fire(data):
    """Handle weapon fire event from player."""
    player_sid = request.sid
    room_code = data.get('room_code')

    if not room_code or room_code not in game_rooms:
        return

    room = game_rooms[room_code]
    if player_sid not in room['players']:
        return

    player_data = room['players'][player_sid]
    player_id = player_data['id']

    # Forward to host
    emit('weapon_fire', {
        'player_id': player_id
    }, to=room['host_sid'])

    logger.debug(f"Player {player_id} fired weapon in room {room_code}")

@socketio.on('request_car_reset')
def handle_request_car_reset(data):
    """Player asks the host to un-stick their car (reset to a safe spot)."""
    player_sid = request.sid
    room_code = data.get('room_code')

    if not room_code or room_code not in game_rooms:
        return

    room = game_rooms[room_code]
    if player_sid not in room['players']:
        return

    player_id = room['players'][player_sid]['id']
    emit('car_reset_request', {'player_id': player_id}, to=room['host_sid'])
    logger.info(f"Player {player_id} requested car reset in room {room_code}")

@socketio.on('weapon_pickup')
def handle_weapon_pickup(data):
    """Handle weapon pickup notification from host to player.
    Requires valid host token and epoch (not just host SID).
    """
    if not isinstance(data, dict):
        return

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

    # Find target player's socket
    for sid, player_data in room['players'].items():
        if player_data['id'] == target_player_id:
            emit('weapon_pickup', {
                'weaponId': data.get('weaponId'),
                'weaponName': data.get('weaponName'),
                'icon': data.get('icon')
            }, to=sid)
            break

@socketio.on('weapon_fired')
def handle_weapon_fired(data):
    """Handle weapon fired notification from host to player.
    Requires valid host token and epoch (not just host SID).
    """
    if not isinstance(data, dict):
        return

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

    # Find target player's socket
    for sid, player_data in room['players'].items():
        if player_data['id'] == target_player_id:
            emit('weapon_fired', {
                'weaponId': data.get('weaponId')
            }, to=sid)
            break

@socketio.on('update_player_name')
def update_player_name(data):
    """Handle player name update."""
    player_sid = request.sid
    new_name = data.get('name', '').strip()
    
    if not new_name:
        emit('name_updated', {'success': False, 'message': 'Invalid name'})
        return
    
    # Find which room the player is in
    for room_code, room_data in game_rooms.items():
        if player_sid in room_data['players']:
            # Update player name
            old_name = room_data['players'][player_sid]['name']
            room_data['players'][player_sid]['name'] = new_name
            
            # Notify player that name was updated
            emit('name_updated', {
                'success': True,
                'name': new_name
            })
            
            # Notify host about player name change
            emit('player_name_updated', {
                'player_id': room_data['players'][player_sid]['id'],
                'name': new_name
            }, to=room_data['host_sid'])
            
            logger.info(f"Player name changed in room {room_code}: {old_name} -> {new_name}")
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    # Debug stays on for local development; deployments set FLASK_DEBUG=0
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)
