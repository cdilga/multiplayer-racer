import { 
    GAME_UPDATE_INTERVAL, 
    PHYSICS_UPDATE_RATE, 
    PHYSICS_TIMESTEP,
    socketDebug
} from './constants.js';

import gameStateManager, { 
    getGameState, 
    setLastPhysicsUpdate,
    getLastPhysicsUpdate,
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
} from './gameState.js';

// Import other modules
import { buildTrack } from './trackBuilder.js';
import { createCar } from './carModel.js';
import rapierPhysics from './rapierPhysics.js';
import * as THREE from 'three';
import CarKinematicController from './carKinematicController.js';

// Import domUtils.js for core DOM utilities
import { 
    getElement, 
    on,
    off,
    addClass,
    removeClass,
    toggleClass,
    createElement,
    setText,
    setHTML,
    toggleFullscreen as domToggleFullscreen, 
    updateFullscreenButton as domUpdateFullscreenButton, 
    createBarIndicator
} from './domUtils.js';

// Import playerUI.js for player-specific UI functionality
import {
    addPlayerToList,
    removePlayerFromList,
    updatePlayerName,
    updatePlayerColor
} from './playerUI.js';

// Import screenManager.js for screen transitions
import {
    showLobbyScreen,
    showGameScreen,
    updateRoomDisplay
} from './screenManager.js';

// Import statsUI.js for stats display
import {
    initStatsOverlay as initStatsOverlayUI,
    updateStatsDisplay as updateStatsContent,
    toggleStatsDisplay as toggleStatsUI,
    formatStatsDisplay,
    collectBasicStats
} from './statsUI.js';

// Import uiStyles.js for styling
import {
    initAllStyles
} from './uiStyles.js';

// Import the new physicsUI module
import { 
    createPhysicsDebugContainer, 
    removePhysicsDebugObjects as physicsUIRemoveDebugObjects, 
    togglePhysicsPanel as physicsUITogglePanel, 
    setupPhysicsParametersPanel,
    createParameterControl as physicsUICreateParameterControl,
    addPhysicsDebugStyles 
} from './physicsUI.js';

// Helper function to create and add an arrow to the scene
function drawArrow(direction, origin, length, color, headLength = 0.5, headWidth = 0.3) {
    const arrow = new THREE.ArrowHelper(
        direction,
        origin,
        length,
        color,
        headLength,
        headWidth
    );
    gameState.scene.add(arrow);
    return arrow;
}

/**
 * Update the control indicator UI to show current player controls
 * @param {HTMLElement} indicator - The control indicator element
 * @param {Object} controls - The control values (acceleration, braking, steering)
 * @param {string} playerName - The name of the player
 */
function updateControlIndicator(indicator, controls, playerName) {
    console.error("updateControlIndicator is being used!")
    if (!indicator) return;

    // Update the indicator labels
    const accelBar = indicator.querySelector('.accel-bar');
    const brakeBar = indicator.querySelector('.brake-bar');
    const steerIndicator = indicator.querySelector('.steer-indicator');
    const playerLabel = indicator.querySelector('.player-name');
    
    if (accelBar) {
        accelBar.style.width = `${Math.max(0, Math.min(100, controls.acceleration * 100))}%`;
    }
    
    if (brakeBar) {
        brakeBar.style.width = `${Math.max(0, Math.min(100, controls.braking * 100))}%`;
    }
    
    if (steerIndicator) {
        // Convert steering (-1 to 1) to rotation (-45 to 45 degrees)
        const rotation = controls.steering * 45;
        steerIndicator.style.transform = `rotate(${rotation}deg)`;
    }
    
    if (playerLabel) {
        playerLabel.textContent = playerName;
    }
}

// Get the game state object for direct access when needed
const gameState = getGameState();

// DOM elements placeholder
let elements = {};

// Socket placeholder
let socket;

