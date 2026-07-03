import { SmashCalloutOverlay } from './SmashCalloutOverlay.js';

let overlayPromise = null;

function waitForHostGame(maxWaitMs = 15000) {
    return new Promise((resolve, reject) => {
        const startedAt = performance.now();

        const poll = () => {
            const game = window.game;
            if (game?.eventBus) {
                resolve(game);
                return;
            }

            if ((performance.now() - startedAt) >= maxWaitMs) {
                reject(new Error('Timed out waiting for host smash callout prerequisites'));
                return;
            }

            window.setTimeout(poll, 50);
        };

        poll();
    });
}

async function ensureSmashCalloutOverlay() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null;
    }

    if (window.__smashCalloutOverlay) {
        return window.__smashCalloutOverlay;
    }

    if (!overlayPromise) {
        overlayPromise = waitForHostGame().then((game) => {
            if (window.__smashCalloutOverlay) {
                return window.__smashCalloutOverlay;
            }

            const overlay = new SmashCalloutOverlay({
                document,
                container: document.body,
                eventBus: game.eventBus,
                gameHost: game
            });
            overlay.init();
            window.__smashCalloutOverlay = overlay;
            return overlay;
        });
    }

    return overlayPromise;
}

export { ensureSmashCalloutOverlay };
