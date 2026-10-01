# UX comprehension study — Joystick Jammers 0.2

Completed planning pass, 29 September 2026. **Eight examples: five host and three mobile**, with
15 generated images and two rounds of blind first-look reviews by six fresh GPT-6 Luna agents.
Open the [visual gallery](index.html) to compare versions and inspect adjacent flow states.

**Ready for bead creation/reconciliation.** This study supplies UX decisions and testable task
slices; it does not certify final visual design, human usability or implementation. No new owner
product question blocks task creation. Extra displays remain Stretch. No game code, policy, beads,
commits or deployment changes were made by this pass.

## What we learned

| Example / recommended image | First-look issue | Revision and fresh-reader evidence | Still needs interaction testing |
|---|---|---|---|
| [H1 Landing](images/H1-host-landing-v1.png) | Host versus controller understood; “Add another screen” ambiguous. | Core concept retained. Both readers inferred the two primary roles. Add-screen entry is now specified as an extra display for an existing room. | Pairing panel, capability failure and manual-code fallback. The new panel is specified, not independently retested. |
| [H2 Returned lobby](images/H2-host-lobby-v2.png) | Idle behavior, choosing-player delay and event editing unclear. | Explicit no-auto-start status, 10-second warning and Change event. Fresh reader correctly described all three. | End → connected/unarmed Lobby on both surfaces; stale Ready; actual warning delivery. The sample has players who have readied again after the return. |
| [H3 Pause/settings](images/H3-host-pause-settings-v2.png) | Settings scope unclear. Coordinator found per-player camera incorrectly exposed globally and Party Mix labelled a mode. | Only this screen / Next round — everyone, correct Race mode and unfinished-round consequence. Reader understood scope and End versus Close. | Phone-admin pairing still inferred as a possible transfer; final copy/panel now explicitly says main host keeps running. Confirmations and composed pause need execution. |
| [H4 Intermission](images/H4-host-round-results-v2.png) | “Skip highlights” might skip the entire screen/start. | Hide replay + Timer keeps running, separate Start next round now. Fresh reader distinguished them correctly. | Deadline/loading transitions, no-vote default/ties, replay unavailable and unsaved results. |
| [H5 Two screens](images/H5-host-two-screens-v2.png) | Proposed distribution looked already applied. | Current assignment, “not applied yet”, Apply/Cancel. Reader correctly left all players on main until Apply and understood disconnect fallback. | Pairing, editing a move, stale drafts and next-map readiness/loss. |
| [M1 Join](images/M1-mobile-join-v2.png) | Coordinator found number assigned before the user claimed a seat. | Prefilled preview; number appears on Join acceptance. Reader understood immediate entry behind the pack. | Claim reply loss, race ending during claim, resume and next-life car changes. |
| [M2 Controls](images/M2-mobile-control-settings-v2.png) | Action directions/test-pad behavior and persistence duration unclear. Coordinator found a live world/minimap on the supposedly lightweight controller. | Flat HUD, explicit two-stick directions, local test pad, across-room persistence and personal exits. Fresh reader described all of these correctly. | Remember off/reset/storage denied, draft cancellation and actual neutral handback. Compact advanced wheelie help still required. |
| [M3 Results](images/M3-mobile-round-results-v2.png) | Reader said “R007 finished 1st”; Ready's early-start effect unclear. | Player identity leads; optional Ready explains all-ready early start. Reader attributed the result to the player and correctly described vote/Ready. | Closed/tied/default ballots, parked seat and host-returned mobile lobby. |

This is a qualitative comparison: one reader per group per round, not a statistically meaningful
success rate. Reviewers saw a small group of related images, so later images had within-group context.
Second-round agents were new and did not receive the first answers, rationale or target inferences.

## Decisions now in the plan

The integrated plan is r10, primarily §§6.5, 6.6a, 10.6, 10.6a, 10.8, 18.4 and 19.5.

- Opening a join URL previews the room; explicit Join claims the seat. Identity starts at host
  acceptance. Existing proof resumes; duplicate requests cannot create a second car.
- Returning everyone to Lobby stops auto-start and clears old Ready. A personal Sit out/Leave never
  affects everyone. End retains committed results and connections; Close revokes the room.