window.isDebugMode = false;
// Wait for DOM to be fully loaded before setting up event listeners
document.addEventListener('DOMContentLoaded', () => {
        
    // Also check URL parameters and path
    if (!window.isDebugMode) {
        const urlParams = new URLSearchParams(window.location.search);
        const pathIncludesDebug = window.location.pathname.includes('/debug');
        window.isDebugMode = urlParams.has('debug') || pathIncludesDebug;
    }
    
    if (window.isDebugMode) {
        console.warn(`Debug mode: ${window.isDebugMode ? 'ON' : 'OFF'}`);
        document.body.classList.add('debug-mode');
    }
    

    // Initialize DOM elements
    elements = {
        lobbyScreen: getElement('lobby-screen'),
        gameScreen: getElement('game-screen'),
        startGameBtn: getElement('start-game-btn'),
        roomCodeDisplay: getElement('room-code-display'),
        playerList: getElement('player-list'),
        joinUrl: getElement('join-url'),
        gameContainer: getElement('game-container'),
        gameStatus: getElement('game-status'),
        statsOverlay: getElement('stats-overlay'),
        fullscreenBtn: getElement('fullscreen-btn')
    };
    
    // Add event listener for start game button
    if (elements.startGameBtn) {
        elements.startGameBtn.addEventListener('click', initGame);
    }
    
    // Initialize socket connection
    socket = io();
    
    // Socket event handlers
    socket.on('connect', () => {
        // Connected to server
        console.log('Connected to server');
        
        // Automatically create a room when connected
        createRoom();
    });
    
    // Handle room creation response
    socket.on('room_created', (data) => {
        setRoomCode(data.room_code);
        elements.roomCodeDisplay.textContent = gameState.roomCode;
        
        // Get local IP address from server-provided data if available
        let ipAddress = 'localhost';
        let port = window.location.port || '5000';
        
        if (typeof window.serverConfig !== 'undefined') {
            ipAddress = window.serverConfig.localIp;
            port = window.serverConfig.port;
        }
        
        updateRoomDisplay(gameState.roomCode, ipAddress, port);

        // Load QR code image
        const qrCodeUrl = `/qrcode/${gameState.roomCode}`;

        const qrCodeElement = document.getElementById('qr-code');
        if (qrCodeElement) {
            qrCodeElement.src = qrCodeUrl;
            // Add error handling in case the QR code fails to load
            qrCodeElement.onerror = function() {
                console.error('QR code failed to load');
                qrCodeElement.style.display = 'none';
                const container = document.querySelector('.qr-code-container');
                if (container) {
                    const errorMsg = document.createElement('p');
                    errorMsg.className = 'error';
                    errorMsg.textContent = 'QR code generation failed. Please use the room code instead.';
                    container.appendChild(errorMsg);
                }
            };
        } else {
            console.error('QR code element not found');
        }
        
        // Show lobby screen
        showLobbyScreen();
    });
    
    // Handle player joining
    socket.on('player_joined', (playerData) => {
        const { id, name, car_color } = playerData;
        
        // Add player to local state using the addPlayer function
        addPlayer(id, {
            name: name,
            carColor: car_color
        });
        
        // Add player to UI list
        addPlayerToList(id, name, car_color);
        
        // Enable start game button if there are players
        elements.startGameBtn.disabled = Object.keys(gameState.players).length === 0;
    });
    
    // Handle player name updates
    socket.on('player_name_updated', (data) => {
        const { player_id, name } = data;
        
        // Update player name in local state using the updatePlayer function
        if (gameState.players[player_id]) {
            updatePlayer(player_id, { name: name });
            
            // Update player name in UI
            const playerElement = document.getElementById(`player-${player_id}`);
            if (playerElement) {
                const nameSpan = playerElement.querySelector('span:not(.player-color)');
                if (nameSpan) {
                    nameSpan.textContent = name;
                }
            }
        }
    });
    
    // Handle player leaving
    socket.on('player_left', (data) => {
        const { player_id } = data;
        
        // Remove player from local state using the removePlayer function
        removePlayer(player_id);
        
        // Remove player from UI
        const playerElement = document.getElementById(`player-${player_id}`);
        if (playerElement) {
            playerElement.remove();
        }
        
        // If game is active, remove player's car
        if (gameState.gameActive && gameState.cars[player_id]) {
            gameState.scene.remove(gameState.cars[player_id].mesh);
            removeCar(player_id);
        }
        
        // Disable start game button if there are no players
        elements.startGameBtn.disabled = Object.keys(gameState.players).length === 0;
    });
    
    // Handle player controls update
    socket.on('player_controls_update', (data) => {
        const { player_id, acceleration, braking, steering } = data;
        
        // Update car controls if the car exists
        if (gameState.cars[player_id]) {
            const car = gameState.cars[player_id];
            updateCar(player_id, {
                controls: {
                    acceleration: acceleration,
                    braking: braking,
                    steering: steering
                }
            });
            
            // Update control indicator if it exists
            if (gameState.controlIndicator) {
                updateControlIndicator(
                    gameState.controlIndicator,
                    car.controls,
                    gameState.players[player_id]?.name || `Player ${player_id}`
                );
            }
        }
    });
    
    // Handle player disconnection
    socket.on('player_disconnected', (data) => {
        const { player_id } = data;
        
        // Remove player from local state using the removePlayer function
        removePlayer(player_id);
        
        // Remove player from UI
        const playerElement = document.getElementById(`player-${player_id}`);
        if (playerElement) {
            playerElement.remove();
        }
        
        // If game is active, remove player's car
        if (gameState.gameActive && gameState.cars[player_id]) {
            gameState.scene.remove(gameState.cars[player_id].mesh);
            removeCar(player_id);
        }
        
        // Disable start game button if there are no players
        elements.startGameBtn.disabled = Object.keys(gameState.players).length === 0;
    });
    
    // Add keyboard event listener for F3/F4 keys
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
            
            // Get the physics panel
            const panel = document.getElementById('physics-params-panel');
            if (!panel) {
                console.error('Physics panel not found in DOM');
                return;
            }
            
            // Toggle the 'visible' class
            const isVisible = panel.classList.toggle('visible');
            
            event.preventDefault();
        }
        // Toggle stats display (F3)
        if (e.key === 'F3' || e.key === 'f3') {
            toggleStatsDisplay();
        }
        
        // Toggle physics debug (F4)
        if (e.key === 'F4' || e.key === 'f4') {
            togglePhysicsDebugDisplay();
        }
    });
    
    // Add event listeners for fullscreen
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    if (elements.fullscreenBtn) {
        elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
    }
});

// Game functions
function createRoom() {
    socket.emit('create_room', {});
}

// Three.js game initialization
let isInitializing = false; // Flag to prevent multiple initializations
let animationRequestId = null; // Track the animation frame request

