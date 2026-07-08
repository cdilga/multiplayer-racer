# Damage System Spec

This document defines the progressive vehicle damage system for Joystick Jammers. Damage is a **core gameplay mechanic**, not a cosmetic feature - it provides meaningful feedback and affects vehicle physics, controls, and respawn behavior.

## Core Philosophy

- **Progressive destruction**: Vehicles degrade visually and mechanically over time
- **Spectacle-driven**: Damage events should be dramatic, visible, and satisfying
- **Arcade feel**: Forgiving but consequential - death should feel fair and fun
- **Clear feedback**: Players always know their vehicle state through visual/UI indicators

## Priority 1: Damage Detection & Health System

### Health Mechanics

```typescript
interface VehicleHealth {
    current: number;        // 0-100
    maximum: number;        // Default 100, configurable per game mode
    isDestroyed: boolean;   // true when current <= 0
    isDead: boolean;        // true when destroyed AND in death state
}
```

### Collision Detection

**Damage is only applied when vulnerable surfaces make contact:**

| Surface | Damage Applied? | Rationale |
|---------|----------------|-----------|
| **Wheels** (bottom) | ❌ NO | Normal driving - wheels should touch ground |
| **Chassis bottom** | ❌ NO | Bottom-out on landing is expected |
| **Roof** | ✅ YES | Flipped/inverted - high damage |
| **Side edges** | ✅ YES | T-bone/side impacts - medium damage |
| **Front/rear** | ✅ YES | Head-on collisions - low-medium damage |

**Implementation approach:**
- Use Rapier collision events to detect impact force/location
- Raycast or body part detection to identify which surface was hit
- Apply damage multipliers based on surface type and impact velocity

```typescript
interface DamageEvent {
    impactForce: number;       // Newtons or equivalent
    impactPoint: Vector3;      // World position
    surfaceHit: 'roof' | 'side' | 'front' | 'rear';
    damageAmount: number;      // Calculated damage
    timestamp: number;
}
```

### Damage Calculation

```typescript
function calculateDamage(collision: CollisionEvent): number {
    const surfaceMultiplier = {
        'roof': 3.0,      // Extremely vulnerable
        'side': 2.0,      // Very vulnerable
        'front': 1.2,     // Moderate
        'rear': 1.2,      // Moderate
        'wheels': 0.0,    // Immune
        'bottom': 0.0     // Immune
    };

    const baseDamage = collision.impactForce / 100; // Scale to 0-100 range
    const multiplier = surfaceMultiplier[collision.surface];

    return baseDamage * multiplier;
}
```

## Priority 2: Visual Destruction (Spectacle)

### Progressive Damage States

Vehicles visually degrade through distinct stages:

| Health % | Visual State | Effects |
|----------|-------------|---------|
| 100-75% | **Pristine** | Clean model, no damage |
| 75-50% | **Scratched** | Scuff marks, small dents, tire smoke increases |
| 50-25% | **Damaged** | Large dents, cracked windows, sparks from scraping |
| 25-1% | **Critical** | Heavy deformation, smoke trail, parts hanging loose |
| 0% | **Destroyed** | Explosion, wheels fly off, chassis becomes burning wreck |

### Wheel Detachment System

**When a vehicle is destroyed (health reaches 0):**

1. **Explosion effect**
   - Particle burst at chassis center
   - Sound effect (explosion audio)
   - Screen shake for nearby players

2. **Wheel separation physics**
   - Each wheel becomes independent Rapier rigid body
   - Apply random angular velocity (spinning through air)
   - Apply outward velocity vector (shoot away from chassis)
   - Wheels bounce/roll realistically via physics
   - Wheels disappear after 5-10 seconds (fade out)

```typescript
interface WheelSeparation {
    wheel: THREE.Mesh;
    rigidBody: RAPIER.RigidBody;

    // Physics properties for dramatic effect
    initialVelocity: Vector3;      // Outward from chassis (randomized)
    initialAngularVelocity: Vector3; // Spin in random direction
    lifetime: number;              // 5-10 seconds before cleanup
}
```

3. **Chassis transformation**
   - Chassis body remains in world as static/kinematic body
   - Fire particle system attached (looping flames)
   - Smoke particle system (dense black smoke)
   - Material changes to "burnt" texture/shader
   - Slight downward deformation (visual collapse)

### Particle Systems Required

- **Smoke trail** (health < 50%): Gray smoke, increases with damage
- **Sparks** (health < 30%): Orange sparks when scraping surfaces
- **Fire** (health = 0): Looping flames on destroyed chassis
- **Explosion burst** (on destruction): One-time large particle burst
- **Debris** (on heavy impacts): Small chunks/shards fly off

## Priority 3: Physics & Control Lockout

### Dead Vehicle Physics State

When `isDestroyed = true`:

1. **Input lockout**
   - All player inputs (throttle, steering, brake) are ignored
   - Vehicle controller stops applying forces to Rapier body
   - Existing momentum continues naturally (coasting)

