# PSX-Portfolio (Three.js)

An interactive nighttime forest portfolio scene built with Three.js. The project focuses on polished camera/interaction UX across desktop and mobile while keeping performance reasonable on low-power devices.

This README was updated to reflect the recent changes (teleport collision, mobile look controls, multi-touch, centralized UI wiring, and lazy-loading of heavy subsystems).

## Recent changes (last week)
- Door collision teleport: walking the camera into the scene object named `backroom-light-door` now teleports the camera to the last navigation position (proximity-based trigger with a cooldown).
- Camera arrival orientation: when navigation/teleport finishes, the camera spherically interpolates (slerp) to face forward before enabling walk-mode, producing a smooth look-forward transition.
- Mobile RotationPad: a new on-screen right-hand rotation pad was added for look control on mobile devices. It is initialized only after the user enters the scene (presses "ENTER THE WOODS") and uses reduced sensitivity (vertical movement is slower than horizontal).
- Two-thumb mobile controls: both the movement pad and the rotation pad support simultaneous touches by tracking per-pad touch/pointer identifiers (improves usability for two-thumb users).
- Mobile flashlight removed: the mobile-specific spotlight/flashlight has been disabled to reduce visual noise and runtime cost on mobile devices.
- UI consolidation: inline scripts were moved from `index.html` into `index.js` and centralized into `initUI()` (resume popup wiring, draggable popups, hint swapping, achievements toggle).
- Mobile hint text: welcome and loading hint text now switches to "Use the directional pads..." on mobile, driven by the centralized `mobileDetect` utility.
- Lazy-loading of heavy subsystems: postprocessing (`postprocesses.js`) and particles (`particles.js`) are now imported dynamically during idle time (via `requestIdleCallback` with a fallback). The animation loop and other systems read composer/particle arrays/updater from runtime globals so the scene can render and be interactive before heavy modules finish loading.

## What changed in the code (high level)
- Files updated:
	- `src/js/animation/animationLoop.js` — no longer statically imports particle updater; reads `window.updateParticles` and `window.particleArrays` (safe fallbacks) and uses `window.composer` when available.
	- `index.js` — removed eager imports for postprocessing and particles; added `lazyLoadHeavyModules()` which dynamically imports `postprocesses.js` and `particles.js` during idle time and exposes results on `window`.
	- `src/js/utils/RotationPad.js` — mobile rotation pad implementation, tuned sensitivity and position.
	- `src/js/utils/movementPad.js` — updated to track per-pad active touch/pointer id for robust two-thumb use.
	- `src/js/utils/mobileDetect.js` — central mobile detection and rotation pad initialization after the welcome event.
	- `src/js/utils/boisvertTeleporter.js` — camera quaternion slerp on arrival (look-forward behavior).

## How lazy-loading works now
- Heavy subsystems (postprocessing, particles) are imported dynamically after initial render using `requestIdleCallback` (or a 2s timeout fallback). When they initialize they attach:
	- `window.composer` and `window.pixelationPass` (postprocessing)
	- `window.particleArrays` and `window.updateParticles` (particles updater)
- The animation loop detects these globals and uses them when available. Until then the scene renders with the default renderer and particle updates are skipped.

## Dev: quick start and verification
1. Install and run dev server:

```powershell
npm install
npm run dev
```

2. Open the app in a browser. In DevTools → Network you should see dynamic imports for `postprocesses.js` and `particles.js` occur after initial load (idle time). Console messages will indicate when lazy modules are initialized:

- "[lazy] postprocessing initialized"
- "[lazy] particles initialized"

3. Verify features:
- Walk the camera into the object named `backroom-light-door` (in-scene). The camera should immediately teleport to the last navigation position. The arrival flow triggers a smooth orientation slerp.
- On mobile: press "ENTER THE WOODS" (welcome popup) to initialize the RotationPad. Use two thumbs — left for movement, right for look — to ensure both pads operate simultaneously.

## Notes, caveats and future work
- Environment/model lazy-loading: the main GLTF loader still loads the full `whole_scene.gltf` file. If you want faster initial load on low-end devices, we can split the environment into smaller chunks and lazy-load distant/optional geometry.
- Pointer events: pads currently use touch + mouse handlers with per-touch id tracking. Migrating to Pointer Events would simplify multi-input handling and is recommended as a follow-up.
- Preload/prefetch: if you want postprocessing/particles to be ready sooner on desktop, we can add `modulepreload` or `prefetch` hints or trigger the dynamic import earlier for desktop users.
- Globals: several modules still expose globals (e.g., `window.camera`, `window.composer`, `window.particleArrays`) for compatibility. If you prefer a cleaner dependency flow, we can refactor to pass explicit references instead.

## Credits
- Built with Three.js and GSAP.
- Assets, models, and textures are in `src/models`, `src/textures` and `src/videos`.

## License
- MIT
