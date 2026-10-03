# P1-N06 · jj-input + controller WASM — evidence

Bead: `br-p1-n06-i62` · Identity: YellowLotus (omp) · Date: 2026-10-03
Machine: the Mac (cdilga's MacBook, arm64, darwin 27.0.0); Rust 1.99.0 via `rust-toolchain.toml`,
wasm-bindgen CLI 0.2.129 (pinned). Native tests/clippy ran through RCH (worker `eris`).

## What was built

- `crates/jj-input`: `curve` (personal dead zone + response, applied pre-quantisation), `intent`
  (`DriveIntent`: independent-axis steer/throttle/brake/reverse; full brake at −0.85, preload
  strictly past it), `action` (ACTION-stick sectors: dominant-axis, hysteresis 0.75/0.5, neutral
  re-arm 0.25, held boost/drift, discrete utilities on entry), `wheelie` (preload/release machine:
  release = out of zone and past −0.3 within 250 ms inclusive; cancel past 1.2 s; dips within the
  window resume the same preload), `source` (per-source flags/freshness/stable action
  IDs/neutralisation), `scheduler` (60 Hz change / 20 Hz refresh / prompt neutral; refresh
  satisfied by change sends; fair batch split via `jj-protocol`).
- `crates/jj-wasm-input`: wasm-bindgen facade (`WasmEndpoint`, `WasmAction`, `WasmFlush`,
  `encode_action`, `quantise`, `apply_curve`) — input + protocol only, no sim/renderer.

## AC → test mapping (all green)

- AC1 diagonal steer doesn't reduce full throttle → `intent::tests::diagonal_steer_does_not_reduce_full_throttle` (proptest)
- AC2 brake full before the wheelie detent → `intent::tests::brake_reaches_full_before_the_wheelie_detent` (proptest)
- AC3 pointer cancel never fires a wheelie or utility → `tests::ac3_neutralisation_never_fires` (proptest, all four reasons) + `wheelie::tests::reset_kills_any_pending_pattern`
- AC4 press+release between two sends yields exactly one action → `tests::ac4_press_release_between_sends_yields_one_action` (proptest, tap strictly inside a 60 Hz window) + `action::tests::one_entry_one_fire`
- AC5 refresh never stacks on change sends → `scheduler::tests::refresh_never_stacks_on_change_sends` (proptest) + `cadence_is_60_on_change_and_20_at_rest` + `idle_stream_is_20hz`
- AC6 WASM bundle ≤ 150 KB gzipped → below

## Commands and output

```console
$ rch exec -- cargo test -p jj-input -p jj-wasm-input
test result: ok. 43 passed; 0 failed; 0 ignored   (jj-input lib)
test result: ok.  2 passed; 0 failed; 0 ignored    (jj-wasm-input lib)

$ rch exec -- cargo clippy -p jj-input -p jj-wasm-input --all-targets --locked -- -D warnings
(no errors, no warnings)

$ cargo check -p jj-wasm-input --target wasm32-unknown-unknown   # Mac, per-crate
Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.32s

$ cargo build -p jj-wasm-input --target wasm32-unknown-unknown --release   # Mac, per-crate
Finished `release` profile [optimized] target(s) in 6.91s

$ wasm-bindgen --target web --out-dir <tmp> target/wasm32-unknown-unknown/release/jj_wasm_input.wasm
$ gzip -9 -c jj_wasm_input_bg.wasm | wc -c   → 19233
$ gzip -9 -c jj_wasm_input.js      | wc -c   →  3907
                                           (raw wasm: 51890)
total gzipped: 23140 B = 22.6 KiB ≈ 15 % of the 150 KiB budget (AC6)
```

The intermediate failing proptest cases (mid-development bugs, since fixed) ran through RCH, so
their seed files live on the worker, not in this tree; all cases pass in the run above.
