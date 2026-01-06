# Architect Response: Visual Overhaul Architecture

## Executive Summary

The visual overhaul plan is solid but needs architectural refinement to align with our design principles. Key recommendations: **integrate post-processing into RenderSystem** (not separate system), **make visual config data-driven** (JSON), and **use EventBus for lifecycle events** (not per-frame updates).

---

## 1. System Organization

### Recommendation: **Integrate Post-Processing into RenderSystem**

**Rationale**: Post-processing is fundamentally part of rendering, not a separate concern. Creating `PostProcessingSystem.js` violates single responsibility - it would just be a wrapper around RenderSystem's renderer.

**Proposed Structure**:
```javascript
// RenderSystem.js
class RenderSystem {
  constructor(options) {
    // ... existing code ...
    this.postProcessing = {
      enabled: true,
      composer: null,
      passes: {}
    };
  }

  async init() {
    // ... existing init ...
    this._initPostProcessing();
  }

  _initPostProcessing() {
    if (!this.postProcessing.enabled) return;
    
    this.postProcessing.composer = new EffectComposer(this.renderer);
    // Add passes...
  }

  render(dt, interpolation) {
    if (this.postProcessing.composer) {
      this.postProcessing.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
```

**Benefits**:
- Single responsibility: RenderSystem owns all rendering
- No extra system to wire up
- Easier to conditionally enable/disable
- Resize handling stays in one place

**File Size Concern**: If RenderSystem grows too large, split into:
- `RenderSystem.js` - Core rendering (scene, camera, renderer)
- `PostProcessingManager.js` - Post-processing passes (imported by RenderSystem)
- Keep them in same directory, RenderSystem imports and uses it

---

## 2. Visual Configuration

### Recommendation: **Hybrid Approach - Data-Driven Defaults + Runtime Overrides**

**Structure**:
```json
// static/assets/config/visual.json
{
  "defaults": {
    "bloom": { "strength": 1.5, "radius": 0.4, "threshold": 0.85 },
    "neon": { "intensity": 1.0, "headlightBrightness": 3.0 },
    "grading": { "intensity": 0.5, "vignette": 0.3, "aberration": 0.1 },
    "trails": { "density": 200, "minSpeed": 30, "opacity": 0.8 },
    "fog": { "density": 0.02, "skyBrightness": 0.5 },
    "shake": { "intensity": 0.15 }
  },
  "presets": {
    "neonMax": { /* override defaults */ },
    "mobileLite": { /* lower values */ },
    "off": { "bloom": { "strength": 0 }, "neon": { "intensity": 0 } }
  }
}
```

**Runtime Config**:
```javascript
// static/js/config/VisualConfig.js
class VisualConfig {
  constructor() {
    this.defaults = null;  // Loaded from JSON
    this.current = {};     // Runtime overrides
    this.preset = 'default';
  }

  async load() {
    this.defaults = await resourceLoader.load('config/visual.json');
    this.current = { ...this.defaults.defaults };
  }

  get(key) {
    return this.current[key] ?? this.defaults?.defaults[key];
  }

  set(key, value) {
    this.current[key] = value;
    this.eventBus.emit('visual:configChanged', { key, value });
  }

  applyPreset(name) {
    const preset = this.defaults.presets[name];
    if (preset) {
      Object.assign(this.current, preset);
      this.preset = name;
      this.eventBus.emit('visual:presetChanged', { preset: name });
    }
  }
}
```

**Integration**:
- `GameHost.js` creates `VisualConfig` instance
- `RenderSystem` subscribes to `visual:configChanged` events
- `LobbyUI` updates config via `visualConfig.set()`

**Benefits**:
- ✅ Data-driven (tweak without code changes)
- ✅ Runtime overrides (sliders work)
- ✅ Presets in JSON (easy to add new ones)
- ✅ Mobile detection can load different defaults

---

## 3. Material Management

### Recommendation: **Add Emissive Properties to JSON Configs**

**Vehicle JSON Enhancement**:
```json
{
  "visual": {
    "body": {
      "color": "#ff0000",
      "emissive": "#ff00ff",      // NEW
      "emissiveIntensity": 0.5    // NEW
    },
    "headlights": {
      "color": "#ffffff",
      "emissive": "#ffffff",
      "emissiveIntensity": 1.0,
      "pointLight": true,          // NEW
      "pointLightIntensity": 3.0   // NEW
    }
  }
}
```

