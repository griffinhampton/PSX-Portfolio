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

// Quality settings based on device
export function getQualitySettings() {
    const isMobile = isMobileDevice();
    
    if (isMobile) {
        return {
            isMobile: true,
            particleCount: 5000,
            shadowMapSize: 512,
            enablePostProcessing: false,
            enableFlashlight: false,
            enableDynamicEffects: false,
            enablePositionTracker: false,
            antialias: false,
            maxLights: 2,
            shadowsEnabled: false,
            fogEnabled: true
        };
    } else {
        return {
            isMobile: false,
            particleCount: 100000,
            shadowMapSize: 1024,
            enablePostProcessing: true,
            enableFlashlight: true,
            enableDynamicEffects: true,
            enablePositionTracker: true,
            antialias: true,
            maxLights: 5,
            shadowsEnabled: true,
            fogEnabled: true
        };
    }
}
