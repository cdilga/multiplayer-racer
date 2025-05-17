// Derby-style car physics implementation with Rapier
// This completely replaces your existing rapierPhysics.js file

// Import Rapier properly using ES modules
let RAPIER = null;

// Initialize Rapier physics
async function initRapierPhysics() {
    try {
        console.log('Starting Rapier initialization...');
        
        // Import Rapier from CDN using the importmap defined in the HTML
        try {
            const rapierModule = await import('@dimforge/rapier3d-compat');
            
            // Init WASM module
            await rapierModule.init();
            
            // Store the module globally
            RAPIER = rapierModule;
            
            
            // Dispatch event to notify other scripts
            window.dispatchEvent(new Event('rapier-ready'));
            
            // Set global flag
            window.rapierLoaded = true;
            
            return RAPIER;
        } catch (error) {
            console.error('Failed to import Rapier:', error);
            throw error;
        }
    } catch (error) {
        console.error('Error initializing Rapier:', error);
        throw error;
    }
}

// Create a Rapier physics world with more realistic settings
function createRapierWorld() {
    if (!RAPIER) {
        console.error('Rapier not initialized. Call initRapierPhysics first.');
        return null;
    }
    
    // Get physics parameters from global object if available
    const params = window.physicsParams ? window.physicsParams : {
        world: {
            gravity: { x: 0.0, y: -20.0, z: 0.0 }
        }
    };
    
    // Create a world with gravity
    const gravity = params.world.gravity;
    const world = new RAPIER.World(gravity);
    
    return world;
}

// Create a derby-style car physics body with more realistic configuration
function createCarPhysics(world, position, dimensions) {
    if (!RAPIER || !world) {
        console.error('Rapier world not initialized');
        return null;
    }
    
    const { width, height, length } = dimensions;
    
    try {
        console.log('Creating derby-style car physics body');
        
        // Get physics parameters from global object if available
        const params = window.physicsParams ? window.physicsParams : {
            car: {
                mass: 1200.0,
                linearDamping: 0.5,
                angularDamping: 4.0,
                enginePower: 1600.0,
                brakeForce: 2000.0,
                steeringResponse: 0.3,
                maxSteeringAngle: 0.6,
                steeringReturnSpeed: 3.0,
                lateralGripFactor: 2.0,
                rollingResistance: 0.15,
                aerodynamicDrag: 0.5
            },
            wheels: {
                frictionSlip: 5.0,
                rearFrictionMultiplier: 1.1,
                suspensionRestLength: 0.4,
                suspensionStiffness: 25.0,
                suspensionDamping: 3.5,
                suspensionCompression: 0.5
            }
        };
        
        // STEP 1: Create the main rigid body with realistic parameters
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(params.car.linearDamping)
            .setAngularDamping(params.car.angularDamping)
            .setCanSleep(false)
            .setAdditionalMass(params.car.mass)
            .setCcdEnabled(true);
        
        const carBody = world.createRigidBody(rigidBodyDesc);
        
        // STEP 2: Create a multi-part collision shape to match the visual model
        
        // Main chassis - The main body of the car
        const mainChassisDesc = RAPIER.ColliderDesc.cuboid(width/2, height/2 * 0.6, length/2)
            .setDensity(0.6)
            .setFriction(0.1)
            .setRestitution(0.1);
        
        world.createCollider(mainChassisDesc, carBody);
        
        // Car roof - Match the visual roof
        const roofWidth = width * 0.75;
        const roofHeight = height * 0.7;
        const roofLength = length * 0.5;
        
        const roofDesc = RAPIER.ColliderDesc.cuboid(roofWidth/2, roofHeight/2, roofLength/2)
            .setTranslation(0, height/2 + roofHeight/2, -(length * 0.05))
            .setDensity(0.3)
            .setFriction(0.1)
            .setRestitution(0.1);
        
        world.createCollider(roofDesc, carBody);
        
        // Lower chassis - Creates a lower center of mass for stability
        const floorpanDesc = RAPIER.ColliderDesc.cuboid(width/2 * 0.9, height/4, length/2 * 0.95)
            .setTranslation(0, -height/4, 0)
            .setDensity(4.0)
            .setFriction(0.2);
        
        world.createCollider(floorpanDesc, carBody);
        
        // STEP 3: Set up wheel physics using raycasts
        
        // Wheel parameters
        const wheelRadius = 0.5;
        const wheelWidth = 0.4;
        
        // Define wheel positions to match the visual model
        const wheelPositions = [
            // Front left
            { x: -width/2 + wheelWidth/2, y: -0.1, z: length/3 },
            // Front right
            { x: width/2 - wheelWidth/2, y: -0.1, z: length/3 },
            // Rear left
            { x: -width/2 + wheelWidth/2, y: -0.1, z: -length/3 },
            // Rear right
            { x: width/2 - wheelWidth/2, y: -0.1, z: -length/3 }
        ];
        
        // Store wheel raycast data for the car
        const wheelRaycasts = [];
        
        // Create wheelRaycast data for each wheel
        wheelPositions.forEach((wheelPos, index) => {
            // Apply different friction to front and rear wheels
            const frictionSlip = params.wheels.frictionSlip * 
                (index >= 2 ? params.wheels.rearFrictionMultiplier : 1.0);
            
            // We'll use this data for our custom raycast vehicle implementation
            wheelRaycasts.push({
                position: wheelPos,
                suspensionRestLength: params.wheels.suspensionRestLength,
                suspensionStiffness: params.wheels.suspensionStiffness,
                suspensionDamping: params.wheels.suspensionDamping,
                suspensionCompression: params.wheels.suspensionCompression,
                wheelRadius: wheelRadius,
                wheelWidth: wheelWidth,
                frictionSlip: frictionSlip,
                isFrontWheel: index < 2,
                steering: 0,
                compression: 0,
                groundContact: false,
                contactPoint: null,
                contactNormal: null,
                wheelObject: null
            });
        });
        
        // STEP 4: Set up vehicle-specific properties
        
        // Store car-specific properties in the user data
        carBody.userData = {
            // Physics properties
            enginePower: params.car.enginePower,
            brakeForce: params.car.brakeForce,
            steeringResponse: params.car.steeringResponse,
            maxSteeringAngle: params.car.maxSteeringAngle,
            steeringReturnSpeed: params.car.steeringReturnSpeed,
            lateralGripFactor: params.car.lateralGripFactor,
            rollingResistance: params.car.rollingResistance,
            aerodynamicDrag: params.car.aerodynamicDrag,
            
            // Vehicle-specific data
            wheels: wheelRaycasts,
            
            // Car state
            currentSpeed: 0,
            isGrounded: true,
            lastGroundContact: Date.now(),
            
            // Control inputs (last applied)
            controls: {
                steering: 0,
                acceleration: 0,
                braking: 0
            },
            
            // For debugging
            lastAppliedForces: {
                engineForce: 0,
                brakeForce: 0,
                steeringTorque: 0,
                lateralForce: 0,
                dragForce: 0
            }
        };
        
        // Wake up the body to ensure it's active
        if (typeof carBody.wakeUp === 'function') {
            carBody.wakeUp();
        }
        
        console.log("Created improved vehicle physics model successfully");
        return carBody;
    } catch (error) {
        console.error("Error creating car physics body:", error);
        return null;
    }
}

