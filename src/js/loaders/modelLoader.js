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

    // Load furniture model
    gltfLoader.load("src/models/furniture/nightstand.gltf", (gltfScene) => {
        models.furniture = gltfScene.scene;
        models.furniture.position.set(-1, -1, -2);
        console.log("furniture loaded successfully!");
        scene.add(models.furniture);
        
        // Add all meshes to raycasting array
        models.furniture.traverse((child) => {
            if (child.isMesh) {
                allMeshes.push(child);
            }
        });
    });

    // Load environment model
    gltfLoader.load('src/models/env/mountainPlane.gltf', (gltfScene) => {
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
