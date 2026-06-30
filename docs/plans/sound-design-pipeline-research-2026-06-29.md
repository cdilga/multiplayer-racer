# Sound Design Pipeline Research

Status: draft research artifact for `br-sound-design-pipeline-64l5.1`
Date: 2026-06-29
Author: `RubyBass`

## 1. Outcome

Recommended pipeline for Joystick Jammers:

- Keep the runtime on native Web Audio plus bundled checked-in assets.
- Do not add a new runtime audio dependency in this bead.
- Keep procedural runtime synthesis for the sound families where it already fits well: engine, simple UI earcons, some boost/wheelie layers, and a few synthetic weapon moments.
- Prefer authored bundled samples or pre-rendered stems for collisions, most weapons, pickup/readability moments, crowd/result cues, and music.
- Allow jsfxr/sfxr-style tooling, Tone.js-style sequencing, MIDI tooling, DAWs, and external generation only as authoring-time or lab-time tools unless a later bead proves the runtime cost is worth it.
- Route all final sounds through one manifest/bus/voice-budget layer in `br-sound-design-pipeline-64l5.2`, not through ad hoc `AudioSystem` placeholders.

This direction matches the repo's current shape:

- `package.json` has no dedicated audio runtime dependency today; runtime deps are only `three`, `@dimforge/rapier3d-compat`, and `socket.io-client`.
- `static/js/audioManager.js` already owns `AudioContext`, unlock, decode/load, ducking, music crossfades, and one-shot sample playback.
- `static/js/audio/EngineSynth.js` already proves that native Web Audio procedural synthesis works here.
- `static/js/systems/AudioSystem.js` still has placeholder event-to-sound mappings for many gameplay events, especially weapons and race cues.

## 2. Repo Baseline

### 2.1 What exists now

- Runtime audio entry points:
  - `static/js/audioManager.js`
  - `static/js/systems/AudioSystem.js`
  - `static/js/audio/EngineSynth.js`
- Loaded music assets: 6 MP3 tracks under `static/audio/music/`
- Loaded SFX assets: 9 MP3 clips under `static/audio/sfx/`
- Procedural runtime sounds already present:
  - engine synth
  - synthesized missile launch
  - synthesized explosion
- Core runtime behaviors already present:
  - unlock on user gesture
  - decoded `AudioBuffer` playback via `fetch` + `decodeAudioData`
  - music crossfade
  - ducking
  - per-sound cooldowns
  - no per-frame logging in audio hot paths

### 2.2 Current gaps

- No sound manifest/schema. Asset paths and event mappings are hardcoded in `audioManager.js`.
- No explicit bus model beyond music vs SFX plus engine volume helpers.
- No explicit voice budget or priority stealing. `activeSounds` is tracked, but there is no concurrency cap or family priority policy.
- Race/derby/gameplay sound coverage is incomplete. `AudioSystem` reuses placeholder clips for many moments:
  - checkpoint uses `button_click`
  - lap complete uses `countdown_beep`
  - pickup reuses `player_join`
  - boost reuses `engine_rev`
  - several weapons use placeholders or generic collision sounds
- No explicit Local-host vs controller split in the audio runtime yet.
- No seeded or captured deterministic path for procedural audio analysis yet.

### 2.3 Runtime fit observations from local inspection

- The project currently decodes every music and SFX file into `AudioBuffer`s at startup.
- That is fine for today's small asset set, but `AudioBuffer` stores decoded PCM in memory, so a much larger music library will cost far more RAM than the compressed MP3 size suggests. This is an inference from the Web Audio model plus the current loading pattern, not a measured bug yet.
- The audio code is already centered on Web Audio primitives, so introducing a second runtime abstraction layer is not justified without a clear payoff.

## 3. Product Constraints That Matter

### 3.1 Local mode

- The host renders the world and owns the shared room mix.
- Phones are controllers, not world renderers.
- Local phones should not instantiate the full world-audio stack.
- If controllers need audio at all, keep it to tiny UI-confirmation cues only, not engine/weapons/music.

