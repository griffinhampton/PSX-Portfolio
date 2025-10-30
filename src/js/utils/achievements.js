// Simple achievements system: register, persist, unlock, and show toasts/panel
const STORAGE_KEY = 'psx_achievements_v1';
const META_KEY = 'psx_achievements_meta_v1';

let achievementsMap = new Map();
let unlockedSet = new Set();
let container = null; // panel container
let toastContainer = null;
let visibleToasts = new Set(); // track currently visible toast IDs to prevent duplicates
let meta = { seenPopup: false, hasNew: false };
// Achievement sound: attempt to play on unlock. Use a single Audio element
// and register it with the global audio registry so mute/master volume
// controls (if present) can affect it.
let achievementAudio = null;

function getAchievementAudio() {
    try {
        if (achievementAudio) return achievementAudio;
        achievementAudio = new Audio('src/sounds/steam-achievement.mp3');
        achievementAudio.preload = 'auto';
        // If a global master volume is set, apply it
        try {
            if (typeof window !== 'undefined' && typeof window.__masterVolume === 'number') {
                achievementAudio.volume = Math.max(0, Math.min(1, window.__masterVolume));
            }
        } catch (e) {}
        // Register with global audio registry so UI mute controls can affect it
        try {
            if (typeof window !== 'undefined') {
                window.__audioRegistry = window.__audioRegistry || [];
                if (!window.__audioRegistry.includes(achievementAudio)) window.__audioRegistry.push(achievementAudio);
            }
        } catch (e) {}
        return achievementAudio;
    } catch (e) {
        // If audio cannot be created, swallow errors — achievements still work
        achievementAudio = null;
        return null;
    }
}

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
    // Use a title span so we can insert the progress bar directly beneath it
    const titleSpan = document.createElement('span');
    titleSpan.className = 'achievements-panel-title';
    titleSpan.innerText = 'Achievements';
    const close = document.createElement('button');
    close.className = 'achievements-panel-close';
    close.innerText = '×';
    close.addEventListener('click', () => container.classList.add('hidden'));
    // Create a left wrapper to stack the title and progress vertically so the
    // header (which is a flex row) keeps the close button on the right.
    const leftWrapper = document.createElement('div');
    leftWrapper.style.display = 'flex';
    leftWrapper.style.flexDirection = 'column';
    leftWrapper.style.gap = '6px';
    leftWrapper.appendChild(titleSpan);

        // Progress bar area: insert into the header so it appears underneath the
        // title and above the content list (per design request).
        const progressWrap = document.createElement('div');
        progressWrap.id = 'achievements-progress-wrap';
        progressWrap.style.display = 'flex';
        progressWrap.style.flexDirection = 'column';
        progressWrap.style.alignItems = 'stretch';
        progressWrap.style.padding = '8px 12px 6px 12px';
        progressWrap.style.gap = '6px';
        progressWrap.style.width = '100%';

        const progressText = document.createElement('div');
        progressText.id = 'achievements-progress-text';
        progressText.style.fontSize = '13px';
        progressText.style.color = '#000';
        progressText.style.textAlign = 'center';
        progressText.style.fontFamily = 'inherit';
        progressText.style.fontWeight = '600';
        progressText.innerText = '0 / 0 (0%)';

        const progressBarBg = document.createElement('div');
        progressBarBg.id = 'achievements-progress-bg';
        progressBarBg.style.height = '14px';
        // empty area uses a light background; the fill will be red
        progressBarBg.style.background = 'rgba(255,255,255,0.9)';
        progressBarBg.style.borderRadius = '6px';
        progressBarBg.style.overflow = 'hidden';
        progressBarBg.style.boxShadow = 'inset 0 1px 0 rgba(0,0,0,0.08)';
        // Black border per request
        progressBarBg.style.border = '2px solid #000';

        const progressFill = document.createElement('div');
        progressFill.id = 'achievements-progress-fill';
        progressFill.style.height = '100%';
        progressFill.style.width = '0%';
        // Red fill colors
        progressFill.style.background = 'linear-gradient(90deg,#ff5252,#e53935)';
        progressFill.style.transition = 'width 400ms ease';

    progressBarBg.appendChild(progressFill);
    // Place the bar first, then the text beneath it
    progressWrap.appendChild(progressBarBg);
    progressWrap.appendChild(progressText);
    // Place progress inside the left wrapper beneath the title
    leftWrapper.appendChild(progressWrap);

    // Build header: left wrapper (title + progress) and close button on right
    header.appendChild(leftWrapper);
    header.appendChild(close);

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
    // Update progress bar: number and percent complete
    try {
        const total = Math.max(0, achievementsMap.size || 0);
        // Count only unlocked achievements that are present in the current map
        let completed = 0;
        for (const id of unlockedSet) {
            if (achievementsMap.has(id)) completed++;
        }
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

        const progressText = container.querySelector('#achievements-progress-text');
        const progressFill = container.querySelector('#achievements-progress-fill');
        if (progressText) progressText.innerText = `${completed} / ${total} (${percent}%)`;
        if (progressFill) progressFill.style.width = `${percent}%`;
    } catch (e) {
        // ignore progress update errors
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
        if (!meta.seenPopup && container.classList.contains('hidden') === false) {
            meta.seenPopup = true;
            meta.hasNew = false;
            saveMeta();
        }
        updateToggleIcon();
        renderPanel();
    };
    window.resetAchievements = resetAchievements;
    renderPanel();
    updateToggleIcon();
    try {
        const toggleBtn = document.querySelector('#achievementsToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
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
                meta.hasNew = true;
                saveMeta();
                updateToggleIcon();
            }
            return ok;
        },
        show(id) {
            const ach = achievementsMap.get(id);
            if (!ach) return false;
            try { showToast(ach); } catch (e) {}
            return true;
        },
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
    renderPanel();
    try { showToast(ach); } catch (e) { /* swallow */ }
    try {
        const a = getAchievementAudio();
        if (a) {
            try { a.currentTime = 0; } catch (e) {}
            const p = a.play();
            if (p && typeof p.then === 'function') p.catch(() => {});
        }
    } catch (e) {}
    // If this was the collector achievement (all unlocked), prompt for dev powers
    try {
        if (id === 'collected_all') {
            const isMobile = (typeof navigator !== 'undefined') && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
            if (isMobile) {
                try { showConfettiAndPlaySound(); } catch (e) {}
            } else {
                try { showDevPowerPrompt(); } catch (e) {}
            }
        }
    } catch (e) {}
    try {
        meta.hasNew = true;
        saveMeta();
        updateToggleIcon();
    } catch (e) {}
    // emit global event
    try {
        window.dispatchEvent(new CustomEvent('achievement:unlocked', { detail: { id, achievement: ach } }));
    } catch (e) {}
    // After any unlock, verify whether the "collected_all" achievement
    // should be granted (i.e. all other registered achievements are unlocked).
    try { checkCollectAllAchievement(); } catch (e) {}
    return true;
}

