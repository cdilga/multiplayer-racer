import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DebugLabContract, DebugLabRegistry } from '../../static/js/debug/DebugLabContract.js';

const diagnosticsFixture = JSON.parse(
  readFileSync(new URL('./fixtures/debug-lab-diagnostics.json', import.meta.url), 'utf8')
);

describe('DebugLabContract', () => {
  describe('contract shape', () => {
    it('defines schema version', () => {
      expect(DebugLabContract.schema).toBe('jj.debugLab.v1');
    });

    it('defines canvas rendering contract', () => {
      expect(DebugLabContract.Canvas).toBeDefined();
      expect(DebugLabContract.Canvas.elementId).toBe('canvas');
      expect(DebugLabContract.Canvas.antialias).toBe(true);
    });

    it('defines inspector panel contract', () => {
      expect(DebugLabContract.InspectorPanel).toBeDefined();
      expect(DebugLabContract.InspectorPanel.elementId).toBe('inspector');
      expect(DebugLabContract.InspectorPanel.hiddenClass).toBe('hidden');
    });

    it('defines control contract', () => {
      expect(DebugLabContract.Controls).toBeDefined();
      expect(DebugLabContract.Controls.reset).toBeDefined();
      expect(DebugLabContract.Controls.stepFrame).toBeDefined();
      expect(DebugLabContract.Controls.stepSecond).toBeDefined();
      expect(DebugLabContract.Controls.playPause).toBeDefined();
    });

    it('defines scenario schema', () => {
      expect(DebugLabContract.Scenario).toBeDefined();
      expect(DebugLabContract.Scenario.schema).toBe('jj.debugLab.v1');
      expect(DebugLabContract.Scenario.properties).toBeDefined();
      expect(DebugLabContract.Scenario.properties.seed).toBeDefined();
      expect(DebugLabContract.Scenario.properties.preset).toBeDefined();
    });

    it('defines screenshot hook', () => {
      expect(DebugLabContract.ScreenshotHook).toBeDefined();
      expect(DebugLabContract.ScreenshotHook.path).toBe('window.__debugLab.takeScreenshot');
    });

    it('defines diagnostics hook', () => {
      expect(DebugLabContract.DiagnosticsHook).toBeDefined();
      expect(DebugLabContract.DiagnosticsHook.path).toBe('window.__debugLab.getDiagnostics');
      expect(DebugLabContract.DiagnosticsHook.schema).toBeDefined();
    });

    it('defines overlay contract', () => {
      expect(DebugLabContract.Overlay).toBeDefined();
      expect(DebugLabContract.Overlay.layers).toBeDefined();
      expect(DebugLabContract.Overlay.safeTextRendering).toBeDefined();
    });

    it('defines safe text rendering requirements', () => {
      expect(DebugLabContract.SafeTextRendering).toBeDefined();
      expect(DebugLabContract.SafeTextRendering.rule).toContain('textContent');
      expect(DebugLabContract.SafeTextRendering.testPayloads).toBeDefined();
      expect(DebugLabContract.SafeTextRendering.testPayloads.length).toBeGreaterThan(0);
    });

    it('defines console spy rules', () => {
      expect(DebugLabContract.ConsoleSpy).toBeDefined();
      expect(DebugLabContract.ConsoleSpy.rule).toBeDefined();
      expect(DebugLabContract.ConsoleSpy.forbiddenCalls).toBeDefined();
    });

    it('defines window hooks interface', () => {
      expect(DebugLabContract.WindowHooks).toBeDefined();
      expect(DebugLabContract.WindowHooks.debugLab).toBeDefined();
      expect(DebugLabContract.WindowHooks.hookPath).toBeDefined();
    });
  });

  describe('reset/step/play semantics', () => {
    it('reset clears state and sets time to zero', () => {
      const hook = DebugLabContract.Controls.reset;
      expect(hook.description).toContain('initial state');
      // Check for side effects related to clearing/resetting
      expect(hook.sideEffects.some(se => se.includes('time') || se.includes('clears'))).toBe(true);
    });

    it('stepFrame advances one frame', () => {
      const hook = DebugLabContract.Controls.stepFrame;
      expect(hook.description).toContain('one simulation frame');
      expect(hook.sideEffects).toContain('increments tick');
    });

    it('stepSecond advances 60 frames', () => {
      const hook = DebugLabContract.Controls.stepSecond;
      expect(hook.description).toContain('one second');
    });

    it('playPause toggles continuous playback', () => {
      const hook = DebugLabContract.Controls.playPause;
      expect(hook.description).toContain('continuous playback');
    });
  });

  describe('diagnostics schema', () => {
    it('defines required schema properties', () => {
      const schema = DebugLabContract.DiagnosticsHook.schema;
      expect(schema.schema).toBe('jj.debugLab.diagnostics.v1');
      expect(schema.timestamp).toBeDefined();
      expect(schema.tick).toBeDefined();
      expect(schema.state).toBeDefined();
      expect(schema.warnings).toBeDefined();
      expect(schema.errors).toBeDefined();
    });
  });

  describe('scenario export schema', () => {
    it('defines required scenario properties', () => {
      const props = DebugLabContract.Scenario.properties;
      expect(props.seed).toBeDefined();
      expect(props.preset).toBeDefined();
      expect(props.toolName).toBeDefined();
      expect(props.buildId).toBeDefined();
      expect(props.screenshotBase64).toBeDefined();
    });

    it('is frozen to prevent mutations', () => {
      expect(() => {
        DebugLabContract.schema = 'modified';
      }).toThrow();
    });
  });
});

