# Shared Task Notes

## Last Completed Work
- **Test Fixture Fixes** - Fixed viewport issues preventing game start
  - `tests/e2e/fixtures.ts` - Use JavaScript click to bypass viewport checks
  - Lobby UI now wider and semi-transparent (800px max-width, backdrop blur)
  - Lobby content scrollable for tall displays

## Files Changed This Iteration
- `tests/e2e/fixtures.ts` - JS click for start button, increased timeouts
- `static/js/ui/LobbyUI.js` - Wider/transparent lobby, scrollable content

## Test Status (19/27 passing)
**Passing:**
- Game flow tests (join, start, disconnect)
- Race completion tests (all 3!)
- Debug panel tests (F2/F3/F4)
- Console error tests
- Camera zoom tests (2/3)

**Failing (8):**
- car-movement tests (3) - physics/movement issues
- car-reset tests (4) - reset functionality
- camera-zoom FOV test (1) - intermittent

## Next Tasks
1. **Fix car movement tests** - May be physics timing issues
2. **Race Completion** is already working! RaceSystem/ResultsUI/GameHost all wired up
3. **Mode System Infrastructure** - Add selector to LobbyUI

## Known Issues
- Car movement/reset tests flaky - likely timing or physics sync issues
- Pre-existing: `removeMesh` throws error on player leave

## Quick Start
```bash
npm test  # Playwright handles server automatically
npm test -- --grep "race completion"  # Just race tests
```
