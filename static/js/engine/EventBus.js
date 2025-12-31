/**
 * EventBus - Pub/Sub messaging system for loose coupling between systems
 *
 * Usage:
 *   import { eventBus } from './engine/EventBus.js';
 *
 *   // Subscribe to events
 *   eventBus.on('vehicle:collision', (data) => handleCollision(data));
 *
 *   // Emit events
 *   eventBus.emit('vehicle:collision', { vehicleA, vehicleB, force });
 *
 *   // One-time listener
 *   eventBus.once('game:start', () => initializeGame());
 *
 *   // Unsubscribe
 *   const handler = (data) => console.log(data);
 *   eventBus.on('test', handler);
 *   eventBus.off('test', handler);
 */

class EventBus {
    constructor() {
        this.listeners = new Map();
        this.onceListeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name (e.g., 'vehicle:collision')
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // Return unsubscribe function for convenience
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event once (auto-unsubscribes after first call)
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    once(event, callback) {
        if (!this.onceListeners.has(event)) {
            this.onceListeners.set(event, new Set());
        }
        this.onceListeners.get(event).add(callback);

        return () => {
            const listeners = this.onceListeners.get(event);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function to remove
     */
    off(event, callback) {
        const listeners = this.listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }

        const onceListeners = this.onceListeners.get(event);
        if (onceListeners) {
            onceListeners.delete(callback);
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} event - Event name
     * @param {*} data - Data to pass to handlers
     */
    emit(event, data) {
        // Call regular listeners
        const listeners = this.listeners.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event handler for '${event}':`, error);
                }
            });
        }

        // Call once listeners and remove them
        const onceListeners = this.onceListeners.get(event);
        if (onceListeners) {
            onceListeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in once handler for '${event}':`, error);
                }
            });
            this.onceListeners.delete(event);
        }
    }

    /**
     * Remove all listeners for an event, or all events if no event specified
     * @param {string} [event] - Event name (optional)
     */
    clear(event) {
        if (event) {
            this.listeners.delete(event);
            this.onceListeners.delete(event);
        } else {
            this.listeners.clear();
            this.onceListeners.clear();
        }
    }

    /**
     * Get count of listeners for an event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
        const regular = this.listeners.get(event)?.size || 0;
        const once = this.onceListeners.get(event)?.size || 0;
        return regular + once;
    }

    /**
     * Check if an event has any listeners
     * @param {string} event - Event name
     * @returns {boolean}
     */
    hasListeners(event) {
        return this.listenerCount(event) > 0;
    }
}

// Singleton instance for application-wide use
const eventBus = new EventBus();

// Export both the class and singleton
// For ES Modules
export { EventBus, eventBus };

// For compatibility with non-module scripts
if (typeof window !== 'undefined') {
    window.EventBus = EventBus;
    window.eventBus = eventBus;
}