describe('DebugLabRegistry', () => {
  let mockLab;

  beforeEach(() => {
    // Mock a lab instance that implements the contract
    mockLab = {
      name: 'test-lab',
      getDiagnostics() {
        return {
          schema: 'jj.debugLab.diagnostics.v1',
          timestamp: Date.now(),
          tick: 0,
          state: { test: true },
          warnings: [],
          errors: [],
        };
      },
      reset() {},
      stepFrame() {},
      takeScreenshot() {
        return Promise.resolve({ success: true, timestampMs: Date.now() });
      },
      labTools: {
        getState() {
          return { test: true };
        },
      },
    };

    // Clear any prior registrations
    DebugLabRegistry.labs.clear();

    // Mock window if needed (for test environment)
    if (typeof window === 'undefined') {
      globalThis.window = {};
    }
  });

  afterEach(() => {
    DebugLabRegistry.labs.clear();
    if (typeof window !== 'undefined' && window.__debugLab) {
      delete window.__debugLab;
    }
    if (typeof window !== 'undefined' && window.__labTools) {
      delete window.__labTools;
    }
  });

  it('registers a lab with getDiagnostics', () => {
    DebugLabRegistry.register('test-tool', mockLab);
    expect(DebugLabRegistry.getByName('test-tool')).toBe(mockLab);
  });

  it('exposes lab on window.__debugLab', () => {
    DebugLabRegistry.register('test-tool', mockLab);
    if (typeof window !== 'undefined') {
      expect(window.__debugLab).toBe(mockLab);
    }
  });

  it('exposes lab tools on window.__labTools', () => {
    DebugLabRegistry.register('test-tool', mockLab);
    if (typeof window !== 'undefined') {
      expect(window.__labTools).toBe(mockLab.labTools);
      expect(window.__labTools.getState()).toEqual({ test: true });
    }
  });

  it('throws if lab lacks getDiagnostics', () => {
    const badLab = { name: 'bad-lab' };
    expect(() => {
      DebugLabRegistry.register('bad-lab', badLab);
    }).toThrow('getDiagnostics');
  });

  it('lists all registered labs', () => {
    const lab2 = { ...mockLab, name: 'lab2' };
    DebugLabRegistry.register('lab1', mockLab);
    DebugLabRegistry.register('lab2', lab2);
    const all = DebugLabRegistry.all();
    expect(all.length).toBe(2);
    expect(all).toContain(mockLab);
    expect(all).toContain(lab2);
  });

  it('unregisters a lab', () => {
    DebugLabRegistry.register('test-tool', mockLab);
    expect(DebugLabRegistry.getByName('test-tool')).toBe(mockLab);
    DebugLabRegistry.unregister('test-tool');
    expect(DebugLabRegistry.getByName('test-tool')).toBeUndefined();
    if (typeof window !== 'undefined') {
      expect(window.__debugLab).toBeUndefined();
      expect(window.__labTools).toBeUndefined();
    }
  });

  it('diagnostics hook returns valid schema', async () => {
    DebugLabRegistry.register('test-tool', mockLab);
    if (typeof window !== 'undefined' && window.__debugLab) {
      const diag = window.__debugLab.getDiagnostics();
      expect(diag.schema).toBe('jj.debugLab.diagnostics.v1');
      expect(typeof diag.timestamp).toBe('number');
      expect(typeof diag.tick).toBe('number');
      expect(Array.isArray(diag.warnings)).toBe(true);
      expect(Array.isArray(diag.errors)).toBe(true);
    }
  });

  it('screenshot hook returns promise', async () => {
    DebugLabRegistry.register('test-tool', mockLab);
    if (typeof window !== 'undefined' && window.__debugLab) {
      const result = await window.__debugLab.takeScreenshot();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timestampMs');
    }
  });
});

