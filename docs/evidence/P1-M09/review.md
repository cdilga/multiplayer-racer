# Fresh-eyes review P1-M09

- Signs are data (`assets/kit/signs/data/*.json`), one registry entry each, one code kit (`sign-kit.ts`): no per-sign geometry. Adding a sign = a data file, a registry entry, and one line in `SIGN_DATA`/`SIGN_PIECES`; `crates/jj-procgen/tests/signs.rs` fails if the three drift apart.
- Grammar lives twice, deliberately: Rust `grammar()` is the validator (colours, shape, charset, bounds), TS `FAMILY_COLOURS` is checked against the data by `signs.test.mjs`. If one changes, a test fails.
- Fit-bounded: the Rust validator computes the fitted cap height (`legend_cap_fraction`, mirrors the renderer's auto-fit) and rejects text below 0.065 of the panel height; the renderer shrinks text to the panel, direction panels grow per row; the node test asserts a minimum legend height per family and that nothing leaves the border.
- Risk: layout constants (panel sizes, z layers) are mirrored in the registry colliders; `signs.test.mjs` and `map.test.mjs` (kit bounds) compare them within 3%.
- Risk: the stroke font is blocky/chamfered; fine as highway lettering at tile size but not a true Transport/Highway Gothic.
- Touched outside owned paths: `registry.ts` (import + spread `SIGN_MODULES`), `map.test.mjs` (kit-bounds test now lists every family dir), `jj-procgen` `lib.rs` (`pub mod signs`) and `Cargo.toml` (serde, serde_json).
