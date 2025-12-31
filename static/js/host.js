// Host interface logic

// Constants
const GAME_UPDATE_INTERVAL = 1000 / 60; // 60 FPS
const PHYSICS_UPDATE_RATE = 60; // Hz
const PHYSICS_TIMESTEP = 1.0 / PHYSICS_UPDATE_RATE;
let lastPhysicsUpdate = 0;

// Game state
const gameState = {
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
        usingRapier: false,
        healthy: true,  // Tracks if physics world is operational
        lastErrorTime: 0,  // Timestamp of last error to prevent spam
        recoveryAttempts: 0,  // Track recovery attempts
        maxRecoveryAttempts: 3  // Maximum recovery attempts before giving up
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
    forceVisualization: []
};

// Expose gameState globally for testing and debugging
window.gameState = gameState;

// DOM elements
const elements = {
    lobbyScreen: document.getElementById('lobby-screen'),
    gameScreen: document.getElementById('game-screen'),
    createRoomBtn: document.getElementById('create-room-btn'),
    startGameBtn: document.getElementById('start-game-btn'),
    roomCodeDisplay: document.getElementById('room-code-display'),
    playerList: document.getElementById('player-list'),
    joinUrl: document.getElementById('join-url'),
    gameContainer: document.getElementById('game-container'),
    gameStatus: document.getElementById('game-status'),
    statsOverlay: document.getElementById('stats-overlay'),
    fullscreenBtn: document.getElementById('fullscreen-btn')
};

// Initialize socket connection
const socket = io();

// Debug counter for socket events
const socketDebug = {
    eventCounts: {},
    lastEvents: [],
    maxEventHistory: 10
};

// Add comprehensive socket event monitoring
// socket.onAny((eventName, ...args) => {
//     // Track event counts
//     socketDebug.eventCounts[eventName] = (socketDebug.eventCounts[eventName] || 0) + 1;
    
//     // Track recent events
//     socketDebug.lastEvents.unshift({
//         event: eventName,
//         args: args,
//         timestamp: new Date().toISOString()
//     });
//     socketDebug.lastEvents = socketDebug.lastEvents.slice(0, socketDebug.maxEventHistory);

//     // Log every event with detailed information
//     console.log('🎯 Socket Event:', {
//         event: eventName,
//         count: socketDebug.eventCounts[eventName],
//         args: args,
//         timestamp: new Date().toISOString(),
//         socketId: socket.id,
//         connectedRooms: Array.from(socket.rooms || []),
//         hasListeners: socket.listeners(eventName).length > 0,
//         allRegisteredEvents: Object.keys(socket._callbacks || {})
//     });
// });

// Socket event handlers
socket.on('connect', () => {
    // Connected to server
});

// Add event listeners for buttons
createRoom();
elements.startGameBtn.addEventListener('click', startGame);

socket.on('room_created', (data) => {
    gameState.roomCode = data.room_code;
    elements.roomCodeDisplay.textContent = gameState.roomCode;
    
    // Get local IP address from server-provided data if available
    let ipAddress = 'localhost';
    let port = window.location.port || '5000';
    
    if (typeof serverConfig !== 'undefined') {
        ipAddress = serverConfig.localIp;
        port = serverConfig.port;
    }
    
    // Update join URL with local IP instead of localhost
    const joinUrl = `http://${ipAddress}:${port}/player`;
    elements.joinUrl.textContent = `${joinUrl}?room=${gameState.roomCode}`;
    
    // Load QR code image
    const qrCodeUrl = `/qrcode/${gameState.roomCode}`;
    const qrCodeElement = document.getElementById('qr-code');
    if (qrCodeElement) {
        qrCodeElement.src = qrCodeUrl;
        
        // Add error handling in case the QR code fails to load
        qrCodeElement.onerror = function() {
            qrCodeElement.style.display = 'none';
            const container = document.querySelector('.qr-code-container');
            if (container) {
                const errorMsg = document.createElement('p');
                errorMsg.className = 'error';
                errorMsg.textContent = 'QR code generation failed. Please use the room code instead.';
                container.appendChild(errorMsg);
            }
        };
    }
    
    // Show lobby screen
    showScreen('lobby');

    // Initialize audio and play lobby music
    if (window.audioManager) {
        audioManager.loadSounds().then(() => {
            audioManager.playMusic('lobby', { loop: true, fadeIn: 1.5 });
        });
    }
});

socket.on('player_joined', (playerData) => {
    const { id, name, car_color } = playerData;

    // Add player to local state
    gameState.players[id] = {
        id,
        name,
        color: car_color
    };

    // Add player to UI list
    addPlayerToList(id, name, car_color);

    // Enable start button if we have at least one player
    elements.startGameBtn.disabled = Object.keys(gameState.players).length === 0;

    // Play player join sound
    if (window.audioManager && audioManager.loaded) {
        audioManager.playPlayerJoin();
    }
});

// Handle player name updates
socket.on('player_name_updated', (data) => {
    const { player_id, name } = data;
    
    // Update player name in local state
    if (gameState.players[player_id]) {
        gameState.players[player_id].name = name;
        
        // Update UI list
        const playerElement = document.getElementById(`player-${player_id}`);
        if (playerElement) {
            const nameSpan = playerElement.querySelector('span:not(.player-color)');
            if (nameSpan) {
                nameSpan.textContent = name;
            }
        }
        
        console.log(`Player ${player_id} name updated to: ${name}`);
    }
});

socket.on('player_left', (data) => {
    const { player_id } = data;
    
    // Remove player from local state
    delete gameState.players[player_id];
    
    // Remove player from UI
    const playerElement = document.getElementById(`player-${player_id}`);
    if (playerElement) {
        playerElement.remove();
    }
    
    // Remove player's car if game is active
    if (gameState.gameActive && gameState.cars[player_id]) {
        gameState.scene.remove(gameState.cars[player_id].mesh);
        delete gameState.cars[player_id];
    }
    
    // Update start button state
    elements.startGameBtn.disabled = Object.keys(gameState.players).length === 0;
});

socket.on('player_controls_update', (data) => {
    const { player_id, acceleration, braking, steering } = data;

    // Skip control updates if test override is active (for automated testing)
    if (gameState._testControlsOverride) {
        return;
    }

    if (gameState.gameActive && gameState.cars[player_id]) {
        const car = gameState.cars[player_id];
        // Validate and sanitize control inputs before assigning
        car.controls = {
            acceleration: Math.max(0, Math.min(1, acceleration || 0)), // Clamp between 0-1
            braking: Math.max(0, Math.min(1, braking || 0)), // Clamp between 0-1
            steering: Math.max(-1, Math.min(1, steering || 0)) // Clamp between -1 to 1
        };
        // Update last control update timestamp
        car.lastControlUpdate = Date.now();
        // Force stats update since we have new control data
        if (gameState.showStats) {
            updateStatsDisplay();

        }
    }
});

// Add keyboard event listener for F3/F4 keys
document.addEventListener('keydown', (e) => {
    // Toggle stats display (F3)
    if (e.key === 'F3' || e.key === 'f3') {
        gameState.showStats = !gameState.showStats;
        elements.statsOverlay.classList.toggle('hidden', !gameState.showStats);
        // Immediately update stats content when showing
        if (gameState.showStats) {
            updateStatsDisplay();
        }
        console.log(`Stats display: ${gameState.showStats ? 'ON' : 'OFF'}`);
        e.preventDefault();
    }
    
    // Toggle physics debug visualization (F4)
    if (e.key === 'F4' || e.key === 'f4') {
        togglePhysicsDebug();
        e.preventDefault();
    }
    
    // Reset all cars with R key
    if (e.key === 'r' || e.key === 'R') {
        resetAllCars();
        e.preventDefault();
    }
    
    // Manual car controls for testing
    const playerCar = gameState.cars["1"]; // Control first car
    if (playerCar) {
        const controlsChanged = handleCarKeysDown(e, playerCar);
        if (controlsChanged) {
            // Update visual control indicator
            if (gameState.controlIndicator) {
                updateControlIndicator(
                    gameState.controlIndicator, 
                    playerCar.controls, 
                    "Manual Control"
                );
            }
            // Record the time of the control update
            playerCar.lastControlUpdate = Date.now();
            e.preventDefault();
        }
    }
});

// Handle keyup events for car controls to reset values
document.addEventListener('keyup', (e) => {
    const playerCar = gameState.cars["1"]; // Control first car
    if (playerCar) {
        const controlsChanged = handleCarKeysUp(e, playerCar);
        if (controlsChanged) {
            // Update visual control indicator
            if (gameState.controlIndicator) {
                updateControlIndicator(
                    gameState.controlIndicator, 
                    playerCar.controls, 
                    "Manual Control"
                );
            }
            // Record the time of the control update
            playerCar.lastControlUpdate = Date.now();
            e.preventDefault();
        }
    }
});

// Function to handle keydown events for car controls
function handleCarKeysDown(e, car) {
    let controlsChanged = false;
    
    // Arrow keys for steering
    if (e.key === 'ArrowLeft') {
        car.controls.steering = -1.0; // Full left
        controlsChanged = true;
    } else if (e.key === 'ArrowRight') {
        car.controls.steering = 1.0; // Full right
        controlsChanged = true;
    }
    
    // Up/Down arrows for acceleration/braking
    if (e.key === 'ArrowUp') {
        car.controls.acceleration = 1.0; // Full throttle
        car.controls.braking = 0.0;     // No brakes
        controlsChanged = true;
    } else if (e.key === 'ArrowDown') {
        car.controls.acceleration = 0.0; // No throttle
        car.controls.braking = 1.0;     // Full brakes
        controlsChanged = true;
    }
    
    return controlsChanged;
}

// Function to handle keyup events for car controls
function handleCarKeysUp(e, car) {
    let controlsChanged = false;
    
    // Reset steering when left/right arrow released
    if (e.key === 'ArrowLeft' && car.controls.steering < 0) {
        car.controls.steering = 0.0;
        controlsChanged = true;
    } else if (e.key === 'ArrowRight' && car.controls.steering > 0) {
        car.controls.steering = 0.0;
        controlsChanged = true;
    }
    
    // Reset acceleration/braking when up/down arrow released
    if (e.key === 'ArrowUp' && car.controls.acceleration > 0) {
        car.controls.acceleration = 0.0;
        controlsChanged = true;
    } else if (e.key === 'ArrowDown' && car.controls.braking > 0) {
        car.controls.braking = 0.0;
        controlsChanged = true;
    }
    
    return controlsChanged;
}

// Create a visual control indicator that will be visible regardless of F3 menu
function createControlIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'host-control-indicator';
    indicator.style.position = 'fixed';
    indicator.style.top = '10px';
    indicator.style.right = '10px';
    indicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    indicator.style.color = 'white';
    indicator.style.padding = '10px';
    indicator.style.borderRadius = '5px';
    indicator.style.fontFamily = 'monospace';
    indicator.style.zIndex = '9999';
    indicator.style.transition = 'background-color 0.3s';
    document.body.appendChild(indicator);
    return indicator;
}

