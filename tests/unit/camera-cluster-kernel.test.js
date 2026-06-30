import { describe, expect, it } from 'vitest';
import {
    CAMERA_CLUSTER_MODES,
    buildCameraClusters,
    listCameraClusterModes,
    listCameraClusterTunables
} from '../../static/js/geometry/index.js';

function buildPackedCars(count, spacing = 4) {
    return Array.from({ length: count }, (_, index) => ({
        id: `car-${index}`,
        position: {
            x: (index % 8) * spacing,
            y: 0,
            z: Math.floor(index / 8) * spacing
        },
        actionScore: index % 3 === 0 ? 0.2 : 0
    }));
}

function buildScatteredCars(count, xOffset = 0, xStep = 24, zStep = 17) {
    return Array.from({ length: count }, (_, index) => ({
        id: `scatter-${xOffset}-${index}`,
        position: {
            x: xOffset + index * xStep,
            y: 0,
            z: (index % 2) * zStep
        }
    }));
}

function sortNumberAscending(leftValue, rightValue) {
    return leftValue - rightValue;
}

describe('camera cluster kernel - public contract', () => {
    it('publishes the locked modes and host-only tunables', () => {
        expect(listCameraClusterModes()).toEqual([
            expect.objectContaining({ id: 'all-cars-in-view', hostRendererOnly: true }),
            expect.objectContaining({ id: 'cluster-director', hostRendererOnly: true }),
            expect.objectContaining({ id: 'wifes-grid-mode', hostRendererOnly: true })
        ]);

        const tunables = listCameraClusterTunables();
        expect(tunables.map((descriptor) => descriptor.key)).toEqual([
            'mergeDist',
            'splitDist',
            'debounceFrames',
            'maxAutoViewports',
            'importance.carCountWeight',
            'importance.actionWeight'
        ]);
        expect(tunables.every((descriptor) => descriptor.scope === 'host-renderer-only')).toBe(true);
    });

    it('keeps packed groups in one cluster for 1, 2, 4, 8, 16, and 32 cars', () => {
        for (const count of [1, 2, 4, 8, 16, 32]) {
            const result = buildCameraClusters(buildPackedCars(count), {
                mode: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
                mergeDist: 18,
                splitDist: 26,
                maxAutoViewports: 4
            });

            expect(result.groups).toHaveLength(count === 0 ? 0 : 1);
            expect(result.groups[0]?.size ?? 0).toBe(count);
            expect(result.diagnostics.naturalClusterCount).toBe(count === 0 ? 0 : 1);
            expect(result.diagnostics.droppedCarIds).toEqual([]);
            expect(result.architecture.localPhoneControllersRenderWorld).toBe(false);
        }
    });

    it('supports all-cars and Wifes Grid Mode group policies explicitly', () => {
        const cars = buildPackedCars(4);
        const allCarsResult = buildCameraClusters(cars, {
            mode: CAMERA_CLUSTER_MODES.ALL_CARS_IN_VIEW,
            maxAutoViewports: 2
        });
        const gridResult = buildCameraClusters(cars, {
            mode: CAMERA_CLUSTER_MODES.WIFES_GRID_MODE,
            maxAutoViewports: 2
        });

        expect(allCarsResult.groups).toHaveLength(1);
        expect(allCarsResult.groups[0].carIds).toEqual(cars.map((car) => car.id));
        expect(allCarsResult.diagnostics.budgetApplied).toBe(false);

        expect(gridResult.groups).toHaveLength(4);
        expect(gridResult.groups.every((group) => group.size === 1)).toBe(true);
        expect(gridResult.diagnostics.finalClusterCount).toBe(4);
        expect(gridResult.diagnostics.budgetApplied).toBe(false);
    });
});

describe('camera cluster kernel - clustering behavior', () => {
    it('retains previous groups up to splitDist for hysteresis-friendly clustering', () => {
        const cars = [
            { id: 'alpha', position: { x: 0, y: 0, z: 0 } },
            { id: 'bravo', position: { x: 30, y: 0, z: 0 } }
        ];

        const freshResult = buildCameraClusters(cars, {
            mode: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
            mergeDist: 20,
            splitDist: 32,
            maxAutoViewports: 4
        });
        const hysteresisResult = buildCameraClusters(cars, {
            mode: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
            mergeDist: 20,
            splitDist: 32,
            maxAutoViewports: 4,
            previousGroups: [{ carIds: ['alpha', 'bravo'] }]
        });

        expect(freshResult.groups).toHaveLength(2);
        expect(hysteresisResult.groups).toHaveLength(1);
        expect(hysteresisResult.diagnostics.retainedPreviousLinkCount).toBe(1);
    });

    it('coarsens mixed tight, medium, and scattered cars into bounded budget clusters', () => {
        const cars = [
            { id: 'tight-0', position: { x: 0, y: 0, z: 0 } },
            { id: 'tight-1', position: { x: 5, y: 0, z: 0 } },
            { id: 'tight-2', position: { x: 10, y: 0, z: 0 } },
            { id: 'medium-0', position: { x: 50, y: 0, z: 0 } },
            { id: 'medium-1', position: { x: 58, y: 0, z: 0 } },
            { id: 'medium-2', position: { x: 66, y: 0, z: 0 } },
            { id: 'medium-3', position: { x: 74, y: 0, z: 0 } },
            ...buildScatteredCars(4, 130, 24, 21),
            ...buildScatteredCars(5, 240, 24, 21)
        ];

        const result = buildCameraClusters(cars, {
            mode: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
            mergeDist: 18,
            splitDist: 26,
            maxAutoViewports: 4
        });

        expect(result.diagnostics.naturalClusterCount).toBe(11);
        expect(result.diagnostics.finalClusterCount).toBe(4);
        expect(result.diagnostics.budgetCapped).toBe(true);
        expect(result.diagnostics.droppedCarIds).toEqual([]);
        expect(result.diagnostics.totalAssignedCars).toBe(16);
        expect(result.groups.map((group) => group.size).sort(sortNumberAscending)).toEqual([3, 4, 4, 5]);
        expect(result.diagnostics.preferredMaxGroupSize).toBe(5);
    });

    it('caps 32 scattered cars to four groups without dropping a player', () => {
        const cars = [
            ...buildScatteredCars(8, 0, 24, 18),
            ...buildScatteredCars(8, 220, 24, 18),
            ...buildScatteredCars(8, 440, 24, 18),
            ...buildScatteredCars(8, 660, 24, 18)
        ];

        const result = buildCameraClusters(cars, {
            mode: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
            mergeDist: 18,
            splitDist: 28,
            maxAutoViewports: 4
        });

        expect(result.diagnostics.naturalClusterCount).toBe(32);
        expect(result.groups).toHaveLength(4);
        expect(result.diagnostics.finalGroupSizes.reduce((sum, size) => sum + size, 0)).toBe(32);
        expect(result.diagnostics.droppedCarIds).toEqual([]);
        expect(Math.max(...result.diagnostics.finalGroupSizes)).toBeLessThanOrEqual(9);
        expect(Math.min(...result.diagnostics.finalGroupSizes)).toBeGreaterThanOrEqual(7);
    });
});
