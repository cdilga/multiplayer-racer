import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * br-captain-call-architecture-hardening-woq.11 Slice 2 — join-route integration.
 *
 * Drives the REAL player page with explicit typed route state (via / intent /
 * pair) and asserts the client-side join decision (window.__joinRoute, produced
 * by the validated pure resolver wired in via src/player/main.js) is
 * deterministic and observable: host QR -> controller-only + no chooser + no
 * world renderer; copied invite -> chooser; controller/screen/spectator intents;
 * pair QR bind; and the Local-phone renderer guard + no-user-agent-only rule.
 *
 * The authoritative server seat-binding + pair-QR image generation are Slice 2's
 * deferred follow-ups (see the Ready/Blocked note); this proves the routing
 * decision + UI + renderer guard are wired and testable.
 */

const ARTIFACT_DIR = 'artifacts/br-captain-call-architecture-hardening-woq.11';

async function joinDecision(page: any, url: string) {
    await page.goto(url);
    await page.waitForFunction(() => !!(window as any).__joinRoute, null, { timeout: 20000 });
    return page.evaluate(() => {
        const chooser = document.getElementById('entry-chooser');
        const badge = document.getElementById('entry-role-badge');
        return {
            decision: (window as any).__joinRoute,
            entry: (window as any).__joinEntry,
            worldRendererStarted: (window as any).__worldRendererStarted,
            hasWorldGame: typeof (window as any).game !== 'undefined',
            chooserVisible: !!chooser && chooser.style.display !== 'none',
            badgeText: badge && badge.style.display !== 'none' ? (badge.textContent || '') : '',
        };
    });
}

test('host QR: direct controller-only, no chooser, no world renderer', async ({ page }) => {
    const r = await joinDecision(page, '/join/WXYZ?via=host_qr&testMode=1');
    expect(r.decision.entryKind).toBe('host_qr_controller');
    expect(r.decision.role).toBe('controller');
    expect(r.decision.showChooser).toBe(false);
    expect(r.decision.startRenderer).toBe(false);
    expect(r.chooserVisible).toBe(false);
    // Local phone renderer guard: never starts the world renderer.
    expect(r.worldRendererStarted).toBe(false);
    expect(r.hasWorldGame).toBe(false);
    // Never routed from user-agent alone.
    expect(r.decision.usedUserAgentOnly).toBe(false);
    // Room derived from the /join/<room> path.
    expect(r.entry.room).toBe('WXYZ');
});

test('copied invite without intent: shows the chooser', async ({ page }) => {
    const r = await joinDecision(page, '/join/WXYZ?via=copied_invite&testMode=1');
    expect(r.decision.entryKind).toBe('copied_invite_chooser');
    expect(r.decision.showChooser).toBe(true);
    expect(r.chooserVisible).toBe(true);
    expect(r.worldRendererStarted).toBe(false);
});

test('controller-only intent: binds controller, no world renderer, no chooser', async ({ page }) => {
    const r = await joinDecision(page, '/join/WXYZ?via=copied_invite&intent=controller&testMode=1');
    expect(r.decision.entryKind).toBe('controller_only');
    expect(r.decision.role).toBe('controller');
    expect(r.decision.startRenderer).toBe(false);
    expect(r.chooserVisible).toBe(false);
    expect(r.worldRendererStarted).toBe(false);
    expect(r.badgeText).toMatch(/Controller/);
});

test('screen/viewer intent: viewer role with a pair prompt (phone degrades, no world renderer)', async ({ page }) => {
    const r = await joinDecision(page, '/join/WXYZ?via=copied_invite&intent=screen&testMode=1');
    expect(r.decision.entryKind).toBe('remote_screen_viewer');
    expect(r.decision.role).toBe('viewer');
    expect(r.decision.pairPrompt).toBe(true);
    // On a Local phone (canRenderViewer=false) it degrades: no world renderer.
    expect(r.decision.startRenderer).toBe(false);
    expect(r.worldRendererStarted).toBe(false);
    expect(r.badgeText).toMatch(/pair/i);
});

test('watch-only intent: read-only spectator, no driving controls', async ({ page }) => {
    const r = await joinDecision(page, '/join/WXYZ?via=copied_invite&intent=spectator&testMode=1');
    expect(r.decision.entryKind).toBe('spectator');
    expect(r.decision.role).toBe('spectator');
    expect(r.decision.readOnly).toBe(true);
    const readOnly = await page.evaluate(() => (window as any).gameState?.entryReadOnly);
    expect(readOnly).toBe(true);
    expect(r.worldRendererStarted).toBe(false);
});

test('pair QR: binds a controller to the existing seat (no new seat)', async ({ page }) => {
    const r = await joinDecision(page, '/join/WXYZ?via=pair_qr&pair=pt-abc&testMode=1');
    expect(r.decision.entryKind).toBe('pair_controller');
    expect(r.decision.role).toBe('controller');
    expect(r.decision.bindToExistingSeat).toBe(true);
    expect(r.decision.startRenderer).toBe(false);
    expect(r.worldRendererStarted).toBe(false);
});

test('chooser interaction: choosing controller re-resolves to controller-only and hides the chooser', async ({ page }) => {
    await page.goto('/join/WXYZ?via=copied_invite&testMode=1');
    await page.waitForFunction(() => (window as any).__joinRoute?.showChooser === true, null, { timeout: 20000 });
    await page.click('#entry-choose-controller');
    const after = await page.evaluate(() => ({
        decision: (window as any).__joinRoute,
        chooserVisible: (() => { const c = document.getElementById('entry-chooser'); return !!c && c.style.display !== 'none'; })(),
    }));
    expect(after.decision.entryKind).toBe('controller_only');
    expect(after.decision.showChooser).toBe(false);
    expect(after.chooserVisible).toBe(false);

    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'join-routing-controller.png') });
    writeFileSync(
        resolve(ARTIFACT_DIR, 'join-routing-decision.json'),
        JSON.stringify(after.decision, null, 2)
    );
});