// Update the control indicator with the latest values
function updateControlIndicator(indicator, controls, playerName) {
    // Check if indicator exists
    if (!indicator) return;
    
    // Flash the background to show something was received
    indicator.style.backgroundColor = 'rgba(0, 255, 0, 0.7)';
    setTimeout(() => {
        indicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    }, 200);
    
    // Update the content
    indicator.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">CONTROLS RECEIVED (${playerName})</div>
        <div>Accel: ${controls.acceleration.toFixed(2)}</div>
        <div>Brake: ${controls.braking.toFixed(2)}</div>
        <div>Steer: ${controls.steering.toFixed(2)}</div>
        <div style="font-size: 0.8em; margin-top: 5px;">Last update: ${new Date().toLocaleTimeString()}</div>
    `;
}

// Game functions
function createRoom() {
    socket.emit('create_room', {});
}

function startGame() {
    if (gameState.roomCode && Object.keys(gameState.players).length > 0) {
        socket.emit('start_game', { room_code: gameState.roomCode });
        initGame();
        showScreen('game');
        gameState.gameActive = true;

        // Play countdown music, then crossfade to race music
        if (window.audioManager && audioManager.loaded) {
            // Stop all current audio first
            audioManager.stopAllMusic();

            // Play countdown sound
            const countdownId = audioManager.playSound('countdown', { volume: 0.8 });

            // After countdown (approx 5 seconds), stop countdown and start race music + engine
            setTimeout(() => {
                if (gameState.gameActive) {
                    // Stop countdown if still playing
                    if (countdownId) {
                        audioManager.stopSound(countdownId, 0.3);
                    }
                    audioManager.playMusic('race_main', { loop: true, fadeIn: 1.0 });

                    // Start engine sound
                    audioManager.startEngineSound();
                }
            }, 5000);
        }
    }
}

function addPlayerToList(id, name, color) {
    const playerItem = document.createElement('li');
    playerItem.id = `player-${id}`;
    
    const colorSpan = document.createElement('span');
    colorSpan.className = 'player-color';
    colorSpan.style.backgroundColor = color;
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    
    playerItem.appendChild(colorSpan);
    playerItem.appendChild(nameSpan);
    elements.playerList.appendChild(playerItem);
}

function showScreen(screenName) {
    elements.lobbyScreen.classList.add('hidden');
    elements.gameScreen.classList.add('hidden');
    
    switch (screenName) {
        case 'lobby':
            elements.lobbyScreen.classList.remove('hidden');
            break;
        case 'game':
            elements.gameScreen.classList.remove('hidden');
            // Show game status briefly then fade out
            elements.gameStatus.style.opacity = '1';
            elements.gameStatus.classList.remove('fade-out');
            setTimeout(() => {
                elements.gameStatus.classList.add('fade-out');
            }, 3000);
            break;
    }
}

// Three.js game initialization
let isInitializing = false; // Flag to prevent multiple initializations
let animationRequestId = null; // Track the animation frame request

function initGame() {
    // Prevent multiple simultaneous initializations
    if (isInitializing) return;
    isInitializing = true;
    
    // Cancel any existing animation frame to prevent duplicate loops
    if (animationRequestId) {
        cancelAnimationFrame(animationRequestId);
        animationRequestId = null;
    }
    
    try {
        // We no longer create the control indicator
        // gameState.controlIndicator is intentionally left undefined
        
        // Initialize Three.js scene
        gameState.scene = new THREE.Scene();
        
        // Get the actual window dimensions instead of container
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspectRatio = width / height;
        
        // Initialize camera with proper aspect ratio
        gameState.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
        
        // Initialize renderer with window dimensions
        gameState.renderer = new THREE.WebGLRenderer({ antialias: true });
        gameState.renderer.setSize(width, height, true);
        gameState.renderer.setClearColor(0x87CEEB); // Sky blue background
        gameState.renderer.shadowMap.enabled = true;
        
        // Clear any existing renderer from the container
        const container = elements.gameContainer;
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        
        container.appendChild(gameState.renderer.domElement);
        
        // Set initial camera position based on aspect ratio
        if (aspectRatio > 1.5) {
            gameState.camera.position.set(0, 45, 45);
        } else {
            gameState.camera.position.set(0, 50, 50);
        }
        gameState.camera.lookAt(0, 0, 0);
        
        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        gameState.scene.add(ambientLight);
        
        // Add directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        gameState.scene.add(directionalLight);
        
        // Create race track using the track builder utility
        if (typeof buildTrack === 'function') {
            gameState.track = buildTrack({
                trackWidth: 10,
                trackShape: 'oval',
                barrierHeight: 1
            });
        } else {
            gameState.track = createRaceTrack();
        }
        
        gameState.scene.add(gameState.track);
        
        // Initialize physics world - THIS IS ASYNC and needs to be waited for
        // Initialize physics world and then create cars
        initPhysics().then((physicsInitialized) => {
            // Check if physics actually initialized successfully
            if (!physicsInitialized) {
                console.warn('Physics failed to initialize - creating cars without physics');
            } else {
                console.log('Physics initialized successfully, now creating cars');
            }

            // Create cars for each player with spread-out starting positions
            const playerIds = Object.keys(gameState.players);
            
            // Create cars for each player
            playerIds.forEach((playerId, index) => {
                const player = gameState.players[playerId];
                createPlayerCar(playerId, player.color);
            });

            // Step physics world once to initialize body positions before game loop
            // This prevents NaN values from translation() on newly created bodies
            if (gameState.physics.world && typeof gameState.physics.world.step === 'function') {
                console.log('Stepping physics world to initialize body positions');
                try {
                    const world = gameState.physics.world;
                    world.step();

                    // Validate that all car physics bodies now have valid positions
                    for (const playerId of playerIds) {
                        const car = gameState.cars[playerId];
                        if (car && car.physicsBody) {
                            try {
                                const pos = car.physicsBody.translation();
                                if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
                                    console.error(`Car ${playerId} still has invalid position after initial step:`, pos);
                                    gameState.physics.healthy = false;
                                } else {
                                    console.log(`Car ${playerId} position initialized: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
                                }
                            } catch (e) {
                                console.error(`Error getting car ${playerId} position:`, e.message);
                                gameState.physics.healthy = false;
                            }
                        }
                    }
                } catch (stepError) {
                    console.error('Initial world.step() failed:', stepError.message);
                    gameState.physics.healthy = false;
                }
            }

            // Force multiple renders to ensure everything is displayed correctly
            gameState.renderer.render(gameState.scene, gameState.camera);
            
            // Wait a short time before starting the game loop to ensure DOM is fully updated
            setTimeout(() => {
                // Force another render after a short delay
                gameState.renderer.render(gameState.scene, gameState.camera);
                
                // Start game loop
                animationRequestId = requestAnimationFrame(gameLoopWithoutRecursion);
                
                // Mark initialization as complete
                isInitializing = false;
            }, 50);
        }).catch(error => {
            console.error('Error initializing physics:', error);
            
            // Create cars anyway, but without physics bodies
            console.warn('Creating cars without physics bodies due to initialization error');
            const playerIds = Object.keys(gameState.players);
            playerIds.forEach((playerId, index) => {
                const player = gameState.players[playerId];
                createPlayerCar(playerId, player.color);
            });
            
            // Start the game loop anyway
            animationRequestId = requestAnimationFrame(gameLoopWithoutRecursion);
            isInitializing = false;
        });
        
        // Handle window resize
        window.removeEventListener('resize', onWindowResize);
        window.addEventListener('resize', onWindowResize);
        
        // Force an immediate resize to ensure proper dimensions
        onWindowResize();
        
        // Force a DOM reflow to fix rendering issues
        forceDOMRender();
    } catch (error) {
        console.error('Error initializing game:', error);
        isInitializing = false;
    }
}

function createRaceTrack() {
    console.log('Creating race track');
    // Create a simple oval track
    const track = new THREE.Group();
    
    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2E7D32,  // Darker grass green
        roughness: 0.9,
        metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    track.add(ground);
    
    // Track path
    const trackPathGeometry = new THREE.RingGeometry(15, 25, 32);
    const trackPathMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x424242,  // Dark asphalt
        roughness: 0.7,
        metalness: 0.2
    });
    const trackPath = new THREE.Mesh(trackPathGeometry, trackPathMaterial);
    trackPath.rotation.x = -Math.PI / 2;
    trackPath.receiveShadow = true;
    track.add(trackPath);
    
    // Lane markings (white lines)
    const innerLaneMarking = new THREE.RingGeometry(15, 15.3, 32);
    const outerLaneMarking = new THREE.RingGeometry(24.7, 25, 32);
    const laneMarkingMaterial = new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,  // White
        roughness: 0.4,
        metalness: 0.2
    });
    
    // Inner lane marking
    const innerLane = new THREE.Mesh(innerLaneMarking, laneMarkingMaterial);
    innerLane.rotation.x = -Math.PI / 2;
    innerLane.position.y = 0.01;  // Slightly above track to avoid z-fighting
    innerLane.receiveShadow = true;
    track.add(innerLane);
    
    // Outer lane marking
    const outerLane = new THREE.Mesh(outerLaneMarking, laneMarkingMaterial);
    outerLane.rotation.x = -Math.PI / 2;
    outerLane.position.y = 0.01;  // Slightly above track to avoid z-fighting
    outerLane.receiveShadow = true;
    track.add(outerLane);
    
    // Start/finish line
    const startLineGeometry = new THREE.PlaneGeometry(10, 1);
    const startLineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        roughness: 0.4 
    });
    const startLine = new THREE.Mesh(startLineGeometry, startLineMaterial);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(0, 0.02, -20);  // Position at the bottom of the track
    startLine.receiveShadow = true;
    track.add(startLine);
    
    // Add the track to the scene
    gameState.scene.add(track);
    gameState.track = track;
    
    return track;
}

function createPlayerCar(playerId, carColor) {
    if (!playerId) return;
    
    try {
        // Convert the player ID to string to ensure consistent usage as object keys
        playerId = String(playerId);
        
        // If a car already exists with this ID, remove it
        if (gameState.cars[playerId]) {
            console.log(`Removing existing car for player ${playerId}`);
            gameState.scene.remove(gameState.cars[playerId].mesh);
            
            // If the car has a physics body, we should also remove that
            if (gameState.cars[playerId].physicsBody && gameState.physics.world) {
                // Ensure we have appropriate method to remove bodies
                if (typeof gameState.physics.world.removeRigidBody === 'function') {
                    gameState.physics.world.removeRigidBody(gameState.cars[playerId].physicsBody);
                }
            }
            
            delete gameState.cars[playerId];
        }
        
        // Log player data
        console.log(`Creating car for player ${playerId}`);
        const player = gameState.players[playerId];
        
        // Set default color if none provided
        const color = carColor || "#FF0000";
        
        // Set start position near the start/finish line with higher elevation
        const startPosition = { x: 0, y: 1.5, z: -20 }; // Lower height for character controller
        
        // Get car dimensions
        const carDimensions = {
            width: 2,    // Car width
            height: 1,   // Car height
            length: 4    // Car length
        };
        
        // Create a simple car mesh with specified dimensions
        const car = createCar({ 
            color,
            dimensions: carDimensions
        });
        
        // Add to scene
        gameState.scene.add(car);
        
        // Apply position to mesh
        car.position.set(startPosition.x, startPosition.y, startPosition.z);
        
        // Initialize physics body if physics is available
        let physicsBody = null;
        
        if (gameState.physics && gameState.physics.initialized &&
            gameState.physics.world && gameState.physics.usingRapier) {
            console.log("Creating dynamic physics body for car");

            try {
                // Create dynamic physics body using Rapier
                physicsBody = rapierPhysics.createCarPhysics(
                    gameState.physics.world,
                    startPosition,
                    carDimensions
                );

                if (physicsBody) {
                    console.log('Dynamic physics body created successfully for player', playerId);

                    // Store player ID in physics body userData
                    if (!physicsBody.userData) {
                        physicsBody.userData = {};
                    }
                    physicsBody.userData.playerId = playerId;
                } else {
                    console.error('Failed to create dynamic physics body for player', playerId);
                }
            } catch (error) {
                console.error('Error creating car physics:', error);
            }
        }
        
        // Extract wheels from the car model for visualization
        const wheelMeshes = [];
        if (car.children) {
            for (let i = 0; i < car.children.length; i++) {
                const child = car.children[i];
                if (child.name && child.name.includes('wheel')) {
                    wheelMeshes.push(child);
                }
            }
        }
        
        // Store the car data
        gameState.cars[playerId] = {
            mesh: car,
            physicsBody: physicsBody,
            wheels: wheelMeshes,
            spawnPosition: { ...startPosition }, // Store original spawn position for reset
            spawnRotation: { x: 0, y: 0, z: 0, w: 1 }, // Store original spawn rotation
            targetPosition: { ...startPosition },
            targetRotation: { x: 0, y: 0, z: 0 },
            targetQuaternion: new THREE.Quaternion(),
            velocity: { x: 0, y: 0, z: 0 },
            speed: 0,
            // Initialize with default controls (all zeros)
            controls: {
                steering: 0,
                acceleration: 0,
                braking: 0
            },
            lastControlUpdate: Date.now()
        };
        
        // Reset the control indicator to show zero values
        if (gameState.controlIndicator) {
            updateControlIndicator(
                gameState.controlIndicator, 
                gameState.cars[playerId].controls, 
                player ? player.name : `Player ${playerId}`
            );
        }
        
        console.log(`Created car for player ${playerId}`);
        return gameState.cars[playerId];
    } catch (error) {
        console.error(`Failed to create car for player ${playerId}:`, error);
        return null;
    }
}

