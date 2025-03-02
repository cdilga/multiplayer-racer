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
        bodies: {}
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
    
    // Update join URL
    const joinUrl = `${window.location.origin}/player`;
    elements.joinUrl.textContent = joinUrl;
    
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
function initGame() {
    try {
        // Initialize Three.js scene
        gameState.scene = new THREE.Scene();
        
        // Calculate proper aspect ratio
        const containerWidth = elements.gameContainer.clientWidth;
        const containerHeight = elements.gameContainer.clientHeight;
        const aspectRatio = containerWidth / containerHeight;
        
        gameState.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
        
        gameState.renderer = new THREE.WebGLRenderer({ antialias: true });
        gameState.renderer.setSize(containerWidth, containerHeight);
        gameState.renderer.setClearColor(0x87CEEB); // Sky blue background
        gameState.renderer.shadowMap.enabled = true;
        elements.gameContainer.appendChild(gameState.renderer.domElement);
        
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
        
        // Force a first render to make everything visible
        gameState.renderer.render(gameState.scene, gameState.camera);
        
        // Start game loop immediately
        requestAnimationFrame(gameLoop);
        
        // Handle window resize
        window.addEventListener('resize', onWindowResize);
    } catch (error) {
        console.error('Error initializing game:', error);
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

function createPlayerCar(playerId, color) {
    // Check if we have a utility function for creating cars
    if (typeof createCar === 'function') {
        try {
            const carMesh = createCar({
                color: color,
                castShadow: true
            });
            
            // Set the initial position
            const player = gameState.players[playerId];
            carMesh.position.set(player.position[0], player.position[1], player.position[2]);
            
            // Add to scene
            gameState.scene.add(carMesh);
            
            // Store the car with its target properties for smooth interpolation
            gameState.cars[playerId] = {
                mesh: carMesh,
                targetPosition: new THREE.Vector3(player.position[0], player.position[1], player.position[2]),
                targetRotation: new THREE.Vector3(0, 0, 0),
                velocity: [0, 0, 0]
            };
            
            return;
        } catch (error) {
            console.error('Error using createCar utility:', error);
        }
    }
    
    // Fallback: Create a simple car model
    const carGroup = new THREE.Group();
    
    // Car body
    const bodyGeometry = new THREE.BoxGeometry(2, 1, 4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    body.castShadow = true;
    carGroup.add(body);
    
    // Car roof
    const roofGeometry = new THREE.BoxGeometry(1.5, 0.7, 2);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = 1.35;
    roof.position.z = -0.2;
    roof.castShadow = true;
    carGroup.add(roof);
    
    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
    
    // Front left wheel
    const wheelFL = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheelFL.rotation.z = Math.PI / 2;
    wheelFL.position.set(-1.1, 0.5, 1.2);
    carGroup.add(wheelFL);
    
    // Front right wheel
    const wheelFR = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheelFR.rotation.z = Math.PI / 2;
    wheelFR.position.set(1.1, 0.5, 1.2);
    carGroup.add(wheelFR);
    
    // Rear left wheel
    const wheelRL = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheelRL.rotation.z = Math.PI / 2;
    wheelRL.position.set(-1.1, 0.5, -1.2);
    carGroup.add(wheelRL);
    
    // Rear right wheel
    const wheelRR = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheelRR.rotation.z = Math.PI / 2;
    wheelRR.position.set(1.1, 0.5, -1.2);
    carGroup.add(wheelRR);
    
    // Set initial position and add to scene
    const player = gameState.players[playerId];
    carGroup.position.set(player.position[0], player.position[1], player.position[2]);
    gameState.scene.add(carGroup);
    
    // Store the car with its target properties for smooth interpolation
    gameState.cars[playerId] = {
        mesh: carGroup,
        targetPosition: new THREE.Vector3(player.position[0], player.position[1], player.position[2]),
        targetRotation: new THREE.Vector3(0, 0, 0),
        velocity: [0, 0, 0]
    };
}

function initPhysics() {
    console.log('Initializing physics');
    try {
        // Initialize Cannon.js physics world if available
        if (typeof CANNON !== 'undefined') {
            gameState.physics.world = new CANNON.World();
            gameState.physics.world.gravity.set(0, -9.82, 0); // Earth gravity
            
            // Add ground plane
            const groundShape = new CANNON.Plane();
            const groundBody = new CANNON.Body({ mass: 0 }); // Mass 0 makes it static
            groundBody.addShape(groundShape);
            groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // Rotate to be flat
            gameState.physics.world.addBody(groundBody);
            console.log('Physics world created with CANNON.js');
        } else {
            console.warn('CANNON.js not available, using simplified physics');
            // Set up a simple physics placeholder
            gameState.physics.world = {
                step: function() {} // Do nothing function
            };
        }
    } catch (error) {
        console.error('Error initializing physics:', error);
        // Set up a simple physics placeholder
        gameState.physics.world = {
            step: function() {} // Do nothing function
        };
    }
}

function gameLoop() {
    if (!gameState.gameActive) {
        return;
    }
    
    try {
        // Update physics
        gameState.physics.world.step(1 / 60);
        
        // Update car positions with smooth interpolation
        Object.keys(gameState.cars).forEach(playerId => {
            const car = gameState.cars[playerId];
            
            if (!car || !car.mesh) {
                return;
            }
            
            // Smoothly interpolate position and rotation
            car.mesh.position.lerp(car.targetPosition, 0.1);
            
            // Create a rotation quaternion from euler angles
            const targetQuaternion = new THREE.Quaternion();
            targetQuaternion.setFromEuler(new THREE.Euler(
                car.targetRotation.x,
                car.targetRotation.y,
                car.targetRotation.z,
                'XYZ'
            ));
            
            // Smoothly interpolate rotation
            car.mesh.quaternion.slerp(targetQuaternion, 0.1);
        });
        
        // Render scene
        gameState.renderer.render(gameState.scene, gameState.camera);
        
        // Update stats display if visible
        if (gameState.showStats) {
            updateStatsDisplay();
        }
        
        // Continue game loop
        requestAnimationFrame(gameLoop);
    } catch (error) {
        console.error('Error in game loop:', error);
        // Try to continue the game loop despite errors
        requestAnimationFrame(gameLoop);
    }
}

function onWindowResize() {
    console.log('Window resized');
    // Update camera aspect ratio and renderer size when window is resized
    const containerWidth = elements.gameContainer.clientWidth;
    const containerHeight = elements.gameContainer.clientHeight;
    
    gameState.camera.aspect = containerWidth / containerHeight;
    gameState.camera.updateProjectionMatrix();
    gameState.renderer.setSize(containerWidth, containerHeight);
    
    // Force a render after resize
    if (gameState.scene && gameState.camera) {
        gameState.renderer.render(gameState.scene, gameState.camera);
    }
}

// Function to update the stats display
function updateStatsDisplay() {
    if (!elements.statsOverlay) return;
    
    let statsHTML = '<div class="stats-header">Game Stats (Press F3 to toggle)</div>';
    
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
    
    // Reset to a position on the starting line
    const startPosition = [0, 0.5, -20];
    const car = gameState.cars[playerId];
    
    // Update car target position
    car.targetPosition.set(startPosition[0], startPosition[1], startPosition[2]);
    
    // Reset rotation to point in the right direction
    car.targetRotation.set(0, 0, 0);
    
    // Update player state
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