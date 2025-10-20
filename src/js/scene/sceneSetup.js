import * as THREE from "three";

/**
 * Set up the main scene, renderer, and camera
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing scene, camera, and renderer
 */
export function setupScene(qualitySettings) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // Set up renderer
    const renderer = new THREE.WebGLRenderer({antialias: qualitySettings.antialias});
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, .95);
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
