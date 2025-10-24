import * as THREE from "three";
import gsap from 'gsap';
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
import { setupMuteButton, getMuteState, toggleMute } from "./src/js/utils/audioController.js";
import { setupNavbar } from "./src/js/utils/navbar.js";
import { initLoadingScreen } from "./src/js/utils/loadingScreen.js";
import { setupBoisvertTeleporter } from "./src/js/utils/boisvertTeleporter.js";
import { initAchievements, registerDefaultAchievements } from "./src/js/utils/achievements.js";

// Initialize loading screen
const loadingController = initLoadingScreen();

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

// Set up camera controls (first-person click-drag style)
const fpControls = setupCameraControls(camera, renderer.domElement, qualitySettings);

// Controls shim: always present and passed to animation loop. By default it delegates to fpControls.
// We can dynamically attach FlyControls (dev only) and switch delegation to it without changing other code.
const controls = {
    // underlying references
    _fp: fpControls,
    _fly: null,
    _clock: null,
    // placeholder target so code that expects controls.target (e.g., teleporter) continues to work
    target: new THREE.Vector3(),
    // switch delegate: 'fp' | 'fly'
    _mode: 'fp',
    setMode(m) { this._mode = m; },
    // Delegate drag-speed and dragging state to underlying fpControls when available
    isUserDragging() {
        try { return this._fp && typeof this._fp.isUserDragging === 'function' ? this._fp.isUserDragging() : false; } catch (e) { return false; }
    },
    setDragSpeed(v) {
        try { if (this._fp && typeof this._fp.setDragSpeed === 'function') this._fp.setDragSpeed(v); } catch (e) {}
    },
    getDragSpeed() {
        try { return this._fp && typeof this._fp.getDragSpeed === 'function' ? this._fp.getDragSpeed() : undefined; } catch (e) { return undefined; }
    },
    update() {
        try {
            if (this._mode === 'fly' && this._fly && this._clock) {
                // FlyControls expects delta seconds
                const dt = this._clock.getDelta();
                this._fly.update(dt);
            } else if (this._fp && typeof this._fp.update === 'function') {
                this._fp.update();
            }
        } catch (e) {
            // Defensive: swallow control update errors during dev
            console.warn('[controls] update error', e);
        }
    }
};

// Expose controls for debugging/console overrides
window.fpControls = fpControls;
window.controls = controls;

// Dev toggle: temporarily enable FlyControls for debugging. Set to false when done.
const ENABLE_DEV_FLY_CONTROLS = false; // TODO: set false before shipping
if (ENABLE_DEV_FLY_CONTROLS) {
    // Dynamically import FlyControls from CDN; keeps production bundle unchanged when flag is false
    import('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/controls/FlyControls.js')
        .then(mod => {
            try {
                const FlyControls = mod.FlyControls;
                // Create a clock for delta time
                const clock = new THREE.Clock();
                // Instantiate FlyControls
                const fly = new FlyControls(camera, renderer.domElement);
                // Configure for developer-friendly navigation
                fly.movementSpeed = 4.0;
                fly.rollSpeed = Math.PI / 6;
                fly.dragToLook = false;
                fly.autoForward = false;

                // Attach to shim
                controls._fly = fly;
                controls._clock = clock;
                controls._mode = 'fly';

                // Expose for console
                window.flyControls = fly;
                console.info('[dev] FlyControls enabled (temporary) - controls now delegating to FlyControls');
            } catch (err) {
                console.warn('[dev] Failed to initialize FlyControls', err);
            }
        })
        .catch(err => {
            console.warn('[dev] Failed to import FlyControls module', err);
        });
}

// Disable look when camera is at navigation position index 5
const DISABLE_LOOK_INDEX = 5;
function isCameraNearPosition(pos, threshold = 0.6) {
    if (!pos || pos.length < 3) return false;
    const dx = camera.position.x - pos[0];
    const dy = camera.position.y - pos[1];
    const dz = camera.position.z - pos[2];
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return dist <= threshold;
}

// Register predicate with controls if available
if (controls && typeof controls.setShouldDisableLookFn === 'function') {
    controls.setShouldDisableLookFn(() => {
        const targetPos = navigationPositions[DISABLE_LOOK_INDEX];
        if (isCameraNearPosition(targetPos, 0.9)) {
            const clampYaw = Math.PI * 0.35; // ~63 degrees each side
            const clampPitch = Math.PI * 0.4; // allow typical pitch range
            return { clampYaw, clampPitch };
        }
        // Otherwise, no clamping
        return null;
    });
}

