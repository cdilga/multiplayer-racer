import {
    EPSILON,
    measurePairwiseSpawnDistances,
    quantizeNumber,
    stableCanonicalize
} from './GeometryKernel.js';

const CAMERA_CLUSTER_SCHEMA = 'camera-cluster-kernel/v1';
const CAMERA_CLUSTER_MODES = Object.freeze({
    ALL_CARS_IN_VIEW: 'all-cars-in-view',
    CLUSTER_DIRECTOR: 'cluster-director',
    WIFES_GRID_MODE: 'wifes-grid-mode'
});

const DEFAULT_CAMERA_CLUSTER_OPTIONS = Object.freeze({
    mode: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
    mergeDist: 28,
    splitDist: 40,
    debounceFrames: 10,
    maxAutoViewports: 4,
    budgetSlack: 1,
    importance: Object.freeze({
        carCountWeight: 1,
        actionWeight: 0.35
    })
});

const CAMERA_CLUSTER_TUNABLES = Object.freeze([
    Object.freeze({
        key: 'mergeDist',
        label: 'Merge Distance',
        defaultValue: DEFAULT_CAMERA_CLUSTER_OPTIONS.mergeDist,
        minValue: 8,
        maxValue: 160,
        step: 1,
        storageKey: 'jj_camera_cluster_merge_dist',
        scope: 'host-renderer-only',
        description: 'Ground-plane distance where separate cars or clusters merge into one camera group.'
    }),
    Object.freeze({
        key: 'splitDist',
        label: 'Split Distance',
        defaultValue: DEFAULT_CAMERA_CLUSTER_OPTIONS.splitDist,
        minValue: 10,
        maxValue: 220,
        step: 1,
        storageKey: 'jj_camera_cluster_split_dist',
        scope: 'host-renderer-only',
        description: 'Ground-plane distance where a previously shared group is allowed to separate again.'
    }),
    Object.freeze({
        key: 'debounceFrames',
        label: 'Debounce Frames',
        defaultValue: DEFAULT_CAMERA_CLUSTER_OPTIONS.debounceFrames,
        minValue: 0,
        maxValue: 60,
        step: 1,
        storageKey: 'jj_camera_cluster_debounce_frames',
        scope: 'host-renderer-only',
        description: 'Minimum host frames that a cluster-count change should persist before retile.'
    }),
    Object.freeze({
        key: 'maxAutoViewports',
        label: 'Max Auto Viewports',
        defaultValue: DEFAULT_CAMERA_CLUSTER_OPTIONS.maxAutoViewports,
        minValue: 1,
        maxValue: 16,
        step: 1,
        storageKey: 'jj_camera_cluster_max_auto_viewports',
        scope: 'host-renderer-only',
        description: 'Maximum viewport budget for cluster director before natural groups are coarsened.'
    }),
    Object.freeze({
        key: 'importance.carCountWeight',
        label: 'Importance Car Count Weight',
        defaultValue: DEFAULT_CAMERA_CLUSTER_OPTIONS.importance.carCountWeight,
        minValue: 0,
        maxValue: 4,
        step: 0.05,
        storageKey: 'jj_camera_cluster_importance_car_count_weight',
        scope: 'host-renderer-only',
        description: 'Viewport-importance weight applied to group population.'
    }),
    Object.freeze({
        key: 'importance.actionWeight',
        label: 'Importance Action Weight',
        defaultValue: DEFAULT_CAMERA_CLUSTER_OPTIONS.importance.actionWeight,
        minValue: 0,
        maxValue: 4,
        step: 0.05,
        storageKey: 'jj_camera_cluster_importance_action_weight',
        scope: 'host-renderer-only',
        description: 'Viewport-importance weight applied to recent action or collision interest.'
    })
]);

function sanitizeNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function sanitizeInteger(value, fallback = 0, minimum = 0) {
    const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.max(minimum, normalized);
}