### 3.2 Remote mode

- Each viewer renders their own scene and therefore can own their own local mix.
- Remote viewers must degrade independently:
  - drop ambience and crowd beds first
  - then reduce sweetener layers
  - keep own-car engine, own critical UI, nearby collision reads, and important weapon telegraphs
- Remote audio cannot assume desktop horsepower; CPU-heavy synthesis and large concurrent decode sets must stay optional.

### 3.3 Repo rules

- No CDN runtime additions.
- No silent runtime dependency creep.
- Browser audio unlock must remain explicit and reliable.
- High-player chaos means voice limits, cooldowns, ducking, and readable hierarchy matter more than "realism."

## 4. Browser And Runtime Constraints

### 4.1 Unlock/autoplay

- Chrome's autoplay policy blocks audio until user interaction in many cases, and Web Audio contexts can begin suspended.[S1]
- The repo already handles this correctly with `click` / `touchstart` / `keydown` unlock plus a UI hint in `audioManager.js`.
- Recommendation: preserve this behavior and make it part of the runtime contract in `.2`.

### 4.2 `OfflineAudioContext`

- `OfflineAudioContext` renders audio as fast as it can into an `AudioBuffer` rather than playing it to speakers.[S2]
- That makes it the right tool for repeatable synth tests, waveform/spectrogram generation, regression fixtures, and objective sound checks.
- Recommendation: use it for the sound lab and acceptance gate, not for gameplay runtime.

### 4.3 `AudioBuffer` and decode model

- MDN describes `AudioBuffer` as a memory-resident asset type intended for short audio snippets, usually under about 45 seconds.[S3]
- `decodeAudioData()` asynchronously decodes compressed audio data into an `AudioBuffer` at the context sample rate.[S4]
- Recommendation:
  - keep `AudioBuffer` for SFX, UI, short stingers, and short loops
  - accept current `AudioBuffer` music loading for the present 6-track catalog
  - if the music catalog grows materially, revisit whether long-form music should stay predecoded or move to a streamed path later

### 4.4 Testability

- Native Web Audio plus `OfflineAudioContext` gives the cleanest route to deterministic offline rendering.
- Anything that injects extra abstraction but still bottoms out in Web Audio has to beat that baseline on authoring productivity, not just feature count.

## 5. Candidate Methods, Libraries, And Tools

### 5.1 Runtime strategy summary

| Method/tool | License | Runtime cost | Fit here | Decision |
| --- | --- | --- | --- | --- |
| Native Web Audio + bundled samples | platform API | lowest new cost | already in repo, strongest fit | primary runtime path |
| Native Web Audio procedural synth | platform API | low to medium CPU | already proven by `EngineSynth` | keep for selected families |
| jsfxr/sfxr-style param synth at runtime | Unlicense for `jsfxr`; Bfxr2 MIT beta | low bundle, limited palette | good for retro/UI/pickups, narrow timbral range | authoring-first, runtime optional later |
| Tone.js runtime | MIT | non-trivial bundle and abstraction surface | strong sequencing/synth toolkit, but heavier than current needs | do not add now |
| Runtime MIDI playback/parser | varies; `@tonejs/midi` MIT | extra parser/runtime path | weak fit for no-CDN/simple runtime rule | do not add now |
| MIDI authored then pre-rendered to assets | authoring-only | zero runtime parser cost | strong fit for music/stingers | recommended for composition workflow |
| External generation tools/services | varies | zero runtime if rendered to assets | useful for ideation, must be human-reviewed | authoring-only |

### 5.2 Native Web Audio plus bundled assets

Why it fits:

- It is already the repo's model.
- It respects the no-CDN rule.
- It works with `OfflineAudioContext` testing.
- It keeps production complexity easy to reason about.
- It matches Local host ownership and Remote per-viewer degradation.

Weakness:

