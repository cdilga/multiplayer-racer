# Bring your friends

Owner request, 2026-10-25: a Steam-audience promotional video, including a brief development story,
announcer voiceover and sound effects, playable on the index. The owner's steering is player appeal
first. This is a 37-second work-in-progress browser-game trailer, not a Steam availability announcement.

The edit opens on four racers sharing one screen. The joke moves from a sensible party-racer idea,
through reference-built cars and repeated handling work, to unreasonable roads and friendly rivalry.
It ends with the actual entry route: open a browser, scan in and race. There is no wishlist CTA or
unshipped feature claim. Seven narrated lines have corresponding English captions.

## Narration

`narration.tsv` uses the existing A00 cue-sheet schema and row guards. Promotional narration is a fixed
passage, so the in-game required-moment coverage and random-callout variant floors do not apply. No
in-game sheet or event mapping is changed. Generate its job with:

```sh
python3 tools/promo/voice-job.py
scp tools/promo/voice-job.json eris:Work/dev/jammers-audio/jobs/promo-job.json
```

Run the existing `bin/voice_render_eris.py` on eris under `flock .gpu.lock`, with
`--job jobs/promo-job.json --candidates 3 --extra 4 --max-candidates 11 --export-dir exports/promo`.
Use the Qwen3-TTS 1.7B Base bfloat16 pipeline and the existing owner's performed hype reference.
Follow `.claude/skills/jammers-audio/SKILL.md`; no generation occurs on the Mac. If voxtype prevents
the native-precision model fitting, stop its user service for the batch and restore it afterwards,
as the existing music runner does. Fetch only the seven picked `promo-*.ogg` exports. Remove the
private excited-reference `text` field before saving `promo-manifest.json`; references, prompts,
raw takes and their private transcripts stay on eris. Do not overwrite the game's `manifest.json`.

The first run hit GPU OOM while voxtype and a CI browser occupied VRAM. After stopping voxtype, the
existing worker's extra-seed round recovered both affected lines. All seven selected lines passed
every screen; voxtype was restarted. The manifest records the selected seeds and measurements.

## Pictures and edit

Use the pinned repository Node. `capture.mjs` builds and serves the real host, loads fixtures/maps
through its existing test surface and records 1280x720 frames at 30 fps. Four simulation ticks per
frame preserve the 120 Hz simulation speed. Autopilot drives the cars; these are staged gameplay
captures, not footage of human opponents. Joining/debug chrome is excluded; world content is intact.

```sh
JJ_PROMO_CAPTURE=/tmp/jj-promo node tools/promo/capture.mjs
git show 76a5c6ea:docs/evidence/P1-A04c/scripted-lap.wav > /tmp/jj-promo-engine.wav
uv run --with 'fonttools[woff]' python tools/promo/render.py --captures /tmp/jj-promo
```

The FFmpeg edit uses project fonts (expanded from WOFF2 to TTF for FreeType), the seven approved
voice exports, existing `assets/audio/music/race-2.ogg`, and the committed A04c engine/SFX lap export.
The engine is an editorial sound bed, not synchronised engine telemetry from these captures. Music
ducks under speech; the finished AAC mix measures -16.2 LUFS integrated and -4.3 dBTP. No new music,
voice impersonation provider or asset licence is introduced; see the existing music manifest for
its provenance and licence. The media is self-hosted H.264/AAC with faststart, and is stored in LFS.

`docs/evidence/P1-PROMO/capture.json` records the capture build and fixtures; `timeline.json` records
the cut, captions and source/output hashes. The capture used the shared working tree's current lab
map and renderer, including changes already present from other sessions; it is labelled WIP. Raw
capture frames stay in `/tmp/jj-promo3`, and can be regenerated with the script.

## Integration checks

`web/landing/tests/trailer.test.mjs` fetches scraper-visible HTML from the real Rust server at root
and preview bases, validates media MIME/ranges, then plays and seeks in Chromium and WebKit. The
landing remains light: `preload=none`, no autoplay, native controls, local poster and WebVTT captions.
The video, poster and captions use Vite's fingerprinted URLs. `?no-inline` keeps WebVTT as a served
asset so its MIME type and preview-base routing are exercised. `og:video` and `og:video:secure_url`
are rewritten to the configured public origin; the existing image card remains the fallback.
Whether a social platform actually embeds video is that platform's policy, not an OG guarantee.
