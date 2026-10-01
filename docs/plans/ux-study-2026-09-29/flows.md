# UX flow contract — r10

Planning specification, 29 September 2026. Read with plan §§3.6, 4, 6.5–6.6a, 10.6a, 10.8 and 17.5.
Owner policy → integrated plan → this contract → generated illustrations. Proposed command names below
describe semantic operations for V2-02; they are not claims about existing APIs.

## What the eight examples cover

| Example | Tier | Entry and user intent | Components, data and acknowledged exit | Failure and acceptance |
|---|---|---|---|---|
| H1 Landing | Minimum core; extra-screen link Stretch | Open site; decide whether this device shows the world or controls one car. | Lightweight route shell offers Host and Join. Host capability check precedes room registration; Join loads only controller assets. Host → H2 initial-lobby variant; Join → code/QR entry → M1. No action means no room/seat creation. | Unsupported host offers Join/use another device with reason. Denied camera offers code entry. Cold controller route never loads renderer/WASM world. Role understood without a manual. |
| H2 Lobby / returned party | Minimum, Party Mix variant Full | Host has ended an event; restart when the party is ready. | `jj-session` retains room, identities and committed results; RoundDirector is unarmed Lobby. Roster cards derive from seats, never a fixed slot array. Start current choices → force-start warning if necessary → Preparing/Countdown. Change event stages new rules; View results is read-only. | Delayed Ready from the old event cannot start this one. A choosing player gets the visible warning and enters with current selection. No interaction leaves Lobby idle. Results status reflects actual save outcome. |
| H3 Pause / settings | Minimum shell; Full-only rules conditional | Host deliberately pauses everyone, then adjusts settings or ends play. | Composed pause reason in `jj-session` stops active game/intermission clock. Screen-local settings update presentation; room rules stage acknowledged next-round revision. Resume removes manual reason only. Return lobby = EndEvent; Close room = Disband; both confirm consequences. | Hidden/fault reasons can prevent Resume: explain remaining reason. Losing host-control phone does not release pause or move authority. Cancel confirmation changes nothing; duplicate End/Disband is idempotent. |
| H4 Round results / replay | Minimum Race automatic-rematch shell; ballot Full | Celebrate a committed round and see what starts next. | RoundResult + save state + ReplayDirector + RoundDirector projection. Hide replay changes presentation only. Start next now closes ballots, commits winner/default and waits for preparation. Deadline countdown, vote-close and Ready all come from one host clock. | Replay failure keeps results and next-round flow. Save failure says unsaved. Loading at zero says Preparing, never negative countdown or fake Running. End cancels auto-next. Test hide/show while vote remains editable. |
| H5 Two screens | Stretch | Pair another display; review who moves before applying. | Separate scoped pairing → pinned build/assets/baseline Ready → assignment draft → revision-checked Apply → moved identity cues. All seats remain one simulation/scoreboard; each has one primary Grid tile. Displays consume snapshots, controllers still send intent. | Failed load never moves players; stale draft rebases visibly. Display loss puts seats back on main/ready displays without a gameplay pause. Rejoin needs per-round readiness and fresh Apply. No capacity control, waiting seats or second authority. |
| M1 Join running race | Minimum; multi-car picker Full | Confirm the room and join without a compulsory tutorial. | Room preview + optional prefilled name/car → idempotent ClaimSeat → accepted stable identity and Identify → controller. One touch screen claims one source/seat. Existing proof takes resume path. No identity allocated before Join. | Lost claim reply retries same request. Host unreachable remains Joining/Reconnecting. Invalid code has editable entry; ended room says ended. If race ends during claim, accepted seat enters intermission instead. No duplicate seats or waiting for next race. |
| M2 Your controls | Minimum touch; extra source adapters Full as planned | Tune controls without stopping friends; remember them next visit. | Neutral/cancel + personal-menu intent → host ack autopilot → local preference draft/test pad → apply/save → neutral re-arm → deliberate input. Versioned preference store is separate from seat credentials; `jj-input` shapes the ordinary source-blind vocabulary. | Storage failure remains playable with unsaved notice. Cancel/Back discards draft; no accidental wheelie/fire on release. Unsupported haptics is explained. Reload/another room restores only that profile. Host pause supersedes personal autopilot banner. |
| M3 Personal result / next round | Minimum result/rematch shell; ballot Full | See own result, vote, optionally start early or sit out. | Own identity leads, then RoundResult/save state and shared deadline. Vote uses identity + intermission revision; one editable vote. Ready signals early start if the nonempty eligible cohort is all ready; timer start does not require Ready. Sit out parks only this seat. | Stale vote/Ready is rejected with current state. A finalised ballot becomes read-only and announces winner. Reconnect keeps vote/identity; host End replaces this screen with connected Lobby. No personal button ends the whole room. |

