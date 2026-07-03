/**
 * DebugLabContract
 * Shared contract and conventions for all debug labs: car-viewer, weapon-lab, map authoring.
 * Ensures deterministic control, screenshot/diagnostics hooks, scenario export/import,
 * and safe text rendering for evidence bundles suitable for Beads completion notes.
 *
 * Contract elements:
 * 1. Production render path (full-screen Three.js canvas)
 * 2. Inspector panel (compact, optional, state-preserving)
 * 3. Deterministic control (reset, step frame, step second, play/pause)
 * 4. Scenario schema (JSON import/export, seed-based reproducibility)
 * 5. Screenshot hook (Playwright integrations, timestamped)
 * 6. Diagnostics hook (machine-readable output)
 * 7. Overlay contract (visible assumptions, configurable layers)
 * 8. Safe text rendering (no XSS, hostnames/model labels/errors literal)
 * 9. Console spy (no per-frame spam, warnings/errors logged with context)
 * 10. Window hooks (window.__debugLab, window.__labTools)
 */

export const DebugLabContract = Object.freeze({
  /**
   * Schema version for all lab scenario exports.
   */
  schema: 'jj.debugLab.v1',

  /**
   * Canvas rendering contract.
   * Labs must expose a production-quality Three.js renderer at the given element.
   */
  Canvas: {
    elementId: 'canvas', // or document.querySelector('canvas')
    pixelRatio: 1, // min(devicePixelRatio, 2) recommended for stability
    outputColorSpace: 'sRGBColorSpace',
    antialias: true,
  },

  /**
   * Inspector panel contract (optional but recommended).
   * If present, should support compact state and parameter tuning.
   */
  InspectorPanel: {
    elementId: 'inspector',
    hiddenClass: 'hidden', // CSS class for visibility toggle
    structureRef: {
      // Example structure for weapon lab:
      controls: [
        { id: 'param-preset', type: 'select', label: 'Preset', options: ['missile', 'mine', 'boost'] },
        { id: 'param-seed', type: 'number', label: 'Seed', min: 0, max: 1000000 },
        { id: 'param-step', type: 'button', label: 'Step 1 frame' },
        { id: 'param-play', type: 'button', label: 'Play/Pause' },
        { id: 'param-screenshot', type: 'button', label: 'Screenshot' },
        { id: 'param-export', type: 'button', label: 'Export JSON' },
        { id: 'param-diagnostics', type: 'button', label: 'Run checks' },
      ],
    },
  },

  /**
   * Control contract: reset, step, play/pause.
   * Labs must provide these deterministic operations for reproducibility.
   */
  Controls: {
    reset: {
      description: 'Reset to initial state (seed, scenario, time=0)',
      hookPath: 'window.__debugLab.reset()',
      sideEffects: ['clears time', 'disposes objects', 'reruns setup'],
    },
    stepFrame: {
      description: 'Advance one simulation frame (fixed dt, usually 1/60s)',
      hookPath: 'window.__debugLab.stepFrame()',
      sideEffects: ['increments tick', 'runs physics/logic step'],
    },
    stepSecond: {
      description: 'Advance one second (60 frames at 60fps)',
      hookPath: 'window.__debugLab.stepSecond()',
      sideEffects: ['increments tick by 60', 'cumulative'],
    },
    playPause: {
      description: 'Toggle continuous playback',
      hookPath: 'window.__debugLab.playPause()',
      sideEffects: ['affects requestAnimationFrame loop', 'pauses timers'],
    },
  },

  /**
   * Scenario schema: reproducible JSON state.
   * Labs export scenarios to preserve seed, presets, and results for issue reports.
   */
  Scenario: {
    schema: 'jj.debugLab.v1',
    properties: {
      seed: { type: 'number', description: 'RNG seed for deterministic reproduction' },
      preset: { type: 'string', description: 'Lab-specific preset name (e.g., "mine-arming")' },
      toolName: { type: 'string', description: 'Tool identifier (e.g., "car-viewer", "weapon-lab")' },
      timestamp: { type: 'string', description: 'ISO 8601 creation time' },
      buildId: { type: 'string', description: 'Build version for cross-version compatibility' },
      screenshotBase64: { type: 'string', description: 'PNG as data URL (optional)' },
      diagnosticsHash: { type: 'string', description: 'Hash of diagnostics output at export time' },
      tuningOverrides: { type: 'object', description: 'Lab-specific parameter overrides' },
      customData: { type: 'object', description: 'Tool-specific data (weapon presets, etc.)' },
    },
  },

  /**
   * Screenshot hook: callable from Playwright, renders to canvas.
   * Should return a Promise<{success: boolean, timestampMs: number, fileSizeBytes: number}>
   */
  ScreenshotHook: {
    path: 'window.__debugLab.takeScreenshot',
    signature: '() => Promise<{success: boolean, timestampMs: number, fileSizeBytes?: number}>',
    behavior: [
      'Render current state to canvas',
      'Capture canvas as PNG',
      'Return data URL or file reference',
      'No console spam during capture',
    ],
  },

  /**
   * Diagnostics hook: machine-readable output.
   * Called by tests and export, should output JSON with schema validation.
   */
  DiagnosticsHook: {
    path: 'window.__debugLab.getDiagnostics',
    signature: '() => object (JSON-serializable)',
    schema: {
      schema: 'jj.debugLab.diagnostics.v1',
      timestamp: 'number (milliseconds since epoch)',
      tick: 'number (simulation tick)',
      state: 'object (tool-specific state summary)',
      warnings: 'string[] (validation warnings)',
      errors: 'string[] (error log since last reset)',
      metrics: 'object (performance metrics: fps, memory, etc.)',
    },
  },

  /**
   * Overlay contract: visible assumptions and state.
   * Labs should render overlays to communicate assumptions to human observers.
   */
  Overlay: {
    layers: [
      { id: 'assumptions', label: 'Assumptions', default: true },
      { id: 'diagnostics', label: 'Diagnostics', default: false },
      { id: 'geometry', label: 'Geometry bounds', default: true },
      { id: 'picking', label: 'Raycast/hit zones', default: false },
    ],
    format: '2D canvas overlay or Three.js debug geometry (wireframes, text, vectors)',
    safeTextRendering: 'Use SafeTextRenderer for all user-provided labels',
  },

  /**
   * Safe text rendering contract.
   * All player names, model labels, errors, and debug text must be rendered safely
   * (no HTML interpolation, no XSS payloads rendered as markup).
   */
  SafeTextRendering: {
    rule: 'All text rendered to canvas or DOM must use textContent, not innerHTML',
    forbiddenPatterns: ['innerHTML', 'dangerouslySetInnerHTML', 'DOMParser eval'],
    acceptedMethods: [
      'canvas.fillText() with explicit font/color',
      'element.textContent = ...',
      'element.appendChild(document.createTextNode(...))',
    ],
    testPayloads: [
      '<img src=x onerror=alert("XSS")>',
      'javascript:alert("XSS")',
      '${Math.random()}',
      '{} ]] - attack try',
    ],
  },

  /**
   * Console spy: prevent per-frame spam, capture warnings/errors.
   * Labs must not log on every frame; use overlays for real-time data.
   */
  ConsoleSpy: {
    rule: 'No per-frame console.log calls (spam ruins test logs and Playwright)',
    allowedCalls: [
      'One-time init messages (console.log at setup)',
      'User-triggered actions (screenshot, export, reset)',
      'Errors and warnings (console.warn, console.error with context)',
    ],
    forbiddenCalls: [
      'console.log inside requestAnimationFrame callback',
      'console.log inside physics/render loop',
      'console.log on every tick',
    ],
    implementation: 'window.__debugLab.getConsoleLogs() returns {warns: [], errors: []} with timestamp',
  },

  /**
   * Window hooks: global entry points for tools and tests.
   * All labs must expose the same interface for tooling.
   */
  WindowHooks: {
    debugLab: 'window.__debugLab — primary lab interface',
    labTools: 'window.__labTools — test/diagnostic helper functions',
    hookPath: {
      // Lab interface (required)
      reset: 'Resets state, clears diagnostics, time=0',
      stepFrame: 'Advances one frame (fixed dt)',
      stepSecond: 'Advances one second',
      playPause: 'Toggles continuous playback',
      takeScreenshot: 'Returns Promise<{success, timestampMs, fileSizeBytes}>',
      getDiagnostics: 'Returns JSON diagnostics bundle',
      getConsoleLogs: 'Returns {warns: [], errors: []} since last reset',
      exportScenario: 'Returns JSON scenario (seed, preset, overrides, screenshot)',
      importScenario: 'Accepts JSON scenario, re-runs setup, returns success boolean',

      // Test helper interface (optional but recommended)
      getCanvasElement: 'Returns HTMLCanvasElement reference',
      getRenderer: 'Returns Three.js Renderer (if applicable)',
      getScene: 'Returns Three.js Scene (if applicable)',
      getState: 'Returns current lab state (tool-specific shape)',
    },
  },

  /**
   * Build and version tracking.
   * Scenarios include buildId so labs can warn on version mismatch.
   */
  VersionTracking: {
    buildIdSource: 'process.env.VITE_BUILD_ID or generated at runtime',
    scenarioCompatibility: 'Warn if buildId differs between scenario and current build',
    migration: 'No automatic migration; old scenarios fail with clear message',
  },
});

/**
 * Registry for all active labs (used by test fixtures and report generators).
 */
export const DebugLabRegistry = {
  labs: new Map(), // Map<toolName, labInstance>

  register(toolName, labInstance) {
    if (typeof labInstance.getDiagnostics !== 'function') {
      throw new Error(`Lab ${toolName} must implement getDiagnostics()`);
    }
    this.labs.set(toolName, labInstance);
    if (typeof window !== 'undefined') {
      window.__debugLab = labInstance; // Expose on window
      window.__labTools = labInstance.labTools || {
        getState: () => labInstance.getDiagnostics()
      };
    }
  },

  unregister(toolName) {
    const labInstance = this.labs.get(toolName);
    this.labs.delete(toolName);
    if (typeof window !== 'undefined' && window.__debugLab === labInstance) {
      delete window.__debugLab;
      delete window.__labTools;
    }
  },

  all() {
    return Array.from(this.labs.values());
  },

  getByName(toolName) {
    return this.labs.get(toolName);
  },
};

export default DebugLabContract;
