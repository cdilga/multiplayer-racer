// Every TV mock state, opened by URL fragment (#<state>). Shared by the page and capture.mjs.
export const STATES = {
  'Grid': ['grid-player', 'grid&n=1', 'grid&n=2', 'grid&n=3', 'grid&n=5', 'grid&n=7', 'grid&n=10', 'grid&n=13', 'grid&n=24', 'grid&n=25', 'grid&n=26', 'grid&n=27', 'grid&n=32', 'grid&n=40', 'grid&n=64', 'grid&n=99', 'grid&n=8&fp=2,5,7'],
  'Per-tile HUD': ['hud&n=8', 'hud&n=32&base=100', 'countdown&n=8', 'identify&n=8&seat=3', 'identify&n=32&seat=12'],
  'Lobby': ['lobby&n=2', 'lobby&n=8', 'lobby&n=16', 'lobby&n=32', 'lobby&n=48', 'lobby&n=140'],
  'Results and intermission': ['results&n=8', 'results&n=32'],
  'Host controls': ['host&n=8', 'host-end&n=8', 'input-drawer&n=8', 'diagnostics&n=8', 'paused&n=8'],
  'Captions': ['captions&n=8&kind=global', 'captions&n=8&kind=player', 'captions&n=3&kind=filler'],
  'Over-3D overlays': ['overlays&n=8'],
  'Derby Overview (design reference, Full)': ['overview&n=8', 'overview&n=16', 'overview&n=32'],
};
