// Car model test script
// This script can be used to test the car model creation in isolation

(function() {
    console.log('Car test script loaded');
    
    // Create a test container
    const testContainer = document.createElement('div');
    testContainer.id = 'car-test-container';
    testContainer.style.width = '100%';
    testContainer.style.height = '400px';
    testContainer.style.backgroundColor = '#87CEEB';
    testContainer.style.position = 'relative';
    
    // Create a button to toggle the test
    const testButton = document.createElement('button');
    testButton.textContent = 'Test Car Model';
    testButton.style.position = 'absolute';
    testButton.style.top = '10px';
    testButton.style.left = '10px';
    testButton.style.zIndex = '100';
    
    // Create a status display
    const statusDisplay = document.createElement('div');
    statusDisplay.id = 'car-test-status';
    statusDisplay.style.position = 'absolute';
    statusDisplay.style.top = '10px';
    statusDisplay.style.right = '10px';
    statusDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    statusDisplay.style.color = 'white';
    statusDisplay.style.padding = '10px';
    statusDisplay.style.borderRadius = '5px';
    statusDisplay.style.zIndex = '100';
    statusDisplay.textContent = 'Click button to test car model';
    
    // Add elements to the page
    document.body.appendChild(testContainer);
    document.body.appendChild(testButton);
    document.body.appendChild(statusDisplay);
    
    // Test scene variables
    let scene, camera, renderer, car, animationId;
    let isTestRunning = false;
    
    // Initialize Three.js scene
    function initTestScene() {
        try {
            statusDisplay.textContent = 'Initializing test scene...';
            
            // Create scene
            scene = new THREE.Scene();
            
            // Create camera
            const width = testContainer.clientWidth;
            const height = testContainer.clientHeight;
            const aspectRatio = width / height;
            camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
            camera.position.set(0, 5, 10);
            camera.lookAt(0, 0, 0);
            
            // Create renderer
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(width, height);
            renderer.setClearColor(0x87CEEB);
            renderer.shadowMap.enabled = true;
            testContainer.appendChild(renderer.domElement);
            
            // Add lights
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(10, 10, 5);
            directionalLight.castShadow = true;
            scene.add(directionalLight);
            
            // Add ground
            const groundGeometry = new THREE.PlaneGeometry(20, 20);
            const groundMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x1e824c,
                roughness: 0.8
            });
            const ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            scene.add(ground);
            
            statusDisplay.textContent = 'Test scene initialized';
            return true;
        } catch (error) {
            console.error('Error initializing test scene:', error);
            statusDisplay.textContent = 'Error: ' + error.message;
            return false;
        }
    }
    
    // Test car creation
    function testCarCreation() {
        try {
            statusDisplay.textContent = 'Creating car model...';
            
            // Test with different colors
            const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff];
            const colorIndex = Math.floor(Math.random() * colors.length);
            const carColor = colors[colorIndex];
            
            // Create car using the utility function
            if (typeof createCar === 'function') {
                car = createCar({
                    color: carColor,
                    castShadow: true
                });
                
                scene.add(car);
                statusDisplay.textContent = 'Car created successfully with color: #' + carColor.toString(16);
                return true;
            } else {
                statusDisplay.textContent = 'Error: createCar function not found';
                return false;
            }
        } catch (error) {
            console.error('Error creating car:', error);
            statusDisplay.textContent = 'Error creating car: ' + error.message;
            return false;
        }
    }
    
    // Animate the test scene
    function animateTestScene() {
        if (!isTestRunning) return;
        
        animationId = requestAnimationFrame(animateTestScene);
        
        if (car) {
            car.rotation.y += 0.01;
        }
        
        renderer.render(scene, camera);
    }
    
    // Start the test
    function startTest() {
        if (isTestRunning) return;
        
        if (initTestScene()) {
            if (testCarCreation()) {
                isTestRunning = true;
                animateTestScene();
                testButton.textContent = 'Stop Test';
            }
        }
    }
    
    // Stop the test
    function stopTest() {
        if (!isTestRunning) return;
        
        cancelAnimationFrame(animationId);
        
        // Clean up
        if (renderer && renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        
        scene = null;
        camera = null;
        renderer = null;
        car = null;
        
        isTestRunning = false;
        testButton.textContent = 'Test Car Model';
        statusDisplay.textContent = 'Test stopped';
    }
    
    // Toggle test
    testButton.addEventListener('click', function() {
        if (isTestRunning) {
            stopTest();
        } else {
            startTest();
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', function() {
        if (isTestRunning && renderer && camera) {
            const width = testContainer.clientWidth;
            const height = testContainer.clientHeight;
            
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        }
    });
    
    console.log('Car test script ready');
})(); 