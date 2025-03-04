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
            console.log('Rapier module imported successfully');
            
            // Init WASM module
            await rapierModule.init();
            console.log('Rapier WASM initialized successfully');
            
            // Store the module globally
            RAPIER = rapierModule;
            
            // Set a flag to indicate successful loading
            window.rapierLoaded = true;
            
            console.log('Rapier physics initialized successfully');
            return RAPIER;
        } catch (importError) {
            console.error('Error importing Rapier module:', importError);
            
            // Fallback to global RAPIER object if available
            if (typeof window.RAPIER !== 'undefined') {
                console.log('Using globally available RAPIER object');
                RAPIER = window.RAPIER;
                
                // Initialize WASM if needed
                if (typeof RAPIER.init === 'function') {
                    await RAPIER.init();
                }
                
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

// Create a Rapier physics world with more realistic settings
function createRapierWorld() {
    if (!RAPIER) {
        console.error('Rapier not initialized. Call initRapierPhysics first.');
        return null;
    }
    
    // Create a world with gravity - lower gravity for more arcade-style fun
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);
    
    console.log('Rapier physics world created');
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
        
        // STEP 1: Create the main rigid body with realistic parameters
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.35)      // Light damping for smoother movement
            .setAngularDamping(0.5)      // Medium angular damping for controlled rotation
            .setCcdEnabled(true)         // Enable continuous collision detection for fast-moving objects
            .setAdditionalMass(1200.0);  // More realistic car mass (kg)
        
        const carBody = world.createRigidBody(rigidBodyDesc);
        
        // STEP 2: Create a more complex multi-part collision shape
        
        // Main chassis - slightly tapered box for better collision profile
        const mainChassisDesc = RAPIER.ColliderDesc.cuboid(width/2, height/2 * 0.8, length/2)
            .setDensity(1.0)
            .setFriction(0.7)
            .setRestitution(0.2)  // Some bounce for derby-style collisions
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
        
        // Create the main chassis collider
        world.createCollider(mainChassisDesc, carBody);
        
        // Lower chassis/floorpan - creates a lower center of mass for stability
        const floorpanDesc = RAPIER.ColliderDesc.cuboid(width/2 * 0.9, height/4, length/2 * 0.95)
            .setTranslation(0, -height/4, 0)  // Position it at the bottom of the car
            .setDensity(3.0)                 // Higher density in the floor for stability
            .setFriction(0.7)
            .setRestitution(0.2);
        
        // Create the floorpan collider
        world.createCollider(floorpanDesc, carBody);
        
        // STEP 3: Add wheel colliders for better grip simulation
        
        // Wheel parameters
        const wheelRadius = 0.4;
        const wheelWidth = 0.25;
        const wheelPositions = [
            // Front left
            { x: -width/2 + wheelWidth/2, y: -height/2 + wheelRadius * 0.7, z: length/2 - wheelRadius * 1.2 },
            // Front right
            { x: width/2 - wheelWidth/2, y: -height/2 + wheelRadius * 0.7, z: length/2 - wheelRadius * 1.2 },
            // Rear left
            { x: -width/2 + wheelWidth/2, y: -height/2 + wheelRadius * 0.7, z: -length/2 + wheelRadius * 1.2 },
            // Rear right
            { x: width/2 - wheelWidth/2, y: -height/2 + wheelRadius * 0.7, z: -length/2 + wheelRadius * 1.2 }
        ];
        
        // Add each wheel as a cylinder collider
        wheelPositions.forEach((wheelPos) => {
            const wheelDesc = RAPIER.ColliderDesc.cylinder(wheelRadius, wheelWidth/2)
                .setTranslation(wheelPos.x, wheelPos.y, wheelPos.z)
                .setDensity(1.0)
                .setFriction(1.5)        // High friction for wheels
                .setRestitution(0.2);    
                
            world.createCollider(wheelDesc, carBody);
        });
        
        // STEP 4: Set up Derby-specific properties
        
        // Store car-specific properties in the user data
        carBody.userData = {
            // Physics properties
            enginePower: 2500.0,       // Max engine force
            brakeForce: 3000.0,        // Max braking force
            steeringResponse: 0.7,     // How quickly steering responds (0-1)
            lateralGripFactor: 1.8,    // Higher values mean more grip in turns
            rollingResistance: 0.05,   // Natural rolling resistance
            aerodynamicDrag: 0.4,      // Air resistance factor
            
            // Car state
            currentSpeed: 0,
            isGrounded: true,
            lastGroundContact: Date.now(),
            wheelContactPoints: [false, false, false, false],
            
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
        
        console.log("Created derby-style car physics body successfully");
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
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const groundBody = world.createRigidBody(groundBodyDesc);
        
        // Main ground surface - large flat cuboid
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100)
            .setFriction(0.8)           // Good grip on the main surface
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
        
        console.log('Ground plane and derby arena barriers created successfully');
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
            
        if (hasSignificantControls && Math.random() < 0.02) {
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
        
        // Get current velocity and orientation
        const vel = carBody.linvel();
        
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
        const enginePower = carBody.userData?.enginePower || 2500.0;
        const brakePower = carBody.userData?.brakeForce || 3000.0;
        const lateralGripFactor = carBody.userData?.lateralGripFactor || 1.8;
        const rollingResistance = carBody.userData?.rollingResistance || 0.05;
        const aerodynamicDrag = carBody.userData?.aerodynamicDrag || 0.4;
        
        // STEP 4: Apply forces and torques to simulate car dynamics
        
        // Speed limits
        const maxSpeedKmh = 70;         // Maximum forward speed
        const reverseMaxSpeedKmh = 30;  // Maximum reverse speed 
        
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
            
            // STEP 4A: Apply engine/acceleration force
            if (acceleration > 0) {
                // Progressive acceleration curve
                // - Full power at low speeds
                // - Reduced power as we approach max speed
                const speedRatio = Math.min(1, speedKmh / maxSpeedKmh);
                
                // Calculate power curve - reduce power as speed increases
                // This creates a more realistic feel as the car approaches top speed
                const powerCurve = 1 - Math.pow(speedRatio, 2);
                
                // Calculate final engine force with acceleration input
                appliedEngineForce = enginePower * acceleration * powerCurve;
                
                // Only apply engine force if we're below max speed or moving backward
                if (speedKmh < maxSpeedKmh || !isMovingForward) {
                    const force = {
                        x: worldForward.x * appliedEngineForce,
                        y: 0,
                        z: worldForward.z * appliedEngineForce
                    };
                    
                    carBody.addForce(force, true);
                    
                    if (Math.random() < 0.005) {
                        console.log(`💨 ENGINE: Applied force: ${appliedEngineForce.toFixed(0)}N, speed: ${speedKmh.toFixed(1)} km/h`);
                    }
                }
            }
            
            // STEP 4B: Apply braking/reverse
            if (braking > 0) {
                // We handle braking differently depending on whether we're moving forward or backward
                
                if (isMovingForward && velMag > 0.1) {
                    // Forward braking - apply force opposite to velocity vector
                    appliedBrakeForce = brakePower * braking;
                    
                    // Apply relative to current speed - stronger at higher speeds
                    const brakeFactor = 0.5 + 0.5 * (speedKmh / maxSpeedKmh);
                    const scaledBrakeForce = appliedBrakeForce * brakeFactor;
                    
                    const force = {
                        x: -vel.x / velMag * scaledBrakeForce,
                        y: 0,
                        z: -vel.z / velMag * scaledBrakeForce
                    };
                    
                    carBody.addForce(force, true);
                    
                    if (Math.random() < 0.005) {
                        console.log(`🛑 BRAKE: Applied brake force: ${scaledBrakeForce.toFixed(0)}N`);
                    }
                } 
                else if (speedKmh < reverseMaxSpeedKmh) {
                    // Reverse - apply force in backward direction
                    // Use 60% of engine power for reverse
                    appliedBrakeForce = enginePower * 0.6 * braking;
                    
                    // Reduce force as we approach max reverse speed 
                    const reverseSpeedRatio = speedKmh / reverseMaxSpeedKmh;
                    const reversePowerCurve = 1 - Math.pow(reverseSpeedRatio, 2);
                    const scaledReverseForce = appliedBrakeForce * reversePowerCurve;
                    
                    const force = {
                        x: -worldForward.x * scaledReverseForce,
                        y: 0,
                        z: -worldForward.z * scaledReverseForce
                    };
                    
                    carBody.addForce(force, true);
                    
                    if (Math.random() < 0.005) {
                        console.log(`⏪ REVERSE: Force: ${scaledReverseForce.toFixed(0)}N, speed: ${speedKmh.toFixed(1)} km/h`);
                    }
                }
            }
            
            // STEP 4C: Apply lateral grip/friction (simulates tire sidewall grip)
            
            // Only apply lateral grip when moving at a reasonable speed
            if (Math.abs(rightVel) > 0.2 && velMag > 1.0) {
                // Calculate tire grip based on speed
                // Reduce grip at higher speeds to allow drifting
                const gripSpeedFactor = Math.max(0.5, 1.0 - (velMag / maxSpeedMs) * 0.3);
                
                // Apply lateral force proportional to sideways velocity
                // This simulates tires resisting sideways movement
                appliedLateralForce = -rightVel * lateralGripFactor * gripSpeedFactor;
                
                // Scale lateral force based on whether we're accelerating or braking
                // This simulates weight transfer effects
                const weightTransferFactor = 1.0 + acceleration * 0.2 - braking * 0.2;
                appliedLateralForce *= weightTransferFactor;
                
                const lateralForce = {
                    x: worldRight.x * appliedLateralForce,
                    y: 0,
                    z: worldRight.z * appliedLateralForce
                };
                
                carBody.addForce(lateralForce, true);
                
                if (Math.random() < 0.005) {
                    console.log(`↔️ GRIP: Lateral force: ${appliedLateralForce.toFixed(0)}N, sideways vel: ${rightVel.toFixed(2)}`);
                }
            }
            
            // STEP 4D: Apply drag and rolling resistance
            
            // Rolling resistance (constant low force opposing movement)
            if (velMag > 0.1) {
                const rollingForce = rollingResistance * velMag;
                
                // Aerodynamic drag (increases with square of speed)
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
                
                if (Math.random() < 0.002) {
                    console.log(`🌬️ DRAG: Applied resistance: ${appliedDragForce.toFixed(0)}N at ${speedKmh.toFixed(1)} km/h`);
                }
            }
            
            // STEP 4E: Apply steering torque
            if (Math.abs(steering) > 0.01 && typeof carBody.addTorque === 'function') {
                // Calculate steering magnitude based on speed
                // - More responsive at low speeds
                // - Reduced response at high speeds for stability
                const speedFactor = Math.pow(Math.max(0, Math.min(1, 1 - (velMag / maxSpeedMs) * 0.8)), 0.8);
                
                // Base steering force with non-linear response curve
                const steeringMagnitude = 300 * Math.sign(steering) * Math.pow(Math.abs(steering), 1.3);
                
                // Apply speed scaling
                appliedSteeringTorque = steeringMagnitude * (0.3 + 0.7 * speedFactor);
                
                // Add countersteer assist to help control slides
                if (Math.abs(rightVel) > 3.0) {
                    const counterSteerMagnitude = 50 * Math.sign(-rightVel) * Math.min(1, Math.abs(rightVel) / 8);
                    appliedSteeringTorque += counterSteerMagnitude;
                }
                
                // Create torque vector (y-axis for steering)
                const torque = { 
                    x: 0, 
                    y: appliedSteeringTorque, 
                    z: 0 
                };
                
                carBody.addTorque(torque, true);
                
                if (Math.random() < 0.005) {
                    console.log(`🔄 STEERING: Torque: ${appliedSteeringTorque.toFixed(0)}, speed factor: ${speedFactor.toFixed(2)}`);
                }
            }
        }
        
        // STEP 5: Store debug data about applied forces
        carBody.userData.lastAppliedForces = {
            engineForce: appliedEngineForce,
            brakeForce: appliedBrakeForce,
            steeringTorque: appliedSteeringTorque,
            lateralForce: appliedLateralForce,
            dragForce: appliedDragForce
        };
        
        // Wake up the body when forces are applied
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
        // Stop all motion
        carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        
        // Reset position
        carBody.setTranslation(startPosition, true);
        
        // Reset rotation - ensure quaternion is valid
        if (!startRotation.w && startRotation.w !== 0) {
            // If we only have Euler angles, convert to quaternion
            if (typeof THREE !== 'undefined' && THREE.Quaternion) {
                const euler = new THREE.Euler(
                    startRotation.x || 0, 
                    startRotation.y || 0, 
                    startRotation.z || 0, 
                    'XYZ'
                );
                const quaternion = new THREE.Quaternion().setFromEuler(euler);
                startRotation = {
                    x: quaternion.x,
                    y: quaternion.y,
                    z: quaternion.z,
                    w: quaternion.w
                };
            } else {
                // Default to identity quaternion if THREE.js not available
                startRotation = { x: 0, y: 0, z: 0, w: 1 };
            }
        }
        
        carBody.setRotation(startRotation, true);
        
        // Reset user data state
        if (carBody.userData) {
            carBody.userData.currentSpeed = 0;
            carBody.userData.controls = { steering: 0, acceleration: 0, braking: 0 };
            carBody.userData.lastAppliedForces = {
                engineForce: 0,
                brakeForce: 0,
                steeringTorque: 0,
                lateralForce: 0,
                dragForce: 0
            };
        }
        
        // Wake up the body to ensure it starts fresh
        if (typeof carBody.wakeUp === 'function') {
            carBody.wakeUp();
        }
        
        // Force a physics world step to ensure changes take effect
        world.step();
        
        console.log(`Car reset to position (${startPosition.x}, ${startPosition.y}, ${startPosition.z})`);
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
        // Get car's up vector in world space
        const rotation = carBody.rotation();
        const q = rotation;
        
        // Transform up vector (0,1,0) by quaternion
        const worldUpY = 2 * (q.x * q.y + q.w * q.z) * 0 + 
                       (1 - 2 * (q.x * q.x + q.z * q.z)) * 1 + 
                       2 * (q.y * q.z - q.w * q.x) * 0;
        
        // Car is upside down if its Y-up vector is pointing downward
        return worldUpY < 0;
    } catch (error) {
        console.error('Error checking if car is upside down:', error);
        return false;
    }
}

// Export functions
window.rapierPhysics = {
    init: initRapierPhysics,
    createWorld: createRapierWorld,
    createCarPhysics: createCarPhysics,
    createGroundPlane: createGroundPlane,
    applyCarControls: applyCarControls,
    resetCarPosition: resetCarPosition,
    isCarUpsideDown: isCarUpsideDown
};