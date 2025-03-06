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
    forceVisualization: []
};

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
        // Create the control indicator if it doesn't exist yet
        if (!gameState.controlIndicator) {
            gameState.controlIndicator = createControlIndicator();
        }
        
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
            // Now create cars after physics is initialized
            console.log('Physics initialized, now creating cars');
            
            // Create cars for each player with spread-out starting positions
            const playerIds = Object.keys(gameState.players);
            
            // Create cars for each player
            playerIds.forEach((playerId, index) => {
                const player = gameState.players[playerId];
                createPlayerCar(playerId, player.color);
            });
            
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
        console.log('Player data:', player);
        
        // Set default color if none provided
        const color = carColor || "#FF0000";
        
        // Create a simple car mesh
        const car = createCar({ color });
        
        // Add to scene
        gameState.scene.add(car);
        
        // Set start position near the start/finish line with higher elevation
        const startPosition = { x: 0, y: 2.0, z: -20 }; // Increased height to avoid ground issues
        
        // Apply position to mesh
        car.position.set(startPosition.x, startPosition.y, startPosition.z);
        
        // Initialize physics body if physics is available
        let physicsBody = null;
        
        if (gameState.physics && gameState.physics.initialized && 
            gameState.physics.world && gameState.physics.usingRapier) {
            console.log("Creating Rapier physics body for car");
            
            // Get car dimensions
            const carDimensions = {
                width: 2,    // Car width
                height: 1,   // Car height
                length: 4    // Car length
            };
            
            try {
                // Create physics body for car with elevated position
                physicsBody = rapierPhysics.createCarPhysics(
                    gameState.physics.world,
                    startPosition,
                    carDimensions
                );
                
                // Check if physics body was created properly
                if (physicsBody) {
                    console.log('Physics body created successfully for player', playerId);
                    console.log('Initial position:', startPosition);
                    
                    // Wake up the physics body immediately and apply a small force to activate it
                    if (typeof physicsBody.wakeUp === 'function') {
                        physicsBody.wakeUp();
                    }
                    
                    // Apply initial push to activate the physics
                    if (typeof physicsBody.applyImpulse === 'function') {
                        // Apply a stronger downward impulse to ensure it hits the ground
                        physicsBody.applyImpulse({ x: 0, y: -0.5, z: 0 }, true);
                        console.log("Applied initial impulse to activate physics");
                    }
                    
                    // Set initial rotation (default to facing forward)
                    physicsBody.setRotation({
                        x: 0,
                        y: 0,
                        z: 0,
                        w: 1
                    }, true);
                } else {
                    console.error('Failed to create physics body for player', playerId);
                }
            } catch (error) {
                console.error('Error creating car physics:', error);
            }
        }
        
        // Store the car data
        gameState.cars[playerId] = {
            mesh: car,
            physicsBody: physicsBody,
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
        try {
            // Check if Rapier is already loaded
            if (window.rapierLoaded) {
                console.log('Rapier is already loaded, initializing physics');
                await initializeWithRapier();
                resolve(true);
            } else {
                console.log('Waiting for Rapier to load...');
                
                // Set up event listener for when Rapier is ready
                window.addEventListener('rapier-ready', async function onRapierReady() {
                    console.log('Received rapier-ready event, initializing physics');
                    window.removeEventListener('rapier-ready', onRapierReady);
                    await initializeWithRapier();
                    resolve(true);
                });
                
                // Fallback timeout in case the event never fires
                setTimeout(() => {
                    console.error('Timed out waiting for Rapier to be ready');
                    resolve(false); // Resolve with false to indicate physics init failed
                }, 5000);
            }
        } catch (error) {
            console.error('Physics initialization error:', error);
            reject(error);
        }
    });
    
    async function initializeWithRapier() {
        try {
            const rapier = await rapierPhysics.init();
            await rapier.init();
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
            
            // Create walls around the track
            createTrackWalls(world, rapier);
            
            gameState.physics.initialized = true;
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
        // Create outer walls based on track dimensions
        const trackWidth = 30;  // Increased to match visible track size
        const trackLength = 60; // Increased to match visible track size
        const wallHeight = 2;
        const wallThickness = 0.5;
        
        // Create walls container
        gameState.physics.bodies.walls = [];
        gameState.physics.colliders.walls = [];
        
        // Left wall
        const leftWallBodyDesc = rapier.RigidBodyDesc.fixed();
        leftWallBodyDesc.setTranslation(-trackWidth/2 - wallThickness/2, wallHeight/2, 0);
        const leftWallBody = world.createRigidBody(leftWallBodyDesc);
        
        const leftWallColliderDesc = rapier.ColliderDesc.cuboid(wallThickness, wallHeight, trackLength);
        leftWallColliderDesc.setFriction(0.2);
        const leftWallCollider = world.createCollider(leftWallColliderDesc, leftWallBody);
        
        gameState.physics.bodies.walls.push(leftWallBody);
        gameState.physics.colliders.walls.push(leftWallCollider);
        
        // Right wall
        const rightWallBodyDesc = rapier.RigidBodyDesc.fixed();
        rightWallBodyDesc.setTranslation(trackWidth/2 + wallThickness/2, wallHeight/2, 0);
        const rightWallBody = world.createRigidBody(rightWallBodyDesc);
        
        const rightWallColliderDesc = rapier.ColliderDesc.cuboid(wallThickness, wallHeight, trackLength);
        rightWallColliderDesc.setFriction(0.2);
        const rightWallCollider = world.createCollider(rightWallColliderDesc, rightWallBody);
        
        gameState.physics.bodies.walls.push(rightWallBody);
        gameState.physics.colliders.walls.push(rightWallCollider);
        
        // Top wall
        const topWallBodyDesc = rapier.RigidBodyDesc.fixed();
        topWallBodyDesc.setTranslation(0, wallHeight/2, -trackLength/2 - wallThickness/2);
        const topWallBody = world.createRigidBody(topWallBodyDesc);
        
        const topWallColliderDesc = rapier.ColliderDesc.cuboid(trackWidth + wallThickness*2, wallHeight, wallThickness);
        topWallColliderDesc.setFriction(0.2);
        const topWallCollider = world.createCollider(topWallColliderDesc, topWallBody);
        
        gameState.physics.bodies.walls.push(topWallBody);
        gameState.physics.colliders.walls.push(topWallCollider);
        
        // Bottom wall
        const bottomWallBodyDesc = rapier.RigidBodyDesc.fixed();
        bottomWallBodyDesc.setTranslation(0, wallHeight/2, trackLength/2 + wallThickness/2);
        const bottomWallBody = world.createRigidBody(bottomWallBodyDesc);
        
        const bottomWallColliderDesc = rapier.ColliderDesc.cuboid(trackWidth + wallThickness*2, wallHeight, wallThickness);
        bottomWallColliderDesc.setFriction(0.2);
        const bottomWallCollider = world.createCollider(bottomWallColliderDesc, bottomWallBody);
        
        gameState.physics.bodies.walls.push(bottomWallBody);
        gameState.physics.colliders.walls.push(bottomWallCollider);
        
        console.log('Created track walls with dimensions:', {
            trackWidth,
            trackLength,
            wallHeight,
            wallThickness
        });
        
    } catch (error) {
        console.error('Error creating track walls:', error);
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
        
        // Skip frames with unreasonable delta times (e.g. after tab was inactive)
        if (deltaTime > 1000) {
            console.log(`Large frame time detected: ${deltaTime}ms, skipping physics update`);
            return;
        }
        
        // Process physics if available
        if (gameState.physics && gameState.physics.world) {
            // Step the physics simulation
            // Limit deltaTime to avoid large steps causing instability (max 1/30th second)
            const physicsStep = Math.min(deltaTime / 1000, 1/30);
            
            // Pass the time step to Rapier's step function
            try {
                // Don't pass the timestep directly - Rapier in this version might not accept it
                // Just call step() without arguments to use default timestep
                gameState.physics.world.step();
                gameState.debugCounters.physicsUpdate++;
                
                // Debug log once every 60 frames
                if (gameState.debugCounters.physicsUpdate % 60 === 0) {
                    console.log('Physics world stepping normally');
                }
            } catch (error) {
                console.error('Physics step error:', error);
            }
            
            // Update all car meshes to match their physics bodies
            Object.keys(gameState.cars).forEach(playerId => {
                const car = gameState.cars[playerId];
                if (car && car.mesh && car.physicsBody) {
                    try {
                        // Get position and rotation from physics body
                        const pos = car.physicsBody.translation();
                        const rot = car.physicsBody.rotation();
                        
                        if (pos && rot) {
                            // Log positions for debugging
                            if (gameState.showPhysicsDebug && gameState.debugCounters.physicsUpdate % 60 === 0) {
                                console.log(`Car ${playerId} physics position:`, pos);
                                console.log(`Car ${playerId} physics velocity:`, car.physicsBody.linvel());
                            }
                            
                            // Update car mesh position
                            car.mesh.position.set(pos.x, pos.y, pos.z);
                            
                            // Update car mesh rotation
                            car.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
                            
                            // Update the car's speed for stats display
                            const vel = car.physicsBody.linvel();
                            if (vel) {
                                const velMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                                car.speed = velMag * 3.6; // Convert to km/h
                                
                                // Also update velocity vector
                                car.velocity = { x: vel.x, y: vel.y, z: vel.z };
                            }
                        }
                    } catch (error) {
                        console.error(`Error updating car ${playerId} from physics:`, error);
                    }
                }
            });
            
            // Apply controls to each car with a physics body
            if (gameState.physics.usingRapier && typeof rapierPhysics.applyCarControls === 'function') {
                Object.keys(gameState.cars).forEach(playerId => {
                    const car = gameState.cars[playerId];
                    if (car && car.physicsBody && car.controls) {
                        try {
                            // Log controls for debugging
                            if (gameState.showPhysicsDebug && 
                                (car.controls.acceleration > 0.1 || car.controls.braking > 0.1 || Math.abs(car.controls.steering) > 0.1) &&
                                gameState.debugCounters.physicsUpdate % 30 === 0) {
                                console.log(`Applying controls to car ${playerId}:`, car.controls);
                            }
                            
                            rapierPhysics.applyCarControls(car.physicsBody, car.controls, playerId);
                        } catch (error) {
                            console.error(`Error applying controls to car ${playerId}:`, error);
                        }
                    }
                });
            }
            
            // Update force visualization if physics debug is enabled
            if (gameState.showPhysicsDebug) {
                visualizeAppliedForces();
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
    
    let statsHTML = '<div class="stats-header">Game Stats (Press F3 to toggle)</div>';
    
    // Add physics engine status
    const physicsStatus = gameState.physics.usingRapier ? 
        '<span style="color:green">Active</span>' : 
        '<span style="color:red">Unavailable</span>';
    
    statsHTML += `<div>Physics: ${physicsStatus}</div>`;
    statsHTML += `<div>Rapier Loaded: ${window.rapierLoaded ? '<span style="color:green">Yes</span>' : '<span style="color:red">No</span>'}</div>`;
    
    // Add physics debug status
    const debugStatus = gameState.showPhysicsDebug ? 
        '<span style="color:green">ON</span> (Press F4 to toggle)' : 
        '<span style="color:#888">OFF</span> (Press F4 to toggle)';
    statsHTML += `<div>Physics Debug: ${debugStatus}</div>`;
    
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
    
    statsHTML += `<div>FPS: ${gameState.fps}</div>`;
    statsHTML += `<div>Players: ${Object.keys(gameState.players).length}</div>`;
    statsHTML += `<div>Cars: ${Object.keys(gameState.cars).length}</div>`;
    
    // Add physics update counter
    statsHTML += `<div>Physics Updates: ${gameState.debugCounters?.physicsUpdate || 0}</div>`;
    if (gameState.showPhysicsDebug) {
        statsHTML += `<div>Debug Lines: ${gameState.debugCounters?.physicsDebugLines || 0}</div>`;
    }
    
    // Add reset all cars button
    statsHTML += `<div class="reset-button-container">
        <button id="reset-all-cars-btn" class="reset-button">Reset All Cars</button>
    </div>`;
    
    // Add detailed player stats with controls and enhanced physics information
    statsHTML += '<div class="stats-section">Player Stats & Car Physics:</div>';
    
    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        const player = gameState.players[playerId];
        if (!car || !player) return;
        
        // Calculate speed from velocity
        let speed = 0;
        let posX = 0, posY = 0, posZ = 0;
        let rotX = 0, rotY = 0, rotZ = 0, rotW = 0;
        let isUpsideDown = false;
        
        // Get physics state (if available)
        if (car.physicsBody) {
            const vel = car.physicsBody.linvel();
            const pos = car.physicsBody.translation();
            const rot = car.physicsBody.rotation();
            
            // Velocity and position
            speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6; // Convert to km/h
            posX = Math.round(pos.x * 100) / 100;
            posY = Math.round(pos.y * 100) / 100;
            posZ = Math.round(pos.z * 100) / 100;
            
            // Rotation
            rotX = Math.round(rot.x * 100) / 100;
            rotY = Math.round(rot.y * 100) / 100;
            rotZ = Math.round(rot.z * 100) / 100;
            rotW = Math.round(rot.w * 100) / 100;
            
            // Check if car is upside down
            if (typeof rapierPhysics.isCarUpsideDown === 'function') {
                isUpsideDown = rapierPhysics.isCarUpsideDown(car.physicsBody);
            }
        }
        
        // Get physics body state
        let physicsState = "No Physics Body";
        let velocityInfo = "";
        
        if (car.physicsBody) {
            const vel = car.physicsBody.linvel();
            const isAwake = typeof car.physicsBody.isAwake === 'function' ? 
                car.physicsBody.isAwake() : "Unknown";
                
            physicsState = `Active: ${isAwake}`;
            velocityInfo = `<div>Velocity: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})</div>`;
            
            // Add upside down indicator
            if (isUpsideDown) {
                physicsState += ' <span style="color:red; font-weight:bold;">UPSIDE DOWN</span>';
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
        
        // Add per-car reset button
        const resetButtonHTML = `
            <div class="reset-button-container">
                <button id="reset-car-${playerId}-btn" class="reset-button car-reset-btn">
                    Reset This Car
                </button>
            </div>`;
        
        // Put it all together
        statsHTML += `
            <div class="player-stats">
                <div class="player-header" style="color: ${player.color}">
                    ${player.name} (ID: ${player.id})
                </div>
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
                ${resetButtonHTML}
            </div>
        `;
    });
    
    elements.statsOverlay.innerHTML = statsHTML;
    
    // Re-attach event listener for reset buttons
    const resetButton = document.getElementById('reset-all-cars-btn');
    if (resetButton) {
        resetButton.onclick = resetAllCars;
    }
    
    // Attach event listeners for individual car reset buttons
    document.querySelectorAll('.car-reset-btn').forEach(button => {
        const playerId = button.id.replace('reset-car-', '').replace('-btn', '');
        button.onclick = () => resetCarPosition(playerId);
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
    
    // Define proper starting position with a safe height above ground
    const startPosition = { x: 0, y: 0.5, z: -20 };
    const startRotation = { x: 0, y: 0, z: 0, w: 1 }; // Identity quaternion (no rotation)
    
    // If we're using Rapier physics, use the improved reset function
    if (car.physicsBody && gameState.physics.world && typeof rapierPhysics.resetCarPosition === 'function') {
        console.log(`Using Rapier's comprehensive reset for car ${playerId}`);
        
        // Call the new reset function that properly resets all physics state
        rapierPhysics.resetCarPosition(
            gameState.physics.world,
            car.physicsBody, 
            startPosition, 
            startRotation
        );
        
        // Also reset wheel steering, suspension, etc. in the wheel data
        if (car.physicsBody.userData && car.physicsBody.userData.wheels) {
            car.physicsBody.userData.wheels.forEach(wheel => {
                wheel.steering = 0;
                wheel.compression = 0;
                wheel.groundContact = false;
                wheel.contactPoint = null;
                wheel.contactNormal = null;
            });
        }
        
        // Extract wheelMeshes from the car mesh if available
        const wheelMeshes = [];
        if (car.mesh && car.mesh.children) {
            // Look for cylinder geometries which should be the wheels
            car.mesh.children.forEach(child => {
                if (child.geometry && 
                    child.geometry.type === "CylinderGeometry" &&
                    child.rotation.z === Math.PI / 2) { // Wheels are rotated 90 degrees
                    wheelMeshes.push(child);
                }
            });
            
            // Sort wheels by position
            if (wheelMeshes.length === 4) {
                wheelMeshes.sort((a, b) => {
                    // Sort first by Z (front/rear)
                    if (a.position.z > b.position.z) return -1;
                    if (a.position.z < b.position.z) return 1;
                    // Then by X (left/right)
                    return a.position.x < b.position.x ? -1 : 1;
                });
            }
        }
        
        // Use the sync function to update visual model
        if (typeof rapierPhysics.syncCarModelWithPhysics === 'function' && wheelMeshes.length > 0) {
            rapierPhysics.syncCarModelWithPhysics(
                car.physicsBody,
                car.mesh,
                wheelMeshes
            );
        } else {
            // Fallback to direct update
            car.mesh.position.set(startPosition.x, startPosition.y, startPosition.z);
            car.mesh.quaternion.set(startRotation.x, startRotation.y, startRotation.z, startRotation.w);
        }
        
        // Reset velocity tracking in our game state
        car.speed = 0;
        car.velocity = [0, 0, 0];
        
        // Reset controls to neutral
        car.controls = {
            steering: 0,
            acceleration: 0,
            braking: 0
        };
    }
    else {
        // Fallback for non-Rapier physics or missing reset function
        console.log(`Using fallback reset for car ${playerId}`);
        
        // Reset mesh position & rotation
        car.mesh.position.set(startPosition.x, startPosition.y, startPosition.z);
        car.mesh.quaternion.set(0, 0, 0, 1); // Identity quaternion (no rotation)
        
        // If physics body exists, try basic reset
        if (car.physicsBody) {
            if (typeof car.physicsBody.setTranslation === 'function') {
                car.physicsBody.setTranslation(startPosition, true);
            }
            
            if (typeof car.physicsBody.setRotation === 'function') {
                car.physicsBody.setRotation(startRotation, true);
            }
            
            if (typeof car.physicsBody.setLinvel === 'function') {
                car.physicsBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
            
            if (typeof car.physicsBody.setAngvel === 'function') {
                car.physicsBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
            
            // Wake up the body to ensure it's active after reset
            if (typeof car.physicsBody.wakeUp === 'function') {
                car.physicsBody.wakeUp();
            }
        }
        
        // Reset velocity and controls in our game state
        car.speed = 0;
        car.velocity = [0, 0, 0];
        car.controls = { steering: 0, acceleration: 0, braking: 0 };
    }
    
    // Notify player to reset their position via server
    socket.emit('reset_player_position', {
        room_code: gameState.roomCode,
        player_id: playerId,
        position: [startPosition.x, startPosition.y, startPosition.z],
        rotation: [0, 0, 0]
    });
    
    // Force an immediate update of the stats display
    if (gameState.showStats) {
        updateStatsDisplay();
    }
    
    console.log(`Reset complete for car ${playerId}`);
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
    
    // Ensure we have physics enabled
    if (!gameState.physics || !gameState.physics.initialized || !gameState.physics.world) {
        if (!gameState.physicsDebugLogs.noPhysicsWarning) {
            console.warn('Physics debug visualization requested but physics is not available');
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
            
            console.log(`Rendered ${gameState.debugCounters.physicsDebugLines} debug lines using Rapier's debugRender`);
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