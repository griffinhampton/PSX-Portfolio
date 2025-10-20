/**
 * Set up window resize handler
 * @param {THREE.Camera} camera - The camera to update
 * @param {THREE.WebGLRenderer} renderer - The renderer to update
 * @param {Object} composer - The effect composer (optional)
 * @param {Object} pixelationPass - The pixelation pass (optional)
 * @param {Object} qualitySettings - The quality settings object
 */
export function setupResizeHandler(camera, renderer, composer, pixelationPass, qualitySettings) {
    function handleWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Update camera aspect ratio
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        // Update renderer size
        renderer.setSize(width, height);
        
        // Update composer and pixelation shader resolution - only if post-processing is enabled
        if (qualitySettings.enablePostProcessing && composer && pixelationPass) {
            composer.setSize(width, height);
            pixelationPass.uniforms.resolution.value.set(width, height);
        }
    }

    // Add resize event listener
    window.addEventListener('resize', handleWindowResize);

    return handleWindowResize;
}
