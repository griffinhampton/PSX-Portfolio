import * as THREE from "three";

/**
 * Generate random position for snow particle outside the house
 * @returns {Object} Object with x, y, z coordinates
 */
function generateSnowPosition() {
    let x, z;
    
    // Keep generating positions until we get one outside the house bounds
    // House bounds: x: -3 to 6, z: -3 to 4
    do {
        x = (Math.random() - 0.5) * 32; // -16 to 16
        z = Math.random() * 60 - 10; // -10 to 50
    } while (x >= -3 && x <= 6 && z >= -3 && z <= 4);
    
    return {
        x: x,
        y: Math.random() * 8 + 4, // Start at y: 4, spread up to 12 for initial variation
        z: z
    };
}

/**
 * Set up particle system for snow effect
 * @param {THREE.Scene} scene - The scene to add particles to
 * @param {THREE.Texture} crossTexture - The texture to use for particles
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing particle arrays and related data
 */
export function setupParticles(scene, crossTexture, qualitySettings) {
    const particlesCnt = qualitySettings.particleCount; // Mobile: 5000, Desktop: 100000
    const particlesPerArray = Math.floor(particlesCnt / 3);
    
    // Create three separate particle systems
    const particleArrays = [];
    
    for (let arrayIndex = 0; arrayIndex < 3; arrayIndex++) {
        const particlesGeometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(particlesPerArray * 3);
        
        // Initialize positions outside the house
        for (let i = 0; i < particlesPerArray; i++) {
            const pos = generateSnowPosition();
            posArray[i * 3] = pos.x;
            posArray[i * 3 + 1] = Math.random() * 17 - 5; // Spread from -5 (ground) to 12 (top spawn)
            posArray[i * 3 + 2] = pos.z;
        }
        
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        
        const imageMat = new THREE.PointsMaterial({
            size: .01,
            transparent: true,
            color: 0xffffff,
            fog: true
        });
        
        const particlesMesh = new THREE.Points(particlesGeometry, imageMat);
        particlesMesh.frustumCulled = false;
        scene.add(particlesMesh);
        
        particleArrays.push({
            mesh: particlesMesh,
            geometry: particlesGeometry,
            count: particlesPerArray
        });
    }

    return {
        particleArrays,
        particlesCnt
    };
}

/**
 * Set up mouse event listener for particle animation
 * @param {Object} mouse - Mouse vector object to update
 * @param {Object} qualitySettings - The quality settings object
 */
export function setupParticleMouseListener(mouse, qualitySettings) {
    let mouseX = 0;
    let mouseY = 0;

    function animateParticles(e) {
        mouseY = e.clientY;
        mouseX = e.clientX;
        
        // Update normalized mouse coordinates for raycaster - only on desktop
        if (qualitySettings.enableFlashlight && mouse) {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        }
    }

    document.addEventListener('mousemove', animateParticles);

    return { mouseX, mouseY };
}

/**
 * Update particle positions for falling snow effect
 * @param {Array} particleArrays - Array of particle system objects
 * @param {Number} deltaTime - Time since last frame (optional, defaults to fixed speed)
 * @param {Boolean} shouldUpdate - Whether particles should fall and respawn (default true)
 */
export function updateParticles(particleArrays, deltaTime = 0.016, shouldUpdate = true) {
    if (!particleArrays || !shouldUpdate) return;
    
    const fallSpeed = 0.005; // Adjust this to make snow fall faster/slower
    
    particleArrays.forEach((particleArray) => {
        const positions = particleArray.geometry.attributes.position.array;
        
        for (let i = 0; i < particleArray.count; i++) {
            const idx = i * 3;
            
            // Make particle fall
            positions[idx + 1] -= fallSpeed;
            
            // Reset position when particle reaches y: -5
            if (positions[idx + 1] <= -5) {
                const newPos = generateSnowPosition();
                positions[idx] = newPos.x;      // x
                positions[idx + 1] = newPos.y;  // y (use random y from generateSnowPosition for variation)
                positions[idx + 2] = newPos.z;  // z
            }
        }
        
        // Mark positions as needing update
        particleArray.geometry.attributes.position.needsUpdate = true;
    });
}
