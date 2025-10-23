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
export function setupCameraInteractiveObjects(scene, domElement, camera, cameraInteractiveConfigs = [], flashlight = null, videoPlayer = null, onCameraMoveComplete = null, allowedIndicatorPositions = []) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const cameraInteractiveObjects = [];
    let previousCameraPosition = null;
    const indicators = new Map(); // Map of object -> indicator element
    
    // Distance threshold for position matching (camera can be slightly off)
    const POSITION_THRESHOLD = 0.5;
    
    /**
     * Check if camera is at an allowed position for showing indicators
     */
    function isCameraAtAllowedPosition() {
        if (allowedIndicatorPositions.length === 0) {
            // If no restrictions, always show
            return true;
        }
        
        const camPos = camera.position;
        
        // Check if camera is near any of the allowed positions
        for (const allowedPos of allowedIndicatorPositions) {
            const distance = Math.sqrt(
                Math.pow(camPos.x - allowedPos[0], 2) +
                Math.pow(camPos.y - allowedPos[1], 2) +
                Math.pow(camPos.z - allowedPos[2], 2)
            );
            
            if (distance < POSITION_THRESHOLD) {
                return true;
            }
        }
        
        return false;
    }

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
        object.userData.hasBeenClicked = false; // Track if object has been clicked
        cameraInteractiveObjects.push(object);
        
        // Create indicator for this object
        createIndicator(object);
    }
    
    /**
     * Create exclamation mark indicator for an object
     */
    function createIndicator(object) {
        const indicator = document.createElement('div');
        indicator.className = 'interactive-indicator';
        indicator.textContent = '!';
        indicator.style.display = 'none'; // Hidden by default
        document.body.appendChild(indicator);
        indicators.set(object, indicator);
    }

    /**
     * Handle object click - move camera to position
     */
    function onObjectClick(object) {
        const config = object.userData.cameraConfig;
        const targetPos = config.cameraPosition;
        const moveDuration = config.moveDuration || 1.5;

        // Mark as clicked and hide indicator
        object.userData.hasBeenClicked = true;
        const indicator = indicators.get(object);
        if (indicator) {
            indicator.style.display = 'none';
        }

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
                    if (window.__DEBUG_SCREEN) console.debug('[cameraInteractive] onCameraMoveComplete callback invoking', object.name, config);
                    onCameraMoveComplete(object, config);
                }
            }
        });
    }

    /**
     * Handle pointer events
     */
    function onPointerDown(event) {
        // Handle pointerdown for camera-interactive objects (allow clicks regardless of drag state)
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
    
    /**
     * Update indicator positions each frame
     */
    function update() {
        cameraInteractiveObjects.forEach(obj => {
            updateIndicator(obj);
        });
    }
    
    /**
     * Update indicator position for an object
     */
    function updateIndicator(object) {
        const indicator = indicators.get(object);
        if (!indicator) return;
        
        // Only show indicator if:
        // 1. Camera is at allowed position
        // 2. Object hasn't been clicked yet
        const isAtAllowedPos = isCameraAtAllowedPosition();
        const shouldShow = isAtAllowedPos && !object.userData.hasBeenClicked;
        
        if (!shouldShow) {
            indicator.style.display = 'none';
            return;
        }
        // Project 3D world position to 2D screen space
        const worldPos = new THREE.Vector3();
        object.getWorldPosition(worldPos);

        // Only show indicator for objects that are in front of the camera
        const toObject = new THREE.Vector3();
        toObject.subVectors(worldPos, camera.position).normalize();
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        if (toObject.dot(camDir) <= 0) {
            // Object is behind the camera - hide indicator
            indicator.style.display = 'none';
            return;
        }

        // Project to NDC
        const vector = worldPos.clone();
        vector.project(camera);

        // Optional occlusion test (enable via window.__ENABLE_INDICATOR_OCCLUSION)
        if (window.__ENABLE_INDICATOR_OCCLUSION) {
            const dir = new THREE.Vector3().subVectors(worldPos, camera.position).normalize();
            raycaster.set(camera.position, dir);
            const distanceToObj = camera.position.distanceTo(worldPos);
            const hits = raycaster.intersectObjects(scene.children, true);
            if (hits && hits.length > 0) {
                const first = hits[0];
                if (first.distance < distanceToObj - 0.05 && first.object !== object) {
                    indicator.style.display = 'none';
                    return;
                }
            }
        }

        // Debug logging
        if (window.__DEBUG_INDICATORS) {
            const screenX = (vector.x * 0.5 + 0.5) * window.innerWidth;
            const screenY = (vector.y * -0.5 + 0.5) * window.innerHeight;
            console.debug('[cameraIndicator] show', { name: object.name, uuid: object.uuid, worldPos: worldPos.toArray(), screen: { x: screenX, y: screenY } });
        }
        
    // Convert to pixel coordinates
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (vector.y * -0.5 + 0.5) * window.innerHeight;
        
        // Update indicator position
        indicator.style.left = `${x}px`;
        indicator.style.top = `${y}px`;
        indicator.style.display = 'block';
    }

    return {
        update,
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown);
            domElement.removeEventListener('touchstart', onPointerDown);
            
            // Clean up indicators
            indicators.forEach((indicator) => {
                if (indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
            });
            indicators.clear();
        },
        getPreviousCameraPosition() {
            return previousCameraPosition;
        }
    };
}