// Create a ground plane with barriers for a derby arena
function createGroundPlane(world) {
    if (!RAPIER || !world) {
        console.error('Rapier world not initialized');
        return null;
    }
    
    try {
        console.log('Creating ground plane with derby arena barriers');
        
        // STEP 1: Create the main ground plane
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, 0, 0); // Ensure ground is at y=0
        const groundBody = world.createRigidBody(groundBodyDesc);
        
        // Main ground surface - large flat cuboid
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(200, 0.5, 200) // Larger and thicker ground
            .setFriction(1.0)           // Increased friction for better grip
            .setRestitution(0.2);       // Slight bounce for dramatic collisions
        
        world.createCollider(groundColliderDesc, groundBody);
        
        // STEP 2: Add arena barriers (optional)
        // These create a "bowl" shape that keeps cars in the play area
        // and allows for wall-riding and bouncing off barriers
        
        // Arena radius and barrier height
        const arenaRadius = 90;   // Slightly smaller than ground plane
        const barrierHeight = 3;  // Tall enough to contain most collisions
        const barrierThickness = 1;
        
        // Create circular barrier
        const barrierDesc = RAPIER.ColliderDesc.cylinder(arenaRadius, barrierHeight/2)
            .setTranslation(0, barrierHeight/2, 0)  // Position at the edge of the ground
            .setFriction(0.3)                      // Slippery walls for sliding
            .setRestitution(0.4);                  // Bouncy walls
            
        // We need to make this a hollow cylinder, so we'll use a custom shape
        // First create the outer cylinder
        const barrier = world.createCollider(barrierDesc, groundBody);
        
        // Now create a slightly smaller inner cylinder to "subtract" from the outer one
        // This creates a hollow cylinder effect
        const innerDesc = RAPIER.ColliderDesc.cylinder(arenaRadius - barrierThickness, barrierHeight/2 + 0.1)
            .setTranslation(0, barrierHeight/2, 0)
            .setSensor(true);  // This makes it non-solid, effectively creating a hollow
            
        world.createCollider(innerDesc, groundBody);
        
        console.log('Ground plane created at position (0,0,0) with size 400x1x400');
        return groundBody;
    } catch (error) {
        console.error('Error creating ground plane:', error);
        console.error('Rapier API available:', Object.keys(RAPIER));
        return null;
    }
}

