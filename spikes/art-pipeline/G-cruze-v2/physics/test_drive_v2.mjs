// test_drive_v2.mjs — settle / full-throttle / full-lock turn / brake-to-stop, at 120 Hz fixed dt,
// for the G-cruze-v2 cruz_missile asset. Mirrors C-physics/test_drive.mjs's structure and findings
// (no ad hoc drag force — see that file's header comment; same root cause here: updateVehicle()
// fights any externally-applied velocity change), adapted to this asset's contract:
//   - Only the FRONT wheels are driven (sidecar.drive === "FWD"; wheel_RL/RR have driven:false) —
//     engine force goes on drivenWheels only, not all four.
//   - Max steer angle comes from the contract (`wheel_FL.range_steer_deg` = [-35, 35]), not a guess.
//   - Ride height is checked against the authored hub height (0.44 m), per ASSET-CONTRACT.md.
//
// IMPORTANT finding (see REPORT.md): chaining "3s full throttle" straight into "full-lock turn" —
// the way the C-physics spike's single continuous scenario did it — rolls this car. We discovered
// this empirically (a snap AND a ramped 0.5s steer input both rolled it at the ~62.5 km/h reached
// after 3s of throttle), then binary-searched the rollover threshold at full lock: no roll up to
// 53.3 km/h, rolls at 58.0 km/h. Root cause, not a test-harness bug: this asset's `com` anchor
// (y=0.85 m) combined with its 1.6 m track width gives a static stability factor of
// trackWidth/(2*comHeight) = 1.6/(2*0.85) ~= 0.94 — LOW even for an SUV (typical passenger cars are
// 1.0-1.5) — and `frictionSlip=1000` gives the tires very high grip, so the car can generate more
// lateral g than its rollover threshold before it would ever slide. Given that, we run turn-radius
// as its own scenario at a speed safely under the measured threshold (40 km/h), and separately keep
// the rollover scan as a first-class, reported result rather than silently avoiding it.

import { writeFileSync } from "node:fs";
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, DT, FORWARD_SIGN } from "./physics_common_v2.mjs";
import { loadVehicle } from "./load_vehicle_v2.mjs";

const GLB = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.lod1.glb", import.meta.url).pathname;
const SIDECAR = new URL("../../../../art/vehicles/cruz-missile/cruz_missile.asset.json", import.meta.url).pathname;
const AUTHORED_HUB_Y = 0.44;
const ENGINE_FORCE = 4200; // N per driven wheel — same magnitude as the C-physics spike; here it's
// only applied to 2 (front) wheels instead of 4 (this asset is FWD), so total propulsive force is
// honestly HALVED relative to that spike, not compensated for.
const TURN_ENGINE_FORCE = 1500;
const MAX_BRAKE = 80; // max impulse per wheel per tick (C-physics REPORT.md #9) — same value, close mass.

function assertFinite(label, v3) {
    for (const [k, val] of Object.entries(v3)) {
        if (!Number.isFinite(val)) throw new Error(`non-finite ${label}.${k} = ${val}`);
    }
}

async function freshVehicle(spawnDrop = 0.5) {
    await ensureInit();
    const v = loadVehicle(GLB, SIDECAR);
    const world = createWorld();
    createGround(world);
    const built = buildVehicle(world, v, { spawn: [0, v.groundOffsetY + spawnDrop, 0] });
    return { v, world, ...built };
}

function chassisBottomY(v, body) {
    const t = body.translation();
    return t.y + v.colliders.col_chassis.centerRel[1] - v.colliders.col_chassis.halfExtents[1];
}

export async function runSettle() {
    const { v, world, body, controller, wheelIndex } = await freshVehicle();
    const idx = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((n) => wheelIndex[n]);
    let settledAtStep = null, prevY = null;
    for (let i = 0; i < 240; i++) { // 2s
        stepWorld(world, controller);
        const t = body.translation(), lv = body.linvel();
        assertFinite("pos", t); assertFinite("linvel", lv);
        if (prevY !== null && settledAtStep === null && Math.abs(t.y - prevY) < 0.0003 && Math.abs(lv.y) < 0.05) settledAtStep = i + 1;
        prevY = t.y;
    }
    const restingBodyY = body.translation().y;
    const restingHubY = restingBodyY + AUTHORED_HUB_Y;
    return {
        settledAtStep, settledAtSeconds: settledAtStep ? settledAtStep * DT : null,
        restingBodyY, restingHubY, authoredHubY: AUTHORED_HUB_Y, rideHeightDeltaM: restingHubY - AUTHORED_HUB_Y,
        restingSuspLens: idx.map((i) => controller.wheelSuspensionLength(i)),
        allWheelsGrounded: idx.every((i) => controller.wheelIsInContact(i)),
        noChassisPenetration: chassisBottomY(v, body) > -0.02,
    };
}

