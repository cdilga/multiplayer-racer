// Host interface logic

// Constants
const GAME_UPDATE_INTERVAL = 1000 / 60; // 60 FPS
const PHYSICS_UPDATE_RATE = 60; // Hz
const PHYSICS_TIMESTEP = 1.0 / PHYSICS_UPDATE_RATE;
let lastPhysicsUpdate = 0;

// Game state
const gameState = {
    roomCode: null,
    players: {},
    scene: null,
    camera: null,
    renderer: null,
    cars: {},
    track: null,
    physics: {
        world: null,
        bodies: {},
        initialized: false,
        rapier: null
    },
    gameActive: false,
    showStats: false, // Display stats toggle
    showPhysicsDebug: false,
    physicsDebugObjects: [],
    physicsDebugLogs: null,
    debugCounters: {
        physicsUpdate: 0,
        controlsUpdate: 0
    }
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
    statsOverlay: document.getElementById('stats-overlay')
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
        console.log('Player controls update received:', data);
        const car = gameState.cars[player_id];
        // Validate and sanitize control inputs before assigning
        car.controls = {
            acceleration: Math.max(0, Math.min(1, acceleration || 0)), // Clamp between 0-1
            braking: Math.max(0, Math.min(1, braking || 0)), // Clamp between 0-1 
            steering: Math.max(-1, Math.min(1, steering || 0)) // Clamp between -1 to 1
        };
        // Update last control update timestamp
        car.lastControlUpdate = Date.now();
        console.log('Car controls:', car.controls);
        // Force stats update since we have new control data
        if (gameState.showStats) {
            updateStatsDisplay();

            console.log('Stats updated');
        }
    }
});

// Add keyboard event listener for F3/F4 keys
document.addEventListener('keydown', (e) => {
    // Toggle stats display (F3)
    if (e.key === 'F3' || e.key === 'f3') {
        gameState.showStats = !gameState.showStats;
        elements.statsOverlay.classList.toggle('hidden', !gameState.showStats);
    }
    
    // Toggle physics debug visualization (F4)
    if (e.key === 'F4' || e.key === 'f4') {
        togglePhysicsDebug();
    }
});

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
    console.log('Showing screen:', screenName);
    elements.lobbyScreen.classList.add('hidden');
    elements.gameScreen.classList.add('hidden');
    
    switch (screenName) {
        case 'lobby':
            elements.lobbyScreen.classList.remove('hidden');
            break;
        case 'game':
            elements.gameScreen.classList.remove('hidden');
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
        // Initialize Three.js scene
        gameState.scene = new THREE.Scene();
        
        // Calculate proper aspect ratio - use getBoundingClientRect for more accurate dimensions
        const container = elements.gameContainer;
        const containerRect = container.getBoundingClientRect();
        const containerWidth = containerRect.width || 800; // Fallback width if zero
        const containerHeight = containerRect.height || 600; // Fallback height if zero
        const aspectRatio = containerWidth / containerHeight;
        
        console.log('Container dimensions:', containerWidth, containerHeight);
        
        gameState.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
        
        gameState.renderer = new THREE.WebGLRenderer({ antialias: true });
        gameState.renderer.setSize(containerWidth, containerHeight);
        gameState.renderer.setClearColor(0x87CEEB); // Sky blue background
        gameState.renderer.shadowMap.enabled = true;
        
        // Clear any existing renderer from the container
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        
        container.appendChild(gameState.renderer.domElement);
        
        // Set up camera position for better viewing angle
        gameState.camera.position.set(0, 40, 40); // Moved back to see more of the track
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
        window.removeEventListener('resize', onWindowResize); // Remove any existing handlers
        window.addEventListener('resize', onWindowResize);
        
        // Make an immediate call to onWindowResize to ensure proper sizing
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
        color: 0x1e824c,  // Grass green
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    track.add(ground);
    
    // Track path
    const trackPathGeometry = new THREE.RingGeometry(15, 25, 32);
    const trackPathMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333333,  // Asphalt black
        roughness: 0.5
    });
    const trackPath = new THREE.Mesh(trackPathGeometry, trackPathMaterial);
    trackPath.rotation.x = -Math.PI / 2;
    trackPath.position.y = 0.01; // Slightly above ground to prevent z-fighting
    trackPath.receiveShadow = true;
    track.add(trackPath);
    
    // Start/finish line
    const lineGeometry = new THREE.PlaneGeometry(10, 1);
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const startLine = new THREE.Mesh(lineGeometry, lineMaterial);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(0, 0.02, -20); // Position at bottom of oval
    startLine.receiveShadow = true;
    track.add(startLine);
    
    console.log('Race track created');
    return track;
}

