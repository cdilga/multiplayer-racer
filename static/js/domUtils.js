// DOM Utilities - Handle all DOM manipulation and UI update logic

// Cache for DOM elements to avoid repeated getElementById calls
const elementCache = {};

/**
 * Get an element by ID, using a cache to improve performance
 * @param {string} id - Element ID
 * @param {boolean} required - If true, throws error when element not found
 * @returns {HTMLElement|null} - The DOM element or null if not found
 */
export function getElement(id, required = false) {
    if (!elementCache[id]) {
        elementCache[id] = document.getElementById(id);
        
        if (required && !elementCache[id]) {
            throw new Error(`Required DOM element not found: ${id}`);
        }
    }
    return elementCache[id];
}

/**
 * Get multiple elements at once and return as an object
 * @param {string[]} ids - Array of element IDs
 * @param {boolean} required - If true, throws error when any element not found
 * @returns {Object} - Object with elements mapped by ID
 */
export function getElements(ids, required = false) {
    const elements = {};
    
    ids.forEach(id => {
        elements[id] = getElement(id, required);
    });
    
    return elements;
}

/**
 * Initialize all required elements for the application
 * @returns {Object} - Object containing all needed DOM elements
 */
export function initializeElements() {
    return {
        lobbyScreen: getElement('lobby-screen'),
        gameScreen: getElement('game-screen'),
        startGameBtn: getElement('start-game-btn'),
        roomCodeDisplay: getElement('room-code-display'),
        playerList: getElement('player-list'),
        joinUrl: getElement('join-url'),
        gameContainer: getElement('game-container'),
        gameStatus: getElement('game-status'),
        statsOverlay: getElement('stats-overlay'),
        fullscreenBtn: getElement('fullscreen-btn')
    };
}

/**
 * Set the text content of an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} text - Text to set
 */
export function setText(idOrElement, text) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element) {
        element.textContent = text;
    }
}

/**
 * Add a CSS class to an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} className - CSS class to add
 */
export function addClass(idOrElement, className) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element && !element.classList.contains(className)) {
        element.classList.add(className);
    }
}

/**
 * Remove a CSS class from an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} className - CSS class to remove
 */
export function removeClass(idOrElement, className) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element && element.classList.contains(className)) {
        element.classList.remove(className);
    }
}

/**
 * Toggle a CSS class on an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} className - CSS class to toggle
 * @returns {boolean} - Whether the class is now applied
 */
export function toggleClass(idOrElement, className) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element) {
        return element.classList.toggle(className);
    }
    return false;
}

/**
 * Show or hide an element by adding/removing 'hidden' class
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {boolean} visible - Whether to show (true) or hide (false) the element
 */
export function setVisible(idOrElement, visible) {
    if (visible) {
        removeClass(idOrElement, 'hidden');
    } else {
        addClass(idOrElement, 'hidden');
    }
}

/**
 * Create a new element with optional attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes to set on the element
 * @param {Array|HTMLElement|string} children - Child elements or text content
 * @returns {HTMLElement} - The created element
 */
export function createElement(tag, attrs = {}, children = null) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'style' && typeof value === 'object') {
            Object.entries(value).forEach(([styleKey, styleValue]) => {
                element.style[styleKey] = styleValue;
            });
        } else if (key === 'className') {
            element.className = value;
        } else {
            element.setAttribute(key, value);
        }
    });
    
    // Add children
    if (children) {
        if (Array.isArray(children)) {
            children.forEach(child => {
                if (typeof child === 'string') {
                    element.appendChild(document.createTextNode(child));
                } else if (child instanceof HTMLElement) {
                    element.appendChild(child);
                }
            });
        } else if (typeof children === 'string') {
            element.textContent = children;
        } else if (children instanceof HTMLElement) {
            element.appendChild(children);
        }
    }
    
    return element;
}

/**
 * Add a player to the player list in the UI
 * @param {string} id - Player ID
 * @param {string} name - Player name
 * @param {string} color - Player color (CSS color)
 */
export function addPlayerToList(id, name, color) {
    const playerList = getElement('player-list');
    if (!playerList) return;
    
    const playerItem = createElement('li', { id: `player-${id}` }, [
        createElement('span', { className: 'player-color', style: { backgroundColor: color } }),
        createElement('span', {}, name)
    ]);
    
    playerList.appendChild(playerItem);
}

/**
 * Remove a player from the player list in the UI
 * @param {string} id - Player ID
 */
export function removePlayerFromList(id) {
    const playerElement = getElement(`player-${id}`);
    if (playerElement) {
        playerElement.remove();
    }
}

