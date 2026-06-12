import { defineConfig } from '@playwright/test';

// Standalone config for smoke-testing the DEPLOYED game.
// No local webServer - targets LIVE_URL (default https://jammers.dilger.dev).
export default defineConfig({
    testDir: '.',
    testMatch: 'live-smoke.ts',
    timeout: 120000,
    retries: 0,
    workers: 1,
    reporter: 'line',
    use: {
        ignoreHTTPSErrors: false,
    },
});
