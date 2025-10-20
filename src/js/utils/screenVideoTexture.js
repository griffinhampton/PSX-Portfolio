import * as THREE from 'three';
import { registerVideo, getMuteState } from './audioController.js';

/**
 * Setup video texture on a screen object
 * @param {THREE.Object3D} screenObject - The 3D screen object
 * @param {string} videoSrc - Path to video file (e.g., 'src/videos/my-video.mp4')
 * @returns {Object} Video controller
 */
export function setupScreenVideoTexture(screenObject, videoSrc) {
    // Create video element
    const video = document.createElement('video');
    video.src = videoSrc;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = getMuteState(); // Use global mute state
    video.playsInline = true;
    video.preload = 'auto';
    video.style.display = 'none';
    document.body.appendChild(video);
    
    // Register video with audio controller
    registerVideo(video);

    // Create video texture
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    
    // Rotate texture 90 degrees counterclockwise
    videoTexture.center.set(0.5, 0.5);
    videoTexture.rotation = Math.PI / 2; // 90 degrees in radians

    // Find the screen mesh and apply texture
    let screenMesh = null;
    screenObject.traverse((child) => {
        if (child.isMesh) {
            screenMesh = child;
            // Store original material
            child.userData.originalMaterial = child.material;
            
            // Create new material with video texture
            child.material = new THREE.MeshBasicMaterial({
                map: videoTexture,
                side: THREE.FrontSide, // Try FrontSide first, change to BackSide if video is on wrong side
                toneMapped: false
            });
        }
    });

    return {
        show() {
            video.play().catch(err => {
                console.warn('Video autoplay blocked, user interaction required');
            });
        },
        hide() {
            video.pause();
            video.currentTime = 0;
        },
        play() {
            video.play().catch(err => {
                console.warn('Video play failed:', err);
            });
        },
        pause() {
            video.pause();
        },
        setVolume(level) {
            video.volume = Math.max(0, Math.min(1, level));
        },
        mute() {
            video.muted = true;
        },
        unmute() {
            video.muted = false;
        },
        toggleMute() {
            video.muted = !video.muted;
            return video.muted;
        },
        getVideo() {
            return video;
        },
        render(camera) {
            // No-op for compatibility with animation loop
        },
        setSize(width, height) {
            // No-op for compatibility
        },
        dispose() {
            video.pause();
            document.body.removeChild(video);
            videoTexture.dispose();
            if (screenMesh && screenMesh.userData.originalMaterial) {
                screenMesh.material = screenMesh.userData.originalMaterial;
            }
        }
    };
}