function initGame() {
    if (gameState.roomCode && Object.keys(gameState.players).length > 0) {
        socket.emit('start_game', { room_code: gameState.roomCode });
        showGameScreen();
    }

    setGameActive(true);
    if (isInitializing) return;
    isInitializing = true;
    
    // Reset any previous state
    if (animationRequestId) {
        cancelAnimationFrame(animationRequestId);
        animationRequestId = null;
    }
    
    // Initialize stats overlay
    initStatsOverlayUI();
    
    // Initialize physics parameters panel
    initPhysicsParametersPanel();
    
    // Initialize Three.js scene
    const scene = new THREE.Scene();
    setScene(scene);
    
    // Set up camera
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspectRatio = width / height;
    
    const camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
    setCamera(camera);
    
    // Set up renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height, true);
    renderer.setClearColor(0x87CEEB); // Sky blue background
    renderer.shadowMap.enabled = true;
    setRenderer(renderer);
    
    // Add renderer to DOM
    const container = elements.gameContainer;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    
    // Position camera
    if (window.innerWidth < 768) {
        // Mobile view - higher angle
        camera.position.set(0, 45, 45);
    } else {
        // Desktop view
        camera.position.set(0, 50, 50);
    }
    camera.lookAt(0, 0, 0);
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    // Add directional light for shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    // Create race track
    let track;
    if (typeof buildTrack === 'function') {
        track = buildTrack({
            scene: scene,
            addToScene: false
        });
    } else {
        track = createRaceTrack();
    }
    
    scene.add(track);
    setTrack(track);
    
    // Initialize physics
    initPhysics().then(() => {
        // Create cars for all players
        const playerIds = Object.keys(gameState.players);
        for (const playerId of playerIds) {
            const player = gameState.players[playerId];
            createPlayerCar(playerId, player.carColor);
        }
        
        // Start game loop
        gameLoop();
    });
    
    // Initial render
    renderer.render(scene, camera);
    
    // Add window resize handler
    window.addEventListener('resize', onWindowResize);
    
    // Create cars for all players
    const playerIds = Object.keys(gameState.players);
    for (const playerId of playerIds) {
        const player = gameState.players[playerId];
        createPlayerCar(playerId, player.carColor);
    }
    
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
    
    // Make physicsParams available globally for other modules
    window.physicsParams = physicsParams;
    
    isInitializing = false;
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
    // Remove existing car if it exists
    if (gameState.cars[playerId]) {
        // Remove from scene
        gameState.scene.remove(gameState.cars[playerId].mesh);
        
        // Remove physics body if it exists
        if (gameState.cars[playerId].physicsBody && gameState.physics.world) {
            // Check if the world has a removeRigidBody method (Rapier does)
            if (typeof gameState.physics.world.removeRigidBody === 'function') {
                gameState.physics.world.removeRigidBody(gameState.cars[playerId].physicsBody);
            }
        }
        
        // Remove car from state
        removeCar(playerId);
    }
    
    // Get player data
    const player = gameState.players[playerId];
    if (!player) {
        console.error(`Player ${playerId} not found`);
        return null;
    }
    
    // Set car color (use default if not provided)
    const color = carColor || "#FF0000";
    
    // Set starting position
    const startPosition = { x: 0, y: 1.5, z: -20 }; // Lower height for character controller
    
    // Set car dimensions
    const carDimensions = {
        width: 2.0,
        height: 1.0,
        length: 4.0,
        wheelRadius: 0.5,
        wheelWidth: 0.4
    };
    
    // Create car mesh
    const car = createCar({
        color: color,
        dimensions: carDimensions
    });
    
    // Position car
    car.position.set(startPosition.x, startPosition.y, startPosition.z);
    
    // Add car to scene
    gameState.scene.add(car);
    
    // Create physics body for car if physics is initialized
    let physicsBody = null;
    let wheelBodies = [];
    
    if (gameState.physics && gameState.physics.initialized &&
        gameState.physics.world && gameState.physics.usingRapier) {
        
        // Create car controller configuration
        const controllerConfig = {
            // Car dimensions
            chassisWidth: carDimensions.width,
            chassisHeight: carDimensions.height,
            chassisLength: carDimensions.length,
            
            // Wheel configuration
            wheelRadius: carDimensions.wheelRadius,
            wheelWidth: carDimensions.wheelWidth,
            
            // Wheel positions
            frontWheelForward: carDimensions.length * 0.3,
            rearWheelForward: -carDimensions.length * 0.3,
            wheelHalfTrack: carDimensions.width * 0.4,
            wheelRestingHeight: -carDimensions.height * 0.5,
            
            // Suspension
            suspensionStiffness: 30.0,
            suspensionDamping: 2.5,
            suspensionTravel: 0.3,
            
            // Engine
            engineForce: 500.0,
            brakeForce: 10.0,
            steeringAngle: 0.5,
            
            // Friction
            wheelFriction: 2.0,
            
            // Mass
            chassisMass: 150.0,
            wheelMass: 20.0,
            
            // Movement parameters from physicsParams
            forwardSpeed: physicsParams.car.forwardSpeed,
            reverseSpeed: physicsParams.car.reverseSpeed,
            maxSteeringAngle: physicsParams.car.maxSteeringAngle,
            steeringSpeed: physicsParams.car.steeringSpeed,
            steeringReturnSpeed: physicsParams.car.steeringReturnSpeed
        };
        
        // Create car physics
        const carPhysics = createCarPhysics(
            gameState.physics.world,
            gameState.physics.rapier,
            startPosition,
            controllerConfig
        );
        
        if (carPhysics) {
            physicsBody = carPhysics.chassisBody;
            wheelBodies = carPhysics.wheelBodies;
        }
    }
    
    // Store wheel meshes for animation
    const wheelMeshes = [];
    
    // Find wheel meshes in the car model
    for (let i = 0; i < car.children.length; i++) {
        const child = car.children[i];
        if (child.name && child.name.includes('wheel')) {
            wheelMeshes.push(child);
        }
    }
    
    // Add car to game state
    const carData = {
        mesh: car,
        physicsBody: physicsBody,
        wheelBodies: wheelBodies,
        wheelMeshes: wheelMeshes,
        controls: {
            acceleration: 0,
            braking: 0,
            steering: 0
        },
        position: { ...startPosition },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        dimensions: { ...carDimensions }
    };
    
    // Add car to game state using the addCar function
    addCar(playerId, carData);
    
    return gameState.cars[playerId];
}

