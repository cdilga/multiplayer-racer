// Player interface logic

// Game state
const gameState = {
    playerName: '',
    roomCode: '',
    playerId: null,
    carColor: null,
    connected: false,
    gameStarted: false,
    controls: {
        steering: 0,       // -1 to 1 (left to right)
        acceleration: 0,   // 0 to 1
        braking: 0         // 0 to 1
    },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    velocity: [0, 0, 0],
    speed: 0,
    touchControls: {
        steeringActive: false,
        steeringStartX: 0,
        steeringCurrentX: 0
    }
};

// DOM elements
const elements = {
    joinScreen: document.getElementById('join-screen'),
    waitingScreen: document.getElementById('waiting-screen'),
    gameScreen: document.getElementById('game-screen'),
    playerNameInput: document.getElementById('player-name'),
    roomCodeInput: document.getElementById('room-code'),
    joinButton: document.getElementById('join-btn'),
    errorMessage: document.getElementById('error-message'),
    displayName: document.getElementById('display-name'),
    displayRoom: document.getElementById('display-room'),
    carPreview: document.getElementById('car-preview'),
    steeringWheel: document.getElementById('steering-wheel'),
    accelerateBtn: document.getElementById('accelerate-btn'),
    brakeBtn: document.getElementById('brake-btn'),
    speedDisplay: document.getElementById('speed'),
    controlsContainer: document.getElementById('controls-container')
};

// Socket.io connection
const socket = io();

// Event listeners
elements.joinButton.addEventListener('click', joinGame);
elements.accelerateBtn.addEventListener('touchstart', () => setAcceleration(1));
elements.accelerateBtn.addEventListener('touchend', () => setAcceleration(0));
elements.brakeBtn.addEventListener('touchstart', () => setBraking(1));
elements.brakeBtn.addEventListener('touchend', () => setBraking(0));

// Mobile controls - prevent default behaviors to avoid scrolling while playing
document.addEventListener('touchmove', (e) => {
    if (gameState.gameStarted) {
        e.preventDefault();
    }
}, { passive: false });

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    gameState.connected = true;
});

socket.on('join_error', (data) => {
    showError(data.message);
});

socket.on('game_joined', (data) => {
    gameState.playerId = data.player_id;
    gameState.carColor = data.car_color;
    
    // Update UI
    elements.displayName.textContent = gameState.playerName;
    elements.displayRoom.textContent = gameState.roomCode;
    
    // Initialize car preview
    initCarPreview();
    
    // Show waiting screen
    showScreen('waiting');
});

socket.on('game_started', () => {
    gameState.gameStarted = true;
    
    // Initialize game controls
    initGameControls();
    
    // Show game screen
    showScreen('game');
    
    // Start game loop
    gameLoop();
});

socket.on('host_disconnected', () => {
    showError('Host disconnected. Please join a new game.');
    resetGame();
});

// Handle position reset from host
socket.on('position_reset', (data) => {
    if (gameState.gameStarted) {
        // Update position and rotation
        gameState.position = data.position;
        gameState.rotation = data.rotation;
        gameState.velocity = [0, 0, 0];
        gameState.speed = 0;
        
        // Update speed display
        elements.speedDisplay.textContent = "0 km/h";
    }
});

// Game functions
function joinGame() {
    const playerName = elements.playerNameInput.value.trim();
    const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
    
    if (!playerName) {
        showError('Please enter your name');
        return;
    }
    
    if (!roomCode) {
        showError('Please enter a room code');
        return;
    }
    
    if (!gameState.connected) {
        showError('Connecting to server...');
        return;
    }
    
    // Store values
    gameState.playerName = playerName;
    gameState.roomCode = roomCode;
    
    // Join game
    socket.emit('join_game', {
        player_name: playerName,
        room_code: roomCode
    });
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');
    
    // Hide error after 3 seconds
    setTimeout(() => {
        elements.errorMessage.classList.add('hidden');
    }, 3000);
}

