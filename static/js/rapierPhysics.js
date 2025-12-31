// Vehicle physics implementation using Rapier's built-in DynamicRayCastVehicleController
// This replaces manual suspension force calculations with the proper API

let RAPIER = null;

// Initialize Rapier physics
async function initRapierPhysics() {
    try {
        console.log('Starting Rapier initialization...');

        // Check if Rapier was already initialized
        if (window.rapierLoaded && window.RAPIER) {
            console.log('Using pre-initialized RAPIER from window.RAPIER');
            RAPIER = window.RAPIER;
            return RAPIER;
        }

        // Import and initialize Rapier
        try {
            const rapierModule = await import('@dimforge/rapier3d-compat');

            if (!window.RAPIER) {
                await rapierModule.init();
                window.RAPIER = rapierModule;
            }

            RAPIER = window.RAPIER;
            window.rapierLoaded = true;

            return RAPIER;
        } catch (importError) {
            console.error('Error importing Rapier module:', importError);

            if (typeof window.RAPIER !== 'undefined' && window.RAPIER !== null) {
                console.log('Using globally available RAPIER object');
                RAPIER = window.RAPIER;
                window.rapierLoaded = true;
                return RAPIER;
            }

            throw new Error('Failed to load Rapier module');
        }
    } catch (error) {
        console.error('Failed to initialize Rapier physics:', error);
        window.rapierLoaded = false;
        return null;
    }
}

// Create a Rapier physics world
function createRapierWorld() {
    if (!RAPIER) {
        console.error('Rapier not initialized. Call initRapierPhysics first.');
        return null;
    }

    // Create world with gravity
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);

    return world;
}

