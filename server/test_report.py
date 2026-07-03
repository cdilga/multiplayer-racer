"""Tests for the central bug-report store + public intake (woq.4)."""

import json
import os
import re
import tempfile
import unittest

from server.app import app
import server.app as app_module
from server import report_store


class ReportStoreTest(unittest.TestCase):
    def test_sanitize_allowlists_and_scrubs_secrets(self):
        cleaned = report_store.sanitize_report({
            'description': 'car flew into space',
            'buildId': 'b1', 'seed': 42,
            'host_token': 'SECRET-HOST-TOKEN', 'not_allowed_field': 'drop me',
            'runContext': {'seed': 42, 'seat_token': 'SECRET-SEAT'},
        })
        self.assertEqual(cleaned['description'], 'car flew into space')
        self.assertEqual(cleaned['buildId'], 'b1')
        self.assertNotIn('not_allowed_field', cleaned)   # allowlist drops unknowns
        self.assertNotIn('host_token', cleaned)          # not an allowed top-level field
        # Nested secret inside an allowed field is redacted, not stored raw.
        self.assertEqual(cleaned['runContext']['seat_token'], report_store.REDACTED)
        self.assertNotIn('SECRET-SEAT', json.dumps(cleaned))

    def test_screenshot_cap_drops_oversized(self):
        big = 'x' * (report_store.MAX_SCREENSHOT_BYTES + 1)
        cleaned = report_store.sanitize_report({'description': 'd', 'screenshot': big})
        self.assertNotIn('screenshot', cleaned)
        self.assertTrue(cleaned.get('screenshotDropped'))
        small = report_store.sanitize_report({'description': 'd', 'screenshot': 'data:image/png;base64,AAAA'})
        self.assertIn('screenshot', small)

    def test_validate_requires_description_and_size(self):
        self.assertEqual(report_store.validate_report({'description': ''})[1], 'missing_description')
        self.assertEqual(report_store.validate_report({})[1], 'missing_description')
        self.assertTrue(report_store.validate_report({'description': 'ok'})[0])
        huge = {'description': 'd', 'consoleTail': 'x' * (report_store.MAX_TOTAL_PAYLOAD_BYTES + 10)}
        self.assertEqual(report_store.validate_report(huge)[1], 'too_large')

    def test_append_and_read_roundtrip_bounded(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'sub', 'reports.ndjson')
            row = report_store.append_report({'description': 'hi', 'host_token': 'SECRET-X'}, path, now=1000.0)
            self.assertEqual(row['clientReportId'], 'r-1000000')
            rows = report_store.read_reports(path)
            self.assertEqual(len(rows), 1)
            self.assertNotIn('SECRET-X', json.dumps(rows))  # secret never persisted


class ReportEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_path = app_module.REPORTS_STORE_PATH
        app_module.REPORTS_STORE_PATH = os.path.join(self._tmp.name, 'reports.ndjson')
        app_module._report_rate_limiter.reset()

    def tearDown(self):
        app_module.REPORTS_STORE_PATH = self._orig_path
        self._tmp.cleanup()

    def _post(self, payload, ip='10.0.0.1'):
        return self.client.post('/report', json=payload, headers={'X-Forwarded-For': ip})

    def test_valid_report_is_stored_with_cors(self):
        resp = self._post({'description': 'wall-less void', 'buildId': 'b9', 'severity': 'high'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['status'], 'stored')
        self.assertEqual(resp.headers.get('Access-Control-Allow-Origin'), '*')
        rows = report_store.read_reports(app_module.REPORTS_STORE_PATH)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['report']['buildId'], 'b9')

    def test_cors_preflight(self):
        resp = self.client.open('/report', method='OPTIONS')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(resp.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')

    def test_missing_description_is_rejected(self):
        resp = self._post({'buildId': 'b'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.get_json()['error'], 'missing_description')

    def test_honeypot_is_silently_dropped_not_stored(self):
        resp = self._post({'description': 'bot', 'website': 'http://spam'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(report_store.read_reports(app_module.REPORTS_STORE_PATH), [])

    def test_rate_limited_per_ip(self):
        a = self._post({'description': 'one'}, ip='7.7.7.7')
        b = self._post({'description': 'two'}, ip='7.7.7.7')
        self.assertEqual(a.status_code, 200)
        self.assertEqual(b.status_code, 429)

    def test_no_raw_secret_in_stored_record(self):
        self._post({'description': 'leak?', 'runContext': {'host_token': 'SECRET-TOKEN-123'}})
        blob = json.dumps(report_store.read_reports(app_module.REPORTS_STORE_PATH))
        self.assertNotIn('SECRET-TOKEN-123', blob)
        self.assertIn(report_store.REDACTED, blob)


class SecurityBoundaryTest(unittest.TestCase):
    """The public report path must not shell out to br/gh or import the drainer."""

    def test_report_store_has_no_br_gh_or_shell(self):
        src = open(os.path.join(os.path.dirname(__file__), 'report_store.py'), encoding='utf-8').read()
        self.assertNotIn('subprocess', src)
        self.assertFalse(re.search(r'\bimport\s+triage\b', src))
        self.assertNotRegex(src, r"[\"']br[\"']")
        self.assertNotRegex(src, r"[\"']gh[\"']")


if __name__ == '__main__':
    unittest.main()
