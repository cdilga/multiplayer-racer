/**
 * Entity - Base class for all game entities
 *
 * Provides common functionality for game objects:
 * - Unique ID generation
 * - Component management
 * - Transform (position, rotation, scale)
 * - Lifecycle methods (init, update, destroy)
 *
 * Usage:
 *   class Vehicle extends Entity {
 *     constructor(config) {
 *       super({ type: 'vehicle', ...config });
 *       this.addComponent('physics', physicsComponent);
 *     }
 *   }
 */

class Entity {
    /**
     * @param {Object} options
     * @param {string} [options.id] - Unique ID (auto-generated if not provided)
     * @param {string} [options.type] - Entity type (e.g., 'vehicle', 'track')
     * @param {Object} [options.position] - Initial position { x, y, z }
     * @param {Object} [options.rotation] - Initial rotation { x, y, z } in radians
     * @param {Object} [options.scale] - Initial scale { x, y, z }
     */
    constructor(options = {}) {
        this.id = options.id || Entity.generateId();
        this.type = options.type || 'entity';

        // Transform
        this.position = { x: 0, y: 0, z: 0, ...options.position };
        this.rotation = { x: 0, y: 0, z: 0, ...options.rotation };
        this.scale = { x: 1, y: 1, z: 1, ...options.scale };

        // Components map
        this.components = new Map();

        // Tags for filtering
        this.tags = new Set(options.tags || []);

        // Active state
        this.active = true;

        // Parent/child relationships
        this.parent = null;
        this.children = [];

        // Metadata
        this.userData = {};
    }

    /**
     * Generate unique ID
     * @static
     * @returns {string}
     */
    static generateId() {
        return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Initialize the entity (called after construction)
     * Override in subclasses for async initialization
     * @returns {Promise<void>}
     */
    async init() {
        // Initialize all components
        for (const [name, component] of this.components) {
            if (typeof component.init === 'function') {
                await component.init(this);
            }
        }
    }

    /**
     * Update the entity (called each frame)
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.active) return;

        // Update all components
        for (const [name, component] of this.components) {
            if (typeof component.update === 'function') {
                component.update(dt, this);
            }
        }

        // Update children
        for (const child of this.children) {
            child.update(dt);
        }
    }

    /**
     * Destroy the entity and cleanup
     */
    destroy() {
        // Destroy all components
        for (const [name, component] of this.components) {
            if (typeof component.destroy === 'function') {
                component.destroy(this);
            }
        }
        this.components.clear();

        // Destroy children
        for (const child of this.children) {
            child.destroy();
        }
        this.children = [];

        // Remove from parent
        if (this.parent) {
            this.parent.removeChild(this);
        }

        this.active = false;
    }

    /**
     * Add a component
     * @param {string} name - Component name
     * @param {Object} component - Component instance
     * @returns {Entity} this (for chaining)
     */
    addComponent(name, component) {
        if (this.components.has(name)) {
            console.warn(`Entity ${this.id}: Component '${name}' already exists`);
            return this;
        }

        this.components.set(name, component);

        // Set reference to owner entity
        if (component) {
            component.entity = this;
        }

        return this;
    }

    /**
     * Get a component by name
     * @param {string} name - Component name
     * @returns {Object|undefined}
     */
    getComponent(name) {
        return this.components.get(name);
    }

    /**
     * Check if entity has a component
     * @param {string} name - Component name
     * @returns {boolean}
     */
    hasComponent(name) {
        return this.components.has(name);
    }

    /**
     * Remove a component
     * @param {string} name - Component name
     * @returns {boolean} True if removed
     */
    removeComponent(name) {
        const component = this.components.get(name);
        if (component) {
            if (typeof component.destroy === 'function') {
                component.destroy(this);
            }
            component.entity = null;
            this.components.delete(name);
            return true;
        }
        return false;
    }

    /**
     * Add a tag
     * @param {string} tag
     * @returns {Entity} this
     */
    addTag(tag) {
        this.tags.add(tag);
        return this;
    }

    /**
     * Remove a tag
     * @param {string} tag
     * @returns {Entity} this
     */
    removeTag(tag) {
        this.tags.delete(tag);
        return this;
    }

    /**
     * Check if entity has a tag
     * @param {string} tag
     * @returns {boolean}
     */
    hasTag(tag) {
        return this.tags.has(tag);
    }

    /**
     * Add a child entity
     * @param {Entity} child
     * @returns {Entity} this
     */
    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
        return this;
    }

    /**
     * Remove a child entity
     * @param {Entity} child
     * @returns {boolean}
     */
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            child.parent = null;
            return true;
        }
        return false;
    }

    /**
     * Set position
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Entity} this
     */
    setPosition(x, y, z) {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
        return this;
    }

    /**
     * Set rotation (in radians)
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Entity} this
     */
    setRotation(x, y, z) {
        this.rotation.x = x;
        this.rotation.y = y;
        this.rotation.z = z;
        return this;
    }

    /**
     * Set scale
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Entity} this
     */
    setScale(x, y, z) {
        this.scale.x = x;
        this.scale.y = y;
        this.scale.z = z;
        return this;
    }

    /**
     * Get world position (accounting for parent transforms)
     * @returns {Object} { x, y, z }
     */
    getWorldPosition() {
        if (!this.parent) {
            return { ...this.position };
        }

        const parentPos = this.parent.getWorldPosition();
        return {
            x: parentPos.x + this.position.x,
            y: parentPos.y + this.position.y,
            z: parentPos.z + this.position.z
        };
    }

    /**
     * Serialize entity to JSON
     * @returns {Object}
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            position: { ...this.position },
            rotation: { ...this.rotation },
            scale: { ...this.scale },
            tags: Array.from(this.tags),
            active: this.active,
            userData: { ...this.userData }
        };
    }

    /**
     * Create entity from JSON
     * @static
     * @param {Object} json
     * @returns {Entity}
     */
    static fromJSON(json) {
        const entity = new Entity({
            id: json.id,
            type: json.type,
            position: json.position,
            rotation: json.rotation,
            scale: json.scale,
            tags: json.tags
        });
        entity.active = json.active;
        entity.userData = json.userData || {};
        return entity;
    }
}

// Export for ES Modules
export { Entity };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.Entity = Entity;
}
