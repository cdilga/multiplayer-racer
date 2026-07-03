import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * br-skip-bin-arcade-design-language-5k3.25 slice C — adoption/de-glass guard.
 *
 * Fails the build if production-visible UI regresses to glass/blur or to raw
 * system/monospace fonts outside the shared type system. This enforces the full
 * acceptance ("no glass/blur, one type system") mechanically, not by manual grep.
 *
 * DEBUG/private dev surfaces are justified exceptions (not player-facing chrome).
 */

// Production-visible UI/CSS/templates that MUST be on-language.
const PROD_UI = [
    'static/css/host.css',
    'static/css/player.css',
    'static/css/landing.css',
    'frontend/host/index.html',
    'frontend/player/index.html',
    'static/js/ui/LobbyUI.js',
    'static/js/ui/RaceUI.js',
    'static/js/ui/RoomCodeOverlayUI.js',
    'static/js/ui/ResultsUI.js',
    'static/js/ui/GameMenuUI.js',
    'static/js/ui/StatsOverlayUI.js',
    'static/js/ui/VehicleIdentityOverlay.js',
];

// Justified exceptions: developer/debug/private overlays, not player chrome.
// (Documented so the exception is explicit rather than an accidental miss.)
const JUSTIFIED_DEBUG_EXCEPTIONS = [
    'static/js/ui/PhysicsTuningUI.js',
    'static/js/ui/BugReportUI.js',
];

function read(rel) {
    return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

describe('5k3.25 de-glass — no glass/blur in production UI', () => {
    for (const rel of PROD_UI) {
        it(`${rel.split('/').pop()} has no backdrop-filter blur / blur() glass`, () => {
            const src = read(rel);
            expect(src, `${rel} still uses blur()`).not.toMatch(/blur\(/);
        });
    }
});

describe('5k3.25 type system — every production font-family routes through a token', () => {
    // Comprehensive: ANY `font-family:` declaration must go through var(--font-*),
    // OR be a keyword (inherit/initial/unset), OR be a brand @font-face family
    // literal ('SkipBin*'). This catches quoted monospace ('monospace'), raw
    // mono-stack starts ('SF Mono', ...), 'Cascadia Code', BlinkMacSystemFont, etc.
    const FONT_DECL = /font-family:\s*([^;]+);/g;
    const ALLOWED_KEYWORD = /^(inherit|initial|unset|revert)$/i;
    for (const rel of PROD_UI) {
        it(`${rel.split('/').pop()} has zero un-tokenized font-family declarations`, () => {
            const css = read(rel);
            const offenders = [];
            for (const m of css.matchAll(FONT_DECL)) {
                const value = m[1].trim();
                const ok =
                    value.includes('var(--font') ||           // tokenized
                    ALLOWED_KEYWORD.test(value) ||             // inherit/initial/...
                    /^'SkipBin/.test(value);                   // @font-face brand family literal
                if (!ok) offenders.push(value);
            }
            expect(offenders, `un-tokenized fonts in ${rel}:\n${offenders.join('\n')}`).toEqual([]);
        });
    }
});

describe('5k3.25 sticker chrome — no soft neon glow in production UI', () => {
    // A soft glow = a shadow/filter with a non-zero blur and zero offset+spread
    // that reads as neon bloom (e.g. `0 0 24px rgba(...)`). Sticker chrome uses
    // hard OFFSET shadows (blur 0), so any `0 0 <N>px` inside a box-shadow /
    // text-shadow / drop-shadow is forbidden.
    // The two leading zeros are the x/y OFFSET; a non-zero third value is the blur.
    // The lookbehind excludes `inset 0 0 0 <spread>px` hard rings (blur 0), which
    // read as `0 0 <spread>px` but are on-language sticker chrome, not neon bloom.
    const SOFT_GLOW = /(box-shadow|text-shadow|drop-shadow)[^;]*(?<!\d )\b0 0 [1-9]\d*px/;
    // Neon glow TOKENS must be neutralised to a hard sticker shadow, not `0 0 Npx`.
    const SOFT_GLOW_TOKEN = /--glow-(?:cyan|green|pink)\s*:\s*0 0 [1-9]\d*px/;

    // Narrow, documented allow-list for intentional gameplay/danger emphasis.
    // (Currently empty — every production glow was converted to sticker chrome.)
    const ALLOWED_GLOW_EXCEPTIONS = [];

    for (const rel of PROD_UI) {
        it(`${rel.split('/').pop()} has no soft neon glow shadow`, () => {
            const offenders = read(rel)
                .split('\n')
                .filter((line) => (SOFT_GLOW.test(line) || SOFT_GLOW_TOKEN.test(line)))
                .filter((line) => !ALLOWED_GLOW_EXCEPTIONS.some((ex) => line.includes(ex)));
            expect(offenders, `soft glow in ${rel}:\n${offenders.join('\n')}`).toEqual([]);
        });
    }

    it('the glow tokens are neutralised to sticker shadows in the shared stylesheets', () => {
        for (const css of ['static/css/host.css', 'static/css/player.css', 'static/css/landing.css']) {
            const src = read(css);
            for (const tok of ['--glow-cyan', '--glow-green', '--glow-pink']) {
                const m = src.match(new RegExp(`${tok}\\s*:\\s*([^;]+);`));
                expect(m, `${tok} missing in ${css}`).toBeTruthy();
                expect(m[1], `${tok} still a soft glow in ${css}`).not.toMatch(/0 0 [1-9]\d*px/);
            }
        }
    });
});

describe('5k3.25 adoption — production UI actually consumes the new tokens', () => {
    it('the brand body/mono tokens are used across converted component UI', () => {
        const anyUses = PROD_UI.some((rel) => /var\(--font-(body|mono|display)/.test(read(rel)));
        expect(anyUses).toBe(true);
    });

    it('legacy --font-sans is aliased onto the brand body face (one type system)', () => {
        for (const css of ['static/css/host.css', 'static/css/player.css', 'static/css/landing.css']) {
            expect(read(css)).toMatch(/--font-sans:\s*var\(--font-body\)/);
        }
    });
});

describe('5k3.25 guard — debug exceptions are explicit', () => {
    it('documents the justified debug/private exception list', () => {
        // Keeps the exception explicit: if these become player-facing, move them
        // into PROD_UI. (Assertion is on the constant so the list is reviewed.)
        expect(JUSTIFIED_DEBUG_EXCEPTIONS.length).toBeGreaterThan(0);
    });
});
