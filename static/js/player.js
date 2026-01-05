// Player interface logic

// Constants for input handling
const INPUT_SEND_RATE = 60; // Hz
const INPUT_SEND_INTERVAL = 1000 / INPUT_SEND_RATE;
let lastInputUpdate = 0;

// Game state
const gameState = {
    playerName: '',
    roomCode: null,
    playerId: null,
    carColor: null,
    connected: false,
    gameStarted: false,
    controls: {
        steering: 0,       // -1 to 1 (left to right)
        acceleration: 0,   // 0 to 1
        braking: 0         // 0 to 1
    },
    speed: 0,
    touchControls: {
        steeringJoystick: null, // Joystick instance
        accelerateTouchId: null, // Touch ID for accelerator
        brakeTouchId: null // Touch ID for brake
    },
    lastSpeed: 0,
    lastUpdateTime: 0,
    nameSet: false, // Flag to track if user has set a custom name
    lastServerUpdate: 0,
    autoJoinDelayMs: 0 // Delay before auto-joining to give time to set name
};

// Helper function to get URL parameters
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

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
    controlsContainer: document.getElementById('controls-container'),
    generateNameBtn: document.getElementById('generate-name-btn'),
    autoJoinMessage: document.getElementById('auto-join-message'),
    detectedRoomCode: document.getElementById('detected-room-code'),
    joinTimerDisplay: document.createElement('div')
};

// Add the join timer display to the auto-join message
if (elements.autoJoinMessage) {
    elements.joinTimerDisplay.className = 'join-timer';
    elements.autoJoinMessage.appendChild(elements.joinTimerDisplay);
}

// Socket.io connection
const socket = io();

// Enable dev mode for faster testing - changed to false to give time to customize name
const DEV_MODE = false;

