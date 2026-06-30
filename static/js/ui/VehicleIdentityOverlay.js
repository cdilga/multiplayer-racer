import {
    buildMarkerIdentity,
    clampMarkerPosition,
    computeHighlightState,
    computeMarkerPresentation,
    computeMarkerPriority,
    estimateMarkerRect,
    rectsOverlap,
    resolveSafeArea
} from './vehicleIdentityMath.js';

const STYLE_ID = 'vehicle-identity-overlay-styles';
const PULSE_DURATION_MS = 1800;
const SAFE_ZONE_CACHE_MS = 120;

class VehicleIdentityOverlay {
    constructor(options = {}) {
        this.gameHost = options.gameHost || null;
        this.eventBus = options.eventBus || this.gameHost?.eventBus || null;
        this.renderSystem = options.renderSystem || this.gameHost?.systems?.render || null;
        this.overlayContainer = options.overlayContainer || this.renderSystem?.overlayContainer || null;

        this.markers = new Map();
        this.pulseUntilByPlayerId = new Map();
        this.viewerPlayerId = null;
        this.initialized = false;
        this.unsubscribeFns = [];
        this.safeAreaCache = {
            atMs: 0,
            area: null
        };

        this._boundUpdate = this._boundUpdate.bind(this);
        this._boundPlayerJoined = this._boundPlayerJoined.bind(this);
        this._boundPlayerLeft = this._boundPlayerLeft.bind(this);
        this._boundRespawn = this._boundRespawn.bind(this);
        this._boundCountdown = this._boundCountdown.bind(this);
    }

    init() {
        if (this.initialized || !this.eventBus || !this.renderSystem?.camera || !this.overlayContainer) {
            return false;
        }

        this._injectStyles();
        this._stripLegacyNameTags();

        this.unsubscribeFns.push(this.eventBus.on('loop:render', this._boundUpdate));
        this.unsubscribeFns.push(this.eventBus.on('network:playerJoined', this._boundPlayerJoined));
        this.unsubscribeFns.push(this.eventBus.on('network:playerLeft', this._boundPlayerLeft));
        this.unsubscribeFns.push(this.eventBus.on('damage:respawn', this._boundRespawn));
        this.unsubscribeFns.push(this.eventBus.on('game:countdown', this._boundCountdown));

        this.initialized = true;
        this.update();
        return true;
    }

    destroy() {
        this.unsubscribeFns.forEach((unsubscribe) => unsubscribe?.());
        this.unsubscribeFns = [];

        for (const marker of this.markers.values()) {
            marker.root.remove();
        }
        this.markers.clear();
        this.initialized = false;
    }

    setViewerPlayerId(playerId) {
        this.viewerPlayerId = playerId == null ? null : String(playerId);
    }

    pulsePlayer(playerId, reason = 'highlight', durationMs = PULSE_DURATION_MS) {
        if (playerId == null) return;
        const key = String(playerId);
        const now = performance.now();
        const nextUntil = now + Math.max(250, durationMs);
        this.pulseUntilByPlayerId.set(key, Math.max(nextUntil, this.pulseUntilByPlayerId.get(key) || 0));

        const marker = this.markers.get(key);
        if (marker) {
            marker.root.dataset.lastPulseReason = reason;
        }
    }

    pulseAll(reason = 'highlight', durationMs = PULSE_DURATION_MS) {
        for (const vehicle of this._getVehicles()) {
            this.pulsePlayer(vehicle.playerId, reason, durationMs);
        }
    }

