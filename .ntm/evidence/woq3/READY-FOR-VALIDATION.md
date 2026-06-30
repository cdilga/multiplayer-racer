# br-captain-call-architecture-hardening-woq.3 - repair evidence (CodexWoq3Repair)

Blocker (JadeTiger, 2026-06-30): long-lived Flask `/version` returned a memoized
stale `buildId` after an in-place rebuild, so a freshly built (matching) client
saw the reload banner - `tests/e2e/stale-client.spec.ts` matching case failed.

## Root cause & fix
`server/app.py::_read_build_identity()` memoized `_BUILD_IDENTITY_CACHE` for the
process lifetime (its docstring wrongly assumed "a redeploy restarts the
process"). Fix: cache the identity **keyed by `dist/version.json` mtime** and
re-read when it changes. Steady-state calls still skip the file read; an in-place
rebuild (no restart) is picked up immediately. `/version` stays `no-store`.

Files changed (narrow):
- `server/app.py` - mtime-invalidated build-identity cache.
- `server/test_cache_headers.py` - added `VersionRefreshTest` (3 tests).
- `docs/deployment/cache-invalidation.md` - corrected the stale "memoized identity
  is fine because a redeploy restarts the process" line for the self-host/hosted
  origin behavior.

## Commands & results (all green)
- `npm run build` → exit 0; `dist/version.json` buildId `6e98ec84c166` (matches bundle).
- `python -m unittest server.test_cache_headers` → **8 OK** (incl. new
  `test_version_refreshes_when_manifest_changes_without_restart`,
  `test_version_stays_cached_while_manifest_unchanged`,
  `test_version_falls_back_to_dev_when_manifest_absent`).
- `npx vitest run tests/unit/build-version.test.js tests/integration/build-skew.test.js` → **18 passed**.
- `npx playwright test tests/e2e/stale-client.spec.ts --workers=1` → **2 passed**
  (matching build: no banner; stale client: banner + `__buildStale` + sends suppressed).
- Live long-lived-process proof: `version-refresh-proof.txt` - one server PID served
  build A, then returned a NEW buildId after an in-place `version.json` change with
  **no restart** (RESULT: PASS). `dist/version.json` restored afterward.

## Other acceptance gates (verified still satisfied)
- Cache headers: hashed `/assets/*` `immutable, max-age=31536000`; HTML `no-cache`;
  `/version` `no-store` (`CacheHeaderTest` + `VersionManifestTest`).
- Bug reports: `static/js/ui/BugReportUI.js` attaches `buildId/buildSha/buildTime`
  + `wasStale`/`serverBuildId` (text report + structured payload).
- Docs cover local dev, local self-host, hosted (Cloudflare Tunnel + Docker), Docker,
  Cloudflare edge rules.

## Residual risk
- mtime-keyed cache assumes the filesystem updates mtime on rebuild (Vite's
  writeFile does; the proof pins mtime explicitly). A pathological rebuild that
  writes new content with an identical mtime would not refresh - not observed in
  practice; `/version` is low-frequency, so switching to per-request read is a safe
  future option if ever needed.
- Playwright's webServer starts a fresh server per run, so the E2E alone does not
  exercise the long-lived-rebuild path; the python regression test and the live
  proof cover it directly.
