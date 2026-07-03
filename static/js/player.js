// Player interface logic

// Constants for input handling
const INPUT_SEND_RATE = 60; // Hz
const INPUT_SEND_INTERVAL = 1000 / INPUT_SEND_RATE;
let lastInputUpdate = 0;
let lastControlFrameTime = null;
let lastInputTimestamp = 0;
let lastInputStallTelemetryAt = 0;
let hasEmittedJoinStartedTelemetry = false;
let hasEmittedFirstInputTelemetry = false;
let hasConnectedControllerTelemetry = false;
let hasJoinFailedTelemetry = false;
const playerControllerTelemetryState = new Map();
const PLAYER_CONTROLLER_TELEMETRY_COOLDOWN_MS = {
    reconnect_attempted: 1500,
    reconnect_succeeded: 3000,
    reconnect_failed: 2500,
    connected: 1000,
    disconnected: 1000,
    visibility_change: 1000,
    controller_fallback: 1200,
};
const ControlMapperClass = typeof window.ControlMapper === 'function'
    ? window.ControlMapper
    : null;
const RemapStoreClass = typeof window.RemapStore === 'function'
    ? window.RemapStore
    : null;
const remapStore = RemapStoreClass ? new RemapStoreClass() : null;
const REMAP_SOURCE_IDS = Object.freeze({
    touch: 'primary',
    keyboard: 'primary',
    gamepadFallback: 'standard'
});
const ROOM_SEAT_STORAGE_PREFIX = 'racer_seat_';
const LEGACY_RECONNECT_PREFIX = 'racer_reconnect_';
const CLIENT_INSTANCE_STORAGE_KEY = 'racer_client_instance_id';
const SEAT_HEARTBEAT_INTERVAL_MS = 4000;
const ACTIVE_ROOM_PHASES = new Set(['countdown', 'active', 'finish_grace', 'round_end']);
const KEYBOARD_ACTIONS = Array.isArray(ControlMapperClass?.KEYBOARD_ACTIONS)
    ? ControlMapperClass.KEYBOARD_ACTIONS
    : ['steerLeft', 'steerRight', 'accelerate', 'brake', 'fire'];
const CONTROL_KEY_CODES = new Set(ControlMapperClass?.KEYBOARD_REGION_PRESETS
    ? Object.values(ControlMapperClass.KEYBOARD_REGION_PRESETS)
        .flatMap((preset) => Object.values(preset.bindings || {}))
        .flatMap((codes) => Array.isArray(codes) ? codes : [])
    : [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'Space'
    ]);

function getStoredRemapSource(kind, sourceId) {
    if (!remapStore) {
        return null;
    }

    try {
        return remapStore.getSource(kind, sourceId);
    } catch (e) {
        return null;
    }
}

function buildInitialControlMapperOptions() {
    const touch = getStoredRemapSource('touch', REMAP_SOURCE_IDS.touch);
    const keyboard = getStoredRemapSource('keyboard', REMAP_SOURCE_IDS.keyboard);
    const gamepad = getStoredRemapSource('gamepad', REMAP_SOURCE_IDS.gamepadFallback);

    return {
        touchSchemeId: touch?.schemeId,
        keyboardSchemeId: keyboard?.schemeId,
        keyboardBindings: keyboard?.bindings,
        gamepadSchemeId: gamepad?.schemeId,
        gamepadBindings: gamepad?.bindings,
        gamepadSourceId: gamepad?.sourceId || REMAP_SOURCE_IDS.gamepadFallback
    };
}

const controlMapper = ControlMapperClass
    ? new ControlMapperClass(buildInitialControlMapperOptions())
    : null;
const keyboardPressedCodes = new Set();
let keyboardControlsBound = false;
let gamepadControlsBound = false;
let activeGamepadIndex = null;
let activeGamepadId = REMAP_SOURCE_IDS.gamepadFallback;
const remapUiState = {
    active: false,
    capturingKeyboardAction: null,
    lastLauncher: null
};

// Game state - exposed on window for testing
const gameState = window.gameState = {
    playerName: '',
    roomCode: null,
    playerId: null,
    seatId: null,
    seatToken: null,
    leaseVersion: null,
    clientInstanceId: null,
    roomPhase: 'waiting',
    role: null,
    carColor: null,
    connected: false,
    gameStarted: false,
    gameMode: 'race', // 'race' or 'derby'
    controls: {
        steering: 0,       // -1 to 1 (left to right)
        acceleration: 0,   // 0 to 1
        braking: 0         // 0 to 1
    },
    speed: 0,
    health: 100,
    boostActive: false,
    wheelieActive: false,
    landingBoostActive: false,
    badLandingActive: false,
    stuntState: 'idle',
    stuntCharge: 0,
    wasBoosting: false,
    wasWheelieActive: false,
    wasLandingBoostActive: false,
    wasBadLandingActive: false,
    touchControls: {
        steeringJoystick: null, // Joystick instance
        accelerateTouchId: null, // Touch ID for accelerator
        brakeTouchId: null, // Touch ID for brake
        fireTouchId: null // Touch ID for fire button (derby mode)
    },
    weapon: null, // Current weapon { id, name, icon }
    lastSpeed: 0,
    lastUpdateTime: 0,
    nameSet: false, // Flag to track if user has set a custom name
    lastServerUpdate: 0,
    autoJoinDelayMs: 0 // Delay before auto-joining to give time to set name
};

let fallbackClientInstanceId = null;

function getLocalStorageHandle() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch (e) {}
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage;
        }
    } catch (e) {}
    return null;
}

function getSessionStorageHandle() {
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
            return window.sessionStorage;
        }
    } catch (e) {}
    try {
        if (typeof sessionStorage !== 'undefined') {
            return sessionStorage;
        }
    } catch (e) {}
    return null;
}

