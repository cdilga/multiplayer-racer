/**
 * Car Kinematic Character Controller
 * 
 * Simplified physics implementation using Rapier's Character Controller
 * for more predictable, arcade-style handling without complex suspension.
 */

// Car controller configuration defaults
const defaultConfig = {
    // Movement
    forwardSpeed: 10.0,
    reverseSpeed: 5.0,
    
    // Steering
    maxSteeringAngle: 0.6,      // In radians - about 35 degrees
    steeringSpeed: 0.3,         // How quickly steering responds
    steeringReturnSpeed: 0.2,   // How quickly steering returns to center
    
    // Character Controller specific
    characterOffset: 0.1,       // Gap between character and environment
    maxSlopeClimbAngle: 0.8,    // Max slope angle in radians (about 45 degrees)
    minSlopeSlideAngle: 0.9,    // Min slope angle for sliding in radians (about 50 degrees)
    
    // Gravity and autostep
    gravity: -9.8,              // Gravity force
    autostep: {
        maxHeight: 0.3,         // Max step height
        minWidth: 0.1,          // Min step width
        includeDynamicBodies: false
    },
    
    // Debug
    enableDebugLogging: false
};

// Helper for clean debug logging
function debugLog(config, ...args) {
    if (config && config.enableDebugLogging) {
        console.log(...args);
    }
}

/**
 * Creates a car kinematic character controller
 * @param {Object} world - Rapier physics world
 * @param {Object} position - Initial position {x, y, z}
 * @param {Object} dimensions - Car dimensions {width, height, length}
 * @param {Object} userConfig - Optional configuration overrides
 * @param {Object} rapier - Rapier physics instance
 * @returns {Object} The car body with controller attached
 */
function createCarController(world, position, dimensions, userConfig = {}, rapier) {
    if (!world) {
        console.error('Rapier world not initialized for character controller');
        return null;
    }
    
    if (!rapier) {
        console.error('Rapier instance not provided to createCarController');
        return null;
    }
    
    // Merge user config with defaults
    const config = { ...defaultConfig, ...userConfig };
    
    try {
        debugLog(config, 'Creating car kinematic character controller');
        
        // Create the character controller with offset
        const characterController = world.createCharacterController(config.characterOffset);
        
        // Setup character controller based on config
        characterController.setUp({ x: 0.0, y: 1.0, z: 0.0 }); // Y-up orientation
        characterController.setMaxSlopeClimbAngle(config.maxSlopeClimbAngle);
        characterController.setMinSlopeSlideAngle(config.minSlopeSlideAngle);
        
        // Configure autostep if needed
        if (config.autostep) {
            characterController.enableAutostep(
                config.autostep.maxHeight,
                config.autostep.minWidth,
                config.autostep.includeDynamicBodies
            );
        }
        
        // Create the rigid body for the car
        const { width, height, length } = dimensions;
        const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(position.x, position.y, position.z);
        
        const carBody = world.createRigidBody(bodyDesc);
        
        // Create collider for the car - use a cuboid (rectangular box) instead of capsule
        // Half-extents are half the dimensions in each direction
        const halfWidth = width * 0.5;
        const halfHeight = height * 0.5;
        const halfLength = length * 0.5;
        
        const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
            .setTranslation(0, halfHeight, 0);  // Lift box so bottom is at y=0
        
        world.createCollider(colliderDesc, carBody);
        
        // Store car state in userData
        carBody.userData = {
            // Controller reference
            characterController,
            
            // Configuration
            config,
            
            // Movement state
            currentSpeed: 0,
            isGrounded: true,
            velocity: { x: 0, y: 0, z: 0 },
            
            // Controls state
            controls: {
                steering: 0,
                acceleration: 0,
                braking: 0
            },
            
            // Current orientation
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            
            // Store dimensions for reference
            dimensions: { width, height, length }
        };
        
        debugLog(config, "Created car kinematic controller successfully");
        return carBody;
    } catch (error) {
        console.error('Error creating car kinematic controller:', error);
        return null;
    }
}

