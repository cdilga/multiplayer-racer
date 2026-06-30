/**
 * ControlMapper - canonical input shape for all controller input sources.
 *
 * The mapper keeps raw source state for diagnostics and produces one merged
 * control contract: { steering, acceleration, braking, fire }.
 *
 * Touch steering shaping stays separate from raw input so debugging and
 * validation can inspect the clamped, unshaped thumb intent directly.
 */

const KEYBOARD_ACTIONS = Object.freeze([
    'steerLeft',
    'steerRight',
    'accelerate',
    'brake',
    'fire'
]);

const TOUCH_SCHEMES = Object.freeze({
    classic: {
        id: 'classic',
        name: 'Classic',
        description: 'Steer on the left, pedals on the right.',
        summary: 'Steer left · pedals right',
        layout: {
            steeringSide: 'left',
            pedalsSide: 'right'
        }
    },
    southpaw: {
        id: 'southpaw',
        name: 'Southpaw',
        description: 'Steer on the right, pedals on the left.',
        summary: 'Steer right · pedals left',
        layout: {
            steeringSide: 'right',
            pedalsSide: 'left'
        }
    }
});

const KEYBOARD_REGION_PRESETS = Object.freeze({
    hybrid: {
        id: 'hybrid',
        name: 'WASD + Arrows',
        summary: 'WASD + Arrows',
        bindings: {
            steerLeft: ['KeyA', 'ArrowLeft'],
            steerRight: ['KeyD', 'ArrowRight'],
            accelerate: ['KeyW', 'ArrowUp'],
            brake: ['KeyS', 'ArrowDown'],
            fire: ['Space']
        }
    },
    wasd: {
        id: 'wasd',
        name: 'WASD',
        summary: 'WASD',
        bindings: {
            steerLeft: ['KeyA'],
            steerRight: ['KeyD'],
            accelerate: ['KeyW'],
            brake: ['KeyS'],
            fire: ['Space']
        }
    },
    arrows: {
        id: 'arrows',
        name: 'Arrows',
        summary: 'Arrows',
        bindings: {
            steerLeft: ['ArrowLeft'],
            steerRight: ['ArrowRight'],
            accelerate: ['ArrowUp'],
            brake: ['ArrowDown'],
            fire: ['Space']
        }
    },
    ijkl: {
        id: 'ijkl',
        name: 'IJKL',
        summary: 'IJKL',
        bindings: {
            steerLeft: ['KeyJ'],
            steerRight: ['KeyL'],
            accelerate: ['KeyI'],
            brake: ['KeyK'],
            fire: ['KeyO']
        }
    }
});

const GAMEPAD_BINDING_PRESETS = Object.freeze({
    standard: {
        id: 'standard',
        name: 'Standard Pad',
        summary: 'Left stick · triggers · south button',
        bindings: {
            steerLeft: ['axis:left-stick-x:negative', 'button:dpad-left'],
            steerRight: ['axis:left-stick-x:positive', 'button:dpad-right'],
            accelerate: ['button:rt'],
            brake: ['button:lt'],
            fire: ['button:south']
        }
    },
    dpadShoulders: {
        id: 'dpadShoulders',
        name: 'D-pad + Shoulders',
        summary: 'D-pad · shoulders · south button',
        bindings: {
            steerLeft: ['button:dpad-left'],
            steerRight: ['button:dpad-right'],
            accelerate: ['button:rb'],
            brake: ['button:lb'],
            fire: ['button:south']
        }
    }
});

const GAMEPAD_BINDING_OPTIONS = Object.freeze({
    steerLeft: [
        { value: 'axis:left-stick-x:negative', label: 'Left stick ←' },
        { value: 'button:dpad-left', label: 'D-pad left' }
    ],
    steerRight: [
        { value: 'axis:left-stick-x:positive', label: 'Left stick →' },
        { value: 'button:dpad-right', label: 'D-pad right' }
    ],
    accelerate: [
        { value: 'button:rt', label: 'Right trigger' },
        { value: 'button:rb', label: 'Right shoulder' },
        { value: 'button:south', label: 'South / A' }
    ],
    brake: [
        { value: 'button:lt', label: 'Left trigger' },
        { value: 'button:lb', label: 'Left shoulder' },
        { value: 'button:east', label: 'East / B' }
    ],
    fire: [
        { value: 'button:south', label: 'South / A' },
        { value: 'button:rb', label: 'Right shoulder' },
        { value: 'button:north', label: 'North / Y' }
    ]
});

