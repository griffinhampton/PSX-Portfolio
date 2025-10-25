/**
 * Set up position tracking and raycaster for displaying object information
 * @param {Object} qualitySettings - The quality settings object
 * @returns {Object} Object containing allMeshes array, positionInfoDiv, and update function
 */
export function setupPositionTracker(qualitySettings) {
    const allMeshes = [];
    let positionInfoDiv = null;

    // Always grab the element so the console toggle can control it, but respect
    // the qualitySettings.enablePositionTracker flag when updating content.
    positionInfoDiv = document.getElementById('positionInfo');

    // Console-controlled visibility flag. Default to false so the div is hidden
    // unless a developer explicitly enables it via `seePositionInfo(true)`.
    if (typeof window !== 'undefined') {
        if (typeof window.__SEE_POSITION_INFO === 'undefined') window.__SEE_POSITION_INFO = false;

        // expose a simple console API to toggle the position info div
        window.seePositionInfo = function enablePositionInfo(val) {
            try {
                window.__SEE_POSITION_INFO = !!val;
                const el = document.getElementById('positionInfo');
                if (el) {
                    el.style.display = window.__SEE_POSITION_INFO ? 'block' : 'none';
                }
            } catch (e) {
                // no-op in non-browser environments
            }
        };
    }

    /**
     * Update position info display based on raycaster intersection
     * @param {THREE.Raycaster} raycaster - The raycaster instance
     * @param {THREE.Vector2} mouse - The mouse position vector
     */
    function updatePositionInfo(raycaster, mouse) {
    // Only update if the position tracker feature is enabled AND the
    // developer has explicitly allowed the info to be shown via the
    // console toggle seePositionInfo(true).
    if (!qualitySettings.enablePositionTracker || !positionInfoDiv || (typeof window !== 'undefined' && !window.__SEE_POSITION_INFO)) return;
        
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