function generateClientInstanceId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `ci-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientInstanceId() {
    if (gameState.clientInstanceId) {
        return gameState.clientInstanceId;
    }

    const sessionStore = getSessionStorageHandle();
    try {
        const existing = sessionStore?.getItem(CLIENT_INSTANCE_STORAGE_KEY);
        if (existing) {
            gameState.clientInstanceId = existing;
            return existing;
        }
    } catch (e) {}

    const nextId = fallbackClientInstanceId || generateClientInstanceId();
    fallbackClientInstanceId = nextId;
    gameState.clientInstanceId = nextId;
    try {
        sessionStore?.setItem(CLIENT_INSTANCE_STORAGE_KEY, nextId);
    } catch (e) {}
    return nextId;
}

function roomSeatStorageKey(roomCode) {
    return `${ROOM_SEAT_STORAGE_PREFIX}${roomCode}`;
}

function legacyReconnectKey(roomCode) {
    return `${LEGACY_RECONNECT_PREFIX}${roomCode}`;
}

function parseStoredJson(rawValue) {
    if (!rawValue) return null;
    try {
        return JSON.parse(rawValue);
    } catch (e) {
        return null;
    }
}

function readStoredSeatRecord(roomCode) {
    if (!roomCode) {
        return null;
    }

    const localStore = getLocalStorageHandle();
    const sessionStore = getSessionStorageHandle();
    const storedSeat = parseStoredJson(localStore?.getItem(roomSeatStorageKey(roomCode)));
    if (storedSeat?.room_code === roomCode) {
        return storedSeat;
    }

    const legacySeat = parseStoredJson(sessionStore?.getItem(legacyReconnectKey(roomCode)));
    if (legacySeat?.room_code === roomCode) {
        return legacySeat;
    }

    return null;
}

function writeStoredSeatRecord(record) {
    if (!record?.room_code) {
        return;
    }

    const normalized = {
        room_code: record.room_code,
        player_id: record.player_id ?? null,
        seat_id: record.seat_id ?? null,
        seat_token: record.seat_token ?? null,
        lease_version: record.lease_version ?? null,
        client_instance_id: record.client_instance_id ?? getClientInstanceId(),
        player_name: record.player_name ?? gameState.playerName ?? '',
        last_joined_at: Date.now()
    };

    const localStore = getLocalStorageHandle();
    const sessionStore = getSessionStorageHandle();
    const serialized = JSON.stringify(normalized);
    try {
        localStore?.setItem(roomSeatStorageKey(record.room_code), serialized);
    } catch (e) {
        console.warn('Could not save seat token data:', e);
    }
    try {
        sessionStore?.setItem(legacyReconnectKey(record.room_code), serialized);
    } catch (e) {
        console.warn('Could not save reconnect data:', e);
    }
}

function clearStoredSeatRecord(roomCode) {
    if (!roomCode) {
        return;
    }

    const localStore = getLocalStorageHandle();
    const sessionStore = getSessionStorageHandle();
    try {
        localStore?.removeItem(roomSeatStorageKey(roomCode));
    } catch (e) {}
    try {
        sessionStore?.removeItem(legacyReconnectKey(roomCode));
    } catch (e) {}
}

function phaseFromGameState(gameStateValue) {
    return gameStateValue === 'racing' ? 'active' : 'waiting';
}

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
    joinControlsBtn: document.getElementById('join-controls-btn'),
    controlSummaryJoin: document.getElementById('control-remap-summary-join'),
    controlSummaryMenu: document.getElementById('control-remap-summary-menu'),
    playerMenuControlsBtn: document.getElementById('player-menu-controls'),
    remapModal: document.getElementById('control-remap-modal'),
    remapStatus: document.getElementById('control-remap-status'),
    remapCloseBtn: document.getElementById('control-remap-close'),
    remapResetBtn: document.getElementById('control-remap-reset'),
    gamepadMappingNotice: document.getElementById('control-remap-gamepad-notice'),
    joinTimerDisplay: document.createElement('div')
};

// Add the join timer display to the auto-join message
if (elements.autoJoinMessage) {
    elements.joinTimerDisplay.className = 'join-timer';
    elements.autoJoinMessage.appendChild(elements.joinTimerDisplay);
}

// ---------------------------------------------------------------------------
// woq.11 Slice 2: join-route integration. Derive the entry decision from
// EXPLICIT typed route state (via / intent / pair / reconnect), never from
// user-agent sniffing, via the validated pure resolver (exposed on window by
// src/player/main.js). Drives the chooser, the role badge, and the renderer
// guard. A Local phone is controllers/HUD-only: it NEVER starts a world
// renderer, so __worldRendererStarted stays false.
// ---------------------------------------------------------------------------
window.__worldRendererStarted = false; // renderer guard: phones never render the world

function readJoinEntryFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    let room = params.get('room') || '';
    const pathMatch = (window.location.pathname || '').match(/^\/join\/([^\/?#]+)/);
    if (!room && pathMatch) {
        try { room = decodeURIComponent(pathMatch[1]); } catch (e) { room = pathMatch[1]; }
    }
    return {
        via: (params.get('via') || '').trim(),
        intent: (params.get('intent') || '').trim(),
        room: (room || '').toUpperCase(),
        pairToken: params.get('pair') || null,
        reconnectToken: params.get('reconnect') || null
    };
}

function roleBadgeText(decision) {
    switch (decision.entryKind) {
        case 'host_qr_controller':
        case 'controller_only':
            return 'Controller — you drive on the visible game screen';
        case 'remote_screen_viewer':
            return decision.startRenderer
                ? 'Screen — pair a phone to drive this seat'
                : 'Screen (light) — pair a phone to drive; this device shows a HUD';
        case 'spectator':
            return 'Spectator — watch only, no driving controls';
        case 'pair_controller':
            return 'Controller — paired to an open seat';
        case 'reconnect_restore':
            return 'Reconnecting — restoring your seat';
        default:
            return decision.role ? `Role: ${decision.role}` : '';
    }
}

function computeJoinRoute(overrideIntent) {
    const entry = readJoinEntryFromUrl();
    if (overrideIntent) entry.intent = overrideIntent;
    // Pre-join the client cannot know full room state: assume an open room.
    // Reconnect prior role comes from any saved seat record.
    let priorRole = null;
    try {
        if (entry.reconnectToken || entry.room) {
            const rec = findSavedReconnectRecord ? findSavedReconnectRecord(entry.room) : null;
            priorRole = rec?.role || null;
        }
    } catch (e) { priorRole = null; }
    const roomState = { status: 'open', topology: 'local', priorRole };
    // Local phone build: controllers only. It cannot render the world, so
    // screen/spectator intents degrade gracefully (no world renderer here).
    const capability = { canRenderViewer: false, sameDeviceViewerController: false };
    const resolver = window.resolveJoinRoute;
    if (typeof resolver !== 'function') {
        return { entry, decision: { entryKind: 'unavailable', role: null, showChooser: false, startRenderer: false, usedUserAgentOnly: false } };
    }
    return { entry, decision: resolver({ ...entry, roomState, capability }) };
}

function applyJoinRoute(overrideIntent) {
    const { entry, decision } = computeJoinRoute(overrideIntent);
    window.__joinEntry = entry;
    window.__joinRoute = decision;
    // Renderer guard reaffirmed: controller/HUD-only, no world renderer.
    window.__worldRendererStarted = false;
    if (typeof gameState === 'object' && gameState) {
        gameState.entryDecision = decision;
        gameState.entryReadOnly = !!decision.readOnly; // spectator: no driving controls
    }

    const chooser = document.getElementById('entry-chooser');
    const badge = document.getElementById('entry-role-badge');
    if (decision.showChooser) {
        if (chooser) chooser.style.display = '';
        if (badge) badge.style.display = 'none';
    } else {
        if (chooser) chooser.style.display = 'none';
        if (badge) {
            const text = roleBadgeText(decision);
            badge.textContent = text;
            badge.style.display = text ? '' : 'none';
        }
    }

    // Prefill the room code from a deep-link (does not overwrite user input).
    if (entry.room && elements.roomCodeInput && !elements.roomCodeInput.value) {
        elements.roomCodeInput.value = entry.room;
    }
    return decision;
}

function initJoinRouting() {
    ['screen', 'controller', 'spectator'].forEach((intent) => {
        const btn = document.getElementById('entry-choose-' + intent);
        if (btn) btn.addEventListener('click', () => applyJoinRoute(intent));
    });
    applyJoinRoute();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJoinRouting);
} else {
    initJoinRouting();
}

function resolveSocketTransports(search = window.location.search) {
    const params = new URLSearchParams(search || '');
    const socketTransport = (params.get('socketTransport') || '').toLowerCase();

    if (socketTransport === 'polling') {
        return ['polling'];
    }
    if (socketTransport === 'websocket') {
        return ['websocket'];
    }
    if (socketTransport === 'hybrid' || socketTransport === 'upgrade') {
        return ['polling', 'websocket'];
    }

    // Most E2E specs still pin polling in testMode for stability, but the
    // large soak can opt back into websocket upgrades explicitly.
    return params.get('testMode') === '1'
        ? ['polling']
        : ['polling', 'websocket'];
}

const socket = io({
    transports: resolveSocketTransports(window.location.search)
});

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

// Roll a fresh random name when the dice button is tapped
elements.generateNameBtn?.addEventListener('click', () => {
    elements.playerNameInput.value = generateRandomName();
    gameState.nameSet = true;
    elements.playerNameInput.focus();
});

// Room codes are 4 letters: force uppercase and drop anything that isn't
// a letter/number as the player types, so "abcd " becomes "ABCD".
elements.roomCodeInput.addEventListener('input', function() {
    const cleaned = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned !== this.value) {
        this.value = cleaned;
    }
});

// Enter anywhere in the join form submits it (mobile keyboards show "Go")
[elements.playerNameInput, elements.roomCodeInput].forEach((input) => {
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            joinGame();
        }
    });
});

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

// Bug reporting (player side) - opens a pre-filled email with controller-side
// debug info. Correlation fields (room code, player id, timestamp) let reports
// be matched against host + server logs later.
const BUG_REPORT_EMAIL = 'bugs@jammers.dilger.dev';
const TUTORIAL_STORAGE_KEY = 'jj_player_tutorial_done_v1';

const tutorialState = {
    active: false,
    phase: null,
    stepIndex: 0,
    replay: false,
    elements: null,
    joinStep: {
        target: '#room-code',
        title: 'Join from the big screen',
        body: 'Enter the 4-letter room code from the host screen. Your name is how everyone spots your car.'
    },
    gameSteps: [
        {
            target: '#steering-area',
            title: 'Steer on the left',
            body: 'Drag anywhere on the left side to turn. Let go and the wheel centers.'
        },
        {
            target: '#pedals-area',
            title: 'Drive on the right',
            body: 'Hold the up pedal to accelerate. Hold the down pedal to brake or reverse.'
        },
        {
            target: '#game-stats',
            title: 'Watch speed and status',
            body: 'Your speed, boost, and wheelie status show here while the race is running.'
        },
        {
            target: '#player-menu-btn',
            title: 'Recover from trouble',
            body: 'Open the menu to reset your car, report a bug, leave, or replay this tutorial.'
        }
    ]
};

function collectPlayerDebugInfo() {
    return {
        timestamp: new Date().toISOString(),
        side: 'player',
        url: window.location.href,
        userAgent: navigator.userAgent,
        roomCode: gameState.roomCode || null,
        playerId: gameState.playerId || null,
        seatId: gameState.seatId || null,
        phase: gameState.roomPhase || null,
        leaseVersion: gameState.leaseVersion || null,
        playerName: gameState.playerName || null,
        connected: gameState.connected,
        gameStarted: gameState.gameStarted,
        gameMode: gameState.gameMode,
        speed: Math.round(gameState.speed || 0),
        weapon: gameState.weapon?.id || null,
        socketId: (typeof socket !== 'undefined' && socket?.id) || null
    };
}

function emitPlayerTelemetryEvent(eventName, properties = {}) {
    const telemetry = window.__JJ_TELEMETRY__;
    if (!telemetry || typeof telemetry.capture !== 'function') {
        return null;
    }
    return telemetry.capture(eventName, properties);
}

function emitPlayerControllerTelemetry(eventName, properties = {}) {
    const nowMs = Date.now();
    const cooldownMs = Number(
        PLAYER_CONTROLLER_TELEMETRY_COOLDOWN_MS[eventName] ?? PLAYER_CONTROLLER_TELEMETRY_COOLDOWN_MS.controller_fallback
    );
    const lastAt = Number(playerControllerTelemetryState.get(eventName) || 0);
    if (cooldownMs > 0 && nowMs - lastAt < cooldownMs) {
        return null;
    }
    playerControllerTelemetryState.set(eventName, nowMs);
    return emitPlayerTelemetryEvent(eventName, {
        topology: 'remote',
        playerCount: gameState.playerId ? 1 : 0,
        ruleset: gameState.gameMode || 'unknown',
        ...properties,
    });
}

function emitInputStallTelemetry(force = false) {
    if (!gameState.gameStarted || !gameState.playerId || !gameState.roomCode) {
        return;
    }

    const now = Date.now();
    if (!force && now - lastInputTimestamp < 8000) {
        return;
    }
    if (!force && now - lastInputStallTelemetryAt < 15000) {
        return;
    }

    lastInputStallTelemetryAt = now;
    emitPlayerControllerTelemetry('gameplay:controller:input_stalled', {
        reason: 'no_input_packet',
        sinceMs: now - lastInputTimestamp
    });
}

function emitPlayerVisibilityTelemetry(state) {
    emitPlayerTelemetryEvent('perf:visibility:state_sample', {
        visibilityState: state,
        topology: 'remote',
        ruleset: gameState.gameMode || 'unknown',
        playerCount: gameState.playerId ? 1 : 0,
        deviceClass: window.__JJ_TELEMETRY__?.getContext?.().deviceClass || 'unknown',
        browserFamily: window.__JJ_TELEMETRY__?.getContext?.().browserFamily || 'unknown',
    });
}

setInterval(() => {
    emitInputStallTelemetry();
}, 3000);

function openPlayerBugReport() {
    const info = collectPlayerDebugInfo();
    const template =
`What went wrong? (be specific — what did you see?)


What did you expect to happen instead?


What were you doing right before it happened?
1.
2.

What device + browser are you on? (e.g. iPhone 13, Safari)

`;
    const summary = [
        `Time: ${info.timestamp}`,
        `Room: ${info.roomCode || '-'}`,
        `Player: ${info.playerName || '-'} (${info.playerId || '-'})`,
        `Socket: ${info.socketId || '-'}`,
        `Mode: ${info.gameMode}`,
        `Started: ${info.gameStarted}  Connected: ${info.connected}`,
        `Browser: ${info.userAgent}`,
        `URL: ${info.url}`
    ].join('\n');

    const subject = `Bug report (player): ${info.roomCode || 'multiplayer-racer'} @ ${info.timestamp}`;
    const body =
`${template}
----------------------------------------
Debug info (auto-captured — please leave this in):
${summary}
`;
    emitPlayerTelemetryEvent('gameplay:player:report_requested', {
        hasRoomCode: Boolean(info.roomCode),
        hasSeatId: Boolean(info.seatId),
        mode: gameState.gameMode || 'unknown',
    });
    window.location.href =
        `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function isTutorialComplete() {
    try {
        return localStorage.getItem(TUTORIAL_STORAGE_KEY) === '1';
    } catch (e) {
        return false;
    }
}

function setTutorialComplete(value) {
    try {
        if (value) {
            localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
        } else {
            localStorage.removeItem(TUTORIAL_STORAGE_KEY);
        }
    } catch (e) {
        // localStorage unavailable - tutorial remains session-only
    }
}

function initTutorial() {
    const overlay = document.getElementById('tutorial-overlay');
    if (!overlay) return;

    tutorialState.elements = {
        overlay,
        veil: document.getElementById('tutorial-veil'),
        spotlight: document.getElementById('tutorial-spotlight'),
        card: document.getElementById('tutorial-card'),
        progress: document.getElementById('tutorial-progress'),
        title: document.getElementById('tutorial-title'),
        body: document.getElementById('tutorial-body'),
        next: document.getElementById('tutorial-next'),
        skip: document.getElementById('tutorial-skip')
    };

    tutorialState.elements.next?.addEventListener('click', advanceTutorial);
    tutorialState.elements.skip?.addEventListener('click', () => finishTutorial({ persist: true }));
    window.addEventListener('resize', () => {
        if (tutorialState.active) renderTutorialStep();
    });

    if (!isTutorialComplete()) {
        setTimeout(() => startJoinTutorial(), 450);
    }
}

function startTutorialForCurrentScreen(replay = false) {
    if (gameState.gameStarted) {
        startGameplayTutorial({ replay });
    } else {
        startJoinTutorial({ replay });
    }
}

function startJoinTutorial({ replay = false } = {}) {
    if (!tutorialState.elements || (!replay && isTutorialComplete())) return;

    emitPlayerControllerTelemetry('gameplay:join:tutorial_viewed', {
        replay: Boolean(replay),
        phase: 'join',
    });

    tutorialState.active = true;
    tutorialState.phase = 'join';
    tutorialState.stepIndex = 0;
    tutorialState.replay = replay;
    renderTutorialStep();
}

function maybeStartGameplayTutorial() {
    if (!isTutorialComplete()) {
        setTimeout(() => startGameplayTutorial(), 300);
    } else if (tutorialState.active && tutorialState.phase === 'join') {
        finishTutorial({ persist: false });
    }
}

