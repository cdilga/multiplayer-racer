"""Cruz Missile v2: an art-directed toy Cruze built from a designed cage, not pixel-measured profiles.

Approach (see ../RESEARCH-car-modelling.md):
  * The body is a sparse quad cage lofted through a handful of hand-chosen stations (DESIGN below).
    Every panel seam (bonnet, boot, doors, bumpers) sits on a station loop or ring point, so parts
    split along clean edge loops by construction.
  * One Catmull-Clark level with creases on the anchor lines (shoulder crease, arch lips) gives the
    smooth toy surface; the cage itself doubles as the medium LOD.
  * Style anchors (headlights, grille bar, lower grille, fog pockets, tail clusters, boot strip,
    windows) are "conformed panels": a convex 2D outline drawn in a projection frame, clipped from
    a small grid, ray-projected onto the body and lifted a few mm, with a short skirt so it never
    reads as a floating sheet.

Coordinates: metres, +Y forward, +Z up, origin on the ground between the axles.

Run:  blender -b -P build_cruze_v2.py -- <out_dir> [--render]
      (or exec inside a live Blender session; it builds into a fresh collection "CruzMissileV2")
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv and not argv[0].startswith("--") else None
RENDER = "--render" in argv
LOD = int(argv[argv.index("--lod") + 1]) if "--lod" in argv else 0
# LOD0 = hero/close-up (smoothed body), LOD1 = baseline gameplay mesh (the designed cage itself),
# LOD2 = medium/distant (cage with fewer stations, simple wheels).  Part IDs, anchors, colliders
# and dent names are identical in every LOD.
LODCFG = {
    0: dict(subsurf=1, cells=0.75, puck_n=12, wheel_seg=16, rim=True, spring="coil", skirt=True),
    1: dict(subsurf=0, cells=0.4, puck_n=8, wheel_seg=12, rim=True, spring="simple", skirt=True),
    2: dict(subsurf=0, cells=0.34, puck_n=6, wheel_seg=8, rim=False, spring="simple", skirt=False),
}[LOD]
LOD2_DROP = {1.78, 1.50, 1.32, -0.30, -1.50, -1.72}
HEADLESS = bpy.app.background

# ------------------------------------------------------------------ design data (edit these)
WHEEL = dict(radius=0.44, width=0.42, track_half=0.80, base_half=1.12, segments=LODCFG["wheel_seg"])
ARCH_R = 0.54            # arch opening radius around the hub
WELL_DEPTH = 0.50        # how far the wheel well reaches in from the body side
SILL_Z = 0.60            # body bottom between the arches (lifted stance)

# Body stations (one continuous shell).  Per station:
#   y, half-width w, bottom z, shoulder z, belt z, roof-edge/bonnet-crease point (gx, gz), centre z.
# On the bonnet and boot the belt/crease/centre points lie on the deck; between the screens they rise
# into the cabin (belt = window sill, g = roof edge / window top).  Proportions follow the stock
# Cruze plan view as ratios (windscreen base ~25% of length, roof 35-72%, rear screen to 86%,
# roof ~73% of body width, side glass ~95%), then toy-scaled.
# Arch stations get their arch height and flare automatically from the wheel positions.
STATIONS = [
    # y      w     zb      zs    belt   gx    gz     zc
    (1.84, 0.44, 0.58,   0.90, 0.95, 0.24, 0.975, 0.99),   # nose cap (rounded, drops away)
    (1.78, 0.70, 0.50,   0.98, 1.03, 0.40, 1.07, 1.09),
    (1.70, 0.84, 0.48,   1.04, 1.09, 0.50, 1.14, 1.16),
    (1.63, 0.90, 0.52,   1.08, 1.12, 0.56, 1.18, 1.21),    # front bumper seam = front arch start
    (1.50, 0.95, SILL_Z, 1.12, 1.15, 0.60, 1.23, 1.26),    # domed bonnet: centre well above the edges
    (1.32, 0.97, SILL_Z, 1.15, 1.18, 0.62, 1.27, 1.30),
    (1.12, 0.97, SILL_Z, 1.16, 1.20, 0.64, 1.29, 1.32),
    (0.92, 0.97, SILL_Z, 1.17, 1.23, 0.66, 1.31, 1.33),    # windscreen base = bonnet seam
    (0.74, 0.97, SILL_Z, 1.17, 1.30, 0.70, 1.50, 1.56),    # windscreen (raked ~45 deg)
    (0.61, 0.97, SILL_Z, 1.17, 1.33, 0.68, 1.64, 1.70),    # front door leading edge = arch end
    (0.30, 0.975, SILL_Z, 1.18, 1.35, 0.64, 1.84, 1.92),   # roof front (domed roof)
    (0.04, 0.975, SILL_Z, 1.19, 1.36, 0.64, 1.86, 1.95),   # B-pillar band
    (-0.04, 0.975, SILL_Z, 1.19, 1.36, 0.64, 1.86, 1.95),
    (-0.30, 0.975, SILL_Z, 1.19, 1.37, 0.64, 1.85, 1.94),
    (-0.61, 0.97, SILL_Z, 1.20, 1.38, 0.63, 1.82, 1.91),   # rear door trailing edge = arch start
    (-0.74, 0.97, SILL_Z, 1.20, 1.38, 0.63, 1.78, 1.86),   # roof rear = rear screen top
    (-0.92, 0.97, SILL_Z, 1.20, 1.39, 0.64, 1.63, 1.69),
    (-1.12, 0.97, SILL_Z, 1.20, 1.40, 0.64, 1.52, 1.57),
    (-1.27, 0.97, SILL_Z, 1.20, 1.40, 0.62, 1.47, 1.51),   # rear screen base = boot seam (high, domed boot)
    (-1.50, 0.96, SILL_Z, 1.20, 1.40, 0.60, 1.48, 1.53),
    (-1.63, 0.94, 0.56,   1.18, 1.37, 0.56, 1.45, 1.50),   # rear bumper seam = rear arch end
    (-1.72, 0.88, 0.54,   1.14, 1.31, 0.50, 1.38, 1.43),
    (-1.82, 0.70, 0.60,   1.06, 1.20, 0.40, 1.25, 1.28),   # tail cap (boot rolls down into it)
]
# Plan-view rounding: ring points move back (front) / forward (rear) by pull * (|x|/w)^2 -> bullet
# nose and rounded boot corners from above.
PLAN_PULL = {1.84: 0.14, 1.78: 0.10, 1.70: 0.05, 1.63: 0.02, -1.72: -0.04, -1.82: -0.10}
# Extra pull on the belt / roof-edge points only: wrap-around windscreen and rear screen.
TOP_PULL = {0.92: 0.10, 0.74: 0.07, 0.61: 0.05, 0.30: 0.03, -0.74: -0.03, -0.92: -0.05, -1.27: -0.06}
FLARE = 0.08             # extra half-width at the arch apex (toy flares)

SEAMS = dict(bumper_front=1.63, bonnet=0.92, roof_front=0.30, door_front=0.61, b_front=0.04,
             b_rear=-0.04, door_rear=-0.61, roof_rear=-0.74, boot=-1.27, bumper_rear=-1.63,
             win_front=0.74, win_rear=-0.92)

if LOD >= 2:
    STATIONS = [st for st in STATIONS if st[0] not in LOD2_DROP]

PALETTE = {  # semantic material -> (base colour, roughness, metallic, emission)
    "paint": ((0.72, 0.73, 0.75), 0.35, 0.3, None),
    "underside": ((0.08, 0.07, 0.07), 0.9, 0.0, None),
    "plastic": ((0.05, 0.05, 0.06), 0.7, 0.0, None),
    "metal": ((0.85, 0.86, 0.88), 0.15, 1.0, None),
    "glass": ((0.10, 0.16, 0.24), 0.05, 0.0, None),
    "tyre": ((0.04, 0.04, 0.04), 0.9, 0.0, None),
    "wheel": ((0.62, 0.63, 0.66), 0.3, 0.8, None),
    "headlight": ((1.0, 0.97, 0.85), 0.1, 0.0, (1.0, 0.9, 0.6)),
    "indicator": ((1.0, 0.55, 0.05), 0.2, 0.0, (1.0, 0.45, 0.0)),
    "brakelight": ((0.55, 0.03, 0.03), 0.2, 0.0, (0.5, 0.02, 0.01)),
    "brakelight_lens": ((0.95, 0.08, 0.05), 0.1, 0.0, (1.0, 0.08, 0.03)),
    "spring": ((1.0, 0.72, 0.08), 0.4, 0.2, None),
}

# ------------------------------------------------------------------ scene setup
if HEADLESS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
COLL_NAME = "CruzMissileV2"
if COLL_NAME in bpy.data.collections:
    old = bpy.data.collections[COLL_NAME]
    for o in list(old.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(old)
COLL = bpy.data.collections.new(COLL_NAME)
bpy.context.scene.collection.children.link(COLL)

MATS = {}
def material(name):
    if name in MATS:
        return MATS[name]
    col, rough, metal, emit = PALETTE[name]
    full = f"jj_{name}"
    m = bpy.data.materials.get(full) or bpy.data.materials.new(full)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*col, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 2.0
    m.diffuse_color = (*col, 1)
    m["jj_semantic"] = name
    MATS[name] = m
    return m


def new_object(name, bm, mats, parent=None, origin=None):
    """bm faces carry material_index into `mats` (list of semantic names)."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for mn in mats:
        me.materials.append(material(mn))
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    if origin is not None:
        me.transform(Matrix.Translation(-Vector(origin)))
        o.location = Vector(origin)
    for p in me.polygons:
        p.use_smooth = True
    if parent is not None:
        bpy.context.view_layer.update()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    o["jj_part"] = name
    return o


