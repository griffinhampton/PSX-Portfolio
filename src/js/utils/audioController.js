/**
 * Global audio controller for muting/unmuting all audio
 */

let isMuted = false;
let videoElements = [];

/**
 * Register a video element to be controlled by the mute button
 * @param {HTMLVideoElement} videoElement 
 */
export function registerVideo(videoElement) {
    if (videoElement && !videoElements.includes(videoElement)) {
        videoElements.push(videoElement);
        videoElement.muted = isMuted;
    }
}

/**
 * Unregister a video element
 * @param {HTMLVideoElement} videoElement 
 */
export function unregisterVideo(videoElement) {
    const index = videoElements.indexOf(videoElement);
    if (index > -1) {
        videoElements.splice(index, 1);
    }
}

/**
 * Mute all registered audio
 */
export function muteAll() {
    isMuted = true;
    videoElements.forEach(video => {
        video.muted = true;
    });
}

/**
 * Unmute all registered audio
 */
export function unmuteAll() {
    isMuted = false;
    videoElements.forEach(video => {
        video.muted = false;
    });
}

/**
 * Toggle mute state
 * @returns {boolean} New mute state
 */
export function toggleMute() {
    if (isMuted) {
        unmuteAll();
    } else {
        muteAll();
    }
    return isMuted;
}

/**
 * Get current mute state
 * @returns {boolean}
 */
export function getMuteState() {
    return isMuted;
}

// NOTE: The UI mute button was removed from the markup. The audio controller
// continues to provide programmatic control via registerVideo/unregisterVideo,
// muteAll/unmuteAll/toggleMute/getMuteState for internal modules (e.g. video textures).