const GAMEPAD_BUTTON_INDEX = Object.freeze({
    south: 0,
    east: 1,
    west: 2,
    north: 3,
    lb: 4,
    rb: 5,
    lt: 6,
    rt: 7,
    back: 8,
    start: 9,
    ls: 10,
    rs: 11,
    'dpad-up': 12,
    'dpad-down': 13,
    'dpad-left': 14,
    'dpad-right': 15
});

const GAMEPAD_AXIS_INDEX = Object.freeze({
    'left-stick-x': 0,
    'left-stick-y': 1,
    'right-stick-x': 2,
    'right-stick-y': 3
});

const KEY_LABELS = Object.freeze({
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Space: 'Space'
});

const GAMEPAD_TOKEN_LABELS = Object.freeze({
    'axis:left-stick-x:negative': 'Left stick ←',
    'axis:left-stick-x:positive': 'Left stick →',
    'button:dpad-left': 'D-pad left',
    'button:dpad-right': 'D-pad right',
    'button:lt': 'Left trigger',
    'button:rt': 'Right trigger',
    'button:lb': 'Left shoulder',
    'button:rb': 'Right shoulder',
    'button:south': 'South / A',
    'button:east': 'East / B',
    'button:north': 'North / Y'
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function moveTowards(current, target, maxDelta) {
    if (current === target) return current;
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
}

function cloneObject(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => cloneObject(entry));
    }

    const next = {};
    for (const [key, entry] of Object.entries(value)) {
        next[key] = cloneObject(entry);
    }
    return next;
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }

    return [];
}

function getKeyboardPreset(presetId) {
    return KEYBOARD_REGION_PRESETS[presetId] || KEYBOARD_REGION_PRESETS.hybrid;
}

function getGamepadPreset(presetId) {
    return GAMEPAD_BINDING_PRESETS[presetId] || GAMEPAD_BINDING_PRESETS.standard;
}

function normalizeKeyboardBindings(bindings, presetId = 'hybrid') {
    const normalized = cloneObject(getKeyboardPreset(presetId).bindings);
    if (!bindings || typeof bindings !== 'object') {
        return normalized;
    }

    for (const action of KEYBOARD_ACTIONS) {
        if (action in bindings) {
            normalized[action] = normalizeStringArray(bindings[action]);
        }
    }

    return normalized;
}

function normalizeGamepadBindings(bindings, presetId = 'standard') {
    const normalized = cloneObject(getGamepadPreset(presetId).bindings);
    if (!bindings || typeof bindings !== 'object') {
        return normalized;
    }

    for (const action of KEYBOARD_ACTIONS) {
        if (action in bindings) {
            normalized[action] = normalizeStringArray(bindings[action]);
        }
    }

    return normalized;
}

function summarizeKeyboardPreset(presetId) {
    if (!KEYBOARD_REGION_PRESETS[presetId]) {
        return 'Custom keyboard';
    }
    return getKeyboardPreset(presetId).summary;
}

function summarizeTouchScheme(schemeId) {
    return (TOUCH_SCHEMES[schemeId] || TOUCH_SCHEMES.classic).summary;
}

function summarizeGamepadPreset(presetId) {
    if (!GAMEPAD_BINDING_PRESETS[presetId]) {
        return 'Custom pad';
    }
    return getGamepadPreset(presetId).summary;
}

function describeKeyboardCode(code) {
    if (KEY_LABELS[code]) {
        return KEY_LABELS[code];
    }

    if (typeof code !== 'string') {
        return '';
    }

    if (code.startsWith('Key') && code.length === 4) {
        return code.slice(3);
    }

    if (code.startsWith('Digit') && code.length === 6) {
        return code.slice(5);
    }

    return code;
}

function describeKeyboardBindingList(codes) {
    return normalizeStringArray(codes)
        .map((code) => describeKeyboardCode(code))
        .join(' / ');
}

function describeGamepadBindingList(tokens) {
    return normalizeStringArray(tokens)
        .map((token) => GAMEPAD_TOKEN_LABELS[token] || token)
        .join(' / ');
}

function collectBindingConflicts(bindings) {
    const seen = new Map();
    const conflicts = [];

    for (const action of KEYBOARD_ACTIONS) {
        for (const binding of normalizeStringArray(bindings[action])) {
            const existing = seen.get(binding);
            if (existing && existing !== action) {
                conflicts.push({
                    input: binding,
                    actions: [existing, action]
                });
                continue;
            }
            seen.set(binding, action);
        }
    }

    return conflicts;
}

