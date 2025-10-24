import * as THREE from 'three';
import gsap from 'gsap';
import MovementPad from './movementPad.js';

/**
 * Setup Boisvert model teleportation system
 * Teleports the boisvert model to specific positions for each camera position
 * @param {THREE.Scene} scene - The scene containing the boisvert model
 * @param {THREE.Camera} camera - The camera to track position changes
 * @param {Array} navigationPositions - Array of [x, y, z] navigation positions
 * @param {Object} controls - The camera controls (for lookAt functionality)
 * @param {Array} boisvertSpawnPositions - Array of [x, y, z] positions where boisvert spawns
 * @param {Array} boisvertZRotations - Array of Z rotations for boisvert at each position
 * @returns {Object} Manager object with update method
 */
export function setupBoisvertTeleporter(scene, camera, navigationPositions, controls, boisvertSpawnPositions, boisvertZRotations) {
    let boisvertModel = null;
    let lastCameraPosition = new THREE.Vector3();
    let currentTargetIndex = -1;
    
    // Distance threshold to detect when camera reaches a new position
    const POSITION_THRESHOLD = 1.0;
    
    // Find the boisvert model in the scene
    scene.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes('boisvert')) {
            boisvertModel = child;
        }
    });
    
    if (!boisvertModel) {
        console.error('Boisvert model not found in scene');
        // List all model names in scene for debugging
        console.log('Available models:');
        scene.traverse((child) => {
            if (child.name) {
                console.log('  -', child.name);
            }
        });
        return { update: () => {} };
    }
    
    console.log('Boisvert teleporter initialized successfully');

    // --- Walk mode variables (PC only) ---
    let walkModeActive = false;
    let walkBounds = null; // { minX, maxX, minY, maxY, minZ, maxZ }
    let walkSpeed = 2.5; // units per second
    let walkKeys = { forward: 0, back: 0, left: 0, right: 0 };
    // Analog movement for mobile movement pad (range approximately -2..2 from pad)
    let analogMove = { x: 0, z: 0 };
    let pendingWalkTarget = null; // THREE.Vector3 to enable walk after navigation completes
    const isMobileDevice = (typeof navigator !== 'undefined') && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
    // Collision helpers
    let walkCollisionWalls = null; // mesh/group to raycast against
    const walkRaycaster = new THREE.Raycaster();
    const walkPlayerRadius = 0.35; // approximate player radius in world units
    const walkCollisionMargin = 0.05;
    let movementPad = null;
    // Helper to create/destroy movement pad (allows dev forcing on desktop)
    function createMovementPad() {
        if (movementPad) return;
        try {
            movementPad = new MovementPad(document.body);

            const onMove = (ev) => {
                const d = ev.detail || {};
                // Invert X so pushing right yields positive x
                analogMove.x = (typeof d.deltaX === 'number') ? -d.deltaX : 0;
                // Y: pushing up should move forward, so keep sign
                analogMove.z = (typeof d.deltaY === 'number') ? d.deltaY : 0;
            };

            const onStop = () => { analogMove.x = 0; analogMove.z = 0; };

            movementPad.padElement.addEventListener('move', onMove);
            movementPad.padElement.addEventListener('stopMove', onStop);

            movementPad._cleanup = () => {
                try { movementPad.padElement.removeEventListener('move', onMove); } catch (e) {}
                try { movementPad.padElement.removeEventListener('stopMove', onStop); } catch (e) {}
                try { movementPad.dispose(); } catch (e) {}
                movementPad = null;
                analogMove.x = 0; analogMove.z = 0;
            };
        } catch (e) {
            console.warn('[walkMode] failed to create movement pad', e);
            movementPad = null;
        }
    }

    function destroyMovementPad() {
        if (!movementPad) return;
        try {
            if (movementPad._cleanup) movementPad._cleanup();
        } catch (e) {}
        movementPad = null;
    }

    function computeBoundsFromCenter(center, size) {
        const halfW = (size && size[0]) ? size[0] / 2 : 2;
        const halfH = (size && size[1]) ? size[1] / 2 : 1.5;
        const halfD = (size && size[2]) ? size[2] / 2 : 2;
        return {
            minX: center.x - halfW,
            maxX: center.x + halfW,
            minY: center.y - halfH,
            maxY: center.y + halfH,
            minZ: center.z - halfD,
            maxZ: center.z + halfD
        };
    }

    function enableWalkMode(centerVec3) {
        // We support walk mode on desktop (WASD) and on mobile via a movement pad.
        // Do not early-return for mobile; instead create the movement pad below.
        if (walkModeActive) return;

        // Allow overrides via global configuration: window.ADDITIONAL_NAVIGATION_BOUNDS = { center: [x,y,z], size: [w,h,d] }
        let boundsConfig = null;
        try { boundsConfig = (window.ADDITIONAL_NAVIGATION_BOUNDS && typeof window.ADDITIONAL_NAVIGATION_BOUNDS === 'object') ? window.ADDITIONAL_NAVIGATION_BOUNDS : null; } catch (e) { boundsConfig = null; }

        let center = centerVec3.clone();
        let size = null;
        if (boundsConfig && Array.isArray(boundsConfig.center) && boundsConfig.center.length >= 3) {
            center = new THREE.Vector3(boundsConfig.center[0], boundsConfig.center[1], boundsConfig.center[2]);
        }
        if (boundsConfig && Array.isArray(boundsConfig.size) && boundsConfig.size.length >= 3) {
            size = boundsConfig.size;
        }

        // Prefer to compute bounds from the scene geometry if available
        let floorMesh = null;
        let wallsMesh = null;
        try {
            // Prefer exact names, fallback to name includes
            floorMesh = scene.getObjectByName('backrooms-floor') || scene.getObjectByName('backrooms-floor-alt') || null;
            if (!floorMesh) {
                scene.traverse(o => { if (!floorMesh && o.name && o.name.toLowerCase().includes('backrooms-floor')) floorMesh = o; });
            }
            wallsMesh = scene.getObjectByName('backrooms-walls') || null;
            if (!wallsMesh) {
                scene.traverse(o => { if (!wallsMesh && o.name && o.name.toLowerCase().includes('backrooms-walls')) wallsMesh = o; });
            }
        } catch (e) {
            floorMesh = null; wallsMesh = null;
        }

        if (floorMesh) {
            // Use floor bounding box to derive X/Z extents and floor Y
            const box = new THREE.Box3().setFromObject(floorMesh);
            const min = box.min;
            const max = box.max;
            // Slight inset so player doesn't clip into walls
            const inset = 0.05;
            walkBounds = {
                minX: min.x + inset,
                maxX: max.x - inset,
                minY: min.y + 0.1,
                maxY: max.y + 2.0,
                minZ: min.z + inset,
                maxZ: max.z - inset
            };
            // prefer walls mesh for collision tests if available
            walkCollisionWalls = wallsMesh || floorMesh;
        } else if (wallsMesh) {
            const box = new THREE.Box3().setFromObject(wallsMesh);
            const min = box.min;
            const max = box.max;
            const inset = 0.05;
            walkBounds = {
                minX: min.x + inset,
                maxX: max.x - inset,
                minY: min.y + 0.1,
                maxY: max.y + 2.0,
                minZ: min.z + inset,
                maxZ: max.z - inset
            };
            walkCollisionWalls = wallsMesh;
        } else {
            // Fallback to center/size
            walkBounds = computeBoundsFromCenter(center, size);
            walkCollisionWalls = null;
        }

        // If on mobile or dev-forced, create a movement pad and wire it to produce analogMove.x / analogMove.z
        if (isMobileDevice || !!window.__FORCE_MOVEMENT_PAD) {
            createMovementPad();
        }

        // key handlers
        function onKeyDown(e) {
            if (e.repeat) return;
            switch (e.code) {
                case 'KeyW': walkKeys.forward = 1; break;
                case 'KeyS': walkKeys.back = 1; break;
                case 'KeyA': walkKeys.left = 1; break;
                case 'KeyD': walkKeys.right = 1; break;
                case 'ArrowUp': walkKeys.forward = 1; break;
                case 'ArrowDown': walkKeys.back = 1; break;
                case 'ArrowLeft': walkKeys.left = 1; break;
                case 'ArrowRight': walkKeys.right = 1; break;
            }
        }

        function onKeyUp(e) {
            switch (e.code) {
                case 'KeyW': walkKeys.forward = 0; break;
                case 'KeyS': walkKeys.back = 0; break;
                case 'KeyA': walkKeys.left = 0; break;
                case 'KeyD': walkKeys.right = 0; break;
                case 'ArrowUp': walkKeys.forward = 0; break;
                case 'ArrowDown': walkKeys.back = 0; break;
                case 'ArrowLeft': walkKeys.left = 0; break;
                case 'ArrowRight': walkKeys.right = 0; break;
            }
        }

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        walkModeActive = true;
        // Expose for debugging
        try { window.__walkModeActive = true; } catch (e) {}

        // store cleanup to object for disable
        enableWalkMode._cleanup = () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            try { window.__walkModeActive = false; } catch (e) {}
            walkCollisionWalls = null;
            destroyMovementPad();
        };
    }

    function disableWalkMode() {
        if (!walkModeActive) return;
        walkModeActive = false;
        walkKeys = { forward: 0, back: 0, left: 0, right: 0 };
        if (enableWalkMode._cleanup) try { enableWalkMode._cleanup(); } catch (e) {}
        walkBounds = null;
        pendingWalkTarget = null;
        walkCollisionWalls = null;
        destroyMovementPad();
    }

    
    /**
     * Teleport boisvert to specific position for given navigation index
     */
    function teleportToPosition(targetPosition, index) {
        // Get the specific spawn position for this camera position
        const spawnPos = boisvertSpawnPositions[index];
        
        if (!spawnPos) {
            console.warn(`No spawn position defined for index ${index}`);
            return;
        }
        
        // Set boisvert's position directly
        boisvertModel.position.set(spawnPos[0], spawnPos[1], spawnPos[2]);

        // Calculate direction to camera
        const dx = camera.position.x - spawnPos[0];
        const dz = camera.position.z - spawnPos[2];
        const angleToCamera = Math.atan2(dx, dz);

        // Defensive: fallback to Math.PI/2 if array or value is missing
        let zRotation = Math.PI / 2;
        if (boisvertZRotations && Array.isArray(boisvertZRotations) && boisvertZRotations[index] !== undefined) {
            zRotation = boisvertZRotations[index];
        }

        boisvertModel.rotation.set(Math.PI / 2, 0, zRotation);
        
        // 1/3 chance to make camera look at boisvert
        if ((Math.random() < 1/3 || index === 5) && index !== 0) {
            lookAtBoisvert();
        }
    }
    
    /**
     * Smoothly rotate camera to look at boisvert
     */
    function lookAtBoisvert() {
        if (!boisvertModel) return;
        
        // Calculate direction from camera to boisvert
        const targetPosition = boisvertModel.position.clone();
        
        // Calculate the rotation needed to look at boisvert
        const direction = new THREE.Vector3();
        direction.subVectors(targetPosition, camera.position).normalize();
        
        // Calculate target euler angles
        const targetQuaternion = new THREE.Quaternion();
        const lookAtMatrix = new THREE.Matrix4();
        lookAtMatrix.lookAt(camera.position, targetPosition, camera.up);
        targetQuaternion.setFromRotationMatrix(lookAtMatrix);
        
        // Smoothly animate camera rotation
        const startQuaternion = camera.quaternion.clone();
        
        gsap.to({t: 0}, {
            t: 1,
            duration: 1.0,
            ease: 'power2.inOut',
            onUpdate: function() {
                camera.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, this.targets()[0].t);
                
                // Update controls target if available
                if (controls && controls.target) {
                    controls.target.copy(targetPosition);
                }
            }
        });
            // Unlock achievement for looking at boisvert
            try { window.achievements && window.achievements.unlock && window.achievements.unlock('looked_boisvert'); } catch(e) {}

            // Check composite master_interactor: if clicked_paper, clicked_painting, clicked_cola, and watched_screen are unlocked
            try {
                const ach = window.achievements;
                if (ach && typeof ach.isUnlocked === 'function') {
                    const all = ach.isUnlocked('clicked_paper') && ach.isUnlocked('clicked_painting') && ach.isUnlocked('clicked_cola') && ach.isUnlocked('watched_screen');
                    if (all) { try { ach.unlock('master_interactor'); } catch(e) {} }
                }
            } catch(e) {}
    }
    
    /**
     * Check if an object is a child of boisvert
     */
    function isChildOfBoisvert(object) {
        let parent = object.parent;
        while (parent) {
            if (parent === boisvertModel) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }

    /**
     * Click handler: if Boisvert is clicked, navigate to first additional nav position (DLC)
     */
    function onBoisvertClick(event) {
        try {
            // Determine additional positions: prefer explicit global, then fall back to window if present
            const additional = (window.ADDITIONAL_NAVIGATION_POSITIONS && Array.isArray(window.ADDITIONAL_NAVIGATION_POSITIONS)) ? window.ADDITIONAL_NAVIGATION_POSITIONS : null;
            // Also allow scene.userData to contain a reference (less likely)
            const additionalFromScene = scene && scene.userData && scene.userData.additionalNavigationPositions ? scene.userData.additionalNavigationPositions : null;
            const additionalPositions = additional || additionalFromScene;
            if (!additionalPositions || additionalPositions.length === 0) return;

            const target = additionalPositions[0];
            if (!target || target.length < 3) return;

            // Use global navigate helper if available
            if (window.navigateToPosition) {
                // If the global helper exists we cannot reliably know when navigation completes,
                // so set a pending target and enable walk mode once the camera reaches it.
                pendingWalkTarget = new THREE.Vector3(target[0], target[1], target[2]);
                try { window.navigateToPosition(target, 30); } catch (e) { /* fallback below will handle */ }
            } else {
                // Fallback: animate camera directly and enable walk mode onComplete
                gsap.to(camera.position, {
                    x: target[0], y: target[1], z: target[2], duration: 2, ease: 'power2.inOut',
                    onComplete: () => {
                        if (window && window.flashlight) window.flashlight.intensity = 30;
                        // After arriving, enable walk mode around this target (PC only)
                        try { enableWalkMode(new THREE.Vector3(target[0], target[1], target[2])); } catch (e) {}
                    }
                });
            }
            // Unlock Boisvert click achievement
            try { window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_boisvert'); } catch (e) {}
        } catch (e) { console.warn('[boisvertClick] failed', e); }
    }
    
    /**
     * Check if camera is near a navigation position
     */
    function checkCameraPosition() {
        const camPos = camera.position;
        
        // Check each navigation position
        for (let i = 0; i < navigationPositions.length; i++) {
            const navPos = navigationPositions[i];
            const distance = Math.sqrt(
                Math.pow(camPos.x - navPos[0], 2) +
                Math.pow(camPos.y - navPos[1], 2) +
                Math.pow(camPos.z - navPos[2], 2)
            );
            
            // If camera is near this position and it's different from last position
            if (distance < POSITION_THRESHOLD && i !== currentTargetIndex) {
                console.log(`Camera reached position ${i} (distance: ${distance.toFixed(2)})`);
                currentTargetIndex = i;
                teleportToPosition(navPos, i);
                // If we arrive at any of the base navigation positions, ensure walk mode is disabled.
                // Walk mode is only intended for the DLC/additional area, so disable on return to base positions.
                try { disableWalkMode(); } catch (e) { /* ignore */ }
                return;
            }
        }
    }
    
    /**
     * Update function to be called in animation loop
     */
    function update() {
        if (!boisvertModel) return;

        // Glitch vibration logic
        if (!update.lastJitterTime) update.lastJitterTime = performance.now();
        if (!update.isVibrating) update.isVibrating = false;
        if (!update.originalPosition) update.originalPosition = boisvertModel.position.clone();
        const now = performance.now();
        const vibrationDuration = 500; // ~0.5 seconds
        const vibrationInterval = 5000; // every 5 seconds
        const glitchAmount = 0.08; // position offset

        if (!update.isVibrating && now - update.lastJitterTime > vibrationInterval) {
            update.isVibrating = true;
            update.vibrationStart = now;
            update.lastJitterTime = now;
            update.originalPosition.copy(boisvertModel.position);
        }

        if (update.isVibrating) {
            const elapsed = now - update.vibrationStart;
            if (elapsed < vibrationDuration) {
                // Glitchy random position offset
                boisvertModel.position.x = update.originalPosition.x + (Math.random() - 0.5) * glitchAmount;
                boisvertModel.position.y = update.originalPosition.y + (Math.random() - 0.5) * glitchAmount;
                boisvertModel.position.z = update.originalPosition.z + (Math.random() - 0.5) * glitchAmount;
            } else {
                boisvertModel.position.copy(update.originalPosition); // Reset position
                update.isVibrating = false;
            }
        }

        // Check if camera has moved to a new position
        const currentPos = camera.position.clone();
        const moved = currentPos.distanceTo(lastCameraPosition) > 0.1;
        if (moved) {
            checkCameraPosition();
            lastCameraPosition.copy(currentPos);
        }

        // If we have a pending walk target (because navigateToPosition was used), wait until camera reaches it
        if (pendingWalkTarget) {
            const d = camera.position.distanceTo(pendingWalkTarget);
            if (d < 0.6) {
                // enable walk mode centered on the pending target
                try { enableWalkMode(pendingWalkTarget); } catch (e) {}
                pendingWalkTarget = null;
            }
        }

        // Walk mode per-frame update (PC only)
        if (walkModeActive && walkBounds) {
            // compute deltaTime
            if (!update._lastTime) update._lastTime = performance.now();
            const now = performance.now();
            const dt = Math.min(0.1, (now - update._lastTime) / 1000); // clamp dt
            update._lastTime = now;

            // Compute move vector based on camera yaw
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            forward.y = 0; forward.normalize();
            const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

            // Support analog movement from mobile pad (analogMove.x/z in approx -2..2 range)
            const analogScale = 0.5; // map -2..2 -> -1..1
            const useAnalog = Math.abs(analogMove.x) > 0.001 || Math.abs(analogMove.z) > 0.001;
            const moveZ = useAnalog ? (analogMove.z * analogScale) : (walkKeys.forward - walkKeys.back);
            const moveX = useAnalog ? (analogMove.x * analogScale) : (walkKeys.right - walkKeys.left);

            if (moveZ !== 0 || moveX !== 0) {
                const move = new THREE.Vector3();
                move.addScaledVector(forward, moveZ * walkSpeed * dt);
                move.addScaledVector(right, moveX * walkSpeed * dt);

                // Collision check: multi-directional raycasts around intended movement
                let blocked = false;
                if (walkCollisionWalls) {
                    // We'll attempt to slide along walls instead of fully blocking movement.
                    // Define a set of directions to probe around the player (8 cardinal/diagonal directions).
                    const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4, -Math.PI/2, -Math.PI/4];

                    // Use a lowered origin to approximate player center for raycasts
                    const origin = camera.position.clone();
                    origin.y = camera.position.y - 0.5;

                    // For each probe direction, if there's a wall within the player radius,
                    // only remove the component of the movement that points into the wall (i.e. project
                    // the move vector to be parallel to the wall normal). This allows sliding.
                    for (let angle of angles) {
                        const checkDir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize();

                        walkRaycaster.set(origin, checkDir);
                        // Short probe distance: just slightly beyond the player radius
                        walkRaycaster.far = walkPlayerRadius + 0.1;

                        try {
                            const hits = walkRaycaster.intersectObject(walkCollisionWalls, true);
                            if (hits && hits.length > 0 && typeof hits[0].distance === 'number') {
                                if (hits[0].distance < walkPlayerRadius) {
                                    // Wall detected in this direction. Only remove the component of the move
                                    // that points into this wall (i.e. when the player is moving TOWARD it).
                                    const moveDirCheck = move.clone();
                                    moveDirCheck.y = 0;
                                    const moveLen = moveDirCheck.length();
                                    if (moveLen < 1e-6) continue; // no meaningful movement
                                    moveDirCheck.normalize();

                                    const dotProduct = moveDirCheck.dot(checkDir);
                                    // If dot > 0.1 we are moving toward this probe direction (wall)
                                    if (dotProduct > 0.1) {
                                        const wallNormal = checkDir.clone();
                                        const parallelMove = move.clone().sub(wallNormal.multiplyScalar(move.dot(wallNormal)));
                                        move.copy(parallelMove);
                                    }
                                }
                            }
                        } catch (e) {
                            // If raycast fails, be conservative and block movement
                            blocked = true;
                            break;
                        }
                    }

                    // After attempting to slide, if the remaining move is negligible, consider it blocked
                    if (move.length() < 0.001) {
                        blocked = true;
                    } else {
                        blocked = false;
                    }
                }

                if (!blocked) {
                    camera.position.add(move);
                    // clamp inside bounds
                    camera.position.x = Math.max(walkBounds.minX, Math.min(walkBounds.maxX, camera.position.x));
                    camera.position.y = Math.max(walkBounds.minY, Math.min(walkBounds.maxY, camera.position.y));
                    camera.position.z = Math.max(walkBounds.minZ, Math.min(walkBounds.maxZ, camera.position.z));

                    // If controls targeting exists, update target too
                    if (controls && controls.target && typeof controls.target.copy === 'function') {
                        controls.target.copy(camera.position);
                    }
                } else {
                    // blocked: optionally could try sliding along wall or small step, for now do nothing
                }
            }

            // If camera leaves bounds (unexpected), disable walk mode
            if (camera.position.x <= walkBounds.minX || camera.position.x >= walkBounds.maxX || camera.position.z <= walkBounds.minZ || camera.position.z >= walkBounds.maxZ) {
                // still allow being exactly on edge; only disable when fully outside by small epsilon
                const eps = 0.01;
                if (camera.position.x < walkBounds.minX - eps || camera.position.x > walkBounds.maxX + eps || camera.position.z < walkBounds.minZ - eps || camera.position.z > walkBounds.maxZ + eps) {
                    disableWalkMode();
                }
            }
        }
    }

    /**
     * Get current boisvert position
     * @returns {THREE.Vector3|null} Current position of boisvert model
     */
    function getBoisvertPosition() {
        if (!boisvertModel) return null;
        return boisvertModel.position.clone();
    }
    
    // Initial teleport to first position
    if (navigationPositions.length > 0) {
        teleportToPosition(navigationPositions[0], 0);
        currentTargetIndex = 0;
        lastCameraPosition.copy(camera.position);
    }

    // Developer helper: toggle forced movement pad on desktop for testing
    try {
        window.toggleMovementPadForDev = function() {
            window.__FORCE_MOVEMENT_PAD = !window.__FORCE_MOVEMENT_PAD;
            console.log('[dev] __FORCE_MOVEMENT_PAD ->', !!window.__FORCE_MOVEMENT_PAD);
            if (walkModeActive) {
                if (window.__FORCE_MOVEMENT_PAD) {
                    createMovementPad();
                } else {
                    destroyMovementPad();
                }
            }
            return !!window.__FORCE_MOVEMENT_PAD;
        };
    } catch (e) {}

    // Add pointerdown listener to boisvert model - clicking it will navigate to first DLC position
    try {
        if (boisvertModel) {
            const raycaster = new THREE.Raycaster();
            const pointer = new THREE.Vector2();

            const canvas = document.querySelector('canvas');
            const targetElement = canvas || document;

            targetElement.addEventListener('pointerdown', (ev) => {
                try {
                    const rect = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
                    let clientX = ev.clientX;
                    let clientY = ev.clientY;

                    // Compute normalized device coordinates
                    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
                    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(pointer, camera);
                    const intersects = raycaster.intersectObject(boisvertModel, true);
                    if (intersects && intersects.length > 0) {
                        try { window.achievements && window.achievements.unlock && window.achievements.unlock('visited_first_dlc'); } catch(e) {}
                        onBoisvertClick(ev);
                    }
                } catch (e) {
                    // ignore
                }
            });

            // Pointer move: show pointer cursor when hovering Boisvert
            let _boisvertHover = false;
            targetElement.addEventListener('pointermove', (ev) => {
                try {
                    const rect = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
                    const clientX = ev.clientX;
                    const clientY = ev.clientY;
                    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
                    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(pointer, camera);
                    const hits = raycaster.intersectObject(boisvertModel, true);
                    const hovering = hits && hits.length > 0;
                    if (hovering && !_boisvertHover) {
                        _boisvertHover = true;
                        try { document.body.style.cursor = 'pointer'; } catch (e) {}
                    } else if (!hovering && _boisvertHover) {
                        _boisvertHover = false;
                        try { document.body.style.cursor = ''; } catch (e) {}
                    }
                } catch (e) {
                    // ignore
                }
            });

            // Also expose a programmatic handler for other systems to call
            try { window.boisvertClickHandler = onBoisvertClick; } catch (e) {}
        }
    } catch (e) { /* ignore */ }
    
    return {
        update,
        getBoisvertPosition,
        // Expose method to force the camera to look at Boisvert
        lookAtBoisvert
    };
}