function startGameplayTutorial({ replay = false } = {}) {
    if (!tutorialState.elements || (!replay && isTutorialComplete())) return;

    emitPlayerControllerTelemetry('gameplay:join:tutorial_viewed', {
        replay: Boolean(replay),
        phase: 'gameplay',
    });

    tutorialState.active = true;
    tutorialState.phase = 'game';
    tutorialState.stepIndex = 0;
    tutorialState.replay = replay;
    renderTutorialStep();
}

function advanceTutorial() {
    if (tutorialState.phase === 'join') {
        finishTutorial({ persist: false });
        return;
    }

    tutorialState.stepIndex += 1;
    if (tutorialState.stepIndex >= tutorialState.gameSteps.length) {
        finishTutorial({ persist: true });
        return;
    }
    renderTutorialStep();
}

function finishTutorial({ persist }) {
    const tutorialPhase = tutorialState.phase;
    const shouldSkip = tutorialPhase === 'join' && !persist;
    tutorialState.active = false;
    tutorialState.phase = null;
    tutorialState.stepIndex = 0;
    tutorialState.elements?.overlay?.classList.add('hidden');
    if (shouldSkip) {
        emitPlayerControllerTelemetry('gameplay:join:tutorial_skipped', {
            phase: tutorialPhase
        });
    } else {
        emitPlayerControllerTelemetry('gameplay:join:completed', {
            phase: tutorialPhase || 'join'
        });
        emitPlayerControllerTelemetry('gameplay:join:tutorial_completed', {
            phase: tutorialPhase || 'join'
        });
    }
    if (persist) {
        setTutorialComplete(true);
    }
}

function getCurrentTutorialStep() {
    if (tutorialState.phase === 'join') return tutorialState.joinStep;
    return tutorialState.gameSteps[tutorialState.stepIndex];
}