function createPlayerCar(playerId, carColor) {
    const player = gameState.players[playerId];
    if (!player) return;
    
    // Create car mesh
    const carMesh = createCar({
        color: carColor || 0xff0000,
        castShadow: true
    });
    
    // Set initial position - start high above the track to see the physics in action
    const startY = 28.0;
    const startPosition = { x: 0, y: startY, z: -20 }; // Default starting position
    
    carMesh.position.set(
        startPosition.x,
        startPosition.y,
        startPosition.z
    );
    
    // Add to scene
    gameState.scene.add(carMesh);
    
    // Create physics body if physics is initialized
    let physicsBody = null;
    
    if (gameState.physics.initialized && gameState.physics.world && gameState.physics.usingRapier) {
        console.log('Creating Rapier physics body for car');
        
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
                    // Apply a very tiny impulse to "activate" the physics (jiggle it a bit)
                    physicsBody.applyImpulse({ x: 0, y: 0.01, z: 0 }, true);
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
                console.error('Physics body creation failed - returned null/undefined');
            }
        } catch (error) {
            console.error('Error creating car physics body:', error);
        }
    }
    
    // Create initial targetQuaternion (default to facing forward)
    const targetQuaternion = new THREE.Quaternion();
    
    // Store car data with default position and rotation
    gameState.cars[playerId] = {
        mesh: carMesh,
        physicsBody: physicsBody,
        targetPosition: new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z),
        targetRotation: new THREE.Vector3(0, 0, 0),
        targetQuaternion: targetQuaternion,
        velocity: [0, 0, 0],
        speed: 0,
        controls: {
            acceleration: 0,
            braking: 0,
            steering: 0
        }
    };
    
    console.log(`Created car for player ${playerId}`);
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
            // Initialize Rapier
            gameState.physics.rapier = await rapierPhysics.init();
            
            if (gameState.physics.rapier) {
                // Create physics world
                gameState.physics.world = rapierPhysics.createWorld();
                
                // Create ground plane
                const groundBody = rapierPhysics.createGroundPlane(gameState.physics.world);
                gameState.physics.bodies.ground = groundBody;
                
                gameState.physics.initialized = true;
                gameState.physics.usingRapier = true; // Flag to indicate we're using Rapier
                console.log('Physics world created with Rapier');
                
                // Send debugging info to stats overlay if it exists
                updateStatsDisplay();
                
                return true;
            } else {
                console.error('Failed to initialize Rapier');
                return false;
            }
        } catch (error) {
            console.error('Error initializing physics with Rapier:', error);
            return false;
        }
    }
}