/**
 * Update the car controller with current controls
 * 
 * @param {Object} carBody - The car body with the character controller
 * @param {Object} controls - {steering, acceleration, braking} each normalized to -1..1
 * @param {number} deltaTime - Time since last update in seconds
 */
function updateCarController(carBody, controls, deltaTime = 1/60) {
    if (!carBody || !carBody.userData || !carBody.userData.characterController) {
        return;
    }
    
    // Ensure deltaTime is valid
    if (!isFinite(deltaTime) || deltaTime <= 0) {
        console.warn("Invalid deltaTime:", deltaTime);
        deltaTime = 1/60; // Use default value
    }
    
    const userData = carBody.userData;
    const controller = userData.characterController;
    const config = userData.config;
    
    // Extract controls safely with defaults
    const steering = isFinite(controls?.steering) ? controls.steering : 0;
    const acceleration = isFinite(controls?.acceleration) ? controls.acceleration : 0;
    const braking = isFinite(controls?.braking) ? controls.braking : 0;
    
    // Store current controls
    userData.controls = { steering, acceleration, braking };
    
    // Calculate orientation changes based on steering
    const targetSteeringAngle = steering * config.maxSteeringAngle;
    const currentRotation = userData.rotation || { x: 0, y: 0, z: 0, w: 1 };
    
    // Update steering based on input
    const steeringDelta = targetSteeringAngle - userData.controls.steering;
    userData.controls.steering += steeringDelta * config.steeringSpeed * deltaTime * 60; // Normalize for 60fps
    
    // Calculate velocity based on acceleration/braking
    let targetSpeed = 0;
    
    // Make sure we're using the latest config values
    const forwardSpeed = config.forwardSpeed || defaultConfig.forwardSpeed;
    const reverseSpeed = config.reverseSpeed || defaultConfig.reverseSpeed;
    
    if (acceleration > 0.1) {
        // Forward movement
        targetSpeed = acceleration * forwardSpeed;
    } else if (braking > 0.1) {
        // Reverse movement
        targetSpeed = -braking * reverseSpeed;
    }
    
    // Apply gravity 
    let verticalVelocity = isFinite(userData.velocity?.y) ? userData.velocity.y : 0;
    verticalVelocity += config.gravity * deltaTime;
    
    // Check if on ground
    const isGrounded = verticalVelocity <= 0;
    
    // If on ground, reset vertical velocity
    if (isGrounded) {
        verticalVelocity = 0;
    }
    
    // Calculate forward vector based on current rotation
    let forwardDir = {
        x: 2 * (currentRotation.x * currentRotation.z + currentRotation.w * currentRotation.y),
        y: 0,
        z: 1 - 2 * (currentRotation.x * currentRotation.x + currentRotation.y * currentRotation.y)
    };
    
    // Check for NaN values in forward direction
    if (!isFinite(forwardDir.x) || !isFinite(forwardDir.z)) {
        console.warn("Invalid forward direction, resetting to default");
        forwardDir = { x: 0, y: 0, z: 1 };
    }
    
    // Normalize forward direction
    const forwardLength = Math.sqrt(forwardDir.x * forwardDir.x + forwardDir.z * forwardDir.z);
    if (forwardLength > 0) {
        forwardDir.x /= forwardLength;
        forwardDir.z /= forwardLength;
    } else {
        // Avoid division by zero
        forwardDir = { x: 0, y: 0, z: 1 };
    }
    
    // Calculate new rotation based on steering
    const rotationSpeed = userData.currentSpeed * userData.controls.steering * deltaTime;
    
    // Check for NaN in rotation speed
    if (isFinite(rotationSpeed)) {
        const cosAngle = Math.cos(rotationSpeed);
        const sinAngle = Math.sin(rotationSpeed);
        
        // Rotate the forward direction
        const newForwardX = forwardDir.x * cosAngle - forwardDir.z * sinAngle;
        const newForwardZ = forwardDir.x * sinAngle + forwardDir.z * cosAngle;
        
        forwardDir.x = newForwardX;
        forwardDir.z = newForwardZ;
    }
    
    // Create quaternion from the forward direction
    const upVector = { x: 0, y: 1, z: 0 };
    const rightVector = {
        x: forwardDir.z,
        y: 0,
        z: -forwardDir.x
    };
    
    // Create rotation quaternion from basis vectors
    const newRotation = quaternionFromBasis(rightVector, upVector, forwardDir);
    
    // Check for NaN values in the new rotation
    if (isFinite(newRotation.x) && isFinite(newRotation.y) && 
        isFinite(newRotation.z) && isFinite(newRotation.w)) {
        // Update the car's rotation
        userData.rotation = newRotation;
    } else {
        console.warn("Invalid rotation calculated, keeping previous rotation");
    }
    
    // Update speed with smoothed interpolation
    userData.currentSpeed = isFinite(userData.currentSpeed) ? 
        userData.currentSpeed * 0.9 + targetSpeed * 0.1 : 
        targetSpeed;
    
    // Calculate movement vector
    const movement = {
        x: forwardDir.x * userData.currentSpeed * deltaTime,
        y: verticalVelocity * deltaTime,
        z: forwardDir.z * userData.currentSpeed * deltaTime
    };
    
    // Check for NaN values in movement
    if (!isFinite(movement.x) || !isFinite(movement.y) || !isFinite(movement.z)) {
        console.warn("Invalid movement calculated:", movement);
        return; // Skip this update
    }
    
    // Store velocity for later use
    userData.velocity = {
        x: movement.x / deltaTime,
        y: movement.y / deltaTime,
        z: movement.z / deltaTime
    };
    
    try {
        // Apply movement via character controller
        controller.computeColliderMovement(
            carBody.collider(0), // Use the first collider
            { x: movement.x, y: 0, z: movement.z } // XZ movement only
        );
        
        // Get the computed displacement that accounts for collisions
        const correctedMovement = controller.computedMovement();
        
        // Check for NaN values in corrected movement
        if (!isFinite(correctedMovement.x) || !isFinite(correctedMovement.y) || !isFinite(correctedMovement.z)) {
            console.warn("Invalid corrected movement:", correctedMovement);
            return; // Skip this update
        }
        
        // Apply corrected movement to the rigid body
        const currentPos = carBody.translation();
        
        // Check for NaN values in current position
        if (!isFinite(currentPos.x) || !isFinite(currentPos.y) || !isFinite(currentPos.z)) {
            console.warn("Invalid current position:", currentPos);
            return; // Skip this update
        }
        
        carBody.setNextKinematicTranslation({
            x: currentPos.x + correctedMovement.x,
            y: currentPos.y + movement.y, // Apply vertical movement directly
            z: currentPos.z + correctedMovement.z
        });
        
        // Apply rotation
        carBody.setNextKinematicRotation(newRotation);
    } catch (error) {
        console.error("Error in character controller update:", error);
    }
}

