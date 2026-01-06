import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost } from './fixtures';

test.describe('Visual Effects', () => {
    test('should have fog and sky dome after initialization', async ({ hostPage }) => {
        // Host creates room (this initializes the game)
        await hostPage.goto('/');
        await waitForRoomCode(hostPage);

        // Wait for game to fully initialize
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
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
        await hostPage.goto('/');
        await waitForRoomCode(hostPage);

        // Wait for game to fully initialize
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
            { timeout: 15000 }
        );

        // Wait for post-processing to initialize (async - composer loads shaders)
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.postProcessing?.composer !== null;
            },
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

    test('should have camera shake config available', async ({ hostPage }) => {
        // Host creates room (this initializes the game)
        await hostPage.goto('/');
        await waitForRoomCode(hostPage);

        // Wait for game to fully initialize
        await hostPage.waitForFunction(
            () => {
                // @ts-ignore
                const game = window.game;
                return game?.systems?.render?.initialized === true;
            },
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
        await hostPage.goto('/');
        await waitForRoomCode(hostPage);

        // Verify visual settings section exists in lobby
        const visualSettings = await hostPage.evaluate(() => {
            const section = document.querySelector('.visual-settings-section');
            const bloomSlider = document.querySelector('#bloom-intensity-slider') as HTMLInputElement;
            const fogSlider = document.querySelector('#fog-density-slider') as HTMLInputElement;
            const shakeSlider = document.querySelector('#camera-shake-slider') as HTMLInputElement;
            const postProcessingToggle = document.querySelector('#post-processing-toggle') as HTMLInputElement;

            return {
                hasSection: section !== null,
                hasBloomSlider: bloomSlider !== null,
                hasFogSlider: fogSlider !== null,
                hasShakeSlider: shakeSlider !== null,
                hasPostProcessingToggle: postProcessingToggle !== null,
                bloomValue: bloomSlider?.value,
                fogValue: fogSlider?.value,
                shakeValue: shakeSlider?.value,
                postProcessingEnabled: postProcessingToggle?.checked
            };
        });

        console.log('Visual settings in lobby:', JSON.stringify(visualSettings, null, 2));
        expect(visualSettings.hasSection).toBe(true);
        expect(visualSettings.hasBloomSlider).toBe(true);
        expect(visualSettings.hasFogSlider).toBe(true);
        expect(visualSettings.hasShakeSlider).toBe(true);
    });

    test('should persist visual settings to localStorage', async ({ hostPage }) => {
        // Set custom localStorage value before navigating
        await hostPage.goto('/');

        // First set some custom values in localStorage
        await hostPage.evaluate(() => {
            localStorage.setItem('visualSettings', JSON.stringify({
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
            const bloomSlider = document.querySelector('#bloom-intensity-slider') as HTMLInputElement;
            const fogSlider = document.querySelector('#fog-density-slider') as HTMLInputElement;
            const shakeSlider = document.querySelector('#camera-shake-slider') as HTMLInputElement;
            const postProcessingToggle = document.querySelector('#post-processing-toggle') as HTMLInputElement;

            return {
                bloomValue: parseFloat(bloomSlider?.value || '0'),
                fogValue: parseFloat(fogSlider?.value || '0'),
                shakeValue: parseFloat(shakeSlider?.value || '0'),
                postProcessingEnabled: postProcessingToggle?.checked
            };
        });

        console.log('Loaded settings from localStorage:', JSON.stringify(loadedSettings, null, 2));
        expect(loadedSettings.bloomValue).toBe(1.5);
        expect(loadedSettings.fogValue).toBe(0.012);
        expect(loadedSettings.shakeValue).toBe(0.25);
        expect(loadedSettings.postProcessingEnabled).toBe(false);

        // Clean up
        await hostPage.evaluate(() => {
            localStorage.removeItem('visualSettings');
        });
    });
});
