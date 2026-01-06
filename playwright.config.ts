import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // Run tests sequentially - multiplayer tests share server state
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Single worker to avoid port conflicts
    reporter: 'html',
    timeout: 60000, // 60s timeout for each test (accounts for CDN latency)
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
                // Use headless mode - xvfb in CI provides virtual display for WebGL
                headless: true,
                launchOptions: {
                    args: [
                        '--use-gl=angle',
                        '--use-angle=swiftshader',
                        '--enable-webgl',
                        '--enable-webgl2',
                        '--ignore-gpu-blocklist',
                        '--disable-gpu-sandbox',
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        // Increase stability for WebGL
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                    ],
                },
            },
        },
    ],
    // Start server automatically for tests using pyenv environment
    webServer: {
        command: 'bash -c "source ~/.pyenv/versions/multiplayer-racer/bin/activate && python server/app.py"',
        url: 'http://localhost:8000',
        reuseExistingServer: true,
        timeout: 30000,
    },
});
