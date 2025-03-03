// Debug utility for the multiplayer racer game

// Add this script right after the other scripts in host.html 
// <script src="/static/js/debug.js"></script>

(function() {
    console.log('Debug script loaded');
    
    // Check if window is loaded
    if (document.readyState === 'complete') {
        initDebug();
    } else {
        window.addEventListener('load', initDebug);
    }
    
    function initDebug() {
        console.log('Debug initialized');
        
        // Log game container dimensions
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            console.log('Game container dimensions:', {
                width: gameContainer.clientWidth,
                height: gameContainer.clientHeight,
                offsetWidth: gameContainer.offsetWidth,
                offsetHeight: gameContainer.offsetHeight,
                style: {
                    width: gameContainer.style.width,
                    height: gameContainer.style.height
                }
            });
        } else {
            console.warn('Game container not found');
        }
        
        // Check if Three.js is loaded
        if (typeof THREE === 'undefined') {
            console.error('THREE is not defined - Three.js library missing');
        } else {
            console.log('THREE.js version:', THREE.REVISION);
        }
        
        // Check for other dependencies
        const dependencies = {
            'CANNON': typeof CANNON !== 'undefined',
            'io': typeof io !== 'undefined',
            'buildTrack': typeof buildTrack === 'function',
            'createCar': typeof createCar === 'function',
            'nipplejs': typeof nipplejs !== 'undefined'
        };
        console.log('Dependencies loaded:', dependencies);
        
        // Monitor socket connection - but with reduced logging
        if (typeof socket !== 'undefined') {
            // Only log non-frequent events by default
            const originalEmit = socket.emit;
            socket.emit = function(event, ...args) {
                // Only log important events, not position updates
                if (event !== 'player_update') {
                    console.log(`Socket emit: ${event}`, args);
                }
                return originalEmit.apply(this, [event, ...args]);
            };
            
            // Add logging for important socket events, excluding frequent ones
            const eventsToLog = [
                'connect', 'disconnect', 'error',
                'room_created', 'game_joined', 'game_started',
                'player_joined', 'player_left'
                // Removed 'player_position_update' to reduce spam
            ];
            
            // Sample rate for position updates (log 1 out of X position updates)
            const positionUpdateSampleRate = 100;
            let positionUpdateCounter = 0;
            
            // Add special handling for position updates
            socket.on('player_position_update', function(data) {
                // Only log occasional position updates to reduce console spam
                positionUpdateCounter++;
                if (positionUpdateCounter % positionUpdateSampleRate === 0) {
                    console.log(`Position update sample (1/${positionUpdateSampleRate}):`, data);
                }
            });
            
            eventsToLog.forEach(event => {
                const originalHandler = socket._callbacks[`$${event}`];
                if (originalHandler && originalHandler.length > 0) {
                    const originalFunction = originalHandler[0];
                    socket.on(event, function(data) {
                        console.log(`Socket received: ${event}`, data);
                    });
                } else {
                    socket.on(event, function(data) {
                        console.log(`Socket received: ${event}`, data);
                    });
                }
            });
            
            console.log('Socket monitoring enabled (with reduced position logging)');
        } else {
            console.warn('socket is not defined');
        }
        
        // Monitor game state
        if (typeof gameState !== 'undefined') {
            // Add a simple inspector to monitor gameState
            window.inspectGameState = function() {
                const players = Object.keys(gameState.players).length;
                const cars = Object.keys(gameState.cars).length;
                
                console.log('Game State Inspection:', {
                    roomCode: gameState.roomCode,
                    gameActive: gameState.gameActive,
                    playerCount: players,
                    carCount: cars,
                    sceneInitialized: gameState.scene !== null,
                    rendererInitialized: gameState.renderer !== null
                });
                
                if (gameState.scene) {
                    // Count objects in scene
                    let meshCount = 0;
                    let lightCount = 0;
                    gameState.scene.traverse(obj => {
                        if (obj.isMesh) meshCount++;
                        if (obj.isLight) lightCount++;
                    });
                    
                    console.log('Scene stats:', {
                        children: gameState.scene.children.length,
                        meshes: meshCount,
                        lights: lightCount
                    });
                }
                
                // Return a simplified version of gameState
                return {
                    roomCode: gameState.roomCode,
                    gameActive: gameState.gameActive,
                    players: Object.keys(gameState.players),
                    cars: Object.keys(gameState.cars),
                    hasTrack: gameState.track !== null
                };
            };
            
            console.log('Game state inspector added. Use window.inspectGameState() to examine game state.');
        } else {
            console.warn('gameState is not defined');
        }
        
        // Add render helper
        window.forceDOMRender = function() {
            // Force browser to recalculate layout
            document.body.style.display = 'none';
            document.body.offsetHeight; // Trigger reflow
            document.body.style.display = '';
            console.log('DOM render forced');
            
            // If game is active, force a Three.js render
            if (typeof gameState !== 'undefined' && 
                gameState.scene && 
                gameState.camera && 
                gameState.renderer) {
                gameState.renderer.render(gameState.scene, gameState.camera);
                console.log('Three.js render forced');
            }
        };
        
        console.log('Debug utilities ready. Use window.forceDOMRender() to force render.');
    }
})();

