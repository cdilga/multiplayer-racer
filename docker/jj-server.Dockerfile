# syntax=docker/dockerfile:1.7
# The jj-server image (P1-D02): the Rust server plus the web bundle it serves, one image for every preview and for
# production (the deployment's base path, realm and secrets come from the environment at run time, never from a layer).
# Built natively for linux/amd64 on the jammers-docker runner (TrueNAS), never under emulation. BuildKit cache mounts
# keep cargo and npm warm between builds.
#
#   docker build -f docker/jj-server.Dockerfile --build-arg JJ_BUILD=$(git rev-parse --short=12 HEAD) -t jj-server .
#   docker run -p 8080:8080 -e JJ_BASE_PATH=/p/test/ jj-server

ARG RUST_VERSION=1.99.0
ARG NODE_VERSION=26.10.0

# ---- Rust: the server and the browser WASM (sim worker, controller input, procgen worker) ----
FROM rust:${RUST_VERSION}-slim-trixie AS rust
ARG WASM_BINDGEN=0.2.129
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -sSfL https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN}/wasm-bindgen-${WASM_BINDGEN}-x86_64-unknown-linux-musl.tar.gz \
    | tar xz -C /tmp && cp /tmp/wasm-bindgen-${WASM_BINDGEN}-x86_64-unknown-linux-musl/wasm-bindgen /usr/local/bin/
WORKDIR /src
COPY rust-toolchain.toml Cargo.toml Cargo.lock deny.toml ./
COPY crates crates
COPY assets assets
COPY maps maps
COPY scenarios scenarios
COPY scripts/build-host-wasm.sh scripts/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    rustup show active-toolchain >/dev/null \
 && cargo build --locked --release -p jj-server --bin jj-server \
 && scripts/build-host-wasm.sh \
 && mkdir -p /out && cp target/release/jj-server /out/

# ---- Web: the landing, host and controller pages (one relative-base build, placed by jj-server) ----
FROM node:${NODE_VERSION}-trixie-slim AS web
ARG JJ_BUILD=dev
WORKDIR /src
COPY web/package.json web/package-lock.json web/
COPY web/shared/package.json web/shared/
COPY web/host/package.json web/host/
COPY web/controller/package.json web/controller/
COPY web/landing/package.json web/landing/
RUN --mount=type=cache,target=/root/.npm cd web && npm ci --no-audit --no-fund
COPY art art
COPY assets assets
COPY maps maps
COPY tools/audio/cues-playtest1.tsv tools/audio/
# The procgen kit stand-ins (P1-M03f/M08a): the host's kit registry globs them into the bundle. Without them the image's
# pages had no `wayfinding/chevron-post` entry, every round preparation failed ("no kit module"), and the first preview
# (v02-f4d0e2ef) never left the Lobby; CI's own build has the whole tree, so only the image showed it.
COPY crates/jj-procgen/kit crates/jj-procgen/kit
COPY web web
COPY --from=rust /src/web/host/src/worker/pkg web/host/src/worker/pkg
COPY --from=rust /src/web/host/src/procgen/pkg web/host/src/procgen/pkg
COPY --from=rust /src/web/host/src/testing/pkg web/host/src/testing/pkg
COPY --from=rust /src/web/controller/src/pkg web/controller/src/pkg
RUN cd web && JJ_COMMIT=${JJ_BUILD} npm run build

# ---- Runtime: non-root, no secrets, health from the server itself ----
FROM debian:trixie-slim
ARG JJ_BUILD=dev
RUN useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin jj
WORKDIR /app
COPY --from=rust /out/jj-server /app/jj-server
COPY --from=web /src/web/dist /app/web
ENV JJ_BIND=0.0.0.0:8080 JJ_DIST=/app/web JJ_BASE_PATH=/ JJ_REALM=preview JJ_BUILD=${JJ_BUILD}
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 CMD ["/app/jj-server", "--healthcheck"]
ENTRYPOINT ["/app/jj-server"]
