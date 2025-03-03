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
    welcomeScreen: document.getElementById('welcome-screen'),
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
socket.onAny((eventName, ...args) => {
    // Track event counts
    socketDebug.eventCounts[eventName] = (socketDebug.eventCounts[eventName] || 0) + 1;
    
    // Track recent events
    socketDebug.lastEvents.unshift({
        event: eventName,
        args: args,
        timestamp: new Date().toISOString()
    });
    socketDebug.lastEvents = socketDebug.lastEvents.slice(0, socketDebug.maxEventHistory);

    // Log every event with detailed information
    console.log('🎯 Socket Event:', {
        event: eventName,
        count: socketDebug.eventCounts[eventName],
        args: args,
        timestamp: new Date().toISOString(),
        socketId: socket.id,
        connectedRooms: Array.from(socket.rooms || []),
        hasListeners: socket.listeners(eventName).length > 0,
        allRegisteredEvents: Object.keys(socket._callbacks || {})
    });
});

// Consolidated socket event handlers
const socketHandlers = {
    connect: () => {
        console.log('Socket connected, creating room...');
        createRoom();
    },
    
    room_created: (data) => {
        console.log('Room created:', data);
        gameState.roomCode = data.room_code;
        elements.roomCodeDisplay.textContent = gameState.roomCode;
        
        // Update QR code and join URL
        const qrCodeImg = document.getElementById('qr-code');
        if (qrCodeImg) {
            qrCodeImg.src = `/qrcode/${gameState.roomCode}`;
        }
        
        // Update join URL display using server-provided IP and port
        if (elements.joinUrl && window.serverConfig) {
            const joinUrl = `${window.serverConfig.localIp}:${window.serverConfig.port}/player?room=${gameState.roomCode}`;
            elements.joinUrl.textContent = joinUrl;
        }
        
        showScreen('lobby');
    },
    
    player_joined: (playerData) => {
        console.log('Player joined:', playerData);
        const { id, name, car_color } = playerData;
        gameState.players[id] = {
            id, name, color: car_color,
            position: playerData.position || [0, 0.5, 0],
            rotation: playerData.rotation || [0, 0, 0]
        };
        addPlayerToList(id, name, car_color);
        elements.startGameBtn.disabled = Object.keys(gameState.players).length === 0;
    },
    
    player_control_update: (data) => {
        console.log('🎮 Control Update:', {
            raw_data: data,
            timestamp: Date.now(),
            socket_id: socket.id,
            event_count: socketDebug.eventCounts['player_control_update'] || 0
        });

        // Extract data with fallbacks
        const player_id = data.player_id || data.playerId;
        const controls = data.controls || {};
        const room_code = data.room_code || data.roomCode;

        // Validate data
        if (!room_code || room_code !== gameState.roomCode) {
            console.warn('❌ Room code mismatch:', { got: room_code, expected: gameState.roomCode });
            return;
        }

        if (!gameState.players[player_id]) {
            console.warn('❌ Unknown player:', { player_id, known_players: Object.keys(gameState.players) });
            return;
        }

        // Update player controls
        gameState.players[player_id].controls = {
            steering: controls.steering || 0,
            acceleration: controls.acceleration || 0,
            braking: controls.braking || 0,
            timestamp: Date.now()
        };

        // Update visual indicators
        const controlIndicator = document.getElementById('host-control-indicator') || createControlIndicator();
        updateControlIndicator(controlIndicator, controls, gameState.players[player_id].name);

        if (gameState.showStats) {
            updateStatsDisplay();
        }
    }
};

// Register all socket handlers
Object.entries(socketHandlers).forEach(([event, handler]) => {
    // Remove any existing handlers for this event
    socket.off(event);
    // Add the new handler
    socket.on(event, handler);
    console.log(`Registered handler for ${event}`);
});

// Event listeners
elements.createRoomBtn.addEventListener('click', createRoom);
elements.startGameBtn.addEventListener('click', startGame);

