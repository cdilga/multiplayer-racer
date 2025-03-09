// Game constants
export const GAME_UPDATE_INTERVAL = 1000 / 60; // 60 FPS
export const PHYSICS_UPDATE_RATE = 60; // Hz
export const PHYSICS_TIMESTEP = 1.0 / PHYSICS_UPDATE_RATE;

// Debug counter for socket events
export const socketDebug = {
    eventCounts: {},
    lastEvents: [],
    maxEventHistory: 10
}; 