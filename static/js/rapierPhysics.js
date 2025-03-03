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
    
    try {
        console.log('Creating car physics body with Rapier API version check');
        
        // Create a rigid body for the car
        let rigidBodyDesc;
        
        // First create the basic rigid body description
        rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.1)     // Reduced from 0.5 for less air resistance
            .setAngularDamping(0.8)     // Keep this to prevent excessive spinning
            .setAdditionalMass(1000.0); // Set explicit mass in kg
        
        const carBody = world.createRigidBody(rigidBodyDesc);
        
        // Create a collider for the car (box shape)
        const colliderDesc = RAPIER.ColliderDesc.cuboid(width/2, height/2, length/2)
            .setRestitution(0.2)     // Slightly bouncy
            .setFriction(1.0)        // High friction for better traction
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
        
        // Create the collider attached to the rigid body
        world.createCollider(colliderDesc, carBody);
        
        // Wake up the body to ensure it's active
        if (typeof carBody.wakeUp === 'function') {
            carBody.wakeUp();
        }
        
        console.log("Created car physics body successfully");
        
        return carBody;
    } catch (error) {
        console.error("Error creating car physics body:", error);
        return null;
    }
}

// Create a ground plane
function createGroundPlane(world) {
    if (!RAPIER || !world) {
        console.error('Rapier world not initialized');
        return null;
    }
    
    try {
        console.log('Creating ground plane with Rapier API version check');
        
        // Create a static rigid body for the ground
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const groundBody = world.createRigidBody(groundBodyDesc);
        
        // Create a collider for the ground (large cuboid)
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
        
        // Set friction if the method exists
        if (typeof groundColliderDesc.setFriction === 'function') {
            groundColliderDesc.setFriction(0.7);
        }
        
        world.createCollider(groundColliderDesc, groundBody);
        
        console.log('Ground plane created successfully');
        return groundBody;
    } catch (error) {
        console.error('Error creating ground plane:', error);
        console.error('Rapier API available:', Object.keys(RAPIER));
        if (RAPIER.ColliderDesc) {
            console.log('Available ColliderDesc methods:', 
                Object.getOwnPropertyNames(RAPIER.ColliderDesc.prototype));
        }
        return null;
    }
}

// Apply forces to a car body based on controls
function applyCarControls(carBody, controls) {
    if (!carBody) return;
    
    try {
        const { steering, acceleration, braking } = controls;
        
        // Check if required methods exist
        if (typeof carBody.rotation !== 'function' || typeof carBody.linvel !== 'function') {
            console.warn('Car body missing required methods for physics control');
            return;
        }
        
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
        
        // SPEED LIMITING - only if setLinvel method exists
        if (velMag > 0.1 && typeof carBody.setLinvel === 'function') {
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
        
        // Apply forces based on controls - only if applyForce method exists
        if (typeof carBody.applyForce === 'function') {
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
            
            // Apply steering torque - only if applyTorque method exists
            if (Math.abs(steering) > 0.01 && typeof carBody.applyTorque === 'function') {
                // Adjust steering force based on speed
                // Stronger at low speeds, reduced at high speeds for stability
                const maxSteeringForce = 100;
                const minSteeringForce = 20;
                
                const speedFactor = Math.min(1, velMag / maxSpeedMs);
                const steeringForce = maxSteeringForce - (maxSteeringForce - minSteeringForce) * speedFactor;
                
                // Apply steering torque around Y axis
                const torque = { x: 0, y: steering * steeringForce, z: 0 };
                carBody.applyTorque(torque, true);
            }
        }
    } catch (error) {
        console.error('Error applying car controls:', error);
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