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
        className: 'physics-panel'
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
    
    // Add rectangular dimensions controls to car body group
    createParameterControl(carBodyGroup, 'carBody', 'width', 'Width', 0.5, 3.0, 0.1, updateCallback);
    createParameterControl(carBodyGroup, 'carBody', 'height', 'Height', 0.5, 2.0, 0.1, updateCallback);
    createParameterControl(carBodyGroup, 'carBody', 'length', 'Length', 1.0, 5.0, 0.1, updateCallback);
    
    const movementGroup = createElement('div', { className: 'params-group' });
    const movementHeading = createElement('h4', {}, 'Movement');
    movementGroup.appendChild(movementHeading);
    
    // Add movement controls
    createParameterControl(movementGroup, 'movement', 'forwardSpeed', 'Forward Speed', 1.0, 20.0, 0.5, updateCallback);
    createParameterControl(movementGroup, 'movement', 'reverseSpeed', 'Reverse Speed', 1.0, 15.0, 0.5, updateCallback);
    createParameterControl(movementGroup, 'movement', 'maxSteeringAngle', 'Steering Angle', 10, 60, 1, updateCallback);
    
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
    // Try to get the panel using getElement
    let panel = getElement('physics-params-panel');
    
    // If not found, try direct DOM query as fallback
    if (!panel) {
        console.warn('Panel not found via getElement, trying direct DOM query');
        panel = document.getElementById('physics-params-panel');
    }
    
    if (!panel) {
        console.error('Physics panel not found in DOM');
        return false;
    }
    
    console.log('Physics panel found, toggling visibility');
    
    // Toggle the 'visible' class instead of 'hidden' to match the CSS in host.css
    const isVisible = panel.classList.toggle('visible');
    console.log('Panel visibility toggled, isVisible:', isVisible);
    
    return isVisible;
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
            
            // Call applyPhysicsChanges if it exists in the window object
            if (typeof window.applyPhysicsChanges === 'function') {
                window.applyPhysicsChanges();
            }
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

/**
 * Remove THREE.js physics debug objects from the scene and dispose of resources
 * @param {Array} debugObjects - Array of debug objects to remove
 */
export function removePhysicsDebugMeshes(debugObjects) {
    if (!debugObjects || !Array.isArray(debugObjects)) return;
    
    // Remove all debug objects from scene and dispose of geometries/materials
    debugObjects.forEach(obj => {
        if (!obj) return;
        
        // Remove from parent (scene)
        if (obj.parent) {
            obj.parent.remove(obj);
        }
        
        // Dispose of geometry and materials to prevent memory leaks
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(material => material.dispose());
            } else {
                obj.material.dispose();
            }
        }
        
        // If it's a group, recursively remove all children
        if (obj.children && obj.children.length > 0) {
            // Create a copy of the children array since it will be modified during removal
            const children = [...obj.children];
            children.forEach(child => {
                obj.remove(child);
                
                // Dispose of geometry and materials
                if (child.geometry) {
                    child.geometry.dispose();
                }
                
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => material.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
    });
    
    // Clear the array
    debugObjects.length = 0;
}

/**
 * Update car dimensions based on physics panel inputs
 * @param {Object} carBody - The car rigid body
 * @param {string} param - The parameter being changed (width, height, length)
 * @param {number} value - The new value
 * @param {Object} world - Rapier physics world
 * @param {Object} rapier - Rapier physics instance
 * @param {Function} updateCarDimensions - Function from carKinematicController to update dimensions
 * @returns {boolean} Success status
 */
export function updateCarDimensionsFromPanel(carBody, param, value, world, rapier, updateCarDimensions) {
    if (!carBody || !world || !rapier || !updateCarDimensions) {
        console.error('Missing required parameters for updateCarDimensionsFromPanel');
        return false;
    }
    
    try {
        // Get current dimensions from userData
        const currentDimensions = carBody.userData?.dimensions || { width: 1.0, height: 0.5, length: 2.0 };
        
        // Create new dimensions object with the updated parameter
        const newDimensions = { ...currentDimensions };
        
        // Update the specific dimension
        if (param === 'width' || param === 'height' || param === 'length') {
            newDimensions[param] = value;
        } else {
            console.warn(`Unknown dimension parameter: ${param}`);
            return false;
        }
        
        // Call the updateCarDimensions function
        return updateCarDimensions(carBody, newDimensions, world, rapier);
    } catch (error) {
        console.error('Error updating car dimensions from panel:', error);
        return false;
    }
}

/**
 * Initialize physics panel controls with current car data
 * @param {Object} carBody - The car rigid body
 * @returns {boolean} Success status
 */
export function initializePhysicsPanelWithCarData(carBody) {
    if (!carBody || !carBody.userData) {
        console.error('Invalid car body for initializing physics panel');
        return false;
    }
    
    try {
        // Get current dimensions from userData
        const dimensions = carBody.userData.dimensions || { width: 1.0, height: 0.5, length: 2.0 };
        const config = carBody.userData.config || {};
        
        // Update dimension controls
        updateControlValue('carBody', 'width', dimensions.width);
        updateControlValue('carBody', 'height', dimensions.height);
        updateControlValue('carBody', 'length', dimensions.length);
        
        // Update movement controls if they exist
        if (config.forwardSpeed) {
            updateControlValue('movement', 'forwardSpeed', config.forwardSpeed);
        }
        if (config.reverseSpeed) {
            updateControlValue('movement', 'reverseSpeed', config.reverseSpeed);
        }
        if (config.maxSteeringAngle) {
            // Convert from radians to a more UI-friendly value (0-100)
            const steeringValue = config.maxSteeringAngle * (180 / Math.PI);
            updateControlValue('movement', 'maxSteeringAngle', steeringValue);
        }
        
        return true;
    } catch (error) {
        console.error('Error initializing physics panel with car data:', error);
        return false;
    }
}

/**
 * Helper function to update a control value in the physics panel
 * @param {string} group - Parameter group name
 * @param {string} param - Parameter name
 * @param {number} value - New value
 */
function updateControlValue(group, param, value) {
    // Find the input element
    const input = document.querySelector(`input[data-group="${group}"][data-param="${param}"]`);
    if (!input) return;
    
    // Update the input value
    input.value = value;
    
    // Update the display value
    const valueDisplay = input.nextElementSibling;
    if (valueDisplay && valueDisplay.classList.contains('value-display')) {
        valueDisplay.textContent = value.toFixed(2);
    }
}

/**
 * Update car movement parameters based on physics panel inputs
 * @param {Object} carBody - The car rigid body
 * @param {string} param - The parameter being changed
 * @param {number} value - The new value
 * @param {Function} updateCarMovementParams - Function from carKinematicController to update movement params
 * @returns {boolean} Success status
 */
export function updateCarMovementFromPanel(carBody, param, value, updateCarMovementParams) {
    if (!carBody || !updateCarMovementParams) {
        console.error('Missing required parameters for updateCarMovementFromPanel');
        return false;
    }
    
    try {
        // Call the updateCarMovementParams function
        return updateCarMovementParams(carBody, param, value);
    } catch (error) {
        console.error('Error updating car movement from panel:', error);
        return false;
    }
}

// Export all physics UI functions
export default {
    createPhysicsDebugContainer,
    removePhysicsDebugObjects,
    setupPhysicsParametersPanel,
    togglePhysicsPanel,
    createParameterControl,
    addPhysicsDebugStyles,
    removePhysicsDebugMeshes,
    updateCarDimensionsFromPanel,
    initializePhysicsPanelWithCarData,
    updateCarMovementFromPanel
}; 