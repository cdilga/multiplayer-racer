# Gap: Bug-tracker pipeline (To-Do item 4 / `FB-bugtrk`)

> Fills the gap left open in `feedback-design-pass.md` §11.6, where `FB-bugtrk` was originally a thin
> shorthand for a report endpoint plus tracker promotion. This designs the whole
> path: **in-game capture → `POST /report` → store → triage**, plus the optional community/analytics
> layers, scoped for a **solo operator** (don't over-build). House style follows the rest of the plan:
> Problem (grounded) → Options → Recommendation → Beads → Tests.
>
> **Owner decisions folded in (this revision):** (a) the game runs **both self-hosted/local and on a
> hosted remote service**, and the owner wants **one central bug store on the hosted side** that *both*
> hosted players and online-when-reachable local players feed into; (b) the client routing is
> **hosted-service-if-reachable → else `mailto:` email** (worst case); (c) anti-abuse for the public
> hosted endpoint is hardened with a **Cloudflare layer (Turnstile + WAF/rate-limit)** in front of the
> app-level defenses; (d) browser clients and public request handlers must **never** know about, shell
> out to, or directly call local maintainer tools like `br`/`gh`. See §2.4 (routing), §3.0 (Cloudflare),
> and §4 (trusted local drainer).

---

## 1. Problem (grounded)

An in-game reporter already exists (commit `ab11436`), on **both sides**:

- **Host** — `static/js/ui/BugReportUI.js` (`REPORT_EMAIL = 'bugs@jammers.dilger.dev'`). On open it
  calls `GameHost.collectDebugInfo()` (`GameHost.js:1149`) for a defensive state snapshot
  (timestamp, `url`, `userAgent`, `roomCode`, `socketId`, `gameState`, `fps`, `settings`, `track`,
  per-player `{name, speed, health, isDead, position}`, plus mode-specific `derby`/`race` blocks) and
  `captureScreenshot()` (`GameHost.js:1212` → `RenderSystem.captureScreenshot()`, a JPEG data URL).
  Submit = **download the screenshot file + open a `mailto:`** with the description and a text summary.
- **Player** — `static/js/player.js:252 openPlayerBugReport()` builds a smaller
  `collectPlayerDebugInfo()` snapshot and opens a `mailto:` (no screenshot — the controller has no
  canvas worth grabbing).

**What's missing (the gap).** Submission is **`mailto:` + manual file attach**. That is high-friction
(the reporter has to find the downloaded JPEG and attach it), lossy (most people abandon at the mail
client, screenshots never get attached), and **nothing lands in a tracker automatically**. There is:

- **no server endpoint** — `server/app.py` exposes only game socket events + `/health`; no `/report`;
- **no build/version stamp** in the snapshot (`collectDebugInfo` has no commit SHA — git HEAD today is
  `a82ca9c`), so a report can't be tied to the code that produced it;
- **no console tail** (the single highest-signal field for "it broke" reports);
- **no store, dedup, severity, or status** — `bugs@…` inbox is the entire pipeline;
- **no rate-limit / spam / size controls** — irrelevant for `mailto:`, mandatory for an HTTP endpoint.

§11.6 already records the key constraint, now strengthened as policy: **the browser cannot know about,
shell out to, or directly call `gh`/`br`**, and neither should the public request path. The browser posts
a sanitized report to `/report`; the endpoint stores it; a trusted local maintainer drainer later
promotes real reports into Beads/GitHub using local credentials.

**Non-negotiables carried from CLAUDE.md.** No CDN deps. No `br`/`gh` invocation in browser code or the
public report request handler. No per-tick logging. Rebuild `dist/` after any `static/js` change. The
endpoint is Flask (matches the stack).

---

## 2. The capture (client side)

### 2.1 Problem
The snapshots are decent but (a) sent by `mailto:`, (b) missing build SHA + console tail, (c) the
screenshot rides as a separate download instead of in the payload, and (d) no privacy scrub.

### 2.2 Options

- **C-a — Keep `mailto:`, add fields.** Cheapest, but doesn't fix the core friction or get reports
  into a store. Rejected as the primary path; **kept as a fallback** (offline / endpoint down).
- **C-b — `POST /report` with JSON, screenshot inline.** The reporter clicks Submit → one `fetch` →
  toast "thanks, filed". Screenshot travels as a downscaled data-URL string in the JSON. Simplest
  transport; payload is bounded by the downscale (below). **Recommended.**
- **C-c — `multipart/form-data` (JSON part + binary screenshot part).** Slightly smaller on the wire,
  but more server-side parsing and more client code for marginal benefit at our screenshot sizes.
  Defer; revisit only if screenshots get large.

### 2.3 Recommendation — `POST /report` (C-b), enrich + redact before send

**Enrich** the existing snapshot with:

- `buildSha` / `buildTime` — injected at bundle time. Add `__BUILD_SHA__` / `__BUILD_TIME__` via Vite
  `define` (from `git rev-parse --short HEAD` at build) so both host and player snapshots carry it.
  Also expose it at **`GET /version`** (`{sha, builtAt}`) so the server can flag client/server skew.
- `consoleTail` — a **ring buffer** (last ~50 lines) of the app's own `console.error`/`warn`/`log`,
  installed once at boot (wrap `console.*`, push to a capped array). This is the field that turns
  "it broke" into a fix. **Scrubbed** before send (below). This is *capture-for-report*, not logging —
  it never prints per-tick and adds nothing to console output, so it doesn't trip
  `console-errors.spec.ts`.
- `mode` / `seed` — `settings.mode` is already there; add the **procedural track seed** (`FB-seed`)
  and `track.configId` so a map bug is reproducible from the report alone.
- `clientReportId` — a UUID minted client-side for idempotency / dedup of double-submits.
- `role` — `"host"` | `"player"` (player already tags `side: 'player'`).
- `contact` — **optional, opt-in** free-text ("email if you want a reply"), default empty.

**Redact (privacy stance — minimize, never surprise the reporter).**

- **Screenshot** = the **game canvas only** (already true — `RenderSystem.captureScreenshot()`, not the
  page), so it can't leak other tabs/desktop. **Downscale** to ≤ 1280px longest edge, JPEG q≈0.6,
  **hard cap ~200 KB**; if over, drop it and set `screenshotDropped: true`. Screenshot is **opt-out**:
  a checkbox in the modal, default on, with the preview already shown (the user sees exactly what's
  sent).
- **`url`** — strip query string + hash before send (room code travels in `roomCode`, not the URL;
  this prevents any future token-in-URL leak).
- **`consoleTail` / description / contact** — run a scrub regex over them client-side: redact things
  shaped like emails, bearer/JWT tokens, and long hex/base64 blobs → `[redacted]`. (Defense-in-depth;
  the server scrubs again.)
- **No IP, no precise geo, no device IDs** are *collected by the client*. The server sees the IP at the
  socket level (unavoidable) and stores only a **salted hash** of it (§3) — never the raw IP — for
  rate-limit/dedup.
- The modal's existing **"Debug info that will be sent"** `<details>` block stays — the reporter can
  see the exact JSON before submitting. That transparency is the privacy contract.

**Transport + fallback.** On Submit: `POST /report` to the **report base URL** resolved in §2.4. On
`2xx` → toast "Filed — thanks!" and close. On network error / `>=5xx` / unreachable → fall back to the
**existing `mailto:` + screenshot download** path (C-a), so a report is never lost when the endpoint is
down. Player side gains the same `fetch`-first, `mailto:`-fallback flow. The full routing chain
(local → hosted-remote → email) is §2.4.

### 2.4 Routing — local vs remote (owner: one central store)

The game runs in two deployments, and the owner wants **all** reports — from hosted players *and* from
local/self-hosted players when they're online — to land in **one central store on the hosted service**.
So the client resolves a **report base URL** and walks a fallback chain:

```
resolveReportBase():
  HOSTED_REPORT_URL = 'https://<owner-hosted-service>/report'   // build-time constant
  if running on the hosted instance        -> POST same-origin '/report'   (already central)
  else (local / self-hosted instance)       -> POST HOSTED_REPORT_URL       (cross-origin to central)
                                               on failure/unreachable -> mailto: fallback (§2.3)
```

- **Hosted/remote instance** → `POST /report` **same-origin** to the hosted service (Cloudflare-
  protected, §3.0). The hosted service **is** the central store (§4).
- **Local/self-hosted instance** → **first try the hosted service's `/report`** (`HOSTED_REPORT_URL`,
  cross-origin) so the owner still receives local players' reports centrally. The hosted service is the
  **single source of truth when online**.
  - This requires **CORS** on the hosted `/report` (allow `POST` + `Content-Type: application/json`
    from any origin — the endpoint is already anonymous/public, so `Access-Control-Allow-Origin: *` is
    acceptable; the Cloudflare layer, not origin, is the gate). Turnstile (§3.0) still applies to these
    cross-origin submits.
  - If the hosted service is **unreachable** (offline, no network, owner's service down, or the cross-
    origin POST fails/times out) → **fall back to the existing `mailto:` email path** (worst case). A
    local instance never writes its own local store — it is a *client* of the central one.