The 8-player/4+4 screens are scenario samples. Increasing rosters use scrolling in management panels
and the uncapped layout contract for driving. Neither roster management nor sample pictures define
admission limits. Minimum uses one car and Race/rematch; hide unavailable car-changing, ballots,
chaos, events and extra-display controls rather than leaving dead promises.

## Adjacent states missing from a single image

### Entry, claim, identity and tutorial

1. Manual entry: “Room code”, Join; preserve a mistyped code on error. Camera denial never prevents
   manual entry. Joining from a QR opens the room preview directly.
2. M1 is **before claim**. “See the controls” is a lightweight diagram and optional local input pad.
   Return to the same populated form. It neither takes a seat nor spawns a practice world.
3. Join submits once; “Joining…” disables duplicate taps while retries reuse the request ID. After
   acknowledgement: “You're #7, Dusty — find this number on the shared screen”; pulse both surfaces.
   “Find my car” repeats the §5.2 Identify effect. The phone then has the two full thumb regions.
4. Actual interactive driving tutorial uses the same core via the host's safe practice presentation
   under V2-115, after a seat exists. The phone receives HUD/input feedback only. Skip/Help remain
   available; other players continue, and the joining seat has the plan's autopilot policy.
5. Name may change immediately; car changes during a race queue for next life/round with explicit
   effective time. No garage visit repairs the current car. Race ending during entry routes the
   accepted identity to the result/next-round state, not a second claim.
6. Reconnect says “Reconnecting as #7”, never a blank name form. Duplicate active tab, handoff,
   expired realm and recovery are distinct §3.6 outcomes. No resume by matching a name.

### Pause, return to lobby, personal sit-out and room closure

| Action | Confirmation / next surface | State effects |
|---|---|---|
| Resume game | Resume immediately if manual pause was the only reason; otherwise “Waiting for the main screen” or concrete fault. | Only manual reason cleared. Neutral re-arm on all sources. |
| Return everyone to lobby during a round | “End this event? This unfinished round won't count. Earlier results stay. Everyone stays connected.” Buttons Keep playing / End event. | Cancel jobs, void unfinished round, show committed summary, enter unarmed Lobby. Cancel leaves prior pause state untouched. |
| Return everyone to lobby from intermission | “Stop auto-next and return everyone to the lobby? These results stay saved.” Change last sentence to honest unsaved status if needed. | Committed score unchanged; deadline/Ready invalidated; room retained. |
| Phone after host End | “Back in the lobby — you're still connected”, #7, “Waiting for the host”, Car & controls, own Ready/choosing state. | No countdown; Ready cannot arm the room. Host Start/arm is explicit. |
| Sit out during race | “Sit out? Your car leaves this round. Your scores stay and you can rejoin.” | Park seat under §4.4; remove tile/ballot eligibility, remember legal progress. No repaired re-entry. |
| Sit out next round during intermission | “Sitting out — still connected”, Rejoin button, result still visible. | Exclude parked seat from Ready/ballot; remove its current ballot before close. At/after close, committed electorate/result stays frozen. |
| Leave room | “Leave room ROO7? Only you leave. Everyone else keeps playing.” | Personal departure under §4.4; keep return proof/standings, go to landing with Resume room when valid. |
| Close room | “Close room ROO7 for everyone? Controllers will disconnect and this join link will stop working.” | Disband revokes room credentials; clients show ended state and final committed summary. It is never a response to a transient disconnect. |

Browser Back closes a personal draft/confirmation before leaving the controller. Navigation,
visibility loss and cancellation neutralise input. A server acknowledgement determines room/seat
transitions; a spinner never claims the transition has already happened.

### Persisting control schemes

