import { GLTFLoader } from "jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

/**
 * Load GLTF models and add them to the scene
 * @param {THREE.Scene} scene - The scene to add models to
 * @param {Array} allMeshes - Array to collect meshes for raycasting
 * @returns {Object} Object containing model references and loader
 */
export function setupModelLoader(scene, allMeshes) {
    const gltfLoader = new GLTFLoader();
    const models = {
        furniture: null,
        environment: null,
        lanternLight: null
    };


    // Load environment model
    gltfLoader.load('src/models/env/whole_scene.gltf', (gltfScene) => {
        models.environment = gltfScene.scene;
        models.environment.position.set(0, 0, 0);
        scene.add(models.environment);
        
        // Add all meshes to raycasting array and find glass object for lantern
        models.environment.traverse((child) => {
            if (child.isMesh) {
                allMeshes.push(child);
            }
            
            // Look for glass object (try common naming patterns)
            const name = child.name.toLowerCase();
            if (name.includes('glass') || name.includes('lantern')) {
                // Create warm point light at glass position
                const lanternLight = new THREE.PointLight(0xffaa55, 2, 5, 2); // Warm orange, intensity 2, distance 5, decay 2
                
                // Add light as child of the glass object so it moves with it
                child.add(lanternLight);
                models.lanternLight = lanternLight;
            }
            // If mesh name indicates an in-scene light fixture for the backroom, create a cold white light
            // Matching should be case-insensitive and accept names like 'backroom-light', 'Backroom_Light', etc.
            if (name.includes('backroom-light')) {
                try {
                    // Cold white color (bluish-white) - use 0xeeeeff for a clean cool-white office look
                    const COLD_WHITE = 0xeeeeff;
                    // Use a very bright PointLight (omnidirectional) for office ceiling fixtures
                    // Higher intensity and longer distance to flood the area
                    // Intensity set to 20.0 (very bright); distance to 40 to cover larger rooms
                    const backroomLight = new THREE.PointLight(COLD_WHITE, 20.0, 40, 2);
                    backroomLight.decay = 2;

                    // Keep shadows off by default for performance
                    try {
                        backroomLight.castShadow = false;
                        backroomLight.shadow.mapSize.width = 1024;
                        backroomLight.shadow.mapSize.height = 1024;
                        backroomLight.shadow.bias = -0.0005;
                    } catch (e) {}

                    // Attach the light to the fixture mesh so it moves with it
                    child.add(backroomLight);

                    // Add a small ambient boost to the whole scene if not already added by this loader
                    if (!models._backroomAmbientAdded) {
                        try {
                            const ambient = new THREE.AmbientLight(0xffffff, 0.6); // gentle ambient to reduce dark contrast
                            scene.add(ambient);
                            models._backroomAmbient = ambient;
                            models._backroomAmbientAdded = true;
                        } catch (e) {}
                    }

                    // If the mesh has a material, make it slightly emissive so it appears lit
                    if (child.material) {
                        // Support for an array of materials
                        const setEmissive = (mat) => {
                            try {
                                if ('emissive' in mat) {
                                    // Save original emissive for debugging if needed
                                    mat.userData = mat.userData || {};
                                    if (mat.userData._origEmissive === undefined) mat.userData._origEmissive = mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000);
                                    mat.emissive = new THREE.Color(COLD_WHITE);
                                    // Increase emissiveIntensity so fixture geometry reads as a bright ceiling lamp
                                    mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 1, 8.0);
                                } else if ('color' in mat) {
                                    // Fallback: tint the color slightly
                                    mat.color = new THREE.Color().lerpColors(mat.color, new THREE.Color(COLD_WHITE), 0.2);
                                }
                            } catch (e) {
                                // ignore material tweak errors
                            }
                        };

                        if (Array.isArray(child.material)) {
                            child.material.forEach(setEmissive);
                        } else {
                            setEmissive(child.material);
                        }
                    }

                    // Keep a reference for potential future adjustments
                    models.backroomLight = models.backroomLight || [];
                    models.backroomLight.push(backroomLight);
                } catch (err) {
                    console.warn('Failed to create backroom light for', child.name, err);
                }
            }
        });
    });

    return models;
}