- **Reachability/timeout:** treat a `fetch` that doesn't resolve to a `2xx`/`4xx` within a short
  timeout (e.g. 5 s) as unreachable and fall through to email. A `4xx` (validation/limit/Turnstile
  fail) is **not** a fallback trigger — the report reached the service and was rejected; surface the
  reason instead of silently emailing.
- `HOSTED_REPORT_URL` is a **build-time constant** (Vite `define`), so a self-host build can point at
  the owner's service (default) or be overridden to a private one. Empty/unset on a local build → skip
  straight to `mailto:` (pure-offline self-host).

---

## 3. The `POST /report` server endpoint

### 3.0 Cloudflare layer (primary anti-abuse for the **hosted** service)

The hosted `/report` is a public, anonymous, internet-facing write endpoint and **the** target for both
hosted players and online local players (§2.4) — so it's the abuse magnet. App-level defenses (§3.4)
stay, but the **first line of defense on the hosted deployment is Cloudflare**, in front of the origin:

- **Turnstile (the CAPTCHA-alternative, privacy-friendly, no puzzle).** The report modal renders a
  Turnstile widget; on submit the client gets a token and includes it as `turnstileToken` in the
  payload. The hosted server **verifies the token server-side** (`siteverify`) before storing — a
  failed/absent/replayed token → `403`, nothing stored. Turnstile is low-friction (usually invisible /
  one click), collects no PII, and is the main bot wall. **Hosted-only**: a pure-offline self-host with
  no Cloudflare keys skips the widget and relies on app-level + email fallback.
