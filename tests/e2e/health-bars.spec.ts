import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * br-skip-bin-arcade-design-language-5k3.13 (P2.3) — Chunky segmented health bars.
 *
 * DOM/visual/stability diagnostic. Renders window.RaceUI health bars in an
 * isolated container (so it never mutates the host's own HUD) at a spread of
 * health values, then asserts:
 *   - fixed 10 chunky segments per bar (not a continuous thin fill)
 *   - lit-segment count matches the discrete health mapping
 *   - lit segments are FLAT SOLID colors (no gradient) => dither/posterize-safe
 *   - segment-track geometry is stable across health values (couch legibility)
 *   - the panel sits within the viewport and below the top HUD row (no overlap)
 * Writes a screenshot + diagnostics JSON artifact.
 */

const ARTIFACT_DIR = 'artifacts/br-skip-bin-arcade-design-language-5k3.13';

test('chunky segmented health bars: discrete, solid, stable, non-overlapping', async ({ page }) => {
    // The host screen (which bundles RaceUI) lives at /host; / is the landing page.
    await page.goto('/host');
    await page.waitForFunction(() => typeof (window as any).RaceUI === 'function', null, {
        timeout: 15000,
    });

    const diag = await page.evaluate(() => {
        const RaceUI = (window as any).RaceUI;

        // Isolated container so we never touch the host's live HUD.
        const container = document.createElement('div');
        container.id = 'health-bar-diagnostic-root';
        document.body.appendChild(container);

        const ui = new RaceUI({ container, eventBus: null });
        ui.init();
        ui.show();

        const players = [
            { id: 'p1', name: 'PINK', color: '#FF2E88', health: 100, maxHealth: 100 },
            { id: 'p2', name: 'CYAN', color: '#2EE8FF', health: 70, maxHealth: 100 },
            { id: 'p3', name: 'YELL', color: '#FFD23E', health: 40, maxHealth: 100 },
            { id: 'p4', name: 'RED', color: '#FF3B3B', health: 15, maxHealth: 100 },
            { id: 'p5', name: 'DEAD', color: '#B14CFF', health: 0, maxHealth: 100 },
        ];
        ui.updateHealthBars(players);

        const panel = container.querySelector('.hud-health-bars') as HTMLElement;
        const items = Array.from(container.querySelectorAll('.health-bar-item')) as HTMLElement[];

        const bars = items.map((item) => {
            const segs = Array.from(item.querySelectorAll('.health-seg')) as HTMLElement[];
            const litSegs = segs.filter((s) => s.classList.contains('is-lit'));
            const firstLit = litSegs[0];
            const track = item.querySelector('.health-bar-segments') as HTMLElement;
            const trackRect = track.getBoundingClientRect();
            const litStyle = firstLit ? getComputedStyle(firstLit) : null;
            return {
                playerId: item.dataset.playerId,
                healthPercent: Number(item.dataset.healthPercent),
                segmentsLitAttr: Number(item.dataset.segmentsLit),
                tier: item.dataset.tier,
                segTotal: segs.length,
                segLit: litSegs.length,
                trackWidth: Math.round(trackRect.width),
                trackHeight: Math.round(trackRect.height),
                litBackgroundImage: litStyle ? litStyle.backgroundImage : 'none',
                litBackgroundColor: litStyle ? litStyle.backgroundColor : '',
            };
        });

        const panelRect = panel.getBoundingClientRect();
        // Top HUD row (timer/lap) that the health panel must sit clear of.
        const hudTop = container.querySelector('.hud-top') as HTMLElement;
        const hudTopRect = hudTop.getBoundingClientRect();

        return {
            bars,
            panel: {
                left: Math.round(panelRect.left),
                top: Math.round(panelRect.top),
                right: Math.round(panelRect.right),
                bottom: Math.round(panelRect.bottom),
                width: Math.round(panelRect.width),
            },
            hudTopBottom: Math.round(hudTopRect.bottom),
            viewport: { w: window.innerWidth, h: window.innerHeight },
            segmentCountConst: RaceUI.SEGMENT_COUNT,
        };
    });

    // 1. Every bar has exactly SEGMENT_COUNT chunky segments (discrete, not thin fill).
    for (const bar of diag.bars) {
        expect(bar.segTotal).toBe(diag.segmentCountConst);
    }

    // 2. Lit-segment count matches the discrete mapping and the data attribute.
    const expected: Record<string, number> = { p1: 10, p2: 7, p3: 4, p4: 2, p5: 0 };
    for (const bar of diag.bars) {
        expect(bar.segLit).toBe(bar.segmentsLitAttr);
        expect(bar.segLit).toBe(expected[bar.playerId as string]);
    }

    // 3. Lit segments are FLAT SOLID colors (no gradient) => survives posterize/dither.
    for (const bar of diag.bars) {
        if (bar.segLit > 0) {
            expect(bar.litBackgroundImage).toBe('none');
        }
    }

    // 4. Couch legibility: chunky segment track height.
    for (const bar of diag.bars) {
        expect(bar.trackHeight).toBeGreaterThanOrEqual(20);
    }

    // 5. Stable dimensions: segment-track width is identical across ALL health values.
    const widths = new Set(diag.bars.map((b) => b.trackWidth));
    expect(widths.size).toBe(1);

    // 6. No overlap: panel within viewport and strictly below the top HUD row.
    expect(diag.panel.left).toBeGreaterThanOrEqual(0);
    expect(diag.panel.top).toBeGreaterThanOrEqual(diag.hudTopBottom);
    expect(diag.panel.right).toBeLessThanOrEqual(diag.viewport.w);

    // Artifacts: screenshot of the panel + machine-readable diagnostics.
    mkdirSync(resolve(ARTIFACT_DIR), { recursive: true });
    const panelHandle = page.locator('#health-bar-diagnostic-root .hud-health-bars');
    await panelHandle.screenshot({ path: resolve(ARTIFACT_DIR, 'health-bars.png') });
    writeFileSync(
        resolve(ARTIFACT_DIR, 'health-bars-diagnostic.json'),
        JSON.stringify(diag, null, 2)
    );
});
