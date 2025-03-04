from flask import Flask, render_template, request, jsonify, send_file
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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='../static', template_folder='../frontend')
app.config['SECRET_KEY'] = 'race_game_secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# Game rooms dictionary
# Structure: {
#   'room_code': {
#     'host_sid': host_session_id,
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
#     'game_state': 'waiting'|'racing'|'finished'
#   }
# }
game_rooms = {}

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

@app.route('/')
def index():
    """Serve the host interface."""
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
    return render_template('host/index.html', local_ip=local_ip, port=port)

@app.route('/player')
def player():
    """Serve the player interface."""
    # Get room code from query parameters if available
    room_code = request.args.get('room', '')
    return render_template('player/index.html', room_code=room_code)

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
        join_url = f"http://{local_ip}:{port}/player?room={room_code}"
        
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

@app.route('/test/car')
def car_test():
    """Serve the car model test page."""
    return render_template('test/car-test.html')

@socketio.on('create_room')
def create_room(data):
    """Host creates a new game room."""
    host_sid = request.sid
    room_code = generate_room_code()
    
    # Ensure room code is unique
    while room_code in game_rooms:
        room_code = generate_room_code()
    
    game_rooms[room_code] = {
        'host_sid': host_sid,
        'players': {},
        'game_state': 'waiting'
    }
    
    join_room(room_code)
    emit('room_created', {'room_code': room_code})
    logger.info(f"Room created: {room_code}")

@socketio.on('player_control_update')
def player_control_update(data):
    """
    Handle player control updates.
    Very simple, as all we need to do is some model validation and then pass through the controls as is to the correct room!
    """
    # Extract data from control update
    player_sid = data.get('player_id')  # Get player ID from the data payload instead of request.sid
    room_code = data.get('room_code')
    controls = data.get('controls', {})
    timestamp = data.get('timestamp')

    # Debug log the raw control update
    logger.debug(f"Received control update from player {player_sid}: {data}")

    # Validate required fields
    if not all([player_sid, room_code, controls, timestamp]):
        logger.info(f"Invalid control update data received: {data}")
        return
    
    # Validate control values are within expected ranges
    steering = max(-1.0, min(1.0, float(controls.get('steering', 0))))
    acceleration = max(0.0, min(1.0, float(controls.get('acceleration', 0)))) 
    braking = max(0.0, min(1.0, float(controls.get('braking', 0))))

    # Create validated control update
    control_update = {
        'player_id': player_sid,
        'steering': steering,
        'acceleration': acceleration, 
        'braking': braking,
        'timestamp': timestamp
    }

    # Debug log the validated control values
    logger.info(f"Validated controls for player {player_sid}: steering={steering:.2f}, " 
                f"acceleration={acceleration:.2f}, braking={braking:.2f}")

    # Forward the control update to all clients in the room
    emit('player_controls_update', control_update, room=room_code)
    
    # Debug log the broadcast
    logger.info(f"Broadcasted control update to room {room_code}")
    
    if not room_code or room_code not in game_rooms:
        logger.warning(f"Player {player_sid} sent control update for non-existent room {room_code}")
        return
    


@socketio.on('join_game')
def on_join_game(data):
    """Handle player joining a game room"""
    player_name = data.get('player_name', 'Player')
    room_code = data.get('room_code', '').upper()
    
    # Validate room code
    if not room_code or room_code not in game_rooms:
        emit('error', {'message': 'Invalid room code'})
        return
    
    # Get room
    room = game_rooms[room_code]
    
    # Check if game already started
    if room['game_state'] != 'waiting':
        emit('error', {'message': 'Game already in progress'})
        return
    
    # Generate player ID (1-based index)
    player_id = len(room['players']) + 1
    
    # Generate random car color
    car_color = f"#{random.randint(0, 0xFFFFFF):06x}"
    
    # Add player to room
    room['players'][request.sid] = {
        'id': player_id,
        'name': player_name,
        'car_color': car_color,
        'position': [0, 0.5, 0],  # Default starting position
        'rotation': [0, 0, 0],    # Default rotation
        'velocity': [0, 0, 0],    # Default velocity
        'controls': {
            'steering': 0,
            'acceleration': 0,
            'braking': 0
        }
    }
    
    # Join Socket.IO room
    join_room(room_code)
    
    # Notify player they've joined
    emit('game_joined', {
        'player_id': player_id,
        'name': player_name,
        'car_color': car_color
    })
    
    # Notify host about new player
    emit('player_joined', {
        'id': player_id,
        'name': player_name,
        'car_color': car_color,
        'position': [0, 0.5, 0],
        'rotation': [0, 0, 0],
        'velocity': [0, 0, 0]
    }, room=room['host_sid'])
    
    logger.info(f"Player {player_name} (ID: {player_id}) joined room {room_code}")

@socketio.on('start_game')
def start_game(data):
    """Host starts the game in a room."""
    room_code = data.get('room_code')
    host_sid = request.sid
    
    if room_code not in game_rooms:
        emit('error', {'message': 'Room not found'})
        return
    
    if game_rooms[room_code]['host_sid'] != host_sid:
        emit('error', {'message': 'Only the host can start the game'})
        return
    
    game_rooms[room_code]['game_state'] = 'racing'
    emit('game_started', to=room_code)
    logger.info(f"Game started in room {room_code}")

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
            del room_data['players'][client_sid]
            
            # Notify host about player disconnect
            emit('player_left', {
                'player_id': player_data['id'],
                'player_name': player_data['name']
            }, to=room_data['host_sid'])
            
            logger.info(f"Player {player_data['name']} disconnected from room {room_code}")
            break

@socketio.on('reset_player_position')
def handle_reset_position(data):
    """Handle resetting a player's position."""
    room_code = data.get('room_code')
    player_id = data.get('player_id')
    position = data.get('position')
    rotation = data.get('rotation')
    
    if not room_code or room_code not in game_rooms:
        logger.error(f"Reset position: Room {room_code} not found")
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True) 