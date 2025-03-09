// Car model utility
import * as THREE from 'three';

/**
 * Creates a car model with specified parameters
 * @param {Object} options - Car configuration options
 * @returns {THREE.Group} - A Three.js group containing the car model
 */
export function createCar(options = {}) {
    // No logging at all - remove debug flag checking
    
    // Default options
    const config = {
        color: 0xff0000,        // Car body color
        roofColor: 0x333333,    // Car roof color
        wheelColor: 0x111111,   // Wheel color
        length: 4,              // Car length
        width: 2,               // Car width
        height: 1,              // Car body height
        wheelRadius: 0.5,       // Wheel radius
        wheelThickness: 0.4,    // Wheel thickness
        ...options.dimensions,  // Override with provided dimensions
        ...options              // Override with any other options
    };
    
    try {
        // Create a group to hold all car parts
        const carGroup = new THREE.Group();
        
        // Create car body
        const bodyGeometry = new THREE.BoxGeometry(
            config.width, 
            config.height, 
            config.length
        );
        const bodyMaterial = new THREE.MeshStandardMaterial({ 
            color: config.color,
            roughness: 0.5
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = config.height / 2;
        
        if (config.castShadow) {
            body.castShadow = true;
        }
        
        carGroup.add(body);
        
        // Create car roof (cabin)
        const roofWidth = config.width * 0.75;
        const roofHeight = config.height * 0.7;
        const roofLength = config.length * 0.5;
        
        const roofGeometry = new THREE.BoxGeometry(
            roofWidth, 
            roofHeight, 
            roofLength
        );
        const roofMaterial = new THREE.MeshStandardMaterial({ 
            color: config.roofColor,
            roughness: 0.7
        });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = config.height + (roofHeight / 2);
        roof.position.z = -(config.length * 0.05); // Slightly to the back
        
        if (config.castShadow) {
            roof.castShadow = true;
        }
        
        carGroup.add(roof);
        
        // Create wheels
        const wheelGeometry = new THREE.CylinderGeometry(
            config.wheelRadius,
            config.wheelRadius,
            config.wheelThickness,
            16
        );
        const wheelMaterial = new THREE.MeshStandardMaterial({ 
            color: config.wheelColor,
            roughness: 0.8
        });


        const wheel_protrusion = 0.1;
        
        // Wheel positions
        const wheelPositions = [
            // Front left
            {
                x: -(config.width / 2) + (config.wheelThickness / 2 - wheel_protrusion),
                y: -0.1, // Position at the bottom of the car with slight overlap
                z: (config.length / 3)
            },
            // Front right
            {
                x: (config.width / 2) - (config.wheelThickness / 2 - wheel_protrusion),
                y: -0.1, // Position at the bottom of the car with slight overlap
                z: (config.length / 3)
            },
            // Rear left
            {
                x: -(config.width / 2) + (config.wheelThickness / 2 - wheel_protrusion),
                y: -0.1, // Position at the bottom of the car with slight overlap
                z: -(config.length / 3)
            },
            // Rear right
            {
                x: (config.width / 2) - (config.wheelThickness / 2 - wheel_protrusion),
                y: -0.1, // Position at the bottom of the car with slight overlap
                z: -(config.length / 3)
            }
        ];

        console.log("Wheel positions:", wheelPositions);
        
        // Create each wheel and add to car
        wheelPositions.forEach((position, index) => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);

            wheel.position.set(position.x, position.y, position.z);

            wheel.rotateZ(Math.PI/2);
            //wheel.rotation.z = ;
            //wheel.rotation.x = Math.PI;
            //wheel.rotation.y = Math.PI/2;

            if (config.castShadow) {
                wheel.castShadow = true;
            }
            
            carGroup.add(wheel);
        });
        
        // Add headlights
        const headlightGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const headlightMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xffffcc,
            emissive: 0xffffcc,
            emissiveIntensity: 0.5
        });
        
        // Left headlight
        const leftHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
        leftHeadlight.position.set(
            -(config.width / 3),
            config.height / 2,
            (config.length / 2) - 0.1
        );
        carGroup.add(leftHeadlight);
        
        // Right headlight
        const rightHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
        rightHeadlight.position.set(
            (config.width / 3),
            config.height / 2,
            (config.length / 2) - 0.1
        );
        carGroup.add(rightHeadlight);
        
        // Add tail lights
        const taillightMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.5
        });
        
        // Left tail light
        const leftTaillight = new THREE.Mesh(headlightGeometry, taillightMaterial);
        leftTaillight.position.set(
            -(config.width / 3),
            config.height / 2,
            -(config.length / 2) + 0.1
        );
        carGroup.add(leftTaillight);
        
        // Right tail light
        const rightTaillight = new THREE.Mesh(headlightGeometry, taillightMaterial);
        rightTaillight.position.set(
            (config.width / 3),
            config.height / 2,
            -(config.length / 2) + 0.1
        );
        carGroup.add(rightTaillight);
        
        return carGroup;
    } catch (error) {
        // Create a simple fallback car without any logging
        try {
            const fallbackGroup = new THREE.Group();
            const fallbackBody = new THREE.Mesh(
                new THREE.BoxGeometry(2, 1, 4),
                new THREE.MeshStandardMaterial({ color: config.color || 0xff0000 })
            );
            fallbackBody.position.y = 0.5;
            fallbackGroup.add(fallbackBody);
            return fallbackGroup;
        } catch (fallbackError) {
            // No logging here either
            throw new Error('Unable to create car model');
        }
    }
}