function clampNumber(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function cloneVec3(point = {}) {
    return {
        x: sanitizeNumber(point.x, 0),
        y: sanitizeNumber(point.y, 0),
        z: sanitizeNumber(point.z, 0)
    };
}

function normalizeMode(mode) {
    const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';

    switch (normalized) {
    case 'all':
    case 'all-cars':
    case 'all-cars-in-view':
    case 'allcarsinview':
        return CAMERA_CLUSTER_MODES.ALL_CARS_IN_VIEW;
    case 'cluster':
    case 'cluster-director':
    case 'clusterdirector':
    case 'auto':
    case 'auto-split':
        return CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR;
    case 'grid':
    case 'wifes-grid':
    case 'wifes-grid-mode':
    case 'wifesgridmode':
        return CAMERA_CLUSTER_MODES.WIFES_GRID_MODE;
    default:
        return DEFAULT_CAMERA_CLUSTER_OPTIONS.mode;
    }
}

function resolveCameraClusterOptions(options = {}) {
    const mergeDist = clampNumber(
        sanitizeNumber(options.mergeDist, DEFAULT_CAMERA_CLUSTER_OPTIONS.mergeDist),
        0,
        10000
    );
    const splitDist = Math.max(
        mergeDist,
        clampNumber(
            sanitizeNumber(options.splitDist, DEFAULT_CAMERA_CLUSTER_OPTIONS.splitDist),
            0,
            10000
        )
    );

    return {
        mode: normalizeMode(options.mode),
        mergeDist: quantizeNumber(mergeDist),
        splitDist: quantizeNumber(splitDist),
        debounceFrames: sanitizeInteger(
            options.debounceFrames,
            DEFAULT_CAMERA_CLUSTER_OPTIONS.debounceFrames,
            0
        ),
        maxAutoViewports: sanitizeInteger(
            options.maxAutoViewports,
            DEFAULT_CAMERA_CLUSTER_OPTIONS.maxAutoViewports,
            1
        ),
        budgetSlack: sanitizeInteger(
            options.budgetSlack,
            DEFAULT_CAMERA_CLUSTER_OPTIONS.budgetSlack,
            0
        ),
        importance: {
            carCountWeight: clampNumber(
                sanitizeNumber(
                    options.importance?.carCountWeight,
                    DEFAULT_CAMERA_CLUSTER_OPTIONS.importance.carCountWeight
                ),
                0,
                100
            ),
            actionWeight: clampNumber(
                sanitizeNumber(
                    options.importance?.actionWeight,
                    DEFAULT_CAMERA_CLUSTER_OPTIONS.importance.actionWeight
                ),
                0,
                100
            )
        }
    };
}

function listCameraClusterModes() {
    return [
        {
            id: CAMERA_CLUSTER_MODES.ALL_CARS_IN_VIEW,
            label: 'All Cars In View',
            budgeted: false,
            hostRendererOnly: true,
            description: 'One shared host camera keeps the full field readable.'
        },
        {
            id: CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
            label: 'Cluster Director',
            budgeted: true,
            hostRendererOnly: true,
            description: 'Natural ground-plane clusters coarsen to a viewport budget when needed.'
        },
        {
            id: CAMERA_CLUSTER_MODES.WIFES_GRID_MODE,
            label: 'Wife\'s Grid Mode',
            budgeted: false,
            hostRendererOnly: true,
            description: 'Opt-in one-camera-per-player grouping for per-player follow panes.'
        }
    ].map((mode) => stableCanonicalize(mode));
}

function listCameraClusterTunables() {
    return CAMERA_CLUSTER_TUNABLES.map((descriptor) => stableCanonicalize(descriptor));
}

function normalizeCars(cars = []) {
    const seenIds = new Map();

    return cars.map((car, index) => {
        const rawId = typeof car?.id === 'string' && car.id.trim()
            ? car.id.trim()
            : `car-${index}`;
        const seenCount = seenIds.get(rawId) || 0;
        seenIds.set(rawId, seenCount + 1);
        const id = seenCount === 0 ? rawId : `${rawId}-${seenCount + 1}`;
        const point = cloneVec3(car?.position || car);

        return {
            id,
            sourceId: rawId,
            index,
            position: point,
            actionScore: sanitizeNumber(
                car?.actionScore ?? car?.recentAction ?? car?.recentActionScore ?? car?.importanceScore,
                sanitizeNumber(car?.importance?.action, 0)
            )
        };
    });
}

function buildPairKey(leftId, rightId) {
    return leftId < rightId ? `${leftId}::${rightId}` : `${rightId}::${leftId}`;
}

function buildPairDiagnostics(cars) {
    const pairwise = measurePairwiseSpawnDistances(cars.map((car) => ({
        id: car.id,
        position: car.position
    })));
    const pairDistanceMap = new Map();

    for (const pair of pairwise.pairwise) {
        pairDistanceMap.set(buildPairKey(pair.aId, pair.bId), sanitizeNumber(pair.distance, Infinity));
    }

    return {
        pairDistanceMap,
        pairwise
    };
}

function buildPreviousLinkSet(previousGroups = []) {
    const links = new Set();

    for (const group of previousGroups) {
        const carIds = Array.isArray(group?.carIds)
            ? group.carIds
            : (Array.isArray(group?.memberIds)
                ? group.memberIds
                : (Array.isArray(group?.cars) ? group.cars.map((car) => car?.id).filter(Boolean) : []));

        for (let leftIndex = 0; leftIndex < carIds.length; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < carIds.length; rightIndex++) {
                links.add(buildPairKey(carIds[leftIndex], carIds[rightIndex]));
            }
        }
    }

    return links;
}

