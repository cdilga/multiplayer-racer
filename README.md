# Multiplayer Racing Game

A real-time multiplayer racing game built with Python and Three.js. Players join a game room on their mobile devices and race against each other, with a host screen displaying all cars in the race.

## Features

- Mobile-first design with touch controls
- Room-based multiplayer with join codes (similar to Kahoot/Jackbox)
- 3D rendering with Three.js
- Real-time updates via WebSockets
- Basic car physics and controls
- Host screen to view all racers at once

## Tech Stack

- **Backend**: Python with Flask and Socket.IO
- **Frontend**: HTML, CSS, JavaScript with Three.js for 3D rendering
- **Communication**: WebSockets via Socket.IO
- **Physics**: Simple custom physics implementation (with optional Cannon.js support)

## Prerequisites

- Python 3.7+
- pip (Python package manager)
- Modern web browser with WebGL support

## Installation

1. Clone the repository:

```bash
git clone https://github.com/your-username/multiplayer-racer.git
cd multiplayer-racer
```

2. Install the Python dependencies:

```bash
pip install -r requirements.txt
```

## Running the Game

1. Start the Python server:

```bash
python server/app.py
```

2. Open the host interface in a web browser:

```
http://localhost:8000/
```

3. Create a game room by clicking the "Create Game Room" button.

4. Players can join the game on their mobile devices by navigating to the displayed URL or by entering the room code.

5. Start the race when all players have joined.

## Game Controls

### Mobile Controls
- Use the virtual joystick on the left side of the screen to steer
- Tap and hold the acceleration button (up arrow) to accelerate
- Tap and hold the brake button (down arrow) to brake

### Keyboard Controls (for testing)
- Arrow keys: Up (accelerate), Down (brake), Left/Right (steering)

## Project Structure

- `server/`: Python server and backend logic
  - `app.py`: Main server file with Flask and Socket.IO
- `frontend/`: Frontend HTML files
  - `host/`: Host interface
  - `player/`: Player interface
- `static/`: Static assets
  - `css/`: CSS stylesheets
  - `js/`: JavaScript files
    - `host.js`: Host interface logic
    - `player.js`: Player interface logic
    - `trackBuilder.js`: Track creation utilities
    - `carModel.js`: Car model utilities

## Extending the Game

### Adding Different Tracks

Modify the `trackBuilder.js` file to add new track shapes and configurations. The track building system is modular and can be extended for more complex tracks.

### Improving Physics

For more realistic physics, you can integrate a full physics engine like Cannon.js or Ammo.js. The current implementation uses a simplified custom physics system.

### Adding Multiplayer Features

Potential enhancements:
- Race position tracking
- Lap counting
- Collision detection between cars
- Power-ups and obstacles
- Different car types with varying attributes

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Three.js for 3D rendering
- Flask and Socket.IO for the server implementation
- nipplejs for touch joystick controls 