// Apply forces to a car body based on controls
function applyCarControls(carBody, controls, playerId) {
    if (!carBody) return;
    
    try {
        // Extract controls safely with defaults
        const steering = controls?.steering || 0;
        const acceleration = controls?.acceleration || 0;
        const braking = controls?.braking || 0;
        
        // Check if required methods exist
        if (typeof carBody.rotation !== 'function' || typeof carBody.linvel !== 'function') {
            console.warn('Car body missing required methods for physics control');
            return;
        }
        
        // Store current controls in user data for debugging
        if (!carBody.userData) {
            carBody.userData = { controls: {}, lastAppliedForces: {} };
        }
        
        carBody.userData.controls = {
            steering,
            acceleration,
            braking
        };
        
        // Debug logging for significant controls (reduced frequency)
        const hasSignificantControls = 
            Math.abs(steering) > 0.1 || 
            acceleration > 0.1 || 
            braking > 0.1;
            
        if (hasSignificantControls && Math.random() < 0.01) {
            const playerInfo = playerId ? `for player ${playerId}` : '';
            console.log(`🚗 APPLYING CONTROLS ${playerInfo}: steering=${steering.toFixed(2)}, accel=${acceleration.toFixed(2)}, brake=${braking.toFixed(2)}`);
        }
        
        // STEP 1: Get the car's current state and orientation
        
        // Get forward and right directions in world space
        const rotation = carBody.rotation();
        const forwardDir = { x: 0, y: 0, z: -1 }; // Default forward is -Z in Three.js
        
        // Apply quaternion to get world forward direction
        const q = rotation;
        const worldForward = {
            x: (1 - 2 * (q.y * q.y + q.z * q.z)) * forwardDir.x + 
                2 * (q.x * q.y - q.w * q.z) * forwardDir.y + 
                2 * (q.x * q.z + q.w * q.y) * forwardDir.z,
            y: 2 * (q.x * q.y + q.w * q.z) * forwardDir.x + 
                (1 - 2 * (q.x * q.x + q.z * q.z)) * forwardDir.y + 
                2 * (q.y * q.z - q.w * q.x) * forwardDir.z,
            z: 2 * (q.x * q.z - q.w * q.y) * forwardDir.x + 
                2 * (q.y * q.z + q.w * q.x) * forwardDir.y + 
                (1 - 2 * (q.x * q.x + q.y * q.y)) * forwardDir.z
        };
        
        // Normalize the forward vector
        const forwardLen = Math.sqrt(worldForward.x * worldForward.x + worldForward.y * worldForward.y + worldForward.z * worldForward.z);
        if (forwardLen > 0) {
            worldForward.x /= forwardLen;
            worldForward.y /= forwardLen;
            worldForward.z /= forwardLen;
        }
        
        // Get right vector (perpendicular to forward)
        const worldRight = {
            x: worldForward.z,
            y: 0,
            z: -worldForward.x
        };
        
        // Normalize right vector
        const rightLen = Math.sqrt(worldRight.x * worldRight.x + worldRight.y * worldRight.y + worldRight.z * worldRight.z);
        if (rightLen > 0) {
            worldRight.x /= rightLen;
            worldRight.y /= rightLen;
            worldRight.z /= rightLen;
        }
        
        // Up vector
        const worldUp = { x: 0, y: 1, z: 0 };
        
        // STEP 2: Calculate the car's current velocity and orientation relative to it
        
        // Get current velocity and world position
        const vel = carBody.linvel();
        const worldPos = carBody.translation();
        
        // Project velocity onto forward/right directions for lateral and forward velocity
        const forwardVel = worldForward.x * vel.x + worldForward.z * vel.z;
        const rightVel = worldRight.x * vel.x + worldRight.z * vel.z;
        
        // Calculate speed (magnitude of velocity projected onto ground plane)
        const velMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        
        // Calculate speed in km/h for display/debugging
        const speedKmh = velMag * 3.6;
        carBody.userData.currentSpeed = speedKmh;
        
        // Determine if we're moving forward or backward
        const isMovingForward = forwardVel >= 0;
        
        // STEP 3: Get car-specific physics properties
        
        // Get car-specific properties from userData
        const enginePower = carBody.userData?.enginePower || 2000.0;
        const brakePower = carBody.userData?.brakeForce || 3000.0;
        const maxSteeringAngle = carBody.userData?.maxSteeringAngle || 0.8;
        const steeringReturnSpeed = carBody.userData?.steeringReturnSpeed || 5.0;
        const lateralGripFactor = carBody.userData?.lateralGripFactor || 3.0;
        const rollingResistance = carBody.userData?.rollingResistance || 0.1;
        const aerodynamicDrag = carBody.userData?.aerodynamicDrag || 0.4;
        
        // STEP 4: Process wheel physics using raycast suspension model
        
        // Get wheel data from user data
        const wheels = carBody.userData?.wheels || [];
        if (wheels.length === 0) {
            console.warn('No wheel data found for physics car');
        }

        // Initialize ground contact flag for whole vehicle
        let atLeastOneWheelInContact = false;
        
        // Track forces for each wheel
        let totalLongitudinalForce = 0;
        let totalLateralForce = 0;
        
        // Update steering angle for front wheels based on input
        wheels.forEach(wheel => {
            if (wheel.isFrontWheel) {
                // Calculate target steering angle - non-linear to make it more responsive
                const targetSteeringAngle = steering * maxSteeringAngle * Math.sign(steering) * 
                                         (0.8 + 0.2 * Math.abs(steering)); // Non-linear steering curve
                
                // Gradually approach target steering angle (smoother steering)
                const steeringDelta = targetSteeringAngle - wheel.steering;
                wheel.steering += steeringDelta * 0.2; // Adjust steering gradually
            }
        });
        
        // Get speed limits from global physics parameters if available
        const params = window.physicsParams ? window.physicsParams.car : null;
        
        // Speed limits
        const maxSpeedKmh = params?.maxSpeedKmh || 120;         // Maximum forward speed
        const reverseMaxSpeedKmh = params?.reverseMaxSpeedKmh || 60;  // Maximum reverse speed 
        
        // Convert to m/s
        const maxSpeedMs = maxSpeedKmh / 3.6;
        const reverseMaxSpeedMs = reverseMaxSpeedKmh / 3.6;
        
        // Initialize force trackers for debugging
        let appliedEngineForce = 0;
        let appliedBrakeForce = 0;
        let appliedSteeringTorque = 0;
        let appliedLateralForce = 0;
        let appliedDragForce = 0;
        
        // Only apply forces if the appropriate method exists
        if (typeof carBody.addForce === 'function') {
            
            // Process each wheel using raycast suspension model
            wheels.forEach((wheel, index) => {
                // Get wheel position in world space using THREE.js for reliable math
                const wheelPosLocal = new THREE.Vector3(
                    wheel.position.x,
                    wheel.position.y, 
                    wheel.position.z
                );
                
                // Create rotation matrix from car's quaternion
                const carRotation = new THREE.Quaternion(
                    rotation.x, rotation.y, rotation.z, rotation.w
                );
                const carMatrix = new THREE.Matrix4().makeRotationFromQuaternion(carRotation);
                
                // Transform wheel local position to world position
                const wheelWorldPos = wheelPosLocal.clone().applyMatrix4(carMatrix);
                const wheelPosWorld = {
                    x: worldPos.x + wheelWorldPos.x,
                    y: worldPos.y + wheelWorldPos.y,
                    z: worldPos.z + wheelWorldPos.z
                };
                
                // Perform raycast test (simplified since we don't call the RAPIER raycast API directly)
                const groundY = 0; // Assuming ground is at Y=0
                const wheelHeight = wheelPosWorld.y;
                
                // SIMPLIFIED GROUND DETECTION: If car is within a height threshold, force it to stay on ground
                const heightThreshold = 10.0; // If car is within this distance of ground, consider it for contact
                
                if (wheelHeight < heightThreshold) {
                    // We're close enough to ground, FORCE ground contact
                    wheel.groundContact = true;
                    
                    // Calculate ideal wheel height (wheelRadius above ground)
                    const idealHeight = wheel.wheelRadius;
                    
                    // Calculate how much suspension should be compressed to reach ideal height
                    wheel.compression = Math.max(0, wheel.suspensionRestLength - (wheelHeight - idealHeight));
                    
                    // Force contact point to be at ground level
                    wheel.contactPoint = {
                        x: wheelPosWorld.x,
                        y: groundY,
                        z: wheelPosWorld.z
                    };
                    
                    wheel.contactNormal = { x: 0, y: 1, z: 0 }; // Ground normal points up
                    
                    atLeastOneWheelInContact = true;
                    
                    // Apply a smoother suspension force that's more consistent
                    // Removed the strong oscillating downward force that was causing jumping
                    const suspensionForce = 20.0 + wheel.compression * 10.0;
                    
                    // Apply a consistent force to keep the car on the ground
                    carBody.addForceAtPoint(
                        { x: 0, y: suspensionForce, z: 0 },
                        wheelPosWorld,
                        true
                    );
                    
                    // Calculate wheel forces (engine, braking, lateral grip)
                    
                    // Calculate wheel forward direction (taking steering into account for front wheels)
                    let wheelForward = { ...worldForward };
                    
                    if (wheel.isFrontWheel && Math.abs(wheel.steering) > 0.01) {
                        // Apply steering rotation to front wheels
                        const steerAngle = wheel.steering;
                        const cosSteer = Math.cos(steerAngle);
                        const sinSteer = Math.sin(steerAngle);
                        
                        // Rotate forward direction around Y axis based on steering angle
                        wheelForward = {
                            x: worldForward.x * cosSteer - worldRight.x * sinSteer,
                            y: 0,
                            z: worldForward.z * cosSteer - worldRight.z * sinSteer
                        };
                    }
                    
                    // Calculate wheel right vector (perpendicular to wheel forward)
                    const wheelRight = {
                        x: wheelForward.z,
                        y: 0,
                        z: -wheelForward.x
                    };
                    
                    // Create a container for all the forces we'll apply to this wheel
                    const wheelForce = { x: 0, y: 0, z: 0 };
                    
                    // Calculate wheel velocity at contact point
                    // Using local linear velocity as Rapier doesn't have linvelAt function
                    const carVel = carBody.linvel();
                    const angVel = carBody.angvel();
                    
                    // Calculate velocity at the wheel position using the formula: v = v_cm + ω × r
                    // where r is the vector from center of mass to wheel position
                    const r = {
                        x: wheelPosWorld.x - worldPos.x,
                        y: wheelPosWorld.y - worldPos.y,
                        z: wheelPosWorld.z - worldPos.z
                    };
                    
                    const wheelVelAtContact = {
                        x: carVel.x + (angVel.y * r.z - angVel.z * r.y),
                        y: carVel.y + (angVel.z * r.x - angVel.x * r.z),
                        z: carVel.z + (angVel.x * r.y - angVel.y * r.x)
                    };
                    
                    // Project wheel velocity onto wheel forward/right directions
                    const wheelForwardVel = wheelForward.x * wheelVelAtContact.x + wheelForward.z * wheelVelAtContact.z;
                    const wheelRightVel = wheelRight.x * wheelVelAtContact.x + wheelRight.z * wheelVelAtContact.z;
                    
                    // Calculate engine force based on acceleration input
                    let engineForce = 0;
                    
                    if (wheel.isFrontWheel) {  // Front-wheel drive
                        if (acceleration > 0 && speedKmh < maxSpeedKmh) {
                            // More consistent acceleration curve that doesn't diminish as much with speed
                            const speedFactor = Math.max(0.6, 1.0 - (speedKmh / maxSpeedKmh));
                            engineForce = acceleration * enginePower * speedFactor;
                            
                            // Apply force consistently regardless of wheel contact
                            wheelForce.x += wheelForward.x * engineForce;
                            wheelForce.z += wheelForward.z * engineForce;
                            
                            // Track for stats
                            appliedEngineForce += engineForce;
                        }
                        else if (acceleration < 0 && speedKmh > -reverseMaxSpeedKmh) {
                            // More consistent reverse acceleration
                            const reverseFactor = 0.5; // Make reverse slower
                            engineForce = acceleration * enginePower * reverseFactor; 
                            
                            // Apply force consistently
                            wheelForce.x += wheelForward.x * engineForce;
                            wheelForce.z += wheelForward.z * engineForce;
                            
                            // Track for stats
                            appliedEngineForce += engineForce;
                        }
                    }
                    
                    // Calculate braking force
                    let brakeForce = 0;
                    
                    if (braking > 0) {
                        // More consistent braking forces
                        brakeForce = braking * brakePower;
                        
                        // Scaling based on velocity to prevent locking of wheels
                        if (Math.abs(wheelForwardVel) < 0.1) {
                            brakeForce *= Math.abs(wheelForwardVel) * 10; // Reduce at very low speeds
                        }
                        
                        // Apply opposite to wheel forward direction
                        if (wheelForwardVel > 0.1) {
                            wheelForce.x -= wheelForward.x * brakeForce;
                            wheelForce.z -= wheelForward.z * brakeForce;
                        } else if (wheelForwardVel < -0.1) {
                            wheelForce.x += wheelForward.x * brakeForce;
                            wheelForce.z += wheelForward.z * brakeForce;
                        }
                        
                        appliedBrakeForce += brakeForce;
                    }
                    
                    // Lateral grip forces (prevent sliding)
                    if (Math.abs(wheelRightVel) > 0.1) {
                        // Increased lateral grip force for better handling
                        const lateralGrip = lateralGripFactor * 1.2;
                        const lateralForce = -wheelRightVel * lateralGrip;
                        
                        // Apply force perpendicular to wheel direction (side grip)
                        wheelForce.x += wheelRight.x * lateralForce;
                        wheelForce.z += wheelRight.z * lateralForce;
                        
                        appliedLateralForce += lateralForce;
                    }
                    
                    // After calculating all wheel forces, apply them in a single call for efficiency
                    if (wheelForce.x !== 0 || wheelForce.z !== 0) {
                        carBody.addForceAtPoint(wheelForce, wheelPosWorld, true);
                    }
                }
            });
            
            // STEP 5: Apply overall vehicle forces
            
            // Apply drag and rolling resistance
            if (velMag > 0.1) {
                // Calculate rolling resistance (constant low force opposing movement)
                const rollingForce = rollingResistance * velMag;
                
                // Calculate aerodynamic drag (increases with square of speed)
                const dragForce = aerodynamicDrag * velMag * velMag;
                
                // Combined resistance force 
                appliedDragForce = rollingForce + dragForce;
                
                // Apply opposite to velocity direction
                const resistanceForce = {
                    x: -vel.x / velMag * appliedDragForce,
                    y: 0,
                    z: -vel.z / velMag * appliedDragForce
                };
                
                carBody.addForce(resistanceForce, true);
                
                // Add stabilizing torque to counteract unwanted rotation
                // This helps keep the car from spinning around its axis
                const angVel = carBody.angvel();
                if (Math.abs(angVel.x) > 0.2 || Math.abs(angVel.z) > 0.2) {
                    const stabilizingTorque = {
                        x: -angVel.x * 15.0, // Strong damping for roll
                        y: -angVel.y * 1.5,  // Light damping for yaw (steering)
                        z: -angVel.z * 15.0  // Strong damping for pitch
                    };
                    carBody.addTorque(stabilizingTorque, true);
                }
                
                if (Math.random() < 0.001) {
                    console.log(`🌬️ DRAG: Applied resistance: ${appliedDragForce.toFixed(0)}N at ${speedKmh.toFixed(1)} km/h`);
                }
            }

            // Apply a direct downward force to ensure the car doesn't float away
            const carHeight = carBody.translation().y;
            
            // Always apply anti-bounce force to counter vertical velocity
            const verticalVel = vel.y;
            if (Math.abs(verticalVel) > 0.1) {
                // Strong counter-force to dampen vertical velocity - increased from 10.0 to 15.0
                const antiVelocityForce = -verticalVel * 15.0;
                carBody.addForce({
                    x: 0,
                    y: antiVelocityForce,
                    z: 0
                }, true);
                
                // If car is moving upward too fast, apply even more damping
                if (verticalVel > 2.0) {
                    const extraDamping = -verticalVel * 10.0; // Extra damping for upward velocity
                    carBody.addForce({
                        x: 0,
                        y: extraDamping,
                        z: 0
                    }, true);
                }
            }
            
            // Additional gravity if car is too high
            if (carHeight > 1.0) { // If car is more than 1 unit above ground
                // Apply stronger force the higher the car is
                const gravityMultiplier = 2.0 + carHeight * 3.0;
                const downwardForce = {
                    x: 0,
                    y: -500.0 * gravityMultiplier, // Much stronger direct force
                    z: 0
                };
                
                carBody.addForce(downwardForce, true);
                
                if (Math.random() < 0.005) {
                    console.log(`⬇️ GRAVITY: Applied downward force: ${(500.0 * gravityMultiplier).toFixed(0)}N at height ${carHeight.toFixed(1)}`);
                }
            }
        }
        
        // STEP 6: Update car state
        carBody.userData.isGrounded = atLeastOneWheelInContact;
        
        if (atLeastOneWheelInContact) {
            carBody.userData.lastGroundContact = Date.now();
        }
        
        // Record force application for debugging
        carBody.userData.lastAppliedForces = {
            engineForce: appliedEngineForce,
            brakeForce: appliedBrakeForce,
            steeringTorque: appliedSteeringTorque,
            lateralForce: appliedLateralForce,
            dragForce: appliedDragForce,
            totalLongitudinalForce: totalLongitudinalForce,
            totalLateralForce: totalLateralForce
        };
        
        // Wake up the body to ensure physics simulation continues
        if (typeof carBody.wakeUp === 'function') {
            carBody.wakeUp();
        }
    } catch (error) {
        console.error('Error applying car controls:', error);
    }
}

