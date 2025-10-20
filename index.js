import * as THREE from "three";
import { getQualitySettings } from "./src/js/utils/mobileDetect.js";
import { setupScene } from "./src/js/scene/sceneSetup.js";
import { setupPostProcessing } from "./src/js/postprocessing/postprocesses.js";
import { setupLights } from "./src/js/lights/lights.js";
import { setupParticles, setupParticleMouseListener, updateParticles } from "./src/js/particles/particles.js";
import { setupModelLoader } from "./src/js/loaders/modelLoader.js";
import { setupCameraControls, setupOrbNavigation } from "./src/js/controls/cameraControls.js";
import { setupPositionTracker } from "./src/js/utils/positionTracker.js";
import { setupResizeHandler } from "./src/js/utils/resizeHandler.js";
import { createAnimationLoop } from "./src/js/animation/animationLoop.js";


const qualitySettings = getQualitySettings();
console.log('Device detected:', qualitySettings.isMobile ? 'Mobile' : 'Desktop');
console.log('Quality settings:', qualitySettings);

// Texture loader
const loader = new THREE.TextureLoader();
const cross = loader.load('src/textures/cross.png');

// Set up scene, camera, and renderer
const { scene, camera, renderer } = setupScene(qualitySettings);

// Make camera and scene globally accessible for animation loop
window.camera = camera;
window.scene = scene;

// Set up post-processing with pixelation effect - now works on mobile too!
let composer, pixelationPass;
if (qualitySettings.enablePostProcessing) {
    const postProcessing = setupPostProcessing(renderer, scene, camera, qualitySettings);
    composer = postProcessing.composer;
    pixelationPass = postProcessing.pixelationPass;
}

// Set up position tracker
const positionTracker = setupPositionTracker(qualitySettings);
const { allMeshes, updatePositionInfo } = positionTracker;

// Load models
const models = setupModelLoader(scene, allMeshes);

// Set up camera controls
const controls = setupCameraControls(camera, renderer.domElement);

// Navigation path positions
const navigationPositions = [
    [-1.73, 1.2, 38],
    [-1.7, 0.5, 26.67],
    [-0.6, 0.5, 19.3],
    [-0.87, 0.6, 15.78],
    [-0.25, 0.65, 11.35],
    [1.62, 0.75, 2.16],
    [3.13, 0.8, 0.04]
];

// Set up particles
const particles = setupParticles(scene, cross, qualitySettings);
const particleArrays = particles.particleArrays;

// Set up lights
const lights = setupLights(scene, camera, qualitySettings);
const { flashlight, raycaster, mouse, centerLight } = lights;

// Set up particle mouse listener
if (qualitySettings.enableFlashlight && mouse) {
    setupParticleMouseListener(mouse, qualitySettings);
}

// Set up window resize handler
setupResizeHandler(camera, renderer, composer, pixelationPass, qualitySettings);

// Set up orb navigation system (after lights are added so orbs are visible)
let orbManager;
try {
    orbManager = setupOrbNavigation(scene, camera, renderer.domElement, navigationPositions, flashlight);
    console.log('Orb manager initialized successfully');
} catch (error) {
    console.error('Error setting up orb navigation:', error);
}

// Create and start animation loop
const animate = createAnimationLoop({
    renderer,
    composer,
    controls,
    qualitySettings,
    lights,
    particleArrays,
    models,
    updatePositionInfo,
    orbManager
});

animate();