# Derby Mode Spec

**Status:** Design Complete - Ready for Implementation

## Overview

Derby Mode is a vehicular combat arena where the **last car standing wins**. Players battle in a circular bowl arena with shrinking walls, collecting weapons to destroy opponents.

## Lobby Mode Selection

### Layout
Large side-by-side cards for mode selection, with room to add future modes (Hill Climber, etc).

```
┌─────────────────────────────────────────────────────────────────┐
│                        SELECT MODE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────┐     ┌─────────────────────┐           │
│   │ ▶ [RACE VIDEO]      │     │ ▶ [DERBY VIDEO]     │           │
│   │                     │     │                     │           │
│   │  🏁 RACE            │     │  💥 DERBY           │           │
│   │                     │     │                     │
│   │  "First across      │     │  "Last car          │           │
│   │   the line wins"    │     │   standing wins"    │           │
│   │                     │     │                     │           │
│   │  ───────────────    │     │  ───────────────    │           │
│   │  3 laps • Oval      │     │  Best of 3 • Arena  │           │
│   └─────────────────────┘     └─────────────────────┘           │
│         [SELECTED]                                               │
│                                                                  │
│                    [ START GAME ]                                │
└─────────────────────────────────────────────────────────────────┘
```

### Mode Cards

Each card displays:
1. **Animated preview** - Looping video/GIF of gameplay (~5-10 seconds)
2. **Mode icon** - Distinctive icon (🏁 race flag, 💥 explosion)
3. **Mode name** - Large, bold text
4. **Tagline** - One-line description of win condition
5. **Details** - Format info (laps, rounds, arena type)

### Color Scheme (Mode-Specific)

| Mode | Primary Color | Accent | Glow Effect |
|------|---------------|--------|-------------|
| Race | `#44FF88` (Neon Green) | `#88FFAA` | Green pulse |
| Derby | `#FF4444` (Neon Red) | `#FF8844` (Orange) | Red/orange fire |
| Hill Climber (future) | `#44AAFF` (Neon Blue) | `#88CCFF` | Blue shimmer |

### Card States

```css
/* Unselected */
.mode-card {
  opacity: 0.7;
  transform: scale(0.95);
  border: 2px solid rgba(255,255,255,0.2);
}

/* Hover */
.mode-card:hover {
  opacity: 0.9;
  transform: scale(0.98);
  border-color: var(--mode-color);
  box-shadow: 0 0 20px var(--mode-color);
}

/* Selected */
.mode-card.selected {
  opacity: 1;
  transform: scale(1);
  border: 3px solid var(--mode-color);
  box-shadow: 0 0 40px var(--mode-color),
              inset 0 0 20px rgba(var(--mode-color), 0.1);
}
```

### Preview Videos

| Mode | Video Content | Duration | Loop |
|------|---------------|----------|------|
| Race | Cars racing on oval, crossing finish line | 8 sec | Yes |
| Derby | Cars colliding in bowl, explosions, weapon fire | 8 sec | Yes |

**Video specs:**
- Resolution: 480x270 (16:9, optimized for cards)
- Format: WebM (with MP4 fallback)
- File size: < 2MB each
- Autoplay: Muted, loops continuously

### Interaction

1. **Click card** → Selects mode, highlights card, enables Start button
2. **Hover card** → Subtle glow, slight scale up
3. **Start button** → Only enabled when mode selected and 2+ players joined

### Mobile Controller View

Players on mobile don't select mode - host does. Controller shows:
```
┌─────────────────────────────────────┐
│                                     │
│     Waiting for host to start...   │
│                                     │
│     Mode: 💥 DERBY                  │
│     Players: 4/16                   │
│                                     │
└─────────────────────────────────────┘
```

### Asset Requirements

**Videos to create:**
- [ ] `assets/videos/race-preview.webm` - Race mode gameplay loop
- [ ] `assets/videos/derby-preview.webm` - Derby mode gameplay loop
- [ ] MP4 fallbacks for Safari compatibility

**Icons:**
- [ ] Race mode icon (flag/checkered pattern)
- [ ] Derby mode icon (explosion/crash)