/**
 * Create quaternion from basis vectors
 */
function quaternionFromBasis(right, up, forward) {
    // Check for invalid input vectors
    if (!right || !up || !forward || 
        !isFinite(right.x) || !isFinite(right.y) || !isFinite(right.z) ||
        !isFinite(up.x) || !isFinite(up.y) || !isFinite(up.z) ||
        !isFinite(forward.x) || !isFinite(forward.y) || !isFinite(forward.z)) {
        console.warn("Invalid basis vectors for quaternion calculation");
        return { x: 0, y: 0, z: 0, w: 1 }; // Return identity quaternion
    }
    
    // Create rotation matrix from basis vectors
    const m00 = right.x;
    const m01 = up.x;
    const m02 = forward.x;
    const m10 = right.y;
    const m11 = up.y;
    const m12 = forward.y;
    const m20 = right.z;
    const m21 = up.z;
    const m22 = forward.z;
    
    // Algorithm from http://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToQuaternion/
    const trace = m00 + m11 + m22;
    let newRotation = { x: 0, y: 0, z: 0, w: 1 };
    
    try {
        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            newRotation.w = 0.25 / s;
            newRotation.x = (m21 - m12) * s;
            newRotation.y = (m02 - m20) * s;
            newRotation.z = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
            newRotation.w = (m21 - m12) / s;
            newRotation.x = 0.25 * s;
            newRotation.y = (m01 + m10) / s;
            newRotation.z = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
            newRotation.w = (m02 - m20) / s;
            newRotation.x = (m01 + m10) / s;
            newRotation.y = 0.25 * s;
            newRotation.z = (m12 + m21) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
            newRotation.w = (m10 - m01) / s;
            newRotation.x = (m02 + m20) / s;
            newRotation.y = (m12 + m21) / s;
            newRotation.z = 0.25 * s;
        }
        
        // Check for NaN values in the result
        if (!isFinite(newRotation.x) || !isFinite(newRotation.y) || 
            !isFinite(newRotation.z) || !isFinite(newRotation.w)) {
            console.warn("NaN values in quaternion calculation result");
            return { x: 0, y: 0, z: 0, w: 1 }; // Return identity quaternion
        }
        
        // Normalize the quaternion
        const magnitude = Math.sqrt(
            newRotation.x * newRotation.x + 
            newRotation.y * newRotation.y + 
            newRotation.z * newRotation.z + 
            newRotation.w * newRotation.w
        );
        
        if (magnitude > 0) {
            newRotation.x /= magnitude;
            newRotation.y /= magnitude;
            newRotation.z /= magnitude;
            newRotation.w /= magnitude;
        } else {
            // If magnitude is zero, return identity quaternion
            return { x: 0, y: 0, z: 0, w: 1 };
        }
        
        return newRotation;
    } catch (error) {
        console.error("Error in quaternion calculation:", error);
        return { x: 0, y: 0, z: 0, w: 1 }; // Return identity quaternion
    }
}

