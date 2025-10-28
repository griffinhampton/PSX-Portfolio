# PSX-Portfolio (Griffin Hampton)

An interactive portfolio built as a Three.js experience — a nighttime forest you can explore that doubles as a portfolio showcase with interactive objects, mini-games, in-scene multimedia, and a small chase encounter (the "Boisvert").

This README intentionally documents everything: architecture, gameplay mechanics, rendering techniques (pixelation pass), mobile optimizations, coding patterns, asset pipeline, developer notes, and the artistic inspirations behind the project. It is long by design — read the sections you want and skip the rest.

---

Table of contents (jump to a section):

- Project summary & visual description
- Inspirations & creative intent
- Architecture & module map
- Boisvert — detection, pathing, and chase (complete deep dive)
- Postprocessing and the pixel filter
- Mobile optimizations and dual-experience design (mobile-first + desktop polish)
- Coding principles, patterns & defensive practices
- Asset pipeline: Blender → glTF (what was done and recommendations)
- Achievements, persistence, and UI behaviors
- Audio/video & master-volume wiring
- Notable files and where to find what
- How to run (dev) and verification checklist
- Deployment
- Credits & license
- Next steps / developer tasks

---

## Project summary & visual description

- What it is: a single-page, client-side 3D portfolio experience using Three.js. It looks and feels like a small interactive environment you can walk around in; objects in the world open popups with portfolio content, videos, and links. The environment is dark and atmospheric with a retro-horror flavor.
- Visual palette & UI: muted night colors, fog, soft hemi lighting, warm cabin lights, and occasional pixelation/postprocess effects to give a low-fi PSX-like vibe. UI uses the VT323 monospace-inspired font for a terminal/retro interface look. Popups are draggable DOM cards that visually mimic old CRT cards.
- Gameplay: the player can navigate with orbs (teleport to navigation nodes), or use WASD/walk-mode inside the portfolio area. Interactables include lanterns (toggleable), fetch items, portfolio cards, and special popups like Griffin's Domain and FNAD nodes. The Boisvert encounter adds a short chase/panic segment.

---

## Inspirations & creative intent

- Backrooms / liminal spaces: the project intentionally channels the uncanny liminal quality of the Backrooms lore — spaces that look familiar but wrong.
- Retro horror: influences from Resident Evil and Silent Hill guide pacing, limited information, timed encounters (countdowns), and mood lighting.
- UX intent: provide two clear player experiences — a touch-first, low-latency mobile experience for casual exploration, and a richer desktop experience that provides extra polish (postprocessing, particles) when device capability permits.

---

## Architecture & module map

This section lists the primary modules and their responsibilities. The goal: make it quick to find the code for a particular behavior.

- `index.html` — entry HTML, DOM containers, popup templates (resume, popups), and CSS links.
- `index.js` — app initialization: quality settings, loading controller, scene setup, lazy-load hooks, achievements popup wiring, and global debug hooks.
- `src/js/scene/sceneSetup.js` — creates renderer, camera and base scene (fog, background). Appends renderer DOM element to `document.body`.
- `src/js/animation/animationLoop.js` — central animation loop. If postprocessing composer is available, the loop uses composer; otherwise it falls back to renderer.
- `src/js/loaders/modelLoader.js` — loads `src/models/env/whole_scene.gltf`, traverses nodes, populates the `allMeshes` raycasting array, and creates helper lights for objects that match naming patterns (lantern, backroom-light, glass, etc.).
- `src/js/controls/cameraControls.js` — camera look controls (click-drag), damping, and pointer interaction handling.
- `src/js/utils/cameraInteractiveObjects.js` — click-to-teleport nodes and camera movement completion callbacks.
- `src/js/utils/interactiveObjects.js` — central clickable object manager: raycasting, lantern toggles, fetch items, popup triggers, and respawn-on-death behavior.
- `src/js/utils/boisvertTeleporter.js` — Boisvert entity logic: look detection, countdown overlay, chase management, teleport-based spawn behavior, gating for walk-mode, and win/loss lifecycle handling.
- `src/js/utils/achievements.js` — achievements registration, localStorage persistence, panel & popup rendering, toasts, and `collected_all` collector logic.
- `src/js/postprocessing/postprocesses.js` — pixelation shader pass and composer configuration (lazy-loaded).
- `src/js/particles/particles.js` — particle systems (snow/ambient particles) (lazy-loaded).
- `src/js/utils/*` — misc utilities: `audioController.js`, `videoPlayer.js`/`screenVideoTexture.js`, `mobileDetect.js`, `movementPad.js`, `RotationPad.js`, `loadingScreen.js`, `positionTracker.js`, `resizeHandler.js`, `navbar.js`, `utils.js` (basic DOM helper), etc.

