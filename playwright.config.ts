import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // Run tests sequentially - multiplayer tests share server state
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Single worker to avoid port conflicts
    reporter: 'html',
    timeout: 60000, // 60s timeout for each test
    use: {
        baseURL: 'http://localhost:8000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    // Don't start server automatically - we'll handle it in CI
    // webServer: {
    //     command: 'python server/app.py',
    //     url: 'http://localhost:8000',
    //     reuseExistingServer: !process.env.CI,
    //     timeout: 30000,
    // },
});
