const REMAP_STORAGE_KEY = 'jj_control_remaps_v1';
const DEVICE_TOKEN_STORAGE_KEY = 'jj_control_device_token_v1';

function cloneObject(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => cloneObject(entry));
    }

    const next = {};
    for (const [key, entry] of Object.entries(value)) {
        next[key] = cloneObject(entry);
    }
    return next;
}

function createDeviceToken() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `jj-device-${Date.now().toString(36)}-${randomPart}`;
}

function normalizeSourceId(sourceId) {
    if (typeof sourceId === 'string' && sourceId.trim()) {
        return sourceId.trim();
    }
    return 'primary';
}

function buildSourceKey(kind, sourceId) {
    return `${kind}:${normalizeSourceId(sourceId)}`;
}

class RemapStore {
    constructor(options = {}) {
        this.storageKey = options.storageKey || REMAP_STORAGE_KEY;
        this.deviceTokenKey = options.deviceTokenKey || DEVICE_TOKEN_STORAGE_KEY;
        this.storage = options.storage || (typeof window !== 'undefined' ? window.localStorage : null);
        this._memoryState = null;
        this._deviceToken = null;
    }

    _readStorage(key) {
        try {
            return this.storage?.getItem?.(key) ?? null;
        } catch (e) {
            return null;
        }
    }

    _writeStorage(key, value) {
        try {
            this.storage?.setItem?.(key, value);
            return true;
        } catch (e) {
            return false;
        }
    }

    _removeStorage(key) {
        try {
            this.storage?.removeItem?.(key);
            return true;
        } catch (e) {
            return false;
        }
    }

    getDeviceToken() {
        if (this._deviceToken) {
            return this._deviceToken;
        }

        const existing = this._readStorage(this.deviceTokenKey);
        if (existing) {
            this._deviceToken = existing;
            return existing;
        }

        const nextToken = createDeviceToken();
        if (!this._writeStorage(this.deviceTokenKey, nextToken)) {
            // localStorage unavailable: stay session-local in memory only.
            this._memoryState ??= this._defaultState(nextToken);
        }
        this._deviceToken = nextToken;
        return nextToken;
    }

    _defaultState(deviceToken = this.getDeviceToken()) {
        return {
            version: 1,
            deviceToken,
            sources: {}
        };
    }

    _loadState() {
        if (this._memoryState) {
            return cloneObject(this._memoryState);
        }

        const raw = this._readStorage(this.storageKey);
        if (!raw) {
            return this._defaultState();
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return this._defaultState();
            }

            return {
                version: 1,
                deviceToken: typeof parsed.deviceToken === 'string'
                    ? parsed.deviceToken
                    : this.getDeviceToken(),
                sources: parsed.sources && typeof parsed.sources === 'object'
                    ? cloneObject(parsed.sources)
                    : {}
            };
        } catch (e) {
            return this._defaultState();
        }
    }

    _saveState(nextState) {
        const cloned = cloneObject(nextState);
        this._memoryState = cloned;
        const persisted = this._writeStorage(this.storageKey, JSON.stringify(cloned));
        if (persisted) {
            this._memoryState = null;
        }
    }

    exportState() {
        return cloneObject(this._loadState());
    }

    getSource(kind, sourceId = 'primary') {
        const state = this._loadState();
        return cloneObject(state.sources[buildSourceKey(kind, sourceId)] || null);
    }

    setSource(entry) {
        const kind = entry?.kind;
        if (typeof kind !== 'string' || !kind.trim()) {
            throw new Error('RemapStore.setSource requires a non-empty kind.');
        }

        const sourceId = normalizeSourceId(entry.sourceId);
        const state = this._loadState();
        const sourceKey = buildSourceKey(kind, sourceId);
        state.sources[sourceKey] = {
            kind,
            sourceId,
            schemeId: typeof entry.schemeId === 'string' ? entry.schemeId : 'default',
            summary: typeof entry.summary === 'string' ? entry.summary : '',
            bindings: cloneObject(entry.bindings || {}),
            updatedAt: new Date().toISOString()
        };
        this._saveState(state);
        return cloneObject(state.sources[sourceKey]);
    }

    removeSource(kind, sourceId = 'primary') {
        const state = this._loadState();
        delete state.sources[buildSourceKey(kind, sourceId)];
        this._saveState(state);
    }

    reset() {
        this._memoryState = null;
        this._removeStorage(this.storageKey);
    }
}

export {
    RemapStore,
    REMAP_STORAGE_KEY,
    DEVICE_TOKEN_STORAGE_KEY,
    buildSourceKey
};
