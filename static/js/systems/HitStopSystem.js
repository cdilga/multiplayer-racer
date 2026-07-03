import { HitStopController } from './HitStopController.js';

const DEFAULT_DAMAGE_TO_SEVERITY = 40;

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function uniqueIds(ids = []) {
    return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
}

class HitStopSystem {
    constructor(options = {}) {
        this.eventBus = options.eventBus || (typeof window !== 'undefined' ? window.eventBus : null);
        this.renderSystem = options.renderSystem || null;
        this.controller = options.controller || new HitStopController(options.controllerConfig || {});
        this.damageToSeverity = options.damageToSeverity || DEFAULT_DAMAGE_TO_SEVERITY;
        this.initialized = false;
        this._unsubscribers = [];
        this._heldVehicleIds = new Set();
        this._lastAppliedFrame = null;
        this.diagnostics = {
            registeredImpacts: [],
            timeline: [],
            physicsTimeScale: 1,
            heldVehicleIds: [],
            cameraPunchFrames: 0,
            meshHoldFrames: 0
        };
    }

    async init() {
        if (this.initialized) return;
        this._subscribe('damage:vehicleCollision', (data) => this._registerCollision(data));
        this._subscribe('damage:barrierCollision', (data) => this._registerBarrier(data));
        this._subscribe('damage:destroyed', (data) => this._registerDestroyed(data));
        this._subscribe('weapon:hit', (data) => this._registerWeaponHit(data));
        this._subscribe('weapon:explosion', (data) => this._registerExplosion(data));
        this.initialized = true;
    }

    setRenderSystem(renderSystem) {
        this.renderSystem = renderSystem;
    }

    _subscribe(eventName, handler) {
        if (!this.eventBus?.on) return;
        const unsubscribe = this.eventBus.on(eventName, handler);
        if (typeof unsubscribe === 'function') {
            this._unsubscribers.push(unsubscribe);
        }
    }

    _severityFromDamage(damage) {
        return clamp01((Number(damage) || 0) / this.damageToSeverity);
    }

    _registerCollision(data = {}) {
        this.registerImpact({
            source: 'damage:vehicleCollision',
            severity: this._severityFromDamage(data.damage),
            context: data.context || 'shared-race',
            vehicleIds: uniqueIds([data.vehicleA, data.vehicleB])
        });
    }

    _registerBarrier(data = {}) {
        this.registerImpact({
            source: 'damage:barrierCollision',
            severity: this._severityFromDamage(data.damage),
            context: data.context || 'shared-race',
            vehicleIds: uniqueIds([data.vehicleId])
        });
    }

    _registerDestroyed(data = {}) {
        this.registerImpact({
            source: 'damage:destroyed',
            severity: 1,
            context: data.context || 'focused',
            elimination: true,
            vehicleIds: uniqueIds([data.vehicleId])
        });
    }

    _registerWeaponHit(data = {}) {
        this.registerImpact({
            source: 'weapon:hit',
            severity: this._severityFromDamage(data.damage),
            context: data.context || 'shared-race',
            vehicleIds: uniqueIds([data.shooterId, data.targetId])
        });
    }

    _registerExplosion(data = {}) {
        const ids = data.vehicleIds || data.affectedVehicleIds || [];
        this.registerImpact({
            source: 'weapon:explosion',
            severity: clamp01(data.severity ?? 0.8),
            context: data.context || 'shared-race',
            vehicleIds: uniqueIds(ids)
        });
    }

    registerImpact(impact = {}) {
        const vehicleIds = uniqueIds(impact.vehicleIds || []);
        const decision = this.controller.registerImpact(impact);
        const record = {
            source: impact.source || 'manual',
            severity: clamp01(impact.severity),
            context: HitStopController.normalizeContext(impact.context),
            elimination: impact.elimination === true,
            vehicleIds,
            decision,
            physicsTimeScale: this.controller.physicsTimeScale
        };
        this.diagnostics.registeredImpacts.push(record);
        if (this.diagnostics.registeredImpacts.length > 12) {
            this.diagnostics.registeredImpacts.shift();
        }

        if (decision.mode === HitStopController.MODE_NONE) {
            return decision;
        }

        this._heldVehicleIds = decision.mode === HitStopController.MODE_FREEZE
            ? new Set(vehicleIds)
            : new Set();

        if (decision.mode === HitStopController.MODE_CAMERA_PUNCH) {
            this.renderSystem?.triggerHitStopCameraPunch?.({
                frames: decision.frames,
                intensity: decision.intensity,
                source: record.source,
                vehicleIds
            });
            this.diagnostics.cameraPunchFrames += decision.frames;
        }
        if (decision.mode === HitStopController.MODE_FREEZE) {
            this.diagnostics.meshHoldFrames += decision.frames;
        }

        this._syncDiagnostics();
        return decision;
    }

    shouldHoldVehicleMesh(vehicleId) {
        return this.controller.freezesMeshes && this._heldVehicleIds.has(vehicleId);
    }

    tick() {
        const before = this.controller.state;
        const after = this.controller.tick();
        if (!after.active) {
            this._heldVehicleIds.clear();
        }
        this._lastAppliedFrame = {
            before,
            after,
            heldVehicleIds: [...this._heldVehicleIds]
        };
        this.diagnostics.timeline.push(this._lastAppliedFrame);
        if (this.diagnostics.timeline.length > 16) {
            this.diagnostics.timeline.shift();
        }
        this._syncDiagnostics();
        return after;
    }

    _syncDiagnostics() {
        this.diagnostics.physicsTimeScale = this.controller.physicsTimeScale;
        this.diagnostics.heldVehicleIds = [...this._heldVehicleIds];
        this.diagnostics.state = this.controller.state;
        this.diagnostics.render = this.renderSystem?.getHitStopRenderDiagnostics?.() || null;
    }

    getDiagnostics() {
        this._syncDiagnostics();
        return JSON.parse(JSON.stringify(this.diagnostics));
    }

    destroy() {
        for (const unsubscribe of this._unsubscribers) {
            unsubscribe();
        }
        this._unsubscribers = [];
        this._heldVehicleIds.clear();
        this.controller.reset();
        this.initialized = false;
    }
}

export { HitStopSystem };

if (typeof window !== 'undefined') {
    window.HitStopSystem = HitStopSystem;
}
