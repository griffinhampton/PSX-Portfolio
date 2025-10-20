import { GLTFLoader } from "jsm/loaders/GLTFLoader.js";

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
        environment: null
    };


    // Load environment model
    gltfLoader.load('src/models/env/whole_scene.gltf', (gltfScene) => {
        models.environment = gltfScene.scene;
        models.environment.position.set(0, 0, 0);
        scene.add(models.environment);
        
        // Add all meshes to raycasting array
        models.environment.traverse((child) => {
            if (child.isMesh) {
                allMeshes.push(child);
            }
        });
    });

    return models;
}
