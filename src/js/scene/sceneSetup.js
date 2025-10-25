import * as THREE from "three";

/**
 * Set up the main scene, renderer, and camera
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing scene, camera, and renderer
 */
export function setupScene(qualitySettings) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // Set up renderer with alpha so DOM behind the canvas can show through
    // (this allows a DOM watermark behind the canvas to be visible and
    // be occluded by rendered 3D content)
    const renderer = new THREE.WebGLRenderer({antialias: qualitySettings.antialias, alpha: true});
    renderer.setSize(w, h);
    // Use a fully transparent clear color so DOM elements behind the canvas
    // can be visible where the WebGL scene doesn't draw over them.
    renderer.setClearColor(0x000000, 0);
    document.body.appendChild(renderer.domElement);

    // Enable shadows - only on desktop
    renderer.shadowMap.enabled = qualitySettings.shadowsEnabled;
    if (qualitySettings.shadowsEnabled) {
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Set up camera
    const fov = 75;
    const aspect = w / h;
    const near = 0.1;
    const far = 100;
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    // Start at first navigation point
    camera.position.set(-1.73, 1.2, 38);

    // Set up scene
    const scene = new THREE.Scene();

    // Add fog that starts 10 units from camera
    if (qualitySettings.fogEnabled) {
        scene.fog = new THREE.Fog(0x333333, 10, 25); // color, near (10 units), far (50 units)
    }

    return { scene, camera, renderer };
}
