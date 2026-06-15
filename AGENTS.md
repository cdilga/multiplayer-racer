# Agent Instructions

This repository uses `br` (Beads Rust) for task tracking and `bv` for graph-aware triage.

## Coordination

- Register with MCP Agent Mail at the start of every session using this project key:
  `/Users/cdilga/Documents/dev/multiplayer-racer`
- Use the exact Agent Mail name assigned in your prompt. If no name was assigned, register with an auto-generated name and announce it.
- Check Agent Mail before claiming work and after each meaningful edit/test cycle.
- Reserve files with Agent Mail before editing. Use specific paths or globs, not the whole repo.
- Announce bead claims, file reservations, blockers, and completion in a thread named after the bead ID.
- Do not sit idle waiting for consensus. If a ready bead is unclaimed and you can make progress, claim it, reserve files, announce, and start.

## Beads

- Use `br`, not `bd`.
- Find ready work with `br ready --json` and graph priorities with `bv --robot-triage` or `bv --robot-next`.
- Never run bare `bv`; it launches an interactive TUI. Always use robot flags.
- Claim work with `br update <id> --status in_progress --assignee <AgentName>`.
- Close work only when the implementation is done, tests/builds relevant to the change pass, and you have posted a completion note.
- For the current polishing swarm, prefer beads under the `beads-polishing` label.

## Current High-Level Goal

Polish Joystick Jammers around:

- player identity/readability
- phone controller speed and reconnect confidence
- map and arena reliability
- first-run tutorial/onboarding
- steering, wheelies, boost, and stunt payoff
- host/client performance under multiplayer input load

The main epic is `br-beads-polishing-wheelie-handling-vxv`.

## Development Commands

- Install dependencies: `npm install` and `pip install -r requirements.txt`
- Build frontend: `npm run build`
- Unit/integration tests: `npm test`
- E2E core flow: `npm run test:e2e`
- Python syntax check: `python -m py_compile server/app.py`
- Run server: `python server/app.py`

The Flask server serves from `dist/` when it exists. If you change JavaScript or CSS that is browser-tested, run `npm run build` before browser/E2E verification.

## Code Rules

- Preserve user and other-agent changes. Do not revert unfamiliar edits.
- Keep file reservations narrow and release them when done.
- Avoid per-frame/per-tick logging. Use overlays, tests, screenshots, or targeted one-time logs.
- Use npm-bundled dependencies; do not add CDN imports.
- Do not commit or push unless the human coordinator explicitly asks for commits.