**Track JSON Enhancement**:
```json
{
  "visual": {
    "track": {
      "color": "#333333",
      "lineColor": "#00ffff",      // NEW - for track lines
      "lineEmissive": "#00ffff",   // NEW
      "lineEmissiveIntensity": 0.8 // NEW
    },
    "barriers": {
      "color": "#666666",
      "emissive": "#00ffff",       // NEW
      "emissiveIntensity": 0.3     // NEW
    }
  }
}
```

**Material Updates**:
- **Factory creates materials** from JSON config
- **Live updates**: When visual config changes, emit event
- **VehicleFactory/TrackFactory** listen to `visual:configChanged`
- **Update material properties** (don't recreate - just modify)

```javascript
// VehicleFactory.js
eventBus.on('visual:configChanged', ({ key, value }) => {
  if (key === 'neon') {
    // Update all vehicle materials
    this.updateEmissiveIntensity(value.intensity);
  }
});
```

**Benefits**:
- ✅ Data-driven (designers can tweak colors in JSON)
- ✅ Per-vehicle/track customization possible
- ✅ Live updates without recreation
- ✅ Shares materials where possible (same config = same material)

---

## 4. Particle System Architecture

### Recommendation: **TrailSystem as Separate System, But Lightweight**

**Rationale**: Trails are a visual effect that spans multiple vehicles and has its own update loop. It's a legitimate "system" but should be minimal.

**Structure**:
```javascript
// TrailSystem.js
class TrailSystem {
  constructor({ eventBus, renderSystem }) {
    this.eventBus = eventBus;
    this.renderSystem = renderSystem;
    this.trails = new Map(); // vehicleId -> Trail object
  }

  init() {
    this.eventBus.on('vehicle:created', this._onVehicleCreated.bind(this));
    this.eventBus.on('vehicle:removed', this._onVehicleRemoved.bind(this));
    this.eventBus.on('loop:update', this._update.bind(this));
  }

  _onVehicleCreated({ vehicle }) {
    const trail = new Trail(vehicle);
    this.trails.set(vehicle.id, trail);
    this.renderSystem.getScene().add(trail.mesh);
  }

  _onVehicleRemoved({ vehicleId }) {
    const trail = this.trails.get(vehicleId);
    if (trail) {
      this.renderSystem.getScene().remove(trail.mesh);
      trail.dispose();
      this.trails.delete(vehicleId);
    }
  }

  _update({ dt }) {
    for (const [vehicleId, trail] of this.trails) {
      trail.update(dt);
    }
  }
}
```

**Trail as Component**:
```javascript
// Trail.js (internal to TrailSystem or separate file)
class Trail {
  constructor(vehicle) {
    this.vehicle = vehicle;
    this.particles = [];
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({
      color: vehicle.color,
      size: 0.2,
      blending: THREE.AdditiveBlending
    });
    this.mesh = new THREE.Points(this.geometry, this.material);
  }

  update(dt) {
    if (this.vehicle.speed < this.minSpeed) return;
    
    // Add new particle at vehicle position
    this.particles.push({
      position: { ...this.vehicle.position },
      age: 0,
      lifetime: 2.0
    });

    // Update existing particles
    // Update geometry attributes
  }
}
```

**Benefits**:
- ✅ Clean separation of concerns
- ✅ Event-driven lifecycle (no direct coupling)
- ✅ Easy to disable/remove
- ✅ Configurable per vehicle (could be in vehicle JSON)

---

## 5. Event-Driven Integration

### Recommendation: **EventBus for Lifecycle, Direct Calls for Performance**

**Use EventBus For**:
- ✅ Vehicle created/removed → TrailSystem reacts
- ✅ Visual config changed → Systems update materials
- ✅ Preset changed → All systems update
- ✅ Collision detected → Camera shake triggered

**Use Direct Calls For**:
- ❌ Per-frame updates (particle trails, camera shake)
- ❌ Render loop (RenderSystem.render() called directly)

**Pattern**:
```javascript
// Lifecycle events (EventBus)
eventBus.emit('vehicle:created', { vehicle });
eventBus.emit('visual:configChanged', { key: 'bloom', value: 1.5 });

// Performance-critical (direct)
trailSystem.update(dt);  // Called in game loop
renderSystem.render(dt);  // Called in game loop
```

**Visual Config Events**:
```javascript
// When slider changes
visualConfig.set('bloom', { strength: 1.5 });
// Emits: 'visual:configChanged' → Systems react

// Systems subscribe
renderSystem.eventBus.on('visual:configChanged', ({ key, value }) => {
  if (key === 'bloom') {
    this.postProcessing.passes.bloom.strength = value.strength;
  }
});
```

---

## 6. Performance Strategy

### Recommendation: **Performance Presets in JSON Config (Host-Side Only)**

**Important**: Mobile devices are controller-only - they send input via Socket.IO and don't render anything. All rendering happens exclusively on the host machine. Therefore, performance concerns are only about the host's capabilities.

**Structure**:
```json
// static/assets/config/visual.json
{
  "presets": {
    "neonMax": {
      "bloom": { "strength": 2.0, "radius": 0.5 },
      "trails": { "density": 300 },
      "chromaticAberration": true
    },
    "balanced": {
      "bloom": { "strength": 1.5, "radius": 0.4 },
      "trails": { "density": 200 },
      "chromaticAberration": true
    },
    "performance": {
      "bloom": { "strength": 1.0, "radius": 0.3 },
      "trails": { "density": 100 },
      "chromaticAberration": false
    },
    "off": {
      "bloom": { "strength": 0 },
      "neon": { "intensity": 0 },
      "trails": { "density": 0 }
    }
  }
}
```

**Usage**:
```javascript
// VisualConfig.js
async load() {
  this.defaults = await resourceLoader.load('config/visual.json');
  // Default to balanced preset
  this.current = { ...this.defaults.presets.balanced };
}
```

**Benefits**:
- ✅ Data-driven (easy to tune performance settings)
- ✅ Host can choose preset based on their machine
- ✅ Can add more presets (low-end host, high-end host)
- ✅ User can override with sliders

---

## Revised File Structure

```
static/
├── assets/
│   ├── config/
│   │   └── visual.json          # NEW: Visual config defaults & presets
│   ├── vehicles/
│   │   └── default.json         # MODIFIED: Add emissive properties
│   └── tracks/
│       └── oval.json            # MODIFIED: Add emissive properties
│
└── js/
    ├── config/
    │   └── VisualConfig.js      # NEW: Visual config manager
    │
    ├── systems/
    │   ├── RenderSystem.js      # MODIFIED: Add post-processing
    │   └── TrailSystem.js       # NEW: Particle trails
    │
    ├── resources/
    │   ├── TrackFactory.js      # MODIFIED: Read emissive from JSON
    │   └── VehicleFactory.js    # MODIFIED: Read emissive from JSON, add lights
    │
    ├── shaders/
    │   └── ColorGradingShader.js # NEW: Custom shader
    │
    └── ui/
        └── LobbyUI.js           # MODIFIED: Add visual config panel
```

---

## Implementation Order (Revised)

1. **Phase 1: Infrastructure**
   - Create `VisualConfig.js` + `visual.json`
   - Create `DeviceDetector.js`
   - Upgrade Three.js
   - Add post-processing to `RenderSystem` (integrated, not separate)

2. **Phase 2: Bloom + Emissive**
   - Add emissive properties to vehicle/track JSONs
   - Update factories to read emissive from JSON
   - Implement bloom in `RenderSystem`
   - Add headlights (PointLights) in `VehicleFactory`

3. **Phase 3: Post-Processing Effects**
   - Add color grading shader
   - Add chromatic aberration
   - Wire up to visual config

4. **Phase 4: Dynamic Effects**
   - Create `TrailSystem`
   - Add fog + sky to `RenderSystem`
   - Add camera shake to `RenderSystem`

5. **Phase 5: UI**
   - Add visual config panel to `LobbyUI`
   - Wire sliders to `VisualConfig`
   - Test presets

---

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Post-processing in RenderSystem | Single responsibility - rendering is one concern |
| Visual config in JSON | Data-driven, easy to tweak |
| TrailSystem as separate system | Legitimate system with own lifecycle |
| EventBus for lifecycle only | Balance between decoupling and performance |
| Materials updated, not recreated | Performance - avoid GC pressure |
| Performance presets in JSON | Data-driven host performance tuning |

---

## Testing Strategy

1. **Unit Tests** (where possible):
   - `VisualConfig` - config loading, presets
   - `DeviceDetector` - mobile detection
   - Material creation from JSON

2. **Integration Tests**:
   - Visual config changes trigger updates
   - TrailSystem lifecycle (create/remove)
   - Post-processing enable/disable

3. **Visual Regression**:
   - Screenshot comparison for visual effects
   - Performance benchmarks (FPS with effects)

---

## Summary

The architecture maintains:
- ✅ **Single Responsibility**: Each module has one job
- ✅ **Data-Driven**: Config in JSON, not code
- ✅ **Loosely Coupled**: EventBus for lifecycle, direct calls for performance
- ✅ **Testable**: Clear boundaries, minimal dependencies
- ✅ **Maintainable**: Easy to extend (add new presets, effects)

**Next Step**: Refine the implementation plan with these architectural decisions, then proceed with Phase 1.

