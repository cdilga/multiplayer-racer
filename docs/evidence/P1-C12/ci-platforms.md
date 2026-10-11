# P1-C12 · Firefox CI provision

2026-10-11, CyanBridge. The Linux CI image now adds Playwright Firefox and its
system dependencies in a separate cached layer. Its content-addressed tag is
`jj-ci:d161a07c0df4`. Built through the existing `scripts/ci/ci-image.sh` on both
Docker runner hosts before selecting that image in the workflow:

- triton: build returned `sha256:b9397aa7b352d354b35dd2897ab5b4b8f6a6d6d82bf3cd9727ae150057813de3`.
- TrueNAS: build returned `sha256:719d33bdab62b87bc314b1a3a3b784bd1496a8467902d917fa53576354126c0c`.
- Subsequent image checks on both report `present: jj-ci:d161a07c0df4`.

Logs `/tmp/jj-c12-ci-image-triton.log`, `/tmp/jj-c12-ci-image-truenas.log`.
This proves provision, not real-device enumeration or the complete C12 journey.
The existing Chromium/WebKit tooling layer and runtime self-hosting are preserved.
