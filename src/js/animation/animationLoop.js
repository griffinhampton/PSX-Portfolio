import * as THREE from "three";

/**
 * Create and start the animation loop
 * @param {Object} params - Animation parameters
 * @param {THREE.WebGLRenderer} params.renderer - The renderer (fallback if no composer)
 * @param {Object} params.composer - The effect composer for post-processing
 * @param {Object} params.controls - The orbit controls
 * @param {Object} params.qualitySettings - The quality settings object
 * @param {Object} params.lights - The lights object containing flashlight, raycaster, mouse
 * @param {THREE.Points} params.particlesMesh - The particle mesh for snow effect
 * @param {Object} params.models - The loaded models object
 * @param {Function} params.updatePositionInfo - Function to update position info display
 */
export function createAnimationLoop({
    renderer,
    composer,
    controls,
    qualitySettings,
    lights,
    particlesMesh,
    models,
    updatePositionInfo,
    orbManager
}) {
    const { flashlight, raycaster, mouse } = lights;

    function animate(t = 0) {
        requestAnimationFrame(animate);
        
        // Update flashlight position to follow camera - only on desktop
        if (qualitySettings.enableFlashlight && flashlight && raycaster && mouse) {
            flashlight.position.copy(window.camera.position);
            
            // Update raycaster with camera and mouse position
            raycaster.setFromCamera(mouse, window.camera);
            
            // Create a plane far in front of the camera to raycast against
            const distance = 20; // Distance to project the flashlight beam
            const direction = new THREE.Vector3();
            raycaster.ray.direction.clone().normalize();
            
            // Calculate target position for flashlight
            const targetPosition = new THREE.Vector3();
            targetPosition.copy(window.camera.position).add(
                raycaster.ray.direction.multiplyScalar(distance)
            );
            
            // Update flashlight target
            flashlight.target.position.copy(targetPosition);
            flashlight.target.updateMatrixWorld();
            
            // Update position info display
            if (updatePositionInfo) {
                updatePositionInfo(raycaster, mouse);
            }
        }
        
        // Keep snow centered on camera - simplified for mobile
        if (!qualitySettings.isMobile && particlesMesh) {
            particlesMesh.position.copy(window.camera.position * 0.0000001 * t);
            particlesMesh.rotation.y += 0.00001;
            particlesMesh.position.y += 0.00005;
            if (particlesMesh.position.y <= -1) {
                particlesMesh.position.y += 3;
            }
        }
        
        // Rotate furniture model
        if (models.furniture) {
            models.furniture.rotation.y += .005;
        }
        
        // Update controls (required when damping is enabled)
        controls.update();
        
        // Update orb navigation system
        if (orbManager && typeof orbManager.update === 'function') {
            orbManager.update();
        }
        
        // Render using composer for post-processing, or fallback to renderer
        if (composer) {
            composer.render();
        } else {
            renderer.render(window.scene, window.camera);
        }
    }

    return animate;
}
