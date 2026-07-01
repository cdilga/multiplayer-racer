export {
    ALLOWED_EVENT_NAMES,
    DEFAULT_PROJECT,
    MAX_PROPERTY_VALUE_LENGTH,
    MAX_PROPERTY_DEPTH,
    TelemetryService,
    normalizeTelemetryEnv,
    serviceForRole
} from './TelemetryService.js';

export {
    TelemetryClient,
    bootstrapPageTelemetry,
    getBrowserTelemetry,
    initBrowserTelemetry,
    resetBrowserTelemetryForTests,
    resolveTelemetryConfig,
    setTelemetryContextFromPayload
} from './TelemetryClient.js';
