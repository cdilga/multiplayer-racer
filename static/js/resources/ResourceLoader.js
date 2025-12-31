/**
 * ResourceLoader - Central asset loading and caching system
 *
 * Loads JSON definitions, textures, and other assets with caching.
 *
 * Usage:
 *   import { ResourceLoader } from './resources/ResourceLoader.js';
 *
 *   const loader = new ResourceLoader({ basePath: '/static/assets' });
 *   const vehicleConfig = await loader.loadJSON('vehicles/default.json');
 *   const trackConfig = await loader.loadJSON('tracks/oval.json');
 *
 * Events emitted:
 *   - 'resource:loading' { path, type }
 *   - 'resource:loaded' { path, type, data }
 *   - 'resource:error' { path, type, error }
 *   - 'resource:progress' { loaded, total, percent }
 */

class ResourceLoader {
    /**
     * @param {Object} options
     * @param {string} [options.basePath='/static/assets'] - Base path for assets
     * @param {EventBus} [options.eventBus] - EventBus for emitting events
     */
    constructor(options = {}) {
        this.basePath = options.basePath || '/static/assets';
        this.eventBus = options.eventBus || (typeof window !== 'undefined' ? window.eventBus : null);

        // Cache for loaded resources
        this.cache = new Map();

        // Loading queue for progress tracking
        this.loadingQueue = new Set();
        this.loadedCount = 0;
        this.totalCount = 0;
    }

    /**
     * Load a JSON file
     * @param {string} path - Path relative to basePath
     * @returns {Promise<Object>}
     */
    async loadJSON(path) {
        const fullPath = this._resolvePath(path);

        // Check cache
        if (this.cache.has(fullPath)) {
            return this.cache.get(fullPath);
        }

        this._emit('resource:loading', { path: fullPath, type: 'json' });
        this.loadingQueue.add(fullPath);
        this.totalCount++;

        try {
            const response = await fetch(fullPath);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Cache the result
            this.cache.set(fullPath, data);

            this.loadingQueue.delete(fullPath);
            this.loadedCount++;
            this._emitProgress();
            this._emit('resource:loaded', { path: fullPath, type: 'json', data });

            return data;

        } catch (error) {
            this.loadingQueue.delete(fullPath);
            this._emit('resource:error', { path: fullPath, type: 'json', error });
            throw new Error(`Failed to load JSON '${fullPath}': ${error.message}`);
        }
    }

    /**
     * Load multiple JSON files in parallel
     * @param {string[]} paths - Array of paths relative to basePath
     * @returns {Promise<Object[]>}
     */
    async loadJSONBatch(paths) {
        return Promise.all(paths.map(path => this.loadJSON(path)));
    }

    /**
     * Load a vehicle definition
     * @param {string} vehicleId - Vehicle ID (e.g., 'default', 'truck')
     * @returns {Promise<Object>}
     */
    async loadVehicle(vehicleId) {
        return this.loadJSON(`vehicles/${vehicleId}.json`);
    }

    /**
     * Load a track definition
     * @param {string} trackId - Track ID (e.g., 'oval', 'figure8')
     * @returns {Promise<Object>}
     */
    async loadTrack(trackId) {
        return this.loadJSON(`tracks/${trackId}.json`);
    }

    /**
     * Preload a list of resources
     * @param {Object} manifest - { vehicles: [...], tracks: [...] }
     * @returns {Promise<void>}
     */
    async preload(manifest) {
        const promises = [];

        if (manifest.vehicles) {
            manifest.vehicles.forEach(id => {
                promises.push(this.loadVehicle(id));
            });
        }

        if (manifest.tracks) {
            manifest.tracks.forEach(id => {
                promises.push(this.loadTrack(id));
            });
        }

        if (manifest.json) {
            manifest.json.forEach(path => {
                promises.push(this.loadJSON(path));
            });
        }

        await Promise.all(promises);
    }

    /**
     * Get a cached resource
     * @param {string} path - Full or relative path
     * @returns {Object|undefined}
     */
    get(path) {
        const fullPath = this._resolvePath(path);
        return this.cache.get(fullPath);
    }

    /**
     * Check if a resource is cached
     * @param {string} path - Full or relative path
     * @returns {boolean}
     */
    has(path) {
        const fullPath = this._resolvePath(path);
        return this.cache.has(fullPath);
    }

    /**
     * Clear the cache
     * @param {string} [path] - Specific path to clear, or all if not provided
     */
    clearCache(path) {
        if (path) {
            const fullPath = this._resolvePath(path);
            this.cache.delete(fullPath);
        } else {
            this.cache.clear();
        }
    }

    /**
     * Get loading progress
     * @returns {{ loaded: number, total: number, percent: number }}
     */
    getProgress() {
        const percent = this.totalCount > 0 ? (this.loadedCount / this.totalCount) * 100 : 0;
        return {
            loaded: this.loadedCount,
            total: this.totalCount,
            percent: Math.round(percent)
        };
    }

    /**
     * Check if currently loading
     * @returns {boolean}
     */
    isLoading() {
        return this.loadingQueue.size > 0;
    }

    /**
     * Reset loading counters
     */
    resetProgress() {
        this.loadedCount = 0;
        this.totalCount = 0;
        this.loadingQueue.clear();
    }

    /**
     * Resolve path relative to basePath
     * @private
     */
    _resolvePath(path) {
        // If already absolute, return as-is
        if (path.startsWith('/') || path.startsWith('http')) {
            return path;
        }
        return `${this.basePath}/${path}`;
    }

    /**
     * Emit an event via EventBus
     * @private
     */
    _emit(event, data) {
        if (this.eventBus) {
            this.eventBus.emit(event, data);
        }
    }

    /**
     * Emit progress update
     * @private
     */
    _emitProgress() {
        this._emit('resource:progress', this.getProgress());
    }
}

// Singleton instance
let resourceLoaderInstance = null;

/**
 * Get or create the singleton ResourceLoader instance
 * @param {Object} [options] - Options for new instance
 * @returns {ResourceLoader}
 */
function getResourceLoader(options) {
    if (!resourceLoaderInstance) {
        resourceLoaderInstance = new ResourceLoader(options);
    }
    return resourceLoaderInstance;
}

// Export for ES Modules
export { ResourceLoader, getResourceLoader };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.ResourceLoader = ResourceLoader;
    window.getResourceLoader = getResourceLoader;
}