// Initialize physics with Rapier
async function initPhysics() {
    console.log('Initializing physics with Rapier');

    // Return a promise that resolves when physics is initialized
    return new Promise(async (resolve, reject) => {
        let resolved = false; // Guard against double resolution

        try {
            // Check if Rapier is already loaded
            if (window.rapierLoaded && window.RAPIER) {
                console.log('Rapier is already loaded, initializing physics');
                const success = await initializeWithRapier();
                resolved = true;
                resolve(success);
            } else {
                console.log('Waiting for Rapier to load...');

                // Set up event listener for when Rapier is ready
                const onRapierReady = async function() {
                    if (resolved) return; // Guard against double resolution
                    console.log('Received rapier-ready event, initializing physics');
                    window.removeEventListener('rapier-ready', onRapierReady);
                    const success = await initializeWithRapier();
                    resolved = true;
                    resolve(success);
                };

                window.addEventListener('rapier-ready', onRapierReady);

                // Fallback timeout in case the event never fires
                setTimeout(() => {
                    if (resolved) return; // Guard against double resolution
                    console.error('Timed out waiting for Rapier to be ready');
                    window.removeEventListener('rapier-ready', onRapierReady); // Clean up listener
                    resolved = true;
                    resolve(false); // Resolve with false to indicate physics init failed
                }, 5000);
            }
        } catch (error) {
            console.error('Physics initialization error:', error);
            if (!resolved) {
                resolved = true;
                reject(error);
            }
        }
    });
    
    async function initializeWithRapier() {
        try {
            // rapierPhysics.init() already calls RAPIER.init() internally,
            // so we don't need to call rapier.init() again (causes deprecation warning)
            const rapier = await rapierPhysics.init();
            console.log('Rapier physics initialized successfully');
            
            // Store Rapier instance and set flag
            gameState.physics.rapier = rapier;
            gameState.physics.usingRapier = true;
            
            // Create a new physics world with gravity
            const gravity = { x: 0.0, y: -9.81, z: 0.0 };
            const world = new rapier.World(gravity);
            gameState.physics.world = world;

            // Create ground collider
            createGroundCollider(world, rapier);

            // Create track walls
            createTrackWalls(world, rapier);
            console.log('Ground and walls created');

            gameState.physics.initialized = true;
            gameState.physics.healthy = true;  // Mark physics as healthy on successful init
            gameState.physics.recoveryAttempts = 0;  // Reset recovery attempts
            console.log('Physics world created');
            
            return true;
        } catch (error) {
            console.error('Failed to initialize Rapier physics:', error);
            return false;
        }
    }
}

// Create ground collider for physics simulation
function createGroundCollider(world, rapier) {
    // Create a static rigid body for the ground
    const groundBodyDesc = rapier.RigidBodyDesc.fixed();
    const groundBody = world.createRigidBody(groundBodyDesc);
    
    // Create a cuboid collider for the ground (large flat plane that matches the visual ground)
    const groundWidth = 150.0;   // Increased from 100 to match visual size
    const groundHeight = 0.1;    // Same thin height
    const groundLength = 150.0;  // Increased from 100 to match visual size
    
    // Create ground collider
    const groundColliderDesc = rapier.ColliderDesc.cuboid(groundWidth/2, groundHeight/2, groundLength/2);
    groundColliderDesc.setFriction(0.8);  // Good friction for the ground
    
    // Create the collider and attach it to the rigid body
    const groundCollider = world.createCollider(groundColliderDesc, groundBody);
    
    // Store references
    gameState.physics.bodies.ground = groundBody;
    gameState.physics.colliders.ground = groundCollider;
    
    console.log(`Created ground collider with size ${groundWidth}x${groundHeight}x${groundLength}`);
}

// Create walls around the track
function createTrackWalls(world, rapier) {
    // Only create walls if we have a track defined
    if (!gameState.track) {
        console.log('No track defined, skipping wall creation');
        return;
    }
    
    try {
        // Use the same dimensions as the ground collider for consistency
        const groundWidth = 150.0;
        const groundLength = 150.0;
        const wallHeight = 3; // Increased height for better visibility
        const wallThickness = 1.0; // Thicker walls for better collision
        
        // Create walls container
        gameState.physics.bodies.walls = [];
        gameState.physics.colliders.walls = [];
        
        // Left wall
        const leftWallBodyDesc = rapier.RigidBodyDesc.fixed();
        leftWallBodyDesc.setTranslation(-groundWidth/2, wallHeight/2, 0);
        const leftWallBody = world.createRigidBody(leftWallBodyDesc);
        
        const leftWallColliderDesc = rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, groundLength/2);
        leftWallColliderDesc.setFriction(0.3);
        const leftWallCollider = world.createCollider(leftWallColliderDesc, leftWallBody);
        
        gameState.physics.bodies.walls.push(leftWallBody);
        gameState.physics.colliders.walls.push(leftWallCollider);
        
        // Right wall
        const rightWallBodyDesc = rapier.RigidBodyDesc.fixed();
        rightWallBodyDesc.setTranslation(groundWidth/2, wallHeight/2, 0);
        const rightWallBody = world.createRigidBody(rightWallBodyDesc);
        
        const rightWallColliderDesc = rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, groundLength/2);
        rightWallColliderDesc.setFriction(0.3);
        const rightWallCollider = world.createCollider(rightWallColliderDesc, rightWallBody);
        
        gameState.physics.bodies.walls.push(rightWallBody);
        gameState.physics.colliders.walls.push(rightWallCollider);
        
        // Top wall
        const topWallBodyDesc = rapier.RigidBodyDesc.fixed();
        topWallBodyDesc.setTranslation(0, wallHeight/2, -groundLength/2);
        const topWallBody = world.createRigidBody(topWallBodyDesc);
        
        const topWallColliderDesc = rapier.ColliderDesc.cuboid(groundWidth/2, wallHeight/2, wallThickness/2);
        topWallColliderDesc.setFriction(0.3);
        const topWallCollider = world.createCollider(topWallColliderDesc, topWallBody);
        
        gameState.physics.bodies.walls.push(topWallBody);
        gameState.physics.colliders.walls.push(topWallCollider);
        
        // Bottom wall
        const bottomWallBodyDesc = rapier.RigidBodyDesc.fixed();
        bottomWallBodyDesc.setTranslation(0, wallHeight/2, groundLength/2);
        const bottomWallBody = world.createRigidBody(bottomWallBodyDesc);
        
        const bottomWallColliderDesc = rapier.ColliderDesc.cuboid(groundWidth/2, wallHeight/2, wallThickness/2);
        bottomWallColliderDesc.setFriction(0.3);
        const bottomWallCollider = world.createCollider(bottomWallColliderDesc, bottomWallBody);
        
        gameState.physics.bodies.walls.push(bottomWallBody);
        gameState.physics.colliders.walls.push(bottomWallCollider);
        
        console.log('Created track walls with dimensions:', {
            groundWidth,
            groundLength,
            wallHeight,
            wallThickness
        });
        
    } catch (error) {
        console.error('Error creating track walls:', error);
    }
}

// Physics world recovery mechanism
// Attempts to recreate the physics world and all bodies after a crash
async function attemptPhysicsRecovery() {
    const now = Date.now();

    // Prevent recovery spam - only attempt once every 5 seconds
    if (now - gameState.physics.lastErrorTime < 5000) {
        return false;
    }

    gameState.physics.lastErrorTime = now;
    gameState.physics.recoveryAttempts++;

    // Check if we've exceeded max recovery attempts
    if (gameState.physics.recoveryAttempts > gameState.physics.maxRecoveryAttempts) {
        console.error(`Physics recovery failed after ${gameState.physics.maxRecoveryAttempts} attempts. Physics disabled.`);
        return false;
    }

    console.log(`Attempting physics recovery (attempt ${gameState.physics.recoveryAttempts}/${gameState.physics.maxRecoveryAttempts})...`);

    try {
        // Store current car positions from meshes before destroying physics
        const carPositions = {};
        Object.keys(gameState.cars).forEach(playerId => {
            const car = gameState.cars[playerId];
            if (car && car.mesh) {
                carPositions[playerId] = {
                    position: {
                        x: car.mesh.position.x,
                        y: car.mesh.position.y,
                        z: car.mesh.position.z
                    },
                    quaternion: {
                        x: car.mesh.quaternion.x,
                        y: car.mesh.quaternion.y,
                        z: car.mesh.quaternion.z,
                        w: car.mesh.quaternion.w
                    }
                };
                // Clear the old physics body reference
                car.physicsBody = null;
            }
        });

        // Clear old physics references
        gameState.physics.bodies = {};
        gameState.physics.colliders = {};

        // Try to free the old world (may fail if corrupted, but that's okay)
        try {
            if (gameState.physics.world && typeof gameState.physics.world.free === 'function') {
                gameState.physics.world.free();
            }
        } catch (freeError) {
            console.warn('Could not free old physics world (may already be corrupted):', freeError.message);
        }

        gameState.physics.world = null;

        // Get the Rapier instance
        const rapier = gameState.physics.rapier;
        if (!rapier) {
            console.error('Rapier instance not available for recovery');
            return false;
        }

        // Create a new physics world
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        const newWorld = new rapier.World(gravity);
        gameState.physics.world = newWorld;

        console.log('New physics world created');

        // Recreate ground collider
        createGroundCollider(newWorld, rapier);

        // Recreate walls
        createTrackWalls(newWorld, rapier);

        // Recreate physics bodies for all cars at their current mesh positions
        const carDimensions = {
            width: 2,
            height: 1,
            length: 4
        };

        Object.keys(carPositions).forEach(playerId => {
            const car = gameState.cars[playerId];
            const savedPos = carPositions[playerId];

            if (car && savedPos) {
                try {
                    // Create new physics body
                    const physicsBody = rapierPhysics.createCarPhysics(
                        newWorld,
                        savedPos.position,
                        carDimensions
                    );

                    if (physicsBody) {
                        // Set rotation to match saved quaternion
                        physicsBody.setRotation(savedPos.quaternion, true);

                        // Store player ID in physics body userData
                        if (!physicsBody.userData) {
                            physicsBody.userData = {};
                        }
                        physicsBody.userData.playerId = playerId;

                        // Assign to car
                        car.physicsBody = physicsBody;
                        console.log(`Recreated physics body for car ${playerId}`);
                    }
                } catch (carError) {
                    console.error(`Failed to recreate physics for car ${playerId}:`, carError);
                }
            }
        });

        // Mark physics as healthy again
        gameState.physics.healthy = true;
        gameState.physics.recoveryAttempts = 0; // Reset attempts on success

        console.log('Physics recovery successful!');
        return true;

    } catch (recoveryError) {
        console.error('Physics recovery failed:', recoveryError);
        gameState.physics.healthy = false;
        return false;
    }
}

// Handle physics error with rate limiting
function handlePhysicsError(error, context = 'unknown') {
    const now = Date.now();

    // Only log errors once per second to prevent spam
    if (now - gameState.physics.lastErrorTime > 1000) {
        console.error(`Physics error (${context}):`, error.message || error);

        // Check for fatal errors that require recovery
        const isFatalError = error.message && (
            error.message.includes('unreachable') ||
            error.message.includes('recursive use') ||
            error.message.includes('unsafe aliasing')
        );

        if (isFatalError && gameState.physics.healthy) {
            console.warn('Fatal physics error detected, marking world as unhealthy');
            gameState.physics.healthy = false;
            gameState.physics.lastErrorTime = now;

            // Schedule recovery attempt
            setTimeout(() => {
                attemptPhysicsRecovery();
            }, 100);
        }
    }
}

