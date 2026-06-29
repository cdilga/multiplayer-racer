# Telemetry Contract

Joystick Jammers telemetry defines a shared event schema for client (host, controller) and server analytics. This contract ensures privacy, low volume, and correlation across systems before any vendor (PostHog, Grafana) integration.

## Core Principles

1. **Privacy-First**: No raw player names, room codes, IPs, tokens, or unbounded user text.
2. **Low Volume**: No per-frame or per-tick events; aggregate or sample high-frequency data.
3. **Correlation**: All events in a match share `release`, `roomAnalyticsId`, `matchId`, and anonymous `playerAnalyticsId`.
4. **Determinism**: Anonymous IDs are derived from browser/device state, not random or time-based.
5. **Clarity**: PostHog gets product/error events; Grafana gets performance/infrastructure metrics.

## TelemetryEvent Shape

All telemetry events conform to this schema:

```typescript
interface TelemetryEvent {
  // Required: event identification
  eventName: string;            // enum of allowlisted names
  timestamp: number;            // milliseconds since epoch
  
  // Required: correlation & context
  release: string;              // git SHA or version tag
  roomAnalyticsId: string;      // server-generated opaque ID; never raw room code
  matchId: string;              // generated at game start; shared by all players in match
  playerAnalyticsId: string;    // anonymous session ID; never display name or socket ID
  
  // Required: runtime info
  env: "local" | "dev" | "staging" | "production";
  role: "host" | "controller" | "server";
  source: string;               // "GameHost", "Player", "Flask", etc.
  
  // Optional: gameplay context
  mode?: "race" | "derby" | "practice" | null;
  trackId?: string;             // stable track identifier
  mapSeed?: number;             // procedural generation seed
  deviceClass?: "mobile" | "desktop" | "tablet";
  browserFamily?: string;       // "Chrome", "Safari", etc.
  
  // Bounded properties (individual events)
  properties?: {
    [key: string]: string | number | boolean | null;
  };
}
```

## Event Naming Convention

Events are organized by category and must be allowlisted. Format: `category:subcategory:action`.

### Product Events (PostHog)

| Name | Role | Description | Properties |
|------|------|-------------|------------|
| `gameplay:match:started` | host | Match initialization | `playerCount`, `mode` |
| `gameplay:match:ended` | host | Match conclusion | `winners` (array of playerAnalyticsId), `duration_ms` |
| `gameplay:player:joined` | host | Player joined match | `playerCount` |
| `gameplay:player:left` | host | Player departed | `playerCount` |
| `gameplay:race:lap_completed` | host | Lap finished | `lapNumber`, `duration_ms` |
| `gameplay:race:finished` | host | Race end | `position`, `duration_ms` |
| `gameplay:derby:elimination` | host | Player eliminated | `eliminator_playerAnalyticsId`, `round` |
| `gameplay:weapon:fired` | host | Weapon used | `weaponType`, `hit` |
| `gameplay:spawn:respawn` | host | Player respawned | `reason` |
| `error:gameplay:crash` | host | Game crash | `message`, `code` |
| `error:network:disconnect` | controller | Connection lost | `duration_ms` |
| `error:network:reconnect` | controller | Reconnection successful | `attempt` |

### Server Events

| Name | Role | Description | Properties |
|------|------|-------------|------------|
| `server:room:created` | server | Room initialization | `mapSeed`, `mode` |
| `server:room:closed` | server | Room cleanup | `playerCount`, `duration_ms` |
| `server:spawn:validation_failed` | server | Invalid spawn state | `reason`, `spawnIndex` |
| `error:server:crash` | server | Server exception | `message`, `code` |

### Performance Events (Grafana)

| Name | Role | Description | Properties |
|------|------|-------------|------------|
| `perf:render:frame_sample` | host | FPS sample (low-rate) | `fps`, `drawCalls`, `triangles` |
| `perf:physics:step_sample` | host | Physics step time (low-rate) | `step_ms`, `bodies_count` |
| `perf:network:latency_sample` | controller | Network round-trip (low-rate) | `latency_ms` |
| `perf:server:request_sample` | server | Request latency (low-rate) | `endpoint`, `latency_ms` |