function isTutorialTargetVisible(element) {
    if (!element) return false;
    if (element.closest('.hidden')) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function findVisibleGameplayStep(startIndex) {
    for (let i = startIndex; i < tutorialState.gameSteps.length; i++) {
        const target = document.querySelector(tutorialState.gameSteps[i].target);
        if (isTutorialTargetVisible(target)) return i;
    }
    return startIndex;
}

function renderTutorialStep() {
    const ui = tutorialState.elements;
    if (!ui || !tutorialState.active) return;

    if (tutorialState.phase === 'game') {
        tutorialState.stepIndex = findVisibleGameplayStep(tutorialState.stepIndex);
    }

    const step = getCurrentTutorialStep();
    const target = document.querySelector(step.target);
    const targetVisible = isTutorialTargetVisible(target);
    const rect = targetVisible ? target.getBoundingClientRect() : null;

    ui.overlay.classList.remove('hidden');
    ui.title.textContent = step.title;
    ui.body.textContent = step.body;

    const total = tutorialState.phase === 'join' ? 1 : tutorialState.gameSteps.length;
    const current = tutorialState.phase === 'join' ? 1 : tutorialState.stepIndex + 1;
    ui.progress.textContent = tutorialState.phase === 'join'
        ? 'First run'
        : `Step ${current} of ${total}`;
    ui.next.textContent = tutorialState.phase === 'join'
        ? 'Got it'
        : (current === total ? 'Done' : 'Next');

    if (targetVisible && rect) {
        const padding = 10;
        const left = Math.max(6, rect.left - padding);
        const top = Math.max(6, rect.top - padding);
        const width = Math.min(window.innerWidth - left - 6, rect.width + padding * 2);
        const height = Math.min(window.innerHeight - top - 6, rect.height + padding * 2);

        ui.spotlight.style.display = 'block';
        ui.spotlight.style.left = `${left}px`;
        ui.spotlight.style.top = `${top}px`;
        ui.spotlight.style.width = `${width}px`;
        ui.spotlight.style.height = `${height}px`;
        ui.veil?.style.setProperty('--spot-x', `${left + width / 2}px`);
        ui.veil?.style.setProperty('--spot-y', `${top + height / 2}px`);

        const cardShouldMoveAbove = rect.top > window.innerHeight * 0.55;
        ui.card.classList.toggle('above', cardShouldMoveAbove);
    } else {
        ui.spotlight.style.display = 'none';
        ui.card.classList.remove('above');
        ui.veil?.style.setProperty('--spot-x', '50%');
        ui.veil?.style.setProperty('--spot-y', '50%');
    }
}

const REMAP_ACTION_LABELS = Object.freeze({
    steerLeft: 'Steer Left',
    steerRight: 'Steer Right',
    accelerate: 'Accelerate',
    brake: 'Brake / Reverse',
    fire: 'Fire'
});

function sanitizeGamepadSourceId(rawId) {
    if (typeof rawId !== 'string' || !rawId.trim()) {
        return REMAP_SOURCE_IDS.gamepadFallback;
    }

    return rawId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || REMAP_SOURCE_IDS.gamepadFallback;
}

function getCurrentGamepadSourceId() {
    return activeGamepadId || REMAP_SOURCE_IDS.gamepadFallback;
}

function getCurrentRemapState() {
    return controlMapper?.getRemapState?.() || {
        touch: { schemeId: 'classic', summary: 'Steer left · pedals right' },
        keyboard: { schemeId: 'hybrid', summary: 'WASD + Arrows', bindings: {} },
        gamepad: { schemeId: 'standard', summary: 'Standard pad', bindings: {}, sourceId: REMAP_SOURCE_IDS.gamepadFallback }
    };
}

function persistTouchRemap() {
    if (!remapStore || !controlMapper) {
        return;
    }

    const touch = getCurrentRemapState().touch;
    remapStore.setSource({
        kind: 'touch',
        sourceId: REMAP_SOURCE_IDS.touch,
        schemeId: touch.schemeId,
        summary: touch.summary,
        bindings: {}
    });
}

function persistKeyboardRemap() {
    if (!remapStore || !controlMapper) {
        return;
    }

    const keyboard = getCurrentRemapState().keyboard;
    remapStore.setSource({
        kind: 'keyboard',
        sourceId: REMAP_SOURCE_IDS.keyboard,
        schemeId: keyboard.schemeId,
        summary: keyboard.summary,
        bindings: keyboard.bindings
    });
}

function persistGamepadRemap(sourceId = getCurrentGamepadSourceId()) {
    if (!remapStore || !controlMapper) {
        return;
    }

    const gamepad = getCurrentRemapState().gamepad;
    remapStore.setSource({
        kind: 'gamepad',
        sourceId,
        schemeId: gamepad.schemeId,
        summary: gamepad.summary,
        bindings: gamepad.bindings
    });
}

function applyStoredGamepadRemap(sourceId = getCurrentGamepadSourceId()) {
    if (!controlMapper) {
        return null;
    }

    const specificRemap = getStoredRemapSource('gamepad', sourceId);
    if (specificRemap?.bindings) {
        controlMapper.setGamepadBindings(specificRemap.bindings, {
            schemeId: specificRemap.schemeId || 'custom',
            sourceId
        });
        return specificRemap;
    }

    const fallbackRemap = sourceId !== REMAP_SOURCE_IDS.gamepadFallback
        ? getStoredRemapSource('gamepad', REMAP_SOURCE_IDS.gamepadFallback)
        : null;
    if (fallbackRemap?.bindings) {
        controlMapper.setGamepadBindings(fallbackRemap.bindings, {
            schemeId: fallbackRemap.schemeId || 'custom',
            sourceId
        });
        return fallbackRemap;
    }

    controlMapper.setGamepadPreset('standard', { sourceId });
    return null;
}

function updateControlRemapSummaries() {
    const state = getCurrentRemapState();
    const summary = [state.touch.summary, state.keyboard.summary, state.gamepad.summary]
        .filter(Boolean)
        .join(' · ');

    if (elements.controlSummaryJoin) {
        elements.controlSummaryJoin.textContent = summary;
    }
    if (elements.controlSummaryMenu) {
        elements.controlSummaryMenu.textContent = summary;
    }
}

function setRemapStatus(message, { error = false } = {}) {
    if (!elements.remapStatus) {
        return;
    }

    elements.remapStatus.textContent = message;
    elements.remapStatus.dataset.state = error ? 'error' : 'ok';
}

function updateGamepadMappingNotice() {
    if (!elements.gamepadMappingNotice) {
        return;
    }

    const validation = controlMapper?.getValidationState?.()?.gamepad;
    if (validation?.warnings?.length) {
        elements.gamepadMappingNotice.textContent = validation.warnings[0];
        elements.gamepadMappingNotice.dataset.state = 'warn';
        return;
    }

    if (activeGamepadIndex === null) {
        elements.gamepadMappingNotice.textContent = 'No gamepad detected. Changes still save for the next compatible pad on this device.';
        elements.gamepadMappingNotice.dataset.state = 'idle';
        return;
    }

    elements.gamepadMappingNotice.textContent = `Active pad saved as ${getCurrentGamepadSourceId()}.`;
    elements.gamepadMappingNotice.dataset.state = 'ok';
}

function renderTouchSchemeOptions() {
    const container = document.getElementById('control-remap-touch-options');
    if (!container || !ControlMapperClass?.TOUCH_SCHEMES) {
        return;
    }

    const currentSchemeId = getCurrentRemapState().touch.schemeId;
    container.innerHTML = '';

    for (const scheme of Object.values(ControlMapperClass.TOUCH_SCHEMES)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'control-remap-chip';
        button.dataset.touchScheme = scheme.id;
        button.setAttribute('aria-pressed', currentSchemeId === scheme.id ? 'true' : 'false');
        if (currentSchemeId === scheme.id) {
            button.classList.add('active');
        }
        button.innerHTML = `
            <span class="control-remap-chip-title">${scheme.name}</span>
            <span class="control-remap-chip-meta">${scheme.summary}</span>
        `;
        button.addEventListener('click', () => applyTouchSchemeRemap(scheme.id));
        container.appendChild(button);
    }
}

function renderKeyboardPresetOptions() {
    const container = document.getElementById('control-remap-keyboard-presets');
    if (!container || !ControlMapperClass?.KEYBOARD_REGION_PRESETS) {
        return;
    }

    const keyboardState = getCurrentRemapState().keyboard;
    container.innerHTML = '';

    for (const preset of Object.values(ControlMapperClass.KEYBOARD_REGION_PRESETS)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'control-remap-chip';
        button.dataset.keyboardPreset = preset.id;
        button.setAttribute('aria-pressed', keyboardState.schemeId === preset.id ? 'true' : 'false');
        if (keyboardState.schemeId === preset.id) {
            button.classList.add('active');
        }
        button.innerHTML = `
            <span class="control-remap-chip-title">${preset.name}</span>
            <span class="control-remap-chip-meta">${preset.summary}</span>
        `;
        button.addEventListener('click', () => applyKeyboardPresetRemap(preset.id));
        container.appendChild(button);
    }
}

function renderKeyboardBindingRows() {
    const container = document.getElementById('control-remap-keyboard-actions');
    if (!container || !ControlMapperClass?.describeKeyboardBindingList) {
        return;
    }

    const keyboardState = getCurrentRemapState().keyboard;
    container.innerHTML = '';

    for (const action of KEYBOARD_ACTIONS) {
        const row = document.createElement('div');
        row.className = 'control-remap-row';

        const label = document.createElement('span');
        label.className = 'control-remap-row-label';
        label.textContent = REMAP_ACTION_LABELS[action] || action;

        const valueButton = document.createElement('button');
        valueButton.type = 'button';
        valueButton.className = 'control-remap-bind-btn';
        valueButton.dataset.keyboardAction = action;
        if (remapUiState.capturingKeyboardAction === action) {
            valueButton.classList.add('capturing');
            valueButton.textContent = 'Press a key…';
        } else {
            valueButton.textContent = ControlMapperClass.describeKeyboardBindingList(
                keyboardState.bindings[action]
            ) || 'Unbound';
        }
        valueButton.addEventListener('click', () => {
            remapUiState.capturingKeyboardAction = action;
            renderControlRemapUI();
            setRemapStatus(`Press a key for ${REMAP_ACTION_LABELS[action]}. Escape cancels.`, {
                error: false
            });
        });

        row.appendChild(label);
        row.appendChild(valueButton);
        container.appendChild(row);
    }
}

function renderGamepadBindingRows() {
    const container = document.getElementById('control-remap-gamepad-actions');
    if (!container || !ControlMapperClass?.GAMEPAD_BINDING_OPTIONS) {
        return;
    }

    const gamepadState = getCurrentRemapState().gamepad;
    container.innerHTML = '';

    for (const action of KEYBOARD_ACTIONS) {
        const options = ControlMapperClass.GAMEPAD_BINDING_OPTIONS[action] || [];
        const row = document.createElement('label');
        row.className = 'control-remap-row';

        const text = document.createElement('span');
        text.className = 'control-remap-row-label';
        text.textContent = REMAP_ACTION_LABELS[action] || action;

        const select = document.createElement('select');
        select.className = 'control-remap-select';
        select.dataset.gamepadAction = action;

        for (const option of options) {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            select.appendChild(optionElement);
        }

        select.value = gamepadState.bindings[action]?.[0] || options[0]?.value || '';
        select.addEventListener('change', () => {
            const result = controlMapper?.setGamepadActionBinding(action, [select.value], {
                schemeId: 'custom',
                sourceId: getCurrentGamepadSourceId(),
                fallbackPresetId: gamepadState.schemeId
            });
            if (!result?.valid) {
                setRemapStatus(result?.errors?.[0] || 'Could not save that gamepad binding.', {
                    error: true
                });
                renderControlRemapUI();
                return;
            }

            persistGamepadRemap(getCurrentGamepadSourceId());
            updateControlRemapSummaries();
            updateGamepadMappingNotice();
            renderControlRemapUI();
            setRemapStatus(`Saved ${REMAP_ACTION_LABELS[action]} for this gamepad source.`, {
                error: false
            });
        });

        row.appendChild(text);
        row.appendChild(select);
        container.appendChild(row);
    }
}

function renderControlRemapUI() {
    renderTouchSchemeOptions();
    renderKeyboardPresetOptions();
    renderKeyboardBindingRows();
    renderGamepadBindingRows();
    updateControlRemapSummaries();
    updateGamepadMappingNotice();
}

function applyTouchSchemeRemap(schemeId) {
    const result = controlMapper?.setTouchScheme(schemeId);
    if (!result?.valid) {
        setRemapStatus(result?.errors?.[0] || 'Could not apply that touch layout.', {
            error: true
        });
        return;
    }

    persistTouchRemap();
    releaseAllControls();
    if (gameState.gameStarted) {
        initGameControls();
        updateWeaponDisplay();
    }
    if (tutorialState.active) {
        renderTutorialStep();
    }
    renderControlRemapUI();
    setRemapStatus(`Saved ${ControlMapperClass.TOUCH_SCHEMES[schemeId].name} for this device.`, {
        error: false
    });
}

function applyKeyboardPresetRemap(presetId) {
    const result = controlMapper?.setKeyboardPreset(presetId);
    if (!result?.valid) {
        setRemapStatus(result?.errors?.[0] || 'Could not apply that keyboard preset.', {
            error: true
        });
        return;
    }

    keyboardPressedCodes.clear();
    controlMapper?.setKeyboardKeys(keyboardPressedCodes);
    controlMapper?.setKeyboardFire(false);
    persistKeyboardRemap();
    syncControlsFromMapper();
    renderControlRemapUI();
    setRemapStatus(`Saved ${ControlMapperClass.KEYBOARD_REGION_PRESETS[presetId].name}.`, {
        error: false
    });
}

function resetAllControlRemaps() {
    remapUiState.capturingKeyboardAction = null;
    controlMapper?.setTouchScheme('classic');
    controlMapper?.setKeyboardPreset('hybrid');
    controlMapper?.setGamepadPreset('standard', {
        sourceId: getCurrentGamepadSourceId()
    });
    controlMapper?.clearGamepadSnapshot();
    keyboardPressedCodes.clear();
    controlMapper?.setKeyboardKeys(keyboardPressedCodes);
    controlMapper?.setKeyboardFire(false);

    remapStore?.removeSource('touch', REMAP_SOURCE_IDS.touch);
    remapStore?.removeSource('keyboard', REMAP_SOURCE_IDS.keyboard);
    remapStore?.removeSource('gamepad', REMAP_SOURCE_IDS.gamepadFallback);
    if (getCurrentGamepadSourceId() !== REMAP_SOURCE_IDS.gamepadFallback) {
        remapStore?.removeSource('gamepad', getCurrentGamepadSourceId());
    }

    if (gameState.gameStarted) {
        releaseAllControls();
        initGameControls();
        updateWeaponDisplay();
    }
    renderControlRemapUI();
    setRemapStatus('Reset to the local default control layout.', { error: false });
}

function normalizeKeyboardBindingCode(event) {
    if (!event) {
        return null;
    }

    if (typeof event.code === 'string' && event.code.trim()) {
        return event.code;
    }

    if (event.key === ' ') {
        return 'Space';
    }

    if (typeof event.key !== 'string' || !event.key.trim()) {
        return null;
    }

    if (event.key.startsWith('Arrow')) {
        return event.key;
    }

    if (/^[a-z]$/i.test(event.key)) {
        return `Key${event.key.toUpperCase()}`;
    }

    if (/^[0-9]$/.test(event.key)) {
        return `Digit${event.key}`;
    }

    return null;
}

function handleRemapCaptureEvent(event) {
    if (!remapUiState.active || !remapUiState.capturingKeyboardAction) {
        return false;
    }

    event.preventDefault?.();
    event.stopPropagation?.();

    if (event.key === 'Escape') {
        remapUiState.capturingKeyboardAction = null;
        renderControlRemapUI();
        setRemapStatus('Keyboard remap cancelled.', { error: false });
        return true;
    }

    const code = normalizeKeyboardBindingCode(event);
    if (!code) {
        setRemapStatus('Only standard keyboard keys can be bound here.', {
            error: true
        });
        return true;
    }

    const action = remapUiState.capturingKeyboardAction;
    const result = controlMapper?.setKeyboardActionBinding(
        action,
        [code],
        {
            schemeId: 'custom',
            fallbackPresetId: getCurrentRemapState().keyboard.schemeId
        }
    );

    if (!result?.valid) {
        setRemapStatus(result?.errors?.[0] || 'That keyboard binding conflicts with another action.', {
            error: true
        });
        return true;
    }

    keyboardPressedCodes.clear();
    controlMapper?.setKeyboardKeys(keyboardPressedCodes);
    controlMapper?.setKeyboardFire(false);
    persistKeyboardRemap();
    remapUiState.capturingKeyboardAction = null;
    renderControlRemapUI();
    setRemapStatus(`Saved ${REMAP_ACTION_LABELS[action] || 'keyboard'} binding.`, {
        error: false
    });
    return true;
}

function openControlRemapModal(launcher = document.activeElement) {
    if (!elements.remapModal) {
        return;
    }

    remapUiState.active = true;
    remapUiState.lastLauncher = launcher;
    remapUiState.capturingKeyboardAction = null;
    elements.remapModal.classList.remove('hidden');
    renderControlRemapUI();
    setRemapStatus('Saved locally on this device only. No account or cloud sync.', {
        error: false
    });

    const firstButton = elements.remapModal.querySelector('.control-remap-chip, .control-remap-bind-btn, .control-remap-select');
    firstButton?.focus?.();
}

function closeControlRemapModal() {
    if (!elements.remapModal) {
        return;
    }

    remapUiState.active = false;
    remapUiState.capturingKeyboardAction = null;
    elements.remapModal.classList.add('hidden');
    remapUiState.lastLauncher?.focus?.();
}

function bindGamepadControls() {
    if (gamepadControlsBound) {
        return;
    }

    window.addEventListener('gamepadconnected', (event) => {
        const gamepad = event.gamepad;
        activeGamepadIndex = gamepad.index;
        activeGamepadId = sanitizeGamepadSourceId(gamepad.id);
        applyStoredGamepadRemap(activeGamepadId);
        renderControlRemapUI();
    });

    window.addEventListener('gamepaddisconnected', (event) => {
        if (event.gamepad.index !== activeGamepadIndex) {
            return;
        }

        activeGamepadIndex = null;
        activeGamepadId = REMAP_SOURCE_IDS.gamepadFallback;
        controlMapper?.clearGamepadSnapshot();
        applyStoredGamepadRemap(REMAP_SOURCE_IDS.gamepadFallback);
        renderControlRemapUI();
    });

    gamepadControlsBound = true;
}

function pollGamepadControls() {
    if (!controlMapper || typeof navigator.getGamepads !== 'function') {
        return;
    }

    const pads = Array.from(navigator.getGamepads?.() || []);
    let gamepad = activeGamepadIndex !== null ? pads[activeGamepadIndex] : null;

    if (!gamepad) {
        gamepad = pads.find(Boolean) || null;
        if (!gamepad) {
            activeGamepadIndex = null;
            activeGamepadId = REMAP_SOURCE_IDS.gamepadFallback;
            controlMapper.clearGamepadSnapshot();
            applyStoredGamepadRemap(REMAP_SOURCE_IDS.gamepadFallback);
            updateGamepadMappingNotice();
            return;
        }
    }

    const nextSourceId = sanitizeGamepadSourceId(gamepad.id);
    if (activeGamepadIndex !== gamepad.index || activeGamepadId !== nextSourceId) {
        activeGamepadIndex = gamepad.index;
        activeGamepadId = nextSourceId;
        applyStoredGamepadRemap(activeGamepadId);
    }

    controlMapper.setGamepadSnapshot({
        connected: true,
        id: gamepad.id,
        index: gamepad.index,
        mapping: gamepad.mapping,
        axes: Array.from(gamepad.axes || []),
        buttons: Array.from(gamepad.buttons || []).map((button) => ({
            pressed: !!button.pressed,
            value: typeof button.value === 'number' ? button.value : (button.pressed ? 1 : 0)
        }))
    });
    updateGamepadMappingNotice();
}

function initControlRemapUI() {
    if (!elements.remapModal) {
        updateControlRemapSummaries();
        return;
    }

    elements.joinControlsBtn?.addEventListener('click', (event) => {
        openControlRemapModal(event.currentTarget);
    });
    elements.playerMenuControlsBtn?.addEventListener('click', (event) => {
        document.getElementById('player-menu')?.classList.add('hidden');
        openControlRemapModal(event.currentTarget);
    });
    elements.remapCloseBtn?.addEventListener('click', closeControlRemapModal);
    elements.remapResetBtn?.addEventListener('click', resetAllControlRemaps);
    elements.remapModal.addEventListener('click', (event) => {
        if (event.target === elements.remapModal) {
            closeControlRemapModal();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (handleRemapCaptureEvent(event)) {
            return;
        }

        if (remapUiState.active && event.key === 'Escape') {
            event.preventDefault?.();
            closeControlRemapModal();
        }
    }, true);

    bindGamepadControls();
    renderControlRemapUI();
}

// In-game menu (help / reset car / leave) - escape hatch when stuck
function initPlayerMenu() {
    const menuBtn = document.getElementById('player-menu-btn');
    const menu = document.getElementById('player-menu');
    const resetBtn = document.getElementById('player-menu-reset');
    const replayTutorialBtn = document.getElementById('player-menu-replay-tutorial');
    const reportBugBtn = document.getElementById('player-menu-report-bug');
    const leaveBtn = document.getElementById('player-menu-leave');
    const closeBtn = document.getElementById('player-menu-close');
    if (!menuBtn || !menu) return;

    const closeMenu = () => menu.classList.add('hidden');
    menuBtn.addEventListener('click', () => menu.classList.remove('hidden'));
    closeBtn?.addEventListener('click', closeMenu);
    menu.addEventListener('click', (e) => {
        if (e.target === menu) closeMenu();
    });

    reportBugBtn?.addEventListener('click', () => {
        openPlayerBugReport();
        closeMenu();
    });

    replayTutorialBtn?.addEventListener('click', () => {
        closeMenu();
        startTutorialForCurrentScreen(true);
    });

    resetBtn?.addEventListener('click', () => {
        if (gameState.gameStarted && gameState.roomCode) {
            socket.emit('request_car_reset', { room_code: gameState.roomCode });
            emitPlayerTelemetryEvent('gameplay:player:reset_requested', {
                hasPlayerId: Boolean(gameState.playerId),
                mode: gameState.gameMode || 'unknown'
            });
            showMessage('Resetting your car...', 1500);
            hapticBuzz(30);
        }
        closeMenu();
    });

    leaveBtn?.addEventListener('click', () => {
        clearStoredSeatRecord(gameState.roomCode);
        // Reload without ?room so we don't instantly auto-rejoin
        window.location.href = window.location.pathname;
    });
}
initPlayerMenu();
initControlRemapUI();
initTutorial();

function updateVehicleStatusFeedback() {
    const statusIcon = document.getElementById('status-icon');
    if (!statusIcon) return;

    const stateClasses = ['status-boost', 'status-wheelie', 'status-landing', 'status-bad'];
    statusIcon.classList.remove(...stateClasses);

    let nextStatus = null;
    if (gameState.badLandingActive) {
        nextStatus = { icon: '!', className: 'status-bad', label: 'Bad landing' };
    } else if (gameState.wheelieActive) {
        nextStatus = { icon: '🚲', className: 'status-wheelie', label: 'Wheelie' };
    } else if (gameState.landingBoostActive) {
        nextStatus = { icon: '🔥', className: 'status-landing', label: 'Landing boost' };
    } else if (gameState.boostActive) {
        nextStatus = { icon: '🔥', className: 'status-boost', label: 'Boost' };
    }

    if (nextStatus) {
        statusIcon.textContent = nextStatus.icon;
        statusIcon.setAttribute('aria-label', nextStatus.label);
        statusIcon.classList.add(nextStatus.className);
        statusIcon.classList.remove('hidden');
    } else {
        statusIcon.classList.add('hidden');
        statusIcon.removeAttribute('aria-label');
    }

    if (gameState.badLandingActive && !gameState.wasBadLandingActive) {
        hapticBuzz([60, 30, 60]);
    } else if (gameState.landingBoostActive && !gameState.wasLandingBoostActive) {
        hapticBuzz([25, 25, 80]);
    } else if (gameState.boostActive && !gameState.wasBoosting) {
        hapticBuzz([20, 20, 20]);
    } else if (gameState.wheelieActive && !gameState.wasWheelieActive) {
        hapticBuzz(18);
    }

    gameState.wasBoosting = gameState.boostActive;
    gameState.wasWheelieActive = gameState.wheelieActive;
    gameState.wasLandingBoostActive = gameState.landingBoostActive;
    gameState.wasBadLandingActive = gameState.badLandingActive;
}

function syncCurrentSeatRecord() {
    if (!gameState.roomCode || !gameState.playerId) {
        return;
    }

    writeStoredSeatRecord({
        room_code: gameState.roomCode,
        player_id: gameState.playerId,
        seat_id: gameState.seatId,
        seat_token: gameState.seatToken,
        lease_version: gameState.leaseVersion,
        client_instance_id: gameState.clientInstanceId,
        player_name: gameState.playerName
    });
}

function ensureWaitingRoomIdentityUI() {
    if (elements.displayName) {
        elements.displayName.textContent = gameState.playerName;
    }
    if (elements.displayRoom) {
        elements.displayRoom.textContent = gameState.roomCode;
    }

    initCarPreview();

    const playerInfo = elements.waitingScreen.querySelector('.player-info');
    const existingNameChange = playerInfo?.querySelector('.name-change-container');
    if (existingNameChange) {
        const waitingNameInput = existingNameChange.querySelector('#waiting-name-input');
        if (waitingNameInput) {
            waitingNameInput.value = gameState.playerName;
        }
        return;
    }

    if (!playerInfo) {
        return;
    }

    const nameChangeContainer = document.createElement('div');
    nameChangeContainer.className = 'name-change-container';
    nameChangeContainer.innerHTML = `
        <p>Want to change your name?</p>
        <div class="name-change-input">
            <input type="text" id="waiting-name-input" value="${gameState.playerName}" maxlength="15">
            <button id="update-name-btn">Update</button>
        </div>
    `;
    playerInfo.appendChild(nameChangeContainer);

    const waitingNameInput = document.getElementById('waiting-name-input');
    const updateNameBtn = document.getElementById('update-name-btn');
    if (!waitingNameInput || !updateNameBtn) {
        return;
    }

    updateNameBtn.addEventListener('click', () => {
        const newName = waitingNameInput.value.trim();
        if (newName && newName !== gameState.playerName) {
            updatePlayerName(newName);
        }
    });

    waitingNameInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            updateNameBtn.click();
        }
    });
}