// Initialize physics with Rapier
async function initPhysics() {
    // Check if rapierPhysics is available
    if (typeof rapierPhysics !== 'undefined') {
        try {
            // Initialize Rapier physics engine
            const rapier = await rapierPhysics.init();
            
            // Create physics world
            const gravity = { x: 0.0, y: -9.81, z: 0.0 };
            const world = new rapier.World(gravity);
            
            // Initialize physics in game state
            initializePhysics(world, rapier);
            
            // Create ground and walls
            createGroundCollider(world, rapier);
            createTrackWalls(world, rapier);
            
            // Physics is now initialized
            console.log("Physics initialized with Rapier");
            
            return true;
        } catch (error) {
            console.error("Failed to initialize Rapier physics:", error);
            return false;
        }
    } else {
        console.warn("Rapier physics not available");
        return false;
    }
}

// Create ground collider for physics simulation
function createGroundCollider(world, rapier) {
    // Create a fixed rigid body for the ground
    const groundBodyDesc = rapier.RigidBodyDesc.fixed();
    const groundBody = world.createRigidBody(groundBodyDesc);
    
    // Create a cuboid collider for the ground
    const groundWidth = 150.0;   // Increased from 100 to match visual size
    const groundHeight = 0.1;    // Same thin height
    const groundLength = 150.0;  // Increased from 100 to match visual size
    
    // Create collider description
    const groundColliderDesc = rapier.ColliderDesc.cuboid(groundWidth/2, groundHeight/2, groundLength/2);
    groundColliderDesc.setTranslation(0, -groundHeight/2, 0);
    
    // Create the collider
    const groundCollider = world.createCollider(groundColliderDesc, groundBody);
    
    // Add to physics state using the imported functions
    addPhysicsBody('ground', groundBody);
    addPhysicsCollider('ground', groundCollider);
    
    return groundCollider;
}

// Create walls around the track
function createTrackWalls(world, rapier) {
    // Only create walls if we have a track defined
    if (!gameState.track) {
        console.warn('No track defined, skipping wall creation');
        return;
    }
    
    try {
        // Use the same dimensions as the ground collider for consistency
        const groundWidth = 150.0;
        const groundLength = 150.0;
        const wallHeight = 3; // Increased height for better visibility
        const wallThickness = 1.0; // Thicker walls for better collision
        
        // Initialize walls arrays in the gameState
        gameState.physics.bodies.walls = [];
        gameState.physics.colliders.walls = [];
        
        // Left wall
        const leftWallBodyDesc = rapier.RigidBodyDesc.fixed();
        leftWallBodyDesc.setTranslation(-groundWidth/2, wallHeight/2, 0);
        const leftWallBody = world.createRigidBody(leftWallBodyDesc);
        
        const leftWallColliderDesc = rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, groundLength/2);
        leftWallColliderDesc.setFriction(0.3);
        const leftWallCollider = world.createCollider(leftWallColliderDesc, leftWallBody);
        
        // Add to physics state
        gameState.physics.bodies.walls.push(leftWallBody);
        gameState.physics.colliders.walls.push(leftWallCollider);
        
        // Right wall
        const rightWallBodyDesc = rapier.RigidBodyDesc.fixed();
        rightWallBodyDesc.setTranslation(groundWidth/2, wallHeight/2, 0);
        const rightWallBody = world.createRigidBody(rightWallBodyDesc);
        
        const rightWallColliderDesc = rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, groundLength/2);
        rightWallColliderDesc.setFriction(0.3);
        const rightWallCollider = world.createCollider(rightWallColliderDesc, rightWallBody);
        
        // Add to physics state
        gameState.physics.bodies.walls.push(rightWallBody);
        gameState.physics.colliders.walls.push(rightWallCollider);
        
        // Top wall
        const topWallBodyDesc = rapier.RigidBodyDesc.fixed();
        topWallBodyDesc.setTranslation(0, wallHeight/2, -groundLength/2);
        const topWallBody = world.createRigidBody(topWallBodyDesc);
        
        const topWallColliderDesc = rapier.ColliderDesc.cuboid(groundWidth/2, wallHeight/2, wallThickness/2);
        topWallColliderDesc.setFriction(0.3);
        const topWallCollider = world.createCollider(topWallColliderDesc, topWallBody);
        
        // Add to physics state
        gameState.physics.bodies.walls.push(topWallBody);
        gameState.physics.colliders.walls.push(topWallCollider);
        
        // Bottom wall
        const bottomWallBodyDesc = rapier.RigidBodyDesc.fixed();
        bottomWallBodyDesc.setTranslation(0, wallHeight/2, groundLength/2);
        const bottomWallBody = world.createRigidBody(bottomWallBodyDesc);
        
        const bottomWallColliderDesc = rapier.ColliderDesc.cuboid(groundWidth/2, wallHeight/2, wallThickness/2);
        bottomWallColliderDesc.setFriction(0.3);
        const bottomWallCollider = world.createCollider(bottomWallColliderDesc, bottomWallBody);
        
        // Add to physics state
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