function makeDisjointSet(size) {
    const parent = Array.from({ length: size }, (_, index) => index);

    function find(index) {
        if (parent[index] !== index) {
            parent[index] = find(parent[index]);
        }
        return parent[index];
    }

    function unite(leftIndex, rightIndex) {
        const leftRoot = find(leftIndex);
        const rightRoot = find(rightIndex);
        if (leftRoot !== rightRoot) {
            parent[rightRoot] = leftRoot;
        }
    }

    return { find, unite };
}

function compareNumbers(leftValue, rightValue) {
    return leftValue - rightValue;
}

function materializeGroup(cars, memberIndices, options) {
    const sortedIndices = memberIndices.slice().sort(compareNumbers);
    const members = sortedIndices.map((memberIndex) => cars[memberIndex]);
    const sum = members.reduce((accumulator, member) => {
        accumulator.x += member.position.x;
        accumulator.y += member.position.y;
        accumulator.z += member.position.z;
        accumulator.actionScore += member.actionScore;
        return accumulator;
    }, { x: 0, y: 0, z: 0, actionScore: 0 });
    const size = members.length;
    const centroid = {
        x: sum.x / Math.max(size, 1),
        y: sum.y / Math.max(size, 1),
        z: sum.z / Math.max(size, 1)
    };
    const radiusPairs = measurePairwiseSpawnDistances([
        { id: '__centroid__', position: centroid },
        ...members.map((member) => ({ id: member.id, position: member.position }))
    ]);
    let radius = 0;
    for (const pair of radiusPairs.pairwise) {
        if (pair.aId === '__centroid__' || pair.bId === '__centroid__') {
            radius = Math.max(radius, sanitizeNumber(pair.distance, 0));
        }
    }

    const bounds = members.reduce((accumulator, member) => {
        accumulator.minX = Math.min(accumulator.minX, member.position.x);
        accumulator.maxX = Math.max(accumulator.maxX, member.position.x);
        accumulator.minY = Math.min(accumulator.minY, member.position.y);
        accumulator.maxY = Math.max(accumulator.maxY, member.position.y);
        accumulator.minZ = Math.min(accumulator.minZ, member.position.z);
        accumulator.maxZ = Math.max(accumulator.maxZ, member.position.z);
        return accumulator;
    }, {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity
    });

    const actionContribution = options.importance.actionWeight * sum.actionScore;
    const carCountContribution = options.importance.carCountWeight * size;

    return {
        memberIndices: sortedIndices,
        memberIds: members.map((member) => member.id),
        firstInputIndex: sortedIndices[0] ?? 0,
        size,
        centroid,
        bounds,
        radius,
        actionScoreTotal: sum.actionScore,
        importanceScore: carCountContribution + actionContribution,
        importanceBreakdown: {
            carCountContribution,
            actionContribution
        },
        sourceClusterCount: 1
    };
}