// Show a modal asking the user if they want "dev powers" (enables FlyControls).
function showDevPowerPrompt() {
    try {
        // Avoid creating multiple prompts
        if (document.getElementById('dev-powers-prompt')) return;

        const wrap = document.createElement('div');
        wrap.id = 'dev-powers-prompt';
        wrap.style.position = 'fixed';
        wrap.style.left = '0';
        wrap.style.top = '0';
        wrap.style.width = '100vw';
        wrap.style.height = '100vh';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        wrap.style.zIndex = '100000';
        wrap.style.background = 'rgba(0,0,0,0.6)';

        const box = document.createElement('div');
        box.style.background = '#111';
        box.style.color = '#fff';
        box.style.padding = '20px';
        box.style.borderRadius = '10px';
        box.style.maxWidth = '560px';
        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.6)';
        box.style.textAlign = 'center';

        const msg = document.createElement('div');
        msg.style.fontSize = '18px';
        msg.style.marginBottom = '16px';
        msg.innerText = "Congratulations — you've done everything in my portfolio, do you want dev powers?";

        const btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.justifyContent = 'center';
        btnWrap.style.gap = '12px';

        const yes = document.createElement('button');
        yes.innerText = 'Yes';
        yes.style.padding = '10px 16px';
        yes.style.background = '#2e7d32';
        yes.style.color = '#fff';
        yes.style.border = '0';
        yes.style.borderRadius = '6px';
        yes.style.cursor = 'pointer';

        const no = document.createElement('button');
        no.innerText = 'No';
        no.style.padding = '10px 16px';
        no.style.background = '#b71c1c';
        no.style.color = '#fff';
        no.style.border = '0';
        no.style.borderRadius = '6px';
        no.style.cursor = 'pointer';

        btnWrap.appendChild(yes);
        btnWrap.appendChild(no);
        box.appendChild(msg);
        box.appendChild(btnWrap);
        wrap.appendChild(box);

        document.body.appendChild(wrap);

        const cleanup = () => {
            try { document.body.removeChild(wrap); } catch (e) {}
        };

        no.addEventListener('click', () => {
            cleanup();
        });

        yes.addEventListener('click', () => {
            // Enable FlyControls indefinitely
            try { enableFlyControls().catch(() => {}); } catch (e) {}
            cleanup();
        });
    } catch (e) {
        // swallow errors so achievement flow is unaffected
        console.warn('[achievements] failed to show dev powers prompt', e);
    }
}

