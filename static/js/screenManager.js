// screenManager.js - Manage screen transitions and UI states
import { getElement, addClass, removeClass } from './domUtils.js';

// Track the currently active screen
let currentScreen = null;

// Configuration for transitions with custom behavior
const screenConfig = {
    // Example of custom screen config
    game: {
        onShow: (screenElement) => {
            // Show game status briefly then fade out
            const gameStatus = getElement('game-status');
            if (gameStatus) {
                gameStatus.style.opacity = '1';
                removeClass(gameStatus, 'fade-out');
                setTimeout(() => {
                    addClass(gameStatus, 'fade-out');
                }, 3000);
            }
        }
    }
};

/**
 * Set the active screen and hide all others
 * @param {string} screenId - ID of the screen to show
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.animate=false] - Whether to animate the transition
 * @returns {HTMLElement|null} - The activated screen element or null if not found
 */
export function setActiveScreen(screenId, options = {}) {
    // Get all screens with the 'screen' class
    const screens = document.querySelectorAll('.screen');
    if (!screens.length) return null;
    
    // Get the target screen
    const targetScreen = getElement(screenId);
    if (!targetScreen) {
        console.error(`Screen with ID "${screenId}" not found`);
        return null;
    }
    
    // Hide all screens
    screens.forEach(screen => {
        addClass(screen, 'hidden');
    });
    
    // Show the target screen
    removeClass(targetScreen, 'hidden');
    
    // Call custom show handler if configured
    const config = screenConfig[screenId];
    if (config && typeof config.onShow === 'function') {
        config.onShow(targetScreen, options);
    }
    
    // Update current screen
    currentScreen = screenId;
    
    return targetScreen;
}

/**
 * Register a custom handler for a screen
 * @param {string} screenId - ID of the screen
 * @param {Object} config - Configuration for the screen
 * @param {Function} config.onShow - Function to call when screen is shown
 * @param {Function} config.onHide - Function to call when screen is hidden
 */
export function registerScreen(screenId, config) {
    screenConfig[screenId] = config;
}

/**
 * Get the current active screen ID
 * @returns {string|null} - ID of the current screen or null if none
 */
export function getCurrentScreen() {
    return currentScreen;
}

/**
 * Show the lobby screen
 * @returns {HTMLElement|null} - The lobby screen element or null if not found
 */
export function showLobbyScreen() {
    return setActiveScreen('lobby-screen');
}

/**
 * Show the game screen
 * @returns {HTMLElement|null} - The game screen element or null if not found
 */
export function showGameScreen() {
    return setActiveScreen('game-screen');
}

/**
 * Update the displayed room code and join URL
 * @param {string} roomCode - Room code to display
 */
export function updateRoomDisplay(roomCode, ip, port) {
    const roomCodeDisplay = getElement('room-code-display');
    if (roomCodeDisplay) {
        roomCodeDisplay.textContent = roomCode;
    }

    const joinUrl = `http://${ip}:${port}/player`;
    // elements.joinUrl.textContent = `${joinUrl}?room=${gameState.roomCode}`;
    
    
    
    const joinUrlElement = getElement('join-url');

    if (joinUrlElement) {
        const url = `${joinUrl}?room=${roomCode}`;
        
        // The actual text will be set by the debug mode handler
        joinUrlElement.setAttribute('data-url', url);
        
        // If debug mode is enabled, make the URL clickable
        if (window.isDebugMode) {
            console.warn("Debug mode is enabled");
            joinUrlElement.innerHTML = `<a href="${url}" onclick="window.open(this.href, '_new', 'width=800,height=600'); return false;">${url}</a>`;
        } else {    
            joinUrlElement.textContent = url;
        }
        
    } else {
        console.error("Join URL element not found");
    }
}

/**
 * Generate and display QR code for the room
 * @param {string} roomCode - Room code to display
 * @param {number} [size=128] - Size of the QR code in pixels
 * @returns {boolean} - Whether QR code was successfully generated
 */
export function generateRoomQRCode(roomCode, size = 128) {
    const qrCodeElement = getElement('qr-code');
    
    // Check if QR code element exists and QR code library is loaded
    if (!qrCodeElement || !window.QRCode) {
        return false;
    }
    
    try {
        // Clear previous QR code
        qrCodeElement.innerHTML = '';
        
        // Generate new QR code
        new window.QRCode(qrCodeElement, {
            text: `${window.location.origin}/join?room=${roomCode}`,
            width: size,
            height: size
        });
        
        return true;
    } catch (e) {
        console.error('Failed to generate QR code:', e);
        return false;
    }
}

// Export all screen management functions
export default {
    setActiveScreen,
    registerScreen,
    getCurrentScreen,
    showLobbyScreen,
    showGameScreen,
    updateRoomDisplay,
    generateRoomQRCode
}; 