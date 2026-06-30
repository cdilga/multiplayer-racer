import {
    buildMarkerIdentity,
    clampMarkerPosition,
    computeHighlightState,
    computeMarkerPresentation,
    computeMarkerPriority,
    estimateMarkerRect,
    resolveSafeArea
} from '../../static/js/ui/vehicleIdentityMath.js';

describe('own car marker math', () => {
    it('normalizes color, number, and name inputs for a badge', () => {
        expect(buildMarkerIdentity({
            playerId: 7,
            playerName: 'SpicyKoala',
            color: '#12abef'
        })).toEqual({
            playerId: 7,
            numberText: '7',
            nameText: 'SpicyKoala',
            color: '#12abef'
        });

        expect(buildMarkerIdentity({
            playerId: 'seat_12',
            playerName: '   ',
            color: 'not-a-color'
        })).toEqual({
            playerId: 'seat_12',
            numberText: '12',
            nameText: 'Player 12',
            color: '#ffffff'
        });
    });

    it('keeps distant badges readable while still emphasizing preferred markers', () => {
        const near = computeMarkerPresentation({ distance: 20, viewportHeight: 720 });
        const far = computeMarkerPresentation({ distance: 220, viewportHeight: 720 });
        const preferred = computeMarkerPresentation({
            distance: 220,
            viewportHeight: 720,
            isPreferred: true,
            isViewerOwned: true,
            isPulsing: true
        });

        expect(far.scale).toBeGreaterThanOrEqual(0.88);
        expect(far.opacity).toBeGreaterThanOrEqual(0.6);
        expect(near.scale).toBeGreaterThan(far.scale);
        expect(preferred.scale).toBeGreaterThan(far.scale);
        expect(preferred.opacity).toBe(1);
    });

    it('tracks pulse timing for spawn and rejoin highlights', () => {
        const active = computeHighlightState({
            nowMs: 1_000,
            pulseUntilMs: 2_000,
            pulseDurationMs: 1_800
        });
        const ended = computeHighlightState({
            nowMs: 2_500,
            pulseUntilMs: 2_000,
            pulseDurationMs: 1_800
        });

        expect(active.active).toBe(true);
        expect(active.remainingMs).toBe(1_000);
        expect(active.intensity).toBeGreaterThan(1);
        expect(ended).toEqual({
            active: false,
            remainingMs: 0,
            intensity: 0
        });
    });

    it('derives safe HUD bounds and clamps marker positions away from them', () => {
        const safeArea = resolveSafeArea({
            viewportWidth: 1280,
            viewportHeight: 720,
            occluders: [
                { left: 20, top: 20, right: 280, bottom: 88 },
                { left: 1020, top: 620, right: 1260, bottom: 700 }
            ],
            margin: 16
        });

        expect(safeArea.safeTop).toBe(104);
        expect(safeArea.safeBottom).toBe(604);

        const clamped = clampMarkerPosition({
            x: 30,
            y: 40,
            viewportWidth: 1280,
            viewportHeight: 720,
            safeLeft: safeArea.safeLeft,
            safeRight: safeArea.safeRight,
            safeTop: safeArea.safeTop,
            safeBottom: safeArea.safeBottom,
            estimatedWidth: 120,
            estimatedHeight: 36
        });

        expect(clamped.x).toBeGreaterThanOrEqual(76);
        expect(clamped.y).toBeGreaterThanOrEqual(140);
    });

    it('estimates a conservative badge footprint for HUD-safe clamping', () => {
        const ordinary = estimateMarkerRect({
            x: 640,
            y: 300,
            scale: 1,
            nameText: 'CameraRacer',
            numberText: '12'
        });
        const viewerOwned = estimateMarkerRect({
            x: 640,
            y: 300,
            scale: 1,
            nameText: 'CameraRacer',
            numberText: '12',
            includeYouLabel: true
        });

        expect(ordinary.height).toBeGreaterThanOrEqual(58);
        expect(ordinary.width).toBeGreaterThan(140);
        expect(viewerOwned.width).toBeGreaterThan(ordinary.width);
    });

    it('prioritizes pulsing and preferred markers in crowded scenes', () => {
        const ordinary = computeMarkerPriority({ distance: 60 });
        const pulsing = computeMarkerPriority({ distance: 60, isPulsing: true });
        const preferred = computeMarkerPriority({ distance: 120, isPreferred: true });

        expect(pulsing).toBeGreaterThan(ordinary);
        expect(preferred).toBeGreaterThan(ordinary);
    });
});