// Initialize unified cursor manager
initializeCursorManager(renderer.domElement, camera);

// Setup mute button
setupMuteButton();


const BASE_NAVIGATION_POSITIONS = [
    [-1.73, 1.2, 38],
    [-1.7, 0.5, 32],
    [-1, 0, 22],
    [-0.87, 0.6, 10.78],
    [1.62, 0.75, 2.16],
    [3.13, 0.7, 0.04]
];

// Wire settings UI (settingsButton, settingsPanel, dragSpeedRange) to camera controls
document.addEventListener('DOMContentLoaded', () => {
    try {
        const settingsBtn = document.getElementById('settingsButton');
        const settingsPanel = document.getElementById('settingsPanel');
        const dragRange = document.getElementById('dragSpeedRange');
        const dragVal = document.getElementById('dragSpeedValue');

        // Mute checkbox wiring
        const muteCheckbox = document.getElementById('muteCheckbox');
        const muteBtn = document.getElementById('muteButton');
        const speakerIcon = muteBtn ? muteBtn.querySelector('.speaker-icon') : null;
        const muteIcon = muteBtn ? muteBtn.querySelector('.mute-icon') : null;
        try {
            if (muteCheckbox) {
                // Initialize from current mute state
                const currentlyMuted = typeof getMuteState === 'function' ? getMuteState() : false;
                muteCheckbox.checked = !!currentlyMuted;
                if (muteBtn) {
                    if (currentlyMuted) { muteBtn.classList.add('muted'); if (speakerIcon) speakerIcon.style.display = 'none'; if (muteIcon) muteIcon.style.display = 'block'; }
                    else { muteBtn.classList.remove('muted'); if (speakerIcon) speakerIcon.style.display = 'block'; if (muteIcon) muteIcon.style.display = 'none'; }
                }

                muteCheckbox.addEventListener('change', () => {
                    try {
                        const newState = toggleMute(); // toggles and returns new state
                        // sync checkbox (toggleMute already flipped it) and button appearance
                        if (muteBtn) {
                            if (newState) { muteBtn.classList.add('muted'); if (speakerIcon) speakerIcon.style.display = 'none'; if (muteIcon) muteIcon.style.display = 'block'; }
                            else { muteBtn.classList.remove('muted'); if (speakerIcon) speakerIcon.style.display = 'block'; if (muteIcon) muteIcon.style.display = 'none'; }
                        }
                        try { muteCheckbox.checked = !!newState; } catch (e) {}
                    } catch (e) { console.warn('[settings] mute toggle failed', e); }
                });
            }
        } catch (e) {}

        if (settingsBtn && settingsPanel) {
            settingsBtn.addEventListener('click', () => {
                settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
            });
        }
        // Settings panel close button
        try {
            const settingsClose = document.getElementById('settingsCloseBtn');
            if (settingsClose && settingsPanel) {
                settingsClose.addEventListener('click', () => { settingsPanel.style.display = 'none'; });
            }
        } catch (e) {}

        if (dragRange && dragVal) {
            // Initialize value from controls if available
            try {
                if (window.controls && typeof window.controls.getDragSpeed === 'function') {
                    const current = window.controls.getDragSpeed();
                    dragRange.value = current;
                    dragVal.innerText = Number(current).toFixed(4);
                }
            } catch (e) {}

            dragRange.addEventListener('input', (e) => {
                const v = e.target.value;
                dragVal.innerText = Number(v).toFixed(4);
                try {
                    if (window.controls && typeof window.controls.setDragSpeed === 'function') {
                        window.controls.setDragSpeed(Number(v));
                    } else if (window.fpControls && typeof window.fpControls.setDragSpeed === 'function') {
                        window.fpControls.setDragSpeed(Number(v));
                    }
                } catch (err) { console.warn('[settings] failed to set drag speed', err); }
            });
        }
        // Achievements panel close button if present
        try {
            const achClose = document.getElementById('achievementsCloseBtn');
            const achPopup = document.getElementById('achievementsPopup');
            if (achClose && achPopup) {
                achClose.addEventListener('click', () => { achPopup.style.display = 'none'; });
            }
        } catch (e) {}
    } catch (e) {}
});


const ADDITIONAL_NAVIGATION_POSITIONS = [
    [4, -8, 10]
];

// Expose additional positions on window for modules that expect a global reference
try { window.ADDITIONAL_NAVIGATION_POSITIONS = ADDITIONAL_NAVIGATION_POSITIONS; } catch (e) {}