## Correlation IDs

### `roomAnalyticsId`
- **Generated**: Server, at room creation.
- **Purpose**: Correlate all events for a game session.
- **Constraint**: Opaque to clients; never the raw room code.
- **Format**: Hex or base36, 8-12 chars.
- **Example**: `a7f2c9e1`, `room-xyz123`.

### `matchId`
- **Generated**: Host, at game start.
- **Purpose**: Correlate all gameplay events within one match (multiple rounds in derby, laps in race).
- **Constraint**: Shared by host, all controllers, and server.
- **Format**: UUIDv4 or similar, 32+ chars.
- **Propagation**: Host sends to server and controllers at match start.

### `playerAnalyticsId`
- **Generated**: Client, on session init (stored in localStorage/sessionStorage).
- **Purpose**: Anonymous player identifier.
- **Constraint**: Derived deterministically from browser fingerprinting; never socket ID or display name.
- **Format**: SHA256 hash (hex), 64 chars, or base36 shorthand, 12-16 chars.
- **Example**: `a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1`.

### `release`
- **Generated**: Build time (host and server).
- **Purpose**: Correlate deployments and identify version-specific issues.
- **Format**: Git SHA (7-40 chars) or semantic version.
- **Propagation**: Host and server both include in events; controller inherits from host.

## Privacy Rules

### Forbidden in Properties

1. **Raw player display names** — use `playerAnalyticsId` only.
2. **Raw room codes** — use `roomAnalyticsId` only.
3. **Raw IP addresses** — use geolocation approximation if needed.
4. **Query strings or URL parameters** — extract values only.
5. **Auth tokens, API keys, or secrets** — never include.
6. **Unbounded user text** (chat, feedback) — truncate to 200 chars and redact PII.
7. **Socket.io session IDs** — use `playerAnalyticsId`.

### Enforcement

- Telemetry service MUST redact forbidden fields on emit.
- Tests MUST detect and fail on forbidden patterns.
- Code review checklist includes privacy audit for new event properties.

## Sampling & Rate Limiting

### High-Frequency Data (Render, Physics, Network)

- **Render frames**: Sample at 1 per 60 frames (≈16 FPS on a 60 Hz display = 1 sample per sec).
- **Physics steps**: Sample at 1 per 100 steps.
- **Network latency**: Sample at 1 per 50 packets.
- **Rationale**: Preserve variance while keeping volume < 1 KB/s per client.

### Match-Level Events

- No sampling; emit on every goal event (join, leave, lap, elimination, spawn, crash).
- Rationale: Low frequency (<10/min per match); high signal.

### Server Metrics

- Sample at 1% of requests; prioritize errors and slow requests (>100ms).
- Rationale: Detect trends without overwhelming log volume.

## Local & Dev Behavior

### Analytics Disabled by Default

- Analytics service returns a no-op sink unless `TELEMETRY_ENABLED=1` (env) or `?telemetry=1` (URL param).
- Rationale: Prevent test/dev data from polluting production analytics.

### Debug Sink

- When enabled with `?telemetry=debug=1`, log all sanitized events to console with `[TELEMETRY]` prefix.
- Rationale: Developers can see what would be sent without actually sending.

### Local Testing

- Use `TELEMETRY_ENDPOINT=http://localhost:9999` to route to a mock server.
- Mock server logs events and returns 200 without processing.

## PostHog vs Grafana Boundary

### PostHog (Product Analytics)

- **Events**: `gameplay:*`, `error:gameplay:*`, `error:network:*`.
- **Purpose**: User funnel, feature usage, crash rates.
- **Receiver**: PostHog ingest API.
- **Retention**: 3 months.

### Grafana (Metrics & Logs)

- **Events**: `perf:*`, `server:*`, `error:server:*`.
- **Purpose**: System health, latency distribution, error logs.
- **Receiver**: Grafana Cloud Loki/Prometheus or local Grafana.
- **Retention**: 30 days (metrics), 7 days (logs).

