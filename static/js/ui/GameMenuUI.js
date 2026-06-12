/**
 * GameMenuUI - Always-available host menu (☰)
 *
 * Gives the host a way out when a game gets stuck: restart the current
 * mode, return to the lobby, or reset all cars - plus a short help section.
 *
 * Usage:
 *   const menu = new GameMenuUI({ eventBus });
 *   menu.init();
 *   menu.setOnRestart(() => ...);
 *   menu.setOnBackToLobby(() => ...);
 *   menu.setOnResetCars(() => ...);
 */

class GameMenuUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;

        this.elements = {
            button: null,
            panel: null
        };

        this.onRestart = null;
        this.onBackToLobby = null;
        this.onResetCars = null;

        this.visible = false;
        this.initialized = false;
    }

    /**
     * Initialize menu UI
     */
    init() {
        if (this.initialized) return;

        this._injectStyles();
        this._createElements();

        this.initialized = true;
    }

    setOnRestart(callback) { this.onRestart = callback; }
    setOnBackToLobby(callback) { this.onBackToLobby = callback; }
    setOnResetCars(callback) { this.onResetCars = callback; }

    /**
     * Create menu button and panel
     * @private
     */
    _createElements() {
        const button = document.createElement('button');
        button.id = 'game-menu-btn';
        button.textContent = '☰ Menu';
        button.addEventListener('click', () => this.toggle());
        this.container.appendChild(button);
        this.elements.button = button;

        const panel = document.createElement('div');
        panel.id = 'game-menu-panel';
        panel.classList.add('hidden');
        panel.innerHTML = `
            <div class="game-menu-title">Game Menu</div>
            <button class="game-menu-action" data-action="restart">🔄 Restart Game</button>
            <button class="game-menu-action" data-action="lobby">🚪 Back to Lobby</button>
            <button class="game-menu-action" data-action="reset-cars">🚗 Reset All Cars</button>
            <div class="game-menu-help">
                <div class="game-menu-help-title">Help</div>
                <div>Players join by scanning the QR code.</div>
                <div>Flipped cars auto-recover after a few seconds.</div>
                <div class="game-menu-shortcuts">
                    <div><b>D</b> debug info</div>
                    <div><b>F2</b> physics tuning</div>
                    <div><b>F3</b> stats</div>
                    <div><b>F4</b> physics debug</div>
                </div>
            </div>
            <button class="game-menu-action game-menu-close" data-action="close">Close</button>
        `;
        panel.addEventListener('click', (e) => {
            const action = e.target?.dataset?.action;
            if (!action) return;

            if (action === 'restart') {
                this.onRestart?.();
                this.hide();
            } else if (action === 'lobby') {
                this.onBackToLobby?.();
                this.hide();
            } else if (action === 'reset-cars') {
                this.onResetCars?.();
                this.hide();
            } else if (action === 'close') {
                this.hide();
            }
        });
        this.container.appendChild(panel);
        this.elements.panel = panel;
    }

    /**
     * Inject styles
     * @private
     */
    _injectStyles() {
        if (document.getElementById('game-menu-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'game-menu-ui-styles';
        style.textContent = `
            #game-menu-btn {
                position: fixed;
                top: 10px;
                left: 10px;
                z-index: 900;
                background: rgba(0, 0, 0, 0.5);
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 5px;
                padding: 8px 15px;
                font-size: 14px;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.3s;
            }
            #game-menu-btn:hover {
                opacity: 1;
            }
            #game-menu-panel {
                position: fixed;
                top: 50px;
                left: 10px;
                z-index: 901;
                background: rgba(10, 10, 25, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                padding: 15px;
                min-width: 220px;
                color: white;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            #game-menu-panel.hidden {
                display: none;
            }
            .game-menu-title {
                font-weight: bold;
                color: #00ff88;
                margin-bottom: 5px;
            }
            .game-menu-action {
                background: #16213e;
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 5px;
                padding: 10px;
                font-size: 14px;
                cursor: pointer;
                text-align: left;
            }
            .game-menu-action:hover {
                background: #1f2b52;
            }
            .game-menu-close {
                text-align: center;
                background: #333;
            }
            .game-menu-help {
                font-size: 12px;
                color: #aaa;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 8px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .game-menu-help-title {
                font-weight: bold;
                color: #888;
            }
            .game-menu-shortcuts {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 2px;
                margin-top: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    toggle() {
        this.visible ? this.hide() : this.show();
    }

    show() {
        this.visible = true;
        this.elements.panel?.classList.remove('hidden');
    }

    hide() {
        this.visible = false;
        this.elements.panel?.classList.add('hidden');
    }

    /**
     * Destroy menu UI
     */
    destroy() {
        this.elements.button?.remove();
        this.elements.panel?.remove();
        this.elements = { button: null, panel: null };
        this.initialized = false;
    }
}

// Export for ES Modules
export { GameMenuUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.GameMenuUI = GameMenuUI;
}
