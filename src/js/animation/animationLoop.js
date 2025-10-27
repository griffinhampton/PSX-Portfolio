import * as THREE from "three";
import gsap from 'gsap';

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

        // Mobile dynamic spotlight intentionally disabled — no mobile flashlight effects.
        
        // Update falling snow particles - stop at last position (works on both desktop and mobile)
        try {
            const currentParticleArrays = (typeof window !== 'undefined' && window.particleArrays) ? window.particleArrays : null;
            const particleUpdater = (typeof window !== 'undefined' && typeof window.updateParticles === 'function') ? window.updateParticles : null;
            if (currentParticleArrays && particleUpdater) {
                const shouldUpdateParticles = !orbManager || !orbManager.isAtLastPosition();
                particleUpdater(currentParticleArrays, undefined, shouldUpdateParticles);
            }
        } catch (e) {
            // ignore particle update errors
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
        
        // Update camera interactive objects
        if (window.cameraInteractiveManager && typeof window.cameraInteractiveManager.update === 'function') {
            window.cameraInteractiveManager.update();
        }
        
        // Update Boisvert teleporter
        if (window.boisvertTeleporter && typeof window.boisvertTeleporter.update === 'function') {
            window.boisvertTeleporter.update();
        }

        // Collision: if player walks into the backroom-light-door, teleport them to the last navigation position
        try {
            // Lazy-find the door object to avoid traversing every frame
            if (!animate._backroomDoor) {
                try {
                    animate._backroomDoor = window.scene ? window.scene.getObjectByName('backroom-light-door') : null;
                    // If direct getObjectByName fails (name may be on a child), fall back to traverse
                    if (!animate._backroomDoor && window.scene) {
                        window.scene.traverse((c) => { if (!animate._backroomDoor && c.name === 'backroom-light-door') animate._backroomDoor = c; });
                    }
                } catch (e) { animate._backroomDoor = null; }
            }

            const door = animate._backroomDoor;
            if (door && window.camera && navigationPositions && navigationPositions.length) {
                // Compute a simple proximity test using door world position
                const doorPos = new THREE.Vector3();
                door.getWorldPosition(doorPos);
                const camPos = window.camera.position;
                const dx = camPos.x - doorPos.x;
                const dy = camPos.y - doorPos.y;
                const dz = camPos.z - doorPos.z;
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

                const DOOR_TRIGGER_DISTANCE = 0.9; // tuned threshold for walking into door
                // cooldown to avoid retrigger storms
                const now = Date.now();
                if (dist <= DOOR_TRIGGER_DISTANCE && (!animate._doorLastTriggered || now - animate._doorLastTriggered > 1500)) {
                    // Teleport to last navigation position (but do not teleport if a chase is active)
                    try {
                        // mark triggered time immediately to avoid rapid retriggers
                        animate._doorLastTriggered = now;
                        // Detect chase state using tolerant global flags - if chase is active, skip teleport
                        let _door_chase_active = false;
                        try {
                            const bt = (typeof window !== 'undefined') ? window.boisvertTeleporterManager : null;
                            const bg = (typeof window !== 'undefined') ? window.boisvertGame : null;
                            if (bt) {
                                try { if (bt.update && bt.update._chaseActive) _door_chase_active = true; } catch (e) {}
                                try { if (bt.isChaseActive || bt.chaseActive || bt._isChaseActive || bt.isChasing) _door_chase_active = true; } catch (e) {}
                            }
                            if (bg) {
                                try { if (bg.isChasing || bg.chaseActive || bg.inChase) _door_chase_active = true; } catch (e) {}
                            }
                        } catch (e) {}

                        if (_door_chase_active) {
                            try { if (window && window.console) console.warn('[collision] door teleport blocked: chase active'); } catch (e) {}
                        } else {
                        // Prefer to always send users exiting the portfolio through the backrooms door
                        // to navigation index 5 (portfolio exit). If index 5 isn't available, fall back
                        // to the previous behavior of using the last navigation position.
                        const preferredIdx = 5;
                        const lastIdx = navigationPositions.length - 1;
                        let target = null;
                        let arrivedIndex = lastIdx;
                        if (navigationPositions[preferredIdx] && navigationPositions[preferredIdx].length >= 3) {
                            target = navigationPositions[preferredIdx];
                            arrivedIndex = preferredIdx;
                        } else {
                            target = navigationPositions[lastIdx];
                            arrivedIndex = lastIdx;
                        }

                        if (target && target.length >= 3) {
                            // Use a short GSAP tween (0.5s) for door exits to match requested speed.
                            // Disable walk mode first to ensure clean state, kill competing tweens,
                            // animate camera, then update orbs and dispatch arrival.
                            try {
                                try { disableWalkMode(); } catch (e) {}
                                try { gsap.killTweensOf(window.camera.position); } catch (e) {}
                                gsap.to(window.camera.position, {
                                    x: target[0],
                                    y: target[1],
                                    z: target[2],
                                    duration: 0.5,
                                    ease: 'power2.inOut',
                                    onComplete: () => {
                                        try { if (orbManager && typeof orbManager.update === 'function') orbManager.update(); } catch (e) {}
                                        try { window.dispatchEvent(new CustomEvent('orb:arrived', { detail: { index: arrivedIndex } })); } catch (e) {}
                                    }
                                });
                            } catch (e) {
                                // swallow
                            }
                        }
                    }
                    } catch (e) {
                        console.warn('[collision] failed to teleport on door collision', e);
                    }
                }
            }
        } catch (e) {
            // swallow errors to avoid breaking the main loop
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
        try {
            const activeComposer = (typeof window !== 'undefined' && window.composer) ? window.composer : composer;
            if (activeComposer) {
                activeComposer.render();
            } else {
                renderer.render(window.scene, window.camera);
            }
        } catch (e) {
            try { renderer.render(window.scene, window.camera); } catch (err) { /* swallow */ }
        }
        
        // Render CSS3D for YouTube screen
        const ytScreen = youtubeScreen ? youtubeScreen() : null;
        if (ytScreen) {
            ytScreen.render(window.camera);
        }
    }

    return animate;
}
