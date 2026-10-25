#!/usr/bin/env python3
"""Serialize publication and pin one immutable SHA for both remotes and LFS."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys


def run(*args, capture=False):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout


def main():
    if not os.environ.get("AGENT_NAME"):
        sys.exit("publish: AGENT_NAME is required")
    branch = sys.argv[1] if len(sys.argv) > 1 else run("git", "branch", "--show-current", capture=True).strip()
    lock = Path(run("git", "rev-parse", "--git-path", "jj-publish.lock", capture=True).strip())
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        sha = run("git", "rev-parse", "--verify", f"refs/heads/{branch}", capture=True).strip()
        for remote in ("gitea", "origin"):
            run("git", "lfs", "push", "--all", remote, sha)
            run("git", "push", "-q", remote, f"{sha}:refs/heads/{branch}")
            print(f"push: {sha[:9]} -> {remote}/{branch}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"publish: {error}")