### Routing

Telemetry service inspects `eventName` prefix and routes accordingly:

```javascript
if (eventName.startsWith("perf:") || eventName.startsWith("server:")) {
  sendToGrafana(event);
} else if (eventName.startsWith("gameplay:") || eventName.startsWith("error:")) {
  sendToPostHog(event);
}
```

## Testing & Validation

### Unit Tests (`tests/unit/telemetry-contract.test.js`)

- **Event names**: Validate against allowlist.
- **Required fields**: Ensure all TelemetryEvent fields present.
- **Property bounds**: Check property values are string/number/boolean/null; object depth ≤ 2; string length ≤ 500.
- **Privacy redaction**: Scan for forbidden patterns (raw names, IPs, tokens).
- **Correlation**: Verify matching `release`, `roomAnalyticsId`, `matchId` across host, controller, server events.
- **Sampling**: Confirm no per-frame event names.

### Integration Tests (E2E)

- Emit sample events from host, controller, server.
- Verify all events reach a mock Grafana endpoint.
- Confirm proper routing (PostHog vs Grafana).

## Examples

### Valid: Match Start (Host → Server)

```json
{
  "eventName": "gameplay:match:started",
  "timestamp": 1719700000000,
  "release": "abc1234",
  "roomAnalyticsId": "room-xyz789",
  "matchId": "550e8400-e29b-41d4-a716-446655440000",
  "playerAnalyticsId": "a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1",
  "env": "production",
  "role": "host",
  "source": "GameHost",
  "mode": "race",
  "trackId": "track-v1-2026-06-29",
  "mapSeed": 12345,
  "properties": {
    "playerCount": 4,
    "mode": "race"
  }
}
```

### Valid: Weapon Fired (Host)

```json
{
  "eventName": "gameplay:weapon:fired",
  "timestamp": 1719700005000,
  "release": "abc1234",
  "roomAnalyticsId": "room-xyz789",
  "matchId": "550e8400-e29b-41d4-a716-446655440000",
  "playerAnalyticsId": "a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1",
  "env": "production",
  "role": "host",
  "source": "GameHost",
  "properties": {
    "weaponType": "missile",
    "hit": true
  }
}
```

### Valid: Network Latency Sample (Controller)

```json
{
  "eventName": "perf:network:latency_sample",
  "timestamp": 1719700001000,
  "release": "abc1234",
  "roomAnalyticsId": "room-xyz789",
  "matchId": "550e8400-e29b-41d4-a716-446655440000",
  "playerAnalyticsId": "a7f2c9e1a7f2c9e1a7f2c9e1a7f2c9e1",
  "env": "production",
  "role": "controller",
  "source": "Player",
  "deviceClass": "mobile",
  "browserFamily": "Chrome",
  "properties": {
    "latency_ms": 35
  }
}
```

### Invalid: Raw Player Name

```json
{
  "eventName": "gameplay:match:started",
  "properties": {
    "player1": "Alice",
    "player2": "Bob"
  }
}
// ❌ FAIL: displayNames forbidden; use playerAnalyticsId instead
```

### Invalid: Per-Frame Event

```json
{
  "eventName": "render:frame:tick"
}
// ❌ FAIL: per-frame events forbidden; use sampling instead
```

## Integration Path

1. **Phase 1 (br-jj-observability-analytics-rkt.2, THIS BEAD)**: Define contract, unit tests, sample events.
2. **Phase 2 (br-jj-observability-analytics-rkt.3)**: Emit from host, controllers, server; propagate correlation IDs.
3. **Phase 3 (br-jj-observability-analytics-rkt.1)**: Wire PostHog and Grafana SDKs; deploy to staging.
4. **Phase 4 (live)**: Enable in production; monitor dashboards.

## References

- AGENTS.md: Architecture (host renderer, controller HUD, remote viewers separate).
- CLAUDE.md: Logging rules (no per-frame logs; use overlays/tests/screenshots).
- Tests: `tests/unit/telemetry-contract.test.js`, `tests/unit/fixtures/telemetry-*`.
