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
            .setLinearDamping(1.5)     // Increased from 0.1 for more drag
            .setAngularDamping(0.9)     // Increased from 0.8 for less spinning
            .setAdditionalMass(1500.0); // Increased mass for more stability
        
        const carBody = world.createRigidBody(rigidBodyDesc);
        carBody.enableCcd(true);
        
        // Create a collider for the car (box shape)
        const colliderDesc = RAPIER.ColliderDesc.cuboid(width/2, height/2, length/2)
            .setRestitution(0.1) 
            .setFriction(1)        
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max); // Changed to average
        
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
function applyCarControls(carBody, controls, playerId) {
    if (!carBody) return;
    
    try {
        const { steering, acceleration, braking } = controls;
        
        // Check if required methods exist
        if (typeof carBody.rotation !== 'function' || typeof carBody.linvel !== 'function') {
            console.warn('Car body missing required methods for physics control');
            return;
        }
        
        // More frequent debug logging of control application
        // Log every time there are significant controls to apply
        const hasSignificantControls = 
            Math.abs(steering) > 0.1 || 
            acceleration > 0.1 || 
            braking > 0.1;
            
        if (hasSignificantControls || Math.random() < 0.05) {
            const playerInfo = playerId ? `for player ${playerId}` : '';
            console.log(`🚀 PHYSICS: Applying controls ${playerInfo}: steering=${steering.toFixed(2)}, accel=${acceleration.toFixed(2)}, brake=${braking.toFixed(2)}`);
        }
        
        // Get forward direction in world space
        const rotation = carBody.rotation();
        const forwardDir = { x: 0, y: 0, z: -1 };
        
        // Apply rotation to get world forward direction
        const worldForward = { x: 0, y: 0, z: 0 };
        const q = rotation;
        
        // Transform direction vector by quaternion (q v q*)
        worldForward.x = (1 - 2 * (q.y * q.y + q.z * q.z)) * forwardDir.x + 
                        2 * (q.x * q.y - q.w * q.z) * forwardDir.y + 
                        2 * (q.x * q.z + q.w * q.y) * forwardDir.z;
        worldForward.y = 2 * (q.x * q.y + q.w * q.z) * forwardDir.x + 
                        (1 - 2 * (q.x * q.x + q.z * q.z)) * forwardDir.y + 
                        2 * (q.y * q.z - q.w * q.x) * forwardDir.z;
        worldForward.z = 2 * (q.x * q.z - q.w * q.y) * forwardDir.x + 
                        2 * (q.y * q.z + q.w * q.x) * forwardDir.y + 
                        (1 - 2 * (q.x * q.x + q.y * q.y)) * forwardDir.z;
        
        // Normalize the vector
        const len = Math.sqrt(worldForward.x * worldForward.x + worldForward.y * worldForward.y + worldForward.z * worldForward.z);
        if (len > 0) {
            worldForward.x /= len;
            worldForward.y /= len;
            worldForward.z /= len;
        }
        
        // Speed constants (in m/s)
        const maxSpeedKmh = 50;  // Reduced from 100
        const reverseMaxSpeedKmh = 25; // Reduced from 50
        const maxSpeedMs = maxSpeedKmh / 3.6;
        const reverseMaxSpeedMs = reverseMaxSpeedKmh / 3.6;
        
        // Get current velocity
        const vel = carBody.linvel();
        const velMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        
        // Calculate speed in km/h for display/debugging
        const speedKmh = velMag * 3.6;
        
        // Determine if we're moving forward or backward
        const dotProduct = worldForward.x * vel.x + worldForward.z * vel.z;
        const isMovingForward = dotProduct >= 0;
        
        // Apply forces based on controls
        if (typeof carBody.addForce === 'function') {
            console.log('Adding forces to car', playerId);
            // Reduced force for more controlled acceleration
            const maxForce = 3000; // Reduced from 15000
            
            if (acceleration > 0) {
                // Calculate force based on current speed with more gradual acceleration
                const speedFactor = Math.max(0.2, 1 - (speedKmh / maxSpeedKmh));
                const appliedForce = maxForce * acceleration * speedFactor * 0.7; // Added 0.7 multiplier
                
                // Apply force in world forward direction
                const force = {
                    x: worldForward.x * appliedForce,
                    y: 0,
                    z: worldForward.z * appliedForce
                };
                
                carBody.addForce(force, true);
                
                // Log force application with distinctive marker for easier log scanning
                if (Math.random() < 0.05 || acceleration > 0.5) {
                    console.log(`🔥 PHYSICS FORCE: Applied forward force: ${appliedForce.toFixed(2)}N, speed: ${speedKmh.toFixed(1)} km/h, direction: (${worldForward.x.toFixed(2)}, ${worldForward.z.toFixed(2)})`);
                }
            }
            
            // Apply braking/reverse with more controlled forces
            if (braking > 0) {
                const brakeForce = 3000; // Reduced from 8000
                
                if (isMovingForward && velMag > 0.1) {
                    // Apply brake force opposite to velocity
                    const force = {
                        x: -vel.x / velMag * brakeForce * braking,
                        y: 0,
                        z: -vel.z / velMag * brakeForce * braking
                    };
                    carBody.addForce(force, true);
                    
                    // Log braking with distinctive marker
                    if (Math.random() < 0.05 || braking > 0.5) {
                        console.log(`🛑 PHYSICS BRAKE: Applied braking force: ${(brakeForce * braking).toFixed(2)}N`);
                    }
                } else if (speedKmh < reverseMaxSpeedKmh) {
                    // Apply reverse force with more controlled magnitude
                    const force = {
                        x: -worldForward.x * maxForce * 0.5 * braking, // Reduced multiplier from 0.8
                        y: 0,
                        z: -worldForward.z * maxForce * 0.5 * braking
                    };
                    carBody.addForce(force, true);
                    
                    // Log reverse with distinctive marker
                    if (Math.random() < 0.05 || braking > 0.5) {
                        console.log(`⏪ PHYSICS REVERSE: Applied reverse force: ${(maxForce * 0.5 * braking).toFixed(2)}N`);
                    }
                }
            }
            
            // Apply steering torque with more controlled forces
            if (Math.abs(steering) > 0.01 && typeof carBody.addTorque === 'function') {
                // Reduced steering forces for better control
                const maxSteeringForce = 200;  // Reduced from 500
                const minSteeringForce = 10;   // Reduced from 100
                
                // Adjust steering based on speed - more responsive at low speeds
                const speedFactor = Math.min(1, velMag / maxSpeedMs);
                const steeringForce = maxSteeringForce - (maxSteeringForce - minSteeringForce) * speedFactor;
                
                const torque = { x: 0, y: steering * steeringForce, z: 0 };
                carBody.addTorque(torque, true);
                
                // Log steering with distinctive marker
                if (Math.random() < 0.05 || Math.abs(steering) > 0.5) {
                    console.log(`🔄 PHYSICS STEERING: Applied steering torque: ${(steering * steeringForce).toFixed(2)}, speed factor: ${speedFactor.toFixed(2)}`);
                }
            }
        }
        
        // Wake up the body when forces are applied
        if (typeof carBody.wakeUp === 'function') {
            carBody.wakeUp();
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