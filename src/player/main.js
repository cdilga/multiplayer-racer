/**
 * Player Entry Point
 *
 * This file bootstraps the player application by:
 * 1. Importing NPM packages (bundled by Vite)
 * 2. Exposing them globally for existing code compatibility
 * 3. Loading the player.js script after globals are set
 */

// Import from NPM (Vite bundles these)
import * as THREE from 'three';
import { io } from 'socket.io-client';
import { ControlMapper } from '/static/js/input/ControlMapper.js';
import { RemapStore } from '/static/js/input/RemapStore.js';
import { initBuildSkew } from '/static/js/buildSkewBanner.js';
import { bootstrapPageTelemetry } from '/static/js/telemetry/index.js';

// Expose globally for existing code compatibility
window.THREE = THREE;
window.io = io;
window.ControlMapper = ControlMapper;
window.RemapStore = RemapStore;

bootstrapPageTelemetry({
    role: 'controller',
    source: 'PlayerEntry'
});

// Detect client/server build skew (stale tab after a redeploy) and show a
// reload prompt; sets window.__buildStale so player.js stops sending control
// payloads against a possibly-changed contract. Fail-open.
initBuildSkew();

// Load mobileUtils.js first (player.js depends on it)
const mobileUtilsScript = document.createElement('script');
mobileUtilsScript.src = '/static/js/mobileUtils.js';
mobileUtilsScript.onload = () => {
    // Then load Joystick.js
    const joystickScript = document.createElement('script');
    joystickScript.src = '/static/js/Joystick.js';
    joystickScript.onload = () => {
        // Finally load player.js after dependencies are ready
        const playerScript = document.createElement('script');
        playerScript.src = '/static/js/player.js';
        document.body.appendChild(playerScript);
    };
    document.body.appendChild(joystickScript);
};
document.body.appendChild(mobileUtilsScript);
