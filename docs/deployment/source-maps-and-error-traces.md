# Source Maps and Error Traces

Joystick Jammers keeps local builds credential-free. Error capture can run in
the test/debug sinks without PostHog credentials, while production source-map
generation and upload are explicitly gated by deploy environment variables.

## Runtime Error Capture

Client error traces are emitted through `static/js/telemetry/TelemetryClient.js`
only. The wrapper captures:

- `window.onerror`
- `unhandledrejection`
- `webglcontextlost`
- Socket.IO `connect_error`
- explicit initialization failures via `window.__JJ_CAPTURE_INIT_FAILURE__`

All captured errors use the existing telemetry schema with release,
environment, role, route, room/match/player analytics IDs, browser/device class,
and a deterministic `fingerprint`. Raw error messages, room codes, tokens,
socket IDs, screenshots, and user-written report text are not sent as analytics
properties.

Repeated identical browser or server fingerprints are throttled before enqueue
or dispatch so one render-loop crash cannot spam PostHog or the report endpoint.

Disable switches:

- Browser: `VITE_TELEMETRY_ERROR_CAPTURE_ENABLED=0`
- Server: `TELEMETRY_ERROR_CAPTURE_ENABLED=0`

## Build-Time Source Maps

Vite source maps are off by default. They are emitted only when one of these is
set for the production build:

```bash
POSTHOG_SOURCEMAP_UPLOAD=1 npm run build
```

or:

```bash
JJ_BUILD_SOURCEMAPS=1 npm run build
```

The release used by telemetry comes from the existing build identity pipeline:

- `BUILD_SHA`, `GIT_COMMIT`, or `CF_PAGES_COMMIT_SHA`
- `BUILD_ID`
- `BUILD_TIME`

## PostHog Upload Path

PostHog's official CLI flow requires injecting release/chunk metadata into the
built assets, uploading the source maps, and serving the injected assets. The
CI/deploy job should run the upload only when PostHog credentials are present:

```bash
POSTHOG_SOURCEMAP_UPLOAD=1 npm run build

if [ -n "$POSTHOG_CLI_PROJECT_ID" ] && [ -n "$POSTHOG_CLI_API_KEY" ]; then
  posthog-cli sourcemap inject --directory ./dist
  posthog-cli sourcemap upload \
    --directory ./dist \
    --release-name joystick-jammers \
    --release-version "${BUILD_SHA:-${CF_PAGES_COMMIT_SHA:-unknown}}" \
    --build "${BUILD_ID:-local}" \
    --delete-after
fi
```

Required CI secrets/env:

- `POSTHOG_CLI_PROJECT_ID`
- `POSTHOG_CLI_API_KEY`
- `POSTHOG_CLI_HOST` when not using the default PostHog host

Reference docs:

- `https://posthog.com/docs/error-tracking/upload-source-maps/cli`
- `https://posthog.com/docs/error-tracking/upload-source-maps/vite`
- `https://posthog.com/docs/error-tracking/stack-traces`

## Validation Checklist

- A local `npm run build` does not emit source maps or require credentials.
- `POSTHOG_SOURCEMAP_UPLOAD=1 npm run build` emits source maps under `dist/`.
- The deploy job uploads only after `posthog-cli sourcemap inject` has modified
  the served assets.
- Error events and manual report submissions can share a `fingerprint`.
- Manual report analytics include booleans/counts only, never raw screenshots or
  user-written report text.