function showScreen(screenName) {
    elements.joinScreen.classList.add('hidden');
    elements.waitingScreen.classList.add('hidden');
    elements.gameScreen.classList.add('hidden');
    
    switch (screenName) {
        case 'join':
            elements.joinScreen.classList.remove('hidden');
            break;
        case 'waiting':
            elements.waitingScreen.classList.remove('hidden');
            break;
        case 'game':
            elements.gameScreen.classList.remove('hidden');
            break;
    }
}

function resetGame() {
    // Reset game state
    gameState.playerName = '';
    gameState.roomCode = '';
    gameState.playerId = null;
    gameState.carColor = null;
    gameState.gameStarted = false;
    
    // Reset controls
    gameState.controls.steering = 0;
    gameState.controls.acceleration = 0;
    gameState.controls.braking = 0;
    
    // Reset inputs
    elements.playerNameInput.value = '';
    elements.roomCodeInput.value = '';
    
    // Show join screen
    showScreen('join');
}

function initCarPreview() {
    // Create a simple Three.js scene for car preview
    const previewScene = new THREE.Scene();
    const previewCamera = new THREE.PerspectiveCamera(75, 1.5, 0.1, 1000);
    const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    
    previewRenderer.setSize(elements.carPreview.clientWidth, elements.carPreview.clientHeight);
    previewRenderer.setClearColor(0x000000, 0);
    elements.carPreview.appendChild(previewRenderer.domElement);
    
    // Add light
    const light = new THREE.AmbientLight(0xffffff, 1);
    previewScene.add(light);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    previewScene.add(directionalLight);
    
    // Create car model
    const carGroup = createCarModel(gameState.carColor);
    previewScene.add(carGroup);
    
    // Position camera
    previewCamera.position.set(0, 3, 6);
    previewCamera.lookAt(carGroup.position);
    
    // Animation loop for preview
    function animatePreview() {
        if (!gameState.gameStarted) {
            requestAnimationFrame(animatePreview);
            carGroup.rotation.y += 0.01;
            previewRenderer.render(previewScene, previewCamera);
        }
    }
    
    animatePreview();
}

function createCarModel(color) {
    // Create a simple car model
    const carGroup = new THREE.Group();
    
    // Car body
    const bodyGeometry = new THREE.BoxGeometry(2, 1, 4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    carGroup.add(body);
    
    // Car roof
    const roofGeometry = new THREE.BoxGeometry(1.5, 0.7, 2);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = 1.35;
    roof.position.z = -0.2;
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
    
    return carGroup;
}

function initGameControls() {
    // Create new control layout with touch areas
    
    // Clear existing controls
    elements.controlsContainer.innerHTML = '';
    
    // Create left half (steering) and right half (pedals) areas
    const steeringArea = document.createElement('div');
    steeringArea.id = 'steering-area';
    steeringArea.className = 'control-area';
    
    const pedalsArea = document.createElement('div');
    pedalsArea.id = 'pedals-area';
    pedalsArea.className = 'control-area';
    
    // Add accelerate and brake buttons to pedals area
    const accelerateBtn = document.createElement('div');
    accelerateBtn.id = 'accelerate-btn';
    accelerateBtn.innerHTML = '↑';
    
    const brakeBtn = document.createElement('div');
    brakeBtn.id = 'brake-btn';
    brakeBtn.innerHTML = '↓';
    
    pedalsArea.appendChild(accelerateBtn);
    pedalsArea.appendChild(brakeBtn);
    
    // Add touch indicator to steering area
    const steeringIndicator = document.createElement('div');
    steeringIndicator.id = 'steering-indicator';
    steeringArea.appendChild(steeringIndicator);
    
    // Add areas to container
    elements.controlsContainer.appendChild(steeringArea);
    elements.controlsContainer.appendChild(pedalsArea);
    
    // Update element references
    elements.steeringArea = steeringArea;
    elements.pedalsArea = pedalsArea;
    elements.accelerateBtn = accelerateBtn;
    elements.brakeBtn = brakeBtn;
    elements.steeringIndicator = steeringIndicator;
    
    // Add touch event listeners for steering area
    steeringArea.addEventListener('touchstart', handleSteeringStart);
    steeringArea.addEventListener('touchmove', handleSteeringMove);
    steeringArea.addEventListener('touchend', handleSteeringEnd);
    steeringArea.addEventListener('touchcancel', handleSteeringEnd);
    
    // Add touch event listeners for pedals
    accelerateBtn.addEventListener('touchstart', () => setAcceleration(1));
    accelerateBtn.addEventListener('touchend', () => setAcceleration(0));
    accelerateBtn.addEventListener('touchcancel', () => setAcceleration(0));
    
    brakeBtn.addEventListener('touchstart', () => setBraking(1));
    brakeBtn.addEventListener('touchend', () => setBraking(0));
    brakeBtn.addEventListener('touchcancel', () => setBraking(0));
    
    // Also support keyboard controls for testing
    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'ArrowLeft':
                setSteering(-1);
                break;
            case 'ArrowRight':
                setSteering(1);
                break;
            case 'ArrowUp':
                setAcceleration(1);
                break;
            case 'ArrowDown':
                setBraking(1);
                break;
        }
    });
    
    document.addEventListener('keyup', (e) => {
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowRight':
                setSteering(0);
                break;
            case 'ArrowUp':
                setAcceleration(0);
                break;
            case 'ArrowDown':
                setBraking(0);
                break;
        }
    });
}