- Without a manifest and lab tooling, it tends to drift into hand-wired placeholders.

Decision:

- This should remain the default production runtime.

### 5.3 Native Web Audio procedural synthesis

What it is good at here:

- engine loops and throttle texture
- boost ramps
- wheelie/stunt sweeteners
- UI earcons
- shield/EMP/energy-style weapon layers
- layering under authored samples for extra transient/body/tail control

Why it fits:

- Already proven by `EngineSynth` and the missile/explosion helpers.
- Easy to render offline for tests.
- No runtime dependency addition.

Weakness:

- Time-consuming to dial in if every weapon is hand-built from scratch.
- Can sound cheap fast when used outside its strongest families.

Decision:

- Keep procedural synthesis, but use it selectively and usually as one layer inside a hybrid sound, not as the answer for every family.

### 5.4 jsfxr / sfxr-style parameter synthesis

Current-source notes:

- `jsfxr` is published under the Unlicense and documents both package usage and direct script-tag/browser usage on its GitHub page.[S5]
- `bfxr.net` positions Bfxr as a desktop sound-effect generator for game effects and points users to the JavaScript reworking `Bfxr2`.[S6]
- `Bfxr2` is MIT-licensed and its README currently describes the app as beta and lacking some classic Bfxr controls.[S7]

Why it fits:

- Fast iteration for arcade/gamey pickup, UI, power-up, simple weapon, and retro flourish sounds.
- Parameter-set authoring is LLM-friendly and easy to version.
- A parameter model maps well onto a future sound manifest.

Why it does not fit as the main runtime answer:

- Palette is intentionally stylized and limited.
- Great for "readable blips" and some arcade weapons, weak for the whole game's identity.
- `jsfxr` documentation includes direct browser/script usage, which is exactly the kind of example that can lead to accidental CDN-style drift if copied thoughtlessly.[S5]

Decision:

- Recommend jsfxr/sfxr-style generation as:
  - authoring-time helper
  - optional lab-time renderer
  - optional runtime path later only for tiny sound families like UI/pickups if `.2` proves it cleanly
- Do not add a jsfxr runtime dependency in this bead.

### 5.5 Tone.js

Current-source notes:

- Tone.js is a Web Audio framework and is MIT-licensed.[S8][S9]
- Tone docs expose `Tone.Offline`, which supports offline rendering workflows.[S10]

Strengths:

- excellent sequencing
- synth toolkit breadth
- musical timing/transport abstractions
- good for interactive music prototypes and layered synth experiments

Costs for this repo:

- larger runtime and conceptual surface than the current needs justify
- another abstraction over code that is already written directly on Web Audio
- easy to overfit the runtime around a library when music here is mostly pre-rendered track playback plus a few reactive cues

Decision:

- Do not add Tone.js to the runtime now.
- Allow it only as an optional prototype or lab dependency in a later bead if there is a specific, evidence-backed need such as authored reactive music experiments that native Web Audio is making too expensive to maintain.

### 5.6 MIDI and `@tonejs/midi`

Current-source notes:

- `@tonejs/midi` is MIT-licensed and parses MIDI data in JavaScript.[S11][S12]
- Official repo issues still show package freshness and timing/duration concerns that make it a poor default choice for a production runtime unless there is a strong reason.[S13][S14]

Decision:

- Use MIDI as an authoring/composition format only.
- Render final music/stingers to checked-in assets before shipping.
- Do not add runtime MIDI playback or parsing in this project unless a future bead proves a concrete feature needs it.

### 5.7 Authoring tools

| Tool | License | Runtime implication | Fit |
| --- | --- | --- | --- |
| Audacity | GPLv3 | none at runtime | editing, cleanup, batch export, loudness checks |
| LMMS | GPLv2+ | none at runtime | DAW for loop/stem authoring, synth sequencing |
| MuseScore Studio | GPL | none at runtime | melody/harmony/stinger composition, then render out |
| REAPER | proprietary paid/eval | none at runtime | strong practical DAW, render/export workflow |
| Bfxr2 | MIT beta | none at runtime | fast UI/pickup/chiptone effect authoring |

