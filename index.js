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
import { setupInteractiveObjects } from "./src/js/utils/interactiveObjects.js";
import { setupCameraInteractiveObjects } from "./src/js/utils/cameraInteractiveObjects.js";
import { setupScreenVideoTexture } from "./src/js/utils/screenVideoTexture.js";
import { initializeCursorManager } from "./src/js/utils/cursorManager.js";
import { setupMuteButton } from "./src/js/utils/audioController.js";
import { setupNavbar } from "./src/js/utils/navbar.js";


const qualitySettings = getQualitySettings();

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
const controls = setupCameraControls(camera, renderer.domElement, qualitySettings);

// Initialize unified cursor manager
initializeCursorManager(renderer.domElement, camera);

// Setup mute button
setupMuteButton();

// Navigation path positions
const navigationPositions = [
    [-1.73, 1.2, 38],
    [-1.7, 0.5, 32],
    [-1, 0, 22],
    [-0.87, 0.6, 10.78],
    [1.62, 0.75, 2.16],
    [3.13, 0.7, 0.04]
];

// Positions where camera-interactive objects are (TV, painting, etc.)
// These are NOT part of the orb navigation - accessed only by clicking objects
const cameraInteractivePositions = [
    [-0.3, 0.10, -0.85], // Screen position
    [1.66, 0.9, -1] // Painting position
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
    orbManager = setupOrbNavigation(scene, camera, renderer.domElement, navigationPositions, flashlight, qualitySettings, cameraInteractivePositions);
} catch (error) {
    // Orb navigation setup failed
}

// Setup navbar navigation
setupNavbar(camera, navigationPositions, orbManager, flashlight);

// Set up interactive objects - Will be set after model loads
let interactiveManager = null;

// Wait for model to load, then set up real interactive objects
setTimeout(() => {
    // Last position is [3.13, 0.7, 0.04]
    const interactiveConfigs = [
        {
            objectName: 'cola', // Parent object name in the GLTF scene
            targetPosition: [2.71, 0.5, -0.02],
            zOffset: 0,
            shouldRotate: true,
            rotationSpeed: 0.005, // Slow rotation speed
            moveDuration: 1.5,
            clickCooldown: 5000 // 5 second cooldown before user can click away
        }
        // Add more interactive objects here with the same pattern
    ];

    // Define allowed camera positions for clicking interactive objects:
    // Last two navigation positions + any camera interactive object positions
    const allowedPositions = [
        navigationPositions[navigationPositions.length - 2], // Second to last orb position [1.62, 0.75, 2.16]
        navigationPositions[navigationPositions.length - 1], // Last orb position [3.13, 0.7, 0.04]
        [-0.3, 0.10, -0.85], // Screen position
        [1.66, 0.9, -1] // Painting position
    ];

    interactiveManager = setupInteractiveObjects(scene, renderer.domElement, camera, interactiveConfigs, allowedPositions);
}, 2000); // Wait 2 seconds for model to load

// Set up camera-interactive objects (like screen) - Will be set after model loads
let cameraInteractiveManager = null;
let screenVideo = null;

setTimeout(() => {
    // Find the screen object in the scene
    let screenObject = null;
    scene.traverse((child) => {
        if (child.name === 'screen') {
            screenObject = child;
        }
    });

    if (screenObject) {
        // Setup video texture on the 3D screen
        screenVideo = setupScreenVideoTexture(screenObject, 'src/videos/NOLD.mp4');
    }

    const cameraInteractiveConfigs = [
        {
            objectName: 'screen', // Name of screen object in GLTF
            cameraPosition: [-0.3, 0.10, -0.85], // Camera position when viewing screen
            moveDuration: 1.5,
            showVideo: true // Show video when camera reaches position
        },
        {
            objectName: 'painting', // Name of painting object in GLTF
            cameraPosition: [1.66, 0.9, -1], // Camera position when viewing painting
            moveDuration: 1.5,
            showVideo: false // Don't show video for painting
        }
    ];

    // Callback to re-enable previous orb when camera moves to screen
    const onScreenClick = () => {
        if (orbManager && typeof orbManager.enablePreviousOrb === 'function') {
            // Get the previous camera position from the camera interactive manager
            const prevPos = cameraInteractiveManager.getPreviousCameraPosition();
            orbManager.enablePreviousOrb(prevPos);
        }
    };

    cameraInteractiveManager = setupCameraInteractiveObjects(
        scene, 
        renderer.domElement, 
        camera, 
        cameraInteractiveConfigs,
        flashlight, // Pass flashlight to dim when at screen
        screenVideo, // Pass video controller
        onScreenClick
    );
}, 2000); // Wait 2 seconds for model to load

// Create and start animation loop
// NOTE: Don't pass interactiveManager directly - animation loop will check the variable
const animate = createAnimationLoop({
    renderer,
    composer,
    controls,
    qualitySettings,
    lights,
    particleArrays,
    models,
    updatePositionInfo,
    orbManager,
    getInteractiveManager: () => interactiveManager, // Pass a getter function instead
    youtubeScreen: () => screenVideo // Pass video controller getter
});

animate();