// Test Rapier initialization
function testRapierPhysics() {
    console.log('=== Testing Rapier Physics ===');
    console.log('window.rapierLoaded:', window.rapierLoaded);
    
    if (typeof rapierPhysics !== 'undefined') {
        console.log('rapierPhysics object available:', rapierPhysics);
        
        // Test initialization
        rapierPhysics.init().then(rapier => {
            console.log('Rapier initialization result:', rapier);
            
            if (rapier) {
                console.log('Creating test world...');
                const world = rapierPhysics.createWorld();
                console.log('Test world created:', world);
                
                if (world) {
                    // Test creating a box
                    console.log('Creating test box...');
                    const boxPos = { x: 0, y: 5, z: 0 };
                    const boxDim = { width: 1, height: 1, length: 1 };
                    const box = rapierPhysics.createCarPhysics(world, boxPos, boxDim);
                    console.log('Test box created:', box);
                    
                    // Simulate a few steps
                    console.log('Simulating physics...');
                    for (let i = 0; i < 10; i++) {
                        world.step();
                        const pos = box.translation();
                        console.log(`Box position after step ${i}:`, pos);
                    }
                    
                    console.log('✅ Rapier test successful!');
                }
            }
        }).catch(err => {
            console.error('❌ Error testing Rapier:', err);
        });
    } else {
        console.error('❌ rapierPhysics object not available');
    }
}

// Expose debug functions globally
window.debugUtils = {
    testRapierPhysics
};

// Automatically run tests when debug mode is enabled via URL parameter
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('debug')) {
        console.log('Debug mode enabled via URL parameter');
        
        // Add debug UI
        const debugUI = document.createElement('div');
        debugUI.className = 'debug-ui';
        debugUI.innerHTML = `
            <div class="debug-header">Debug Tools</div>
            <button id="test-rapier-btn">Test Rapier Physics</button>
        `;
        document.body.appendChild(debugUI);
        
        // Style the debug UI
        const style = document.createElement('style');
        style.textContent = `
            .debug-ui {
                position: fixed;
                bottom: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                z-index: 9999;
            }
            .debug-header {
                font-weight: bold;
                margin-bottom: 10px;
                text-align: center;
            }
            .debug-ui button {
                display: block;
                width: 100%;
                margin: 5px 0;
                padding: 5px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
            }
            .debug-ui button:hover {
                background: #45a049;
            }
        `;
        document.head.appendChild(style);
        
        // Add event listeners
        document.getElementById('test-rapier-btn').addEventListener('click', testRapierPhysics);
    }
}); 