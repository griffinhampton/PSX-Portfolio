/**
 * Setup video player overlay for displaying YouTube videos
 * @param {string} videoId - YouTube video ID
 * @returns {Object} Player manager with show/hide methods
 */
export function setupVideoPlayer(videoId) {
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'video-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.5);
        color: white;
        font-size: 32px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        cursor: pointer;
        z-index: 1001;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        padding: 0;
    `;
    closeButton.onmouseover = () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.3)';
        closeButton.style.transform = 'scale(1.1)';
    };
    closeButton.onmouseout = () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.2)';
        closeButton.style.transform = 'scale(1)';
    };

    // Create video container
    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = `
        position: relative;
        width: 90%;
        max-width: 1200px;
        aspect-ratio: 16 / 9;
        background: black;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    `;

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
    `;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;

    // Assemble
    videoContainer.appendChild(iframe);
    overlay.appendChild(closeButton);
    overlay.appendChild(videoContainer);
    document.body.appendChild(overlay);

    // Close handlers
    const hide = () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
            // Stop video by clearing src
            iframe.src = '';
        }, 300);
    };

    closeButton.onclick = hide;
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            hide();
        }
    };

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.style.display === 'flex') {
            hide();
        }
    });

    return {
        show() {
            // Set iframe src when showing
            iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
            overlay.style.display = 'flex';
            // Trigger reflow for transition
            overlay.offsetHeight;
            overlay.style.opacity = '1';
        },
        hide,
        dispose() {
            document.body.removeChild(overlay);
        }
    };
}
