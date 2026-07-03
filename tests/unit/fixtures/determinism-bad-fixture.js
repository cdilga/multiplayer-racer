/**
 * Fixture for tests/unit/determinism-static-scan.test.js ONLY.
 *
 * This file deliberately contains direct, non-deterministic calls so the static
 * scanner can prove it DETECTS them. It is not imported by any gameplay code.
 * Do not "fix" these — they are the negative test case.
 */

export function badArenaPick(arenas) {
    return arenas[Math.floor(Math.random() * arenas.length)];
}

export function badTimer() {
    return performance.now();
}

export function badStamp() {
    return Date.now();
}

// A line that mentions the marker is intentionally allowed and must be ignored
// by the scanner even though it names a banned global:
export function allowedWallClock() {
    return performance.now(); // determinism-allow: fixture proves the inline marker works
}
