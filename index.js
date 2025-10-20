import * as THREE from "three";
import { getQualitySettings } from "./src/js/utils/mobileDetect.js";
import { setupScene } from "./src/js/scene/sceneSetup.js";
import { setupPostProcessing } from "./src/js/postprocessing/postprocesses.js";
import { setupLights } from "./src/js/lights/lights.js";
import { setupParticles, setupParticleMouseListener } from "./src/js/particles/particles.js";
import { setupModelLoader } from "./src/js/loaders/modelLoader.js";
import { setupCameraControls } from "./src/js/controls/cameraControls.js";
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

// Set up post-processing with pixelation effect - only on desktop
let composer, pixelationPass;
if (qualitySettings.enablePostProcessing) {
    const postProcessing = setupPostProcessing(renderer, scene, camera);
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

// Set up particles
const particles = setupParticles(scene, cross, qualitySettings);
const particlesMesh = particles.particlesMesh;

// Set up lights
const lights = setupLights(scene, camera, qualitySettings);
const { flashlight, raycaster, mouse, centerLight } = lights;

// Set up particle mouse listener
if (qualitySettings.enableFlashlight && mouse) {
    setupParticleMouseListener(mouse, qualitySettings);
}

// Set up window resize handler
setupResizeHandler(camera, renderer, composer, pixelationPass, qualitySettings);

// Create and start animation loop
const animate = createAnimationLoop({
    renderer,
    composer,
    controls,
    qualitySettings,
    lights,
    particlesMesh,
    models,
    updatePositionInfo
});

animate();