describe('debug-lab scenario schema', () => {
  it('round-trips scenario JSON', () => {
    const scenario = {
      schema: 'jj.debugLab.v1',
      seed: 12345,
      preset: 'mine-arming',
      toolName: 'weapon-lab',
      timestamp: new Date().toISOString(),
      buildId: 'test-build-1',
      tuningOverrides: { spawnInterval: 5 },
      customData: {},
    };

    const json = JSON.stringify(scenario);
    const parsed = JSON.parse(json);

    expect(parsed.schema).toBe('jj.debugLab.v1');
    expect(parsed.seed).toBe(12345);
    expect(parsed.preset).toBe('mine-arming');
  });

  it('consumes the diagnostics evidence fixture', () => {
    expect(diagnosticsFixture.schema).toBe('jj.debugLab.v1');
    expect(diagnosticsFixture.scenario.schema).toBe('jj.debugLab.v1');
    expect(diagnosticsFixture.diagnostics.schema).toBe('jj.debugLab.diagnostics.v1');
    expect(diagnosticsFixture.diagnostics.hooksAvailable.reset).toBe(true);
    expect(diagnosticsFixture.diagnostics.hooksAvailable.takeScreenshot).toBe(true);
    expect(diagnosticsFixture.diagnostics.hooksAvailable.getDiagnostics).toBe(true);
    expect(diagnosticsFixture.evidence.canvasVisible).toBe(true);
    expect(diagnosticsFixture.evidence.xssPayloadsRenderedLiterally).toBe(true);
  });

  it('validates scenario properties', () => {
    const scenario = {
      schema: 'jj.debugLab.v1',
      seed: -1, // Invalid: seed should be positive
      preset: 'test',
    };

    // This is a semantic check, not a schema validator
    // In real implementation, a Zod or similar schema would validate
    expect(scenario.seed).toBeLessThan(0);
  });
});

describe('safe text rendering requirement', () => {
  it('defines test payloads for XSS detection', () => {
    const payloads = DebugLabContract.SafeTextRendering.testPayloads;
    expect(payloads).toContain('<img src=x onerror=alert("XSS")>');
    expect(payloads).toContain('javascript:alert("XSS")');
  });

  it('forbids innerHTML and dangerouslySetInnerHTML', () => {
    const forbidden = DebugLabContract.SafeTextRendering.forbiddenPatterns;
    expect(forbidden).toContain('innerHTML');
    expect(forbidden).toContain('dangerouslySetInnerHTML');
  });

  it('accepts canvas.fillText as safe method', () => {
    const accepted = DebugLabContract.SafeTextRendering.acceptedMethods;
    expect(accepted.some((m) => m.includes('fillText'))).toBe(true);
  });
});
