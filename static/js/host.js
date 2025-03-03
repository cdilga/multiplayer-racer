// Host interface logic

// Constants
const GAME_UPDATE_INTERVAL = 1000 / 60; // 60 FPS

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
    showStats: false // Display stats toggle
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

// Socket.io connection
const socket = io();

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
});

// Socket event handlers
socket.on('connect', () => {
    // Connected to server
});

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
        color: car_color,
        position: playerData.position || [0, 0.5, 0], // Default position if not provided
        rotation: playerData.rotation || [0, 0, 0]    // Default rotation if not provided
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

socket.on('player_position_update', (data) => {
    const { player_id, position, rotation, velocity } = data;
    
    if (gameState.gameActive && gameState.cars[player_id]) {
        // Update car position and rotation
        const car = gameState.cars[player_id];
        
        // Convert the position and rotation arrays to Three.js objects
        car.targetPosition.set(position[0], position[1], position[2]);
        car.targetRotation.set(rotation[0], rotation[1], rotation[2]);
        
        // Store velocity for physics calculations
        car.velocity = velocity;
        
        // Calculate speed for display
        car.speed = Math.sqrt(
            velocity[0] * velocity[0] + 
            velocity[1] * velocity[1] + 
            velocity[2] * velocity[2]
        );
        
        // Update stats display if visible
        if (gameState.showStats) {
            updateStatsDisplay();
        }
    }
});

