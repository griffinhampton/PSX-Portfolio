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
    // Track lantern state and camera position for auto-reset
    let lastCameraPosition = null;
    let activeLanterns = new Set(); // Track which lanterns are currently off
    const CAMERA_MOVEMENT_THRESHOLD = 0.5; // How much camera must move to trigger reset
    // NOTE: interactive indicators have been removed globally per UX request.
    // This file no longer creates or manages DOM "exclamation" indicators.
    
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
     * Check if camera has moved significantly from last position
     */
    function hasCameraMoved() {
        if (!lastCameraPosition) {
            lastCameraPosition = camera.position.clone();
            return false;
        }
        
        const currentPos = camera.position;
        const distance = Math.sqrt(
            Math.pow(currentPos.x - lastCameraPosition.x, 2) +
            Math.pow(currentPos.y - lastCameraPosition.y, 2) +
            Math.pow(currentPos.z - lastCameraPosition.z, 2)
        );
        
        if (distance > CAMERA_MOVEMENT_THRESHOLD) {
            lastCameraPosition = currentPos.clone();
            return true;
        }
        
        return false;
    }

    /**
     * Turn a lantern back on (reset its lights)
     */
    function resetLantern(object) {
        try {
            const lights = findLanternLights(object);
            
            if (!lights || lights.length === 0) {
                // Try to use global manager
                if (typeof window !== 'undefined') {
                    const gm = window.lightsManager || window.lights || window.sceneLights || window.lightController;
                    if (gm && typeof gm.turnOn === 'function') {
                        try {
                            gm.turnOn(object.name || 'lantern');
                            return;
                        } catch (e) {}
                    }
                }
                return;
            }
            
            // Turn all associated lights back on
            lights.forEach(light => {
                try {
                    if (typeof light.intensity === 'number') {
                        // Restore saved intensity or use default
                        light.intensity = (light.userData && light.userData._savedIntensity) 
                            ? light.userData._savedIntensity 
                            : 1;
                    } else if ('visible' in light) {
                        light.visible = true;
                    }
                } catch (e) {
                    try { 
                        if ('visible' in light) light.visible = true; 
                    } catch (ee) {}
                }
            });
            
            // Update persistent state
            try {
                const key = (object && object.uuid) ? object.uuid : (object && object.name) ? object.name : 'lantern';
                if (typeof window !== 'undefined') {
                    try { 
                        window.__lanternLightStates = window.__lanternLightStates || {};
                        window.__lanternLightStates[key] = true; 
                    } catch (e) {}
                    
                    // Update localStorage
                    try {
                        if (window.localStorage) {
                            const prev = localStorage.getItem('lanternLightStates');
                            const map = prev ? JSON.parse(prev) : {};
                            map[key] = true;
                            localStorage.setItem('lanternLightStates', JSON.stringify(map));
                        }
                    } catch (e) {}
                }
            } catch (e) {}
            
            // Remove from active lanterns set
            activeLanterns.delete(object.uuid || object.name);
            
        } catch (e) {
            console.warn('[interactiveObjects] resetLantern error', e);
        }
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
        // Make cola visually unlit like painting/screen/paper so it "glows" and isn't affected by scene lights
        // Also boost brightness: multiply the base color and disable tone mapping so it appears brighter
        if (config.objectName === 'cola') {
            object.traverse((child) => {
                if (child.isMesh && child.material) {
                    try {
                        const oldMaterial = child.material;
                        // Preserve texture where possible
                        const map = oldMaterial.map || null;
                        if (map) {
                            try { map.encoding = THREE.sRGBEncoding; map.needsUpdate = true; } catch (e) {}
                        }

                        // Determine a base color (fall back to white if none)
                        const baseColor = (oldMaterial.color && oldMaterial.color.clone) ? oldMaterial.color.clone() : new THREE.Color(1, 1, 1);
                        // Brightness multiplier - tweak this value to make cola brighter/dimmer
                        const BRIGHTNESS_MULTIPLIER = 1.6;
                        baseColor.multiplyScalar(BRIGHTNESS_MULTIPLIER);

                        const unlitMaterial = new THREE.MeshBasicMaterial({
                            map: map,
                            color: baseColor,
                            transparent: !!oldMaterial.transparent,
                            opacity: (typeof oldMaterial.opacity === 'number') ? oldMaterial.opacity : 1,
                            side: oldMaterial.side || THREE.FrontSide,
                            alphaTest: (typeof oldMaterial.alphaTest === 'number') ? oldMaterial.alphaTest : 0
                        });

                        // Prevent tone mapping from dimming the unlit material
                        try { unlitMaterial.toneMapped = false; } catch (e) {}

                        child.material = unlitMaterial;
                        child.material.needsUpdate = true;

                        if (oldMaterial.dispose) {
                            try { oldMaterial.dispose(); } catch (e) {}
                        }
                    } catch (e) {
                        // ignore material conversion failures
                    }
                }
            });
        }
        // Mark lanterns so we can toggle lights when clicked
        if (config.objectName === 'lantern' || (object.name && object.name.toLowerCase().includes('lantern'))) {
            object.userData.isLantern = true;
            // lanterns shouldn't jitter/rotate by default
            object.userData.shouldRotate = false;
            object.userData.shouldJitter = false;
        }
        object.userData.shouldJitter = false; // Will be set to true after click
        object.userData.targetPosition = null; // Store target position for jitter
        object.userData.hasBeenClicked = false; // Track if object has been clicked

        interactiveObjects.push(object);

        // No DOM indicators are created for interactive objects.
    }

    // Developer debug helpers removed: click-log and verbose debug flags
    
    // createIndicator removed — indicators intentionally omitted.

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
        // Use a CD / disc fetchitem for the third hunt item
        if ((n.includes('cd') || n.includes('disc') || n.includes('compact')) && n.includes('fetchitem')) return 2; // cd fetchitem
        return -1;
    }

    /**
     * Determine whether the Boisvert chase is currently active.
     * We check a few possible globals/properties to be tolerant of different modules.
     */
    function isChaseActive() {
        try {
            if (typeof window === 'undefined') return false;
            const bt = window.boisvertTeleporterManager;
            const bg = window.boisvertGame;
            // common property names used across modules
            if (bt) {
                // The teleporter manager exposes an `update` function which carries
                // an internal `_chaseActive` flag (see boisvertTeleporter.js). Check that first.
                try {
                    if (bt.update && bt.update._chaseActive) return true;
                } catch (e) {}
                if (bt.isChaseActive || bt.chaseActive || bt._isChaseActive) return true;
                if (typeof bt.isChasing === 'boolean') return !!bt.isChasing;
            }
            if (bg) {
                if (bg.isChasing || bg.chaseActive || bg.inChase) return true;
                // some code paths may put the chase flag on the bg.update object
                try { if (bg.update && bg.update._chaseActive) return true; } catch (e) {}
            }
        } catch (e) {
            // ignore
        }
        return false;
    }

    /**
     * Respawn (reset) all fetch items: restore visibility, position, rotation and game-state.
     * This will also clear any active tweens on the object so it returns to its original pose.
     */
    function respawnFetchItems() {
        try {
            // respawning all fetch items
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

                    // Fetch items should not display the exclamation indicator.
                    // (Indicator creation for fetch items is intentionally skipped.)
                } catch (e) {
                    console.warn('[interactiveObjects] Error respawning individual fetchitem', e);
                }
            });
            // respawn complete
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
        // If this is a lantern, toggle its associated light(s) and don't run the normal movement flow
        try {
            if (object.userData && object.userData.isLantern) {
                try { toggleLantern(object); } catch (e) { console.warn('[interactiveObjects] toggleLantern failed', e); }
                // Ensure lanterns can be toggled repeatedly without waiting for cooldown/reset
                try { currentlyActiveObject = null; cooldownEndTime = 0; } catch (e) {}
                return;
            }
        } catch (e) {}
        
        // Mark as clicked and hide indicator
        object.userData.hasBeenClicked = true;
        // Log click for fetch items to help debug raycast/click issues
        try {
            if (config && config.isFetchItem) {
                // fetchitem clicked
            }
        } catch (e) {}
        // No DOM indicators to hide (removed globally).
        
        // Set cooldown time
        cooldownEndTime = Date.now() + clickCooldown;

        // If this object is a fetch item, mark it collected immediately
        if (config && config.isFetchItem) {
            try {
                const objName = (config.objectName || object.name || '').toLowerCase();
                // If this is the easter egg, only award the achievement and do NOT mark the hunt item
                if (objName.includes('easter')) {
                    try {
                        if (window && window.achievements && typeof window.achievements.unlock === 'function') {
                            window.achievements.unlock('clicked_easter');
                        }
                    } catch (e) {}
                } else {
                    const idx = getFetchItemIndexByName(config.objectName || object.name);
                    const setter = window && window.boisvertGame && window.boisvertGame.setItemChecked;
                    if (typeof setter === 'function' && idx >= 0) {
                        try { window.boisvertGame.setItemChecked(idx, true); } catch (e) { /* ignore */ }
                    }
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

        // If this object is part of Griffin's Domain (registered by name),
        // show the griffin popup immediately. These objects are often
        // registered without a targetPosition so the onComplete popup
        // path (which runs after movement) never fires.
        try {
            const nameLowerQuick = ((config.objectName || object.name) || '').toLowerCase();
            // If the name matches any of the known griffin / FNAD tokens, show the appropriate popup
            if (nameLowerQuick.includes('griffins-domain') || nameLowerQuick.includes('fnad')) {
                let popupId = 'griffinPopup';
                if (nameLowerQuick.includes('fnad-world')) popupId = 'fnadWorldPopup';
                else if (nameLowerQuick.includes('fnad-2') || nameLowerQuick.includes('fnad2')) popupId = 'fnad2Popup';

                const popup = document.getElementById(popupId);
                if (popup) {
                    popup.style.display = 'block';
                    try { popup.dataset.activeObjectUuid = object.uuid; } catch (e) {}
                }
                try { window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_griffins_domain'); } catch (e) {}
            }
        } catch (e) {}

        // Log activation details for debugging (click-to-activate)
        // debug logging removed

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

                        // Show Griffin's Domain popup for objects with 'griffins-domain' in name
                        try {
                            const nameLower = ((config.objectName || object.name) || '').toLowerCase();
                            if (nameLower.includes && (nameLower.includes('griffins-domain') || nameLower.includes('fnad'))) {
                                let popupId = 'griffinPopup';
                                if (nameLower.includes('fnad-world')) popupId = 'fnadWorldPopup';
                                else if (nameLower.includes('fnad-2') || nameLower.includes('fnad2')) popupId = 'fnad2Popup';
                                const popup = document.getElementById(popupId);
                                if (popup) {
                                    popup.style.display = 'block';
                                    try { popup.dataset.activeObjectUuid = object.uuid; } catch(e) {}
                                }
                                try { window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_griffins_domain'); } catch(e) {}
                            }
                        } catch (e) {}

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
        // Allow this object to be clicked again
        try { object.userData.hasBeenClicked = false; } catch (e) {}
        // No indicators to restore (indicators removed).
        
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

        // Hide Griffin's Domain / FNAD popup when relevant objects reset
        try {
            const nameLower = ((config.objectName || object.name) || '').toLowerCase();
            if (nameLower.includes && (nameLower.includes('griffins-domain') || nameLower.includes('fnad'))) {
                let popupId = 'griffinPopup';
                if (nameLower.includes('fnad-world')) popupId = 'fnadWorldPopup';
                else if (nameLower.includes('fnad-2') || nameLower.includes('fnad2')) popupId = 'fnad2Popup';
                const popup = document.getElementById(popupId);
                if (popup) {
                    popup.style.display = 'none';
                    try { delete popup.dataset.activeObjectUuid; } catch (e) {}
                }
            }
        } catch (e) {}

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
            // raycastTargets computed
        } catch (e) {}
        
        const intersects = raycaster.intersectObjects(raycastTargets, false);

    // Determine whether the click hit a fetchitem or a griffins-domain object in either the raycastTargets or the whole scene.
        let clickedIsFetchItem = false;
        let clickedIsGriffin = false;
        let fullHitsCache = null;
        try {
            if (!intersects || intersects.length === 0) {
                // Fallback debug: see what the ray hits against the whole scene
                fullHitsCache = raycaster.intersectObjects(scene.children, true);
                if (fullHitsCache && fullHitsCache.length > 0) {
                    const fh = fullHitsCache[0];
                    let chain = [];
                                try {
                                    let p = fh.object;
                                    while (p) {
                                        chain.push(p.name || p.type);
                                        try {
                                            const nm = (p.name || '').toLowerCase();
                                            if (nm && nm.includes('fetchitem')) clickedIsFetchItem = true;
                                            // Treat any node whose name contains 'fnad' as a griffin-like object
                                            if (nm && (nm.includes('griffins-domain') || nm.includes('fnad'))) clickedIsGriffin = true;
                                        } catch (ee) {}
                                        p = p.parent;
                                    }
                                } catch(e){}
                    // fallback top scene hit computed
                } else {
                    // no intersects on raycastTargets and nothing hit in whole scene
                }
            } else {
                const top = intersects[0].object;
                let chain = [];
                try {
                    let p = top;
                    while (p) {
                        chain.push(p.name || p.type);
                        try {
                            const nm = (p.name || '').toLowerCase();
                            if (nm && nm.includes('fetchitem')) clickedIsFetchItem = true;
                            if (nm && (nm.includes('griffins-domain') || nm.includes('fnad'))) clickedIsGriffin = true;
                        } catch (ee) {}
                        p = p.parent;
                    }
                } catch(e){}
                // top intersect on raycastTargets computed
            }
        } catch (e) {}

        // (raycast intermediate debug entry removed)

        // If camera is not at an allowed position and the click did not hit a fetch item or a griffins-domain object, ignore the click
        if (!cameraAllowed && !clickedIsFetchItem && !clickedIsGriffin) {
            // camera not at allowed position; ignore click
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
                // If this interactive is a fetch item and the chase isn't active, ignore clicks
                try {
                    const cfg = clicked.userData.config || {};
                    const isFetch = !!cfg.isFetchItem;
                    const nameLower = ((cfg.objectName || clicked.name) || '').toLowerCase();
                    const isEaster = nameLower.includes && nameLower.includes('easter');
                    if (isFetch && !isEaster && !isChaseActive()) {
                        // Treat as a non-interactive click: reset any active object if cooldown elapsed
                        if (currentlyActiveObject) {
                            if (Date.now() >= cooldownEndTime) {
                                resetObject(currentlyActiveObject);
                                currentlyActiveObject = null;
                                cooldownEndTime = 0;
                            }
                        }
                        return;
                    }
                } catch (e) {
                    // ignore and continue
                }
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
                    // Prevent activating objects that are occluded by walls (don't allow clicking through geometry)
                    try {
                        if (isOccludedByWalls(clicked)) {
                            // Click hit is occluded by wall geometry; ignore the click
                            return;
                        }
                    } catch (e) {}

                    // Enforce proximity: only allow activation if the user (camera) is within 10 units
                    try {
                        const _pos = new THREE.Vector3();
                        clicked.getWorldPosition(_pos);
                        const _dist = camera.position.distanceTo(_pos);
                        if (typeof _dist === 'number' && _dist > 10) {
                            // Too far away to interact
                            return;
                        }
                    } catch (e) {
                        // if anything goes wrong determining distance, fall back to allowing the click
                    }

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
        
        // NEW: Check if camera has moved and reset any active lanterns
        if (hasCameraMoved && typeof hasCameraMoved === 'function' && activeLanterns.size > 0) {
            try {
                if (hasCameraMoved()) {
                    const lanternsToReset = Array.from(activeLanterns);
                    lanternsToReset.forEach(lanternKey => {
                        let lanternObject = null;
                        interactiveObjects.forEach(obj => {
                            try {
                                if (obj.userData && obj.userData.isLantern) {
                                    const key = obj.uuid || obj.name;
                                    if (key === lanternKey) lanternObject = obj;
                                }
                            } catch (e) {}
                        });
                        if (lanternObject) {
                            try { resetLantern(lanternObject); } catch (e) {}
                        }
                    });
                    activeLanterns.clear();
                }
            } catch (e) {
                // ignore camera-reset errors
            }
        }

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
            
            // Indicators have been removed; nothing to update per-frame.
        });
    }
    

    /**
     * Determine whether the given object is occluded from the camera by
     * the 'backrooms-walls' (or other wall-like) geometry. Returns true
     * if a wall is closer to the camera than the object along the ray.
     */
    function isOccludedByWalls(object) {
        try {
            if (!object) return false;
            // Get world position of the object (use canonical if available)
            const worldPos = new THREE.Vector3();
            object.getWorldPosition(worldPos);

            // Direction from camera to object
            const dir = new THREE.Vector3().subVectors(worldPos, camera.position);
            const distanceToObj = dir.length();
            if (distanceToObj <= 0.0001) return false;
            dir.normalize();

            // Raycast into the scene to find the first hit
            raycaster.set(camera.position, dir);
            const hits = raycaster.intersectObjects(scene.children, true);
            if (!hits || hits.length === 0) return false;

            const first = hits[0];
            // If the first hit is the object itself (or a descendant), it's not occluded
            let p = first.object;
            while (p) {
                if (p === object) return false;
                p = p.parent;
            }

            // If the first hit is very near the distance to the object, allow it
            if (first.distance >= distanceToObj - 0.05) return false;

            // Otherwise check whether the first hit is a wall/backrooms geometry
            try {
                p = first.object;
                while (p) {
                    const nm = (p.name || '').toLowerCase();
                    if (nm && (nm.includes('walls') || nm.includes('wall') || nm.includes('backrooms'))) {
                        return true;
                    }
                    p = p.parent;
                }
            } catch (e) {
                // ignore
            }

            return false;
        } catch (e) {
            return false;
        }
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

    let __originalSceneAdd = null;

    function registerFetchItemsInTree(root) {
        try {
            if (!root) return;
            root.traverse((child) => {
                try {
                    if (child && child.name && child.name.toLowerCase().includes('fetchitem')) {
                        // Avoid double-registration
                        if (child.userData && child.userData.isInteractive) {
                            return;
                        }
                        const cfg = {
                            objectName: child.name,
                            clickCooldown: 300,
                            moveDuration: 0.6,
                            shouldRotate: false,
                            shouldJitter: false,
                            isFetchItem: true
                        };
                        setupInteractiveObject(child, cfg);
                    }
                    // Also auto-register any objects containing 'griffins-domain' or 'fnad' in their name
                    try {
                        const lname = child && child.name && child.name.toLowerCase();
                        if (lname && (lname.includes('griffins-domain') || lname.includes('fnad'))) {
                            // Avoid double-registration
                            if (child.userData && child.userData.isInteractive) {
                                return;
                            }
                            const cfg2 = {
                                objectName: child.name,
                                clickCooldown: 300,
                                moveDuration: 1.5,
                                shouldRotate: false,
                                shouldJitter: false,
                                isFetchItem: false
                            };
                            setupInteractiveObject(child, cfg2);
                        }
                        // Auto-register lantern objects by name
                        const lname2 = child && child.name && child.name.toLowerCase();
                        if (lname2 && lname2.includes('lantern')) {
                            if (child.userData && child.userData.isInteractive) {
                                return;
                            }
                            const cfgL = {
                                objectName: child.name,
                                clickCooldown: 200,
                                moveDuration: 0.2,
                                shouldRotate: false,
                                shouldJitter: false,
                                isLantern: true
                            };
                            setupInteractiveObject(child, cfgL);
                        }
                    } catch (e) {
                        // ignore individual child errors
                    }
                } catch (e) {
                    console.error('[interactiveObjects] Error registering individual fetchitem:', e);
                }
            });
        } catch (e) {
            console.error('[interactiveObjects] Error in registerFetchItemsInTree:', e);
        }
    }

    /**
     * MODIFIED toggleLantern function - tracks when lanterns are turned off
     * (Placed inside setupInteractiveObjects so it can access activeLanterns)
     */
    function toggleLantern(object) {
        try {
            // ensure an in-memory cache exists for lantern states
            try { if (typeof window !== 'undefined') window.__lanternLightStates = window.__lanternLightStates || {}; } catch (e) {}
            const lights = findLanternLights(object);
            if ((!lights || lights.length === 0) && typeof window !== 'undefined') {
                // try to let a manager handle it
                const gm = window.lightsManager || window.lights || window.sceneLights || window.lightController;
                if (gm) {
                    try {
                        // try a few common method names
                        if (typeof gm.toggleLight === 'function') {
                            gm.toggleLight(object.name || 'lantern');
                            return;
                        }
                        if (typeof gm.toggle === 'function') {
                            gm.toggle(object.name || 'lantern');
                            return;
                        }
                        if (typeof gm.toggleByName === 'function') {
                            gm.toggleByName(object.name || 'lantern');
                            return;
                        }
                    } catch (e) {}
                }
            }

            if (!lights || lights.length === 0) {
                // nothing found — bail
                return;
            }

            let wasOn = false;
            let nowOn = false;
            
            lights.forEach(light => {
                try {
                    // Check if currently on
                    if (typeof light.intensity === 'number') {
                        if (light.intensity > 0) wasOn = true;
                    } else if ('visible' in light && light.visible) {
                        wasOn = true;
                    }
                    
                    // Toggle
                    if (typeof light.intensity === 'number') {
                        if (light.intensity > 0) {
                            light.userData = light.userData || {};
                            light.userData._savedIntensity = light.intensity;
                            light.intensity = 0;
                        } else {
                            light.intensity = (light.userData && light.userData._savedIntensity) ? light.userData._savedIntensity : 1;
                            nowOn = true;
                        }
                    } else if ('visible' in light) {
                        light.visible = !light.visible;
                        if (light.visible) nowOn = true;
                    }
                } catch (e) {
                    try { if ('visible' in light) light.visible = !light.visible; } catch (ee) {}
                }
            });
            
            // Track lantern state for auto-reset
            const key = (object && object.uuid) ? object.uuid : (object && object.name) ? object.name : 'lantern';
            
            // If we just turned it off, add to active lanterns set
            if (wasOn && !nowOn) {
                activeLanterns.add(key);
            } else if (nowOn) {
                activeLanterns.delete(key);
            }
            
            // Persist the resulting on/off state
            try {
                let anyOn = nowOn;
                lights.forEach(l => {
                    try {
                        if (typeof l.intensity === 'number') {
                            if (l.intensity > 0) anyOn = true;
                        } else if ('visible' in l) {
                            if (l.visible) anyOn = true;
                        }
                    } catch (e) {}
                });
                try { if (typeof window !== 'undefined') window.__lanternLightStates[key] = !!anyOn; } catch (e) {}
                try {
                    if (typeof window !== 'undefined' && window.localStorage) {
                        const prev = localStorage.getItem('lanternLightStates');
                        const map = prev ? JSON.parse(prev) : {};
                        map[key] = !!anyOn;
                        localStorage.setItem('lanternLightStates', JSON.stringify(map));
                    }
                } catch (e) {}
            } catch (e) {}
        } catch (e) {
            console.warn('[interactiveObjects] toggleLantern error', e);
        }
    }

    // Register existing items now (scan the whole scene)
    try {
        registerFetchItemsInTree(scene);
        const found = interactiveObjects.filter(o => o.userData && o.userData.config && o.userData.config.isFetchItem).length;
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
                    for (const o of objs) {
                        // register any fetchitems inside the added subtree
                        registerFetchItemsInTree(o);
                    }
                } catch (e) {
                    console.error('[interactiveObjects] Error in scene.add monkey-patch:', e);
                }
                return res;
            };
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
                registerFetchItemsInTree(scene);
                // force re-registration complete
            } catch (e) {
                console.error('[interactiveObjects] forceRegisterFetchItems failed:', e);
            }
        },
        respawnFetchItems,
        // Clear the currently active object if it matches the provided object.
        // This allows external callers (popup close handlers) to tell the manager
        // to reset state for an object that was clicked and to allow it to be
        // clicked again immediately.
        clearActiveObject(obj) {
            try {
                if (currentlyActiveObject && obj && currentlyActiveObject === obj) {
                    try { resetObject(currentlyActiveObject); } catch (e) {}
                    currentlyActiveObject = null;
                    cooldownEndTime = 0;
                }
            } catch (e) {}
        },
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown);
            domElement.removeEventListener('touchstart', onPointerDown);

            // No indicator DOM cleanup required (indicators removed).
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
     * Find lights likely associated with a lantern object.
     * Tries several strategies:
     *  - explicit userData.lightUuid or lightName on the object
     *  - global light managers on window (tolerant checks)
     *  - search the scene for Light objects whose name contains 'lantern' or the object's name token
     */
    function findLanternLights(object) {
        const results = [];
        try {
            if (!object) return results;

            // 1) explicit UUID or name reference on the object
            try {
                if (object.userData && object.userData.lightUuid) {
                    const uuid = object.userData.lightUuid;
                    const found = scene.getObjectByProperty('uuid', uuid);
                    if (found && found.isLight) results.push(found);
                }
                if (object.userData && object.userData.lightName) {
                    const name = object.userData.lightName.toLowerCase();
                    scene.traverse((c) => { try { if (c.isLight && c.name && c.name.toLowerCase().includes(name)) results.push(c); } catch(e){} });
                }
                // 1b) check the object's descendants for any Light nodes (common when lantern model contains a light)
                try {
                    object.traverse && object.traverse((c) => {
                        try {
                            if (c && c.isLight) results.push(c);
                        } catch (e) {}
                    });
                } catch (e) {}
            } catch (e) {}

            // 2) try global managers (tolerant)
            try {
                const gm = (typeof window !== 'undefined') ? (window.lightsManager || window.lights || window.sceneLights || window.lightController) : null;
                if (gm) {
                    // if manager provides array or find function, try to extract lights
                    if (Array.isArray(gm)) {
                        gm.forEach(it => { try { if (it && it.isLight) results.push(it); } catch(e){} });
                    } else {
                        // hunt common methods
                        if (typeof gm.getLightByName === 'function') {
                            const candidate = gm.getLightByName(object.name || 'lantern');
                            if (candidate) results.push(candidate);
                        }
                        if (typeof gm.find === 'function') {
                            try { const found = gm.find(it => it && it.name && it.name.toLowerCase().includes('lantern')); if (found && found.isLight) results.push(found); } catch(e){}
                        }
                    }
                }
            } catch (e) {}

            // 3) scene search: any lights with 'lantern' or containing the object's name
            try {
                const token = (object.name || '').toLowerCase();
                scene.traverse((c) => {
                    try {
                        if (!c || !c.isLight) return;
                        const nm = (c.name || '').toLowerCase();
                        if (nm && (nm.includes('lantern') || (token && token.length > 0 && nm.includes(token)))) {
                            results.push(c);
                        }
                    } catch (e) {}
                });
                // 3b) also consider lights that are spatially near the lantern (within ~3 units)
                try {
                    const worldPos = new THREE.Vector3();
                    object.getWorldPosition(worldPos);
                    const proximityThresh = 3.0;
                    scene.traverse((c) => {
                        try {
                            if (!c || !c.isLight) return;
                            // If not already matched by name, check distance
                            const lp = new THREE.Vector3();
                            c.getWorldPosition(lp);
                            if (lp.distanceTo(worldPos) <= proximityThresh) results.push(c);
                        } catch (e) {}
                    });
                } catch (e) {}
            } catch (e) {}
        } catch (e) {
            // ignore
        }
        // dedupe by uuid
        const seen = new Set();
        return results.filter(l => { if (!l || !l.uuid) return false; if (seen.has(l.uuid)) return false; seen.add(l.uuid); return true; });
    }

    /**
     * Toggle the lantern's lights on/off. Uses intensity when available, otherwise toggles visibility.
     */
        // Module-level toggleLantern removed: replaced by a version inside setupInteractiveObjects

