// Waits for an async page predicate. Playwright's waitForFunction does not await a predicate's Promise: an `async`
// predicate is truthy at once, so `waitForFunction(async () => …)` never waited (Playwright 1.62.1, checked on eris
// 2026-11-14; br-63l3). `until` polls from Node instead, awaiting the predicate each time, and resolves with its first
// truthy value (so callers can read a value, as `jsonValue()` did).
/**
 * @template T
 * @param {import('playwright').Page} page
 * @param {(arg: any) => T | Promise<T>} fn
 * @param {any} [arg]
 * @param {number} [ms]
 * @param {number} [every]
 * @returns {Promise<T>}
 */
export async function until(page, fn, arg, ms = 120_000, every = 100) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`until: not true after ${ms} ms: ${fn.toString().slice(0, 140)}`);
    await new Promise((r) => setTimeout(r, every));
  }
}
