/**
 * Runtime spawn/respawn separation invariant (br-around-couch-risk-resolution-3xv.15).
 *
 * A single safe-placement service for every path that puts a car onto the map:
 * initial spawn, respawn, late-join, reconnect recovery, derby re-entry, and race
 * reset/regrid. The invariant it guarantees:
 *
 *   Two cars never enter the exact same point, and never on overlapping footprints.
 *
 * Exact-coordinate reuse is ALWAYS a bug, even under high-player-count fallback.
 * When space is scarce the allocator does deterministic best-effort placement
 * (radial jitter within bounds) rather than silently stacking two solid cars, and
 * emits structured diagnostics for every rejection and fallback.
 *
 * Determinism: all randomness comes from an injected `nextFloat()` (wired to the
 * GameRunContext RNG stream by the caller). This module never calls the global
 * ungoverned RNG, so seeded runs place cars identically every replay.
 */

const DEFAULT_FOOTPRINT_RADIUS = 1.2;   // car half-extent used for overlap tests
const DEFAULT_MIN_SEPARATION = 3.0;     // required centre-to-centre distance
const DEFAULT_COOLDOWN_MS = 750;        // a just-vacated point stays reserved briefly
const DEFAULT_MAX_JITTER_RINGS = 6;
const DEFAULT_JITTER_STEP = 1.5;

function planar(a, b) {
    const dx = (a.x ?? 0) - (b.x ?? 0);
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return Math.hypot(dx, dz);
}

function samePoint(a, b) {
    return (a.x ?? 0) === (b.x ?? 0) && (a.z ?? 0) === (b.z ?? 0);
}

export class SpawnAllocator {
    /**
     * @param {Object} [options]
     * @param {number} [options.footprintRadius] - car half-extent for overlap tests
     * @param {number} [options.minSeparation] - required centre-to-centre distance
     * @param {number} [options.cooldownMs] - how long a vacated point stays reserved
     * @param {function(): number} [options.nextFloat] - deterministic [0,1) source
     * @param {function(): number} [options.now] - ms clock (for cooldowns)
     */
    constructor(options = {}) {
        this.footprintRadius = options.footprintRadius ?? DEFAULT_FOOTPRINT_RADIUS;
        this.minSeparation = options.minSeparation ?? DEFAULT_MIN_SEPARATION;
        this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
        this._nextFloat = typeof options.nextFloat === 'function' ? options.nextFloat : null;
        this._now = typeof options.now === 'function' ? options.now : () => 0;
        // id -> { position, until } (until=Infinity for a live reservation)
        this._reservations = new Map();
    }

    /** Reserve a point for an id (e.g. a live car body). until=null => permanent. */
    reserve(id, position, untilMs = null) {
        this._reservations.set(id, {
            position: { x: position.x ?? 0, z: position.z ?? 0 },
            until: untilMs == null ? Infinity : untilMs
        });
    }

    /** Release an id; its point enters a brief cooldown so a follower can't reuse it instantly. */
    release(id) {
        const existing = this._reservations.get(id);
        if (!existing) return;
        this._reservations.delete(id);
        const cooldownKey = `cooldown:${id}`;
        this._reservations.set(cooldownKey, {
            position: existing.position,
            until: this._now() + this.cooldownMs
        });
    }

    /** Active reservation points (pruning expired cooldowns). */
    activeReservations() {
        const now = this._now();
        const points = [];
        for (const [key, entry] of this._reservations) {
            if (entry.until !== Infinity && entry.until <= now) {
                this._reservations.delete(key);
                continue;
            }
            points.push(entry.position);
        }
        return points;
    }

    _blocked(point, blockers) {
        for (const b of blockers) {
            if (samePoint(point, b)) {
                return { hit: true, occupant: b, distance: 0, exact: true };
            }
            const distance = planar(point, b);
            if (distance < Math.max(this.minSeparation, this.footprintRadius * 2)) {
                return { hit: true, occupant: b, distance, exact: false };
            }
        }
        return { hit: false };
    }

