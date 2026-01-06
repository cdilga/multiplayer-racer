# Color Scheme: Sunset Neon

A warm, vibrant color palette that breaks from the typical teal/purple cyberpunk cliché. This scheme uses sunset-inspired colors with neon accents.

## Color Palette

### Primary Colors
- **Neon Coral**: `#FF6B6B` (rgb(255, 107, 107)) - Primary accent, buttons, highlights
- **Electric Gold**: `#FFD93D` (rgb(255, 217, 61)) - Secondary accent, success states
- **Deep Amber**: `#FF8800` (rgb(255, 136, 0)) - Tertiary accent, warnings

### Background Colors
- **Midnight**: `#1a0f0a` (rgb(26, 15, 10)) - Main background (dark brown-black)
- **Charcoal**: `#2a1510` (rgb(42, 21, 16)) - Secondary background (warmer dark)
- **Ember**: `#3a2015` (rgb(58, 32, 21)) - Panel backgrounds (brown-tinted)

### Atmospheric Colors
- **Sky Base**: `#0f0a1a` (rgb(15, 10, 26)) - Deep indigo for sky dome base
- **Horizon Glow**: `#4a2510` (rgb(74, 37, 16)) - Warm horizon with orange tint
- **Sunset Peak**: `#6a3015` (rgb(106, 48, 21)) - Burnt orange for sky dome top

### Lighting Colors
- **Warm Amber Light**: `#ffaa44` (rgb(255, 170, 68)) - Ambient lighting
- **Golden Sun**: `#ffcc66` (rgb(255, 204, 102)) - Directional light
- **Neon Highlight**: `#ff6b6b` (rgb(255, 107, 107)) - Vehicle lights, accents

### UI Text Colors
- **Bright Text**: `#ffffff` - Primary text
- **Muted Text**: `#c9a887` - Secondary text (warm beige)
- **Subtle Text**: `#8a6f5a` - Tertiary text (muted brown)

## Application

### RenderSystem.js
```javascript
// Background and fog
scene.background = new THREE.Color(0x1a0f0a);  // Midnight
scene.fog = new THREE.FogExp2(0x1a0f0a, 0.008);

// Lighting
ambient = new THREE.AmbientLight(0xffaa44, 0.3);  // Warm Amber Light
directional = new THREE.DirectionalLight(0xffcc66, 0.5);  // Golden Sun

// Sky dome gradient
topColor: 0x6a3015,    // Sunset Peak
bottomColor: 0x0f0a1a, // Sky Base
horizonColor: 0x4a2510 // Horizon Glow
```

### LobbyUI.js
```css
--midnight: #1a0f0a;
--charcoal: #2a1510;
--ember: #3a2015;
--neon-coral: #FF6B6B;
--electric-gold: #FFD93D;
--deep-amber: #FF8800;
--bright-text: #ffffff;
--muted-text: #c9a887;
--subtle-text: #8a6f5a;
```

## Reasoning

### Why This Palette Works

1. **Distinctive**: Warm sunset colors stand out from typical cold cyberpunk aesthetics
2. **High Contrast**: Neon coral/gold on dark backgrounds ensures readability
3. **Cohesive**: All colors share warm undertones, creating visual harmony
4. **Energetic**: Warm colors evoke speed, excitement, and competition
5. **Accessible**: Good contrast ratios for text legibility

### Avoided Clichés

- ❌ Teal/Cyan (#00ffff, #00d4ff)
- ❌ Purple/Magenta (#aa00ff, #ff00ff)
- ❌ Electric Blue (#0088ff, #4444ff)
- ✅ Warm oranges, reds, and golds instead

### Inspiration

- Sunset racing games (OutRun, Horizon Chase)
- Warm neon signs (amber, coral, gold)
- Desert heat and fire imagery
- Retro arcade cabinets with warm CRT glow

## Future Variations

Consider these alternative warm palettes:

### "Molten Metal"
- Primary: `#FF4500` (Orange Red)
- Secondary: `#FFD700` (Gold)
- Background: `#1a1410` (Charcoal)

### "Neon Sunset"
- Primary: `#FF1493` (Hot Pink)
- Secondary: `#FFA500` (Orange)
- Background: `#0a0a1a` (Dark Indigo)

### "Desert Heat"
- Primary: `#FF6347` (Tomato)
- Secondary: `#F4A460` (Sandy Brown)
- Background: `#2f1a10` (Dark Sienna)
