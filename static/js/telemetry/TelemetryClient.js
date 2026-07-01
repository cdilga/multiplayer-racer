import { BUILD_INFO, getReleaseId } from '../buildInfo.js';
import { TelemetryService, normalizeTelemetryEnv } from './TelemetryService.js';

const UNKNOWN_ROOM_ID = 'room-unknown';
const UNKNOWN_MATCH_ID = 'match-unknown';
const UNKNOWN_PLAYER_ID = 'player-unknown';
const ANONYMOUS_ID_STORAGE_KEY = 'jj_telemetry_anonymous_id_v1';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

let browserTelemetryClient = null;

function getRuntimeWindow() {
    return typeof window !== 'undefined' ? window : null;
}

function getStorage() {
    const runtimeWindow = getRuntimeWindow();
    try {
        if (runtimeWindow?.localStorage) {
            return runtimeWindow.localStorage;
        }
    } catch (e) {}
    return null;
}

function createAnonymousId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return `anon-${cryptoApi.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    }
    return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateAnonymousId() {
    const storage = getStorage();
    try {
        const existing = storage?.getItem(ANONYMOUS_ID_STORAGE_KEY);
        if (existing) {
            return existing;
        }
    } catch (e) {}

    const nextId = createAnonymousId();
    try {
        storage?.setItem(ANONYMOUS_ID_STORAGE_KEY, nextId);
    } catch (e) {}
    return nextId;
}

function safePathname(urlLike) {
    try {
        if (!urlLike) {
            return getRuntimeWindow()?.location?.pathname || '/';
        }
        const base = getRuntimeWindow()?.location?.origin || 'https://example.test';
        return new URL(urlLike, base).pathname || '/';
    } catch (e) {
        return '/';
    }
}

function resolveViteEnv(overrideEnv) {
    if (overrideEnv && typeof overrideEnv === 'object') {
        return overrideEnv;
    }
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        return import.meta.env;
    }
    return {};
}

function resolveGlobalConfig() {
    const runtimeWindow = getRuntimeWindow();
    return runtimeWindow?.__JJ_TELEMETRY_CONFIG__ || {};
}

function getTelemetryQueryMode() {
    const runtimeWindow = getRuntimeWindow();
    try {
        const params = new URLSearchParams(runtimeWindow?.location?.search || '');
        return (params.get('telemetry') || '').trim().toLowerCase();
    } catch (e) {
        return '';
    }
}

function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

class NoOpTelemetrySink {
    constructor() {
        this.kind = 'noop';
    }

    observe() {}

    async flush(batch = []) {
        return { sent: 0, failed: batch.length ? 0 : 0 };
    }
}

class MemoryTelemetrySink {
    constructor({ kind = 'debug', consoleDebug = false } = {}) {
        this.kind = kind;
        this.consoleDebug = consoleDebug;
        this.events = [];
        this.flushes = [];
    }

    observe(event) {
        this.events.push(event);
        if (this.consoleDebug) {
            console.log('[TELEMETRY DEBUG SINK]', JSON.stringify(event));
        }
    }

    async flush(batch = []) {
        this.flushes.push(batch.map((event) => ({ ...event })));
        return { sent: batch.length, failed: 0 };
    }
}

class PostHogFetchSink {
    constructor({ apiKey, host = DEFAULT_POSTHOG_HOST, fetchImpl } = {}) {
        this.kind = 'posthog';
        this.apiKey = apiKey;
        this.host = String(host || DEFAULT_POSTHOG_HOST).replace(/\/+$/, '');
        this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    }

    observe() {}

    async flush(batch = []) {
        if (!batch.length) {
            return { sent: 0, failed: 0 };
        }
        if (!this.fetchImpl || !this.apiKey) {
            return { sent: 0, failed: batch.length };
        }

        const response = await this.fetchImpl(`${this.host}/batch/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: this.apiKey,
                batch: batch.map((event) => ({
                    event: event.eventName,
                    properties: {
                        distinct_id: event.playerAnalyticsId,
                        $lib: 'joystick-jammers-browser-telemetry',
                        release: event.release,
                        roomAnalyticsId: event.roomAnalyticsId,
                        matchId: event.matchId,
                        project: event.project,
                        service: event.service,
                        env: event.env,
                        role: event.role,
                        source: event.source,
                        ...(event.mode ? { mode: event.mode } : {}),
                        ...(event.properties || {})
                    },
                    timestamp: new Date(event.timestamp).toISOString()
                })),
                sent_at: new Date().toISOString()
            })
        });

        if (!response?.ok) {
            return { sent: 0, failed: batch.length };
        }
        return { sent: batch.length, failed: 0 };
    }
}