# ------------------------------------------------------------------ tub cage
AXLES = (WHEEL["base_half"], -WHEEL["base_half"])

def arch_at(y):
    """(arch bottom z, flare 0..1) for a station y; arch z == 0 when not over a wheel."""
    za, fl = 0.0, 0.0
    for ay in AXLES:
        dy = y - ay
        fl = max(fl, 1 - (dy / (ARCH_R + 0.35)) ** 2)
        if abs(dy) < ARCH_R:
            za = max(za, WHEEL["radius"] + math.sqrt(ARCH_R ** 2 - dy ** 2))
    return za, max(0.0, fl)

# Ring point names (right side, bottom -> top). Left side mirrors them.
RIGHT = ["in", "well", "lip", "low", "shoulder", "belt", "wtop", "g"]
SEG_NAMES = ["in-well", "well-lip", "lip-low", "low-shoulder", "shoulder-belt", "belt-wtop", "wtop-g", "g-C"]
IDX = {n: i for i, n in enumerate(RIGHT)}          # right index; left index = 16 - i


def station_ring(st):
    y, w0, zb, zs, zbelt, gx, gz, zc = st
    za, flare = arch_at(y)
    w = w0 + FLARE * flare
    arch = za > zb + 1e-3
    w_in = w - WELL_DEPTH
    if arch:
        p_in, p_well, p_lip = (w_in, zb), (w_in, za), (w, za + 0.04)
    else:
        p_in, p_well, p_lip = (w_in, zb), (w - 0.14, zb), (w - 0.05, zb + 0.09)
    z_low = max(zb + 0.38 * (zs - zb), (za + 0.09) if arch else 0)
    z_low = min(z_low, zs - 0.05)
    p_low = (w + 0.005, z_low)                   # fullest point of the barrel side
    p_sh = (w - 0.005, zs)                       # soft shoulder crease (style anchor)
    p_belt = (w0 - 0.11, zbelt)                  # deck edge / window sill, rolled inward
    p_g = (min(gx, w0 - 0.12), gz)               # bonnet crease / roof edge
    cabin = gz - zbelt > 0.12
    k = 0.8 if cabin else 0.5                    # window top sits 80% up the side glass: frame band above
    p_wtop = (p_belt[0] + k * (p_g[0] - p_belt[0]), p_belt[1] + k * (p_g[1] - p_belt[1]))
    right = [p_in, p_well, p_lip, p_low, p_sh, p_belt, p_wtop, p_g]
    pull = PLAN_PULL.get(y, 0.0)
    tpull = TOP_PULL.get(y, 0.0)

    def Y(i, x):
        yy = y - pull * (x / w) ** 2
        if i >= IDX["belt"]:
            yy -= tpull
        return yy
    pts = [Vector((x, Y(i, x), z)) for i, (x, z) in enumerate(right)]
    pts.append(Vector((0.0, y, zc)))             # top centre
    pts += [Vector((-x, Y(i, x), z)) for i, (x, z) in reversed(list(enumerate(right)))]
    return pts, arch