2. **Physics body transition**
   ```typescript
   // Before destruction
   vehicleBody.setBodyType(RAPIER.RigidBodyType.Dynamic);

   // After destruction
   vehicleBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
   // OR keep Dynamic but apply strong downward force to settle
   ```

3. **Collision properties**
   - Chassis remains collidable (other vehicles can hit wreck)
   - Wheels no longer collide after separation
   - Friction coefficient increases (wreck drags more)

### Respawn System

**Trigger conditions:**
- Player presses designated respawn button (e.g., "R" or touchscreen button)
- Auto-respawn timer (optional, per game mode): 5-10 seconds after destruction

**Respawn sequence:**

1. **Fade out dead vehicle**
   - Burning wreck fades to 0 opacity over 1 second
   - Fire/smoke particles stop emitting
   - Rigid body removed from physics world

2. **Teleport to spawn point**
   - Determine spawn location (track-dependent)
     - Race mode: Last checkpoint or track start
     - Derby mode: Random edge of arena
     - Fight mode: Designated respawn zones
   - Optionally: brief invincibility period (2-3 seconds)

3. **Fade in restored vehicle**
   - Vehicle appears at 100% health
   - All wheels reattached
   - Clean textures/materials restored
   - Spawn effect (portal, flash, particles)

4. **Re-enable controls**
   - `isDestroyed = false`, `isDead = false`
   - Player can drive again

### Respawn Configuration

```typescript
interface RespawnConfig {
    enabled: boolean;              // Some modes may disable respawn
    autoRespawnDelay: number;      // Seconds (0 = manual only)
    invincibilityDuration: number; // Seconds post-respawn
    spawnStrategy: 'checkpoint' | 'arena-edge' | 'spawn-zone';
    spawnEffect: 'portal' | 'flash' | 'teleport';
}
```

## Priority 4: Health Bar UI (Aesthetic)

### Design Requirements

- **Follow vehicle**: Health bar hovers above vehicle at fixed screen offset
- **Always visible**: Positioned so it doesn't clip off-screen
- **Player-colored**: Matches player's car color for identification
- **Style**: Neon/cyberpunk aesthetic matching game theme

### Visual Design

```
┌─────────────────────────────────┐
│ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱           │  Player 1 (Blue neon glow)
└─────────────────────────────────┘
        ↑ Vehicle position
```

**Components:**
- Outer border: Bright neon (player color)
- Fill bar: Solid color (green → yellow → red gradient based on health)
- Background: Semi-transparent dark (0.3 alpha)
- Glow effect: Subtle bloom around border

### Technical Implementation

```typescript
class HealthBarUI {
    vehicle: Vehicle;
    container: THREE.Sprite; // Billboard sprite

    // Updates every frame
    update(camera: THREE.Camera): void {
        // Position above vehicle in world space
        const vehiclePos = this.vehicle.getPosition();
        this.container.position.set(
            vehiclePos.x,
            vehiclePos.y + 2.5, // Offset above car
            vehiclePos.z
        );

        // Always face camera (billboard)
        this.container.lookAt(camera.position);

        // Update fill percentage
        const healthPercent = this.vehicle.health.current / this.vehicle.health.maximum;
        this.updateFillBar(healthPercent);
    }

    updateFillBar(percent: number): void {
        // Adjust UV coordinates or shader uniforms
        // Gradient: green (100%) → yellow (50%) → red (0%)
    }
}
```

### Positioning Strategy

- Use Three.js Sprite or Plane geometry
- Update position in render loop to follow vehicle
- Clamp screen-space position to safe zone (avoid edges)
- Scale based on camera distance (larger when closer)

## Priority 5: Game Mode Integration

### Race Mode
- **Damage enabled**: Yes
- **Health**: 100 (medium durability)
- **Respawn**: Enabled, at last checkpoint
- **Death penalty**: Time lost during respawn sequence

### Derby Mode
- **Damage enabled**: Yes (central mechanic)
- **Health**: 150 (higher durability for longer matches)
- **Respawn**: Disabled (last car standing wins)
- **Death consequence**: Elimination from round

### Fight Mode
- **Damage enabled**: Yes
- **Health**: 100 (balanced for weapon damage)
- **Respawn**: Enabled, at spawn zones
- **Death tracking**: Kill/death stats, respawn counter

## Implementation Phases

### Phase 1: Core Damage System ✅ (Foundation)
- [x] Health data structure
- [x] Collision detection (surface identification)
- [x] Damage calculation with multipliers
- [ ] Basic damage events broadcast to UI

### Phase 2: Visual Destruction 🎨 (Spectacle)
- [ ] Progressive damage textures/materials
- [ ] Particle systems (smoke, sparks, fire)
- [ ] Explosion effect on destruction
- [ ] Wheel detachment physics
- [ ] Burning wreck visual state

### Phase 3: Physics & Controls 🎮 (Gameplay Impact)
- [ ] Input lockout when destroyed
- [ ] Chassis physics transition (dynamic → kinematic)
- [ ] Wheel separation rigid bodies
- [ ] Collision property changes

