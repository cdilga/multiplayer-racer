import { defineConfig, devices } from '@playwright/test';

// Detect environment for GPU strategy
const isCI = !!process.env.CI;

// GPU flags strategy:
// - CI: Use SwiftShader (software renderer) since no GPU available
// - Local: Use native GPU acceleration for speed
const gpuArgs = isCI ? [
    // CI: Force software rendering (no GPU)
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',  // Required for SwiftShader WebGL (avoids deprecation crash)
    '--disable-gpu',  // Forces SwiftShader, prevents futile GPU detection
] : [
    // Local: Use hardware GPU when available
    '--use-gl=angle',
    '--use-angle=default',  // Let ANGLE pick best backend (Metal on Mac, D3D on Windows)
    '--enable-gpu-rasterization',
];

// Common WebGL and stability flags
const commonArgs = [
    '--enable-webgl',
    '--enable-webgl2',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
];

// CI-specific flags for containerized environments
// These optimize for resource-constrained CI runners (see CI_TEST_PERFORMANCE_SPEC.md)
// NOTE: --single-process removed - causes browser crashes in multi-context scenarios
// Instead, we use parallel workers to improve performance
const ciArgs = isCI ? [
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',      // Use /tmp instead of /dev/shm (often too small in containers)
    '--disable-setuid-sandbox',
    '--disable-accelerated-2d-canvas',
    '--disable-accelerated-video-decode',
    '--disable-audio-output',        // Prevent audio-related issues
    '--mute-audio',
    '--disable-features=VizDisplayCompositor,AudioServiceOutOfProcess',
] : [];

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: !isCI,  // Parallel locally, serial in CI (SwiftShader can't handle multiple WebGL contexts)
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,  // Reduced from 2 to save time
    // 1 worker in CI - SwiftShader software rendering needs dedicated CPU
    // 2 workers locally where GPU acceleration is available
    workers: isCI ? 1 : 2,
    reporter: 'html',
    // Longer timeouts in CI due to SwiftShader slowness (3 min for complex multi-step tests)
    timeout: isCI ? 180000 : 60000,
    expect: {
        timeout: isCI ? 30000 : 5000,
    },
    use: {
        baseURL: 'http://localhost:8000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: isCI ? 30000 : 10000,
        navigationTimeout: isCI ? 60000 : 30000,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                headless: true,
                launchOptions: {
                    args: [...gpuArgs, ...commonArgs, ...ciArgs],
                },
            },
        },
    ],
    webServer: {
        command: 'bash -c "source ~/.pyenv/versions/multiplayer-racer/bin/activate && python server/app.py"',
        url: 'http://localhost:8000',
        reuseExistingServer: true,
        timeout: 30000,
    },
});