// Developer dump/clear helpers removed.

/**
 * Setup close button handlers for popup cards
 */
function setupPopupCloseButtons() {
    const closeButtons = document.querySelectorAll('.popup-close');
    
    closeButtons.forEach(button => {
        // Check if this button already has our handler attached
        if (button.dataset.closeHandlerAttached) {
            return; // Skip if already has handler
        }
        
        // Mark as handled to prevent duplicate listeners
        button.dataset.closeHandlerAttached = 'true';
        
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            
            const popupId = button.getAttribute('data-popup');
            const objectName = button.getAttribute('data-object');
            
            // Hide the popup
            const popup = document.getElementById(popupId);
            if (popup) {
                popup.style.display = 'none';
            }
            
            // Reset the associated object. Prefer to use the popup's recorded UUID
            // (set when the popup was shown) so we reliably clear the exact object
            // instance that was activated (this fixes FNAD re-open issues when the
            // scene contains different node instances / ancestors).
            try {
                if (popup && popup.dataset && popup.dataset.activeObjectUuid && window.interactiveObjectsList) {
                    const uuid = popup.dataset.activeObjectUuid;
                    const objectToResetByUuid = window.interactiveObjectsList.find(obj => obj && obj.uuid === uuid);
                    if (objectToResetByUuid) {
                        try {
                            if (window && window.interactiveObjectsManager && typeof window.interactiveObjectsManager.clearActiveObject === 'function') {
                                window.interactiveObjectsManager.clearActiveObject(objectToResetByUuid);
                            } else {
                                resetObjectToOriginal(objectToResetByUuid);
                            }
                        } catch (e) { try { resetObjectToOriginal(objectToResetByUuid); } catch (ee) {} }
                    }
                    try { delete popup.dataset.activeObjectUuid; } catch (e) {}
                    return; // handled by UUID path
                }
            } catch (e) {
                // ignore and fall back to name-based reset
            }

            // Fallback: match either exact name or substring so
            // popups that use a generic data-object like 'griffins-domain' can
            // reset objects named 'griffins-domain-xxx'.
            if (objectName && window.interactiveObjectsList) {
                // Prefer exact match, fall back to first object whose name includes the objectName token
                let objectToReset = window.interactiveObjectsList.find(obj => obj.name === objectName);
                if (!objectToReset) {
                    objectToReset = window.interactiveObjectsList.find(obj => obj.name && objectName && obj.name.toLowerCase().includes(objectName.toLowerCase()));
                    // Special-case: the griffin popup is used for FNAD objects too; allow closing to reset FNAD objects
                    if (!objectToReset && objectName === 'griffins-domain') {
                        objectToReset = window.interactiveObjectsList.find(obj => obj.name && (obj.name.toLowerCase().includes('griffins-domain') || obj.name.toLowerCase().includes('fnad')));
                    }
                }
                if (objectToReset) {
                    // Prefer asking the interactive manager to reset internal state
                    // so it can clear currentlyActiveObject and reset internal state.
                    try {
                        if (window && window.interactiveObjectsManager && typeof window.interactiveObjectsManager.clearActiveObject === 'function') {
                            window.interactiveObjectsManager.clearActiveObject(objectToReset);
                        } else {
                            // Fallback: reset via the generic helper
                            resetObjectToOriginal(objectToReset);
                        }
                    } catch (e) {
                        try { resetObjectToOriginal(objectToReset); } catch (ee) {}
                    }
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
