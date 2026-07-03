import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Repo-local bundled font assets that the @font-face src MUST reference.
const FONT_FILES = ['skip-bin-display.woff2', 'skip-bin-body.woff2'].map((n) => ({
    name: n,
    path: fileURLToPath(new URL(`../../static/assets/fonts/${n}`, import.meta.url))
}));

/**
 * br-skip-bin-arcade-design-language-5k3.25 slice A — shared UI type/sticker/grain foundation.
 *
 * Source-scan guards over the three shared token stylesheets (host/player/
 * landing). Proves: the 2-typeface system exists everywhere, fonts are NOT
 * CDN-loaded, sticker-chrome tokens exist, the shared foundation adds no
 * glass/blur, and the grain overlay foundation is present + non-interactive.
 */

const CSS_FILES = ['host', 'player', 'landing'].map((n) =>
    fileURLToPath(new URL(`../../static/css/${n}.css`, import.meta.url))
);
const sources = CSS_FILES.map((p) => ({ path: p, css: readFileSync(p, 'utf8') }));

// Extract just the @font-face blocks (for CDN scanning scoped to font sources).
function fontFaceBlocks(css) {
    return (css.match(/@font-face\s*\{[^}]*\}/g) || []);
}

describe('type system — two typefaces defined across all shared stylesheets', () => {
    for (const { path, css } of sources) {
        const name = path.split('/').pop();
        it(`${name} defines --font-display and --font-body`, () => {
            expect(css).toMatch(/--font-display\s*:/);
            expect(css).toMatch(/--font-body\s*:/);
        });
        it(`${name} declares the two @font-face families`, () => {
            expect(css).toMatch(/@font-face[\s\S]*?font-family:\s*'SkipBinDisplay'/);
            expect(css).toMatch(/@font-face[\s\S]*?font-family:\s*'SkipBinBody'/);
        });
    }
});

describe('type system — fonts are self-hosted, never from a CDN', () => {
    for (const { path, css } of sources) {
        const name = path.split('/').pop();
        it(`${name} has no Google Fonts / gstatic reference`, () => {
            expect(css).not.toMatch(/fonts\.googleapis\.com/);
            expect(css).not.toMatch(/fonts\.gstatic\.com/);
            expect(css).not.toMatch(/@import\s+url\(['"]?https?:/i);
        });
        it(`${name} @font-face sources reference REPO-LOCAL .woff2 (no CDN url)`, () => {
            const blocks = fontFaceBlocks(css);
            expect(blocks.length).toBeGreaterThanOrEqual(2);
            for (const block of blocks) {
                // No remote url() inside a font src.
                expect(block).not.toMatch(/url\(\s*['"]?https?:\/\//i);
                // Must load a self-hosted /static/assets/fonts/*.woff2 with format('woff2'),
                // then fall back to local(). Local-only is NOT acceptable.
                expect(block).toMatch(/url\(\s*['"]\/static\/assets\/fonts\/skip-bin-[a-z]+\.woff2['"]\s*\)\s*format\(\s*['"]woff2['"]\s*\)/);
                expect(block).toMatch(/local\(/);
            }
        });
        it(`${name} references both bundled woff2 files by name`, () => {
            expect(css).toMatch(/\/static\/assets\/fonts\/skip-bin-display\.woff2/);
            expect(css).toMatch(/\/static\/assets\/fonts\/skip-bin-body\.woff2/);
        });
    }
});

describe('type system — bundled woff2 assets exist, are non-empty, and are real WOFF2', () => {
    for (const { name, path } of FONT_FILES) {
        it(`${name} exists and is a non-trivial file`, () => {
            expect(existsSync(path)).toBe(true);
            const buf = readFileSync(path);
            expect(buf.length).toBeGreaterThan(2000); // not an empty/placeholder stub
        });
        it(`${name} has the WOFF2 signature 'wOF2'`, () => {
            const buf = readFileSync(path);
            expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
            // Header numTables is sane (>0).
            expect(buf.readUInt16BE(12)).toBeGreaterThan(0);
        });
    }
});

describe('sticker chrome — matte hard-edged tokens exist (no glass/blur foundation)', () => {
    for (const { path, css } of sources) {
        const name = path.split('/').pop();
        it(`${name} defines sticker tokens (ink border, tightened radius, hard shadow)`, () => {
            expect(css).toMatch(/--ink\s*:/);
            expect(css).toMatch(/--border-ink\s*:/);
            expect(css).toMatch(/--radius-sticker\s*:/);
            expect(css).toMatch(/--shadow-sticker\s*:/);
            expect(css).toMatch(/--glow-soft\s*:\s*none/);
        });
        it(`${name} shared foundation adds no backdrop-filter/blur (no glass)`, () => {
            // The 5k3.25 foundation must not (re)introduce glass. (Legacy blur in
            // component JS is the deferred slice-C de-glass, out of scope here.)
            const foundation = css.slice(css.indexOf('Skip Bin Arcade shared UI foundation'));
            // Glass = an ACTIVE backdrop-filter (blur). `backdrop-filter: none` is
            // the explicit de-glass declaration and must be allowed.
            expect(foundation).not.toMatch(/backdrop-filter:\s*(?!none\b)[^;\s]/);
            expect(foundation).not.toMatch(/\bblur\s*\(/);
        });
    }
});

describe('grain overlay — shared CSS foundation is present and non-interactive', () => {
    for (const { path, css } of sources) {
        const name = path.split('/').pop();
        it(`${name} defines .sb-grain-overlay with pointer-events:none`, () => {
            const block = (css.match(/\.sb-grain-overlay\s*\{[^}]*\}/) || [''])[0];
            expect(block).toBeTruthy();
            expect(block).toMatch(/pointer-events:\s*none/);
        });
        it(`${name} disables grain animation under prefers-reduced-motion`, () => {
            expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.sb-grain-overlay[\s\S]*?animation:\s*none/);
        });
        it(`${name} hides grain via reduce-effects / data-enabled=false`, () => {
            expect(css).toMatch(/\.reduce-effects\s+\.sb-grain-overlay|\.sb-grain-overlay\[data-enabled="false"\]/);
        });
    }
});
