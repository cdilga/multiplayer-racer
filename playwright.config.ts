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
const ciArgs = isCI ? [
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',
] : [];

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    // Limit workers to 2 - WebGL tests have resource contention with more workers
    workers: 2,
    reporter: 'html',
    timeout: 60000,
    use: {
        baseURL: 'http://localhost:8000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
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