function sortGroups(groups) {
    return groups.slice().sort((leftGroup, rightGroup) => {
        if (leftGroup.firstInputIndex !== rightGroup.firstInputIndex) {
            return leftGroup.firstInputIndex - rightGroup.firstInputIndex;
        }
        if (leftGroup.size !== rightGroup.size) {
            return leftGroup.size - rightGroup.size;
        }
        return leftGroup.memberIds.join('|').localeCompare(rightGroup.memberIds.join('|'));
    });
}

function computeNaturalGroups(cars, pairDistanceMap, options, previousLinkSet) {
    const disjointSet = makeDisjointSet(cars.length);
    let mergePairCount = 0;
    let retainedPreviousLinkCount = 0;

    for (let leftIndex = 0; leftIndex < cars.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < cars.length; rightIndex++) {
            const leftCar = cars[leftIndex];
            const rightCar = cars[rightIndex];
            const pairKey = buildPairKey(leftCar.id, rightCar.id);
            const distance = sanitizeNumber(pairDistanceMap.get(pairKey), Infinity);
            const withinMerge = distance <= options.mergeDist + EPSILON;
            const withinSplit = previousLinkSet.has(pairKey) && distance <= options.splitDist + EPSILON;

            if (withinMerge || withinSplit) {
                disjointSet.unite(leftIndex, rightIndex);
                if (withinMerge) {
                    mergePairCount += 1;
                } else if (withinSplit) {
                    retainedPreviousLinkCount += 1;
                }
            }
        }
    }

    const groupedMembers = new Map();
    for (let index = 0; index < cars.length; index++) {
        const root = disjointSet.find(index);
        if (!groupedMembers.has(root)) {
            groupedMembers.set(root, []);
        }
        groupedMembers.get(root).push(index);
    }

    return {
        groups: sortGroups(
            Array.from(groupedMembers.values()).map((memberIndices) => materializeGroup(cars, memberIndices, options))
        ),
        mergePairCount,
        retainedPreviousLinkCount
    };
}

function computeMinGroupDistance(group, otherGroup, pairDistanceMap) {
    let minDistance = Infinity;

    for (const leftId of group.memberIds) {
        for (const rightId of otherGroup.memberIds) {
            minDistance = Math.min(
                minDistance,
                sanitizeNumber(pairDistanceMap.get(buildPairKey(leftId, rightId)), Infinity)
            );
        }
    }

    return minDistance;
}

function mergeGroupPair(cars, leftGroup, rightGroup, options) {
    const merged = materializeGroup(
        cars,
        [...leftGroup.memberIndices, ...rightGroup.memberIndices],
        options
    );
    merged.sourceClusterCount = leftGroup.sourceClusterCount + rightGroup.sourceClusterCount;
    return merged;
}

function buildMergeHistoryEntry(leftGroup, rightGroup, distance, mergedGroup, preferredMaxGroupSize) {
    return stableCanonicalize({
        leftCarIds: leftGroup.memberIds,
        rightCarIds: rightGroup.memberIds,
        distance: quantizeNumber(distance),
        mergedSize: mergedGroup.size,
        overflow: Math.max(0, mergedGroup.size - preferredMaxGroupSize)
    });
}

