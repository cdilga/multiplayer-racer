"""Model a Cruze-inspired car from measured reference profiles, in the LIVE Blender (via MCP execute_code).

python3 bmcp.py model_cruze_from_refs.py
Builds two variants from out/profiles.json: CRUZE_REF (measured proportions) and CRUZE_CHUNKY (game style:
bigger wheels, shorter overhangs, taller stance), each split into contract parts with dent shape keys.
"""
import bpy, bmesh, json, math, os
from mathutils import Vector

ROOT = "/Users/cdilga/Documents/dev/multiplayer-racer/spikes/art-pipeline"
P = json.load(open(os.path.join(ROOT, "out", "profiles.json")))
L = P["length"]; prof = P["profile"]; WX = P["wheel_x"]; WR = P["wheel_radius"]

# fresh scene (keep camera/light defaults out of the way)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

def material(name, rgba, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba; b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = emit; b.inputs["Emission Strength"].default_value = 3
    return m

MAT = {"paint": material("jj_paint", (0.95, 0.55, 0.05, 1), 0.3), "glass": material("jj_glass", (0.12, 0.2, 0.26, 1), 0.05),
       "plastic": material("jj_plastic", (0.05, 0.05, 0.06, 1), 0.7), "tyre": material("jj_tyre", (0.02, 0.02, 0.02, 1), 0.9),
       "wheel": material("jj_wheel", (0.7, 0.7, 0.72, 1), 0.25, 1.0),
       "headlight": material("jj_headlight", (1, 1, 0.9, 1), 0.1, emit=(1, 0.95, 0.8, 1)),
       "brakelight": material("jj_brakelight", (0.8, 0.05, 0.05, 1), 0.2, emit=(1, 0.05, 0.02, 1))}

def par(child, parent):
    bpy.context.view_layer.update()  # new objects' matrix_world is stale until updated
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()

def lerp_profile(x):
    xs = [p["x"] for p in prof]
    for i in range(len(prof) - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / max(xs[i + 1] - xs[i], 1e-6)
            a, b = prof[i], prof[i + 1]
            belt = a["belt"] if a["belt"] is not None else b["belt"]
            if a["belt"] is not None and b["belt"] is not None:
                belt = a["belt"] + (b["belt"] - a["belt"]) * t
            return {k: a[k] + (b[k] - a[k]) * t for k in ("top", "bottom", "halfwidth")} | {"belt": belt}
    return prof[-1]

def build(name, chunky):
    # Stylisation (vibe, not a replica): compress overhangs, lift stance, fatten wheels.
    wheel_scale = 1.4 if chunky else 1.0
    over = 0.72 if chunky else 1.0
    lift = 0.12 if chunky else 0.0
    height_scale = 1.08 if chunky else 1.0
    wf, wr = WX
    def xmap(x):  # longitudinal remap: overhangs compressed
        if x < wf: return wf - (wf - x) * over
        if x > wr: return wr + (x - wr) * over
        return x
    new_len = xmap(L) - xmap(0)
    S, M = len(prof) * 2, 36  # slices, ring verts
    bm = bmesh.new(); rings = []
    for i in range(S + 1):
        x = L * i / S; p = lerp_profile(x)
        zt, zb, w = p["top"] * height_scale + lift, p["bottom"] + lift, max(p["halfwidth"], 0.05)
        belt = (p["belt"] * height_scale + lift) if p["belt"] is not None else None
        zc, hz = (zt + zb) / 2, max((zt - zb) / 2, 0.02)
        y = new_len / 2 - (xmap(x) - xmap(0))  # +Y forward
        ring = []
        for j in range(M):
            th = 2 * math.pi * j / M
            c, s = math.cos(th), math.sin(th)
            n = 5.0
            z = zc + hz * math.copysign(abs(s) ** (2 / n), s)
            ww = w
            if belt is not None and z > belt:  # greenhouse tumblehome
                ww = w * (1 - 0.3 * (z - belt) / max(zt - belt, 0.05))
            xx = ww * math.copysign(abs(c) ** (2 / n), c)
            ring.append(bm.verts.new((xx, y, z)))
        rings.append(ring)
    for i in range(S):
        for j in range(M):
            a, b = rings[i][j], rings[i][(j + 1) % M]
            c2, d = rings[i + 1][(j + 1) % M], rings[i + 1][j]
            bm.faces.new((a, b, c2, d))
    for ring in (rings[0], rings[-1]):  # cap ends
        f = bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # --- classify faces into contract parts (data API only: MCP-safe, no UI operators)
    parts = ["chassis", "bumper_front", "bumper_rear", "bonnet", "boot", "door_L", "door_R", "glass"]
    ys_front, ys_rear = new_len / 2, -new_len / 2
    glass_x = [p["x"] for p in prof if p["belt"] is not None]
    gy0 = new_len / 2 - (xmap(min(glass_x)) - xmap(0)); gy1 = new_len / 2 - (xmap(max(glass_x)) - xmap(0))
    beltz = min(p["belt"] for p in prof if p["belt"] is not None) * height_scale + lift
    for f in bm.faces:
        c, nrm = f.calc_center_median(), f.normal
        idx = 0
        if c.y > ys_front - 0.32 and c.z < beltz - 0.15: idx = 1
        elif c.y < ys_rear + 0.3 and c.z < beltz - 0.1: idx = 2
        elif gy1 < c.y < gy0 and c.z > beltz and abs(nrm.z) < 0.85: idx = 7
        elif c.y >= gy0 and nrm.z > 0.55: idx = 3
        elif c.y <= gy1 and nrm.z > 0.55: idx = 4
        elif gy1 + 0.25 < c.y < gy0 - 0.1 and abs(nrm.x) > 0.6 and 0.35 + lift < c.z < beltz:
            idx = 5 if c.x < 0 else 6
        f.material_index = idx
    made = {}
    for k, pn in enumerate(parts):
        b2 = bm.copy()
        bmesh.ops.delete(b2, geom=[f for f in b2.faces if f.material_index != k], context="FACES")
        bmesh.ops.delete(b2, geom=[v for v in b2.verts if not v.link_faces], context="VERTS")
        if not b2.faces:
            b2.free(); continue
        lo = Vector((min(v.co.x for v in b2.verts), min(v.co.y for v in b2.verts), min(v.co.z for v in b2.verts)))
        hi = Vector((max(v.co.x for v in b2.verts), max(v.co.y for v in b2.verts), max(v.co.z for v in b2.verts)))
        ctr = (lo + hi) / 2
        for v in b2.verts: v.co -= ctr
        for f in b2.faces: f.material_index = 0; f.smooth = True
        me = bpy.data.meshes.new(f"{name}_{pn}"); b2.to_mesh(me); b2.free()
        me.materials.append(MAT["glass"] if pn == "glass" else MAT["plastic"] if pn.startswith("bumper") else MAT["paint"])
        o = bpy.data.objects.new(f"{name}_{pn}", me); o.location = ctr
        bpy.context.scene.collection.objects.link(o)
        made[pn] = o
    bm.free()
    chassis = made["chassis"]
    for k, o in made.items():
        if o is not chassis:
            par(o, chassis)
        if k != "glass":  # R68 dent key, off by default
            o.shape_key_add(name="Basis"); key = o.shape_key_add(name=f"{k}_dent"); key.value = 0.0
            out = (o.location - Vector((0, 0, 0.7 + lift)))
            out = out.normalized() if out.length > 0.2 else Vector((0, 1, 0))
            imp = max((v.co.copy() for v in o.data.vertices), key=lambda v: v.dot(out))
            rad = max(o.dimensions) * 0.35
            for vi, v in enumerate(o.data.vertices):
                d = (v.co - imp).length
                if d < rad: key.data[vi].co = v.co - out * 0.2 * (1 - d / rad) ** 1.5

    def prim(nm, kind, loc, mat, parent, **kw):
        b3 = bmesh.new()
        if kind == "cyl":
            bmesh.ops.create_cone(b3, cap_ends=True, cap_tris=False, segments=kw["seg"], radius1=kw["r"], radius2=kw["r"], depth=kw["d"])
            bmesh.ops.rotate(b3, verts=b3.verts, cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "Y"))
        else:
            bmesh.ops.create_cube(b3, size=1.0)
            bmesh.ops.scale(b3, vec=kw["s"], verts=b3.verts)
        me = bpy.data.meshes.new(nm); b3.to_mesh(me); b3.free(); me.materials.append(mat)
        ob = bpy.data.objects.new(nm, me); ob.location = loc; bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            par(ob, parent)
        return ob
    r = WR * wheel_scale
    wd = 0.28 * (1.25 if chunky else 1)
    for tag, wx in (("F", wf), ("R", wr)):
        for side, sx in (("L", -1), ("R", 1)):
            y = new_len / 2 - (xmap(wx) - xmap(0)); x = sx * (lerp_profile(wx)["halfwidth"] - 0.08)
            t = prim(f"{name}_wheel_{tag}{side}", "cyl", (x, y, r), MAT["tyre"], chassis, seg=20, r=r, d=wd)
            prim(f"{t.name}_rim", "cyl", (x, y, r), MAT["wheel"], t, seg=10, r=r * 0.62, d=wd + 0.02)
    for sx in (-1, 1):
        for tag, y, m in (("head", new_len / 2 - 0.05, MAT["headlight"]), ("brake", -new_len / 2 + 0.05, MAT["brakelight"])):
            prim(f"{name}_light_{tag}_{'L' if sx < 0 else 'R'}", "cube", (sx * 0.55, y, 0.78 + lift), m, chassis, s=(0.32, 0.08, 0.1))
    # smooth shading
    return chassis, new_len

ref, len_ref = build("CRUZE_REF", False)
chunky, len_ch = build("CRUZE_CHUNKY", True)
ref.location.x = -1.4; chunky.location.x = 1.4
result = {"ref_len": round(len_ref, 3), "chunky_len": round(len_ch, 3),
          "objects": len(bpy.data.objects),
          "parts_ref": sorted(o.name for o in ref.children_recursive if o.type == "MESH")[:40]}
print(result)