// Improved game loop that avoids potential stack overflow issues
function gameLoopWithoutRecursion(timestamp) {
    try {
        // Schedule next frame first to avoid recursion issues
        animationRequestId = requestAnimationFrame(gameLoopWithoutRecursion);
        
        // Update physics if initialized
        if (gameState.physics.initialized && gameState.physics.world) {
            const now = performance.now();
            const elapsed = now - lastPhysicsUpdate;
            
            if (elapsed >= (1000 / PHYSICS_UPDATE_RATE)) {
                // Update physics world
                gameState.physics.world.step();
                lastPhysicsUpdate = now;
                gameState.debugCounters.physicsUpdate++;
                
                // Update car positions from physics
                Object.keys(gameState.cars).forEach(playerId => {
                    const car = gameState.cars[playerId];
                    if (!car || !car.physicsBody) return;
                    
                    // Get physics state
                    const physicsPos = car.physicsBody.translation();
                    const physicsRot = car.physicsBody.rotation();
                    const vel = car.physicsBody.linvel();
                    
                    // Update mesh position
                    car.mesh.position.set(physicsPos.x, physicsPos.y, physicsPos.z);
                    car.targetPosition.copy(car.mesh.position);
                    
                    // Calculate speed and store it
                    car.speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                    car.velocity = [vel.x, vel.y, vel.z];
                    
                    // Update rotation based on velocity
                    const speed = car.speed;
                    
                    if (speed > 0.5) { // Only when moving at a reasonable speed
                        // Calculate heading angle from velocity
                        const angle = Math.atan2(vel.x, -vel.z);
                        
                        // Create a quaternion for this rotation around Y axis
                        const newRotation = new THREE.Quaternion();
                        newRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                        
                        // Apply rotation directly for responsive steering
                        car.mesh.quaternion.copy(newRotation);
                        car.targetQuaternion = newRotation;
                    } else {
                        // At very low speeds, use physics rotation but only for Y axis
                        const euler = new THREE.Euler().setFromQuaternion(
                            new THREE.Quaternion(physicsRot.x, physicsRot.y, physicsRot.z, physicsRot.w)
                        );
                        
                        // Only keep the Y rotation (heading)
                        euler.x = 0;
                        euler.z = 0;
                        
                        // Create new quaternion and apply smoothly
                        car.targetQuaternion = new THREE.Quaternion().setFromEuler(euler);
                        car.mesh.quaternion.slerp(car.targetQuaternion, 0.1);
                    }
                });
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
    
    // Get accurate container dimensions
    const container = elements.gameContainer;
    const containerRect = container.getBoundingClientRect();
    const width = containerRect.width || 800; // Fallback width if zero
    const height = containerRect.height || 600; // Fallback height if zero
    
    console.log('Resize: Container dimensions:', width, height);
    
    // Update camera
    gameState.camera.aspect = width / height;
    gameState.camera.updateProjectionMatrix();
    
    // Update renderer
    gameState.renderer.setSize(width, height);
    
    // Force a render after resize
    if (gameState.scene) {
        gameState.renderer.render(gameState.scene, gameState.camera);
    }
}

// Function to update the stats display
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
    
    // Add reset all cars button
    statsHTML += `<div class="reset-button-container">
        <button id="reset-all-cars-btn" class="reset-button">Reset All Cars</button>
    </div>`;
    
    // Add detailed player stats with controls
    statsHTML += '<div class="stats-section">Player Stats & Controls:</div>';
    
    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        const player = gameState.players[playerId];
        if (!car || !player) return;
        
        // Calculate speed from velocity if physics body exists
        let speed = 0;
        let posX = 0, posY = 0, posZ = 0;
        
        if (car.physicsBody) {
            const vel = car.physicsBody.linvel();
            // Calculate speed as magnitude of horizontal velocity (x and z)
            speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
            const pos = car.physicsBody.translation();
            posX = Math.round(pos.x * 100) / 100;
            posY = Math.round(pos.y * 100) / 100;
            posZ = Math.round(pos.z * 100) / 100;
        } else {
            // Fallback to target position if no physics body
            posX = Math.round(car.targetPosition.x * 100) / 100;
            posY = Math.round(car.targetPosition.y * 100) / 100;
            posZ = Math.round(car.targetPosition.z * 100) / 100;
        }
        
        // Get physics body state
        let physicsState = "No Physics Body";
        let velocityInfo = "";
        if (car.physicsBody) {
            const vel = car.physicsBody.linvel();
            const isAwake = car.physicsBody.isAwake ? car.physicsBody.isAwake() : "Unknown";
            physicsState = `Active: ${isAwake}`;
            velocityInfo = `<div>Velocity: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})</div>`;
        }
        
        // Get control inputs and their age
        let controlsHTML = '<div class="control-info">No controls received</div>';
        if (car.controls) {
            console.log('Car controls received in the stats update:', car.controls);
            const timeSinceLastControl = car.lastControlUpdate ? Math.round((Date.now() - car.lastControlUpdate) / 1000) : 'N/A';
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
        } else {
            console.log('No car controls received in the stats update');
        }
        
        statsHTML += `
            <div class="player-stats">
                <div class="player-header" style="color: ${player.color}">
                    ${player.name} (ID: ${player.id})
                </div>
                <div>Speed: ${speed.toFixed(2)} units/s</div>
                <div>Position: (${posX}, ${posY}, ${posZ})</div>
                ${velocityInfo}
                <div>Physics: ${physicsState}</div>
                <div class="controls-section">
                    <div class="controls-header">Controls:</div>
                    ${controlsHTML}
                </div>
            </div>
        `;
    });
    
    elements.statsOverlay.innerHTML = statsHTML;
    
    // Re-attach event listener for reset button
    const resetButton = document.getElementById('reset-all-cars-btn');
    if (resetButton) {
        resetButton.onclick = resetAllCars;
    }
}

