// domUtils.js - Generic DOM manipulation utilities
// A lean utility module focused solely on DOM operations without game-specific logic

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
 * Find element by selector, without caching
 * @param {string} selector - CSS selector
 * @param {HTMLElement|Document} context - Context to search within
 * @returns {HTMLElement|null} - The DOM element or null if not found
 */
export function querySelector(selector, context = document) {
    return context.querySelector(selector);
}

/**
 * Find all elements matching selector, without caching
 * @param {string} selector - CSS selector
 * @param {HTMLElement|Document} context - Context to search within
 * @returns {NodeList} - List of matching elements
 */
export function querySelectorAll(selector, context = document) {
    return context.querySelectorAll(selector);
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
 * Set the text content of an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} text - Text to set
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function setText(idOrElement, text) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element) {
        element.textContent = text;
    }
    return element;
}

/**
 * Set HTML content of an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} html - HTML content to set
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function setHTML(idOrElement, html) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element) {
        element.innerHTML = html;
    }
    return element;
}

/**
 * Add a CSS class to an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} className - CSS class to add
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function addClass(idOrElement, className) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element && !element.classList.contains(className)) {
        element.classList.add(className);
    }
    return element;
}

/**
 * Remove a CSS class from an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} className - CSS class to remove
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function removeClass(idOrElement, className) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element && element.classList.contains(className)) {
        element.classList.remove(className);
    }
    return element;
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
 * Check if element has a CSS class
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} className - CSS class to check
 * @returns {boolean} - Whether the class is applied
 */
export function hasClass(idOrElement, className) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    return element ? element.classList.contains(className) : false;
}

/**
 * Show or hide an element by adding/removing 'hidden' class
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {boolean} visible - Whether to show (true) or hide (false) the element
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function setVisible(idOrElement, visible) {
    if (visible) {
        return removeClass(idOrElement, 'hidden');
    } else {
        return addClass(idOrElement, 'hidden');
    }
}

/**
 * Get or set attribute on an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} attrName - Attribute name
 * @param {string} [value] - Value to set (if omitted, returns current value)
 * @returns {string|HTMLElement|null} - Attribute value when getting, element when setting, null if not found
 */
export function attr(idOrElement, attrName, value) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (!element) return null;
    
    if (value === undefined) {
        return element.getAttribute(attrName);
    } else {
        element.setAttribute(attrName, value);
        return element;
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
 * Add event listener to an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} event - Event name
 * @param {Function} callback - Event handler
 * @param {Object} [options] - Event listener options
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function on(idOrElement, event, callback, options) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element) {
        element.addEventListener(event, callback, options);
    }
    return element;
}

/**
 * Remove event listener from an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {string} event - Event name
 * @param {Function} callback - Event handler
 * @param {Object} [options] - Event listener options
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function off(idOrElement, event, callback, options) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element) {
        element.removeEventListener(event, callback, options);
    }
    return element;
}

/**
 * Create a bar indicator (for visualizing values)
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
 * Toggle fullscreen mode
 * @param {HTMLElement|string} idOrElement - Element to make fullscreen (defaults to document.documentElement)
 * @returns {boolean} - Whether fullscreen is currently active
 */
export function toggleFullscreen(idOrElement = document.documentElement) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    
    if (!element) {
        console.error('Element not found for fullscreen toggle');
        return false;
    }
    
    try {
        if (!document.fullscreenElement) {
            // Enter fullscreen
            if (element.requestFullscreen) {
                element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) { /* Safari */
                element.webkitRequestFullscreen();
            } else if (element.msRequestFullscreen) { /* IE11 */
                element.msRequestFullscreen();
            }
            return true;
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { /* Safari */
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) { /* IE11 */
                document.msExitFullscreen();
            }
            return false;
        }
    } catch (e) {
        console.error('Error toggling fullscreen:', e);
        return !!document.fullscreenElement;
    }
}

/**
 * Update the fullscreen button based on current fullscreen state
 * @param {boolean} isFullscreen - Whether the page is currently in fullscreen mode
 */
export function updateFullscreenButton(isFullscreen) {
    const fullscreenBtn = getElement('fullscreen-btn');
    if (!fullscreenBtn) return;
    
    if (isFullscreen) {
        fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        fullscreenBtn.title = 'Exit Fullscreen';
    } else {
        fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
        fullscreenBtn.title = 'Enter Fullscreen';
    }
}

/**
 * Prevent default behavior of an event
 * @param {Event} event - The event to prevent default behavior for
 */
export function preventDefault(event) {
    if (event && event.preventDefault) {
        event.preventDefault();
    }
}

/**
 * Stop event propagation
 * @param {Event} event - The event to stop propagation on
 */
export function stopPropagation(event) {
    if (event && event.stopPropagation) {
        event.stopPropagation();
    }
}

/**
 * Apply CSS styles to an element
 * @param {string|HTMLElement} idOrElement - Element ID or element object
 * @param {Object} styles - Styles to apply
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function applyStyles(idOrElement, styles) {
    const element = typeof idOrElement === 'string' ? getElement(idOrElement) : idOrElement;
    if (element && styles) {
        Object.entries(styles).forEach(([property, value]) => {
            element.style[property] = value;
        });
    }
    return element;
}

// Export all DOM utility functions
export default {
    getElement,
    querySelector,
    querySelectorAll,
    getElements,
    setText,
    setHTML,
    addClass,
    removeClass,
    toggleClass,
    hasClass,
    setVisible,
    attr,
    createElement,
    on,
    off,
    createBarIndicator,
    toggleFullscreen,
    updateFullscreenButton,
    preventDefault,
    stopPropagation,
    applyStyles
}; 