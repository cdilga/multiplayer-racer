const ALLOWED_EVENT_NAMES = new Set([
    'gameplay:match:started',
    'gameplay:match:ended',
    'gameplay:player:joined',
    'gameplay:player:left',
    'gameplay:race:lap_completed',
    'gameplay:race:finished',
    'gameplay:derby:elimination',
    'gameplay:weapon:fired',
    'gameplay:spawn:respawn',
    'error:gameplay:crash',
    'error:network:disconnect',
    'error:network:reconnect',
    'server:room:created',
    'server:room:closed',
    'server:spawn:validation_failed',
    'error:server:crash',
    'perf:render:frame_sample',
    'perf:physics:step_sample',
    'perf:network:latency_sample',
    'perf:server:request_sample'
]);

const REDACTED_VALUE = '[redacted]';

const SENSITIVE_KEY_PATTERNS = [
    /display[_-]?name/i,
    /player[_-]?name/i,
    /nick[_-]?name/i,
    /^player\d+$/i,
    /room[_-]?code/i,
    /join[_-]?code/i,
    /(^|[_-])query$/i,
    /(^|[_-])(url|href|referrer|location)$/i,
    /(^|[_-])(api[_-]?key|auth[_-]?key|access[_-]?key|private[_-]?key)$/i,
    /token|secret|password/i,
    /socket[._-]?id/i,
    /(^|[_-])(client[_-]?ip|ip[_-]?address|remote[_-]?addr)$/i
];

const SENSITIVE_VALUE_PATTERNS = [
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
    /(?:^|[?&])(room|code|token|secret|password|api[_-]?key)=/i,
    /^https?:\/\/\S+\?\S+=\S+/i,
    /\bBearer\s+[A-Za-z0-9._-]+/i
];

const MAX_PROPERTY_VALUE_LENGTH = 500;
const MAX_PROPERTY_DEPTH = 2;
const DEFAULT_PROJECT = 'joystick-jammers';
const ROLE_SERVICE_MAP = Object.freeze({
    host: 'host-client',
    controller: 'controller-client',
    server: 'game-server'
});

function serviceForRole(role) {
    return ROLE_SERVICE_MAP[role] || 'unknown';
}

function normalizeTelemetryEnv(env) {
    const value = String(env || '').trim().toLowerCase();
    if (value === 'prod' || value === 'production') return 'prod';
    if (value === 'staging') return 'staging';
    return 'local';
}

class TelemetryService {
    constructor(config = {}) {
        this.enabled = config.enabled ?? false;
        this.debug = config.debug ?? false;
        this.endpoint = config.endpoint ?? null;
        this.release = config.release ?? 'unknown';
        this.role = config.role ?? 'unknown';
        this.source = config.source ?? 'unknown';
        this.project = config.project ?? DEFAULT_PROJECT;
        this.service = config.service ?? serviceForRole(this.role);
        this.env = normalizeTelemetryEnv(config.env ?? 'local');
        this.queue = [];
        this.noOpSink = this._createNoOpSink();
    }

    static create(config) {
        return new TelemetryService(config);
    }

    _createNoOpSink() {
        return {
            emit: () => {},
            setRoomAnalyticsId: () => {},
            setMatchId: () => {},
            setPlayerAnalyticsId: () => {},
            flush: async () => { return { sent: 0, failed: 0 }; }
        };
    }

    setRoomAnalyticsId(id) {
        if (!this.enabled) return;
        this.roomAnalyticsId = id;
    }

    setMatchId(id) {
        if (!this.enabled) return;
        this.matchId = id;
    }

    setPlayerAnalyticsId(id) {
        if (!this.enabled) return;
        this.playerAnalyticsId = id;
    }

    _validateEventName(name) {
        if (!ALLOWED_EVENT_NAMES.has(name)) {
            const err = new Error(`Event name not allowlisted: ${name}`);
            err.code = 'INVALID_EVENT_NAME';
            throw err;
        }
    }