# ring index layout: 0..7 right (in..g), 8 top centre, 9..16 left (g..in); closing edge 16->0 underside
RING_N = 17


def seg_info(j):
    """segment j = edge ring[j] -> ring[(j+1)%N]: (side, name)."""
    if j == 16:
        return ("C", "bottom")
    if j < 8:
        return ("R", SEG_NAMES[j])
    return ("L", SEG_NAMES[15 - j])


def classify(y0, y1, side, seg, arch):
    """Return (part, semantic material) for a body face between stations y0 > y1."""
    ym = 0.5 * (y0 + y1)
    S = SEAMS
    if seg == "well-lip":
        mat = "plastic" if arch else "underside"
    elif seg in ("bottom", "in-well"):
        mat = "plastic" if (arch and seg == "in-well") else "underside"
    else:
        mat = "paint"
    upper = seg in ("belt-wtop", "wtop-g", "g-C")
    if ym > S["bumper_front"]:
        return ("bonnet" if upper else "bumper_front", mat)
    if ym < S["bumper_rear"]:
        return ("boot" if upper else "bumper_rear", mat)
    if upper and ym > S["bonnet"]:
        return ("bonnet", mat)
    if upper and ym < S["boot"]:
        return ("boot", mat)
    if seg == "g-C":
        if S["roof_front"] < ym < S["bonnet"] or S["boot"] < ym < S["roof_rear"]:
            return ("glass", "glass")                    # windscreen / rear screen
        return ("chassis", mat)                           # roof
    if seg == "belt-wtop":
        if S["b_front"] < ym < S["win_front"] or S["win_rear"] < ym < S["b_rear"]:
            return ("glass", "glass")                    # side windows (follow the A/C pillar slopes)
        return ("chassis", mat)                           # B pillar, quarter panels
    if seg == "wtop-g":
        return ("chassis", mat)                           # window frame / roof rail / pillars
    if seg in ("lip-low", "low-shoulder", "shoulder-belt") and side in "LR":
        if S["b_front"] < ym < S["door_front"]:
            return (f"door_{side}", mat)
        if S["door_rear"] < ym < S["b_rear"]:
            return (f"door_rear_{side}", mat)
    return ("chassis", mat)


def build_body():
    bm = bmesh.new()
    crease = bm.edges.layers.float.new("crease_edge")
    rings, arches = [], []
    for st in STATIONS:
        pts, arch = station_ring(st)
        rings.append([bm.verts.new(p) for p in pts])
        arches.append(arch)
    ys = [st[0] for st in STATIONS]
    slots = {}   # (part, mat) -> index

    def slot(key):
        if key not in slots:
            slots[key] = len(slots)
        return slots[key]
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        arch = arches[i] or arches[i + 1]
        for j in range(RING_N):
            jn = (j + 1) % RING_N
            f = bm.faces.new((a[j], b[j], b[jn], a[jn]))
            side, seg = seg_info(j)
            f.material_index = slot(classify(ys[i], ys[i + 1], side, seg, arch))
    # end caps as rungs (quads, one tri at the top)
    for ring, front in ((rings[0], True), (rings[-1], False)):
        part = "bumper_front" if front else "bumper_rear"
        R_ = ring[0:8]; T = ring[8]; L_ = list(reversed(ring[9:17]))
        faces = [(R_[k], R_[k + 1], L_[k + 1], L_[k]) for k in range(7)] + [(R_[7], T, L_[7])]
        for fv in faces:
            f = bm.faces.new(fv if front else tuple(reversed(fv)))
            f.material_index = slot((part, "paint"))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    def crease_line(name, value, y_hi=99, y_lo=-99, only_arch=False):
        """Crease the lengthwise line through ring point `name` (both sides) between y_hi and y_lo."""
        for idx in (IDX[name], 16 - IDX[name]):
            for i in range(len(rings) - 1):
                if only_arch and not (arches[i] or arches[i + 1]):
                    continue
                if not (ys[i] <= y_hi + 1e-6 and ys[i + 1] >= y_lo - 1e-6):
                    continue
                e = bm.edges.get((rings[i][idx], rings[i + 1][idx]))
                if e:
                    e[crease] = max(e[crease], value)

    def crease_loop(y, seg_names, value):
        """Crease the cross-section edges of station y that belong to the given segments."""
        i = ys.index(y)
        for j in range(RING_N):
            if seg_info(j)[1] in seg_names:
                e = bm.edges.get((rings[i][j], rings[i][(j + 1) % RING_N]))
                if e:
                    e[crease] = max(e[crease], value)
    S = SEAMS
    crease_line("shoulder", 0.55)
    crease_line("lip", 0.6, only_arch=True)
    crease_line("belt", 0.7, S["bonnet"], S["boot"])                  # window sill / belt line
    crease_line("g", 0.5, S["bonnet"], S["boot"])                     # roof edge, A/C pillar edges
    crease_line("wtop", 0.8, S["win_front"], S["win_rear"])           # window top
    crease_line("g", 0.35, 99, S["bonnet"])                           # soft bonnet creases
    for y in (S["bonnet"], S["roof_front"], S["roof_rear"], S["boot"]):
        crease_loop(y, ("g-C",), 0.7)                                   # screen outlines
    for y in (S["win_front"], S["b_front"], S["b_rear"], S["win_rear"]):
        crease_loop(y, ("belt-wtop",), 0.7)                             # side window ends
    return bm, slots


