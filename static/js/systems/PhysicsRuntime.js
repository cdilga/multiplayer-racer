/**
 * PhysicsRuntime (br-physics-runtime-extract) — an injectable, headless,
 * deterministic Rapier stepper.
 *
 * The live PhysicsSystem couples Rapier to the browser render loop and wall
 * clock. This wrapper isolates "a Rapier World stepped at a fixed dt under an
 * injected clock" so the sim can run in Node (or a worker) for deterministic
 * replays and parameter sweeps (the enabler for the physics-feel beads). RAPIER
 * is injected (same pattern as PhysicsSystem) so it works in tests and runtime.
 *
 * Determinism: fixed timestep + no wall-clock reads here; the same RAPIER build,
 * gravity, bodies, and per-tick inputs produce the same trajectory every run.
 */
export class PhysicsRuntime {
    /**
     * @param {Object} options
     * @param {Object} options.RAPIER - the Rapier module (injected)
     * @param {{x:number,y:number,z:number}} [options.gravity]
     * @param {number} [options.fixedDt=1/60] - fixed simulation timestep (seconds)
     */
    constructor({ RAPIER, gravity = { x: 0, y: -9.81, z: 0 }, fixedDt = 1 / 60 } = {}) {
        if (!RAPIER) throw new Error('PhysicsRuntime requires an injected RAPIER module');
        this.RAPIER = RAPIER;
        this.fixedDt = fixedDt;
        this.world = new RAPIER.World(gravity);
        if ('timestep' in this.world) this.world.timestep = fixedDt;
        this.tick = 0;
        this.simTimeMs = 0;
    }

    /** Advance the simulation by exactly one fixed timestep. */
    step() {
        this.world.step();
        this.tick += 1;
        this.simTimeMs += this.fixedDt * 1000;
    }

    /** Advance `n` fixed steps. */
    stepMany(n = 1) {
        for (let i = 0; i < Math.max(0, Math.floor(n)); i += 1) this.step();
    }

    /** Current sim time in ms (a clock derived from ticks, never wall time). */
    nowMs() {
        return this.simTimeMs;
    }

    /** Release Rapier resources. */
    free() {
        if (this.world && typeof this.world.free === 'function') this.world.free();
        this.world = null;
    }
}

/**
 * SimVehicleAdapter — a minimal headless vehicle body driven by scripted controls,
 * so the runtime can sweep-tune feel without the full render-coupled vehicle.
 */
export class SimVehicleAdapter {
    /**
     * @param {PhysicsRuntime} runtime
     * @param {Object} [options]
     * @param {{x:number,y:number,z:number}} [options.position]
     * @param {{x:number,y:number,z:number}} [options.halfExtents] - cuboid half-sizes
     * @param {number} [options.engineForce] - forward force per unit acceleration
     * @param {number} [options.steerTorque] - yaw torque per unit steering
     */
    constructor(runtime, options = {}) {
        const RAPIER = runtime.RAPIER;
        const pos = options.position || { x: 0, y: 2, z: 0 };
        const he = options.halfExtents || { x: 1, y: 0.5, z: 2 };
        this.runtime = runtime;
        this.engineForce = options.engineForce ?? 800;
        this.steerTorque = options.steerTorque ?? 120;
        this.body = runtime.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.4).setAngularDamping(0.6)
        );
        runtime.world.createCollider(
            RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z).setFriction(0.9),
            this.body
        );
    }

    /**
     * Apply one tick of controls (deterministic: pure force/torque from inputs).
     * @param {{acceleration?:number, braking?:number, steering?:number}} controls
     */
    applyControls(controls = {}) {
        const accel = (controls.acceleration || 0) - (controls.braking || 0);
        const rot = this.body.rotation();
        // Forward vector from the body's quaternion (local -Z is "forward").
        const fx = 2 * (rot.x * rot.z + rot.w * rot.y);
        const fz = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
        const f = this.engineForce * accel;
        this.body.addForce({ x: fx * f, y: 0, z: fz * f }, true);
        if (controls.steering) {
            this.body.addTorque({ x: 0, y: -controls.steering * this.steerTorque, z: 0 }, true);
        }
    }

    /** Quantized position/velocity state (for trajectory hashing). */
    getState() {
        const p = this.body.translation();
        const v = this.body.linvel();
        const q = (n) => Math.round(n * 1000) / 1000;
        return { x: q(p.x), y: q(p.y), z: q(p.z), vx: q(v.x), vy: q(v.y), vz: q(v.z) };
    }
}

export default { PhysicsRuntime, SimVehicleAdapter };