/**
 * Sync the visual model with the physics body
 * 
 * @param {Object} carBody - The car rigid body
 * @param {Object} carMesh - The Three.js mesh for the car
 * @param {Array} wheelMeshes - Array of wheel meshes [frontLeft, frontRight, rearLeft, rearRight]
 */
function syncCarModelWithKinematics(carBody, carMesh, wheelMeshes = []) {
    if (!carBody || !carMesh) return;
    
    try {
        // Update position
        const position = carBody.translation();
        
        // Check for NaN values in position
        if (position && isFinite(position.x) && isFinite(position.y) && isFinite(position.z)) {
            carMesh.position.set(position.x, position.y, position.z);
        } else {
            console.warn("Invalid position values detected:", position);
        }
        
        // Update rotation from userData (more up-to-date than the physics body during interpolation)
        const rotation = carBody.userData?.rotation || carBody.rotation();
        
        // Check for NaN values in rotation
        if (rotation && 
            isFinite(rotation.x) && 
            isFinite(rotation.y) && 
            isFinite(rotation.z) && 
            isFinite(rotation.w)) {
            
            // Normalize the quaternion to prevent issues
            const magnitude = Math.sqrt(
                rotation.x * rotation.x + 
                rotation.y * rotation.y + 
                rotation.z * rotation.z + 
                rotation.w * rotation.w
            );
            
            if (magnitude > 0) {
                carMesh.quaternion.set(
                    rotation.x / magnitude, 
                    rotation.y / magnitude, 
                    rotation.z / magnitude, 
                    rotation.w / magnitude
                );
            }
        } else {
            console.warn("Invalid rotation values detected:", rotation);
        }
        
        // Update wheels if present
        if (wheelMeshes && wheelMeshes.length > 0) {
            const steering = carBody.userData?.controls?.steering || 0;
            if (isFinite(steering)) {
                const steeringAngle = steering * (carBody.userData?.config?.maxSteeringAngle || 0.6);
                
                // Front wheels - apply steering
                if (wheelMeshes[0]) {
                    wheelMeshes[0].rotation.y = steeringAngle;
                }
                if (wheelMeshes[1]) {
                    wheelMeshes[1].rotation.y = steeringAngle;
                }
            }
            
            // Animate wheel rotation based on speed
            const speed = carBody.userData?.currentSpeed || 0;
            if (isFinite(speed)) {
                const wheelRotationSpeed = speed * 0.3; // Scale factor
                
                wheelMeshes.forEach(wheel => {
                    if (wheel) {
                        // Add rotation around X axis for wheel spinning
                        wheel.rotation.x += wheelRotationSpeed;
                    }
                });
            }
        }
    } catch (error) {
        console.error("Error syncing car model with kinematics:", error);
    }
}

