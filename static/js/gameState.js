// Game state management
import { PHYSICS_TIMESTEP } from './constants.js';

// Initial game state
const initialState = {
    gameActive: false,
    players: {},
    cars: {},
    roomCode: null,
    scene: null,
    camera: null,
    renderer: null,
    physics: {
        initialized: false,
        world: null,
        bodies: {},
        colliders: {},
        usingRapier: false
    },
    showStats: false,
    showPhysicsDebug: false,
    physicsDebugObjects: [],
    physicsDebugLogs: null,
    lastTimestamp: 0,
    frameCount: 0,
    fps: 0,
    lastFrameTime: 0,
    debugCounters: {
        physicsUpdate: 0,
        controlsUpdate: 0,
        physicsDebugLines: 0
    },
    debugRenderLogged: false,
    forceVisualization: [],
    track: null
};

// Create a copy of the initial state
let gameState = { ...initialState };

// Last physics update timestamp
let lastPhysicsUpdate = 0;

// Game state management functions
export const getGameState = () => gameState;

export const resetGameState = () => {
    gameState = { ...initialState };
    lastPhysicsUpdate = 0;
    return gameState;
};

export const getLastPhysicsUpdate = () => lastPhysicsUpdate;
export const setLastPhysicsUpdate = (timestamp) => {
    lastPhysicsUpdate = timestamp;
};

// Player management
export const addPlayer = (id, playerData) => {
    gameState.players[id] = playerData;
    return gameState.players[id];
};

export const updatePlayer = (id, data) => {
    if (gameState.players[id]) {
        gameState.players[id] = { ...gameState.players[id], ...data };
    }
    return gameState.players[id];
};

export const removePlayer = (id) => {
    if (gameState.players[id]) {
        delete gameState.players[id];
    }
};

// Car management
export const addCar = (id, carData) => {
    gameState.cars[id] = carData;
    return gameState.cars[id];
};

export const updateCar = (id, data) => {
    if (gameState.cars[id]) {
        gameState.cars[id] = { ...gameState.cars[id], ...data };
    }
    return gameState.cars[id];
};

export const removeCar = (id) => {
    if (gameState.cars[id]) {
        delete gameState.cars[id];
    }
};

// Game state setters
export const setRoomCode = (code) => {
    gameState.roomCode = code;
    return code;
};

export const setGameActive = (active) => {
    gameState.gameActive = active;
    return active;
};

export const setScene = (scene) => {
    gameState.scene = scene;
    return scene;
};

export const setCamera = (camera) => {
    gameState.camera = camera;
    return camera;
};

export const setRenderer = (renderer) => {
    gameState.renderer = renderer;
    return renderer;
};

export const setTrack = (track) => {
    gameState.track = track;
    return track;
};

// Physics management
export const initializePhysics = (world, rapier) => {
    gameState.physics.world = world;
    gameState.physics.rapier = rapier;
    gameState.physics.initialized = true;
    gameState.physics.usingRapier = true;
    return gameState.physics;
};

export const addPhysicsBody = (name, body) => {
    gameState.physics.bodies[name] = body;
    return body;
};

export const addPhysicsCollider = (name, collider) => {
    gameState.physics.colliders[name] = collider;
    return collider;
};

// Debug management
export const toggleStats = () => {
    gameState.showStats = !gameState.showStats;
    return gameState.showStats;
};

export const togglePhysicsDebug = () => {
    gameState.showPhysicsDebug = !gameState.showPhysicsDebug;
    return gameState.showPhysicsDebug;
};

export const updateFPS = (timestamp) => {
    const deltaTime = timestamp - gameState.lastTimestamp;
    gameState.lastTimestamp = timestamp;
    gameState.frameCount++;
    
    // Update FPS every second
    if (timestamp - gameState.lastFrameTime >= 1000) {
        gameState.fps = Math.round((gameState.frameCount * 1000) / (timestamp - gameState.lastFrameTime));
        gameState.frameCount = 0;
        gameState.lastFrameTime = timestamp;
    }
    
    return gameState.fps;
};

// Export the game state and management functions
export default {
    getGameState,
    resetGameState,
    getLastPhysicsUpdate,
    setLastPhysicsUpdate,
    addPlayer,
    updatePlayer,
    removePlayer,
    addCar,
    updateCar,
    removeCar,
    setRoomCode,
    setGameActive,
    setScene,
    setCamera,
    setRenderer,
    setTrack,
    initializePhysics,
    addPhysicsBody,
    addPhysicsCollider,
    toggleStats,
    togglePhysicsDebug,
    updateFPS
}; 