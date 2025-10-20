import * as THREE from 'three';
import gsap from 'gsap';

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
            console.log('Boisvert model found!', child);
            console.log('Initial position:', child.position);
            console.log('Is Group:', child.isGroup);
            console.log('Is Mesh:', child.isMesh);
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
        console.log('Boisvert Z rotation for index', index, ':', zRotation);

        boisvertModel.rotation.set(Math.PI / 2, 0, zRotation);
        
        console.log(`Boisvert teleported to position ${index}: [${spawnPos[0]}, ${spawnPos[1]}, ${spawnPos[2]}]`);
        console.log(`Boisvert facing camera at angle: ${(angleToCamera * 180 / Math.PI).toFixed(2)}°`);
        
        // 1/3 chance to make camera look at boisvert
        if (Math.random() < 1/3) {
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
        console.log('Performing initial teleport to first position...');
        teleportToPosition(navigationPositions[0], 0);
        currentTargetIndex = 0;
        lastCameraPosition.copy(camera.position);
    }
    
    return {
        update,
        getBoisvertPosition
    };
}
