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

// Expose globally for existing code compatibility
window.THREE = THREE;
window.io = io;

// UI elements
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const errorOverlay = document.getElementById('error-overlay');
const errorMessage = document.getElementById('error-message');
const debugInfo = document.getElementById('debug-info');

// Debug display (D key handler)
let showDebug = false;

document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        showDebug = !showDebug;
        debugInfo.classList.toggle('hidden', !showDebug);
    }
});

// Show error
function showError(message) {
    errorMessage.textContent = message;
    errorOverlay.classList.remove('hidden');
    loadingOverlay.classList.add('hidden');
}

// Update loading text
function updateLoading(text) {
    loadingText.textContent = text;
}

// Initialize game
async function initGame() {
    try {
        updateLoading('Loading physics engine...');

        // Initialize Rapier WASM
        await RAPIER.init();
        window.RAPIER = RAPIER;
        window.rapierLoaded = true;

        updateLoading('Creating game host...');

        // Dynamic import existing GameHost
        const { GameHost } = await import('/static/js/GameHost.js');

        // Create and initialize game host
        const game = new GameHost({
            container: document.getElementById('game-container')
        });

        // Make game accessible globally for debugging
        window.game = game;

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

        updateLoading('Initializing systems...');
        await game.init();

        updateLoading('Starting game...');
        await game.start();

        // Hide loading overlay
        loadingOverlay.classList.add('hidden');

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
        showError(error.message || 'Failed to initialize game. Please refresh and try again.');
    }
}

// Start initialization
initGame();
