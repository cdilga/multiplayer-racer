// Rapier physics integration for multiplayer racer
// Based on https://sbcode.net/threejs/physics-rapier/

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

// Create a Rapier physics world
function createRapierWorld() {
    if (!RAPIER) {
        console.error('Rapier not initialized. Call initRapierPhysics first.');
        return null;
    }
    
    // Create a world with gravity
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);
    
    console.log('Rapier physics world created');
    return world;
}

// Create a car physics body
function createCarPhysics(world, position, dimensions) {
    if (!RAPIER || !world) {
        console.error('Rapier world not initialized');
        return null;
    }
    
    const { width, height, length } = dimensions;
    
    // Create a rigid body for the car
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        // Set reasonable mass and damping values for a car
        .setMass(1500) // 1500kg - typical car weight
        .setLinearDamping(0.5) // Represents air resistance and rolling friction
        .setAngularDamping(0.8); // Restricts how quickly the car can spin
    
    const carBody = world.createRigidBody(rigidBodyDesc);
    
    // Create a collider for the car (box shape)
    const colliderDesc = RAPIER.ColliderDesc.cuboid(width/2, height/2, length/2)
        .setRestitution(0.1)  // Low bounciness for a car
        .setFriction(0.9)     // High friction for tires
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
    
    world.createCollider(colliderDesc, carBody);
    
    // Initial linear velocity limit - help prevent extreme accelerations at startup
    carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    
    console.log("Created car physics body with proper damping and friction");
    
    return carBody;
}

// Create a ground plane
function createGroundPlane(world) {
    if (!RAPIER || !world) {
        console.error('Rapier world not initialized');
        return null;
    }
    
    // Create a static rigid body for the ground
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = world.createRigidBody(groundBodyDesc);
    
    // Create a collider for the ground (large cuboid)
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100)
        .setFriction(0.7);
    
    world.createCollider(groundColliderDesc, groundBody);
    
    return groundBody;
}