// Random name generator
function generateRandomName() {
    // Lists of adjectives and nouns for GitHub-style random names
    const adjectives = [
        'Admiring', 'Adoring', 'Affectionate', 'Agitated', 'Amazing', 'Angry', 'Awesome', 'Beautiful', 
        'Blissful', 'Bold', 'Brave', 'Busy', 'Charming', 'Clever', 'Cool', 'Compassionate', 'Competent', 
        'Confident', 'Crazy', 'Dazzling', 'Determined', 'Distracted', 'Dreamy', 'Eager', 'Ecstatic', 
        'Elastic', 'Elated', 'Elegant', 'Eloquent', 'Epic', 'Exciting', 'Fervent', 'Festive', 'Flamboyant', 
        'Focused', 'Friendly', 'Frosty', 'Funny', 'Gallant', 'Gifted', 'Goofy', 'Gracious', 'Great', 
        'Happy', 'Hardcore', 'Heuristic', 'Hopeful', 'Hungry', 'Infallible', 'Inspiring', 'Intelligent', 
        'Interesting', 'Jolly', 'Jovial', 'Keen', 'Kind', 'Laughing', 'Loving', 'Lucid', 'Magical', 
        'Mystifying', 'Modest', 'Musing', 'Naughty', 'Nervous', 'Nice', 'Nifty', 'Nimble', 'Nostalgic', 
        'Objective', 'Optimistic', 'Peaceful', 'Pedantic', 'Pensive', 'Practical', 'Priceless', 'Quirky', 
        'Quizzical', 'Recursing', 'Relaxed', 'Reverent', 'Romantic', 'Sad', 'Serene', 'Sharp', 'Silly', 
        'Sleepy', 'Stoic', 'Strange', 'Stupefied', 'Sweet', 'Tender', 'Thirsty', 'Trusting', 'Unruffled', 
        'Upbeat', 'Vibrant', 'Vigilant', 'Vigorous', 'Wizardly', 'Wonderful', 'Xenodochial', 'Youthful', 
        'Zealous', 'Zen'
    ];
    
    const nouns = [
        'Albattani', 'Allen', 'Almeida', 'Archimedes', 'Ardinghelli', 'Aryabhata', 'Austin', 'Babbage', 
        'Banach', 'Banzai', 'Bardeen', 'Bartik', 'Bassi', 'Beaver', 'Bell', 'Benz', 'Bhabha', 'Bhaskara', 
        'Black', 'Blackburn', 'Blackwell', 'Bohr', 'Booth', 'Borg', 'Bose', 'Bouman', 'Boyd', 'Brahmagupta', 
        'Brattain', 'Brown', 'Buck', 'Burnell', 'Cannon', 'Carson', 'Cartwright', 'Cerf', 'Chandrasekhar', 
        'Chaplygin', 'Chatelet', 'Chatterjee', 'Chebyshev', 'Cohen', 'Chaum', 'Clarke', 'Colden', 'Cori', 
        'Cray', 'Curie', 'Darwin', 'Davinci', 'Dewdney', 'Dhawan', 'Diffie', 'Dijkstra', 'Dirac', 'Driscoll', 
        'Driver', 'Dubinsky', 'Easley', 'Edison', 'Einstein', 'Elbakyan', 'Elgamal', 'Elion', 'Ellis', 
        'Engelbart', 'Euclid', 'Euler', 'Faraday', 'Feistel', 'Fermat', 'Fermi', 'Feynman', 'Franklin', 
        'Gagarin', 'Galileo', 'Galois', 'Ganguly', 'Gates', 'Gauss', 'Germain', 'Goldberg', 'Goldstine', 
        'Goldwasser', 'Golick', 'Goodall', 'Gould', 'Greider', 'Grothendieck', 'Haibt', 'Hamilton', 'Haslett', 
        'Hawking', 'Heisenberg', 'Hellman', 'Hermann', 'Herschel', 'Hertz', 'Heyrovsky', 'Hodgkin', 'Hofstadter', 
        'Hoover', 'Hopper', 'Hugle', 'Hypatia', 'Ishizaka', 'Jackson', 'Jang', 'Jennings', 'Jepsen', 'Johnson', 
        'Joliot', 'Jones', 'Kalam', 'Kapitsa', 'Kare', 'Keldysh', 'Keller', 'Kepler', 'Khayyam', 'Khorana', 
        'Kilby', 'Kirch', 'Knuth', 'Kowalevski', 'Lalande', 'Lamarr', 'Lamport', 'Leakey', 'Leavitt', 'Lederberg', 
        'Lehmann', 'Lewin', 'Lichterman', 'Liskov', 'Lovelace', 'Lumiere', 'Mahavira', 'Margulis', 'Matsumoto', 
        'Maxwell', 'Mayer', 'McCartney', 'McWilliams', 'Meitner', 'Meninsky', 'Merkle', 'Mestorf', 'Mirzakhani', 
        'Montalcini', 'Moore', 'Morse', 'Moser', 'Murdock', 'Neumann', 'Newton', 'Nightingale', 'Nobel', 'Noether', 
        'Northcutt', 'Noyce', 'Panini', 'Pare', 'Pascal', 'Pasteur', 'Payne', 'Perlman', 'Pike', 'Poincare', 
        'Poitras', 'Proskuriakova', 'Ptolemy', 'Raman', 'Ramanujan', 'Ride', 'Ritchie', 'Robinson', 'Roentgen', 
        'Rosalind', 'Rubin', 'Saha', 'Sammet', 'Sanderson', 'Satoshi', 'Shamir', 'Shannon', 'Shaw', 'Shirley', 
        'Shockley', 'Shtern', 'Sinoussi', 'Snyder', 'Spence', 'Stallman', 'Stonebraker', 'Sutherland', 'Swanson', 
        'Swartz', 'Swirles', 'Taussig', 'Tesla', 'Tharp', 'Thompson', 'Torvalds', 'Tu', 'Turing', 'Varahamihira', 
        'Vaughan', 'Villani', 'Visvesvaraya', 'Volhard', 'Wescoff', 'Wilbur', 'Wiles', 'Williams', 'Williamson', 
        'Wilson', 'Wing', 'Wozniak', 'Wright', 'Wu', 'Yalow', 'Yonath', 'Zhukovsky'
    ];
    
    // Pick a random adjective and noun
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    // Combine them with a random number to ensure uniqueness
    return `${adjective}${noun}`;
}

// Event listeners
elements.joinButton.addEventListener('click', joinGame);
elements.accelerateBtn.addEventListener('touchstart', () => setAcceleration(1));
elements.accelerateBtn.addEventListener('touchend', () => setAcceleration(0));
elements.brakeBtn.addEventListener('touchstart', () => setBraking(1));
elements.brakeBtn.addEventListener('touchend', () => setBraking(0));

