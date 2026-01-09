# Multiplayer Racer Development Guide

## Environment Setup
- Activate virtual environment: `pyenv activate multiplayer-racer`
- This must be done before running the server or any Python commands

## Server Commands
- Run server: `python server/app.py`
- Run IP detection test: `python server/test_ip_detection.py`
- Install dependencies: `pip install -r requirements.txt`

## Testing

### Running Tests
- Run all tests: `npm test`
- Run tests with UI: `npm run test:ui`
- Run tests headed (visible browser): `npm run test:headed`

### Manual Testing URLs
- Open host interface: `http://localhost:8000/`
- Test car models: `http://localhost:8000/test/car`
- Manual testing via multiple browsers/devices

## Development Workflow (TDD)

**Always follow this Test-Driven Development loop:**

```
1. Write Test (that fails)
   └─→ npm test -- --grep "your test name"

2. Verify Test Fails
   └─→ Confirm the test fails for the right reason

3. Implement Logic
   └─→ Write minimal code to make the test pass

4. Run Tests
   └─→ npm test

5. Check Visuals (if UI-related)
   └─→ npm run test:headed
   └─→ Manually verify in browser if needed

6. All Tests Pass in CI
   └─→ Push changes, verify GitHub Actions pass
```

### Example Workflow

```bash
# 1. Start the server (in one terminal)
python server/app.py

# 2. Write your test in tests/e2e/
# 3. Run specific test to see it fail
npm test -- --grep "should reset car to spawn position"

# 4. Implement the feature
# 5. Run tests again
npm test

# 6. Visual verification
npm run test:headed

# 7. Push and verify CI
git push origin your-branch
```

### Key Principles
- **Red-Green-Refactor**: Write failing test → Make it pass → Clean up
- **Test first**: Don't write implementation code without a failing test
- **Small increments**: Each test should verify one specific behavior
- **CI is truth**: Local passing isn't enough - CI must pass

## Dependency Management - CRITICAL

**NEVER use CDN links for dependencies. ALL dependencies MUST be installed via NPM and bundled.**

### Why This Matters
- CDN imports break tests and make them slow/flaky
- CDN imports bypass our bundling tooling
- CDN imports create network dependencies during development
- CDN imports make offline development impossible

### The Rule
```
❌ WRONG - Never do this:
"three": "https://cdn.jsdelivr.net/npm/three@0.152.0/build/three.module.js"
"@dimforge/rapier3d-compat": "https://cdn.skypack.dev/@dimforge/rapier3d-compat"

✅ CORRECT - Always do this:
npm install three @dimforge/rapier3d-compat
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
```

### If You Need a New Dependency
1. `npm install <package-name>`
2. Import it normally in your JavaScript/TypeScript
3. Let the bundler handle it
4. **NEVER** add CDN URLs to import maps or script tags

### Existing CDN References
If you encounter existing CDN references in the codebase, **convert them to NPM packages** rather than perpetuating the pattern.

### DO NOT Use Test-Time CDN Interception
**NEVER** intercept CDN requests in tests as a workaround. Route interception is a broken band-aid that:
- Still makes network requests (slow)
- Can fail intermittently
- Doesn't fix the root cause

The ONLY acceptable fix is removing CDN dependencies and using NPM + bundling.

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

## Physics Implementation (Rapier 3D)

### IMPORTANT: Use Rapier's Built-in Vehicle Controller

Rapier has a dedicated `DynamicRayCastVehicleController` class for vehicle physics.
**DO NOT** manually apply suspension forces with `addForceAtPoint()` - this is error-prone and causes instability (cars flying upward).

### Correct Implementation Pattern

