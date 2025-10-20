import * as THREE from "three";
import { EffectComposer } from "jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "jsm/postprocessing/ShaderPass.js";

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
    const renderScale = qualitySettings.renderScale || 1.0;
    const renderWidth = Math.floor(window.innerWidth * renderScale);
    const renderHeight = Math.floor(window.innerHeight * renderScale);
    
    const composer = new EffectComposer(renderer);
    composer.setSize(renderWidth, renderHeight);
    
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Pixelation shader
    const pixelShader = {
        uniforms: {
            tDiffuse: { value: null },
            resolution: { value: new THREE.Vector2() },
            pixelSize: { value: qualitySettings.pixelSize || 3 } // Use quality setting or default to 3
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

    return { composer, pixelationPass };
}
