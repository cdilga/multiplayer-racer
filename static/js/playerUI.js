// playerUI.js - Manage player-specific UI components
import { getElement, createElement } from './domUtils.js';

/**
 * Add a player to the player list in the UI
 * @param {string} id - Player ID
 * @param {string} name - Player name
 * @param {string} color - Player color (CSS color)
 * @returns {HTMLElement} - The created player item element
 */
export function addPlayerToList(id, name, color) {
    const playerList = getElement('player-list');
    if (!playerList) return null;
    
    const playerItem = createElement('li', { id: `player-${id}`, className: 'player-item' }, [
        createElement('span', { className: 'player-color', style: { backgroundColor: color } }),
        createElement('span', { className: 'player-name' }, name)
    ]);
    
    playerList.appendChild(playerItem);
    return playerItem;
}

/**
 * Remove a player from the player list in the UI
 * @param {string} id - Player ID
 * @returns {boolean} - Whether player was successfully removed
 */
export function removePlayerFromList(id) {
    const playerElement = getElement(`player-${id}`);
    if (playerElement) {
        playerElement.remove();
        return true;
    }
    return false;
}

/**
 * Update player name in the player list
 * @param {string} id - Player ID
 * @param {string} name - New player name
 * @returns {boolean} - Whether player was successfully updated
 */
export function updatePlayerName(id, name) {
    const playerElement = getElement(`player-${id}`);
    if (playerElement) {
        const nameSpan = playerElement.querySelector('.player-name');
        if (nameSpan) {
            nameSpan.textContent = name;
            return true;
        }
    }
    return false;
}

/**
 * Update player color in the player list
 * @param {string} id - Player ID
 * @param {string} color - New player color
 * @returns {boolean} - Whether player was successfully updated
 */
export function updatePlayerColor(id, color) {
    const playerElement = getElement(`player-${id}`);
    if (playerElement) {
        const colorSpan = playerElement.querySelector('.player-color');
        if (colorSpan) {
            colorSpan.style.backgroundColor = color;
            return true;
        }
    }
    return false;
}

/**
 * Get all players from the player list
 * @returns {Array} - Array of player elements
 */
export function getAllPlayers() {
    const playerList = getElement('player-list');
    if (!playerList) return [];
    
    return Array.from(playerList.querySelectorAll('.player-item'));
}

/**
 * Clear all players from the player list
 */
export function clearPlayerList() {
    const playerList = getElement('player-list');
    if (playerList) {
        playerList.innerHTML = '';
    }
}

// Export all player UI functions
export default {
    addPlayerToList,
    removePlayerFromList,
    updatePlayerName,
    updatePlayerColor,
    getAllPlayers,
    clearPlayerList
}; 