function validateKeyboardBindings(bindings) {
    const normalized = normalizeKeyboardBindings(bindings);
    const errors = [];

    for (const action of KEYBOARD_ACTIONS) {
        if (normalized[action].length === 0) {
            errors.push(`Missing required keyboard binding for ${action}.`);
        }
    }

    const conflicts = collectBindingConflicts(normalized);
    if (conflicts.length > 0) {
        for (const conflict of conflicts) {
            const label = describeKeyboardCode(conflict.input);
            errors.push(`Keyboard conflict: ${label} is assigned to ${conflict.actions.join(' and ')}.`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        conflicts,
        bindings: normalized
    };
}

function isKnownGamepadToken(token) {
    if (typeof token !== 'string') return false;
    if (token.startsWith('button:')) {
        return token.slice(7) in GAMEPAD_BUTTON_INDEX;
    }

    if (!token.startsWith('axis:')) {
        return false;
    }

    const [, axisName, direction] = token.split(':');
    return axisName in GAMEPAD_AXIS_INDEX && (direction === 'negative' || direction === 'positive');
}

function validateGamepadBindings(bindings, options = {}) {
    const normalized = normalizeGamepadBindings(bindings, options.presetId);
    const errors = [];
    const warnings = [];

    for (const action of KEYBOARD_ACTIONS) {
        if (normalized[action].length === 0) {
            errors.push(`Missing required gamepad binding for ${action}.`);
            continue;
        }

        for (const binding of normalized[action]) {
            if (!isKnownGamepadToken(binding)) {
                errors.push(`Unknown gamepad binding token: ${binding}.`);
            }
        }
    }

    const conflicts = collectBindingConflicts(normalized);
    if (conflicts.length > 0) {
        for (const conflict of conflicts) {
            const label = GAMEPAD_TOKEN_LABELS[conflict.input] || conflict.input;
            errors.push(`Gamepad conflict: ${label} is assigned to ${conflict.actions.join(' and ')}.`);
        }
    }

    if (options.mapping && options.mapping !== 'standard') {
        warnings.push('Gamepad mapping is not standard; confirm this pad on-device before closing the bead.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        conflicts,
        bindings: normalized
    };
}

function validateTouchScheme(schemeId) {
    const valid = !!TOUCH_SCHEMES[schemeId];
    return {
        valid,
        errors: valid ? [] : [`Unknown touch scheme: ${schemeId}.`],
        schemeId: valid ? schemeId : 'classic'
    };
}

function getMovementMagnitude(controls) {
    return Math.max(
        Math.abs(controls?.steering || 0),
        controls?.acceleration || 0,
        controls?.braking || 0
    );
}

function readGamepadButtonValue(alias, buttons) {
    const index = GAMEPAD_BUTTON_INDEX[alias];
    if (index === undefined) {
        return 0;
    }

    const button = buttons?.[index];
    if (!button) {
        return 0;
    }

    if (typeof button.value === 'number') {
        return clamp(button.value, 0, 1);
    }

    return button.pressed ? 1 : 0;
}

function readGamepadAxisValue(axisName, direction, axes, deadZone) {
    const index = GAMEPAD_AXIS_INDEX[axisName];
    if (index === undefined) {
        return 0;
    }

    const rawValue = clamp(axes?.[index] ?? 0, -1, 1);
    let value = direction === 'negative'
        ? Math.max(0, -rawValue)
        : Math.max(0, rawValue);

    if (value <= deadZone) {
        return 0;
    }

    value = (value - deadZone) / (1 - deadZone);
    return clamp(value, 0, 1);
}

function readGamepadTokenValue(token, snapshot, deadZone) {
    if (typeof token !== 'string') {
        return 0;
    }

    if (token.startsWith('button:')) {
        return readGamepadButtonValue(token.slice(7), snapshot.buttons);
    }

    if (!token.startsWith('axis:')) {
        return 0;
    }

    const [, axisName, direction] = token.split(':');
    return readGamepadAxisValue(axisName, direction, snapshot.axes, deadZone);
}

class ControlMapper {
    constructor(options = {}) {
        this.options = {
            steeringRampUpPerSecond: options.steeringRampUpPerSecond ?? 4,
            steeringRampDownPerSecond: options.steeringRampDownPerSecond ?? 6,
            touchAccelerationRampUpMs: options.touchAccelerationRampUpMs ?? 220,
            touchAccelerationRampDownMs: options.touchAccelerationRampDownMs ?? 90,
            steeringDeadZone: options.steeringDeadZone ?? 0.1,
            steeringCurveExponent: options.steeringCurveExponent ?? 1.5,
            steeringSnapThreshold: options.steeringSnapThreshold ?? 0.03,
            steeringFilterLagMs: options.steeringFilterLagMs ?? 50,
            gamepadDeadZone: options.gamepadDeadZone ?? 0.15
        };

        this.bindingConfig = {
            touch: {
                schemeId: validateTouchScheme(options.touchSchemeId || 'classic').schemeId
            },
            keyboard: {
                schemeId: KEYBOARD_REGION_PRESETS[options.keyboardSchemeId] ? options.keyboardSchemeId : 'hybrid',
                bindings: normalizeKeyboardBindings(options.keyboardBindings, options.keyboardSchemeId || 'hybrid')
            },
            gamepad: {
                schemeId: GAMEPAD_BINDING_PRESETS[options.gamepadSchemeId] ? options.gamepadSchemeId : 'standard',
                bindings: normalizeGamepadBindings(options.gamepadBindings, options.gamepadSchemeId || 'standard'),
                sourceId: options.gamepadSourceId || 'standard'
            }
        };

        this.touchInput = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false
        };
        this.touchShaped = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false
        };
        this.keyboardTarget = {
            steering: 0,
            acceleration: 0,
            braking: 0
        };
        this.keyboardInput = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false
        };
        this.gamepadInput = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false
        };
        this.gamepadState = {
            connected: false,
            id: null,
            index: null,
            mapping: null
        };
        this.controls = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false
        };
        this.debugValues = {
            touchRaw: { ...this.touchInput },
            touchShaped: { ...this.touchShaped },
            keyboardRaw: { ...this.keyboardInput },
            keyboardTarget: { ...this.keyboardTarget },
            gamepadRaw: { ...this.gamepadInput, connected: false, mapping: null, sourceId: this.bindingConfig.gamepad.sourceId },
            merged: { ...this.controls },
            activeSource: 'touch',
            bindings: {},
            validation: {},
            tuning: {}
        };

        this.keyboardState = {
            keys: new Set()
        };
        this.pendingFirePress = false;
        this._steeringFilteredValue = 0;

        this._syncValidationState();
        this._refreshTouchShaped();
        this._updateMerged();
    }

    _applyDeadZone(value, threshold) {
        if (Math.abs(value) < threshold) return 0;
        const sign = Math.sign(value);
        const magnitude = Math.abs(value);
        return sign * ((magnitude - threshold) / (1 - threshold));
    }

    _applyCurve(value, exponent) {
        const sign = Math.sign(value);
        return sign * Math.pow(Math.abs(value), exponent);
    }

    _snapToZero(value, threshold) {
        return Math.abs(value) < threshold ? 0 : value;
    }

    _applyFilter(value, dtMs) {
        const lagSeconds = this.options.steeringFilterLagMs / 1000;
        const dtSeconds = Math.max(0, dtMs) / 1000;
        const alpha = dtSeconds / (lagSeconds + dtSeconds);
        this._steeringFilteredValue = (1 - alpha) * this._steeringFilteredValue + alpha * value;
        return this._steeringFilteredValue;
    }

    _shapeSteering(rawValue, dtMs = 16.667) {
        let shaped = rawValue;
        shaped = this._applyDeadZone(shaped, this.options.steeringDeadZone);
        shaped = this._applyCurve(shaped, this.options.steeringCurveExponent);
        shaped = this._applyFilter(shaped, dtMs);
        if (Math.abs(rawValue) <= this.options.steeringSnapThreshold) {
            shaped = this._snapToZero(shaped, this.options.steeringSnapThreshold);
        }
        return shaped;
    }

    _getTuningDebug() {
        return {
            touchAccelerationRampUpMs: this.options.touchAccelerationRampUpMs,
            touchAccelerationRampDownMs: this.options.touchAccelerationRampDownMs,
            steeringDeadZone: this.options.steeringDeadZone,
            steeringCurveExponent: this.options.steeringCurveExponent,
            steeringSnapThreshold: this.options.steeringSnapThreshold,
            steeringFilterLagMs: this.options.steeringFilterLagMs,
            gamepadDeadZone: this.options.gamepadDeadZone
        };
    }

    _resolveTouchAccelerationRampMs(current, target) {
        if (target > current) {
            return Math.max(1, this.options.touchAccelerationRampUpMs);
        }
        return Math.max(1, this.options.touchAccelerationRampDownMs);
    }

    _refreshTouchShaped(dtMs = 16.667, { advanceThrottle = true } = {}) {
        this.touchShaped.steering = clamp(
            this._shapeSteering(this.touchInput.steering, dtMs),
            -1,
            1
        );

        if (advanceThrottle) {
            const rampMs = this._resolveTouchAccelerationRampMs(
                this.touchShaped.acceleration,
                this.touchInput.acceleration
            );
            const maxDelta = Math.max(0, dtMs) / rampMs;
            this.touchShaped.acceleration = moveTowards(
                this.touchShaped.acceleration,
                this.touchInput.acceleration,
                maxDelta
            );
        }

        this.touchShaped.braking = this.touchInput.braking;
        this.touchShaped.fire = this.touchInput.fire;
        this.debugValues.touchShaped = { ...this.touchShaped };
    }

    _syncValidationState() {
        this.debugValues.bindings = this.getRemapState();
        this.debugValues.validation = {
            keyboard: validateKeyboardBindings(this.bindingConfig.keyboard.bindings),
            gamepad: validateGamepadBindings(this.bindingConfig.gamepad.bindings, {
                mapping: this.gamepadState.mapping,
                presetId: this.bindingConfig.gamepad.schemeId
            }),
            touch: validateTouchScheme(this.bindingConfig.touch.schemeId)
        };
        this.debugValues.tuning = this._getTuningDebug();
    }

    getKnownKeyboardCodes() {
        const keys = new Set();
        for (const codes of Object.values(this.bindingConfig.keyboard.bindings)) {
            for (const code of normalizeStringArray(codes)) {
                keys.add(code);
            }
        }
        return keys;
    }

    getRemapState() {
        return cloneObject({
            touch: {
                schemeId: this.bindingConfig.touch.schemeId,
                summary: summarizeTouchScheme(this.bindingConfig.touch.schemeId)
            },
            keyboard: {
                schemeId: this.bindingConfig.keyboard.schemeId,
                summary: summarizeKeyboardPreset(this.bindingConfig.keyboard.schemeId),
                bindings: this.bindingConfig.keyboard.bindings
            },
            gamepad: {
                schemeId: this.bindingConfig.gamepad.schemeId,
                sourceId: this.bindingConfig.gamepad.sourceId,
                summary: summarizeGamepadPreset(this.bindingConfig.gamepad.schemeId),
                bindings: this.bindingConfig.gamepad.bindings
            }
        });
    }

    getValidationState() {
        return cloneObject(this.debugValues.validation);
    }

    setTouchScheme(schemeId) {
        const validation = validateTouchScheme(schemeId);
        if (!validation.valid) {
            return validation;
        }

        this.bindingConfig.touch.schemeId = validation.schemeId;
        this._syncValidationState();
        return validation;
    }

    setKeyboardPreset(presetId) {
        const preset = getKeyboardPreset(presetId);
        this.bindingConfig.keyboard.schemeId = preset.id;
        this.bindingConfig.keyboard.bindings = normalizeKeyboardBindings(null, preset.id);
        this._updateKeyboardTargetsFromKeys();
        this._syncValidationState();
        this._updateMerged();
        return this.getValidationState().keyboard;
    }

    setKeyboardBindings(bindings, options = {}) {
        const nextBindings = normalizeKeyboardBindings(
            bindings,
            options.fallbackPresetId || this.bindingConfig.keyboard.schemeId
        );
        const validation = validateKeyboardBindings(nextBindings);
        if (!validation.valid) {
            return validation;
        }

        this.bindingConfig.keyboard.schemeId = options.schemeId || 'custom';
        this.bindingConfig.keyboard.bindings = validation.bindings;
        this._updateKeyboardTargetsFromKeys();
        this._syncValidationState();
        this._updateMerged();
        return validation;
    }

    setKeyboardActionBinding(action, codes, options = {}) {
        if (!KEYBOARD_ACTIONS.includes(action)) {
            return {
                valid: false,
                errors: [`Unknown keyboard action: ${action}.`],
                conflicts: []
            };
        }

        const nextBindings = cloneObject(this.bindingConfig.keyboard.bindings);
        nextBindings[action] = normalizeStringArray(codes);
        return this.setKeyboardBindings(nextBindings, {
            schemeId: options.schemeId || 'custom',
            fallbackPresetId: options.fallbackPresetId
        });
    }

    clearKeyboardActionBinding(action) {
        const defaults = normalizeKeyboardBindings(null, this.bindingConfig.keyboard.schemeId);
        return this.setKeyboardActionBinding(action, defaults[action], { schemeId: 'custom' });
    }

    setGamepadSource(sourceId) {
        this.bindingConfig.gamepad.sourceId = sourceId || 'standard';
        this.debugValues.gamepadRaw.sourceId = this.bindingConfig.gamepad.sourceId;
        this._syncValidationState();
    }

    setGamepadPreset(presetId, options = {}) {
        const preset = getGamepadPreset(presetId);
        this.bindingConfig.gamepad.schemeId = preset.id;
        this.bindingConfig.gamepad.bindings = normalizeGamepadBindings(null, preset.id);
        if (options.sourceId) {
            this.bindingConfig.gamepad.sourceId = options.sourceId;
        }
        this._syncValidationState();
        this._updateMerged();
        return this.getValidationState().gamepad;
    }

    setGamepadBindings(bindings, options = {}) {
        const nextBindings = normalizeGamepadBindings(
            bindings,
            options.fallbackPresetId || this.bindingConfig.gamepad.schemeId
        );
        const validation = validateGamepadBindings(nextBindings, {
            mapping: this.gamepadState.mapping,
            presetId: options.fallbackPresetId || this.bindingConfig.gamepad.schemeId
        });
        if (!validation.valid) {
            return validation;
        }

        this.bindingConfig.gamepad.schemeId = options.schemeId || 'custom';
        this.bindingConfig.gamepad.bindings = validation.bindings;
        if (options.sourceId) {
            this.bindingConfig.gamepad.sourceId = options.sourceId;
        }
        this._syncValidationState();
        this._updateMerged();
        return validation;
    }

    setGamepadActionBinding(action, tokens, options = {}) {
        if (!KEYBOARD_ACTIONS.includes(action)) {
            return {
                valid: false,
                errors: [`Unknown gamepad action: ${action}.`],
                conflicts: []
            };
        }

        const nextBindings = cloneObject(this.bindingConfig.gamepad.bindings);
        nextBindings[action] = normalizeStringArray(tokens);
        return this.setGamepadBindings(nextBindings, {
            schemeId: options.schemeId || 'custom',
            sourceId: options.sourceId,
            fallbackPresetId: options.fallbackPresetId
        });
    }

    clearGamepadActionBinding(action) {
        const defaults = normalizeGamepadBindings(null, this.bindingConfig.gamepad.schemeId);
        return this.setGamepadActionBinding(action, defaults[action], { schemeId: 'custom' });
    }

    setTouchInput(steering, acceleration, braking, fire = this.touchInput.fire) {
        this.touchInput.steering = clamp(steering, -1, 1);
        this.touchInput.acceleration = clamp(acceleration, 0, 1);
        this.touchInput.braking = clamp(braking, 0, 1);
        this.touchInput.fire = !!fire;

        this.debugValues.touchRaw = { ...this.touchInput };
        this._refreshTouchShaped(16.667, { advanceThrottle: false });
        this._updateMerged();
    }

    setTouchSteering(steering) {
        this.setTouchInput(steering, this.touchInput.acceleration, this.touchInput.braking, this.touchInput.fire);
    }

    setTouchAcceleration(acceleration) {
        this.setTouchInput(this.touchInput.steering, acceleration, this.touchInput.braking, this.touchInput.fire);
    }

    setTouchBraking(braking) {
        this.setTouchInput(this.touchInput.steering, this.touchInput.acceleration, braking, this.touchInput.fire);
    }

    setTouchFire(fire) {
        this.setTouchInput(this.touchInput.steering, this.touchInput.acceleration, this.touchInput.braking, fire);
    }

    setKeyboardKeys(pressedKeys) {
        this.keyboardState.keys = new Set(pressedKeys || []);
        this._updateKeyboardTargetsFromKeys();
        this.keyboardInput.acceleration = this.keyboardTarget.acceleration;
        this.keyboardInput.braking = this.keyboardTarget.braking;
        this.debugValues.keyboardRaw = {
            steering: this.keyboardInput.steering,
            acceleration: this.keyboardInput.acceleration,
            braking: this.keyboardInput.braking,
            fire: this.keyboardInput.fire
        };
        this._updateMerged();
    }

    setKeyboardFire(fire) {
        this.keyboardInput.fire = !!fire;
        this.debugValues.keyboardRaw.fire = this.keyboardInput.fire;
        this._updateMerged();
    }

    applyKeyboardEvent(type, code) {
        if (!code || !this.getKnownKeyboardCodes().has(code)) {
            return false;
        }

        if (this.bindingConfig.keyboard.bindings.fire.includes(code)) {
            this.setKeyboardFire(type === 'keydown');
            return true;
        }

        if (type === 'keydown') {
            this.keyboardState.keys.add(code);
        } else if (type === 'keyup') {
            this.keyboardState.keys.delete(code);
        } else {
            return false;
        }

        this.setKeyboardKeys(this.keyboardState.keys);
        return true;
    }

    setGamepadSnapshot(snapshot = {}) {
        const steerLeft = Math.max(
            ...this.bindingConfig.gamepad.bindings.steerLeft.map((token) =>
                readGamepadTokenValue(token, snapshot, this.options.gamepadDeadZone)
            ),
            0
        );
        const steerRight = Math.max(
            ...this.bindingConfig.gamepad.bindings.steerRight.map((token) =>
                readGamepadTokenValue(token, snapshot, this.options.gamepadDeadZone)
            ),
            0
        );
        const acceleration = Math.max(
            ...this.bindingConfig.gamepad.bindings.accelerate.map((token) =>
                readGamepadTokenValue(token, snapshot, this.options.gamepadDeadZone)
            ),
            0
        );
        const braking = Math.max(
            ...this.bindingConfig.gamepad.bindings.brake.map((token) =>
                readGamepadTokenValue(token, snapshot, this.options.gamepadDeadZone)
            ),
            0
        );
        const fire = this.bindingConfig.gamepad.bindings.fire.some((token) =>
            readGamepadTokenValue(token, snapshot, this.options.gamepadDeadZone) > 0.5
        );

        this.gamepadInput.steering = clamp(steerRight - steerLeft, -1, 1);
        this.gamepadInput.acceleration = clamp(acceleration, 0, 1);
        this.gamepadInput.braking = clamp(braking, 0, 1);
        this.gamepadInput.fire = fire;
        this.gamepadState.connected = snapshot.connected !== false
            && (Array.isArray(snapshot.axes) || Array.isArray(snapshot.buttons) || snapshot.id != null);
        this.gamepadState.id = snapshot.id ?? null;
        this.gamepadState.index = Number.isInteger(snapshot.index) ? snapshot.index : null;
        this.gamepadState.mapping = typeof snapshot.mapping === 'string' ? snapshot.mapping : null;

        this.debugValues.gamepadRaw = {
            steering: this.gamepadInput.steering,
            acceleration: this.gamepadInput.acceleration,
            braking: this.gamepadInput.braking,
            fire: this.gamepadInput.fire,
            connected: this.gamepadState.connected,
            mapping: this.gamepadState.mapping,
            sourceId: this.bindingConfig.gamepad.sourceId
        };
        this._syncValidationState();
        this._updateMerged();
        return this.getControls();
    }

    clearGamepadSnapshot() {
        this.gamepadInput = { steering: 0, acceleration: 0, braking: 0, fire: false };
        this.gamepadState = { connected: false, id: null, index: null, mapping: null };
        this.debugValues.gamepadRaw = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false,
            connected: false,
            mapping: null,
            sourceId: this.bindingConfig.gamepad.sourceId
        };
        this._syncValidationState();
        this._updateMerged();
    }

    step(dtMs = 16.667) {
        const dtSeconds = Math.max(0, dtMs) / 1000;
        const targetSteering = this.keyboardTarget.steering;
        const currentSteering = this.keyboardInput.steering;
        const rampRate = targetSteering === 0
            ? this.options.steeringRampDownPerSecond
            : this.options.steeringRampUpPerSecond;

        this.keyboardInput.steering = moveTowards(
            currentSteering,
            targetSteering,
            rampRate * dtSeconds
        );
        this.keyboardInput.acceleration = this.keyboardTarget.acceleration;
        this.keyboardInput.braking = this.keyboardTarget.braking;

        this.debugValues.keyboardRaw = {
            steering: this.keyboardInput.steering,
            acceleration: this.keyboardInput.acceleration,
            braking: this.keyboardInput.braking,
            fire: this.keyboardInput.fire
        };
        this._refreshTouchShaped(dtMs);
        this._updateMerged();
        return this.getControls();
    }

    consumeFirePressed() {
        const pressed = this.pendingFirePress;
        this.pendingFirePress = false;
        return pressed;
    }

    getControls() {
        return { ...this.controls };
    }

    getDebugValues() {
        return cloneObject({
            touchRaw: this.debugValues.touchRaw,
            touchShaped: this.debugValues.touchShaped,
            keyboardRaw: this.debugValues.keyboardRaw,
            keyboardTarget: this.debugValues.keyboardTarget,
            gamepadRaw: this.debugValues.gamepadRaw,
            merged: this.debugValues.merged,
            activeSource: this.debugValues.activeSource,
            bindings: this.debugValues.bindings,
            validation: this.debugValues.validation,
            tuning: this.debugValues.tuning
        });
    }

    reset() {
        this.touchInput = { steering: 0, acceleration: 0, braking: 0, fire: false };
        this.touchShaped = { steering: 0, acceleration: 0, braking: 0, fire: false };
        this.keyboardTarget = { steering: 0, acceleration: 0, braking: 0 };
        this.keyboardInput = { steering: 0, acceleration: 0, braking: 0, fire: false };
        this.gamepadInput = { steering: 0, acceleration: 0, braking: 0, fire: false };
        this.gamepadState = { connected: false, id: null, index: null, mapping: null };
        this.keyboardState.keys.clear();
        this.pendingFirePress = false;
        this._steeringFilteredValue = 0;

        this.debugValues.touchRaw = { ...this.touchInput };
        this.debugValues.touchShaped = { ...this.touchShaped };
        this.debugValues.keyboardTarget = { ...this.keyboardTarget };
        this.debugValues.keyboardRaw = { ...this.keyboardInput };
        this.debugValues.gamepadRaw = {
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false,
            connected: false,
            mapping: null,
            sourceId: this.bindingConfig.gamepad.sourceId
        };
        this.controls = { steering: 0, acceleration: 0, braking: 0, fire: false };
        this.debugValues.merged = { ...this.controls };
        this.debugValues.activeSource = 'touch';
        this._syncValidationState();
    }

    _isActionPressed(action) {
        const bindings = this.bindingConfig.keyboard.bindings[action] || [];
        return bindings.some((binding) => this.keyboardState.keys.has(binding));
    }

    _updateKeyboardTargetsFromKeys() {
        const leftPressed = this._isActionPressed('steerLeft');
        const rightPressed = this._isActionPressed('steerRight');

        this.keyboardTarget.steering = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0);
        this.keyboardTarget.acceleration = this._isActionPressed('accelerate') ? 1 : 0;
        this.keyboardTarget.braking = this._isActionPressed('brake') ? 1 : 0;
        this.debugValues.keyboardTarget = { ...this.keyboardTarget };
    }

    _updateMerged() {
        const movementSources = [
            { name: 'gamepad', input: this.gamepadInput },
            { name: 'keyboard', input: this.keyboardInput },
            { name: 'touch', input: this.touchShaped }
        ];

        let activeSource = 'touch';
        let movementInput = this.touchShaped;

        for (const source of movementSources) {
            if (getMovementMagnitude(source.input) > 0.001) {
                activeSource = source.name;
                movementInput = source.input;
                break;
            }
        }

        const nextControls = {
            steering: movementInput.steering,
            acceleration: movementInput.acceleration,
            braking: movementInput.braking,
            fire: !!(this.touchShaped.fire || this.keyboardInput.fire || this.gamepadInput.fire)
        };

        if (nextControls.fire && !this.controls.fire) {
            this.pendingFirePress = true;
        }

        this.controls = nextControls;
        this.debugValues.merged = { ...this.controls };
        this.debugValues.activeSource = activeSource;
    }
}