/**
 * Updates car physics based on controls
 * @param {Object} car - The car object
 * @param {Object} controls - Control inputs
 * @param {Number} deltaTime - Time step
 */
export function updateCarPhysics(car, controls, deltaTime = 1/60) {
    if (!car || !controls) {
        return 0;
    }
    
    try {
        // Physics constants
        const maxSpeed = 30; // Units per second
        const acceleration = 20; // Units per second squared
        const deceleration = 10; // Natural friction/drag
        const brakeForce = 30; // Braking force
        const turnSpeed = 3.0; // Turning rate
        
        // Get car's local axes
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
        
        // Calculate current speed (magnitude of velocity)
        const currentSpeed = Math.sqrt(
            car.velocity.x * car.velocity.x + 
            car.velocity.z * car.velocity.z
        );
        
        // Calculate acceleration force
        let accelerationForce = 0;
        
        if (controls.acceleration > 0) {
            // Apply acceleration, reduced at higher speeds
            const accelFactor = 1 - (currentSpeed / maxSpeed) * 0.7;
            accelerationForce = acceleration * controls.acceleration * accelFactor;
        } else if (controls.braking > 0) {
            // Apply brakes, more effective at higher speeds
            const brakeFactor = 1 + (currentSpeed / maxSpeed) * 0.5;
            accelerationForce = -brakeForce * controls.braking * brakeFactor;
        }
        
        // Apply natural deceleration (drag)
        const dragForce = currentSpeed > 0 ? -deceleration * (currentSpeed / maxSpeed) : 0;
        const totalForce = accelerationForce + dragForce;
        
        // Calculate new speed and clamp it
        let newSpeed = currentSpeed + totalForce * deltaTime;
        newSpeed = Math.max(0, Math.min(newSpeed, maxSpeed));
        
        // If almost stopped, just stop
        if (newSpeed < 0.1) {
            newSpeed = 0;
            car.velocity.set(0, 0, 0);
        } else {
            // Update velocity in car's forward direction
            car.velocity.copy(forward).multiplyScalar(newSpeed);
        }
        
        // Apply steering to rotation
        if (newSpeed > 0.5) {
            // Get the Rapier physics body for this car
            const carPhysicsBody = world.getRigidBody(car.physicsId);
            if (!carPhysicsBody) {
                console.error('Could not find physics body for car');
                return;
            }

            // Get velocity and position from Rapier physics
            const physicsVelocity = carPhysicsBody.linvel();
            const physicsRotation = carPhysicsBody.rotation();

            // Update Three.js car model position and rotation to match physics
            car.position.set(
                carPhysicsBody.translation().x,
                carPhysicsBody.translation().y, 
                carPhysicsBody.translation().z
            );

            // Calculate rotation from physics velocity direction
            const velocityDirection = new THREE.Vector3(physicsVelocity.x, 0, physicsVelocity.z).normalize();
            const targetRotation = Math.atan2(velocityDirection.x, -velocityDirection.z);
            
            // Smoothly interpolate to target rotation
            const rotationLerpFactor = 0.1;
            car.rotation.y = THREE.MathUtils.lerp(
                car.rotation.y,
                targetRotation,
                rotationLerpFactor
            );

            // Apply steering force to physics body
            const steeringFactor = Math.max(0.3, 1 - (newSpeed / maxSpeed) * 0.7);
            const steeringForce = right.multiplyScalar(controls.steering * steeringFactor * newSpeed);
            carPhysicsBody.applyImpulse({
                x: steeringForce.x,
                y: 0,
                z: steeringForce.z
            }, true);
        }
        // Update position based on velocity
        car.position.x += car.velocity.x * deltaTime;
        car.position.z += car.velocity.z * deltaTime;
        
        // Return current speed for UI display
        return newSpeed;
    } catch (error) {
        // No logging here to prevent stack issues
        return 0;
    }
}

// Export all functions as the default export
export default { createCar, updateCarPhysics }; 