// Dynamically import FlyControls and attach it to the global controls shim.
// Uses document canvas element as fallback for renderer.domElement. Creates
// a simple clock object if THREE.Clock isn't available here.
async function enableFlyControls() {
    try {
        // If controls shim isn't present, nothing to attach to
        const controlsShim = window.controls;
        if (!controlsShim) return;

        // If already in fly mode, skip
        if (controlsShim._mode === 'fly' && controlsShim._fly) return;

        const mod = await import('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/controls/FlyControls.js');
        const FlyControls = mod && mod.FlyControls ? mod.FlyControls : null;
        if (!FlyControls) return;

        // Determine dom element for event listeners: prefer renderer canvas, otherwise first canvas
        let dom = null;
        try {
            // try to find a renderer canvas appended to body
            dom = document.querySelector('canvas') || document.body;
        } catch (e) { dom = document.body; }

        // Ensure we have a camera
        const camera = window.camera;
        if (!camera) return;

        const fly = new FlyControls(camera, dom);
        // sensible dev defaults
        fly.movementSpeed = 4.0;
        fly.rollSpeed = Math.PI / 6;
        fly.dragToLook = false;
        fly.autoForward = false;

        // Simple clock replacement with getDelta() in seconds
        const clock = {
            _last: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
            getDelta() {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const dt = (now - this._last) / 1000;
                this._last = now;
                return dt;
            }
        };

        // Attach to shim so existing animation loop will call update()
        try {
            controlsShim._fly = fly;
            controlsShim._clock = clock;
            controlsShim._mode = 'fly';
            // Expose for debugging
            window.flyControls = fly;
            console.warn('[achievements] FlyControls enabled (dev powers)');
        } catch (e) {
            console.warn('[achievements] failed to attach FlyControls to controls shim', e);
        }
    } catch (e) {
        console.warn('[achievements] enableFlyControls error', e);
    }
}