Inference:

- GPL or proprietary authoring tools are acceptable here because they do not become shipped runtime dependencies; what matters for the repo is the license of checked-in assets and sample sources, not the editor used to render them.

Decision:

- Encourage authoring-tool freedom.
- Standardize the runtime output format and validation evidence, not the DAW.

## 6. Recommended Sound-Family Decision Matrix

| Sound family | Recommended source strategy | Why | Local/Remote notes |
| --- | --- | --- | --- |
| Engine loop | procedural synth primary, optional authored fallback | continuous parameter tracking is exactly what synth is good at | host owns shared Local engine bed; Remote viewers render own-car engine locally |
| Boost | hybrid: synth ramp + optional short sample transient | boost needs readable onset plus controllable tail | keep own-car boost strong; far cars can lose tail layer first |
| Wheelie / stunt / landing | hybrid: short authored transient plus light synth sweetener | the read is transient-first; synth can add style without many assets | Local host only; Remote can keep only self/nearby stunt cues |
| Collisions | authored sample set with pitch/volume variation, optional synth sub layer for heavy hits | impacts need believable transient/body spread and variety | priority budget required in high-player scenes |
| Missile launch | hybrid, current synth acceptable as base layer | synthetic sweep works, but needs stronger identity/body | Remote keep nearby/self launches; cull distant duplicates |
| Explosion | hybrid, sample-led with optional synth/noise layer | explosions need weight and variation | heavy events may duck music; voice priority high |
| Mine deploy | tiny authored or jsfxr-style authored blip | short, readable, not worth a heavyweight synth path | safe low-cost cue |
| Oil slick | authored splat/spray clip, maybe layered noise | material read matters more than tonal complexity | low priority at distance |
| Sniper / EMP / shield | synth-friendly or hybrid | these are stylized energy cues | good candidates for offline-rendered synth presets |
| Flamethrower | hybrid loop with noise-based body | continuous texture is important, placeholder screech is wrong | distance-based attenuation/degradation important |
| Pickups | authored tiny sample or jsfxr-style authored cue | fast readability, low duration, easy variation | can be one of the cheapest families |
| UI earcons | procedural or jsfxr-style authored | tiny assets, deterministic, low CPU | controllers may use a separate minimal UI-only subset |
| Countdown / lap / finish / result stingers | authored bundled short assets | scoreboard/state changes deserve polished cues | Local host only for shared couch mix; Remote all viewers hear locally |
| Music | pre-rendered bundled assets from DAW/MIDI workflow | highest payoff with lowest runtime risk | keep reactive runtime limited to crossfade/ducking |
| Ambience / tape hiss / lo-fi bed | authored loop or lightweight generated noise, host-only by default | easy to over-mask gameplay; keep subtle | first thing to drop in Remote degradation |
| Crowd / podium / result moments | authored bundled stingers or beds | taste-heavy, better curated offline | low priority in crowded combat scenes |

## 7. What Not To Do

- Do not add Tone.js, `jsfxr`, `@tonejs/midi`, Howler, or any other runtime audio library in this bead.
- Do not ship browser-loaded CDN scripts for audio tooling.
- Do not let phones/controllers in Local mode pay the cost of world audio.
- Do not treat loudness metrics as proof of taste.
- Do not keep extending `AudioSystem` with placeholder reuse instead of moving to a manifest.

## 8. Validation Plan

### 8.1 Normal CI

Automate only what is cheap and objective:

- sound manifest/schema validation
- asset path existence
- source-strategy validity:
  - sample entry has asset path
  - synth entry has param block
  - pre-rendered music entry has asset path and metadata
- no-CDN/runtime guard:
  - fail if new audio runtime script tags or CDN imports appear
  - fail if new audio runtime deps are added without bead-scoped approval
