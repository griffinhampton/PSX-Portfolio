import * as THREE from "three";
import { updateParticles } from "../particles/particles.js";

/**
 * Create and start the animation loop
 * @param {Object} params - Animation parameters
 * @param {THREE.WebGLRenderer} params.renderer - The renderer (fallback if no composer)
 * @param {Object} params.composer - The effect composer for post-processing
 * @param {Object} params.controls - The orbit controls
 * @param {Object} params.qualitySettings - The quality settings object
 * @param {Object} params.lights - The lights object containing flashlight, raycaster, mouse
 * @param {Array} params.particleArrays - Array of particle system objects for snow effect
 * @param {Object} params.models - The loaded models object
 * @param {Function} params.updatePositionInfo - Function to update position info display
 * @param {Object} params.interactiveManager - Manager for interactive clickable objects
 */
export function createAnimationLoop({
    renderer,
    composer,
    controls,
    qualitySettings,
    lights,
    particleArrays,
    models,
    updatePositionInfo,
    orbManager,
    getInteractiveManager,
    youtubeScreen,
    navigationPositions
}) {
    const { flashlight, raycaster, mouse, mobileSpotlight } = lights;

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

        // Update mobile spotlight - only on mobile, points at boisvert when camera moves (not inside)
        if (qualitySettings.isMobile && mobileSpotlight) {
            // Update spotlight position to camera
            mobileSpotlight.position.copy(window.camera.position);
            
            // Get boisvert's position from the teleporter
            if (window.boisvertTeleporter && window.boisvertTeleporter.getBoisvertPosition) {
                const boisvertPos = window.boisvertTeleporter.getBoisvertPosition();
                
                // Only update target if we're not at the last position (inside)
                const isAtLastPosition = orbManager && orbManager.isAtLastPosition();
                
                if (boisvertPos && !isAtLastPosition) {
                    mobileSpotlight.target.position.copy(boisvertPos);
                    mobileSpotlight.target.updateMatrixWorld();
                }
            }
        }
        
        // Update falling snow particles - stop at last position (works on both desktop and mobile)
        if (particleArrays) {
            const shouldUpdateParticles = !orbManager || !orbManager.isAtLastPosition();
            updateParticles(particleArrays, undefined, shouldUpdateParticles);
        }
        
        // Update controls (required when damping is enabled)
        controls.update();
        
        // Update orb navigation system
        if (orbManager && typeof orbManager.update === 'function') {
            orbManager.update();
        }
        
        // Update interactive objects (rotation animations)
        const interactiveManager = getInteractiveManager ? getInteractiveManager() : null;
        if (interactiveManager && typeof interactiveManager.update === 'function') {
            interactiveManager.update();
        }
        
        // Update camera interactive objects (indicators)
        if (window.cameraInteractiveManager && typeof window.cameraInteractiveManager.update === 'function') {
            window.cameraInteractiveManager.update();
        }
        
        // Update Boisvert teleporter
        if (window.boisvertTeleporter && typeof window.boisvertTeleporter.update === 'function') {
            window.boisvertTeleporter.update();
        }

        // Detect arrival at the last base navigation position (so achievements work even when user navigates via navbar)
        try {
            if (navigationPositions && navigationPositions.length) {
                const lastIdx = navigationPositions.length - 1;
                const lastPos = navigationPositions[lastIdx];
                if (lastPos && lastPos.length >= 3) {
                    const dx = window.camera.position.x - lastPos[0];
                    const dy = window.camera.position.y - lastPos[1];
                    const dz = window.camera.position.z - lastPos[2];
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    const ARRIVAL_THRESHOLD = 0.6; // match other thresholds used elsewhere
                    // Use a persisted flag on the animate function to avoid repeated events
                    if (dist <= ARRIVAL_THRESHOLD && !animate._wasAtLastPosition) {
                        animate._wasAtLastPosition = true;
                        try { window.dispatchEvent(new CustomEvent('orb:arrived', { detail: { index: lastIdx } })); } catch (e) {}
                    } else if (dist > ARRIVAL_THRESHOLD) {
                        animate._wasAtLastPosition = false;
                    }
                }
            }
        } catch (e) {}
        
        // Render using composer for post-processing, or fallback to renderer
        if (composer) {
            composer.render();
        } else {
            renderer.render(window.scene, window.camera);
        }
        
        // Render CSS3D for YouTube screen
        const ytScreen = youtubeScreen ? youtubeScreen() : null;
        if (ytScreen) {
            ytScreen.render(window.camera);
        }
    }

    return animate;
}