// Keep `navigationPositions` as the original base array for achievements and special logic
const navigationPositions = BASE_NAVIGATION_POSITIONS;

// `orbNavigationPositions` is used by the orb navigation system and may include DLC positions
const orbNavigationPositions = BASE_NAVIGATION_POSITIONS.concat(ADDITIONAL_NAVIGATION_POSITIONS);
// Boisvert spawn positions for each camera position (base values)
const boisvertSpawnPositions = [
    [-3.5, -.5, 42],      // Position 0: First camera position
    [-10, 1.5, 32],          // Position 1
    [11.11,1.2, 25],          // Position 2
    [-3.5, -2.5, 20],          // Position 3
    [-3.15, -1, -.9],          // Position 4
    [-3.8, -1.5, 0]           // Position 5: Last/inside position
];

// If you've added additional navigation positions, extend boisvert spawn positions by
// repeating the last known spawn position so indices stay aligned. You can customize
// `ADDITIONAL_BOISVERT_SPAWNS` if you want per-position spawn coordinates.
const ADDITIONAL_BOISVERT_SPAWNS = [];
const extendedBoisvertSpawnPositions = boisvertSpawnPositions.concat(
    ADDITIONAL_BOISVERT_SPAWNS.length ? ADDITIONAL_BOISVERT_SPAWNS : new Array(ADDITIONAL_NAVIGATION_POSITIONS.length).fill(boisvertSpawnPositions[boisvertSpawnPositions.length - 1])
);

// Boisvert Z rotation for each navigation position (base values)
const boisvertZRotations = [
    Math.PI / 2-4.5, // nav position 0
    Math.PI / 2, // nav position 1
    Math.PI /2, // nav position 2
    Math.PI / 5, // nav position 3
    0,           // nav position 4
    -Math.PI / 2 // nav position 5
];

// Extend rotations similarly by repeating the last rotation if no explicit additional rotations are provided
const ADDITIONAL_BOISVERT_Z = [];
const extendedBoisvertZRotations = boisvertZRotations.concat(
        ADDITIONAL_BOISVERT_Z.length ? ADDITIONAL_BOISVERT_Z : new Array(ADDITIONAL_NAVIGATION_POSITIONS.length).fill(boisvertZRotations[boisvertZRotations.length - 1])
);

// Positions where camera-interactive objects are (TV screen)
// These are NOT part of the orb navigation - accessed only by clicking objects
const cameraInteractivePositions = [
    [-0.3, 0.10, -0.85] // Screen position
];

// Set up particles
const particles = setupParticles(scene, cross, qualitySettings);
const particleArrays = particles.particleArrays;

// Set up lights
const lights = setupLights(scene, camera, qualitySettings);
const { flashlight, raycaster, mouse, centerLight } = lights;
// expose flashlight for global fallback access
try { window.flashlight = flashlight; } catch (e) {}

// Set up particle mouse listener
if (qualitySettings.enableFlashlight && mouse) {
    setupParticleMouseListener(mouse, qualitySettings);
}

// Set up window resize handler
setupResizeHandler(camera, renderer, composer, pixelationPass, qualitySettings);

// Set up orb navigation system (after lights are added so orbs are visible)
let orbManager;
try {
    orbManager = setupOrbNavigation(scene, camera, renderer.domElement, orbNavigationPositions, flashlight, qualitySettings, cameraInteractivePositions, navigationPositions.length);
} catch (error) {
    // Orb navigation setup failed
}

// Setup navbar navigation
// Navbar, achievements, interactive objects, and Boisvert logic remain tied to the original `navigationPositions`
setupNavbar(camera, navigationPositions, orbManager, flashlight);

// Wire the new DLC nav button to navigate to the first additional position (if present)
const dlcBtn = document.getElementById('navDLC');
if (dlcBtn) {
    dlcBtn.addEventListener('click', () => {
        try {
            if (ADDITIONAL_NAVIGATION_POSITIONS && ADDITIONAL_NAVIGATION_POSITIONS.length > 0) {
                const firstDLC = ADDITIONAL_NAVIGATION_POSITIONS[0];
                // Use the global helper if available, otherwise fall back to direct GSAP
                if (window.navigateToPosition) {
                    window.navigateToPosition(firstDLC, 30);
                } else {
                    gsap.to(camera.position, {
                        x: firstDLC[0], y: firstDLC[1], z: firstDLC[2], duration: 2, ease: 'power2.inOut',
                        onComplete: () => { if (flashlight) flashlight.intensity = 30; if (orbManager && typeof orbManager.update === 'function') orbManager.update(); }
                    });
                }
            }
        } catch (e) { console.warn('[navDLC] error navigating to DLC position', e); }
    });
}