// Function to properly reset a car to initial state
function resetCarPosition(world, carBody, startPosition, startRotation = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!carBody || !world) return false;
    
    try {
        // Ensure the position is at least 1 unit above ground to prevent clipping
        const resetPosition = {
            x: startPosition.x,
            y: Math.max(startPosition.y, 2.0), // Ensure minimum height
            z: startPosition.z
        };
        
        console.log(`Resetting car to position: (${resetPosition.x}, ${resetPosition.y}, ${resetPosition.z})`);
        
        // Stop all motion
        carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        
        // Set the position
        carBody.setTranslation(resetPosition, true);
        
        // Set the rotation (quaternion)
        carBody.setRotation(startRotation, true);
        
        // Reset additional properties in userData
        if (carBody.userData) {
            carBody.userData.currentSpeed = 0;
            carBody.userData.isGrounded = false;
            carBody.userData.lastGroundContact = Date.now();
            
            // Reset controls
            if (carBody.userData.controls) {
                carBody.userData.controls = {
                    acceleration: 0,
                    braking: 0,
                    steering: 0
                };
            }
            
            // Reset wheel data
            if (carBody.userData.wheels) {
                carBody.userData.wheels.forEach(wheel => {
                    wheel.steering = 0;
                    wheel.compression = 0;
                    wheel.groundContact = false;
                    wheel.contactPoint = null;
                    wheel.contactNormal = null;
                });
            }
        }
        
        // Wake up the physics body
        if (typeof carBody.wakeUp === 'function') {
            carBody.wakeUp();
        }
        
        // Apply a small downward impulse to ensure the car starts falling
        carBody.applyImpulse({ x: 0, y: -10.0, z: 0 }, true);
        
        return true;
    } catch (error) {
        console.error('Error resetting car position:', error);
        return false;
    }
}