// Add input event listener to player name input to track when user sets a custom name
elements.playerNameInput.addEventListener('input', function() {
    if (this.value.trim() !== '') {
        gameState.nameSet = true;
    }
});

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
    
    // Initialize error logging if not already initialized
    if (!errorLog.container) {
        errorLog.init();
        console.log('Error log initialized on connect');
    }
    
    // Check for room code in URL parameters or window.roomCode (from template)
    let roomCode = getUrlParameter('room');
    
    // If no room code in URL, check if it was passed via template
    if (!roomCode && window.roomCode && window.roomCode !== "{{ room_code }}") {
        roomCode = window.roomCode;
    }
    
    if (roomCode) {
        // Set room code input value
        elements.roomCodeInput.value = roomCode;
        
        // Show message that room code was detected
        if (elements.autoJoinMessage && elements.detectedRoomCode) {
            elements.detectedRoomCode.textContent = roomCode;
            elements.autoJoinMessage.style.display = 'block';
            
            // Generate a random name if the user hasn't set one
            if (!gameState.nameSet && !elements.playerNameInput.value.trim()) {
                elements.playerNameInput.value = generateRandomName();
                // Don't set nameSet flag here to allow user to change it
            }
            
            joinGame();
        }
    }

});

socket.on('join_error', (data) => {
    showError(data.message);
});

socket.on('game_joined', (data) => {
    gameState.playerId = data.player_id;
    gameState.carColor = data.car_color;

    // Store player ID for reconnection
    try {
        const reconnectKey = `racer_reconnect_${gameState.roomCode}`;
        localStorage.setItem(reconnectKey, JSON.stringify({
            player_id: data.player_id,
            player_name: gameState.playerName,
            room_code: gameState.roomCode
        }));
    } catch (e) {
        console.warn('Could not save reconnect data:', e);
    }

    // Handle reconnection - if game is already racing, skip to controller
    if (data.reconnected && data.game_state === 'racing') {
        console.log('Reconnected to racing game!');
        elements.waitingScreen.classList.add('hidden');
        elements.controllerScreen.classList.remove('hidden');
        showMessage('Reconnected! You are back in the race.');
        return;
    }

    // Update UI (with null checks for DOM elements)
    if (elements.displayName) {
        elements.displayName.textContent = gameState.playerName;
    }
    if (elements.displayRoom) {
        elements.displayRoom.textContent = gameState.roomCode;
    }
    
    // Initialize car preview
    initCarPreview();
    
    // Add a name change option in the waiting room
    const nameChangeContainer = document.createElement('div');
    nameChangeContainer.className = 'name-change-container';
    nameChangeContainer.innerHTML = `
        <p>Want to change your name?</p>
        <div class="name-change-input">
            <input type="text" id="waiting-name-input" value="${gameState.playerName}" maxlength="15">
            <button id="update-name-btn">Update</button>
        </div>
    `;
    
    // Add the name change container to the waiting screen
    const playerInfo = elements.waitingScreen.querySelector('.player-info');
    if (playerInfo) {
        playerInfo.appendChild(nameChangeContainer);
        
        // Add event listeners for name change
        const waitingNameInput = document.getElementById('waiting-name-input');
        const updateNameBtn = document.getElementById('update-name-btn');
        
        if (waitingNameInput && updateNameBtn) {
            updateNameBtn.addEventListener('click', () => {
                const newName = waitingNameInput.value.trim();
                if (newName && newName !== gameState.playerName) {
                    // Update name
                    updatePlayerName(newName);
                }
            });
            
            waitingNameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    updateNameBtn.click();
                }
            });
        }
    }
    
    // Show waiting screen
    showScreen('waiting');
});

socket.on('game_started', () => {
    gameState.gameStarted = true;
    
    // Initialize game controls
    initGameControls();
    
    // Show game screen
    showScreen('game');
    
    // Note: The game loop (updateLoop) is already running via requestAnimationFrame
});

socket.on('host_disconnected', () => {
    showError('Host disconnected. Please join a new game.');
    resetGame();
});

// Handle position reset from host
socket.on('position_reset', (data) => {
    if (gameState.gameStarted) {
        console.log('Position reset received:', data);

        // Update speed display
        if (elements.speedDisplay) {
            elements.speedDisplay.textContent = "0 km/h";
        }
    }
});