    update() {
        if (!this.initialized) return;

        this._stripLegacyNameTags();

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const safeArea = this._getSafeArea(viewportWidth, viewportHeight);
        const nowMs = performance.now();
        const focusTarget = this.renderSystem.getCameraFocusTarget?.() || null;
        const focusPlayerId = focusTarget?.playerId != null ? String(focusTarget.playerId) : null;
        const focusInfo = this.renderSystem.getCameraModeInfo?.() || { mode: 'party' };
        const isFocusedMode = focusInfo.mode !== 'party';
        const preferredPlayerId = this.viewerPlayerId || (
            isFocusedMode ? focusPlayerId : null
        );

        const staged = [];
        const liveIds = new Set();
        const vector = new window.THREE.Vector3();

        for (const vehicle of this._getVehicles()) {
            const playerId = String(vehicle.playerId ?? vehicle.id ?? '');
            liveIds.add(playerId);

            if (!vehicle.mesh || vehicle.mesh.visible === false) {
                this._hideMarker(playerId);
                continue;
            }

            vector.setFromMatrixPosition(vehicle.mesh.matrixWorld);
            vector.y += 2.8;
            vector.project(this.renderSystem.camera);

            if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
                this._hideMarker(playerId);
                continue;
            }

            const isDepthClamped = vector.z > 1 || vector.z < -1;
            if (isDepthClamped && !isFocusedMode) {
                this._hideMarker(playerId);
                continue;
            }

            const normalizedX = Math.max(-2.5, Math.min(2.5, vector.x));
            const normalizedY = Math.max(-2.5, Math.min(2.5, vector.y));
            const screenX = (normalizedX * viewportWidth / 2) + (viewportWidth / 2);
            const screenY = -(normalizedY * viewportHeight / 2) + (viewportHeight / 2);
            const distance = this.renderSystem.camera.position.distanceTo(vehicle.mesh.position);
            const isViewerOwned = preferredPlayerId != null && preferredPlayerId === playerId && this.viewerPlayerId != null;
            const isPreferred = preferredPlayerId != null && preferredPlayerId === playerId;
            const isEdgeClamped = isDepthClamped || Math.abs(vector.x) > 1 || Math.abs(vector.y) > 1;

            const marker = this._ensureMarker(vehicle);
            const identity = buildMarkerIdentity({
                playerId: vehicle.playerId,
                playerName: vehicle.playerName,
                color: vehicle.color
            });
            const pulseUntilMs = this.pulseUntilByPlayerId.get(playerId) || 0;
            const pulse = computeHighlightState({
                nowMs,
                pulseUntilMs,
                pulseDurationMs: PULSE_DURATION_MS
            });
            const presentation = computeMarkerPresentation({
                distance,
                viewportHeight,
                isPreferred,
                isViewerOwned,
                isPulsing: pulse.active
            });
            const estimate = estimateMarkerRect({
                x: screenX,
                y: screenY - presentation.liftPx,
                scale: presentation.scale,
                nameText: identity.nameText,
                numberText: identity.numberText,
                includeYouLabel: isViewerOwned
            });
            const clamped = clampMarkerPosition({
                x: screenX,
                y: screenY - presentation.liftPx,
                viewportWidth,
                viewportHeight,
                safeLeft: safeArea.safeLeft,
                safeRight: safeArea.safeRight,
                safeTop: safeArea.safeTop,
                safeBottom: safeArea.safeBottom,
                estimatedWidth: estimate.width,
                estimatedHeight: estimate.height
            });
            const clampedRect = estimateMarkerRect({
                x: clamped.x,
                y: clamped.y,
                scale: presentation.scale,
                nameText: identity.nameText,
                numberText: identity.numberText,
                includeYouLabel: isViewerOwned
            });

            staged.push({
                playerId,
                vehicle,
                marker,
                identity,
                distance,
                isViewerOwned,
                isPreferred,
                pulse,
                presentation,
                x: clamped.x,
                y: clamped.y,
                rect: clampedRect,
                isEdgeClamped,
                priority: computeMarkerPriority({
                    isPreferred,
                    isViewerOwned,
                    isPulsing: pulse.active,
                    distance
                })
            });
        }

        this._pruneMissingMarkers(liveIds);

        staged.sort((a, b) => b.priority - a.priority);
        const placed = [];

