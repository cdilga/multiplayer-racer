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

@socketio.on('join_game')
def join_game(data):
    """Player joins an existing game room."""
    player_sid = request.sid
    room_code = data.get('room_code', '').upper()
    player_name = data.get('player_name', 'Player')
    
    if room_code not in game_rooms:
        emit('join_error', {'message': 'Room not found'})
        return
    
    # Generate random car color
    car_color = f"#{random.randint(0, 0xFFFFFF):06x}"
    
    # Add player to room
    player_id = len(game_rooms[room_code]['players']) + 1
    game_rooms[room_code]['players'][player_sid] = {
        'id': player_id,
        'name': player_name,
        'car_color': car_color,
        'position': [0, 0.5, -20 + (player_id * 3)],  # Staggered starting positions
        'rotation': [0, 0, 0],
        'velocity': [0, 0, 0]
    }
    
    join_room(room_code)
    
    # Notify player they've joined
    emit('game_joined', {
        'player_id': player_id,
        'player_name': player_name,
        'car_color': car_color
    })
    
    # Notify host about new player
    emit('player_joined', game_rooms[room_code]['players'][player_sid], 
         to=game_rooms[room_code]['host_sid'])
    
    logger.info(f"Player {player_name} joined room {room_code}")
    
    # If game is already in progress, immediately send game_started to this player
    if game_rooms[room_code]['game_state'] == 'racing':
        emit('game_started')

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
    
    if not player_sid:
        logger.error(f"Reset position: Player {player_id} not found in room {room_code}")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True) 