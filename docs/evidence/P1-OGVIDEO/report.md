# P1-OGVIDEO — br-jq5n

Owner request 2026-10-25. Implemented both og:video and og:video:secure_url, H.264/AAC MP4 type and 1280x720 dimensions. The existing OG/Twitter image fallback remains. Vite fingerprints media; jj-server rewrites metadata to JJ_PUBLIC_ORIGIN plus the root or preview base.

The server now serves video/mp4 and UTF-8 text/vtt and supports single-byte-range responses (206, Content-Range, Accept-Ranges). Playback testing reproduced seeking stalls without ranges. Prefix probes, open-ended ranges, suffixes, clamping, unsatisfiable ranges and malformed/multiple-range fallback are covered. HEAD retains a full response.

Validation on the Mac, Playwright Chromium and WebKit (emulated phone, not Safari or a physical device): four real-server journeys passed at / and /p/trailer/, including raw HTML metadata, fetched MP4 signature and MIME, 206 byte probe, caption MIME and seven loaded cues, no MP4 request before play, playback, seeking near the end, no media errors, and intact Host routing. RCH: cargo test -p jj-server statics::tests — five passed. Existing landing suite: 39 passed.

Social platforms decide whether they embed video. The metadata does not guarantee inline playback on any particular social service. No runtime CDN or third-party player is used.
