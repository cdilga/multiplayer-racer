---
name: jammers-game-probe
description: See, set, step and assert Joystick Jammers 0.2's simulation as data through the `jj` CLI (jj sim, jj validate, jj procgen) and the browser host's test surface (window.__jjTest, P1-F05b) - run a scenario, read its outcome envelopes, tune a value with --set, sweep it, compare against an accepted trace, replay a bug clip, or turn an observed behaviour into a fixture. Use when a bead touches car feel, physics, race rules, damage, procgen or anything the sim decides; when a car "feels wrong", a scenario fails, a number needs measuring rather than guessing, or a bug needs reproducing; or before changing jj-sim, jj-map or jj-procgen.
---

# Jammers game probe (R90: everything introspectable, settable, steppable, fixture-testable)

The game's state is data. Don't eyeball a running game to decide whether something is right: load a fixture, step it,
read the JSON, assert an envelope. The tools are `jj` (native, `crates/jj-tools`) and, in a browser, the host's test
surface `window.__jjTest` (`web/host/src/testing/testing.ts`). Plan: §13a ("validation in the loop"), §13b.2.

**Where it runs:** on eris through `scripts/remote/eris.sh` (it syncs the clone to your pushed HEAD first), or through
RCH for uncommitted Rust (`rch exec -- cargo …`). Never workspace-wide cargo on the Mac.

**Distilled from** steps repeated in two closed beads: **P1-S03** (vehicle feel bank: run the bank, read envelopes,
`--set` and `--sweep` a tuning field, `--compare` against the accepted trace) and **P1-S09** (skill-payoff duels:
the same loop over `scenarios/duels/`). P1-F05a and P1-F05b built the tools.

## The commands (ask `jj`, don't restate it)

```bash
cargo run -q --locked -p jj-tools --bin jj -- --help        # validate, sim, procgen, vehicle sync
cargo run -q --locked -p jj-tools --bin jj -- sim --help    # every sim mode with examples
```

`jj sim` loads a fixture (`scenarios/**/*.json`), runs it, writes `target/jj-runs/sim-<scenario>/` (outcome.json,
journal.bin, trace.jsonl with `--trace`), replays its own journal to the same full-state hash, and exits **0** when every
envelope holds and the replay matches, **1** when not (printing observed vs envelope), **2** on usage. The bank is
`jj sim --json scenarios/*.json`; CI runs it inside `cargo test` (the `scenarios` lane).

## Worked example (eris, about a minute)

```bash
scripts/remote/eris.sh --run probe-demo 'cargo run -q --locked -p jj-tools --bin jj -- sim scenarios/straight-throttle.json; echo "exit $?"; cargo run -q --locked -p jj-tools --bin jj -- sim --set max_engine_force=4000 scenarios/straight-throttle.json; echo "exit $?"'
```

Stated result (game commit f830de5):
- the first run prints `pass straight-throttle (720 ticks, state a9180304738c…, replay matches)` then seven `ok`
  lines, e.g. `ok  car 0 @   720 forwardSpeed = 23.038 in [15, 35]`, and `exit 0`;
- the tuned run (`--set max_engine_force=4000`, about half the Cruz's force) prints `FAIL straight-throttle … replay
  matches`, `tuned: max_engine_force=4000`, one `BAD car 0 @   720 forwardSpeed = 13.169 NOT in [15, 35]`, the full
  outcome signature, and `exit 1`.

Read it as: the sim is deterministic (the replay matched both times), and the envelope caught the weaker engine at
tick 720. That is the loop for any tuning question: change one value with `--set`, see which envelope moves, then
`--sweep max_engine_force=3000..9000:7` for a curve, then `--compare <accepted trace>` before committing a profile.

## In the browser

A host page opened with `?test=live` (or the S02 harness, `web/dist-test/harness.html`) carries `window.__jjTest`:
`observe()` (cars, seats, round, every field the snapshot has), `command({cmd, …})` (e.g. `{cmd:'autopilot', on:true}`,
`finishRace`), and frame stepping when held. The canonical caller is the public smoke
(`web/tests/smoke/smoke-flow.mjs`: it drives a car with the phone's sticks and reads `observe()` until the car moved
3 m at 4 m/s). Production builds answer `/test/` with 404 (F05b's realm gate), so this only works on test and preview
realms.

## Turning a behaviour into a fixture

Copy the nearest scenario, set the cars, seats and phase it needs, run it until the behaviour shows, and pin its
outcome as an envelope (not an exact float). A bug from the browser comes back as a clip: `jj sim --replay
<clip>.jjclip --trace` re-simulates it from its map bytes, seed and journal, from the same build only.

## Traps

`docs/learnings/sim.md` (Rapier's vehicle facts: engine force integrates with dt, brake is an impulse per tick, ghosts
need explicit groups, decisive maths through libm) and `docs/learnings/procgen.md`.