The system favors small modules that are composed in `index.js` during initialization.

---

## Boisvert — detection, pathing, and chase (complete deep dive)

Below is a full technical description of the Boisvert mechanics and the implementation choices behind them.

1) Model placement and spawn positions

- The Boisvert model is not continuously navigated across a navmesh. Instead the environment defines a set of spawn positions (an array of vectors) that correspond to navigation nodes and thematic encounter points. When an encounter triggers, Boisvert is moved (teleported) to a spawn that makes sense for the player's current navigation position.

Rationale: this teleport-and-curate approach enables predictable, dramaturgically-placed encounters without the complexity and CPU cost of full pathfinding or steering behaviors. It also enables easy control over sightlines and timing in a portfolio context.

2) Detection (line-of-sight / raycasting)

- Detection uses the Three.js Raycaster from the camera position toward Boisvert's world position (or a target offset on the model). The detection has three main checks:
  - Cone / angle test: the vector from camera forward to the target must be within a configurable angle threshold.
  - Raycast occlusion: a ray is cast and any intersection with opaque geometry before the Boisvert target will block detection.
  - Debounce/seen flags: an internal `_lookAtBoisvertSeen` flag and debounce timers prevent immediate repeat triggers from rapid look toggles.

3) Countdown & overlay

- When first detected, a countdown overlay appears (a visible DOM overlay). If the countdown completes, chase logic activates. If the player breaks line-of-sight during the countdown, the code has tolerant behavior: short look-away flicks do not restart the countdown, and full resets occur primarily on win/death.

4) Chase lifecycle and rules

- Chase activation: when countdown completes, Boisvert transitions to a chase state. In the current implementation the chase results in tense UI changes, audio cues, backroom tinting, and partial disabling of player aids (flashlight/navigation fade or locking) to increase stakes.
- Teleporting behavior: during chase phases Boisvert is moved between curated spawns as the camera moves across navigation indices. The system prioritizes spawn positions that keep Boisvert relevant to the player's location (behind/nearby) without attempting to do continuous pathfinding.

5) Win/loss handling

- On win: Boisvert is removed from the scene and internal flags are adjusted such that the countdown can later reappear the next time appropriate. The code ensures Boisvert despawns cleanly and will respawn when the player revisits the portfolio area under the appropriate conditions.
- On loss: the loss overlay plays a death audio cue and resets certain game flags. Fetch items are restored to their spawn positions where relevant.

6) Gating & user input conflicts

- When walk-mode (WASD or MovementPad) is active, Boisvert click interactions are ignored to prevent navigation conflicts. Both local `walkModeActive` and `window.__walkModeActive` are checked for robustness.

7) Where the code lives

- All Boisvert logic: `src/js/utils/boisvertTeleporter.js`.
- Shared raycast helpers and clickable mesh collection: `src/js/loaders/modelLoader.js` (which fills `allMeshes`) and `src/js/utils/interactiveObjects.js`.

---

## Postprocessing and the pixel filter (implementation details)

The project contains an optional pixelation pass implemented as a shader pass in `src/js/postprocessing/postprocesses.js`.