// Improved game loop that avoids potential stack overflow issues
function gameLoopWithoutRecursion(timestamp) {
    // Calculate delta time
    const deltaTime = timestamp - (gameState.lastTimestamp || timestamp);
    
    // Update FPS counter
    updateFPS(timestamp);
    
    // Update stats display if enabled
    if (gameState.showStats) {
        updateStatsDisplay();
    }
    
    // Update physics at fixed timestep
    const now = performance.now();
    if (now - getLastPhysicsUpdate() >= PHYSICS_TIMESTEP * 1000) {
        // Calculate physics timestep (clamped to avoid spiral of death)
        // Ensure physicsStep is never 0 by using Math.max with a small positive value
        const physicsStep = Math.max(Math.min(deltaTime / 1000, 1/30), 1/60);
        
        // Update physics world
        if (gameState.physics.initialized && gameState.physics.world) {
            gameState.physics.world.step();
            gameState.debugCounters.physicsUpdate++;
            
            // Update physics debug visualization if enabled
            if (gameState.showPhysicsDebug) {
                updatePhysicsDebugVisualization();
            }
        }
        
        // Update car positions based on physics
        for (const playerId in gameState.cars) {
            const car = gameState.cars[playerId];
            
            // Apply controls to physics body
            if (car.physicsBody) {
                // Update car controller with current controls
                CarKinematicController.updateCarController(
                    car.physicsBody,
                    car.controls,
                    physicsStep
                );
            }
        }
        
        // Update last physics update time
        setLastPhysicsUpdate(now);
    }
    
    // Update car meshes based on physics bodies
    for (const playerId in gameState.cars) {
        const car = gameState.cars[playerId];
        
        // Update car mesh position/rotation from physics body
        if (car.physicsBody) {
            // Sync car model with physics
            CarKinematicController.syncCarModelWithKinematics(
                car.physicsBody,
                car.mesh,
                car.wheelMeshes
            );
        }
    }
    
    // Render the scene
    gameState.renderer.render(gameState.scene, gameState.camera);
    
    // Request next frame
    requestAnimationFrame(gameLoopWithoutRecursion);
}

// Modify the existing gameLoop function to use the new gameLoopWithoutRecursion function
function gameLoop() {
    // Start the non-recursive game loop
    requestAnimationFrame(gameLoopWithoutRecursion);
}

function onWindowResize() {
    if (gameState.camera && gameState.renderer) {
        // Get new window dimensions
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Update camera aspect ratio
        gameState.camera.aspect = width / height;
        gameState.camera.updateProjectionMatrix();
        
        // Update renderer size
        gameState.renderer.setSize(width, height, true);
        
        // Force a render to update the display
        gameState.renderer.render(gameState.scene, gameState.camera);
    }
}

/**
 * Update stats display with game state information
 */
function updateStatsDisplay() {
    if (!gameState.showStats) return;
    
    // Get the current game state
    const currentGameState = getGameState();
    
    // Debug car controls data
    const carKeys = Object.keys(currentGameState.cars);
    if (carKeys.length > 0) {
        const firstCarId = carKeys[0];
        const firstCar = currentGameState.cars[firstCarId];
    }
    
    // Collect basic stats from game state
    const stats = collectBasicStats(currentGameState);
    
    // Format stats and update display
    const formattedStats = formatStatsDisplay(stats, currentGameState);
    updateStatsContent(formattedStats);
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
    
    console.warn(`Creating missing physics body for car ${playerId}`);
    
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

// Update the function to use the renamed import
function toggleFullscreen() {
    const isFullscreen = domToggleFullscreen();
    domUpdateFullscreenButton(isFullscreen);
}

// Update the function to use the renamed import
function updateFullscreenButton() {
    const isFullscreen = !!document.fullscreenElement;
    domUpdateFullscreenButton(isFullscreen);
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
                
                const engineForceArrow = drawArrow(
                    engineDir.normalize(),
                    position.clone().add(new THREE.Vector3(0, 1.5, 0)),
                    Math.min(Math.abs(forces.engineForce) / 1000, 5),
                    0x00ff00, // Green
                    0.5,
                    0.3
                );
                gameState.forceVisualization.push(engineForceArrow);
            }
            
            // Visualize brake force (always backward)
            if (forces.brakeForce > 100) {
                const brakeDir = new THREE.Vector3(0, 0, 1);
                brakeDir.applyQuaternion(car.mesh.quaternion);
                
                const brakeForceArrow = drawArrow(
                    brakeDir.normalize(),
                    position.clone().add(new THREE.Vector3(0, 1.2, 0)),
                    Math.min(forces.brakeForce / 1000, 5),
                    0xff0000, // Red
                    0.5,
                    0.3
                );
                gameState.forceVisualization.push(brakeForceArrow);
            }
            
            // Visualize lateral force (sideways)
            if (Math.abs(forces.lateralForce) > 100) {
                const lateralDir = new THREE.Vector3(Math.sign(forces.lateralForce), 0, 0);
                lateralDir.applyQuaternion(car.mesh.quaternion);
                
                const lateralForceArrow = drawArrow(
                    lateralDir.normalize(),
                    position.clone().add(new THREE.Vector3(0, 0.9, 0)),
                    Math.min(Math.abs(forces.lateralForce) / 500, 5),
                    0x0000ff, // Blue
                    0.5,
                    0.3
                );
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
        // Movement
        forwardSpeed: 10.0,
        reverseSpeed: 5.0,
        
        // Steering
        maxSteeringAngle: 0.6,
        steeringSpeed: 0.3,
        steeringReturnSpeed: 0.2
    },
    carBody: {
        // Dimensions
        width: 1.5,
        height: 0.8,
        length: 3.0
    },
    world: {
        gravity: { x: 0.0, y: -20.0, z: 0.0 }
    },
    characterController: {
        characterOffset: 0.1,        // Gap between character and environment
        maxSlopeClimbAngle: 0.6,     // About 35 degrees
        minSlopeSlideAngle: 0.4,     // About 25 degrees
        gravity: -20.0,               // Character-specific gravity
        enableAutostep: true,        // Whether to enable auto-stepping
        autostepHeight: 0.3,         // Maximum step height
        autostepWidth: 0.2           // Minimum step width
    },
    wheels: {
        friction: 1.0,               // Wheel friction
        suspensionStiffness: 10.0    // Suspension stiffness
    }
};

