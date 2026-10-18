# P1-C12.1 (br-twal.1): native input helper, receipt

Built 2026-10-18 by AmberSpring. Code: `crates/jj-input-helper/` (the helper), `web/host/src/input/helper.ts` +
`helper.json` (the host page's client), `local.ts` / `drawer.ts` (sources and the drawer), `crates/jj-server`
(`B/downloads/`), `docker/jj-server.Dockerfile` (the builds). Journey: `web/tests/journeys/c12-1-input-helper.test.mjs`.

## Transport: a loopback WebSocket, and why

The helper listens on `127.0.0.1:47123` (data: `web/host/src/input/helper.json`); the host page connects with a plain
`WebSocket` and receives JSON frames (`crates/jj-input-helper/src/protocol.rs`, fixture
`crates/jj-input-helper/tests/fixtures/protocol.jsonl`). Its devices become `LocalSource{source, axes, buttons, seq}`
in the page (`source = 1000 + device id`), so the worker's `jj-input` path is unchanged and source-blind.

Considered: joining the room as a hub endpoint over the existing protocol. Rejected for now: it needs WebRTC (ICE,
DTLS, SCTP) in a native Rust binary for input that never leaves the computer, and the room's join/claim flow for
devices that are physically the host's. Loopback is one hop on the same machine, needs no network, and the page
already owns local sources (P1-C05). The WebSocket side is ~150 lines over the workspace's own `sha1`/`base64`
(`ws.rs`), std threads only (no async runtime, no Tokio).

Chrome's Local Network Access: a public HTTPS page opening `ws://127.0.0.1` gets Chrome's permission prompt for
reaching apps on this device. The page never probes on its own: it connects only when the player presses **Connect**
in the drawer (after installing) or when this browser paired before, so a host without the helper never sees a
prompt. The prompt itself was not exercised here (the journeys' pages are served from loopback, which needs no
permission): it's in the owner's Playtest-1 row.

## Security (a keylogger-shaped binary)

`pairing.rs` and `server.rs`:

1. Binds 127.0.0.1 only; the handshake's `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding).
2. The handshake's `Origin` must be the game's sites (`https://jammers.dilger.dev`, `https://jammers-preview.dilger.dev`)
   or one passed with `--allow-origin`. Browsers set `Origin`; no other website can open the socket (403).
3. Nothing is sent until the page pairs: the six-digit code the helper's window shows, typed into the drawer once,
   answered with a per-origin token the page keeps (`localStorage`) and the helper keeps in
   `~/.config/jj-input-helper/pairings.json` (macOS `~/Library/Application Support`, Windows `%APPDATA%`). A code works
   once; five wrong codes change it; tokens compare in constant time and only for their own origin.
4. Devices are opened only while a paired page is connected and closed when the last one goes; the window says so:
   `Capturing 2 keyboards and 6 pads for <origin> (only while that page is open).` / `Not capturing: no game page is paired.`
5. Keys still reach the desktop as usual (no grab by default); `--grab` (Linux) takes the devices exclusively.

## Per-OS backends

| OS | Keyboards (one source each) | Pads (no slot limit) | Permission |
|---|---|---|---|
| Linux | evdev (`evdev` 0.13.2, Apache-2.0 OR MIT; deps nix/bitvec/funty/radium/tap/wyz, MIT) | evdev, kernel gamepad codes to the standard mapping | read `/dev/input/event*`: the `input` group (`usermod -aG input $USER`, log in again) |
| Windows | Raw Input (`windows-sys` 0.61.2, MIT OR Apache-2.0): `hDevice` per keystroke, scan codes to `KeyboardEvent.code` | Raw Input HID (usage 1/4, 1/5) parsed with `HidP_*`: no XInput four-pad limit | none |
| macOS | IOHIDManager (hand-written IOKit/CoreFoundation bindings) | IOHIDManager, Generic Desktop 4/5 | Input Monitoring (the helper asks; the system prompt) |

No `gilrs`: Linux needs nothing past evdev, and Windows/macOS pads come through the same HID stream as the keyboards.
Generic HID pads map heuristically (X/Y left stick, Rx/Ry or Z/Rz right, buttons in Xbox order, hat to d-pad); real
pads on Windows and macOS are owner rows.

## Builds (served by our own server, R70)

`docker/jj-server.Dockerfile` builds the helper in the image's Rust stage and places it at `/app/web/downloads/`, which
jj-server serves as `B/downloads/<file>` (`attachment`, `no-cache`, real 404s; test
`jj_server::tests::serves_the_input_helper_downloads`), with `B/downloads/index.json` listing what's there. The drawer
offers the visitor's OS build first and lists only builds the server has.

- **Linux x86_64:** `x86_64-unknown-linux-musl`, static-pie, 1.2 MB.
- **Windows x86_64:** `x86_64-pc-windows-gnu` via MinGW (`gcc-mingw-w64-x86-64`), PE32+ console, 2.0 MB.
- **macOS arm64: not built in CI.** Linking IOKit needs Apple's SDK, which the Linux runners don't have (and can't
  redistribute). CI type-checks it (`cargo clippy --target aarch64-apple-darwin` clean, below); the binary is built on a
  Mac (`cargo build --release -p jj-input-helper`), and the drawer says the macOS build isn't on the server yet until
  then. Follow-up: br-twal.1.1.

Verified on eris (2026-10-18) in `rust:1.99.0-slim-trixie`, the image's own Rust stage, with the Dockerfile's commands:

```
-rwxr-xr-x 2027687 x86_64-pc-windows-gnu/release/jj-input-helper.exe
-rwxr-xr-x 1221456 x86_64-unknown-linux-musl/release/jj-input-helper
jj-input-helper: ELF 64-bit LSB pie executable, x86-64, static-pie linked
jj-input-helper.exe: PE32+ executable for MS Windows 5.02 (console), x86-64, 9 sections
$ jj-input-helper --version
jj-input-helper 0.2.0
```

Type checks and lints, eris, toolchain 1.99.0: `cargo clippy -p jj-input-helper --all-targets -- -D warnings` clean for
`x86_64-unknown-linux-gnu`, `x86_64-pc-windows-gnu` and `aarch64-apple-darwin`; `cargo fmt --check` clean.

## What an unsigned install shows (expected behaviour, for the owner's signing decision)

Not run on real Windows/macOS machines here; these are the platforms' documented behaviours for an unsigned download,
to be confirmed in the owner rows (docs/playtests/owner-checklists.md §3).

- **Windows:** the browser may say the file "isn't commonly downloaded" (Keep); running it, SmartScreen shows "Windows
  protected your PC" (More info → Run anyway). A console window opens with the pairing code.
- **macOS:** a downloaded raw binary loses its executable bit and is quarantined: `chmod +x` it, then Gatekeeper refuses
  it ("Apple could not verify…"); System Settings → Privacy & Security → Open Anyway. Then the Input Monitoring prompt.
- **Linux:** `chmod +x`; reading devices needs the `input` group (the helper says so when it can't read any).

Signing, for the owner to decide (not a blocker): Windows Authenticode (an OV certificate, roughly US$200-400 a year, or
Microsoft's Trusted Signing service at about US$10 a month where available) removes most SmartScreen friction once the
signature builds reputation; Apple's Developer Program (US$99 a year) gives a Developer ID to sign and notarise a `.app`
or `.pkg`, which removes the Gatekeeper steps. Both also mean shipping the helper as an installer rather than a raw
binary.

## Tests and results

Rust, `cargo test -p jj-input-helper` (eris, 1.99.0): 15 unit + 2 integration tests pass.

- AC1 `hub::tests::two_keyboards_and_six_pads_are_eight_sources_and_unplug_is_isolated`: two keyboards and six pads,
  eight ids; the same W on both keyboards is two key sets; each pad its own frame; unplugging one pad leaves every other
  device's id, state and messages alone; replugged, it gets its id back. Plus
  `identical_devices_at_once_get_their_own_ids`.
- `tests/server.rs`: Host/Origin refusals (403), wrong code refused with no capture, the code pairs, capture starts,
  device messages reach the page, an unpaired second page hears nothing, the token pairs it, capture stops when both
  pages leave, and the status lines say so.
- `protocol`, `ws` (RFC 6455 accept example, frames), `pairing` (host/origin, one-use code, per-origin tokens, five
  wrong codes, persistence), `keymap` (cluster keys on all three OSes, pad mappings), `backend::linux` (classify,
  translate keys/sticks/triggers/hats).

jj-server: `serves_the_input_helper_downloads` passes; `cargo clippy -p jj-server --all-targets -D warnings` clean.

Journey `web/tests/journeys/c12-1-input-helper.test.mjs`, eris (Chromium headless, `JJ_CHROMIUM_GPU=1`), all pass:

1. (AC2, AC3) Real helper on its scripted backend + real host page: drawer `off` state links
   `B/downloads/jj-input-helper-linux-x86_64` (this visitor's OS), fetched 200 `attachment` with the helper's bytes;
   Connect → wrong code refused and shown → right code (Enter) pairs and the token is kept; two keyboards and six pads
   listed; the helper says `Capturing 2 keyboards and 6 pads`; keyboard 1 holds W and keyboard 2 holds S → seats
   `local:1001` and `local:1002` on two cars, throttle and brake each on its own car, then swapped; the browser's own
   W and I claim nothing (Keys A/B rows: "the input helper has these"); Escape isn't swallowed; unplugging keyboard 2
   autopilots only its car; closing the page stops capture (`Not capturing`).
2. Phone-sized host (412x915): no horizontal overflow off and paired.
3. TV-sized host (1920x1080), no helper running: Connect keeps looking ("Looking for the input helper") and Stop looking
   returns to off.
4. **Real devices, Linux evdev**, `JJ_HELPER_UINPUT=1`: `web/tests/journeys/lib/uinput-devices.py` creates two virtual
   keyboards and five virtual pads (past Chromium's four slots) through `/dev/uinput`; the real helper (`--only <prefix>
   --grab`, so the desktop never sees the keys) pairs with the page; each keyboard's W and each pad's left stick forward
   give **seven seats on seven cars, all throttling**; unplugging pad 5 autopilots exactly one car. Helper status after
   the unplug: `Capturing 2 keyboards and 4 pads for http://127.0.0.1:40381 (only while that page is open).`

Regression (eris): `web/host/tests/clusters.test.mjs`, `web/host/tests/input.test.mjs`,
`web/tests/journeys/c14-controls.test.mjs`, and c12-many-controllers' full-slot / Firefox / WebKit journeys (results
in the bead comment).

## Not covered here

- Real Windows and macOS machines (Input Monitoring walk-through, SmartScreen/Gatekeeper, real pads' button layout):
  owner rows in docs/playtests/owner-checklists.md §3.
- The macOS binary from CI (needs a macOS runner or SDK): br-twal.1.1.
- Chrome's Local Network Access prompt from the public preview, and Safari's handling of `ws://127.0.0.1` from an HTTPS
  page: owner row (first one).
- Wheels through the helper: helper pads use the standard pad mapping; wheel profiles (P1-C05.2) stay on the browser's
  Gamepad API path.