// Function to reset a car's position
function resetCarPosition(playerId) {
    if (!gameState.cars[playerId]) return;
    
    const car = gameState.cars[playerId];
    // Set starting position high above the track to see physics in action
    const startPosition = [0, 8.0, -20]; // Same height as initial spawn
    
    // Set the car's target position to the start position
    car.targetPosition.set(startPosition[0], startPosition[1], startPosition[2]);
    car.targetRotation.set(0, 0, 0);
    
    // Reset speed and velocity tracking
    car.speed = 0;
    car.velocity = [0, 0, 0];
    
    // Reset physics body if available
    if (car.physicsBody) {
        // Reset position
        car.physicsBody.position.set(startPosition[0], startPosition[1], startPosition[2]);
        
        // Reset rotation (quaternion)
        car.physicsBody.quaternion.set(0, 0, 0, 1); // Identity quaternion
        
        // Reset velocity and angular velocity
        car.physicsBody.velocity.set(0, 0, 0);
        car.physicsBody.angularVelocity.set(0, 0, 0);
        
        // Wake up the body to ensure it's active
        car.physicsBody.wakeUp();
    }
    
    // Notify player to reset their position via server
    socket.emit('reset_player_position', {
        room_code: gameState.roomCode,
        player_id: playerId,
        position: startPosition,
        rotation: [0, 0, 0]
    });
    
    // Force an immediate update of the stats display
    if (gameState.showStats) {
        updateStatsDisplay();
    }
}

// Function to reset all cars
function resetAllCars() {
    Object.keys(gameState.cars).forEach(playerId => {
        resetCarPosition(playerId);
    });
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
    if (!gameState.physics.initialized || !gameState.physics.usingRapier) {
        if (!gameState.physicsDebugLogs.noPhysicsWarning) {
            console.warn('Physics debug visualization requested but physics is not available');
            gameState.physicsDebugLogs.noPhysicsWarning = true;
        }
        return;
    }
    
    // Only log full debug info once per session or every 10 seconds
    const now = Date.now();
    const shouldLogFull = !gameState.physicsDebugLogs.lastFullLog || 
                         (now - gameState.physicsDebugLogs.lastFullLog > 10000);
    
    if (shouldLogFull) {
        console.log('Updating physics debug visualization');
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
        
        // Get dimensions from the car model (physics body is a box)
        const carWidth = 2;  // Standard car width
        const carHeight = 1; // Standard car height
        const carLength = 4; // Standard car length
        
        // Create wireframe box geometry
        const wireGeometry = new THREE.BoxGeometry(carWidth, carHeight, carLength);
        const wireframe = new THREE.LineSegments(
            new THREE.WireframeGeometry(wireGeometry),
            new THREE.LineBasicMaterial({ 
                color: 0x00ff00,  // Green wireframe
                linewidth: 2      // Line width (note: may not work in WebGL)
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
        
        if (shouldLogFull) {
            console.log(`Added wireframe for car ${playerId}`);
        }
    });
    
    // Also add a ground plane wireframe if we have one
    if (gameState.physics.bodies && gameState.physics.bodies.ground) {
        if (shouldLogFull) {
            console.log('Adding ground plane wireframe');
        }
        // Ground plane is a cuboid with dimensions 100x0.1x100
        const groundGeometry = new THREE.BoxGeometry(200, 0.2, 200);
        const groundWireframe = new THREE.LineSegments(
            new THREE.WireframeGeometry(groundGeometry),
            new THREE.LineBasicMaterial({ 
                color: 0x0000ff,  // Blue wireframe
                linewidth: 1
            })
        );
        
        // Ground is at y=0
        groundWireframe.position.set(0, 0, 0);
        
        // Add to scene and track
        gameState.scene.add(groundWireframe);
        gameState.physicsDebugObjects.push(groundWireframe);
        
        if (shouldLogFull) {
            console.log('Ground wireframe added');
        }
    } else if (shouldLogFull) {
        console.warn('No ground physics body found');
    }
    
    if (shouldLogFull) {
        console.log(`Total physics debug objects created: ${gameState.physicsDebugObjects.length}`);
    }
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