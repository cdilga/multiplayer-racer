function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toFinite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function sanitizeColor(color) {
    if (typeof color !== 'string') return '#ffffff';
    const trimmed = color.trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : '#ffffff';
}

function extractBadgeNumber(playerId) {
    const raw = String(playerId ?? '').trim();
    if (!raw) return '?';

    const digits = raw.match(/\d+/g);
    if (digits?.length) {
        return digits[digits.length - 1].slice(-2);
    }

    const compact = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
    return compact.slice(0, 2) || '?';
}

export function buildMarkerIdentity({ playerId, playerName, color } = {}) {
    const rawName = typeof playerName === 'string' ? playerName.trim() : '';
    const badgeNumber = extractBadgeNumber(playerId);
    const fallbackName = playerId == null ? 'Player' : `Player ${badgeNumber}`;

    return {
        playerId,
        numberText: badgeNumber,
        nameText: rawName || fallbackName,
        color: sanitizeColor(color)
    };
}

export function computeMarkerPresentation({
    distance = 40,
    viewportHeight = 720,
    isPreferred = false,
    isViewerOwned = false,
    isPulsing = false
} = {}) {
    const safeDistance = Math.max(1, toFinite(distance, 40));
    const safeViewportHeight = Math.max(320, toFinite(viewportHeight, 720));

    const viewportScale = clamp(safeViewportHeight / 720, 0.95, 1.55);
    const distanceScale = clamp(1.1 - (safeDistance / 260), 0.88, 1.08);

    let scale = viewportScale * distanceScale;
    if (isPreferred) scale *= 1.08;
    if (isViewerOwned) scale *= 1.14;
    if (isPulsing) scale *= 1.12;

    scale = clamp(scale, 0.88, 1.8);

    let opacity = clamp(1.06 - (safeDistance / 300), 0.6, 0.96);
    if (isPreferred) opacity = Math.max(opacity, 0.82);
    if (isViewerOwned || isPulsing) opacity = 1;

    return {
        scale,
        opacity,
        liftPx: Math.round((58 * viewportScale) + (isPulsing ? 6 : 0))
    };
}

export function computeHighlightState({
    nowMs = 0,
    pulseUntilMs = 0,
    pulseDurationMs = 1800
} = {}) {
    const safeNow = toFinite(nowMs, 0);
    const safeUntil = toFinite(pulseUntilMs, 0);
    const safeDuration = Math.max(1, toFinite(pulseDurationMs, 1800));
    const remainingMs = Math.max(0, safeUntil - safeNow);
    const active = remainingMs > 0;

    return {
        active,
        remainingMs,
        intensity: active ? clamp(0.7 + (remainingMs / safeDuration), 0.7, 1.7) : 0
    };
}

export function computeMarkerPriority({
    isPreferred = false,
    isViewerOwned = false,
    isPulsing = false,
    distance = 40
} = {}) {
    return (
        (isViewerOwned ? 1000 : 0) +
        (isPreferred ? 250 : 0) +
        (isPulsing ? 150 : 0) -
        Math.round(Math.max(0, toFinite(distance, 40)))
    );
}

export function estimateMarkerRect({
    x = 0,
    y = 0,
    scale = 1,
    nameText = '',
    numberText = '',
    includeYouLabel = false
} = {}) {
    const safeScale = clamp(toFinite(scale, 1), 0.5, 3);
    const safeNameWidth = clamp(String(nameText).length * 7.2, 40, 144);
    const safeNumberWidth = Math.max(30, (String(numberText).length * 11) + 18);
    const youWidth = includeYouLabel ? 44 : 0;
    const width = Math.round((38 + safeNumberWidth + safeNameWidth + youWidth + (includeYouLabel ? 8 : 0)) * safeScale);
    const height = Math.round(58 * safeScale);
    const left = x - (width / 2);
    const top = y - height;

    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height
    };
}

export function rectsOverlap(a, b, padding = 6) {
    if (!a || !b) return false;

    return !(
        a.right + padding <= b.left ||
        b.right + padding <= a.left ||
        a.bottom + padding <= b.top ||
        b.bottom + padding <= a.top
    );
}

export function resolveSafeArea({
    viewportWidth = 1280,
    viewportHeight = 720,
    occluders = [],
    margin = 18
} = {}) {
    const safeViewportWidth = Math.max(320, toFinite(viewportWidth, 1280));
    const safeViewportHeight = Math.max(240, toFinite(viewportHeight, 720));
    const safeMargin = Math.max(0, toFinite(margin, 14));

    let safeTop = safeMargin;
    let safeBottom = safeViewportHeight - safeMargin;

    for (const occluder of occluders) {
        if (!occluder) continue;
        const rect = {
            top: toFinite(occluder.top, 0),
            bottom: toFinite(occluder.bottom, 0),
            left: toFinite(occluder.left, 0),
            right: toFinite(occluder.right, 0)
        };

        if (rect.bottom <= safeViewportHeight * 0.55) {
            safeTop = Math.max(safeTop, rect.bottom + safeMargin);
        }
        if (rect.top >= safeViewportHeight * 0.45) {
            safeBottom = Math.min(safeBottom, rect.top - safeMargin);
        }
    }

    if (safeBottom <= safeTop + 40) {
        safeBottom = safeViewportHeight - safeMargin;
    }

    return {
        safeLeft: safeMargin,
        safeRight: safeViewportWidth - safeMargin,
        safeTop,
        safeBottom
    };
}

export function clampMarkerPosition({
    x = 0,
    y = 0,
    viewportWidth = 1280,
    viewportHeight = 720,
    safeLeft = 14,
    safeRight = null,
    safeTop = 14,
    safeBottom = null,
    estimatedWidth = 120,
    estimatedHeight = 36
} = {}) {
    const maxX = (safeRight ?? viewportWidth - 14) - (estimatedWidth / 2);
    const minX = safeLeft + (estimatedWidth / 2);
    const maxY = (safeBottom ?? viewportHeight - 14) - 4;
    const minY = safeTop + estimatedHeight;

    return {
        x: clamp(x, minX, maxX),
        y: clamp(y, minY, maxY)
    };
}

/**
 * br-car-identity-system — when a car is off-screen its marker is pinned to the
 * safe-area edge; this computes a directional arrow that points from the pinned
 * marker toward where the car actually is, so "where's my car?" is answerable at
 * a glance.
 *
 * @param {Object} opts
 * @param {number} opts.rawX - unclamped projected screen X of the car
 * @param {number} opts.rawY - unclamped projected screen Y of the car
 * @param {number} opts.clampedX - edge-pinned marker X
 * @param {number} opts.clampedY - edge-pinned marker Y
 * @param {boolean} opts.isEdgeClamped - true when the car is off-screen
 * @returns {{offscreen:boolean, angleRad:number, angleDeg:number}}
 */
export function computeOffscreenArrow({ rawX = 0, rawY = 0, clampedX = 0, clampedY = 0, isEdgeClamped = false } = {}) {
    if (!isEdgeClamped) {
        return { offscreen: false, angleRad: 0, angleDeg: 0 };
    }
    const dx = rawX - clampedX;
    const dy = rawY - clampedY;
    // Screen-space (y grows downward). atan2(dy, dx): 0 = pointing right,
    // +PI/2 = pointing down. Falls back to "up" when the car sits exactly on
    // the pinned point (degenerate) so the arrow is never NaN.
    const angleRad = (dx === 0 && dy === 0) ? -Math.PI / 2 : Math.atan2(dy, dx);
    return { offscreen: true, angleRad, angleDeg: angleRad * 180 / Math.PI };
}
