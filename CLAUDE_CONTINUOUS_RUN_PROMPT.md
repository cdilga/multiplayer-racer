# Joystick Jammers - Ralph Wiggum Prompt

## Your Mission

Implement features from `GAME_IMPROVEMENT_IDEAS.md` in priority order, following TDD.

---

## Priority #1: Test Optimization

**Read `TEST_OPTIMISATION_SPEC.md` first** - this is the current blocking task.

Target: Reduce test time from ~50 min to <5 min without losing coverage.

---

## Workflow

1. **Read the roadmap:** `GAME_IMPROVEMENT_IDEAS.md`
2. **Pick the top incomplete item** (currently: Test Optimization)
3. **Follow TDD from `CLAUDE.md`:**
   - Write failing test
   - Implement minimal code
   - Run `npm test`
   - Commit when green
4. **Update `GAME_IMPROVEMENT_IDEAS.md`** when completing items
5. **Move to next priority item**

---

## Key Files

| Purpose | File |
|---------|------|
| Roadmap | `GAME_IMPROVEMENT_IDEAS.md` |
| Test optimization spec | `TEST_OPTIMISATION_SPEC.md` |
| Dev workflow | `CLAUDE.md` |
| Strategic vision | `PROJECT_DIRECTION.md` |
| Future ideas | `IDEAS_NEEDING_REFINEMENT.md` |

---

## Commands

```bash
npm test              # Run all tests
npm run test:headed   # Run with visible browser
python server/app.py  # Start server (separate terminal)
```

---

## Decision Framework

When stuck, ask:
1. Does it make destruction/chaos more fun? → Do it
2. Does it improve visual spectacle? → High priority
3. Does it reduce complexity while keeping fun? → Do it
4. None of the above? → Defer or simplify

---

## Commit After Each Feature

```bash
git add .
git commit -m "feat: [description]"
git push origin main
```

---

**Start now: Read `TEST_OPTIMISATION_SPEC.md` and begin test optimization.**
