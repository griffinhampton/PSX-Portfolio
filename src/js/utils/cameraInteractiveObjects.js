import gsap from 'gsap';
import * as THREE from 'three';
import { registerInteractiveManager } from './cursorManager.js';

/**
 * Setup camera-interactive objects that move the camera when clicked
 * @param {THREE.Scene} scene - The scene containing the objects
 * @param {HTMLElement} domElement - The renderer's DOM element for raycasting
 * @param {THREE.Camera} camera - The camera for raycasting
 * @param {Array} cameraInteractiveConfigs - Array of configuration objects
 * @param {Object} flashlight - The flashlight object to dim/brighten
 * @param {Object} videoPlayer - The video player manager
 * @param {Function} onCameraMoveComplete - Callback when camera movement completes
 * @returns {Object} Manager object with cleanup methods
 */
export function setupCameraInteractiveObjects(scene, domElement, camera, cameraInteractiveConfigs = [], flashlight = null, videoPlayer = null, onCameraMoveComplete = null) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const cameraInteractiveObjects = [];
    let previousCameraPosition = null;

    /**
     * Make an object camera-interactive based on configuration
     * @param {Object} config - Configuration object
     * @param {string} config.objectName - Name of the object in the scene
     * @param {Array<number>} config.cameraPosition - [x, y, z] position to move camera to
     * @param {number} config.moveDuration - Duration of camera move animation in seconds (default: 1.5)
     */
    function setupCameraInteractiveObject(object, config) {
        object.userData.isCameraInteractive = true;
        object.userData.cameraConfig = config;
        cameraInteractiveObjects.push(object);
    }

    /**
     * Handle object click - move camera to position
     */
    function onObjectClick(object) {
        const config = object.userData.cameraConfig;
        const targetPos = config.cameraPosition;
        const moveDuration = config.moveDuration || 1.5;

        // Store previous camera position
        previousCameraPosition = camera.position.clone();

        // Kill any ongoing camera animations
        gsap.killTweensOf(camera.position);

        // Dim flashlight when moving to screen
        if (flashlight) {
            flashlight.intensity = 5;
        }

        // Move camera to target position
        gsap.to(camera.position, {
            x: targetPos[0],
            y: targetPos[1],
            z: targetPos[2],
            duration: moveDuration,
            ease: 'power2.inOut',
            onComplete: () => {
                // Show video player if available
                if (videoPlayer && config.showVideo) {
                    videoPlayer.show();
                }
                
                if (onCameraMoveComplete) {
                    onCameraMoveComplete(object, config);
                }
            }
        });
    }

    /**
     * Handle pointer events
     */
    function onPointerDown(event) {
        // Get pointer position
        const rect = domElement.getBoundingClientRect();
        let clientX, clientY;

        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else if (event.changedTouches && event.changedTouches.length > 0) {
            clientX = event.changedTouches[0].clientX;
            clientY = event.changedTouches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        // Raycast - check all scene objects to handle nested meshes
        raycaster.setFromCamera(pointer, camera);
        
        // Get all descendants of camera-interactive objects for raycasting
        const raycastTargets = [];
        cameraInteractiveObjects.forEach(obj => {
            obj.traverse(child => {
                if (child.isMesh) {
                    raycastTargets.push(child);
                }
            });
        });
        
        const intersects = raycaster.intersectObjects(raycastTargets, false);

        if (intersects.length > 0) {
            let clicked = intersects[0].object;
            
            // Walk up the tree to find the camera-interactive object
            while (clicked && !clicked.userData.isCameraInteractive) {
                clicked = clicked.parent;
            }

            if (clicked && clicked.userData.isCameraInteractive) {
                onObjectClick(clicked);
            }
        }
    }

    // Find and setup all configured objects
    cameraInteractiveConfigs.forEach(config => {
        let found = false;
        scene.traverse((child) => {
            if (child.name === config.objectName) {
                setupCameraInteractiveObject(child, config);
                found = true;
            }
        });
    });

    // Register with cursor manager for hover detection
    registerInteractiveManager(() => cameraInteractiveObjects);

    // Add event listeners
    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('touchstart', onPointerDown, { passive: false });

    return {
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown);
            domElement.removeEventListener('touchstart', onPointerDown);
        },
        getPreviousCameraPosition() {
            return previousCameraPosition;
        }
    };
}