// Improved game loop that avoids potential stack overflow issues
function gameLoopWithoutRecursion(timestamp) {
    try {
        // Request next frame early
        animationRequestId = requestAnimationFrame(gameLoopWithoutRecursion);
        
        // Calculate delta time since last frame
        const deltaTime = timestamp - (gameState.lastTimestamp || timestamp);
        gameState.lastTimestamp = timestamp;

        // Skip first frame (deltaTime is 0) and frames with unreasonable delta times
        if (deltaTime <= 0 || deltaTime > 1000) {
            if (deltaTime > 1000) {
                console.log(`Large frame time detected: ${deltaTime}ms, skipping physics update`);
            }
            return;
        }
        
        // Process physics if available and healthy
        if (gameState.physics && gameState.physics.world && gameState.physics.healthy) {
            // Step the physics simulation
            // Limit deltaTime to avoid large steps causing instability (max 1/30th second)
            const physicsStep = Math.min(deltaTime / 1000, 1/30);

            // IMPORTANT: Apply controls BEFORE world.step()
            // Forces are integrated during step() and then reset, so they must be applied first
            Object.keys(gameState.cars).forEach(playerId => {
                const car = gameState.cars[playerId];
                if (car && car.physicsBody && car.controls && gameState.physics.healthy) {
                    try {
                        // Apply controls using dynamic physics with delta time and world for raycasting
                        rapierPhysics.applyCarControls(car.physicsBody, car.controls, physicsStep, gameState.physics.world, playerId);
                    } catch (error) {
                        handlePhysicsError(error, `applyCarControls(${playerId})`);
                    }
                }
            });

            // Set the physics timestep via Rapier's integrationParameters
            try {
                const world = gameState.physics.world;

                // DON'T modify integrationParameters.dt - let Rapier use its default
                // Modifying dt dynamically can cause instability

                // DEBUG: Check car position before step
                const carIds = Object.keys(gameState.cars);
                const carBeforeStep = carIds.length > 0 && gameState.cars[carIds[0]]?.physicsBody
                    ? gameState.cars[carIds[0]].physicsBody.translation()
                    : null;

                // Step the physics simulation (after forces are applied)
                world.step();
                gameState.debugCounters.physicsUpdate++;

                // DEBUG: Check if car position changed dramatically
                if (carBeforeStep && carIds.length > 0 && gameState.cars[carIds[0]]?.physicsBody) {
                    const carAfterStep = gameState.cars[carIds[0]].physicsBody.translation();
                    const posChange = carAfterStep.y - carBeforeStep.y;
                    if (Math.abs(posChange) > 0.5) {
                        console.error(`⚠️ CAR POSITION JUMP: before=${carBeforeStep.y.toFixed(2)}, after=${carAfterStep.y.toFixed(2)}, change=${posChange.toFixed(2)}`);
                    }
                }

                // Debug log once every 300 frames (reduced frequency)
                if (gameState.debugCounters.physicsUpdate % 300 === 0) {
                    console.log(`Physics stepping with dt=${physicsStep.toFixed(4)}s`);
                }

                // Check for collisions by detecting sudden velocity changes
                checkCarCollisions();

            } catch (error) {
                handlePhysicsError(error, 'world.step');
                return; // Skip rest of physics processing when step fails
            }

            // Update all car meshes to match their physics bodies
            Object.keys(gameState.cars).forEach(playerId => {
                const car = gameState.cars[playerId];
                if (car && car.mesh && car.physicsBody && gameState.physics.healthy) {
                    try {
                        // Sync visual model with dynamic physics body
                        rapierPhysics.syncCarModelWithPhysics(
                            car.mesh,
                            car.physicsBody,
                            car.wheels
                        );

                        // Update the car's speed for stats display
                        if (car.physicsBody.userData) {
                            car.speed = car.physicsBody.userData.currentSpeed || 0;
                            car.velocity = car.physicsBody.userData.velocity || { x: 0, y: 0, z: 0 };
                        }
                    } catch (error) {
                        handlePhysicsError(error, `syncCarModel(${playerId})`);

                        // If sync fails, check if the car's physics body has invalid values
                        try {
                            const pos = car.physicsBody.translation();
                            if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
                                console.warn(`Detected invalid position for car ${playerId}, attempting reset`);
                                resetCarPosition(playerId);
                            }
                        } catch (posError) {
                            handlePhysicsError(posError, `getPosition(${playerId})`);
                        }
                    }
                }
            });
            
            // Update force visualization if physics debug is enabled
            if (gameState.showPhysicsDebug) {
                visualizeAppliedForces();
                updatePhysicsDebugVisualization();
            }

            // Update engine sound based on average car speed
            if (window.audioManager && audioManager.enginePlaying) {
                const carIds = Object.keys(gameState.cars);
                if (carIds.length > 0) {
                    // Get max speed and check if any car is accelerating
                    let maxSpeed = 0;
                    let anyAccelerating = false;

                    carIds.forEach(id => {
                        const car = gameState.cars[id];
                        if (car && car.speed !== undefined) {
                            maxSpeed = Math.max(maxSpeed, Math.abs(car.speed));
                        }
                        if (car && car.controls && car.controls.acceleration > 0) {
                            anyAccelerating = true;
                        }
                    });

                    audioManager.updateEngineSound(maxSpeed, 30, anyAccelerating);
                }
            }
        }

        // Update stats display if visible
        if (gameState.showStats) {
            updateStatsDisplay();
        }
        
        // Render scene
        if (gameState.scene && gameState.camera) {
            gameState.renderer.render(gameState.scene, gameState.camera);
        }
        
        // Update physics debug visualization if enabled
        if (gameState.showPhysicsDebug) {
            updatePhysicsDebugVisualization();
        }
        
    } catch (error) {
        console.error('Error in game loop:', error);
    }
}

// Modify the existing gameLoop function to use the new gameLoopWithoutRecursion function
function gameLoop() {
    // Start the improved game loop instead
    if (animationRequestId) {
        cancelAnimationFrame(animationRequestId);
    }
    animationRequestId = requestAnimationFrame(gameLoopWithoutRecursion);
}

// Collision detection state
const collisionState = {
    lastVelocities: {},  // Track previous velocities per car
    collisionCooldowns: {},  // Prevent sound spam
    cooldownMs: 300  // Minimum time between collision sounds per car
};

/**
 * Check for car collisions by detecting sudden velocity changes
 * Plays collision sounds when impacts are detected
 */
function checkCarCollisions() {
    if (!window.audioManager || !audioManager.loaded) return;

    const now = Date.now();

    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        if (!car || !car.physicsBody) return;

        try {
            const linvel = car.physicsBody.linvel();
            const currentVel = { x: linvel.x, y: linvel.y, z: linvel.z };
            const currentSpeed = Math.sqrt(currentVel.x ** 2 + currentVel.z ** 2);

            const lastVel = collisionState.lastVelocities[playerId];

            if (lastVel) {
                // Calculate velocity change (impact force indicator)
                const deltaVx = currentVel.x - lastVel.x;
                const deltaVz = currentVel.z - lastVel.z;
                const impactMagnitude = Math.sqrt(deltaVx ** 2 + deltaVz ** 2);

                // Threshold for collision detection (tune as needed)
                const collisionThreshold = 3.0;

                if (impactMagnitude > collisionThreshold) {
                    // Check cooldown to prevent sound spam
                    const lastCollision = collisionState.collisionCooldowns[playerId] || 0;
                    if (now - lastCollision > collisionState.cooldownMs) {
                        // Normalize intensity (0-1 range)
                        const intensity = Math.min(1, impactMagnitude / 15);
                        audioManager.playCollisionSound(intensity);
                        collisionState.collisionCooldowns[playerId] = now;
                    }
                }
            }

            // Store current velocity for next frame
            collisionState.lastVelocities[playerId] = currentVel;

        } catch (error) {
            // Silently ignore physics errors during collision check
        }
    });
}

function onWindowResize() {
    if (!gameState.camera || !gameState.renderer) return;
    
    // Use window dimensions directly
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update camera
    gameState.camera.aspect = width / height;
    gameState.camera.updateProjectionMatrix();
    
    // Update renderer size
    gameState.renderer.setSize(width, height, true);
    
    // Adjust camera position based on aspect ratio
    const aspectRatio = width / height;
    if (aspectRatio > 1.5) {
        gameState.camera.position.set(0, 45, 45);
    } else {
        gameState.camera.position.set(0, 50, 50);
    }
    gameState.camera.lookAt(0, 0, 0);
    
    // Force a render
    if (gameState.scene) {
        gameState.renderer.render(gameState.scene, gameState.camera);
    }
}

