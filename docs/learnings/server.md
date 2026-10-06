# Server learnings (jj-server, Asupersync)

Traps and decisions for `crates/jj-server`. Newest first.

## 2026-10-07: one bundle, any base path (P1-N02)

- Vite builds with a **relative base** (`base: './'` in `web/vite.config.ts`), so JS, CSS, workers and WASM find
  their siblings relative to their own URL. Only the HTML pages need help: they live at `dist/<page>/index.html` but
  are served at `B/`, `B/host`, `B/c` and `B/j/<CODE>`, so `../assets/…` would resolve wrongly. `jj-server` rewrites
  each page's `./assets/`, `../assets/` (and `test/`) links to `B/assets/…` once at load time, and adds
  `<meta name="jj-base" content="B">`. Apps read the base with `basePath()` from `web/shared/src/base.ts`, never
  `import.meta.env.BASE_URL` (it's `./`).
- A bundle built with a root base (`/assets/…`) still works: the rewrite rebases root links too.
- `web/landing/tests/lib/site.mjs` serves test builds with the real `jj-server` binary (`JJ_SERVER_BIN`, else
  `target/debug/jj-server`), so every Playwright journey exercises the real routes.

## 2026-10-07: Asupersync HTTP server (0.5.0)

- Use `Http1Listener::bind_produced_with_config` + `run_produced`: one task per connection, and
  `Http1ProducedResponse::chunked` streams SSE for as long as the producer runs.
- **`HostPolicy` defaults to `RejectUnknown` and serves nothing**: set `HostPolicy::AllowAll`.
- **`max_connections` defaults to `Some(10_000)`**: set `None` (R66, no caps).
- The per-send frame cap is 64 KiB: split big bodies (`main.rs` sends 60 KiB slices).
- The `reason` phrase isn't derived from the status: pass the right one.
- A client disconnect shows up as an `Err` from the next `send_bytes`, so a heartbeat (15 s) bounds detection.
- Race a std `Future` against `asupersync::time::sleep` with `combinator::select::Select` (both `Box::pin`ned). The
  room/mailbox wake-up is a plain std `Future` with `Waker`s in `rooms::Mailbox`, so the core needs no runtime.
- `no-tokio.sh` must walk the shipping targets only: Asupersync reaches Tokio through `wasm-bindgen-futures` on an
  emscripten-only cfg that `--target all` includes.
