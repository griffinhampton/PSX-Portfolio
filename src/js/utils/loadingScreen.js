/**
 * Loading screen with rotating messages and progress bar
 */

// Array of loading messages (you can add your own quotes here)
const loadingMessages = [
    "INITIALIZING...",
    "LOADING ASSETS...",
    "RENDERING ENVIRONMENT...",
    "ADDING ONE MORE PIXEL...",
    "ALMOST THERE...",
    "MAKING LOADING TEXT IS SO MUCH FUN... NO ONE COULD SEE THIS AND I WOULD NEVER KNOW... ARE YOU THERE..?",
    "this loading text is lowercase...",
    "LOADING...",
    "SOOOO... THE WEATHER..."
];

let currentMessageIndex = 0;
let messageOrder = [];

/**
 * Shuffle array to get random order
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Initialize loading screen
 */
export function initLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingMessage = document.getElementById('loadingMessage');
    const loadingBar = document.getElementById('loadingBar');
    const loadingPercent = document.getElementById('loadingPercent');

    if (!loadingScreen || !loadingMessage || !loadingBar || !loadingPercent) {
        console.warn('Loading screen elements not found');
        return;
    }

    // Shuffle messages for random order
    messageOrder = shuffleArray(loadingMessages);
    currentMessageIndex = 0;

    // Set initial message
    loadingMessage.textContent = messageOrder[0];

    // Track loading progress
    let progress = 0;
    let isComplete = false;

    // Rotate messages every 2 seconds
    const messageInterval = setInterval(() => {
        if (!isComplete) {
            currentMessageIndex = (currentMessageIndex + 1) % messageOrder.length;
            loadingMessage.textContent = messageOrder[currentMessageIndex];
        }
    }, 2000);

    /**
     * Update loading progress
     */
    function updateProgress(newProgress) {
        if (isComplete) return;
        
        progress = Math.min(newProgress, 100);
        loadingBar.style.width = `${progress}%`;
        loadingPercent.textContent = `${Math.floor(progress)}%`;

        // Complete loading when we reach 100%
        if (progress >= 100) {
            isComplete = true;
            clearInterval(messageInterval);
            loadingMessage.textContent = "COMPLETE!";
            
            // Fade out loading screen after a brief delay
            setTimeout(() => {
                loadingScreen.classList.add('fade-out');
                
                // Remove loading screen from DOM after fade completes
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                    
                    // Show welcome popup
                    showWelcomePopup();
                }, 500);
            }, 500);
    
        }
    }

    // Simulate loading progress
    // In a real scenario, you'd update this based on actual asset loading
    let simulatedProgress = 0;
    const progressInterval = setInterval(() => {
        if (simulatedProgress < 90) {
            // Faster initial progress
            simulatedProgress += Math.random() * 15;
        } else if (simulatedProgress < 100) {
            // Slower near the end
            simulatedProgress += Math.random() * 5;
        }

        updateProgress(simulatedProgress);

        if (simulatedProgress >= 100) {
            clearInterval(progressInterval);
        }
    }, 300);

    return {
        updateProgress,
        complete: () => updateProgress(100)
    };
}

/**
 * Hook into Three.js loading manager to show real progress
 */
export function setupLoadingManager(loadingManager, loadingScreenController) {
    if (!loadingManager || !loadingScreenController) return;

    loadingManager.onProgress = (url, loaded, total) => {
        const progress = (loaded / total) * 100;
        loadingScreenController.updateProgress(progress);
    };

    loadingManager.onLoad = () => {
        loadingScreenController.complete();
    };
}

/**
 * Show welcome popup
 */
function showWelcomePopup() {
    const welcomePopup = document.getElementById('welcomePopup');
    const welcomeButton = document.getElementById('welcomeButton');
    
    if (!welcomePopup || !welcomeButton) {
        console.warn('Welcome popup elements not found');
        return;
    }
    
    // Show the popup
    welcomePopup.style.display = 'flex';
    
    // Handle button click
    welcomeButton.addEventListener('click', () => {
        welcomePopup.style.animation = 'fadeIn 0.3s ease-out reverse';
        
        setTimeout(() => {
            welcomePopup.style.display = 'none';
            // Emit an event so other parts of the app know the user entered
            try { window.dispatchEvent(new CustomEvent('welcome:entered')); } catch (e) {}
        }, 300);
    });
}