The initial touch presets are Floating and Fixed; they retain the same two-stick action mapping.
They change ergonomics, not gameplay capability. Keep normal braking and deliberate wheelie detent
separate; the tiny diagram is an introductory summary, with a dedicated advanced Help step.

- **Draft:** editing affects only the local test pad until Save. “Test these controls” shows axis
  position, current semantic action and neutral/re-arm; it emits no gameplay intent. Autopilot drives
  the real car. It is not a remote world viewer or an isolated physics fork.
- **Apply:** validate the profile, neutralise input, apply its version, optionally save, return to
  controller. Hold-to-drive does not carry through the settings transition.
- **Remember on:** persist the profile for this browser and source across room/room-code changes,
  until Reset/browser data clear. No server/account sync; preview and production are separate.
- **Remember off:** apply for the current page session and delete the prior saved profile for this
  source. Reload/new tab starts defaults. Visible help must explain this; unchecked does not mean
  “discard what I just changed”.
- **Reset:** confirm the source name, restore defaults and persist/remove according to Remember.
  Do not clear membership, controls on another source, car choice, identity or score.
- **Migration/failure:** validate known fields with explicit defaults for changed/unsupported
  controls; storage denial is “Applied for now — this browser couldn't remember your settings”.
  A disconnected command is not labelled saved on the host. Preference saving alone is local.
- **Sources:** touch is one local profile. Pads/keys use source-appropriate controls and manually
  selectable local profiles; transient browser pad indices are not trusted as permanent hardware
  identity. On uncertain matching use defaults and offer the saved profile, not a silent calibration
  transfer. No extra source discovery or fingerprinting just for preferences.
- **Ownership:** Camera first/third-person is a seat preference rendered by the host; motion/haptics
  here affect this controller. Learner/assist changes are separate visible gameplay requests, with
  next-life/round acceptance; no silently enabled assists in the response slider.

### Timer, ballot and replay

The 42 s / 32 s pictures are one static point in the same 60 s active-clock intermission. Pauses
freeze both. At vote close, show winner/mode and “Preparing next round”; if ready before the remaining
10 s elapses, preserve the scheduled start unless all-ready/host early start occurs. At zero, start
only after required preparation and the director's countdown. If loading overruns, replace the
numeric prediction with “Course loading — starting when ready” and keep usable settings/help.

“Hide replay” does not advance time, close the ballot or mark anyone Ready. “Show replay” restores
available clips. A majority skip-playback request has the same limited effect. “Start next round
now” closes the ballot, freezes selection and requests preparation/start; it cannot force unready
assets through. A ready-based policy override retains its warning; ordinary Party Mix auto-next
does not issue a redundant warning.

Winner = most accepted votes; tied top options with actual votes use recorded seeded RNG. With no
accepted votes, use the displayed default (§10.12); label that default before voting closes.
Publish the winner, vote totals and default/tie/host-override
reason after close. A “How voting works” expander explains this before close without making it a
mandatory reading step. Readiness, map choice and skip-playback are three separate intents.

The UI says “Result saved on the main screen” only after host checkpoint acknowledgement. Otherwise
“Result counted — not saved yet”, with recoverable storage diagnostics on the host. No retention
promise beyond plan §3.4; no implication of a cloud account or phone result store.

### Adding a display and managing from a phone

These are separate roles with separate QR/link scopes:

| Step | Extra display (Stretch) | Room-control phone (Minimum) |
|---|---|---|
| Start | “Extra display for an existing room” → main host opens Add screen and shows display pairing code. | “Manage room from a phone” → “The main screen keeps running the game. This phone gets room controls, not a player seat.” |
| Pair | New screen redeems short-lived display grant, same realm/build, labels device and viewing profile. | §3.6 two-minute one-use grant; phone/host show matching phrase; main host approves. |
| Pending | “Loading this round”; current players remain on working screens. Failed asset offers retry/cancel. | “Waiting for approval”; denied/expired offers a new request, not host replacement. |
| Ready | Main host sees current assignment + proposed partition, visible draft status. | Phone gets authorised administration; main host retains simulation authority. |
| Apply | Host confirms revision-checked layout; controllers/both screens identify moves. Cancel changes no layout. | Each admin action is acknowledged by active host; unreachable main host disables commands. |
| Loss | Tiles return automatically to remaining ready displays. Rejoin needs new round readiness and a fresh assignment. | Game keeps running. Main host can revoke grant. No seat, ballot or replacement-host privilege. |

