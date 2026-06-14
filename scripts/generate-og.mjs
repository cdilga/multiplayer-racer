// generate-og.mjs
//
// Generates the Open Graph social-share image for Joystick Jammers.
//
//   node scripts/generate-og.mjs
//
// It renders a fully self-contained HTML/CSS "card" (no external fonts or
// images, so rendering is deterministic) and screenshots it with Playwright's
// bundled Chromium. Output: static/og-image.png (1200x630, optionally @2x).
//
// Optional: pass --square to also emit static/og-image-square.png (1080x1080).

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'static');

// deviceScaleFactor. At 2x (2400x1260) the heavy neon gradients/glows push the
// PNG well past 1MB, so we render at 1x to stay comfortably under the OG size
// budget while keeping the native 1200x630 dimensions. Bump to 2 if you want a
// crisper @2x asset and don't care about file size.
const SCALE = 1;

/**
 * Build the standalone HTML card.
 * @param {{width:number, height:number, square?:boolean}} opts
 */
function buildHtml({ width, height, square = false }) {
    // Shared neon palette (locked brand colours).
    const CYAN = '#4cc9f0';
    const GREEN = '#00ff88';
    const INDIGO = '#4361ee';
    const PINK = '#f72585';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #ffffff;
    /* Dark navy gradient base */
    background:
      radial-gradient(120% 90% at 80% -10%, rgba(247,37,133,0.22) 0%, rgba(247,37,133,0) 45%),
      radial-gradient(110% 90% at 8% 110%, rgba(0,255,136,0.20) 0%, rgba(0,255,136,0) 50%),
      linear-gradient(135deg, #1a1a2e 0%, #16213e 55%, #0d1429 100%);
    position: relative;
  }

  /* Faint perspective grid floor (Tron vibe) */
  .grid {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 220%;
    height: ${square ? 46 : 52}%;
    transform: translateX(-50%) perspective(420px) rotateX(62deg);
    transform-origin: bottom center;
    background-image:
      linear-gradient(to right, rgba(76,201,240,0.28) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(76,201,240,0.28) 1px, transparent 1px);
    background-size: 60px 60px;
    -webkit-mask-image: linear-gradient(to top, #000 0%, transparent 78%);
            mask-image: linear-gradient(to top, #000 0%, transparent 78%);
    opacity: 0.7;
  }

  /* Diagonal speed lines */
  .speed {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .speed span {
    position: absolute;
    height: 4px;
    border-radius: 4px;
    transform: rotate(-18deg);
    filter: blur(0.4px);
  }

  .frame {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: ${square ? '90px 96px' : '70px 92px'};
    /* Keep text out of the bottom-right art zone */
    max-width: ${square ? '100%' : '840px'};
    z-index: 5;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    align-self: flex-start;
    padding: 10px 20px;
    border-radius: 999px;
    border: 1.5px solid rgba(76,201,240,0.55);
    background: rgba(76,201,240,0.10);
    box-shadow: 0 0 24px rgba(76,201,240,0.28), inset 0 0 18px rgba(76,201,240,0.10);
    font-size: 21px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${CYAN};
  }
  .badge .dot {
    width: 11px; height: 11px; border-radius: 50%;
    background: ${GREEN};
    box-shadow: 0 0 12px ${GREEN}, 0 0 20px ${GREEN};
  }

  .wordmark {
    margin-top: 30px;
    font-weight: 900;
    font-size: ${square ? 132 : 136}px;
    line-height: 0.92;
    letter-spacing: -2px;
    text-transform: uppercase;
  }
  .wordmark .joystick {
    display: block;
    color: #ffffff;
    text-shadow:
      0 0 8px rgba(76,201,240,0.9),
      0 0 28px rgba(76,201,240,0.65),
      0 0 60px rgba(67,97,238,0.55);
  }
  .wordmark .jammers {
    display: block;
    background: linear-gradient(92deg, ${GREEN} 0%, ${CYAN} 60%, ${INDIGO} 100%);
    -webkit-background-clip: text;
            background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 0 18px rgba(0,255,136,0.55)) drop-shadow(0 0 40px rgba(76,201,240,0.35));
  }

  .tagline {
    margin-top: 30px;
    font-size: ${square ? 38 : 37}px;
    font-weight: 700;
    color: #ffffff;
    white-space: ${square ? 'normal' : 'nowrap'};
  }
  .tagline .wreck {
    color: ${PINK};
    text-shadow: 0 0 18px rgba(247,37,133,0.7);
  }
  .sub {
    margin-top: 14px;
    font-size: 25px;
    font-weight: 500;
    color: #8d99ae;
    letter-spacing: 0.3px;
  }

  .url {
    margin-top: ${square ? 44 : 38}px;
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 12px;
    padding: 13px 26px;
    border-radius: 14px;
    background: linear-gradient(120deg, rgba(0,255,136,0.16), rgba(76,201,240,0.16));
    border: 1.5px solid rgba(0,255,136,0.5);
    box-shadow: 0 0 26px rgba(0,255,136,0.25);
    font-size: 27px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #ffffff;
  }
  .url .arrow { color: ${GREEN}; font-size: 24px; }

  /* ---- Art: neon scene anchored bottom-right ---- */
  .art {
    position: absolute;
    right: ${square ? -10 : -20}px;
    bottom: ${square ? 70 : 18}px;
    width: ${square ? 520 : 540}px;
    height: ${square ? 420 : 440}px;
    z-index: 4;
    pointer-events: none;
  }
  .art svg { width: 100%; height: 100%; overflow: visible; }
</style>
</head>
<body>
  <div class="grid"></div>

  <div class="speed">
    <span style="top:18%; right:34%; width:200px; background:${CYAN}; box-shadow:0 0 14px ${CYAN};"></span>
    <span style="top:30%; right:28%; width:130px; background:${GREEN}; box-shadow:0 0 14px ${GREEN};"></span>
    <span style="top:44%; right:38%; width:160px; background:${PINK}; box-shadow:0 0 14px ${PINK};"></span>
    <span style="top:58%; right:30%; width:110px; background:${CYAN}; box-shadow:0 0 12px ${CYAN};"></span>
  </div>

  <div class="frame">
    <div class="badge"><span class="dot"></span>Party Racer &middot; Demolition Derby</div>
    <h1 class="wordmark">
      <span class="joystick">Joystick</span>
      <span class="jammers">Jammers</span>
    </h1>
    <p class="tagline">Connect your phone. <span class="wreck">Wreck your friends.</span></p>
    <p class="sub">Phones are the controllers. The mayhem is on the big screen.</p>
    <span class="url"><span class="arrow">&#9654;</span> jammers.dilger.dev</span>
  </div>

  <div class="art">
    <svg viewBox="0 0 560 430" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="carBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${CYAN}"/>
          <stop offset="1" stop-color="${INDIGO}"/>
        </linearGradient>
        <linearGradient id="phoneScreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0d1429"/>
          <stop offset="1" stop-color="#16213e"/>
        </linearGradient>
        <radialGradient id="spark" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="0.35" stop-color="${GREEN}"/>
          <stop offset="0.75" stop-color="${PINK}"/>
          <stop offset="1" stop-color="rgba(247,37,133,0)"/>
        </radialGradient>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <!-- Explosion spark behind cars -->
      <g filter="url(#glow)" opacity="0.95">
        <circle cx="300" cy="150" r="86" fill="url(#spark)"/>
        <g stroke="${GREEN}" stroke-width="6" stroke-linecap="round">
          <line x1="300" y1="50"  x2="300" y2="14"/>
          <line x1="386" y1="100" x2="420" y2="78"/>
          <line x1="214" y1="100" x2="180" y2="78"/>
          <line x1="396" y1="180" x2="436" y2="190"/>
        </g>
        <g stroke="${PINK}" stroke-width="6" stroke-linecap="round">
          <line x1="208" y1="190" x2="168" y2="200"/>
          <line x1="350" y1="62"  x2="372" y2="34"/>
          <line x1="250" y1="62"  x2="228" y2="34"/>
        </g>
      </g>

      <!-- Neon car 1 (cyan/indigo) -->
      <g filter="url(#glow)" transform="translate(150 188) rotate(-8)">
        <path d="M10 60 L40 24 Q56 6 92 6 L188 6 Q220 6 238 30 L266 60 Q272 78 256 86 L24 86 Q4 80 10 60 Z"
              fill="url(#carBody)" stroke="${CYAN}" stroke-width="3"/>
        <path d="M70 24 L96 12 L168 12 L196 26 L196 44 L70 44 Z" fill="#0d1429" opacity="0.85"/>
        <circle cx="62" cy="92" r="24" fill="#0d1429" stroke="${CYAN}" stroke-width="6"/>
        <circle cx="208" cy="92" r="24" fill="#0d1429" stroke="${CYAN}" stroke-width="6"/>
      </g>

      <!-- Neon car 2 (pink, smaller, flipped behind) -->
      <g filter="url(#glow)" transform="translate(300 270) rotate(6) scale(0.8)" opacity="0.95">
        <path d="M10 60 L40 24 Q56 6 92 6 L188 6 Q220 6 238 30 L266 60 Q272 78 256 86 L24 86 Q4 80 10 60 Z"
              fill="#1a1a2e" stroke="${PINK}" stroke-width="4"/>
        <path d="M70 24 L96 12 L168 12 L196 26 L196 44 L70 44 Z" fill="#0d1429" opacity="0.85"/>
        <circle cx="62" cy="92" r="24" fill="#0d1429" stroke="${PINK}" stroke-width="6"/>
        <circle cx="208" cy="92" r="24" fill="#0d1429" stroke="${PINK}" stroke-width="6"/>
      </g>

      <!-- Phone-as-controller, foreground tucked into the car cluster -->
      <g filter="url(#glow)" transform="translate(120 268) rotate(-12)">
        <rect x="0" y="0" width="120" height="160" rx="20" fill="#0d1429" stroke="${CYAN}" stroke-width="4"/>
        <rect x="12" y="14" width="96" height="132" rx="10" fill="url(#phoneScreen)" stroke="rgba(76,201,240,0.4)" stroke-width="1.5"/>
        <!-- D-pad -->
        <g fill="${CYAN}">
          <rect x="30" y="64" width="18" height="50" rx="5"/>
          <rect x="14" y="80" width="50" height="18" rx="5"/>
        </g>
        <!-- Action buttons -->
        <circle cx="86" cy="74" r="10" fill="${GREEN}"/>
        <circle cx="86" cy="104" r="10" fill="${PINK}"/>
      </g>
    </svg>
  </div>
</body>
</html>`;
}

async function renderCard(browser, { width, height, square, outFile }) {
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: SCALE,
    });
    const page = await context.newPage();
    await page.setContent(buildHtml({ width, height, square }), {
        waitUntil: 'networkidle',
    });
    // Brief settle so gradients/filters are fully painted before capture.
    await page.waitForTimeout(150);
    await page.screenshot({ path: outFile, type: 'png' });
    await context.close();
    return outFile;
}

async function main() {
    const wantSquare = process.argv.includes('--square');
    mkdirSync(OUT_DIR, { recursive: true });

    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
        const og = await renderCard(browser, {
            width: 1200,
            height: 630,
            square: false,
            outFile: resolve(OUT_DIR, 'og-image.png'),
        });
        console.log(`Wrote ${og}`);

        if (wantSquare) {
            const sq = await renderCard(browser, {
                width: 1080,
                height: 1080,
                square: true,
                outFile: resolve(OUT_DIR, 'og-image-square.png'),
            });
            console.log(`Wrote ${sq}`);
        }
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
