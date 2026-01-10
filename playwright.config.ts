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
const ciArgs = isCI ? [
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',      // Use /tmp instead of /dev/shm (often too small in containers)
    '--disable-setuid-sandbox',
    '--disable-accelerated-2d-canvas',
    '--disable-accelerated-video-decode',
    '--single-process',              // Reduces memory overhead (~200MB) and IPC latency
    '--disable-features=VizDisplayCompositor',
] : [];

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: !isCI,  // Sequential in CI for stability
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    // Single worker in CI (resource-constrained), 2 locally for speed
    workers: isCI ? 1 : 2,
    reporter: 'html',
    // Longer timeouts in CI due to SwiftShader slowness
    timeout: isCI ? 120000 : 60000,
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