// Add socket event handler for name update confirmation
socket.on('name_updated', (data) => {
    if (data.success) {
        gameState.playerName = data.name;
        if (elements.displayName) {
            elements.displayName.textContent = data.name;
        }
        console.log(`Name updated to: ${data.name}`);
    }
});

// Add socket event handler for errors
socket.on('error', (data) => {
    showError(data.message);
});

socket.on('car_state_update', (data) => {
    if (data.player_id === socket.id) {
        // Update our state with authoritative server data
        gameState.position = data.position;
        gameState.rotation = data.rotation;
        gameState.velocity = data.velocity;
        gameState.lastServerUpdate = data.timestamp;
        
        // Update visual representation
        updateCarVisuals();
    }
});

// Game functions
function joinGame() {
    // Generate a random name if the field is empty
    if (!elements.playerNameInput.value.trim()) {
        elements.playerNameInput.value = generateRandomName();
    }
    
    const playerName = elements.playerNameInput.value.trim();
    const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
    
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
    gameState.nameSet = true; // Mark name as set when joining
    
    // Hide the auto-join timer if it's visible
    if (elements.joinTimerDisplay) {
        elements.joinTimerDisplay.style.display = 'none';
    }
    
    // Show a joining message
    showMessage('Joining game...', 1000);
    
    // Check for saved reconnection data
    let reconnectId = null;
    try {
        const reconnectKey = `racer_reconnect_${roomCode}`;
        const savedData = localStorage.getItem(reconnectKey);
        if (savedData) {
            const parsed = JSON.parse(savedData);
            if (parsed.room_code === roomCode) {
                reconnectId = parsed.player_id;
                console.log('Found reconnection data, attempting to rejoin as player', reconnectId);
            }
        }
    } catch (e) {
        console.warn('Could not read reconnect data:', e);
    }

    // Join game
    socket.emit('join_game', {
        player_name: playerName,
        room_code: roomCode,
        reconnect_id: reconnectId
    });
}

// Show a temporary message
function showMessage(message, duration = 3000) {
    // Create a message element if it doesn't exist
    if (!elements.messageDisplay) {
        elements.messageDisplay = document.createElement('div');
        elements.messageDisplay.className = 'message-display';
        document.body.appendChild(elements.messageDisplay);
    }
    
    // Show the message
    elements.messageDisplay.textContent = message;
    elements.messageDisplay.classList.add('visible');
    
    // Hide after duration
    setTimeout(() => {
        elements.messageDisplay.classList.remove('visible');
    }, duration);
}

