import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';

const ARTIFACT_DIR = resolve('artifacts/br-skip-bin-arcade-design-language-5k3.28');

type BoxMetric = {
    selector: string;
    x: number;
    y: number;
    width: number;
    height: number;
    touchAction: string;
    visible: boolean;
};

test.describe('Skip Bin Arcade phone controller skin', () => {
    test.beforeEach(() => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });
    });

    test('mobile controller skin keeps large touch targets and controller-only runtime', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 30000 });

        await playerPage.setViewportSize({ width: 390, height: 844 });
        await playerPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'player-join-mobile.png'),
            fullPage: true,
        });

        await playerPage.evaluate(() => {
            document.body.classList.add('game-active');
            document.querySelector('#join-screen')?.classList.add('hidden');
            document.querySelector('#waiting-screen')?.classList.add('hidden');
            document.querySelector('#game-screen')?.classList.remove('hidden');
        });

        await expect(playerPage.locator('#game-screen')).toBeVisible();
        await expect(playerPage.locator('#controls-container')).toBeVisible();
        await playerPage.screenshot({
            path: resolve(ARTIFACT_DIR, 'player-controller-mobile.png'),
            fullPage: true,
        });

        const evidence = await playerPage.evaluate(() => {
            const selectors = [
                '#steering-area',
                '#pedals-area',
                '#accelerate-btn',
                '#brake-btn',
                '#player-menu-btn',
                '#game-stats',
            ];

            const boxes = selectors.map((selector) => {
                const el = document.querySelector(selector) as HTMLElement | null;
                const rect = el?.getBoundingClientRect();
                const style = el ? getComputedStyle(el) : null;

                return {
                    selector,
                    x: Math.round(rect?.x ?? -1),
                    y: Math.round(rect?.y ?? -1),
                    width: Math.round(rect?.width ?? 0),
                    height: Math.round(rect?.height ?? 0),
                    touchAction: style?.touchAction ?? '',
                    visible: !!el && !!rect && rect.width > 0 && rect.height > 0,
                };
            });

            const query = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
            const steering = query('#steering-area');
            const pedals = query('#pedals-area');
            const accelerate = query('#accelerate-btn');
            const brake = query('#brake-btn');
            const canvasCount = document.querySelectorAll('canvas').length;
            const scripts = Array.from(document.scripts).map((script) => script.getAttribute('src') || 'inline');

            return {
                viewport: { width: window.innerWidth, height: window.innerHeight },
                boxes,
                noWorldRenderer: {
                    canvasCount,
                    gameHostGlobal: typeof (window as any).GameHost,
                    renderSystemGlobal: typeof (window as any).RenderSystem,
                    webglCanvas: !!document.querySelector('canvas'),
                    scripts,
                },
                overlaps: {
                    steeringPedals: !!steering && !!pedals && steering.right > pedals.left && steering.left < pedals.right,
                    accelerateBrake: !!accelerate && !!brake && accelerate.bottom > brake.top && accelerate.top < brake.bottom,
                },
            };
        });

        writeFileSync(
            resolve(ARTIFACT_DIR, 'player-controller-touch-targets.json'),
            JSON.stringify(evidence, null, 2)
        );

        const box = (selector: string): BoxMetric => {
            const found = evidence.boxes.find((entry) => entry.selector === selector);
            if (!found) {
                throw new Error(`Missing box metric for ${selector}`);
            }
            return found;
        };

        for (const selector of ['#player-menu-btn', '#game-stats']) {
            expect(box(selector).width, `${selector} width`).toBeGreaterThanOrEqual(44);
            expect(box(selector).height, `${selector} height`).toBeGreaterThanOrEqual(44);
        }

        for (const selector of ['#steering-area', '#pedals-area', '#accelerate-btn', '#brake-btn']) {
            expect(box(selector).width, `${selector} width`).toBeGreaterThanOrEqual(120);
            expect(box(selector).height, `${selector} height`).toBeGreaterThanOrEqual(120);
            expect(box(selector).touchAction, `${selector} touch action`).toBe('none');
        }

        expect(evidence.overlaps.steeringPedals, 'steering and pedals overlap').toBe(false);
        expect(evidence.overlaps.accelerateBrake, 'accelerate and brake overlap').toBe(false);
        expect(evidence.noWorldRenderer.canvasCount).toBe(0);
        expect(evidence.noWorldRenderer.gameHostGlobal).toBe('undefined');
        expect(evidence.noWorldRenderer.renderSystemGlobal).toBe('undefined');
        expect(evidence.noWorldRenderer.webglCanvas).toBe(false);
    });
});