“Move a player” opens a selected identity and destination list; save changes the **draft**. Automatic
placement gives later joins a working tile without waiting for the host. A draft based on old roster/
readiness is visibly refreshed before Apply. Mirror Overview is disabled with the arena-only reason
in Race. Additional displays default to muted world audio to avoid doubled sound; local audio can
be enabled explicitly. Viewer performance failure never blocks simulation.

## Buildable slices and evidence

These extend existing cut IDs; they create no new beads or release prerequisites.

| Cut / child | Depends on | Outcome / required fixtures |
|---|---|---|
| V2-02 UX command contracts | Existing shared type work | Claim dedup; start/intermission revisions; menu intent/ack; layout draft revision; server-enforced scope. |
| V2-11 preference schema + source shaping, then storage adapter + local test pad | V2-10; schema before storage | Fixed/floating same semantic trace; neutral cancellation; remember/off/reset/migrate/denied storage; source separation. No host simulation dependency for preference tests. |
| V2-79a0 identity/garage forms | Existing V2-16/11/12 | Optional edits, defaults, accepted identity, no multi-car prerequisite; one-car Minimum. |
| V2-79b ready/start revision reducer | Existing V2-79a0/03 | End → idle lobby; stale Ready ignored; current-selection 10 s warning; explicit arm. |
| V2-100 + V2-77 round UI integration | Existing director/replay prerequisites | Hide ≠ start; paused deadlines; zero + unready assets; counted/unsaved; M3 Ready/vote semantics. Full ballot child remains V2-104. |
| V2-116a Minimum route/personal-menu integration | Existing V2-03/79a0/125 | H1/H2/M1/M2 and Minimum result/lobby variants; ack menu/autopilot, claim→round-ended race, duplicate tap, lost reply, browser Back. Integrated driving evidence at V2-121. |
| V2-122 paired phone admin UI | Existing V2-03/05/119 | Correct role/phrase, revoke/deny/expiry, End vs Disband confirmations; never transfers simulation. |
| V2-116 Full surface children | Existing Full prerequisites in §18.4 | Rich garage/event/ballot/result/host-rule variants with same lifecycle and real fixtures; human comprehension and device captures. |
| V2-111 viewer pairing → readiness → draft assignment → stream/loss integration | Existing Stretch prerequisites | H5 current/proposed distinction; stale draft; late joining seat; next-map asset failure; lose/rejoin viewer; no parked players from display capacity. |
| V2-44 / V2-121 / V2-99 qualification | Existing tier closure | Actual newcomers complete joins, resume, settings and lobby-return on target devices; owner feel/look verdict after real captures. |

Acceptance captures need actual DOM/renderer state, not these PNGs. At minimum: pointer + keyboard/
pad access, visible focus, screen-reader labels, 44 CSS px touch targets as a design target, portrait/
landscape safe areas, 200% UI text, long names/labels above 99, crowded rosters, no reliance on colour,
reduced motion, denied haptics/storage, slow/offline/reconnect, stale command and duplicate tab.
Raster text at arbitrary scale cannot qualify any of those. Controls/settings can scroll; driving
sticks cannot be pushed off screen by decorative branding.

## Decisions and rationale

- A join confirmation avoids phantom cars from link previews/accidental scans; prefilled defaults
  preserve a one-tap path. The visible identity starts at the actual accepted claim boundary.
- Personal settings deliberately enable weak autopilot rather than globally pausing; the player can
  safely read while friends continue. Neutral re-arm prevents setting changes from triggering stunts.
- Preferences live on the device because the product has no account model and ergonomics follow the
  source. Deleting the previous record on Remember off makes next-visit behavior predictable.
- Lobby return disarms starts because “let's stop for a moment” must not immediately restart from
  preserved Ready bits. Normal automatic intermission remains hands-free.
- Replay visibility and round progression are distinct: people may want results/voting visible
  while keeping the same social break. “Skip” was too ambiguous in the blind review.
- Applying a display draft explicitly prevents silent moves while arranging screens. Lost viewers
  fall back automatically because keeping everyone playing outranks the chosen distribution.
- Rich illustration establishes direction, but rendered UI must reuse stable tokens, identities and
  production assets. Generated number/colour drift and decorative filler are not new requirements.