function updateStatsDisplay() {
    if (!elements.statsOverlay) return;

    // Create persistent structure if it doesn't exist
    if (!elements.statsOverlay.querySelector('#stats-dynamic-content')) {
        elements.statsOverlay.innerHTML = `
            <div class="stats-header">Game Stats (Press F3 to toggle)</div>
            <div id="stats-dynamic-content"></div>
            <div class="reset-button-container">
                <button id="reset-all-cars-btn" class="reset-button">Reset All Cars</button>
            </div>
            <div class="stats-section">Player Stats & Car Physics:</div>
            <div id="player-stats-content"></div>
        `;
        // Attach click handler once
        const resetBtn = elements.statsOverlay.querySelector('#reset-all-cars-btn');
        if (resetBtn) {
            resetBtn.onclick = resetAllCars;
        }
    }

    // Update only the dynamic content
    const dynamicContent = elements.statsOverlay.querySelector('#stats-dynamic-content');
    if (!dynamicContent) return;

    // Add physics engine status
    const physicsStatus = gameState.physics.usingRapier ?
        '<span style="color:green">Active</span>' :
        '<span style="color:red">Unavailable</span>';

    // Add physics debug status
    const debugStatus = gameState.showPhysicsDebug ?
        '<span style="color:green">ON</span> (Press F4 to toggle)' :
        '<span style="color:#888">OFF</span> (Press F4 to toggle)';

    // Add FPS counter
    const now = performance.now();
    if (!gameState.lastFrameTime) {
        gameState.lastFrameTime = now;
        gameState.frameCount = 0;
        gameState.fps = 0;
    }

    gameState.frameCount++;

    if (now - gameState.lastFrameTime >= 1000) {
        gameState.fps = Math.round(gameState.frameCount * 1000 / (now - gameState.lastFrameTime));
        gameState.frameCount = 0;
        gameState.lastFrameTime = now;
    }

    let statsHTML = `<div>Physics: ${physicsStatus}</div>`;
    statsHTML += `<div>Rapier Loaded: ${window.rapierLoaded ? '<span style="color:green">Yes</span>' : '<span style="color:red">No</span>'}</div>`;
    statsHTML += `<div>Physics Debug: ${debugStatus}</div>`;
    statsHTML += `<div>FPS: ${gameState.fps}</div>`;
    statsHTML += `<div>Players: ${Object.keys(gameState.players).length}</div>`;
    statsHTML += `<div>Cars: ${Object.keys(gameState.cars).length}</div>`;

    // Add physics update counter
    statsHTML += `<div>Physics Updates: ${gameState.debugCounters?.physicsUpdate || 0}</div>`;
    if (gameState.showPhysicsDebug) {
        statsHTML += `<div>Debug Lines: ${gameState.debugCounters?.physicsDebugLines || 0}</div>`;
    }

    dynamicContent.innerHTML = statsHTML;

    // Update player stats in the dedicated container
    const playerStatsContent = elements.statsOverlay.querySelector('#player-stats-content');
    if (!playerStatsContent) return;

    // Get current player IDs and existing player containers
    const currentCarIds = Object.keys(gameState.cars);
    const existingContainers = playerStatsContent.querySelectorAll('.player-stats-container');

    // Remove containers for players that no longer exist
    existingContainers.forEach(container => {
        const containerId = container.getAttribute('data-player-id');
        if (!currentCarIds.includes(containerId)) {
            container.remove();
        }
    });

    // Update or create containers for each player
    currentCarIds.forEach(playerId => {
        const car = gameState.cars[playerId];
        const player = gameState.players[playerId];
        if (!car || !player) return;
        
        // Calculate speed from velocity
        let speed = 0;
        let posX = 0, posY = 0, posZ = 0;
        let rotX = 0, rotY = 0, rotZ = 0, rotW = 0;
        let isUpsideDown = false;
        
        // Get physics state (if available) with safety checks
        if (car.physicsBody && gameState.physics.healthy) {
            try {
                const vel = car.physicsBody.linvel();
                const pos = car.physicsBody.translation();
                const rot = car.physicsBody.rotation();

                // Validate values before using them
                if (vel && Number.isFinite(vel.x) && Number.isFinite(vel.z)) {
                    speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6; // Convert to km/h
                }
                if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
                    posX = Math.round(pos.x * 100) / 100;
                    posY = Math.round(pos.y * 100) / 100;
                    posZ = Math.round(pos.z * 100) / 100;
                }
                if (rot && Number.isFinite(rot.x) && Number.isFinite(rot.y) && Number.isFinite(rot.z) && Number.isFinite(rot.w)) {
                    rotX = Math.round(rot.x * 100) / 100;
                    rotY = Math.round(rot.y * 100) / 100;
                    rotZ = Math.round(rot.z * 100) / 100;
                    rotW = Math.round(rot.w * 100) / 100;
                }

                // Check if car is upside down
                if (typeof rapierPhysics.isCarUpsideDown === 'function') {
                    isUpsideDown = rapierPhysics.isCarUpsideDown(car.physicsBody);
                }
            } catch (e) {
                // Physics body access failed - silently skip
            }
        }

        // Get physics body state
        let physicsState = "No Physics Body";
        let velocityInfo = "";

        if (car.physicsBody && gameState.physics.healthy) {
            try {
                const vel = car.physicsBody.linvel();
                const isAwake = typeof car.physicsBody.isAwake === 'function' ?
                    car.physicsBody.isAwake() : "Unknown";

                if (vel && Number.isFinite(vel.x) && Number.isFinite(vel.y) && Number.isFinite(vel.z)) {
                    physicsState = `Active: ${isAwake}`;
                    velocityInfo = `<div>Velocity: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})</div>`;
                } else {
                    physicsState = '<span style="color:orange">Invalid State</span>';
                }

                // Add upside down indicator
                if (isUpsideDown) {
                    physicsState += ' <span style="color:red; font-weight:bold;">UPSIDE DOWN</span>';
                }
            } catch (e) {
                physicsState = '<span style="color:red">Error</span>';
            }
        }
        
        // Get player controls
        let controlsHTML = '<div class="control-info">No controls received</div>';
        
        if (car.controls) {
            const timeSinceLastControl = car.lastControlUpdate ? 
                Math.round((Date.now() - car.lastControlUpdate) / 1000) : 'N/A';
            
            controlsHTML = `
            <div class="control-info">
                <div class="control-row">
                    <span>Steering:</span>
                        ${createBarIndicator(car.controls.steering, -1, 1)}
                        <span class="value">${car.controls.steering.toFixed(2)}</span>
                </div>
                <div class="control-row">
                        <span>Acceleration:</span>
                        ${createBarIndicator(car.controls.acceleration, 0, 1)}
                        <span class="value">${car.controls.acceleration.toFixed(2)}</span>
                </div>
                <div class="control-row">
                        <span>Braking:</span>
                        ${createBarIndicator(car.controls.braking, 0, 1)}
                        <span class="value">${car.controls.braking.toFixed(2)}</span>
                </div>
                    <div class="control-time">Last update: ${timeSinceLastControl}s ago</div>
                </div>`;
        }
        
        // NEW: Add applied forces display if available from user data
        let forcesHTML = '';
        
        if (car.physicsBody && car.physicsBody.userData && car.physicsBody.userData.lastAppliedForces) {
            const forces = car.physicsBody.userData.lastAppliedForces;
            
            forcesHTML = `
                <div class="forces-section">
                    <div class="forces-header">Applied Forces:</div>
                <div class="control-info">
                    <div class="control-row">
                            <span>Engine:</span>
                            ${createBarIndicator(forces.engineForce/5000, 0, 1)} 
                            <span class="value">${forces.engineForce.toFixed(0)}N</span>
                    </div>
                    <div class="control-row">
                            <span>Brake:</span>
                            ${createBarIndicator(forces.brakeForce/5000, 0, 1)}
                            <span class="value">${forces.brakeForce.toFixed(0)}N</span>
                    </div>
                    <div class="control-row">
                            <span>Steering:</span>
                            ${createBarIndicator(forces.steeringTorque/500, -1, 1)}
                            <span class="value">${forces.steeringTorque.toFixed(0)}Nm</span>
                    </div>
                        <div class="control-row">
                            <span>Grip:</span>
                            ${createBarIndicator(forces.lateralForce/2000, -1, 1)}
                            <span class="value">${forces.lateralForce.toFixed(0)}N</span>
                        </div>
                        <div class="control-row">
                            <span>Drag:</span>
                            ${createBarIndicator(forces.dragForce/1000, 0, 1)}
                            <span class="value">${forces.dragForce.toFixed(0)}N</span>
                        </div>
                    </div>
                </div>`;
        }
        
        // Check if container exists for this player
        let container = playerStatsContent.querySelector(`[data-player-id="${playerId}"]`);

        if (!container) {
            // Create new container with stable structure
            container = document.createElement('div');
            container.className = 'player-stats-container';
            container.setAttribute('data-player-id', playerId);
            container.innerHTML = `
                <div class="player-stats">
                    <div class="player-header" style="color: ${player.color}">
                        ${player.name} (ID: ${player.id})
                    </div>
                    <div class="player-stats-dynamic"></div>
                    <div class="reset-button-container">
                        <button id="reset-car-${playerId}-btn" class="reset-button car-reset-btn">
                            Reset This Car
                        </button>
                    </div>
                </div>
            `;
            playerStatsContent.appendChild(container);

            // Attach click handler to the button (only once when created)
            const resetBtn = container.querySelector('.car-reset-btn');
            if (resetBtn) {
                resetBtn.onclick = () => resetCarPosition(playerId);
            }
        }

        // Update only the dynamic stats content
        const dynamicStatsDiv = container.querySelector('.player-stats-dynamic');
        if (dynamicStatsDiv) {
            dynamicStatsDiv.innerHTML = `
                <div>Speed: ${speed.toFixed(1)} km/h</div>
                <div>Position: (${posX}, ${posY}, ${posZ})</div>
                ${velocityInfo}
                <div>Rotation: (${rotY.toFixed(2)}, ${rotX.toFixed(2)}, ${rotZ.toFixed(2)}, ${rotW.toFixed(2)})</div>
                <div>Physics: ${physicsState}</div>
                <div class="controls-section">
                    <div class="controls-header">Controls:</div>
                    ${controlsHTML}
                </div>
                ${forcesHTML}
            `;
        }
    });
}