function showError(message) {
    if (!elements.errorMessage) {
        console.error('Error display element not found:', message);
        return;
    }
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');

    // Hide error after 3 seconds
    setTimeout(() => {
        if (elements.errorMessage) {
            elements.errorMessage.classList.add('hidden');
        }
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
    gameState.roomCode = null;
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

    // Clear existing controls (with null check)
    if (!elements.controlsContainer) {
        console.error('Controls container not found');
        return;
    }
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

    // Add areas to container
    elements.controlsContainer.appendChild(steeringArea);
    elements.controlsContainer.appendChild(pedalsArea);

    // Update element references
    elements.steeringArea = steeringArea;
    elements.pedalsArea = pedalsArea;
    elements.accelerateBtn = accelerateBtn;
    elements.brakeBtn = brakeBtn;

    // Initialize joystick for steering (horizontal only)
    // Size is 2x larger for finer control on mobile
    if (typeof Joystick !== 'undefined') {
        gameState.touchControls.steeringJoystick = new Joystick({
            container: steeringArea,
            mode: 'horizontal',
            size: 200,
            maxDistance: 80,
            onMove: ({ x }) => setSteering(x),
            onEnd: () => setSteering(0)
        });
    } else {
        console.error('Joystick class not loaded');
    }

    // Add touch event listeners for pedals with proper touch ID tracking
    accelerateBtn.addEventListener('touchstart', handleAccelerateStart, { passive: false });
    accelerateBtn.addEventListener('touchend', handleAccelerateEnd, { passive: false });
    accelerateBtn.addEventListener('touchcancel', handleAccelerateEnd, { passive: false });

    brakeBtn.addEventListener('touchstart', handleBrakeStart, { passive: false });
    brakeBtn.addEventListener('touchend', handleBrakeEnd, { passive: false });
    brakeBtn.addEventListener('touchcancel', handleBrakeEnd, { passive: false });

    // Prevent context menu on long press (Android)
    [steeringArea, accelerateBtn, brakeBtn].forEach(el => {
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Global context menu prevention during game
    document.addEventListener('contextmenu', (e) => {
        if (gameState.gameStarted) {
            e.preventDefault();
        }
    });

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

// Touch handlers for accelerator with touch ID tracking
function handleAccelerateStart(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        if (gameState.touchControls.accelerateTouchId === null) {
            gameState.touchControls.accelerateTouchId = touch.identifier;
            setAcceleration(1);
            elements.accelerateBtn.style.backgroundColor = '#3a9fc0';
            break;
        }
    }
}

function handleAccelerateEnd(e) {
    for (const touch of e.changedTouches) {
        if (touch.identifier === gameState.touchControls.accelerateTouchId) {
            gameState.touchControls.accelerateTouchId = null;
            setAcceleration(0);
            elements.accelerateBtn.style.backgroundColor = '#4cc9f0';
            break;
        }
    }
}

// Touch handlers for brake with touch ID tracking
function handleBrakeStart(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        if (gameState.touchControls.brakeTouchId === null) {
            gameState.touchControls.brakeTouchId = touch.identifier;
            setBraking(1);
            elements.brakeBtn.style.backgroundColor = '#d61d6d';
            break;
        }
    }
}

function handleBrakeEnd(e) {
    for (const touch of e.changedTouches) {
        if (touch.identifier === gameState.touchControls.brakeTouchId) {
            gameState.touchControls.brakeTouchId = null;
            setBraking(0);
            elements.brakeBtn.style.backgroundColor = '#f72585';
            break;
        }
    }
}

// Old steering functions removed - now using Joystick class

function setSteering(value) {
    gameState.controls.steering = value;
}

function setAcceleration(value) {
    gameState.controls.acceleration = value;
}

function setBraking(value) {
    gameState.controls.braking = value;
}

function sendControls() {

    var to_send = {
        room_code: gameState.roomCode,
        controls: {acceleration: gameState.controls.acceleration,
        braking: gameState.controls.braking,
        steering: gameState.controls.steering},
        player_id: gameState.playerId,
        timestamp: Date.now()
    }
    console.log('Sending controls:', to_send);
    socket.emit('player_controls_update', {
        to_send
    });
}

// Game loop using setTimeout for consistent 60 FPS
function gameLoop() {
    if (!gameState.gameStarted) return;
    
    // Send control updates to server as needed
    sendControls();
    
    // Continue the game loop
    setTimeout(gameLoop, 1000 / 60); // 60 FPS update rate
}

// Update player name function
function updatePlayerName(name) {
    if (!name || !name.trim() || !gameState.connected) return;
    
    const newName = name.trim();
    
    // Only update if different from current name
    if (newName !== gameState.playerName) {
        socket.emit('update_player_name', { name: newName });
        gameState.nameSet = true;
    }
}

// Input handling
function handleInput() {
    const currentTime = performance.now();
    const elapsed = currentTime - lastInputUpdate;
    
    if (elapsed >= INPUT_SEND_INTERVAL) {
        // Get current control states
        const controls = {
            steering: gameState.controls.steering,
            acceleration: gameState.controls.acceleration,
            braking: gameState.controls.braking
        };
    
        const player_control_update = {
            player_id: gameState.playerId,
            room_code: gameState.roomCode,
            controls: controls,
            timestamp: Date.now()
        };
        
        // Send control update to server
        socket.emit('player_control_update', player_control_update);

        // Add a helper method to errorLog to log info messages (different color)
        if (!errorLog.info) {
            errorLog.info = function(message, timeout = 1000) {
                // Create info element (similar to error but different color)
                const infoElement = document.createElement('div');
                infoElement.className = 'info-log-item';
                infoElement.style.backgroundColor = 'rgba(0, 100, 0, 0.7)'; // Dark green
                infoElement.style.color = 'white';
                infoElement.style.padding = '5px 8px';
                infoElement.style.marginBottom = '3px';
                infoElement.style.borderRadius = '4px';
                infoElement.style.fontFamily = 'monospace';
                infoElement.style.fontSize = '11px';
                infoElement.style.opacity = '0.7';
                infoElement.style.transition = 'opacity 0.3s';
                
                // Add timestamp
                const time = new Date().toLocaleTimeString();
                infoElement.textContent = `[${time}] ${message}`;
                
                // Make sure container exists
                if (!this.container) {
                    this.init();
                }
                
                // Add to container
                this.container.appendChild(infoElement);
                
                // Schedule removal
                setTimeout(() => {
                    infoElement.style.opacity = '0';
                    setTimeout(() => {
                        if (infoElement.parentNode) {
                            infoElement.parentNode.removeChild(infoElement);
                        }
                    }, 300);
                }, timeout);
            };
        }               
        lastInputUpdate = currentTime;
    }
}

// Create an on-screen error logger for mobile devices
const errorLog = {
    container: null,
    errors: [],
    maxErrors: 5,
    displayTime: 5000, // How long errors stay visible (5 seconds)
    
    // Initialize the error log container
    init: function() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'error-log-container';
            this.container.style.position = 'fixed';
            this.container.style.top = '10px';
            this.container.style.left = '10px';
            this.container.style.width = '80%';
            this.container.style.maxHeight = '30%';
            this.container.style.overflow = 'hidden';
            this.container.style.zIndex = '9999';
            this.container.style.pointerEvents = 'none'; // Touch passthrough
            document.body.appendChild(this.container);
        }
        
        // Override console.error to also log to our on-screen display
        const originalError = console.error;
        console.error = (...args) => {
            // Call the original console.error
            originalError.apply(console, args);
            
            // Also log to our on-screen display
            this.log(args.join(' '));
        };
        
        // Add a global error handler
        window.addEventListener('error', (event) => {
            this.log(`ERROR: ${event.message} at ${event.filename}:${event.lineno}`);
        });
        
        // Add handler for promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.log(`PROMISE ERROR: ${event.reason}`);
        });
    },
    
    // Log an error
    log: function(message) {
        // Create error element
        const errorElement = document.createElement('div');
        errorElement.className = 'error-log-item';
        errorElement.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
        errorElement.style.color = 'white';
        errorElement.style.padding = '8px 12px';
        errorElement.style.marginBottom = '5px';
        errorElement.style.borderRadius = '4px';
        errorElement.style.fontFamily = 'monospace';
        errorElement.style.fontSize = '12px';
        errorElement.style.wordBreak = 'break-word';
        errorElement.style.opacity = '0.9';
        errorElement.style.transition = 'opacity 0.3s';
        
        // Add timestamp
        const time = new Date().toLocaleTimeString();
        errorElement.innerHTML = `<strong>[${time}]</strong> ${message}`;
        
        // Add to container
        this.container.appendChild(errorElement);
        this.errors.push({
            element: errorElement,
            timestamp: Date.now()
        });
        
        // Schedule removal
        setTimeout(() => {
            errorElement.style.opacity = '0';
            setTimeout(() => {
                if (errorElement.parentNode) {
                    errorElement.parentNode.removeChild(errorElement);
                }
                // Remove from errors array
                const index = this.errors.findIndex(e => e.element === errorElement);
                if (index !== -1) {
                    this.errors.splice(index, 1);
                }
            }, 300);
        }, this.displayTime);
        
        // Limit number of errors
        if (this.errors.length > this.maxErrors) {
            const oldest = this.errors.shift();
            if (oldest.element.parentNode) {
                oldest.element.parentNode.removeChild(oldest.element);
            }
        }
    }
};