function applyRoomPhaseState(phase, { message = null, duration = 3000 } = {}) {
    const nextPhase = typeof phase === 'string' && phase ? phase : phaseFromGameState('waiting');
    const previousPhase = gameState.roomPhase;
    gameState.roomPhase = nextPhase;

    if (ACTIVE_ROOM_PHASES.has(nextPhase)) {
        const shouldRebuildControls = !(gameState.gameStarted && previousPhase === nextPhase);
        gameState.gameStarted = true;
        if (shouldRebuildControls) {
            initGameControls();
            showScreen('game');
            maybeStartGameplayTutorial();
        } else {
            showScreen('game');
        }
        if (message) {
            showMessage(message, duration);
        } else if (previousPhase === 'host_lost') {
            showMessage('Host reconnected. Match resumed.', 2500);
        }
        return;
    }

    if (gameState.gameStarted) {
        releaseAllControls({ emitPacket: false });
    }
    gameState.gameStarted = false;

    if (nextPhase === 'closed') {
        clearStoredSeatRecord(gameState.roomCode);
        resetGame();
        showError(message || 'This room has closed.');
        return;
    }

    ensureWaitingRoomIdentityUI();
    showScreen('waiting');

    if (message) {
        showMessage(message, duration);
    } else if (nextPhase === 'host_lost' && previousPhase !== 'host_lost') {
        showMessage('Host connection lost. Holding your seat while it reconnects.', 3500);
    } else if (previousPhase === 'host_lost') {
        showMessage('Host reconnected. Waiting for the next state update.', 2500);
    }
}

function sendSeatHeartbeat() {
    if (!gameState.connected || !gameState.roomCode || !gameState.seatId || !gameState.playerId) {
        return;
    }
    if (window.__buildStale) {
        return;
    }

    socket.emit('seat_heartbeat', {
        room_code: gameState.roomCode,
        seat_id: gameState.seatId,
        player_id: gameState.playerId,
        lease_version: gameState.leaseVersion,
        client_instance_id: getClientInstanceId()
    });
}

(window.setInterval || setInterval)(sendSeatHeartbeat, SEAT_HEARTBEAT_INTERVAL_MS);

// Socket event handlers
// Handle vehicle state updates from server (forwarded from host)
socket.on('vehicle_states_update', (data) => {
    if (!gameState.gameStarted || !gameState.playerId) return;

    const myVehicle = data.vehicles.find(v => v.id === gameState.playerId);
    if (myVehicle) {
        gameState.speed = myVehicle.speed;
        gameState.health = myVehicle.health;
        gameState.boostActive = !!myVehicle.boost;
        gameState.wheelieActive = !!myVehicle.wheelie || myVehicle.handlingState === 'wheelie';
        gameState.stuntState = myVehicle.stuntState || 'idle';
        gameState.stuntCharge = Math.max(0, Math.min(1, myVehicle.stuntCharge || 0));
        gameState.landingBoostActive = !!myVehicle.landingBoost || gameState.stuntState === 'reward';
        gameState.badLandingActive = !!myVehicle.badLanding || gameState.stuntState === 'bad-landing';

        // Update speed display
        if (elements.speedDisplay) {
            elements.speedDisplay.textContent = `${Math.round(gameState.speed)} km/h`;

            // Visual feedback for speed
            const speedFactor = Math.min(1, gameState.speed / 120);
            elements.speedDisplay.style.color = `rgb(255, ${Math.floor(255 * (1 - speedFactor))}, ${Math.floor(255 * (1 - speedFactor))})`;
        }

        updateVehicleStatusFeedback();
    }
});

// Update connection status UI
function updateConnectionStatus(connected) {
    gameState.connected = connected;
    const statusEl = document.getElementById('connection-status');
    const statusText = document.getElementById('status-text');

    if (statusEl && statusText) {
        if (connected) {
            statusEl.className = 'connection-status connected';
            statusText.textContent = 'Connected';
        } else {
            statusEl.className = 'connection-status disconnected';
            statusText.textContent = 'Reconnecting...';
        }
    }
}

socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
    if (!hasConnectedControllerTelemetry) {
        emitPlayerControllerTelemetry('gameplay:controller:connected', {
            mode: 'player_connect',
            cause: 'connect'
        });
        hasConnectedControllerTelemetry = true;
    } else {
        emitPlayerControllerTelemetry('gameplay:controller:reconnect_succeeded', {
            mode: gameState.gameMode || 'unknown',
            cause: 'connect_retry'
        });
    }
    getClientInstanceId();
    // ... rest of connect handler ...

    // Initialize error logging if not already initialized
    if (!errorLog.container) {
        errorLog.init();
        console.log('Error log initialized on connect');
    }

    // Reconnect path: if we were already in a game when the socket dropped
    // (phone slept, network blip), rejoin automatically with the stored seat
    // token + client-instance metadata so the server restores our seat.
    if (gameState.roomCode) {
        console.log('Socket reconnected - rejoining room', gameState.roomCode);
        showMessage('Recovering session...', 2000);
        elements.roomCodeInput.value = gameState.roomCode;
        if (gameState.playerName) {
            elements.playerNameInput.value = gameState.playerName;
        }
        joinGame();
        return;
    }

    // Check for room code in URL parameters or window.roomCode (from template)
    let roomCode = getUrlParameter('room');

    // If no room code in URL, check if it was passed via template
    if (!roomCode && window.roomCode && window.roomCode !== "{{ room_code }}") {
        roomCode = window.roomCode;
    }

    // Normalize to the canonical 4-letter uppercase form so the field and the
    // "room detected" banner match what's on the big screen (e.g. ?room=abcd).
    if (roomCode) {
        roomCode = roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    // Fresh page load with no URL room (e.g. typed code earlier, tab restored
    // after the phone slept): pre-fill the room/name from the saved reconnect
    // record so the player can rejoin with one tap. We don't auto-submit here -
    // that would hijack someone trying to join a different room.
    if (!roomCode) {
        const saved = findSavedReconnect();
        if (saved) {
            elements.roomCodeInput.value = saved.room_code;
            if (saved.player_name && elements.playerNameInput && !elements.playerNameInput.value.trim()) {
                elements.playerNameInput.value = saved.player_name;
            }
        }
    } else {
        const saved = readStoredSeatRecord(roomCode);
        if (saved?.player_name && elements.playerNameInput && !elements.playerNameInput.value.trim()) {
            elements.playerNameInput.value = saved.player_name;
        }
    }

    if (roomCode) {
        // Set room code input value
        elements.roomCodeInput.value = roomCode;

        // Show the "room detected" banner when present (cosmetic only)
        if (elements.autoJoinMessage && elements.detectedRoomCode) {
            elements.detectedRoomCode.textContent = roomCode;
            elements.autoJoinMessage.style.display = 'block';
        }

        // Generate a random name if the user hasn't set one
        if (!gameState.nameSet && !elements.playerNameInput.value.trim()) {
            elements.playerNameInput.value = generateRandomName();
            // Don't set nameSet flag here to allow user to change it
        }

        // Always attempt the join - don't gate it on the banner elements
        joinGame();
    }
});