// Add key listener for stats toggle (F3)
document.addEventListener('keydown', (e) => {
    if (e.key === 'F3' || e.key === 'f3') {
        gameState.showStats = !gameState.showStats;
        if (gameState.showStats) {
            elements.statsOverlay.classList.remove('hidden');
        } else {
            elements.statsOverlay.classList.add('hidden');
        }
    }
    
    // Add physics debug visualization toggle (F4)
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
    elements.welcomeScreen.classList.add('hidden');
    elements.lobbyScreen.classList.add('hidden');
    elements.gameScreen.classList.add('hidden');
    
    switch (screenName) {
        case 'welcome':
            elements.welcomeScreen.classList.remove('hidden');
            break;
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
            
            // Offset each car on the track to avoid overlapping
            playerIds.forEach((playerId, index) => {
                const player = gameState.players[playerId];
                
                // Set starting positions in a spaced line on the track
                player.position = [0, 0.5, -20 + (index * 5)]; // Line them up at the start line with 5 units spacing
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
                player.position = [0, 0.5, -20 + (index * 5)];
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
    
    // Set initial position - start 8 units above the track to see the physics in action
    const startY = 28.0; // Keeping at 8.0 to ensure we can see the physics working
    carMesh.position.set(
        player.position[0],
        startY,
        player.position[2]
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
                { x: player.position[0], y: startY, z: player.position[2] },
                carDimensions
            );
            
            // Check if physics body was created properly
            if (physicsBody) {
                console.log('Physics body created successfully for player', playerId);
                console.log('Initial position:', { x: player.position[0], y: startY, z: player.position[2] });
                
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
                
                // Initialize rotation from player data if available
                if (player.rotation && player.rotation.length >= 3) {
                    // Convert Euler rotation to quaternion
                    const euler = new THREE.Euler(
                        player.rotation[0],
                        player.rotation[1],
                        player.rotation[2],
                        'XYZ'
                    );
                    const quaternion = new THREE.Quaternion().setFromEuler(euler);
                    
                    // Set initial rotation of physics body
                    physicsBody.setRotation({
                        x: quaternion.x,
                        y: quaternion.y,
                        z: quaternion.z,
                        w: quaternion.w
                    }, true);
                }
            } else {
                console.error('Physics body creation failed - returned null/undefined');
            }
        } catch (error) {
            console.error('Error creating car physics body:', error);
        }
    }
    
    // Create initial targetQuaternion from player rotation
    const targetQuaternion = new THREE.Quaternion();
    if (player.rotation && player.rotation.length >= 3) {
        const euler = new THREE.Euler(
            player.rotation[0],
            player.rotation[1],
            player.rotation[2],
            'XYZ'
        );
        targetQuaternion.setFromEuler(euler);
    }
    
    // Store car data
    gameState.cars[playerId] = {
        mesh: carMesh,
        physicsBody: physicsBody,
        targetPosition: new THREE.Vector3(
            player.position[0],
            player.position[1],
            player.position[2]
        ),
        targetRotation: new THREE.Vector3(
            player.rotation[0],
            player.rotation[1],
            player.rotation[2]
        ),
        targetQuaternion: targetQuaternion,
        velocity: [0, 0, 0],
        speed: 0
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
                    console.warn('Timed out waiting for Rapier to be ready');
                    setupFallbackPhysics();
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
                setupFallbackPhysics();
                return false;
            }
        } catch (error) {
            console.error('Error initializing physics with Rapier:', error);
            setupFallbackPhysics();
            return false;
        }
    }
}

// Fallback physics for when Rapier fails to initialize
function setupFallbackPhysics() {
    console.warn('Setting up fallback physics - game physics will be unavailable');
    // Simple physics placeholder
    gameState.physics.world = {
        step: function(dt) {} // Do nothing function
    };
    gameState.physics.initialized = false;
    gameState.physics.usingRapier = false;
    
    // Update stats to show fallback is in use
    updateStatsDisplay();
    
    // Alert the user that physics will be limited
    elements.gameStatus.textContent = 'Limited physics mode - car controls may be unreliable';
    elements.gameStatus.style.color = 'orange';
}