```javascript
// 1. Create vehicle controller (once, during setup)
const vehicleController = world.createVehicleController(chassisRigidBody);

// 2. Add wheels with proper configuration
vehicleController.addWheel(
    {x: -1, y: 0, z: 1.5},    // Position relative to chassis
    {x: 0, y: -1, z: 0},       // Suspension direction (DOWN)
    {x: -1, y: 0, z: 0},       // Axle axis
    0.8,                        // Suspension rest length
    0.3                         // Wheel radius
);

// 3. Configure suspension for each wheel
vehicleController.setWheelSuspensionStiffness(wheelIndex, 24.0);
vehicleController.setWheelFrictionSlip(wheelIndex, 1000.0);

// 4. In game loop - set controls then update
vehicleController.setWheelEngineForce(0, engineForce);
vehicleController.setWheelEngineForce(1, engineForce);
vehicleController.setWheelSteering(0, steeringAngle);
vehicleController.setWheelSteering(1, steeringAngle);
vehicleController.setWheelBrake(2, brakeForce);
vehicleController.setWheelBrake(3, brakeForce);

// 5. Update vehicle physics (BEFORE world.step())
vehicleController.updateVehicle(deltaTime);
world.step();
```

### Key References
- Official Rapier docs: https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html
- Three.js example: https://threejs.org/examples/physics_rapier_vehicle_controller.html

### Common Mistakes to Avoid
1. **Don't** manually calculate suspension forces - Rapier does this correctly
2. **Don't** use `addForceAtPoint()` for vehicle physics - causes instability
3. **Don't** call `world.step()` before `vehicleController.updateVehicle()`
4. **Do** use reasonable mass (10-50 units for arcade feel)
5. **Do** set friction slip high enough for grip (500-1000)

### Debugging Physics Issues - IMPORTANT
**NEVER multiply/divide values by 1000x to "make it work"**

If physics isn't working (car not moving, flying away, etc):
- Don't just multiply force values by large numbers - this masks the real problem
- Don't scale parameters randomly hoping something works
- **DO** investigate the root cause: wrong API usage, order of operations, missing setup
- **DO** check if you're using the correct Rapier API for the task
- **DO** look for fundamental architectural issues (dead code, conflicting systems)
- **DO** read official documentation and examples

Example: If car won't move with engineForce=100, changing to 100000 won't fix it if
the fundamental problem is that forces aren't being applied correctly or the vehicle
controller isn't being used at all.

## Architecture Vision

This project is evolving toward a clean, data-driven architecture. See the full plan at:
`.claude/plans/typed-sauteeing-pony.md`

### Core Principles
1. **Data over Code** - Vehicles, tracks, physics params defined in JSON files
2. **Single Responsibility** - Each module does one thing well
3. **Event-Driven** - Systems communicate via EventBus, not direct references
4. **Composition** - Entity-Component pattern for flexibility

### Target Structure
```
static/
├── assets/          # JSON definitions (vehicles, tracks)
├── js/
│   ├── engine/      # Core: Engine, GameLoop, EventBus, StateMachine
│   ├── resources/   # ResourceLoader, VehicleFactory, TrackFactory
│   ├── entities/    # Entity, Vehicle, Track
│   ├── systems/     # PhysicsSystem, RenderSystem, NetworkSystem, etc.
│   ├── input/       # InputManager, TouchController
│   └── ui/          # LobbyUI, RaceUI, ResultsUI
```

### When Making Architectural Decisions
- Prefer extracting systems over adding to existing files
- Move hardcoded values to JSON configuration
- Use EventBus for inter-system communication
- Keep host.js and player.js as thin orchestrators

## Claude Agents

Specialized agents are available in the `agents/` directory. Invoke them when facing domain-specific challenges.

### Architect Agent
**Location:** `agents/architect/AGENT.md`

Call upon the Architect when facing:
- Module organization questions ("Where should this code go?")
- Decomposition guidance ("This file is too big")
- Integration patterns ("How should these systems communicate?")
- Data vs code decisions ("Should this be configurable?")
- Refactoring guidance ("This feels hacky")

The Architect ensures artisan-quality abstractions that are elegant, maintainable, and a joy to work with.