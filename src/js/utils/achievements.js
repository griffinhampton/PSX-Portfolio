// Simple achievements system: register, persist, unlock, and show toasts/panel
const STORAGE_KEY = 'psx_achievements_v1';
const META_KEY = 'psx_achievements_meta_v1';

let achievementsMap = new Map();
let unlockedSet = new Set();
let container = null; // panel container
let toastContainer = null;
let visibleToasts = new Set(); // track currently visible toast IDs to prevent duplicates
let meta = { seenPopup: false, hasNew: false };

function loadMeta() {
    try {
        const raw = localStorage.getItem(META_KEY);
        if (!raw) return;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') meta = Object.assign(meta, obj);
    } catch (e) {
        console.warn('Failed to load achievements meta from storage', e);
    }
}

function saveMeta() {
    try {
        localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
        console.warn('Failed to save achievements meta to storage', e);
    }
}

function updateToggleIcon() {
    try {
        const toggleBtn = document.querySelector('#achievementsToggle');
        const toggleImg = toggleBtn ? toggleBtn.querySelector('img') : null;
        // Determine desired src
    let desired = 'src/textures/achievement-base.png';
        if (meta.hasNew) desired = 'src/textures/achievement-new.png';
        else if (meta.seenPopup) desired = 'src/textures/achievement-base.png';

    

        if (toggleImg) {
            // Try to set img src; if it errors, fallback to button background
            toggleImg.src = desired;
            // ensure button background is cleared so the img is visible
            if (toggleBtn) toggleBtn.style.backgroundImage = '';
        } else if (toggleBtn) {
            // If no <img> element was found, set the button background as a fallback
            toggleBtn.style.backgroundImage = `url('${desired}')`;
            toggleBtn.style.backgroundRepeat = 'no-repeat';
            toggleBtn.style.backgroundPosition = 'center';
            toggleBtn.style.backgroundSize = 'contain';
        }

        // Visual indicator: add a red border when there's a new achievement
        if (toggleBtn) {
            if (meta.hasNew) {
                // Use a noticeable red border; preserve existing borderRadius if set
                toggleBtn.style.border = '2px solid #e53935';
                // Optional subtle glow
                toggleBtn.style.boxShadow = '0 0 8px rgba(229,57,53,0.35)';
            } else {
                // Clear border/boxShadow to revert to default styling
                toggleBtn.style.border = '';
                toggleBtn.style.boxShadow = '';
            }
        }
    } catch (e) {
        // silent
    }
}

function loadUnlocked() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            // Only restore unlocked achievements that are still considered persistent
            const filtered = arr.filter(id => {
                const ach = achievementsMap.get(id);
                // If achievement isn't registered yet, keep it for backwards compatibility
                if (!ach) return true;
                // Default persistence = true; only ignore if persistent === false
                return ach.persistent !== false;
            });
            unlockedSet = new Set(filtered);
        }
    } catch (e) {
        console.warn('Failed to load achievements from storage', e);
    }
}

