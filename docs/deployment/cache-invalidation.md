# Deployment caching, build identity & stale-client invalidation

This is the contract for how build artifacts are cached and how a browser that
is still running an old bundle after a redeploy is detected and told to reload.
It backs bead `br-captain-call-architecture-hardening-woq.3`.

## Build identity

Every build resolves a `{buildId, buildSha, buildTime}` identity
(`vite.config.js → resolveBuildIdentity()`):

| Field | Source (in precedence order) | Meaning |
|-------|------------------------------|---------|
| `buildId` | `BUILD_ID` env → git short sha (12) → time-based `t…` | short, human-scannable deploy id used for skew checks |
| `buildSha` | `BUILD_SHA`/`GIT_COMMIT`/`CF_PAGES_COMMIT_SHA` env → `git rev-parse HEAD` → `unknown` | full commit for traceability |
| `buildTime` | `BUILD_TIME` env → ISO build clock | when the bundle was built |

The identity is delivered two ways, and they must agree:

1. **Baked into the client bundle** via Vite `define` (`__BUILD_ID__`,
   `__BUILD_SHA__`, `__BUILD_TIME__`), read by `static/js/buildInfo.js`.
2. **Written to `dist/version.json`** by the `jj-version-manifest` Vite plugin,
   which the Flask server reads to answer `GET /version`.

Because both come from the same build, a running server always advertises the
id of the bundle it is serving.

## Cache rules

Implemented in `server/app.py` (`serve_assets`, `set_cache_headers`,
`version_manifest`):

| Resource | Cache-Control | Why |
|----------|---------------|-----|
| `/assets/<hashed>.{js,css}` (Vite, content-hashed) | `public, max-age=31536000, immutable` | filename changes on any content change, so it is safe to cache forever; a rebuild auto-invalidates by URL |
| HTML documents (`/`, `/host`, `/player`) | `no-cache` | must revalidate so a new build's hashed asset references are always picked up |
| `/version` | `no-cache, no-store, must-revalidate` | a redeployed server must answer with the fresh id immediately |
| `/host-assets.json` | `no-cache` | reflects current on-disk build |
| other `/static/*` (non-hashed runtime files) | `no-cache` | never served stale across a rebuild |

**Invariant:** only content-hashed filenames are ever `immutable`. Anything whose
URL is stable across builds is `no-cache`.

## Stale-client detection & invalidation

`static/js/buildInfo.js` provides the pure logic:

- `checkBuildSkew()` fetches `/version` (`cache: 'no-store'`) and compares the
  server `buildId` against the baked-in client `buildId`.
- `isBuildSkewed()` reports skew **only** when both ids are real (non-`dev`,
  non-`unknown`) and differ - local dev and partial deploys never nag.
- On skew it sets `window.__buildStale = true` and `shouldSuppressSend()` returns
  `true`, so the network layer stops emitting contract/control payloads.
- Fail-open: an unreachable or unparseable `/version` leaves sends enabled.

Bug reports (`static/js/ui/BugReportUI.js`) embed `{buildId, buildSha,
buildTime, wasStale, serverBuildId}` so a report can be matched to a deploy and a
"stale client" cause is visible instead of masquerading as a gameplay bug.

## Environment-specific behavior

### Local dev (Vite dev server, `npm run dev`)
`define` constants are absent → client reads `dev`/`unknown`. `dist/` usually
absent → server `/version` returns the `dev` fallback. Skew detection is inert
by design (no false reload prompts while editing).

### Local self-host (`python server/app.py` after `npm run build`)
`dist/` exists → server serves hashed assets `immutable`, HTML `no-cache`, and
`/version` from `dist/version.json`. Rebuild + refresh always picks up the new
build; an open tab from before the rebuild detects skew on its next
`checkBuildSkew()`.

### Hosted service (jammers.dilger.dev via Cloudflare Tunnel + Docker)
- Set `BUILD_ID`/`BUILD_SHA`/`BUILD_TIME` (or rely on git sha) at build time so
  the deployed identity is stable and traceable.
- Cloudflare should honor origin `Cache-Control`: cache `immutable` `/assets/*`
  at the edge, and **never** cache `/version`, HTML, or `/host-assets.json`
  (respect `no-cache`/`no-store`). If a page rule overrides cache, exclude
  `/version` and HTML, or purge on deploy.
- The server resolves `/version` from `dist/version.json` and **re-reads it
  whenever the file changes** (the identity is cached by mtime, not memoized for
  the process lifetime). So a long-lived origin that is rebuilt/redeployed in
  place - with or without a process restart - advertises the new build id
  immediately, and a freshly built client is never wrongly flagged stale.

### Docker
The image is built with `npm run build`, so `dist/version.json` and the bundle
share one identity. Pass `BUILD_ID`/`BUILD_SHA` as build args/env for a stable
id across replicas; otherwise each image build derives its own git-sha id.

## Verifying

- `npx vitest run tests/unit/build-version.test.js tests/integration/build-skew.test.js`
- `python -m unittest server.test_cache_headers`
- `curl -s localhost:8000/version` → `{ "manifest": "jj-build-version", "buildId": …, … }`
- `curl -sI localhost:8000/assets/<hashed>.js | grep -i cache-control` → `immutable`