function coarsenGroupsToBudget(cars, naturalGroups, pairDistanceMap, options) {
    const budget = Math.max(1, options.maxAutoViewports);
    if (naturalGroups.length <= budget) {
        return {
            groups: naturalGroups,
            mergeHistory: [],
            preferredMaxGroupSize: Math.max(...naturalGroups.map((group) => group.size), 0)
        };
    }

    const baseCapacity = Math.ceil(cars.length / budget) + options.budgetSlack;
    const largestNaturalGroup = Math.max(...naturalGroups.map((group) => group.size), 0);
    const preferredMaxGroupSize = Math.max(baseCapacity, largestNaturalGroup);
    const groups = naturalGroups.slice();
    const mergeHistory = [];

    while (groups.length > budget) {
        let bestCandidate = null;

        for (let leftIndex = 0; leftIndex < groups.length; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex++) {
                const leftGroup = groups[leftIndex];
                const rightGroup = groups[rightIndex];
                const distance = computeMinGroupDistance(leftGroup, rightGroup, pairDistanceMap);
                const mergedSize = leftGroup.size + rightGroup.size;
                const overflow = Math.max(0, mergedSize - preferredMaxGroupSize);
                const mergeKey = [...leftGroup.memberIds, ...rightGroup.memberIds].sort().join('|');

                const candidate = {
                    leftIndex,
                    rightIndex,
                    distance,
                    mergedSize,
                    overflow,
                    mergeKey
                };

                if (!bestCandidate ||
                    candidate.overflow < bestCandidate.overflow ||
                    (candidate.overflow === bestCandidate.overflow &&
                        candidate.distance < bestCandidate.distance - EPSILON) ||
                    (candidate.overflow === bestCandidate.overflow &&
                        Math.abs(candidate.distance - bestCandidate.distance) <= EPSILON &&
                        candidate.mergeKey < bestCandidate.mergeKey)) {
                    bestCandidate = candidate;
                }
            }
        }

        if (!bestCandidate) {
            break;
        }

        const leftGroup = groups[bestCandidate.leftIndex];
        const rightGroup = groups[bestCandidate.rightIndex];
        const mergedGroup = mergeGroupPair(cars, leftGroup, rightGroup, options);

        mergeHistory.push(buildMergeHistoryEntry(
            leftGroup,
            rightGroup,
            bestCandidate.distance,
            mergedGroup,
            preferredMaxGroupSize
        ));

        groups.splice(bestCandidate.rightIndex, 1);
        groups.splice(bestCandidate.leftIndex, 1, mergedGroup);
    }

    return {
        groups: sortGroups(groups),
        mergeHistory,
        preferredMaxGroupSize
    };
}

function buildNearestExternalDistance(groups, groupIndex, pairDistanceMap) {
    let nearestDistance = Infinity;

    for (let otherIndex = 0; otherIndex < groups.length; otherIndex++) {
        if (otherIndex === groupIndex) continue;
        nearestDistance = Math.min(
            nearestDistance,
            computeMinGroupDistance(groups[groupIndex], groups[otherIndex], pairDistanceMap)
        );
    }

    return Number.isFinite(nearestDistance) ? quantizeNumber(nearestDistance) : null;
}

function finalizeGroups(groups, pairDistanceMap) {
    return groups.map((group, index) => stableCanonicalize({
        id: `cluster-${index}`,
        carIds: group.memberIds,
        size: group.size,
        sourceClusterCount: group.sourceClusterCount,
        centroid: {
            x: quantizeNumber(group.centroid.x),
            y: quantizeNumber(group.centroid.y),
            z: quantizeNumber(group.centroid.z)
        },
        bounds: {
            minX: quantizeNumber(group.bounds.minX),
            maxX: quantizeNumber(group.bounds.maxX),
            minY: quantizeNumber(group.bounds.minY),
            maxY: quantizeNumber(group.bounds.maxY),
            minZ: quantizeNumber(group.bounds.minZ),
            maxZ: quantizeNumber(group.bounds.maxZ)
        },
        radius: quantizeNumber(group.radius),
        nearestExternalDistance: buildNearestExternalDistance(groups, index, pairDistanceMap),
        importance: {
            score: quantizeNumber(group.importanceScore),
            carCountContribution: quantizeNumber(group.importanceBreakdown.carCountContribution),
            actionContribution: quantizeNumber(group.importanceBreakdown.actionContribution)
        }
    }));
}

function collectAssignedCarIds(groups) {
    return groups.flatMap((group) => group.carIds);
}

function buildArchitectureGuard() {
    return stableCanonicalize({
        scope: 'host-renderer-only',
        localHostRendersWorld: true,
        localPhoneControllersRenderWorld: false,
        remoteViewerNotes: 'Remote viewers are separate consumers and not part of Local host camera grouping.'
    });
}

