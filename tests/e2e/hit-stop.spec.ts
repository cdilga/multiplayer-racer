import { test, expect } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.join(process.cwd(), 'artifacts/br-skip-bin-arcade-design-language-5k3.15');

function ensureArtifactDir() {
    fs.mkdirSync(artifactDir, { recursive: true });
}

function hostUrl() {
    return '/host?testMode=1';
}

test.describe('Host hit-stop runtime wiring', () => {
    test('heavy impact and elimination drive render-only hit-stop diagnostics', async ({ hostPage }) => {
        ensureArtifactDir();
        const consoleIssues: string[] = [];
        const pageErrors: string[] = [];

        hostPage.on('console', (message) => {
            if (message.type() === 'error') {
                consoleIssues.push(message.text());
            }
        });
        hostPage.on('pageerror', (error) => pageErrors.push(error.message));

        await hostPage.goto(hostUrl());
        await hostPage.waitForSelector('#room-code-display', { state: 'visible', timeout: 30000 });
        await hostPage.waitForFunction(() => !!window.game?.systems?.hitStop, null, { timeout: 30000 });

        const impactDiagnostics = await hostPage.evaluate(async () => {
            const game = window.game;
            const hitStop = game.systems.hitStop;
            const render = game.systems.render;

            const beforeCamera = render.camera.position.clone();
            game.eventBus.emit('damage:vehicleCollision', {
                vehicleA: 'car-a',
                vehicleB: 'car-b',
                damage: 36
            });

            for (let i = 0; i < 4; i++) {
                render._applyCameraShake(1 / 60);
                hitStop.tick();
            }

            const afterCamera = render.camera.position.clone();
            const sharedDiagnostics = hitStop.getDiagnostics();

            game.eventBus.emit('damage:destroyed', { vehicleId: 'car-a' });
            const holdAtStart = {
                carA: hitStop.shouldHoldVehicleMesh('car-a'),
                carB: hitStop.shouldHoldVehicleMesh('car-b')
            };
            const freezeFrames = [];
            for (let i = 0; i < 3; i++) {
                freezeFrames.push({
                    frame: i + 1,
                    holdCarA: hitStop.shouldHoldVehicleMesh('car-a'),
                    state: hitStop.controller.state
                });
                hitStop.tick();
            }
            const holdAfter = hitStop.shouldHoldVehicleMesh('car-a');

            return {
                sharedDiagnostics,
                holdAtStart,
                freezeFrames,
                holdAfter,
                renderDiagnostics: render.getHitStopRenderDiagnostics(),
                cameraDelta: {
                    x: afterCamera.x - beforeCamera.x,
                    y: afterCamera.y - beforeCamera.y,
                    z: afterCamera.z - beforeCamera.z
                },
                physicsTimeScale: hitStop.controller.physicsTimeScale
            };
        });

        expect(impactDiagnostics.sharedDiagnostics.registeredImpacts.at(-1)).toMatchObject({
            source: 'damage:vehicleCollision',
            context: 'shared-race',
            vehicleIds: ['car-a', 'car-b'],
            decision: {
                mode: 'camera-punch',
                frames: 3
            },
            physicsTimeScale: 1
        });
        expect(impactDiagnostics.renderDiagnostics.appliedFrames).toBeGreaterThanOrEqual(3);
        expect(Math.abs(impactDiagnostics.cameraDelta.z)).toBeGreaterThan(0);
        expect(impactDiagnostics.holdAtStart).toEqual({ carA: true, carB: false });
        expect(impactDiagnostics.freezeFrames.map((frame) => frame.holdCarA)).toEqual([true, true, true]);
        expect(impactDiagnostics.holdAfter).toBe(false);
        expect(impactDiagnostics.physicsTimeScale).toBe(1);
        expect(consoleIssues).toEqual([]);
        expect(pageErrors).toEqual([]);

        await hostPage.screenshot({
            path: path.join(artifactDir, 'hit-stop-runtime-host.png'),
            fullPage: true
        });
        fs.writeFileSync(
            path.join(artifactDir, 'hit-stop-runtime-diagnostics.json'),
            JSON.stringify(impactDiagnostics, null, 2)
        );
    });
});
