"""Exercise the shared-branch pre-push adapter with real Git commits."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Publication(unittest.TestCase):
    def test_another_authors_valid_commit_can_be_pushed_but_conflict_is_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
            git("init", "-q")
            git("config", "user.email", "fixture@example.test")
            git("config", "user.name", "Fixture")
            (root / "world.txt").write_text("base")
            git("add", "world.txt")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            (root / "world.txt").write_text("change")
            git("add", "world.txt")
            git("commit", "-qm", "feature\n\nAgent: GreenLake")
            head = git("rev-parse", "HEAD")
            hooks = root / ".git/hooks"
            # Use the installed archive reader and matcher, not a test replacement.
            installed = ROOT / ".git/hooks/agent-mail-pre-push-base.py"
            if not installed.exists():
                installed = ROOT / ".git/hooks/hooks.d/pre-push/50-agent-mail.py"
            (hooks / "agent-mail-pre-push-base.py").write_text(installed.read_text())
            for holder, expected in (("GreenLake", 0), ("RedHill", 1)):
                reservation = {"agent_name": holder, "path_pattern": "world.txt"}
                original = (hooks / "agent-mail-pre-push-base.py").read_text()
                # Replace archive lookup only; matching and adapter stay real.
                (hooks / "agent-mail-pre-push-base.py").write_text(original + f'\ndef get_active_reservations():\n    return [{reservation!r}]\n')
                result = subprocess.run(["python3", str(ROOT / "scripts/hooks/pre-push-agent-mail.py")],
                                        input=f"refs/heads/main {head} refs/heads/main {base}\n", cwd=root,
                                        env={**os.environ, "AGENT_NAME": "BlueHill"}, text=True, capture_output=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                (hooks / "agent-mail-pre-push-base.py").write_text(original)


if __name__ == "__main__":
    unittest.main()
