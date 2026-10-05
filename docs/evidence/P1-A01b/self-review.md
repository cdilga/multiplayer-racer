# P1-A01b self-review (audition page /poc/audio/voice/)

## Looked at
`node art/ui/lib/live-check.mjs --local --out docs/evidence/P1-A01b --viewports 412x915,915x412,1920x1080 /poc/audio/voice/`: all three pass.
Screenshots read: `poc_audio_voice_412x915.png`, `poc_audio_voice_915x412.png`, `poc_audio_voice_1920x1080.png` (top of page), plus scrolled
captures `prompt_412.png`, `prompt_1920.png`, `engines_412.png`, `engines_1920.png` (Playwright, local static server over art/ui). Also the first,
full-page captures at 412 and 1920 before the layout change (header, reference blocks, candidate and engine blocks).
Seen: masthead and the metrics caveat, jump pills, reference blocks A-F with transcripts and players, 4 candidate blocks, 8 engine blocks laid out as
Qwen-left / FrankenTTS-right pairs at 1920 and stacked on the phone, per-clip metrics rows, Whisper-heard line, WER in red when non-zero.

## Defects found and fixed
- The owner's reference transcript was in the committed manifest/page (it is the owner's own spoken words about the project): removed; the page says it is kept private.
- Single-clip reference blocks showed a pointless "Play all" button: hidden for one clip.
- Loudness differed by up to 11 LU between engines/references, biasing an A/B listen: players are level-matched to -20 LUFS (metrics stay on raw renders; stated on the page).
- live-check "cut off by the screen edge" on the long page (fold test, no real clipping): the page now scrolls inside `.page` (a scroll container), which the check accepts. Side effect: the document itself does not scroll.
- Blurb claimed a shared seed policy; ftts has no sampler seed: reworded.

## Remaining defects
- **Audition audio cannot reach the preview without committing it.** `scripts/poc-publish.sh` rsyncs the whole `art/ui/` tree with `--delete` (CI does this from a git checkout), so uncommitted clips under `art/ui/poc/audio/voice/clips/` are never uploaded and a manual rsync would be wiped by the next CI deploy; `art/**/*.m4a/.ogg/.mp3/.wav` are Git LFS. Nothing was committed. Until a publish route exists (e.g. an `--exclude 'poc/audio/voice/clips/'` plus a separate manual rsync of clips, or the owner approving LFS-committed AAC for this POC), the deployed page shows "Clip not published" under each player. The acceptance item "passes live-check on the deployed URL" is therefore not met.
- `art/ui/poc/audio/voice/clips/` is local-only and gitignored by `art/ui/poc/audio/voice/.gitignore`. Regenerate with `docs/evidence/P1-A01b/make_manifest.py` (needs private/p1a01b).
- No one has listened to any clip; the reference choice (C2, C3) is by metrics only.
- Pitch median figures are from a crude tracker and read high for the VoiceDesign clips.

## Not covered
Real-phone or Safari playback (AAC chosen for iOS, untested; local checks are Playwright Chromium); the deployed URL; any listening judgement; the full 61-row render and the owner's pick (step 5); the precision ruling if FrankenTTS is picked (1.7B bf16 pipeline here was bf16 on GPU with an fp32 CPU codec).
Also note live-check's first run wrote `docs/evidence/design-live/poc_audio_voice_*.png` (default output dir) before `--out` was used; they are stale and can be dropped.
