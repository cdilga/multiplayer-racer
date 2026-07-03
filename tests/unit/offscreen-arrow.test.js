import { describe, it, expect } from 'vitest';
import { computeOffscreenArrow } from '../../static/js/ui/vehicleIdentityMath.js';

/**
 * br-car-identity-system — the off-screen indicator decision. When your car
 * leaves the frame its marker pins to the edge; this arrow points from the pin
 * toward the car's true position. Running-game wiring is asserted in the host
 * E2E (tests/e2e/car-identity.spec.ts); this proves the geometry.
 */

const R2D = 180 / Math.PI;

describe('computeOffscreenArrow (off-screen car indicator)', () => {
    it('is not offscreen (no arrow) when the car is on-screen', () => {
        const a = computeOffscreenArrow({ rawX: 640, rawY: 360, clampedX: 640, clampedY: 360, isEdgeClamped: false });
        expect(a.offscreen).toBe(false);
        expect(a.angleRad).toBe(0);
    });

    it('points RIGHT when the car is off the right edge', () => {
        // Marker pinned at right edge (x=1260), car projects further right (x=2000).
        const a = computeOffscreenArrow({ rawX: 2000, rawY: 360, clampedX: 1260, clampedY: 360, isEdgeClamped: true });
        expect(a.offscreen).toBe(true);
        expect(a.angleDeg).toBeCloseTo(0, 5); // rightward
    });

    it('points DOWN when the car is off the bottom edge (screen y grows down)', () => {
        const a = computeOffscreenArrow({ rawX: 640, rawY: 1200, clampedX: 640, clampedY: 700, isEdgeClamped: true });
        expect(a.angleDeg).toBeCloseTo(90, 5);
    });

    it('points UP when the car is off the top edge', () => {
        const a = computeOffscreenArrow({ rawX: 640, rawY: -400, clampedX: 640, clampedY: 40, isEdgeClamped: true });
        expect(a.angleDeg).toBeCloseTo(-90, 5);
    });

    it('points toward the correct diagonal (up-left)', () => {
        const a = computeOffscreenArrow({ rawX: -200, rawY: -200, clampedX: 40, clampedY: 40, isEdgeClamped: true });
        // dx<0, dy<0 -> third quadrant in screen space -> ~ -135deg
        expect(a.angleDeg).toBeCloseTo(-135, 4);
    });

    it('never returns NaN for a degenerate pin (car exactly on the marker)', () => {
        const a = computeOffscreenArrow({ rawX: 100, rawY: 100, clampedX: 100, clampedY: 100, isEdgeClamped: true });
        expect(Number.isFinite(a.angleRad)).toBe(true);
        expect(a.angleDeg).toBeCloseTo(-90, 5); // safe fallback = up
    });

    it('angleRad and angleDeg agree', () => {
        const a = computeOffscreenArrow({ rawX: 900, rawY: 500, clampedX: 640, clampedY: 360, isEdgeClamped: true });
        expect(a.angleDeg).toBeCloseTo(a.angleRad * R2D, 9);
    });
});
