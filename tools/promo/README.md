# Bring everyone

Owner feedback, 25 October 2026: a fun Steam-audience trailer for the things that make Joystick Jammers different. Lead on actual carnage and a growing crowd, name and show every selectable vehicle, explain controllers and local Wi-Fi, then a huge weapons derby with a real winner. End with a spoken and visible **jammers.dilger.dev** invitation. No Steam release/wishlist claim.

**Preparation checkpoint:** the owner's later full-roster visual rework gates final video publication. Preserve queued narration and this edit, recapture the reviewed models, then finish the mix and index playback checks. The current index trailer is unchanged. `--silent-preview` reviews pictures under `/tmp` without replacing website media; its placeholder timing and silent narration are not a deliverable.

## Voice: Aussie Maya1 v1

Refer to this voice as **Aussie Maya1 v1**, project recipe ID `aussie-maya1-v1`. The canonical recipe is `tools/audio/maya1-voice.json`: Maya1, the exact Physical Soccer live broad Australian male prompt, temperature 0.3, 48 kHz. This is a project recipe ID, not a provider speaker ID; generated performances can vary. It supersedes the first trailer's Qwen owner-clone voice. Historical Qwen provenance remains in commit b43febb2; do not relabel it.

`narration.tsv` has eleven short, Australian lines with matching captions, including all seven names in the current selectable roster. Capitalisation follows the cue guard; “A u hawk” is the AU model code spoken as letters. Each line is validated through the shared cue guard. The trailer has fixed narration rather than random gameplay callouts, so gameplay moment/variant floors do not apply.

```sh
python3 tools/promo/voice-job.py
python3 tools/audio/maya1.py --job tools/promo/voice-job.json --batch maya1-promo --local
```

Generation and ASR run on eris using the shared Maya renderer. See its canonical identity and generated manifest for the actual backend/model revision and audio measurements. No private references, credentials or raw generation inputs belong in this repository. Fetch/install only passing `promo-*.ogg` exports and `promo-manifest.json`. The editor refuses any other canonical voice ID or failing row.

## Actual game footage

Use pinned Node 26.10.0. The scripts build and serve the real host and record 1280×720 at 30 fps, advancing the Rust/WASM simulation four ticks per frame (120 Hz). They stage gameplay through the existing R90 test surface; they are not footage of human opponents or a real-time performance benchmark.

```sh
JJ_PROMO_CAPTURE=/tmp/jj-promo-crowd node tools/promo/capture-crowd.mjs
JJ_PROMO_CAPTURE=/tmp/jj-promo-crowd node tools/promo/capture-controllers.mjs
JJ_PROMO_CAPTURE=/tmp/jj-promo-roster node tools/promo/capture-roster.mjs
JJ_PROMO_CAPTURE=/tmp/jj-promo3 node tools/promo/capture.mjs
```

The crowd capture uses **64 as a sample, never a gameplay limit**. Synthetic controller Hello/Claim messages fill the actual lobby. The real room enters Derby, all 64 cars are present, journalled poses stage a pileup, and journalled real boomerang pickups/throws produce volleys. Detached bodies stay dynamic through the round. The actual derby clock awards the winner by damage; the editor reads that result, rather than inventing a winner. Its editorial winner card reads the actual winner, seat number and damage points from the complete result data and overlays those facts on the battle aftermath.

An actual bug discovered during filming refused every derby item as `notRacing`; br-r1ma.1 fixes the mode-specific eligibility, retains protection/end checks and verifies exact replay. The capture uses that rebuilt testing WASM. See `docs/evidence/P1-PROMO2/derby-weapons.md`.

The roster script drives each selectable model individually. The editor labels all seven and builds readable mosaics. The road montage reuses the first film's actual jump, dirt, town, rocks and bitumen captures. `mapUrl` supplies the same map to the renderer and simulation; loading only a simulation fixture does not update the rendered world.

Controller inserts use the current controller's explicit UI-state opener and committed C08/C12 journey captures. Fresh Mac Chromium/Chrome WebRTC attempts with STUN disabled returned ICE no-route; these inserts do not certify a new connection or physical gamepad. The local-play narration says phones **can** connect directly on the same Wi-Fi, matching the architecture, not a universal network guarantee. Existing TURN remains the connectivity fallback.

## Edit and index

```sh
git show 76a5c6ea:docs/evidence/P1-A04c/scripted-lap.wav > /tmp/jj-promo-engine.wav
uv run --with 'fonttools[woff]' python tools/promo/render.py --captures /tmp/jj-promo-crowd4 --roster /tmp/jj-promo-roster --roads /tmp/jj-promo3
```

FFmpeg expands project Barlow WOFF2 fonts to TTF, edits the eleven narration beats, adds readable titles and an extended website end card, then mixes the voice with ducked `race-2.ogg` and the committed Jammers engine/SFX lap export. That sound bed is editorial, not telemetry-synchronised. All runtime media is self-hosted H.264/AAC with faststart, local WebVTT captions and a local poster. The MP4/JPEG use LFS.

The index uses an explicit play button, no autoplay, no video request before interaction, native controls after play and fingerprinted media. `og:video` retains the existing image fallback; actual social video embedding depends on the platform. `web/landing/tests/trailer.test.mjs` checks the real Rust server's MIME/ranges and Chromium/WebKit playback/captions/seek at root and preview bases. Evidence and feature-to-timestamp coverage live in `docs/evidence/P1-PROMO2/`.
