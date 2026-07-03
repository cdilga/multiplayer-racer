import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * br-jj-observability-analytics-rkt.11 — End-to-end telemetry validation through a
 * DETERMINISTIC test sink (no live PostHog/Grafana creds).
 *
 * Activates the test sink by injecting window.__JJ_TELEMETRY_CONFIG__ before any
 * page script runs, then exercises the real browser telemetry pipeline and reads
 * events back via window.__JJ_TELEMETRY__.getDebugEvents().
 *
 * Covers: app boot (host + player), join funnel, first input, one client
 * exception (redaction), and one reconnect path. Every captured event is asserted
 * allowlisted + privacy-clean + bounded. Writes an evidence artifact.
 */

const ARTIFACT_DIR = 'artifacts/br-jj-observability-analytics-rkt.11';
const TEST_SINK_INIT = `window.__JJ_TELEMETRY_CONFIG__ = { sink: 'test', enabled: true, release: 'e2e-telemetry' };`;
const E2E_ORIGIN = process.env.JJ_E2E_ORIGIN || 'http://127.0.0.1:8000';
const TEST_QUERY = 'testMode=1&telemetry=test&socketTransport=websocket';

// Event names the app is allowed to emit (mirror of ALLOWED_EVENT_NAMES prefixes;
// we assert prefix families to stay resilient to taxonomy growth).
const ALLOWED_PREFIXES = ['app_boot', 'route_view', 'gameplay:', 'perf:', 'error:', 'server:', 'controller:'];

// Raw values that must NEVER appear in any captured payload.
const FORBIDDEN_RAW = ['192.168.', 'Bearer ', 'sk-secret', 'token='];

function isAllowlisted(name: string): boolean {
    return ALLOWED_PREFIXES.some((p) => (p.endsWith(':') ? name.startsWith(p) : name === p));
}

async function getEvents(page: any): Promise<any[]> {
    return page.evaluate(() => (window as any).__JJ_TELEMETRY__?.getDebugEvents?.() || []);
}

async function pollForEvent(page: any, predicate: (e: any) => boolean, timeoutMs = 15000): Promise<any[]> {
    const deadline = Date.now() + timeoutMs;
    let events: any[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
        events = await getEvents(page);
        if (events.some(predicate)) return events;
        if (Date.now() > deadline) return events;
        await page.waitForTimeout(200);
    }
}

