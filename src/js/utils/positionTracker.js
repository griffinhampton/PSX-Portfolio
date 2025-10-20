/**
 * Set up position tracking and raycaster for displaying object information
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing allMeshes array, positionInfoDiv, and update function
 */
export function setupPositionTracker(qualitySettings) {
    const allMeshes = [];
    let positionInfoDiv = null;

    if (qualitySettings.enablePositionTracker) {
        positionInfoDiv = document.getElementById('positionInfo');
    }

    /**
     * Update position info display based on raycaster intersection
     * @param {THREE.Raycaster} raycaster - The raycaster instance
     * @param {THREE.Vector2} mouse - The mouse position vector
     */
    function updatePositionInfo(raycaster, mouse) {
        if (!qualitySettings.enablePositionTracker || !positionInfoDiv) return;
        
        raycaster.setFromCamera(mouse, window.camera);
        
        // Get all intersections with meshes
        const intersects = raycaster.intersectObjects(allMeshes, true);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const object = intersects[0].object;
            positionInfoDiv.innerHTML = `
                Position: x: ${point.x.toFixed(2)}, y: ${point.y.toFixed(2)}, z: ${point.z.toFixed(2)}<br>
                Object: ${object.name || object.type}<br>
                Distance: ${intersects[0].distance.toFixed(2)}
            `;
        } else {
            positionInfoDiv.innerHTML = 'Hover over objects to see position';
        }
    }

    return {
        allMeshes,
        positionInfoDiv,
        updatePositionInfo
    };
}
