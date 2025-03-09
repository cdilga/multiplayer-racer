// Physics UI Module - Handle physics-specific UI elements and visualization
import { getElement, createElement, toggleClass } from './domUtils.js';

/**
 * Create or update a container for physics debug visualization
 * @returns {HTMLElement} The physics debug container
 */
export function createPhysicsDebugContainer() {
    let debugContainer = getElement('physics-debug-container');
    
    if (!debugContainer) {
        debugContainer = createElement('div', { id: 'physics-debug-container' });
        document.body.appendChild(debugContainer);
    }
    
    return debugContainer;
}

/**
 * Remove physics debug visualization elements from the DOM
 */
export function removePhysicsDebugObjects() {
    const debugContainer = getElement('physics-debug-container');
    if (debugContainer) {
        debugContainer.remove();
    }
}

/**
 * Set up the physics parameters panel and UI controls
 * @param {Object} config - Configuration with parameter groups, labels, etc.
 * @param {Function} updateCallback - Callback when a parameter is changed
 * @returns {HTMLElement} - The created panel
 */
export function setupPhysicsParametersPanel(config, updateCallback) {
    const gameScreen = getElement('game-screen');
    
    // Remove existing panel if it exists
    const existingPanel = getElement('physics-params-panel');
    if (existingPanel) {
        existingPanel.remove();
    }
    
    // Create panel
    const panel = createElement('div', { 
        id: 'physics-params-panel',
        className: 'physics-panel hidden'
    });
    
    // Create tabs for parameters
    const tabsContainer = createElement('div', { className: 'tabs-container' });
    const tabsContent = createElement('div', { className: 'tabs-content' });
    
    // Create the tab buttons
    const carTab = createElement('button', { className: 'tab-button active', 'data-tab': 'car-params' }, 'Car');
    const worldTab = createElement('button', { className: 'tab-button', 'data-tab': 'world-params' }, 'World');
    const wheelsTab = createElement('button', { className: 'tab-button', 'data-tab': 'wheels-params' }, 'Wheels');
    
    tabsContainer.appendChild(carTab);
    tabsContainer.appendChild(worldTab);
    tabsContainer.appendChild(wheelsTab);
    
    // Create the tab content containers
    const carParams = createElement('div', { id: 'car-params', className: 'tab-content active' });
    const worldParams = createElement('div', { id: 'world-params', className: 'tab-content' });
    const wheelsParams = createElement('div', { id: 'wheels-params', className: 'tab-content' });
    
    // Create parameter groups inside each tab
    // Car parameters - two groups: body and movement
    const carBodyGroup = createElement('div', { className: 'params-group' });
    const carBodyHeading = createElement('h4', {}, 'Car Body');
    carBodyGroup.appendChild(carBodyHeading);
    
    const movementGroup = createElement('div', { className: 'params-group' });
    const movementHeading = createElement('h4', {}, 'Movement');
    movementGroup.appendChild(movementHeading);
    
    carParams.appendChild(carBodyGroup);
    carParams.appendChild(movementGroup);
    
    // World parameters - one group
    const worldGroup = createElement('div', { className: 'params-group' });
    const worldHeading = createElement('h4', {}, 'World Physics');
    worldGroup.appendChild(worldHeading);
    worldParams.appendChild(worldGroup);
    
    // Wheels parameters - one group
    const wheelsGroup = createElement('div', { className: 'params-group' });
    const wheelsHeading = createElement('h4', {}, 'Wheel Properties');
    wheelsGroup.appendChild(wheelsHeading);
    wheelsParams.appendChild(wheelsGroup);
    
    // Add the tab contents to the container
    tabsContent.appendChild(carParams);
    tabsContent.appendChild(worldParams);
    tabsContent.appendChild(wheelsParams);
    
    // Create buttons container at the bottom of the panel
    const buttonsContainer = createElement('div', { className: 'buttons-container' });
    
    // Add reset button
    const resetButton = createElement('button', { 
        id: 'reset-physics', 
        className: 'physics-button'
    }, 'Reset to Defaults');
    
    // Add close button
    const closeButton = createElement('button', { 
        id: 'close-physics-panel', 
        className: 'physics-button'
    }, 'Close');
    
    buttonsContainer.appendChild(resetButton);
    buttonsContainer.appendChild(closeButton);
    
    panel.appendChild(tabsContainer);
    panel.appendChild(tabsContent);
    panel.appendChild(buttonsContainer);
    
    if (gameScreen) {
        gameScreen.appendChild(panel);
    } else {
        document.body.appendChild(panel);
    }
    
    return panel;
}

/**
 * Toggle visibility of the physics panel
 * @returns {boolean} Whether the panel is now visible
 */
export function togglePhysicsPanel() {
    const panel = getElement('physics-params-panel');
    if (!panel) return false;
    
    return toggleClass(panel, 'hidden');
}

/**
 * Create a parameter control for the physics UI
 * @param {HTMLElement} container - Container to add the control to
 * @param {string} group - Parameter group name
 * @param {string} param - Parameter name
 * @param {string} label - Display label
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} step - Step size for input
 * @param {Function} onChange - Callback when value changes
 * @returns {Object} - Object containing input and valueDisplay elements
 */
export function createParameterControl(container, group, param, label, min, max, step, onChange) {
    const controlRow = createElement('div', { className: 'control-row' });
    
    const labelElement = createElement('label', {}, label);
    const input = createElement('input', {
        type: 'range',
        min: min.toString(),
        max: max.toString(),
        step: step.toString(),
        'data-group': group,
        'data-param': param
    });
    
    const valueDisplay = createElement('span', { className: 'value-display' });
    
    // Set up event listener
    input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        valueDisplay.textContent = value.toFixed(2);
        if (onChange) {
            onChange(group, param, value);
        }
    });
    
    controlRow.appendChild(labelElement);
    controlRow.appendChild(input);
    controlRow.appendChild(valueDisplay);
    container.appendChild(controlRow);
    
    return { input, valueDisplay };
}

/**
 * Add styles for physics debug visualization
 */
export function addPhysicsDebugStyles() {
    const styleId = 'physics-debug-styles';
    if (document.getElementById(styleId)) return;
    
    const styleElement = createElement('style', { id: styleId });
    styleElement.textContent = `
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
        .control-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }
        .control-row label {
            flex: 0 0 30%;
        }
        .control-row input {
            flex: 0 0 50%;
        }
        .value-display {
            flex: 0 0 15%;
            text-align: right;
        }
        .buttons-row {
            display: flex;
            justify-content: space-between;
            margin-top: 10px;
        }
        .buttons-row button {
            flex: 0 0 48%;
            padding: 5px;
            background-color: #333;
            color: white;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
        }
        .buttons-row button:hover {
            background-color: #444;
        }
        
        /* Force visualization styles */
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
    
    document.head.appendChild(styleElement);
}

// Call this when the module is loaded to ensure styles are available
addPhysicsDebugStyles();

// Export all physics UI functions
export default {
    createPhysicsDebugContainer,
    removePhysicsDebugObjects,
    setupPhysicsParametersPanel,
    togglePhysicsPanel,
    createParameterControl,
    addPhysicsDebugStyles
}; 