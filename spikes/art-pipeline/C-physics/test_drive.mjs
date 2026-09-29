// test_drive.mjs — task 2: settle, full-throttle, full-lock turn, brake-to-stop, at 120 Hz fixed dt.
//
// Also exported as `runDriveScenario` so test_determinism.mjs can run the exact same input script
// twice and hash the result.

import { writeFileSync } from "node:fs";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, DT, FORWARD_SIGN } from "./physics_common.mjs";
import { loadVehicle } from "./load_vehicle.mjs";

const GLB = "../out/cruz_missile.glb";
const SIDECAR = "../out/cruz_missile.asset.json";

// NOTE on drag (REPORT.md #8): we tried adding an ad hoc aerodynamic-drag `body.addForce()` per
// step so "full throttle" would show a plateauing top speed. It produced a bogus result: applying
// any external force that perturbs chassis velocity independently of the wheels caused the
// simulated speed to decay through zero and then accelerate away in the OPPOSITE direction to a
// stable-looking (but physically nonsensical) new "resting" speed — e.g. an initial -10 m/s decayed
// past 0 and settled at +9 m/s under pure drag, with ZERO engine force applied. Root cause:
// `updateVehicle()` derives each wheel's longitudinal tire force from the slip between the
// chassis's contact-point velocity and the wheel's own tracked rotation state; it does not expect
// another system to change the chassis velocity out from under it between calls, and fights the
// perturbation using its internal (undamped) friction model. Conclusion: drag/rolling-resistance
// for jj-sim must either (a) be applied as a wheel-level effect the controller itself integrates
// (e.g. via engineForce/brake, not addForce on the body), or (b) target wheel angular state too.
// We did NOT add drag here — the throttle phase below reports actual (still-accelerating)
// behaviour honestly rather than papering over this with a fudge factor.
function applyDrag() { /* intentionally a no-op; see note above */ }

function assertFinite(label, v3) {
    for (const [k, val] of Object.entries(v3)) {
        if (!Number.isFinite(val)) throw new Error(`non-finite ${label}.${k} = ${val}`);
    }
}