// Apply forces to a car body based on controls
function applyCarControls(carBody, controls) {
    if (!carBody) return;
    
    const { steering, acceleration, braking } = controls;
    
    // Get forward direction in world space
    const rotation = carBody.rotation();
    const forwardDir = { x: 0, y: 0, z: -1 };
    
    // Apply rotation to get world forward direction
    const worldForward = { x: 0, y: 0, z: 0 };
    const q = rotation;
    
    // Apply quaternion rotation to forward vector manually for better accuracy
    const x = forwardDir.x;
    const y = forwardDir.y;
    const z = forwardDir.z;
    
    // Transform direction vector by quaternion (q v q*)
    worldForward.x = (1 - 2 * (q.y * q.y + q.z * q.z)) * x + 2 * (q.x * q.y - q.w * q.z) * y + 2 * (q.x * q.z + q.w * q.y) * z;
    worldForward.y = 2 * (q.x * q.y + q.w * q.z) * x + (1 - 2 * (q.x * q.x + q.z * q.z)) * y + 2 * (q.y * q.z - q.w * q.x) * z;
    worldForward.z = 2 * (q.x * q.z - q.w * q.y) * x + 2 * (q.y * q.z + q.w * q.x) * y + (1 - 2 * (q.x * q.x + q.y * q.y)) * z;
    
    // Normalize the vector
    const len = Math.sqrt(worldForward.x * worldForward.x + worldForward.y * worldForward.y + worldForward.z * worldForward.z);
    if (len > 0) {
        worldForward.x /= len;
        worldForward.y /= len;
        worldForward.z /= len;
    }
    
    // Speed constants
    const maxSpeedKmh = 100;  // 100 km/h forward max
    const reverseMaxSpeedKmh = 50;  // 50 km/h reverse max
    
    // Convert to m/s (physics units)
    const maxSpeedMs = maxSpeedKmh / 3.6;
    const reverseMaxSpeedMs = reverseMaxSpeedKmh / 3.6;
    
    // Get current linear velocity
    const vel = carBody.linvel();
    const velMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    
    // Calculate speed in km/h for display/debugging
    const speedKmh = velMag * 3.6;
    
    // Determine if we're moving forward or backward relative to the car's orientation
    const dotProduct = worldForward.x * vel.x + worldForward.z * vel.z;
    const isMovingForward = dotProduct >= 0;
    
    // AGGRESSIVE SPEED LIMITING
    // Always check and enforce speed limits
    if (velMag > 0.1) {
        // Create limited velocity vector
        let limitedVel = { x: vel.x, y: vel.y, z: vel.z };
        let needsLimiting = false;
        
        // Apply appropriate speed limit based on direction
        const effectiveSpeedLimit = isMovingForward ? maxSpeedMs : reverseMaxSpeedMs;
        
        if (velMag > effectiveSpeedLimit) {
            // Scale velocity to the maximum allowed
            const scaleFactor = effectiveSpeedLimit / velMag;
            limitedVel.x *= scaleFactor;
            limitedVel.z *= scaleFactor;
            needsLimiting = true;
            
            // Debug logging when limiting
            console.log(`Speed limited: ${speedKmh.toFixed(1)} km/h → ${(effectiveSpeedLimit * 3.6).toFixed(1)} km/h [${isMovingForward ? 'forward' : 'reverse'}]`);
        }
        
        // Apply the limit if needed
        if (needsLimiting) {
            carBody.setLinvel(limitedVel, true);
            
            // Update local variables to reflect the change
            vel.x = limitedVel.x;
            vel.y = limitedVel.y;
            vel.z = limitedVel.z;
        }
    }
    
    // Apply forces based on controls
    const maxForce = 1500; // Maximum force in Newtons
    
    // Calculate speed factor for force application (reduces force as speed increases)
    const speedFactor = 1 - Math.min(1, (speedKmh / maxSpeedKmh));
    
    if (acceleration > 0) {
        // Only apply force if under speed limit
        if (isMovingForward && speedKmh < maxSpeedKmh) {
            // Reduce force as we approach max speed
            const appliedForce = maxForce * acceleration * Math.max(0.2, speedFactor);
            
            const force = {
                x: worldForward.x * appliedForce,
                y: 0,
                z: worldForward.z * appliedForce
            };
            carBody.applyForce(force, true);
        } else if (!isMovingForward) {
            // If moving backwards and accelerating, apply more force to help change direction
            const appliedForce = maxForce * 1.5 * acceleration;
            
            const force = {
                x: worldForward.x * appliedForce,
                y: 0,
                z: worldForward.z * appliedForce
            };
            carBody.applyForce(force, true);
        }
    }
    
    // Apply braking/reverse based on controls
    if (braking > 0) {
        if (isMovingForward && velMag > 0.1) {
            // Apply braking force if moving forward
            const brakeForce = 2000; // Braking force in Newtons
            const force = {
                x: -vel.x / velMag * brakeForce * braking,
                y: 0,
                z: -vel.z / velMag * brakeForce * braking
            };
            carBody.applyForce(force, true);
        } else if (speedKmh < reverseMaxSpeedKmh) {
            // Apply reverse acceleration force
            const reverseForce = maxForce * 0.5 * braking; // Less force for reverse
            const force = {
                x: -worldForward.x * reverseForce,
                y: 0,
                z: -worldForward.z * reverseForce
            };
            carBody.applyForce(force, true);
        }
    }
    
    // Apply steering torque with better handling
    if (Math.abs(steering) > 0.01) {
        // Adjust steering force based on speed
        // Stronger at low speeds, reduced at high speeds for stability
        const maxSteeringForce = 100;
        const minSteeringForce = 20;
        
        const speedFactor = Math.min(1, velMag / maxSpeedMs);
        const steeringForce = maxSteeringForce - (maxSteeringForce - minSteeringForce) * speedFactor;
        
        // Apply steering torque around Y axis
        const torque = { x: 0, y: steering * steeringForce, z: 0 };
        carBody.applyTorque(torque, true);
        
        // Apply counter-force for drift correction at high speeds
        if (velMag > 5) {
            // Calculate drift correction
            const rightDir = { 
                x: worldForward.z, 
                y: 0, 
                z: -worldForward.x 
            };
            
            // Project velocity onto right vector to measure lateral velocity
            const lateralVel = vel.x * rightDir.x + vel.z * rightDir.z;
            
            // Apply correction force perpendicular to forward direction
            const driftCorrection = -lateralVel * 0.1 * speedFactor;
            const correctionForce = {
                x: rightDir.x * driftCorrection,
                y: 0,
                z: rightDir.z * driftCorrection
            };
            
            carBody.applyForce(correctionForce, true);
        }
    }
}

// Export functions
window.rapierPhysics = {
    init: initRapierPhysics,
    createWorld: createRapierWorld,
    createCarPhysics: createCarPhysics,
    createGroundPlane: createGroundPlane,
    applyCarControls: applyCarControls
}; 