- **Cloudflare WAF / rate-limiting rules** in front of the origin: per-IP rate-limit rule on the
  `/report` path (e.g. N/min), basic bot-fight / managed challenge on anomalous traffic, body-size cap
  at the edge. This absorbs floods **before** they reach Flask, so the in-process buckets (§3.4) are a
  backstop, not the only wall.
- **Keys** (`TURNSTILE_SITE_KEY` client / `TURNSTILE_SECRET_KEY` server) come from env, never bundled
  secrets. The Vite build injects only the **public** site key.
- **Privacy:** Turnstile is chosen precisely because it's puzzle-free and doesn't profile the user; it
  fits the "minimize, don't surprise" stance (§2.3). Cloudflare sees IPs (it's the edge) but the
  **origin still stores only the salted IP hash** (§3.4) — the edge layer doesn't change what we retain.

This is **deployment config**, not app rewiring: the same Flask `/report` runs locally without
Cloudflare; the protections wrap it only on the hosted service.

### 3.1 Problem
None exists. It must accept anonymous reports from the open internet (and **cross-origin** from local
instances, §2.4), so it needs Turnstile/edge defenses (§3.0) **plus** app-level validation, size/rate
limits, CORS, and spam handling **before** anything reaches a tracker.

### 3.2 Schema (validated, allowlist — unknown keys dropped)

```jsonc
// POST /report   Content-Type: application/json   (max body 256 KB)
{
  "clientReportId": "uuid",            // required, idempotency key
  "role":        "host" | "player",    // required
  "description": "string",             // required, 1..4000 chars (the human text)
  "contact":     "string",             // optional, <=200 chars, opt-in
  "snapshot": {                        // required, the collectDebugInfo() object
    "timestamp":  "ISO8601",
    "buildSha":   "string<=40",
    "buildTime":  "ISO8601",
    "roomCode":   "string<=8",
    "mode":       "race" | "derby" | null,
    "seed":       "string<=64 | null",
    "track":      "string<=64 | null",
    "gameState":  "string<=32",
    "fps":        "number",
    "userAgent":  "string<=512",
    "url":        "string<=512",       // query/hash already stripped client-side
    "players":    [ /* bounded list, capped at 64 */ ],
    "consoleTail":["string", ...]      // capped 50 lines x 500 chars
  },
  "screenshot": "data:image/jpeg;base64,...",  // optional, <=200 KB decoded, jpeg/png only
  "turnstileToken": "string",          // required on the hosted deployment (§3.0); absent on offline self-host
  "honeypot":   ""                     // must be empty (bot trap, hidden field)
}
```

**Validation** (fail closed, return `400` with a short reason, never echo input into an error page):

- **Turnstile first (hosted):** if `TURNSTILE_SECRET_KEY` is configured, verify `turnstileToken`
  server-side; missing/invalid/replayed → `403`, store nothing. (No key configured = offline self-host
  → skip this check.)
- Reject non-`application/json`, body `> 256 KB` (Flask `MAX_CONTENT_LENGTH`), missing required fields.
- `screenshot` must match `data:image/(jpeg|png);base64,` and decode to `≤ 200 KB`; else drop it and
  keep the rest (don't 400 the whole report for an oversized image).
- Coerce/clamp every string to its max length; **drop unknown keys** (allowlist) so the stored record
  shape is fixed.
- `honeypot` non-empty → silently `202` (pretend success, store nothing) so bots don't learn.
- **CORS preflight:** answer `OPTIONS /report` and set `Access-Control-Allow-Origin: *`,
  `Allow-Methods: POST, OPTIONS`, `Allow-Headers: Content-Type` so cross-origin local instances (§2.4)
  can submit. The endpoint is anonymous by design; Turnstile + edge rules are the gate, not origin.

### 3.3 Auth — anonymous OK
Yes, anonymous. It's a walk-up party game; requiring login would kill the report rate, which is the
whole point. Defenses are **rate-limit + size + spam heuristics**, not identity. (If a future account
system lands — `FB-account` — attach `deviceToken` when present as a *soft* trust signal, never a gate.)

### 3.4 Rate-limiting & spam
On the hosted deployment these are the **second** line behind Cloudflare (§3.0); on a local self-host
they're the *only* line. Solo-scale, no Redis. **In-process token buckets** keyed on a **salted IP
hash** and on `roomCode`:

- per IP-hash: **5 / minute, 30 / hour**; per room: **10 / hour**. Over limit → `429` + `Retry-After`.
- **Soft trust signal:** a report whose `roomCode` matches a room the server has actually seen
  (`game_rooms`) is trusted; an unknown/absent room gets a tighter bucket (bots rarely hold a live
  room). Never a hard reject — a legit report can arrive just after a room closes.
- **Honeypot** field (above) + **server-side scrub** (re-run the email/token/hex redaction on
  `description`/`contact`/`consoleTail`; defense-in-depth).
- **Global daily cap** (e.g. 500/day) as a backstop; past it, return `202` but only count, don't store
  (so a flood can't fill the disk). Bump if it ever legitimately saturates.
- Escalation path *only if abused*: hCaptcha / lightweight PoW on the modal. **Not built now** — note
  it, don't pre-build it.

Use **`flask-limiter`** (in-memory backend) for the buckets — one dependency, idiomatic, no infra.

### 3.5 Response
`202 Accepted { "ok": true, "id": "rpt_<short>" }` — the endpoint **persists locally and returns
immediately**; it does **not** call `gh`/`br` in the request path (§4 explains why). `4xx` for
validation/limit, generic `500` on unexpected error (never leak a stack trace).

---

## 4. Storage & triage

### 4.1 Problem
Where do reports land, and how do they reach a tracker the maintainer actually reads, **without**
putting a GitHub token on the public game server or letting the open internet write straight into the
issue tracker? Per the owner decision, this store lives **on the hosted service** and is the **single
central inbox** that *both* hosted players and online local players (§2.4) feed into.

### 4.2 Options

- **S-a — Endpoint → GitHub issues synchronously via `gh`** (plan's I4a). Anyone hitting `/report`
  writes directly to the **public** issue tracker → spam goes straight to GitHub; couples the request
  path to GitHub's API + rate limits + latency; needs a write-scoped token on the game box. **Reject as
  the request-path target.**
- **S-b — Endpoint → beads (`br`) synchronously** (plan's I4b). Same coupling problem; also `br` writes
  to a local SQLite/JSONL that lives in the dev repo, not on the prod server. **Reject for the request
  path.**
- **S-c — Endpoint → append-only NDJSON log (+ screenshots on disk), out-of-band drainer promotes to
  `br`/`gh`.** The endpoint only ever does a cheap local append (durable, no network in the hot path).
  A **separate, authenticated triage step** (cron or `make triage`, run by the maintainer) reads new
  records, **dedupes**, and promotes the real ones into the tracker. The public never writes to GitHub
  directly. **Recommended.**
- **S-d — Managed DB (D1/Postgres/Supabase).** Overkill for a solo party game; adds infra + a schema to
  own. The project already ships an SQLite beads DB; a flat NDJSON file is enough for the raw inbox.
  Defer until volume demands it.

### 4.3 Recommendation — S-c: NDJSON source-of-truth → drainer → **beads (`br`)** as the dev tracker

**Source of truth = append-only file on the hosted service** (the owner's central inbox), outside
`dist/`, gitignored, on a persisted volume:

```
server/data/reports/            # ON THE HOSTED SERVICE — central store for all instances (§2.4)
  reports.ndjson                 # one JSON record per line (the raw inbox)
  screenshots/<id>.jpg           # decoded screenshot, referenced by id
```

Each record = the validated payload + server-stamped `{id, receivedAt, ipHash, roomKnown, fingerprint,
severity, status, source}` where `source = "hosted" | "local"` (whether the report came from a hosted
player or a cross-origin local instance, §2.4). Appending is atomic-enough at our rate (one writer,
`O_APPEND`); the file *is* the backup. A **local self-host instance keeps no store of its own** — when
online it POSTs here, when offline it emails (§2.4); this file is the one place reports accumulate.

**Promotion target = beads (`br`).** Beads is the right dev-facing store because the project already
runs on `br` + the agent-swarm workflow consumes beads, so a report becomes actionable work
immediately (`br create`, deps, ready-queue). **GitHub issues are the optional public mirror** (S-a as
an *opt-in* per-report action during triage, e.g. for a community-facing tracker), not the default.

**Triage drainer** (`server/triage.py` / `make triage`, run by the maintainer — has the `br`/`gh`
creds the server must not):

1. Read records newer than the last-drained offset.
2. **Dedup by `fingerprint`** = hash of `(buildSha, mode, top console-error signature or normalized
   description, gameState)`. New fingerprint → `br create` a bead labelled `bug,from-report`,
   severity-mapped priority, screenshot path + snapshot in the body. Seen fingerprint → **increment a
   count / add a comment** on the existing bead instead of opening a duplicate (`+1, also room XYZ`).
3. **Severity** (server pre-classifies; human can override): `crash`/uncaught-error in `consoleTail` →
   high; disconnect/stuck-game keywords → medium; everything else → low. Drives bead priority.
4. **Status** lives on the bead (`open`→`triaged`→`fixed`/`wontfix`); the NDJSON record's `status` is
   just `new`→`promoted`/`spam`/`dropped` so re-runs are idempotent.

This keeps the **fast, dumb, safe** endpoint separate from the **slow, smart, authenticated** triage —
the public can write to a file but only the maintainer's drainer reaches the tracker.

---

## 5. Optional community layer — **later / opt-in** (the "voting" idea)

> From `IDEAS_NEEDING_REFINEMENT.md`: *"Bug submission system with community voting"*. **Designed here,
> explicitly deferred** — it only earns its keep once there's a player base. Not in `FB-bugtrk` v1.

- **Read view (`GET /reports`, `FB-bugtrk-board`):** a public board of **already-triaged, non-spam,
  de-PII'd** reports (title + status + vote count only — never raw snapshots, IPs, screenshots, or
  contact). Backed by the *triaged beads*, not the raw NDJSON, so nothing un-vetted is ever exposed.
- **Voting (`POST /reports/{id}/vote`):** one vote per IP-hash (reuse §3 limiter), feeds bead priority
  (a `votes` field → drives the ready-queue ranking). Anonymous; same spam stance as `/report`.
- **De-dup as a feature:** the §4.3 fingerprint means a player hitting a known bug sees "already
  reported (12 affected) — +1?" instead of filing a dup — the community count *is* the vote.
- **Hard gate:** nothing reaches the public board without passing triage (anti-abuse + anti-PII). Build
  only if/when there's an audience worth moderating for.

---

## 6. Analytics tie-in — **lightweight, optional** (the "catch bugs in real-time" idea)

> From the ideas doc: *"Analytics to catch bugs in real-time"* / *"Analytics agent (watch players,
> catch bugs)"*. Keep it tiny; this is **not** a metrics platform.

- **Auto-report on uncaught error (`FB-bugtrk-auto`).** A global `window.onerror` /
  `unhandledrejection` handler that fires the **same** capture pipeline (§2) with `role` unchanged and
  `auto: true`, **throttled** (one auto-report per error-fingerprint per session) so a per-frame
  exception can't spam `/report`. This is the real "catch bugs in real-time" win — crashes file
  themselves with full context, no human action. Respects the no-per-tick rule via fingerprint+session
  throttle.
- **Server health counters (`FB-bugtrk-auto`).** Extend `/health` (or a sibling `/metrics`) with cheap
  in-memory counters already implied by the game loop: rooms, active players, reports-last-hour,
  socket disconnect rate. A spike in disconnects/auto-reports is the real-time signal; no per-event
  storage, no PII.
- **Explicitly out of scope now:** session recording, funnels, third-party analytics SDKs, any
  per-player tracking. If wanted later, a single self-hosted lightweight tool (e.g. Plausible-style) —
  but that's a separate product call (§14 of the main plan), not `FB-bugtrk`.

---

## 7. Beads

`FB-bugtrk` is split so the **pragmatic core ships first** and the community/analytics layers stay
clearly optional. Slot under Wave 4 (flow/product), as in the main plan's sequence.

| Bead | Theme | Scope | Depends on | Tests |
|---|---|---|---|---|
| **FB-bugtrk** | I | **Core pipeline.** Client: enrich snapshot (`buildSha` via Vite `define` + `GET /version`, `consoleTail` ring buffer, `seed`, `clientReportId`), privacy scrub + screenshot downscale/cap, **routing chain** `resolveReportBase()` = hosted-if-same-origin → `HOSTED_REPORT_URL` cross-origin from local → `mailto:` fallback (§2.4), host **and** player. Server: `POST /report` (allowlist schema, validation, size caps, **CORS preflight**), `flask-limiter` rate-limit + honeypot + server scrub, append to central `reports.ndjson` (`source` tag) + screenshot to disk, `202`. | — | E2E (§8) |
| **FB-bugtrk-cf** | I | **Cloudflare anti-abuse for the hosted service (§3.0).** Turnstile widget in the report modal + `turnstileToken` in payload + server-side `siteverify` (skipped when no key = offline self-host); Cloudflare WAF/edge rate-limit + body-size rule on `/report`; env-based keys (public site key via Vite `define`). Deployment/config bead, hosted-only. | FB-bugtrk | E2E (Turnstile gate: bad/absent token → `403`), config |
| **FB-bugtrk-triage** | I | **Triage drainer** (`server/triage.py` / `make triage`, runs on the **hosted** side / maintainer box): read central NDJSON → fingerprint-dedup → `br create`/comment, severity→priority map, status bookkeeping; optional per-report `gh issue create` mirror. Runs with maintainer creds, **not** in the request path. | FB-bugtrk | unit (dedup, severity, idempotent re-run) |
| **FB-bugtrk-auto** | I | **Lightweight analytics (§6):** `window.onerror`/`unhandledrejection` auto-report (fingerprint+session throttled), `/health` (or `/metrics`) counters. | FB-bugtrk | unit (throttle), E2E (thrown error files one report) |
| **FB-bugtrk-board** | I | **Community layer (§5) — opt-in/later:** `GET /reports` read board (triaged, de-PII'd) + `POST /reports/{id}/vote` (IP-hash limited) feeding bead priority. Build only with an audience. | FB-bugtrk-triage | E2E (board shows only triaged; vote is rate-limited) |

(Replaces the single `FB-bugtrk` row in `feedback-design-pass.md` §13; keep `FB-account`/`FB-monetize`
as-is. `FB-bugtrk` stays the only **non-optional** one.)

---

## 8. Tests

Following the plan's "verify correctness, not presence" bar (principle 9) and the privacy/spam stance:

**Endpoint — accept / validate / limit / Turnstile (`tests/integration/`, pytest against the Flask app):**
- **Accepts** a well-formed report → `202` + `{ok:true,id}`; a record is appended to `reports.ndjson`
  and (if a screenshot was sent) a file exists under `screenshots/`.
- **Validates:** missing required field / non-JSON / body `> 256 KB` → `400`, nothing written.
  Oversized screenshot → report still stored, image dropped, `screenshotDropped` recorded.
- **Allowlist:** an unknown/injected key in the payload is **not** present in the stored record.
- **Rate-limits:** 6th request in a minute from one IP-hash → `429` + `Retry-After`; honeypot non-empty
  → `202` but **no** record written.
- **Turnstile gate (§3.0):** with `TURNSTILE_SECRET_KEY` configured (verify mocked), a missing/invalid
  `turnstileToken` → `403`, **nothing stored**; a valid token → `202`. With **no** secret configured
  (offline self-host) the check is skipped and a tokenless report is accepted.
- **CORS:** `OPTIONS /report` returns the allow-origin/methods/headers so a cross-origin local instance
  can submit (§2.4).
- **No stack-trace / input echo** in any error response body.

**Routing — local → remote → email (`tests/e2e/`, Playwright; intercept `fetch`):**
- **Hosted instance:** submit POSTs **same-origin** `/report`, `2xx` → toast, no `mailto:`.
- **Local instance, service reachable:** submit POSTs the **cross-origin `HOSTED_REPORT_URL`** (assert
  the request target), `2xx` → toast, no email.
- **Local instance, service down (the worst-case fallback):** stub `HOSTED_REPORT_URL` to fail / time
  out → client **falls back to `mailto:`** + screenshot download (the central store is bypassed only
  when unreachable). A `4xx` from the service does **not** trigger the email fallback (surfaces the
  rejection instead).

**Report reaches the store / triage (`tests/integration/` + unit):**
- A submitted report, once drained, produces **exactly one** bead for a new fingerprint; a second
  report with the **same** fingerprint adds a comment / increments count, **no** second bead (dedup).
- Drainer is **idempotent**: re-running over the same NDJSON creates no new beads (status bookkeeping).
- Severity map: a `consoleTail` containing an uncaught error → high-priority bead.

**Privacy — no PII leaked (the hard gate):**
- Stored record contains **`ipHash`, never a raw IP**; `url` has **no query string/hash**.
- An email / bearer-token / long-hex string placed in `description` + `consoleTail` is **`[redacted]`**
  in the stored record (server scrub runs even if client scrub is bypassed — test by POSTing raw).
- Screenshot opt-out (`screenshot` omitted) → record stored with **no** image file, no error.
- Community board (`FB-bugtrk-board`) endpoint returns **only** triaged items and **never** exposes
  `ipHash`, `contact`, `userAgent`, `consoleTail`, or screenshot paths.

**Client (`tests/e2e/`, Playwright, after `npm run build`):**
- Host & player reporter: filling + submitting calls `POST /report` (assert request fired & `2xx`),
  toast shown, modal closes. With the endpoint stubbed to `500`, it **falls back** to `mailto:` +
  screenshot download (existing behavior preserved).
- `FB-bugtrk-auto`: a thrown uncaught error files **one** auto-report (not one-per-frame) — guards the
  no-per-tick rule.