/**
 * Update player name in the player list
 * @param {string} id - Player ID
 * @param {string} name - New player name
 */
export function updatePlayerName(id, name) {
    const playerElement = getElement(`player-${id}`);
    if (playerElement) {
        const nameSpan = playerElement.querySelector('span:nth-child(2)');
        if (nameSpan) {
            nameSpan.textContent = name;
        }
    }
}

/**
 * Switch between different screens (lobby, game, etc.)
 * @param {string} screenName - Name of the screen to show
 */
export function showScreen(screenName) {
    const lobbyScreen = getElement('lobby-screen');
    const gameScreen = getElement('game-screen');
    
    if (!lobbyScreen || !gameScreen) return;
    
    addClass(lobbyScreen, 'hidden');
    addClass(gameScreen, 'hidden');
    
    switch (screenName) {
        case 'lobby':
            removeClass(lobbyScreen, 'hidden');
            break;
        case 'game':
            removeClass(gameScreen, 'hidden');
            // Show game status briefly then fade out
            const gameStatus = getElement('game-status');
            if (gameStatus) {
                gameStatus.style.opacity = '1';
                removeClass(gameStatus, 'fade-out');
                setTimeout(() => {
                    addClass(gameStatus, 'fade-out');
                }, 3000);
            }
            break;
    }
}

/**
 * Update the displayed room code and join URL
 * @param {string} roomCode - Room code to display
 */
export function updateRoomDisplay(roomCode) {
    setText('room-code-display', roomCode);
    
    const joinUrl = getElement('join-url');
    if (joinUrl) {
        const url = `${window.location.origin}/join?room=${roomCode}`;
        joinUrl.href = url;
        joinUrl.textContent = url;
    }
    
    // Update QR code if element exists
    const qrCodeElement = getElement('qr-code');
    if (qrCodeElement && window.QRCode) {
        qrCodeElement.innerHTML = '';
        new window.QRCode(qrCodeElement, {
            text: `${window.location.origin}/join?room=${roomCode}`,
            width: 128,
            height: 128
        });
    }
}

/**
 * Update stats display with pre-formatted content
 * @param {string} content - Pre-formatted HTML content to display
 */
export function updateStatsDisplay(content) {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) return;
    
    statsOverlay.innerHTML = content;
}

/**
 * Toggle fullscreen mode
 * @returns {boolean} Whether the app is now in fullscreen mode
 */
export function toggleFullscreen() {
    const gameContainer = getElement('game-container');
    if (!gameContainer) return false;
    
    if (!document.fullscreenElement) {
        if (gameContainer.requestFullscreen) {
            gameContainer.requestFullscreen();
        } else if (gameContainer.webkitRequestFullscreen) {
            gameContainer.webkitRequestFullscreen();
        } else if (gameContainer.msRequestFullscreen) {
            gameContainer.msRequestFullscreen();
        }
        return true;
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        return false;
    }
}

/**
 * Update the fullscreen button icon based on current state
 * @param {boolean} isFullscreen - Whether the app is currently in fullscreen mode
 */
export function updateFullscreenButton(isFullscreen) {
    const fullscreenBtn = getElement('fullscreen-btn');
    if (!fullscreenBtn) return;
    
    if (isFullscreen) {
        fullscreenBtn.innerHTML = '⤵';
        fullscreenBtn.title = 'Exit Fullscreen';
    } else {
        fullscreenBtn.innerHTML = '⤢';
        fullscreenBtn.title = 'Enter Fullscreen';
    }
}

/**
 * Create a bar indicator (for visualizing forces, etc.)
 * @param {number} value - Current value of the indicator
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {HTMLElement} The created bar indicator element
 */
export function createBarIndicator(value, min, max) {
    // For symmetric controls like steering (-1 to 1)
    const isSymmetric = min < 0 && max > 0;
    const barWidth = 60; // Width in pixels
    
    if (isSymmetric) {
        // Create container
        const container = createElement('span', { className: 'control-bar', style: { width: `${barWidth}px` } });
        
        // Add center marker
        const centerMarker = createElement('span', { className: 'control-bar-center' });
        container.appendChild(centerMarker);
        
        // Calculate fill percentage (from center)
        const fillPercent = Math.abs(value) / Math.max(Math.abs(min), Math.abs(max)) * 50;
        const fillDirection = value >= 0 ? 'positive' : 'negative';
        
        // Create fill element
        const fill = createElement('span', { 
            className: `control-bar-fill ${fillDirection}`,
            style: { width: `${fillPercent}%` }
        });
        container.appendChild(fill);
        
        return container;
    } else {
        // Create container for non-symmetric values (0 to 1)
        const container = createElement('span', { className: 'control-bar', style: { width: `${barWidth}px` } });
        
        // Calculate fill percentage
        const fillPercent = (value - min) / (max - min) * 100;
        
        // Create fill element
        const fill = createElement('span', { 
            className: 'control-bar-fill positive',
            style: { width: `${fillPercent}%` }
        });
        container.appendChild(fill);
        
        return container;
    }
}

