import { getQualitySettings } from './mobileDetect.js';

/**
 * Set up window resize handler
 * @param {THREE.Camera} camera - The camera to update
 * @param {THREE.WebGLRenderer} renderer - The renderer to update
 * @param {Object} composer - The effect composer (optional)
 * @param {Object} pixelationPass - The pixelation pass (optional)
 * @param {Object} qualitySettings - The quality settings object (will be updated on resize)
 */
export function setupResizeHandler(camera, renderer, composer, pixelationPass, qualitySettings) {
    function handleWindowResize() {
        // Re-evaluate quality settings for orientation changes
        const newSettings = getQualitySettings();
        Object.assign(qualitySettings, newSettings);
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Update camera aspect ratio
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        // Update renderer size
        renderer.setSize(width, height);
        
        // Update composer and pixelation shader resolution - only if post-processing is enabled
        if (qualitySettings.enablePostProcessing && composer && pixelationPass) {
            const renderScale = qualitySettings.renderScale || 1.0;
            const renderWidth = Math.floor(width * renderScale);
            const renderHeight = Math.floor(height * renderScale);
            composer.setSize(renderWidth, renderHeight);
            pixelationPass.uniforms.resolution.value.set(renderWidth, renderHeight);
        }
    }

    // Add resize event listener
    window.addEventListener('resize', handleWindowResize);

    return handleWindowResize;
}
