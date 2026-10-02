# Owner direction for Joystick Jammers 0.2 (2026-09-29)

**Status:** normative. Implementation agents, bead authors and reviewers must follow this document.
The full rationale lives in `docs/plans/v0.2-revamp-plan-2026-09-28.md` (rulings R1–R82). The
design brief is `docs/plans/v0.2-experience-direction.md`.

## Precedence

1. The latest explicit owner ruling (this document and the plan's rulings table).
2. The v0.2 plan and the policy/design contracts it references.
3. Reconciled beads.
4. Existing code, tests and older docs.

A bead, test or older doc **cannot override** a ruling. If a bead, an old test or an older section of
`AGENTS.md`/`README.md`/`docs/` contradicts this document, this document wins. Flag the conflict; don't
"fix" the ruling to match the code. Existing code is evidence to inspect, not a constraint.

## Hard rules (short form)

| Area | Rule |
|---|---|
| Separation | Joystick Jammers is completely separate from Physical Soccer: no shared code, crates, repos, deploy repo or imports. Borrow ideas only. (R1) |
| Server | Rust replaces the Python game server from day 0; Asupersync, no Tokio. Python stays for Blender/offline tools only. (R2) |
| Simulation | Authoritative game simulation is Rust (`jj-sim`, native `rapier3d`) compiled to WASM for the browser host and native for tests/tools. 120 Hz game time, interpolated rendering, named composable pauses. (R61, plan §13) |
| **No caps** | **No arbitrary gameplay-count limits anywhere**: players, seats, controllers, tiles, fielded cars, live debris. No temporary/MVP/intermediate limits, queues, truncated arrays or count-triggered refusal. Test cohorts are samples, not limits. (R36, R47, R66) |
| Debris | Detached parts and fragments stay **dynamic** bodies for the round (sleep/wake allowed). Never convert to static, delete oldest, merge or budget by count. (R58) |
| Replays | No live killcam/PIP/interstitial. Highlight reels play after a round. Stored replay capacity *is* a permitted memory budget; it never limits live play. (R57, R67) |
| Controls | Two big joysticks: left DRIVE (steer, throttle, brake/reverse, deep pull-release wheelie), right ACTION (weapon forward/back; boost/drift sideways). No tap-to-fire, no accelerometer/flick boost. Real tutorial. (R60) |
| Phones | One phone = one player on its touchscreen. A second player on the same phone only via an external controller plugged into/paired with it (own seat). (R65) |
| Dropout | Controller dropout never pauses the room; a visible weak autopilot takes over. Host backgrounding pauses/resumes the same simulation. (R45, R59) |
| L-plates | Visible L-plates. Learners may win, but get a reduced payoff from advanced mechanics (boost, drift, wheelie/hop). No speed cap or forced losing. (R64) |
| Late joins | Race entrants join last, a few seconds behind the last racer. Derby: 3 min, raw points; late joiners are allowed to be disadvantaged. (R56, R63) |
| Dependencies | Runtime assets/libraries remain self-hosted: no runtime CDNs, remote fonts, model hosts or decoder downloads. Start from current stable releases, pinned and qualified. Cloudflare STUN/TURN is an explicitly allowed managed connectivity service, not an asset-CDN exception. (R70, R76, R79) |
| Hosting and transport | Rust HTTPS discovery/room/signalling service; **WebRTC controller ↔ host gameplay from the first multiplayer slice**. Prefer direct LAN where viable, with trickle ICE and Cloudflare standalone STUN/TURN initially. No SFU, mandatory WSS gameplay fallback, per-input Rust hop or coturn deployment prerequisite. Offline bootstrap remains deferred; local gameplay paths are core scope. Runtime player-name TTS is shelved. (R69, R71 amended by R77/R79) |
| Input efficiency | Compact binary state, fair hub batching on one connection per browser endpoint, bounded-age queues and a simple two-channel delivery policy are required from Minimum. Measure bandwidth, packet overhead and latency for phones/pads/keys/hubs; preserve every source and loss-safe release/reconnect. Complexity increases only with evidence. Playtest direct/relay incidence and Cloudflare usage before considering self-hosting. (R80, plan §13.3a) |
| **One screen first** | Minimum and Full focus on one excellent shared display. Additional consuming screens are a **high-effort, low-near-term-reward, separately owner-gated project** (G-SCREENS), not ordinary Stretch or automatic post-playtest work. Extra arenas/modes/themes and release do not depend on it or authorise it. No multi-screen implementation or replication spikes until the owner explicitly approves that scope. Preserve small boundaries, not speculative infrastructure. (R78) |
| Previews | Production on `jammers.dilger.dev`; all rainbow previews on `jammers-preview.dilger.dev/p/<id>/`, each with its own backend. Keep latest + pinned; unpinned expire after 24 h; at most 3 unpinned. (R52, R72, R73) |
| Builds | Use RCH for heavy builds/tests/sweeps; record receipts. (R35) |
| **Vehicle modelling** | Canonical method: per-tier reference sheets → silhouette masks/measurement → three.js model script (faceted at every tier, one code-drawn atlas, very lean triangle budget) → silhouette-IoU scoring + regularised optimiser → by-eye cue pass → bake to the contract. Skill `lowpoly-model-from-refs`; evidence `spikes/art-pipeline/J-cruze-lowpoly/`. Blender is not the vehicle path. (R81, amends R54) |
| Damage parts (interim) | For now: `front`, `back`, four doors, four wheels; intact → dented → detached; the rest is core. The fuller §8.1/§8.2 anatomy is a later target. (R82) |

## Superseded guidance

**2026-10-02 modelling amendment:** R81 supersedes R54's Blender requirement and the Blender-based vehicle steps
in plan §12.4–12.5 and V2-82/82a. Older vehicle-modelling skills and spikes (G Blender, H primitive kit, I destruction)
are reference material, not the method.

**2026-09-30 transport/display amendment:** R77 supersedes the WSS gameplay requirement and the
deferral of controller WebRTC. R78 supersedes the ordinary Stretch scheduling of extra screens.
The detailed multi-screen notes remain future design references, not permission to execute them.
R79 selects Cloudflare STUN/TURN first and makes viable local direct paths a day-one requirement;
R80 makes efficient controller transport explicit. Older references to the Rust gameplay relay
mean the discovery/signalling service for 0.2; the host receives gameplay directly over WebRTC or
through TURN, never through a second Rust input-forwarding implementation.

Older guidance that conflicts with these rules is superseded for 0.2 work, including: the JS vehicle
simulation and "never change suspension implementation" rules, Flask/Socket.IO server instructions,
Voronoi/split camera plans, the neon/lo-fi art direction, tap-to-fire controls, split-phone play,
static/merged debris, player caps and the `beads-polishing` goal list. Superseded plans/design/spec
docs were removed on 2026-09-29 (recoverable at commit `bbadc3e`, listed in `docs/README.md`). The
remaining 0.1 code docs carry a banner and are rewritten as 0.2 replaces the code.

## Tracker clean slate (ruling, 2026-09-30)

Every pre-0.2 bead that was not done by 2026-09-30 is closed **without implementation** and labelled
`superseded-v0_1` (95 beads). The tracker restarts empty; 0.2 work enters only as new beads cut from
the v0.2 plan (§18.4 conversion contract). Don't reopen a `superseded-v0_1` bead to implement its 0.1
scope. If an idea is still wanted, cut a fresh 0.2 bead that cites the plan. Old bead bodies are
evidence to read, not work to resume (`br list --status closed --label superseded-v0_1`).
