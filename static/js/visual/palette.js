export const WORLD_PALETTE = {
    INK: '#14110F',
    ASPHALT: '#2A2620',
    CARDBOARD: '#6B5A41',
    RUST: '#7A4A2E',
    'SICK-GREEN': '#4B5A3A',
    DUSK: '#3A3550',
    HAZE: '#8A7E6B',
    BONE: '#C9BBA0'
};

export const LOUD_PALETTE = {
    P1: '#FF2E88',
    P2: '#2EE8FF',
    P3: '#FFD23E',
    P4: '#FF3B3B',
    P5: '#5CFF6A',
    P6: '#FF8A2E',
    P7: '#B14CFF',
    DANGER: '#FF2E2E',
    BOOST: '#2EE8FF',
    WHITE: '#FFFFFF'
};

export const EXPLICIT_ENVIRONMENT_SOURCES = [
    'static/js/resources/TrackFactory.js',
    'static/js/resources/ProceduralTrackGenerator.js',
    'static/js/resources/terrain.js',
    'static/js/resources/bowlProfile.js'
];

export const EXPLICIT_PLAYER_DANGER_SOURCES = [
    'static/js/resources/VehicleFactory.js',
    'static/js/systems/WeaponSystem.js',
    'static/js/systems/DamageSystem.js',
    'static/js/ui/ownCarMarker.js'
];

const EXPLICIT_COMMENT_ALLOW_MARKER = 'palette-allow';
const HEX_NORMALIZATION = /^#|^0x/i;
export const FORBIDDEN_LOUD_HEXES = [
    LOUD_PALETTE.P1,
    LOUD_PALETTE.P2,
    LOUD_PALETTE.P3,
    LOUD_PALETTE.P4,
    LOUD_PALETTE.P5,
    LOUD_PALETTE.P6,
    LOUD_PALETTE.P7,
    LOUD_PALETTE.DANGER
].map(normalizeHex);

const WORLD_SET = new Set(Object.values(WORLD_PALETTE).map(normalizeHex));

function normalizeHex(raw) {
    const normalized = raw.trim().toUpperCase().replace(HEX_NORMALIZATION, '#');
    return normalized;
}

function toHexCode(value) {
    return normalizeHex(value);
}

export function isLoudColor(color) {
    return FORBIDDEN_LOUD_HEXES.includes(normalizeHex(color));
}

export function isWorldColor(color) {
    return WORLD_SET.has(normalizeHex(color));
}

export function scanForLoudColors(source, rel, marker = EXPLICIT_COMMENT_ALLOW_MARKER) {
    const hexRegex = /(?:0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6})/g;
    const findings = [];
    const lines = source.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.includes(marker)) {
            continue;
        }

        let match;
        while ((match = hexRegex.exec(line)) !== null) {
            const hex = toHexCode(match[0]);
            if (FORBIDDEN_LOUD_HEXES.includes(hex)) {
                findings.push({
                    source: rel,
                    line: index + 1,
                    text: line.trim(),
                    match: match[0],
                    normalized: hex
                });
            }
        }
    }

    return findings;
}

export function assertEnvironmentColor(color, source = 'unknown') {
    if (isLoudColor(color)) {
        throw new Error(`${source} uses forbidden loud color ${toHexCode(color)}`);
    }
    return true;
}

export function normalizePaletteList(values) {
    return Object.values(values).map(normalizeHex);
}