## Game Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   LOBBY     │────▶│   ROUND 1   │────▶│  ROUND END  │
│ Mode select │     │  Combat     │     │  Scores     │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
      ┌────────────────────────────────────────┘
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   ROUND 2   │────▶│  ROUND END  │────▶│   ROUND 3   │ (if needed)
│  Combat     │     │  Scores     │     │  Combat     │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
      ┌────────────────────────────────────────┘
      ▼
┌─────────────┐
│ MATCH END   │
│ Winner!     │
└─────────────┘
```

### Match Format
- **Best of 3 rounds** - First to 2 round wins takes the match
- **Round win condition** - Last car standing (all others eliminated)
- **Late join** - Players can only join between rounds, not mid-round

### Round Phases
1. **Countdown** (3 seconds) - Players spawn, weapons don't spawn yet
2. **Combat** (until 1 survivor) - Full combat, weapons spawn, walls shrink
3. **Victory** (3 seconds) - Winner celebration, scores update

## Arena Design

### Circular Bowl
```
        ════════════════════
      ╱                      ╲
    ╱    ╭──────────────╮     ╲
   ║    │                │     ║
   ║    │    PLAY AREA   │     ║    ← Sloped walls push
   ║    │                │     ║      cars toward center
    ╲    ╰──────────────╯     ╱
      ╲                      ╱
        ════════════════════
              FLOOR
```

### Specifications
- **Diameter:** 80 units (shrinks to 40 units minimum)
- **Wall height:** 15 units (cars can't escape)
- **Wall slope:** 30° inward (pushes cars back to center)
- **Floor:** Slightly concave (subtle bowl shape)

### Shrinking Mechanic
- **Starts shrinking:** 30 seconds into round
- **Shrink rate:** 0.5 units/second (gradual pressure)
- **Minimum size:** 40 units diameter (intense final fights)
- **Visual warning:** Red glow on walls when shrinking
- **Physics:** Walls physically move inward, pushing cars

### Spawn Points
- 16 spawn points evenly distributed around the bowl edge
- Players spawn facing center
- Spawn points deactivate as walls shrink past them

## Weapon System

### Available Weapons
| Weapon | Description | Damage | Special |
|--------|-------------|--------|---------|
| **Missile** | Lock-on projectile | 35% | Tracks nearest enemy |
| **Mine** | Drops behind car | 40% | Stays until triggered |
| **Oil Slick** | Drops slippery zone | 0% | Reduces friction, causes spinouts |
| **Sniper** | Instant hit beam | 50% | Rare, single shot, long cooldown |
| **Shield** | Temporary invulnerability | 0% | 5 seconds duration |
| **Boost** | Speed burst | 0% | Ram damage +25% while boosting |
| **EMP** | Disables nearby cars | 0% | 3 second stun, area effect |
| **Flamethrower** | Cone of fire | 5%/sec | Continuous damage, short range |

### Weapon Spawns
- **Spawn method:** Random drops from above (visible falling animation)
- **Spawn frequency:** Every 8-12 seconds (random)
- **Spawn locations:** Random within play area (not on walls)
- **Spawn count:** 1-2 weapons at a time
- **Visual:** Glowing rotating pickup with weapon icon

### Weapon Rarity
```
Common (70%):    Missile, Mine, Oil Slick, Boost
Uncommon (25%):  Shield, EMP, Flamethrower
Rare (5%):       Sniper
```

### Inventory
- **Slots:** 1 weapon at a time
- **Pickup behavior:** New weapon replaces current (no discarding)
- **Ammo:** Single use (most weapons), 3 seconds duration (flamethrower/shield)

## Controller UI (Mobile)

### Derby Controller Layout
```
┌─────────────────────────────────────┐
│                                     │
│   ┌─────────┐         ┌─────────┐   │
│   │         │         │  ACCEL  │   │
│   │ JOYSTICK│         │    ▲    │   │
│   │    ◉    │         │  BRAKE  │   │
│   └─────────┘         └─────────┘   │
│                                     │
│          [MISSILE 🚀]               │
│             ╱╲                      │
│            ╱  ╲                     │
│           ╱FIRE╲                    │
│          ╱──────╲                   │
│                                     │
└─────────────────────────────────────┘
```

### Controls
- **Joystick (left):** Steering (same as race mode)
- **Accel/Brake (right):** Throttle and brake (same as race mode)
- **Fire button (center bottom):** Triangle-shaped, fires current weapon
- **Weapon indicator:** Shows current held weapon above fire button

### Eliminated State
```
┌─────────────────────────────────────┐
│                                     │
│           💥 ELIMINATED 💥          │
│                                     │
│        Waiting for next round...    │
│                                     │
│           [2 players left]          │
│                                     │
└─────────────────────────────────────┘
```

## Scoring & Results

### Round Scoring
| Placement | Points |
|-----------|--------|
| 1st (Winner) | 10 |
| 2nd | 6 |
| 3rd | 4 |
| 4th | 3 |
| 5th | 2 |
| 6th+ | 1 |

### Match Victory
- First to **2 round wins** wins the match
- Tiebreaker: Total points across rounds

### Results Screen
- Shows round winner with celebration
- Running score tally
- "Next Round" countdown (5 seconds)
- After match: Full results with final standings

## Technical Implementation

### New Systems Required

1. **DerbySystem** - Manages derby-specific game logic
   - Round state machine
   - Elimination tracking
   - Wall shrinking logic
   - Victory detection

2. **WeaponSystem** - Handles all weapon mechanics
   - Weapon spawning
   - Pickup detection
   - Weapon firing
   - Projectile physics (missiles)
   - Effect zones (oil, EMP)

3. **DerbyArena** - Arena generation and management
   - Bowl geometry generation
   - Dynamic wall colliders (for shrinking)
   - Spawn point management

4. **DerbyUI** - Derby-specific UI elements
   - Weapon indicator on controller
   - Fire button
   - Eliminated state
   - Round/score display on host

### Events
```javascript
// Derby lifecycle
'derby:round-start'      // Round begins
'derby:round-end'        // Round ends, winner determined
'derby:match-end'        // Match complete
'derby:player-eliminated' // Player destroyed
'derby:walls-shrinking'  // Walls start closing in