export function resolveTelemetryConfig(config = {}) {
    const env = resolveViteEnv(config.env);
    const globalConfig = resolveGlobalConfig();
    const queryMode = getTelemetryQueryMode();

    const posthogApiKey = firstDefined(
        config.posthogApiKey,
        globalConfig.posthogApiKey,
        env.VITE_POSTHOG_API_KEY,
        ''
    );
    const posthogHost = firstDefined(
        config.posthogHost,
        globalConfig.posthogHost,
        env.VITE_POSTHOG_HOST,
        DEFAULT_POSTHOG_HOST
    );

    const requestedSink = firstDefined(
        config.sink,
        globalConfig.sink,
        queryMode === 'debug' ? 'debug' : undefined,
        queryMode === 'test' ? 'test' : undefined,
        posthogApiKey ? 'posthog' : 'noop'
    );

    const enabled = Boolean(firstDefined(
        config.enabled,
        globalConfig.enabled,
        env.VITE_TELEMETRY_ENABLED === '1',
        requestedSink === 'debug' || requestedSink === 'test'
    ));

    const sink = requestedSink === 'posthog' && (!enabled || !posthogApiKey)
        ? 'noop'
        : (!enabled && requestedSink !== 'debug' && requestedSink !== 'test' ? 'noop' : requestedSink);

    return {
        enabled,
        debug: Boolean(firstDefined(config.debug, globalConfig.debug, queryMode === 'debug', false)),
        sink,
        envLabel: normalizeTelemetryEnv(firstDefined(config.envLabel, globalConfig.envLabel, env.MODE || env.NODE_ENV || 'local')),
        release: String(firstDefined(config.release, globalConfig.release, getReleaseId(BUILD_INFO))),
        buildId: String(firstDefined(config.buildId, globalConfig.buildId, BUILD_INFO.buildId)),
        buildTime: String(firstDefined(config.buildTime, globalConfig.buildTime, BUILD_INFO.buildTime)),
        posthogApiKey: String(posthogApiKey || ''),
        posthogHost: String(posthogHost || DEFAULT_POSTHOG_HOST),
        fetchImpl: firstDefined(config.fetchImpl, globalConfig.fetchImpl, null),
        autoFlush: Boolean(firstDefined(config.autoFlush, globalConfig.autoFlush, sink === 'posthog')),
    };
}

function createSink(config) {
    if (config.sink === 'debug' || config.sink === 'test') {
        return new MemoryTelemetrySink({
            kind: config.sink,
            consoleDebug: config.debug && config.sink === 'debug',
        });
    }
    if (config.sink === 'posthog') {
        return new PostHogFetchSink({
            apiKey: config.posthogApiKey,
            host: config.posthogHost,
            fetchImpl: config.fetchImpl,
        });
    }
    return new NoOpTelemetrySink();
}

export class TelemetryClient {
    constructor(options = {}) {
        this.config = resolveTelemetryConfig(options);
        this.service = new TelemetryService({
            enabled: this.config.sink !== 'noop',
            release: this.config.release,
            role: options.role || 'unknown',
            source: options.source || 'unknown',
            env: this.config.envLabel,
            debug: false,
        });
        this.sink = createSink(this.config);
        this.service.setRoomAnalyticsId(UNKNOWN_ROOM_ID);
        this.service.setMatchId(UNKNOWN_MATCH_ID);
        this.service.setPlayerAnalyticsId(UNKNOWN_PLAYER_ID);
        this.identifyAnonymous(options.anonymousId);
    }

    init() {
        return this;
    }

    identifyAnonymous(anonymousId) {
        const nextId = String(anonymousId || getOrCreateAnonymousId() || UNKNOWN_PLAYER_ID);
        this.service.setPlayerAnalyticsId(nextId);
        return nextId;
    }

