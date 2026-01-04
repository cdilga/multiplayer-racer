# Shared Task Notes

## Last Completed Work
- **Dynamic Camera Zoom** implemented in `RenderSystem.js`
  - Multi-vehicle camera tracking that keeps all vehicles visible
  - FOV adjusts (30-100°) based on vehicle spread
  - Camera centers on average position of all vehicles
  - 3 new e2e tests in `tests/e2e/camera-zoom.spec.ts` - all passing

## Files Changed This Iteration
- `static/js/systems/RenderSystem.js` - Added multi-vehicle camera logic
- `static/js/GameHost.js` - Added `addCameraTarget()` and `removeCameraTarget()` calls
- `tests/e2e/camera-zoom.spec.ts` - New test file

## Next Tasks (Priority Order from IMPLEMENTATION_PLAN.md)
1. **Mode System Infrastructure** (Phase 3)
   - Add mode selector to LobbyUI.js (Race/Derby/Fight)
   - Store mode in GameHost.js settings
   - Pass mode to systems (RaceSystem)

2. **Visual Destruction Effects** (Phase 4)
   - Explosion particle effects when vehicle destroyed
   - Smoke effect at 10% health
   - Debris physics

## Known Issues
- Pre-existing: `removeMesh` throws error `mesh.traverse is not a function` when player leaves
- Pre-existing: Rapier physics errors after vehicle removal (existing tests still pass)
- These are test cleanup issues, not gameplay bugs

## Test Status
- Camera zoom tests: 3/3 passing
- All pre-existing tests continue to work (verified first 16 tests)
- Full test suite: ~27 tests total

## Quick Start Commands
```bash
pyenv activate multiplayer-racer
python server/app.py  # Terminal 1
npm test              # Terminal 2 (all tests)
npm test -- --grep "camera-zoom"  # Just camera tests
```