// Initialize achievements system
// Register defaults first so persistence logic can reference achievement metadata
registerDefaultAchievements();
const achievements = initAchievements();
// keep explicit global reference for console testing
window.achievements = achievements;
// Unlock 'first_visit' when the user dismisses the welcome popup (ENTER THE WOODS)
const welcomeBtn = document.getElementById('welcomeButton');
if (welcomeBtn) {
    welcomeBtn.addEventListener('click', () => {
        try {
            console.debug('[achievements] attempting unlock welcome_forest');
            // mark that the player has entered the woods this session
            try { window.hasEnteredWoods = true; } catch (e) {}
            const ok = achievements.unlock('welcome_forest');
            if (!ok) {
                // show as fallback in case it's already unlocked or unlock failed
                achievements.show && achievements.show('welcome_forest');
                // ensure toggle indicates there's a new achievement until user opens panel
                try {
                    if (window.achievements && typeof window.achievements.markHasNew === 'function') {
                        window.achievements.markHasNew();
                    } else {
                        // fallback to dispatching the unlocked event
                        window.dispatchEvent(new CustomEvent('achievement:unlocked', { detail: { id: 'welcome_forest' } }));
                    }
                } catch (e) {}
            }
        } catch (e) {}
    });
}

// Also listen for the centralized welcome event (fired after popup hides)
window.addEventListener('welcome:entered', () => {
    try {
    // mark that the player has entered the woods this session
    try { window.hasEnteredWoods = true; } catch (e) {}
    console.debug('[achievements] welcome:entered received — unlocking welcome_forest');
    const ok = achievements.unlock('welcome_forest');
    if (!ok) achievements.show && achievements.show('welcome_forest');
    } catch (e) {}
});

// Populate achievements popup when it's opened and wire reset button
function renderAchievementsPopup() {
    const container = document.getElementById('achievementsListContainer');
    if (!container || !window.achievements) return;
    const list = window.achievements.getAll();
    container.innerHTML = '';
    list.forEach(a => {
        const item = document.createElement('div');
        item.className = 'achievement-item' + (a.unlocked ? ' unlocked' : '');
        item.style.padding = '8px 6px';
        item.style.borderBottom = '1px dashed rgba(255,255,255,0.05)';
        item.style.display = 'flex';
        item.style.alignItems = 'center';

    const textWrap = document.createElement('div');
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';
    textWrap.style.flex = '1 1 auto';

    const title = document.createElement('div');
    title.className = 'achievement-title';
    title.innerText = a.title;
    const desc = document.createElement('div');
    desc.className = 'achievement-desc';
    desc.innerText = a.description;

    textWrap.appendChild(title);
    textWrap.appendChild(desc);

    const icon = document.createElement('span');
    icon.className = 'achievement-icon';
    icon.setAttribute('aria-hidden', 'true');
    // Use the same '×' character as the popup close button for consistency
    icon.innerText = a.unlocked ? '✔' : '×';
    icon.style.marginLeft = '12px';
    icon.style.flex = '0 0 auto';

    item.appendChild(textWrap);
    item.appendChild(icon);
        container.appendChild(item);
    });
}

// Open popup handler: ensure popup content is up to date
const achToggle = document.getElementById('achievementsToggle');
if (achToggle) {
    function removeAchievementBadge() {
        try {
            const existing = document.getElementById('achievementBadge');
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            // restore pointer-events if we changed it
            achToggle.style.pointerEvents = '';
        } catch (e) {}
    }

    achToggle.addEventListener('click', () => {
        // Opening the achievements panel should clear the new-achievement badge
        removeAchievementBadge();
        setTimeout(renderAchievementsPopup, 50); // slight delay to ensure display
    });
}

// Reset button removed from UI - no wiring required