- Implementation: a custom shader pass quantizes fragment coordinates to blocks defined by `pixelSize` and `resolution` uniforms. The pass is added to an EffectComposer along with a RenderPass.
- Controls: `qualitySettings.pixelSize` and `qualitySettings.enablePostProcessing` toggle the effect. On lower quality or mobile the composer is not initialized.
- Lazy-loading: because composing is expensive, `postprocesses.js` is dynamically imported during idle time and sets `window.composer` and the pixelation pass on success. The main loop tests for `composer` and delegates when present.

Why this approach: it allows a PSX-like aesthetic when desired without penalizing mobile devices. The pixel pass is a single, cheap shader and is combined only when hardware can support it.

---

## Mobile-first design & parallel desktop experience

This project treats mobile as a primary target but preserves a fuller desktop experience when available.

Differences between mobile & desktop builds (not exhaustive):

- Mobile defaults:
  - Postprocessing disabled
  - Lower `renderScale` (less GPU resolution)
  - No mobile flashlight / dynamic spotlights
  - Fewer particles, lower particle update frequency
  - RotationPad initialized only when the player explicitly enters the woods
  - MovementPad and RotationPad use per-pointer-id tracking for reliable two-thumb control

- Desktop additions (when enabled):
  - Composer-based postprocessing (pixelation, film/pass) for stylistic polish
  - Denser particle systems and shadows enabled when `qualitySettings.shadowsEnabled` is true
  - Slightly higher texture resolution and additional UI affordances

The `getQualitySettings()` in `src/js/utils/mobileDetect.js` centralizes these tuning decisions.

---

## Coding principles, patterns & notable engineering choices (long)

This project blends experiment-forward iteration with a few production-minded patterns:

1) Defensive programming - try/catch and tolerant lookups

- Many DOM and scene operations are wrapped in try/catch blocks so the page degrades gracefully during partial loads or removed elements. This is helpful for a portfolio that must not crash in a demo environment.

2) Lazy-loading & progressive enhancement

- Postprocessing and particles are loaded with dynamic imports triggered by `requestIdleCallback`. This improves interactive readiness.

3) Minimal explicit global surface

- The app uses a few named globals (`window.camera`, `window.composer`, `window.fpControls`, `window.__masterVolume`) intentionally for quick dev access. Where possible, modules accept explicit references (renderer, camera) to keep the call graph clear.

4) Event-driven UI and state

- The popup and achievements systems use DOM events and explicit callback hooks. Achievements use a meta object to track whether a popup was seen and whether there are new achievements waiting.

5) Small utilities and single responsibility

- Each `src/js/utils/*` file implements a discrete responsibility (audio controller, movement pad, rotation pad, loading screen) to make it easier to reason about the codebase and to allow future unit tests to focus on small modules.

6) Performance-aware loop

- The main render loop avoids allocating temporaries wherever it is hot and checks for optional systems (composer, particle updaters) instead of hard-depending on them.

---

## Asset pipeline: Blender → glTF (what was done and recommended optimizations)

Author workflow (what was done):

- Models & props built in Blender. The scene was assembled in Blender and exported to `whole_scene.gltf`.
- Export settings favored runtime efficiency: trimmed unused bones, removed non-exported helper objects, and prioritized mesh grouping to minimize draw calls.

Recommended optimization steps (author used some of these practices):

1) Clean geometry in Blender — remove duplicate vertices, apply transforms, reduce modifier stacks.
2) Reduce polycount for background props; keep detail for focal pieces only.
3) Combine materials where possible and atlas textures to minimize material count.
4) Use gltf-pipeline or Khronos exporters to apply Draco compression for meshes and KTX2/Basis for textures if you need smaller download sizes (useful for production hosting).
5) Pre-bake lightmaps for static objects when you want static indirect lighting without run-time cost.