// Show confetti falling from the top of the screen and play a single win sound.
function showConfettiAndPlaySound() {
    try {
        if (document.getElementById('ach-confetti')) return;
        const container = document.createElement('div');
        container.id = 'ach-confetti';
        container.style.position = 'fixed';
        container.style.left = '0';
        container.style.top = '0';
        container.style.width = '100%';
        container.style.height = '0';
        container.style.pointerEvents = 'none';
        container.style.overflow = 'visible';
        container.style.zIndex = '100000';
        document.body.appendChild(container);

        const colors = ['#ff3b30','#ff9500','#ffcc00','#4cd964','#5ac8fa','#007aff','#5856d6','#ff2d55'];
        const count = Math.max(18, Math.min(60, Math.round((window.innerWidth || 320) / 12)));
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            const w = Math.floor(Math.random() * 10) + 6;
            const h = Math.floor(Math.random() * 18) + 8;
            el.style.width = w + 'px';
            el.style.height = h + 'px';
            el.style.background = colors[Math.floor(Math.random() * colors.length)];
            el.style.position = 'fixed';
            const startLeft = Math.random() * 100;
            el.style.left = startLeft + 'vw';
            el.style.top = '-10vh';
            el.style.opacity = String(0.95 - Math.random() * 0.4);
            el.style.borderRadius = (Math.random() > 0.6 ? '2px' : '50%');
            el.style.transform = `rotate(${Math.random() * 360}deg)`;
            el.style.willChange = 'transform, top, left, opacity';
            el.style.transition = `transform ${3 + Math.random()*1.5}s linear, top ${3 + Math.random()*1.5}s linear, left ${3 + Math.random()*1.5}s linear, opacity 0.6s ease`;
            container.appendChild(el);

            // stagger animation
            setTimeout(() => {
                const endLeftOffset = (Math.random() - 0.5) * 20; // vw offset
                el.style.top = (100 + Math.random() * 10) + 'vh';
                el.style.left = `calc(${startLeft}vw + ${endLeftOffset}vw)`;
                el.style.transform = `rotate(${(Math.random() * 720) - 360}deg) translateY(0)`;
                // fade slightly at end
                setTimeout(() => { el.style.opacity = '0.05'; }, 2600 + Math.random()*800);
            }, 50 + i * 30);

            // cleanup each piece after animation
            setTimeout(() => {
                try { container.removeChild(el); } catch (e) {}
            }, 4200 + i * 30);
        }

        // remove container after all pieces cleaned
        setTimeout(() => {
            try { if (container.parentNode) container.parentNode.removeChild(container); } catch (e) {}
        }, 5200 + count * 30);

        // Play win sound once (safe-playback)
        try {
            const s = new Audio('src/textures/win-noise.mp3');
            s.preload = 'auto';
            try {
                window.__audioRegistry = window.__audioRegistry || [];
                if (!window.__audioRegistry.includes(s)) window.__audioRegistry.push(s);
            } catch (e) {}
            const p = s.play();
            if (p && typeof p.then === 'function') p.catch(() => {});
        } catch (e) {
            // swallow
        }
    } catch (e) {
        console.warn('[achievements] showConfettiAndPlaySound error', e);
    }
}

function resetAchievements() {
    unlockedSet = new Set();
    saveUnlocked();
    renderPanel();
}


function checkCollectAllAchievement() {
    const collectorId = 'collected_all';
    // Only proceed if the collector is registered and not already unlocked
    if (!achievementsMap.has(collectorId)) return;
    if (unlockedSet.has(collectorId)) return;

    for (const [id] of achievementsMap.entries()) {
        if (id === collectorId) continue;
        if (!unlockedSet.has(id)) {
            return; // found an achievement not yet unlocked
        }
    }
    // All others are unlocked — grant the collector achievement
    try { unlockAchievement(collectorId); } catch (e) {}
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
        { id: 'clicked_griffins_domain', title: "..Sooo Wanna Hire Me?", description: "You clicked one of the portfolio cards." },
        { id: 'watched_screen', title: 'Film Critic', description: 'You played the video on the TV.' },
        { id: 'master_interactor', title: 'Sleuth', description: 'You investigated all interactive objects in the cabin.' },
        { id: 'clicked_boisvert', title: 'Hello, Room', description: 'You clicked on the entity.' },
        { id: 'visited_first_dlc', title: 'Where am I..?', description: 'You traveled to the first area of the DLC.' },
        { id: 'clicked_easter', title: 'Created By Griffin Hampton.', description: 'You found the hidden easter egg in the backrooms.' },
        { id: 'game_start', title: 'Let the Hunt Begin', description:'You initiated the game with Room.'},
        { id: 'game_lost', title: 'You Died...', description: 'You lost the game with Room.' },
        { id: 'game_won', title: 'Nightmare Slain', description:'You won the game with Room.'},
        { id: 'collected_all', title: 'Platinum', description: 'You collected every achievement.' },
    ];
    for (const a of defaults) achievementsMap.set(a.id, a);
    for (const a of extras) achievementsMap.set(a.id, a);
    
    renderPanel();
}

// Auto-init on import? No — require explicit init in index.js