// Add visual indicator for controls and server-reported speed
function updateInputIndicator() {
    // If game hasn't started, we don't need to update anything
    if (!gameState.gameStarted) {
        return;
    }
    
    try {
        let inputIndicator = document.getElementById('input-indicator');
        if (!inputIndicator) {
            inputIndicator = document.createElement('div');
            inputIndicator.id = 'input-indicator';
            inputIndicator.style.position = 'absolute';
            inputIndicator.style.bottom = '10px';
            inputIndicator.style.left = '10px';
            inputIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            inputIndicator.style.color = 'white';
            inputIndicator.style.padding = '10px';
            inputIndicator.style.borderRadius = '5px';
            inputIndicator.style.fontFamily = 'monospace';
            inputIndicator.style.fontSize = '14px';
            inputIndicator.style.pointerEvents = 'none'; // Pass events through
            document.body.appendChild(inputIndicator);
        }
        
        // Get current control inputs
        const controls = gameState.controls;
        
        // Calculate speed magnitude from server-provided velocity
        let speedValue = 0;
        if (gameState.velocity && gameState.velocity.length >= 3) {
            speedValue = Math.sqrt(
                gameState.velocity[0] * gameState.velocity[0] + 
                gameState.velocity[2] * gameState.velocity[2]
            );
        }
        
        // Create visual indicators
        const steeringBar = createVisualBar(controls.steering, -1, 1, 50);
        const accelBar = createVisualBar(controls.acceleration, 0, 1, 50);
        const brakeBar = createVisualBar(controls.braking, 0, 1, 50);
        
        // Display current inputs and server-reported speed with visual bars
        inputIndicator.innerHTML = `
            <div style="margin-bottom: 8px; text-align: center; font-weight: bold;">Controller Input</div>
            <div>Steering: ${steeringBar} ${controls.steering.toFixed(2)}</div>
            <div>Accelerate: ${accelBar} ${controls.acceleration.toFixed(2)}</div>
            <div>Brake: ${brakeBar} ${controls.braking.toFixed(2)}</div>
            <div style="margin-top: 5px; border-top: 1px solid #aaa; padding-top: 5px;">
                Server Speed: ${speedValue.toFixed(2)} units/s
            </div>
        `;
    } catch (error) {
        console.error(`Error updating input indicator: ${error.message}`);
    }
}

