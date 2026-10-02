# Owner direction for Joystick Jammers 0.2 (2026-09-29)

**Status:** normative. Implementation agents, bead authors and reviewers must follow this document.
The full rationale lives in `docs/plans/v0.2-revamp-plan-2026-09-28.md` (rulings R1–R92). What the
first playtest builds, and in what order, is `docs/plans/v0.2-playtest-1-plan.md` (the bead source
for the Minimum build). The design brief is `docs/plans/v0.2-experience-direction.md`.

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
| Damage parts (interim) | For now: `front`, `back`, four doors, four wheels; the rest is core. **Each part goes intact → loose → detached; no denting** (R86 amends R82). Loose = visibly hanging/wobbling on its hinge while still attached; detached = a dynamic body left on the track for the round. In Playtest 1. The fuller §8.1/§8.2 anatomy is a later target. (R82, R86) |
| Host recovery (deferred) | Emergency host replacement, recovery export/import, registration CAS, credential revision, host checkpoint/restore after host death, explicit device handoff and the paired host-control phone are **deferred, possibly forever**. A dead host ends the room. A controller still resumes its own seat on the same device, and a host re-registers its room after a server restart. Possible drive-by only if G-SCREENS is ever approved. (R84) |
| Continuous previews | **No dev freeze for playtests.** Rainbow previews ship from the first deployable slice and keep shipping; a playtest is a preview the owner **pins**. A preview index at `https://jammers-preview.dilger.dev/` lists every preview newest first, with what changed, smoke status, pin/expiry and Host/Join links. (R85) |
| TURN (R88) | Self-hosted coturn at `turn.dilger.dev` first (UDP only, REST credentials, private peers denied) behind a narrow geo-restricted FortiGate UDP VIP; Cloudflare TURN is the TCP/TLS and overflow fallback. Everything else stays on Cloudflare tunnels. `docs/infra/turn-and-previews.md`. (R88 amends R79) |
| Audio (R89) | Announcer = the owner's voice cloned with Qwen3-TTS 1.7B on eris (FrankenWhisper transcripts); music = YuE2 at full precision on eris, instrumental only. Highest quality wins; weights/recordings never in the repo. (R89 amends R13/R19/R55) |
| **Validation in the loop** | Every part of the game is introspectable as structured data, settable, steppable/replayable and fixture-testable by agents. Capability required; design is the implementer's call. (R90) |
| Coordination | NTM paused; native Claude Code agents and messaging; Agent Mail for reservations and the commit guard. (R91) |
| Cloudflare TURN (R92) | Fallback enabled with an **accepted, bounded** billing risk: lazy issuance on relay-fallback requests with per-room/IP limits, spend guard (alert 10 %, delete keys at 25 % of the free 1,000 GB), CF budget emails. Issued credentials can't be revoked, so no zero-charge guarantee. HA push approved for this alert only; nothing else may depend on Home Assistant. Issuance goes through one `turn-broker` that alone holds the Cloudflare token (approved 2026-10-02; Playtest-1 plan §5.3). (R92) |
| 0.1 code | The 0.1 code was removed from the `v0.2-revamp` branch on 2026-10-02; read it with `git show v0.1-final:<path>` (tag on `main` @ `bbadc3e`). Production stays 0.1 on `main` until 0.2 is promoted. Nothing is ported as code; useful cases are re-expressed as 0.2 tests (Playtest-1 plan §14). (R87) |
| Procedural biomes (R83) | First playtest has all four biomes (town, rocks, outback dirt, outback bitumen) at deliberately minimal variation; breadth comes after the playtest. One seed/terrain core cut, then four parallel biome cuts; derby is separate with rocks vibes. Signs: Wikipedia *Road signs in Australia* is the style source; new/joke signs are allowed if they follow a real sign family's grammar (e.g. yellow diamond "BLOODY BIG JUMPS AHEAD"). Plan §11.5a. 2026-10-02: the seed/RNG and course-graph core may start before G-PROCSPIKE; the rest of the core follows the spike's recommendation, which the owner reviews when convenient rather than as a gate (Playtest-1 plan Q-P1, §15.0). |
| Worker loop (2026-10-02) | Workers get the full development loop: debug, inspect game state, run local and multi-device setups and servers, write and run e2e tests, and iterate on mechanics and models (with visual inspection) until they work. Only the full CI matrix is batched: the validator verifies many submitted changes in one run, and a failure keeps the bead open and sends it back to its agent with a note (code-first/batch-verify). Favour Physical Soccer's test style (scenario banks, journeys) over many unit tests. `docs/process/code-first-batch-verify.md`. |
| Owner feedback never blocks (2026-10-02) | No bead waits on the owner except the Playtest-1 qualification itself. Where the owner's eye matters (procgen direction, voice, music, feel, looks, Windows or Mac Safari hosting), work proceeds on its best evidence-backed candidate, the owner judges it at a playtest or when convenient, and a "no" becomes a repair bead (Physical Soccer's habit). |
| One shared tree, shared runners (2026-10-02) | No git worktrees or extra clones for agents: one shared working tree, coordinated through native Claude messaging and Agent Mail file reservations (worktrees caused an integration nightmare). Remote per-run directories are only for non-code outputs. All Gitea runners are shared across the owner's projects, deploy runners included; the security trade-off is accepted for these projects. |
| Every feature earns its keep (2026-10-02) | A tool, command, flag, helper, skill or harness feature exists only when a named task needs it now; scaffolding that stops earning its keep is deleted. The `jj` CLI stays small (Playtest-1 plan §13b.2). |
| Bead evidence (2026-10-02) | Beads close on CI, emulators and Playwright only. Real-device checks are the owner's playtests (Playtest-1 plan P1-Q02 checklist); a failed row becomes a bug bead. Owner verdicts (spike, voice, music, G-FEEL) stay owner evidence. |

## Superseded guidance

**2026-10-02 playtest-scope amendment:** R84 removes host recovery, the host-control phone and
device handoff from the Minimum build (master plan §3.4, most of §3.6, J08, J09, G-RECOVER, V2-120's
recovery parts, V2-122). R85 makes previews continuous and adds the preview index. R86 replaces the
dented stage with a loose stage. R87 removes the 0.1 code from the 0.2 branch. The Minimum build is
now specified by `docs/plans/v0.2-playtest-1-plan.md`.

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
remaining 0.1 code and its docs were removed from this branch on 2026-10-02 (R87; tag `v0.1-final`).

## Tracker clean slate (ruling, 2026-09-30)

Every pre-0.2 bead that was not done by 2026-09-30 is closed **without implementation** and labelled
`superseded-v0_1` (95 beads). The tracker restarts empty; 0.2 work enters only as new beads cut from
the v0.2 plan (§18.4 conversion contract). Don't reopen a `superseded-v0_1` bead to implement its 0.1
scope. If an idea is still wanted, cut a fresh 0.2 bead that cites the plan. Old bead bodies are
evidence to read, not work to resume (`br list --status closed --label superseded-v0_1`).
