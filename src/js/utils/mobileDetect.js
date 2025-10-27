import * as THREE from 'three';

// Mobile detection utility
export function isMobileDevice() {
    // Check user agent
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    
    // Check for mobile devices
    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const isMobileUA = mobileRegex.test(userAgent);
    
    // Check for touch support
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    // Check screen size (assuming mobile if width < 768px)
    const isSmallScreen = window.innerWidth < 768;
    
    // Return true if any mobile indicator is present
    return isMobileUA || (hasTouch && isSmallScreen);
}

// Check if device is in landscape mode
export function isLandscapeMode() {
    return window.innerWidth > window.innerHeight;
}

// Quality settings based on device
export function getQualitySettings() {
    const isMobile = isMobileDevice();
    const isLandscape = isLandscapeMode();
    
    if (isMobile) {
        return {
            isMobile: true,
            particleCount: 2000,
            shadowMapSize: 512,
            enablePostProcessing: true,  // Enable for mobile
            // Slightly reduce pixelation to be less aggressive on small screens
            pixelSize: 1.75,
            renderScale: isLandscape ? 1.0 : 0.8,  // Full res in landscape, 80% in portrait
            enableFlashlight: false,
            enableDynamicEffects: true,
            enablePositionTracker: false,
            antialias: false,
            maxLights: 2,
            shadowsEnabled: false,
            fogEnabled: true,
            orbSize: 0.3,  // Larger orbs for easier touch interaction
            orbRaycastThreshold: 0.5  // Larger hit area for touch
        };
    } else {
        return {
            isMobile: false,
            particleCount: 2000,
            shadowMapSize: 512,
            enablePostProcessing: true,
            // Reduce pixel size by 1 to make the effect noticeably less blocky
            pixelSize: 2.75,
            renderScale: 1.0,  // Full resolution
            enableFlashlight: true,
            enableDynamicEffects: true,
            enablePositionTracker: true,
            antialias: false,
            maxLights: 5,
            shadowsEnabled: false,
            fogEnabled: true,
            orbSize: 0.2,  // Standard orb size
            orbRaycastThreshold: 0.3  // Standard hit area
        };
    }
}

// Initialize a RotationPad only after the user explicitly enters the woods
// (clicks the welcome/enter button). This mirrors the UX where movement pad
// appears when walk mode is enabled — rotation pad should not be visible until
// the player has opted into the experience.
if (isMobileDevice()) {
    let _rotationPadInitialized = false;

    function initRotationPadOnce() {
        if (_rotationPadInitialized) return;
        _rotationPadInitialized = true;

        import('./RotationPad.js').then(mod => {
            try {
                const RotationPad = mod.default;
                const pad = new RotationPad(document.body);
                try { window.rotationPad = pad; } catch (e) {}

                // Base sensitivity constants; actual sensitivity can be overridden at runtime
                const BASE_SENSITIVITY = 0.06;
                // Make vertical (pitch) even slower relative to horizontal
                const VERTICAL_MULTI = 0.5; // vertical is 50% of horizontal
                // Listen for pad events and consult any runtime override on window.__rotationPadSensitivity
                pad.padElement.addEventListener('YawPitch', (ev) => {
                    try {
                        const d = ev && ev.detail ? ev.detail : null;
                        if (!d) return;
                        const dx = (typeof d.deltaX === 'number') ? d.deltaX : 0;
                        const dy = (typeof d.deltaY === 'number') ? d.deltaY : 0;

                        const camera = window.camera;
                        if (!camera) return;

                        // Allow runtime override: window.__rotationPadSensitivity (normalized value)
                        // If present and numeric, treat it as a multiplier for the base sensitivity.
                        let runtimeSens = null;
                        try { if (typeof window.__rotationPadSensitivity === 'number') runtimeSens = window.__rotationPadSensitivity; } catch (e) {}
                        const HORIZONTAL_SENSITIVITY = (runtimeSens !== null) ? runtimeSens : (BASE_SENSITIVITY * 0.1);

                        const PI_2 = Math.PI / 2;
                        const euler = new THREE.Euler();
                        euler.setFromQuaternion(camera.quaternion, 'YXZ');
                        euler.y -= dx * HORIZONTAL_SENSITIVITY;
                        euler.x -= dy * HORIZONTAL_SENSITIVITY * VERTICAL_MULTI;
                        euler.x = Math.max(-PI_2 + 0.1, Math.min(PI_2 - 0.1, euler.x));
                        camera.quaternion.setFromEuler(euler);

                        try { if (window.controls && window.controls.target && typeof window.controls.target.copy === 'function') window.controls.target.copy(camera.position); } catch (e) {}
                    } catch (e) { /* ignore */ }
                });
            } catch (err) {
                console.warn('[mobileDetect] failed to initialize RotationPad', err);
            }
        }).catch(err => { /* ignore dynamic import error */ console.warn('[mobileDetect] RotationPad import failed', err); });
    }

    // Listen for the welcome event (fired when user enters the woods) and initialize pad then
    try {
        window.addEventListener('welcome:entered', initRotationPadOnce);
    } catch (e) {}

    // Also hook the welcome button click as a fallback
    document.addEventListener('DOMContentLoaded', () => {
        try {
            const wb = document.getElementById('welcomeButton');
            if (wb) wb.addEventListener('click', initRotationPadOnce, { once: true });
        } catch (e) {}
    });
}