def subdivide(bm, levels=1, name="tmp"):
    """Apply Catmull-Clark (with creases) through a temporary modifier; returns a new bmesh."""
    me = bpy.data.meshes.new(name + "_cage")
    bm.to_mesh(me)
    o = bpy.data.objects.new(name + "_cage", me)
    COLL.objects.link(o)
    mod = o.modifiers.new("sub", "SUBSURF")
    mod.levels = mod.render_levels = levels
    mod.use_creases = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    out = bmesh.new()
    out.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.meshes.remove(me)
    return out


def split_by_slot(bm, slots):
    """-> {part: bmesh with material_index remapped to a per-part semantic list}."""
    inv = {v: k for k, v in slots.items()}
    parts = {}
    for idx, (part, mat) in inv.items():
        parts.setdefault(part, []).append((idx, mat))
    result = {}
    for part, entries in parts.items():
        keep = {idx for idx, _ in entries}
        mats = []
        remap = {}
        for idx, mat in entries:
            if mat not in mats:
                mats.append(mat)
            remap[idx] = mats.index(mat)
        b = bm.copy()
        bmesh.ops.delete(b, geom=[f for f in b.faces if f.material_index not in keep], context="FACES")
        for f in b.faces:
            f.material_index = remap[f.material_index]
        bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context="VERTS")
        result[part] = (b, mats)
    return result


# ------------------------------------------------------------------ conformed panels
def frame(d, up=Vector((0, 0, 1))):
    d = d.normalized()
    u = d.cross(up).normalized()
    v = u.cross(d).normalized()
    if v.z < 0:
        v = -v
    return u, v, d


def panel(bm_out, bvh, outline, origin, d, mat_index, lift=0.012, bulge=0.0, skirt=0.02, cells=7,
          mirror_x=False):
    """Add a conformed panel to bm_out. outline: convex [(s,t)] in the (u,v) frame at origin,
    projected along -d onto bvh."""
    cells = max(2, int(round(cells * LODCFG["cells"])))
    u, v, d = frame(d)
    if mirror_x:
        outline = [(-s, t) for s, t in outline]
    ss = [p[0] for p in outline]; ts = [p[1] for p in outline]
    s0, s1, t0, t1 = min(ss), max(ss), min(ts), max(ts)
    b = bmesh.new()
    bmesh.ops.create_grid(b, x_segments=cells, y_segments=cells, size=0.5)
    for vtx in b.verts:
        vtx.co = Vector((s0 + (vtx.co.x + 0.5) * (s1 - s0), t0 + (vtx.co.y + 0.5) * (t1 - t0), 0))
    # clip by each outline edge (convex, counter-clockwise or clockwise both handled)
    cx, cy = sum(ss) / len(ss), sum(ts) / len(ts)
    n = len(outline)
    for k in range(n):
        a = Vector((*outline[k], 0)); c = Vector((*outline[(k + 1) % n], 0))
        e = c - a
        no = Vector((e.y, -e.x, 0)).normalized()
        if no.dot(Vector((cx, cy, 0)) - a) > 0:
            no = -no
        geom = b.verts[:] + b.edges[:] + b.faces[:]
        bmesh.ops.bisect_plane(b, geom=geom, dist=1e-6, plane_co=a, plane_no=no, clear_outer=True)
    rmax = max((Vector((s, t)) - Vector((cx, cy))).length for s, t in outline) or 1
    vmap = {}
    for vtx in b.verts:
        s, t = vtx.co.x, vtx.co.y
        p = Vector(origin) + u * s + v * t
        hit, nrm, _, _ = bvh.ray_cast(p + d * 3.0, -d)
        if hit is None:
            hit, nrm, _, _ = bvh.find_nearest(p)
        r = (Vector((s, t)) - Vector((cx, cy))).length / rmax
        top = hit + nrm * (lift + bulge * max(0.0, 1 - r * r))
        vmap[vtx] = (top, hit - nrm * 0.004)
    new = {vtx: bm_out.verts.new(vmap[vtx][0]) for vtx in b.verts}
    for f in b.faces:
        nf = bm_out.faces.new([new[x] for x in f.verts])
        nf.material_index = mat_index
        nf.smooth = True
    # skirt: boundary edges drop back to the surface
    for e in (b.edges if LODCFG["skirt"] else []):
        if e.is_boundary:
            v0, v1 = e.verts
            f = e.link_faces[0]
            # keep winding consistent with the face
            loop = next(l for l in f.loops if l.edge == e)
            a_, b_ = loop.vert, loop.link_loop_next.vert
            sa = bm_out.verts.new(vmap[a_][1]); sb = bm_out.verts.new(vmap[b_][1])
            sf = bm_out.faces.new((new[b_], new[a_], sa, sb))
            sf.material_index = mat_index
            sf.smooth = False
    b.free()
    return bm_out


