import * as THREE from "three";
import { EffectComposer } from "jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "jsm/postprocessing/ShaderPass.js";
import { FilmPass } from "jsm/postprocessing/FilmPass.js";
import { BokehPass } from "jsm/postprocessing/BokehPass.js";
import { RGBShiftShader } from "jsm/shaders/RGBShiftShader.js";

/**
 * Set up post-processing with pixelation effect
 * @param {THREE.WebGLRenderer} renderer - The WebGL renderer
 * @param {THREE.Scene} scene - The scene to render
 * @param {THREE.Camera} camera - The camera to render from
 * @param {Object} qualitySettings - Quality settings object with pixelSize and renderScale
 * @returns {Object} Object containing composer and pixelationPass
 */
export function setupPostProcessing(renderer, scene, camera, qualitySettings = {}) {
    // Apply render scale for performance (mobile can render at lower res)
    const isMobile = !!qualitySettings.isMobile;
    // If caller provided renderScale, respect it. Otherwise default to 0.9 on PC and keep mobile defaults as-is
    let currentRenderScale = (typeof qualitySettings.renderScale === 'number') ? qualitySettings.renderScale : (isMobile ? 1.0 : 0.9);
    let renderWidth = Math.floor(window.innerWidth * currentRenderScale);
    let renderHeight = Math.floor(window.innerHeight * currentRenderScale);
    
    const composer = new EffectComposer(renderer);
    composer.setSize(renderWidth, renderHeight);
    
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Pixelation shader
    const pixelShader = {
        uniforms: {
            tDiffuse: { value: null },
            resolution: { value: new THREE.Vector2() },
            pixelSize: { value: qualitySettings.pixelSize || 2 } // Use quality setting or default to 3
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform vec2 resolution;
            uniform float pixelSize;
            varying vec2 vUv;

            void main() {
                vec2 iResolution = vec2(resolution.x / pixelSize, resolution.y / pixelSize);
                vec2 uv = floor(vUv * iResolution) / iResolution;
                gl_FragColor = texture2D(tDiffuse, uv);
            }
        `
    };

    const pixelationPass = new ShaderPass(pixelShader);
    pixelationPass.uniforms.resolution.value.set(renderWidth, renderHeight);
    composer.addPass(pixelationPass);

    // Helper to apply a new render scale at runtime (updates composer + renderer buffers)
    function applyRenderScale(scale) {
        try {
            scale = Math.max(0.1, Math.min(1.0, scale));
            if (Math.abs(scale - currentRenderScale) < 0.001) return;
            currentRenderScale = scale;
            renderWidth = Math.max(1, Math.floor(window.innerWidth * currentRenderScale));
            renderHeight = Math.max(1, Math.floor(window.innerHeight * currentRenderScale));
            try { composer.setSize(renderWidth, renderHeight); } catch (e) {}
            try { renderer.setSize(renderWidth, renderHeight, false); } catch (e) {}
            try { if (pixelationPass && pixelationPass.uniforms && pixelationPass.uniforms.resolution) pixelationPass.uniforms.resolution.value.set(renderWidth, renderHeight); } catch (e) {}
        } catch (e) {}
    }

    // Dynamic resolution controller (exposed via returned object). It uses an EMA of frame time
    // and nudges the render scale up/down to try to hit the target frame time.
    const dynDefaults = {
        enabled: !!qualitySettings.dynamicResolution, // set true in qualitySettings to enable by default
        minScale: 0.5,
        maxScale: 1.0,
        step: 0.05,
        targetFps: qualitySettings.targetFps || 60,
        emaAlpha: 0.12,
        upFactor: 0.85,   // when avg frame < target * upFactor, increase scale
        downFactor: 1.05  // when avg frame > target * downFactor, decrease scale
    };
    const dynOpts = Object.assign({}, dynDefaults, qualitySettings.dynamicResolutionOptions || {});
    let dynEmaMs = 1000 / dynOpts.targetFps;

    function dynamicResolutionTick(frameMs) {
        try {
            if (!dynOpts.enabled) return;
            if (typeof frameMs !== 'number' || frameMs <= 0) return;
            dynEmaMs = dynOpts.emaAlpha * frameMs + (1 - dynOpts.emaAlpha) * dynEmaMs;
            const targetMs = 1000 / dynOpts.targetFps;
            if (dynEmaMs > targetMs * dynOpts.downFactor) {
                // slow, reduce scale
                const newScale = Math.max(dynOpts.minScale, Math.round((currentRenderScale - dynOpts.step) * 100) / 100);
                applyRenderScale(newScale);
            } else if (dynEmaMs < targetMs * dynOpts.upFactor) {
                // have headroom, increase scale
                const newScale = Math.min(dynOpts.maxScale, Math.round((currentRenderScale + dynOpts.step) * 100) / 100);
                applyRenderScale(newScale);
            }
        } catch (e) {}
    }

    // Chromatic aberration (approximated with RGB shift shader)
    try {
        const rgbPass = new ShaderPass(RGBShiftShader);
        // Convert offset vec2 -> amount + angle
        const offset = (qualitySettings.chromaticOffset && Array.isArray(qualitySettings.chromaticOffset)) ? qualitySettings.chromaticOffset : [0.002, 0.002];
        const ox = offset[0] || 0.002;
        const oy = offset[1] || 0.002;
        const amount = Math.sqrt(ox * ox + oy * oy);
        const angle = Math.atan2(oy, ox);
        try { rgbPass.uniforms['amount'].value = amount; } catch (e) {}
        try { if (rgbPass.uniforms['angle']) rgbPass.uniforms['angle'].value = angle; } catch (e) {}
        composer.addPass(rgbPass);
    } catch (e) {
        // ignore if shader not available
    }

    // Noise (FilmPass) — opacity maps to noiseIntensity
    try {
        const noiseOpacity = (qualitySettings.noiseOpacity !== undefined) ? qualitySettings.noiseOpacity : 0.5;
        // FilmPass(noiseIntensity, scanlinesIntensity, scanlinesCount, grayscale)
        const filmPass = new FilmPass(noiseOpacity, 0.0, 0, false);
        composer.addPass(filmPass);
    } catch (e) {}

    // Depth of field (BokehPass approximation)
    try {
        const dofOpts = qualitySettings.depthOfField || {};
        const focusDistance = (dofOpts.focusDistance !== undefined) ? dofOpts.focusDistance : 1;
        const focalLength = (dofOpts.focalLength !== undefined) ? dofOpts.focalLength : .5;
        const bokehScale = (dofOpts.bokehScale !== undefined) ? dofOpts.bokehScale : 1.0;
        // Map to BokehPass params: focus, aperture, maxblur
        const params = {
            focus: focusDistance,
            aperture: Math.max(0.0001, 0.00025 * (focalLength || 1.5)),
            maxblur: 0.01 * (bokehScale || 1)
        };
        const bokehPass = new BokehPass(scene, camera, params);
        composer.addPass(bokehPass);
    } catch (e) {}

    // Tile-based rendering helper for PC: renders the scene/composer in N x M tiles
    const enableTileRendering = (typeof qualitySettings.enableTileRendering !== 'undefined') ? !!qualitySettings.enableTileRendering : (!isMobile);

    function renderFull() {
        if (composer && typeof composer.render === 'function') {
            try { composer.render(); } catch (e) { /* ignore */ }
        } else {
            try { renderer.render(scene, camera); } catch (e) {}
        }
    }

    function renderTiled(tilesX = (qualitySettings.tileCountX || 2), tilesY = (qualitySettings.tileCountY || 2)) {
        // If tiles disabled or camera doesn't support view offset, fallback to full render
        if (!enableTileRendering || !camera || typeof camera.setViewOffset !== 'function') {
            return renderFull();
        }

        // full render target size (the size we set composer to)
        const fullW = renderWidth;
        const fullH = renderHeight;
        if (fullW <= 0 || fullH <= 0) return renderFull();

        const tileW = Math.ceil(fullW / tilesX);
        const tileH = Math.ceil(fullH / tilesY);

        // drawing buffer size (actual canvas pixels)
        const drawW = renderer.domElement.width;
        const drawH = renderer.domElement.height;
        const scaleX = drawW / fullW;
        const scaleY = drawH / fullH;

        // enable scissor test so each tile only writes to its region
        try { renderer.state.buffers.scissor.setTest(true); } catch (e) { try { renderer.getContext().enable(renderer.getContext().SCISSOR_TEST); } catch (ee) {} }

        for (let j = 0; j < tilesY; j++) {
            for (let i = 0; i < tilesX; i++) {
                const offsetX = i * tileW;
                const offsetY = j * tileH;
                const thisW = Math.min(tileW, fullW - offsetX);
                const thisH = Math.min(tileH, fullH - offsetY);

                // Set camera to render only this sub-region of the full view
                try { camera.setViewOffset(fullW, fullH, offsetX, offsetY, thisW, thisH); } catch (e) {}

                // Map tile region into drawing buffer coordinates
                const vx = Math.floor(offsetX * scaleX);
                // flip Y for WebGL viewport origin
                const vy = Math.floor(drawH - ((offsetY + thisH) * scaleY));
                const vw = Math.ceil(thisW * scaleX);
                const vh = Math.ceil(thisH * scaleY);

                try {
                    renderer.setViewport(vx, vy, vw, vh);
                    renderer.setScissor(vx, vy, vw, vh);
                } catch (e) {}

                // Render this tile (composer will pick up camera.viewOffset)
                try {
                    if (composer && typeof composer.render === 'function') composer.render();
                    else renderer.render(scene, camera);
                } catch (e) {}
            }
        }

        // restore camera and renderer state
        try { camera.clearViewOffset(); } catch (e) {}
        try { renderer.setViewport(0, 0, drawW, drawH); renderer.setScissor(0, 0, drawW, drawH); } catch (e) {}
        try { renderer.state.buffers.scissor.setTest(false); } catch (e) { try { renderer.getContext().disable(renderer.getContext().SCISSOR_TEST); } catch (ee) {} }
    }

    // Return composer and helpers; renderTiled is the preferred render method for PC
    return { composer, pixelationPass, renderTiled, applyRenderScale, dynamicResolutionTick, getCurrentRenderScale: () => currentRenderScale };
}