// Helper function to create visual bars for control values
function createVisualBar(value, min, max, width) {
    const isSymmetric = min < 0 && max > 0;
    
    if (isSymmetric) {
        // For steering: center-based bar (-1 to 1)
        const centerPos = width / 2;
        const maxBarWidth = width / 2;
        const barWidth = Math.abs(value) * maxBarWidth;
        const leftPos = value < 0 ? centerPos - barWidth : centerPos;
        const color = value < 0 ? '#f44336' : '#4CAF50';
        
        return `<div style="display:inline-block; width:${width}px; height:10px; background:#333; position:relative; margin:0 5px; vertical-align:middle;">
            <div style="position:absolute; left:${centerPos}px; height:10px; width:1px; background:#fff;"></div>
            <div style="position:absolute; left:${leftPos}px; width:${barWidth}px; height:10px; background:${color};"></div>
        </div>`;
    } else {
        // For acceleration/braking: single bar (0 to 1)
        const barWidth = Math.max(0, Math.min(1, (value - min) / (max - min))) * width;
        
        return `<div style="display:inline-block; width:${width}px; height:10px; background:#333; margin:0 5px; vertical-align:middle;">
            <div style="width:${barWidth}px; height:10px; background:#4CAF50;"></div>
        </div>`;
    }
}

// Initialize the error log as soon as possible
document.addEventListener('DOMContentLoaded', () => {
    errorLog.init();
    console.log('Error log initialized for mobile debugging');
});

// Main game loop for updating UI based on server data and sending controls
function updateLoop() {
    if (gameState.gameStarted) {
        // Handle input and send to server
        handleInput();
        
        // Update visual indicators for input status
        updateInputIndicator();
    }
    
    // Continue the loop
    requestAnimationFrame(updateLoop);
}

// Start update loop
requestAnimationFrame(updateLoop);

// Input event listeners
document.addEventListener('keydown', (event) => {
    switch(event.key) {
        case 'ArrowUp':
            gameState.controls.acceleration = 1;
            break;
        case 'ArrowDown':
            gameState.controls.braking = 1;
            break;
        case 'ArrowLeft':
            gameState.controls.steering = -1;
            break;
        case 'ArrowRight':
            gameState.controls.steering = 1;
            break;
    }
});

document.addEventListener('keyup', (event) => {
    switch(event.key) {
        case 'ArrowUp':
            gameState.controls.acceleration = 0;
            break;
        case 'ArrowDown':
            gameState.controls.braking = 0;
            break;
        case 'ArrowLeft':
        case 'ArrowRight':
            gameState.controls.steering = 0;
            break;
    }
});

// Room joining function
function joinRoom(roomCode) {
    if (gameState.connected) {
        gameState.roomCode = roomCode;
        socket.emit('join_room', {
            room_code: roomCode,
            name: 'Player ' + socket.id.substr(0, 4),
            car_color: '#' + Math.floor(Math.random()*16777215).toString(16)
        });
    }
} 