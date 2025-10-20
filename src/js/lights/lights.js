import * as THREE from "three";

/**
 * Helper function to create a 14-sided texture for spotlight
 * @returns {THREE.CanvasTexture} The pentagon texture
 */
function createPentagonTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Fill black background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 512, 512);
    
    // Draw white 14-sided polygon
    ctx.fillStyle = 'white';
    ctx.beginPath();
    const centerX = 256;
    const centerY = 256;
    const radius = 240;
    const sides = 14;
    
    for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
    ctx.fill();
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

/**
 * Set up all lights for the scene
 * @param {THREE.Scene} scene - The scene to add lights to
 * @param {THREE.Camera} camera - The camera for flashlight positioning
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing all light references
 */
export function setupLights(scene, camera, qualitySettings) {
    const lights = {};

    // Reduced ambient light for darker outdoor atmosphere
    lights.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(lights.ambientLight);

    // Darker hemisphere light with cool tones for night atmosphere
    lights.hemiLight = new THREE.HemisphereLight(0x4466aa, 0x111122, 0.4);
    scene.add(lights.hemiLight);

    // Warm cabin light - main focal point near the cabin at 0,0,0
    lights.cabinLight = new THREE.PointLight(0xffab3f, 25, 15);
    lights.cabinLight.position.set(2, 1, 0);
    if (qualitySettings.shadowsEnabled) {
        lights.cabinLight.castShadow = true;
        lights.cabinLight.shadow.mapSize.width = qualitySettings.shadowMapSize;
        lights.cabinLight.shadow.mapSize.height = qualitySettings.shadowMapSize;
    }
    scene.add(lights.cabinLight);

    // Only add additional lights on desktop
    if (!qualitySettings.isMobile) {
        lights.cabinLight2 = new THREE.PointLight(0xffab3f, 25, 100);
        lights.cabinLight2.position.set(2, 5, 0);
        if (qualitySettings.shadowsEnabled) {
            lights.cabinLight2.castShadow = true;
            lights.cabinLight2.shadow.mapSize.width = qualitySettings.shadowMapSize;
            lights.cabinLight2.shadow.mapSize.height = qualitySettings.shadowMapSize;
        }
        scene.add(lights.cabinLight2);

        // Strong center point light (interior/close lighting)
        lights.centerLight = new THREE.PointLight(0xffffff, 10, 5);
        lights.centerLight.position.set(0, 1, 1);
        scene.add(lights.centerLight);
    }

    // Reduced directional light for subtle depth
    lights.directionalLight = new THREE.DirectionalLight(0xaaccff, 0.5);
    lights.directionalLight.position.set(5, 10, 5);
    scene.add(lights.directionalLight);

    // Flashlight - only on desktop
    if (qualitySettings.enableFlashlight) {
        // Flashlight spotlight that follows mouse - tighter beam, darker, pentagonal shape
        lights.flashlight = new THREE.SpotLight(0xffffff, 30, 30, Math.PI / 12, 0.3, 1);
        lights.flashlight.position.copy(camera.position);
        if (qualitySettings.shadowsEnabled) {
            lights.flashlight.castShadow = true;
            lights.flashlight.shadow.mapSize.width = qualitySettings.shadowMapSize;
            lights.flashlight.shadow.mapSize.height = qualitySettings.shadowMapSize;
            lights.flashlight.shadow.camera.near = 0.5;
            lights.flashlight.shadow.camera.far = 30;
        }
        lights.flashlight.map = createPentagonTexture(); // Add pentagonal shape
        scene.add(lights.flashlight);
        scene.add(lights.flashlight.target); // Add target to scene so we can move it

        // Raycaster for flashlight mouse tracking
        lights.raycaster = new THREE.Raycaster();
        lights.mouse = new THREE.Vector2();
    }

    // Light sphere - only add if centerLight exists (desktop only)
    if (!qualitySettings.isMobile && lights.centerLight) {
        const lightSphereGeo = new THREE.SphereGeometry(0.05, 16, 16);
        const lightSphereMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0
        });

        lights.lightSphere = new THREE.Mesh(lightSphereGeo, lightSphereMat);
        lights.centerLight.add(lights.lightSphere);
    }

    return lights;
}