ControlMapper.KEYBOARD_ACTIONS = KEYBOARD_ACTIONS;
ControlMapper.TOUCH_SCHEMES = TOUCH_SCHEMES;
ControlMapper.KEYBOARD_REGION_PRESETS = KEYBOARD_REGION_PRESETS;
ControlMapper.GAMEPAD_BINDING_PRESETS = GAMEPAD_BINDING_PRESETS;
ControlMapper.GAMEPAD_BINDING_OPTIONS = GAMEPAD_BINDING_OPTIONS;
ControlMapper.describeKeyboardBindingList = describeKeyboardBindingList;
ControlMapper.describeGamepadBindingList = describeGamepadBindingList;
ControlMapper.validateKeyboardBindings = validateKeyboardBindings;
ControlMapper.validateGamepadBindings = validateGamepadBindings;
ControlMapper.validateTouchScheme = validateTouchScheme;

export {
    ControlMapper,
    KEYBOARD_ACTIONS,
    TOUCH_SCHEMES,
    KEYBOARD_REGION_PRESETS,
    GAMEPAD_BINDING_PRESETS,
    GAMEPAD_BINDING_OPTIONS,
    describeKeyboardBindingList,
    describeGamepadBindingList,
    validateKeyboardBindings,
    validateGamepadBindings,
    validateTouchScheme
};