function saveUnlocked() {
    try {
        // Only persist achievements marked as persistent (default true)
        const toPersist = Array.from(unlockedSet).filter(id => {
            const ach = achievementsMap.get(id);
            if (!ach) return true; // unknown achievements persisted for compatibility
            return ach.persistent !== false;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch (e) {
        console.warn('Failed to save achievements to storage', e);
    }
}

function ensureContainers() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'achievements-toast-container';
        // Position and sizing differ between mobile and desktop to avoid covering UI
        try {
            const isMobile = (typeof navigator !== 'undefined') && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
            toastContainer.style.position = 'fixed';
            toastContainer.style.zIndex = '99999';
            toastContainer.style.pointerEvents = 'none';
            // Place toasts in the top-right on both platforms to avoid covering bottom UI
            // Mobile gets slightly tighter inset
            if (isMobile) {
                toastContainer.style.top = '12px';
                toastContainer.style.right = '12px';
            } else {
                toastContainer.style.top = '20px';
                toastContainer.style.right = '20px';
            }
        } catch (e) {}
        document.body.appendChild(toastContainer);
    }
    if (!container) {
        container = document.createElement('div');
        container.id = 'achievements-panel';
        container.className = 'achievements-panel hidden';
        const header = document.createElement('div');
        header.className = 'achievements-panel-header';
        header.innerText = 'Achievements';
        const close = document.createElement('button');
        close.className = 'achievements-panel-close';
        close.innerText = '×';
        close.addEventListener('click', () => container.classList.add('hidden'));
        header.appendChild(close);
        container.appendChild(header);

        const list = document.createElement('div');
        list.className = 'achievements-list';
        list.id = 'achievements-list';
        container.appendChild(list);

        const resetBtn = document.createElement('button');
        resetBtn.className = 'achievements-reset';
        resetBtn.innerText = 'Reset Achievements';
        resetBtn.addEventListener('click', () => {
            resetAchievements();
            renderPanel();
        });
        container.appendChild(resetBtn);

        document.body.appendChild(container);
    }
}

function renderPanel() {
    ensureContainers();
    const list = container.querySelector('#achievements-list');
    list.innerHTML = '';
    for (const [id, ach] of achievementsMap.entries()) {
        const item = document.createElement('div');
        item.className = 'achievement-item' + (unlockedSet.has(id) ? ' unlocked' : '');
        const title = document.createElement('div');
        title.className = 'achievement-title';
        title.innerText = ach.title || id;
        const desc = document.createElement('div');
        desc.className = 'achievement-desc';
        desc.innerText = ach.description || '';
        item.appendChild(title);
        item.appendChild(desc);
        list.appendChild(item);
    }
}

function showToast(achievement) {
    ensureContainers();
    const id = achievement.id || null;
    // prevent duplicate visible toasts for the same achievement
    if (id && visibleToasts.has(id)) return;
    if (id) visibleToasts.add(id);

    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `<strong>${achievement.title}</strong><div class="achievement-toast-desc">${achievement.description || ''}</div>`;
    // Apply device-specific sizing so mobile toasts are small and don't cover controls
    try {
        const isMobile = (typeof navigator !== 'undefined') && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
        if (isMobile) {
            // Slightly larger mobile toast for readability without covering controls
            toast.style.width = '280px';
            toast.style.fontSize = '15px';
            toast.style.padding = '14px 16px';
            toast.style.borderRadius = '10px';
            toast.style.background = 'rgba(0,0,0,0.92)';
            toast.style.color = '#fff';
            toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.4)';
            toast.style.marginBottom = '10px';
            toast.style.pointerEvents = 'auto';
        } else {
            // Larger desktop toast
            toast.style.width = '420px';
            toast.style.fontSize = '17px';
            toast.style.padding = '18px 20px';
            toast.style.borderRadius = '12px';
            toast.style.background = 'rgba(0,0,0,0.96)';
            toast.style.color = '#fff';
            toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.45)';
            toast.style.marginBottom = '12px';
            toast.style.pointerEvents = 'auto';
        }
        // Ensure consistent visual layout
        toast.style.display = 'block';
        toast.style.overflow = 'hidden';
    } catch (e) { /* ignore styling errors */ }
    toastContainer.appendChild(toast);
    // entrance
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            try { toastContainer.removeChild(toast); } catch (e) {}
            if (id) visibleToasts.delete(id);
        }, 300);
    }, 3500);
}

