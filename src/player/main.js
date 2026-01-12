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

// Expose globally for existing code compatibility
window.THREE = THREE;
window.io = io;

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
