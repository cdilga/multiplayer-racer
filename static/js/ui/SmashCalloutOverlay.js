const STYLE_ID = 'smash-callout-overlay-styles';
const DEFAULT_DURATION_MS = 1800;
const DEFAULT_MAX_QUEUE = 3;

function coerceText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function playerLabel(id) {
    const text = coerceText(id);
    return text ? `Player ${text}` : 'Someone';
}

class SmashCalloutOverlay {
    constructor(options = {}) {
        this.document = options.document || (typeof document !== 'undefined' ? document : null);
        this.container = options.container || this.document?.body || null;
        this.eventBus = options.eventBus || null;
        this.gameHost = options.gameHost || null;
        this.durationMs = options.durationMs || DEFAULT_DURATION_MS;
        this.maxQueue = options.maxQueue || DEFAULT_MAX_QUEUE;
        this.timerApi = options.timerApi || (typeof window !== 'undefined' ? window : globalThis);

        this.root = null;
        this.textEl = null;
        this.queue = [];
        this.visible = false;
        this.hideTimer = null;
        this.unsubscribe = null;
        this.lastCallout = null;
        this.eventCount = 0;
    }

    init() {
        if (!this.document || !this.container || this.root) return this;

        this._ensureStyles();
        this.root = this.document.createElement('div');
        this.root.className = 'smash-callout-overlay hidden';
        this.root.setAttribute('aria-live', 'polite');
        this.root.setAttribute('aria-atomic', 'true');
        this.textEl = this.document.createElement('div');
        this.textEl.className = 'smash-callout-text';
        this.root.appendChild(this.textEl);
        this.container.appendChild(this.root);

        if (this.eventBus?.on) {
            this.unsubscribe = this.eventBus.on('damage:destroyed', (event) => this.handleDestroyed(event));
        }
        return this;
    }

    destroy() {
        this._clearHideTimer();
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.root?.remove?.();
        this.root = null;
        this.textEl = null;
        this.queue = [];
        this.visible = false;
    }

    handleDestroyed(event = {}) {
        const callout = this.buildCallout(event);
        this.eventCount += 1;
        this.queue.push(callout);
        if (this.queue.length > this.maxQueue) {
            this.queue.splice(0, this.queue.length - this.maxQueue);
        }
        if (!this.visible) {
            this._showNext();
        }
        return callout;
    }

    buildCallout(event = {}) {
        const victimName = this._resolveName({
            name: event.victimName,
            playerId: event.victimPlayerId ?? event.playerId,
            vehicleId: event.victimVehicleId ?? event.vehicleId
        });
        const attackerId = event.attackerPlayerId ?? event.sourcePlayerId ?? event.source?.sourcePlayerId ?? event.source?.playerId;
        const attackerName = this._resolveName({
            name: event.attackerName ?? event.sourceName ?? event.source?.sourceName,
            playerId: attackerId,
            vehicleId: event.attackerVehicleId ?? event.sourceVehicleId ?? event.source?.sourceVehicleId
        });

        const hasAttacker = attackerId != null || coerceText(event.attackerName ?? event.sourceName ?? event.source?.sourceName);
        const text = hasAttacker
            ? SmashCalloutOverlay.formatWrecked(attackerName, victimName)
            : SmashCalloutOverlay.formatVictimFallback(victimName);

        return {
            text,
            attackerName: hasAttacker ? attackerName : null,
            victimName,
            sourcePlayerId: attackerId ?? null,
            playerId: event.victimPlayerId ?? event.playerId ?? null,
            weaponId: event.sourceWeaponId ?? event.weaponId ?? event.source?.weaponId ?? null
        };
    }

    showCallout(callout) {
        if (!this.root || !this.textEl) return;
        this.lastCallout = { ...callout };
        this.textEl.textContent = callout.text;
        this.root.classList.remove('hidden');
        this.root.dataset.hasAttacker = callout.attackerName ? 'true' : 'false';
        this.visible = true;
        this._clearHideTimer();
        this.hideTimer = this.timerApi.setTimeout?.(() => this._hideCurrent(), this.durationMs) ?? null;
    }

    getDiagnostics() {
        return {
            visible: this.visible,
            queueLength: this.queue.length,
            eventCount: this.eventCount,
            lastCallout: this.lastCallout ? { ...this.lastCallout } : null,
            text: this.textEl?.textContent || ''
        };
    }

    _showNext() {
        const next = this.queue.shift();
        if (next) {
            this.showCallout(next);
        }
    }

    _hideCurrent() {
        this._clearHideTimer();
        this.root?.classList.add('hidden');
        this.visible = false;
        this._showNext();
    }

    _clearHideTimer() {
        if (this.hideTimer != null) {
            this.timerApi.clearTimeout?.(this.hideTimer);
            this.hideTimer = null;
        }
    }

    _resolveName({ name, playerId, vehicleId }) {
        const explicit = coerceText(name);
        if (explicit) return explicit;

        const game = this.gameHost;
        const byPlayer = playerId != null ? game?.vehicles?.get?.(playerId) : null;
        if (byPlayer?.playerName) return coerceText(byPlayer.playerName);

        const networkName = playerId != null ? game?.systems?.network?.players?.get?.(playerId)?.name : null;
        if (networkName) return coerceText(networkName);

        if (vehicleId != null && game?.vehicles?.entries) {
            for (const [candidatePlayerId, vehicle] of game.vehicles.entries()) {
                if (String(vehicle?.id) === String(vehicleId)) {
                    return coerceText(vehicle.playerName, playerLabel(candidatePlayerId));
                }
            }
        }

        return playerLabel(playerId ?? vehicleId);
    }

    _ensureStyles() {
        if (!this.document || this.document.getElementById(STYLE_ID)) return;
        const style = this.document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .smash-callout-overlay {
                position: fixed;
                left: 50%;
                top: max(84px, env(safe-area-inset-top));
                transform: translateX(-50%) rotate(-1deg);
                z-index: 1700;
                pointer-events: none;
                max-width: min(860px, calc(100vw - 48px));
                padding: 14px 22px;
                color: #fff8df;
                background: #2a211a;
                border: 3px solid #14110f;
                border-radius: 4px;
                box-shadow: 5px 5px 0 #14110f;
                text-align: center;
            }
            .smash-callout-overlay.hidden { display: none; }
            .smash-callout-text {
                font-family: var(--font-display, Impact, Arial Black, sans-serif);
                font-size: clamp(1.7rem, 5vw, 4.6rem);
                font-weight: 900;
                line-height: 0.95;
                letter-spacing: 0.03em;
                text-transform: uppercase;
                text-shadow: 3px 3px 0 #14110f;
                overflow-wrap: anywhere;
            }
            .smash-callout-overlay[data-has-attacker="true"] .smash-callout-text {
                color: #ff4f33;
            }
            @media (prefers-reduced-motion: reduce) {
                .smash-callout-overlay {
                    transform: translateX(-50%);
                }
            }
        `;
        this.document.head.appendChild(style);
    }

    static formatWrecked(attacker, victim) {
        return `${coerceText(attacker, 'Someone')} WRECKED ${coerceText(victim, 'Someone')}`;
    }

    static formatVictimFallback(victim) {
        return `${coerceText(victim, 'Someone')} GOT WRECKED`;
    }
}

export { SmashCalloutOverlay };
