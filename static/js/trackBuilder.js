// Track builder utility

/**
 * Creates a race track with specified parameters
 * @param {Object} options - Track configuration options
 * @returns {THREE.Group} - A Three.js group containing the track elements
 */
function buildTrack(options = {}) {
    console.log('buildTrack called with options:', options);
    
    // Default options
    const config = {
        trackWidth: 10,         // Width of the track
        trackLength: 100,       // Length for a straight track section
        trackShape: 'oval',     // oval, figure8, custom
        trackColor: 0x333333,   // Asphalt color
        groundColor: 0x1e824c,  // Grass color
        groundSize: 200,        // Size of the ground plane
        barrierHeight: 1,       // Height of track barriers
        barrierColor: 0xdddddd, // Color of barriers
        ...options
    };
    
    // Create a group to hold all track elements
    const track = new THREE.Group();
    
    // Add ground
    const groundGeometry = new THREE.PlaneGeometry(config.groundSize, config.groundSize);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: config.groundColor,
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    track.add(ground);
    
    // Create track based on shape
    switch (config.trackShape) {
        case 'oval':
            createOvalTrack(track, config);
            break;
        case 'figure8':
            createFigure8Track(track, config);
            break;
        default:
            createOvalTrack(track, config);
    }
    
    console.log('Track built successfully');
    return track;
}

/**
 * Creates an oval race track
 * @param {THREE.Group} parent - Parent group to add track to
 * @param {Object} config - Track configuration
 */
function createOvalTrack(parent, config) {
    console.log('Creating oval track');
    // Calculate dimensions
    const innerRadius = 20;
    const outerRadius = innerRadius + config.trackWidth;
    
    // Create track surface
    const trackGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 32);
    const trackMaterial = new THREE.MeshStandardMaterial({
        color: config.trackColor,
        roughness: 0.5
    });
    const trackSurface = new THREE.Mesh(trackGeometry, trackMaterial);
    trackSurface.rotation.x = -Math.PI / 2;
    trackSurface.position.y = 0.01; // Slightly above ground to prevent z-fighting
    trackSurface.receiveShadow = true;
    parent.add(trackSurface);
    
    // Add lane markings (updated for newer Three.js versions)
    addLaneMarkings(parent, 'oval', innerRadius, outerRadius);
    
    // Add start/finish line
    const lineWidth = config.trackWidth;
    const lineGeometry = new THREE.PlaneGeometry(lineWidth, 1);
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const startLine = new THREE.Mesh(lineGeometry, lineMaterial);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(0, 0.02, -(innerRadius + config.trackWidth/2)); // Position at bottom of oval
    startLine.receiveShadow = true;
    parent.add(startLine);
    
    // Add inner barrier
    if (config.barrierHeight > 0) {
        const innerBarrierGeometry = new THREE.CylinderGeometry(
            innerRadius, innerRadius, config.barrierHeight, 32, 1, true
        );
        const barrierMaterial = new THREE.MeshStandardMaterial({
            color: config.barrierColor,
            roughness: 0.5
        });
        const innerBarrier = new THREE.Mesh(innerBarrierGeometry, barrierMaterial);
        innerBarrier.position.y = config.barrierHeight / 2;
        innerBarrier.receiveShadow = true;
        innerBarrier.castShadow = true;
        parent.add(innerBarrier);
        
        // Add outer barrier
        const outerBarrierGeometry = new THREE.CylinderGeometry(
            outerRadius, outerRadius, config.barrierHeight, 32, 1, true
        );
        const outerBarrier = new THREE.Mesh(outerBarrierGeometry, barrierMaterial);
        outerBarrier.position.y = config.barrierHeight / 2;
        outerBarrier.receiveShadow = true;
        outerBarrier.castShadow = true;
        parent.add(outerBarrier);
    }
    
    console.log('Oval track created');
}

/**
 * Creates a figure-8 race track
 * @param {THREE.Group} parent - Parent group to add track to
 * @param {Object} config - Track configuration
 */
function createFigure8Track(parent, config) {
    console.log('Creating figure-8 track (placeholder)');
    // This is a placeholder for a more complex figure-8 track
    // For simplicity, we're just creating an oval track for now
    createOvalTrack(parent, config);
}

/**
 * Adds lane markings to the track
 * @param {THREE.Group} parent - Parent group to add markings to
 * @param {string} shape - Track shape
 * @param {number} innerRadius - Inner radius of track
 * @param {number} outerRadius - Outer radius of track
 */
function addLaneMarkings(parent, shape, innerRadius, outerRadius) {
    console.log('Adding lane markings');
    
    if (shape === 'oval') {
        // Calculate middle radius
        const middleRadius = (innerRadius + outerRadius) / 2;
        
        // Create dashed line material
        const dashedLineMaterial = new THREE.LineDashedMaterial({
            color: 0xffffff,
            dashSize: 2,
            gapSize: 2,
        });
        
        try {
            // In newer Three.js versions, we need to use different approaches
            // for creating circular paths
            
            // Method 1: Using BufferGeometry and setFromPoints
            const points = [];
            const segments = 64;
            for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * Math.PI * 2;
                points.push(new THREE.Vector3(
                    Math.cos(theta) * middleRadius,
                    0,
                    Math.sin(theta) * middleRadius
                ));
            }
            
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const centerLine = new THREE.Line(geometry, dashedLineMaterial);
            centerLine.rotation.x = -Math.PI / 2;
            centerLine.position.y = 0.03; // Slightly above track
            centerLine.computeLineDistances(); // Required for dashed lines
            parent.add(centerLine);
            
            console.log('Lane markings created using BufferGeometry');
        } catch (error) {
            console.error('Error creating lane markings:', error);
            
            // Fallback method if the first approach fails
            try {
                // Create simple yellow markers at intervals around the track
                const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00 });
                const markerGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.5);
                
                for (let i = 0; i < 16; i++) {
                    const theta = (i / 16) * Math.PI * 2;
                    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
                    marker.position.set(
                        Math.cos(theta) * middleRadius,
                        0.05, // Slightly above the track
                        Math.sin(theta) * middleRadius
                    );
                    parent.add(marker);
                }
                
                console.log('Fallback lane markings created using marker boxes');
            } catch (fallbackError) {
                console.error('Failed to create fallback lane markings:', fallbackError);
            }
        }
    }
} 