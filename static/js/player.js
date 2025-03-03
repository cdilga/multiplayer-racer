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
    },
    lastSpeed: 0,
    lastUpdateTime: 0,
    nameSet: false, // Flag to track if user has set a custom name
    autoJoinDelayMs: 2000 // Delay before auto-joining to give time to set name
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
const DEFAULT_ROOM_CODE = 'TEST';

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
            
            // Set up auto-join timer
            let secondsLeft = Math.floor(gameState.autoJoinDelayMs / 1000);
            elements.joinTimerDisplay.textContent = `Joining in ${secondsLeft} seconds... (click to cancel)`;
            elements.joinTimerDisplay.style.display = 'block';
            
            // Allow clicking the timer to cancel auto-join
            elements.joinTimerDisplay.addEventListener('click', () => {
                clearInterval(joinTimerInterval);
                clearTimeout(joinTimer);
                elements.joinTimerDisplay.textContent = 'Auto-join cancelled';
                setTimeout(() => {
                    elements.joinTimerDisplay.style.display = 'none';
                }, 1500);
            });
            
            // Update countdown every second
            const joinTimerInterval = setInterval(() => {
                secondsLeft--;
                if (secondsLeft <= 0) {
                    clearInterval(joinTimerInterval);
                    elements.joinTimerDisplay.textContent = 'Joining game...';
                } else {
                    elements.joinTimerDisplay.textContent = `Joining in ${secondsLeft} seconds... (click to cancel)`;
                }
            }, 1000);
            
            // Set up auto-join timer
            const joinTimer = setTimeout(() => {
                joinGame();
            }, gameState.autoJoinDelayMs);
        }
    }
    
    // In dev mode, auto-fill form and auto-join
    if (DEV_MODE) {
        if (!elements.roomCodeInput.value) {
            elements.roomCodeInput.value = DEFAULT_ROOM_CODE;
        }
        setTimeout(() => {
            joinGame();
        }, 500); // Short delay to ensure connection is ready
    }
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
        console.log('Position reset received:', data);
        
        // Update position and rotation
        gameState.position = [...data.position]; // Make a copy to ensure it's a new array
        gameState.rotation = [...data.rotation];
        gameState.velocity = [0, 0, 0];
        gameState.speed = 0;
        
        // Ensure car stays on the ground
        gameState.position[1] = 0.5;
        
        // Update speed display
        elements.speedDisplay.textContent = "0 km/h";
        
        // Force an immediate position update to the server
        sendPositionUpdate();
    }
});

// Add socket event handler for name update confirmation
socket.on('name_updated', (data) => {
    if (data.success) {
        gameState.playerName = data.name;
        elements.displayName.textContent = data.name;
        console.log(`Name updated to: ${data.name}`);
    }
});

// Add socket event handler for errors
socket.on('error', (data) => {
    showError(data.message);
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
    
    // Join game
    socket.emit('join_game', {
        player_name: playerName,
        room_code: roomCode
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
    // Improved car physics simulation with better direction handling
    const maxSpeed = 3.0;
    const acceleration = 0.04;
    const deceleration = 0.015;
    const brakeForce = 0.07;
    const turnSpeed = 0.05;
    
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
    
    // Apply steering to yaw (y-axis rotation) 
    if (Math.abs(gameState.speed) > 0.01) {
        // Turn rate depends on speed - sharper at lower speeds
        const speedAdjustedTurnRate = turnSpeed * (1 + (1 - Math.min(Math.abs(gameState.speed), maxSpeed) / maxSpeed));
        
        // Update rotation - positive steering turns right
        gameState.rotation[1] += speedAdjustedTurnRate * gameState.controls.steering * Math.sign(gameState.speed);
        
        // Normalize rotation angle
        gameState.rotation[1] = gameState.rotation[1] % (Math.PI * 2);
        if (gameState.rotation[1] < 0) gameState.rotation[1] += Math.PI * 2;
    }
    
    // Calculate forward direction vector from rotation
    const forwardX = Math.sin(gameState.rotation[1]); 
    const forwardZ = Math.cos(gameState.rotation[1]);
    
    // Update position based on current rotation and speed
    gameState.position[0] += forwardX * gameState.speed;
    gameState.position[2] -= forwardZ * gameState.speed;
    
    // Ensure car stays on the ground
    gameState.position[1] = 0.5;
    
    // Update velocity vector for server reporting
    gameState.velocity = [
        forwardX * gameState.speed,
        0,
        -forwardZ * gameState.speed
    ];
    
    // Update speed display (convert to km/h for display)
    const speedKmh = Math.abs(Math.round(gameState.speed * 200));
    elements.speedDisplay.textContent = `${speedKmh} km/h`;
}

function sendPositionUpdate() {
    if (gameState.gameStarted) {
        // Only send updates if we're moving or just stopped
        const isMoving = Math.abs(gameState.speed) > 0.01;
        const justStopped = gameState.lastSpeed > 0.01 && Math.abs(gameState.speed) <= 0.01;
        
        // Store current speed for next comparison
        gameState.lastSpeed = Math.abs(gameState.speed);
        
        // Limit update frequency based on speed
        const currentTime = Date.now();
        const timeSinceLastUpdate = currentTime - (gameState.lastUpdateTime || 0);
        
        // Send less frequent updates when stationary, more frequent when moving fast
        const updateInterval = isMoving ? 
            Math.max(50, 100 - Math.abs(gameState.speed) * 30) : // 50-100ms when moving
            500; // 500ms when stationary
        
        if (isMoving || justStopped || timeSinceLastUpdate >= updateInterval) {
            socket.emit('player_update', {
                room_code: gameState.roomCode,
                position: gameState.position,
                rotation: gameState.rotation,
                velocity: gameState.velocity
            });
            
            gameState.lastUpdateTime = currentTime;
        }
    }
}

// Game loop using setTimeout for consistent 60 FPS
function gameLoop() {
    if (!gameState.gameStarted) return;
    
    // Update physics
    updatePhysics();
    
    // Send position updates to server as needed
    sendPositionUpdate();
    
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