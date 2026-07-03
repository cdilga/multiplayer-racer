/**
 * Host Entry Point
 *
 * This file bootstraps the host application by:
 * 1. Importing NPM packages (bundled by Vite)
 * 2. Exposing them globally for existing code compatibility
 * 3. Initializing Rapier WASM
 * 4. Loading the GameHost module
 */

// Import from NPM (Vite bundles these)
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { io } from 'socket.io-client';
import { bootstrapPageTelemetry } from '/static/js/telemetry/index.js';
import { GrainOverlay } from '/static/js/ui/GrainOverlay.js';
import { installHostDebugLab } from '/static/js/debug/HostDebugLabAdapter.js';

// Expose globally for existing code compatibility
window.THREE = THREE;
window.io = io;

bootstrapPageTelemetry({
    role: 'host',
    source: 'HostEntry'
});

const urlParams = new URLSearchParams(window.location.search);

// UI elements
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loadingStep = document.getElementById('loading-step');
const loadingSkipButton = document.getElementById('loading-skip-btn');
const errorOverlay = document.getElementById('error-overlay');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');
const debugInfo = document.getElementById('debug-info');

const INIT_TOTAL_STEPS = 5;

function readDurationParam(name, fallbackMs) {
    const raw = urlParams.get(name);
    if (raw === null || raw === '') return fallbackMs;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallbackMs;
    return Math.max(0, parsed);
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createNeverResolvingPromise() {
    return new Promise(() => {});
}

function createLoadingOverlayController() {
    const config = {
        showDelayMs: readDurationParam('loadingOverlayShowDelayMs', 450),
        timeoutMs: readDurationParam('loadingOverlayTimeoutMs', 15000),
        testInitDelayMs: readDurationParam('testInitDelayMs', 0),
        testInitDelayAt: urlParams.get('testInitDelayAt') || 'before-rapier',
        testInitStallAt: urlParams.get('testInitStallAt') || ''
    };

    const debugState = {
        wasShown: false,
        dismissed: false,
        timedOut: false,
        completed: false,
        lastText: '',
        lastStep: '',
        loadingVisible: false,
        errorVisible: false,
        showDelayMs: config.showDelayMs,
        timeoutMs: config.timeoutMs
    };
    window.__hostLoadingOverlay = debugState;

    let completed = false;
    let dismissed = false;
    let showTimer = null;
    let timeoutTimer = null;

    function syncDebugState(extra = {}) {
        Object.assign(debugState, extra, {
            loadingVisible: !loadingOverlay.classList.contains('hidden'),
            errorVisible: !errorOverlay.classList.contains('hidden')
        });
    }

    function clearTimers() {
        if (showTimer !== null) {
            window.clearTimeout(showTimer);
            showTimer = null;
        }
        if (timeoutTimer !== null) {
            window.clearTimeout(timeoutTimer);
            timeoutTimer = null;
        }
    }

    function hideLoadingOverlay() {
        loadingOverlay.classList.add('hidden');
        syncDebugState();
    }

    function hideErrorOverlay() {
        errorOverlay.classList.add('hidden');
        if (errorTitle) errorTitle.textContent = 'Something went wrong';
        errorMessage.textContent = '';
        syncDebugState();
    }

    function showLoadingOverlay() {
        if (completed || dismissed || debugState.timedOut) return;
        loadingOverlay.classList.remove('hidden');
        syncDebugState({ wasShown: true });
    }

    function showErrorOverlay(message, title = 'Something went wrong', { timedOut = false } = {}) {
        loadingOverlay.classList.add('hidden');
        if (errorTitle) errorTitle.textContent = title;
        errorMessage.textContent = message;
        errorOverlay.classList.remove('hidden');
        syncDebugState({ timedOut, errorMessage: message });
    }

    function updateStep(text, stepNumber) {
        loadingText.textContent = text;
        if (loadingStep) {
            const boundedStep = Math.max(1, Math.min(INIT_TOTAL_STEPS, stepNumber));
            loadingStep.textContent = `Step ${boundedStep} of ${INIT_TOTAL_STEPS}`;
            loadingOverlay.dataset.loadingStep = String(boundedStep);
        }
        syncDebugState({
            lastText: text,
            lastStep: loadingStep?.textContent || '',
            loadingStepNumber: Number(loadingOverlay.dataset.loadingStep || stepNumber)
        });
    }

    loadingSkipButton?.addEventListener('click', () => {
        dismissed = true;
        hideLoadingOverlay();
        syncDebugState({ dismissed: true });
    });

    return {
        start() {
            completed = false;
            dismissed = false;
            clearTimers();
            hideErrorOverlay();
            hideLoadingOverlay();
            updateStep('Bolting the wheels on...', 1);

            showTimer = window.setTimeout(() => {
                showLoadingOverlay();
            }, config.showDelayMs);

            timeoutTimer = window.setTimeout(() => {
                if (completed) return;

                debugState.timedOut = true;
                showErrorOverlay(
                    'Host startup is taking longer than expected. Retry to start over, or wait a little longer if your browser is still warming up.',
                    'Still starting up',
                    { timedOut: true }
                );
            }, config.timeoutMs);
        },

        setStep(text, stepNumber) {
            updateStep(text, stepNumber);
        },

        async maybePause(stageName) {
            if (config.testInitStallAt === stageName) {
                await createNeverResolvingPromise();
            }
            if (config.testInitDelayMs > 0 && config.testInitDelayAt === stageName) {
                await delay(config.testInitDelayMs);
            }
        },

        finish() {
            completed = true;
            clearTimers();
            hideLoadingOverlay();
            hideErrorOverlay();
            syncDebugState({ completed: true });
        },

        fail(message) {
            completed = true;
            clearTimers();
            showErrorOverlay(message);
            syncDebugState({ completed: true });
        }
    };
}

const loadingUi = createLoadingOverlayController();

// Debug display (D key handler)
let showDebug = false;

document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        showDebug = !showDebug;
        debugInfo.classList.toggle('hidden', !showDebug);
    }
});