// Add this CSS to improve the debug display
function addPhysicsDebugStyles() {
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
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
        
        /* Improved control bars */
        .control-bar {
            height: 8px;
            border-radius: 4px;
            background-color: #333;
        }
        
        .control-bar-fill.positive {
            background-color: #4CAF50;
        }
        
        .control-bar-fill.negative {
            background-color: #f44336;
        }
        
        .car-reset-btn {
            background-color: #2196F3;
            font-size: 10px;
            padding: 3px 8px;
            margin-top: 8px;
        }
        
        .car-reset-btn:hover {
            background-color: #0b7dda;
        }
    `;
    document.head.appendChild(styleEl);
}

// Call this when the game initializes
addPhysicsDebugStyles();

// Function to reset a car's position
function resetCarPosition(playerId) {
    if (!gameState.cars[playerId]) return;

    const car = gameState.cars[playerId];

    // Use stored spawn position, or fall back to default if not available
    const startPosition = car.spawnPosition || { x: 0, y: 1.5, z: -20 };
    const startRotation = car.spawnRotation || { x: 0, y: 0, z: 0, w: 1 };
    
    try {
        // If we have a physics body, reset its position using dynamic physics
        if (car.physicsBody && gameState.physics.world) {
            console.log(`Resetting dynamic physics body for car ${playerId}`);

            // Use Rapier's comprehensive reset function
            if (typeof rapierPhysics.resetCarPosition === 'function') {
                rapierPhysics.resetCarPosition(
                    car.physicsBody,
                    startPosition,
                    startRotation
                );
            }

            // Also update the car's controls in gameState
            car.controls = {
                steering: 0,
                acceleration: 0,
                braking: 0
            };
        }
        
        // Also reset the visual mesh position directly
        if (car.mesh) {
            car.mesh.position.set(startPosition.x, startPosition.y, startPosition.z);
            car.mesh.quaternion.set(startRotation.x, startRotation.y, startRotation.z, startRotation.w);
            
            // Reset wheel rotations if we have wheels
            if (car.wheels && car.wheels.length > 0) {
                car.wheels.forEach(wheel => {
                    if (wheel) {
                        // Reset steering rotation (y-axis)
                        wheel.rotation.y = 0;
                    }
                });
            }
        }
        
        // Reset target position and rotation
        car.targetPosition = { ...startPosition };
        car.targetRotation = { x: 0, y: 0, z: 0 };
        car.velocity = { x: 0, y: 0, z: 0 };
        car.speed = 0;
        
        console.log(`Reset car ${playerId} to starting position`);
    } catch (error) {
        console.error(`Error resetting car ${playerId}:`, error);
    }
}

// Function to reset all cars
function resetAllCars() {
    console.log("Resetting all cars...");
    Object.keys(gameState.cars).forEach(playerId => {
        resetCarPosition(playerId);
    });

    // Force a physics world step to ensure all resets take effect
    if (gameState.physics.world && typeof gameState.physics.world.step === 'function') {
        gameState.physics.world.step();
    }

    console.log("All cars reset complete");
}

// Expose reset functions for testing and debug panel
window.resetCarPosition = resetCarPosition;
window.resetAllCars = resetAllCars;

// Initialize the stats overlay style
function initStatsOverlay() {
    const style = document.createElement('style');
    style.textContent = `
        .game-title {
            font-size: 2.5em;
            color: #f72585;
            text-align: center;
            margin-bottom: 1em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        #stats-overlay {
            position: absolute;
            top: 10px;
            left: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            z-index: 1000;
            max-width: 300px;
            pointer-events: auto;
        }
        #stats-overlay.hidden {
            display: none;
        }
        .stats-header {
            font-weight: bold;
            margin-bottom: 5px;
            text-align: center;
        }
        .stats-section {
            margin-top: 5px;
            font-weight: bold;
            border-top: 1px solid rgba(255, 255, 255, 0.3);
            padding-top: 5px;
        }
        .player-stats {
            margin: 10px 0;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        .player-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
            padding-bottom: 5px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }
        .physics-state {
            font-size: 0.8em;
            opacity: 0.8;
        }
        .control-info {
            margin: 5px 0;
            padding: 5px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 3px;
        }
        .reset-button {
            background-color: #e63946;
            color: white;
            border: none;
            border-radius: 3px;
            padding: 3px 8px;
            margin-top: 5px;
            cursor: pointer;
            font-size: 0.8rem;
            font-family: monospace;
        }
        .reset-button-container {
            margin: 10px 0;
            text-align: center;
        }
        #reset-all-cars-btn {
            background-color: #f72585;
            padding: 5px 10px;
        }
        
        /* Control indicator styles */
        .control-bar {
            display: inline-block;
            height: 10px;
            background: #555;
            margin: 0 5px;
            position: relative;
            border-radius: 2px;
            overflow: hidden;
        }
        .control-bar-fill {
            height: 100%;
            position: absolute;
            top: 0;
            transition: width 0.2s ease;
        }
        .control-bar-fill.positive {
            background: #4CAF50;
            left: 50%;
        }
        .control-bar-fill.negative {
            background: #f44336;
            right: 50%;
        }
        .control-bar-center {
            position: absolute;
            width: 1px;
            height: 10px;
            background: #fff;
            top: 0;
            left: 50%;
        }
    `;
    document.head.appendChild(style);
}

// Call this at page load
initStatsOverlay();

// Force a DOM reflow to fix rendering issues
function forceDOMRender() {
    // Force browser to recalculate layout
    const container = elements.gameContainer;
    if (container) {
        container.style.display = 'none';
        container.offsetHeight; // Trigger reflow
        container.style.display = '';
        console.log('DOM render forced');
    }
    
    // Force a Three.js render
    if (gameState.scene && gameState.camera && gameState.renderer) {
        gameState.renderer.render(gameState.scene, gameState.camera);
        console.log('Three.js render forced');
    }
}

// Physics debug visualization
function togglePhysicsDebug() {
    // Initialize the debug property if it doesn't exist
    if (typeof gameState.showPhysicsDebug === 'undefined') {
        gameState.showPhysicsDebug = false;
        gameState.physicsDebugObjects = [];
    }
    
    // Toggle the debug state
    gameState.showPhysicsDebug = !gameState.showPhysicsDebug;
    
    console.log(`Physics debug visualization: ${gameState.showPhysicsDebug ? 'ON' : 'OFF'}`);
    
    // Remove existing debug objects if turning off
    if (!gameState.showPhysicsDebug) {
        removePhysicsDebugObjects();
    } else {
        // Force immediate update if turning on
        updatePhysicsDebugVisualization();
    }
}

// Remove all physics debug visualization objects
function removePhysicsDebugObjects() {
    if (gameState.physicsDebugObjects && gameState.physicsDebugObjects.length > 0) {
        gameState.physicsDebugObjects.forEach(obj => {
            if (obj && gameState.scene) {
                gameState.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            }
        });
        gameState.physicsDebugObjects = [];
    }
}

// Update or create physics debug visualization
function updatePhysicsDebugVisualization() {
    // Clear existing debug objects
    removePhysicsDebugObjects();
    
    // Initialize logging status if not already done
    if (!gameState.physicsDebugLogs) {
        gameState.physicsDebugLogs = {
            noPhysicsWarning: false,
            carsWithoutPhysics: {},
            lastFullLog: 0
        };
    }
    
    // Ensure we have physics enabled and healthy
    if (!gameState.physics || !gameState.physics.initialized || !gameState.physics.world || !gameState.physics.healthy) {
        if (!gameState.physicsDebugLogs.noPhysicsWarning) {
            console.warn('Physics debug visualization requested but physics is not available or unhealthy');
            gameState.physicsDebugLogs.noPhysicsWarning = true;
        }
        return;
    }

    const world = gameState.physics.world;
    
    // Check if the world has the debugRender method (Rapier should provide this)
    if (world.debugRender) {
        try {
            // Use Rapier's built-in debug render function
            const { vertices, colors } = world.debugRender();
            
            // Log debug data to understand the format
            if (!gameState.debugRenderLogged) {
                console.log('Rapier debug render data:', {
                    verticesLength: vertices.length,
                    colorsLength: colors.length,
                    firstFewVertices: vertices.slice(0, 10),
                    firstFewColors: colors.slice(0, 10)
                });
                gameState.debugRenderLogged = true;
            }
            
            gameState.debugCounters.physicsDebugLines = vertices.length / 6; // 6 values per line (3D start and end points)
            
            // Create a single geometry for all the debug lines
            const positions = [];
            
            // Process vertices as 3D line segments (Rapier returns [x1,y1,z1,x2,y2,z2,...])
            for (let i = 0; i < vertices.length; i += 6) {
                // Only add valid line segments
                if (i + 5 < vertices.length) {
                    // Line start point
                    positions.push(vertices[i], vertices[i + 1], vertices[i + 2]);
                    
                    // Line end point
                    positions.push(vertices[i + 3], vertices[i + 4], vertices[i + 5]);
                }
            }
            
            // Create geometry and material
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            
            const material = new THREE.LineBasicMaterial({
                color: 0x00ff00,
                linewidth: 1,
                opacity: 1.0,
                transparent: false
            });
            
            // Create the lines object and add to scene
            const lines = new THREE.LineSegments(geometry, material);
            gameState.scene.add(lines);
            
            // Track for later removal
            gameState.physicsDebugObjects.push(lines);
            
            return;
        } catch (error) {
            console.error('Error using Rapier debug render:', error);
        }
    }
    
    // Fallback to manual wireframe creation if debug render not available
    console.log('Falling back to manual physics debug visualization');
    
    // Only log full debug info once per session or every 10 seconds
    const now = Date.now();
    const shouldLogFull = !gameState.physicsDebugLogs.lastFullLog || 
                         (now - gameState.physicsDebugLogs.lastFullLog > 10000);
    
    if (shouldLogFull) {
        console.log('Number of cars:', Object.keys(gameState.cars).length);
        gameState.physicsDebugLogs.lastFullLog = now;
    }
    
    // Create wireframe boxes for each car's physics body
    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        
        if (!car || !car.physicsBody) {
            // Only log this warning once per car
            if (!gameState.physicsDebugLogs.carsWithoutPhysics[playerId]) {
                console.warn(`Car ${playerId} has no physics body`);
                gameState.physicsDebugLogs.carsWithoutPhysics[playerId] = true;
            }
            return;
        }
        
        // If a car previously didn't have physics but now does, log that
        if (gameState.physicsDebugLogs.carsWithoutPhysics[playerId]) {
            console.log(`Car ${playerId} now has a physics body`);
            gameState.physicsDebugLogs.carsWithoutPhysics[playerId] = false;
        }
        
        try {
            // Get actual dimensions from the physics body if possible
            let carWidth = 2;  // Default car width
            let carHeight = 1; // Default car height
            let carLength = 4; // Default car length
            
            // Try to get actual dimensions from the body's colliders
            if (car.physicsBody.collider && typeof car.physicsBody.collider === 'function') {
                const collider = car.physicsBody.collider(0);
                if (collider && collider.halfExtents) {
                    const halfExtents = collider.halfExtents();
                    carWidth = halfExtents.x * 2;
                    carHeight = halfExtents.y * 2;
                    carLength = halfExtents.z * 2;
                }
            }
            
            // Create wireframe box geometry
            const wireGeometry = new THREE.BoxGeometry(carWidth, carHeight, carLength);
            const wireframe = new THREE.LineSegments(
                new THREE.WireframeGeometry(wireGeometry),
                new THREE.LineBasicMaterial({ 
                    color: 0x00ff00,  // Green wireframe
                    linewidth: 2,      // Line width (note: may not work in WebGL)
                    opacity: 1.0,
                    transparent: false
                })
            );
            
            // Get physics body position and rotation
            const physicsPos = car.physicsBody.translation();
            const physicsRot = car.physicsBody.rotation();
            
            if (shouldLogFull) {
                console.log(`Physics position for car ${playerId}:`, physicsPos);
                console.log(`Physics rotation for car ${playerId}:`, physicsRot);
            }
            
            // Set wireframe position to match physics body
            wireframe.position.set(physicsPos.x, physicsPos.y, physicsPos.z);
            
            // Set wireframe rotation to match physics body
            wireframe.quaternion.set(
                physicsRot.x,
                physicsRot.y,
                physicsRot.z,
                physicsRot.w
            );
            
            // Add to scene and track for later removal
            gameState.scene.add(wireframe);
            gameState.physicsDebugObjects.push(wireframe);
        } catch (error) {
            console.error(`Error creating wireframe for car ${playerId}:`, error);
        }
    });
    
    // Also add a ground plane wireframe if we have one
    if (gameState.physics.bodies && gameState.physics.bodies.ground) {
        try {
            // Ground plane is a cuboid with dimensions from the physics
            const groundGeometry = new THREE.BoxGeometry(200, 0.2, 200);
            const groundWireframe = new THREE.LineSegments(
                new THREE.WireframeGeometry(groundGeometry),
                new THREE.LineBasicMaterial({ 
                    color: 0x0000ff,  // Blue wireframe
                    linewidth: 1,
                    opacity: 1.0,
                    transparent: false
                })
            );
            
            // Ground is at y=0
            groundWireframe.position.set(0, 0, 0);
            
            // Add to scene and track
            gameState.scene.add(groundWireframe);
            gameState.physicsDebugObjects.push(groundWireframe);
        } catch (error) {
            console.error('Error creating ground wireframe:', error);
        }
    }
    
    // Add track walls if we have them
    if (gameState.physics.bodies && gameState.physics.bodies.walls) {
        gameState.physics.bodies.walls.forEach((wallBody, index) => {
            try {
                // Try to get wall dimensions and position
                const wallTranslation = wallBody.translation();
                
                // Use more accurate wall dimensions based on our creation code
                let wallWidth, wallHeight, wallLength;
                
                // Determine if this is a side wall or end wall based on index
                if (index < 2) {
                    // Side walls (left, right)
                    wallWidth = 0.5;
                    wallHeight = 2;
                    wallLength = 40;
                } else {
                    // End walls (top, bottom)
                    wallWidth = 21; // trackWidth + wallThickness*2
                    wallHeight = 2;
                    wallLength = 0.5;
                }
                
                // Create a box wireframe for walls with correct dimensions
                const wallGeometry = new THREE.BoxGeometry(wallWidth, wallHeight, wallLength);
                const wallWireframe = new THREE.LineSegments(
                    new THREE.WireframeGeometry(wallGeometry),
                    new THREE.LineBasicMaterial({ 
                        color: 0xff0000,  // Red wireframe
                        linewidth: 1,
                        opacity: 1.0,
                        transparent: false
                    })
                );
                
                // Position the wireframe at the wall's position
                wallWireframe.position.set(
                    wallTranslation.x,
                    wallTranslation.y,
                    wallTranslation.z
                );
                
                // Apply rotation if available
                const wallRotation = wallBody.rotation();
                if (wallRotation) {
                    wallWireframe.quaternion.set(
                        wallRotation.x,
                        wallRotation.y,
                        wallRotation.z,
                        wallRotation.w
                    );
                }
                
                // Add to scene and track
                gameState.scene.add(wallWireframe);
                gameState.physicsDebugObjects.push(wallWireframe);
            } catch (error) {
                console.error(`Error creating wireframe for wall ${index}:`, error);
            }
        });
    }
    
    // Update debug counter
    gameState.debugCounters.physicsDebugLines = gameState.physicsDebugObjects.length;
}

// Function to ensure a car has a physics body
function ensureCarHasPhysicsBody(playerId) {
    const car = gameState.cars[playerId];
    const player = gameState.players[playerId];
    
    if (!car || !player) return false;
    
    // If car already has a physics body, nothing to do
    if (car.physicsBody) return true;
    
    // Only try to create a physics body if physics is properly initialized
    if (!gameState.physics.initialized || !gameState.physics.world || !gameState.physics.usingRapier) {
        return false;
    }
    
    console.log(`Creating missing physics body for car ${playerId}`);
    
    try {
        // Get car dimensions
        const carDimensions = {
            width: 2,    // Car width
            height: 1,   // Car height
            length: 4    // Car length
        };
        
        // Create physics body for car using car's current position
        const physicsBody = rapierPhysics.createCarPhysics(
            gameState.physics.world,
            { 
                x: car.mesh.position.x, 
                y: car.mesh.position.y, 
                z: car.mesh.position.z 
            },
            carDimensions
        );
        
        if (physicsBody) {
            console.log(`Successfully created physics body for car ${playerId}`);
            
            // Set rotation to match visual mesh
            const quaternion = car.mesh.quaternion.clone();
            physicsBody.setRotation({
                x: quaternion.x,
                y: quaternion.y,
                z: quaternion.z,
                w: quaternion.w
            }, true);
            
            // Assign physics body to car
            car.physicsBody = physicsBody;
            return true;
        }
    } catch (error) {
        console.error(`Error creating physics body for car ${playerId}:`, error);
    }
    
    return false;
}

// Add fullscreen handling functions
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        elements.gameScreen.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

// Update fullscreen button icon based on state
function updateFullscreenButton() {
    const isFullscreen = document.fullscreenElement !== null;
    elements.fullscreenBtn.innerHTML = isFullscreen ? `
        <svg viewBox="0 0 24 24">
            <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
        </svg>
    ` : `
        <svg viewBox="0 0 24 24">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>
    `;
}

// Add event listeners for fullscreen
document.addEventListener('fullscreenchange', updateFullscreenButton);
elements.fullscreenBtn.addEventListener('click', toggleFullscreen);

// Helper function to create a visual bar indicator for control values
function createBarIndicator(value, min, max) {
    // For symmetric controls like steering (-1 to 1)
    const isSymmetric = min < 0 && max > 0;
    const barWidth = 60; // Width in pixels
    
    if (isSymmetric) {
        // Create a bar with center marker and fill from center
        const fillPercent = Math.abs(value) / Math.max(Math.abs(min), Math.abs(max)) * 50;
        const fillDirection = value >= 0 ? 'positive' : 'negative';
        
        return `
            <span class="control-bar" style="width: ${barWidth}px;">
                <span class="control-bar-center"></span>
                <span class="control-bar-fill ${fillDirection}" style="width: ${fillPercent}%;"></span>
            </span>
        `;
    } else {
        // Create a simple fill bar for non-symmetric values (0 to 1)
        const fillPercent = (value - min) / (max - min) * 100;
        
        return `
            <span class="control-bar" style="width: ${barWidth}px;">
                <span class="control-bar-fill positive" style="width: ${fillPercent}%;"></span>
            </span>
        `;
    }
}

// Function to visualize forces applied to the car for debugging
function visualizeAppliedForces() {
    if (!gameState.showPhysicsDebug) return;
    
    // Remove any existing force visualization
    if (gameState.forceVisualization) {
        gameState.forceVisualization.forEach(arrow => {
            if (arrow && gameState.scene) {
                gameState.scene.remove(arrow);
            }
        });
        gameState.forceVisualization = [];
    } else {
        gameState.forceVisualization = [];
    }
    
    // Visualize forces on each car
    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        if (!car || !car.physicsBody || !car.physicsBody.userData || !car.physicsBody.userData.lastAppliedForces) return;
        
        const forces = car.physicsBody.userData.lastAppliedForces;
        const position = car.mesh.position.clone();
        
        try {
            // Visualize engine force (forward/backward)
            if (Math.abs(forces.engineForce) > 100) {
                const engineDir = new THREE.Vector3(0, 0, -Math.sign(forces.engineForce));
                engineDir.applyQuaternion(car.mesh.quaternion);
                
                const engineForceArrow = new THREE.ArrowHelper(
                    engineDir.normalize(),
                    position.clone().add(new THREE.Vector3(0, 1.5, 0)),
                    Math.min(Math.abs(forces.engineForce) / 1000, 5),
                    0x00ff00, // Green
                    0.5,
                    0.3
                );
                gameState.scene.add(engineForceArrow);
                gameState.forceVisualization.push(engineForceArrow);
            }
            
            // Visualize brake force (always backward)
            if (forces.brakeForce > 100) {
                const brakeDir = new THREE.Vector3(0, 0, 1);
                brakeDir.applyQuaternion(car.mesh.quaternion);
                
                const brakeForceArrow = new THREE.ArrowHelper(
                    brakeDir.normalize(),
                    position.clone().add(new THREE.Vector3(0, 1.2, 0)),
                    Math.min(forces.brakeForce / 1000, 5),
                    0xff0000, // Red
                    0.5,
                    0.3
                );
                gameState.scene.add(brakeForceArrow);
                gameState.forceVisualization.push(brakeForceArrow);
            }
            
            // Visualize lateral force (sideways)
            if (Math.abs(forces.lateralForce) > 100) {
                const lateralDir = new THREE.Vector3(Math.sign(forces.lateralForce), 0, 0);
                lateralDir.applyQuaternion(car.mesh.quaternion);
                
                const lateralForceArrow = new THREE.ArrowHelper(
                    lateralDir.normalize(),
                    position.clone().add(new THREE.Vector3(0, 0.9, 0)),
                    Math.min(Math.abs(forces.lateralForce) / 500, 5),
                    0x0000ff, // Blue
                    0.5,
                    0.3
                );
                gameState.scene.add(lateralForceArrow);
                gameState.forceVisualization.push(lateralForceArrow);
            }
        } catch (error) {
            console.error('Error visualizing forces:', error);
        }
    });
}

// Global object to store physics parameters
let physicsParams = {
    car: {
        // Engine/Drive - maps to vehicleController
        engineForce: 200.0,
        brakeForce: 50.0,
        maxSteeringAngle: 0.55,

        // Body physics - maps to rigidBody
        density: 4.0,
        linearDamping: 0.25,
        angularDamping: 0.6
    },
    world: {
        gravity: { x: 0.0, y: -12.0, z: 0.0 }
    },
    wheels: {
        frictionSlip: 1000.0,
        rearFrictionMultiplier: 1.0,
        sideFrictionStiffness: 1.0,
        suspensionRestLength: 0.5,
        suspensionStiffness: 30.0,
        suspensionDamping: 3.0,
        suspensionCompression: 2.0,
        maxSuspensionTravel: 0.3
    }
};

// Store original values for reset
const defaultPhysicsParams = JSON.parse(JSON.stringify(physicsParams));

// localStorage keys for persistence
const PHYSICS_STORAGE_KEY = 'racerPhysicsParams';
const PROFILES_STORAGE_KEY = 'racerPhysicsProfiles';

// Deep merge utility for loading saved params
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// Load saved params from localStorage
function loadPhysicsParams() {
    try {
        const saved = localStorage.getItem(PHYSICS_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Deep merge to preserve any new params not in saved data
            physicsParams = deepMerge(defaultPhysicsParams, parsed);
            console.log('Loaded physics params from localStorage');
        }
    } catch (e) {
        console.warn('Failed to load physics params:', e);
    }
}

// Save current params to localStorage
function savePhysicsParams() {
    try {
        localStorage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify(physicsParams));
    } catch (e) {
        console.warn('Failed to save physics params:', e);
    }
}

// Get all saved profiles
function getPhysicsProfiles() {
    try {
        const saved = localStorage.getItem(PROFILES_STORAGE_KEY);
        return saved ? JSON.parse(saved) : {};
    } catch (e) {
        return {};
    }
}

// Save a profile
function savePhysicsProfile(name) {
    const profiles = getPhysicsProfiles();
    profiles[name] = JSON.parse(JSON.stringify(physicsParams));
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    updateProfileUI();
    console.log(`Saved physics profile: ${name}`);
}

// Load a profile
function loadPhysicsProfile(name) {
    const profiles = getPhysicsProfiles();
    if (profiles[name]) {
        physicsParams = deepMerge(defaultPhysicsParams, profiles[name]);
        window.physicsParams = physicsParams;
        updateAllParameterControls();
        applyPhysicsChanges();
        savePhysicsParams(); // Also save as current
        console.log(`Loaded physics profile: ${name}`);
    }
}

// Delete a profile
function deletePhysicsProfile(name) {
    const profiles = getPhysicsProfiles();
    delete profiles[name];
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    updateProfileUI();
    console.log(`Deleted physics profile: ${name}`);
}

// Export current settings as JSON file
function exportPhysicsProfile() {
    const json = JSON.stringify(physicsParams, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'physics-profile.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('Exported physics profile to JSON');
}

// Update profile dropdown UI
function updateProfileUI() {
    const select = document.getElementById('profile-select');
    if (!select) return;

    const profiles = getPhysicsProfiles();
    select.innerHTML = '<option value="">-- Saved Profiles --</option>';

    Object.keys(profiles).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

// Presets for different physics behaviors
const physicsPresets = {
    default: JSON.parse(JSON.stringify(physicsParams)),
    arcade: {
        car: {
            engineForce: 300.0,
            brakeForce: 80.0,
            maxSteeringAngle: 0.7,
            density: 3.0,
            linearDamping: 0.3,
            angularDamping: 0.8
        },
        world: {
            gravity: { x: 0.0, y: -10.0, z: 0.0 }
        },
        wheels: {
            frictionSlip: 1500.0,
            rearFrictionMultiplier: 1.1,
            sideFrictionStiffness: 1.5,
            suspensionRestLength: 0.5,
            suspensionStiffness: 25.0,
            suspensionDamping: 2.5,
            suspensionCompression: 1.5,
            maxSuspensionTravel: 0.35
        }
    },
    simulation: {
        car: {
            engineForce: 150.0,
            brakeForce: 60.0,
            maxSteeringAngle: 0.5,
            density: 5.0,
            linearDamping: 0.2,
            angularDamping: 0.5
        },
        world: {
            gravity: { x: 0.0, y: -9.81, z: 0.0 }
        },
        wheels: {
            frictionSlip: 800.0,
            rearFrictionMultiplier: 1.0,
            sideFrictionStiffness: 1.2,
            suspensionRestLength: 0.4,
            suspensionStiffness: 35.0,
            suspensionDamping: 4.0,
            suspensionCompression: 2.5,
            maxSuspensionTravel: 0.25
        }
    },
    drift: {
        car: {
            engineForce: 250.0,
            brakeForce: 40.0,
            maxSteeringAngle: 0.8,
            density: 4.0,
            linearDamping: 0.25,
            angularDamping: 0.3
        },
        world: {
            gravity: { x: 0.0, y: -12.0, z: 0.0 }
        },
        wheels: {
            frictionSlip: 600.0,
            rearFrictionMultiplier: 0.7,
            sideFrictionStiffness: 0.6,
            suspensionRestLength: 0.45,
            suspensionStiffness: 28.0,
            suspensionDamping: 2.0,
            suspensionCompression: 1.5,
            maxSuspensionTravel: 0.3
        }
    }
};

// Toggle physics parameter panel
function togglePhysicsPanel() {
    const panel = document.getElementById('physics-params-panel');
    
    if (!panel) {
        console.error('Physics parameters panel not found in DOM');
        return;
    }
    
    panel.classList.toggle('visible');
    
    // Initialize parameters when first shown
    if (panel.classList.contains('visible') && !panel.dataset.initialized) {
        initPhysicsParametersPanel();
        panel.dataset.initialized = 'true';
    }
}

// Initialize the physics parameters panel UI with all controls
function initPhysicsParametersPanel() {
    console.log('Initializing physics parameters panel');
    
    // Setup tab switcher
    setupTabSwitcher();
    
    // Create car parameters UI
    createCarParametersUI();
    
    // Create world parameters UI
    createWorldParametersUI();
    
    // Create wheels parameters UI
    createWheelsParametersUI();
    
    // Setup reset button
    setupPhysicsButtons();
    
    console.log('Physics parameters panel initialized');
}

// Setup tab switching functionality
function setupTabSwitcher() {
    const tabs = document.querySelectorAll('.params-tab');
    const containers = document.querySelectorAll('.params-container');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and containers
            tabs.forEach(t => t.classList.remove('active'));
            containers.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab
            tab.classList.add('active');
            
            // Show corresponding container
            const targetId = tab.dataset.tab + '-params';
            document.getElementById(targetId).classList.add('active');
        });
    });
}

// Create a single parameter control row
function createParameterControl(container, group, param, label, min, max, step) {
    const row = document.createElement('div');
    row.className = 'param-row';
    
    const labelElement = document.createElement('div');
    labelElement.className = 'param-label';
    labelElement.textContent = label;
    
    const valueInput = document.createElement('input');
    valueInput.className = 'param-value';
    valueInput.type = 'text';
    valueInput.value = physicsParams[group][param];
    valueInput.dataset.group = group;
    valueInput.dataset.param = param;
    
    const slider = document.createElement('input');
    slider.className = 'param-slider';
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = physicsParams[group][param];
    slider.dataset.group = group;
    slider.dataset.param = param;
    
    // Add event listeners with immediate application
    slider.addEventListener('input', () => {
        valueInput.value = slider.value;
        updatePhysicsParameter(group, param, parseFloat(slider.value));
        applyPhysicsChanges(); // Apply changes immediately
    });
    
    valueInput.addEventListener('change', () => {
        const value = parseFloat(valueInput.value);
        if (!isNaN(value)) {
            slider.value = value;
            updatePhysicsParameter(group, param, value);
            applyPhysicsChanges(); // Apply changes immediately
        } else {
            valueInput.value = physicsParams[group][param];
        }
    });
    
    const rangeDisplay = document.createElement('div');
    rangeDisplay.className = 'param-range';
    
    const minSpan = document.createElement('span');
    minSpan.textContent = min;
    
    const maxSpan = document.createElement('span');
    maxSpan.textContent = max;
    
    rangeDisplay.appendChild(minSpan);
    rangeDisplay.appendChild(maxSpan);
    
    row.appendChild(labelElement);
    row.appendChild(valueInput);
    row.appendChild(slider);
    
    container.appendChild(row);
    container.appendChild(rangeDisplay);
}

// Create UI controls for car parameters
function createCarParametersUI() {
    const carBodyGroup = document.querySelector('#car-params .params-group:nth-child(1)');
    const movementGroup = document.querySelector('#car-params .params-group:nth-child(2)');

    // Update group title
    const carBodyGroupTitle = carBodyGroup.querySelector('.params-group-title');
    if (carBodyGroupTitle) {
        carBodyGroupTitle.textContent = 'Body Physics';
    }

    const movementGroupTitle = movementGroup.querySelector('.params-group-title');
    if (movementGroupTitle) {
        movementGroupTitle.textContent = 'Drive & Steering';
    }

    // Body physics parameters
    createParameterControl(carBodyGroup, 'car', 'density', 'Density (mass)', 1.0, 10.0, 0.5);
    createParameterControl(carBodyGroup, 'car', 'linearDamping', 'Linear Damping', 0.0, 1.0, 0.05);
    createParameterControl(carBodyGroup, 'car', 'angularDamping', 'Angular Damping', 0.0, 2.0, 0.1);

    // Drive parameters
    createParameterControl(movementGroup, 'car', 'engineForce', 'Engine Force', 50.0, 500.0, 10.0);
    createParameterControl(movementGroup, 'car', 'brakeForce', 'Brake Force', 10.0, 200.0, 5.0);
    createParameterControl(movementGroup, 'car', 'maxSteeringAngle', 'Max Steering', 0.3, 1.0, 0.05);
}

// Create UI controls for world parameters
function createWorldParametersUI() {
    const worldGroup = document.querySelector('#world-params .params-group');

    // World physics
    createParameterControl(worldGroup, 'world', 'gravity.y', 'World Gravity Y', -30, -5, 0.5);
}

// Create UI controls for wheels parameters
function createWheelsParametersUI() {
    const wheelGroup = document.querySelector('#wheels-params .params-group:nth-child(1)');
    const suspensionGroup = document.querySelector('#wheels-params .params-group:nth-child(2)');

    // Update group titles
    const wheelGroupTitle = wheelGroup.querySelector('.params-group-title');
    if (wheelGroupTitle) {
        wheelGroupTitle.textContent = 'Wheel Friction';
    }

    const suspensionGroupTitle = suspensionGroup.querySelector('.params-group-title');
    if (suspensionGroupTitle) {
        suspensionGroupTitle.textContent = 'Suspension';
    }

    // Wheel friction settings
    createParameterControl(wheelGroup, 'wheels', 'frictionSlip', 'Friction Slip', 100.0, 2000.0, 50.0);
    createParameterControl(wheelGroup, 'wheels', 'rearFrictionMultiplier', 'Rear Friction Mult', 0.5, 2.0, 0.1);
    createParameterControl(wheelGroup, 'wheels', 'sideFrictionStiffness', 'Side Friction', 0.5, 2.0, 0.1);

    // Suspension settings
    createParameterControl(suspensionGroup, 'wheels', 'suspensionRestLength', 'Rest Length', 0.2, 1.0, 0.05);
    createParameterControl(suspensionGroup, 'wheels', 'suspensionStiffness', 'Stiffness', 10.0, 60.0, 2.0);
    createParameterControl(suspensionGroup, 'wheels', 'suspensionDamping', 'Damping (Relax)', 1.0, 10.0, 0.5);
    createParameterControl(suspensionGroup, 'wheels', 'suspensionCompression', 'Compression', 0.5, 5.0, 0.5);
    createParameterControl(suspensionGroup, 'wheels', 'maxSuspensionTravel', 'Max Travel', 0.1, 0.5, 0.05);
}

// Setup physics parameter buttons
function setupPhysicsButtons() {
    // Reset button
    const resetBtn = document.getElementById('reset-physics');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Reset to default values
            physicsParams = JSON.parse(JSON.stringify(defaultPhysicsParams));
            window.physicsParams = physicsParams;

            // Update UI
            updateAllParameterControls();

            // Apply changes
            applyPhysicsChanges();
            savePhysicsParams();

            // Clear active preset buttons
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        });
    }

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presetName = btn.dataset.preset;
            if (physicsPresets[presetName]) {
                physicsParams = JSON.parse(JSON.stringify(physicsPresets[presetName]));
                window.physicsParams = physicsParams;
                updateAllParameterControls();
                applyPhysicsChanges();
                savePhysicsParams();

                // Update active state
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });

    // Save profile button
    const saveProfileBtn = document.getElementById('save-profile');
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('profile-name');
            const name = nameInput.value.trim();
            if (name) {
                savePhysicsProfile(name);
                nameInput.value = '';
            }
        });
    }

    // Load profile button
    const loadProfileBtn = document.getElementById('load-profile');
    if (loadProfileBtn) {
        loadProfileBtn.addEventListener('click', () => {
            const select = document.getElementById('profile-select');
            if (select && select.value) {
                loadPhysicsProfile(select.value);
            }
        });
    }

    // Delete profile button
    const deleteProfileBtn = document.getElementById('delete-profile');
    if (deleteProfileBtn) {
        deleteProfileBtn.addEventListener('click', () => {
            const select = document.getElementById('profile-select');
            if (select && select.value) {
                if (confirm(`Delete profile "${select.value}"?`)) {
                    deletePhysicsProfile(select.value);
                }
            }
        });
    }

    // Export profile button
    const exportProfileBtn = document.getElementById('export-profile');
    if (exportProfileBtn) {
        exportProfileBtn.addEventListener('click', exportPhysicsProfile);
    }

    // Initialize profile dropdown
    updateProfileUI();
}

// Update a specific physics parameter
function updatePhysicsParameter(group, param, value) {
    // Handle nested properties (e.g., gravity.y)
    if (param.includes('.')) {
        const parts = param.split('.');
        let obj = physicsParams[group];
        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
    } else {
        physicsParams[group][param] = value;
    }

    // Auto-save to localStorage after each change
    savePhysicsParams();
}

// Update all UI controls to match current parameter values
function updateAllParameterControls() {
    const inputs = document.querySelectorAll('#physics-params-panel input');
    
    inputs.forEach(input => {
        const group = input.dataset.group;
        const param = input.dataset.param;
        
        if (group && param) {
            // Handle nested properties
            let value;
            if (param.includes('.')) {
                const parts = param.split('.');
                let obj = physicsParams[group];
                for (let i = 0; i < parts.length; i++) {
                    obj = obj[parts[i]];
                }
                value = obj;
            } else {
                value = physicsParams[group][param];
            }
            
            input.value = value;
        }
    });
}

// Apply physics changes to active car bodies (now using character controller)
function applyPhysicsChanges() {
    try {
        // Apply changes to world physics
        if (gameState.physics && gameState.physics.world) {
            updateWorldPhysics(gameState.physics.world);
        }

        // Apply changes to existing car controllers
        for (const playerId in gameState.players) {
            const player = gameState.players[playerId];

            if (player.carBody) {
                updateCarControllerConfig(player.carBody);
            }
        }
    } catch (error) {
        console.error('Error applying physics changes:', error);
    }
}

// Update car physics body configuration with current parameters
function updateCarControllerConfig(carBody) {
    if (!carBody || !carBody.userData) return;

    try {
        const userData = carBody.userData;
        const vc = userData.vehicleController;

        // Update control parameters (used by applyCarControls in rapierPhysics.js)
        userData.engineForce = physicsParams.car.engineForce;
        userData.brakeForce = physicsParams.car.brakeForce;
        userData.maxSteeringAngle = physicsParams.car.maxSteeringAngle;

        // Update damping on the rigid body itself
        if (typeof carBody.setLinearDamping === 'function') {
            carBody.setLinearDamping(physicsParams.car.linearDamping);
            carBody.setAngularDamping(physicsParams.car.angularDamping);
        }

        // Update vehicle controller wheel parameters directly via Rapier API
        if (vc) {
            const numWheels = typeof vc.numWheels === 'function' ? vc.numWheels() : 4;

            for (let i = 0; i < numWheels; i++) {
                const isFront = i < 2;
                const frictionMult = isFront ? 1.0 : physicsParams.wheels.rearFrictionMultiplier;

                // Suspension parameters
                if (typeof vc.setWheelSuspensionStiffness === 'function') {
                    vc.setWheelSuspensionStiffness(i, physicsParams.wheels.suspensionStiffness);
                }
                if (typeof vc.setWheelSuspensionCompression === 'function') {
                    vc.setWheelSuspensionCompression(i, physicsParams.wheels.suspensionCompression);
                }
                if (typeof vc.setWheelSuspensionRelaxation === 'function') {
                    vc.setWheelSuspensionRelaxation(i, physicsParams.wheels.suspensionDamping);
                }
                if (typeof vc.setWheelMaxSuspensionTravel === 'function') {
                    vc.setWheelMaxSuspensionTravel(i, physicsParams.wheels.maxSuspensionTravel);
                }

                // Friction
                if (typeof vc.setWheelFrictionSlip === 'function') {
                    vc.setWheelFrictionSlip(i, physicsParams.wheels.frictionSlip * frictionMult);
                }

                // Side friction stiffness if available
                if (typeof vc.setWheelSideFrictionStiffness === 'function') {
                    vc.setWheelSideFrictionStiffness(i, physicsParams.wheels.sideFrictionStiffness);
                }
            }
        }

        // Also update legacy userData.wheels for any code that might read it
        if (userData.wheels) {
            userData.wheels.forEach((wheel, i) => {
                const isFront = i < 2;
                wheel.suspensionStiffness = physicsParams.wheels.suspensionStiffness;
                wheel.suspensionDamping = physicsParams.wheels.suspensionDamping;
                wheel.suspensionRestLength = physicsParams.wheels.suspensionRestLength;
                wheel.frictionSlip = physicsParams.wheels.frictionSlip *
                    (isFront ? 1.0 : physicsParams.wheels.rearFrictionMultiplier);
            });
        }
    } catch (error) {
        console.error('Error updating car physics config:', error);
    }
}

// Update world physics
function updateWorldPhysics(world) {
    if (!world || typeof world.setGravity !== 'function') return;
    
    try {
        // Update gravity
        world.setGravity(physicsParams.world.gravity);
    } catch (error) {
        console.error('Error updating world physics:', error);
    }
}

// Add keyboard listener for F2 to toggle physics panel is now handled in initGame
// Removing this duplicate event listener

// Add initialization call to initGame
const originalInitGame = initGame;
initGame = function() {
    // Load saved physics params from localStorage BEFORE calling original init
    loadPhysicsParams();

    // Make physicsParams available globally BEFORE other modules use it
    window.physicsParams = physicsParams;

    // Call the original initGame function
    originalInitGame();

    // Initialize physics panel HTML content
    const gameScreen = document.getElementById('game-screen');
    const existingPanel = document.getElementById('physics-params-panel');

    // If the panel already exists in HTML, just make sure it's properly initialized
    if (existingPanel) {
        console.log('Physics parameters panel found in HTML');
    } else {
        // Otherwise dynamically add it - this is a fallback
        console.log('Creating physics parameters panel programmatically');
        const panel = document.createElement('div');
        panel.id = 'physics-params-panel';
        gameScreen.appendChild(panel);
    }

    // Add key event listener if not already added
    if (!window.physicsKeyListenerAdded) {
        document.addEventListener('keydown', function(event) {
            // F2 key to toggle physics panel
            if (event.key === 'F2') {
                togglePhysicsPanel();
                event.preventDefault();
            }
        });
        window.physicsKeyListenerAdded = true;
    }
};

// ... existing code ... 