// Helper function to check if car is upside down
function isCarUpsideDown(carBody) {
    if (!carBody) return false;
    
    try {
        // Get the rotation of the car
        const q = carBody.rotation();
        
        // Get the up vector in world space (transformed from local Y-up)
        const localUp = { x: 0, y: 1, z: 0 };
        
        // Transform the up vector by the car's rotation quaternion
        const worldUpY = 2 * (q.x * q.y + q.w * q.z) * localUp.x + 
                        (1 - 2 * (q.x * q.x + q.z * q.z)) * localUp.y + 
                        2 * (q.y * q.z - q.w * q.x) * localUp.z;
        
        // Check if the car is upside down (local Y-up is pointing down in world space)
        // We use a threshold of -0.75 to prevent flipping back and forth around 90 degrees
        return worldUpY < -0.75;
    } catch (error) {
        console.error('Error checking if car is upside down:', error);
        return false;
    }
}

/**
 * Synchronize the Three.js visual car model with the physics model
 * This ensures the car visual representation matches exactly with the physics body
 * @param {Object} carBody - The Rapier physics rigid body
 * @param {Object} carMesh - The Three.js mesh or group for the car
 * @param {Array} wheelMeshes - Array of wheel meshes in order [frontLeft, frontRight, rearLeft, rearRight]
 */
