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
        });
    });

    return models;
}