        for (const entry of staged) {
            const overlaps = placed.some((rect) => rectsOverlap(rect, entry.rect));
            const canForce = entry.isPreferred || entry.pulse.active || isFocusedMode;
            if (overlaps && !canForce) {
                this._hideMarker(entry.playerId);
                continue;
            }

            placed.push(entry.rect);
            this._applyMarker(entry, preferredPlayerId);
        }
    }

    getDebugSnapshot() {
        const markers = [];
        for (const [playerId, marker] of this.markers) {
            const rect = marker.root.getBoundingClientRect();
            const hidden = marker.root.style.display === 'none';
            markers.push({
                playerId,
                visible: !hidden,
                preferred: marker.root.classList.contains('is-preferred'),
                viewerOwned: marker.root.classList.contains('is-viewer-owned'),
                pulsing: marker.root.classList.contains('is-pulsing'),
                numberText: marker.number.textContent,
                nameText: marker.name.textContent,
                rect: hidden ? null : {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height
                }
            });
        }

        return {
            markerCount: markers.length,
            visibleCount: markers.filter((marker) => marker.visible).length,
            preferredPlayerId: this.viewerPlayerId,
            markers
        };
    }

    _boundUpdate() {
        this.update();
    }

    _boundPlayerJoined(data) {
        this.pulsePlayer(data?.id ?? data?.playerId, 'join');
    }

    _boundPlayerLeft(data) {
        this._removeMarker(data?.playerId ?? data?.id);
    }

    _boundRespawn(data) {
        this.pulsePlayer(data?.playerId ?? data?.vehicleId, 'respawn');
    }

    _boundCountdown() {
        this.pulseAll('start', 2200);
    }

    _getVehicles() {
        if (!this.gameHost?.vehicles?.values) return [];
        return Array.from(this.gameHost.vehicles.values());
    }

    _ensureMarker(vehicle) {
        const playerId = String(vehicle.playerId ?? vehicle.id);
        const existing = this.markers.get(playerId);
        if (existing) return existing;

        const root = document.createElement('div');
        root.className = 'vehicle-id-marker';
        root.dataset.playerId = playerId;

        const chevron = document.createElement('div');
        chevron.className = 'vehicle-id-chevron';

        const badge = document.createElement('div');
        badge.className = 'vehicle-id-badge';

        const you = document.createElement('span');
        you.className = 'vehicle-id-you';
        you.textContent = 'YOU';

        const number = document.createElement('span');
        number.className = 'vehicle-id-number';

        const name = document.createElement('span');
        name.className = 'vehicle-id-name';

        badge.appendChild(you);
        badge.appendChild(number);
        badge.appendChild(name);
        root.appendChild(chevron);
        root.appendChild(badge);
        this.overlayContainer.appendChild(root);

        const marker = { root, chevron, badge, you, number, name, vehicle };
        this.markers.set(playerId, marker);
        return marker;
    }

    _removeMarker(playerId) {
        const key = playerId == null ? null : String(playerId);
        if (!key) return;

        const marker = this.markers.get(key);
        if (marker) {
            marker.root.remove();
            this.markers.delete(key);
        }
        this.pulseUntilByPlayerId.delete(key);
    }

    _hideMarker(playerId) {
        const marker = this.markers.get(String(playerId));
        if (marker) {
            marker.root.style.display = 'none';
        }
    }

    _pruneMissingMarkers(liveIds) {
        for (const playerId of this.markers.keys()) {
            if (!liveIds.has(playerId)) {
                this._removeMarker(playerId);
            }
        }
    }

    _applyMarker(entry, preferredPlayerId) {
        const {
            playerId,
            marker,
            identity,
            isPreferred,
            isViewerOwned,
            pulse,
            presentation,
            x,
            y,
            isEdgeClamped
        } = entry;

        marker.number.textContent = identity.numberText;
        marker.name.textContent = identity.nameText;
        marker.root.style.setProperty('--vehicle-accent', identity.color);
        marker.root.style.left = `${x}px`;
        marker.root.style.top = `${y}px`;
        marker.root.style.opacity = `${presentation.opacity}`;
        marker.root.style.transform = `translate(-50%, -100%) scale(${presentation.scale})`;
        marker.root.style.display = '';
        marker.root.classList.toggle('is-preferred', isPreferred);
        marker.root.classList.toggle('is-viewer-owned', isViewerOwned);
        marker.root.classList.toggle('is-pulsing', pulse.active);
        marker.root.classList.toggle('is-edge-clamped', !!isEdgeClamped);
        marker.root.dataset.playerId = playerId;
        marker.root.dataset.lastPulseReason = marker.root.dataset.lastPulseReason || '';
        marker.root.dataset.preferredPlayerId = preferredPlayerId || '';
    }

    _getSafeArea(viewportWidth, viewportHeight) {
        const now = performance.now();
        if (this.safeAreaCache.area && (now - this.safeAreaCache.atMs) < SAFE_ZONE_CACHE_MS) {
            return this.safeAreaCache.area;
        }

        const selectors = [
            '#race-timer',
            '.hud-lap',
            '.hud-health-bars',
            '.hud-speed',
            '#camera-controls',
            '.room-code-overlay'
        ];

        const occluders = selectors
            .map((selector) => document.querySelector(selector))
            .filter((element) => element && this._isVisible(element))
            .map((element) => element.getBoundingClientRect());

        const area = resolveSafeArea({
            viewportWidth,
            viewportHeight,
            occluders
        });

        this.safeAreaCache = {
            atMs: now,
            area
        };
        return area;
    }

    _isVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    _stripLegacyNameTags() {
        const nameTags = this.renderSystem?.nameTags;
        if (!nameTags?.size) return;

        for (const [id, tagData] of nameTags.entries()) {
            tagData?.element?.remove?.();
            nameTags.delete(id);
        }
    }

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .vehicle-id-marker {
                --vehicle-accent: #ffffff;
                position: absolute;
                left: 0;
                top: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 6px;
                transform-origin: center bottom;
                pointer-events: none;
                z-index: 11;
                white-space: nowrap;
                will-change: transform, opacity, left, top;
                filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.45));
            }
            .vehicle-id-chevron {
                width: 20px;
                height: 12px;
                background: linear-gradient(180deg, #ffffff 0%, var(--vehicle-accent) 100%);
                clip-path: polygon(50% 100%, 0 0, 100% 0);
                box-shadow: 0 0 14px color-mix(in srgb, var(--vehicle-accent) 70%, transparent);
            }
            .vehicle-id-badge {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                min-height: 28px;
                padding: 6px 10px;
                border-radius: 999px;
                border: 2px solid color-mix(in srgb, var(--vehicle-accent) 88%, #ffffff);
                background: rgba(8, 10, 18, 0.86);
                color: #f5f8ff;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 13px;
                font-weight: 800;
                letter-spacing: 0.01em;
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
            }
            .vehicle-id-you {
                display: none;
                padding: 2px 7px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--vehicle-accent) 75%, #ffffff);
                color: #09111a;
                font-size: 10px;
                letter-spacing: 0.08em;
            }
            .vehicle-id-number {
                min-width: 22px;
                padding: 2px 7px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--vehicle-accent) 20%, #ffffff);
                color: color-mix(in srgb, var(--vehicle-accent) 75%, #ffffff);
                text-align: center;
            }
            .vehicle-id-name {
                max-width: 144px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .vehicle-id-marker.is-preferred .vehicle-id-badge {
                border-color: color-mix(in srgb, var(--vehicle-accent) 92%, #ffffff);
                box-shadow:
                    0 0 0 1px rgba(255, 255, 255, 0.12),
                    0 0 18px color-mix(in srgb, var(--vehicle-accent) 40%, transparent);
            }
            .vehicle-id-marker.is-preferred .vehicle-id-chevron {
                height: 14px;
            }
            .vehicle-id-marker.is-viewer-owned .vehicle-id-you {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .vehicle-id-marker.is-pulsing .vehicle-id-chevron,
            .vehicle-id-marker.is-pulsing .vehicle-id-badge {
                animation: vehicle-id-pulse 0.85s ease-in-out infinite alternate;
            }
            @keyframes vehicle-id-pulse {
                0% {
                    transform: scale(1);
                    filter: brightness(1);
                }
                100% {
                    transform: scale(1.08);
                    filter: brightness(1.16);
                }
            }
        `;
        document.head.appendChild(style);
    }
}

export { VehicleIdentityOverlay };