/**
 * Find the most recent saved reconnect record across all rooms in
 * browser storage. Lets a phone that fully reloaded after sleeping rejoin
 * even when the room code was typed manually (no ?room= in the URL).
 * @returns {{player_id:any, player_name:string, room_code:string, seat_token?:string, lease_version?:number}|null}
 */
function findSavedReconnect() {
    const candidates = [];
    const readCandidatesFromStorage = (storage, prefix) => {
        if (!storage) return;
        try {
            const entryCount = typeof storage.length === 'number'
                ? storage.length
                : Object.keys(storage.snapshot?.() || {}).length;
            for (let i = 0; i < entryCount; i++) {
                const key = typeof storage.key === 'function'
                    ? storage.key(i)
                    : Object.keys(storage.snapshot?.() || {})[i];
                if (!key || !key.startsWith(prefix)) {
                    continue;
                }
                const parsed = parseStoredJson(storage.getItem(key));
                if (parsed?.room_code) {
                    candidates.push(parsed);
                }
            }
        } catch (e) {
            // storage unavailable / blocked
        }
    };

    readCandidatesFromStorage(getLocalStorageHandle(), ROOM_SEAT_STORAGE_PREFIX);
    readCandidatesFromStorage(getSessionStorageHandle(), LEGACY_RECONNECT_PREFIX);
    candidates.sort((a, b) => (b.last_joined_at || 0) - (a.last_joined_at || 0));
    return candidates[0] || null;
}

function syncTelemetryContextFromPayload(payload) {
    const telemetry = window.__JJ_TELEMETRY__;
    if (!telemetry || typeof telemetry.setContextFromPayload !== 'function') {
        return null;
    }
    return telemetry.setContextFromPayload(payload);
}

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    updateConnectionStatus(false);
    emitPlayerControllerTelemetry('gameplay:controller:disconnected', {
        reason: reason || 'disconnect',
        mode: gameState.gameMode || 'unknown'
    });
    emitPlayerTelemetryEvent('error:network:disconnect', {
        reason: reason || 'disconnect',
        mode: gameState.gameMode || 'unknown',
    });
});

socket.on('reconnect_attempt', (attempt) => {
    emitPlayerControllerTelemetry('gameplay:controller:reconnect_attempted', {
        attempt: Number.isFinite(attempt) ? attempt : 1,
        mode: gameState.gameMode || 'unknown',
    });
});

socket.on('connect_error', (error) => {
    emitPlayerControllerTelemetry('gameplay:controller:reconnect_failed', {
        reason: 'connect_error',
        mode: gameState.gameMode || 'unknown',
    });
    emitPlayerTelemetryEvent('error:network:disconnect', {
        reason: 'connect_error',
        mode: gameState.gameMode || 'unknown',
        networkPhase: 'connect',
    });
    emitPlayerTelemetryEvent('perf:connectivity:reconnect', {
        status: 'failed',
        reason: 'connect_error',
        mode: gameState.gameMode || 'unknown',
    });
});

socket.on('reconnect', (attempt) => {
    emitPlayerControllerTelemetry('gameplay:controller:reconnect_succeeded', {
        attempt: Number.isFinite(attempt) ? attempt : 1,
        mode: gameState.gameMode || 'unknown',
    });
    emitPlayerTelemetryEvent('perf:connectivity:reconnect', {
        status: 'success',
        attempt: Number.isFinite(attempt) ? attempt : 0,
        mode: gameState.gameMode || 'unknown',
    });
});

socket.on('join_error', (data) => {
    hasEmittedJoinStartedTelemetry = false;
    setJoinBusy(false);
    if (!hasJoinFailedTelemetry) {
        emitPlayerTelemetryEvent('gameplay:join:failed', {
            reason: data?.message || 'join_failed',
            mode: gameState.gameMode || 'unknown'
        });
        hasJoinFailedTelemetry = true;
        setTimeout(() => {
            hasJoinFailedTelemetry = false;
        }, 1500);
    }
    showError(friendlyJoinError(data.message));
    elements.roomCodeInput?.focus();
});

function handleSuccessfulJoin(data) {
    syncTelemetryContextFromPayload(data);
    gameState.playerId = data.player_id;
    gameState.seatId = data.seat_id ?? data.player_id ?? null;
    gameState.seatToken = data.seat_token || gameState.seatToken || null;
    gameState.leaseVersion = data.lease_version ?? gameState.leaseVersion ?? null;
    gameState.clientInstanceId = data.client_instance_id || getClientInstanceId();
    gameState.role = data.role || gameState.role || null;
    gameState.carColor = data.car_color;
    gameState.roomPhase = data.phase || phaseFromGameState(data.game_state);
    hasEmittedJoinStartedTelemetry = false;
    hasEmittedFirstInputTelemetry = false;
    emitPlayerTelemetryEvent('gameplay:join:completed', {
        mode: gameState.gameMode || 'unknown',
        joinPath: data.is_late_join ? 'late_join' : 'join_game'
    });
    emitPlayerTelemetryEvent('gameplay:player:joined', {
        mode: gameState.gameMode || 'unknown',
        joinCompleted: true
    });

    if (data.mode) {
        gameState.gameMode = data.mode;
        updateModeDisplay(data.mode);
    }

    syncCurrentSeatRecord();
    ensureWaitingRoomIdentityUI();

    const nextPhase = data.phase || phaseFromGameState(data.game_state);
    if (ACTIVE_ROOM_PHASES.has(nextPhase)) {
        const message = data.reconnected
            ? 'Reconnected! You are back in the race.'
            : (data.is_late_join ? 'Joined the race! Good luck catching up!' : null);
        applyRoomPhaseState(nextPhase, {
            message,
            duration: data.is_late_join ? 2500 : 2000
        });
        return;
    }

    if (nextPhase === 'host_lost') {
        applyRoomPhaseState(nextPhase, {
            message: 'Host connection lost. Holding your seat while it reconnects.',
            duration: 3500
        });
        return;
    }

    applyRoomPhaseState(nextPhase);
}

socket.on('game_joined', (data) => {
    setJoinBusy(false);
    handleSuccessfulJoin(data);
});

socket.on('controller_takeover_required', (data) => {
    setJoinBusy(false);
    gameState.seatId = data.seat_id ?? gameState.seatId;
    gameState.playerId = data.player_id ?? gameState.playerId;
    gameState.leaseVersion = data.lease_version ?? gameState.leaseVersion;
    gameState.roomPhase = data.phase || gameState.roomPhase;

    const confirmTakeover = window.confirm?.(
        `${data.player_name || gameState.playerName || 'This seat'} is already connected on another controller. Take over this seat here?`
    );
    if (!confirmTakeover) {
        showMessage('Seat takeover cancelled.', 1800);
        return;
    }

    const roomCode = gameState.roomCode || elements.roomCodeInput.value.trim().toUpperCase();
    const savedSeat = readStoredSeatRecord(roomCode);
    socket.emit('confirm_controller_takeover', {
        room_code: roomCode,
        seat_id: data.seat_id,
        seat_token: gameState.seatToken || savedSeat?.seat_token || null,
        client_instance_id: getClientInstanceId()
    });
    setJoinBusy(true);
});

socket.on('seat_taken_over', (data) => {
    gameState.leaseVersion = data.lease_version ?? gameState.leaseVersion;
    gameState.roomPhase = 'waiting';
    if (gameState.gameStarted) {
        releaseAllControls({ emitPacket: false });
    }
    gameState.gameStarted = false;
    ensureWaitingRoomIdentityUI();
    showScreen('waiting');
    showError('This controller was taken over on another device.');
});

socket.on('player_kicked', (data = {}) => {
    // Host removed this car (br-kick-car): bounce to the join flow, not frozen.
    if (gameState.gameStarted) {
        releaseAllControls({ emitPacket: false });
    }
    // Clear the saved seat so the phone rejoins fresh (no ghost reconnect).
    clearStoredSeatRecord(gameState.roomCode);
    gameState.gameStarted = false;
    gameState.playerId = null;
    gameState.seatId = null;
    gameState.seatToken = null;
    gameState.roomPhase = 'idle';
    showScreen('join');
    showError('You were removed by the host — you can rejoin.');
});

socket.on('room_phase', (data) => {
    syncTelemetryContextFromPayload(data);
    if (data.mode) {
        gameState.gameMode = data.mode;
        updateModeDisplay(data.mode);
    }
    applyRoomPhaseState(data.phase || phaseFromGameState(data.game_state));
});

socket.on('game_started', (data = {}) => {
    syncTelemetryContextFromPayload(data);
    applyRoomPhaseState(data.phase || 'active');
});

// Handle mode selection from host
socket.on('mode_selected', (data) => {
    console.log('Mode selected:', data);
    gameState.gameMode = data.mode;
    updateModeDisplay(data.mode);
});

// Handle weapon pickup notification from host
socket.on('weapon_pickup', (data) => {
    gameState.weapon = {
        id: data.weaponId,
        name: data.weaponName,
        icon: data.icon || getWeaponIcon(data.weaponId)
    };
    updateWeaponDisplay();
    hapticBuzz([30, 40, 60]);
});

// Handle weapon fired (used) notification
socket.on('weapon_fired', (data) => {
    gameState.weapon = null;
    updateWeaponDisplay();
});

socket.on('host_disconnected', (data = {}) => {
    syncTelemetryContextFromPayload(data);
    if (data.mode) {
        gameState.gameMode = data.mode;
        updateModeDisplay(data.mode);
    }
    applyRoomPhaseState(data.phase || 'host_lost', {
        message: `Host disconnected. Holding your seat${data.grace_seconds ? ` for ${data.grace_seconds} seconds` : ''} while the room reconnects.`,
        duration: 3500
    });
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
        syncCurrentSeatRecord();
        if (elements.displayName) {
            elements.displayName.textContent = data.name;
        }
        console.log(`Name updated to: ${data.name}`);
    }
});