def circle(cx, cy, r, n=12, sx=1.0):
    return [(cx + r * sx * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def puck(bm_out, bvh, origin, d, st, r, mat_ring, mat_face, depth=0.03, dome=0.012, n=14,
         ring_w=0.18, mirror_x=False):
    """A crisp round lamp aligned to the body surface: chrome ring + slightly domed lens.
    st = (s, t) in the same projection frame as panel(); r = outer radius."""
    n = min(n, LODCFG["puck_n"])
    u, v, d = frame(d)
    s_, t_ = st
    if mirror_x:
        s_ = -s_
    p = Vector(origin) + u * s_ + v * t_
    hit, nrm, _, _ = bvh.ray_cast(p + d * 3.0, -d)
    if hit is None:
        hit, nrm, _, _ = bvh.find_nearest(p)
    a = nrm.orthogonal().normalized()
    b = nrm.cross(a).normalized()
    def ring(radius, off):
        return [bm_out.verts.new(hit + nrm * off + (a * math.cos(2 * math.pi * k / n) + b * math.sin(2 * math.pi * k / n)) * radius)
                for k in range(n)]
    if LOD >= 2:                                  # distant: just the lens disc
        rim = ring(r, depth * 0.5)
        f = bm_out.faces.new(rim); f.material_index = mat_face
        return bm_out
    back = ring(r, -0.01)
    front = ring(r, depth)
    inner = ring(r * (1 - ring_w), depth)
    for k in range(n):
        k1 = (k + 1) % n
        f = bm_out.faces.new((back[k], back[k1], front[k1], front[k])); f.material_index = mat_ring
        f = bm_out.faces.new((front[k], front[k1], inner[k1], inner[k])); f.material_index = mat_ring; f.smooth = True
    c = bm_out.verts.new(hit + nrm * (depth + dome))
    for k in range(n):
        f = bm_out.faces.new((inner[k], inner[(k + 1) % n], c)); f.material_index = mat_face; f.smooth = True
    return bm_out


def mirrored_bm(bm):
    b = bm.copy()
    bmesh.ops.scale(b, vec=Vector((-1, 1, 1)), verts=b.verts)
    bmesh.ops.reverse_faces(b, faces=b.faces)
    return b


# ------------------------------------------------------------------ wheels + suspension
def build_wheel():
    """Chunky AT tyre (staggered tread lugs in the silhouette) + five-spoke rim. Axle = X."""
    R, W, N = WHEEL["radius"], WHEEL["width"], WHEEL["segments"]
    hw = W / 2
    bm = bmesh.new()
    # profile (radius, x) from inner bead round to outer bead
    prof = [(0.29, -hw + 0.02), (0.38, -hw), (0.425, -hw + 0.03), (R, -hw * 0.45), (R, hw * 0.45),
            (0.425, hw - 0.03), (0.38, hw), (0.29, hw - 0.02)]
    if not LODCFG["rim"]:
        prof = [(0.29, -hw), (R, -hw * 0.7), (R, hw * 0.7), (0.29, hw)]
    rings = []
    for k in range(N):
        a = 2 * math.pi * k / N
        lug = (k % 2 == 0)
        ring = []
        for pi_, (r, x) in enumerate(prof):
            rr = r
            if LODCFG["rim"] and pi_ in (3, 4):   # tread band: alternate block height
                rr = R if lug else R - 0.045
            if LODCFG["rim"] and pi_ in (2, 5):   # shoulder lugs, staggered
                rr = min(R, r + (0.03 if not lug else 0.0))
            ring.append(bm.verts.new((x, rr * math.cos(a), rr * math.sin(a))))
        rings.append(ring)
    for k in range(N):
        a, b = rings[k], rings[(k + 1) % N]
        for j in range(len(prof) - 1):
            f = bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
            f.material_index = 0
    # rim: outer face dish (x = hw - 0.03), ring + 5 spokes + hub, dark back disc
    rx = hw - 0.03
    def disc(radius, x, n, mat):
        vs = [bm.verts.new((x, radius * math.cos(2 * math.pi * k / n), radius * math.sin(2 * math.pi * k / n))) for k in range(n)]
        f = bm.faces.new(vs if x > 0 else list(reversed(vs)))
        f.material_index = mat
        return vs
    if not LODCFG["rim"]:
        disc(0.29, hw, N, 1)                      # flat rim face
        bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index == 0])
        return bm, ["tyre", "wheel", "plastic"]
    disc(0.29, rx - 0.06, N, 2)                   # dark back disc (plastic)
    outer = [bm.verts.new((rx, 0.29 * math.cos(2 * math.pi * k / N), 0.29 * math.sin(2 * math.pi * k / N))) for k in range(N)]
    inner = [bm.verts.new((rx + 0.01, 0.24 * math.cos(2 * math.pi * k / N), 0.24 * math.sin(2 * math.pi * k / N))) for k in range(N)]
    for k in range(N):
        f = bm.faces.new((outer[k], outer[(k + 1) % N], inner[(k + 1) % N], inner[k]))
        f.material_index = 1
    for s in range(5):                            # spokes: flat wedges hub -> ring
        a = 2 * math.pi * s / 5
        c, sn = math.cos(a), math.sin(a)
        pc, ps = -sn, c
        def P(r, off, x):
            return Vector((x, r * c + off * pc, r * sn + off * ps))
        quad = [P(0.07, -0.035, rx + 0.02), P(0.25, -0.05, rx + 0.005), P(0.25, 0.05, rx + 0.005), P(0.07, 0.035, rx + 0.02)]
        vs = [bm.verts.new(q) for q in quad]
        f = bm.faces.new(vs)
        f.material_index = 1
    hub = disc(0.08, rx + 0.03, 8, 1)
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index == 0])
    return bm, ["tyre", "wheel", "plastic"]


