import { BUILD_INFO, getReleaseId } from '../buildInfo.js';
import { TelemetryService, normalizeTelemetryEnv } from './TelemetryService.js';

const UNKNOWN_ROOM_ID = 'room-unknown';
const UNKNOWN_MATCH_ID = 'match-unknown';
const UNKNOWN_PLAYER_ID = 'player-unknown';
const ANONYMOUS_ID_STORAGE_KEY = 'jj_telemetry_anonymous_id_v1';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const DEFAULT_ERROR_THROTTLE_MS = 60000;
const DEFAULT_TELEMETRY_COOLDOWN_MS = 1500;
const MAX_STACK_LINE_COUNT = 200;

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

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function numberOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function stableStringify(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value !== 'object') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function firstStackFrame(stack = '') {
    const lines = String(stack || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const candidate = lines.find((line) => /\bat\s+|@|\.js/.test(line)) || lines[0] || '';
    return candidate
        .replace(/https?:\/\/[^/\s)]+/g, '')
        .replace(/[?#][^\s)]+/g, '')
        .replace(/:\d+:\d+/g, ':line:col')
        .slice(0, 160);
}

function normalizeErrorLike(error) {
    if (error instanceof Error || (error && typeof error === 'object' && ('message' in error || 'stack' in error))) {
        return {
            name: String(error.name || 'Error'),
            message: String(error.message || ''),
            stack: String(error.stack || ''),
            code: error.code != null ? String(error.code) : ''
        };
    }
    return {
        name: 'NonErrorRejection',
        message: String(error || ''),
        stack: '',
        code: ''
    };
}

function getBrowserFamily(userAgent = '') {
    const ua = String(userAgent || '');
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    if (/Firefox\//.test(ua)) return 'Firefox';
    return 'unknown';
}

function getDeviceClass(runtimeWindow = getRuntimeWindow()) {
    const navigatorLike = runtimeWindow?.navigator || globalThis.navigator || {};
    const userAgent = String(navigatorLike.userAgent || '');
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
    if (/Mobi|iPhone|Android/i.test(userAgent)) return 'mobile';
    return 'desktop';
}

function runtimeContextProperties() {
    const runtimeWindow = getRuntimeWindow();
    const navigatorLike = runtimeWindow?.navigator || globalThis.navigator || {};
    return {
        routePath: safePathname(),
        browserFamily: getBrowserFamily(navigatorLike.userAgent),
        deviceClass: getDeviceClass(runtimeWindow),
    };
}

export function getRuntimeTelemetryContext() {
    return runtimeContextProperties();
}

export function buildTelemetryFingerprint(parts = {}) {
    const normalized = {
        eventName: String(parts.eventName || ''),
        origin: String(parts.errorOrigin || parts.origin || ''),
        errorName: String(parts.errorName || parts.name || ''),
        code: String(parts.code || ''),
        sourcePath: safePathname(parts.sourcePath || parts.filename || parts.fileName || ''),
        lineNumber: numberOrNull(parts.lineNumber ?? parts.lineno) ?? '',
        columnNumber: numberOrNull(parts.columnNumber ?? parts.colno) ?? '',
        stackTop: firstStackFrame(parts.stack || ''),
        routePath: safePathname(parts.routePath || ''),
        handler: String(parts.handler || '')
    };
    return `jjerr-${hashString(stableStringify(normalized))}`;
}

function coerceErrorProperties(error, properties = {}, options = {}) {
    const normalized = normalizeErrorLike(error);
    const stackLineCount = normalized.stack ? normalized.stack.split('\n').length : 0;
    const lineNumber = numberOrNull(properties.lineNumber ?? properties.lineno ?? options.lineNumber);
    const columnNumber = numberOrNull(properties.columnNumber ?? properties.colno ?? options.columnNumber);
    const errorOrigin = String(options.errorOrigin || properties.errorOrigin || 'manual.captureException');
    const routePath = safePathname(properties.routePath || options.routePath);
    const sourcePath = safePathname(properties.sourcePath || properties.filename || options.sourcePath || options.filename);
    const fingerprint = String(
        options.fingerprint ||
        properties.fingerprint ||
        properties.errorFingerprint ||
        buildTelemetryFingerprint({
            eventName: options.eventName || 'error:gameplay:crash',
            errorOrigin,
            errorName: normalized.name,
            code: normalized.code,
            sourcePath,
            routePath,
            lineNumber,
            columnNumber,
            stack: normalized.stack,
            handler: properties.handler || options.handler,
        })
    );

    return {
        ...runtimeContextProperties(),
        ...properties,
        errorOrigin,
        errorName: normalized.name,
        errorMessage: normalized.message ? '[redacted]' : 'Unknown error',
        messageLength: normalized.message.length,
        errorCode: normalized.code || normalized.name,
        hasStack: Boolean(normalized.stack),
        stackLineCount: Math.min(stackLineCount, MAX_STACK_LINE_COUNT),
        stackTop: firstStackFrame(normalized.stack),
        sourcePath,
        ...(lineNumber !== null ? { lineNumber } : {}),
        ...(columnNumber !== null ? { columnNumber } : {}),
        fingerprint,
    };
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

    const errorCaptureSetting = firstDefined(
        config.errorCaptureEnabled,
        globalConfig.errorCaptureEnabled,
        env.VITE_TELEMETRY_ERROR_CAPTURE_ENABLED,
        env.VITE_TELEMETRY_ERROR_CAPTURE
    );
    const errorThrottleMs = clampInteger(
        firstDefined(config.errorThrottleMs, globalConfig.errorThrottleMs, env.VITE_TELEMETRY_ERROR_THROTTLE_MS),
        1000,
        3600000,
        DEFAULT_ERROR_THROTTLE_MS
    );

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
        errorCaptureEnabled: parseBoolean(errorCaptureSetting, true),
        errorThrottleMs,
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
        this.errorThrottle = new Map();
        this.transitionState = new Map();
        this.rateLimitState = new Map();
        this._browserErrorCaptureInstalled = false;
        this._removeBrowserErrorCapture = null;
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

    captureWithCooldown(eventName, properties = {}, options = {}) {
        const cooldownMs = Math.max(0, Number(options.cooldownMs || DEFAULT_TELEMETRY_COOLDOWN_MS));
        const nowMs = Number(options.nowMs || Date.now());
        const key = `cooldown:${eventName}:${stableStringify(properties)}`;

        if (cooldownMs > 0 && this._isRateLimited(key, nowMs, cooldownMs)) {
            return null;
        }

        return this.capture(eventName, properties);
    }

    captureStateTransition(eventName, state, properties = {}, options = {}) {
        const key = `transition:${eventName}`;
        const previous = this.transitionState.get(key);
        if (previous === String(state)) {
            const cooldownMs = Math.max(0, Number(options.cooldownMs || 0));
            if (cooldownMs <= 0) {
                return null;
            }

            const nowMs = Number(options.nowMs || Date.now());
            const lastEmit = Number(this.rateLimitState.get(key)?.lastAt || 0);
            if (nowMs - lastEmit < cooldownMs) {
                return null;
            }
        }

        this.transitionState.set(key, String(state));
        if (!this.rateLimitState.has(key)) {
            this.rateLimitState.set(key, { lastAt: Number.MIN_SAFE_INTEGER });
        }
        this.rateLimitState.get(key).lastAt = Number(options.nowMs || Date.now());

        const transitionedProperties = {
            ...(properties || {}),
            state,
        };
        return this.capture(eventName, transitionedProperties);
    }

    _isRateLimited(key, nowMs, cooldownMs) {
        const existing = this.rateLimitState.get(key);
        if (existing && nowMs - existing.lastAt < cooldownMs) {
            existing.lastAt = nowMs;
            this.rateLimitState.set(key, existing);
            return true;
        }

        this.rateLimitState.set(key, {
            lastAt: nowMs,
        });
        return false;
    }

    captureException(error, properties = {}, options = {}) {
        if (!this.config.errorCaptureEnabled) {
            return null;
        }
        const eventName = options.eventName || 'error:gameplay:crash';
        const baseProperties = coerceErrorProperties(error, properties, { ...options, eventName });
        if (this._shouldThrottle(baseProperties.fingerprint, options.nowMs)) {
            return null;
        }
        return this.capture(eventName, baseProperties);
    }

    captureInitializationFailure(error, properties = {}) {
        return this.captureException(error, {
            phase: 'initialization',
            ...properties,
        }, {
            errorOrigin: 'initialization',
            eventName: 'error:gameplay:crash',
        });
    }

    captureSocketConnectError(error, properties = {}) {
        return this.captureException(error, {
            networkPhase: 'connect',
            ...properties,
        }, {
            errorOrigin: 'socketio.connect_error',
            eventName: 'error:network:disconnect',
        });
    }

    captureWebGLContextLoss(event = {}, properties = {}) {
        return this.captureException(new Error('WebGL context lost'), {
            canvasTag: String(event?.target?.tagName || 'CANVAS').toLowerCase(),
            ...properties,
        }, {
            errorOrigin: 'webglcontextlost',
            eventName: 'error:gameplay:crash',
        });
    }

    installBrowserErrorCapture(options = {}) {
        const runtimeWindow = getRuntimeWindow();
        if (!runtimeWindow || this._browserErrorCaptureInstalled || !this.config.errorCaptureEnabled) {
            return false;
        }

        const onError = (event = {}) => {
            const error = event.error || new Error(String(event.message || 'Window error'));
            this.captureException(error, {
                sourcePath: event.filename,
                lineNumber: event.lineno,
                columnNumber: event.colno,
                phase: options.phase || 'runtime',
            }, {
                errorOrigin: 'window.onerror',
                eventName: 'error:gameplay:crash',
            });
        };
        const onUnhandledRejection = (event = {}) => {
            this.captureException(event.reason, {
                phase: options.phase || 'runtime',
            }, {
                errorOrigin: 'unhandledrejection',
                eventName: 'error:gameplay:crash',
            });
        };
        const onWebGLContextLost = (event = {}) => {
            this.captureWebGLContextLoss(event, {
                phase: options.phase || 'runtime',
            });
        };

        runtimeWindow.addEventListener?.('error', onError);
        runtimeWindow.addEventListener?.('unhandledrejection', onUnhandledRejection);
        const documentLike = runtimeWindow.document || globalThis.document;
        documentLike?.addEventListener?.('webglcontextlost', onWebGLContextLost, true);

        this._browserErrorCaptureInstalled = true;
        this._removeBrowserErrorCapture = () => {
            runtimeWindow.removeEventListener?.('error', onError);
            runtimeWindow.removeEventListener?.('unhandledrejection', onUnhandledRejection);
            documentLike?.removeEventListener?.('webglcontextlost', onWebGLContextLost, true);
            this._browserErrorCaptureInstalled = false;
            this._removeBrowserErrorCapture = null;
        };
        return true;
    }

    uninstallBrowserErrorCapture() {
        this._removeBrowserErrorCapture?.();
    }

    _shouldThrottle(fingerprint, nowMs = Date.now()) {
        if (!fingerprint) {
            return false;
        }
        const previous = this.errorThrottle.get(fingerprint);
        const now = Number(nowMs);
        if (previous && now - previous.lastSeenAt < this.config.errorThrottleMs) {
            previous.count += 1;
            previous.lastSeenAt = now;
            this.errorThrottle.set(fingerprint, previous);
            return true;
        }
        this.errorThrottle.set(fingerprint, { firstSeenAt: now, lastSeenAt: now, count: 1 });
        return false;
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
        this.errorThrottle.clear();
        this.transitionState.clear();
        this.rateLimitState.clear();
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

export function captureInitializationFailure(error, properties = {}) {
    const client = getBrowserTelemetry();
    if (!client) {
        return null;
    }
    return client.captureInitializationFailure(error, properties);
}

export function captureSocketConnectError(error, properties = {}) {
    const client = getBrowserTelemetry();
    if (!client) {
        return null;
    }
    return client.captureSocketConnectError(error, properties);
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
    client.installBrowserErrorCapture({
        phase: options.phase || 'runtime',
    });
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow) {
        runtimeWindow.__JJ_CAPTURE_INIT_FAILURE__ = (error, properties = {}) =>
            client.captureInitializationFailure(error, properties);
    }
    return client;
}

export function resetBrowserTelemetryForTests() {
    browserTelemetryClient?.uninstallBrowserErrorCapture?.();
    browserTelemetryClient = null;
    const runtimeWindow = getRuntimeWindow();
    if (runtimeWindow?.__JJ_TELEMETRY__) {
        delete runtimeWindow.__JJ_TELEMETRY__;
    }
    if (runtimeWindow?.__JJ_CAPTURE_INIT_FAILURE__) {
        delete runtimeWindow.__JJ_CAPTURE_INIT_FAILURE__;
    }
    if (runtimeWindow?.__JJ_TELEMETRY_CONFIG__) {
        delete runtimeWindow.__JJ_TELEMETRY_CONFIG__;
    }
}
