import gsap from 'gsap';
import * as THREE from 'three';
import { registerInteractiveManager } from './cursorManager.js';

/**
 * Setup interactive objects that can be clicked and animated
 * @param {THREE.Scene} scene - The scene containing the objects
 * @param {HTMLElement} domElement - The renderer's DOM element for raycasting
 * @param {THREE.Camera} camera - The camera for raycasting
 * @param {Array} interactiveConfigs - Array of configuration objects for interactive items
 * @param {Array} allowedCameraPositions - Array of [x,y,z] positions where clicking is allowed
 * @returns {Object} Manager object with cleanup methods
 */
export function setupInteractiveObjects(scene, domElement, camera, interactiveConfigs = [], allowedCameraPositions = []) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const interactiveObjects = [];
    let currentlyActiveObject = null; // Track the currently active/rotating object
    let cooldownEndTime = 0; // Timestamp when cooldown ends
    
    // Distance threshold for position matching (camera can be slightly off)
    const POSITION_THRESHOLD = 0.5;
    
    /**
     * Check if camera is at an allowed position
     */
    function isCameraAtAllowedPosition() {
        if (allowedCameraPositions.length === 0) {
            // If no restrictions, always allow
            return true;
        }
        
        const camPos = camera.position;
        
        // Check if camera is near any of the allowed positions
        for (const allowedPos of allowedCameraPositions) {
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
     * Make an object interactive based on configuration
     * @param {Object} config - Configuration object
     * @param {string} config.objectName - Name of the object in the scene
     * @param {Array<number>} config.targetPosition - [x, y, z] position to move to
     * @param {number} config.zOffset - Additional z offset from target position (default: 0)
     * @param {boolean} config.shouldRotate - Whether object should rotate (default: false)
     * @param {number} config.rotationSpeed - Speed of rotation if enabled (default: 0.01)
     * @param {number} config.moveDuration - Duration of move animation in seconds (default: 1.5)
     * @param {number} config.clickCooldown - Cooldown in ms before user can click away (default: 0)
     */
    function setupInteractiveObject(object, config) {
        const targetPos = config.targetPosition;
        const zOffset = config.zOffset || 0;
        const shouldRotate = config.shouldRotate !== undefined ? config.shouldRotate : false;
        const rotationSpeed = config.rotationSpeed || 0.01;
        const moveDuration = config.moveDuration || 1.5;

        // Store original position in case we want to reset
        object.userData.originalPosition = object.position.clone();
        object.userData.originalRotation = object.rotation.clone();
        object.userData.isInteractive = true;
        object.userData.config = config;
        object.userData.shouldRotate = false; // Will be set to true after click

        interactiveObjects.push(object);
    }

    /**
     * Handle object click - move and start rotation
     */
    function onObjectClick(object) {
        const config = object.userData.config;
        const targetPos = config.targetPosition;
        const zOffset = config.zOffset || 0;
        const moveDuration = config.moveDuration || 1.5;
        const clickCooldown = config.clickCooldown || 0;

        // Set as the currently active object
        currentlyActiveObject = object;
        
        // Set cooldown time
        cooldownEndTime = Date.now() + clickCooldown;

        // Animate to target position
        gsap.to(object.position, {
            x: targetPos[0],
            y: targetPos[1],
            z: targetPos[2] + zOffset,
            duration: moveDuration,
            ease: 'power2.inOut',
            onComplete: () => {
                // Start rotation after movement completes
                if (config.shouldRotate) {
                    object.userData.shouldRotate = true;
                }
            }
        });
    }

    /**
     * Reset object back to original position and stop rotation
     */
    function resetObject(object) {
        const config = object.userData.config;
        const moveDuration = config.moveDuration || 1.5;

        // Stop rotation immediately
        object.userData.shouldRotate = false;

        // Animate back to original position
        gsap.to(object.position, {
            x: object.userData.originalPosition.x,
            y: object.userData.originalPosition.y,
            z: object.userData.originalPosition.z,
            duration: moveDuration,
            ease: 'power2.inOut'
        });
    }

    /**
     * Handle pointer events
     */
    function onPointerDown(event) {
        // Check if camera is at an allowed position
        if (!isCameraAtAllowedPosition()) {
            return; // Don't process clicks if camera is not at allowed position
        }
        
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
        
        // Get all descendants of interactive objects for raycasting
        const raycastTargets = [];
        interactiveObjects.forEach(obj => {
            obj.traverse(child => {
                if (child.isMesh) {
                    raycastTargets.push(child);
                }
            });
        });
        
        const intersects = raycaster.intersectObjects(raycastTargets, false);

        if (intersects.length > 0) {
            let clicked = intersects[0].object;
            
            // Walk up the tree to find the interactive object
            while (clicked && !clicked.userData.isInteractive) {
                clicked = clicked.parent;
            }

            if (clicked && clicked.userData.isInteractive) {
                // If this is a different object than the currently active one, reset the old one
                if (currentlyActiveObject && currentlyActiveObject !== clicked) {
                    // Check cooldown before allowing reset
                    if (Date.now() >= cooldownEndTime) {
                        resetObject(currentlyActiveObject);
                    } else {
                        // Still in cooldown, ignore click
                        return;
                    }
                }
                
                // Only activate if it's not already the active object
                if (currentlyActiveObject !== clicked) {
                    onObjectClick(clicked);
                }
            } else {
                // Reset any active object when clicking non-interactive things
                if (currentlyActiveObject) {
                    // Check cooldown before allowing reset
                    if (Date.now() >= cooldownEndTime) {
                        resetObject(currentlyActiveObject);
                        currentlyActiveObject = null;
                        cooldownEndTime = 0;
                    }
                }
            }
        } else {
            // No intersection - clicked empty space, reset any active object
            if (currentlyActiveObject) {
                // Check cooldown before allowing reset
                if (Date.now() >= cooldownEndTime) {
                    resetObject(currentlyActiveObject);
                    currentlyActiveObject = null;
                    cooldownEndTime = 0;
                }
            }
        }
    }

    /**
     * Update rotating objects each frame
     */
    function update() {
        interactiveObjects.forEach(obj => {
            if (obj.userData.shouldRotate) {
                const rotationSpeed = obj.userData.config.rotationSpeed || 0.01;
                obj.rotation.y += rotationSpeed;
            }
        });
    }

    // Find and setup all configured objects
    interactiveConfigs.forEach(config => {
        let found = false;
        scene.traverse((child) => {
            if (child.name === config.objectName) {
                setupInteractiveObject(child, config);
                found = true;
            }
        });

    });

    // Register with cursor manager for hover detection
    registerInteractiveManager(() => interactiveObjects);

    // Add event listeners
    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('touchstart', onPointerDown, { passive: false });

    return {
        update,
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown);
            domElement.removeEventListener('touchstart', onPointerDown);
        }
    };
}
