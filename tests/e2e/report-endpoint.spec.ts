import { test, expect, gotoHost } from './fixtures';

/**
 * br-captain-call-architecture-hardening-woq.4 — E2E smoke for the public
 * bug-report intake. A browser can POST a sanitized report to the same-origin
 * /report endpoint and get a stored acknowledgement; the honeypot path is
 * silently accepted without error. (The BugReportUI submit flow tries this POST
 * first and falls back to mailto only when it is unreachable — unit-covered in
 * tests/unit/bug-report.test.ts.)
 */
test.describe('bug-report intake endpoint (woq.4)', () => {
    test('a browser POST to /report is stored; honeypot is accepted silently', async ({ hostPage }) => {
        await gotoHost(hostPage);

        const result = await hostPage.evaluate(async () => {
            const post = (body: any) => fetch('/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
            const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

            // Missing description -> validation failure (uses this IP's rate token).
            const bad = await post({ buildId: 'x' });
            // Honeypot short-circuits BEFORE the rate limit -> silently accepted.
            const bot = await post({ description: 'spam', website: 'http://spam.example' });
            // Space past the per-IP rate window (1 req / 2s) for the real submission.
            await wait(2200);
            const good = await post({
                description: 'e2e smoke: car fell through the floor',
                buildId: 'e2e-build', mode: 'derby', severity: 'high',
                runContext: { seed: 7, buildId: 'e2e-build' }
            });
            return { good, bot, bad };
        });

        expect(result.bad.status).toBe(400);    // validation failure
        expect(result.bot.status).toBe(200);    // honeypot: accepted, not stored
        expect(result.good.status).toBe(200);
        expect(result.good.json?.status).toBe('stored');
        expect(result.good.json?.clientReportId).toBeTruthy();
    });
});