def build_spring(z0, z1, radius=0.075, turns=3.5, per_turn=6, wire=0.024):
    bm = bmesh.new()
    if LODCFG["spring"] == "simple":              # coil read as a yellow sleeve over the damper
        c = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=radius, radius2=radius, depth=(z1 - z0) * 0.8)
        for v in c["verts"]:
            v.co.z += (z0 + z1) / 2
        for f in bm.faces:
            f.material_index = 0
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm, ["spring", "metal"]
    n = int(turns * per_turn)
    prev = None
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * turns * t
        c = Vector((radius * math.cos(a), radius * math.sin(a), z0 + (z1 - z0) * t))
        tangent = Vector((-math.sin(a), math.cos(a), 0)).normalized()
        radial = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for k in range(4):
            b_ = 2 * math.pi * k / 4
            ring.append(bm.verts.new(c + (radial * math.cos(b_) + Vector((0, 0, 1)) * math.sin(b_)) * wire))
        if prev:
            for k in range(4):
                bm.faces.new((prev[k], prev[(k + 1) % 4], ring[(k + 1) % 4], ring[k]))
        prev = ring
    # damper body through the middle
    d = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.035, radius2=0.035, depth=(z1 - z0))
    for v in d["verts"]:
        v.co.z += (z0 + z1) / 2
    for f in bm.faces:
        f.material_index = 1 if any(v in d["verts"] for v in f.verts) else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, ["spring", "metal"]


# ------------------------------------------------------------------ collider helpers
def hull_object(name, points, parent):
    b = bmesh.new()
    for pt in points:
        b.verts.new(pt)
    res = bmesh.ops.convex_hull(b, input=b.verts[:])
    drop = {g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)}
    bmesh.ops.delete(b, geom=list(drop), context="VERTS")
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    o = new_object(name, b, [], parent=parent)
    del o["jj_part"]
    o.display_type = "WIRE"
    return o


def collider_meta(o, shape, part):
    o["jj_collider"] = {"shape": shape, "part": part}
    o.hide_render = True



# ------------------------------------------------------------------ build
body_cage, slots = build_body()
tub = subdivide(body_cage, LODCFG["subsurf"], "body") if LODCFG["subsurf"] else body_cage.copy()

# a BVH over the smooth shell for projecting the detail panels
BVH_TUB = BVHTree.FromBMesh(tub)

parts = split_by_slot(tub, slots)
chassis_bm, chassis_mats = parts.pop("chassis")
chassis = new_object("chassis", chassis_bm, chassis_mats)
objs = {"chassis": chassis}

HINGE = {
    "bonnet": ("y_min", "top"), "boot": ("y_max", "top"),
    "door_L": ("y_max", "side"), "door_R": ("y_max", "side"),
    "door_rear_L": ("y_max", "side"), "door_rear_R": ("y_max", "side"),
}
for name, (b, mats) in parts.items():
    co = [v.co for v in b.verts]
    xs = [c.x for c in co]; ys = [c.y for c in co]; zs = [c.z for c in co]
    origin = None
    if name in HINGE:
        edge, kind = HINGE[name]
        y = min(ys) if edge == "y_min" else max(ys)
        if kind == "side":
            x = max(xs) if name.endswith("R") else min(xs)
            origin = (x, y, (min(zs) + max(zs)) / 2)
        else:
            origin = (0.0, y, max(zs) if name == "bonnet" else max(zs))
    objs[name] = new_object(name, b, mats, parent=chassis, origin=origin)

# ---- style anchor panels -------------------------------------------------
def panel_object(name, specs, mats, parent=None):
    bm = bmesh.new()
    for spec in specs:
        if spec.get("lod_max", 9) < LOD:
            continue
        spec = {k: v for k, v in spec.items() if k != "lod_max"}
        if spec.get("kind") == "puck":
            spec = dict(spec); spec.pop("kind")
            puck(bm, **spec)
        else:
            panel(bm, **spec)
    bm.normal_update()
    o = new_object(name, bm, mats, parent=parent or chassis)
    return o

FRONT = Vector((0, 1, 0)); REAR = Vector((0, -1, 0)); SIDE_R = Vector((1, 0, 0)); SIDE_L = Vector((-1, 0, 0))

# Anchor 1: swept headlights that wrap into the guards, amber tip, round projector "eye".
HL_DIR = Vector((0.6, 1.0, 0.55))
hl_origin = Vector((0.50, 1.74, 1.02))
hl_outline = [(-0.27, -0.09), (0.12, -0.13), (0.44, -0.04), (0.66, 0.15), (0.44, 0.20), (-0.27, 0.12)]
hl_lens = [(-0.24, -0.07), (0.12, -0.105), (0.40, -0.025), (0.57, 0.14), (0.40, 0.17), (-0.24, 0.095)]
amber = [(0.42, 0.0), (0.57, 0.14), (0.45, 0.17), (0.34, 0.08)]
proj = circle(-0.07, 0.015, 0.10, 14)
proj_core = circle(-0.07, 0.015, 0.068, 12)
for side in ("R", "L"):
    sx = 1 if side == "R" else -1
    d = Vector((HL_DIR.x * sx, HL_DIR.y, HL_DIR.z))
    org = Vector((hl_origin.x * sx, hl_origin.y, hl_origin.z))
    mir = side == "L"
    objs[f"light_head_{side}"] = panel_object(f"light_head_{side}", [
        dict(bvh=BVH_TUB, outline=hl_outline, origin=org, d=d, mat_index=0, lift=0.010, cells=6, mirror_x=mir, lod_max=1),
        dict(bvh=BVH_TUB, outline=hl_lens, origin=org, d=d, mat_index=2, lift=0.016, cells=6, mirror_x=mir),
        dict(bvh=BVH_TUB, outline=amber, origin=org, d=d, mat_index=1, lift=0.02, cells=3, mirror_x=mir),
        dict(kind="puck", bvh=BVH_TUB, origin=org, d=d, st=(-0.07, 0.015), r=0.095, mat_ring=3, mat_face=2,
             depth=0.028, dome=0.01, mirror_x=mir),
    ], ["plastic", "indicator", "headlight", "metal"])