export function initAchievements(list = []) {
    // Force a fresh session: clear persisted achievements and meta on every page load
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(META_KEY);
    } catch (e) {}
    unlockedSet = new Set();
    meta = { seenPopup: false, hasNew: false };
    // register initial list
    for (const a of list) {
        achievementsMap.set(a.id, a);
    }
    // expose panel toggle for debug
    window.toggleAchievementsPanel = () => {
        ensureContainers();
        container.classList.toggle('hidden');
        // Mark that user has seen the popup when they open it
        if (!meta.seenPopup && container.classList.contains('hidden') === false) {
            meta.seenPopup = true;
            // clear hasNew when user opens panel
            meta.hasNew = false;
            saveMeta();
        }
        updateToggleIcon();
        renderPanel();
    };
    // expose reset helper
    window.resetAchievements = resetAchievements;
    renderPanel();
    // Ensure toggle reflects persisted meta state
    updateToggleIcon();
    // Wire a click listener on the toggle button (if present) so clicking marks popup as seen
    try {
        const toggleBtn = document.querySelector('#achievementsToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                // user is interacting with the toggle — mark seen and clear new flag
                if (!meta.seenPopup || meta.hasNew) {
                    meta.seenPopup = true;
                    meta.hasNew = false;
                    saveMeta();
                    updateToggleIcon();
                }
            });
        }
    } catch (e) {}
    const controller = {
        register(list) {
            for (const a of list) achievementsMap.set(a.id, a);
            renderPanel();
        },
        unlock(id) {
            const ok = unlockAchievement(id);
            if (ok) {
                // mark meta.hasNew so toggle indicates new achievement until user opens panel
                meta.hasNew = true;
                saveMeta();
                updateToggleIcon();
            }
            return ok;
        },
        // Force-show an achievement toast (does not change unlocked state)
        show(id) {
            const ach = achievementsMap.get(id);
            if (!ach) return false;
            try { showToast(ach); } catch (e) {}
            return true;
        },
        // Public helper to mark that there's a new achievement (updates UI and persists)
        markHasNew() {
            try {
                meta.hasNew = true;
                saveMeta();
                updateToggleIcon();
            } catch (e) {}
        },
        isUnlocked(id) {
            return unlockedSet.has(id);
        },
        getAll() {
            return Array.from(achievementsMap.values()).map(a => ({...a, unlocked: unlockedSet.has(a.id)}));
        },
        reset: resetAchievements
    };
    // Expose controller for debugging
    try { window.achievements = controller; } catch (e) {}
    return controller;
}

function unlockAchievement(id) {
    const ach = achievementsMap.get(id);
    if (!ach) {
        console.warn('Attempted to unlock unknown achievement', id);
        return false;
    }
    if (unlockedSet.has(id)) return false;
    unlockedSet.add(id);
    saveUnlocked();
    // render and toast
    renderPanel();
    try { showToast(ach); } catch (e) { /* swallow */ }
    // mark meta that there's a new achievement available
    try {
        meta.hasNew = true;
        saveMeta();
        updateToggleIcon();
    } catch (e) {}
    // emit global event
    try {
        window.dispatchEvent(new CustomEvent('achievement:unlocked', { detail: { id, achievement: ach } }));
    } catch (e) {}
    return true;
}

function resetAchievements() {
    unlockedSet = new Set();
    saveUnlocked();
    renderPanel();
}

// Convenience: register some common achievements
export function registerDefaultAchievements() {
    const defaults = [
        { id: 'welcome_forest', title: 'Welcome to the Forest...', description: 'You entered the woods for the first time.' },
        { id: 'looked_boisvert', title: '???', description: 'You looked at Room.' },
    { id: 'enter_cabin', title: 'Home Sweet Home', description: 'You entered the cabin.', persistent: false }
    ];
    // Additional interactive achievements
    const extras = [
        { id: 'clicked_paper', title: 'Find my Pages...', description: 'You examined the paper on the table (my resume).' },
        { id: 'clicked_painting', title: 'Art Critic', description: 'You inspected the painting.' },
        { id: 'clicked_cola', title: 'Is This a Fallout Reference?', description: 'You inspected the LinkedIn Cola bottle.' },
        { id: 'watched_screen', title: 'Film Critic', description: 'You played the video on the TV.' },
        { id: 'visited_first_dlc', title: 'Where am I..?', description: 'You traveled to the first area of the DLC.' },
        { id: 'clicked_boisvert', title: 'Hello, Room', description: 'You clicked on the entity.' },
        { id: 'master_interactor', title: 'Sleuth', description: 'You investigated all interactive objects.' },
        { id: 'game_start', title: 'Let the Hunt Begin', description:'You initiated the game with Room.'},
        { id: 'game_lost', title: 'You Died...', description: 'You lost the game with Room.' },
        { id: 'game_won', title: 'Nightmare Slain', description:'You won the game with Room.'},
    ];
    for (const a of defaults) achievementsMap.set(a.id, a);
    for (const a of extras) achievementsMap.set(a.id, a);
    
    renderPanel();
}

// Auto-init on import? No — require explicit init in index.js