    setContext(context = {}) {
        if (context.roomAnalyticsId !== undefined && context.roomAnalyticsId !== null && context.roomAnalyticsId !== '') {
            this.service.setRoomAnalyticsId(String(context.roomAnalyticsId));
        }
        if (context.matchId !== undefined && context.matchId !== null && context.matchId !== '') {
            this.service.setMatchId(String(context.matchId));
        }
        if (context.playerAnalyticsId !== undefined && context.playerAnalyticsId !== null && context.playerAnalyticsId !== '') {
            this.service.setPlayerAnalyticsId(String(context.playerAnalyticsId));
        }
        return this.getContext();
    }

    setContextFromPayload(payload = {}) {
        return this.setContext({
            roomAnalyticsId: payload.roomAnalyticsId ?? payload.room_analytics_id,
            matchId: payload.matchId ?? payload.match_id,
            playerAnalyticsId: payload.playerAnalyticsId ?? payload.player_analytics_id,
        });
    }

    getContext() {
        return {
            roomAnalyticsId: this.service.roomAnalyticsId,
            matchId: this.service.matchId,
            playerAnalyticsId: this.service.playerAnalyticsId,
        };
    }

    capture(eventName, properties = {}) {
        if (this.config.sink === 'noop') {
            return null;
        }

        const event = this.service.emit(eventName, properties);
        if (!event) {
            return null;
        }
        this.sink.observe(event);
        if (this.config.autoFlush) {
            void this.flush();
        }
        return event;
    }

    captureException(error, properties = {}, options = {}) {
        const stack = String(error?.stack || '');
        const baseProperties = {
            errorName: String(error?.name || 'Error'),
            errorMessage: error?.message ? '[redacted]' : 'Unknown error',
            messageLength: String(error?.message || '').length,
            hasStack: Boolean(stack),
            stackLineCount: stack ? stack.split('\n').length : 0,
            ...properties,
        };
        return this.capture(options.eventName || 'error:gameplay:crash', baseProperties);
    }

    async flush() {
        if (this.config.sink === 'noop' || this.service.queue.length === 0) {
            return { sent: 0, failed: 0 };
        }
        const batch = this.service.queue.splice(0, this.service.queue.length);
        const result = await this.sink.flush(batch);
        if (result.failed > 0) {
            this.service.queue.unshift(...batch);
        }
        return result;
    }

    clear() {
        this.service.clear();
        if (Array.isArray(this.sink.events)) {
            this.sink.events.length = 0;
        }
        if (Array.isArray(this.sink.flushes)) {
            this.sink.flushes.length = 0;
        }
    }

    getDebugEvents() {
        if (Array.isArray(this.sink.events)) {
            return this.sink.events.slice();
        }
        return [];
    }
}

export function initBrowserTelemetry(options = {}) {
    if (!browserTelemetryClient) {
        browserTelemetryClient = new TelemetryClient(options).init();
        const runtimeWindow = getRuntimeWindow();
        if (runtimeWindow) {
            runtimeWindow.__JJ_TELEMETRY__ = browserTelemetryClient;
        }
    } else if (options && Object.keys(options).length > 0) {
        browserTelemetryClient.setContext({
            roomAnalyticsId: options.roomAnalyticsId,
            matchId: options.matchId,
            playerAnalyticsId: options.playerAnalyticsId,
        });
    }
    return browserTelemetryClient;
}

export function getBrowserTelemetry() {
    return browserTelemetryClient || getRuntimeWindow()?.__JJ_TELEMETRY__ || null;
}

export function setTelemetryContextFromPayload(payload = {}) {
    const client = getBrowserTelemetry();
    if (!client) {
        return null;
    }
    return client.setContextFromPayload(payload);
}

export function bootstrapPageTelemetry(options = {}) {
    const client = initBrowserTelemetry(options);
    const routePath = safePathname(options.routePath);
    client.capture('app_boot', {
        routePath,
        role: options.role || 'unknown',
        entrySource: options.source || 'unknown',
        buildId: client.config.buildId,
        buildTime: client.config.buildTime,
    });
    client.capture('route_view', {
        routePath,
        role: options.role || 'unknown',
    });
    return client;
}

export function resetBrowserTelemetryForTests() {
    browserTelemetryClient = null;
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow?.__JJ_TELEMETRY__) {
        delete runtimeWindow.__JJ_TELEMETRY__;
    }
    if (runtimeWindow?.__JJ_TELEMETRY_CONFIG__) {
        delete runtimeWindow.__JJ_TELEMETRY_CONFIG__;
    }
}