// Store original values for reset
const defaultPhysicsParams = JSON.parse(JSON.stringify(physicsParams));

// Replace initPhysicsParametersPanel with a version that uses the existing panel
function initPhysicsParametersPanel() {
    console.log('Initializing physics parameters panel');
    
    // Get the existing physics panel from the HTML
    const physicsPanel = document.getElementById('physics-params-panel');
    if (!physicsPanel) {
        console.error('Physics panel not found in HTML');
        return;
    }
    
    
    console.log('Found existing physics panel in HTML');
    
        
    console.log('Found existing physics panel in HTML');
    
    // Create tabs for different parameter groups
    setupTabSwitcher();
    
    // Create UI controls for physics parameters
    createCarParametersUI();
    createWorldParametersUI();
    createWheelsParametersUI();
    
    // Set up physics buttons
    setupPhysicsButtons();
    
    // Update all parameter controls with current values
    // This needs to be called after the game has started and cars are created
    // We'll set a small delay to ensure cars are created
    setTimeout(() => {
        updateAllParameterControls();
        console.log('Parameter controls updated with delay');
    }, 1000);
    
}

// Setup event listeners for the physics panel tabs
function setupTabSwitcher() {
    console.log('Setting up tab switcher for physics panel');
    
    const tabButtons = document.querySelectorAll('.params-tab');
    if (tabButtons.length === 0) {
        console.error('No tab buttons found with class .params-tab');
        return;
    }
    
    console.log(`Found ${tabButtons.length} tab buttons`);
    
    tabButtons.forEach(tab => {
        tab.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            const targetId = targetTab + '-params';
            
            console.log(`Tab clicked: ${targetTab}, targeting: ${targetId}`);
            
            // Remove active class from all tabs and contents
            document.querySelectorAll('.params-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.params-container').forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab and its content
            this.classList.add('active');
            
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.classList.add('active');
            } else {
                console.error(`Target element #${targetId} not found`);
            }
        });
    });
    
    console.log('Tab switcher setup complete');
}

// Create UI controls for car parameters
function createCarParametersUI() {
    const carBodyGroup = document.querySelector('#car-params .params-group:nth-child(1)');
    const movementGroup = document.querySelector('#car-params .params-group:nth-child(2)');
    
    if (!carBodyGroup || !movementGroup) {
        console.error('Car parameter groups not found');
        return;
    }
    
    // Car body physics - add rectangular dimensions
    physicsUICreateParameterControl(carBodyGroup, 'carBody', 'width', 'Width', 0.5, 3.0, 0.1);
    physicsUICreateParameterControl(carBodyGroup, 'carBody', 'height', 'Height', 0.5, 2.0, 0.1);
    physicsUICreateParameterControl(carBodyGroup, 'carBody', 'length', 'Length', 1.0, 5.0, 0.1);
    
    // Character controller settings
    physicsUICreateParameterControl(carBodyGroup, 'characterController', 'characterOffset', 'Character Offset', 0.05, 0.5, 0.05);
    physicsUICreateParameterControl(carBodyGroup, 'characterController', 'maxSlopeClimbAngle', 'Max Climb Angle', 0.2, 1.0, 0.05);
    physicsUICreateParameterControl(carBodyGroup, 'characterController', 'minSlopeSlideAngle', 'Min Slide Angle', 0.2, 0.8, 0.05);
    
    // Movement parameters
    physicsUICreateParameterControl(movementGroup, 'car', 'forwardSpeed', 'Forward Speed', 5.0, 50.0, 1.0);
    physicsUICreateParameterControl(movementGroup, 'car', 'reverseSpeed', 'Reverse Speed', 2.0, 25.0, 1.0);
    physicsUICreateParameterControl(movementGroup, 'car', 'steeringSpeed', 'Steering Speed', 0.05, 0.3, 0.01);
    physicsUICreateParameterControl(movementGroup, 'car', 'steeringReturnSpeed', 'Steering Return', 0.1, 1.0, 0.05);
}

// Create UI controls for world parameters
function createWorldParametersUI() {
    const worldGroup = document.querySelector('#world-params .params-group');
    if (!worldGroup) {
        console.error('World parameters group not found');
        return;
    }
    
    // World physics
    physicsUICreateParameterControl(worldGroup, 'world', 'gravity.y', 'World Gravity Y', -30, -5, 0.5);
    physicsUICreateParameterControl(worldGroup, 'characterController', 'gravity', 'Car Gravity', -30, -5, 0.5);
}

// Create UI controls for wheels parameters - now just basic character controller settings
function createWheelsParametersUI() {
    const wheelGroup = document.querySelector('#wheels-params .params-group');
    if (!wheelGroup) {
        console.error('Wheels parameters group not found');
        return;
    }
    
    // Wheel settings
    physicsUICreateParameterControl(wheelGroup, 'wheels', 'friction', 'Wheel Friction', 0.1, 2.0, 0.1);
    physicsUICreateParameterControl(wheelGroup, 'wheels', 'suspensionStiffness', 'Suspension Stiffness', 1.0, 30.0, 1.0);
}

