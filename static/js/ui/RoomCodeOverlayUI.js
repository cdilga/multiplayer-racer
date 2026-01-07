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
            <img class="overlay-qr" alt="Join QR Code" />
            <div class="overlay-code"></div>
            <div class="overlay-label">Scan to join!</div>
        `;

        // Cache elements
        this.qrImage = this.element.querySelector('.overlay-qr');
        this.codeText = this.element.querySelector('.overlay-code');

        // Add styles
        this._injectStyles();

        // Add to container
        this.container.appendChild(this.element);
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
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                border-radius: 10px;
                padding: 10px;
                text-align: center;
                z-index: 1000;
                transition: all 0.3s ease;
                border: 2px solid #4cc9f0;
            }

            .room-code-overlay.hidden {
                display: none;
            }

            .room-code-overlay.minimized {
                padding: 5px;
            }

            .room-code-overlay .overlay-qr {
                width: 80px;
                height: 80px;
                border-radius: 5px;
                background: white;
                display: block;
                margin: 0 auto 5px;
            }

            .room-code-overlay.minimized .overlay-qr {
                width: 60px;
                height: 60px;
            }

            .room-code-overlay .overlay-code {
                font-size: 1.2rem;
                font-weight: bold;
                color: #4cc9f0;
                letter-spacing: 3px;
                font-family: monospace;
            }

            .room-code-overlay.minimized .overlay-code {
                font-size: 1rem;
            }

            .room-code-overlay .overlay-label {
                font-size: 0.7rem;
                color: #8d99ae;
                margin-top: 3px;
            }

            .room-code-overlay.minimized .overlay-label {
                display: none;
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

        // Show during lobby
        this.eventBus.on('game:lobby', () => {
            this.show();
            this.expand();
        });

        // Minimize during countdown/racing
        this.eventBus.on('game:countdown', () => {
            this.minimize();
        });

        this.eventBus.on('game:racing', () => {
            this.show();
            this.minimize();
        });

        // Hide during results
        this.eventBus.on('game:results', () => {
            this.hide();
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
        this.show();
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
