# Draft Status Note: br-around-couch-risk-resolution-3xv.7

**Date:** 2026-06-30  
**Worker:** AuroraForge  
**Bead:** br-around-couch-risk-resolution-3xv.7 (Race finish grace)  
**Status:** DRAFT - HALTED (Blocked by dependencies)

## Work Done (Not to be Committed)

Created draft test specifications to validate implementation approach:

**Files Created (Draft):**
- `tests/unit/race-finish-grace.test.js` — Test specification for grace timer, DNF ranking, late-join logic (linter has since modified this)
- `tests/integration/race-lifecycle.test.js` — Integration test spec for full race lifecycle
- `RACE_FINISH_GRACE_EVIDENCE.md` — Documentation of test coverage and algorithm specs
- `RACE_FINISH_PLAN.md` — Implementation planning (in scratchpad)

**Status of Drafts:**
- Test file has been modified by linter (now imports RaceSystem)
- Integration test is pure logic spec (not integrated with actual RaceSystem yet)
- No implementation code in RaceSystem.js or server/app.py
- No code is ready for production

## Why Halting Now

**Blocking Dependencies:**
- `br-around-couch-risk-resolution-3xv.2` (Room-seat registry) — OPEN
- `br-captain-call-architecture-hardening-woq.11` (Join routing) — OPEN

Cannot proceed with:
- Claiming bead (technical blocker prevents br update)
- Integrating with actual RaceSystem (room-seat registry needed)
- Server handler (join routing needed for proper state)
- E2E tests (depends on routing implementation)

## Next Steps

**Do Not:**
- Commit draft test files or evidence docs
- Post READY for validation
- Close or update bead status
- Edit additional .7 files

**Await:**
- Blocker resolution (.2 and .11 to move to in_progress/closed)
- Coordinator reauthorization to proceed with implementation

**If Blockers Clear:**
- Worker can claim bead
- Integrate test specs with actual RaceSystem implementation
- Re-run full test suite (unit + integration + E2E)
- Request fresh validation

## Notes for Next Worker

**What's Useful From This Draft:**
- Test specification captures all acceptance criteria
- Algorithm docs (DNF ranking, late-join window) are detailed and testable
- Edge cases identified and covered

**What Needs Rework:**
- Linted test file imports RaceSystem but doesn't implement it
- Integration tests are pure-logic specs, not actual integration tests
- No E2E coverage (depends on blocker resolution)

---

**Status:** Awaiting blocker resolution and coordinator decision.  
**Do Not Merge:** These are draft specifications only.