// Initialize game
async function initGame() {
    loadingUi.start();

    try {
        // Kick off the (large) GameHost chunk download immediately so it
        // overlaps with WASM init instead of waterfalling after it. window.THREE
        // and window.io are already set above, which is all its modules need at
        // evaluation time (RAPIER is only used once we construct the host).
        const gameHostModulePromise = import('/static/js/GameHost.js');

        loadingUi.setStep('Spinning up the physics tape...', 2);
        await loadingUi.maybePause('before-rapier');

        // Initialize Rapier WASM
        await RAPIER.init();
        window.RAPIER = RAPIER;
        window.rapierLoaded = true;

        loadingUi.setStep('Warming the host camcorder...', 3);
        await loadingUi.maybePause('before-game-host');

        const { GameHost } = await gameHostModulePromise;

        // Create and initialize game host
        const game = new GameHost({
            container: document.getElementById('game-container')
        });

        // Make game accessible globally for debugging
        window.game = game;

        import('/static/js/ui/SmashCalloutOverlayBootstrap.js')
            .then(({ ensureSmashCalloutOverlay }) => ensureSmashCalloutOverlay())
            .catch(() => {});

        // 5k3.25: attach the shared camcorder film-grain DOM overlay so the host
        // UI reads as "inside the camcorder" (DOM counterpart of the 5k3.8 WebGL
        // grain). pointer-events:none is enforced by the overlay + CSS; it never
        // steals input. Reduce-effects / prefers-reduced-motion disables it.
        const grainOverlay = new GrainOverlay();
        grainOverlay.attach();
        if (GrainOverlay.prefersReducedMotion()) {
            grainOverlay.setEnabled(false);
        }
        window.__sbGrainOverlay = grainOverlay;

        // Expose rapierPhysics for test compatibility (upside-down detection)
        window.rapierPhysics = {
            isCarUpsideDown: (physicsBody) => {
                if (!physicsBody) return false;
                try {
                    const rot = physicsBody.rotation();
                    // Calculate up vector after quaternion rotation
                    // upY = 1 - 2*(x² + z²) for unit quaternion
                    const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
                    return upY < 0.3; // Car is upside down if Y-up < 0.3
                } catch (e) {
                    return false;
                }
            }
        };

        // Expose gameState for test compatibility
        // Use a proxy to allow setting controls on the actual vehicle
        window.gameState = {
            get cars() {
                const result = {};
                for (const [playerId, vehicle] of game.vehicles) {
                    // Create a proxy that forwards property sets to the actual vehicle
                    result[playerId] = new Proxy({
                        mesh: vehicle.mesh,
                        playerId: playerId,
                        spawnPosition: vehicle.spawnPosition,
                        physicsBody: game.systems.physics?.getVehicleBody?.(vehicle.id) || null
                    }, {
                        get(target, prop) {
                            if (prop === 'controls') {
                                return vehicle.controls;
                            }
                            return target[prop];
                        },
                        set(target, prop, value) {
                            if (prop === 'controls') {
                                // Update the actual vehicle's controls
                                vehicle.controls = value;
                                return true;
                            }
                            target[prop] = value;
                            return true;
                        }
                    });
                }
                return result;
            },
            _testControlsOverride: false
        };

        // Expose reset functions for test compatibility
        console.log('Assigning window.resetCarPosition function');
        window.resetCarPosition = function(playerId) {
            console.log('RESET FUNCTION CALLED with:', playerId);
            // Try both string and number keys since Map keys can be either
            let vehicle = game.vehicles.get(playerId);
            if (!vehicle) {
                vehicle = game.vehicles.get(Number(playerId));
            }
            if (!vehicle) {
                vehicle = game.vehicles.get(String(playerId));
            }

            if (vehicle && vehicle.spawnPosition) {
                console.log('Reset: Vehicle found, resetting to spawn');
                // Reset vehicle
                vehicle.reset(vehicle.spawnPosition);
                if (game.systems.physics) {
                    game.systems.physics.resetVehicle(
                        vehicle.id,
                        vehicle.spawnPosition,
                        vehicle.spawnPosition.rotation || 0
                    );
                }
                console.log('Reset: Complete');
            } else {
                console.log('Reset: Vehicle not found');
            }
        };

        window.resetAllCars = () => {
            let index = 0;
            for (const [playerId, vehicle] of game.vehicles) {
                const spawnPos = game.track?.getSpawnPosition(index) || vehicle.spawnPosition;
                vehicle.reset(spawnPos);
                if (game.systems.physics) {
                    game.systems.physics.resetVehicle(
                        vehicle.id,
                        spawnPos,
                        spawnPos.rotation || 0
                    );
                }
                index++;
            }
        };

        loadingUi.setStep('Snapping the arena together...', 4);
        await loadingUi.maybePause('before-game-init');
        await game.init();

        // Expose the debug-lab contract hooks (window.__debugLab / __labTools) for
        // Playwright automation and lab tooling. Defensive: a lab failure must
        // never block the host from reaching the lobby.
        try {
            installHostDebugLab(game);
        } catch (labError) {
            console.warn('Debug lab install failed:', labError);
        }

        loadingUi.setStep('Rolling to the lobby...', 5);
        await loadingUi.maybePause('before-game-start');
        await game.start();

        loadingUi.finish();

        // Setup debug display updates
        setInterval(() => {
            try {
                // Update debug info panel
                const debugFps = document.getElementById('debug-fps');
                const debugState = document.getElementById('debug-state');
                const debugPlayers = document.getElementById('debug-players');
                const debugRoom = document.getElementById('debug-room');

                if (debugFps) debugFps.textContent = game.engine?.getFps?.() || '0';
                if (debugState) debugState.textContent = game.engine?.getState?.() || '-';
                if (debugPlayers) debugPlayers.textContent = game.vehicles?.size || '0';
                if (debugRoom) debugRoom.textContent = game.roomCode || '-';

                // Also update stats overlay if visible
                const statsPlayers = document.getElementById('stats-players');
                const statsState = document.getElementById('stats-state');
                if (statsPlayers) statsPlayers.textContent = game.vehicles?.size || '0';
                if (statsState) statsState.textContent = game.engine?.getState?.() || '-';
            } catch (error) {
                // Silently ignore errors during debug updates
            }
        }, 500);

        console.log('Game initialized successfully!');

    } catch (error) {
        console.error('Failed to initialize game:', error);
        loadingUi.fail(error.message || 'Failed to initialize game. Please refresh and try again.');
    }
}

// Start initialization
initGame();
