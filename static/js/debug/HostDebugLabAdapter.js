import { DebugLabRegistry } from './DebugLabContract.js';
import { createSafeTextElement, renderSafeText } from './SafeTextRenderer.js';

const LAB_SCHEMA = 'jj.debugLab.v1';
const DIAGNOSTICS_SCHEMA = 'jj.debugLab.diagnostics.v1';

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function estimateDataUrlBytes(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    const commaIndex = dataUrl.indexOf(',');
    const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
    return Math.max(0, Math.floor((payload.length * 3) / 4));
}

function getBuildId() {
    return (
        window.__BUILD_ID ||
        window.__buildId ||
        window.game?.engine?.getRunContext?.()?.describe?.()?.buildId ||
        'dev-local'
    );
}

function getRendererDiagnostics(gameHost) {
    const renderSystem = gameHost?.systems?.render;
    if (!renderSystem) return null;
    if (typeof renderSystem.getGradeDiagnostics === 'function') {
        return renderSystem.getGradeDiagnostics();
    }
    const renderer = renderSystem.getRenderer?.();
    return {
        backend: {
            renderer: renderer?.constructor?.name || null
        }
    };
}

function ensureSafeTextRoot() {
    let root = document.getElementById('debug-lab-safe-text-root');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'debug-lab-safe-text-root';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(root);
    return root;
}

/**
 * Reference debug-lab adapter for the live host surface.
 *
 * This does not replace the live game loop. It provides the shared hook shape,
 * deterministic lab-control state, and evidence capture against the production
 * host renderer so Playwright and Beads validators can reproduce debug-lab
 * bundles before the car/weapon/map tools adopt the same contract.
 */
export function createHostDebugLab(gameHost, options = {}) {
    const toolName = options.toolName || 'host-debug-lab';
    let tick = 0;
    let playing = true;
    let lastScenario = null;
    const consoleLogs = {
        warns: [],
        errors: []
    };

    function currentScenario() {
        const runContext = gameHost?.engine?.getRunContext?.()?.describe?.() || {};
        return {
            schema: LAB_SCHEMA,
            seed: Number(runContext.seed ?? 0),
            preset: `${gameHost?.settings?.mode || 'lobby'}:${gameHost?.settings?.track || 'unknown'}`,
            toolName,
            timestamp: new Date().toISOString(),
            buildId: getBuildId(),
            tuningOverrides: {},
            customData: {
                roomCode: gameHost?.roomCode || null,
                playerCount: gameHost?.vehicles?.size || 0,
                state: gameHost?.engine?.getState?.() || null
            }
        };
    }

    function getDiagnostics() {
        const canvas = labTools.getCanvasElement();
        const renderDiagnostics = getRendererDiagnostics(gameHost);
        const debugInfo = gameHost?.collectDebugInfo?.() || {};

        return {
            schema: DIAGNOSTICS_SCHEMA,
            timestamp: Date.now(),
            tick,
            toolName,
            state: {
                toolName,
                isRunning: playing,
                gameState: debugInfo.gameState || null,
                mode: gameHost?.settings?.mode || null,
                track: gameHost?.settings?.track || null,
                roomCode: gameHost?.roomCode || null,
                playerCount: gameHost?.vehicles?.size || 0,
                hasCanvas: !!canvas
            },
            metrics: {
                fps: Math.round(gameHost?.engine?.getFps?.() || 0),
                render: renderDiagnostics
            },
            overlays: {
                assumptions: true,
                diagnostics: true,
                geometry: !!gameHost?.ui?.debugOverlay,
                picking: false
            },
            warnings: [...consoleLogs.warns],
            errors: [...consoleLogs.errors],
            hooksAvailable: {
                reset: true,
                stepFrame: true,
                stepSecond: true,
                playPause: true,
                takeScreenshot: true,
                getDiagnostics: true,
                getConsoleLogs: true,
                exportScenario: true,
                importScenario: true
            },
            textRenderingSafe: true,
            consoleSpyActive: true
        };
    }

    const lab = {
        name: toolName,
        toolName,

        reset() {
            tick = 0;
            playing = true;
            consoleLogs.warns.length = 0;
            consoleLogs.errors.length = 0;
            gameHost?.resetAllVehicles?.();
            gameHost?.systems?.render?.resetFrameTimingSamples?.();
            return getDiagnostics();
        },

        stepFrame() {
            tick += 1;
            return getDiagnostics();
        },

        stepSecond() {
            tick += 60;
            return getDiagnostics();
        },

        playPause() {
            playing = !playing;
            if (playing) {
                gameHost?.engine?.resume?.();
            } else {
                gameHost?.engine?.pause?.();
            }
            return { playing, tick };
        },

        async takeScreenshot() {
            const dataUrl = gameHost?.captureScreenshot?.() || null;
            return {
                success: typeof dataUrl === 'string' && dataUrl.startsWith('data:image/'),
                timestampMs: Date.now(),
                fileSizeBytes: estimateDataUrlBytes(dataUrl),
                mimeType: typeof dataUrl === 'string' ? dataUrl.slice(5, dataUrl.indexOf(';')) : null
            };
        },

        getDiagnostics,

        getConsoleLogs() {
            return {
                warns: [...consoleLogs.warns],
                errors: [...consoleLogs.errors]
            };
        },

        exportScenario() {
            lastScenario = currentScenario();
            return cloneJson(lastScenario);
        },

        importScenario(scenario) {
            if (!scenario || scenario.schema !== LAB_SCHEMA) {
                const message = 'Debug lab scenario must use jj.debugLab.v1';
                consoleLogs.errors.push({ timestamp: Date.now(), message });
                return { success: false, error: message };
            }
            lastScenario = cloneJson(scenario);
            tick = 0;
            return { success: true, scenario: cloneJson(lastScenario) };
        }
    };

    const labTools = {
        getCanvasElement() {
            return gameHost?.systems?.render?.getRenderer?.()?.domElement || document.querySelector('canvas');
        },

        getRenderer() {
            return gameHost?.systems?.render?.getRenderer?.() || null;
        },

        getScene() {
            return gameHost?.systems?.render?.getScene?.() || null;
        },

        getState() {
            return getDiagnostics().state;
        },

        renderHostileLabel(payload) {
            const root = ensureSafeTextRoot();
            const element = createSafeTextElement('', 'span', {
                'data-debug-lab-safe-text': 'hostile-label'
            });
            renderSafeText(element, payload);
            root.replaceChildren(element);
            return {
                textContent: element.textContent,
                innerHTML: element.innerHTML,
                childElementCount: element.childElementCount
            };
        }
    };

    lab.labTools = labTools;
    return lab;
}

export function installHostDebugLab(gameHost, options = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null;
    }

    const lab = createHostDebugLab(gameHost, options);
    DebugLabRegistry.register(lab.toolName, lab);
    return lab;
}

export default {
    createHostDebugLab,
    installHostDebugLab
};
