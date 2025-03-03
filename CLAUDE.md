# Multiplayer Racer Development Guide

## Server Commands
- Run server: `python server/app.py`
- Run IP detection test: `python server/test_ip_detection.py`
- Install dependencies: `pip install -r requirements.txt`

## Testing
- Open host interface: `http://localhost:8000/`
- Test car models: `http://localhost:8000/test/car`
- Manual testing via multiple browsers/devices

## Code Style Guidelines
- **Python**: Follow PEP 8 conventions
  - 4-space indentation
  - Use descriptive variable names
  - Add docstrings for functions and classes
  - Proper error handling with try/except

- **JavaScript**:
  - 4-space indentation
  - Use camelCase for variables and functions
  - Group related functions together
  - Use constants for configuration values
  - Comment complex logic and physics calculations

- **Error Handling**:
  - Log errors with appropriate levels
  - Provide user-friendly error messages
  - Fail gracefully with fallbacks when possible

## Architecture
- Server: Flask + Socket.IO (Python)
- Frontend: Three.js for 3D rendering
  - Host will host a game on a big screen
  - Player gives a controller interface to mobile devices
- Communication: Real-time via WebSockets