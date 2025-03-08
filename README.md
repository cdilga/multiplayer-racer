# Multiplayer Racer

A multiplayer racing game with physics using Three.js, Rapier physics, and Socket.IO.

## Recent Updates

### Physics Engine Upgrade
- Replaced Cannon.js with Rapier physics for improved performance and stability
- Added better car physics with more realistic handling
- Fixed issues with mesh synchronization between physics and rendering

### Rendering Fixes
- Fixed the issue with Three.js scene not rendering until screen resize
- Added forced DOM rendering to ensure the game displays correctly on initialization
- Improved window resize handling with fallback dimensions

### Player Experience Improvements
- Added random name generator with GitHub-style naming (adjective + noun)
- Players can now set custom names before joining a game
- Added ability to update player names during the waiting phase
- Improved UI for player name input with a dice button for random names

## Setup and Installation

### Prerequisites
- Node.js (for frontend dependencies)
- Python 3.7+ (for the server)
- pip (Python package manager)

### Server Setup
1. Clone the repository
2. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Install Node.js dependencies:
   ```
   npm install
   ```

### Running the Game
1. Start the server:
   ```
   python server/app.py
   ```
2. Open a browser and navigate to:
   ```
   http://localhost:8000
   ```
3. Create a game room on the host screen
4. Connect with mobile devices using the displayed QR code or room code

## Development

### Project Structure
- `server/` - Flask and Socket.IO server
- `frontend/` - HTML templates for host and player views
- `static/` - JavaScript, CSS, and other static assets
- `static/js/rapierPhysics.js` - Rapier physics integration

### Building for Production
1. Build the frontend assets:
   ```
   npm run build
   ```
2. Deploy the server and built assets to your hosting environment

## Technologies Used
- Three.js for 3D rendering
- Rapier physics for realistic car physics
- Socket.IO for real-time communication
- Flask for the web server
- Vite for frontend build tooling

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

### Adding Multiplayer Features

Potential enhancements:
- Race position tracking
- Lap counting
- Collision detection between cars
- Power-ups and obstacles
- Different car types with varying attributes

## License

Copyright © Chris Dilger
All rights reserved.

## Acknowledgments

- Three.js for 3D rendering
- Flask and Socket.IO for the server implementation
- nipplejs for touch joystick controls 