    _validateRequiredFields(event) {
        const required = ['eventName', 'timestamp', 'release', 'roomAnalyticsId', 'matchId', 'playerAnalyticsId', 'project', 'service', 'env', 'role', 'source'];
        for (const field of required) {
            const value = event[field];
            if (value === undefined || value === null || value === '') {
                const err = new Error(`Missing required field: ${field}`);
                err.code = 'MISSING_FIELD';
                throw err;
            }
        }
    }

    _validateProperties(props) {
        if (!props) return;
        if (typeof props !== 'object' || Array.isArray(props)) {
            const err = new Error('Properties must be an object');
            err.code = 'INVALID_PROPERTIES';
            throw err;
        }

        const check = (obj, depth = 1) => {
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'string' && value.length > MAX_PROPERTY_VALUE_LENGTH) {
                    const err = new Error(`Property value exceeds ${MAX_PROPERTY_VALUE_LENGTH} chars: ${key}`);
                    err.code = 'PROPERTY_VALUE_TOO_LONG';
                    throw err;
                }
                if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
                    const err = new Error(`Property value must be string, number, boolean, or null: ${key}`);
                    err.code = 'INVALID_PROPERTY_VALUE';
                    throw err;
                }
            }
        };

        check(props, 1);
    }

    _shouldRedactKey(key) {
        return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    }

    _shouldRedactValue(value) {
        return typeof value === 'string' && SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
    }

    _sanitizeProperties(properties = {}) {
        const sanitized = {};
        for (const [key, value] of Object.entries(properties)) {
            if (this._shouldRedactKey(key) || this._shouldRedactValue(value)) {
                sanitized[key] = REDACTED_VALUE;
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    _sanitize(event) {
        const sanitized = { ...event };
        if (sanitized.properties) {
            sanitized.properties = this._sanitizeProperties(sanitized.properties);
        }
        return sanitized;
    }

    emit(eventName, properties = {}) {
        if (!this.enabled) return;

        try {
            this._validateEventName(eventName);

            const event = {
                eventName,
                timestamp: Date.now(),
                release: this.release,
                roomAnalyticsId: this.roomAnalyticsId,
                matchId: this.matchId,
                playerAnalyticsId: this.playerAnalyticsId,
                project: this.project,
                service: this.service,
                env: this.env,
                role: this.role,
                source: this.source,
                properties
            };

            this._validateRequiredFields(event);
            this._validateProperties(properties);

            const sanitized = this._sanitize(event);

            if (this.debug) {
                console.log('[TELEMETRY]', JSON.stringify(sanitized));
            }

            this.queue.push(sanitized);
        } catch (err) {
            if (this.debug) {
                console.error('[TELEMETRY ERROR]', err.message, err.code);
            }
            throw err;
        }
    }

    async flush() {
        if (!this.enabled || this.queue.length === 0) {
            return { sent: 0, failed: 0 };
        }

        const batch = this.queue.splice(0, this.queue.length);

        if (this.debug) {
            console.log(`[TELEMETRY] Flushing ${batch.length} events`);
        }

        if (!this.endpoint) {
            return { sent: batch.length, failed: 0 };
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events: batch })
            });

            if (!response.ok) {
                return { sent: 0, failed: batch.length };
            }

            return { sent: batch.length, failed: 0 };
        } catch (err) {
            if (this.debug) {
                console.error('[TELEMETRY FLUSH ERROR]', err.message);
            }
            return { sent: 0, failed: batch.length };
        }
    }

    getQueueSize() {
        return this.queue.length;
    }

    clear() {
        this.queue = [];
    }
}

export {
    ALLOWED_EVENT_NAMES,
    DEFAULT_PROJECT,
    MAX_PROPERTY_VALUE_LENGTH,
    MAX_PROPERTY_DEPTH,
    TelemetryService,
    normalizeTelemetryEnv,
    serviceForRole
};
