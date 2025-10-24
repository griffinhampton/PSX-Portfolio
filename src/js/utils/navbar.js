import gsap from 'gsap';

/**
 * Setup navigation bar functionality
 * @param {THREE.Camera} camera - The camera to control
 * @param {Array} navigationPositions - Array of navigation path positions
 * @param {Object} orbManager - The orb manager for updating visible orbs
 * @param {Object} flashlight - The flashlight for intensity control
 */
export function setupNavbar(camera, navigationPositions, orbManager, flashlight) {
    const navButtons = {
        start: document.getElementById('navBackToStart'),
        cabin: document.getElementById('navToCabin')
    };

    /**
     * Navigate camera to a specific position with animation
     * @param {Array<number>} targetPosition - [x, y, z] position to navigate to
     * @param {number} flashlightIntensity - Intensity for flashlight at destination
     */
    function navigateToPosition(targetPosition, flashlightIntensity = 30) {
        // Kill any ongoing camera animations
        gsap.killTweensOf(camera.position);

        // Animate camera to target position
        gsap.to(camera.position, {
            x: targetPosition[0],
            y: targetPosition[1],
            z: targetPosition[2],
            duration: 2,
            ease: 'power2.inOut',
            onComplete: () => {
                // Update flashlight intensity
                if (flashlight) {
                    flashlight.intensity = flashlightIntensity;
                }
                
                // Update visible orbs if orbManager exists
                if (orbManager && typeof orbManager.update === 'function') {
                    orbManager.update();
                }
            }
        });
    }

    // Expose helper globally so other modules (e.g. Boisvert click) can reuse the same
    // navigation behavior without depending on module return values.
    try {
        window.navigateToPosition = navigateToPosition;
    } catch (e) {
        // ignore if we cannot set global
    }

    // Back to Start - Navigate to first position
    if (navButtons.start) {
        navButtons.start.addEventListener('click', () => {
            const startPosition = navigationPositions[0]; // First position
            navigateToPosition(startPosition, 30);
        });
    }

    // To the Cabin - Navigate to last position
    if (navButtons.cabin) {
        navButtons.cabin.addEventListener('click', () => {
            const cabinPosition = navigationPositions[navigationPositions.length - 1]; // Last position
            navigateToPosition(cabinPosition, 5); // Dimmed flashlight at cabin
        });
    }



    return {
        navigateToPosition,
        dispose() {
            // Remove event listeners if needed
            Object.values(navButtons).forEach(button => {
                if (button) {
                    button.replaceWith(button.cloneNode(true));
                }
            });
        }
    };
}