function handleSteeringStart(e) {
    if (e.touches.length > 0) {
        const touch = e.touches[0];
        const rect = elements.steeringArea.getBoundingClientRect();
        
        gameState.touchControls.steeringActive = true;
        gameState.touchControls.steeringStartX = touch.clientX;
        gameState.touchControls.steeringCurrentX = touch.clientX;
        
        // Position the indicator where the touch started
        elements.steeringIndicator.style.left = `${touch.clientX - rect.left}px`;
        elements.steeringIndicator.style.top = `${touch.clientY - rect.top}px`;
        elements.steeringIndicator.classList.add('active');
        
        // Initial steering value
        updateSteeringFromTouch();
    }
}

function handleSteeringMove(e) {
    if (gameState.touchControls.steeringActive && e.touches.length > 0) {
        const touch = e.touches[0];
        const rect = elements.steeringArea.getBoundingClientRect();
        
        gameState.touchControls.steeringCurrentX = touch.clientX;
        
        // Update the position of the indicator with vertical position from touch
        elements.steeringIndicator.style.left = `${touch.clientX - rect.left}px`;
        elements.steeringIndicator.style.top = `${touch.clientY - rect.top}px`;
        
        updateSteeringFromTouch();
    }
}

function handleSteeringEnd() {
    if (gameState.touchControls.steeringActive) {
        gameState.touchControls.steeringActive = false;
        elements.steeringIndicator.classList.remove('active');
        setSteering(0);
    }
}

function updateSteeringFromTouch() {
    if (!gameState.touchControls.steeringActive) return;
    
    const steeringWidth = elements.steeringArea.clientWidth;
    const deltaX = gameState.touchControls.steeringCurrentX - gameState.touchControls.steeringStartX;
    
    // Map the horizontal movement to steering (-1 to 1)
    // Use a sensitivity factor to determine how much movement is needed for full lock
    const sensitivity = 0.5; // Adjust as needed
    const maxDelta = steeringWidth * sensitivity;
    
    // Calculate steering value
    let steeringValue = deltaX / maxDelta;
    steeringValue = Math.max(-1, Math.min(1, steeringValue)); // Clamp between -1 and 1
    
    setSteering(steeringValue);
}

function setSteering(value) {
    gameState.controls.steering = value;
}

function setAcceleration(value) {
    gameState.controls.acceleration = value;
}

function setBraking(value) {
    gameState.controls.braking = value;
}

