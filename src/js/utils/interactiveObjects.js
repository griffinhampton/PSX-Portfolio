// ...existing code...
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
    const indicators = new Map(); // Map of object -> indicator element
    
    // Store scene reference globally for close button access
    window.interactiveObjectsScene = scene;
    window.interactiveObjectsList = interactiveObjects;
    
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
     * @param {boolean} config.shouldJitter - Whether object should jitter (default: false)
     * @param {number} config.jitterAmount - Amount of random jitter movement (default: 0.01)
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

        // Make painting unaffected by lights (convert to unlit material)
        if (config.objectName === 'painting') {
            object.traverse((child) => {
                if (child.isMesh && child.material) {
                    const oldMaterial = child.material;
                    const unlitMaterial = new THREE.MeshBasicMaterial({
                        map: oldMaterial.map,
                        color: oldMaterial.color,
                        transparent: oldMaterial.transparent,
                        opacity: oldMaterial.opacity,
                        side: oldMaterial.side,
                        alphaTest: oldMaterial.alphaTest
                    });
                    child.material = unlitMaterial;
                    if (oldMaterial.dispose) {
                        oldMaterial.dispose();
                    }
                }
            });
        }
        // Load resume texture for paper immediately
        if (config.objectName === 'paper') {
            object.traverse((child) => {
                if (child.isMesh && child.material) {
                    const oldMaterial = child.material;
                    const loader = new THREE.TextureLoader();
                    loader.load('src/textures/Resume.webp', (texture) => {
                        texture.center.set(0.5, 0.5);
                        texture.rotation = -Math.PI / 2;
                        // Zoom out by 10%
                        texture.repeat.set(0.9, 0.9);
                        texture.offset.set(0.05, 0.05);
                        const unlitMaterial = new THREE.MeshBasicMaterial({
                            map: texture,
                            color: oldMaterial.color,
                            transparent: oldMaterial.transparent,
                            opacity: oldMaterial.opacity,
                            side: oldMaterial.side,
                            alphaTest: oldMaterial.alphaTest
                        });
                        child.material = unlitMaterial;
                        if (oldMaterial.dispose) {
                            oldMaterial.dispose();
                        }
                    });
                }
            });
        }
        object.userData.shouldJitter = false; // Will be set to true after click
        object.userData.targetPosition = null; // Store target position for jitter
        object.userData.hasBeenClicked = false; // Track if object has been clicked

        interactiveObjects.push(object);
        
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
     * Handle object click - move and start rotation or jitter
     */
    function onObjectClick(object) {
        const config = object.userData.config;
        const targetPos = config.targetPosition;
        const zOffset = config.zOffset || 0;
        const moveDuration = config.moveDuration || 1.5;
        const clickCooldown = config.clickCooldown || 0;

        // Set as the currently active object
        currentlyActiveObject = object;
        
        // Mark as clicked and hide indicator
        object.userData.hasBeenClicked = true;
        const indicator = indicators.get(object);
        if (indicator) {
            indicator.style.display = 'none';
        }
        
        // Set cooldown time
        cooldownEndTime = Date.now() + clickCooldown;

        // Store target position for jitter reference
        object.userData.targetPosition = new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2] + zOffset);

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
                
                // Start jitter after movement completes
                if (config.shouldJitter) {
                    object.userData.shouldJitter = true;
                }
                
                // Show LinkedIn popup for cola bottle
                if (config.objectName === 'cola') {
                    const popup = document.getElementById('linkedinPopup');
                    if (popup) {
                        popup.style.display = 'block';
                    }
                }

                // Show Resume popup for paper
                if (config.objectName === 'paper') {
                    const popup = document.getElementById('resumePopup');
                    if (popup) {
                        popup.style.display = 'block';
                    }
                    // Set Resume.webp as paper texture
                    object.traverse((child) => {
                        if (child.isMesh && child.material) {
                            const loader = new THREE.TextureLoader();
                            loader.load('src/textures/Resume.webp', (texture) => {
                                // Rotate texture 90 degrees to portrait
                                texture.center.set(0.5, 0.5);
                                texture.rotation = -Math.PI / 2;
                                child.material.map = texture;
                                child.material.needsUpdate = true;
                            });
                        }
                    });
                }

                // Show About Me popup for painting
                if (config.objectName === 'painting') {
                    const popup = document.getElementById('aboutPopup');
                    if (popup) {
                        popup.style.display = 'block';
                    }
                }
            }
        });

        // Animate rotation if targetRotation is specified
        if (config.targetRotation) {
            // Store target rotation for swaying reference
            object.userData.targetRotation = {
                x: config.targetRotation[0],
                y: config.targetRotation[1],
                z: config.targetRotation[2]
            };
            
            gsap.to(object.rotation, {
                x: config.targetRotation[0],
                y: config.targetRotation[1],
                z: config.targetRotation[2],
                duration: moveDuration,
                ease: 'power2.inOut'
            });
        }
    }

    /**
     * Reset object back to original position and stop rotation/jitter
     */
    function resetObject(object) {
        const config = object.userData.config;
        const moveDuration = config.moveDuration || 1.5;

        // Stop rotation and jitter immediately
        object.userData.shouldRotate = false;
        object.userData.shouldJitter = false;
        object.userData.targetPosition = null;
        object.userData.targetRotation = null;
        
        // Hide LinkedIn popup when cola resets
        if (config.objectName === 'cola') {
            const popup = document.getElementById('linkedinPopup');
            if (popup) {
                popup.style.display = 'none';
            }
        }

        // Hide Resume popup when paper resets
        if (config.objectName === 'paper') {
            const popup = document.getElementById('resumePopup');
            if (popup) {
                popup.style.display = 'none';
            }
        }

        // Hide About Me popup when painting resets
        if (config.objectName === 'painting') {
            const popup = document.getElementById('aboutPopup');
            if (popup) {
                popup.style.display = 'none';
            }
        }

        // Animate back to original position
        gsap.to(object.position, {
            x: object.userData.originalPosition.x,
            y: object.userData.originalPosition.y,
            z: object.userData.originalPosition.z,
            duration: moveDuration,
            ease: 'power2.inOut'
        });
        
        // Animate back to original rotation
        gsap.to(object.rotation, {
            x: object.userData.originalRotation.x,
            y: object.userData.originalRotation.y,
            z: object.userData.originalRotation.z,
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
     * Update rotating and jittering objects each frame
     */
    function update() {
        const time = Date.now() * 0.001; // Convert to seconds
        const isAtAllowedPos = isCameraAtAllowedPosition();
        
        interactiveObjects.forEach(obj => {
            if (obj.userData.shouldRotate) {
                const rotationSpeed = obj.userData.config.rotationSpeed || 0.01;
                obj.rotation.y += rotationSpeed;
            }
            
            if (obj.userData.shouldJitter && obj.userData.targetPosition) {
                const jitterAmount = obj.userData.config.jitterAmount || 0.01;
                const target = obj.userData.targetPosition;
                
                // Use sine waves for smooth swaying motion
                const swaySpeed = 0.5; // Slower = more gentle sway
                const swayX = Math.sin(time * swaySpeed) * jitterAmount * 5;
                const swayY = Math.sin(time * swaySpeed * 0.7) * jitterAmount * 3;
                const swayZ = Math.cos(time * swaySpeed * 0.5) * jitterAmount * 4;
                
                // Apply smooth swaying to position
                obj.position.x = target.x + swayX;
                obj.position.y = target.y + swayY;
                obj.position.z = target.z + swayZ;
                
                // Add gentle rotation sway
                const rotTarget = obj.userData.targetRotation;
                if (rotTarget) {
                    obj.rotation.x = rotTarget.x + Math.sin(time * swaySpeed * 0.8) * 0.02;
                    obj.rotation.z = rotTarget.z + Math.cos(time * swaySpeed * 0.6) * 0.02;
                }
            }
            
            // Update indicator position and visibility
            updateIndicator(obj, isAtAllowedPos);
        });
    }
    
    /**
     * Update indicator position for an object
     */
    function updateIndicator(object, showIndicator) {
        const indicator = indicators.get(object);
        if (!indicator) return;
        
        // Only show indicator if:
        // 1. Camera is at allowed position
        // 2. Object hasn't been clicked yet
        // 3. Object is not currently active
        const shouldShow = showIndicator && 
                          !object.userData.hasBeenClicked && 
                          currentlyActiveObject !== object;
        
        if (!shouldShow) {
            indicator.style.display = 'none';
            return;
        }
        
        // Project 3D position to 2D screen space
        const vector = new THREE.Vector3();
        object.getWorldPosition(vector);
        vector.project(camera);
        
        // Convert to pixel coordinates
        const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
        const y = (vector.y * -0.5 + 0.5) * window.innerHeight;
        
        // Update indicator position
        indicator.style.left = `${x}px`;
        indicator.style.top = `${y}px`;
        indicator.style.display = 'block';
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

    // Setup close button handlers for all popups
    setupPopupCloseButtons();

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
        }
    };
}

/**
 * Setup close button handlers for popup cards
 */
function setupPopupCloseButtons() {
    const closeButtons = document.querySelectorAll('.popup-close');
    
    closeButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            
            const popupId = button.getAttribute('data-popup');
            const objectName = button.getAttribute('data-object');
            
            // Hide the popup
            const popup = document.getElementById(popupId);
            if (popup) {
                popup.style.display = 'none';
            }
            
            // Reset the associated object
            if (objectName && window.interactiveObjectsList) {
                // Find the object in the interactive objects list
                const objectToReset = window.interactiveObjectsList.find(obj => obj.name === objectName);
                if (objectToReset) {
                    resetObjectToOriginal(objectToReset);
                }
            }
        });
    });
}

/**
 * Helper function to reset an object to its original position and rotation
 */
function resetObjectToOriginal(object) {
    const config = object.userData.config;
    const originalPos = object.userData.originalPosition;
    const originalRot = object.userData.originalRotation;
    
    if (!originalPos || !originalRot) return;
    
    // Stop rotation and jitter
    object.userData.shouldRotate = false;
    object.userData.shouldJitter = false;
    object.userData.targetPosition = null;
    
    // Animate back to original position and rotation
    const resetDuration = config.moveDuration || 1.5;
    
    gsap.to(object.position, {
        x: originalPos.x,
        y: originalPos.y,
        z: originalPos.z,
        duration: resetDuration,
        ease: 'power2.inOut'
    });
    
    gsap.to(object.rotation, {
        x: originalRot.x,
        y: originalRot.y,
        z: originalRot.z,
        duration: resetDuration,
        ease: 'power2.inOut'
    });
}
