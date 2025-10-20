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
            particleCount: 5000,
            shadowMapSize: 512,
            enablePostProcessing: true,  // Enable for mobile
            pixelSize: 3, 
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
            particleCount: 5000,
            shadowMapSize: 1024,
            enablePostProcessing: true,
            pixelSize: 3,  // Smaller pixels for sharper look
            renderScale: 1.0,  // Full resolution
            enableFlashlight: true,
            enableDynamicEffects: true,
            enablePositionTracker: true,
            antialias: true,
            maxLights: 5,
            shadowsEnabled: true,
            fogEnabled: true,
            orbSize: 0.2,  // Standard orb size
            orbRaycastThreshold: 0.3  // Standard hit area
        };
    }
}