export async function runThrottleAndBrake() {
    const { v, world, body, controller, wheelIndex, drivenWheels } = await freshVehicle();
    const idx = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((n) => wheelIndex[n]);
    for (let i = 0; i < 240; i++) stepWorld(world, controller); // settle first

    // ---- 3s full throttle, straight ----
    for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * ENGINE_FORCE);
    const startZ = body.translation().z;
    const speedSamples = [];
    for (let i = 0; i < 360; i++) { // 3s
        stepWorld(world, controller);
        assertFinite("pos", body.translation());
        if ((i + 1) % 12 === 0) speedSamples.push({ t: (i + 1) * DT, speed: Math.abs(controller.currentVehicleSpeed()) });
    }
    const endZ = body.translation().z;
    const speedAt3s = Math.abs(controller.currentVehicleSpeed());
    const throttle = {
        durationSteps: 360, engineForcePerDrivenWheel: ENGINE_FORCE, drivenWheelCount: drivenWheels.length,
        distanceM: Math.abs(endZ - startZ), speedAt3sMS: speedAt3s, speedAt3sKmh: speedAt3s * 3.6,
        stillAccelerating: true, speedSamples,
    };

    // ---- brake to stop, from that same speed, straight line ----
    for (const i of idx) controller.setWheelEngineForce(i, 0);
    const brakeStartSpeed = Math.abs(controller.currentVehicleSpeed());
    const brakeStartZ = body.translation().z, brakeStartX = body.translation().x;
    for (const i of idx) controller.setWheelBrake(i, MAX_BRAKE);
    let brakeStopStep = null;
    for (let i = 0; i < 600; i++) { // up to 5s
        stepWorld(world, controller);
        assertFinite("pos", body.translation());
        if (brakeStopStep === null && Math.abs(controller.currentVehicleSpeed()) < 0.05) brakeStopStep = i + 1;
        if (brakeStopStep !== null && i > brakeStopStep + 30) break;
    }
    const endPos = body.translation();
    const brake = {
        brakeStartSpeedMS: brakeStartSpeed, brakeForcePerWheel: MAX_BRAKE,
        stopTimeS: brakeStopStep ? brakeStopStep * DT : null,
        stopDistanceM: Math.hypot(endPos.x - brakeStartX, endPos.z - brakeStartZ),
    };
    return { throttle, brake };
}

/**
 * Full-lock turn at a speed safely under the measured rollover threshold (see header + `runRolloverScan`
 * below): accelerate to ~40 km/h, ramp steer to the contract's max (35 deg) over 0.5 s, hold, measure
 * the steady-state turning radius two ways (yaw-rate and a 3-point geometric circle fit).
 */
export async function runTurn({ targetSpeedMS = 11.11 } = {}) {
    const { v, world, body, controller, wheelIndex, drivenWheels, steerWheels } = await freshVehicle();
    const idx = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((n) => wheelIndex[n]);
    for (let i = 0; i < 240; i++) stepWorld(world, controller); // settle

    const steerRangeDeg = v.parts.wheel_FL.rangeSteerDeg;
    const MAX_STEER_RAD = (Math.max(...steerRangeDeg.map(Math.abs)) * Math.PI) / 180;

    // accelerate to the target cruise speed
    for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * ENGINE_FORCE);
    let accelSteps = 0;
    while (Math.abs(controller.currentVehicleSpeed()) < targetSpeedMS && accelSteps < 1200) {
        stepWorld(world, controller);
        accelSteps++;
    }
    const speedAtTurnStart = Math.abs(controller.currentVehicleSpeed());

    // ramp steer to max over 0.5s (60 steps), holding a modest cruise throttle
    for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * TURN_ENGINE_FORCE);
    const headings = [], positions = [];
    let anyAirborne = false;
    const RAMP_STEPS = 60, TOTAL_STEPS = 480;
    for (let i = 0; i < TOTAL_STEPS; i++) {
        const ramp = Math.min(1, i / RAMP_STEPS);
        for (const wi of steerWheels) controller.setWheelSteering(wi, MAX_STEER_RAD * ramp);
        stepWorld(world, controller);
        assertFinite("pos", body.translation());
        if (!idx.some((wi) => controller.wheelIsInContact(wi))) anyAirborne = true;
        const t = body.translation(), av = body.angvel();
        positions.push([t.x, t.z]);
        headings.push({ t: i * DT, yawRate: av.y, speed: Math.abs(controller.currentVehicleSpeed()) });
    }
    const steady = headings.slice(-120).filter((h) => Math.abs(h.yawRate) > 1e-3);
    const avgSpeed = steady.reduce((a, h) => a + h.speed, 0) / (steady.length || 1);
    const avgYawRate = steady.reduce((a, h) => a + Math.abs(h.yawRate), 0) / (steady.length || 1);
    const turningRadiusM_fromYawRate = avgYawRate > 1e-3 ? avgSpeed / avgYawRate : null;
    const p1 = positions[Math.floor(positions.length * 0.3)];
    const p2 = positions[Math.floor(positions.length * 0.65)];
    const p3 = positions[positions.length - 1];
    const turningRadiusM_geometric = circumradius(p1, p2, p3);

    return {
        targetSpeedMS, speedAtTurnStartMS: speedAtTurnStart, speedAtTurnStartKmh: speedAtTurnStart * 3.6,
        steerAngleRad: MAX_STEER_RAD, steerAngleDeg: (MAX_STEER_RAD * 180) / Math.PI, steerRampSteps: RAMP_STEPS,
        engineForcePerDrivenWheel: TURN_ENGINE_FORCE,
        turningRadiusM_fromYawRate, turningRadiusM_geometric, avgSpeedMS: avgSpeed, avgYawRateRadS: avgYawRate,
        rolledOver: anyAirborne,
        drivenWheels, steerWheels,
    };
}

