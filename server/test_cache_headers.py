"""Cache-header + version-manifest coverage for deploy/stale-client safety (woq.3).

Proves the rules the bead requires:
- content-hashed /assets/* are immutable (safe to cache forever)
- HTML documents are no-cache (a new build's hashes are always picked up)
- the /version manifest is no-store (a redeployed server answers fresh)
- /version exposes a stable {buildId, buildSha, buildTime} shape for skew detection
"""

import json
import os
import shutil
import tempfile
import unittest

import server.app as server_app
from server.app import app, dist_path


PROD_MODE = os.path.exists(dist_path)


class VersionManifestTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_version_endpoint_shape_and_no_store(self):
        resp = self.client.get('/version')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['manifest'], 'jj-build-version')
        for key in ('buildId', 'buildSha', 'buildTime'):
            self.assertIn(key, data)
            self.assertIsInstance(data[key], str)
            self.assertGreater(len(data[key]), 0)
        cache = resp.headers.get('Cache-Control', '')
        self.assertIn('no-store', cache)

    def test_version_is_stable_across_calls(self):
        first = self.client.get('/version').get_json()
        second = self.client.get('/version').get_json()
        self.assertEqual(first['buildId'], second['buildId'])
        self.assertEqual(first['buildSha'], second['buildSha'])


@unittest.skipUnless(PROD_MODE, 'dist/ not built; cache-header rules only apply in production serving mode')
class CacheHeaderTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_html_documents_are_no_cache(self):
        resp = self.client.get('/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get('Cache-Control'), 'no-cache')

    def test_hashed_assets_are_immutable(self):
        assets_dir = os.path.join(dist_path, 'assets')
        if not os.path.isdir(assets_dir):
            self.skipTest('no built assets to probe')
        sample = next((f for f in os.listdir(assets_dir) if f.endswith('.js')), None)
        if not sample:
            self.skipTest('no .js asset to probe')
        resp = self.client.get(f'/assets/{sample}')
        self.assertEqual(resp.status_code, 200)
        cache = resp.headers.get('Cache-Control', '')
        self.assertIn('immutable', cache)
        self.assertIn('max-age=31536000', cache)

    def test_version_json_static_artifact_present_if_built(self):
        # The Vite versionManifestPlugin writes dist/version.json; when present
        # it must agree with the /version endpoint the server serves from it.
        version_path = os.path.join(dist_path, 'version.json')
        if not os.path.exists(version_path):
            self.skipTest('dist/version.json not produced by this build')
        endpoint = self.client.get('/version').get_json()
        import json
        with open(version_path, encoding='utf-8') as f:
            on_disk = json.load(f)
        self.assertEqual(endpoint['buildId'], on_disk['buildId'])


class VersionRefreshTest(unittest.TestCase):
    """woq.3 stale-client blocker regression.

    A long-lived / self-hosted Flask process that is rebuilt IN PLACE (no restart)
    must serve the NEW buildId at /version, not a memoized stale one. Previously
    _read_build_identity() cached forever, so the stale-client E2E flagged a
    freshly built (matching) client as stale. We point dist_path at a temp dir and
    rewrite version.json with a newer mtime to simulate the rebuild.
    """

    def setUp(self):
        self.client = app.test_client()
        self._orig_dist = server_app.dist_path
        self._tmp = tempfile.mkdtemp(prefix='woq3-version-')
        server_app.dist_path = self._tmp
        server_app._BUILD_IDENTITY_CACHE = None
        server_app._BUILD_IDENTITY_MTIME = None

    def tearDown(self):
        server_app.dist_path = self._orig_dist
        server_app._BUILD_IDENTITY_CACHE = None
        server_app._BUILD_IDENTITY_MTIME = None
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_version(self, build_id, mtime):
        path = os.path.join(self._tmp, 'version.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({
                'buildId': build_id,
                'buildSha': build_id + '-sha',
                'buildTime': '2026-01-01T00:00:00.000Z',
            }, f)
        # Pin an explicit mtime so the invalidation is deterministic (no reliance
        # on sub-second filesystem timestamp resolution between writes).
        os.utime(path, (mtime, mtime))

    def test_version_refreshes_when_manifest_changes_without_restart(self):
        self._write_version('build-old-aaaaaa', mtime=1_000_000)
        first = self.client.get('/version').get_json()
        self.assertEqual(first['buildId'], 'build-old-aaaaaa')

        # Rebuild in place: same path, new id, newer mtime, NO process restart.
        self._write_version('build-new-bbbbbb', mtime=2_000_000)
        second = self.client.get('/version').get_json()
        self.assertEqual(second['buildId'], 'build-new-bbbbbb')
        self.assertEqual(second['buildSha'], 'build-new-bbbbbb-sha')

    def test_version_stays_cached_while_manifest_unchanged(self):
        self._write_version('build-stable-cccccc', mtime=1_500_000)
        a = self.client.get('/version').get_json()['buildId']
        b = self.client.get('/version').get_json()['buildId']
        self.assertEqual(a, 'build-stable-cccccc')
        self.assertEqual(b, 'build-stable-cccccc')

    def test_version_falls_back_to_dev_when_manifest_absent(self):
        # Empty temp dir -> no version.json -> dev/env fallback, no crash, and the
        # endpoint still returns a valid non-empty shape.
        data = self.client.get('/version').get_json()
        for key in ('buildId', 'buildSha', 'buildTime'):
            self.assertIsInstance(data[key], str)
            self.assertGreater(len(data[key]), 0)


if __name__ == '__main__':
    unittest.main()
