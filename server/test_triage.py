"""Tests for the trusted local bug-report drainer (woq.4)."""

import json
import os
import tempfile
import unittest

from server import report_store, triage


def _seed_store(path, reports):
    for r in reports:
        report_store.append_report(r, path, now=1000.0)


class TriageTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = os.path.join(self._tmp.name, 'reports.ndjson')
        self.state = os.path.join(self._tmp.name, 'state.json')

    def tearDown(self):
        self._tmp.cleanup()

    def test_severity_maps_to_priority_deterministically(self):
        self.assertEqual(triage.severity_to_priority('critical'), 0)
        self.assertEqual(triage.severity_to_priority('high'), 1)
        self.assertEqual(triage.severity_to_priority('medium'), 2)
        self.assertEqual(triage.severity_to_priority('low'), 3)
        self.assertEqual(triage.severity_to_priority('nonsense'), 2)  # default

    def test_fingerprint_dedupes_same_problem(self):
        a = {'report': {'buildId': 'b1', 'mode': 'derby', 'description': 'Car   FLEW into space'}}
        b = {'report': {'buildId': 'b1', 'mode': 'derby', 'description': 'car flew into space'}}
        c = {'report': {'buildId': 'b2', 'mode': 'derby', 'description': 'car flew into space'}}
        self.assertEqual(triage.fingerprint(a), triage.fingerprint(b))  # case/space-insensitive
        self.assertNotEqual(triage.fingerprint(a), triage.fingerprint(c))  # different build

    def test_plan_groups_and_prioritizes(self):
        _seed_store(self.store, [
            {'description': 'void spawn', 'buildId': 'b1', 'mode': 'race', 'severity': 'low'},
            {'description': 'void spawn', 'buildId': 'b1', 'mode': 'race', 'severity': 'critical'},
            {'description': 'stuck wall', 'buildId': 'b1', 'mode': 'derby', 'severity': 'medium'},
        ])
        plan = triage.plan_drain(self.store, self.state)
        self.assertEqual(len(plan), 2)  # two distinct fingerprints
        void = next(p for p in plan if 'void' in p['reportSample']['description'])
        self.assertEqual(void['count'], 2)
        self.assertEqual(void['priority'], 0)  # min priority across the group (critical wins)
        self.assertEqual(void['action'], 'create')

    def test_drain_is_idempotent_no_duplicate_beads(self):
        calls = []
        runner = lambda cmd: calls.append(cmd)
        _seed_store(self.store, [{'description': 'void', 'buildId': 'b1', 'mode': 'race', 'severity': 'high'}])

        first = triage.apply_drain(self.store, self.state, dry_run=False, runner=runner)
        self.assertEqual(len(first), 1)
        create_calls = [c for c in calls if c[:2] == ['br', 'create']]
        self.assertEqual(len(create_calls), 1)

        # Rerun with unchanged store -> no new create (idempotent).
        calls.clear()
        second = triage.apply_drain(self.store, self.state, dry_run=False, runner=runner)
        self.assertEqual([c for c in calls if c[:2] == ['br', 'create']], [])
        self.assertEqual(second, [])

        # A new occurrence of the same fingerprint -> a comment, still no duplicate create.
        calls.clear()
        _seed_store(self.store, [{'description': 'void', 'buildId': 'b1', 'mode': 'race', 'severity': 'high'}])
        third = triage.apply_drain(self.store, self.state, dry_run=False, runner=runner)
        self.assertTrue(any(c[:2] == ['br', 'comments'] for c in calls))
        self.assertFalse(any(c[:2] == ['br', 'create'] for c in calls))

    def test_dry_run_makes_no_br_calls(self):
        calls = []
        _seed_store(self.store, [{'description': 'void', 'buildId': 'b1', 'mode': 'race'}])
        result = triage.apply_drain(self.store, self.state, dry_run=True, runner=lambda cmd: calls.append(cmd))
        self.assertEqual(calls, [])           # dry-run never shells out
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]['dryRun'])
        # Dry-run does not persist state, so a real run still sees the report as new.
        self.assertFalse(os.path.exists(self.state))

    def test_github_mirroring_is_explicit_per_report(self):
        calls = []
        _seed_store(self.store, [{'description': 'void', 'buildId': 'b1', 'mode': 'race'}])
        triage.apply_drain(self.store, self.state, dry_run=False, mirror_github=True, runner=lambda cmd: calls.append(cmd))
        self.assertTrue(any(c[:2] == ['gh', 'issue'] for c in calls))
        # Without the flag, no gh call.
        calls.clear()
        os.remove(self.state)
        triage.apply_drain(self.store, self.state, dry_run=False, mirror_github=False, runner=lambda cmd: calls.append(cmd))
        self.assertFalse(any(c and c[0] == 'gh' for c in calls))


class DrainerBoundaryTest(unittest.TestCase):
    def test_public_app_does_not_import_triage(self):
        src = open(os.path.join(os.path.dirname(__file__), 'app.py'), encoding='utf-8').read()
        self.assertNotIn('import triage', src)
        self.assertNotIn('from triage', src)
        self.assertNotIn('from server.triage', src)


if __name__ == '__main__':
    unittest.main()