/**
 * Binary-search-style coarse scan (see header): full-lock (ramped over 0.5s) turn entered at a range
 * of cruise speeds, reporting the lowest tested speed that rolls the car and the highest that doesn't.
 * This is the concrete "asset problem" number for REPORT.md, not a guess.
 */
export async function runRolloverScan(speedsKmh = [30, 40, 48.6, 53.3, 58.0, 62.5]) {
    const rows = [];
    for (const kmh of speedsKmh) {
        const targetSpeedMS = kmh / 3.6;
        const { v, world, body, controller, wheelIndex, drivenWheels, steerWheels } = await freshVehicle();
        const idx = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((n) => wheelIndex[n]);
        for (let i = 0; i < 240; i++) stepWorld(world, controller);
        const steerRangeDeg = v.parts.wheel_FL.rangeSteerDeg;
        const MAX_STEER_RAD = (Math.max(...steerRangeDeg.map(Math.abs)) * Math.PI) / 180;
        for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * ENGINE_FORCE);
        let accelSteps = 0;
        while (Math.abs(controller.currentVehicleSpeed()) < targetSpeedMS && accelSteps < 1200) { stepWorld(world, controller); accelSteps++; }
        for (const i of drivenWheels) controller.setWheelEngineForce(i, FORWARD_SIGN * TURN_ENGINE_FORCE);
        let rolled = false;
        for (let i = 0; i < 480; i++) {
            const ramp = Math.min(1, i / 60);
            for (const wi of steerWheels) controller.setWheelSteering(wi, MAX_STEER_RAD * ramp);
            stepWorld(world, controller);
            if (!idx.some((wi) => controller.wheelIsInContact(wi))) rolled = true;
        }
        rows.push({ targetKmh: kmh, rolled });
    }
    return rows;
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
    const settle = await runSettle();
    const { throttle, brake } = await runThrottleAndBrake();
    const turn = await runTurn();
    const rollover = await runRolloverScan();
    const result = { settle, throttle, turn, brake, rollover };
    writeFileSync(new URL("./out/drive_test.json", import.meta.url), JSON.stringify(result, null, 2));

    console.log("=== DRIVE TEST (cruz_missile, FWD) ===");
    console.log("settle:", settle.settledAtSeconds, "s; resting hub Y =", settle.restingHubY.toFixed(4), "vs authored", settle.authoredHubY, "(delta", settle.rideHeightDeltaM.toFixed(4), "m); grounded:", settle.allWheelsGrounded);
    console.log("throttle 3s: distance", throttle.distanceM.toFixed(2), "m; speed@3s", throttle.speedAt3sKmh.toFixed(1), "km/h (still accelerating, no drag model)");
    console.log("turn: entry", turn.speedAtTurnStartKmh.toFixed(1), "km/h, steer", turn.steerAngleDeg.toFixed(1), "deg (ramped); radius(yaw) ~", turn.turningRadiusM_fromYawRate?.toFixed(2), "m; radius(geom) ~", turn.turningRadiusM_geometric?.toFixed(2), "m; rolledOver:", turn.rolledOver);
    console.log("brake: from", brake.brakeStartSpeedMS.toFixed(1), "m/s, stopped in", brake.stopTimeS, "s over", brake.stopDistanceM.toFixed(2), "m");
    console.log("rollover scan (full lock, ramped 0.5s):");
    for (const r of rollover) console.log(`  ${r.targetKmh.toFixed(1)} km/h -> rolled=${r.rolled}`);
    console.log("wrote out/drive_test.json");
}
