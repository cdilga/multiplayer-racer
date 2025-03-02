from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import random
import string
import json
import logging

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

def generate_room_code(length=4):
    """Generate a random room code of uppercase letters."""
    return ''.join(random.choices(string.ascii_uppercase, k=length))

@app.route('/')
def index():
    """Serve the host interface."""
    return render_template('host/index.html')

@app.route('/player')
def player():
    """Serve the player interface."""
    return render_template('player/index.html')

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
    
    if game_rooms[room_code]['game_state'] != 'waiting':
        emit('join_error', {'message': 'Game already in progress'})
        return
    
    # Generate random car color
    car_color = f"#{random.randint(0, 0xFFFFFF):06x}"
    
    # Add player to room
    player_id = len(game_rooms[room_code]['players']) + 1
    game_rooms[room_code]['players'][player_sid] = {
        'id': player_id,
        'name': player_name,
        'car_color': car_color,
        'position': [0, 0, player_id * 2],  # Staggered starting positions
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
        return
    
    # Find the player in the room
    for sid, player_data in game_rooms[room_code]['players'].items():
        if player_data['id'] == player_id:
            # Update player position and rotation
            player_data['position'] = position
            player_data['rotation'] = rotation
            player_data['velocity'] = [0, 0, 0]  # Reset velocity
            
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
            
            return

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True) 