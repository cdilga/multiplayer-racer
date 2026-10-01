"""glb_check.py — inspect a GLB baked from the code-built car against the draft vehicle contract (§12.4 / validate_vehicle.py).
Usage: python3 glb_check.py out/cruze_lod0.glb"""
import json, struct, sys
def load(path):
    d = open(path, 'rb').read(); magic, ver, ln = struct.unpack_from('<4sII', d, 0); assert magic == b'glTF'
    clen, ctype = struct.unpack_from('<I4s', d, 12); return json.loads(d[20:20 + clen]), ln
g, size = load(sys.argv[1]); nodes = {n.get('name'): n for n in g['nodes']}
def tris():
    t = 0
    for m in g.get('meshes', []):
        for p in m['primitives']:
            if 'indices' in p: t += g['accessors'][p['indices']]['count'] // 3
    return t
ident = lambda n: n.get('translation') or (n['matrix'][12:15] if 'matrix' in n else [0, 0, 0])
REQ_CONTRACT = ['chassis', 'bonnet', 'boot', 'door_L', 'door_R', 'bumper_front', 'bumper_rear', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', 'glass']
MARKERS = ['lplate_front', 'lplate_rear', 'cam_fp', 'com', 'roof_number', 'cam_tp_target', 'exhaust_0']
print(f"file {sys.argv[1]}  {size/1024:.0f} KB  nodes {len(g['nodes'])}  meshes {len(g.get('meshes', []))}  materials {len(g.get('materials', []))}  images {len(g.get('images', []))}  tris {tris():,}")
print('\ncontract names (validate_vehicle.py REQUIRED_PARTS):')
for n in REQ_CONTRACT: print(f"  {'OK ' if n in nodes else 'MISSING'} {n}")
print('  -> our naming: door_FR/FL/RR/RL (4 doors) instead of door_L/R; glass split into glass_front/glass_rear (+ per-door windows)')
print('\nmarkers:')
for n in MARKERS: print(f"  {'OK ' if n in nodes else 'MISSING'} {n}")
print('\npivots (translation must be off-origin for hinged/hub parts):')
for n in sorted(nodes):
    if n and ':' not in n and n.split('_')[0] in ('door', 'bonnet', 'boot', 'wheel', 'mirror', 'headlamp', 'taillamp', 'bumper', 'spoiler'):
        t = ident(nodes[n]); print(f"  {n:14s} {['%.2f' % v for v in t]}  {'ok' if max(abs(v) for v in t) > 0.3 else 'AT ORIGIN'}")
print('\nmaterials:', sorted({m.get('name') for m in g.get('materials', [])}))
print('morph targets present:', any(p.get('targets') for m in g.get('meshes', []) for p in m['primitives']), '(dents are CPU vertex edits at runtime, no authored morphs)')
print('colour attribute (COLOR_0) on all primitives:', all('COLOR_0' in p['attributes'] for m in g.get('meshes', []) for p in m['primitives']))
