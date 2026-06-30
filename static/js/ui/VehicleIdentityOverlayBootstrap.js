import { VehicleIdentityOverlay } from './VehicleIdentityOverlay.js';

let overlayPromise = null;

function waitForHostGame(maxWaitMs = 15000) {
    return new Promise((resolve, reject) => {
        const startedAt = performance.now();

        const poll = () => {
            const game = window.game;
            const render = game?.systems?.render;
            if (game && render?.overlayContainer && render?.camera && game?.eventBus) {
                resolve(game);
                return;
            }

            if ((performance.now() - startedAt) >= maxWaitMs) {
                reject(new Error('Timed out waiting for host game overlay prerequisites'));
                return;
            }

            window.setTimeout(poll, 50);
        };

        poll();
    });
}

async function ensureVehicleIdentityOverlay() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null;
    }

    if (window.__vehicleIdentityOverlay) {
        return window.__vehicleIdentityOverlay;
    }

    if (!overlayPromise) {
        overlayPromise = waitForHostGame().then((game) => {
            if (window.__vehicleIdentityOverlay) {
                return window.__vehicleIdentityOverlay;
            }

            const overlay = new VehicleIdentityOverlay({
                gameHost: game,
                eventBus: game.eventBus,
                renderSystem: game.systems.render,
                overlayContainer: game.systems.render.overlayContainer
            });
            overlay.init();
            window.__vehicleIdentityOverlay = overlay;
            return overlay;
        });
    }

    return overlayPromise;
}

export { ensureVehicleIdentityOverlay };
