// statsUI.js - Stats display and management
import { getElement, setHTML, createBarIndicator } from './domUtils.js';

/**
 * Initialize stats overlay UI
 */
export function initStatsOverlay() {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) return;
    
    // Set initial content
    setHTML(statsOverlay, '<div class="stats-header">Game Stats (Press F3 to toggle)</div>');
    
    // Make sure the overlay is hidden initially
    statsOverlay.classList.add('hidden');
}

/**
 * Update stats display with pre-formatted content
 * @param {string} content - Pre-formatted HTML content to display
 */
export function updateStatsDisplay(content) {
    const statsOverlay = getElement('stats-overlay');
    if (!statsOverlay) {
        console.error("Stats overlay element not found!");
        return;
    }
        
    // Update the content
    setHTML(statsOverlay, content);
    
    // Make sure the overlay is visible if gameState.showStats is true
    if (window.gameState && window.gameState.showStats) {
        statsOverlay.classList.remove('hidden');
    }
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
 * Format game stats into HTML for display
 * @param {Object} stats - Basic stats data (fps, counters, etc.)
 * @param {Object} gameState - The game state with detailed car and player information
 * @returns {string} - Formatted HTML for the stats display
 */
export function formatStatsDisplay(stats, gameState) {
    
    // If we have cars, log details about the first car
    if (gameState && gameState.cars && Object.keys(gameState.cars).length > 0) {
        const firstCarId = Object.keys(gameState.cars)[0];
        const firstCar = gameState.cars[firstCarId];
    }
    
    let statsHTML = '<div class="stats-header">Game Stats (Press F3 to toggle)</div>';
    
    // Add physics engine status
    const physicsStatus = stats.physicsStatus === 'Active' ? 
        '<span style="color:green">Active</span>' : 
        '<span style="color:red">Unavailable</span>';
    
    statsHTML += `<div>Physics: ${physicsStatus}</div>`;
    statsHTML += `<div>Rapier Loaded: ${stats.rapierLoaded === 'Yes' ? '<span style="color:green">Yes</span>' : '<span style="color:red">No</span>'}</div>`;
    
    // Add physics debug status
    const debugStatus = stats.physicsDebug === 'ON' ? 
        '<span style="color:green">ON</span> (Press F4 to toggle)' : 
        '<span style="color:#888">OFF</span> (Press F4 to toggle)';
    statsHTML += `<div>Physics Debug: ${debugStatus}</div>`;
    
    // Add FPS counter
    statsHTML += `<div>FPS: ${stats.fps}</div>`;
    statsHTML += `<div>Players: ${stats.playerCount}</div>`;
    statsHTML += `<div>Cars: ${stats.carCount}</div>`;
    
    // Add physics update counter
    statsHTML += `<div>Physics Updates: ${stats.physicsUpdates || 0}</div>`;
    if (stats.physicsDebug === 'ON') {
        statsHTML += `<div>Debug Lines: ${stats.debugLines || 0}</div>`;
    }
    
    // Add detailed player stats with controls and enhanced physics information
    if (gameState && gameState.cars) {
        statsHTML += '<div class="stats-section">Player Stats & Car Physics:</div>';
        
        Object.keys(gameState.cars).forEach(playerId => {
            const car = gameState.cars[playerId];
            const player = gameState.players[playerId];
            if (!car || !player) return;
            
            // Add player section
            statsHTML += formatPlayerStats(playerId, player, car);
        });
    }
    
    return statsHTML;
}

/**
 * Format stats for a single player/car
 * @param {string} playerId - Player ID
 * @param {Object} player - Player data
 * @param {Object} car - Car data
 * @returns {string} - Formatted HTML for the player stats
 */
function formatPlayerStats(playerId, player, car) {
    // Calculate speed from velocity
    let speed = 0;
    let posX = 0, posY = 0, posZ = 0;
    let rotX = 0, rotY = 0, rotZ = 0, rotW = 0;
    let isUpsideDown = false;
    
    // Get physics state (if available)
    if (car.physicsBody) {
        const vel = car.physicsBody.linvel();
        const pos = car.physicsBody.translation();
        const rot = car.physicsBody.rotation();
        
        // Velocity and position
        speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6; // Convert to km/h
        posX = Math.round(pos.x * 100) / 100;
        posY = Math.round(pos.y * 100) / 100;
        posZ = Math.round(pos.z * 100) / 100;
        
        // Rotation
        rotX = Math.round(rot.x * 100) / 100;
        rotY = Math.round(rot.y * 100) / 100;
        rotZ = Math.round(rot.z * 100) / 100;
        rotW = Math.round(rot.w * 100) / 100;
        
        // Check if car is upside down
        if (car.physicsBody.userData && typeof car.physicsBody.userData.isUpsideDown === 'function') {
            isUpsideDown = car.physicsBody.userData.isUpsideDown();
        }
    }
    
    // Get physics body state
    let physicsState = "No Physics Body";
    let velocityInfo = "";
    
    if (car.physicsBody) {
        const vel = car.physicsBody.linvel();
        const isAwake = typeof car.physicsBody.isAwake === 'function' ? 
            car.physicsBody.isAwake() : "Unknown";
            
        physicsState = `Active: ${isAwake}`;
        velocityInfo = `<div>Velocity: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})</div>`;
        
        // Add upside down indicator
        if (isUpsideDown) {
            physicsState += ' <span style="color:red; font-weight:bold;">UPSIDE DOWN</span>';
        }
    }
    
    // Get player controls
    let controlsHTML = formatControlsInfo(car);
    
    // Add applied forces display if available
    let forcesHTML = formatForcesInfo(car);
    
    // Put it all together
    return `
        <div class="player-stats">
            <div class="player-header" style="color: ${player.color || player.carColor}">
                ${player.name} (ID: ${playerId})
            </div>
            <div>Speed: ${speed.toFixed(1)} km/h</div>
            <div>Position: (${posX}, ${posY}, ${posZ})</div>
            ${velocityInfo}
            <div>Rotation: (${rotY.toFixed(2)}, ${rotX.toFixed(2)}, ${rotZ.toFixed(2)}, ${rotW.toFixed(2)})</div>
            <div>Physics: ${physicsState}</div>
            <div class="controls-section">
                <div class="controls-header">Controls:</div>
                ${controlsHTML}
            </div>
            ${forcesHTML}
        </div>
    `;
}

/**
 * Format controls information for a car
 * @param {Object} car - Car data with controls
 * @returns {string} - Formatted HTML for controls display
 */
function formatControlsInfo(car) {
    if (!car.controls) {
        return '<div class="control-info">No controls received</div>';
    }
    
    const timeSinceLastControl = car.lastControlUpdate ? 
        Math.round((Date.now() - car.lastControlUpdate) / 1000) : 'N/A';
    
    return `
    <div class="control-info">
        <div class="control-row">
            <span>Steering:</span>
                ${createBarIndicator(car.controls.steering, -1, 1).outerHTML}
                <span class="value">${car.controls.steering.toFixed(2)}</span>
        </div>
        <div class="control-row">
                <span>Acceleration:</span>
                ${createBarIndicator(car.controls.acceleration, 0, 1).outerHTML}
                <span class="value">${car.controls.acceleration.toFixed(2)}</span>
        </div>
        <div class="control-row">
                <span>Braking:</span>
                ${createBarIndicator(car.controls.braking, 0, 1).outerHTML}
                <span class="value">${car.controls.braking.toFixed(2)}</span>
        </div>
        <div class="control-time">Last update: ${timeSinceLastControl}s ago</div>
    </div>`;
}

/**
 * Format forces information for a car
 * @param {Object} car - Car data with physics body
 * @returns {string} - Formatted HTML for forces display
 */
function formatForcesInfo(car) {
    if (!car.physicsBody || !car.physicsBody.userData || !car.physicsBody.userData.lastAppliedForces) {
        return '';
    }
    
    const forces = car.physicsBody.userData.lastAppliedForces;
    
    return `
        <div class="forces-section">
            <div class="forces-header">Applied Forces:</div>
        <div class="control-info">
            <div class="control-row">
                    <span>Engine:</span>
                    ${createBarIndicator(forces.engineForce/5000, 0, 1).outerHTML} 
                    <span class="value">${forces.engineForce.toFixed(0)}N</span>
            </div>
            <div class="control-row">
                    <span>Brake:</span>
                    ${createBarIndicator(forces.brakeForce/5000, 0, 1).outerHTML}
                    <span class="value">${forces.brakeForce.toFixed(0)}N</span>
            </div>
            <div class="control-row">
                    <span>Steering:</span>
                    ${createBarIndicator(forces.steeringTorque/500, -1, 1).outerHTML}
                    <span class="value">${forces.steeringTorque.toFixed(0)}Nm</span>
            </div>
                <div class="control-row">
                    <span>Grip:</span>
                    ${createBarIndicator(forces.lateralForce/2000, -1, 1).outerHTML}
                    <span class="value">${forces.lateralForce.toFixed(0)}N</span>
                </div>
                <div class="control-row">
                    <span>Drag:</span>
                    ${createBarIndicator(forces.dragForce/1000, 0, 1).outerHTML}
                    <span class="value">${forces.dragForce.toFixed(0)}N</span>
                </div>
            </div>
        </div>`;
}

/**
 * Collect basic stats data from game state
 * @param {Object} gameState - The current game state
 * @returns {Object} - Basic stats data object
 */
export function collectBasicStats(gameState) {
    return {
        fps: gameState.fps,
        physicsUpdates: gameState.debugCounters.physicsUpdate,
        controlsUpdates: gameState.debugCounters.controlsUpdate,
        debugLines: gameState.debugCounters.physicsDebugLines,
        playerCount: Object.keys(gameState.players).length,
        carCount: Object.keys(gameState.cars).length,
        physicsStatus: gameState.physics.usingRapier ? 'Active' : 'Unavailable',
        rapierLoaded: window.rapierLoaded ? 'Yes' : 'No',
        physicsDebug: gameState.showPhysicsDebug ? 'ON' : 'OFF'
    };
}

// Export all stats UI functions
export default {
    initStatsOverlay,
    updateStatsDisplay,
    toggleStatsDisplay,
    showStatsDisplay,
    hideStatsDisplay,
    formatStatsDisplay,
    collectBasicStats
}; 