### Phase 4: Respawn System 🔄 (Player Experience)
- [ ] Respawn trigger (button input)
- [ ] Spawn point determination (per mode)
- [ ] Fade out/in sequence
- [ ] Vehicle restoration (health, wheels, visuals)
- [ ] Invincibility period (optional)

### Phase 5: Health Bar UI 💚 (Feedback)
- [ ] Sprite/billboard creation
- [ ] Camera-facing behavior
- [ ] Follow vehicle position
- [ ] Health percentage visualization
- [ ] Neon styling with player colors
- [ ] Gradient color change (green → red)

## Testing Strategy

### Unit Tests
- Damage calculation logic
- Surface type detection from collision data
- Health state transitions (healthy → destroyed → respawned)
- Respawn cooldown/timer logic

### Integration Tests
- Collision → damage → health reduction flow
- Wheel detachment physics (bodies created correctly)
- Input lockout when `isDestroyed = true`
- Respawn restores vehicle to full health

### E2E Tests
Add to existing `full-game.spec.ts`:
- Verify vehicle takes damage from roof/side collisions
- Verify vehicle does NOT take damage from wheel contact
- Verify destruction triggers explosion effect
- Verify respawn restores vehicle (visual test)
- Verify health bar follows vehicle on screen

## Configuration Files

### Damage Configuration (`assets/damage-config.json`)
```json
{
    "surfaceMultipliers": {
        "roof": 3.0,
        "side": 2.0,
        "front": 1.2,
        "rear": 1.2,
        "wheels": 0.0,
        "bottom": 0.0
    },
    "healthDefaults": {
        "race": 100,
        "derby": 150,
        "fight": 100
    },
    "respawnDefaults": {
        "race": {
            "enabled": true,
            "autoDelay": 3,
            "invincibility": 2,
            "strategy": "checkpoint"
        },
        "derby": {
            "enabled": false
        },
        "fight": {
            "enabled": true,
            "autoDelay": 5,
            "invincibility": 3,
            "strategy": "spawn-zone"
        }
    },
    "wheelSeparation": {
        "velocityRange": [5, 15],
        "angularVelocityRange": [10, 30],
        "lifetime": 8,
        "fadeOutDuration": 2
    }
}
```

## Architecture Changes

### New Modules/Systems

```
static/js/
├── systems/
│   ├── DamageSystem.ts          # Core damage logic
│   ├── DestructionSystem.ts     # Visual destruction & particles
│   └── RespawnSystem.ts         # Respawn mechanics
├── components/
│   ├── HealthComponent.ts       # Health data per vehicle
│   ├── DamageStateComponent.ts  # Visual damage state
│   └── DeadVehicleComponent.ts  # Burning wreck state
└── ui/
    └── HealthBarUI.ts           # Health bar rendering
```

### Event-Driven Communication

```typescript
// EventBus messages
enum DamageEvents {
    DAMAGE_TAKEN = 'damage:taken',
    VEHICLE_DESTROYED = 'damage:destroyed',
    RESPAWN_REQUESTED = 'damage:respawn-requested',
    RESPAWN_COMPLETED = 'damage:respawn-completed',
    HEALTH_CHANGED = 'damage:health-changed'
}

// Example usage
eventBus.emit(DamageEvents.DAMAGE_TAKEN, {
    vehicleId: string,
    damageAmount: number,
    newHealth: number,
    surface: string
});
```

## Performance Considerations

- **Particle pooling**: Reuse particle systems, don't create/destroy every frame
- **Wheel cleanup**: Remove detached wheels after lifetime expires
- **Collision filtering**: Ignore wheel-ground collisions in damage detection
- **Health bar LOD**: Simplify/hide health bars for distant vehicles
- **Texture atlasing**: Damage states use same texture atlas, different UVs

## Future Enhancements (Post-MVP)

- **Localized damage**: Track damage per body part (e.g., damage only left side)
- **Repair pickups**: Health restoration items in fight/race modes
- **Damage modifiers**: Power-ups that increase/decrease damage taken
- **Replay death cam**: Slow-motion replay of destruction moment
- **Destruction combos**: Bonus points for stylish destruction
- **Environmental hazards**: Lava, spikes, crushers that instant-kill

## References

- [Rapier Collision Events](https://rapier.rs/javascript3d/classes/World.html#contactPair)
- [Three.js Sprite Billboards](https://threejs.org/docs/#api/en/objects/Sprite)
- [Particle System Examples](https://threejs.org/examples/?q=particle)
- [VISUAL_EFFECTS_SPEC.md](./VISUAL_EFFECTS_SPEC.md) - Particle systems detail
- [PROJECT_DIRECTION_SPEC.md](./PROJECT_DIRECTION_SPEC.md) - Destruction as Priority 1

---

**Note:** This is a living document. Update as implementation progresses and new requirements emerge.