function buildCameraClusters(cars = [], options = {}) {
    const normalizedCars = normalizeCars(cars);
    const resolvedOptions = resolveCameraClusterOptions(options);
    const { pairDistanceMap, pairwise } = buildPairDiagnostics(normalizedCars);
    const previousGroups = Array.isArray(options.previousGroups)
        ? options.previousGroups
        : (Array.isArray(options.previous?.groups) ? options.previous.groups : []);
    const previousLinkSet = buildPreviousLinkSet(previousGroups);

    let naturalGroups = [];
    let groups = [];
    let mergeHistory = [];
    let mergePairCount = 0;
    let retainedPreviousLinkCount = 0;
    let preferredMaxGroupSize = normalizedCars.length > 0 ? normalizedCars.length : 0;

    if (resolvedOptions.mode === CAMERA_CLUSTER_MODES.ALL_CARS_IN_VIEW) {
        naturalGroups = normalizedCars.length > 0
            ? [materializeGroup(normalizedCars, normalizedCars.map((_, index) => index), resolvedOptions)]
            : [];
        groups = naturalGroups;
    } else if (resolvedOptions.mode === CAMERA_CLUSTER_MODES.WIFES_GRID_MODE) {
        naturalGroups = normalizedCars.map((_, index) => materializeGroup(normalizedCars, [index], resolvedOptions));
        groups = naturalGroups;
    } else {
        const natural = computeNaturalGroups(
            normalizedCars,
            pairDistanceMap,
            resolvedOptions,
            previousLinkSet
        );
        naturalGroups = natural.groups;
        mergePairCount = natural.mergePairCount;
        retainedPreviousLinkCount = natural.retainedPreviousLinkCount;

        const coarsened = coarsenGroupsToBudget(
            normalizedCars,
            naturalGroups,
            pairDistanceMap,
            resolvedOptions
        );
        groups = coarsened.groups;
        mergeHistory = coarsened.mergeHistory;
        preferredMaxGroupSize = coarsened.preferredMaxGroupSize;
    }

    const finalizedGroups = finalizeGroups(groups, pairDistanceMap);
    const assignedCarIds = collectAssignedCarIds(finalizedGroups);
    const uniqueAssignedCarIds = new Set(assignedCarIds);
    const droppedCarIds = normalizedCars
        .map((car) => car.id)
        .filter((carId) => !uniqueAssignedCarIds.has(carId));

    return stableCanonicalize({
        schema: CAMERA_CLUSTER_SCHEMA,
        mode: resolvedOptions.mode,
        options: {
            mergeDist: resolvedOptions.mergeDist,
            splitDist: resolvedOptions.splitDist,
            debounceFrames: resolvedOptions.debounceFrames,
            maxAutoViewports: resolvedOptions.maxAutoViewports,
            budgetSlack: resolvedOptions.budgetSlack,
            importance: resolvedOptions.importance
        },
        architecture: buildArchitectureGuard(),
        groups: finalizedGroups,
        diagnostics: {
            totalCars: normalizedCars.length,
            totalAssignedCars: assignedCarIds.length,
            droppedCarIds,
            pairwiseDistanceCount: pairwise.pairwise.length,
            minPairDistance: pairwise.minDistance,
            naturalClusterCount: naturalGroups.length,
            finalClusterCount: finalizedGroups.length,
            naturalGroupSizes: naturalGroups.map((group) => group.size),
            finalGroupSizes: finalizedGroups.map((group) => group.size),
            mergePairCount,
            retainedPreviousLinkCount,
            budgetApplied: resolvedOptions.mode === CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR,
            budgetCapped: resolvedOptions.mode === CAMERA_CLUSTER_MODES.CLUSTER_DIRECTOR &&
                naturalGroups.length > resolvedOptions.maxAutoViewports,
            preferredMaxGroupSize,
            mergeHistory,
            tuningPanelDescriptors: listCameraClusterTunables()
        }
    });
}

export {
    CAMERA_CLUSTER_MODES,
    CAMERA_CLUSTER_SCHEMA,
    CAMERA_CLUSTER_TUNABLES,
    DEFAULT_CAMERA_CLUSTER_OPTIONS,
    buildCameraClusters,
    listCameraClusterModes,
    listCameraClusterTunables,
    resolveCameraClusterOptions
};