    _jitter(base, blockers, bounds) {
        // Deterministic radial jitter: expand ring by ring; within each ring sample
        // angles from the injected RNG (or a fixed rotation when none is provided).
        const rings = DEFAULT_MAX_JITTER_RINGS;
        const anglesPerRing = 8;
        for (let ring = 1; ring <= rings; ring += 1) {
            const radius = ring * DEFAULT_JITTER_STEP;
            for (let step = 0; step < anglesPerRing; step += 1) {
                const t = this._nextFloat ? this._nextFloat() : (step / anglesPerRing);
                const angle = t * Math.PI * 2 + (step * Math.PI * 2) / anglesPerRing;
                const candidate = {
                    ...base,
                    x: (base.x ?? 0) + Math.cos(angle) * radius,
                    z: (base.z ?? 0) + Math.sin(angle) * radius
                };
                if (bounds && !bounds(candidate)) continue;
                if (!this._blocked(candidate, blockers).hit) {
                    return { position: candidate, ring, radius };
                }
            }
        }
        return null;
    }

    /**
     * Pick a safe placement from ordered candidate poses.
     *
     * @param {Object[]} candidates - preferred poses [{x,z,rotation,...}], best first
     * @param {Object} [context]
     * @param {Object[]} [context.occupied] - live car positions [{id,x,z}]
     * @param {Object[]} [context.reserved] - extra reserved points [{x,z}]
     * @param {function(Object): boolean} [context.inBounds] - surface/bounds predicate
     * @param {Object} [context.meta] - {seed, phase, ruleset, playerCount, requesterId}
     * @returns {{ok:boolean, position:(Object|null), reason:string, fallback:boolean, diagnostics:Object}}
     */
    allocate(candidates = [], context = {}) {
        const occupied = Array.isArray(context.occupied) ? context.occupied : [];
        const extraReserved = Array.isArray(context.reserved) ? context.reserved : [];
        const bounds = typeof context.inBounds === 'function' ? context.inBounds : null;
        const blockers = [...occupied, ...extraReserved, ...this.activeReservations()];
        const rejected = [];

        for (const candidate of candidates) {
            if (bounds && !bounds(candidate)) {
                rejected.push({ candidate, reason: 'out_of_bounds' });
                continue;
            }
            const block = this._blocked(candidate, blockers);
            if (block.hit) {
                rejected.push({
                    candidate,
                    reason: block.exact ? 'exact_point_reuse' : 'footprint_overlap',
                    occupantId: block.occupant?.id ?? null,
                    minPairDistance: block.distance
                });
                continue;
            }
            return {
                ok: true,
                position: candidate,
                reason: 'candidate',
                fallback: false,
                diagnostics: this._diag(context, rejected, candidate, null)
            };
        }

        // No preferred candidate is safe → deterministic jitter fallback around the
        // first candidate (never an exact reuse, never a silent stack).
        const base = candidates[0] || { x: 0, z: 0 };
        const jitter = this._jitter(base, blockers, bounds);
        if (jitter) {
            return {
                ok: true,
                position: jitter.position,
                reason: 'jitter_fallback',
                fallback: true,
                diagnostics: this._diag(context, rejected, jitter.position, jitter)
            };
        }

        return {
            ok: false,
            position: null,
            reason: 'no_safe_placement',
            fallback: true,
            diagnostics: this._diag(context, rejected, null, null)
        };
    }

    _diag(context, rejected, chosen, jitter) {
        const meta = context.meta || {};
        return {
            requesterId: meta.requesterId ?? null,
            mapId: meta.mapId ?? null,
            seed: meta.seed ?? null,
            ruleset: meta.ruleset ?? null,
            phase: meta.phase ?? null,
            playerCount: meta.playerCount ?? null,
            rejectedCount: rejected.length,
            rejected,
            chosen: chosen ? { x: chosen.x, z: chosen.z } : null,
            fallbackRing: jitter?.ring ?? null,
            minSeparation: this.minSeparation,
            footprintRadius: this.footprintRadius
        };
    }
}

export function createSpawnAllocator(options = {}) {
    return new SpawnAllocator(options);
}

export default { SpawnAllocator, createSpawnAllocator };
