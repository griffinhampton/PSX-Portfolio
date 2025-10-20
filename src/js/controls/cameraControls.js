import { OrbitControls } from "jsm/controls/OrbitControls.js";

/**
 * Set up orbit controls for camera
 * @param {THREE.Camera} camera - The camera to control
 * @param {HTMLElement} domElement - The renderer's DOM element
 * @returns {OrbitControls} The configured controls
 */
export function setupCameraControls(camera, domElement) {
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .05; // Lower value for more noticeable damping
    controls.enablePan = false; // Disable panning - camera stays in fixed position
    controls.mouseButtons = {
        LEFT: 0, // THREE.MOUSE.ROTATE
        MIDDLE: 1, // THREE.MOUSE.DOLLY
        RIGHT: 0 // THREE.MOUSE.ROTATE
    };

    return controls;
}
