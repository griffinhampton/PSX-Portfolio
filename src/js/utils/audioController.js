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

/**
 * Setup the mute button in the UI
 */
export function setupMuteButton() {
    const muteButton = document.getElementById('muteButton');
    const speakerIcon = muteButton.querySelector('.speaker-icon');
    const muteIcon = muteButton.querySelector('.mute-icon');

    if (!muteButton) return;

    muteButton.addEventListener('click', () => {
        const newMuteState = toggleMute();
        
        // Update button appearance
        if (newMuteState) {
            muteButton.classList.add('muted');
            speakerIcon.style.display = 'none';
            muteIcon.style.display = 'block';
        } else {
            muteButton.classList.remove('muted');
            speakerIcon.style.display = 'block';
            muteIcon.style.display = 'none';
        }
    });
}
