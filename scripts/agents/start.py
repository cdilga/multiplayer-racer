#!/usr/bin/env python3
"""Start a fresh Claude, Codex or OMP session with the same project bootstrap."""
import argparse
import os
from pathlib import Path
import shlex
import sys

from mail import ROOT, call


def launch(provider, extra, name, mode):
    prompt = (f"You are {name}, a NEW {provider} session in {ROOT}. "
              f"Your Agent Mail identity is already registered and AGENT_NAME={name}; do not adopt another identity. "
              "Read AGENTS.md and docs/process/bead-workflow.md. Before picking a bead run "
              "python3 scripts/ci/pickup.py --claim. If it assigns a CI repair, take it first; "
              "otherwise use br ready / bv --robot-next. Use native Agent Mail MCP tools or "
              "python3 scripts/agents/mail.py (the HTTP bridge), never the database-opening am CLI. "
              "Preserve existing edits; reserve narrow paths whenever another session is active. "
              "Build, test, commit and push your bead, then hand it off with scripts/beads/close.sh. "
              "Do not wait on CI. Check pickup again before your next bead. "
              "No worktrees or extra clones. "
              f"Operating mode: {mode}.")
    defaults = {"claude": [], "codex": [], "omp": ["--model", "zai/glm-5.3", "--thinking", "max"]}
    return [provider, *defaults[provider], *extra, prompt]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("solo", "worker"), default="solo")
    parser.add_argument("--print-command", action="store_true", help="Preview bootstrap without registration or starting an agent")
    parser.add_argument("provider", choices=("claude", "codex", "omp"))
    parser.add_argument("extra", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    extra = args.extra[1:] if args.extra[:1] == ["--"] else args.extra
    if args.print_command:
        print(shlex.join(launch(args.provider, extra, "<new-agent-name>", args.mode)))
        return
    os.chdir(ROOT)
    identity = call("register_agent", {"project_key": str(ROOT), "program": args.provider,
                    "model": "session-configured", "task_description": f"{args.mode}: bead work and CI repair pickup"})
    name = identity["name"]
    os.environ.update(AGENT_NAME=name, BR_ACTOR=name, JJ_ROLE=args.mode)
    version = (ROOT / ".nvmrc").read_text().strip().removeprefix("v")
    node_bin = Path(os.environ.get("NVM_DIR", str(Path.home() / ".nvm"))) / "versions/node" / f"v{version}" / "bin"
    if not (node_bin / "node").exists():
        sys.exit(f"start: install the pinned Node {version} before starting a session")
    os.environ["PATH"] = str(node_bin) + os.pathsep + os.environ["PATH"]
    print(f"Agent Mail: {name} ({args.provider}, {args.mode})", flush=True)
    command = launch(args.provider, extra, name, args.mode)
    os.execvp(command[0], command)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        sys.exit(f"start: {error}")
