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
    
    // Mobile devices need faster rotation speed
    const rotationSpeed = qualitySettings.isMobile ? 0.004 : 0.002;
    
    const controls = {
        isLocked: false,
        
        update() {
            // No continuous update needed for this control style
        }
    };

    function onPointerMove(event) {
        // Only handle camera rotation if dragging
        if (isDragging) {
            const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
            const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

            euler.setFromQuaternion(camera.quaternion);

            euler.y -= movementX * rotationSpeed;
            euler.x -= movementY * rotationSpeed;

            // Clamp vertical rotation to prevent flipping
            euler.x = Math.max(-PI_2 + 0.1, Math.min(PI_2 - 0.1, euler.x));

            camera.quaternion.setFromEuler(euler);
        }
        // Don't return early - allow event to propagate to other handlers
    }

    function onPointerDown(event) {
        // Only start dragging on left mouse button
        if (event.button === 0) {
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
 * points starting at starting position
 * [[-1.73,1.2,38],
 * [[-1.7,.5,26.67],
 * [-.6,.5,19.3],
 * [-.87,.6,15.78],
 * [-.25,.65,11.35],
 * [1.62,.75,2.16],
 * [3.13,.8,0.04]
 * ]
 * */

/**
 * Set up orb-based navigation system
 * Orbs only load the nearest 2 on each side of the camera in the path array
 * Clicking an orb moves the camera to that position and removes the orb
 * @param {THREE.Scene} scene 
 * @param {THREE.Camera} camera 
 * @param {HTMLElement} domElement 
 * @param {Array<Array<number>>} positions - Array of [x,y,z] positions for navigation
 * @param {THREE.SpotLight} flashlight - The flashlight to control (optional)
 * @param {Object} qualitySettings - Quality settings for orb sizing (optional)
 * @param {Array<Array<number>>} excludePositions - Positions where orbs should never appear (optional)
 * @returns {Object} orbManager with update() method
 */
export function setupOrbNavigation(scene, camera, domElement, positions = [], flashlight = null, qualitySettings = {}, excludePositions = []) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const orbMeshes = [];
    const group = new THREE.Group();
    group.name = 'orbNavigationGroup';
    scene.add(group);

    // Track which position index we're currently at/closest to
    let currentIndex = 0;
    
    // Distance threshold for position exclusion (only exclude if very close)
    // Reduced to 0.5 to only exclude positions that are essentially the same as camera-interactive positions
    const EXCLUDE_THRESHOLD = 0.5;
    
    /**
     * Check if a position should be excluded (too close to a camera interactive object)
     */
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
    
    // Get orb size from quality settings (larger on mobile)
    const orbSize = qualitySettings.orbSize || 0.2;
    const raycastThreshold = qualitySettings.orbRaycastThreshold || 0.3;

    /**
     * Create an orb mesh
     */
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

        // Pulse animation
        gsap.to(mesh.scale, { 
            x: 1.3, y: 1.3, z: 1.3, 
            duration: 0.8, 
            yoyo: true, 
            repeat: -1, 
            ease: 'sine.inOut' 
        });

        return mesh;
    }

    /**
     * Find the closest position index to camera
     */
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

    /**
     * Check if camera is at a camera-interactive position (not in navigation path)
     */
    function isAtCameraInteractivePosition() {
        const camPos = camera.position;
        for (const excludePos of excludePositions) {
            const distance = Math.sqrt(
                Math.pow(camPos.x - excludePos[0], 2) +
                Math.pow(camPos.y - excludePos[1], 2) +
                Math.pow(camPos.z - excludePos[2], 2)
            );
            
            if (distance < 0.5) { // Very close to a camera-interactive position
                return true;
            }
        }
        return false;
    }

    /**
     * Update which orbs should be visible
     * Only show nearest 2 on each side of current position
     */
    function updateVisibleOrbs() {
        // Don't update orbs if camera is at a camera-interactive position
        // This prevents orbs from disappearing when clicking on painting/screen
        if (isAtCameraInteractivePosition()) {
            return;
        }
        
        currentIndex = findClosestIndex();
        
        // Clear existing orbs
        group.children.forEach(child => {
            gsap.killTweensOf(child.scale);
        });
        group.clear();
        orbMeshes.length = 0;

        // Calculate which indices to show (2 on each side)
        const indicesToShow = [];
        for (let offset = -2; offset <= 2; offset++) {
            if (offset === 0) continue; // Don't show orb at current position
            const idx = currentIndex + offset;
            if (idx >= 0 && idx < positions.length) {
                // Check if this position should be excluded
                if (!shouldExcludePosition(positions[idx])) {
                    indicesToShow.push(idx);
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



    /**
     * Get pointer position from event (works for both mouse and touch)
     */
    function getPointerPosition(event) {
        const rect = domElement.getBoundingClientRect();
        let clientX, clientY;
        
        if (event.touches && event.touches.length > 0) {
            // Touch event
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else if (event.changedTouches && event.changedTouches.length > 0) {
            // Touch end event
            clientX = event.changedTouches[0].clientX;
            clientY = event.changedTouches[0].clientY;
        } else {
            // Mouse event
            clientX = event.clientX;
            clientY = event.clientY;
        }
        
        return {
            x: ((clientX - rect.left) / rect.width) * 2 - 1,
            y: -((clientY - rect.top) / rect.height) * 2 + 1
        };
    }

    /**
     * Handle pointer click or touch
     */
    function onPointerDown(event) {
        const pos = getPointerPosition(event);
        pointer.x = pos.x;
        pointer.y = pos.y;

        raycaster.setFromCamera(pointer, camera);
        // Increase threshold for better hit detection on mobile
        raycaster.params.Points.threshold = raycastThreshold;
        const intersects = raycaster.intersectObjects(group.children, false);
        
        if (intersects.length > 0) {
            const picked = intersects[0].object;
            const targetPos = picked.userData.position.clone();
            const targetIdx = picked.userData.index;

            // Kill any ongoing camera animations to prevent glitches
            gsap.killTweensOf(camera.position);
            
            // Remove the clicked orb immediately
            gsap.killTweensOf(picked.scale);
            group.remove(picked);

            // Move camera to orb position
            const duration = 1.5;
            gsap.to(camera.position, {
                x: targetPos.x,
                y: targetPos.y,
                z: targetPos.z,
                duration,
                ease: 'power2.inOut',
                onComplete: () => {
                    // Update current index and refresh visible orbs
                    currentIndex = targetIdx;
                    updateVisibleOrbs();
                    
                    // Dim flashlight at last position, normal intensity elsewhere
                    if (flashlight) {
                        if (targetIdx === positions.length - 1) {
                            flashlight.intensity = 5; // Dimmed intensity
                        } else {
                            flashlight.intensity = 30; // Normal intensity
                        }
                    }
                }
            });
        }
    }

    // Register with cursor manager for hover detection (only on desktop)
    if (!qualitySettings.isMobile) {
        registerInteractiveManager(() => group.children);
    }

    domElement.addEventListener('pointerdown', onPointerDown);
    
    // Add touch event listeners for mobile support
    domElement.addEventListener('touchstart', onPointerDown, { passive: false });
    domElement.addEventListener('touchend', onPointerDown, { passive: false });

    // Initialize with visible orbs
    updateVisibleOrbs();

    const orbManager = {
        update() {
            // Update visible orbs when called externally (e.g., from navbar navigation)
            updateVisibleOrbs();
        },
        getCurrentIndex() {
            return currentIndex;
        },
        isAtLastPosition() {
            return currentIndex === positions.length - 1;
        },
        enablePreviousOrb(previousPosition = null) {
            // When user clicks screen, create orb at the position they came from
            // This allows them to return from the screen view
            
            if (previousPosition) {
                // Check if this position should be excluded
                const posArray = [previousPosition.x, previousPosition.y, previousPosition.z];
                if (shouldExcludePosition(posArray)) {
                    return; // Don't create orb at excluded position
                }
                
                // Use the actual previous camera position if provided
                const orb = createOrbMesh(
                    posArray, 
                    currentIndex // Use current index as this orb returns to where we were
                );
                orb.userData.isActive = true;
                orb.userData.isPreviousOrb = true; // Mark this as a "go back" orb
                orbMeshes.push(orb);
                group.add(orb);
            } else if (currentIndex > 0) {
                // Fallback to previous position in path array
                const prevIdx = currentIndex - 1;
                const prevPos = positions[prevIdx];
                
                // Check if this position should be excluded
                if (shouldExcludePosition(prevPos)) {
                    return; // Don't create orb at excluded position
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