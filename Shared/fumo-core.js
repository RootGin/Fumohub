/**
 * ============================================================================
 * FumoHub - Shared Scene Core Utilities (fumo-core.js)
 * Shared procedural audio, cached voxel geometries, color math, and
 * full WebGL context lifecycle & disposal management across all 16 scenes.
 * ============================================================================
 */

(function (root) {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. PROCEDURAL WEB AUDIO SYNTHESIZER
  // --------------------------------------------------------------------------
  class PlushSoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    suspend() {
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    }

    dispose() {
      if (this.ctx) {
        try {
          if (this.ctx.state !== 'closed') {
            this.ctx.close().catch(() => {});
          }
        } catch (e) {}
        this.ctx = null;
      }
    }

    // Cute double-chirp plushie squeeze sound
    playSqueeze(pitchMultiplier = 1.0) {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // Squeak 1 (compress)
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        const baseFreq = (520 + Math.random() * 80) * pitchMultiplier;
        osc1.frequency.setValueAtTime(baseFreq, now);
        osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.48, now + 0.085);
        osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.15, now + 0.16);

        gain1.gain.setValueAtTime(0.001, now);
        gain1.gain.linearRampToValueAtTime(0.11, now + 0.025);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

        osc1.connect(gain1);
        gain1.connect(this.masterGain || this.ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.18);

        // Squeak 2 (rebound pop)
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(baseFreq * 1.1, now + 0.11);
        osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.65, now + 0.21);

        gain2.gain.setValueAtTime(0.001, now + 0.11);
        gain2.gain.linearRampToValueAtTime(0.08, now + 0.13);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

        osc2.connect(gain2);
        gain2.connect(this.masterGain || this.ctx.destination);
        osc2.start(now + 0.11);
        osc2.stop(now + 0.25);
      } catch (e) {}
    }

    // Soft fabric thud when a fumo bounces off furniture
    playBounce(intensity = 0.5) {
      if (!this.enabled || intensity < 0.08) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const vol = Math.min(0.14, intensity * 0.12);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        const startFreq = 115 + Math.min(80, intensity * 35);
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);

        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

        osc.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
      } catch (e) {}
    }

    // Gentle whoosh on pickup
    playPickup() {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.09);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
        osc.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
      } catch (e) {}
    }
  }

  // --------------------------------------------------------------------------
  // 2. VOXEL & COLOR HELPER UTILITIES
  // --------------------------------------------------------------------------
  const _tempColor = typeof THREE !== 'undefined' ? new THREE.Color() : null;
  const _softGeomCache = new Map();
  const _cachedGeomSet = new WeakSet();

  function voxelHash(x, y, z) {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function varyColor(hexOrString, x, y, z, variance = 0.035, seamDarken = 0) {
    if (!_tempColor) return new THREE.Color(hexOrString);
    _tempColor.set(hexOrString);
    const h = voxelHash(x, y, z);
    const delta = (h - 0.5) * 2 * variance - seamDarken;
    _tempColor.offsetHSL(0, (h - 0.5) * 0.03, delta);
    return _tempColor.clone();
  }

  // Caches BoxGeometry per size to avoid allocating hundreds of duplicate geometries
  function createSoftVoxelGeometry(size = 1) {
    if (typeof THREE === 'undefined') return null;
    const key = Math.round(size * 1000) / 1000;
    if (!_softGeomCache.has(key)) {
      const s = size * 0.985;
      const geom = new THREE.BoxGeometry(s, s, s);
      _softGeomCache.set(key, geom);
      _cachedGeomSet.add(geom);
    }
    return _softGeomCache.get(key);
  }

  // Clamps DPR to 1.5 on high-DPI screens, reducing fragment fill-rate & bloom pass cost by ~44%
  function getOptimalPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, 1.5);
  }

  // --------------------------------------------------------------------------
  // 3. SCENE LIFECYCLE & MEMORY CLEANER
  // --------------------------------------------------------------------------
  class FumoSceneLifecycle {
    constructor(options = {}) {
      this.renderer = options.renderer || null;
      this.scene = options.scene || null;
      this.composer = options.composer || null;
      this.audio = options.audio || null;
      this.onToggleMode = options.onToggleMode || null;
      this.onSetMode = options.onSetMode || null;
      this.onPause = options.onPause || null;
      this.onResume = options.onResume || null;
      this.onDispose = options.onDispose || null;

      this.isPaused = false;
      this.isDisposed = false;

      this._boundMessageHandler = this._handleMessage.bind(this);
      this._boundVisibilityHandler = this._handleVisibility.bind(this);
      this._boundUnloadHandler = this.destroy.bind(this);

      window.addEventListener('message', this._boundMessageHandler);
      document.addEventListener('visibilitychange', this._boundVisibilityHandler);
      window.addEventListener('pagehide', this._boundUnloadHandler);
    }

    _handleMessage(e) {
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'setMode') {
        if (this.onSetMode) {
          this.onSetMode(data.mode);
        } else if (this.onToggleMode) {
          const isCurrentNight = document.body.classList.contains('night-ui');
          const wantNight = data.mode === 'night';
          if (isCurrentNight !== wantNight) {
            this.onToggleMode();
          }
        }
      } else if (data.type === 'toggleMode') {
        if (this.onToggleMode) this.onToggleMode();
      } else if (data.type === 'pause') {
        this.pause(false);
      } else if (data.type === 'resume') {
        this.resume(false);
      } else if (data.type === 'destroy') {
        this.destroy();
      }
    }

    _handleVisibility() {
      if (document.hidden) {
        this.pause(true);
      } else {
        this.resume(true);
      }
    }

    pause(fromVisibility = false) {
      this.isPaused = true;
      if (this.audio) {
        try {
          if (typeof this.audio.suspend === 'function') {
            this.audio.suspend();
          } else if (this.audio.ctx && typeof this.audio.ctx.suspend === 'function' && this.audio.ctx.state === 'running') {
            this.audio.ctx.suspend().catch(() => {});
          }
        } catch (err) {}
      }
      if (this.onPause) this.onPause(fromVisibility);
    }

    resume(fromVisibility = false) {
      this.isPaused = false;
      if (this.audio) {
        try {
          if (typeof this.audio.resume === 'function') {
            this.audio.resume();
          } else if (this.audio.ctx && typeof this.audio.ctx.resume === 'function' && this.audio.ctx.state === 'suspended') {
            this.audio.ctx.resume().catch(() => {});
          }
        } catch (err) {}
      }
      if (this.onResume) this.onResume(fromVisibility);
    }

    destroy() {
      if (this.isDisposed) return;
      this.isDisposed = true;

      window.removeEventListener('message', this._boundMessageHandler);
      document.removeEventListener('visibilitychange', this._boundVisibilityHandler);
      window.removeEventListener('pagehide', this._boundUnloadHandler);

      if (this.onDispose) {
        try { this.onDispose(); } catch (err) {}
      }

      // 1. Recursive Scene Graph Geometry & Material Disposal
      FumoSceneLifecycle.disposeHierarchy(this.scene);

      // 2. Post-processing Composer Disposal
      if (this.composer) {
        try {
          if (this.composer.renderTarget1) this.composer.renderTarget1.dispose();
          if (this.composer.renderTarget2) this.composer.renderTarget2.dispose();
          if (Array.isArray(this.composer.passes)) {
            this.composer.passes.forEach((pass) => {
              if (pass.dispose) pass.dispose();
              if (pass.renderTargetBright) pass.renderTargetBright.dispose();
              if (Array.isArray(pass.renderTargetsHorizontal)) {
                pass.renderTargetsHorizontal.forEach((rt) => rt.dispose());
              }
              if (Array.isArray(pass.renderTargetsVertical)) {
                pass.renderTargetsVertical.forEach((rt) => rt.dispose());
              }
            });
          }
        } catch (err) {}
      }

      // 3. WebGL Context Loss & Renderer Disposal
      if (this.renderer) {
        try {
          this.renderer.dispose();
          if (typeof this.renderer.forceContextLoss === 'function') {
            this.renderer.forceContextLoss();
          }
          const canvas = this.renderer.domElement;
          if (canvas) {
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (gl && typeof gl.getExtension === 'function') {
              const loseExt = gl.getExtension('WEBGL_lose_context');
              if (loseExt) loseExt.loseContext();
            }
          }
        } catch (err) {}
      }

      // 4. Audio Engine Cleanup
      if (this.audio) {
        try {
          if (typeof this.audio.dispose === 'function') {
            this.audio.dispose();
          } else if (this.audio.ctx && typeof this.audio.ctx.close === 'function') {
            this.audio.ctx.close().catch(() => {});
          }
        } catch (err) {}
      }
    }

    static disposeHierarchy(rootObj) {
      if (!rootObj) return;
      rootObj.traverse((child) => {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
          // Do not dispose cached shared box geometries
          if (!_cachedGeomSet.has(child.geometry)) {
            child.geometry.dispose();
          }
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (m && typeof m.dispose === 'function') {
              ['map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap', 'envMap', 'alphaMap', 'roughnessMap', 'metalnessMap'].forEach((prop) => {
                if (m[prop] && typeof m[prop].dispose === 'function') {
                  m[prop].dispose();
                }
              });
              m.dispose();
            }
          });
        }
      });
    }
  }

  // Export to global scope for seamless inclusion across diorama files
  root.PlushSoundEngine = PlushSoundEngine;
  root.voxelHash = voxelHash;
  root.varyColor = varyColor;
  root.createSoftVoxelGeometry = createSoftVoxelGeometry;
  root.getOptimalPixelRatio = getOptimalPixelRatio;
  root.FumoSceneLifecycle = FumoSceneLifecycle;

})(typeof window !== 'undefined' ? window : this);