# Anchor 2 + 3: chrome split bar with a blank disc over a big dark trapezoid lower grille,
# round fog lamps in dark triangular pockets.  All on the front bumper.
fo = Vector((0, 1.85, 0))
front_specs = [
    dict(bvh=BVH_TUB, outline=[(-0.40, 0.78), (0.40, 0.78), (0.36, 0.845), (-0.36, 0.845)], origin=fo, d=FRONT, mat_index=0, lift=0.012, cells=5, lod_max=1),   # upper grille (dark)
    dict(bvh=BVH_TUB, outline=[(-0.46, 0.845), (0.46, 0.845), (0.42, 0.905), (-0.42, 0.905)], origin=fo, d=FRONT, mat_index=1, lift=0.02, cells=5),  # chrome bar
    dict(kind="puck", bvh=BVH_TUB, origin=fo, d=FRONT, st=(0, 0.875), r=0.075, mat_ring=1, mat_face=1, depth=0.035, dome=0.01),  # blank disc
    dict(bvh=BVH_TUB, outline=[(-0.36, 0.52), (0.36, 0.52), (0.52, 0.75), (-0.52, 0.75)], origin=fo, d=FRONT, mat_index=0, lift=0.012, cells=5),     # lower grille
]
for sx in (1, -1):
    tri = [(0.56 * sx, 0.52), (0.84 * sx, 0.56), (0.74 * sx, 0.77)]
    front_specs.append(dict(bvh=BVH_TUB, outline=tri, origin=fo, d=Vector((0.25 * sx, 1, 0)), mat_index=0, lift=0.012, cells=5))
    front_specs.append(dict(kind="puck", bvh=BVH_TUB, origin=fo, d=Vector((0.25 * sx, 1, 0)), st=(0.70 * sx, 0.62), r=0.07,
                            mat_ring=1, mat_face=2, depth=0.02, dome=0.008))
bf = objs["bumper_front"]
trim = panel_object("bumper_front_trim", front_specs, ["plastic", "metal", "headlight"], parent=bf)

# Anchor 6: wrap-around tail clusters with two round red lenses in chrome bezels.
TL_DIR = Vector((0.7, -1.0, 0.2))
tl_origin = Vector((0.58, -1.76, 1.17))
tl_outline = [(-0.24, -0.11), (0.24, -0.13), (0.50, -0.04), (0.52, 0.12), (-0.24, 0.13)]
LENSES = [(-0.07, 0.005), (0.16, 0.0)]
for side in ("R", "L"):
    sx = 1 if side == "R" else -1
    d = Vector((TL_DIR.x * sx, TL_DIR.y, TL_DIR.z))
    org = Vector((tl_origin.x * sx, tl_origin.y, tl_origin.z))
    # the rear frame's u axis points inboard on the right, so the right side mirrors the outline
    mir = side == "R"
    specs = [dict(bvh=BVH_TUB, outline=tl_outline, origin=org, d=d, mat_index=2, lift=0.012, cells=6, mirror_x=mir)]
    for cx, cy in LENSES:
        specs.append(dict(bvh=BVH_TUB, outline=circle(cx, cy, 0.105, 12), origin=org, d=d, mat_index=1, lift=0.02, cells=3, mirror_x=mir, lod_max=1))
        specs.append(dict(bvh=BVH_TUB, outline=circle(cx, cy, 0.08, 12), origin=org, d=d, mat_index=3, lift=0.028, bulge=0.014, cells=2, mirror_x=mir))
    objs[f"light_brake_{side}"] = panel_object(f"light_brake_{side}", specs, ["plastic", "metal", "brakelight", "brakelight_lens"])

# Anchor 5: high short boot with a chrome strip across the lid.
boot = objs["boot"]
panel_object("boot_trim", [dict(bvh=BVH_TUB, outline=[(-0.34, 1.19), (0.34, 1.19), (0.32, 1.245), (-0.32, 1.245)], origin=Vector((0, -1.82, 0)), d=REAR, mat_index=0, lift=0.016, cells=4)], ["metal"], parent=boot)

# Mirrors: body-coloured wedges on the front doors.
for side in ("R", "L"):
    sx = 1 if side == "R" else -1
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vtx in bm.verts:
        x, y, z = vtx.co
        vtx.co = Vector((0.07 + x * 0.14 + (0.03 if z > 0 else 0) * (x + 0.5), y * (0.16 - 0.05 * (x + 0.5)), z * 0.11))
    if LOD < 2:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.02, segments=1, affect="EDGES")
    for vtx in bm.verts:
        vtx.co.x *= sx
        vtx.co += Vector((0.88 * sx, 0.80, 1.36))
    if sx < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    objs[f"mirror_{side}"] = new_object(f"mirror_{side}", bm, ["paint"], parent=objs[f"door_{side}"])

