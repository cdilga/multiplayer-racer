"""Regression checks for process boundaries: real Git/Beads, isolated tracker fixtures."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/agents"))
import mail
import start


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


pickup = module("pickup", ROOT / "scripts/ci/pickup.py")


class Commands(unittest.TestCase):
    def test_all_providers_receive_the_same_identity_and_pickup(self):
        for provider in ("claude", "codex", "omp"):
            command = start.launch(provider, [], "GreenLake", "worker")
            self.assertEqual(command[0], provider)
            self.assertIn("GreenLake", command[-1])
            self.assertIn("pickup.py --claim", command[-1])
            self.assertIn("HTTP bridge", command[-1])
        self.assertIn("zai/glm-5.3", start.launch("omp", [], "GreenLake", "worker"))
        omp = start.launch("omp", [], "GreenLake", "worker")
        overlay = Path(omp[omp.index("--config") + 1])
        self.assertIn("autoResume: false", overlay.read_text())

    def test_mail_sse_decodes_tool_result(self):
        from io import BytesIO
        response = BytesIO(b'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"name\\":\\"GreenLake\\"}"}]}}\n\n')
        with patch.object(mail, "config", return_value={"url": "http://127.0.0.1/mcp/"}), patch.object(mail.urllib.request, "urlopen", return_value=response):
            self.assertEqual(mail.call("register_agent", {}), {"name": "GreenLake"})

    def test_newer_running_or_green_batch_supersedes_old_red(self):
        runs = [{"id": 1, "head_branch": "main", "conclusion": "failure"},
                {"id": 3, "head_branch": "other", "conclusion": "failure"},
                {"id": 2, "head_branch": "main", "status": "running"}]
        self.assertEqual(pickup.latest_run(runs, "main")["id"], 2)


class ClaimRace(unittest.TestCase):
    @unittest.skipUnless(shutil.which("br"), "real Beads race canary runs at agent setup; CI image has no br")
    def test_two_agents_make_one_bead_and_one_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            subprocess.run(["br", "init", "--prefix", "ct", "-q"], cwd=root, check=True, capture_output=True)
            shutil.copy(ROOT / ".beads/policy.yaml", root / ".beads/policy.yaml")
            report = {"action": "failed", "run": {"id": 42, "head_sha": "a" * 40, "html_url": "http://ci/runs/42"}, "failed_jobs": [{"name": "browser"}]}
            with patch.object(pickup, "ROOT", root):
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(lambda actor: pickup.claim_repair(report, actor, "main", "owner/repo"), ["GreenLake", "BlueHill"]))
                self.assertEqual(sorted(r["action"] for r in results), ["repair", "repair_owned"])
                self.assertEqual(len({r["bead"] for r in results}), 1)
                data = json.loads(pickup.run("br", "list", "--label", "ci:repair", "--json", "--limit", "0"))
                issues = data.get("issues", data) if isinstance(data, dict) else data
                self.assertEqual(len(issues), 1)
                bead = issues[0]
                # A failed repair handoff can move to the next free agent; an
                # in-progress repair above was not stolen.
                pickup.run("br", "update", bead["id"], "--status", "batch_pending", "--actor", bead["assignee"], "--transition-comment", "commit:abc AC1: focused check")
                other = "BlueHill" if bead["assignee"] == "GreenLake" else "GreenLake"
                with patch.object(pickup, "failed_contains_handoff", return_value=True):
                    resumed = pickup.claim_repair(report, other, "main", "owner/repo")
                self.assertEqual(resumed["action"], "repair")
                self.assertEqual(resumed["assignee"], other)


class CloseBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {**os.environ, "AGENT_NAME": "GreenLake"}
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "fixture@example.test")
        self.git("config", "user.name", "Fixture")
        (self.root / ".beads").mkdir()
        (self.root / ".beads/issues.jsonl").write_text(json.dumps({"id": "ct-1", "labels": [], "acceptance_criteria": "- [ ] works"}) + "\n")
        self.git("add", ".beads/issues.jsonl")
        self.git("commit", "-qm", "P1-OPS ct-1: fixture")
        sha = self.git("rev-parse", "HEAD").strip()
        self.git("remote", "add", "gitea", str(self.root / "missing.git"))
        self.git("update-ref", "refs/remotes/gitea/main", sha)
        self.git("config", "branch.main.remote", "gitea")
        self.git("config", "branch.main.merge", "refs/heads/main")
        for folder in ("scripts/beads", "scripts/ci", "bin"):
            (self.root / folder).mkdir(parents=True)
        shutil.copy(ROOT / "scripts/beads/close.sh", self.root / "scripts/beads/close.sh")
        self.log = self.root / "calls"
        br = self.root / "bin/br"
        br.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >>"$CALL_LOG"\n'
                      'if [ "$1" = show ]; then printf \'[{"status":"%s"}]\\n\' "${BR_FIXTURE_STATUS:-in_progress}"; fi\n')
        br.chmod(0o755)
        self.env.update(PATH=str(self.root / "bin") + os.pathsep + self.env["PATH"], CALL_LOG=str(self.log))

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, env=self.env, text=True, stderr=subprocess.DEVNULL)

    def close(self, *args, code=2):
        green = self.root / "scripts/ci/green-for.py"
        green.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >>"$CALL_LOG"\necho http://ci/runs/1\nexit {code}\n')
        green.chmod(0o755)
        return subprocess.run(["bash", "scripts/beads/close.sh", "ct-1", "--tests", "AC1: real check", *args], cwd=self.root, env=self.env, capture_output=True, text=True)

    def test_default_handoff_does_not_query_ci_or_tick_acceptance(self):
        result = self.close()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertIn("--status batch_pending", log)
        self.assertNotIn("--acceptance-criteria", log)
        self.assertNotIn("--branch", log)

    def test_pending_finalization_returns_without_wait_or_dispatch(self):
        result = self.close("--finalize")
        self.assertEqual(result.returncode, 3, result.stderr)
        log = self.log.read_text()
        self.assertNotIn("--wait", log)
        self.assertNotIn("gate report", log)

    def test_followup_to_pending_records_new_handoff_without_same_status_transition(self):
        self.env["BR_FIXTURE_STATUS"] = "batch_pending"
        result = self.close()
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log.read_text()
        self.assertIn("comments add ct-1 commit:", log)
        self.assertNotIn("--status batch_pending", log)

    def test_green_finalization_records_gate_and_receipt(self):
        result = self.close("--finalize", code=0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("gate report", self.log.read_text())
        self.assertIn("receipt:http://ci/runs/1", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