// Keep popup updated when an achievement is unlocked
window.addEventListener('achievement:unlocked', () => {
    // Update the achievements popup and show a red exclamation badge on the toggle
    try { renderAchievementsPopup(); } catch (e) {}

    try {
        const btn = document.getElementById('achievementsToggle');
        if (btn) {
            // Ensure the button is positioned so the absolute badge sits correctly
            if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';

            // If badge already exists, don't recreate
            if (!document.getElementById('achievementBadge')) {
                const span = document.createElement('span');
                span.id = 'achievementBadge';
                span.textContent = '!';
                span.setAttribute('aria-hidden', 'true');
                // Inline styles to avoid needing CSS edits
                span.style.position = 'absolute';
                span.style.top = '4px';
                span.style.right = '6px';
                span.style.background = '#e53935';
                span.style.color = 'white';
                span.style.borderRadius = '50%';
                span.style.width = '18px';
                span.style.height = '18px';
                span.style.display = 'flex';
                span.style.alignItems = 'center';
                span.style.justifyContent = 'center';
                span.style.fontSize = '12px';
                span.style.fontWeight = '700';
                span.style.lineHeight = '18px';
                span.style.zIndex = '1000';
                span.style.pointerEvents = 'none';
                btn.appendChild(span);
            }
        }
    } catch (e) { /* ignore */ }
});

