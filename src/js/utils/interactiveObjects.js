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
    // Optional: enable occlusion checks for indicators (disabled by default)
    const ENABLE_INDICATOR_OCCLUSION = false;
    
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
        // Ensure the indicator does not capture pointer events so clicks pass through
        // to the underlying renderer canvas (prevents the indicator div from blocking pointerdown)
        indicator.style.pointerEvents = 'none';
        // Keep indicator visually above canvas
        indicator.style.zIndex = '9999';
        document.body.appendChild(indicator);
        indicators.set(object, indicator);
    }

    /**
     * Map fetchitem object names to the items list index used by boisvertGame
     * Returns -1 if name doesn't map to a known fetch item
     */
    function getFetchItemIndexByName(name) {
        if (!name) return -1;
        const n = name.toLowerCase();
        // Accept several name variants for the silly pumpkin (typos or alternate names)
        if ((n.includes('silly') || n.includes('goofy') || n.includes('punk') || n.includes('pumpk')) && n.includes('fetchitem')) return 0; // silly pumpkin
        if (n.includes('terrablade') && n.includes('fetchitem')) return 1; // terrablade
        if (n.includes('easter') && n.includes('fetchitem')) return 2; // easter egg
        return -1;
    }

    /**
     * Respawn (reset) all fetch items: restore visibility, position, rotation and game-state.
     * This will also clear any active tweens on the object so it returns to its original pose.
     */
    function respawnFetchItems() {
        try {
            if (window && window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] respawning all fetch items...');
            interactiveObjects.forEach(obj => {
                try {
                    const cfg = obj.userData && obj.userData.config;
                    if (!cfg || !cfg.isFetchItem) return;

                    // Kill any tweens affecting this object
                    try { gsap.killTweensOf(obj.position); } catch(e) {}
                    try { gsap.killTweensOf(obj.rotation); } catch(e) {}

                    // Restore original transform if available
                    if (obj.userData.originalPosition) {
                        obj.position.copy(obj.userData.originalPosition);
                    }
                    if (obj.userData.originalRotation) {
                        obj.rotation.copy(obj.userData.originalRotation);
                    }

                    // Ensure visibility
                    obj.visible = true;

                    // Reset interactive runtime flags
                    obj.userData.hasBeenClicked = false;
                    obj.userData.shouldRotate = false;
                    obj.userData.shouldJitter = false;
                    obj.userData.targetPosition = null;

                    // If the global game tracks collection state, mark item as unchecked
                    try {
                        const idx = getFetchItemIndexByName(cfg.objectName || obj.name);
                        const setter = window && window.boisvertGame && window.boisvertGame.setItemChecked;
                        if (typeof setter === 'function' && idx >= 0) {
                            try { window.boisvertGame.setItemChecked(idx, false); } catch (e) { /* ignore */ }
                        }
                    } catch (e) {}

                    // Show indicator again if present
                    const ind = indicators.get(obj);
                    if (ind) ind.style.display = 'block';
                } catch (e) {
                    console.warn('[interactiveObjects] Error respawning individual fetchitem', e);
                }
            });
            if (window && window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] respawn complete');
        } catch (e) {
            console.error('[interactiveObjects] respawnFetchItems failed', e);
        }
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
        // Log click for fetch items to help debug raycast/click issues
        try {
            if (config && config.isFetchItem) {
                console.log('[interactiveObjects] fetchitem clicked ->', object.name || '<unnamed>');
            }
        } catch (e) {}
        const indicator = indicators.get(object);
        if (indicator) {
            indicator.style.display = 'none';
        }
        
        // Set cooldown time
        cooldownEndTime = Date.now() + clickCooldown;

        // If this object is a fetch item, mark it collected immediately
        if (config && config.isFetchItem) {
            try {
                const idx = getFetchItemIndexByName(config.objectName || object.name);
                const setter = window && window.boisvertGame && window.boisvertGame.setItemChecked;
                if (typeof setter === 'function' && idx >= 0) {
                    try { window.boisvertGame.setItemChecked(idx, true); } catch (e) { /* ignore */ }
                }
            } catch (e) {
                console.warn('[interactiveObjects] fetchitem marking failed', e);
            }

            // Fly up by +0.5 on Y over 5 seconds and rotate around Z while flying
            try {
                const targetY = (object.position && typeof object.position.y === 'number') ? object.position.y + 0.5 : 0.5;
                gsap.to(object.position, {
                    y: targetY,
                    duration: 5,
                    ease: 'power1.out',
                    onComplete: () => {
                        try { object.visible = false; } catch (e) {}
                    }
                });

                // Rotate around Z axis while flying up (2 full rotations)
                const rotTarget = (object.rotation && typeof object.rotation.z === 'number') ? object.rotation.z + Math.PI * 4 : Math.PI * 4;
                gsap.to(object.rotation, {
                    z: rotTarget,
                    duration: 5,
                    ease: 'none'
                });
            } catch (e) {
                try { object.visible = false; } catch (e) {}
            }
        }

        // Store target position for jitter reference and animate to target if provided
        if (Array.isArray(targetPos) && targetPos.length >= 3) {
            object.userData.targetPosition = new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2] + zOffset);

            // Animate to target position
            gsap.to(object.position, {
                x: targetPos[0],
                y: targetPos[1],
                z: targetPos[2] + zOffset,
                duration: moveDuration,
                ease: 'power2.inOut',
                onComplete: () => {
                    try {
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
                            try {
                                if (!window.__colaAudio) {
                                    window.__colaAudio = new Audio('src/sounds/cola-drink.mp3');
                                    window.__colaAudio.preload = 'auto';
                                }
                                const playPromise = window.__colaAudio.play();
                                if (playPromise && typeof playPromise.then === 'function') {
                                    playPromise.catch(() => { /* ignore autoplay rejection */ });
                                }
                            } catch (audioErr) {
                                console.warn('[interactiveObjects] cola audio failed to play', audioErr);
                            }
                            if (popup) popup.style.display = 'block';
                            try { window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_cola'); } catch(e) {}
                        }

                        // Show Resume popup for paper
                        if (config.objectName === 'paper') {
                            const popup = document.getElementById('resumePopup');
                            if (popup) popup.style.display = 'block';
                            try { window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_paper'); } catch(e) {}
                            // Set Resume.webp as paper texture
                            object.traverse((child) => {
                                if (child.isMesh && child.material) {
                                    const loader = new THREE.TextureLoader();
                                    loader.load('src/textures/Resume.webp', (texture) => {
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
                            if (popup) popup.style.display = 'block';
                            try { window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_painting'); } catch(e) {}
                        }

                        // Check composite: if all three clicked achievements + watched_screen unlocked, award master_interactor
                        try {
                            const ach = window.achievements;
                            if (ach && typeof ach.isUnlocked === 'function') {
                                const all = ach.isUnlocked('clicked_paper') && ach.isUnlocked('clicked_painting') && ach.isUnlocked('clicked_cola') && ach.isUnlocked('watched_screen');
                                if (all) { try { ach.unlock('master_interactor'); } catch(e) {} }
                            }
                        } catch(e) {}
                    } catch (err) {
                        // ensure onComplete doesn't break the flow
                        console.warn('[interactiveObjects] onComplete error', err);
                    }
                }
            });

        }

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
        // Handle pointerdown for interactive objects (allow clicks even if controls report dragging)
        // Check if camera is at an allowed position
        // Debug: log pointerdown entry and camera allowed state
        let cameraAllowed = true;
        try {
            const rectDbg = domElement.getBoundingClientRect();
            const clientXD = event.clientX || (event.touches && event.touches[0] && event.touches[0].clientX) || (event.changedTouches && event.changedTouches[0] && event.changedTouches[0].clientX) || 0;
            const clientYD = event.clientY || (event.touches && event.touches[0] && event.touches[0].clientY) || (event.changedTouches && event.changedTouches[0] && event.changedTouches[0].clientY) || 0;
            cameraAllowed = isCameraAtAllowedPosition();
            console.log('[interactiveObjects] pointerdown at', { clientX: clientXD, clientY: clientYD, domRect: { left: rectDbg.left, top: rectDbg.top, width: rectDbg.width, height: rectDbg.height }, cameraAllowed });
        } catch (e) {}
        
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
        try {
            console.log('[interactiveObjects] raycastTargets count=', raycastTargets.length, 'interactiveObjects=', interactiveObjects.length, 'interactive names=', interactiveObjects.map(o=>o.name));
        } catch (e) {}
        
        const intersects = raycaster.intersectObjects(raycastTargets, false);

        // Determine whether the click hit a fetchitem in either the raycastTargets or the whole scene.
        let clickedIsFetchItem = false;
        let fullHitsCache = null;
        try {
            if (!intersects || intersects.length === 0) {
                // Fallback debug: see what the ray hits against the whole scene
                fullHitsCache = raycaster.intersectObjects(scene.children, true);
                if (fullHitsCache && fullHitsCache.length > 0) {
                    const fh = fullHitsCache[0];
                    let chain = [];
                    try { let p = fh.object; while(p) { chain.push(p.name || p.type); if (p.name && p.name.toLowerCase().includes('fetchitem')) clickedIsFetchItem = true; p = p.parent; } } catch(e){}
                    console.log('[interactiveObjects] fallback top scene hit:', { name: fh.object.name, uuid: fh.object.uuid, distance: fh.distance, parentChain: chain });
                } else {
                    console.log('[interactiveObjects] no intersects on raycastTargets and nothing hit in whole scene');
                }
            } else {
                const top = intersects[0].object;
                let chain = [];
                try { let p = top; while(p) { chain.push(p.name || p.type); if (p.name && p.name.toLowerCase().includes('fetchitem')) clickedIsFetchItem = true; p = p.parent; } } catch(e){}
                console.log('[interactiveObjects] top intersect on raycastTargets:', { name: top.name, uuid: top.uuid, parentChain: chain });
            }
        } catch (e) {}

        // If camera is not at an allowed position and the click did not hit a fetch item, ignore the click
        if (!cameraAllowed && !clickedIsFetchItem) {
            if (window && window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] click ignored: camera not at allowed position and not a fetchitem');
            return;
        }
        if (intersects.length > 0) {
            const initialHit = intersects[0].object;
            let clicked = initialHit;

            // Walk up the tree to find the interactive object
            while (clicked && !clicked.userData.isInteractive) {
                clicked = clicked.parent;
            }

            // If we couldn't find a registered interactive ancestor, but the hit or one of its parents
            // is a fetchitem (name contains 'fetchitem'), auto-register a minimal config and treat it as clicked.
            if ((!clicked || !clicked.userData || !clicked.userData.isInteractive) && initialHit) {
                try {
                    let p = initialHit;
                    let fetchCandidate = null;
                    while (p) {
                        try {
                            if (p.name && p.name.toLowerCase().includes('fetchitem')) {
                                fetchCandidate = p;
                                break;
                            }
                        } catch (e) {}
                        p = p.parent;
                    }

                    if (fetchCandidate) {
                        // If not already interactive, set minimal userData so onObjectClick can operate
                        if (!fetchCandidate.userData || !fetchCandidate.userData.isInteractive) {
                            try {
                                fetchCandidate.userData = fetchCandidate.userData || {};
                                fetchCandidate.userData.originalPosition = fetchCandidate.position.clone();
                                fetchCandidate.userData.originalRotation = fetchCandidate.rotation.clone();
                                fetchCandidate.userData.isInteractive = true;
                                fetchCandidate.userData.config = {
                                    objectName: fetchCandidate.name || 'fetchitem',
                                    clickCooldown: 300,
                                    moveDuration: 0.6,
                                    shouldRotate: false,
                                    shouldJitter: false,
                                    isFetchItem: true
                                };
                                // add to interactiveObjects list so indicators/updates include it
                                interactiveObjects.push(fetchCandidate);
                            } catch (e) {
                                console.warn('[interactiveObjects] failed to auto-register fetchCandidate', e);
                            }
                        }

                        // Treat this as the clicked interactive object
                        clicked = fetchCandidate;
                    }
                } catch (e) {
                    // ignore and continue
                }
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

        // Now project the world position to normalized device coordinates
        const vector = worldPos.clone();
        vector.project(camera);

        // Optional: occlusion test (is object visible from camera?)
        if (ENABLE_INDICATOR_OCCLUSION || window.__ENABLE_INDICATOR_OCCLUSION) {
            const dir = new THREE.Vector3().subVectors(worldPos, camera.position).normalize();
            raycaster.set(camera.position, dir);
            const distanceToObj = camera.position.distanceTo(worldPos);
            // Intersect with the whole scene to detect occluders
            const hits = raycaster.intersectObjects(scene.children, true);
            if (hits && hits.length > 0) {
                const first = hits[0];
                if (first.distance < distanceToObj - 0.05 && first.object !== object) {
                    // Something is blocking the view of the object
                    if (window.__DEBUG_INDICATORS) console.debug('[indicator] occluded:', object.name, 'hit=', first.object.name, 'hitDist=', first.distance, 'objDist=', distanceToObj);
                    indicator.style.display = 'none';
                    return;
                }
            }
        }

        // Debug logging to help track mirrored/duplicate indicators
        if (window.__DEBUG_INDICATORS) {
            try {
                const dot = toObject.dot(camDir);
                const screenX = (vector.x * 0.5 + 0.5) * window.innerWidth;
                const screenY = (vector.y * -0.5 + 0.5) * window.innerHeight;
                console.debug('[indicator] show', { name: object.name, uuid: object.uuid, worldPos: worldPos.toArray(), dot, screen: { x: screenX, y: screenY }, hasBeenClicked: !!object.userData.hasBeenClicked });
                // Log parent chain for context
                let p = object.parent;
                const chain = [];
                while (p) { chain.push(p.name || p.type); p = p.parent; }
                console.debug('[indicator] parentChain', chain.join(' -> '));
            } catch (err) {
                console.warn('[indicator] debug error', err);
            }
        }
        
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

    // Auto-detect any scene objects that include "fetchitem" in their name
    // These are the collectible items for the Boisvert chase and are made interactive.
    // Items may be added asynchronously (GLTFLoader), and some scenes add them before
    // this setup runs. We provide (A) an initial scan, (B) a monkey-patch to catch
    // future additions, and (C) an exposed force-register helper you can call after
    // models finish loading.
    let __originalSceneAdd = null;

    function registerFetchItemsInTree(root) {
        try {
            if (!root) return;
            root.traverse((child) => {
                try {
                    if (child && child.name && child.name.toLowerCase().includes('fetchitem')) {
                        // Avoid double-registration
                        if (child.userData && child.userData.isInteractive) {
                            if (window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] fetchitem already registered:', child.name);
                            return;
                        }

                        if (window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] Registering fetchitem:', child.name, 'uuid=', child.uuid);
                        const cfg = {
                            objectName: child.name,
                            clickCooldown: 300,
                            moveDuration: 0.6,
                            shouldRotate: false,
                            shouldJitter: false,
                            isFetchItem: true
                        };
                        setupInteractiveObject(child, cfg);
                        if (window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] fetchitem registered successfully:', child.name);
                    }
                } catch (e) {
                    console.error('[interactiveObjects] Error registering individual fetchitem:', e);
                }
            });
        } catch (e) {
            console.error('[interactiveObjects] Error in registerFetchItemsInTree:', e);
        }
    }

    // Register existing items now (scan the whole scene)
    try {
        console.log('[interactiveObjects] Starting initial fetchitem registration...');
        registerFetchItemsInTree(scene);
        const found = interactiveObjects.filter(o => o.userData && o.userData.config && o.userData.config.isFetchItem).length;
        console.log('[interactiveObjects] Initial fetchitem registration complete. Found:', found, 'fetch items');
    } catch (e) {
        console.error('[interactiveObjects] Initial fetchitem registration failed:', e);
    }

    // Monkey-patch scene.add to auto-register any fetchitems added later
    try {
        if (scene && typeof scene.add === 'function') {
            __originalSceneAdd = scene.add.bind(scene);
            scene.add = function(...objs) {
                const res = __originalSceneAdd(...objs);
                try {
                    if (window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] scene.add called with', objs.length, 'objects');
                    for (const o of objs) {
                        // register any fetchitems inside the added subtree
                        registerFetchItemsInTree(o);
                    }
                } catch (e) {
                    console.error('[interactiveObjects] Error in scene.add monkey-patch:', e);
                }
                return res;
            };
            console.log('[interactiveObjects] scene.add monkey-patched successfully');
        }
    } catch (e) {
        console.error('[interactiveObjects] Failed to monkey-patch scene.add:', e);
    }

    // Register with cursor manager for hover detection
    registerInteractiveManager(() => interactiveObjects);

    // Add event listeners
    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('touchstart', onPointerDown, { passive: false });

    // Setup close button handlers for all popups
    setupPopupCloseButtons();

    // Prepare manager object so we can expose helpers and restore state on dispose
    const manager = {
        update,
        forceRegisterFetchItems() {
            try {
                console.log('[interactiveObjects] Force re-registering all fetchitems...');
                registerFetchItemsInTree(scene);
                console.log('[interactiveObjects] Force registration complete. Total interactive:', interactiveObjects.length);
            } catch (e) {
                console.error('[interactiveObjects] forceRegisterFetchItems failed:', e);
            }
        },
        respawnFetchItems,
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
            // restore scene.add if we patched it
            try {
                if (__originalSceneAdd && scene && scene.add) {
                    scene.add = __originalSceneAdd;
                }
            } catch (e) {}

            // Remove any global event listeners we added for respawn
            try {
                if (typeof window !== 'undefined') {
                    try { window.removeEventListener('boisvert:teleportToStart', _teleportListener); } catch(e) {}
                    try { window.removeEventListener('boisvert:playerLost', _lostListener); } catch(e) {}
                    try { window.removeEventListener('boisvert:dlcAreaEntered', _dlcEnterListener); } catch(e) {}
                }
            } catch (e) {}
        }
    };

    // Auto-respawn hooks: listen for some common custom events the main app can dispatch.
    // The main app can dispatch e.g. window.dispatchEvent(new CustomEvent('boisvert:teleportToStart'))
    // when the player is teleported back to start, or 'boisvert:playerLost' when they lose,
    // or 'boisvert:dlcAreaEntered' when they enter the DLC area again.
    let _teleportListener = null;
    let _lostListener = null;
    let _dlcEnterListener = null;
    try {
        if (typeof window !== 'undefined') {
            _teleportListener = () => { respawnFetchItems(); };
            _lostListener = () => { respawnFetchItems(); };
            _dlcEnterListener = () => { respawnFetchItems(); };
            window.addEventListener('boisvert:teleportToStart', _teleportListener);
            window.addEventListener('boisvert:playerLost', _lostListener);
            window.addEventListener('boisvert:dlcAreaEntered', _dlcEnterListener);
            if (window.__DEBUG_INTERACTIVE) console.log('[interactiveObjects] respawn event listeners added');
        }
    } catch (e) {
        console.warn('[interactiveObjects] failed to add respawn listeners', e);
    }

    // Expose manager for manual control and debugging
    try {
        window.interactiveObjectsManager = manager;
    } catch (e) {}

    return manager;
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
