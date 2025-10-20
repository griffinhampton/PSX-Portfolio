# Three.js Winter Cabin Scene

A nighttime winter forest scene built with Three.js featuring a lit cabin, falling snow particles, atmospheric fog, and an interactive flashlight system.

## Features

### Desktop Experience
- Interactive mouse-following flashlight with 14-sided polygonal beam
- 100,000 particle snow system that follows the camera
- Custom pixelation post-processing shader
- Real-time raycasting for 3D position tracking
- Shadow mapping with PCF soft shadows
- Multiple dynamic light sources (cabin lights, ambient, hemisphere, directional)
- OrbitControls with damping for smooth camera movement
- Atmospheric fog starting 10 units from camera
- GLTF model loading (furniture and environment)
- Real-time position display for camera placement

### Mobile Optimization
Automatic mobile detection with performance optimizations:
- Reduced particle count (5,000 instead of 100,000)
- Disabled post-processing effects
- No flashlight or raycaster calculations
- Shadows disabled
- Direct rendering (no EffectComposer)
- Antialiasing disabled
- Static models (no rotation)

## Technical Stack

- Three.js r161
- OrbitControls for camera interaction
- GLTFLoader for 3D models
- EffectComposer for post-processing
- Custom GLSL shaders for pixelation
- Raycaster for 3D mouse interactions
- Vite for development and building

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open your browser to `http://localhost:5173`

## Build

```bash
npm run build
```

## Project Structure

```
.
├── public/
│   ├── index.html              # Main HTML file
│   └── assets/
│       ├── models/             # 3D models (GLTF)
│       └── textures/           # Texture images
├── src/
│   ├── js/
│   │   ├── main.js            # Main entry point
│   │   ├── config.js          # Configuration constants
│   │   ├── lights/
│   │   │   ├── sceneLights.js # Scene lighting setup
│   │   │   └── flashlight.js  # Flashlight spotlight
│   │   ├── particles/
│   │   │   └── snowParticles.js # Particle system
│   │   ├── postprocessing/
│   │   │   └── pixelation.js  # Post-processing effects
│   │   └── utils/
│   │       ├── mobileDetection.js # Mobile device detection
│   │       └── positionTracker.js # 3D position tracking
│   ├── cross.png              # Particle texture
│   ├── env/                   # Environment models
│   └── furniture/             # Furniture models
├── package.json
└── README.md
```

## Scene Components

### Lighting
- Ambient light (0.3 intensity)
- Hemisphere light with cool blue tones (0.4 intensity)
- Two warm cabin point lights (25 intensity, orange)
- Directional light for depth (0.5 intensity)
- Interactive spotlight flashlight (30 intensity, desktop only)

### Post-Processing
- Custom pixelation shader (3-pixel grid)
- Configurable through shader uniforms

### Particle System
- 100,000 particles on desktop (5,000 on mobile)
- Follows camera position
- Custom texture-based material
- Continuous y-axis animation

### Models
- Nightstand furniture model
- Mountain plane environment model
- All models support shadow casting and receiving

## Camera Controls
- Fixed position rotation (panning disabled)
- Mouse button configuration: left/right for rotation, middle for zoom
- Smooth damping enabled (factor: 0.05)

## Browser Compatibility

Works on all modern browsers supporting WebGL. Mobile devices automatically receive optimized settings for better performance.

## Performance Considerations

Desktop systems should maintain 60fps with all features enabled. Mobile devices receive a significantly optimized version that reduces particle count by 95%, disables post-processing, shadows, and dynamic elements to ensure playable framerates on lower-powered devices.

## License

MIT