/**
 * Initialize the stats overlay
 */
export function initStatsOverlay() {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) return;
    
    // Create and add stylesheet for stats display
    const style = document.createElement('style');
    style.textContent = `
        .game-title {
            font-size: 2.5em;
            color: #f72585;
            text-align: center;
            margin-bottom: 1em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        #stats-overlay {
            position: absolute;
            top: 10px;
            left: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            z-index: 1000;
            max-width: 300px;
            pointer-events: auto;
            max-height: 90vh;
            overflow-y: auto;
        }
        #stats-overlay.hidden {
            display: none;
        }
        .stats-header {
            font-weight: bold;
            margin-bottom: 5px;
            text-align: center;
        }
        .stats-section {
            margin-top: 5px;
            font-weight: bold;
            border-top: 1px solid rgba(255, 255, 255, 0.3);
            padding-top: 5px;
        }
        .player-stats {
            margin: 10px 0;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        .player-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
            padding-bottom: 5px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }
        .physics-state {
            font-size: 0.8em;
            opacity: 0.8;
        }
        .control-info {
            margin: 5px 0;
            padding: 5px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 3px;
        }
        
        /* Control indicator styles */
        .control-row {
            display: flex;
            align-items: center;
            margin: 4px 0;
        }
        .control-row span {
            display: inline-block;
            min-width: 80px;
        }
        .control-row .value {
            min-width: 40px;
            text-align: right;
        }
        .controls-section {
            margin-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 5px;
        }
        .controls-header {
            font-size: 11px;
            color: #aaa;
            margin-bottom: 3px;
        }
        .control-time {
            font-size: 10px;
            color: #888;
            text-align: right;
            margin-top: 3px;
        }
        .forces-section {
            margin-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 5px;
        }
        .forces-header {
            font-size: 11px;
            color: #aaa;
            margin-bottom: 3px;
        }
    `;
    document.head.appendChild(style);
    
    // Set initial style
    Object.assign(statsOverlay.style, {
        position: 'absolute',
        top: '10px',
        left: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '12px',
        zIndex: '1000'
    });
}

/**
 * Add styles for force visualization and indicators
 */
export function addBarIndicatorStyles() {
    const styleId = 'bar-indicator-styles';
    if (document.getElementById(styleId)) return;
    
    const styleElement = createElement('style', { id: styleId });
    styleElement.textContent = `
        .bar-indicator {
            display: inline-block;
            width: 60px;
            height: 10px;
            background-color: #333;
            border-radius: 5px;
            overflow: hidden;
            position: relative;
            margin: 0 5px;
        }
        
        .bar-indicator .bar {
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            background-color: #4CAF50;
            transition: width 0.1s;
        }
        
        /* Control bar styles */
        .control-bar {
            display: inline-block;
            width: 60px;
            height: 10px;
            background: #333;
            margin: 0 5px;
            position: relative;
            border-radius: 2px;
            overflow: hidden;
        }
        
        .control-bar-fill {
            height: 100%;
            position: absolute;
            top: 0;
            transition: width 0.2s ease;
        }
        
        .control-bar-fill.positive {
            background: #4CAF50;
            left: 50%;
        }
        
        .control-bar-fill.negative {
            background: #f44336;
            right: 50%;
        }
        
        .control-bar-center {
            position: absolute;
            width: 1px;
            height: 10px;
            background: #fff;
            top: 0;
            left: 50%;
        }
    `;
    
    document.head.appendChild(styleElement);
}

// Call this when the module is loaded to ensure bar indicator styles are available
addBarIndicatorStyles();

// Export all DOM utility functions
export default {
    getElement,
    getElements,
    initializeElements,
    setText,
    addClass,
    removeClass,
    toggleClass,
    setVisible,
    createElement,
    addPlayerToList,
    removePlayerFromList,
    updatePlayerName,
    showScreen,
    updateRoomDisplay,
    updateStatsDisplay,
    toggleFullscreen,
    updateFullscreenButton,
    createBarIndicator,
    initStatsOverlay,
    addBarIndicatorStyles
}; 