// Car model utility

/**
 * Creates a car model with specified parameters
 * @param {Object} options - Car configuration options
 * @returns {THREE.Group} - A Three.js group containing the car model
 */
function createCar(options = {}) {
    console.log('Creating car with options:', options);
    
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
        castShadow: true,       // Whether the car casts shadows
        ...options
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
        
        // Wheel positions
        const wheelPositions = [
            // Front left
            {
                x: -(config.width / 2) + (config.wheelThickness / 2),
                y: config.wheelRadius,
                z: (config.length / 3)
            },
            // Front right
            {
                x: (config.width / 2) - (config.wheelThickness / 2),
                y: config.wheelRadius,
                z: (config.length / 3)
            },
            // Rear left
            {
                x: -(config.width / 2) + (config.wheelThickness / 2),
                y: config.wheelRadius,
                z: -(config.length / 3)
            },
            // Rear right
            {
                x: (config.width / 2) - (config.wheelThickness / 2),
                y: config.wheelRadius,
                z: -(config.length / 3)
            }
        ];
        
        // Create each wheel and add to car
        wheelPositions.forEach((position, index) => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.rotation.z = Math.PI / 2; // Rotate to stand up
            wheel.position.set(position.x, position.y, position.z);
            
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
        
        console.log('Car created successfully');
        return carGroup;
    } catch (error) {
        console.error('Error creating car:', error);
        // Return a fallback simple car if there's an error
        try {
            // Simple fallback car
            const fallbackGroup = new THREE.Group();
            const fallbackBody = new THREE.Mesh(
                new THREE.BoxGeometry(2, 1, 4),
                new THREE.MeshStandardMaterial({ color: config.color || 0xff0000 })
            );
            fallbackBody.position.y = 0.5;
            fallbackGroup.add(fallbackBody);
            console.log('Created fallback car model');
            return fallbackGroup;
        } catch (fallbackError) {
            console.error('Failed to create fallback car:', fallbackError);
            throw new Error('Unable to create car model');
        }
    }
}

/**
 * Updates car physics based on controls
 * @param {Object} car - Car object with position, rotation, and velocity
 * @param {Object} controls - Control inputs (steering, acceleration, braking)
 * @param {Number} deltaTime - Time since last update in seconds
 */
function updateCarPhysics(car, controls, deltaTime = 1/60) {
    if (!car || !controls) {
        console.warn('Invalid car or controls object in updateCarPhysics');
        return 0;
    }
    
    try {
        // Physics constants
        const maxSpeed = 30; // Units per second
        const acceleration = 20; // Units per second squared
        const deceleration = 10; // Natural friction/drag
        const brakeForce = 30; // Braking force
        const turnSpeed = 2.5; // Turning rate
        
        // Calculate forward vector based on current rotation
        const forwardX = Math.sin(car.rotation.y);
        const forwardZ = Math.cos(car.rotation.y);
        
        // Calculate current speed
        const currentSpeed = Math.sqrt(
            car.velocity.x * car.velocity.x + 
            car.velocity.z * car.velocity.z
        );
        
        // Update speed based on acceleration/braking
        let newSpeed = currentSpeed;
        
        if (controls.acceleration > 0) {
            // Accelerate
            newSpeed += acceleration * controls.acceleration * deltaTime;
        } else if (controls.braking > 0) {
            // Apply brakes
            newSpeed -= brakeForce * controls.braking * deltaTime;
        } else {
            // Natural deceleration
            newSpeed -= deceleration * deltaTime;
        }
        
        // Clamp speed
        newSpeed = Math.max(0, Math.min(newSpeed, maxSpeed));
        
        // If almost stopped, just stop
        if (newSpeed < 0.1) {
            newSpeed = 0;
        }
        
        // Update rotation based on steering (only if moving)
        if (newSpeed > 0.5) {
            // Steering effect is proportional to speed, with reduced effect at high speeds
            const steeringFactor = Math.min(1, newSpeed / (maxSpeed * 0.5));
            car.rotation.y += turnSpeed * controls.steering * steeringFactor * deltaTime;
        }
        
        // Calculate new velocity vector
        if (newSpeed > 0) {
            car.velocity.x = forwardX * newSpeed;
            car.velocity.z = -forwardZ * newSpeed;
        } else {
            car.velocity.x = 0;
            car.velocity.z = 0;
        }
        
        // Update position
        car.position.x += car.velocity.x * deltaTime;
        car.position.z += car.velocity.z * deltaTime;
        
        // Return current speed for UI display
        return newSpeed;
    } catch (error) {
        console.error('Error in updateCarPhysics:', error);
        return 0;
    }
} 