# Wheels (hub pivots) and suspension (coil-overs visible in the lifted arches).
wbm, wmats = build_wheel()
for name, y in (("FL", AXLES[0]), ("FR", AXLES[0]), ("RL", AXLES[1]), ("RR", AXLES[1])):
    sx = 1 if name.endswith("R") else -1
    b = wbm.copy() if sx > 0 else mirrored_bm(wbm)
    hub = Vector((WHEEL["track_half"] * sx, y, WHEEL["radius"]))
    bmesh.ops.translate(b, vec=hub, verts=b.verts)
    objs[f"wheel_{name}"] = new_object(f"wheel_{name}", b, wmats, parent=chassis, origin=hub)
    cb = bmesh.new()
    cyl = bmesh.ops.create_cone(cb, cap_ends=True, segments=12, radius1=WHEEL["radius"], radius2=WHEEL["radius"], depth=WHEEL["width"])
    bmesh.ops.rotate(cb, verts=cb.verts, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    bmesh.ops.translate(cb, vec=hub, verts=cb.verts)
    co = new_object(f"col_wheel_{name}", cb, [], parent=objs[f"wheel_{name}"])
    del co["jj_part"]; co.display_type = "WIRE"
    collider_meta(co, "cylinder", f"wheel_{name}")
    sb, smats = build_spring(WHEEL["radius"] + 0.06, 0.96)
    bmesh.ops.translate(sb, vec=Vector(((WHEEL["track_half"] - 0.25) * sx, y, 0)), verts=sb.verts)
    # lower arm from the spring base to the hub
    arm = bmesh.ops.create_cube(sb, size=1.0)
    for vtx in arm["verts"]:
        vtx.co = Vector(((WHEEL["track_half"] - 0.27 + 0.13 * (vtx.co.x + 0.5)) * sx, y + vtx.co.y * 0.08, WHEEL["radius"] + 0.02 + vtx.co.z * 0.05))
    for f in sb.faces:
        if all(v in arm["verts"] for v in f.verts):
            f.material_index = 1
    bmesh.ops.recalc_face_normals(sb, faces=sb.faces)
    objs[f"susp_{name}"] = new_object(f"susp_{name}", sb, smats, parent=chassis,
                                      origin=((WHEEL["track_half"] - 0.25) * sx, y, 0.96))

# ---- collision proxies: convex hulls from the design cage, boxes per panel, cylinders per wheel
body_cage.verts.ensure_lookup_table()
LOW = set(range(0, 6)) | set(range(11, 17))            # in..belt, both sides
CAB = set(range(5, 12))                                # belt..roof centre..belt
lower_pts, cabin_pts = [], []
for i, st in enumerate(STATIONS):
    for j in range(RING_N):
        co = body_cage.verts[i * RING_N + j].co.copy()
        if j in LOW and SEAMS["bumper_rear"] - 0.01 <= st[0] <= SEAMS["bumper_front"] + 0.01:
            lower_pts.append(co)                       # bumpers bring their own colliders while attached
        if j in CAB and SEAMS["boot"] - 0.01 <= st[0] <= SEAMS["bonnet"] + 0.01:
            cabin_pts.append(co)
collider_meta(hull_object("col_chassis", lower_pts, chassis), "convex", "chassis")
collider_meta(hull_object("col_cabin", cabin_pts, chassis), "convex", "chassis")

for pname in ("bumper_front", "bumper_rear"):            # rounded nose/tail: hull, not a box
    po = objs[pname]
    collider_meta(hull_object(f"col_{pname}", [po.matrix_world @ v.co for v in po.data.vertices], po), "convex", pname)
for pname in ("bonnet", "boot", "door_L", "door_R", "door_rear_L", "door_rear_R"):
    po = objs[pname]
    mw = po.matrix_world
    cs = [mw @ v.co for v in po.data.vertices]
    lo = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
    hi = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    b = bmesh.new()
    bmesh.ops.create_cube(b, size=1.0)
    for v in b.verts:
        v.co = Vector((lo.x + (v.co.x + 0.5) * (hi.x - lo.x), lo.y + (v.co.y + 0.5) * (hi.y - lo.y), lo.z + (v.co.z + 0.5) * (hi.z - lo.z)))
    o = new_object(f"col_{pname}", b, [], parent=po)
    del o["jj_part"]; o.display_type = "WIRE"
    collider_meta(o, "box", pname)

# Anchors / empties from the vehicle contract.
def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.15
    e.location = loc
    COLL.objects.link(e)
    e.parent = chassis
    return e
empty("cam_fp", (0.35, 0.10, 1.62)); empty("cam_tp_target", (0, 0, 1.2)); empty("com", (0, 0.05, 0.60))  # arcade-low CoM: lifted look, planted handling (physics fit)
empty("roof_number", (0, -0.15, max(st[7] for st in STATIONS) + 0.005))
empty("lplate_front", (0, 1.83, 0.56)); empty("lplate_rear", (0, -1.83, 0.92)); empty("exhaust_0", (-0.45, -1.76, 0.60))

# joint metadata (same keys as the spike E rig contract)
for n in ("door_L", "door_R", "door_rear_L", "door_rear_R"):
    o = objs[n]; o["jj_joint"] = "hinge"; o["jj_axis"] = [0, 0, 1 if n.endswith("R") else -1]; o["jj_range_deg"] = [0, 70]
objs["bonnet"]["jj_joint"] = "hinge"; objs["bonnet"]["jj_axis"] = [1, 0, 0]; objs["bonnet"]["jj_range_deg"] = [0, 60]
objs["boot"]["jj_joint"] = "hinge"; objs["boot"]["jj_axis"] = [-1, 0, 0]; objs["boot"]["jj_range_deg"] = [0, 60]
for n in ("FL", "FR"):
    o = objs[f"wheel_{n}"]; o["jj_joint"] = "compound"; o["jj_axis_steer"] = [0, 0, 1]; o["jj_range_steer_deg"] = [-35, 35]; o["jj_axis_spin"] = [1, 0, 0]
for n in ("RL", "RR"):
    o = objs[f"wheel_{n}"]; o["jj_joint"] = "spin"; o["jj_axis"] = [1, 0, 0]
for n in ("FL", "FR", "RL", "RR"):
    objs[f"susp_{n}"]["jj_joint"] = "suspension"; objs[f"susp_{n}"]["jj_axis"] = [0, 0, 1]

# ------------------------------------------------------------------ stats
stats = {}
tot = 0
for o in COLL.objects:
    if o.type == "MESH" and not o.name.startswith("col_"):
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        stats[o.name] = t
        tot += t
stats["_total_tris"] = tot
stats["_cage_quads"] = len(body_cage.faces)
print("CRUZE_V2_STATS", json.dumps(stats))

if OUT:
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"stats.lod{LOD}.json"), "w") as f:
        json.dump(stats, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"cruze_v2.lod{LOD}.blend"))