- deterministic offline render checks for synth-capable entries:
  - duration bounds
  - silence/truncation
  - clipping/near-clipping threshold
  - peak/RMS/crest-factor sanity
  - spectral centroid or energy-band sanity where useful
- event wiring tests for critical families:
  - engine
  - collision
  - boost
  - pickup
  - missile/explosion
  - results

### 8.2 Opt-in audio QA

These should be lab scripts, not mandatory on every PR:

- `OfflineAudioContext` render bundles
- waveform PNGs
- spectrogram PNGs
- loop seam analysis
- attack/transient envelope checks
- A/B comparison tables between revisions
- voice-budget simulation with many simultaneous events

### 8.3 Manual playtest / human ears gate

Required before closing any major sound family:

- couch readability from 2 m to 4 m
- does the room still understand state when 4+ cars collide and weapons fire
- fatigue after several rounds
- own-car vs other-car identity in Remote
- does music duck enough but not too much
- does any family become annoying under repetition

### 8.4 Per-family validation expectations

| Family | Automatable | Human-only or mostly human |
| --- | --- | --- |
| Engine | offline render regression, RPM sweep sanity, duration/levels | emotional feel, annoyance, "cheapness" |
| Collision | peak/crest/duration/variation set checks | perceived impact weight, repetition fatigue |
| Weapons | envelope/level/variation checks | identity, fairness/readability, delight |
| Pickups/UI | duration/level/checks | crispness, annoyance at repetition |
| Music/stingers | file checks and loudness bounds | taste, pacing, emotional fit |
| Ambience/crowd | file checks only | masking, atmosphere, subtlety |

## 9. Local And Remote Runtime Guidance

### 9.1 Local host/controller

- Host owns:
  - music
  - world SFX
  - shared engine bed
  - results/crowd/ambience
- Controllers should not initialize the world mix.
- If controller audio exists later, keep it as a separate tiny package of UI cues and explicit haptics-style confirmation sounds.

### 9.2 Remote viewer

- Each viewer owns its own `AudioContext`.
- Recommended degradation order:
  1. ambience/tape/crowd beds
  2. distant collision sweeteners
  3. non-own-car engine detail layers
  4. secondary weapon tails
- Preserve longest:
  - own UI
  - own engine
  - own boost/wheelie/stunt cues
  - nearby collisions
  - critical weapon telegraphs

## 10. Wiring Into Existing Sound Beads

The current graph already covers the follow-up implementation surface. I do not recommend creating a new implementation bead yet.

- `br-sound-design-pipeline-64l5.2`
  - implement manifest
  - buses
  - voice budgets
  - Local/Remote audio-role split
  - deterministic procedural render path
- `br-sound-design-pipeline-64l5.3`
  - build the sound lab
  - render evidence bundles
  - host A/B preview workflow
- `br-sound-design-pipeline-64l5.4`
  - codify transient/body/tail, masking, hierarchy, repetition, and evidence review into a reusable skill
- `br-sound-design-pipeline-64l5.5`
  - define acceptance thresholds and force existing/future audio beads through them

No extra bead was created because the existing children already cover runtime, lab, skill, and acceptance-gate work.

## 11. Concrete Recommendations For `.2`

- Keep production runtime dependency count unchanged unless a later bead proves otherwise.
- Introduce a manifest with at least:
  - `id`
  - `family`
  - `sourceType`
  - `assetPath` or `synthSpec`
  - `bus`
  - `priority`
  - `cooldownMs`
  - `maxVoices`
  - `duckGroup`
  - `loop`
  - `variation`
  - `localRolePolicy`
  - `remoteRolePolicy`
  - `offlineValidation`
- Split buses at minimum into:
  - `music`
  - `engine`
  - `weapon`
  - `impact`
  - `ui`
  - `ambience`
- Add family-level voice budgets.
- Make synth entries renderable through `OfflineAudioContext`.
- Replace `AudioSystem` placeholder reuse with manifest-driven sound IDs.