function syncCarModelWithPhysics(carBody, carMesh, wheelMeshes = []) {
    if (!carBody || !carMesh) return;
    
    try {
        // Update main car body position and rotation
        const physicsPos = carBody.translation();
        const physicsRot = carBody.rotation();
        
        // Set the car mesh position
        carMesh.position.set(physicsPos.x, physicsPos.y, physicsPos.z);
        
        // Set the car mesh rotation
        carMesh.quaternion.set(physicsRot.x, physicsRot.y, physicsRot.z, physicsRot.w);
        
        // If wheel meshes are provided and wheel data exists in the car body
        if (wheelMeshes.length > 0 && carBody.userData && carBody.userData.wheels) {
            const wheels = carBody.userData.wheels;
            
            // Update each wheel mesh based on physics data
            wheels.forEach((wheelData, index) => {
                // Make sure we have a corresponding wheel mesh
                if (index < wheelMeshes.length && wheelMeshes[index]) {
                    const wheelMesh = wheelMeshes[index];
                    const worldPos = carBody.translation();
                    const worldRot = carBody.rotation();
                    
                    // Calculate wheel position in world space
                    // Use THREE.js for more reliable vector math
                    const carPos = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
                    const wheelLocalPos = new THREE.Vector3(
                        wheelData.position.x, 
                        wheelData.position.y, 
                        wheelData.position.z
                    );
                    
                    // Create rotation matrix from car's quaternion
                    const carRotation = new THREE.Quaternion(worldRot.x, worldRot.y, worldRot.z, worldRot.w);
                    const carMatrix = new THREE.Matrix4().makeRotationFromQuaternion(carRotation);
                    
                    // Transform wheel local position to world position
                    const wheelWorldPos = wheelLocalPos.clone().applyMatrix4(carMatrix);
                    const wheelFinalPos = carPos.clone().add(wheelWorldPos);
                    
                    // Adjust for suspension compression
                    if (wheelData.groundContact) {
                        // Apply compression along world up vector
                        wheelFinalPos.y -= wheelData.compression;
                    }
                    
                    // Set wheel position
                    wheelMesh.position.set(wheelFinalPos.x, wheelFinalPos.y, wheelFinalPos.z);
                    
                    // Debug wheel positions - log occasionally
                    if (Math.random() < 0.0002) {
                        console.log(`Wheel ${index} position:`, 
                                    { x: wheelFinalPos.x, y: wheelFinalPos.y, z: wheelFinalPos.z }, 
                                    'Local pos:', wheelData.position,
                                    'Contact:', wheelData.groundContact,
                                    'Compression:', wheelData.compression);
                    }
                    
                    // Apply car's rotation to the wheel
                    wheelMesh.quaternion.set(worldRot.x, worldRot.y, worldRot.z, worldRot.w);
                    
                    // Apply steering rotation for front wheels
                    if (wheelData.isFrontWheel && Math.abs(wheelData.steering) > 0.01) {
                        // Create a quaternion for the steering rotation (around Y axis)
                        const steerAngle = wheelData.steering;
                        const steerQuat = new THREE.Quaternion().setFromAxisAngle(
                            new THREE.Vector3(0, 1, 0), 
                            steerAngle
                        );
                        
                        // Apply the steering rotation
                        wheelMesh.quaternion.premultiply(steerQuat);
                    }
                    
                    // Simulate wheel rotation based on vehicle speed
                    // (This can be enhanced to use actual wheel angular velocity)
                    if (carBody.userData.currentSpeed) {
                        // Simple rotation based on speed
                        const speed = carBody.userData.currentSpeed / 3.6; // Convert km/h to m/s
                        const wheelRadius = wheelData.wheelRadius;
                        const rotationSpeed = speed / wheelRadius;
                        
                        // The existing rotation is around the Z axis since we rotated the wheels
                        const rotationAxis = new THREE.Vector3(0, 0, 1);
                        const rotationQuat = new THREE.Quaternion().setFromAxisAngle(
                            rotationAxis,
                            rotationSpeed * 0.01 // Small increment per frame
                        );
                        
                        // Apply the rotation
                        wheelMesh.quaternion.premultiply(rotationQuat);
                    }
                    
                    // Store reference to wheel mesh in wheel data for future updates
                    wheelData.wheelObject = wheelMesh;
                }
            });
        }
    } catch (error) {
        console.error('Error synchronizing car model with physics:', error);
    }
}

// Export the rapierPhysics object with all the functions
const rapierPhysics = {
    init: initRapierPhysics,
    // Add other functions here
    createWorld: createRapierWorld,
    createCarPhysics: createCarPhysics,
    createGroundPlane: createGroundPlane,
    applyCarControls: applyCarControls,
    resetCarPosition: resetCarPosition,
    isCarUpsideDown: isCarUpsideDown,
    syncCarModelWithPhysics: syncCarModelWithPhysics
};

// Make it available globally for backward compatibility
window.rapierPhysics = rapierPhysics;

// Export as default
export default rapierPhysics;