// Weapons
'weapon:spawned'         // New weapon appears
'weapon:pickup'          // Player collected weapon
'weapon:fired'           // Player used weapon
'weapon:hit'             // Weapon hit target
```

### State Machine
```
LOBBY ──▶ COUNTDOWN ──▶ COMBAT ──▶ ROUND_END ──▶ COUNTDOWN (repeat)
                                        │
                                        ▼
                                   MATCH_END ──▶ LOBBY
```

## Asset Requirements

### 3D Models
- Bowl arena mesh (or generate procedurally)
- Weapon pickup models (8 types)
- Projectile models (missile, mine, oil patch)
- Explosion/effect particles

### Audio
- Weapon fire sounds (8 types)
- Explosion sounds
- Pickup sound
- Wall shrinking rumble
- Victory fanfare
- Elimination sound

### UI Assets
- Weapon icons (8 types)
- Fire button graphic
- Eliminated overlay
- Round indicator

## Configuration (Data-Driven)

All weapons and arenas are defined as JSON assets - no hardcoding. This enables:
- Easy balancing without code changes
- Modding support
- Hot-reloading during development

### Directory Structure
```
assets/
├── arenas/
│   └── derby-bowl.json      # Arena definition
├── weapons/
│   ├── missile.json         # Each weapon is its own file
│   ├── mine.json
│   ├── oil-slick.json
│   ├── sniper.json
│   ├── shield.json
│   ├── boost.json
│   ├── emp.json
│   └── flamethrower.json
└── models/
    ├── weapons/
    │   ├── missile.glb      # 3D model for pickup/projectile
    │   ├── mine.glb
    │   └── ...
    └── arenas/
        └── derby-bowl.glb   # Optional custom arena mesh