Important note: the repository contains `src/models/env/whole_scene.gltf` as the runtime scene file. The author created those assets in Blender and exported them as .gltf.

---

## Achievements, progress UI, and collector achievement

- Achievements are declared in `src/js/utils/achievements.js`, persisted to localStorage under a versioned key, and surfaced in a developer panel and a popup.
- The popup contains a progress bar and a percentage text placed beneath the bar to indicate completion percentage. Rendering is deduplicated via unique element IDs.
- The `collected_all` achievement (collector) is automatically unlocked when all other registered achievements are unlocked.

---

## Audio, video, and master-volume handling

- Video textures are created with hidden HTMLVideoElements (see `src/js/utils/screenVideoTexture.js`) and registered with `src/js/utils/audioController.js` so mute and master-volume controls can be applied consistently.
- Video elements are created with `playsInline` and `preload='auto'`. `THREE.VideoTexture` is used to map videos to screen meshes.

---

## Notable runtime flags and debug hooks

- `window.__masterVolume` — master volume state exposed for debug and integration
- `window.__walkModeActive` — indicates the walk-mode state when WASD or MovementPad is active
- `seePositionInfo(true|false)` — console helper to toggle the developer position info HUD
- `window.fpControls` and `window.controls` — debugging access to the active camera control objects

---

## How to run (development) — quick

Prerequisites: Node.js + npm

1) Install dependencies

```powershell
npm install
```

2) Start the dev server

```powershell
npm run dev
```

3) Open the app in the dev server address. Inspect network panel for lazy imports.

---

## Verification checklist (exhaustive)

- Scene loads and navigation orbs teleport the camera.
- Boisvert first-time sighting shows countdown overlay and behaves as described.
- Collector achievement unlocks after clearing all registered achievements.
- RotationPad on mobile is initialized only after the welcome action.
- Postprocessing files (`postprocesses.js`, `particles.js`) are fetched after idle time.

---

## Deployment

- Live site: https://www.backroomsportfolio.com
- Hosted as static files with DNS configured to route `www.backroomsportfolio.com` to the hosting service (IONOS).

---

## Credits & license

- Code & assets: Griffin Hampton (with exclusion to the lantern, that was made by my friend Seth)
- 3D models: created in Blender by the author and exported to `src/models/`
- Libraries: Three.js, GSAP, Bootstrap (carousel)
- Boisvert 'Room' character based on _xreamy_'s design and creation of the Room character on their channel _Boisvert
- License: MIT

---

## Annotated code excerpts (per-module examples)

Below are short, annotated excerpts from the implementation to help reviewers find the most important mechanics quickly. Each excerpt includes the file path and the approximate lines where the snippet appears.

1) Boisvert — line-of-sight / occlusion check (raycast)

File: `src/js/utils/boisvertTeleporter.js` (around lines ~2868-2896)

```javascript
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

    // The first hit determines visibility/occlusion; if the hit is part of Boisvert,
    // Boisvert is visible. Otherwise occluderName identifies the blocking mesh.
}
```

Annotation: this is the core visibility test used to decide if the player is "looking at" Boisvert. It performs a raycast from the camera to the Boisvert model, limits the ray to the exact distance, and inspects the first intersection to detect occlusion.

2) Boisvert — camera slerp (lookAt behavior)

File: `src/js/utils/boisvertTeleporter.js` (around lines ~2221-2260)

```javascript
function lookAtBoisvert() {
    if (!boisvertModel) return;
    const targetPosition = boisvertModel.position.clone();
    const lookAtMatrix = new THREE.Matrix4();
    lookAtMatrix.lookAt(camera.position, targetPosition, camera.up);
    const targetQuaternion = new THREE.Quaternion();
    targetQuaternion.setFromRotationMatrix(lookAtMatrix);
    const startQuaternion = camera.quaternion.clone();

    gsap.to({t:0}, {
        t:1, duration:1.0, ease:'power2.inOut',
        onUpdate: function() {
            camera.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, this.targets()[0].t);
            if (controls && controls.target) controls.target.copy(targetPosition);
        }
    });
    window.achievements && window.achievements.unlock && window.achievements.unlock('looked_boisvert');
}
```

