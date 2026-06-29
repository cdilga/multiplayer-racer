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

const FORBIDDEN_PATTERNS = [
    /\b(Alice|Bob|Charlie|Player\d+)\b/i,
    /room[-_]?code/i,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    /token|secret|key|password/i,
    /socket[._]?id/i
];

const MAX_PROPERTY_VALUE_LENGTH = 500;
const MAX_PROPERTY_DEPTH = 2;

class TelemetryService {
    constructor(config = {}) {
        this.enabled = config.enabled ?? false;
        this.debug = config.debug ?? false;
        this.endpoint = config.endpoint ?? null;
        this.release = config.release ?? 'unknown';
        this.role = config.role ?? 'unknown';
        this.source = config.source ?? 'unknown';
        this.env = config.env ?? 'local';
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
        const required = ['eventName', 'timestamp', 'release', 'roomAnalyticsId', 'matchId', 'playerAnalyticsId', 'env', 'role', 'source'];
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
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    if (depth >= MAX_PROPERTY_DEPTH) {
                        const err = new Error(`Property depth exceeds ${MAX_PROPERTY_DEPTH}`);
                        err.code = 'PROPERTY_DEPTH_EXCEEDED';
                        throw err;
                    }
                    check(value, depth + 1);
                }
            }
        };

        check(props, 1);
    }

    _checkPrivacy(event) {
        const serialized = JSON.stringify(event);
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(serialized)) {
                const err = new Error(`Privacy violation detected: forbidden pattern found`);
                err.code = 'PRIVACY_VIOLATION';
                err.pattern = pattern.toString();
                throw err;
            }
        }
    }

    _sanitize(event) {
        const sanitized = { ...event };
        if (sanitized.properties) {
            sanitized.properties = JSON.parse(JSON.stringify(sanitized.properties));
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
                env: this.env,
                role: this.role,
                source: this.source,
                properties
            };

            this._validateRequiredFields(event);
            this._validateProperties(properties);
            this._checkPrivacy(event);

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

export { TelemetryService, ALLOWED_EVENT_NAMES, MAX_PROPERTY_VALUE_LENGTH, MAX_PROPERTY_DEPTH };