```

### Arena Config (`assets/arenas/derby-bowl.json`)
```json
{
  "id": "derby-bowl",
  "name": "The Pit",
  "type": "derby",
  "geometry": {
    "shape": "bowl",
    "diameter": 80,
    "minDiameter": 40,
    "wallHeight": 15,
    "wallSlope": 30,
    "floorConcavity": 0.1,
    "model": null
  },
  "shrinking": {
    "enabled": true,
    "startTime": 30,
    "rate": 0.5,
    "warningColor": "#FF4444"
  },
  "spawns": {
    "count": 16,
    "distribution": "circular",
    "faceCenter": true,
    "heightOffset": 0.5
  },
  "weapons": {
    "enabled": true,
    "spawnInterval": [8, 12],
    "maxActive": 3,
    "spawnHeight": 10
  },
  "lighting": {
    "ambient": "#FF4444",
    "ambientIntensity": 0.3,
    "fog": {
      "color": "#1a0808",
      "density": 0.01
    }
  },
  "music": "derby-battle.mp3"
}
```

### Weapon Config (`assets/weapons/missile.json`)
```json
{
  "id": "missile",
  "name": "Homing Missile",
  "icon": "🚀",
  "rarity": "common",
  "model": "models/weapons/missile.glb",
  "pickupScale": 1.5,
  "pickupRotationSpeed": 2,

  "behavior": {
    "type": "projectile",
    "speed": 50,
    "lifetime": 5,
    "tracking": {
      "enabled": true,
      "turnRate": 3,
      "lockRange": 30,
      "lockAngle": 45
    }
  },

  "damage": {
    "amount": 35,
    "radius": 0,
    "knockback": 15
  },

  "effects": {
    "trail": {
      "type": "smoke",
      "color": "#FFAA44",
      "size": 0.3
    },
    "explosion": {
      "particles": "explosion-fire",
      "scale": 2,
      "sound": "missile-explode.mp3"
    },
    "fire": {
      "sound": "missile-launch.mp3",
      "cameraShake": 0.1
    }
  },

  "ui": {
    "color": "#FF6B6B",
    "description": "Tracks nearest enemy"
  }
}
```

### Weapon Config (`assets/weapons/mine.json`)
```json
{
  "id": "mine",
  "name": "Proximity Mine",
  "icon": "💣",
  "rarity": "common",
  "model": "models/weapons/mine.glb",

  "behavior": {
    "type": "deployable",
    "deployBehind": true,
    "deployOffset": -2,
    "lifetime": 60,
    "triggerRadius": 3,
    "armDelay": 1
  },

  "damage": {
    "amount": 40,
    "radius": 5,
    "knockback": 25
  },

  "effects": {
    "idle": {
      "type": "pulse",
      "color": "#FF0000",
      "rate": 1
    },
    "explosion": {
      "particles": "explosion-large",
      "scale": 3,
      "sound": "mine-explode.mp3"
    }
  }
}
```

### Weapon Config (`assets/weapons/oil-slick.json`)
```json
{
  "id": "oil-slick",
  "name": "Oil Slick",
  "icon": "🛢️",
  "rarity": "common",
  "model": "models/weapons/oil-barrel.glb",

  "behavior": {
    "type": "zone",
    "deployBehind": true,
    "zoneRadius": 6,
    "lifetime": 15
  },

  "damage": {
    "amount": 0
  },

  "effects": {
    "zone": {
      "texture": "oil-puddle.png",
      "frictionMultiplier": 0.1
    }
  }
}
```

### Weapon Config (`assets/weapons/sniper.json`)
```json
{
  "id": "sniper",
  "name": "Rail Gun",
  "icon": "⚡",
  "rarity": "rare",
  "model": "models/weapons/railgun.glb",

  "behavior": {
    "type": "hitscan",
    "range": 100,
    "chargeTime": 0.5
  },

  "damage": {
    "amount": 50,
    "knockback": 30
  },

  "effects": {
    "beam": {
      "color": "#00FFFF",
      "width": 0.3,
      "duration": 0.2
    },
    "fire": {
      "sound": "railgun-fire.mp3",
      "cameraShake": 0.3
    }
  }
}
```

### Weapon Config (`assets/weapons/shield.json`)
```json
{
  "id": "shield",
  "name": "Energy Shield",
  "icon": "🛡️",
  "rarity": "uncommon",
  "model": "models/weapons/shield-pickup.glb",

  "behavior": {
    "type": "buff",
    "duration": 5,
    "invulnerable": true
  },

  "effects": {
    "active": {
      "type": "sphere",
      "color": "#44FFFF",
      "opacity": 0.3,
      "pulse": true
    },
    "activate": {
      "sound": "shield-up.mp3"
    },
    "deactivate": {
      "sound": "shield-down.mp3"
    }
  }
}
```

### Weapon Config (`assets/weapons/boost.json`)
```json
{
  "id": "boost",
  "name": "Nitro Boost",
  "icon": "🔥",
  "rarity": "common",
  "model": "models/weapons/nitro-canister.glb",

  "behavior": {
    "type": "buff",
    "duration": 3,
    "speedMultiplier": 2,
    "ramDamageBonus": 25
  },

  "effects": {
    "active": {
      "type": "flames",
      "color": "#FF4400",
      "emitFrom": "exhaust"
    },
    "activate": {
      "sound": "boost-ignite.mp3",
      "cameraShake": 0.15
    }
  }
}
```

### Weapon Config (`assets/weapons/emp.json`)
```json
{
  "id": "emp",
  "name": "EMP Blast",
  "icon": "⚡",
  "rarity": "uncommon",
  "model": "models/weapons/emp-device.glb",

  "behavior": {
    "type": "aoe",
    "radius": 15,
    "stunDuration": 3
  },

  "damage": {
    "amount": 0
  },

  "effects": {
    "blast": {
      "type": "shockwave",
      "color": "#4444FF",
      "expandSpeed": 30
    },
    "stunned": {
      "type": "sparks",
      "color": "#4444FF"
    },
    "fire": {
      "sound": "emp-pulse.mp3",
      "cameraShake": 0.2
    }
  }
}
```

### Weapon Config (`assets/weapons/flamethrower.json`)
```json
{
  "id": "flamethrower",
  "name": "Flamethrower",
  "icon": "🔥",
  "rarity": "uncommon",
  "model": "models/weapons/flamethrower.glb",

  "behavior": {
    "type": "continuous",
    "duration": 3,
    "coneAngle": 30,
    "range": 8,
    "tickRate": 0.1
  },

  "damage": {
    "amount": 5,
    "perTick": true
  },

  "effects": {
    "stream": {
      "type": "fire-particles",
      "color": ["#FF4400", "#FFAA00"],
      "density": 50
    },
    "fire": {
      "sound": "flamethrower-loop.mp3",
      "loop": true
    }
  }
}
```

### Weapon Rarity Distribution (`assets/weapons/rarity.json`)
```json
{
  "common": {
    "weight": 70,
    "weapons": ["missile", "mine", "oil-slick", "boost"]
  },
  "uncommon": {
    "weight": 25,
    "weapons": ["shield", "emp", "flamethrower"]
  },
  "rare": {
    "weight": 5,
    "weapons": ["sniper"]
  }
}
```

## Implementation Phases

### Phase 0: Mode Selection UI ✅ COMPLETE
- [x] Mode selector cards in lobby
- [x] Card hover/select states with mode-specific colors
- [ ] Video preview integration (placeholder images initially)
- [x] Mode state passed to game engine on start
- [x] Mobile controller shows selected mode

### Phase 1: Core Derby (MVP) ✅ COMPLETE
- [x] DerbySystem with round state machine
- [x] Bowl arena with static walls
- [x] Elimination detection
- [x] Basic scoring
- [x] Controller fire button (no weapon yet - just ram mode)

### Phase 2: Weapons ✅ COMPLETE
- [x] WeaponSystem foundation
- [x] Weapon spawning (random positions, rarity-based selection)
- [x] 3 starter weapons: Missile, Mine, Boost
- [x] Weapon pickup and firing
- [x] Fire button on mobile controller for derby mode
- [x] Network events for weapon pickup/fired

### Phase 3: Full Arsenal
- [ ] Remaining weapons: Oil, Sniper, Shield, EMP, Flamethrower
- [ ] Weapon balancing
- [ ] Visual effects for all weapons

### Phase 4: Shrinking Arena
- [ ] Dynamic wall colliders
- [ ] Shrink timing logic
- [ ] Visual warning effects
- [ ] Spawn point deactivation

### Phase 5: Polish
- [ ] Sound effects
- [ ] Particle effects
- [ ] Results screen
- [ ] Multiple arena variants

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Weapons in MVP? | Yes, full arsenal |
| Round format? | Best of 3 |
| Late join timing? | Between rounds only |
| Arena shape? | Circular bowl |
| Shrinking? | Yes, walls close in |
| Fire control? | Dedicated button |
| Inventory size? | 1 weapon |

---

**Note:** This spec focuses on Derby as a standalone mode. The "Fight Mode" mentioned in PROJECT_DIRECTION_SPEC is effectively merged into this design.
