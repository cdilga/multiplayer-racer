# Self-review P1-PT-barriers (br-gw74.9)

Local macOS/arm64, Playwright Chromium and WebKit, real Rust server, built WASM worker. Isolated frame-stepped rail yard; one Cruz Missile. This is browser emulation, not physical-device or deployed-preview evidence.

## Looked at

- `frames/chromium-fullscreen-hit-1366x768.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-fullscreen-hit-1920x1080.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-fullscreen-hit-375x667.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-fullscreen-hit-412x915.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-fullscreen-hit-915x412.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-hit-1366x768.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-hit-1920x1080.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-hit-375x667.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-hit-412x915.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-hit-915x412.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-resized-hit-1366x768.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-resized-hit-1920x1080.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-resized-hit-375x667.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-resized-hit-412x915.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/chromium-resized-hit-915x412.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-fullscreen-hit-1366x768.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-fullscreen-hit-1920x1080.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-fullscreen-hit-375x667.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-fullscreen-hit-412x915.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-fullscreen-hit-915x412.jpg` — after fullscreen toggle: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-hit-1366x768.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-hit-1920x1080.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-hit-375x667.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-hit-412x915.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-hit-915x412.jpg` — mid-hit: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-resized-hit-1366x768.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-resized-hit-1920x1080.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-resized-hit-375x667.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-resized-hit-412x915.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.
- `frames/webkit-resized-hit-915x412.jpg` — after viewport rotation: intact Cruz body, drawn galvanised beam/posts beside the car, visible contact, coherent chase camera and no blank world.

## Defects found and fixed

- Initial browser startup rejected the non-generic guard-rail map in the WASM canonical-map encoder. It now uses the complete procgen registry, as the host and fixture loader do.
- The early captures showed too little movement to judge (0.025 m). The final fixture waits for a measured collision deflection above 0.15 m.
- The free-drive join QR partly covered the car on the small phone. Final mechanics captures use the existing offline fixed-tile test route and near chase camera, so the beam/car contact can be seen. No product UI is hidden or changed.
- Native curved-corner fixtures exposed sharp displaced beam ends catching the car; a rounded collider inside the authored envelope and passive springs between bolted neighbouring endpoints preserve a smooth contact surface.

## Remaining defects

None in the changed rail rendering in this local matrix. Deployed-preview and remote captures are still required before closure.

## Not covered

Physical phones, Safari, WebGPU, deployed preview, remote GPU, actual controller connection, and vehicle-model acceptance are not claimed. The fixture tests the WASM/snapshot/instanced-rendering path; real transport has separate journeys. The complete bank and green CI are still required.
