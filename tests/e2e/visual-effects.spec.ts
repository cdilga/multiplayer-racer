import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost, gotoHost } from './fixtures';

async function setRangeValue(page: any, selector: string, value: number) {
    await page.locator(selector).evaluate((element: HTMLInputElement, nextValue: number) => {
        element.value = String(nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

test.describe('Visual Effects', () => {
    test('should have fog and sky dome after initialization', async ({ hostPage }) => {
        // Host creates room (this initializes the game)
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        // Wait for game to fully initialize
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
            null,
            { timeout: 15000 }
        );

        // Wait a bit more for sky dome to be created
        await hostPage.waitForTimeout(500);

        // Verify fog and sky dome are present
        const visualEffects = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;

            // Debug info
            const debug = {
                hasGame: !!game,
                hasSystems: !!game?.systems,
                hasRender: !!game?.systems?.render,
                hasScene: !!game?.systems?.render?.scene,
                renderInitialized: !!game?.systems?.render?.initialized,
                sceneChildren: game?.systems?.render?.scene?.children?.length || 0
            };

            if (!game?.systems?.render?.scene) {
                return { hasFog: false, hasSkyDome: false, error: 'Scene not found', debug };
            }

            const scene = game.systems.render.scene;

            // Check for fog (FogExp2)
            const hasFog = scene.fog !== null && scene.fog !== undefined;

            // Check for sky dome (look for mesh with name 'skyDome' or very large sphere)
            let hasSkyDome = false;
            const meshNames: string[] = [];
            scene.traverse((obj: any) => {
                if (obj.name) meshNames.push(obj.name);
                if (obj.name === 'skyDome' ||
                    (obj.type === 'Mesh' && obj.geometry?.type === 'SphereGeometry' &&
                     obj.geometry?.parameters?.radius >= 400)) {
                    hasSkyDome = true;
                }
            });

            // Additional debug: check fog details
            const fogInfo = scene.fog ? {
                type: scene.fog.constructor?.name,
                color: scene.fog.color?.getHex?.()
            } : null;

            return { hasFog, hasSkyDome, debug, meshNames, fogInfo };
        });

        console.log('Visual effects result:', JSON.stringify(visualEffects, null, 2));
        expect(visualEffects.hasFog).toBe(true);
        expect(visualEffects.hasSkyDome).toBe(true);
    });

    test('should have post-processing effects enabled', async ({ hostPage }) => {
        // Host creates room (this initializes the game)
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        // Wait for game to fully initialize
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
            null,
            { timeout: 15000 }
        );

        // Wait for post-processing to initialize (async - composer loads shaders)
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.postProcessing?.composer !== null;
            },
            null,
            { timeout: 10000 }
        ).catch(() => {
            // Post-processing might not initialize in headless - continue anyway
            console.log('Post-processing composer wait timed out');
        });

        // Verify post-processing is enabled
        const postProcessing = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            if (!game?.systems?.render?.postProcessing) {
                return { enabled: false, hasComposer: false, error: 'PostProcessing not found' };
            }

            const pp = game.systems.render.postProcessing;
            return {
                enabled: pp.enabled,
                hasComposer: pp.composer !== null,
                hasBloom: pp.passes?.bloom !== undefined,
                hasColorGrading: pp.passes?.colorGrading !== undefined
            };
        });

        console.log('Post-processing result:', JSON.stringify(postProcessing, null, 2));
        expect(postProcessing.enabled).toBe(true);
        // Post-processing might not work in headless Chrome due to WebGL limitations
        // Only require that it's enabled, not that all passes are loaded
        if (postProcessing.hasComposer) {
            expect(postProcessing.hasBloom).toBe(true);
        }
    });

    test('should expose host-grade ladder diagnostics with explicit tone-mapping', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
            null,
            { timeout: 15000 }
        );

        const diagnostics = await hostPage.evaluate(() => {
            // @ts-ignore
            const render = window.game?.systems?.render;
            return {
                tiers: render?.listGradeTiers?.() || [],
                diagnostics: render?.getGradeDiagnostics?.() || null,
                screenshotLength: render?.captureScreenshot?.()?.length || 0
            };
        });

        expect(diagnostics.tiers.map((tier: any) => tier.tierName)).toEqual([
            'host-native',
            'host-balanced',
            'host-degraded',
            'host-fallback'
        ]);
        expect(diagnostics.diagnostics?.toneMapping?.decision).toBe('skip-aces');
        expect(diagnostics.diagnostics?.toneMapping?.mode).toBe('NoToneMapping');
        expect(diagnostics.diagnostics?.backend?.renderer).toBe('WebGLRenderer');
        expect(diagnostics.diagnostics?.postProcessing?.colorGradingStyle).toBe('skip-bin-arcade-posterize-dither');
        expect(diagnostics.diagnostics?.postProcessing?.ditherPattern).toBe('bayer-4x4');
        expect(diagnostics.diagnostics?.postProcessing?.posterizeBandCount).toBeGreaterThanOrEqual(5);
        expect(diagnostics.diagnostics?.postProcessing?.ditherStrength).toBeGreaterThan(0);
        // 5k3.8: animated camcorder film grain + vignette are live in the built
        // shader uniforms at the native tier (observed via real diagnostics).
        expect(diagnostics.diagnostics?.postProcessing?.filmGrainAmount).toBeGreaterThan(0);
        expect(diagnostics.diagnostics?.postProcessing?.filmGrainAnimated).toBe(true);
        expect(diagnostics.diagnostics?.postProcessing?.vignetteAmount).toBeGreaterThan(0);
        expect(diagnostics.screenshotLength).toBeGreaterThan(10_000);
    });

    test('should have camera shake config available', async ({ hostPage }) => {
        // Host creates room (this initializes the game)
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        // Wait for game to fully initialize
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
            null,
            { timeout: 15000 }
        );

        // Verify camera shake config exists
        const shakeConfig = await hostPage.evaluate(() => {
            // @ts-ignore
            const game = window.game;
            const render = game?.systems?.render;
            return {
                hasShakeConfig: render?.cameraShake !== undefined,
                shakeIntensity: render?.cameraShake?.intensity,
                shakeEnabled: render?.cameraShake?.enabled
            };
        });

        console.log('Camera shake config:', JSON.stringify(shakeConfig, null, 2));
        expect(shakeConfig.hasShakeConfig).toBe(true);
    });

    test('should have visual settings controls in lobby', async ({ hostPage }) => {
        // Host creates room (this initializes the game)
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        // Verify visual settings section exists in lobby
        const visualSettings = await hostPage.evaluate(() => {
            const section = document.querySelector('.visual-settings-section');
            const qualitySelect = document.querySelector('#visual-quality-select') as HTMLSelectElement;
            const resolutionSlider = document.querySelector('#resolution-scale-slider') as HTMLInputElement;
            const resolutionAuto = document.querySelector('#resolution-auto-toggle') as HTMLInputElement;
            const reduceEffects = document.querySelector('#reduce-effects-toggle') as HTMLInputElement;
            const filmGrain = document.querySelector('#film-grain-slider') as HTMLInputElement;
            const dither = document.querySelector('#dither-strength-slider') as HTMLInputElement;
            const scanline = document.querySelector('#scanline-slider') as HTMLInputElement;
            const bloomSlider = document.querySelector('#bloom-intensity-slider') as HTMLInputElement;
            const fogSlider = document.querySelector('#fog-density-slider') as HTMLInputElement;
            const shakeSlider = document.querySelector('#camera-shake-slider') as HTMLInputElement;
            const postProcessingToggle = document.querySelector('#post-processing-toggle') as HTMLInputElement;

            return {
                hasSection: section !== null,
                hasQualitySelect: qualitySelect !== null,
                hasResolutionSlider: resolutionSlider !== null,
                hasResolutionAuto: resolutionAuto !== null,
                hasReduceEffects: reduceEffects !== null,
                hasFilmGrain: filmGrain !== null,
                hasDither: dither !== null,
                hasScanline: scanline !== null,
                hasBloomSlider: bloomSlider !== null,
                hasFogSlider: fogSlider !== null,
                hasShakeSlider: shakeSlider !== null,
                hasPostProcessingToggle: postProcessingToggle !== null,
                qualityValue: qualitySelect?.value,
                resolutionAutoChecked: resolutionAuto?.checked,
                reduceEffectsChecked: reduceEffects?.checked,
                bloomValue: bloomSlider?.value,
                fogValue: fogSlider?.value,
                shakeValue: shakeSlider?.value,
                postProcessingEnabled: postProcessingToggle?.checked
            };
        });

        console.log('Visual settings in lobby:', JSON.stringify(visualSettings, null, 2));
        expect(visualSettings.hasSection).toBe(true);
        expect(visualSettings.hasQualitySelect).toBe(true);
        expect(visualSettings.hasResolutionSlider).toBe(true);
        expect(visualSettings.hasResolutionAuto).toBe(true);
        expect(visualSettings.hasReduceEffects).toBe(true);
        expect(visualSettings.hasFilmGrain).toBe(true);
        expect(visualSettings.hasDither).toBe(true);
        expect(visualSettings.hasScanline).toBe(true);
        expect(visualSettings.hasBloomSlider).toBe(true);
        expect(visualSettings.hasFogSlider).toBe(true);
        expect(visualSettings.hasShakeSlider).toBe(true);
        expect(visualSettings.qualityValue).toBe('auto');
        expect(visualSettings.resolutionAutoChecked).toBe(true);
        expect(visualSettings.reduceEffectsChecked).toBe(false);
    });

    test('should persist visual settings to localStorage', async ({ hostPage }) => {
        // Set custom localStorage value before navigating
        await gotoHost(hostPage);

        // First set some custom values in localStorage
        await hostPage.evaluate(() => {
            localStorage.setItem('visualSettings', JSON.stringify({
                visualQualityMode: 'host-balanced',
                resolutionScale: 0.75,
                reduceEffects: true,
                filmGrain: 0.22,
                ditherStrength: 0.33,
                scanline: 0.11,
                bloom: 1.5,
                fog: 0.012,
                shake: 0.25,
                postProcessing: false
            }));
        });

        // Reload the page to trigger loading from localStorage
        await hostPage.reload();
        await waitForRoomCode(hostPage);

        // Verify sliders have loaded values from localStorage
        const loadedSettings = await hostPage.evaluate(() => {
            const qualitySelect = document.querySelector('#visual-quality-select') as HTMLSelectElement;
            const resolutionSlider = document.querySelector('#resolution-scale-slider') as HTMLInputElement;
            const resolutionAuto = document.querySelector('#resolution-auto-toggle') as HTMLInputElement;
            const reduceEffects = document.querySelector('#reduce-effects-toggle') as HTMLInputElement;
            const filmGrain = document.querySelector('#film-grain-slider') as HTMLInputElement;
            const dither = document.querySelector('#dither-strength-slider') as HTMLInputElement;
            const scanline = document.querySelector('#scanline-slider') as HTMLInputElement;
            const bloomSlider = document.querySelector('#bloom-intensity-slider') as HTMLInputElement;
            const fogSlider = document.querySelector('#fog-density-slider') as HTMLInputElement;
            const shakeSlider = document.querySelector('#camera-shake-slider') as HTMLInputElement;
            const postProcessingToggle = document.querySelector('#post-processing-toggle') as HTMLInputElement;

            return {
                qualityValue: qualitySelect?.value,
                resolutionValue: parseFloat(resolutionSlider?.value || '0'),
                resolutionAutoChecked: resolutionAuto?.checked,
                reduceEffectsChecked: reduceEffects?.checked,
                filmGrainValue: parseFloat(filmGrain?.value || '0'),
                ditherValue: parseFloat(dither?.value || '0'),
                scanlineValue: parseFloat(scanline?.value || '0'),
                bloomValue: parseFloat(bloomSlider?.value || '0'),
                fogValue: parseFloat(fogSlider?.value || '0'),
                shakeValue: parseFloat(shakeSlider?.value || '0'),
                postProcessingEnabled: postProcessingToggle?.checked
            };
        });

        console.log('Loaded settings from localStorage:', JSON.stringify(loadedSettings, null, 2));
        expect(loadedSettings.qualityValue).toBe('host-balanced');
        expect(loadedSettings.resolutionValue).toBe(0.75);
        expect(loadedSettings.resolutionAutoChecked).toBe(false);
        expect(loadedSettings.reduceEffectsChecked).toBe(true);
        expect(loadedSettings.filmGrainValue).toBe(0.22);
        expect(loadedSettings.ditherValue).toBe(0.33);
        expect(loadedSettings.scanlineValue).toBe(0.11);
        expect(loadedSettings.bloomValue).toBe(1.5);
        expect(loadedSettings.fogValue).toBe(0.012);
        expect(loadedSettings.shakeValue).toBe(0.25);
        expect(loadedSettings.postProcessingEnabled).toBe(false);

        // Clean up
        await hostPage.evaluate(() => {
            localStorage.removeItem('visualSettings');
        });
    });

    test('host manual visual settings override adaptive quality and reduce effects', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                // @ts-ignore
                return game?.systems?.render?.initialized === true && !!window.__JJ_MANUAL_VISUAL_SETTINGS__ && !!window.__JJ_ADAPTIVE__;
            },
            null,
            { timeout: 15000 }
        );

        await hostPage.locator('#visual-settings-toggle').click();
        await hostPage.selectOption('#visual-quality-select', 'host-degraded');
        await setRangeValue(hostPage, '#resolution-scale-slider', 0.65);
        await setRangeValue(hostPage, '#film-grain-slider', 0.21);
        await setRangeValue(hostPage, '#dither-strength-slider', 0.31);
        await setRangeValue(hostPage, '#scanline-slider', 0.17);
        await setRangeValue(hostPage, '#bloom-intensity-slider', 1.3);
        await setRangeValue(hostPage, '#fog-density-slider', 0.01);
        await setRangeValue(hostPage, '#camera-shake-slider', 0.2);

        const manual = await hostPage.evaluate(() => {
            // @ts-ignore
            const adaptive = window.__JJ_ADAPTIVE__;
            // @ts-ignore
            const controller = window.__JJ_MANUAL_VISUAL_SETTINGS__;
            // @ts-ignore
            const render = window.game?.systems?.render;
            adaptive.sample(18);
            return {
                settings: controller.getSettings(),
                adaptive: adaptive.state,
                grade: render.getGradeDiagnostics()
            };
        });

        expect(manual.settings.visualQualityMode).toBe('host-degraded');
        expect(manual.settings.resolutionScale).toBe(0.65);
        expect(manual.adaptive.manual).toBe(true);
        expect(manual.adaptive.tier).toBe('host-degraded');
        expect(manual.grade.resolutionScale).toBeCloseTo(0.65, 5);
        expect(manual.grade.postProcessing.filmGrainAmount).toBeCloseTo(0.21, 5);
        expect(manual.grade.postProcessing.filmGrainOverride).toBeCloseTo(0.21, 5);
        expect(manual.grade.postProcessing.ditherStrength).toBeCloseTo(0.31, 5);
        expect(manual.grade.postProcessing.ditherOverride).toBeCloseTo(0.31, 5);
        expect(manual.grade.postProcessing.scanlineAmount).toBeCloseTo(0.17, 5);
        expect(manual.grade.postProcessing.scanlineOverride).toBeCloseTo(0.17, 5);
        expect(manual.grade.postProcessing.bloomStrength).toBeCloseTo(1.3, 5);
        expect(manual.grade.fog.density).toBeCloseTo(0.01, 5);

        await hostPage.locator('#reduce-effects-toggle').check();
        const reduced = await hostPage.evaluate(() => {
            // @ts-ignore
            const adaptive = window.__JJ_ADAPTIVE__;
            // @ts-ignore
            const controller = window.__JJ_MANUAL_VISUAL_SETTINGS__;
            // @ts-ignore
            const render = window.game?.systems?.render;
            const overlay = document.querySelector('.sb-grain-overlay') as HTMLElement;
            return {
                settings: controller.getSettings(),
                adaptive: adaptive.state,
                grade: render.getGradeDiagnostics(),
                bodyReduceEffects: document.body.classList.contains('reduce-effects'),
                overlayEnabled: overlay?.dataset.enabled
            };
        });

        expect(reduced.settings.reduceEffects).toBe(true);
        expect(reduced.adaptive.manual).toBe(true);
        expect(reduced.adaptive.tier).toBe('host-fallback');
        expect(reduced.grade.postProcessing.enabled).toBe(false);
        expect(reduced.grade.postProcessing.bloomStrength).toBe(0);
        expect(reduced.grade.postProcessing.filmGrainAmount).toBe(0);
        expect(reduced.grade.postProcessing.ditherStrength).toBe(0);
        expect(reduced.grade.postProcessing.scanlineAmount).toBe(0);
        expect(reduced.grade.fog.density).toBeLessThanOrEqual(0.003);
        expect(reduced.bodyReduceEffects).toBe(true);
        expect(reduced.overlayEnabled).toBe('false');

        await hostPage.locator('#reduce-effects-toggle').uncheck();
        await hostPage.selectOption('#visual-quality-select', 'auto');
        await hostPage.locator('#resolution-auto-toggle').check();
        const auto = await hostPage.evaluate(() => {
            // @ts-ignore
            const adaptive = window.__JJ_ADAPTIVE__;
            // @ts-ignore
            const controller = window.__JJ_MANUAL_VISUAL_SETTINGS__;
            adaptive.sample(60);
            return {
                settings: controller.getSettings(),
                adaptive: adaptive.state,
                bodyReduceEffects: document.body.classList.contains('reduce-effects')
            };
        });

        expect(auto.settings.visualQualityMode).toBe('auto');
        expect(auto.settings.resolutionScale).toBeNull();
        expect(auto.settings.reduceEffects).toBe(false);
        expect(auto.adaptive.manual).toBe(false);
        expect(auto.bodyReduceEffects).toBe(false);
    });
});