## 12. Evidence Commands And Checks

Commands run during this research pass:

```bash
br show br-sound-design-pipeline-64l5.1 --json
br show br-sound-design-pipeline-64l5 --json
br show br-sound-design-pipeline-64l5.2 --json
br show br-sound-design-pipeline-64l5.4 --json
```

```bash
sed -n '1,220p' README.md
sed -n '1,260p' static/js/audioManager.js
sed -n '1,560p' static/js/systems/AudioSystem.js
sed -n '1,260p' static/js/audio/EngineSynth.js
sed -n '1,220p' package.json
sed -n '1,220p' docs/plans/game-modes-and-flows.md
sed -n '1,220p' docs/plans/feedback-design-pass.md
```

```bash
find static/audio -type f | wc -l
ls -lah static/audio/music static/audio/sfx music/tracks
```

Observed local evidence:

- `find static/audio -type f | wc -l` returned `15`
- `static/audio/music/` contains 6 tracks
- `static/audio/sfx/` contains 9 clips
- `npm ls tone jsfxr @tonejs/midi --depth=0` returned an empty tree

```bash
npm ls tone jsfxr @tonejs/midi --depth=0 || true
```

Output:

```text
multiplayer-racer@1.0.0 /Users/cdilga/Documents/dev/multiplayer-racer
└── (empty)
```

```bash
rg -n "unpkg|tonejs|Tone\\.js|jsfxr|sfxr|@tonejs/midi|npm install tone" \
  package.json static frontend src server docs | sed -n '1,200p'
```

Observed result:

- no runtime audio library usage in app code
- only existing research docs mention `jsfxr/sfxr`

## 13. Sources

### 13.1 Browser/runtime

- [S1] Chrome Developers, "Autoplay policy in Chrome"
  https://developer.chrome.com/blog/autoplay/
- [S2] MDN, `OfflineAudioContext`
  https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
- [S3] MDN, `AudioBuffer`
  https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer
- [S4] MDN, `BaseAudioContext.decodeAudioData()`
  https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData

### 13.2 Candidate libraries/tools

- [S5] `chr15m/jsfxr` GitHub repo and Unlicense/package usage
  https://github.com/chr15m/jsfxr
- [S6] Bfxr official site
  https://www.bfxr.net/
- [S7] `increpare/bfxr2` GitHub repo, MIT beta desktop app
  https://github.com/increpare/bfxr2
- [S8] Tone.js docs/site
  https://tonejs.github.io/
- [S9] Tone.js GitHub repo and MIT license
  https://github.com/Tonejs/Tone.js
- [S10] Tone.js `Offline` docs
  https://tonejs.github.io/docs/15.0.4/functions/Offline.html
- [S11] `Tonejs/Midi` GitHub repo
  https://github.com/Tonejs/Midi
- [S12] `@tonejs/midi` npm package page
  https://www.npmjs.com/package/@tonejs/midi
- [S13] Tonejs/Midi issue: package freshness / outdated npm package
  https://github.com/Tonejs/Midi/issues/96
- [S14] Tonejs/Midi issue: duration/timing concern
  https://github.com/Tonejs/Midi/issues/177
- [S15] Audacity license page
  https://www.audacityteam.org/about/license/
- [S16] LMMS home/docs project entry point
  https://lmms.io/
- [S17] MuseScore Studio handbook/FAQ entry point
  https://musescore.org/en/handbook-studio
- [S18] REAPER purchase/license page
  https://www.reaper.fm/purchase.php

### 13.3 Repo grounding

- `README.md`
- `package.json`
- `static/js/audioManager.js`
- `static/js/systems/AudioSystem.js`
- `static/js/audio/EngineSynth.js`
- `docs/plans/game-modes-and-flows.md`
- `docs/plans/feedback-design-pass.md`
- `docs/plans/research-brief-2026-06-28.md`