// Add socket event handler for errors
socket.on('error', (data) => {
    setJoinBusy(false);
    showError(friendlyJoinError(data.message));
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

    if (!hasEmittedJoinStartedTelemetry) {
        emitPlayerTelemetryEvent('gameplay:join:started', {
            routePath: window.location.pathname,
            mode: gameState.gameMode || 'unknown'
        });
        hasEmittedJoinStartedTelemetry = true;
        emitPlayerControllerTelemetry('gameplay:join:route_viewed', {
            routePath: window.location.pathname,
            gameMode: gameState.gameMode || 'unknown'
        });
    }
    
    // Store values
    gameState.playerName = playerName;
    gameState.roomCode = roomCode;
    gameState.nameSet = true; // Mark name as set when joining
    
    // Hide the auto-join timer if it's visible
    if (elements.joinTimerDisplay) {
        elements.joinTimerDisplay.style.display = 'none';
    }
    
    // Show a joining message + busy button
    setJoinBusy(true);
    showMessage('Joining game...', 1000);

    const savedSeat = readStoredSeatRecord(roomCode);
    const reconnectId = savedSeat?.player_id ?? null;
    const seatToken = savedSeat?.seat_token ?? gameState.seatToken ?? null;
    const clientInstanceId = getClientInstanceId();
    if (savedSeat?.room_code === roomCode) {
        console.log('Found saved seat data, attempting to rejoin seat', savedSeat.seat_id || reconnectId);
    }

    // Join game
    socket.emit('join_game', {
        player_name: playerName,
        room_code: roomCode,
        reconnect_id: reconnectId,
        seat_token: seatToken,
        lease_version: savedSeat?.lease_version ?? gameState.leaseVersion ?? null,
        client_instance_id: clientInstanceId
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

// Toggle the join button between idle and a "Joining…" busy state. The button
// stays clickable for tests but visually communicates progress to the player.
function setJoinBusy(busy) {
    if (!elements.joinButton) return;
    if (busy) {
        elements.joinButton.dataset.idleLabel = elements.joinButton.dataset.idleLabel
            || elements.joinButton.textContent;
        elements.joinButton.textContent = 'Joining…';
        elements.joinButton.classList.add('joining');
    } else {
        elements.joinButton.textContent = elements.joinButton.dataset.idleLabel || 'Join Race';
        elements.joinButton.classList.remove('joining');
    }
}

// Map raw server errors to friendly, actionable copy for the join screen.
function friendlyJoinError(message) {
    if (typeof message === 'string' && /invalid room code/i.test(message)) {
        return "That room code wasn't found — check the big screen and try again.";
    }
    return message || 'Something went wrong. Please try again.';
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

    // Toggle portrait-mode rotate message (only show during game)
    document.body.classList.toggle('game-active', screenName === 'game');

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

    if (tutorialState.active) {
        setTimeout(renderTutorialStep, 0);
    }
}

/**
 * Get weapon icon by weapon ID
 * @param {string} weaponId
 * @returns {string} Emoji icon
 */
function getWeaponIcon(weaponId) {
    const icons = {
        'missile': '\uD83D\uDE80',
        'mine': '\uD83D\uDCA3',
        'boost': '\uD83D\uDD25',
        'shield': '\uD83D\uDEE1\uFE0F',
        'emp': '\u26A1',
        'sniper': '\u26A1',
        'oil-slick': '\uD83D\uDEE2\uFE0F',
        'flamethrower': '\uD83D\uDD25'
    };
    return icons[weaponId] || '\u2753';
}

/**
 * Update the weapon display on the controller
 */
function updateWeaponDisplay() {
    const weaponIndicator = document.getElementById('weapon-indicator');
    const fireBtn = document.getElementById('fire-btn');

    if (weaponIndicator) {
        if (gameState.weapon) {
            weaponIndicator.innerHTML = `${gameState.weapon.icon}<span>${gameState.weapon.name}</span>`;
            weaponIndicator.classList.add('has-weapon');
        } else {
            weaponIndicator.innerHTML = '<span>No Weapon</span>';
            weaponIndicator.classList.remove('has-weapon');
        }
    }

    if (fireBtn) {
        if (gameState.weapon) {
            fireBtn.classList.add('enabled');
            fireBtn.style.opacity = '1';
            fireBtn.innerHTML = `${gameState.weapon.icon}<br>FIRE`;
        } else {
            fireBtn.classList.remove('enabled');
            fireBtn.style.opacity = '0.3';
            fireBtn.innerHTML = 'FIRE';
        }
    }
}

/**
 * Fire weapon
 */
function fireWeapon() {
    if (!gameState.weapon) {
        console.log('No weapon to fire');
        return;
    }

    socket.emit('weapon_fire', {
        room_code: gameState.roomCode,
        player_id: gameState.playerId
    });
    hapticBuzz(40);

    // Optimistically clear weapon (server will confirm)
    gameState.weapon = null;
    updateWeaponDisplay();
}

/**
 * Update the mode display in the waiting room
 * @param {string} mode - 'race' or 'derby'
 */
function updateModeDisplay(mode) {
    const modeDisplay = document.querySelector('.mode-display');
    const modeIcon = document.getElementById('mode-icon');
    const modeName = document.getElementById('mode-name');
    const waitingText = document.getElementById('waiting-text');

    if (modeDisplay) {
        modeDisplay.setAttribute('data-mode', mode);
    }

    if (modeIcon) {
        modeIcon.textContent = mode === 'derby' ? '💥' : '🏁';
    }

    if (modeName) {
        modeName.textContent = mode === 'derby' ? 'DERBY' : 'RACE';
    }

    if (waitingText) {
        waitingText.textContent = mode === 'derby'
            ? 'The host will start the derby soon'
            : 'The host will start the race soon';
    }
}

function resetGame() {
    // Reset game state
    gameState.playerName = '';
    gameState.roomCode = null;
    gameState.playerId = null;
    gameState.seatId = null;
    gameState.seatToken = null;
    gameState.leaseVersion = null;
    gameState.roomPhase = 'waiting';
    gameState.role = null;
    gameState.carColor = null;
    gameState.gameStarted = false;
    
    // Reset controls
    keyboardPressedCodes.clear();
    lastControlFrameTime = null;
    if (controlMapper) {
        controlMapper.reset();
        syncControlsFromMapper();
    } else {
        gameState.controls.steering = 0;
        gameState.controls.acceleration = 0;
        gameState.controls.braking = 0;
        updateFireButtonPressedState(false);
    }
    gameState.touchControls.accelerateTouchId = null;
    gameState.touchControls.brakeTouchId = null;
    gameState.touchControls.fireTouchId = null;
    
    // Reset inputs
    elements.playerNameInput.value = '';
    elements.roomCodeInput.value = '';
    
    // Show join screen
    showScreen('join');
}

function initCarPreview() {
    // Rejoining re-runs this; drop the old canvas so previews don't stack
    elements.carPreview.innerHTML = '';

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
    
    // Animation loop for preview - stops once the game starts or this
    // canvas has been replaced by a newer preview (rejoin)
    function animatePreview() {
        if (!gameState.gameStarted && previewRenderer.domElement.isConnected) {
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
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    carGroup.add(body);

    // Car roof
    const roofGeometry = new THREE.BoxGeometry(1.5, 0.7, 2);
    const roofMaterial = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = 1.35;
    roof.position.z = -0.2;
    carGroup.add(roof);

    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16);
    const wheelMaterial = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });
    
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

    const touchSchemeId = controlMapper?.getRemapState?.()?.touch?.schemeId || 'classic';
    const touchLayout = ControlMapperClass?.TOUCH_SCHEMES?.[touchSchemeId]?.layout || {
        steeringSide: 'left',
        pedalsSide: 'right'
    };
    elements.controlsContainer.dataset.touchScheme = touchSchemeId;
    steeringArea.dataset.side = touchLayout.steeringSide;
    pedalsArea.dataset.side = touchLayout.pedalsSide;

    // Add accelerate and brake buttons to pedals area
    const accelerateBtn = document.createElement('div');
    accelerateBtn.id = 'accelerate-btn';
    accelerateBtn.innerHTML = '↑';

    const brakeBtn = document.createElement('div');
    brakeBtn.id = 'brake-btn';
    brakeBtn.innerHTML = '↓';

    pedalsArea.appendChild(accelerateBtn);
    pedalsArea.appendChild(brakeBtn);

    // Add areas to container in the selected touch layout order.
    if (touchLayout.steeringSide === 'right') {
        elements.controlsContainer.appendChild(pedalsArea);
        elements.controlsContainer.appendChild(steeringArea);
    } else {
        elements.controlsContainer.appendChild(steeringArea);
        elements.controlsContainer.appendChild(pedalsArea);
    }

    // Add fire button and weapon indicator (weapons available in every mode)
    const weaponArea = document.createElement('div');
    weaponArea.id = 'weapon-area';
    weaponArea.className = 'weapon-area';

    // Weapon indicator shows current weapon
    const weaponIndicator = document.createElement('div');
    weaponIndicator.id = 'weapon-indicator';
    weaponIndicator.className = 'weapon-indicator';
    weaponIndicator.innerHTML = '<span>No Weapon</span>';

    // Fire button - triangle shaped
    const fireBtn = document.createElement('div');
    fireBtn.id = 'fire-btn';
    fireBtn.className = 'fire-btn';
    fireBtn.innerHTML = 'FIRE';
    fireBtn.style.opacity = '0.3'; // Disabled until weapon picked up

    weaponArea.appendChild(weaponIndicator);
    weaponArea.appendChild(fireBtn);
    elements.controlsContainer.appendChild(weaponArea);

    // Fire button touch handlers
    fireBtn.addEventListener('touchstart', handleFireStart, { passive: false });
    fireBtn.addEventListener('touchend', handleFireEnd, { passive: false });
    fireBtn.addEventListener('touchcancel', handleFireEnd, { passive: false });
    fireBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard/desktop fallback
    fireBtn.addEventListener('mousedown', handleFireStart);
    fireBtn.addEventListener('mouseup', handleFireEnd);

    elements.fireBtn = fireBtn;
    elements.weaponIndicator = weaponIndicator;

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

    bindKeyboardControls();
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

// Touch handlers for fire button with touch ID tracking
function handleFireStart(e) {
    e.preventDefault();

    // Mouse/desktop fallback
    if (!e.changedTouches) {
        setTouchFire(true);
        return;
    }

    for (const touch of e.changedTouches) {
        if (gameState.touchControls.fireTouchId === null) {
            gameState.touchControls.fireTouchId = touch.identifier;
            setTouchFire(true);
            break;
        }
    }
}

function handleFireEnd(e) {
    if (!e.changedTouches) {
        setTouchFire(false);
        return;
    }

    for (const touch of e.changedTouches) {
        if (touch.identifier === gameState.touchControls.fireTouchId) {
            gameState.touchControls.fireTouchId = null;
            setTouchFire(false);
            break;
        }
    }
}

/**
 * Trigger haptic feedback where supported (Android Chrome etc.)
 * @param {number|number[]} pattern - Vibration pattern in ms
 */
function hapticBuzz(pattern) {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

// Old steering functions removed - now using Joystick class

function updateFireButtonPressedState(isPressed) {
    if (elements.fireBtn) {
        elements.fireBtn.classList.toggle('pressed', !!isPressed);
    }
}

function syncControlsFromMapper() {
    if (!controlMapper) {
        return {
            steering: gameState.controls.steering,
            acceleration: gameState.controls.acceleration,
            braking: gameState.controls.braking,
            fire: !!gameState.touchControls.fireTouchId
        };
    }

    const mappedControls = controlMapper.getControls();
    gameState.controls.steering = mappedControls.steering;
    gameState.controls.acceleration = mappedControls.acceleration;
    gameState.controls.braking = mappedControls.braking;
    updateFireButtonPressedState(mappedControls.fire);
    return mappedControls;
}

function stepControlMapper(dtMs = 0) {
    if (!controlMapper) {
        return syncControlsFromMapper();
    }

    pollGamepadControls();
    controlMapper.step(dtMs);
    return syncControlsFromMapper();
}

function advanceControlFrame(frameTime = performance.now()) {
    const currentTime = Number.isFinite(frameTime) ? frameTime : performance.now();
    const dtMs = lastControlFrameTime === null
        ? 0
        : Math.max(0, currentTime - lastControlFrameTime);
    lastControlFrameTime = currentTime;

    const controls = stepControlMapper(dtMs);
    if (controlMapper && controlMapper.consumeFirePressed() && gameState.gameStarted) {
        fireWeapon();
    }

    return controls;
}

function buildControlPacket(timestamp = Date.now()) {
    const controls = syncControlsFromMapper();
    return {
        player_id: gameState.playerId,
        seat_id: gameState.seatId,
        room_code: gameState.roomCode,
        lease_version: gameState.leaseVersion,
        client_instance_id: getClientInstanceId(),
        controls: {
            steering: controls.steering,
            acceleration: controls.acceleration,
            braking: controls.braking
        },
        timestamp
    };
}

function emitControlUpdate(currentTime = performance.now(), options = {}) {
    const { force = false } = options;
    const now = Number.isFinite(currentTime) ? currentTime : performance.now();
    const elapsed = now - lastInputUpdate;

    if (!force && elapsed < INPUT_SEND_INTERVAL) {
        return null;
    }

    // Stop streaming control payloads once a build skew is detected: a stale
    // client must not keep driving a possibly-changed server contract. The
    // reload banner (buildSkewBanner.js) tells the player how to recover.
    if (window.__buildStale) {
        lastInputUpdate = now;
        return null;
    }

    const playerControlUpdate = buildControlPacket(Date.now());
    socket.emit('player_control_update', playerControlUpdate);

    lastInputTimestamp = Date.now();
    if (!hasEmittedFirstInputTelemetry) {
        const hasNonZeroInput = playerControlUpdate.controls?.steering !== 0
            || playerControlUpdate.controls?.acceleration !== 0
            || playerControlUpdate.controls?.braking !== 0;
        if (hasNonZeroInput) {
            emitPlayerControllerTelemetry('gameplay:join:first_input', {
                gamePhase: gameState.roomPhase || 'active'
            });
            hasEmittedFirstInputTelemetry = true;
        }
    }

    if (!errorLog.info) {
        errorLog.info = function(message, timeout = 1000) {
            const infoElement = document.createElement('div');
            infoElement.className = 'info-log-item';
            infoElement.style.backgroundColor = 'rgba(0, 100, 0, 0.7)';
            infoElement.style.color = 'white';
            infoElement.style.padding = '5px 8px';
            infoElement.style.marginBottom = '3px';
            infoElement.style.borderRadius = '4px';
            infoElement.style.fontFamily = 'monospace';
            infoElement.style.fontSize = '11px';
            infoElement.style.opacity = '0.7';
            infoElement.style.transition = 'opacity 0.3s';

            const time = new Date().toLocaleTimeString();
            infoElement.textContent = `[${time}] ${message}`;

            if (!this.container) {
                this.init();
            }

            this.container.appendChild(infoElement);

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

    lastInputUpdate = now;
    return playerControlUpdate;
}

function normalizeKeyboardControlCode(event) {
    if (!event) return null;

    const normalized = normalizeKeyboardBindingCode(event);
    if (!normalized) {
        return null;
    }

    if (controlMapper?.getKnownKeyboardCodes?.().has(normalized)) {
        return normalized;
    }

    return CONTROL_KEY_CODES.has(normalized) ? normalized : null;
}

function isEditableControlTarget(target) {
    if (!target) return false;

    const tagName = typeof target.tagName === 'string'
        ? target.tagName.toUpperCase()
        : '';

    return !!target.isContentEditable
        || tagName === 'INPUT'
        || tagName === 'TEXTAREA'
        || tagName === 'SELECT';
}

function handleKeyboardControlEvent(event) {
    if (remapUiState.active) {
        return false;
    }

    const code = normalizeKeyboardControlCode(event);
    if (!code || !gameState.gameStarted || isEditableControlTarget(event.target)) {
        return false;
    }

    event.preventDefault?.();

    if (controlMapper) {
        if (!controlMapper.applyKeyboardEvent(event.type, code)) {
            return false;
        }
    } else if (event.type === 'keydown') {
        keyboardPressedCodes.add(code);
    } else if (event.type === 'keyup') {
        keyboardPressedCodes.delete(code);
    } else {
        return false;
    }

    syncControlsFromMapper();
    return true;
}

function bindKeyboardControls() {
    if (keyboardControlsBound) return;

    document.addEventListener('keydown', handleKeyboardControlEvent);
    document.addEventListener('keyup', handleKeyboardControlEvent);
    keyboardControlsBound = true;
}

function setSteering(value) {
    if (controlMapper) {
        controlMapper.setTouchSteering(value);
        syncControlsFromMapper();
        return;
    }

    gameState.controls.steering = value;
}

function setAcceleration(value) {
    if (controlMapper) {
        controlMapper.setTouchAcceleration(value);
        syncControlsFromMapper();
        return;
    }

    gameState.controls.acceleration = value;
}

function setBraking(value) {
    if (controlMapper) {
        controlMapper.setTouchBraking(value);
        syncControlsFromMapper();
        return;
    }

    gameState.controls.braking = value;
}

function setTouchFire(value) {
    if (controlMapper) {
        controlMapper.setTouchFire(value);
        syncControlsFromMapper();
        return;
    }

    updateFireButtonPressedState(value);
    if (value) {
        fireWeapon();
    }
}

// Release all controls and push the zeroed state to the server immediately.
// Used when the tab is hidden/locked so the car doesn't drive itself.
function releaseAllControls(options = {}) {
    const { emitPacket = gameState.gameStarted } = options;
    keyboardPressedCodes.clear();
    lastControlFrameTime = null;
    gameState.touchControls.accelerateTouchId = null;
    gameState.touchControls.brakeTouchId = null;
    gameState.touchControls.fireTouchId = null;

    if (gameState.touchControls.steeringJoystick?.setEnabled) {
        gameState.touchControls.steeringJoystick.setEnabled(false);
        gameState.touchControls.steeringJoystick.setEnabled(true);
    }

    if (controlMapper) {
        controlMapper.reset();
        syncControlsFromMapper();
    } else {
        gameState.controls.steering = 0;
        gameState.controls.acceleration = 0;
        gameState.controls.braking = 0;
        updateFireButtonPressedState(false);
    }

    if (emitPacket && gameState.playerId && gameState.roomCode) {
        emitControlUpdate(performance.now(), { force: true });
    }
}

document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
        releaseAllControls();
        emitPlayerVisibilityTelemetry('background');
        emitPlayerControllerTelemetry('gameplay:controller:visibility_change', {
            visibilityState: 'background'
        });
    } else {
        emitPlayerVisibilityTelemetry('foreground');
        emitPlayerControllerTelemetry('gameplay:controller:visibility_change', {
            visibilityState: 'foreground'
        });
    }
});

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
function handleInput(currentTime = performance.now()) {
    return emitControlUpdate(currentTime);
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

// Controls/speed debug overlay - hidden unless the page is opened with
// ?debug=1 (it covers the controls and means nothing to players)
const SHOW_INPUT_DEBUG = getUrlParameter('debug') === '1';

// Add visual indicator for controls and server-reported speed
function updateInputIndicator() {
    // If game hasn't started, we don't need to update anything
    if (!SHOW_INPUT_DEBUG || !gameState.gameStarted) {
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

function registerPlayerControlMapperTestHooks() {
    window.__playerControlMapperTestHooks = {
        setSession(nextState = {}) {
            if ('playerId' in nextState) gameState.playerId = nextState.playerId;
            if ('seatId' in nextState) gameState.seatId = nextState.seatId;
            if ('seatToken' in nextState) gameState.seatToken = nextState.seatToken;
            if ('leaseVersion' in nextState) gameState.leaseVersion = nextState.leaseVersion;
            if ('clientInstanceId' in nextState) gameState.clientInstanceId = nextState.clientInstanceId;
            if ('roomCode' in nextState) gameState.roomCode = nextState.roomCode;
            if ('gameStarted' in nextState) gameState.gameStarted = nextState.gameStarted;
            if ('weapon' in nextState) gameState.weapon = nextState.weapon;
            return syncControlsFromMapper();
        },
        applyTouchIntent(nextControls = {}) {
            if ('steering' in nextControls) setSteering(nextControls.steering);
            if ('acceleration' in nextControls) setAcceleration(nextControls.acceleration);
            if ('braking' in nextControls) setBraking(nextControls.braking);
            if ('fire' in nextControls) setTouchFire(nextControls.fire);
            return syncControlsFromMapper();
        },
        dispatchKeyboardEvent(type, init = {}) {
            const event = {
                type,
                key: init.key,
                code: init.code,
                repeat: !!init.repeat,
                target: init.target || document.body,
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true;
                }
            };
            handleKeyboardControlEvent(event);
            return event;
        },
        advanceFrame(dtMs = 16.667) {
            if (lastControlFrameTime === null) {
                lastControlFrameTime = 0;
            }
            const nextFrameTime = lastControlFrameTime + dtMs;
            return advanceControlFrame(nextFrameTime);
        },
        buildControlPacket(timestamp = Date.now()) {
            return buildControlPacket(timestamp);
        },
        emitControlUpdate(currentTime = performance.now(), options = {}) {
            return emitControlUpdate(currentTime, options);
        },
        getControls() {
            return { ...gameState.controls };
        },
        getControlDebug() {
            return controlMapper ? controlMapper.getDebugValues() : null;
        },
        getRemapState() {
            return getCurrentRemapState();
        },
        rebuildGameControls() {
            initGameControls();
            return this.getTouchLayout();
        },
        getTouchLayout() {
            return {
                schemeId: elements.controlsContainer?.dataset?.touchScheme || null,
                childIds: Array.from(elements.controlsContainer?.children || []).map((child) => child.id)
            };
        },
        openRemapModal() {
            openControlRemapModal();
            return !elements.remapModal?.classList?.contains('hidden');
        },
        closeRemapModal() {
            closeControlRemapModal();
            return !elements.remapModal?.classList?.contains('hidden');
        },
        applyTouchScheme(schemeId) {
            applyTouchSchemeRemap(schemeId);
            return getCurrentRemapState();
        },
        applyKeyboardPreset(presetId) {
            applyKeyboardPresetRemap(presetId);
            return getCurrentRemapState();
        },
        setKeyboardBinding(action, code) {
            const result = controlMapper?.setKeyboardActionBinding(action, [code], {
                schemeId: 'custom',
                fallbackPresetId: getCurrentRemapState().keyboard.schemeId
            });
            if (result?.valid) {
                persistKeyboardRemap();
                renderControlRemapUI();
            }
            return result;
        },
        setGamepadBinding(action, token, sourceId = getCurrentGamepadSourceId()) {
            const result = controlMapper?.setGamepadActionBinding(action, [token], {
                schemeId: 'custom',
                sourceId,
                fallbackPresetId: getCurrentRemapState().gamepad.schemeId
            });
            if (result?.valid) {
                persistGamepadRemap(sourceId);
                renderControlRemapUI();
            }
            return result;
        },
        getSocketEmits() {
            if (typeof socket.getEmittedEvents === 'function') {
                return socket.getEmittedEvents();
            }
            return Array.isArray(socket.emitted) ? [...socket.emitted] : [];
        },
        clearSocketEmits() {
            if (Array.isArray(socket.emitted)) {
                socket.emitted.length = 0;
            }
        },
        releaseAllControls() {
            releaseAllControls();
            return syncControlsFromMapper();
        }
    };
}

// Main game loop for updating UI based on server data and sending controls
function updateLoop(frameTime) {
    if (gameState.gameStarted) {
        advanceControlFrame(frameTime);
        handleInput(frameTime);
        updateInputIndicator();
    } else {
        lastControlFrameTime = null;
    }

    requestAnimationFrame(updateLoop);
}

bindKeyboardControls();
registerPlayerControlMapperTestHooks();
syncControlsFromMapper();

// Start update loop
requestAnimationFrame(updateLoop);

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
