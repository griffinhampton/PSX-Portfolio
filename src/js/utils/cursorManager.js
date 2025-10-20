/**
 * Unified cursor management utility
 * Sets cursor to pointer when hovering over interactive elements
 */

import * as THREE from 'three';

// Global state
let registeredManagers = [];
let currentDomElement = null;
let isInitialized = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/**
 * Register a manager that provides interactive objects
 * @param {Function} getObjectsFn - Function that returns array of interactive objects
 */
export function registerInteractiveManager(getObjectsFn) {
    registeredManagers.push(getObjectsFn);
}

/**
 * Initialize the unified cursor manager
 * @param {HTMLElement} domElement - The DOM element to attach listeners to
 * @param {THREE.Camera} camera - The camera for raycasting
 */
export function initializeCursorManager(domElement, camera) {
    if (isInitialized) return;
    
    currentDomElement = domElement;
    isInitialized = true;
    
    function onPointerMove(event) {
        // Get pointer position
        const rect = domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Check all registered managers for interactive objects
        raycaster.setFromCamera(pointer, camera);
        
        // Collect all meshes from all managers
        const raycastTargets = [];
        registeredManagers.forEach(getObjectsFn => {
            const objects = getObjectsFn();
            if (Array.isArray(objects)) {
                objects.forEach(obj => {
                    if (obj && obj.traverse) {
                        obj.traverse(child => {
                            if (child.isMesh) {
                                raycastTargets.push(child);
                            }
                        });
                    }
                });
            }
        });
        
        const intersects = raycaster.intersectObjects(raycastTargets, false);
        
        if (intersects.length > 0) {
            domElement.style.cursor = 'pointer';
        } else {
            domElement.style.cursor = 'default';
        }
    }
    
    domElement.addEventListener('pointermove', onPointerMove);
}

/**
 * Set cursor to clickable (pointer/grab hand)
 * @param {HTMLElement} element - The DOM element to update
 */
export function setClickableCursor(element) {
    element.style.cursor = 'pointer';
}

/**
 * Set cursor to default
 * @param {HTMLElement} element - The DOM element to update
 */
export function setDefaultCursor(element) {
    element.style.cursor = 'default';
}