/**
 * Update the car's dimensions at runtime
 * 
 * @param {Object} carBody - The car rigid body
 * @param {Object} dimensions - New dimensions {width, height, length}
 * @param {Object} world - Rapier physics world
 * @param {Object} rapier - Rapier physics instance
 * @returns {boolean} Success status
 */
function updateCarDimensions(carBody, dimensions, world, rapier) {
    if (!carBody || !dimensions || !world || !rapier) {
        console.error('Missing required parameters for updateCarDimensions');
        return false;
    }
    
    try {
        // Get current position and rotation
        const position = carBody.translation();
        const rotation = carBody.rotation();
        
        // Store current userData
        const userData = carBody.userData;
        
        // Remove existing collider
        if (carBody.numColliders() > 0) {
            world.removeCollider(carBody.collider(0), true);
        }
        
        // Create new collider with updated dimensions
        const { width, height, length } = dimensions;
        
        // Half-extents are half the dimensions in each direction
        const halfWidth = width * 0.5;
        const halfHeight = height * 0.5;
        const halfLength = length * 0.5;
        
        const colliderDesc = rapier.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
            .setTranslation(0, halfHeight, 0);  // Lift box so bottom is at y=0
        
        world.createCollider(colliderDesc, carBody);
        
        // Update dimensions in userData
        if (userData) {
            userData.dimensions = { width, height, length };
        }
        
        debugLog(userData?.config, "Updated car dimensions successfully");
        return true;
    } catch (error) {
        console.error('Error updating car dimensions:', error);
        return false;
    }
}

/**
 * Update the car's movement parameters at runtime
 * 
 * @param {Object} carBody - The car rigid body
 * @param {string} param - Parameter name to update
 * @param {number} value - New value for the parameter
 * @returns {boolean} Success status
 */
function updateCarMovementParams(carBody, param, value) {
    if (!carBody || !carBody.userData || !carBody.userData.config) {
        console.error('Invalid car body or missing config for updateCarMovementParams');
        return false;
    }
    
    try {
        const config = carBody.userData.config;
        
        // Log the current value
        console.log(`Updating car movement parameter ${param} from ${config[param]} to ${value}`);
        
        // Update the specific parameter
        switch (param) {
            case 'forwardSpeed':
                config.forwardSpeed = value;
                break;
            case 'reverseSpeed':
                config.reverseSpeed = value;
                break;
            case 'maxSteeringAngle':
                // Convert from degrees to radians if the input is in degrees
                if (value > 1.0) {
                    config.maxSteeringAngle = value * (Math.PI / 180);
                } else {
                    config.maxSteeringAngle = value;
                }
                break;
            case 'steeringSpeed':
                config.steeringSpeed = value;
                break;
            case 'steeringReturnSpeed':
                config.steeringReturnSpeed = value;
                break;
            case 'gravity':
                config.gravity = value;
                break;
            default:
                console.warn(`Unknown movement parameter: ${param}`);
                return false;
        }
        
        // Log the updated config
        console.log('Updated car config:', {
            forwardSpeed: config.forwardSpeed,
            reverseSpeed: config.reverseSpeed,
            maxSteeringAngle: config.maxSteeringAngle,
            steeringSpeed: config.steeringSpeed,
            steeringReturnSpeed: config.steeringReturnSpeed,
            gravity: config.gravity
        });
        
        debugLog(config, `Updated car movement parameter ${param} to ${value}`);
        return true;
    } catch (error) {
        console.error('Error updating car movement parameters:', error);
        return false;
    }
}

// Export as default
export default {
    createCarController,
    updateCarController,
    syncCarModelWithKinematics,
    updateCarDimensions,
    updateCarMovementParams
}; 