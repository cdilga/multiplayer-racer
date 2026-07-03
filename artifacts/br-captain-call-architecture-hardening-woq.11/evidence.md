# woq.11 Slice 2 — join-route/UI integration Evidence (NobleBay)

Wires the validated Slice-1 `joinRouteResolver` into the real join route + player flow so the entry journeys are observable, deterministic, and testable from EXPLICIT typed route state (never user-agent sniffing). Reservations 3575-3583. Bead in_progress; NOT closed.

## Files changed (reserved only)
- `server/app.py` (3575) — new `/join/<room_code>` deep-link route: room in the path, `via`/`intent`/`pair`/`reconnect` in the query drive the client resolver.
- `src/player/main.js` (3576) — the ES entry now imports and exposes `window.resolveJoinRoute` + `JOIN_VIA`/`JOIN_INTENT`/`JOIN_ENTRY_KIND` (player.js is a plain global script).
- `static/js/player.js` (3577) — on boot reads `via/intent/pair/reconnect/room` from URL (path + query), calls the pure resolver with a client roomState + Local-phone capability (`canRenderViewer:false`), sets `window.__joinRoute`/`window.__joinEntry`, drives the chooser + role badge, and reaffirms the renderer guard `window.__worldRendererStarted=false`.
- `frontend/player/index.html` (3578) — additive entry chooser (screen / controller / spectator) + role badge, sticker-chrome styled with tokens (no glass/glow/raw-font).
- NEW `tests/e2e/join-routing.spec.ts` (3580) — deterministic browser proofs.
- `static/js/engine/joinRouteResolver.js` (3579) / `docs/contracts/join-route-matrix.md` (3582): unchanged (Slice-1 resolver already covers the cases).

## Acceptance items PROVEN this slice (tests/e2e/join-routing.spec.ts => 7 passed)
- Host QR: `/join/WXYZ?via=host_qr` -> entryKind `host_qr_controller`, role controller, showChooser=false, startRenderer=false, chooser hidden, room derived from path.
- Copied invite (no intent): -> `copied_invite_chooser`, chooser visible.
- Controller-only intent: -> `controller_only`, no renderer, no chooser, badge "Controller".
- Screen/viewer intent: -> `remote_screen_viewer`, role viewer, `pairPrompt=true`, degrades to no world renderer on the phone, badge mentions "pair".
- Watch-only intent: -> `spectator`, readOnly=true, `gameState.entryReadOnly=true`.
- Pair QR: `via=pair_qr&pair=...` -> `pair_controller`, bindToExistingSeat=true, no new seat, no renderer.
- Chooser interaction: clicking "I can see the game screen" re-resolves to `controller_only` and hides the chooser.
- Local-phone renderer guard: `window.__worldRendererStarted===false` and `typeof window.game==='undefined'` in every case (phones never instantiate the world renderer; only the pre-existing car preview exists).
- No user-agent-only routing: `window.__joinRoute.usedUserAgentOnly===false`; role decided by via/intent, capability only gates rendering.

## Commands (fresh, by me)
- `npx vitest run tests/unit/join-route-resolver.test.js` => **29 passed** (Slice-1 resolver incl. capacity-stress-no-reject, invalid-pair fallback, reconnect restore).
- `npm run build` => **PASS** (resolver bundles into the player entry).
- `npx playwright test tests/e2e/join-routing.spec.ts` => **7 passed**.
- Regression: `npx playwright test tests/e2e/join-flow.spec.ts --workers=1` => **8 passed** (existing manual join unaffected; a bare `/player` with no room resolves to `missing_room` -> NO chooser, so the normal type-room-and-join flow is untouched).

## Local/Remote invariant + vocabulary
- Local phone stays controller/HUD-only: no world renderer added (guard asserted); screen/spectator intents degrade (no local world render) on the phone build; server sim/network untouched.
- Roles come from `sessionVocabulary` (host/controller/viewer/spectator) via the resolver — no parallel role names invented.

## REMAINING for full-bead closure (Slice complete / full bead BLOCKED)
1. Pair-QR IMAGE generation + token issuance — overlaps `woq.12` (FB-pair two-device one-seat pairing). This slice handles pair INTENT/binding decision + invalid-token fallback (resolver + unit test), not QR image creation.
2. Host-lobby QR vs pair-QR VISUAL distinction in host UI — needs `LobbyUI.js`/`static/css/host.css`, currently HOT with active 5k3.25 design-language work; deferred to avoid collision (post a blocker/coordinate before editing).
3. Authoritative SERVER seat-binding for viewer/spectator/pair roles + full in-game read-only control suppression for spectator — overlaps `48a` remote-play; this slice proves the client decision/intent is observable + testable, not the server seat lifecycle.
4. Capacity-stress LIVE server proof (no arbitrary cap reject) — covered at the resolver level by the Slice-1 unit test; a live overloaded-room e2e needs server load simulation.

## Out-of-scope observation (NOT woq.11)
`tests/unit/ui-deglass-guard.test.js` (a 5k3.25 file) currently fails on `frontend/host/index.html` — a `box-shadow: 0 0 14px rgba(...)` soft glow added by the concurrent 5k3.25 host-bootstrap work (I did not touch host/index.html in woq.11), plus a guard false-positive on `inset 0 0 0 3px` (a hard ring, blur 0). Flagged for the 5k3.25 owner; not part of this slice.
