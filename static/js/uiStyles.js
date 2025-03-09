// uiStyles.js - Handle UI styling and CSS management
import { createElement } from './domUtils.js';

/**
 * Initialize the stats overlay styles
 */
export function initStatsOverlayStyles() {
    addStyles('stats-overlay-styles', `
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
    `);
}

/**
 * Initialize bar indicator styles
 */
export function initBarIndicatorStyles() {
    addStyles('bar-indicator-styles', `
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
    `);
}

/**
 * Initialize physics debug styles
 */
export function initPhysicsDebugStyles() {
    addStyles('physics-debug-styles', `
        #physics-debug-container {
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1000;
        }
        .physics-debug-line {
            position: absolute;
            height: 2px;
            background-color: rgba(255, 0, 0, 0.7);
            transform-origin: 0 50%;
            pointer-events: none;
        }
        .physics-panel {
            position: absolute;
            top: 50px;
            right: 10px;
            width: 300px;
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            z-index: 1000;
        }
        .physics-panel.hidden {
            display: none;
        }
        .tabs-container {
            display: flex;
            border-bottom: 1px solid #444;
            margin-bottom: 10px;
        }
        .tab {
            padding: 5px 10px;
            cursor: pointer;
        }
        .tab.active {
            background-color: #333;
            border-radius: 5px 5px 0 0;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
    `);
}

/**
 * Initialize player list styles
 */
export function initPlayerListStyles() {
    addStyles('player-list-styles', `
        #player-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .player-item {
            display: flex;
            align-items: center;
            padding: 5px 10px;
            margin-bottom: 5px;
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        
        .player-color {
            display: inline-block;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            margin-right: 10px;
        }
        
        .player-name {
            flex-grow: 1;
        }
    `);
}

/**
 * Initialize all UI styles at once
 */
export function initAllStyles() {
    initStatsOverlayStyles();
    initBarIndicatorStyles();
    initPhysicsDebugStyles();
    initPlayerListStyles();
}

/**
 * Add styles to the document
 * @param {string} id - ID for the style element
 * @param {string} cssText - CSS text to add
 * @returns {HTMLStyleElement} - The created style element
 */
function addStyles(id, cssText) {
    // Check if styles already exist
    let styleElement = document.getElementById(id);
    
    if (!styleElement) {
        // Create new style element
        styleElement = createElement('style', { id });
        document.head.appendChild(styleElement);
    }
    
    // Set or update the CSS text
    styleElement.textContent = cssText;
    
    return styleElement;
}

// Export all styling functions
export default {
    initStatsOverlayStyles,
    initBarIndicatorStyles,
    initPhysicsDebugStyles,
    initPlayerListStyles,
    initAllStyles
}; 