test('telemetry captured through a deterministic test sink: boot, join, first input, exception, reconnect', async ({ browser }) => {
    const captured: Record<string, any[]> = {};

    // === Host boot ===
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await hostContext.addInitScript(TEST_SINK_INIT);
    const hostPage = await hostContext.newPage();
    await hostPage.goto(`${E2E_ORIGIN}/host?${TEST_QUERY}`);

    // Sink must be the test sink and app_boot/route_view must land through it.
    await hostPage.waitForFunction(() => typeof (window as any).__JJ_TELEMETRY__?.getDebugEvents === 'function', null, { timeout: 30000 });
    const hostBoot = await pollForEvent(hostPage, (e) => e.eventName === 'app_boot');
    captured.hostBoot = hostBoot;
    expect(hostBoot.some((e) => e.eventName === 'app_boot')).toBe(true);
    expect(hostBoot.some((e) => e.eventName === 'route_view')).toBe(true);
    // Boot events carry required correlation envelope fields.
    const bootEvt = hostBoot.find((e) => e.eventName === 'app_boot');
    expect(bootEvt.release).toBeTruthy();
    expect(bootEvt.role).toBe('host');

    // Room code
    await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });
    let roomCode = '';
    for (let i = 0; i < 60; i++) {
        roomCode = (await hostPage.locator('#room-code-display').textContent()) || '';
        if (roomCode && roomCode.length === 4 && !roomCode.includes('-')) break;
        await hostPage.waitForTimeout(50);
    }
    expect(roomCode.length).toBe(4);

    // === Player boot + join funnel ===
    const playerContext = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    await playerContext.addInitScript(TEST_SINK_INIT);
    const playerPage = await playerContext.newPage();
    // websocket transport => an offline toggle drops the socket immediately, so
    // the reconnect path fires deterministically (vs. long polling ping timeout).
    await playerPage.goto(`${E2E_ORIGIN}/player?${TEST_QUERY}`);
    await playerPage.waitForFunction(() => typeof (window as any).__JJ_TELEMETRY__?.getDebugEvents === 'function', null, { timeout: 30000 });

    const playerBoot = await pollForEvent(playerPage, (e) => e.eventName === 'app_boot');
    expect(playerBoot.some((e) => e.eventName === 'app_boot')).toBe(true);
    expect(playerBoot.some((e) => e.eventName === 'route_view')).toBe(true);

    // Join
    await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });
    await playerPage.fill('#room-code', roomCode);
    await playerPage.fill('#player-name', 'ValidatorRider');
    await playerPage.click('#join-btn');
    await playerPage.waitForFunction(() => (window as any).gameState && (window as any).gameState.playerId !== null, null, { timeout: 30000 });

    // Join funnel: host observes gameplay:player:joined (reliable server-driven path).
    const hostAfterJoin = await pollForEvent(hostPage, (e) => e.eventName === 'gameplay:player:joined');
    captured.hostAfterJoin = hostAfterJoin;
    expect(hostAfterJoin.some((e) => e.eventName === 'gameplay:player:joined')).toBe(true);

    // First input: drive the REAL control path via the app's own runtime test hook
    // (window.__playerControlMapperTestHooks) so a non-zero control packet flows
    // through the real emitControlUpdate(), which emits gameplay:join:first_input.
    await playerPage.waitForFunction(() => !!(window as any).__playerControlMapperTestHooks, null, { timeout: 15000 });
    await playerPage.evaluate(() => {
        const hooks = (window as any).__playerControlMapperTestHooks;
        hooks.setSession({ gameStarted: true });     // control streaming active
        hooks.applyTouchIntent({ acceleration: 1 }); // non-zero input intent
        hooks.advanceFrame(250);                     // step the mapper so controls resolve non-zero + send
        hooks.emitControlUpdate(performance.now(), { force: true });
    });
    const playerAfterInput = await pollForEvent(playerPage, (e) => e.eventName === 'gameplay:join:first_input', 8000);
    captured.playerAfterInput = playerAfterInput;
    const firstInputSeen = playerAfterInput.some((e) => e.eventName === 'gameplay:join:first_input');
    expect(firstInputSeen, 'gameplay:join:first_input must be captured through the test sink').toBe(true);

    // === Client exception (redaction end-to-end) ===
    await hostPage.evaluate(() => {
        (window as any).__JJ_TELEMETRY__.captureException(new Error('Bearer sk-secret-token=abc123 leaked'));
    });
    const hostAfterError = await pollForEvent(hostPage, (e) => String(e.eventName).startsWith('error:'));
    captured.hostAfterError = hostAfterError;
    const errEvt = hostAfterError.find((e) => String(e.eventName).startsWith('error:'));
    expect(errEvt).toBeTruthy();
    // The raw error message must be redacted (browser messages -> '[redacted]').
    expect(errEvt.properties.errorMessage).toBe('[redacted]');

    // === Reconnect path ===
    // Drop the websocket transport => real socket.io 'disconnect' fires, emitting
    // error:network:disconnect; restoring connectivity fires 'reconnect', emitting
    // the controller reconnect + perf:connectivity:reconnect events.
    await playerContext.setOffline(true);
    await playerPage.waitForTimeout(2500);
    const afterDisconnect = await pollForEvent(
        playerPage,
        (e) => e.eventName === 'error:network:disconnect' || e.eventName === 'gameplay:controller:disconnected',
        20000
    );
    const disconnectSeen = afterDisconnect.some(
        (e) => e.eventName === 'error:network:disconnect' || e.eventName === 'gameplay:controller:disconnected'
    );
    await playerContext.setOffline(false);
    const playerAfterReconnect = await pollForEvent(
        playerPage,
        (e) => e.eventName === 'error:network:reconnect'
            || e.eventName === 'perf:connectivity:reconnect'
            || e.eventName === 'gameplay:controller:reconnect_succeeded'
            || e.eventName === 'gameplay:controller:reconnect_attempted'
            || String(e.eventName).includes('reconnect'),
        30000
    );
    captured.playerAfterReconnect = playerAfterReconnect;
    const reconnectSeen = playerAfterReconnect.some(
        (e) => String(e.eventName).includes('reconnect')
    );
    expect(disconnectSeen, 'error:network:disconnect must be captured on transport drop').toBe(true);
    expect(reconnectSeen, 'a reconnect-family event must be captured through the test sink').toBe(true);

    // === Global invariants across every captured event ===
    const allEvents = [
        ...(await getEvents(hostPage)),
        ...(await getEvents(playerPage)),
    ];
    expect(allEvents.length).toBeGreaterThan(0);

    for (const e of allEvents) {
        // Allowlisted names only.
        expect(isAllowlisted(e.eventName), `unexpected event name: ${e.eventName}`).toBe(true);
        // Required correlation envelope present.
        expect(e.release).toBeTruthy();
        expect(e.roomAnalyticsId ?? '').not.toBe('');
    }

    // Privacy: no forbidden raw value anywhere in the serialized capture.
    const serialized = JSON.stringify(allEvents);
    for (const raw of FORBIDDEN_RAW) {
        expect(serialized.includes(raw), `forbidden raw value leaked: ${raw}`).toBe(false);
    }
    expect(serialized).not.toContain(roomCode); // raw room code must not leak
    expect(serialized).not.toContain('ValidatorRider'); // raw player name must not leak

    // No-spam sanity: boot must not spam app_boot per frame.
    const bootCount = allEvents.filter((e) => e.eventName === 'app_boot').length;
    expect(bootCount).toBeLessThanOrEqual(2); // one host + one player

    // === Evidence artifact ===
    const summary = {
        bead: 'br-jj-observability-analytics-rkt.11',
        sink: 'test',
        roomCodePresentInEvents: serialized.includes(roomCode),
        coverage: {
            hostBoot: hostBoot.some((e) => e.eventName === 'app_boot'),
            playerBoot: playerBoot.some((e) => e.eventName === 'app_boot'),
            joinFunnel: hostAfterJoin.some((e) => e.eventName === 'gameplay:player:joined'),
            firstInput: firstInputSeen,
            clientException: errEvt.properties.errorMessage === '[redacted]',
            disconnect: disconnectSeen,
            reconnect: reconnectSeen,
        },
        capturedEventNames: Array.from(new Set(allEvents.map((e) => e.eventName))).sort(),
        totalCaptured: allEvents.length,
        privacyScan: {
            forbiddenRawFound: FORBIDDEN_RAW.filter((r) => serialized.includes(r)),
            rawRoomCodeFound: serialized.includes(roomCode),
            rawPlayerNameFound: serialized.includes('ValidatorRider'),
        },
    };
    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    writeFileSync(resolve(ARTIFACT_DIR, 'telemetry-e2e-capture.json'), JSON.stringify(summary, null, 2));

    await hostContext.close();
    await playerContext.close();
});