// Create car physics using Rapier's vehicle controller
function createCarPhysics(world, position, dimensions) {
    if (!RAPIER || !world) {
        console.error('Rapier world not initialized');
        return null;
    }

    // Sync RAPIER reference
    if (window.RAPIER && RAPIER !== window.RAPIER) {
        RAPIER = window.RAPIER;
    }

    // Get physics params from global (set by host.js) or use defaults
    const params = window.physicsParams || {
        car: {
            engineForce: 200.0,
            brakeForce: 50.0,
            maxSteeringAngle: 0.55,
            density: 4.0,
            linearDamping: 0.25,
            angularDamping: 0.6
        },
        wheels: {
            frictionSlip: 1000.0,
            rearFrictionMultiplier: 1.0,
            sideFrictionStiffness: 1.0,
            suspensionRestLength: 0.5,
            suspensionStiffness: 30.0,
            suspensionDamping: 3.0,
            suspensionCompression: 2.0,
            maxSuspensionTravel: 0.3
        }
    };

    const { width, height, length } = dimensions;

    try {
        console.log('Creating car with Rapier vehicle controller');

        // STEP 1: Create chassis rigid body
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(params.car.linearDamping)
            .setAngularDamping(params.car.angularDamping)
            .setCanSleep(false);

        const chassisBody = world.createRigidBody(rigidBodyDesc);

        if (!chassisBody) {
            console.error('Failed to create chassis body');
            return null;
        }

        // Verify initial position
        const initialPos = chassisBody.translation();
        if (!initialPos || !Number.isFinite(initialPos.x)) {
            console.error('Invalid initial position');
            return null;
        }
        console.log('Chassis created at:', initialPos.x.toFixed(2), initialPos.y.toFixed(2), initialPos.z.toFixed(2));

        // STEP 2: Create chassis collider
        const chassisCollider = RAPIER.ColliderDesc.cuboid(width/2, height/2, length/2)
            .setDensity(params.car.density)
            .setFriction(0.5);
        world.createCollider(chassisCollider, chassisBody);
        console.log('Chassis collider created, estimated mass:', (width * height * length * params.car.density).toFixed(0), 'kg');

        // STEP 3: Create vehicle controller
        let vehicleController = null;

        // Check if createVehicleController is available (newer Rapier versions)
        if (typeof world.createVehicleController === 'function') {
            vehicleController = world.createVehicleController(chassisBody);
            console.log('Using Rapier vehicle controller');
        } else {
            console.log('Vehicle controller not available, using manual wheel physics');
        }

        // STEP 4: Define wheel configuration
        const wheelRadius = 0.35;
        const suspensionRestLength = params.wheels.suspensionRestLength;
        const suspensionDirection = { x: 0, y: -1, z: 0 };  // Points DOWN
        const axleDirection = { x: -1, y: 0, z: 0 };        // Points LEFT

        // Wheel positions relative to chassis center
        const wheelPositions = [
            { x: -width/2 + 0.2, y: 0, z: length/2 - 0.5 },   // Front left
            { x: width/2 - 0.2, y: 0, z: length/2 - 0.5 },    // Front right
            { x: -width/2 + 0.2, y: 0, z: -length/2 + 0.5 },  // Rear left
            { x: width/2 - 0.2, y: 0, z: -length/2 + 0.5 }    // Rear right
        ];

        // Add wheels to vehicle controller (if available)
        if (vehicleController) {
            wheelPositions.forEach((pos, index) => {
                const isFront = index < 2;
                const frictionMult = isFront ? 1.0 : params.wheels.rearFrictionMultiplier;

                vehicleController.addWheel(
                    pos,
                    suspensionDirection,
                    axleDirection,
                    suspensionRestLength,
                    wheelRadius
                );

                // Configure suspension from params
                vehicleController.setWheelSuspensionStiffness(index, params.wheels.suspensionStiffness);
                vehicleController.setWheelSuspensionCompression(index, params.wheels.suspensionCompression);
                vehicleController.setWheelSuspensionRelaxation(index, params.wheels.suspensionDamping);
                vehicleController.setWheelMaxSuspensionTravel(index, params.wheels.maxSuspensionTravel);
                vehicleController.setWheelFrictionSlip(index, params.wheels.frictionSlip * frictionMult);

                // Side friction stiffness if available
                if (typeof vehicleController.setWheelSideFrictionStiffness === 'function') {
                    vehicleController.setWheelSideFrictionStiffness(index, params.wheels.sideFrictionStiffness);
                }

                console.log(`Added wheel ${index} at (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
            });
        }

        // STEP 5: Store data for controls and rendering
        chassisBody.userData = {
            vehicleController: vehicleController,
            wheelPositions: wheelPositions,
            wheelRadius: wheelRadius,
            suspensionRestLength: suspensionRestLength,

            // Control parameters (from global params)
            engineForce: params.car.engineForce,
            brakeForce: params.car.brakeForce,
            maxSteeringAngle: params.car.maxSteeringAngle,

            // State
            currentSpeed: 0,
            isGrounded: false,

            // For manual implementation fallback
            wheels: wheelPositions.map((pos, i) => ({
                position: pos,
                isFrontWheel: i < 2,
                steering: 0,
                radius: wheelRadius
            }))
        };

        console.log('Car physics created successfully');
        return chassisBody;

    } catch (error) {
        console.error('Error creating car physics:', error);
        return null;
    }
}

// Apply controls to vehicle
function applyCarControls(carBody, controls, dt, world, playerId) {
    if (!carBody || !controls || !world) return;

    const userData = carBody.userData;
    if (!userData) return;

    const steering = controls.steering || 0;
    const acceleration = controls.acceleration || 0;
    const braking = controls.braking || 0;

    // Use vehicle controller if available
    if (userData.vehicleController) {
        const vc = userData.vehicleController;

        // Engine force on rear wheels (rear-wheel drive for better control)
        const engineForce = acceleration * userData.engineForce;
        vc.setWheelEngineForce(2, engineForce);  // Rear left
        vc.setWheelEngineForce(3, engineForce);  // Rear right

        // Steering on front wheels (negated for correct left/right when moving forward)
        const steerAngle = -steering * userData.maxSteeringAngle;
        vc.setWheelSteering(0, steerAngle);  // Front left
        vc.setWheelSteering(1, steerAngle);  // Front right

        // Braking on all wheels
        const brake = braking * userData.brakeForce;
        for (let i = 0; i < 4; i++) {
            vc.setWheelBrake(i, brake);
        }

        // Update vehicle physics
        vc.updateVehicle(dt);

        // Update speed
        userData.currentSpeed = vc.currentVehicleSpeed ? vc.currentVehicleSpeed() : 0;

    } else {
        // Fallback: Simple force-based controls (no suspension)
        // This is a basic fallback if vehicle controller isn't available

        if (acceleration !== 0) {
            // Get forward direction from rotation
            const rot = carBody.rotation();
            const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

            // Apply forward force
            const force = {
                x: forward.x * acceleration * userData.engineForce * 10,
                y: 0,
                z: forward.z * acceleration * userData.engineForce * 10
            };
            carBody.addForce(force, true);
        }

        if (steering !== 0) {
            // Apply steering torque
            const torque = { x: 0, y: -steering * 50, z: 0 };
            carBody.addTorque(torque, true);
        }

        if (braking > 0) {
            // Apply damping for braking
            const vel = carBody.linvel();
            const brakeDamping = braking * 0.95;
            carBody.setLinvel({
                x: vel.x * (1 - brakeDamping * dt * 10),
                y: vel.y,
                z: vel.z * (1 - brakeDamping * dt * 10)
            }, true);
        }

        // Calculate speed
        const vel = carBody.linvel();
        userData.currentSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6; // km/h
    }

    // Store velocity for external access
    userData.velocity = carBody.linvel();
}

// Sync visual model with physics
function syncCarModelWithPhysics(mesh, physicsBody, wheels) {
    if (!mesh || !physicsBody) return;

    // Get physics position and rotation
    const pos = physicsBody.translation();
    const rot = physicsBody.rotation();

    // Validate
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        return;
    }

    // Update mesh
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Update wheel visuals if provided
    if (wheels && physicsBody.userData?.vehicleController) {
        const vc = physicsBody.userData.vehicleController;
        wheels.forEach((wheel, i) => {
            if (wheel && vc.wheelIsInContact && vc.wheelIsInContact(i)) {
                // Could add wheel rotation animation here
            }
        });
    }
}

// Reset car position
function resetCarPosition(carBody, position, rotation) {
    if (!carBody) return;

    // Reset position
    carBody.setTranslation(position, true);

    // Reset rotation (default to identity if not provided)
    if (rotation) {
        carBody.setRotation(rotation, true);
    } else {
        carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }

    // Reset velocities
    carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // Apply small downward impulse to start falling
    carBody.applyImpulse({ x: 0, y: -5.0, z: 0 }, true);
}

// Check if car is upside down
function isCarUpsideDown(carBody) {
    if (!carBody) return false;

    const rot = carBody.rotation();
    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);

    return up.y < 0.3;  // If Y component of up vector is low, car is tipped
}

// Create ground plane
function createGroundPlane(world) {
    if (!RAPIER || !world) return null;

    // Create fixed body for ground
    const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    // Create large flat collider
    const groundCollider = RAPIER.ColliderDesc.cuboid(100, 0.1, 100)
        .setFriction(0.8);
    world.createCollider(groundCollider, groundBody);

    return groundBody;
}

// Export functions
window.rapierPhysics = {
    init: initRapierPhysics,
    createWorld: createRapierWorld,
    createCarPhysics: createCarPhysics,
    applyCarControls: applyCarControls,
    syncCarModelWithPhysics: syncCarModelWithPhysics,
    resetCarPosition: resetCarPosition,
    isCarUpsideDown: isCarUpsideDown,
    createGroundPlane: createGroundPlane
};
