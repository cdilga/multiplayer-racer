import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: [
            'tests/unit/**/*.test.ts',
            'tests/unit/**/*.test.js',
            'tests/integration/**/*.test.ts',
            'tests/integration/**/*.test.js',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
        },
    },
});