// Setup physics parameter buttons
function setupPhysicsButtons() {
    console.log('Setting up physics buttons');
    
    // Get reset button element
    const resetButton = document.getElementById('reset-physics');
    
    // Add error handling
    if (!resetButton) {
        console.error('Reset physics button not found');
    } else {
        console.log('Found reset button');
        
        // Reset button
        resetButton.addEventListener('click', () => {
            console.log('Reset physics button clicked');
            // Reset physics parameters to defaults
            if (defaultPhysicsParams) {
                physicsParams = JSON.parse(JSON.stringify(defaultPhysicsParams));
                updateAllParameterControls();
                applyPhysicsChanges();
            }
        });
    }
    
    // Add a close button if it doesn't exist
    let closeButton = document.getElementById('close-physics-panel');
    if (!closeButton) {
        console.log('Close button not found, creating one');
        
        // Get the buttons container
        const buttonsContainer = document.querySelector('.param-buttons');
        if (buttonsContainer) {
            // Create close button
            closeButton = document.createElement('button');
            closeButton.id = 'close-physics-panel';
            closeButton.className = 'param-button close';
            closeButton.textContent = 'Close';
            
            // Add to container
            buttonsContainer.appendChild(closeButton);
            console.log('Close button created and added');
        } else {
            console.error('Buttons container not found');
        }
    }
    
    // Set up close button event listener
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            console.log('Close physics button clicked');
            // Hide the panel
            const panel = document.getElementById('physics-params-panel');
            if (panel) {
                panel.classList.remove('visible');
            }
        });
    }
    
    console.log('Physics buttons setup complete');
}

// Update all UI controls to match current parameter values
function updateAllParameterControls() {
    console.log('Updating all parameter controls with current values');
    const inputs = document.querySelectorAll('#physics-params-panel input');
    
    // First, make sure we have the current car dimensions from the first player's car
    if (gameState.players) {
        const playerIds = Object.keys(gameState.players);
        if (playerIds.length > 0) {
            const firstPlayer = gameState.players[playerIds[0]];
            if (firstPlayer.carBody && firstPlayer.carBody.userData && firstPlayer.carBody.userData.dimensions) {
                const dimensions = firstPlayer.carBody.userData.dimensions;
                console.log('Got current car dimensions from player car:', dimensions);
                
                // Update physicsParams with the current dimensions
                physicsParams.carBody.width = dimensions.width;
                physicsParams.carBody.height = dimensions.height;
                physicsParams.carBody.length = dimensions.length;
            }
        }
    }
    
    inputs.forEach(input => {
        const group = input.dataset.group;
        const param = input.dataset.param;
        
        if (group && param) {
            try {
                // Check if the group exists
                if (!physicsParams[group]) {
                    console.warn(`Group ${group} not found in physicsParams`);
                    return;
                }
                
                // Handle nested properties
                let value;
                if (param.includes('.')) {
                    const parts = param.split('.');
                    let obj = physicsParams[group];
                    
                    // Navigate through the object hierarchy
                    for (let i = 0; i < parts.length && obj !== undefined; i++) {
                        obj = obj[parts[i]];
                    }
                    value = obj;
                } else {
                    value = physicsParams[group][param];
                }
                
                // Only update if value is defined
                if (value !== undefined) {
                    input.value = value;
                    
                    // Update the value display if it exists
                    const valueDisplay = input.nextElementSibling;
                    if (valueDisplay && valueDisplay.classList.contains('value-display')) {
                        valueDisplay.textContent = value.toFixed(2);
                    }
                } else {
                    console.warn(`Parameter ${param} not found in group ${group}`);
                }
            } catch (error) {
                console.error(`Error updating parameter control (${group}.${param}):`, error);
            }
        }
    });
    
    console.log('All parameter controls updated');
}

// Apply physics changes to active car bodies (now using character controller)
function applyPhysicsChanges() {
    try {
        // Apply changes to world physics
        if (gameState.physics.world) {
            updateWorldPhysics(gameState.physics.world);
        }
        
        // Apply changes to existing car controllers
        for (const playerId in gameState.players) {
            // Get the car for this player
            const car = gameState.cars[playerId];
            
            if (car && car.physicsBody) {
                updateCarControllerConfig(car.physicsBody);
            } else {
                // Try to ensure the car has a physics body
                if (car && !car.physicsBody) {
                    ensureCarHasPhysicsBody(playerId);
                }
            }
        }
    } catch (error) {
        console.error('Error applying physics changes:', error);
    }
}

// Make applyPhysicsChanges available globally
window.applyPhysicsChanges = applyPhysicsChanges;