// Setup Boisvert teleporter (wait for model to load)
let boisvertTeleporter = null;
setTimeout(() => {
    boisvertTeleporter = setupBoisvertTeleporter(
        scene,
        camera,
        navigationPositions,
        controls,
        extendedBoisvertSpawnPositions,
        extendedBoisvertZRotations // <-- pass the extended arrays here
    );
    // Store globally for animation loop access
    window.boisvertTeleporter = boisvertTeleporter;
}, 2000); // Wait 2 seconds for model to load

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
        },
        {
            objectName: 'paper', // New paper object in the GLTF scene
            targetPosition: [2.71, 0.6, -0.02], // Raised 0.1 higher on Y
            zOffset: 0,
            shouldRotate: false, // No continuous rotation
            shouldJitter: true, // Enable shaking
            jitterAmount: 0.007, // Tighter shake area
            targetRotation: [0 , Math.PI / 10-.4, Math.PI / 2], // Rotate 90° Y, 30° Z
            moveDuration: 1.5,
            clickCooldown: 5000
        },
        {
            objectName: 'painting', // Parent object name in the GLTF scene
            targetPosition: [1.71, 1.0, -0.04], // Moved forward +1 X and up +0.5 Y for better viewing
            zOffset: 0,
            shouldRotate: false, // No rotation
            shouldJitter: true, // Enable swaying motion
            jitterAmount: 0.01, // Amount of sway movement
            targetRotation: [0, Math.PI / 2, 0], // Rotate to face camera (90 degrees on Y axis)
            moveDuration: 1.5,
            clickCooldown: 5000 // 5 second cooldown before user can click away
        }
        // Add more interactive objects here with the same pattern
    ];

    // Define allowed camera positions for clicking interactive objects:
    // Only last navigation position (cola and painting only clickable from last position)
    const allowedPositions = [
        navigationPositions[navigationPositions.length - 1] // Last orb position [3.13, 0.7, 0.04]
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
        // Do NOT unlock on 'play' (user may scrub or autoplay). We'll unlock when
        // the player actually clicks the screen and the camera moves to the screen view.
    }

    const cameraInteractiveConfigs = [
        {
            objectName: 'screen', // Name of screen object in GLTF
            cameraPosition: [-0.3, 0.10, -0.85], // Camera position when viewing screen
            moveDuration: 1.5,
            showVideo: true // Show video when camera reaches position
        }
    ];

    // Callback to re-enable previous orb when camera moves away from interactive objects
    const onCameraInteractiveClick = (object, config) => {
        if (orbManager && typeof orbManager.enablePreviousOrb === 'function') {
            // Get the previous camera position from the camera interactive manager
            const prevPos = cameraInteractiveManager.getPreviousCameraPosition();
            orbManager.enablePreviousOrb(prevPos);
        }

        // If this interaction is the screen (config.showVideo), unlock 'watched_screen'
        try {
            if (config && config.showVideo) {
                // Prevent duplicate unlocks in-session and respect persisted state
                if (!(achievements && typeof achievements.isUnlocked === 'function' && achievements.isUnlocked('watched_screen')) && !window._hasUnlockedWatchedScreen) {
                    window._hasUnlockedWatchedScreen = true;
                    try { achievements.unlock('watched_screen'); } catch (e) {}
                    // Check composite master_interactor
                    try {
                        if (achievements && typeof achievements.isUnlocked === 'function') {
                            const all = achievements.isUnlocked('clicked_paper') && achievements.isUnlocked('clicked_painting') && achievements.isUnlocked('clicked_cola');
                            if (all) { try { achievements.unlock('master_interactor'); } catch(e) {} }
                        }
                    } catch(e) {}
                }

                // Show screen popup with a single return control
                try {
                    console.debug('[cameraInteractive] screen interaction detected');
                    let screenPopup = document.getElementById('screenPopup');
                    console.debug('[screenPopup] attempting to show popup, element=', !!screenPopup);
                    if (!screenPopup) {
                        console.debug('[screenPopup] element not found, creating dynamic popup');
                        const dyn = document.createElement('div');
                        dyn.id = 'screenPopup';
                        // Use the linkedin popup styles so it inherits bottom positioning
                        dyn.className = 'linkedin-popup';
                        dyn.style.position = 'fixed';
                        dyn.style.zIndex = '9999';
                        dyn.innerHTML = `<div class="popup-card popup-small draggable"><button class="popup-close" id="screenReturnBtn">×</button><div class="popup-body" style="display:flex;align-items:center;gap:12px;"><button id="screenReturnAction" class="popup-return-btn" style="padding:8px 10px;">×</button><span style="font-size:14px;color:#fff;">return to chair</span></div></div>`;
                        document.body.appendChild(dyn);
                        screenPopup = dyn;
                    }
                    // Force it above the canvas; positioning (bottom/left) is handled by CSS
                    screenPopup.style.display = 'block';
                    screenPopup.style.position = 'fixed';
                    screenPopup.style.zIndex = '9999';

                    const resetToChair = () => {
                        try {
                            const lastIdx = navigationPositions.length - 1;
                            const target = navigationPositions[lastIdx];
                            // Animate camera back to chair position
                            gsap.to(camera.position, {
                                x: target[0],
                                y: target[1],
                                z: target[2],
                                duration: 1.5,
                                ease: 'power2.inOut',
                                onComplete: () => {
                                    // Update orb manager visible orbs
                                    try { if (orbManager && typeof orbManager.update === 'function') orbManager.update(); } catch (e) {}
                                }
                            });
                        } catch (e) {}
                    };

                    const returnBtn = document.getElementById('screenReturnBtn');
                    const returnAction = document.getElementById('screenReturnAction');
                    const hidePopup = () => { if (screenPopup) screenPopup.style.display = 'none'; };
                    if (returnBtn) {
                        returnBtn.addEventListener('click', () => { hidePopup(); resetToChair(); });
                    }
                    if (returnAction) {
                        returnAction.addEventListener('click', () => { hidePopup(); resetToChair(); });
                    }
                } catch (e) { console.warn('[screenPopup] error showing popup', e); }
            }
        } catch (e) { console.warn('[cameraInteractive] error handling screen interaction', e); }

        // Hide About Me popup when navigating away from painting
        const aboutPopup = document.getElementById('aboutPopup');
        if (aboutPopup) {
            aboutPopup.style.display = 'none';
        }
    };

    // Only show TV indicator from last position
    const tvIndicatorPositions = [
        navigationPositions[navigationPositions.length - 1] // Last orb position [3.13, 0.7, 0.04]
    ];

    cameraInteractiveManager = setupCameraInteractiveObjects(
        scene, 
        renderer.domElement, 
        camera, 
        cameraInteractiveConfigs,
        flashlight, // Pass flashlight to dim when at screen
        screenVideo, // Pass video controller
        onCameraInteractiveClick,
        tvIndicatorPositions // Pass allowed positions for showing indicator
    );
    
    // Store globally for animation loop access
    window.cameraInteractiveManager = cameraInteractiveManager;

    // Hook: unlock 'visited_last_position' when orbManager reaches last index
    // Listen for arrival events and unlock when player actually arrives at last position
    window.addEventListener('orb:arrived', (e) => {
        try {
            const idx = e && e.detail ? e.detail.index : null;
            const lastIndex = navigationPositions.length - 1;
            if (idx === lastIndex) {
                if (!window.hasEnteredWoods) return;
                if (window._hasUnlockedEnterCabin) return;
                window._hasUnlockedEnterCabin = true;
                if (achievements && typeof achievements.isUnlocked === 'function' && achievements.isUnlocked('enter_cabin')) return;
                achievements.unlock('enter_cabin');
            }
            // If player arrives at the first additional (DLC) position (index === base length), unlock visited_first_dlc
            try {
                const firstDLCIndex = navigationPositions.length;
                if (idx === firstDLCIndex) {
                    try { achievements && achievements.unlock && achievements.unlock('visited_first_dlc'); } catch (e) {}
                }
            } catch (e) {}
        } catch (err) {}
    });
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
    youtubeScreen: () => screenVideo, // Pass video controller getter
    navigationPositions
});

animate();