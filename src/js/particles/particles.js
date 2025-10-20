import * as THREE from "three";

/**
 * Set up particle system for snow effect
 * @param {THREE.Scene} scene - The scene to add particles to
 * @param {THREE.Texture} crossTexture - The texture to use for particles
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing particlesMesh and related data
 */
export function setupParticles(scene, crossTexture, qualitySettings) {
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCnt = qualitySettings.particleCount; // Mobile: 5000, Desktop: 100000

    const posArray = new Float32Array(particlesCnt * 3);

    for(let i = 0; i < particlesCnt * 3; i++) {
        posArray[i] = ((Math.random() - .5) * 5); // Spread particles from -2.5 to 2.5
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    const imageMat = new THREE.PointsMaterial({
        size: .01,
        map: crossTexture,
        transparent: true,
    });

    // Create random particles
    const particlesMesh = new THREE.Points(particlesGeometry, imageMat);
    particlesMesh.frustumCulled = false; // ensure it's always rendered when we move it with the camera
    scene.add(particlesMesh); // Add directly to scene, not to mesh

    return {
        particlesMesh,
        particlesGeometry,
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
