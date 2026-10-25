#!/usr/bin/env python3
"""Check outgoing commits against reservations using each commit's Agent trailer.

The stock Agent Mail guard treats the pusher as author of every commit. On our
shared branch that rejects another agent's valid, already-committed work. Keep
the installed guard's archive discovery and matching; change only attribution.
"""
import os
from pathlib import Path
import runpy
import subprocess
import sys


def git(*args):
    return subprocess.check_output(["git", *args])


def commits(refs):
    found = set()
    for line in refs.splitlines():
        _, local, _, remote = line.split()
        if set(local) == {"0"}:
            continue
        args = [local, "--not", "--remotes"] if set(remote) == {"0"} else [f"{remote}..{local}"]
        found.update(git("rev-list", *args).decode().splitlines())
    return sorted(found)


def main():
    actor = os.environ.get("AGENT_NAME", "").strip()
    if not actor:
        sys.exit("pre-push: AGENT_NAME is required")
    hooks = Path(git("rev-parse", "--git-path", "hooks").decode().strip())
    base = hooks / "agent-mail-pre-push-base.py"
    if not base.exists():
        sys.exit("pre-push: install the Agent Mail guard, then scripts/hooks/install.sh")
    guard = runpy.run_path(str(base))
    reservations = guard["get_active_reservations"]()
    check = guard["check_conflicts"]
    for sha in commits(sys.stdin.read()):
        authors = git("log", "-1", "--format=%(trailers:key=Agent,valueonly)", sha).decode().strip().splitlines()
        # Legacy human commits have no trailer; preserve the original pusher check.
        author = authors[0].strip() if len(authors) == 1 else actor
        check.__globals__["AGENT_NAME"] = author
        paths = git("diff-tree", "--root", "-r", "-m", "--no-commit-id", "--name-only", "-z", sha).decode().split("\0")
        conflicts = check(paths, reservations)
        if conflicts:
            detail = "; ".join(f"{path} reserved by {holder}" for path, _, holder in conflicts)
            sys.exit(f"pre-push: {sha[:9]} (Agent: {author}): {detail}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        sys.exit(f"pre-push: reservation check failed: {error}")
