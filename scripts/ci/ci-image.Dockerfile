# The CI job image (docs/infra/ci-runners.md): the act runner image plus everything the jobs used to apt-get and
# download per job (Playwright's Chromium system libraries took 10 minutes a job on TrueNAS). Built locally on each
# runner host by scripts/ci/ci-image.sh, never pulled: the tag is a hash of this file, so a change here is a new tag.
#
# What lives here: node (.nvmrc), Playwright's Chromium headless shell and its libraries, coturn, git-lfs, zstd,
# wasm-bindgen, cargo-nextest. What doesn't: the Rust toolchain and cargo/npm caches, which stay on the runner's
# persistent /cargo-cache volume (they change with every rust-toolchain.toml or lockfile bump).
FROM catthehacker/ubuntu:act-22.04@sha256:3cdab37904fc1798c460f1fadd47fd2c4d24fa2f292d1b57fc12eff072b415ec

ARG NODE_VERSION=26.10.0
ARG PLAYWRIGHT_VERSION=1.62.1
ARG WASM_BINDGEN=0.2.129
ARG NEXTEST=0.9.146

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/opt/node/bin:$PATH

RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      coturn git-lfs zstd python3 ca-certificates curl xz-utils \
      vulkan-tools libvulkan1 mesa-vulkan-drivers \
 && mkdir -p /opt/node \
 && curl -sSfL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" | tar xJ -C /opt/node --strip-components=1 \
 && cd /tmp && npm init -y >/dev/null && npm install -s "playwright@${PLAYWRIGHT_VERSION}" \
 && npx playwright install-deps chromium \
 && npx playwright install --only-shell chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /tmp/node_modules /tmp/package*.json /root/.npm \
 && curl -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN}/wasm-bindgen-${WASM_BINDGEN}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
 && cp /tmp/wasm-bindgen-${WASM_BINDGEN}-x86_64-unknown-linux-musl/wasm-bindgen /tmp/wasm-bindgen-${WASM_BINDGEN}-x86_64-unknown-linux-musl/wasm-bindgen-test-runner /usr/local/bin/ \
 && rm -rf /tmp/wasm-bindgen-* \
 && curl -sSfL "https://get.nexte.st/${NEXTEST}/linux" | tar xz -C /usr/local/bin \
 && git lfs install --system \
 && rm -rf /var/lib/apt/lists/*
