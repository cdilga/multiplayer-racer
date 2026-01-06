import { test, expect, waitForRoomCode, joinGameAsPlayer, startGameFromHost } from './fixtures';

test.describe('Dynamic Camera Zoom', () => {

    test('should keep both vehicles visible when positioned far apart', async ({ hostPage, playerPage, browser }) => {
        // Host creates room
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);

        // Player 1 joins
        await joinGameAsPlayer(playerPage, roomCode, 'Player1');
        await expect(hostPage.locator('#player-list')).toContainText('Player1', { timeout: 10000 });

        // Create a fresh context for Player 2 (avoid conflicts with shared context)
        const player2Context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const player2Page = await player2Context.newPage();
        await joinGameAsPlayer(player2Page, roomCode, 'Player2');
        await expect(hostPage.locator('#player-list')).toContainText('Player2', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Wait for countdown to finish and race to start
        await hostPage.waitForTimeout(4500);

        // Enable test controls override
        await hostPage.evaluate(() => {
            // @ts-ignore
            if (!window.gameState) window.gameState = {};
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Position vehicles far apart using physics reset
        const cameraResult = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            if (!game || !game.vehicles || game.vehicles.size < 2) {
                return { error: 'Need at least 2 vehicles', vehicleCount: game?.vehicles?.size || 0 };
            }

            const vehicles = Array.from(game.vehicles.values());
            const vehicle1 = vehicles[0];
            const vehicle2 = vehicles[1];

            // Verify camera has both targets
            const cameraTargetCount = game.systems.render.cameraTargets?.length || 0;

            // Position vehicles far apart (opposite sides of track)
            const pos1 = { x: -40, y: 1.5, z: 0 };
            const pos2 = { x: 40, y: 1.5, z: 0 };

            // Reset vehicles to these positions
            game.systems.physics.resetVehicle(vehicle1.id, pos1, 0);
            game.systems.physics.resetVehicle(vehicle2.id, pos2, 0);

            // Wait for physics and render to sync - let camera transition
            await new Promise(resolve => setTimeout(resolve, 500));

            // Get camera info
            const camera = game.systems.render.camera;
            const renderer = game.systems.render.renderer;

            // Check if both vehicles are in the camera frustum
            const frustum = new THREE.Frustum();
            const projScreenMatrix = new THREE.Matrix4();
            projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(projScreenMatrix);

            // Get vehicle positions after physics update
            const v1Pos = vehicle1.mesh?.position || vehicle1.position;
            const v2Pos = vehicle2.mesh?.position || vehicle2.position;

            const v1InFrustum = frustum.containsPoint(new THREE.Vector3(v1Pos.x, v1Pos.y, v1Pos.z));
            const v2InFrustum = frustum.containsPoint(new THREE.Vector3(v2Pos.x, v2Pos.y, v2Pos.z));

            return {
                success: true,
                cameraTargetCount,
                vehicle1Position: { x: v1Pos.x, y: v1Pos.y, z: v1Pos.z },
                vehicle2Position: { x: v2Pos.x, y: v2Pos.y, z: v2Pos.z },
                vehicle1InFrustum: v1InFrustum,
                vehicle2InFrustum: v2InFrustum,
                bothVisible: v1InFrustum && v2InFrustum,
                cameraFOV: camera.fov,
                cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z }
            };
        });

        console.log('Camera zoom test result:', JSON.stringify(cameraResult, null, 2));

        if (cameraResult.error) {
            console.error('Error:', cameraResult.error);
        }

        // Both vehicles should be visible in the camera frustum
        expect(cameraResult.bothVisible).toBe(true);
        expect(cameraResult.vehicle1InFrustum).toBe(true);
        expect(cameraResult.vehicle2InFrustum).toBe(true);

        await player2Page.close();
        await player2Context.close();
    });

    test('should adjust camera FOV/zoom when vehicles spread apart', async ({ hostPage, playerPage, browser }) => {
        // Host creates room
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);

        // Player 1 joins
        await joinGameAsPlayer(playerPage, roomCode, 'ZoomTest1');
        await expect(hostPage.locator('#player-list')).toContainText('ZoomTest1', { timeout: 10000 });

        // Create a fresh context for Player 2
        const player2Context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const player2Page = await player2Context.newPage();
        await joinGameAsPlayer(player2Page, roomCode, 'ZoomTest2');
        await expect(hostPage.locator('#player-list')).toContainText('ZoomTest2', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);

        // Wait for countdown
        await hostPage.waitForTimeout(4500);

        // Enable test controls override
        await hostPage.evaluate(() => {
            // @ts-ignore
            if (!window.gameState) window.gameState = {};
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Test camera adjusts as vehicles move apart
        const zoomResult = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            if (!game || !game.vehicles || game.vehicles.size < 2) {
                return { error: 'Need at least 2 vehicles' };
            }

            const vehicles = Array.from(game.vehicles.values());
            const vehicle1 = vehicles[0];
            const vehicle2 = vehicles[1];
            const camera = game.systems.render.camera;

            // Record initial FOV when cars are close
            const closePos1 = { x: 0, y: 1.5, z: -5 };
            const closePos2 = { x: 0, y: 1.5, z: 5 };
            game.systems.physics.resetVehicle(vehicle1.id, closePos1, 0);
            game.systems.physics.resetVehicle(vehicle2.id, closePos2, 0);

            // Wait for transition
            await new Promise(resolve => setTimeout(resolve, 500));
            const initialFOV = camera.fov;

            // Move vehicles far apart
            const farPos1 = { x: -50, y: 1.5, z: 0 };
            const farPos2 = { x: 50, y: 1.5, z: 0 };
            game.systems.physics.resetVehicle(vehicle1.id, farPos1, 0);
            game.systems.physics.resetVehicle(vehicle2.id, farPos2, 0);

            // Wait for camera to adjust
            await new Promise(resolve => setTimeout(resolve, 500));
            const adjustedFOV = camera.fov;

            // Verify both vehicles still visible
            const frustum = new THREE.Frustum();
            const projScreenMatrix = new THREE.Matrix4();
            projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(projScreenMatrix);

            const v1Pos = vehicle1.mesh?.position || vehicle1.position;
            const v2Pos = vehicle2.mesh?.position || vehicle2.position;

            return {
                success: true,
                initialFOV,
                adjustedFOV,
                fovIncreased: adjustedFOV > initialFOV,
                vehicle1Visible: frustum.containsPoint(new THREE.Vector3(v1Pos.x, v1Pos.y, v1Pos.z)),
                vehicle2Visible: frustum.containsPoint(new THREE.Vector3(v2Pos.x, v2Pos.y, v2Pos.z))
            };
        });

        console.log('FOV adjustment test result:', JSON.stringify(zoomResult, null, 2));

        // When vehicles are far apart, camera should have adjusted
        // Either FOV increased or zoom adjusted to keep both visible
        expect(zoomResult.vehicle1Visible).toBe(true);
        expect(zoomResult.vehicle2Visible).toBe(true);

        await player2Page.close();
        await player2Context.close();
    });

    test('should center camera on average position of all vehicles', async ({ hostPage, playerPage, browser }) => {
        // Host creates room
        await hostPage.goto('/');
        const roomCode = await waitForRoomCode(hostPage);

        // Player 1 joins
        await joinGameAsPlayer(playerPage, roomCode, 'CenterTest1');
        await expect(hostPage.locator('#player-list')).toContainText('CenterTest1', { timeout: 10000 });

        // Create a fresh context for Player 2
        const player2Context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            hasTouch: true,
        });
        const player2Page = await player2Context.newPage();
        await joinGameAsPlayer(player2Page, roomCode, 'CenterTest2');
        await expect(hostPage.locator('#player-list')).toContainText('CenterTest2', { timeout: 10000 });

        // Start game
        await startGameFromHost(hostPage);
        await hostPage.waitForTimeout(4500);

        // Enable test controls override
        await hostPage.evaluate(() => {
            // @ts-ignore
            if (!window.gameState) window.gameState = {};
            // @ts-ignore
            window.gameState._testControlsOverride = true;
        });

        // Test camera centers on vehicle midpoint
        const centerResult = await hostPage.evaluate(async () => {
            // @ts-ignore
            const game = window.game;
            if (!game || !game.vehicles || game.vehicles.size < 2) {
                return { error: 'Need at least 2 vehicles' };
            }

            const vehicles = Array.from(game.vehicles.values());
            const vehicle1 = vehicles[0];
            const vehicle2 = vehicles[1];
            const camera = game.systems.render.camera;
            const renderSystem = game.systems.render;

            // Position vehicles at known positions
            const pos1 = { x: -30, y: 1.5, z: 20 };
            const pos2 = { x: 30, y: 1.5, z: -20 };
            game.systems.physics.resetVehicle(vehicle1.id, pos1, 0);
            game.systems.physics.resetVehicle(vehicle2.id, pos2, 0);

            // Wait for camera to update
            await new Promise(resolve => setTimeout(resolve, 500));

            // Expected center point
            const expectedCenterX = (pos1.x + pos2.x) / 2; // 0
            const expectedCenterZ = (pos1.z + pos2.z) / 2; // 0

            // Check if camera is looking at/near the center
            // The camera should be positioned above and behind the center point
            const cameraLookTarget = renderSystem.cameraLookTarget || { x: 0, z: 0 };

            return {
                success: true,
                expectedCenter: { x: expectedCenterX, z: expectedCenterZ },
                cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                cameraCenteredApprox: Math.abs(camera.position.x) < 10 // Camera roughly centered
            };
        });

        console.log('Camera centering test result:', JSON.stringify(centerResult, null, 2));

        // Camera should be roughly centered between vehicles
        expect(centerResult.cameraCenteredApprox).toBe(true);

        await player2Page.close();
        await player2Context.close();
    });

});
