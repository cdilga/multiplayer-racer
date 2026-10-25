# Self-review P1-PROMO — br-522t

Local real Rust server, http://127.0.0.1:4177/, Mac arm64, Playwright Chromium and WebKit. Work-in-progress gameplay captured through the existing host test surface, deterministic stepping and autopilot. Voice generated on eris with Qwen3-TTS 1.7B Base bfloat16 and the existing owner hype reference. All seven picked lines pass every automatic voice screen. The final mix measures -16.2 LUFS / -4.3 dBTP.

## Looked at

- `filmstrip.jpg`: all seven editorial beats sampled from the finished film; player-first hook, build/rebuild development beat, canyon, risky line, phone-controller pitch and product ending. Gameplay stays visible; all titles fit.
- `index/index_412x915.jpg` and `index/index_412x915_after-resize.jpg`: Join first, Host reachable, trailer and captions below, readable controls.
- `index/index_375x667.jpg` and `index/index_375x667_after-resize.jpg`: short-phone layout, text wrapping, full player width, no horizontal overflow.
- `index/index_915x412.jpg` and `index/index_915x412_after-resize.jpg`: host/join panels, complete upper tag after padding fix, scroll to trailer; all content reachable.
- `index/index_1366x768.jpg` and `index/index_1366x768_after-resize.jpg`: two-column hero, whole trailer section via natural vertical scrolling, controls and footer.
- `index/index_1920x1080.jpg` and `index/index_1920x1080_after-resize.jpg`: TV layout, title/poster legibility, both main actions.
- `playing-chromium.jpg` and `playing-webkit.jpg`: actual decoded frame at sixteen seconds after seeking; English captions explicitly selected and loaded in both engines.

## Defects found and fixed

- Initial capture loaded different maps in the sim and renderer. Recaptured with the same map URL and fixture; old footage discarded.
- FFmpeg silently fell back from WOFF2 to a thin system font. Expanded the project's Barlow fonts to TTF and rerendered; finished filmstrip and poster use the proper fonts.
- Video seeking stalled without HTTP byte ranges. Added and tested 206/416 responses through the real server.
- Vite inlined WebVTT, bypassing served-caption MIME checks. Kept it external with ?no-inline.
- Short landscape layout clipped the upper Host tag border. Increased vertical padding and recaptured both states.

The live-check matrix found no HTTP, image-decode, script or horizontal-overflow failures. Its remaining “cut off by the screen edge” reports identify content that straddles the viewport fold on this vertically scrolling page, not clipped content: inspected the full-page images and scrolled the actual native player into view. The 1920x1080 run is clean. The checker was not weakened.

## Remaining defects

No observed trailer/index breakage. A full web typecheck is blocked by pre-existing/shared-tree TS18048/TS2345/TS2322 errors in web/host/src/render/map/map.ts:377–387; reported to TurquoiseSnow, outside this task's edits. Focused trailer journeys: four passed. Existing landing journeys: 39 passed. RCH static-server tests: five passed.

## Not covered

Physical phones, Safari, a physical TV, and perceptual listening are not available in this session. Audio claims are limited to pipeline transcripts/screens and measured levels, not an invented listening review. Engine/SFX is an editorial bed, not synchronised capture telemetry. The captures used the current shared-tree lab map and renderer; other sessions' dirty changes are not included in this commit.

This is the locally served build. A deployed preview smoke remains with the normal image/publish pipeline after the push; no CI verdict or public deployment is claimed here.
