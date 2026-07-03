/**
 * RoomCodeOverlayUI - Persistent QR code overlay for late joiners
 *
 * Shows a small QR code and room code in the corner during gameplay,
 * allowing players to join races in progress.
 */

class RoomCodeOverlayUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;

        // State
        this.roomCode = '';
        this.minimized = false;
        this.visible = false;
        this.gameState = 'lobby';

        // Elements
        this.element = null;
        this.qrImage = null;
        this.codeText = null;
    }

    /**
     * Initialize the overlay
     */
    init() {
        this._createElements();
        this._subscribeToEvents();
    }

    /**
     * Create DOM elements
     * @private
     */
    _createElements() {
        // Create container
        this.element = document.createElement('div');
        this.element.className = 'room-code-overlay hidden';
        this.element.innerHTML = `
            <img class="overlay-qr" alt="Join QR Code — click to copy join link" title="Click to copy join link" />
            <div class="overlay-code" title="Click to copy join link" role="button" tabindex="0"></div>
            <div class="overlay-label">Scan to join!</div>
            <div class="overlay-copied" aria-live="polite">Copied!</div>
        `;

        // Cache elements
        this.qrImage = this.element.querySelector('.overlay-qr');
        this.codeText = this.element.querySelector('.overlay-code');
        this.copiedFeedback = this.element.querySelector('.overlay-copied');

        // Click-to-copy the join link on both the QR image and the code text (flol).
        this.qrImage?.addEventListener('click', () => this._copyJoinLink());
        this.codeText?.addEventListener('click', () => this._copyJoinLink());
        this.codeText?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._copyJoinLink(); }
        });

        // Cmd/Ctrl+C copies the join link when the overlay is visible and the user
        // has not selected other text (so normal copy still works elsewhere).
        this._boundCopyKey = (e) => {
            if (!(e.key === 'c' || e.key === 'C') || !(e.metaKey || e.ctrlKey)) return;
            if (!this.roomCode || this._isHidden()) return;
            const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
            if (sel && String(sel).length > 0) return; // respect an explicit selection
            e.preventDefault();
            this._copyJoinLink();
        };
        document.addEventListener('keydown', this._boundCopyKey);

        // Add styles
        this._injectStyles();

        // Add to container
        this.container.appendChild(this.element);
    }

    /** @returns {string} the full join URL the QR encodes (origin-based). */
    joinLink() {
        const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
        return `${origin}/join/${this.roomCode}`;
    }

    /** @private */
    _isHidden() {
        return !this.element || this.element.classList.contains('hidden');
    }

    /**
     * Copy the join link to the clipboard and flash 'Copied!' feedback (flol).
     * @private
     */
    async _copyJoinLink() {
        if (!this.roomCode) return;
        const link = this.joinLink();
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(link);
                ok = true;
            }
        } catch (_) { ok = false; }
        if (!ok) {
            // Fallback for browsers without async clipboard: a temporary textarea.
            try {
                const ta = document.createElement('textarea');
                ta.value = link;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand?.('copy');
                document.body.removeChild(ta);
                ok = true;
            } catch (_) { ok = false; }
        }
        if (ok) this._showCopiedFeedback();
    }

    /** @private Flash the 'Copied!' feedback for ~2s. */
    _showCopiedFeedback() {
        if (!this.copiedFeedback) return;
        this.element.classList.add('show-copied');
        clearTimeout(this._copiedTimer);
        this._copiedTimer = setTimeout(() => {
            this.element?.classList.remove('show-copied');
        }, 2000);
    }

    /**
     * Inject CSS styles
     * @private
     */
    _injectStyles() {
        if (document.getElementById('room-code-overlay-styles')) return;

        const style = document.createElement('style');
        style.id = 'room-code-overlay-styles';
        style.textContent = `
            .room-code-overlay {
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: rgba(5, 11, 24, 0.82);
                border-radius: 12px;
                padding: 14px 16px;
                text-align: center;
                z-index: 40;
                transition: all 0.3s ease;
                border: 1px solid rgba(76, 201, 240, 0.55);
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
                opacity: 0.78;
            }

            .room-code-overlay:hover {
                opacity: 1;
            }

            .room-code-overlay.hidden {
                display: none;
            }

            .room-code-overlay.minimized {
                padding: 10px 12px;
                border-radius: 10px;
                opacity: 0.72;
            }

            .room-code-overlay.minimized:hover {
                opacity: 1;
            }

            .room-code-overlay .overlay-qr {
                width: 108px;
                height: 108px;
                border-radius: 8px;
                background: white;
                display: block;
                margin: 0 auto 8px;
                cursor: pointer;
            }

            .room-code-overlay .overlay-code {
                cursor: pointer;
            }

            .room-code-overlay .overlay-copied {
                position: absolute;
                left: 50%;
                bottom: 8px;
                transform: translateX(-50%);
                background: #14110f;
                color: #C9BBA0;
                border: 2px solid #C9BBA0;
                border-radius: 6px;
                padding: 3px 10px;
                font-weight: 700;
                font-size: 13px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 90ms ease-out;
            }

            .room-code-overlay.show-copied .overlay-copied {
                opacity: 1;
            }

            .room-code-overlay.minimized .overlay-qr {
                width: 72px;
                height: 72px;
                margin-bottom: 6px;
            }

            .room-code-overlay .overlay-code {
                font-size: 1.1rem;
                font-weight: bold;
                color: #4cc9f0;
                letter-spacing: 0.18em;
                font-family: var(--font-mono, monospace);
            }

            .room-code-overlay.minimized .overlay-code {
                font-size: 0.95rem;
            }

            .room-code-overlay .overlay-label {
                font-size: 0.8rem;
                color: #8d99ae;
                margin-top: 5px;
            }

            .room-code-overlay.minimized .overlay-label {
                font-size: 0.68rem;
                color: #6d7a8e;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Subscribe to game events
     * @private
     */
    _subscribeToEvents() {
        if (!this.eventBus) return;

        this.eventBus.on('game:lobby', () => {
            this._setGameState('lobby');
        });

        this.eventBus.on('game:countdown', () => {
            this._setGameState('countdown');
        });

        this.eventBus.on('game:racing', () => {
            this._setGameState('racing');
        });

        this.eventBus.on('game:results', () => {
            this._setGameState('results');
        });
    }

    /**
     * Set room code and update QR
     * @param {string} code
     */
    setRoomCode(code) {
        this.roomCode = code;
        if (this.codeText) {
            this.codeText.textContent = code;
        }
        if (this.qrImage) {
            this.qrImage.src = `/qrcode/${code}`;
        }
        this._syncPresentation();
    }

    /**
     * Track the host game state so the overlay only appears in active play.
     * @private
     * @param {string} state
     */
    _setGameState(state) {
        this.gameState = state;
        this._syncPresentation();
    }

    /**
     * Apply the overlay state machine:
     * lobby/results => hidden, countdown/racing => visible + minimized.
     * @private
     */
    _syncPresentation() {
        const shouldShow = this.roomCode && (
            this.gameState === 'countdown' ||
            this.gameState === 'racing'
        );

        if (!shouldShow) {
            this.expand();
            this.hide();
            return;
        }

        this.show();
        this.minimize();
    }

    /**
     * Show the overlay
     */
    show() {
        if (!this.roomCode) return;
        this.visible = true;
        if (this.element) {
            this.element.classList.remove('hidden');
        }
    }

    /**
     * Hide the overlay
     */
    hide() {
        this.visible = false;
        if (this.element) {
            this.element.classList.add('hidden');
        }
    }

    /**
     * Minimize to small corner display
     */
    minimize() {
        this.minimized = true;
        if (this.element) {
            this.element.classList.add('minimized');
        }
    }

    /**
     * Expand to full display
     */
    expand() {
        this.minimized = false;
        if (this.element) {
            this.element.classList.remove('minimized');
        }
    }

    /**
     * Cleanup
     */
    dispose() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

// Export for ES Modules
export { RoomCodeOverlayUI };
