# Generator17 deterministic receipts — br-gw74.11

The ramp-foot repair intentionally advanced generator16 to17. Gameplay hashes include that version, so ordinary seed and two-biome hashes require refreshing even where the course geometry does not contain a roof kicker. Arena hashes have their own version and remain unchanged.

- Full RCH `cargo test -p jj-procgen` on eris passed arena containment, seed/autopilot banks and bike laps before stopping at the old two-biome expectations. It was not a complete green sweep.
- Regenerated seed and recipe expectations with the existing `JJ_BLESS=1` path.
- Focused native `cargo test -p jj-procgen --test biome --test procgen`: green (8 biome tests,5 procgen tests); RCH on eris.
- WASM `cargo test -p jj-procgen --target wasm32-unknown-unknown --test wasm_parity`:4/4 pass, including native seed/recipe hashes and arena meshes.
- The physical23-lot roof landing/replay fixture remains unchanged and passed in the ramp-foot receipt.

Containing CI and deployed visual evidence still required before close.
