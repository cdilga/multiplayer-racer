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
        
        // Monitor socket connection
        if (typeof socket !== 'undefined') {
            const originalEmit = socket.emit;
            socket.emit = function(event, ...args) {
                console.log(`Socket emit: ${event}`, args);
                return originalEmit.apply(this, [event, ...args]);
            };
            
            // Add logging for important socket events
            const eventsToLog = [
                'connect', 'disconnect', 'error',
                'room_created', 'game_joined', 'game_started',
                'player_joined', 'player_left', 'player_position_update'
            ];
            
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
            
            console.log('Socket monitoring enabled');
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