- Hide replay changes presentation only. Start next round now closes voting and waits for readiness.
  Ready is optional under auto-next. At deadline with assets unfinished, say Loading honestly.
- Fixed/floating controls and source preferences persist on this device across rooms. Remember off
  applies for this page session and removes the old saved profile; reset and storage failure are
  specified. Competitive assists remain separate.
- Personal settings explicitly hand the car to weak autopilot; save/cancel returns through neutral
  re-arm. Their test pad sends no gameplay actions. Controllers never load the world renderer.
- Extra-screen layout is a revisioned draft; Apply moves players, Cancel leaves them. Viewer loss
  restores tiles automatically without stopping the round. A second screen is never another authority.
- Room-admin pairing is distinct from player join, extra-display pairing and emergency host recovery.
  Each has its own explanation and scoped grant.
- Production room-code typography/alphabet avoids O/0 and I/1/L. Both rounds repeatedly read the
  mock “ROO7” as “R007”; the illustrated code and QR are placeholders, not a production contract.

Rationale, components/data/commands, failures and per-task acceptance are in [flows.md](flows.md).
Existing cuts own the work: V2-02/11/79a0/79b/100/104/111/116a/116/117/122, with normal tier
qualification. The release dependency graph remains 116 cuts; no new hidden Full/Stretch dependency
was added to Minimum. Conversion must copy the flow outcomes into executable children, not merely
attach a PNG to an epic.

## Coverage and release scope

H1/H2/H3 and M1/M2 cover Minimum entry, connected lobby, pause, lightweight settings and returns.
H4/M3 show the Full ballot variant; Minimum uses the same result/timer shell with Race rematch.
H2's Party Mix and multi-car choice are Full. H5 is the explicitly requested forward design of
Stretch displays. No feature is promoted by being illustrated.

The [flow contract](flows.md) also covers the phone after host return to Lobby, host/admin pairing,
display loading/moves/loss, destructive confirmations, code errors, reconnect, cancelled drafts,
unsaved preferences and results. The gallery's “Explore next states” presents these as text
wireframes. They were authored **after** the blind tests and have not been tested as interactive
product screens. This avoids claiming eight static images exhaust the full UX.

## Artefacts and reproduction

- [Gallery](index.html): all eight examples, original/revised selector, next-state wireframes and journey links.
- [Flow contract](flows.md): journey traces, commands, ownership, persistence, failures, rationale and task slices.
- [Round 1 raw responses](reviews/round-1.md) and [round 2 raw responses](reviews/round-2.md).
- [Validation record](reviews/validation.md): plan graph, local assets, links and desktop/mobile gallery checks.
- [Initial prompts](prompts.md), [revision prompts](revision-prompts.md), [image provenance](images/provenance.json).
- Images are local PNG copies from built-in image_gen; original generated files were retained.
- Reviewer model: GPT-6 Luna; reasoning: low; forked context: none. Generic inference questions,
  read-only view_image access, no project documents or answer key. Three groups per round:
  entry H1/M1/H2; host H3/H4/H5; mobile M2/M3.
- Gallery uses system fonts and local assets, works as a local file, and has no CDN or backend.
  Its navigation/compare/dialog controls are real; buttons drawn inside images are not interactive.

## Limits and implementation gates

The art establishes an Outback comic motorsport direction: cream/ink UI, cobalt/yellow identity,
red-dirt world and bold sporting headings. Some generated images retain excessive decorative copy,
inconsistent car/identity colours or awkward font/room-code glyphs. These are recorded defects,
not approved production assets. H4 still drifts from the intended #7/#12 palette; all production
screens must derive identity from the same kit. Shrink/remove branding before shrinking touch
targets, labels or controls. Generated cars are not a vehicle import/validation result.

Next evidence is real newcomers on phone/TV/pad: find their car, join unaided, open settings without
pausing friends, return from a menu safely, explain Ready and make a lobby/leave choice correctly.
Test target-device touch reach, text/QR viewing distance, long names, crowded rosters, accessibility,
network failure and storage denial. Scope remains with V2-44/121/99, with repair tasks for failures.
There is no claim of owner art approval or measured human completion time from this study.