Annotation: this smoothly rotates the camera to face Boisvert using quaternion slerp driven by GSAP, then awards the 'looked_boisvert' achievement. It demonstrates tidy animation wiring and defensive checks.

3) Central interactive raycast (clicks & fetch items)

File: `src/js/utils/interactiveObjects.js` (around lines ~720-745)

```javascript
pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
raycaster.setFromCamera(pointer, camera);

const raycastTargets = [];
interactiveObjects.forEach(obj => {
    obj.traverse(child => { if (child.isMesh) raycastTargets.push(child); });
});
const intersects = raycaster.intersectObjects(raycastTargets, false);
```

Annotation: the interactive object manager converts screen coordinates to normalized device coordinates, builds a flat list of descendant meshes from registered interactive objects, and performs an intersection test. This pattern avoids missing nested meshes and enables reliable click handling.

4) Pixelation shader pass (postprocessing)

File: `src/js/postprocessing/postprocesses.js` (top of file)

```javascript
const pixelShader = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() }, pixelSize: { value: qualitySettings.pixelSize || 2 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float pixelSize; varying vec2 vUv; void main(){ vec2 iResolution = vec2(resolution.x / pixelSize, resolution.y / pixelSize); vec2 uv = floor(vUv * iResolution) / iResolution; gl_FragColor = texture2D(tDiffuse, uv); }`
};

const pixelationPass = new ShaderPass(pixelShader);
pixelationPass.uniforms.resolution.value.set(renderWidth, renderHeight);
composer.addPass(pixelationPass);
```

Annotation: this shader quantizes UVs to produce blocky pixels. It is lightweight and therefore safe to enable on capable devices; on mobile it is disabled by default via `qualitySettings`.

5) MovementPad — per-pointer tracking (two-thumb support)

File: `src/js/utils/movementPad.js` (constructor excerpt)

```javascript
// Track active touch identifier so multiple pads can be used simultaneously
this.activePointerId = null;
// Separate mouse flag for desktop interactions
this.mouseDown = false;

// Example of mouse/pointer handler wiring (abbreviated)
this._onRegionMouseDown = (event) => { this.mouseDown = true; this.handle.style.opacity = 1.0; this.update(event.pageX, event.pageY); }
```

Annotation: the pad stores `activePointerId` so each pad (movement vs rotation) can hold its own touch pointer and allow reliable two-thumb input on mobile.

6) Achievements — collector check (auto-unlock)

File: `src/js/utils/achievements.js` (around lines ~430-447)

```javascript
function checkCollectAllAchievement() {
  const collectorId = 'collected_all';
  if (!achievementsMap.has(collectorId)) return;
  if (unlockedSet.has(collectorId)) return;
  for (const [id] of achievementsMap.entries()) {
    if (id === collectorId) continue;
    if (!unlockedSet.has(id)) return; // found an achievement not yet unlocked
  }
  try { unlockAchievement(collectorId); } catch (e) {}
}
```

Annotation: after each unlock the system calls this helper to auto-award the completionist achievement when all others are unlocked. It is defensive and skips itself when the collector is missing or already unlocked.

7) Model loading & raycast mesh collection (GLTF traversal)

File: `src/js/loaders/modelLoader.js` (gltf load callback)

```javascript
gltfLoader.load('src/models/env/whole_scene.gltf', (gltfScene) => {
  models.environment = gltfScene.scene; scene.add(models.environment);
  models.environment.traverse((child) => {
    if (child.isMesh) allMeshes.push(child);
    const name = child.name.toLowerCase();
    if (name.includes('glass') || name.includes('lantern')) { /* create lantern light and attach */ }
  });
});
```




