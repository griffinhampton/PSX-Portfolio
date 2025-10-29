import gsap from 'gsap';
import * as THREE from 'three';
import { setClickableCursor, setDefaultCursor, registerInteractiveManager } from '../utils/cursorManager.js';

/**
 * Set up first-person look controls for camera (click and drag to look around)
 * @param {THREE.Camera} camera - The camera to control
 * @param {HTMLElement} domElement - The renderer's DOM element
 * @param {Object} qualitySettings - Quality settings for device-specific adjustments
 * @returns {Object} controls object with update() method
 */
export function setupCameraControls(camera, domElement, qualitySettings = {}) {
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const PI_2 = Math.PI / 2;
    
    let isPointerLocked = false;
    let isDragging = false;
    let shouldDisableLookFn = null;
    let isClamping = false;
    let clampBaseYaw = null;
    let clampYawRange = null;
    let clampPitchRange = null;
    
    let rotationSpeed = qualitySettings.isMobile ? 0.004 : 0.002;
    
    const controls = {
        isLocked: false,
        isUserDragging() {
            return !!isDragging;
        },
        setDragSpeed(v) {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) rotationSpeed = n;
        },
        getDragSpeed() {
            return rotationSpeed;
        },
        setShouldDisableLookFn(fn) {
            shouldDisableLookFn = fn;
        },
        update() {
            // No continuous update needed for this control style
        }
    };

    function onPointerMove(event) {
        if (isDragging) {
            if (window.__DEBUG_CAMERA_CONTROLS) console.debug('[cameraControls] onPointerMove - isDragging', isDragging);
            
            let disableInfo = null;
            if (typeof shouldDisableLookFn === 'function') {
                try {
                    disableInfo = shouldDisableLookFn();
                } catch (err) {
                    disableInfo = null;
                }
            }

            if (disableInfo === true) {
                if (window.__DEBUG_CAMERA_CONTROLS) console.debug('[cameraControls] predicate -> fully disabled');
                isDragging = false;
                return;
            }

            if (disableInfo && typeof disableInfo === 'object') {
                if (!isClamping) {
                    const qeuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
                    clampBaseYaw = qeuler.y;
                    clampYawRange = typeof disableInfo.clampYaw === 'number' ? disableInfo.clampYaw : Math.PI / 2;
                    clampPitchRange = typeof disableInfo.clampPitch === 'number' ? disableInfo.clampPitch : null;
                    isClamping = true;
                }
            } else {
                isClamping = false;
                clampBaseYaw = null;
                clampYawRange = null;
                clampPitchRange = null;
            }
            
            const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
            const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

            euler.setFromQuaternion(camera.quaternion);
            euler.y -= movementX * rotationSpeed;
            euler.x -= movementY * rotationSpeed;
            euler.x = Math.max(-PI_2 + 0.1, Math.min(PI_2 - 0.1, euler.x));

            if (isClamping && clampBaseYaw !== null && typeof clampYawRange === 'number') {
                if (window.__DEBUG_CAMERA_CONTROLS) console.debug('[cameraControls] clamping active, baseYaw=', clampBaseYaw, 'range=', clampYawRange);
                const minYaw = clampBaseYaw - clampYawRange;
                const maxYaw = clampBaseYaw + clampYawRange;
                let yaw = euler.y;
                while (yaw - clampBaseYaw > Math.PI) yaw -= Math.PI * 2;
                while (yaw - clampBaseYaw < -Math.PI) yaw += Math.PI * 2;
                yaw = Math.max(minYaw, Math.min(maxYaw, yaw));
                euler.y = yaw;
            }

            camera.quaternion.setFromEuler(euler);
        }
    }

    function onPointerDown(event) {
        if (event.button === 0) {
            if (window.__DEBUG_CAMERA_CONTROLS) console.debug('[cameraControls] onPointerDown');
            
            if (typeof shouldDisableLookFn === 'function') {
                try {
                    const res = shouldDisableLookFn();
                    if (window.__DEBUG_CAMERA_CONTROLS) console.debug('[cameraControls] predicate result:', res);
                    
                    if (res === true) {
                        isDragging = false;
                        return;
                    }
                    
                    if (res && typeof res === 'object') {
                        const qeuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
                        clampBaseYaw = qeuler.y;
                        clampYawRange = typeof res.clampYaw === 'number' ? res.clampYaw : Math.PI / 2;
                        clampPitchRange = typeof res.clampPitch === 'number' ? res.clampPitch : null;
                        isClamping = true;
                    } else {
                        isClamping = false;
                        clampBaseYaw = null;
                        clampYawRange = null;
                        clampPitchRange = null;
                    }
                } catch (err) {
                    // predicate error - ignore and allow dragging
                }
            }
            isDragging = true;
        }
    }

    function onPointerUp(event) {
        if (event.button === 0) {
            isDragging = false;
        }
    }

    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('pointerleave', () => {
        isDragging = false;
    });

    return controls;
}