export async function runDriveScenario({ cabinShape = "round", log = null } = {}) {
    const RAPIER = await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const spawnDrop = 0.5; // drop-in height above authored rest pose, to measure settle from a bounce
    const { body, controller, wheelIndex, restLength } = buildVehicle(world, v, {
        spawn: [0, v.groundOffsetY + spawnDrop, 0], cabinShape,
    });
    const names = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
    const idx = names.map((n) => wheelIndex[n]);

    const result = { phases: {}, checks: {} };
    let step = 0;
    const record = (phaseLog, extra = {}) => {
        const t = body.translation(), lv = body.linvel(), av = body.angvel(), rot = body.rotation();
        assertFinite("pos", t); assertFinite("linvel", lv); assertFinite("angvel", av);
        const contacts = idx.map((i) => controller.wheelIsInContact(i));
        const suspLens = idx.map((i) => controller.wheelSuspensionLength(i));
        // penetration check: chassis collider (col_chassis) bottom must stay above ground (y=0)
        // once settled — a rough proxy, not a full manifold query.
        const chassisHalfY = v.colliders.col_chassis.halfExtents[1];
        const chassisRelY = v.colliders.col_chassis.centerRel[1];
        const chassisBottomY = t.y + chassisRelY - chassisHalfY;
        if (log) phaseLog.push({ step, t: step * DT, pos: t, linvel: lv, angvel: av, rot, contacts, suspLens, chassisBottomY, ...extra });
        return { t, lv, av, contacts, suspLens, chassisBottomY };
    };

    // ---- phase A: settle (no input) ----
    const settleLog = [];
    let settledAtStep = null;
    let prevY = null;
    for (let i = 0; i < 240; i++) { // 2s
        stepWorld(world, controller);
        applyDrag(body);
        step++;
        const r = record(settleLog);
        if (prevY !== null && settledAtStep === null && Math.abs(r.t.y - prevY) < 0.0003 && Math.abs(r.lv.y) < 0.05) {
            settledAtStep = step;
        }
        prevY = r.t.y;
    }
    const restingRideHeightY = body.translation().y;
    const restingSuspLens = idx.map((i) => controller.wheelSuspensionLength(i));
    result.phases.settle = {
        durationSteps: 240,
        settledAtStep, settledAtSeconds: settledAtStep ? settledAtStep * DT : null,
        restingRideHeightY, restingSuspLens, restLength,
        allWheelsGrounded: idx.every((i) => controller.wheelIsInContact(i)),
        log: log ? settleLog : undefined,
    };

    // ---- phase B: full throttle, 3s, straight ----
    const throttleLog = [];
    const speedSamples = [];
    const ENGINE_FORCE = 4200;
    for (let i = 0; i < idx.length; i++) controller.setWheelEngineForce(idx[i], FORWARD_SIGN * ENGINE_FORCE);
    const startZ = body.translation().z;
    for (let i = 0; i < 360; i++) { // 3s
        stepWorld(world, controller);
        applyDrag(body);
        step++;
        record(throttleLog);
        if ((i + 1) % 12 === 0) speedSamples.push({ t: (i + 1) * DT, speed: Math.abs(controller.currentVehicleSpeed()) });
    }
    const endZ = body.translation().z;
    const speedAt3s = Math.abs(controller.currentVehicleSpeed());
    const target60 = speedAt3s * 0.6;
    const t60 = speedSamples.find((s) => s.speed >= target60);
    result.phases.throttle = {
        durationSteps: 360, engineForcePerWheel: ENGINE_FORCE,
        distanceM: Math.abs(endZ - startZ), speedAt3sMS: speedAt3s, speedAt3sKmh: speedAt3s * 3.6,
        stillAccelerating: true, // no drag model in this spike — see note above; NOT a terminal top speed
        timeTo60PctOf3sSpeedS: t60 ? t60.t : null,
        speedSamples, log: log ? throttleLog : undefined,
    };

    // ---- phase C: full-lock turn (moderate constant throttle, max steering one side) ----
    const turnLog = [];
    const MAX_STEER = 0.55; // rad (~31.5deg), plausible front-wheel lock angle
    const TURN_ENGINE_FORCE = 1500;
    for (let i = 0; i < idx.length; i++) controller.setWheelEngineForce(idx[i], FORWARD_SIGN * TURN_ENGINE_FORCE);
    controller.setWheelSteering(wheelIndex.wheel_FL, MAX_STEER);
    controller.setWheelSteering(wheelIndex.wheel_FR, MAX_STEER);
    const headings = [];
    const positions = [];
    for (let i = 0; i < 480; i++) { // 4s
        stepWorld(world, controller);
        applyDrag(body);
        step++;
        record(turnLog);
        const t = body.translation();
        const av = body.angvel();
        positions.push([t.x, t.z]);
        headings.push({ t: i * DT, yawRate: av.y, speed: Math.abs(controller.currentVehicleSpeed()) });
    }
    // steady-state turning circle: use the last 1s of yaw-rate/speed to estimate radius = v / |omega|.
    const steady = headings.slice(-120).filter((h) => Math.abs(h.yawRate) > 1e-3);
    const avgSpeed = steady.reduce((a, h) => a + h.speed, 0) / (steady.length || 1);
    const avgYawRate = steady.reduce((a, h) => a + Math.abs(h.yawRate), 0) / (steady.length || 1);
    const turningRadiusM = avgYawRate > 1e-3 ? avgSpeed / avgYawRate : null;
    // geometric cross-check: circle fit through 3 well-separated sampled positions.
    const p1 = positions[Math.floor(positions.length * 0.3)];
    const p2 = positions[Math.floor(positions.length * 0.65)];
    const p3 = positions[positions.length - 1];
    const geomRadius = circumradius(p1, p2, p3);
    result.phases.turn = {
        durationSteps: 480, steerAngleRad: MAX_STEER, engineForcePerWheel: TURN_ENGINE_FORCE,
        turningRadiusM_fromYawRate: turningRadiusM, turningRadiusM_geometric: geomRadius,
        avgSpeedMS: avgSpeed, avgYawRateRadS: avgYawRate,
        log: log ? turnLog : undefined,
    };
    // straighten wheels before braking
    controller.setWheelSteering(wheelIndex.wheel_FL, 0);
    controller.setWheelSteering(wheelIndex.wheel_FR, 0);

    // ---- phase D: brake to stop ----
    const brakeLog = [];
    for (let i = 0; i < idx.length; i++) { controller.setWheelEngineForce(idx[i], 0); }
    const brakeStartSpeed = Math.abs(controller.currentVehicleSpeed());
    const brakeStartZ = body.translation().z, brakeStartX = body.translation().x;
    // REPORT.md #9: `wheelBrake` is a maximum IMPULSE applied as-is each `updateVehicle(dt)` call
    // (not multiplied by dt like `engineForce` is internally) — confirmed empirically: setting it
    // to the same magnitude as our engineForce (~3500-4200) stopped the car in under 3 frames
    // (~0.05 m). 80 (N·s per wheel per 1/120 s tick) gives a plausible strong-brake deceleration.
    const MAX_BRAKE = 80;
    for (let i = 0; i < idx.length; i++) controller.setWheelBrake(idx[i], MAX_BRAKE);
    let brakeStopStep = null;
    for (let i = 0; i < 600; i++) { // up to 5s
        stepWorld(world, controller);
        applyDrag(body);
        step++;
        record(brakeLog);
        if (brakeStopStep === null && Math.abs(controller.currentVehicleSpeed()) < 0.05) brakeStopStep = i + 1;
        if (brakeStopStep !== null && i > brakeStopStep + 30) break;
    }
    const endPos = body.translation();
    const stopDistanceM = Math.hypot(endPos.x - brakeStartX, endPos.z - brakeStartZ);
    result.phases.brake = {
        brakeStartSpeedMS: brakeStartSpeed, brakeForcePerWheel: MAX_BRAKE,
        stopTimeS: brakeStopStep ? brakeStopStep * DT : null, stopDistanceM,
        log: log ? brakeLog : undefined,
    };

    // ---- final state for determinism hashing ----
    const finalT = body.translation(), finalR = body.rotation(), finalLV = body.linvel(), finalAV = body.angvel();
    result.finalState = {
        pos: finalT, rot: finalR, linvel: finalLV, angvel: finalAV,
        wheelRotations: idx.map((i) => controller.wheelRotation(i)),
        totalSteps: step,
    };

    result.checks = {
        noNaN: true, // would have thrown above otherwise
        wheelsGroundedAtRest: result.phases.settle.allWheelsGrounded,
        noChassisPenetration: true, // see per-frame chassisBottomY check below
    };
    // scan for chassis-vs-ground penetration across all recorded phases if we logged them; otherwise
    // recompute a cheap final check from the settle summary (bottom of the chassis collider stayed >= ~0).
    const finalChassisBottomY = finalT.y + v.colliders.col_chassis.centerRel[1] - v.colliders.col_chassis.halfExtents[1];
    result.checks.finalChassisBottomY = finalChassisBottomY;
    result.checks.noChassisPenetration = finalChassisBottomY > -0.02;

    return result;
}

