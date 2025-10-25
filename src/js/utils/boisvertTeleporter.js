import * as THREE from 'three';
import gsap from 'gsap';
import MovementPad from './movementPad.js';

/**
 * Setup Boisvert model teleportation system
 * Teleports the boisvert model to specific positions for each camera position
 * @param {THREE.Scene} scene - The scene containing the boisvert model
 * @param {THREE.Camera} camera - The camera to track position changes
 * @param {Array} navigationPositions - Array of [x, y, z] navigation positions
 * @param {Object} controls - The camera controls (for lookAt functionality)
 * @param {Array} boisvertSpawnPositions - Array of [x, y, z] positions where boisvert spawns
 * @param {Array} boisvertZRotations - Array of Z rotations for boisvert at each position
 * @returns {Object} Manager object with update method
 */
export function setupBoisvertTeleporter(scene, camera, navigationPositions, controls, boisvertSpawnPositions, boisvertZRotations) {
    let boisvertModel = null;
    let lastCameraPosition = new THREE.Vector3();
    let currentTargetIndex = -1;
    
    // Distance threshold to detect when camera reaches a new position
    const POSITION_THRESHOLD = 1.0;
    
    // Find the boisvert model in the scene
    scene.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes('boisvert')) {
            boisvertModel = child;
        }
    });
    
    if (!boisvertModel) {
        console.error('Boisvert model not found in scene');
        return { update: () => {} };
    }

    // Walk mode variables
    let walkModeActive = false;
    let walkBounds = null;
    let walkSpeed = 2.5;
    let walkKeys = { forward: 0, back: 0, left: 0, right: 0 };
    let analogMove = { x: 0, z: 0 };
    let pendingWalkTarget = null;
    let movementPad = null;
    const isMobileDevice = (typeof navigator !== 'undefined') && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
    // Collision/walk helpers and overlay state (defaults)
    let walkCollisionWalls = null;
    const walkRaycaster = new THREE.Raycaster();
    const walkPlayerRadius = 0.35;
    // Table registration helpers
    let __originalSceneAdd_tables = null;
    let _registeredTableObjects = [];

    function registerTablesInTree(root) {
        try {
            if (!root) return;
            const tableCandidates = [];
            // traverse the subtree looking for table-like nodes
            root.traverse(o => {
                try {
                    if (!o || !o.name) return;
                    const n = o.name.toLowerCase();
                    if (n.includes('backrooms-table') || n.includes('table-top') || n.includes('tabletop') || (n.includes('table') && n.includes('backrooms')) || n.includes('table')) {
                        tableCandidates.push(o);
                    }
                } catch (e) {}
            });

            // dedupe
            const uniq = [];
            for (let t of tableCandidates) {
                if (!t) continue;
                if (!uniq.find(x => x && x.uuid === t.uuid)) uniq.push(t);
            }

            _registeredTableObjects = uniq;

            // Build collider list similar to chase logic so we can set walkCollisionWalls early
            try {
                const colliders = [];
                const wallsObj = scene.getObjectByName('backrooms-walls');
                const floorObj = scene.getObjectByName('backrooms-floor');
                if (wallsObj) colliders.push(wallsObj);
                if (floorObj) colliders.push(floorObj);
                if (uniq.length > 0) {
                    for (let t of uniq) colliders.push(t);
                }

                // fallback: if nothing found, try a broader scan
                if (colliders.length === 0) {
                    scene.traverse(o => {
                        try {
                            if (o && o.name) {
                                const n = o.name.toLowerCase();
                                if (n.includes('walls') || n.includes('floor') || n.includes('table-top') || n.includes('table')) {
                                    colliders.push(o);
                                }
                            }
                        } catch (e) {}
                    });
                }

                if (colliders.length > 0) {
                    walkCollisionWalls = colliders;
                    if (window && window.console) console.log('[boisvertTeleporter] registerTablesInTree: registered', uniq.length, 'table nodes, colliders=', colliders.length);
                } else {
                    walkCollisionWalls = null;
                    if (window && window.console) console.log('[boisvertTeleporter] registerTablesInTree: no colliders found');
                }
            } catch (e) {
                if (window && window.console) console.warn('[boisvertTeleporter] registerTablesInTree build colliders failed', e);
            }
        } catch (e) {
            if (window && window.console) console.error('[boisvertTeleporter] registerTablesInTree error', e);
        }
    }

    // Initial scan and monkey-patch to catch later additions
    try {
        console.log('[boisvertTeleporter] Starting initial table registration...');
        registerTablesInTree(scene);
    } catch (e) {
        console.error('[boisvertTeleporter] initial registerTablesInTree failed', e);
    }

    try {
        if (scene && typeof scene.add === 'function') {
            __originalSceneAdd_tables = scene.add.bind(scene);
            scene.add = function(...objs) {
                const res = __originalSceneAdd_tables(...objs);
                try {
                    if (window && window.console && window.__DEBUG_TABLES) console.log('[boisvertTeleporter] scene.add called with', objs.length, 'objects');
                    for (const o of objs) {
                        registerTablesInTree(o);
                    }
                } catch (e) {
                    console.error('[boisvertTeleporter] scene.add monkey-patch error', e);
                }
                return res;
            };
            console.log('[boisvertTeleporter] scene.add monkey-patched for table registration');
        }
    } catch (e) {
        console.error('[boisvertTeleporter] failed to monkey-patch scene.add for tables', e);
    }

    // Also schedule a couple of delayed re-scans to catch GLTFs that load slightly later
    try {
        setTimeout(() => { try { registerTablesInTree(scene); } catch(e){} }, 500);
        setTimeout(() => { try { registerTablesInTree(scene); } catch(e){} }, 1500);
        setTimeout(() => { try { registerTablesInTree(scene); } catch(e){} }, 3000);
    } catch (e) {}

    // Boisvert overlay / noise canvas state
    let _boisvertOverlay = null;
    let _noiseCanvas = null;
    let _noiseCtx = null;
    let _noiseRAF = null;
    let _noiseEnabled = false;
    let _noiseLast = 0;

    // Game intro and items UI
    let _gameIntroEl = null;
    let _itemsListEl = null;

    // Death overlay state (image + smokey bar)
    let _deathOverlay = null;
    let _deathImage = null;
    let _deathBar = null;
    const _deathFadeInMs = 5000;
    const _deathFadeOutMs = 1000;
    let _deathPlaying = false;
    // Win overlay state (uses same alpha/timings as death overlay)
    let _winOverlay = null;
    let _winImage = null;
    let _winBar = null;
    let _winPlaying = false;
    let _winTriggered = false;

    // Chase message / countdown state
    let _chaseMsgEl = null;
    let _chaseCountdownEl = null;
    let _countdownDuration = 3; // seconds
    let _countdownStart = 0;
    let _countdownRAF = null;
    let _countdownCompleted = false;

    // Chase constants
    const CHASE_UPDATE_HZ = 6;
    // make Boisvert slightly slower on mobile devices
    let CHASE_SPEED = isMobileDevice ? 1.2 : 1.9; // mobile slower, desktop faster
    // reduce stop distance so Boisvert continues moving closer
    const CHASE_STOP_DISTANCE = 0.6;
    // increase lose distance so collision triggers easier
    const GAME_LOSE_DISTANCE = 1.6;

    function _chaseUpdate(now) {
        if (!boisvertModel || !update || !update._chaseActive) return;

        if (!update._lastChaseDecision) update._lastChaseDecision = 0;
        if (!update._lastChaseTime) update._lastChaseTime = now || performance.now();

        const nowTime = now || performance.now();
        const dt = Math.min(0.1, (nowTime - update._lastChaseTime) / 1000);
        update._lastChaseTime = nowTime;

        const decisionInterval = 1000 / CHASE_UPDATE_HZ;
        if (!update._lastChaseDecision || (nowTime - update._lastChaseDecision) >= decisionInterval) {
            update._lastChaseDecision = nowTime;

            const origin = boisvertModel.position.clone();
            origin.y += 0.9;
            const target = camera.position.clone();
            target.y = origin.y;

            const toPlayer = new THREE.Vector3().subVectors(target, origin);
            const dist = toPlayer.length();

            // If Boisvert gets very close to the player, trigger the 'game_lost' achievement
            if (dist <= GAME_LOSE_DISTANCE) {
                if (!update._loseTriggered) {
                    update._loseTriggered = true;
                    try {
                        if (window && window.achievements && typeof window.achievements.unlock === 'function') {
                            window.achievements.unlock('game_lost');
                        }
                    } catch (e) {}
                    try { showDeathOverlay(); } catch (e) {}

                    // Reset player and Boisvert positions to the first additional navigation point (or fallback)
                    try {
                        let additional = null;
                        try {
                            additional = (typeof window !== 'undefined' && Array.isArray(window.ADDITIONAL_NAVIGATION_POSITIONS)) ? window.ADDITIONAL_NAVIGATION_POSITIONS : null;
                        } catch (e) { additional = null; }
                        if (!additional && scene && scene.userData && Array.isArray(scene.userData.additionalNavigationPositions)) {
                            additional = scene.userData.additionalNavigationPositions;
                        }

                        let dest = null;
                        if (additional && additional.length > 0) dest = additional[0];
                        else if (navigationPositions && navigationPositions.length > 0) dest = navigationPositions[0];

                        if (dest && dest.length >= 3) {
                            try {
                                camera.position.set(dest[0], dest[1], dest[2]);
                                if (controls && controls.target && typeof controls.target.copy === 'function') {
                                    controls.target.copy(camera.position);
                                }
                            } catch (e) {}
                        }

                        // reset Boisvert to spawn pos index 0 if available
                        try {
                            if (boisvertSpawnPositions && boisvertSpawnPositions.length > 0) {
                                const s = boisvertSpawnPositions[0];
                                if (s && s.length >= 3) {
                                    boisvertModel.position.set(s[0], s[1], s[2]);
                                }
                                if (boisvertZRotations && Array.isArray(boisvertZRotations) && boisvertZRotations[0] !== undefined) {
                                    try { boisvertModel.rotation.set(Math.PI / 2, 0, boisvertZRotations[0]); } catch (e) {}
                                }
                            }
                        } catch (e) {}

                        // Allow countdown to be started again
                        try {
                            _countdownCompleted = false;
                            _countdownStart = 0;
                            if (_chaseMsgEl) {
                                try { _chaseMsgEl.style.opacity = '0'; } catch (e) {}
                            }
                            if (update) {
                                try { update._chaseActive = false; } catch (e) {}
                                try { update._loseTriggered = false; } catch (e) {}
                            }
                        } catch (e) {}
                    } catch (e) {}

                    // stop further chase behavior
                    try { update._chaseMoveDir = null; } catch (e) {}
                    try { update._chaseActive = false; } catch (e) {}
                }
                return;
            }

            if (dist <= 0.001) {
                update._chaseMoveDir = null;
            } else {
                if (dist <= CHASE_STOP_DISTANCE) {
                    update._chaseMoveDir = null;
                } else {
                    const dir = toPlayer.clone().normalize();
                    let chosen = null;
                    
                    try {
                        if (!walkCollisionWalls) {
                            try {
                                // collect collision-relevant objects: walls, floor and table-top
                                const colliders = [];
                                const wallsObj = scene.getObjectByName('backrooms-walls');
                                const floorObj = scene.getObjectByName('backrooms-floor');
                                const tableTopObjs = [];
                                const byNameTable = scene.getObjectByName('backrooms-table-top');
                                if (byNameTable) tableTopObjs.push(byNameTable);
                                scene.traverse(o => {
                                    try {
                                        if (!o || !o.name) return;
                                        const n = o.name.toLowerCase();
                                        if (n.includes('backrooms-table') || n.includes('table-top') || n.includes('tabletop') || (n.includes('table') && n.includes('backrooms'))) {
                                            tableTopObjs.push(o);
                                        }
                                    } catch (e) {}
                                });
                                // dedupe
                                const uniqTableObjs = [];
                                for (let o of tableTopObjs) {
                                    if (!o) continue;
                                    if (!uniqTableObjs.find(x => x && x.uuid === o.uuid)) uniqTableObjs.push(o);
                                }
                                if (wallsObj) colliders.push(wallsObj);
                                if (floorObj) colliders.push(floorObj);
                                if (uniqTableObjs.length > 0) {
                                    for (let t of uniqTableObjs) colliders.push(t);
                                }

                                // fallback: scan for likely names if exact names not present
                                if (colliders.length === 0) {
                                    scene.traverse(o => {
                                        if (o && o.name) {
                                            const n = o.name.toLowerCase();
                                            if (n.includes('walls') || n.includes('floor') || n.includes('table-top') || n.includes('table')) {
                                                colliders.push(o);
                                            }
                                        }
                                    });
                                }

                                if (colliders.length > 0) {
                                    walkCollisionWalls = colliders; // store as array of objects
                                } else {
                                    walkCollisionWalls = null;
                                }
                            } catch (e) {
                                walkCollisionWalls = null;
                            }
                        }

                        if (walkCollisionWalls) {
                            walkRaycaster.set(origin, dir);
                            walkRaycaster.far = dist;
                            const hits = Array.isArray(walkCollisionWalls)
                                ? walkRaycaster.intersectObjects(walkCollisionWalls, true)
                                : walkRaycaster.intersectObject(walkCollisionWalls, true);
                            
                            if (!hits || hits.length === 0) {
                                chosen = dir;
                            } else {
                                const first = hits[0];
                                let normalWorld = null;
                                
                                try {
                                    if (first && first.face && first.object) {
                                        const faceNormal = first.face.normal.clone();
                                        const normalMatrix = new THREE.Matrix3().getNormalMatrix(first.object.matrixWorld);
                                        normalWorld = faceNormal.applyMatrix3(normalMatrix).normalize();
                                    }
                                } catch (e) {
                                    normalWorld = null;
                                }

                                if (normalWorld) {
                                    const proj = dir.clone().sub(normalWorld.clone().multiplyScalar(dir.dot(normalWorld))).normalize();
                                    walkRaycaster.set(origin, proj);
                                    walkRaycaster.far = Math.min(dist, 4);
                                    const slideHits = Array.isArray(walkCollisionWalls)
                                        ? walkRaycaster.intersectObjects(walkCollisionWalls, true)
                                        : walkRaycaster.intersectObject(walkCollisionWalls, true);
                                    if (!slideHits || slideHits.length === 0) {
                                        chosen = proj;
                                    }
                                }

                                if (!chosen) {
                                    const offsets = [Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3];
                                    for (let a of offsets) {
                                        const probe = dir.clone().applyAxisAngle(new THREE.Vector3(0,1,0), a).normalize();
                                        walkRaycaster.set(origin, probe);
                                        walkRaycaster.far = Math.min(dist, 4);
                                        const ph = Array.isArray(walkCollisionWalls)
                                            ? walkRaycaster.intersectObjects(walkCollisionWalls, true)
                                            : walkRaycaster.intersectObject(walkCollisionWalls, true);
                                        if (!ph || ph.length === 0) {
                                            chosen = probe;
                                            break;
                                        }
                                    }
                                }
                            }
                        } else {
                            chosen = dir;
                        }
                    } catch (e) {
                        chosen = dir;
                    }
                    
                    if (chosen) {
                        update._chaseMoveDir = chosen;
                    } else {
                        update._chaseMoveDir = null;
                    }
                }
            }
        }

        if (update._chaseMoveDir) {
            try {
                const move = update._chaseMoveDir.clone().multiplyScalar(CHASE_SPEED * dt);
                let blockedByWall = false;
                
                try {
                    const originTest = boisvertModel.position.clone();
                    originTest.y += 0.9;
                    const dirTest = move.clone();
                    const len = dirTest.length();
                    
                    if (len > 1e-6) {
                        dirTest.normalize();
                        walkRaycaster.set(originTest, dirTest);
                        walkRaycaster.far = len + walkPlayerRadius + 0.02;
                        
                        if (walkCollisionWalls) {
                            const hitTest = Array.isArray(walkCollisionWalls)
                                ? walkRaycaster.intersectObjects(walkCollisionWalls, true)
                                : walkRaycaster.intersectObject(walkCollisionWalls, true);
                            if (hitTest && hitTest.length > 0) blockedByWall = true;
                        } else {
                            const hitTest = walkRaycaster.intersectObjects(scene.children, true);
                            if (hitTest && hitTest.length > 0) {
                                for (let h of hitTest) {
                                    if (!isChildOfBoisvert(h.object)) {
                                        blockedByWall = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    blockedByWall = false;
                }

                if (!blockedByWall) {
                    boisvertModel.position.add(move);
                } else {
                    update._chaseMoveDir = null;
                }
                
                const dx = camera.position.x - boisvertModel.position.x;
                const dz = camera.position.z - boisvertModel.position.z;
                const targetZ = -Math.atan2(dx, dz);
                const currentZ = (typeof boisvertModel.rotation.z === 'number') ? boisvertModel.rotation.z : 0;
                const TWO_PI = Math.PI * 2;
                let delta = targetZ - currentZ;
                delta = ((delta + Math.PI) % (TWO_PI)) - Math.PI;
                const smoothFactor = Math.min(1, Math.max(0.02, dt * 6));
                boisvertModel.rotation.z = currentZ + delta * smoothFactor;
            } catch (e) {
                // Ignore movement errors
            }
        }
    }

    function startNoiseLoop() {
        if (_noiseEnabled) return;
        if (!_noiseCanvas || !_noiseCtx) return;
        _noiseEnabled = true;
        _noiseLast = 0;

        function frame(t) {
            if (!_noiseEnabled) return;
            if (!t) t = performance.now();
            if (t - _noiseLast > 40) {
                try {
                    const w = _noiseCanvas.width;
                    const h = _noiseCanvas.height;
                    const imageData = _noiseCtx.createImageData(w, h);
                    const data = imageData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const v = (Math.random() * 255) | 0;
                        data[i] = v;
                        data[i+1] = v;
                        data[i+2] = v;
                        data[i+3] = 140;
                    }
                    _noiseCtx.putImageData(imageData, 0, 0);
                } catch (e) {}
                _noiseLast = t;
            }
            _noiseRAF = requestAnimationFrame(frame);
        }
        _noiseRAF = requestAnimationFrame(frame);
    }

    function stopNoiseLoop() {
        _noiseEnabled = false;
        if (_noiseRAF) {
            try {
                cancelAnimationFrame(_noiseRAF);
            } catch(e) {}
        }
        _noiseRAF = null;
        if (_noiseCtx && _noiseCanvas) {
            try {
                _noiseCtx.clearRect(0, 0, _noiseCanvas.width, _noiseCanvas.height);
            } catch(e) {}
        }
    }

    function resizeNoise() {
        try {
            if (!_noiseCanvas) return;
            const w = 240;
            const h = Math.max(96, Math.round((w * window.innerHeight) / window.innerWidth));
            _noiseCanvas.width = w;
            _noiseCanvas.height = h;
        } catch (e) {}
    }

    function ensureOverlay() {
        if (_boisvertOverlay) return;
        try {
            const overlay = document.createElement('div');
            overlay.id = 'boisvert-overlay';
            overlay.style.position = 'fixed';
            overlay.style.left = '0';
            overlay.style.top = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '100000';
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.35s ease';

            const vignette = document.createElement('div');
            vignette.style.position = 'absolute';
            vignette.style.left = '0';
            vignette.style.top = '0';
            vignette.style.width = '100%';
            vignette.style.height = '100%';
            vignette.style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 100%)';
            vignette.style.pointerEvents = 'none';
            overlay.appendChild(vignette);

            const c = document.createElement('canvas');
            c.style.position = 'absolute';
            c.style.left = '0';
            c.style.top = '0';
            c.style.width = '100%';
            c.style.height = '100%';
            c.style.pointerEvents = 'none';
            c.style.opacity = '0.18';
            c.style.mixBlendMode = 'overlay';
            overlay.appendChild(c);

            document.body.appendChild(overlay);
            _boisvertOverlay = overlay;
            _noiseCanvas = c;
            _noiseCtx = c.getContext('2d');

            window.addEventListener('resize', resizeNoise);
            resizeNoise();
        } catch (e) {
            // Fail silently if DOM unavailable
        }
    }

    function ensureDeathOverlay() {
        if (_deathOverlay) return;
        try {
            const overlay = document.createElement('div');
            overlay.id = 'boisvert-death-overlay';
            overlay.style.position = 'fixed';
            overlay.style.left = '0';
            overlay.style.top = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '100005';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';

            // Smokey bar across the screen
            const bar = document.createElement('div');
            bar.id = 'boisvert-death-bar';
            bar.style.position = 'absolute';
            bar.style.left = '0';
            bar.style.top = '50%';
            bar.style.transform = 'translateY(-50%)';
            bar.style.width = '100%';
            // initial height will be adjusted once image size is known
            bar.style.height = '20vh';
            bar.style.maxHeight = '85vh';
            bar.style.background = 'linear-gradient(90deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.75) 100%)';
            bar.style.opacity = '0';
            bar.style.pointerEvents = 'none';
            bar.style.filter = 'blur(6px)';
            bar.style.transition = `opacity ${_deathFadeInMs}ms ease`;
            bar.style.boxShadow = '0 30px 80px rgba(0,0,0,0.6) inset';
            overlay.appendChild(bar);

            const img = document.createElement('img');
            img.id = 'boisvert-death-image';
            img.alt = 'death';
            // make the image larger but allow controlling rendered size
            img.style.maxWidth = '98%';
            img.style.maxHeight = '85vh';
            // render at roughly half-size of the viewport width
            img.style.width = '45%';
            img.style.height = 'auto';
            img.style.opacity = '0';
            img.style.pointerEvents = 'none';
            img.style.transition = `opacity ${_deathFadeInMs}ms ease`;
            img.style.imageRendering = 'auto';
            overlay.appendChild(img);

            // Load the source image and process it into a canvas to convert white -> alpha
            try {
                const srcPath = 'src/textures/dark souls-death.png';
                const loaderImg = new Image();
                loaderImg.crossOrigin = 'anonymous';
                loaderImg.onload = function() {
                    try {
                        const w = loaderImg.naturalWidth || loaderImg.width;
                        const h = loaderImg.naturalHeight || loaderImg.height;
                        const tmp = document.createElement('canvas');
                        tmp.width = w;
                        tmp.height = h;
                        const tctx = tmp.getContext('2d');
                        tctx.drawImage(loaderImg, 0, 0, w, h);

                        try {
                            // Convert black background to alpha so the image floats over the bar
                            const tmp2 = document.createElement('canvas');
                            tmp2.width = w;
                            tmp2.height = h;
                            const t2 = tmp2.getContext('2d');
                            t2.drawImage(loaderImg, 0, 0, w, h);
                            try {
                                const imageData2 = t2.getImageData(0, 0, w, h);
                                const data2 = imageData2.data;
                                // pixels near black will become transparent
                                const blackThreshold = 60; // distance from black under which we consider 'black'
                                const maxDistB = Math.sqrt(3 * Math.pow(blackThreshold, 2));
                                for (let i = 0; i < data2.length; i += 4) {
                                    const r = data2[i];
                                    const g = data2[i+1];
                                    const b = data2[i+2];
                                    const a = data2[i+3];
                                    // If already fully transparent, keep
                                    if (a === 0) continue;
                                    // Distance from black (0,0,0)
                                    const dr = r;
                                    const dg = g;
                                    const db = b;
                                    const distB = Math.sqrt(dr * dr + dg * dg + db * db);
                                    const factorB = Math.max(0, Math.min(1, distB / maxDistB));
                                    // new alpha scaled by factor (pure black -> 0, far from black -> original)
                                    const newA = Math.round(a * factorB);
                                    data2[i+3] = newA;
                                }
                                t2.putImageData(imageData2, 0, 0);
                                try {
                                    const processed2 = tmp2.toDataURL('image/png');
                                    img.src = processed2;
                                } catch (e) {
                                    img.src = srcPath;
                                }
                                // once the visible IMG is set, adjust the bar height to match
                                img.onload = function() {
                                    try {
                                        // measure the rendered image height and set bar to slightly larger
                                        const rect = img.getBoundingClientRect();
                                        const imgH = rect.height || (img.naturalHeight || 0);
                                        const padding = Math.min(60, Math.round(imgH * 0.15));
                                        const newBarH = Math.min(window.innerHeight * 0.5, Math.max(60, imgH + padding));
                                        bar.style.height = newBarH + 'px';
                                        bar.style.maxHeight = Math.max(newBarH, 220) + 'px';
                                    } catch (e) {}
                                };
                            } catch (e) {
                                // getImageData may fail (CORS) — fall back to original
                                img.src = srcPath;
                            }
                        } catch (e) {
                            img.src = srcPath;
                        }
                    } catch (e) {
                        try { img.src = srcPath; } catch (ee) {}
                    }
                };
                loaderImg.onerror = function() {
                    try { img.src = srcPath; } catch (e) {}
                };
                loaderImg.src = srcPath;
            } catch (e) {
                try { img.src = 'src/textures/darksouls-death.png'; } catch (ee) {}
            }

            document.body.appendChild(overlay);
            _deathOverlay = overlay;
            _deathImage = img;
            _deathBar = bar;
        } catch (e) {
            // silent
        }
    }

    function ensureWinOverlay() {
        if (_winOverlay) return;
        try {
            const overlay = document.createElement('div');
            overlay.id = 'boisvert-win-overlay';
            overlay.style.position = 'fixed';
            overlay.style.left = '0';
            overlay.style.top = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '100006';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';

            const bar = document.createElement('div');
            bar.id = 'boisvert-win-bar';
            bar.style.position = 'absolute';
            bar.style.left = '0';
            bar.style.top = '50%';
            bar.style.transform = 'translateY(-50%)';
            bar.style.width = '100%';
            // initial height will be adjusted once image size is known
            bar.style.height = '20vh';
            bar.style.maxHeight = '85vh';
            bar.style.background = 'linear-gradient(90deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.75) 100%)';
            bar.style.opacity = '0';
            bar.style.pointerEvents = 'none';
            bar.style.filter = 'blur(6px)';
            bar.style.transition = `opacity ${_deathFadeInMs}ms ease`;
            bar.style.boxShadow = '0 30px 80px rgba(0,0,0,0.6) inset';
            overlay.appendChild(bar);

            const img = document.createElement('img');
            img.id = 'boisvert-win-image';
            img.alt = 'fetch-complete';
            img.style.maxWidth = '98%';
            img.style.maxHeight = '85vh';
            img.style.width = '45%';
            img.style.height = 'auto';
            img.style.opacity = '0';
            img.style.pointerEvents = 'none';
            img.style.transition = `opacity ${_deathFadeInMs}ms ease`;
            img.style.imageRendering = 'auto';
            overlay.appendChild(img);

            // Load the source image and attempt to convert near-black to alpha (like death overlay)
            try {
                const srcPath = 'src/textures/win-text.png';
                const loaderImg = new Image();
                loaderImg.crossOrigin = 'anonymous';
                loaderImg.onload = function() {
                    try {
                        const w = loaderImg.naturalWidth || loaderImg.width;
                        const h = loaderImg.naturalHeight || loaderImg.height;
                        const tmp2 = document.createElement('canvas');
                        tmp2.width = w;
                        tmp2.height = h;
                        const t2 = tmp2.getContext('2d');
                        t2.drawImage(loaderImg, 0, 0, w, h);
                        try {
                            const imageData2 = t2.getImageData(0, 0, w, h);
                            const data2 = imageData2.data;
                            const blackThreshold = 60;
                            const maxDistB = Math.sqrt(3 * Math.pow(blackThreshold, 2));
                            for (let i = 0; i < data2.length; i += 4) {
                                const r = data2[i];
                                const g = data2[i+1];
                                const b = data2[i+2];
                                const a = data2[i+3];
                                if (a === 0) continue;
                                const dr = r;
                                const dg = g;
                                const db = b;
                                const distB = Math.sqrt(dr * dr + dg * dg + db * db);
                                const factorB = Math.max(0, Math.min(1, distB / maxDistB));
                                const newA = Math.round(a * factorB);
                                data2[i+3] = newA;
                            }
                            t2.putImageData(imageData2, 0, 0);
                            try {
                                img.src = tmp2.toDataURL('image/png');
                            } catch (e) {
                                img.src = srcPath;
                            }
                            img.onload = function() {
                                try {
                                    const rect = img.getBoundingClientRect();
                                    const imgH = rect.height || (img.naturalHeight || 0);
                                    const padding = Math.min(60, Math.round(imgH * 0.15));
                                    const newBarH = Math.min(window.innerHeight * 0.5, Math.max(60, imgH + padding));
                                    bar.style.height = newBarH + 'px';
                                    bar.style.maxHeight = Math.max(newBarH, 220) + 'px';
                                } catch (e) {}
                            };
                        } catch (e) {
                            img.src = srcPath;
                        }
                    } catch (e) { img.src = srcPath; }
                };
                loaderImg.onerror = function() { try { img.src = srcPath; } catch (e) {} };
                loaderImg.src = srcPath;
            } catch (e) {
                try { img.src = 'src/textures/fetch-quest-completed.png'; } catch (ee) {}
            }

            document.body.appendChild(overlay);
            _winOverlay = overlay;
            _winImage = img;
            _winBar = bar;
        } catch (e) {
            // silent
        }
    }

    function showDeathOverlay() {
        try {
            if (_deathPlaying) return;
            ensureDeathOverlay();
            if (!_deathOverlay || !_deathImage || !_deathBar) return;
            _deathPlaying = true;

            // Ensure initial states
            _deathImage.style.transition = `opacity ${_deathFadeInMs}ms ease`;
            _deathBar.style.transition = `opacity ${_deathFadeInMs}ms ease`;
            _deathImage.style.opacity = '0';
            _deathBar.style.opacity = '0';

            // Trigger fade in on next frame
            requestAnimationFrame(() => {
                try {
                    _deathImage.style.opacity = '1';
                    _deathBar.style.opacity = '0.5';
                } catch (e) {}
            });

            // After fade-in completes, start fade-out
            setTimeout(() => {
                try {
                    _deathImage.style.transition = `opacity ${_deathFadeOutMs}ms ease`;
                    _deathBar.style.transition = `opacity ${_deathFadeOutMs}ms ease`;
                    _deathImage.style.opacity = '0';
                    _deathBar.style.opacity = '0';
                } catch (e) {}
            }, _deathFadeInMs);

            // Cleanup after full duration
            setTimeout(() => {
                try {
                    if (_deathOverlay && _deathOverlay.parentNode) {
                        try { document.body.removeChild(_deathOverlay); } catch (e) {}
                    }
                } catch (e) {}
                // reset items list when the player dies
                try { resetBoisvertItems(); } catch (e) {}
                _deathOverlay = null;
                _deathImage = null;
                _deathBar = null;
                _deathPlaying = false;
            }, _deathFadeInMs + _deathFadeOutMs + 60);
        } catch (e) {
            _deathPlaying = false;
        }
    }

        function showWinOverlay() {
            try {
                if (_winPlaying) return;
                ensureWinOverlay();
                if (!_winOverlay || !_winImage || !_winBar) return;
                _winPlaying = true;

                _winImage.style.transition = `opacity ${_deathFadeInMs}ms ease`;
                _winBar.style.transition = `opacity ${_deathFadeInMs}ms ease`;
                _winImage.style.opacity = '0';
                _winBar.style.opacity = '0';

                requestAnimationFrame(() => {
                    try {
                        _winImage.style.opacity = '1';
                        _winBar.style.opacity = '0.5';
                    } catch (e) {}
                });

                setTimeout(() => {
                    try {
                        _winImage.style.transition = `opacity ${_deathFadeOutMs}ms ease`;
                        _winBar.style.transition = `opacity ${_deathFadeOutMs}ms ease`;
                        _winImage.style.opacity = '0';
                        _winBar.style.opacity = '0';
                    } catch (e) {}
                }, _deathFadeInMs);

                setTimeout(() => {
                    try {
                        if (_winOverlay && _winOverlay.parentNode) {
                            try { document.body.removeChild(_winOverlay); } catch (e) {}
                        }
                    } catch (e) {}

                    // After the win overlay finishes, reset items and Boisvert position and respawn items
                    try { resetBoisvertItems(); } catch (e) {}

                    try {
                        // reset Boisvert to spawn pos index 0 if available
                        if (boisvertSpawnPositions && boisvertSpawnPositions.length > 0) {
                            const s = boisvertSpawnPositions[0];
                            if (s && s.length >= 3) {
                                try { boisvertModel.position.set(s[0], s[1], s[2]); } catch (e) {}
                            }
                            if (boisvertZRotations && Array.isArray(boisvertZRotations) && boisvertZRotations[0] !== undefined) {
                                try { boisvertModel.rotation.set(Math.PI / 2, 0, boisvertZRotations[0]); } catch (e) {}
                            }
                        }
                    } catch (e) {}

                    // Try to respawn interactive fetch items if manager available
                    try {
                        if (window && window.interactiveObjectsManager && typeof window.interactiveObjectsManager.respawnFetchItems === 'function') {
                            try { window.interactiveObjectsManager.respawnFetchItems(); } catch (e) {}
                        }
                    } catch (e) {}

                    _winOverlay = null;
                    _winImage = null;
                    _winBar = null;
                    _winPlaying = false;
                    _winTriggered = false; // allow re-triggering if player plays again
                }, _deathFadeInMs + _deathFadeOutMs + 60);
            } catch (e) {
                _winPlaying = false;
            }
        }

    function showOverlay() {
        try {
            ensureOverlay();
            if (_boisvertOverlay) _boisvertOverlay.style.opacity = '1';
            startNoiseLoop();
            startChaseMessageCountdown();
        } catch (e) {}
    }

    function hideOverlay() {
        try {
            if (_boisvertOverlay) _boisvertOverlay.style.opacity = '0';
            stopNoiseLoop();
            stopChaseMessageCountdown();
        } catch (e) {}
    }

    function ensureChaseMessage() {
        if (_chaseMsgEl) return;
        try {
            const wrapper = document.createElement('div');
            wrapper.id = 'boisvert-chase-message';
            wrapper.style.position = 'fixed';
            wrapper.style.left = '50%';
            wrapper.style.top = '45%';
            wrapper.style.transform = 'translate(-50%, -50%)';
            wrapper.style.pointerEvents = 'none';
            wrapper.style.zIndex = '100001';
            wrapper.style.textAlign = 'center';
            wrapper.style.color = '#ffffff';
            wrapper.style.fontFamily = "'VT323', monospace";
            wrapper.style.textShadow = '0 2px 8px rgba(0,0,0,0.9)';

            const countdown = document.createElement('div');
            countdown.id = 'boisvert-chase-countdown';
            countdown.innerText = `GAME BEGINS IN: ${_countdownDuration}`;
            countdown.style.fontSize = '32px';
            countdown.style.fontWeight = '400';
            countdown.style.letterSpacing = '2px';
            countdown.style.opacity = '0.95';
            countdown.style.color = 'red';
            countdown.style.margin = '0';
            wrapper.appendChild(countdown);

            document.body.appendChild(wrapper);
            _chaseMsgEl = wrapper;
            _chaseCountdownEl = countdown;
            _chaseMsgEl.style.transition = 'opacity 0.25s ease';
            _chaseMsgEl.style.opacity = '0';
        } catch (e) {
            // Ignore
        }
    }

    function ensureItemsList() {
        if (_itemsListEl) return;
        try {
            const wrapper = document.createElement('div');
            wrapper.id = 'boisvert-items-list';
            wrapper.style.position = 'fixed';
            wrapper.style.right = '16px';
            wrapper.style.top = '16px';
            wrapper.style.zIndex = '100010';
            wrapper.style.pointerEvents = 'auto';
            wrapper.style.minWidth = '200px';
            wrapper.style.maxWidth = '320px';
            // make background transparent and remove box visuals per request
            wrapper.style.background = 'transparent';
            wrapper.style.color = 'red';
            wrapper.style.fontFamily = "'VT323', monospace";
            // remove box appearance
            wrapper.style.borderRadius = '';
            wrapper.style.padding = '';
            wrapper.style.boxShadow = '';
            wrapper.style.textAlign = 'right';

            const title = document.createElement('div');
            title.innerText = 'Items';
            title.style.fontSize = '24px';
            title.style.marginBottom = '6px';
            title.style.fontWeight = '600';
            title.style.color = 'red';
            wrapper.appendChild(title);

            const items = [
                '1: silly pumpkin',
                '2: terrablade',
                '3: easter? egg'
            ];

            items.forEach((labelText, idx) => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.marginBottom = '6px';
                row.style.cursor = 'pointer';

                const lbl = document.createElement('div');
                lbl.id = `boisvert-item-label-${idx}`;
                lbl.innerText = labelText;
                lbl.style.fontSize = '20px';
                lbl.style.userSelect = 'none';
                lbl.style.color = 'red';
                lbl.style.flex = '1';

                // when clicked (for testing) toggle found state and dispatch event
                row.addEventListener('click', (ev) => {
                    try {
                        const wasFound = lbl.classList.contains('boisvert-item-found');
                        const nowFound = !wasFound;
                        if (nowFound) {
                            lbl.classList.add('boisvert-item-found');
                            lbl.style.textDecoration = 'line-through';
                            lbl.style.opacity = '0.6';
                        } else {
                            lbl.classList.remove('boisvert-item-found');
                            lbl.style.textDecoration = '';
                            lbl.style.opacity = '1';
                        }
                        const ev = new CustomEvent('boisvert:itemChange', { detail: { index: idx, checked: nowFound } });
                        window.dispatchEvent(ev);
                    } catch (e) {}
                });

                row.appendChild(lbl);
                wrapper.appendChild(row);
            });

            document.body.appendChild(wrapper);
            _itemsListEl = wrapper;
            // wire runtime helpers to allow external code to mark/reset items
            try {
                if (typeof window !== 'undefined') {
                    window.boisvertGame = window.boisvertGame || {};
                    try { window.boisvertGame.__setItem = setBoisvertItemChecked; } catch (e) {}
                    try { window.boisvertGame.__reset = resetBoisvertItems; } catch (e) {}
                    try { window.boisvertGame.showIntro = showGameIntro; } catch (e) {}
                }
            } catch (e) {}
        } catch (e) {
            // ignore
        }
    }

    function setBoisvertItemChecked(index, checked) {
        try {
            ensureItemsList();
            const lbl = document.getElementById(`boisvert-item-label-${index}`);
            if (lbl) {
                if (checked) {
                    lbl.classList.add('boisvert-item-found');
                    lbl.style.textDecoration = 'line-through';
                    lbl.style.opacity = '0.6';
                } else {
                    lbl.classList.remove('boisvert-item-found');
                    lbl.style.textDecoration = '';
                    lbl.style.opacity = '1';
                }
                try { const ev = new CustomEvent('boisvert:itemChange', { detail: { index: index, checked: !!checked } }); window.dispatchEvent(ev); } catch (e) {}
            }
        } catch (e) {}
    }

    function resetBoisvertItems() {
        try {
            if (!_itemsListEl) return;
            for (let i = 0; i < 3; i++) {
                const lbl = document.getElementById(`boisvert-item-label-${i}`);
                if (lbl) {
                    lbl.classList.remove('boisvert-item-found');
                    lbl.style.textDecoration = '';
                    lbl.style.opacity = '1';
                }
            }
        } catch (e) {}
    }

    // Track item found state and trigger win behavior when all are collected
    let _foundFlags = [false, false, false];
    let _itemChangeListener = null;
    try {
        _itemChangeListener = function(ev) {
            try {
                const d = (ev && ev.detail) ? ev.detail : null;
                if (!d || typeof d.index !== 'number') return;
                const idx = d.index;
                const checked = !!d.checked;
                if (idx >= 0 && idx < _foundFlags.length) {
                    _foundFlags[idx] = checked;
                }

                // If all three are true, and we haven't already triggered win sequence
                const all = _foundFlags.every(x => x === true);
                if (all && !_winTriggered) {
                    _winTriggered = true;
                    try {
                        if (window && window.achievements && typeof window.achievements.unlock === 'function') {
                            window.achievements.unlock('game_won');
                        }
                    } catch (e) {}

                    // Reset Boisvert position immediately so the scene is coherent while the overlay shows
                    try {
                        if (boisvertSpawnPositions && boisvertSpawnPositions.length > 0) {
                            const s = boisvertSpawnPositions[0];
                            if (s && s.length >= 3) {
                                try { boisvertModel.position.set(s[0], s[1], s[2]); } catch (e) {}
                            }
                            if (boisvertZRotations && Array.isArray(boisvertZRotations) && boisvertZRotations[0] !== undefined) {
                                try { boisvertModel.rotation.set(Math.PI / 2, 0, boisvertZRotations[0]); } catch (e) {}
                            }
                        }
                    } catch (e) {}

                    // Respawn fetch items immediately (and again after overlay cleanup)
                    try {
                        if (window && window.interactiveObjectsManager && typeof window.interactiveObjectsManager.respawnFetchItems === 'function') {
                            try { window.interactiveObjectsManager.respawnFetchItems(); } catch (e) {}
                        }
                    } catch (e) {}

                    try { showWinOverlay(); } catch (e) {}
                }
            } catch (e) {}
        };
        window.addEventListener('boisvert:itemChange', _itemChangeListener);
    } catch (e) {}

    // brief intro popup shown at game start
    function ensureGameIntro() {
        if (_gameIntroEl) return;
        try {
            const wrap = document.createElement('div');
            wrap.id = 'boisvert-game-intro';
            wrap.style.position = 'fixed';
            wrap.style.left = '50%';
            wrap.style.top = '40%';
            wrap.style.transform = 'translate(-50%, -50%)';
            wrap.style.zIndex = '100009';
            wrap.style.pointerEvents = 'none';
            // remove box background/padding per request - just plain text popup
            wrap.style.background = 'transparent';
            wrap.style.color = '#fff';
            wrap.style.fontFamily = "'VT323', monospace";
            wrap.style.padding = '';
            wrap.style.borderRadius = '';
            wrap.style.textAlign = 'center';
            wrap.style.maxWidth = '680px';
            wrap.style.opacity = '0';
            wrap.style.transition = 'opacity 0.35s ease';

            const h = document.createElement('div');
            h.innerText = 'Find the three secret items hidden around the backrooms.';
            h.style.fontSize = '20px';
            h.style.marginBottom = '8px';
            wrap.appendChild(h);

            const p = document.createElement('div');
            p.innerText = 'Collect them all to win. Items will appear in the top-right list.';
            p.style.fontSize = '14px';
            wrap.appendChild(p);

            document.body.appendChild(wrap);
            _gameIntroEl = wrap;
        } catch (e) {}
    }

    function showGameIntro() {
        try {
            ensureGameIntro();
            if (!_gameIntroEl) return;
            // ensure items list exists and is reset
            ensureItemsList();
            resetBoisvertItems();

            // fade in
            requestAnimationFrame(() => {
                try { _gameIntroEl.style.opacity = '1'; } catch (e) {}
            });

            // hide after 6s
            setTimeout(() => {
                try { if (_gameIntroEl) _gameIntroEl.style.opacity = '0'; } catch (e) {}
                // remove after transition
                setTimeout(() => {
                    try { if (_gameIntroEl && _gameIntroEl.parentNode) _gameIntroEl.parentNode.removeChild(_gameIntroEl); } catch (e) {}
                    _gameIntroEl = null;
                }, 400);
            }, 6000);
        } catch (e) {}
    }

    function startChaseMessageCountdown() {
        try {
            ensureChaseMessage();
            if (!_chaseMsgEl) return;
            
            if (_countdownCompleted) {
                try {
                    _chaseMsgEl.style.opacity = '0';
                } catch (e) {}
                return;
            }
            
            _chaseMsgEl.style.opacity = '1';
            _countdownStart = performance.now();
            if (_countdownRAF) {
                try {
                    cancelAnimationFrame(_countdownRAF);
                } catch (e) {}
            }

            function tick(now) {
                if (!_chaseMsgEl) return;
                if (!now) now = performance.now();
                const elapsed = (now - _countdownStart) / 1000.0;
                const remaining = Math.max(0, _countdownDuration - elapsed);
                const display = Math.ceil(remaining);
                
                try {
                    _chaseCountdownEl.innerText = `GAME BEGINS IN: ${display}`;
                } catch (e) {}
                
                if (remaining > 0) {
                    _countdownRAF = requestAnimationFrame(tick);
                } else {
                    _countdownRAF = null;
                    _countdownCompleted = true;
                    
                    try {
                        if (_chaseMsgEl) _chaseMsgEl.style.opacity = '0';
                    } catch (e) {}
                    
                        try {
                            if (window && window.achievements && typeof window.achievements.unlock === 'function') {
                                window.achievements.unlock('game_start');
                            }
                            try {
                                if (typeof update === 'function') update._chaseActive = true;
                            } catch(e) {}
                            // show game intro and items list when chase starts
                            try { showGameIntro(); } catch (e) {}
                            try { ensureItemsList(); } catch (e) {}
                        } catch (e) {}
                }
            }

            _countdownRAF = requestAnimationFrame(tick);
        } catch (e) {
            // Ignore
        }
    }

    function stopChaseMessageCountdown() {
        try {
            if (_countdownRAF) {
                try {
                    cancelAnimationFrame(_countdownRAF);
                } catch (e) {}
            }
            _countdownRAF = null;
            _countdownStart = 0;
            if (_chaseMsgEl) {
                _chaseMsgEl.style.opacity = '0';
                try {
                    if (_chaseCountdownEl && !_countdownCompleted) {
                        _chaseCountdownEl.innerText = `GAME BEGINS IN: ${_countdownDuration}`;
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    function createMovementPad() {
        if (movementPad) return;
        try {
            movementPad = new MovementPad(document.body);

            const onMove = (ev) => {
                const d = ev.detail || {};
                analogMove.x = (typeof d.deltaX === 'number') ? -d.deltaX : 0;
                analogMove.z = (typeof d.deltaY === 'number') ? d.deltaY : 0;
            };

            const onStop = () => {
                analogMove.x = 0;
                analogMove.z = 0;
            };

            movementPad.padElement.addEventListener('move', onMove);
            movementPad.padElement.addEventListener('stopMove', onStop);

            movementPad._cleanup = () => {
                try {
                    movementPad.padElement.removeEventListener('move', onMove);
                } catch (e) {}
                try {
                    movementPad.padElement.removeEventListener('stopMove', onStop);
                } catch (e) {}
                try {
                    movementPad.dispose();
                } catch (e) {}
                movementPad = null;
                analogMove.x = 0;
                analogMove.z = 0;
            };
        } catch (e) {
            console.warn('[walkMode] failed to create movement pad', e);
            movementPad = null;
        }
    }

    function destroyMovementPad() {
        if (!movementPad) return;
        try {
            if (movementPad._cleanup) movementPad._cleanup();
        } catch (e) {}
        movementPad = null;
    }

    function computeBoundsFromCenter(center, size) {
        const halfW = (size && size[0]) ? size[0] / 2 : 2;
        const halfH = (size && size[1]) ? size[1] / 2 : 1.5;
        const halfD = (size && size[2]) ? size[2] / 2 : 2;
        return {
            minX: center.x - halfW,
            maxX: center.x + halfW,
            minY: center.y - halfH,
            maxY: center.y + halfH,
            minZ: center.z - halfD,
            maxZ: center.z + halfD
        };
    }

    function enableWalkMode(centerVec3) {
        if (walkModeActive) return;

        let boundsConfig = null;
        try {
            boundsConfig = (window.ADDITIONAL_NAVIGATION_BOUNDS && typeof window.ADDITIONAL_NAVIGATION_BOUNDS === 'object') ? window.ADDITIONAL_NAVIGATION_BOUNDS : null;
        } catch (e) {
            boundsConfig = null;
        }

        let center = centerVec3.clone();
        let size = null;
        
        if (boundsConfig && Array.isArray(boundsConfig.center) && boundsConfig.center.length >= 3) {
            center = new THREE.Vector3(boundsConfig.center[0], boundsConfig.center[1], boundsConfig.center[2]);
        }
        if (boundsConfig && Array.isArray(boundsConfig.size) && boundsConfig.size.length >= 3) {
            size = boundsConfig.size;
        }

    let floorMesh = null;
    let wallsMesh = null;
    let tableTopMeshes = [];
    // proxy meshes for expanded table-top collisions
    let tableCollisionProxies = [];
        
        try {
            floorMesh = scene.getObjectByName('backrooms-floor') || scene.getObjectByName('backrooms-floor-alt') || null;
            if (!floorMesh) {
                scene.traverse(o => {
                    if (!floorMesh && o.name && o.name.toLowerCase().includes('backrooms-floor')) {
                        floorMesh = o;
                    }
                });
            }
            wallsMesh = scene.getObjectByName('backrooms-walls') || null;
            if (!wallsMesh) {
                scene.traverse(o => {
                    if (!wallsMesh && o.name && o.name.toLowerCase().includes('backrooms-walls')) {
                        wallsMesh = o;
                    }
                });
            }
            // table-top detection: collect all matching table objects
            try {
                const found = [];
                const byName = scene.getObjectByName('backrooms-table-top');
                if (byName) found.push(byName);
                scene.traverse(o => {
                    try {
                        if (!o || !o.name) return;
                        const n = o.name.toLowerCase();
                        if (n.includes('backrooms-table') || n.includes('table-top') || n.includes('tabletop') || (n.includes('table') && n.includes('backrooms'))) {
                            found.push(o);
                        }
                    } catch (e) {}
                });
                // deduplicate
                const uniq = [];
                for (let o of found) {
                    if (!o) continue;
                    if (!uniq.find(x => x && x.uuid === o.uuid)) uniq.push(o);
                }
                tableTopMeshes = uniq;
            } catch (e) {
                tableTopMeshes = [];
            }
        } catch (e) {
            floorMesh = null;
            wallsMesh = null;
            tableTopMesh = null;
        }

        if (floorMesh) {
            const box = new THREE.Box3().setFromObject(floorMesh);
            const min = box.min;
            const max = box.max;
            const inset = 0.05;
            walkBounds = {
                minX: min.x + inset,
                maxX: max.x - inset,
                minY: min.y + 0.1,
                maxY: max.y + 2.0,
                minZ: min.z + inset,
                maxZ: max.z - inset
            };
            // collect colliders (walls, floor). For table-top we create an
            // expanded invisible proxy so collisions extend above/below the real table.
            const colliders = [];
            if (wallsMesh) colliders.push(wallsMesh);
            if (floorMesh) colliders.push(floorMesh);
            if (tableTopMeshes && tableTopMeshes.length > 0) {
                for (let tmesh of tableTopMeshes) {
                    try {
                        const box = new THREE.Box3().setFromObject(tmesh);
                        const size = new THREE.Vector3();
                        box.getSize(size);
                        const center = new THREE.Vector3();
                        box.getCenter(center);
                        // Expand Y by ~8 units to create a tall collision proxy
                        const expandedY = Math.max(0.1, size.y + 8);
                        const geo = new THREE.BoxGeometry(Math.max(0.001, size.x || 1), expandedY, Math.max(0.001, size.z || 1));
                        const mat = new THREE.MeshBasicMaterial({ visible: false });
                        const proxy = new THREE.Mesh(geo, mat);
                        proxy.position.copy(center);
                        proxy.frustumCulled = false;
                        proxy.userData._isCollisionProxy = true;
                        try { scene.add(proxy); } catch (e) {}
                        tableCollisionProxies.push(proxy);
                        colliders.push(proxy);
                    } catch (e) {
                        // fallback to using the table mesh itself
                        try { colliders.push(tmesh); } catch (ee) {}
                    }
                }
            }
            walkCollisionWalls = colliders.length > 0 ? colliders : null;
        } else if (wallsMesh) {
            const box = new THREE.Box3().setFromObject(wallsMesh);
            const min = box.min;
            const max = box.max;
            const inset = 0.05;
            walkBounds = {
                minX: min.x + inset,
                maxX: max.x - inset,
                minY: min.y + 0.1,
                maxY: max.y + 2.0,
                minZ: min.z + inset,
                maxZ: max.z - inset
            };
            // collect colliders (walls + optional expanded table-top proxy)
            const colliders = [];
            if (wallsMesh) colliders.push(wallsMesh);
            if (tableTopMeshes && tableTopMeshes.length > 0) {
                for (let tmesh of tableTopMeshes) {
                    try {
                        const box = new THREE.Box3().setFromObject(tmesh);
                        const size = new THREE.Vector3();
                        box.getSize(size);
                        const center = new THREE.Vector3();
                        box.getCenter(center);
                        const expandedY = Math.max(0.1, size.y + 8);
                        const geo = new THREE.BoxGeometry(Math.max(0.001, size.x || 1), expandedY, Math.max(0.001, size.z || 1));
                        const mat = new THREE.MeshBasicMaterial({ visible: false });
                        const proxy = new THREE.Mesh(geo, mat);
                        proxy.position.copy(center);
                        proxy.frustumCulled = false;
                        proxy.userData._isCollisionProxy = true;
                        try { scene.add(proxy); } catch (e) {}
                        tableCollisionProxies.push(proxy);
                        colliders.push(proxy);
                    } catch (e) {
                        try { colliders.push(tmesh); } catch (ee) {}
                    }
                }
            }
            walkCollisionWalls = colliders.length > 0 ? colliders : null;
        } else {
            walkBounds = computeBoundsFromCenter(center, size);
            walkCollisionWalls = null;
        }

        if (isMobileDevice || !!window.__FORCE_MOVEMENT_PAD) {
            createMovementPad();
        }

        function onKeyDown(e) {
            if (e.repeat) return;
            switch (e.code) {
                case 'KeyW':
                case 'ArrowUp':
                    walkKeys.forward = 1;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    walkKeys.back = 1;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    walkKeys.left = 1;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    walkKeys.right = 1;
                    break;
            }
        }

        function onKeyUp(e) {
            switch (e.code) {
                case 'KeyW':
                case 'ArrowUp':
                    walkKeys.forward = 0;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    walkKeys.back = 0;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    walkKeys.left = 0;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    walkKeys.right = 0;
                    break;
            }
        }

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        walkModeActive = true;
        try {
            window.__walkModeActive = true;
        } catch (e) {}

        enableWalkMode._cleanup = () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            try {
                window.__walkModeActive = false;
            } catch (e) {}
            walkCollisionWalls = null;
            // remove any table collision proxies we created
            try {
                if (tableCollisionProxies && tableCollisionProxies.length > 0) {
                    for (let proxy of tableCollisionProxies) {
                        try {
                            if (proxy && proxy.parent) {
                                try { proxy.parent.remove(proxy); } catch (e) {}
                            }
                        } catch (e) {}
                        try { if (proxy && proxy.geometry) proxy.geometry.dispose(); } catch (e) {}
                        try { if (proxy && proxy.material) proxy.material.dispose(); } catch (e) {}
                    }
                    tableCollisionProxies = [];
                }
            } catch (e) {}
            destroyMovementPad();
        };
    }

    function disableWalkMode() {
        if (!walkModeActive) return;
        walkModeActive = false;
        walkKeys = { forward: 0, back: 0, left: 0, right: 0 };
        if (enableWalkMode._cleanup) {
            try {
                enableWalkMode._cleanup();
            } catch (e) {}
        }
        walkBounds = null;
        pendingWalkTarget = null;
        walkCollisionWalls = null;
        destroyMovementPad();
    }

    function teleportToPosition(targetPosition, index) {
        const spawnPos = boisvertSpawnPositions[index];
        
        if (!spawnPos) {
            console.warn(`No spawn position defined for index ${index}`);
            return;
        }
        
        boisvertModel.position.set(spawnPos[0], spawnPos[1], spawnPos[2]);

        const dx = camera.position.x - spawnPos[0];
        const dz = camera.position.z - spawnPos[2];
        const angleToCamera = Math.atan2(dx, dz);

        let zRotation = Math.PI / 2;
        if (boisvertZRotations && Array.isArray(boisvertZRotations) && boisvertZRotations[index] !== undefined) {
            zRotation = boisvertZRotations[index];
        }

        boisvertModel.rotation.set(Math.PI / 2, 0, zRotation);
        
        try {
            let inAdditional = false;
            let targetIsAdditional = false;
            const additional = (typeof window !== 'undefined' && Array.isArray(window.ADDITIONAL_NAVIGATION_POSITIONS)) ? window.ADDITIONAL_NAVIGATION_POSITIONS : null;
            
            if (additional && additional.length > 0) {
                for (let ap of additional) {
                    if (!ap || ap.length < 3) continue;
                    
                    const ddCam = Math.sqrt(
                        Math.pow(camera.position.x - ap[0], 2) +
                        Math.pow(camera.position.y - ap[1], 2) +
                        Math.pow(camera.position.z - ap[2], 2)
                    );
                    if (ddCam <= Math.max(POSITION_THRESHOLD, 0.9)) {
                        inAdditional = true;
                    }

                    const ddTarget = Math.sqrt(
                        Math.pow(spawnPos[0] - ap[0], 2) +
                        Math.pow(spawnPos[1] - ap[1], 2) +
                        Math.pow(spawnPos[2] - ap[2], 2)
                    );
                    if (ddTarget <= Math.max(POSITION_THRESHOLD, 0.9)) {
                        targetIsAdditional = true;
                    }
                    
                    if (inAdditional && targetIsAdditional) break;
                }
            }
            
            if (!inAdditional && !targetIsAdditional && (Math.random() < 1/3 || index === 5) && index !== 0) {
                lookAtBoisvert();
            }
        } catch (e) {
            // Fallback to not looking at Boisvert
        }
    }
    
    function lookAtBoisvert() {
        if (!boisvertModel) return;
        
        const targetPosition = boisvertModel.position.clone();
        const direction = new THREE.Vector3();
        direction.subVectors(targetPosition, camera.position).normalize();
        
        const targetQuaternion = new THREE.Quaternion();
        const lookAtMatrix = new THREE.Matrix4();
        lookAtMatrix.lookAt(camera.position, targetPosition, camera.up);
        targetQuaternion.setFromRotationMatrix(lookAtMatrix);
        
        const startQuaternion = camera.quaternion.clone();
        
        gsap.to({t: 0}, {
            t: 1,
            duration: 1.0,
            ease: 'power2.inOut',
            onUpdate: function() {
                camera.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, this.targets()[0].t);
                
                if (controls && controls.target) {
                    controls.target.copy(targetPosition);
                }
            }
        });
        
        try {
            window.achievements && window.achievements.unlock && window.achievements.unlock('looked_boisvert');
        } catch(e) {}

        try {
            const ach = window.achievements;
            if (ach && typeof ach.isUnlocked === 'function') {
                const all = ach.isUnlocked('clicked_paper') && ach.isUnlocked('clicked_painting') && ach.isUnlocked('clicked_cola') && ach.isUnlocked('watched_screen');
                if (all) {
                    try {
                        ach.unlock('master_interactor');
                    } catch(e) {}
                }
            }
        } catch(e) {}
    }
    
    function isChildOfBoisvert(object) {
        let parent = object.parent;
        while (parent) {
            if (parent === boisvertModel) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }

    function onBoisvertClick(event) {
        try {
            const additional = (window.ADDITIONAL_NAVIGATION_POSITIONS && Array.isArray(window.ADDITIONAL_NAVIGATION_POSITIONS)) ? window.ADDITIONAL_NAVIGATION_POSITIONS : null;
            const additionalFromScene = scene && scene.userData && scene.userData.additionalNavigationPositions ? scene.userData.additionalNavigationPositions : null;
            const additionalPositions = additional || additionalFromScene;
            
            if (!additionalPositions || additionalPositions.length === 0) return;

            const target = additionalPositions[0];
            if (!target || target.length < 3) return;

            if (window.navigateToPosition) {
                pendingWalkTarget = new THREE.Vector3(target[0], target[1], target[2]);
                try {
                    gsap.to(camera.position, {
                        x: target[0],
                        y: target[1],
                        z: target[2],
                        duration: 0.4,
                        ease: 'power2.inOut',
                        onComplete: () => {
                            if (window && window.flashlight) window.flashlight.intensity = 30;
                            try {
                                enableWalkMode(new THREE.Vector3(target[0], target[1], target[2]));
                            } catch (e) {}

                            try {
                                const lookTarget = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z - 1);
                                const lookAtMatrix = new THREE.Matrix4();
                                lookAtMatrix.lookAt(camera.position, lookTarget, camera.up);
                                const targetQuat = new THREE.Quaternion();
                                targetQuat.setFromRotationMatrix(lookAtMatrix);

                                const startQuat = camera.quaternion.clone();
                                gsap.to({ t: 0 }, {
                                    t: 1,
                                    duration: 0.6,
                                    ease: 'power2.inOut',
                                    onUpdate() {
                                        camera.quaternion.slerpQuaternions(startQuat, targetQuat, this.targets()[0].t);
                                        if (controls && controls.target && typeof controls.target.copy === 'function') {
                                            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(2);
                                            const ctrlTarget = camera.position.clone().add(forward);
                                            controls.target.copy(ctrlTarget);
                                        }
                                    }
                                });
                            } catch (e) {
                                // Ignore orientation failures
                            }
                        }
                    });
                } catch (e) {
                    // Fallback handled elsewhere
                }
            } else {
                window.navigateToPosition(target, 30);
            }
            
            try {
                window.achievements && window.achievements.unlock && window.achievements.unlock('clicked_boisvert');
            } catch (e) {}
        } catch (e) {
            console.warn('[boisvertClick] failed', e);
        }
    }
    
    function checkCameraPosition() {
        const camPos = camera.position;
        
        for (let i = 0; i < navigationPositions.length; i++) {
            const navPos = navigationPositions[i];
            const distance = Math.sqrt(
                Math.pow(camPos.x - navPos[0], 2) +
                Math.pow(camPos.y - navPos[1], 2) +
                Math.pow(camPos.z - navPos[2], 2)
            );
            
            if (distance < POSITION_THRESHOLD && i !== currentTargetIndex) {
                currentTargetIndex = i;
                teleportToPosition(navPos, i);
                try {
                    disableWalkMode();
                } catch (e) {}
                return;
            }
        }
        
        try {
            let nearestIndex = -1;
            let nearestDist = Infinity;
            
            for (let j = 0; j < navigationPositions.length; j++) {
                const p = navigationPositions[j];
                const d = Math.sqrt(
                    Math.pow(camPos.x - p[0], 2) +
                    Math.pow(camPos.y - p[1], 2) +
                    Math.pow(camPos.z - p[2], 2)
                );
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestIndex = j;
                }
            }
            
            const RELAXED_THRESHOLD = Math.max(POSITION_THRESHOLD * 2.0, 1.2);
            if (nearestIndex !== -1 && nearestIndex !== currentTargetIndex && nearestDist <= RELAXED_THRESHOLD) {
                currentTargetIndex = nearestIndex;
                teleportToPosition(navigationPositions[nearestIndex], nearestIndex);
                try {
                    disableWalkMode();
                } catch (e) {}
            }
        } catch (e) {
            // Swallow edge-case detection errors
        }
    }
    
    function update() {
        if (!boisvertModel) return;

        // Glitch vibration logic
        if (!update.lastJitterTime) update.lastJitterTime = performance.now();
        if (!update.isVibrating) update.isVibrating = false;
        if (!update.originalPosition) update.originalPosition = boisvertModel.position.clone();
        
        const now = performance.now();
        const vibrationDuration = 500;
        const vibrationInterval = 5000;
        const glitchAmount = 0.08;

        if (!update.isVibrating && now - update.lastJitterTime > vibrationInterval) {
            update.isVibrating = true;
            update.vibrationStart = now;
            update.lastJitterTime = now;
            update.originalPosition.copy(boisvertModel.position);
        }

        if (update.isVibrating) {
            const elapsed = now - update.vibrationStart;
            if (elapsed < vibrationDuration) {
                boisvertModel.position.x = update.originalPosition.x + (Math.random() - 0.5) * glitchAmount;
                boisvertModel.position.y = update.originalPosition.y + (Math.random() - 0.5) * glitchAmount;
                boisvertModel.position.z = update.originalPosition.z + (Math.random() - 0.5) * glitchAmount;
            } else {
                boisvertModel.position.copy(update.originalPosition);
                update.isVibrating = false;
            }
        }

        const currentPos = camera.position.clone();
        const moved = currentPos.distanceTo(lastCameraPosition) > 0.1;
        if (moved) {
            checkCameraPosition();
            lastCameraPosition.copy(currentPos);
        }

        if (pendingWalkTarget) {
            const d = camera.position.distanceTo(pendingWalkTarget);
            if (d < 0.6) {
                try {
                    enableWalkMode(pendingWalkTarget);
                } catch (e) {}
                pendingWalkTarget = null;
            }
        }

        try {
            const additional = (typeof window !== 'undefined' && Array.isArray(window.ADDITIONAL_NAVIGATION_POSITIONS)) ? window.ADDITIONAL_NAVIGATION_POSITIONS : null;
            if (additional && additional.length > 0) {
                let inAdditional = false;
                for (let ap of additional) {
                    if (!ap || ap.length < 3) continue;
                    const dd = Math.sqrt(
                        Math.pow(camera.position.x - ap[0], 2) +
                        Math.pow(camera.position.y - ap[1], 2) +
                        Math.pow(camera.position.z - ap[2], 2)
                    );
                    if (dd <= Math.max(POSITION_THRESHOLD, 0.9)) {
                        inAdditional = true;
                        break;
                    }
                }

                if (inAdditional) {
                    const TARGET = new THREE.Vector3(-10.5, -10, -11.79);
                    if (boisvertModel && boisvertModel.position.distanceTo(TARGET) > 0.25) {
                        try {
                            const ROT_Z = Math.PI * 3 / 4;
                            try {
                                boisvertModel.position.set(TARGET.x, TARGET.y, TARGET.z);
                            } catch (e) {}

                            try {
                                if (typeof gsap !== 'undefined' && gsap.to) {
                                    gsap.to(boisvertModel.rotation, { z: ROT_Z, duration: 0.45, ease: 'power2.out' });
                                } else {
                                    boisvertModel.rotation.z = ROT_Z;
                                }
                            } catch (e) {
                                try {
                                    boisvertModel.rotation.z = ROT_Z;
                                } catch (ee) {}
                            }

                            if (update && update.originalPosition) update.originalPosition.copy(boisvertModel.position);
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            // Swallow
        }

        if (walkModeActive && walkBounds) {
            if (!update._lastTime) update._lastTime = performance.now();
            const now = performance.now();
            const dt = Math.min(0.1, (now - update._lastTime) / 1000);
            update._lastTime = now;

            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            forward.y = 0;
            forward.normalize();
            const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

            const analogScale = 0.5;
            const useAnalog = Math.abs(analogMove.x) > 0.001 || Math.abs(analogMove.z) > 0.001;
            const moveZ = useAnalog ? (analogMove.z * analogScale) : (walkKeys.forward - walkKeys.back);
            const moveX = useAnalog ? (analogMove.x * analogScale) : (walkKeys.right - walkKeys.left);

            if (moveZ !== 0 || moveX !== 0) {
                const move = new THREE.Vector3();
                move.addScaledVector(forward, moveZ * walkSpeed * dt);
                move.addScaledVector(right, moveX * walkSpeed * dt);

                let blocked = false;
                if (walkCollisionWalls) {
                    // Sample raycasts at multiple heights so low geometry (table-tops)
                    // under head level will be detected. Player height is treated as
                    // camera top -> camera - 2 units bottom. We sample a few levels
                    // between head and feet.
                    const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4, -Math.PI/2, -Math.PI/4];
                    const heightOffsets = [-0.1, -0.6, -1.2, -1.9]; // offsets from camera.y (negative = below head)

                    for (let angle of angles) {
                        const checkDir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize();

                        // For this angle, check multiple heights; if any height reports a nearby hit,
                        // treat that direction as blocked and handle slide/parallel movement similar to before.
                        let blockedAtThisAngle = false;
                        let nearestHit = null;

                        for (let h of heightOffsets) {
                            const origin = camera.position.clone();
                            origin.y = camera.position.y + h;
                            walkRaycaster.set(origin, checkDir);
                            walkRaycaster.far = walkPlayerRadius + 0.1;

                            try {
                                const hits = Array.isArray(walkCollisionWalls)
                                    ? walkRaycaster.intersectObjects(walkCollisionWalls, true)
                                    : walkRaycaster.intersectObject(walkCollisionWalls, true);
                                if (hits && hits.length > 0 && typeof hits[0].distance === 'number') {
                                    if (hits[0].distance < walkPlayerRadius) {
                                        blockedAtThisAngle = true;
                                        nearestHit = hits[0];
                                        break; // no need to test lower heights for this angle
                                    }
                                }
                            } catch (e) {
                                // ignore
                            }
                        }

                        if (!blockedAtThisAngle) continue;

                        try {
                            const moveDirCheck = move.clone();
                            moveDirCheck.y = 0;
                            const moveLen = moveDirCheck.length();
                            if (moveLen < 1e-6) continue;
                            moveDirCheck.normalize();

                            const dotProduct = moveDirCheck.dot(checkDir);
                            if (dotProduct > 0.1) {
                                const wallNormal = checkDir.clone();
                                const parallelMove = move.clone().sub(wallNormal.multiplyScalar(move.dot(wallNormal)));
                                move.copy(parallelMove);
                            }
                        } catch (e) {
                            // swallow
                        }
                    }

                    if (move.length() < 0.001) {
                        blocked = true;
                    } else {
                        blocked = false;
                    }
                }

                if (!blocked) {
                    camera.position.add(move);
                    camera.position.x = Math.max(walkBounds.minX, Math.min(walkBounds.maxX, camera.position.x));
                    camera.position.y = Math.max(walkBounds.minY, Math.min(walkBounds.maxY, camera.position.y));
                    camera.position.z = Math.max(walkBounds.minZ, Math.min(walkBounds.maxZ, camera.position.z));

                    if (controls && controls.target && typeof controls.target.copy === 'function') {
                        controls.target.copy(camera.position);
                    }
                }
            }

            const eps = 0.01;
            if (camera.position.x < walkBounds.minX - eps || camera.position.x > walkBounds.maxX + eps || camera.position.z < walkBounds.minZ - eps || camera.position.z > walkBounds.maxZ + eps) {
                disableWalkMode();
            }
            
            try {
                if (boisvertModel) {
                    const dx = camera.position.x - boisvertModel.position.x;
                    const dz = camera.position.z - boisvertModel.position.z;
                    const targetZ = -Math.atan2(dx, dz);
                    const currentZ = (typeof boisvertModel.rotation.z === 'number') ? boisvertModel.rotation.z : 0;
                    const TWO_PI = Math.PI * 2;
                    let delta = targetZ - currentZ;
                    delta = ((delta + Math.PI) % (TWO_PI)) - Math.PI;
                    const smoothFactor = Math.min(1, Math.max(0.05, dt * 6));
                    boisvertModel.rotation.z = currentZ + delta * smoothFactor;
                }
            } catch (e) {
                // Ignore rotation errors
            }

            try {
                if (boisvertModel) {
                    try {
                        scene.updateMatrixWorld(true);
                    } catch (e) {}

                    const origin = new THREE.Vector3();
                    camera.getWorldPosition(origin);
                    const targetPos = new THREE.Vector3();
                    boisvertModel.getWorldPosition(targetPos);

                    const toBois = new THREE.Vector3().subVectors(targetPos, origin);
                    const distToBois = toBois.length();

                    if (distToBois > 0.001) {
                        const dir = toBois.normalize();

                        walkRaycaster.set(origin, dir);
                        walkRaycaster.far = distToBois + 0.01;
                        const hits = walkRaycaster.intersectObjects(scene.children, true);

                        let boisvertVisible = false;
                        let occluderName = null;

                        if (hits && hits.length > 0) {
                            const first = hits[0];
                            if (first) {
                                if (isChildOfBoisvert(first.object)) {
                                    boisvertVisible = true;
                                } else {
                                    boisvertVisible = false;
                                    occluderName = first.object && first.object.name ? first.object.name : (first.object && first.object.type ? first.object.type : 'unknown');
                                }
                            }
                        }

                        try {
                            const canvas = document.querySelector('canvas');
                            const shouldApplyBW = (!boisvertVisible && occluderName === null);

                            if (shouldApplyBW && !update._bwActive) {
                                update._bwActive = true;
                                if (canvas) {
                                    canvas.style.transition = canvas.style.transition || 'filter 0.35s ease';
                                    canvas.style.filter = 'grayscale(100%)';
                                } else {
                                    document.body.classList.add('boisvert-bw');
                                }
                                showOverlay();
                            } else if (!shouldApplyBW && update._bwActive) {
                                update._bwActive = false;
                                if (canvas) {
                                    canvas.style.filter = '';
                                } else {
                                    document.body.classList.remove('boisvert-bw');
                                }
                                hideOverlay();
                            }
                        } catch (e) {
                            // Ignore DOM errors
                        }
                    }
                }
            } catch (e) {
                // Ignore raycast/visibility errors
            }
        }

        try {
            _chaseUpdate(now);
        } catch (e) {
            // Ignore chase errors
        }
    }

    function getBoisvertPosition() {
        if (!boisvertModel) return null;
        return boisvertModel.position.clone();
    }
    
    // Initial teleport to first position
    if (navigationPositions.length > 0) {
        teleportToPosition(navigationPositions[0], 0);
        currentTargetIndex = 0;
        lastCameraPosition.copy(camera.position);
    }

    // Developer helper
    try {
        window.toggleMovementPadForDev = function() {
            window.__FORCE_MOVEMENT_PAD = !window.__FORCE_MOVEMENT_PAD;
            
            if (walkModeActive) {
                if (window.__FORCE_MOVEMENT_PAD) {
                    createMovementPad();
                } else {
                    destroyMovementPad();
                }
            }
            return !!window.__FORCE_MOVEMENT_PAD;
        };
    } catch (e) {}

    // Add pointerdown listener to boisvert model
    try {
        if (boisvertModel) {
            const raycaster = new THREE.Raycaster();
            const pointer = new THREE.Vector2();

            const canvas = document.querySelector('canvas');
            const targetElement = canvas || document;

            targetElement.addEventListener('pointerdown', (ev) => {
                try {
                    const rect = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
                    let clientX = ev.clientX;
                    let clientY = ev.clientY;

                    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
                    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(pointer, camera);
                    const intersects = raycaster.intersectObject(boisvertModel, true);
                    if (intersects && intersects.length > 0) {
                        try {
                            window.achievements && window.achievements.unlock && window.achievements.unlock('visited_first_dlc');
                        } catch(e) {}
                        onBoisvertClick(ev);
                    }
                } catch (e) {
                    // Ignore
                }
            });

            // Pointer move: show pointer cursor when hovering Boisvert
            let _boisvertHover = false;
            targetElement.addEventListener('pointermove', (ev) => {
                try {
                    const rect = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
                    const clientX = ev.clientX;
                    const clientY = ev.clientY;
                    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
                    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(pointer, camera);
                    const hits = raycaster.intersectObject(boisvertModel, true);
                    const hovering = hits && hits.length > 0;
                    if (hovering && !_boisvertHover) {
                        _boisvertHover = true;
                        try {
                            document.body.style.cursor = 'pointer';
                        } catch (e) {}
                    } else if (!hovering && _boisvertHover) {
                        _boisvertHover = false;
                        try {
                            document.body.style.cursor = '';
                        } catch (e) {}
                    }
                } catch (e) {
                    // Ignore
                }
            });

            try {
                window.boisvertClickHandler = onBoisvertClick;
            } catch (e) {}
        }
    } catch (e) {}
    
    // Expose a manager so external code can force a table re-scan if needed
    const manager = {
        update,
        getBoisvertPosition,
        lookAtBoisvert,
        forceRegisterTables() {
            try {
                console.log('[boisvertTeleporter] forceRegisterTables called');
                registerTablesInTree(scene);
                console.log('[boisvertTeleporter] forceRegisterTables complete');
            } catch (e) {
                console.error('[boisvertTeleporter] forceRegisterTables failed', e);
            }
        }
        ,
        dispose() {
            try {
                if (_itemChangeListener && typeof window !== 'undefined') {
                    try { window.removeEventListener('boisvert:itemChange', _itemChangeListener); } catch(e) {}
                    _itemChangeListener = null;
                }
            } catch (e) {}
            try {
                if (__originalSceneAdd_tables && scene && scene.add) {
                    try { scene.add = __originalSceneAdd_tables; } catch(e) {}
                }
            } catch (e) {}
        }
    };

    try { window.boisvertTeleporterManager = manager; } catch (e) {}

    return manager;
}

// Expose small runtime helpers for the items list so other game code can mark items
try {
    if (typeof window !== 'undefined') {
        window.boisvertGame = window.boisvertGame || {};
        window.boisvertGame.setItemChecked = function(i, v) {
            try { if (i !== undefined && typeof i === 'number') { const fn = window.boisvertGame.__setItem; if (fn) fn(i, !!v); } } catch(e){}
        };
        window.boisvertGame.resetItems = function() { try { const fn = window.boisvertGame.__reset; if (fn) fn(); } catch(e){} };
        // wire internal functions if available
        try { window.boisvertGame.__setItem = setBoisvertItemChecked; } catch (e) {}
        try { window.boisvertGame.__reset = resetBoisvertItems; } catch (e) {}
        try { window.boisvertGame.showIntro = showGameIntro; } catch (e) {}
    }
} catch (e) {}