/**
 * Set up orb-based navigation system
 * @param {THREE.Scene} scene 
 * @param {THREE.Camera} camera 
 * @param {HTMLElement} domElement 
 * @param {Array<Array<number>>} positions - Array of [x,y,z] positions for navigation
 * @param {THREE.SpotLight} flashlight - The flashlight to control (optional)
 * @param {Object} qualitySettings - Quality settings for orb sizing (optional)
 * @param {Array<Array<number>>} excludePositions - Positions where orbs should never appear (optional)
 * @param {number} basePositionsLength - Original positions length before DLC additions (optional)
 * @returns {Object} orbManager with update() method
 */
export function setupOrbNavigation(scene, camera, domElement, positions = [], flashlight = null, qualitySettings = {}, excludePositions = [], basePositionsLength = null) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const orbMeshes = [];
    const group = new THREE.Group();
    group.name = 'orbNavigationGroup';
    scene.add(group);

    let currentIndex = 0;
    const EXCLUDE_THRESHOLD = 0.5;
    
    function shouldExcludePosition(pos) {
        for (const excludePos of excludePositions) {
            const distance = Math.sqrt(
                Math.pow(pos[0] - excludePos[0], 2) +
                Math.pow(pos[1] - excludePos[1], 2) +
                Math.pow(pos[2] - excludePos[2], 2)
            );
            
            if (distance < EXCLUDE_THRESHOLD) {
                return true;
            }
        }
        return false;
    }
    
    const orbSize = qualitySettings.orbSize || 0.2;
    const raycastThreshold = qualitySettings.orbRaycastThreshold || 0.3;

    function createOrbMesh(pos, idx) {
        const geom = new THREE.SphereGeometry(orbSize, 12, 12);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x0088ff,
            metalness: 0.3,
            roughness: 0.4,
            transparent: true,
            opacity: 0.85
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.userData = { 
            index: idx, 
            position: new THREE.Vector3(...pos),
            isActive: false
        };

        gsap.to(mesh.scale, { 
            x: 1.3, y: 1.3, z: 1.3, 
            duration: 0.8, 
            yoyo: true, 
            repeat: -1, 
            ease: 'sine.inOut' 
        });

        return mesh;
    }

    function findClosestIndex() {
        let minDist = Infinity;
        let closestIdx = 0;
        positions.forEach((pos, idx) => {
            const dist = camera.position.distanceTo(new THREE.Vector3(...pos));
            if (dist < minDist) {
                minDist = dist;
                closestIdx = idx;
            }
        });
        return closestIdx;
    }

    function isAtCameraInteractivePosition() {
        const camPos = camera.position;
        for (const excludePos of excludePositions) {
            const distance = Math.sqrt(
                Math.pow(camPos.x - excludePos[0], 2) +
                Math.pow(camPos.y - excludePos[1], 2) +
                Math.pow(camPos.z - excludePos[2], 2)
            );
            
            if (distance < EXCLUDE_THRESHOLD) {
                return true;
            }
        }
        return false;
    }

    function updateVisibleOrbs(skipIfAtInteractive = true) {
        if (skipIfAtInteractive && isAtCameraInteractivePosition()) {
            return;
        }
        
        currentIndex = findClosestIndex();
        
        // Clear existing orbs
        group.children.forEach(child => {
            gsap.killTweensOf(child.scale);
        });
        group.clear();
        orbMeshes.length = 0;

        const indicesToShow = [];

    // If basePositionsLength is provided and the camera is at/after that index,
    // we're in the ADDITIONAL_NAVIGATION_POSITIONS area — show all orbs at once
    // NOTE: Only enable the "show all orbs" behavior on mobile devices.
    const inAdditionalArea = (typeof basePositionsLength === 'number' && basePositionsLength >= 0 && currentIndex >= basePositionsLength && !!qualitySettings.isMobile);

        // compute the index of the first additional position when available
        const firstAdditionalIdx = (typeof basePositionsLength === 'number' && basePositionsLength >= 0) ? basePositionsLength : null;

        if (inAdditionalArea) {
            // Add every position except the current one, respecting exclusion rules
            for (let idx = 0; idx < positions.length; idx++) {
                if (idx === currentIndex) continue;
                // Never include the very first additional position (hide it everywhere)
                if (firstAdditionalIdx !== null && idx === firstAdditionalIdx) continue;
                // If this is an "additional" position and we're not on mobile, skip it
                if (typeof basePositionsLength === 'number' && basePositionsLength >= 0 && idx >= basePositionsLength && !qualitySettings.isMobile) continue;
                if (!shouldExcludePosition(positions[idx])) indicesToShow.push(idx);
            }
        } else {
            // Default behavior: show nearest 2 on each side
            for (let offset = -2; offset <= 2; offset++) {
                if (offset === 0) continue;
                const idx = currentIndex + offset;
                if (idx >= 0 && idx < positions.length) {
                    // Never include the very first additional position (hide it everywhere)
                    if (firstAdditionalIdx !== null && idx === firstAdditionalIdx) continue;
                    // Skip additional (DLC) positions on non-mobile platforms
                    if (typeof basePositionsLength === 'number' && basePositionsLength >= 0 && idx >= basePositionsLength && !qualitySettings.isMobile) continue;
                    if (!shouldExcludePosition(positions[idx])) {
                        indicesToShow.push(idx);
                    }
                }
            }
        }

        // Create and add orbs
        indicesToShow.forEach(idx => {
            const orb = createOrbMesh(positions[idx], idx);
            orb.userData.isActive = true;
            orbMeshes.push(orb);
            group.add(orb);
        });
    }

    function getPointerPosition(event) {
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
        
        return {
            x: ((clientX - rect.left) / rect.width) * 2 - 1,
            y: -((clientY - rect.top) / rect.height) * 2 + 1
        };
    }

    function onPointerDown(event) {
        const pos = getPointerPosition(event);
        pointer.x = pos.x;
        pointer.y = pos.y;

        raycaster.setFromCamera(pointer, camera);
        raycaster.params.Points.threshold = raycastThreshold;
        const intersects = raycaster.intersectObjects(group.children, false);
        
        if (intersects.length > 0) {
            const picked = intersects[0].object;
            const targetPos = picked.userData.position.clone();
            const targetIdx = picked.userData.index;

            gsap.killTweensOf(camera.position);
            gsap.killTweensOf(picked.scale);
            group.remove(picked);

            const duration = 1.5;

            // Ensure a global footsteps audio exists and is registered
            try {
                    if (typeof window !== 'undefined') {
                    if (!window.__footstepsAudio) {
                        const fa = document.createElement('audio');
                        fa.src = 'src/sounds/footsteps-in-thin-snow-46199.mp3';
                        fa.loop = true; // loop so continuous footsteps play while navigating
                        fa.preload = 'auto';
                        fa.style.display = 'none';
                        try { document.body.appendChild(fa); } catch (e) {}
                        try { window.__audioRegistry = window.__audioRegistry || []; if (!window.__audioRegistry.includes(fa)) window.__audioRegistry.push(fa); } catch (e) {}
                        window.__footstepsAudio = fa;
                    }
                }
            } catch (e) {}

            gsap.to(camera.position, {
                x: targetPos.x,
                y: targetPos.y,
                z: targetPos.z,
                duration,
                ease: 'power2.inOut',
                onStart() {
                    // Begin fading winter-wind as soon as navigation starts
                    try {
                        const toIdx = (typeof targetIdx === 'number') ? targetIdx : null;
                        // Determine the TV index (last base navigation index) from basePositionsLength
                        const effectiveTvIdx = (typeof basePositionsLength === 'number' && basePositionsLength > 0) ? (basePositionsLength - 1) : (positions.length - 1);
                        let targetVol = 0.6;
                        if (toIdx === effectiveTvIdx) {
                            targetVol = 0.0; // mute at TV
                        } else if (toIdx === 5) {
                            targetVol = 0.08; // dampened indoor index
                        } else {
                            targetVol = 0.6;
                        }
                        const fadeDur = duration; // match camera tween duration (1.5s)
                        if (typeof window !== 'undefined' && window.__winterWindAudio) {
                            try {
                                if (typeof gsap === 'object' && typeof gsap.to === 'function') {
                                    gsap.to(window.__winterWindAudio, { volume: Math.max(0, Math.min(1, targetVol)), duration: fadeDur, ease: 'linear' });
                                } else {
                                    // simple interval fallback
                                    const a = window.__winterWindAudio;
                                    const start = (typeof a.volume === 'number') ? a.volume : 0;
                                    const steps = Math.max(1, Math.round((fadeDur * 60)));
                                    let i = 0;
                                    const delta = (targetVol - start) / steps;
                                    const iv = setInterval(() => {
                                        try {
                                            i++;
                                            a.volume = Math.max(0, Math.min(1, start + delta * i));
                                            if (i >= steps) clearInterval(iv);
                                        } catch (e) { clearInterval(iv); }
                                    }, Math.max(10, Math.round((fadeDur * 1000) / steps)));
                                }
                            } catch (e) {
                                try { window.__winterWindAudio.volume = Math.max(0, Math.min(1, targetVol)); } catch (e) {}
                            }
                        }
                    } catch (e) {}

                    // Play footsteps when navigation starts except when navigating to index 5
                    // or when specifically moving from index 5 -> index 4 (quiet transition)
                    try {
                        const fromIdx = (typeof currentIndex === 'number') ? currentIndex : null;
                        const toIdx = (typeof targetIdx === 'number') ? targetIdx : null;
                        const skip = (toIdx === 5) || (fromIdx === 5 && toIdx === 4);
                        if (!skip && typeof window !== 'undefined' && window.__footstepsAudio) {
                            // Play (or resume) without resetting currentTime so pause preserves position
                            try { window.__footstepsAudio.play().catch(()=>{}); } catch (e) {}
                        }
                    } catch (e) {}
                },
                onComplete: () => {
                    // Stop footsteps when navigation completes
                    try {
                        if (typeof window !== 'undefined' && window.__footstepsAudio) {
                            // pause but DO NOT reset playback position so future play resumes
                            try { window.__footstepsAudio.pause(); } catch (e) {}
                        }
                    } catch (e) {}

                    currentIndex = targetIdx;
                    updateVisibleOrbs();
                    
                    if (flashlight) {
                        const effectiveLastIdx = (typeof basePositionsLength === 'number' && basePositionsLength > 0) 
                            ? basePositionsLength - 1 
                            : positions.length - 1;
                        
                        if (targetIdx === effectiveLastIdx) {
                            flashlight.intensity = 5;
                        } else {
                            flashlight.intensity = 30;
                        }
                    }
                    
                    try {
                        window.dispatchEvent(new CustomEvent('orb:arrived', { detail: { index: targetIdx } }));
                    } catch (e) {}

                    try {
                        if (picked && picked.userData && picked.userData.isPreviousOrb) {
                            if (window.boisvertTeleporter && typeof window.boisvertTeleporter.lookAtBoisvert === 'function') {
                                window.boisvertTeleporter.lookAtBoisvert();
                            }
                        }
                    } catch (e) {}
                },
                onKill() {
                    // Also stop footsteps if the tween is killed
                    try {
                        if (typeof window !== 'undefined' && window.__footstepsAudio) {
                            // pause but DO NOT reset playback position so future play resumes
                            try { window.__footstepsAudio.pause(); } catch (e) {}
                        }
                    } catch (e) {}
                    // Notify others that navigation was cancelled/killed so audio can be reverted
                    try {
                        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                            try { window.dispatchEvent(new CustomEvent('orb:cancelled', { detail: { from: currentIndex, to: targetIdx } })); } catch (e) {}
                        }
                    } catch (e) {}
                }
            });
        }
    }

    if (!qualitySettings.isMobile) {
        registerInteractiveManager(() => group.children);
    }

    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('touchstart', onPointerDown, { passive: false });
    domElement.addEventListener('touchend', onPointerDown, { passive: false });

    updateVisibleOrbs();

    const orbManager = {
        update() {
            updateVisibleOrbs();
        },
        getCurrentIndex() {
            return currentIndex;
        },
        isAtLastPosition() {
            const effectiveLastIdx = (typeof basePositionsLength === 'number' && basePositionsLength > 0) 
                ? basePositionsLength - 1 
                : positions.length - 1;
            return currentIndex === effectiveLastIdx;
        },
        enablePreviousOrb(previousPosition = null) {
            updateVisibleOrbs(false);

            // compute the index of the first additional position when available
            const firstAdditionalIdx = (typeof basePositionsLength === 'number' && basePositionsLength >= 0) ? basePositionsLength : null;

            if (previousPosition) {
                const posArray = [previousPosition.x, previousPosition.y, previousPosition.z];
                if (shouldExcludePosition(posArray)) {
                    return;
                }

                // Try to resolve the index of the provided previousPosition within positions
                let resolvedIdx = positions.findIndex(p => p[0] === posArray[0] && p[1] === posArray[1] && p[2] === posArray[2]);
                if (resolvedIdx === -1) {
                    // fallback to currentIndex if we can't find it
                    resolvedIdx = currentIndex;
                }

                // Never create an orb for the very first additional position
                if (firstAdditionalIdx !== null && resolvedIdx === firstAdditionalIdx) return;

                // If this previous position falls into the ADDITIONAL_NAVIGATION_POSITIONS range
                // and we're not on mobile, don't create the orb.
                if (typeof basePositionsLength === 'number' && basePositionsLength >= 0 && resolvedIdx >= basePositionsLength && !qualitySettings.isMobile) {
                    return;
                }

                const orb = createOrbMesh(posArray, resolvedIdx);
                orb.userData.isActive = true;
                orb.userData.isPreviousOrb = true;
                orbMeshes.push(orb);
                group.add(orb);
            } else if (currentIndex > 0) {
                const prevIdx = currentIndex - 1;
                const prevPos = positions[prevIdx];

                // Never create the very first additional position
                if (firstAdditionalIdx !== null && prevIdx === firstAdditionalIdx) return;

                // Skip if this prev position is excluded or is an additional (DLC) position on non-mobile
                if (shouldExcludePosition(prevPos)) {
                    return;
                }
                if (typeof basePositionsLength === 'number' && basePositionsLength >= 0 && prevIdx >= basePositionsLength && !qualitySettings.isMobile) {
                    return;
                }

                const orb = createOrbMesh(prevPos, prevIdx);
                orb.userData.isActive = true;
                orbMeshes.push(orb);
                group.add(orb);
            }
        },
        dispose() {
            domElement.removeEventListener('pointerdown', onPointerDown);
            domElement.removeEventListener('touchstart', onPointerDown);
            domElement.removeEventListener('touchend', onPointerDown);
            group.children.forEach(child => {
                gsap.killTweensOf(child.scale);
            });
            group.clear();
            scene.remove(group);
        }
    };

    return orbManager;
}