// Improved game loop that avoids potential stack overflow issues
function gameLoopWithoutRecursion(timestamp) {
    // Schedule next frame first to avoid recursion issues
    animationRequestId = requestAnimationFrame(gameLoopWithoutRecursion);
    
    if (!gameState.gameActive) {
        return;
    }
    
    try {
        // Update physics if initialized
        if (gameState.physics.initialized && gameState.physics.world) {
            // Step the physics world - use fixed timestep
            const fixedTimeStep = 1.0 / 60.0; // 60 Hz physics update
            gameState.physics.world.step();
            
            // Debug physics state with reduced frequency
            if (gameState.showPhysicsDebug) {
                gameState.debugCounters.physicsUpdate = (gameState.debugCounters.physicsUpdate + 1) % 100;
                
                if (gameState.debugCounters.physicsUpdate === 0) {
                    Object.keys(gameState.cars).forEach(playerId => {
                        const car = gameState.cars[playerId];
                        if (car && car.physicsBody) {
                            const vel = car.physicsBody.linvel();
                            const pos = car.physicsBody.translation();
                            console.log(`Car ${playerId} physics - Vel: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)}) Pos: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
                        }
                    });
                }
            }
        }
        
        // Update car positions with smooth interpolation
        Object.keys(gameState.cars).forEach(playerId => {
            const car = gameState.cars[playerId];
            const player = gameState.players[playerId];
            
            if (!car || !car.mesh) {
                return;
            }
            
            // If we have a physics body, update from physics and apply controls
            if (car.physicsBody && gameState.physics.usingRapier) {
                // Apply player controls to physics body FIRST if we have them
                if (player && player.controls) {
                    // Always log every control application for debugging
                    const timestamp = player.controls.timestamp || 0;
                    const currentTime = Date.now();
                    const age = currentTime - timestamp;
                    
                    // Log every 60 frames or anytime there are significant controls
                    const hasSignificantControls = 
                        Math.abs(player.controls.steering) > 0.1 || 
                        player.controls.acceleration > 0.1 || 
                        player.controls.braking > 0.1;
                    
                    gameState.debugCounters.controlsUpdate = (gameState.debugCounters.controlsUpdate || 0) + 1;
                    if (gameState.debugCounters.controlsUpdate % 60 === 0 || hasSignificantControls) {
                        console.log(`🔄 APPLYING CONTROLS to car ${playerId} (age: ${age}ms):`, {
                            steering: player.controls.steering,
                            acceleration: player.controls.acceleration,
                            braking: player.controls.braking
                        });
                    }
                    
                    // Ensure controls are properly formatted and have appropriate scale
                    const controls = {
                        steering: (player.controls.steering || 0) * 2.0,
                        acceleration: (player.controls.acceleration || 0) * 2.0,
                        braking: (player.controls.braking || 0) * 1.5
                    };
                    
                    // Apply controls to physics body and pass player ID for debugging
                    rapierPhysics.applyCarControls(car.physicsBody, controls, playerId);
                    
                    // Wake up the physics body when controls are applied
                    if (typeof car.physicsBody.wakeUp === 'function') {
                        car.physicsBody.wakeUp();
                    }
                    
                    // Create a visual indicator for applying physics
                    const physicsIndicator = document.getElementById('physics-indicator') || createPhysicsIndicator();
                    updatePhysicsIndicator(physicsIndicator, controls, playerId, hasSignificantControls);
                }
                
                function createPhysicsIndicator() {
                    const indicator = document.createElement('div');
                    indicator.id = 'physics-indicator';
                    indicator.style.position = 'fixed';
                    indicator.style.bottom = '10px';
                    indicator.style.right = '10px';
                    indicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                    indicator.style.color = 'white';
                    indicator.style.padding = '10px';
                    indicator.style.borderRadius = '5px';
                    indicator.style.fontFamily = 'monospace';
                    indicator.style.zIndex = '9999';
                    document.body.appendChild(indicator);
                    return indicator;
                }
                
                function updatePhysicsIndicator(indicator, controls, playerId, isActive) {
                    // Change color based on active controls
                    indicator.style.backgroundColor = isActive ? 
                        'rgba(255, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.7)';
                    
                    // Format control values for display
                    const steeringVal = (controls.steering * 2.0).toFixed(2);
                    const accelVal = (controls.acceleration * 2.0).toFixed(2);
                    const brakeVal = (controls.braking * 1.5).toFixed(2);
                    
                    indicator.innerHTML = `
                        <div style="font-weight: bold; margin-bottom: 5px;">PHYSICS CONTROLS (Car ${playerId})</div>
                        <div>Accel: ${accelVal} (x2.0)</div>
                        <div>Brake: ${brakeVal} (x1.5)</div>
                        <div>Steer: ${steeringVal} (x2.0)</div>
                    `;
                }
                
                // Get position and rotation from physics body
                const physicsPos = car.physicsBody.translation();
                const physicsRot = car.physicsBody.rotation();
                
                // Update target position from physics
                car.targetPosition.set(physicsPos.x, physicsPos.y, physicsPos.z);
                
                // Get the velocity for speed calculation
                const vel = car.physicsBody.linvel();
                const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z); // in m/s
                
                // Update the mesh position with smooth lerp
                car.mesh.position.lerp(car.targetPosition, 0.2);
                
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
                
                // Update velocity and speed for display
                car.velocity = [vel.x, vel.y, vel.z];
                car.speed = speed * 3.6; // Convert to km/h
                
                // Update player state for network sync
                player.position = [physicsPos.x, physicsPos.y, physicsPos.z];
                const euler = new THREE.Euler().setFromQuaternion(car.targetQuaternion);
                player.rotation = [euler.x, euler.y, euler.z];
                
                // Send car state update to the player
                // Do this at a reduced rate (every 5 frames) to avoid network spam
                if (gameState.debugCounters.physicsUpdate % 5 === 0) {
                    socket.emit('car_state_update', {
                        player_id: playerId,
                        position: player.position,
                        rotation: player.rotation,
                        velocity: car.velocity,
                        timestamp: Date.now()
                    });
                }
            }
        });
        
        // Handle physics debug visualization
        if (gameState.showPhysicsDebug) {
            updatePhysicsDebugVisualization();
        }
        
        // Render scene
        gameState.renderer.render(gameState.scene, gameState.camera);
        
        // Update stats display if visible
        if (gameState.showStats) {
            updateStatsDisplay();
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
    
    // Add detailed player stats
    statsHTML += '<div class="stats-section">Detailed Player Stats:</div>';
    
    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        const player = gameState.players[playerId];
        if (!car || !player) return;
        
        const speed = Math.round((car.speed || 0) * 100) / 100;
        const posX = Math.round(car.targetPosition.x * 100) / 100;
        const posY = Math.round(car.targetPosition.y * 100) / 100;
        const posZ = Math.round(car.targetPosition.z * 100) / 100;
        
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
        if (player.controls) {
            const controlAge = now - (player.controls.timestamp || 0);
            const steering = Math.round(player.controls.steering * 100) / 100;
            const accel = Math.round(player.controls.acceleration * 100) / 100;
            const brake = Math.round(player.controls.braking * 100) / 100;
            
            // Add visual indicators for controls
            const steeringBar = createBarIndicator(steering, -1, 1);
            const accelBar = createBarIndicator(accel, 0, 1);
            const brakeBar = createBarIndicator(brake, 0, 1);
            
            controlsHTML = `
                <div class="control-info">
                    <div>Last Input: ${controlAge.toFixed(0)}ms ago</div>
                    <div>Steering: ${steeringBar} (${steering.toFixed(2)})</div>
                    <div>Accelerate: ${accelBar} (${accel.toFixed(2)})</div>
                    <div>Brake: ${brakeBar} (${brake.toFixed(2)})</div>
                </div>
            `;
        }
        
        statsHTML += `
            <div class="player-stats">
                <div class="player-header">
                    <span style="color:${player.color}">${player.name}</span>
                    <span class="physics-state">[${physicsState}]</span>
                </div>
                <div>Speed: ${speed.toFixed(2)} km/h</div>
                <div>Position: (${posX}, ${posY}, ${posZ})</div>
                ${velocityInfo}
                ${controlsHTML}
                <button class="reset-button reset-car-btn" data-player-id="${playerId}">Reset Position</button>
            </div>
        `;
    });
    
    elements.statsOverlay.innerHTML = statsHTML;
    
    // Add event listeners to reset buttons
    document.getElementById('reset-all-cars-btn').addEventListener('click', resetAllCars);
    document.querySelectorAll('.reset-car-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const playerId = e.target.getAttribute('data-player-id');
            resetCarPosition(playerId);
        });
    });
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
        try {
            console.log(`Resetting car ${playerId} to starting position...`);
            
            // Reset position using Rapier's setTranslation
            car.physicsBody.setTranslation({ x: startPosition[0], y: startPosition[1], z: startPosition[2] }, true);
            
            // Reset rotation using Rapier's setRotation
            car.physicsBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            
            // Reset linear and angular velocity
            car.physicsBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            car.physicsBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            
            // Wake up the body to ensure it's active in the physics simulation
            car.physicsBody.wakeUp();
            
            // Apply a small impulse to "activate" the physics (jiggle it a bit)
            if (typeof car.physicsBody.applyImpulse === 'function') {
                car.physicsBody.applyImpulse({ x: 0, y: 0.01, z: 0 }, true);
                console.log("Applied reset impulse to activate physics");
            }
            
            console.log(`Reset physics for car ${playerId} to position (${startPosition.join(', ')})`);
            
            // Also reset any player control state that might be stored
            if (gameState.players[playerId]) {
                gameState.players[playerId].controls = {
                    steering: 0,
                    acceleration: 0,
                    braking: 0,
                    timestamp: Date.now()
                };
            }
        } catch (error) {
            console.error('Error resetting car physics:', error);
        }
    }
    
    // Update internal game state
    gameState.players[playerId].position = startPosition;
    gameState.players[playerId].rotation = [0, 0, 0];
    
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