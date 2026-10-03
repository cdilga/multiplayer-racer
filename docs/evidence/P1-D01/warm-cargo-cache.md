# P1-D01 · AC3: a push with no Rust change hits the warm cargo cache

Recorded by LavenderCliff, 2026-10-04, from Gitea's job records (`tea api …/actions/jobs/<id>` and its log).

| Run | Commit | What changed | Runner | rust job | Crates compiled |
|---|---|---|---|---|---|
| 1010 | 70fd670 | first run on the persistent `/cargo-cache` (cold) | triton-rust | 211 s (bead comment, 2026-10-03) | everything |
| 1091 | f616716 | beads, docs | triton-rust | 126 s (20:39:52 → 20:41:58) | — |
| 1094 | 9e36a5b | web code, ci.yml | triton-rust | 128 s (20:48:41 → 20:50:49) | — |
| **1098** | **0f4c193** | **ci.yml only (no Rust change)** | triton-rust | **128 s** (21:00:11 → 21:02:19) | **only the 14 workspace crates; no third-party crate compiled** |

Run 1098's log (job 1472) compiles only `jj-*` crates (jj-contracts, jj-fixture, jj-input, jj-map, jj-procgen,
jj-protocol, jj-server, jj-session, jj-sim, jj-tools, jj-types, jj-wasm-host, jj-wasm-input, jj-wasm-procgen); each
`cargo` step finishes in 1.2–4.3 s. Every dependency came from the warm cache. The remaining ~2 minutes are the
job's fixed steps (toolchain check, fmt, workspace check, wasm32 check, tests, the jj CLI runs, no-tokio, cargo deny).