// Update car controller configuration with current parameters
function updateCarControllerConfig(carBody) {
    if (!carBody) {
        console.error('Car body is null or undefined');
        return;
    }
    
    if (!carBody.userData) {
        console.error('Car body has no userData property');
        return;
    }
    
    try {
        // Update character controller configuration
        if (carBody.userData.config) {
            // Forward the new parameters to the character controller config
            carBody.userData.config.forwardSpeed = physicsParams.car.forwardSpeed;
            carBody.userData.config.reverseSpeed = physicsParams.car.reverseSpeed;
            carBody.userData.config.maxSteeringAngle = physicsParams.car.maxSteeringAngle;
            carBody.userData.config.steeringSpeed = physicsParams.car.steeringSpeed;
            carBody.userData.config.steeringReturnSpeed = physicsParams.car.steeringReturnSpeed;
            carBody.userData.config.characterOffset = physicsParams.characterController.characterOffset;
            carBody.userData.config.maxSlopeClimbAngle = physicsParams.characterController.maxSlopeClimbAngle;
            carBody.userData.config.minSlopeSlideAngle = physicsParams.characterController.minSlopeSlideAngle;
            carBody.userData.config.gravity = physicsParams.characterController.gravity;
            
            // Update movement parameters using the updateCarMovementParams function if available
            if (typeof CarKinematicController.updateCarMovementParams === 'function') {
                // Update each movement parameter
                CarKinematicController.updateCarMovementParams(carBody, 'forwardSpeed', physicsParams.car.forwardSpeed);
                CarKinematicController.updateCarMovementParams(carBody, 'reverseSpeed', physicsParams.car.reverseSpeed);
                CarKinematicController.updateCarMovementParams(carBody, 'maxSteeringAngle', physicsParams.car.maxSteeringAngle);
                CarKinematicController.updateCarMovementParams(carBody, 'steeringSpeed', physicsParams.car.steeringSpeed);
                CarKinematicController.updateCarMovementParams(carBody, 'steeringReturnSpeed', physicsParams.car.steeringReturnSpeed);
                CarKinematicController.updateCarMovementParams(carBody, 'gravity', physicsParams.characterController.gravity);
            }
            
            // Update autostep settings if character controller is available
            if (carBody.userData.characterController) {
                const controller = carBody.userData.characterController;
                
                // Apply autostep settings
                if (physicsParams.characterController.enableAutostep) {
                    controller.enableAutostep(
                        physicsParams.characterController.autostepHeight,
                        physicsParams.characterController.autostepWidth,
                        false // Don't enable dynamic bodies for autostep
                    );
                } else {
                    controller.disableAutostep();
                }
                
                // Update other controller settings
                controller.setMaxSlopeClimbAngle(physicsParams.characterController.maxSlopeClimbAngle);
                controller.setMinSlopeSlideAngle(physicsParams.characterController.minSlopeSlideAngle);
            }
        } else {
            console.error('Car body userData has no config property');
        }
        
        // Update car dimensions if the updateCarDimensions function is available
        if (typeof CarKinematicController.updateCarDimensions === 'function' && 
            gameState.physics.world && 
            gameState.physics.rapier) {
            
            const dimensions = {
                width: physicsParams.carBody.width,
                height: physicsParams.carBody.height,
                length: physicsParams.carBody.length
            };
            
            CarKinematicController.updateCarDimensions(
                carBody, 
                dimensions, 
                gameState.physics.world, 
                gameState.physics.rapier
            );
        }
    } catch (error) {
        console.error('Error updating car controller config:', error);
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

/**
 * Toggle stats display
 */
function toggleStatsDisplay() {
    // Toggle the state in gameState
    toggleStats();
    
    // Call the imported toggleStatsUI function to handle the UI
    const isVisible = toggleStatsUI(gameState.showStats);
    
    // Update the stats display immediately if visible
    if (isVisible) {
        updateStatsDisplay();
    }
    
    // Log debug information
    console.log("Stats display toggled:", isVisible);
}

function togglePhysicsDebugDisplay() {
    // Toggle the state in gameState
    togglePhysicsDebug();
    
    if (gameState.showPhysicsDebug) {
        // Add debug visualization styles
        addPhysicsDebugStyles();
        
        // Create debug container if it doesn't exist
        createPhysicsDebugContainer();
        
        // Update visualization immediately if physics is initialized
        if (gameState.physics.initialized && gameState.physics.world) {
            updatePhysicsDebugVisualization();
        }
    } else {
        // Remove debug visualization objects
        removePhysicsDebugObjects();
    }
    
    console.log(`Physics debug: ${gameState.showPhysicsDebug ? 'ON' : 'OFF'}`);
}

function createCarPhysics(world, rapier, position, config) {
    // Create car physics using the CarKinematicController
    const carBody = CarKinematicController.createCarController(
        world,
        position,
        {
            width: config.chassisWidth,
            height: config.chassisHeight,
            length: config.chassisLength
        },
        config,
        rapier  // Pass the Rapier instance
    );
    
    if (!carBody) {
        console.error('Failed to create car body');
        return null;
    }
    
    // Return the car physics body and wheel bodies
    return {
        chassisBody: carBody,
        wheelBodies: [] // Simplified for this example
    };
}

// The initStatsOverlay function has been replaced with direct calls to initStatsOverlayUI

// Update removePhysicsDebugObjects to use the renamed import
function removePhysicsDebugObjects() {
    // First remove any THREE.js objects from the scene
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
        
        // Clear stored debug objects
        gameState.physicsDebugObjects = [];
    }
    
    // Then call the physicsUI function to remove DOM elements
    physicsUIRemoveDebugObjects();
}

/**
 * Update or create physics debug visualization
 */
function updatePhysicsDebugVisualization() {
    if (!gameState.physics.initialized || !gameState.physics.world) return;
    
    // Clear previous debug objects
    removePhysicsDebugObjects();
    
    // Create debug container using domUtils
    const debugContainer = createPhysicsDebugContainer();
    
    // If Rapier's debug render is available, use it
    const world = gameState.physics.world;
    
    try {
        if (world.debugRender) {
            // Use Rapier's built-in debug render function
            const { vertices, colors } = world.debugRender();
            
            // Log debug data to understand the format (only once)
            if (!gameState.debugRenderLogged) {
                console.debug('Rapier debug render data:', {
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
        }
    } catch (error) {
        console.error('Error using Rapier debug render:', error);
    }
}