function updatePhysics() {
    // Improved car physics simulation
    const maxSpeed = 3.0;
    const acceleration = 0.04;
    const deceleration = 0.015;
    const brakeForce = 0.07;
    const turnSpeed = 0.03;
    
    // Calculate current forward direction based on rotation
    const forwardX = Math.sin(gameState.rotation[1]);
    const forwardZ = Math.cos(gameState.rotation[1]);
    
    // Update speed based on acceleration/braking
    if (gameState.controls.acceleration > 0) {
        const accelerationFactor = 1 - (gameState.speed / maxSpeed) * 0.5;
        gameState.speed += acceleration * gameState.controls.acceleration * accelerationFactor;
    } else if (gameState.controls.braking > 0) {
        const brakeEffectiveness = 1 + Math.abs(gameState.speed);
        gameState.speed -= brakeForce * gameState.controls.braking * brakeEffectiveness;
    } else {
        if (Math.abs(gameState.speed) < deceleration) {
            gameState.speed = 0;
        } else if (gameState.speed > 0) {
            const resistanceFactor = 1 + (gameState.speed / maxSpeed) * 0.5;
            gameState.speed -= deceleration * resistanceFactor;
        } else if (gameState.speed < 0) {
            const resistanceFactor = 1 + (Math.abs(gameState.speed) / maxSpeed) * 0.5;
            gameState.speed += deceleration * resistanceFactor;
        }
    }
    
    // Clamp speed
    gameState.speed = Math.max(-maxSpeed/2, Math.min(maxSpeed, gameState.speed));
    
    // Fix steering direction - IMPORTANT: We ADD to rotation for right turns (positive steering)
    if (Math.abs(gameState.speed) > 0.01) {
        // Turn rate depends on speed - sharper at lower speeds
        const speedAdjustedTurnRate = turnSpeed * (1 + (1 - Math.min(Math.abs(gameState.speed), maxSpeed) / maxSpeed));
        
        // FIX: ADDING instead of subtracting, so positive steering (right) increases angle (turns right)
        // Note that we maintain the speed direction factor to allow proper reverse steering
        gameState.rotation[1] += speedAdjustedTurnRate * gameState.controls.steering * Math.sign(gameState.speed);
    }
    
    // Normalize rotation angle
    gameState.rotation[1] = gameState.rotation[1] % (Math.PI * 2);
    if (gameState.rotation[1] < 0) gameState.rotation[1] += Math.PI * 2;
    
    // Update position based on current forward direction
    gameState.position[0] += forwardX * gameState.speed;
    gameState.position[2] -= forwardZ * gameState.speed;
    
    // Ensure car stays on the ground
    gameState.position[1] = 0.5;
    
    // Update velocity vector based on current direction and speed
    gameState.velocity = [
        forwardX * gameState.speed,
        0,
        -forwardZ * gameState.speed
    ];
    
    // Calculate actual movement direction
    if (Math.abs(gameState.speed) > 0.01) {
        // Use actual velocity direction for car rotation (make car face direction of travel)
        const velocityMagnitude = Math.sqrt(
            gameState.velocity[0] * gameState.velocity[0] + 
            gameState.velocity[2] * gameState.velocity[2]
        );
        
        if (velocityMagnitude > 0.01) {
            // Calculate target rotation based on velocity direction
            const targetRotation = Math.atan2(gameState.velocity[0], -gameState.velocity[2]);
            
            // Smoothly interpolate current rotation towards target rotation
            const rotationLerp = 0.2; // Adjust for more/less drift
            
            let rotDiff = targetRotation - gameState.rotation[1];
            
            // Handle wrap-around for angles
            if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            
            // Apply the lerped rotation
            gameState.rotation[1] += rotDiff * rotationLerp;
            
            // Normalize rotation again after changes
            gameState.rotation[1] = gameState.rotation[1] % (Math.PI * 2);
            if (gameState.rotation[1] < 0) gameState.rotation[1] += Math.PI * 2;
        }
    }
    
    // Update speed display (convert to km/h for display)
    const speedKmh = Math.abs(Math.round(gameState.speed * 200));
    elements.speedDisplay.textContent = `${speedKmh} km/h`;
    
    // Ensure position updates are being sent regularly
    sendPositionUpdate();
}

function sendPositionUpdate() {
    if (gameState.gameStarted) {
        socket.emit('player_update', {
            room_code: gameState.roomCode,
            position: gameState.position,
            rotation: gameState.rotation,
            velocity: gameState.velocity
        });
    }
}

// Game loop using setTimeout for consistent 60 FPS
function gameLoop() {
    if (!gameState.gameStarted) return;
    
    // Update physics
    updatePhysics();
    
    // Continue the game loop
    setTimeout(gameLoop, 1000 / 60); // 60 FPS update rate
} 