// statsUI.js - Stats display and management
import { getElement, setHTML } from './domUtils.js';

/**
 * Initialize stats overlay UI
 */
export function initStatsOverlay() {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) return;
    
    // Set initial content
    setHTML(statsOverlay, '<div class="stats-header">Game Stats (Press F3 to toggle)</div>');
}

/**
 * Update stats display with pre-formatted content
 * @param {string} content - Pre-formatted HTML content to display
 */
export function updateStatsDisplay(content) {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) return;
    
    setHTML(statsOverlay, content);
}

/**
 * Toggle visibility of the stats overlay
 * @param {boolean} [visible] - Force specific visibility state
 * @returns {boolean} - Whether the stats overlay is now visible
 */
export function toggleStatsDisplay(visible) {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) return false;
    
    if (visible === undefined) {
        // Toggle visibility
        if (statsOverlay.classList.contains('hidden')) {
            statsOverlay.classList.remove('hidden');
            return true;
        } else {
            statsOverlay.classList.add('hidden');
            return false;
        }
    } else {
        // Set specific visibility
        if (visible) {
            statsOverlay.classList.remove('hidden');
        } else {
            statsOverlay.classList.add('hidden');
        }
        return visible;
    }
}

/**
 * Show the stats overlay
 * @returns {boolean} - Whether the operation was successful
 */
export function showStatsDisplay() {
    return toggleStatsDisplay(true);
}

/**
 * Hide the stats overlay
 * @returns {boolean} - Whether the operation was successful
 */
export function hideStatsDisplay() {
    return toggleStatsDisplay(false);
}

/**
 * Format stats into HTML content
 * @param {Object} stats - Stats data to format
 * @returns {string} - Formatted HTML content
 */
export function formatStatsHTML(stats) {
    let html = '<div class="stats-header">Game Stats (Press F3 to toggle)</div>';
    
    // Add basic stats
    if (stats.fps !== undefined) {
        html += `<div>FPS: ${stats.fps}</div>`;
    }
    
    if (stats.playerCount !== undefined) {
        html += `<div>Players: ${stats.playerCount}</div>`;
    }
    
    if (stats.physicsUpdates !== undefined) {
        html += `<div>Physics Updates: ${stats.physicsUpdates}</div>`;
    }
    
    // Add any other sections from the stats object
    Object.entries(stats).forEach(([key, value]) => {
        // Skip keys we've already handled
        if (['fps', 'playerCount', 'physicsUpdates'].includes(key)) {
            return;
        }
        
        // Handle nested objects
        if (typeof value === 'object' && value !== null) {
            html += `<div class="stats-section">${formatKey(key)}:</div>`;
            
            // Add each property of the nested object
            Object.entries(value).forEach(([nestedKey, nestedValue]) => {
                html += `<div>${formatKey(nestedKey)}: ${formatValue(nestedValue)}</div>`;
            });
        } else {
            // Add simple key-value pairs
            html += `<div>${formatKey(key)}: ${formatValue(value)}</div>`;
        }
    });
    
    return html;
}

/**
 * Format a key for display
 * @param {string} key - The key to format
 * @returns {string} - Formatted key
 */
function formatKey(key) {
    // Convert camelCase to Title Case with spaces
    return key
        // Insert a space before all uppercase letters
        .replace(/([A-Z])/g, ' $1')
        // Convert first character to uppercase and trim
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

/**
 * Format a value for display
 * @param {*} value - The value to format
 * @returns {string} - Formatted value
 */
function formatValue(value) {
    if (typeof value === 'boolean') {
        return value ? 
            '<span style="color:green">Yes</span>' : 
            '<span style="color:red">No</span>';
    }
    
    if (typeof value === 'number') {
        // Format numbers with 2 decimal places if they have decimals
        return Number.isInteger(value) ? value.toString() : value.toFixed(2);
    }
    
    return String(value);
}

// Export all stats UI functions
export default {
    initStatsOverlay,
    updateStatsDisplay,
    toggleStatsDisplay,
    showStatsDisplay,
    hideStatsDisplay,
    formatStatsHTML
}; 