// Add socket event handler for player name updates
socket.on('player_name_updated', (data) => {
    const playerId = data.id;
    const newName = data.name;
    
    if (gameState.players[playerId]) {
        // Update player name
        gameState.players[playerId].name = newName;
        
        // Update player list in UI if in lobby
        updatePlayerList();
        
        console.log(`Player ${playerId} updated name to: ${newName}`);
    }
});

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
        
        // Initialize physics world
        initPhysics();
        
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
    
    // Set initial position
    carMesh.position.set(
        player.position[0],
        player.position[1],
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
        
        // Create physics body for car
        physicsBody = rapierPhysics.createCarPhysics(
            gameState.physics.world,
            { x: player.position[0], y: player.position[1], z: player.position[2] },
            carDimensions
        );
        
        // If the physics body was created successfully
        if (physicsBody) {
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
            
            console.log('Physics body created successfully');
        } else {
            console.warn('Failed to create physics body for car');
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

// Initialize physics with Rapier instead of Cannon.js
async function initPhysics() {
    console.log('Initializing physics with Rapier');
    
    // Check if Rapier is already loaded
    if (window.rapierLoaded) {
        console.log('Rapier is already loaded, initializing physics');
        await initializeWithRapier();
    } else {
        console.log('Waiting for Rapier to load...');
        
        // Set up event listener for when Rapier is ready
        window.addEventListener('rapier-ready', async function onRapierReady() {
            console.log('Received rapier-ready event, initializing physics');
            window.removeEventListener('rapier-ready', onRapierReady);
            await initializeWithRapier();
        });
        
        // Fallback timeout in case the event never fires
        setTimeout(() => {
            console.warn('Timed out waiting for Rapier to be ready');
            setupFallbackPhysics();
        }, 5000);
    }
    
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
            } else {
                console.error('Failed to initialize Rapier');
                setupFallbackPhysics();
            }
        } catch (error) {
            console.error('Error initializing physics with Rapier:', error);
            setupFallbackPhysics();
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
            gameState.physics.world.step();
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
                // Apply player controls to physics body FIRST
                if (player.controls) {
                    rapierPhysics.applyCarControls(car.physicsBody, player.controls);
                }
                
                // Get position and rotation from physics body
                const physicsPos = car.physicsBody.translation();
                const physicsRot = car.physicsBody.rotation();
                
                // Update target position from physics
                car.targetPosition.set(physicsPos.x, physicsPos.y, physicsPos.z);
                
                // COMPLETELY OVERRIDE the car rotation to match the ACTUAL direction of movement
                // This is a brute-force approach to ensure the car model points in the right direction
                
                // Get the velocity and extract direction
                const vel = car.physicsBody.linvel();
                
                // Only override direction when actually moving
                const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z); // in m/s
                
                if (speed > 0.5) { // Only when moving at a reasonable speed
                    // In THREE.js, we want the car to point in the direction of motion
                    // Calculate the heading angle from velocity
                    // NOTE: Z-axis is typically forward in THREE.js models, but negative Z is "into" the screen
                    // So we negate Z to flip the direction
                    const angle = Math.atan2(vel.x, -vel.z);
                    
                    // Create a quaternion representation of this rotation around Y axis
                    const newRotation = new THREE.Quaternion();
                    newRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                    
                    // DEBUG THIS TO CONSOLE
                    console.log(`Car ${playerId} heading: ${(angle * 180 / Math.PI).toFixed(1)}° speed: ${(speed * 3.6).toFixed(1)} km/h`);
                    
                    // Assign directly to avoid any interpolation issues
                    car.targetQuaternion = newRotation;
                } else {
                    // At very low speeds, use the physics rotation but only for Y axis
                    // This prevents the car from flipping or rolling when stopped
                    const euler = new THREE.Euler().setFromQuaternion(
                        new THREE.Quaternion(physicsRot.x, physicsRot.y, physicsRot.z, physicsRot.w)
                    );
                    
                    // Only keep the Y rotation (heading) and reset others
                    euler.x = 0;
                    euler.z = 0;
                    
                    // Create new quaternion
                    car.targetQuaternion = new THREE.Quaternion().setFromEuler(euler);
                }
                
                // Calculate Euler angles for network sync
                const euler = new THREE.Euler().setFromQuaternion(car.targetQuaternion);
                car.targetRotation.set(euler.x, euler.y, euler.z);
                
                // Update player's position and rotation for network sync
                player.position = [physicsPos.x, physicsPos.y, physicsPos.z];
                player.rotation = [euler.x, euler.y, euler.z];
                
                // Update velocity for display - reuse the vel variable from earlier
                car.velocity = [vel.x, vel.y, vel.z];
                
                // We already calculated speed earlier, store it
                car.speed = speed * 3.6; // Convert to km/h for display
                
                // Update the mesh position with smooth lerp
                car.mesh.position.lerp(car.targetPosition, 0.2);
                
                // Apply rotation directly without slerp when moving, for immediate response
                if (speed > 0.5) {
                    car.mesh.quaternion.copy(car.targetQuaternion);
                } else {
                    // Use smooth interpolation when stopped or moving very slowly
                    car.mesh.quaternion.slerp(car.targetQuaternion, 0.2);
                }
            } else {
                // Fallback to the old method if no physics body or not using Rapier
                
                // Update the mesh position with smooth lerp
                car.mesh.position.lerp(car.targetPosition, 0.1);
                
                // Create a rotation quaternion from euler angles
                if (!car.targetQuaternion) {
                    car.targetQuaternion = new THREE.Quaternion();
                }
                
                car.targetQuaternion.setFromEuler(new THREE.Euler(
                    car.targetRotation.x,
                    car.targetRotation.y,
                    car.targetRotation.z,
                    'XYZ'
                ));
                
                // Smoothly interpolate rotation
                car.mesh.quaternion.slerp(car.targetQuaternion, 0.1);
            }
        });
        
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
    
    // Add player stats
    statsHTML += '<div class="stats-section">Player Stats:</div>';
    
    Object.keys(gameState.cars).forEach(playerId => {
        const car = gameState.cars[playerId];
        const player = gameState.players[playerId];
        if (!car || !player) return;
        
        const speed = Math.round((car.speed || 0) * 100) / 100;
        const posX = Math.round(car.targetPosition.x * 100) / 100;
        const posY = Math.round(car.targetPosition.y * 100) / 100;
        const posZ = Math.round(car.targetPosition.z * 100) / 100;
        
        statsHTML += `
            <div class="player-stats">
                <span style="color:${player.color}">${player.name}</span>:
                <div>Speed: ${speed} units/s</div>
                <div>Position: (${posX}, ${posY}, ${posZ})</div>
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
    // Set a proper starting position (at the center of the track)
    const startPosition = [0, 0.5, -20];
    
    // Set the car's target position to the start position
    car.targetPosition.set(startPosition[0], startPosition[1], startPosition[2]);
    car.targetRotation.set(0, 0, 0);
    
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
            margin: 5px 0;
            padding-left: 10px;
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