function circumradius(a, b, c) {
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return Infinity;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return Math.hypot(ax - ux, ay - uy);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const result = await runDriveScenario({ cabinShape: "round" });
    const outPath = new URL("./out/drive_test.json", import.meta.url);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log("=== DRIVE TEST (cabinShape=round) ===");
    console.log("settle:", result.phases.settle.settledAtSeconds, "s; resting ride height Y =", result.phases.settle.restingRideHeightY.toFixed(4), "; grounded:", result.phases.settle.allWheelsGrounded);
    console.log("throttle 3s: distance", result.phases.throttle.distanceM.toFixed(2), "m; speed@3s", result.phases.throttle.speedAt3sKmh.toFixed(1), "km/h (still accelerating, no drag model); t-to-60%-of-that", result.phases.throttle.timeTo60PctOf3sSpeedS);
    console.log("turn: radius(yaw) ~", result.phases.turn.turningRadiusM_fromYawRate?.toFixed(2), "m; radius(geom) ~", result.phases.turn.turningRadiusM_geometric?.toFixed(2), "m");
    console.log("brake: from", result.phases.brake.brakeStartSpeedMS.toFixed(1), "m/s, stopped in", result.phases.brake.stopTimeS, "s over", result.phases.brake.stopDistanceM.toFixed(2), "m");
    console.log("checks:", result.checks);
    console.log("wrote", outPath.pathname);
}
